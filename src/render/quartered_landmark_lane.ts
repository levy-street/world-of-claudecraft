// The visible-zone lane's kit step for every zone whose features wait on
// assets that may not be resident: the Drakelands kit (drakelands_kit_lane.ts)
// and the Quartered Isle's landmark assets (policy in
// quartered_landmark_lane_core.ts). One call per recheck starts whichever
// fetch is due and returns the predicate the queue filters with.
//
// The isle's assets are resident at boot on most hosts (the deferred preload
// lane loads them), so its step is a no-op there. On the iOS memory profile,
// and on any host where a boot load failed, the fetch starts once the isle is
// within the prepare horizon plus the margin, the isle stays out of the
// one-at-a-time lane until it lands, and the recheck is re-armed then so the
// zone is queued on the next frame even if the camera stands still.

import type { BiomeId, ZoneDef } from '../sim/types';
import { drakelandsKitRecheck } from './drakelands_kit_lane';
import {
  quarteredLandmarkAssetsResident,
  quarteredLandmarkLoadFor,
} from './quartered_landmark_dressing';
import {
  quarteredLandmarkHoldsZone,
  quarteredLandmarkPrefetchDue,
} from './quartered_landmark_lane_core';
import type { ZoneStreamRecheck } from './zone_streaming';

export { quarteredLandmarkLoadFor };

// The recheck that last held the isle back, and the load it is waiting on.
let heldRecheck: ZoneStreamRecheck | null = null;
let watched: Promise<void> | null = null;

function heldForAssets(biome: BiomeId): boolean {
  return quarteredLandmarkHoldsZone(biome, quarteredLandmarkAssetsResident());
}

function quarteredLandmarkRecheck(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
  recheck: ZoneStreamRecheck,
): void {
  if (quarteredLandmarkAssetsResident()) return;
  heldRecheck = recheck;
  if (watched || !quarteredLandmarkPrefetchDue(zones, cameraX, cameraZ, horizon)) return;
  const load = quarteredLandmarkLoadFor('quartered');
  if (!load) return;
  watched = load;
  const settle = (): void => {
    if (watched === load) watched = null;
  };
  load.then(
    () => {
      settle();
      if (heldRecheck) heldRecheck.x = Number.NaN;
      heldRecheck = null;
    },
    (err) => {
      settle();
      // The next recheck in reach retries; a prepare that needs the assets now
      // (an arrival, a walked crossing) retries the load and surfaces the failure.
      console.warn('Quartered Isle landmark prefetch failed', err);
    },
  );
}

/**
 * The visible-zone lane's per-recheck kit step, with that lane's zones, camera
 * and horizon: starts each fetch that is due and returns the predicate the
 * queue filters with (true for a zone to hold back until its assets are
 * resident). `recheck` is re-armed when a held fetch lands.
 */
export function zoneKitRecheck(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
  recheck: ZoneStreamRecheck,
): (biome: BiomeId) => boolean {
  const drakelandsHolds = drakelandsKitRecheck(zones, cameraX, cameraZ, horizon, recheck);
  quarteredLandmarkRecheck(zones, cameraX, cameraZ, horizon, recheck);
  return (biome) => drakelandsHolds(biome) || heldForAssets(biome);
}
