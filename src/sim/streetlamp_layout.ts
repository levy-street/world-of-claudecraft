// streetlamp_layout: where the streetlamps stand. Pure (no Three, no DOM), so
// the whole layout is a deterministic function of the road polylines, the zone
// hubs, and the caller-supplied probes, and a Vitest can assert spacing,
// clearance, and coverage without a renderer.
//
// It is a SIM layout, like dungeon_layout.ts and prop_layout.ts, because a lamp
// post is solid: `colliders.ts` binds the probes below, plants a collider on
// every site it returns, and hands the finished list to the renderer
// (`streetlampPlacements`). One plan, so the post you see is the post you walk
// into, and neither half can drift from the other.
//
// Lamps line EVERY road end to end: the whole network is lit, not just a short
// walk out of each hub. Near a hub they stand at town spacing; on the open road
// they spread far apart, waymarkers on a maintained highway rather than a
// boulevard: sparse on purpose, so the wilderness still reads as wilderness.
//
// Roads arrive as sparse authored waypoints; src/sim/world.ts densifies and
// warps them into the curve the terrain splat actually paints, so a fixed
// offset from the raw chord can land a post ON the painted track (the meander
// swings the centre line by several yards). The caller therefore supplies a
// roadClear probe (the sim's roadDistance), and every post is nudged along the
// roadside normal until it sits inside a clearance band beside the REAL track:
// never on the road, never so far off it stops reading as a road lamp.
//
// Every post also carries the direction of the road it lights (`roadYaw`), and
// `lampFixtureYaw` turns a fixture by its OWN light axis so the lit end always
// overhangs the track: a hanging lantern reaches its arm out over the road with
// the post left standing on the outside, exactly as a real street lamp is hung.
//
// A road curve is authored content, not an rng draw: nothing here touches `Rng`,
// so a given world and seed always lay the same posts in the same places and
// every host agrees on where they are.
import { resolveStreetlampStyle, type StreetlampStyleId } from './streetlamp_style';
import type { BiomeId } from './types';

/** A zone hub: the town centre and the radius its plateau is flattened to. */
export interface LampTown {
  x: number;
  z: number;
  radius: number;
}

/** One lamp post, in world XZ. */
export interface LampSite {
  x: number;
  z: number;
  /** ground height at the post's foot, carried from the probe that vetted it */
  y: number;
  /**
   * World yaw pointing from the post AT the road it lights, in the same
   * `atan2(x, z)` convention a Three Y rotation composes in. The fixture's own
   * yaw is `lampFixtureYaw(roadYaw, ...)`: the plan knows where the road is,
   * only the model knows which of its edges the light hangs off.
   */
  roadYaw: number;
  /** authored area owning the road centre sample, before the roadside offset */
  areaId: string | null;
}

export interface StreetlampPlan {
  sites: LampSite[];
}

export interface StreetlampPlanOptions {
  /** yards of road between consecutive lamps inside a town's reach */
  spacing?: number;
  /** yards between lamps on the open road, past every town's reach */
  openSpacing?: number;
  /** town reach = radius * reachScale + reachPad, in yards (spacing tier only) */
  reachScale?: number;
  reachPad?: number;
  /** first guess for how far a post sits off the raw chord centreline */
  offset?: number;
  /** the clearance band: a post must sit this far off the PAINTED road centre */
  clearMin?: number;
  clearMax?: number;
  /** minimum distance from every raw authored road chord after painted-road correction */
  authoredClearMin?: number;
  /** yards per correction step while nudging a post into the band */
  nudgeStep?: number;
  /** correction steps before a spot is abandoned (junctions, switchbacks) */
  maxNudges?: number;
  /** two lamps closer together than this collapse to one (junctions) */
  minSeparation?: number;
  /** a site whose ground sits below this is over water or a void: dropped */
  minGroundY?: number;
}

const DEFAULTS = {
  spacing: 26,
  openSpacing: 64,
  reachScale: 1.6,
  reachPad: 60,
  offset: 3.8,
  clearMin: 3.0,
  clearMax: 5.6,
  nudgeStep: 0.45,
  maxNudges: 8,
  // Two thirds of the town step, so the rhythm of a lit street survives while
  // any pair a junction or a hairpin crowded together collapses to one lamp.
  // At the old 8 yd, roads meeting at a shallow angle stood two posts close
  // enough to read as one doubled fixture rather than as a lit road.
  minSeparation: 18,
  minGroundY: -3,
};

/**
 * A fixture whose light sits closer than this to its own post axis has no
 * meaningful lit side (a lantern straight above the post reads the same from
 * every angle), so it simply squares up to the road.
 */
export const LAMP_LIGHT_AXIS_MIN = 0.15;

/** Arm of the central difference that reads which way the road lies, in yards.
 *  Wide enough that the meander noise in the probe does not dominate the slope,
 *  short enough to stay inside the clearance band it is measured from. */
const FACING_PROBE_STEP = 0.5;

/** Distance to the nearest raw authored road chord. The painted-road probe may
 *  nudge a post across another connector, so both representations need their
 *  own clearance contract. */
