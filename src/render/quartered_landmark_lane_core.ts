// The Quartered Isle's landmark-asset lane as plain predicates (the
// drakelands_kit_lane_core.ts twin). Its island models, ice spire and lava
// textures are fetched by the zone prepare when they are not resident, and the
// visible-zone lane prepares one zone at a time: a prepare that sat awaiting a
// download would keep the isle's own terrain and every zone queued behind it
// unprepared. So the lane holds the isle out of its queue until the assets
// are resident, and starts the fetch a margin before the isle comes into
// reach. Three-free and DOM-free.

import type { BiomeId, ZoneDef } from '../sim/types';
import { DRAKELANDS_KIT_PREFETCH_MARGIN_YD } from './drakelands_kit_lane_core';
import { distanceSqToZone } from './zone_streaming';

/** How far beyond the prepare horizon an approach starts the fetch: the same
 *  lead the Drakelands kit takes (on foot and by ferry). */
export const QUARTERED_LANDMARK_PREFETCH_MARGIN_YD = DRAKELANDS_KIT_PREFETCH_MARGIN_YD;

/** The zone features that build from these assets: the quartered biome's. */
export function zoneFeaturesNeedQuarteredLandmarks(biome: BiomeId): boolean {
  return biome === 'quartered';
}

/** Whether the visible-zone lane holds this biome's zone out of its queue. */
export function quarteredLandmarkHoldsZone(biome: BiomeId, assetsResident: boolean): boolean {
  return !assetsResident && zoneFeaturesNeedQuarteredLandmarks(biome);
}

/** True once a quartered zone lies within the prepare horizon plus the margin
 *  of the camera, measured to its rectangle as the prepare lane measures it,
 *  so the fetch always starts before that lane can queue the zone. */
export function quarteredLandmarkPrefetchDue(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
): boolean {
  const reach = Math.max(0, horizon) + QUARTERED_LANDMARK_PREFETCH_MARGIN_YD;
  const reachSq = reach * reach;
  return zones.some(
    (zone) =>
      zoneFeaturesNeedQuarteredLandmarks(zone.biome) &&
      distanceSqToZone(zone, cameraX, cameraZ) <= reachSq,
  );
}
