// The Drakelands kit lane: where the kit loads on the iOS memory profile, which
// skips it at boot (policy and rationale in drakelands_kit_lane_core.ts).
// Elsewhere the boot preload has made it resident before the Renderer exists,
// and every entry point here is a no-op.
//
// Two entry points, one load:
// - drakelandsKitRecheck: the visible-zone lane's recheck starts it once the
//   Drakelands is within the prepare horizon plus the margin, and holds the
//   zone out of that one-at-a-time lane until the kit is resident, so a
//   download never blocks the other zones queued behind it; the recheck is
//   re-armed when the kit lands, and the zone is queued then.
// - drakelandsKitLoadFor: the zone prepare starts it beside its terrain build
//   and awaits it before building the ember features, on every path that
//   prepares a zone directly (behind the curtain of world entry, a teleport, a
//   hearth or a rift exit, and a walked crossing that beat the lane). A failed
//   load rejects that prepare, so the zone stays unprepared and the next
//   prepare retries; the features are never built before the kit settles.
import type { BiomeId, ZoneDef } from '../sim/types';
import {
  drakelandsKitHoldsZone,
  drakelandsKitPrefetchDue,
  zoneFeaturesNeedDrakelandsKit,
} from './drakelands_kit_lane_core';
import { emberFeatureAssetsResident, loadEmberPropScenes } from './ember_features';
import { ignivarEnvPropsSettled, prepareIgnivarEnvProps } from './ignivar_env_props';
import type { ZoneStreamRecheck } from './zone_streaming';

let inFlight: Promise<void> | null = null;
// The visible-zone recheck that last held a zone back: re-armed when the kit
// lands, so the held zone is queued on the next frame even if the camera stands
// still. A rebuilt renderer registers its own on its first hold.
let heldRecheck: ZoneStreamRecheck | null = null;

function loadDrakelandsKit(): Promise<void> {
  if (inFlight) return inFlight;
  const task = Promise.all([
    // Settled templates are never re-run: a retry after a failed prop fetches
    // only what is missing (prepareIgnivarEnvProps re-bakes every key).
    ignivarEnvPropsSettled() ? undefined : prepareIgnivarEnvProps(),
    loadEmberPropScenes(),
  ]).then(() => undefined);
  inFlight = task;
  // Observed here, so a load that fails while the terrain build is still
  // running is never an unhandled rejection; its awaiters still receive it.
  const settle = (): void => {
    if (inFlight === task) inFlight = null;
  };
  task.then(() => {
    settle();
    if (heldRecheck) heldRecheck.x = Number.NaN;
    heldRecheck = null;
  }, settle);
  return task;
}

/** The kit load a zone prepare must await before building this biome's
 *  features, or null when there is nothing to wait for. */
export function drakelandsKitLoadFor(biome: BiomeId): Promise<void> | null {
  if (!zoneFeaturesNeedDrakelandsKit(biome) || emberFeatureAssetsResident()) return null;
  return loadDrakelandsKit();
}

function heldForKit(biome: BiomeId): boolean {
  return drakelandsKitHoldsZone(biome, emberFeatureAssetsResident());
}

/**
 * The visible-zone lane's per-recheck step, with that lane's zones, camera and
 * horizon: starts the kit load once the Drakelands is in reach, and returns the
 * predicate the queue filters with (true for a zone to hold back until the kit
 * is resident). `recheck` is re-armed when the kit lands.
 */
export function drakelandsKitRecheck(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
  recheck: ZoneStreamRecheck,
): (biome: BiomeId) => boolean {
  if (emberFeatureAssetsResident()) return heldForKit;
  heldRecheck = recheck;
  if (!inFlight && drakelandsKitPrefetchDue(zones, cameraX, cameraZ, horizon)) {
    loadDrakelandsKit().catch((err) => {
      // The next recheck in reach retries; a prepare that needs the kit now
      // (an arrival, a walked crossing) retries it and surfaces the failure.
      console.warn('Drakelands kit prefetch failed', err);
    });
  }
  return heldForKit;
}