function authoredRoadDistance(
  roads: readonly (readonly { x: number; z: number }[])[],
  x: number,
  z: number,
): number {
  let best = Infinity;
  for (const road of roads) {
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lenSq = abx * abx + abz * abz;
      const t =
        lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lenSq)) : 0;
      best = Math.min(best, Math.hypot(x - a.x - abx * t, z - a.z - abz * t));
    }
  }
  return best;
}

/**
 * The yaw to instance a fixture at, so its lit end hangs over the road.
 *
 * `axisX`/`axisZ` are the fixture's horizontal LIGHT AXIS in its own model
 * space: the vector from the foot of its post to its authored light socket.
 * That is the whole contract, and it is what makes this work for every style
 * at once. A lantern hung off the model's +x edge and a brazier carried on a
 * -z arm are the same problem stated in different local frames; turning the
 * axis onto `roadYaw` puts the light over the track and leaves the base out on
 * the verge either way, with no per-model table to keep in sync.
 *
 * Angles compose the way a Three Y rotation does: a local direction at
 * `atan2(x, z)` lands at `atan2(x, z) + yaw` in the world.
 */
export function lampFixtureYaw(roadYaw: number, axisX: number, axisZ: number): number {
  if (Math.hypot(axisX, axisZ) < LAMP_LIGHT_AXIS_MIN) return roadYaw;
  return roadYaw - Math.atan2(axisX, axisZ);
}

export interface StreetlampProbes {
  /** ground height at a world XZ (the sim's terrainHeight, bound to the seed) */
  groundAt(x: number, z: number): number;
  /** true when a prop, building, or collider already owns this spot */
  blocked(x: number, z: number): boolean;
  /** distance from a world XZ to the PAINTED road centre (the sim's roadDistance) */
  roadClear(x: number, z: number): number;
  /** strict authored area identity at the road centre, or null outside all areas */
  areaAt?(x: number, z: number): string | null;
}

/**
 * Lay out the whole network's streetlamps.
 *
 * Walks each road polyline by CUMULATIVE arc length rather than restarting the
 * step at every waypoint, so lamps stay evenly spaced instead of bunching up
 * wherever the authored road happens to have a dense corner. Sides alternate
 * down the run, which is what makes a lit road read as a road rather than as a
 * fence. Each post is then slid along the roadside normal until the roadClear
 * probe agrees it stands beside the painted track, not on it, and records the
 * yaw back toward that track so the fixture can be hung facing the road.
 */
