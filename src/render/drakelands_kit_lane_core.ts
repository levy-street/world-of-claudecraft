// Pure policy of the Drakelands kit lane (drakelands_kit_lane.ts): which host
// preloads the kit at boot, which zone features need it, and when an approach
// starts loading it.
//
// The kit is the six Drakelands prop GLBs (ember_features.ts) plus the Ignivar
// templates (ignivar_env_props.ts) that Wyrmwatch, the Last Keep and the
// Forgefather's Isle fortress instance: tens of MiB of transcoded mips and baked
// geometry that only the Drakelands and the Ignivar raid draw. Every host used
// to load it at boot. On the iOS memory profile, where WebKit kills the page at
// a fixed per-process ceiling, a page life that never goes there should not pay
// for it, so the boot thunks resolve at once there and the kit loads when the
// player approaches. Desktop and Android keep the boot preload unchanged.
//
// Catching up is complete because only the LOAD moves: the zone prepare awaits
// the kit before it builds the features (and the build refuses to run before
// every template was attempted and settled; one that still fails after the
// loader's retries is skipped for the session, as at boot), then builds, gates
// and precompiles the same group from the same templates it always did. The
// raid dressing already awaits the templates.
import type { BiomeId, ZoneDef } from '../sim/types';
import { distanceSqToZone } from './zone_streaming';

/**
 * How far beyond the prepare horizon an approach starts loading the kit. The
 * visible-zone lane holds the Drakelands until the kit is resident and queues it
 * once its rectangle is within the horizon, so the fetch gets this much travel
 * to land first: the margin over RUN_SPEED on foot, over the Wickharbor ferry's
 * cruise speed on the ship, the fastest way in without a loading curtain (both
 * leads pinned by tests/drakelands_kit_lane_core.test.ts). A distance, not a
 * timer.
 */
export const DRAKELANDS_KIT_PREFETCH_MARGIN_YD = 300;

export interface DrakelandsKitProfile {
  readonly iosMemoryProfile: boolean;
}

/** Whether the deferred boot lane loads the kit on this host. */
export function drakelandsKitBootPreloaded(profile: DrakelandsKitProfile): boolean {
  return !profile.iosMemoryProfile;
}

/**
 * The deferred-lane thunk for one kit load: it runs `load` when the lane opens,
 * except on the iOS memory profile, where it resolves at once. The profile is
 * read when the thunk runs (the lane opens after the device profile is known),
 * never at module import.
 */
export function drakelandsKitBootThunk(
  load: () => Promise<unknown>,
  profile: () => DrakelandsKitProfile,
): () => Promise<unknown> {
  return () => (drakelandsKitBootPreloaded(profile()) ? load() : Promise.resolve());
}

/** The zone features that build from the kit: the ember biome's. */
export function zoneFeaturesNeedDrakelandsKit(biome: BiomeId): boolean {
  return biome === 'ember';
}

/**
 * Whether the visible-zone lane holds this biome's zone out of its queue: it
 * prepares one zone at a time, so a prepare that sat awaiting the kit's download
 * would keep every zone queued behind it unprepared. Held until the kit is
 * resident; the prepares that must build now (behind a curtain, a walked
 * crossing) call the prepare directly and await the kit instead.
 */
export function drakelandsKitHoldsZone(biome: BiomeId, kitResident: boolean): boolean {
  return !kitResident && zoneFeaturesNeedDrakelandsKit(biome);
}

/**
 * True once a zone whose features need the kit lies within the prepare horizon
 * plus DRAKELANDS_KIT_PREFETCH_MARGIN_YD of the camera, measured to its
 * rectangle exactly as the prepare lane measures it, so the prefetch always
 * fires before that lane can queue the zone.
 */
export function drakelandsKitPrefetchDue(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
): boolean {
  const reach = Math.max(0, horizon) + DRAKELANDS_KIT_PREFETCH_MARGIN_YD;
  const reachSq = reach * reach;
  return zones.some(
    (zone) =>
      zoneFeaturesNeedDrakelandsKit(zone.biome) &&
      distanceSqToZone(zone, cameraX, cameraZ) <= reachSq,
  );
}
