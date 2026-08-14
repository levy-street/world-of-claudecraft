// Pure residency policy for the per-biome sky assets (src/render/sky.ts owns
// the stores, src/render/renderer.ts drives this plan on the zone-streaming
// recheck cadence).
//
// The problem it solves: one biome's dome HDR is a 2k half-float DataTexture
// (about 16.8 MB of CPU pixels plus the same again on the GPU once uploaded),
// its PMREM source another (small) one, and both were fetch-memoized for the
// whole session. Nineteen shipped sky keys therefore accumulated with no upper
// bound over a long session that crosses many realms. This core answers the
// only two questions that eviction needs: which keys should be resident near
// the camera, and which resident key is far enough away to give its memory
// back.
//
// Distances are measured to a key's nearest RECTANGLE, not to a zone centre,
// and a key that spans several zones (the Vale sky covers both Eastbrook and
// the Farshore isle) takes the minimum across all of them.

import { INITIAL_SKY_PREWARM_RADIUS, MAX_OUTDOOR_FOG_FAR } from './zone_streaming';

// The keep radius is the ceiling of every horizon the background streaming lane
// can ask for: the renderer feeds queueVisibleZonePrepares
// max(subsystemCullFar, lastRequestedFogFar), and both are bounded by
// MAX_OUTDOOR_FOG_FAR (the vista arm requests FOGLESS_DETAIL_FAR = 700, the
// fogged arm requests preset.far scaled by the day/night farScale, which never
// exceeds 1). Anchoring KEEP there is what makes eviction unable to fight that
// lane: nothing inside the horizon a zone prepare can be queued from is ever a
// candidate for release.
export const SKY_KEEP_RADIUS = MAX_OUTDOOR_FOG_FAR;
// The hysteresis band, so a camera loitering on the boundary cannot thrash a
// fetch/dispose cycle. The plan runs on the streaming recheck cadence, so the
// camera advances at most ZONE_STREAM_RECHECK_DISTANCE (24 yd) between two
// plans; the band is INITIAL_SKY_PREWARM_RADIUS (240 yd, ten of those steps),
// the same runway the loading-screen prewarm treats as "one normal travel
// transition". A key that leaves the keep radius therefore has a full travel
// transition of slack before anything is disposed.
export const SKY_EVICT_RADIUS = SKY_KEEP_RADIUS + INITIAL_SKY_PREWARM_RADIUS;