export function planStreetlamps(
  roads: readonly (readonly { x: number; z: number }[])[],
  towns: readonly LampTown[],
  probes: StreetlampProbes,
  options: StreetlampPlanOptions = {},
): StreetlampPlan {
  const spacing = options.spacing ?? DEFAULTS.spacing;
  const openSpacing = options.openSpacing ?? DEFAULTS.openSpacing;
  const reachScale = options.reachScale ?? DEFAULTS.reachScale;
  const reachPad = options.reachPad ?? DEFAULTS.reachPad;
  const offset = options.offset ?? DEFAULTS.offset;
  const clearMin = options.clearMin ?? DEFAULTS.clearMin;
  const clearMax = options.clearMax ?? DEFAULTS.clearMax;
  const authoredClearMin = options.authoredClearMin ?? 0;
  const nudgeStep = options.nudgeStep ?? DEFAULTS.nudgeStep;
  const maxNudges = options.maxNudges ?? DEFAULTS.maxNudges;
  const minSeparation = options.minSeparation ?? DEFAULTS.minSeparation;
  const minGroundY = options.minGroundY ?? DEFAULTS.minGroundY;
  const minSepSq = minSeparation * minSeparation;

  const reachSq = towns.map((town) => {
    const reach = town.radius * reachScale + reachPad;
    return reach * reach;
  });
  const inTownReach = (x: number, z: number): boolean => {
    for (let i = 0; i < towns.length; i++) {
      const dx = x - towns[i].x;
      const dz = z - towns[i].z;
      if (dx * dx + dz * dz <= reachSq[i]) return true;
    }
    return false;
  };

  const sites: LampSite[] = [];
  // Junction dedupe: roads cross and share endpoints anywhere on the map now,
  // so separation is checked against EVERY placed lamp through a coarse grid
  // (cell = minSeparation, so only the 3x3 neighbourhood can conflict).
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cz: number): number => cx * 73856093 + cz * 19349663;
  const cellOf = (v: number): number => Math.floor(v / minSeparation);
  const tooClose = (x: number, z: number): boolean => {
    const cx = cellOf(x);
    const cz = cellOf(z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const index of bucket) {
          const sx = sites[index].x - x;
          const sz = sites[index].z - z;
          if (sx * sx + sz * sz < minSepSq) return true;
        }
      }
    }
    return false;
  };
  const remember = (index: number): void => {
    const key = cellKey(cellOf(sites[index].x), cellOf(sites[index].z));
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  };

  /**
   * Which way the road lies from a finished post: the downhill direction of the
   * clearance probe, read as a central difference.
   *
   * Not the chord normal it was offset along. The paint meanders, and a strong
   * swing can leave a post on the far side of the track it was walked out from,
   * or park it nearer a second road than the one that placed it; both cases
   * point the chord normal AWAY from the road the post actually stands beside,
   * which would hang the lantern over the verge instead of over the path. The
   * probe is the same one the clearance band was vetted against, so the lamp
   * always faces whatever track it ended up next to. `fallbackX/Z` (toward the
   * road centre sample) covers a flat probe: no road near, or a post exactly
   * between two of them.
   */
  const roadYawAt = (x: number, z: number, fallbackX: number, fallbackZ: number): number => {
    const east = probes.roadClear(x + FACING_PROBE_STEP, z);
    const west = probes.roadClear(x - FACING_PROBE_STEP, z);
    const north = probes.roadClear(x, z + FACING_PROBE_STEP);
    const south = probes.roadClear(x, z - FACING_PROBE_STEP);
    const gx = east - west;
    const gz = north - south;
    if (Number.isFinite(gx) && Number.isFinite(gz) && Math.hypot(gx, gz) > 1e-6) {
      return Math.atan2(-gx, -gz);
    }
    return Math.hypot(fallbackX, fallbackZ) > 1e-6 ? Math.atan2(fallbackX, fallbackZ) : 0;
  };

  for (const road of roads) {
    if (road.length < 2) continue;
    let stepIndex = 0;
    // distance along the polyline still owed before the next lamp
    let carried = spacing * 0.5;
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len <= 1e-6) continue;
      const ux = dx / len;
      const uz = dz / len;
      // the roadside normal, so a lamp stands beside the track, not on it
      const nx = -uz;
      const nz = ux;
      let d = carried;
      while (d < len) {
        const onX = a.x + ux * d;
        const onZ = a.z + uz * d;
        const areaId = probes.areaAt?.(onX, onZ) ?? null;
        const sideSign = stepIndex % 2 === 0 ? 1 : -1;
        stepIndex++;
        // The next step length is decided at the SAMPLE point, so the town
        // tier is a property of where the road is, not of what got placed.
        d += inTownReach(onX, onZ) ? spacing : openSpacing;

        let x = onX + nx * sideSign * offset;
        let z = onZ + nz * sideSign * offset;
        // Slide along the normal until the post stands inside the clearance
        // band beside the PAINTED road (the meander moves it off the chord).
        let clear = probes.roadClear(x, z);
        let nudges = 0;
        while ((clear < clearMin || clear > clearMax) && nudges < maxNudges) {
          const step = clear < clearMin ? nudgeStep : -nudgeStep;
          x += nx * sideSign * step;
          z += nz * sideSign * step;
          clear = probes.roadClear(x, z);
          nudges++;
        }
        if (clear < clearMin || clear > clearMax) continue;
        if (authoredClearMin > 0 && authoredRoadDistance(roads, x, z) < authoredClearMin) continue;
        if (tooClose(x, z)) continue;
        const y = probes.groundAt(x, z);
        if (y < minGroundY) continue;
        if (probes.blocked(x, z)) continue;
        sites.push({ x, y, z, roadYaw: roadYawAt(x, z, onX - x, onZ - z), areaId });
        remember(sites.length - 1);
      }
      // carry the unspent remainder into the next chord so the spacing runs
      // continuously along the whole polyline
      carried = d - len;
    }
  }
  return { sites };
}

/** A planned site with the fixture identity resolved onto it. */
export interface PlacedStreetlamp extends LampSite {
  style: StreetlampStyleId;
}

/** The zone facts a site needs to know which fixture stands on it. */
export interface LampStyleZone {
  id: string;
  biome: BiomeId;
}

/**
 * Resolve the fixture identity for every site, ONCE, so the collider that
 * blocks a post and the mesh that draws it are sized from the same row of
 * `STREETLAMP_COLLIDER_RADIUS`. Split out from the plan because style depends
 * on authored zone data the pure layout above deliberately knows nothing about.
 */
export function styleStreetlampSites(
  sites: readonly LampSite[],
  zones: readonly LampStyleZone[],
): PlacedStreetlamp[] {
  const biomeById = new Map(zones.map((zone) => [zone.id, zone.biome]));
  return sites.map((site) => ({
    ...site,
    style: resolveStreetlampStyle(
      site.areaId,
      site.areaId ? (biomeById.get(site.areaId) ?? null) : null,
    ),
  }));
}

/**
 * Which lamps carry a real point light. The forward renderer keeps only
 * `GFX.maxPointLights` lights alive at once (renderer.ts budgetFireLights), and
 * campfires, braziers, and quest glows already compete for those slots, so
 * lighting every post would starve them and light nothing extra. Every OTHER
 * lamp still carries its HDR emissive lantern, and its ground light comes from
 * the night light field on the tiers that splice it (every lamp joins the
 * field) or the draped fallback pool elsewhere; the real lights only add the
 * falloff on nearby characters and props. Same rule as frost_sky.ts's
 * Icemantle lanterns, named and tested here so the stride is not a magic
 * modulo buried in a build loop.
 */
export const LAMP_LIGHT_STRIDE = 3;

export function lampCarriesLight(indexInZone: number): boolean {
  return indexInZone % LAMP_LIGHT_STRIDE === 0;
}