/** One rectangle a sky key is drawn over (a zone rect, or a place-keyed window). */
export interface SkyResidencyRegion<K extends string> {
  readonly key: K;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface SkyResidencyInput<K extends string> {
  readonly regions: readonly SkyResidencyRegion<K>[];
  readonly cameraX: number;
  readonly cameraZ: number;
  /**
   * Keys holding ANY decoded sky asset right now (dome HDR, PMREM source or
   * backdrop). Deliberately the memory-accurate set rather than the
   * fully-resident one: a key holding half its set is still holding the
   * expensive half, so it must stay evictable.
   */
  readonly resident: Iterable<K>;
  /**
   * Keys whose sky set is FULLY landed (both HDR arms). Only this set may
   * suppress an ensure: suppressing on `resident` stranded a biome whose dome
   * arrived while its env arm exhausted retries, with nothing left to enqueue
   * the missing half (review round 2). Defaults to `resident` when omitted,
   * which keeps the old behavior for callers without partial-load states.
   */
  readonly ready?: Iterable<K>;
  /**
   * Keys that must never be evicted whatever the distance says: the dome
   * blend's live `from`/`to` pair (their textures are bound into live shader
   * uniforms) and the biome whose prefiltered environment is bound as
   * scene.environment.
   */
  readonly pinned: Iterable<K>;
  /**
   * Keys the caller is willing to (re-)fetch, when it wants a narrower set than
   * "everything inside the keep radius". The renderer passes the sky keys of
   * the zones it has already PREPARED: an unprepared zone's sky belongs to the
   * streaming lane (prepareZoneSky), while a PREPARED zone never re-runs that
   * lane, and is therefore exactly the set an eviction could otherwise strand.
   * Omit to let every key inside the keep radius be ensured.
   */
  readonly ensurable?: Iterable<K>;
  readonly keepRadius?: number;
  readonly evictRadius?: number;
}

export interface SkyResidencyPlan<K extends string> {
  /** Non-resident keys inside the keep radius, nearest first. */
  readonly ensure: K[];
  /** Resident, unpinned keys past the evict radius. */
  readonly evict: K[];
}

/**
 * Whether an ARRIVAL at a zone can skip the zone-warmup path entirely.
 * Terrain and shader programs are necessary but not sufficient: a prepared
 * zone's sky may have been evicted while the player was away, and bailing on
 * terrain alone would make prepareZoneAt's sky recovery branch unreachable
 * from the arrival path, leaving the residency lane to rebuild the sky during
 * live play (fetch, upload and PMREM included) under the previous realm's
 * frozen dome. The shadowless tiers never fetch sky HDRIs, so sky residency
 * is permanently false there and must not gate arrival (same carve-out as the
 * recovery branch itself).
 */
export function zoneArrivalReady(input: {
  readonly prepared: boolean;
  readonly programsPrewarmed: boolean;
  readonly standardMaterials: boolean;
  /** Lazily evaluated: the caller sits on a per-frame arrival check and the
   *  residency readout allocates, so it must only run once every cheap gate
   *  above it has passed. */
  readonly skyResident: () => boolean;
}): boolean {
  if (!input.prepared || !input.programsPrewarmed) return false;
  if (!input.standardMaterials) return true;
  return input.skyResident();
}

/** Squared XZ distance from a point to a region's rectangle (0 when inside). */
function distanceSqToRegion<K extends string>(
  region: SkyResidencyRegion<K>,
  x: number,
  z: number,
): number {
  const dx = x < region.minX ? region.minX - x : x > region.maxX ? x - region.maxX : 0;
  const dz = z < region.minZ ? region.minZ - z : z > region.maxZ ? z - region.maxZ : 0;
  return dx * dx + dz * dz;
}

/**
 * The ensure/evict plan for the sky stores at one camera position.
 *
 * A resident key with no region at all (nothing on the map draws it any more)
 * reads as infinitely far and is evicted unless pinned; that is the only way
 * such a key could ever be released.
 */
export function computeSkyResidencyPlan<K extends string>(
  input: SkyResidencyInput<K>,
): SkyResidencyPlan<K> {
  const keepRadius = Math.max(0, input.keepRadius ?? SKY_KEEP_RADIUS);
  const evictRadius = Math.max(keepRadius, input.evictRadius ?? SKY_EVICT_RADIUS);
  const keepSq = keepRadius * keepRadius;
  const evictSq = evictRadius * evictRadius;

  const nearestSq = new Map<K, number>();
  const order = new Map<K, number>();
  for (const region of input.regions) {
    const distanceSq = distanceSqToRegion(region, input.cameraX, input.cameraZ);
    const previous = nearestSq.get(region.key);
    if (previous === undefined) {
      nearestSq.set(region.key, distanceSq);
      order.set(region.key, order.size);
    } else if (distanceSq < previous) {
      nearestSq.set(region.key, distanceSq);
    }
  }

  const resident = new Set(input.resident);
  const ready = input.ready === undefined ? resident : new Set(input.ready);
  const pinned = new Set(input.pinned);
  const ensurable = input.ensurable === undefined ? null : new Set(input.ensurable);

  const ensure: K[] = [];
  for (const [key, distanceSq] of nearestSq) {
    if (ready.has(key) || distanceSq > keepSq) continue;
    if (ensurable !== null && !ensurable.has(key)) continue;
    ensure.push(key);
  }
  ensure.sort(
    (a, b) =>
      (nearestSq.get(a) ?? 0) - (nearestSq.get(b) ?? 0) ||
      (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );

  const evict: K[] = [];
  for (const key of resident) {
    if (pinned.has(key)) continue;
    const distanceSq = nearestSq.get(key);
    if (distanceSq !== undefined && distanceSq <= evictSq) continue;
    evict.push(key);
  }

  return { ensure, evict };
}
