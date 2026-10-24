// Shared authoritative geometry and replicated cues for the haunted crew.
export const GHOST_CAPTAIN_ID = 'turretback_hermit';
export const GHOST_SAILOR_ID = 'barnacle_crawler';
export const GHOST_CAPTAIN_BROADSIDE = 'ghost_captain_broadside';
export const GHOST_CAPTAIN_ANCHOR = 'ghost_captain_anchor';
export const GHOST_CAPTAIN_BOARDING = 'ghost_captain_boarding';
export const GHOST_BROADSIDE_LANE = 'ghost_broadside_lane';
export const GHOST_BROADSIDE_FIRE = 'ghost_broadside_fire';
export const GHOST_BROADSIDE_SHIP = 'ghost_broadside_ship';
export const GHOST_ANCHOR_LANE = 'ghost_anchor_lane';
export const GHOST_ANCHOR_DRAG = 'ghost_anchor_drag';
export const GHOST_BOARDING_LANE = 'ghost_boarding_lane';
export const GHOST_BOARDING_SLASH = 'ghost_boarding_slash';
export const GHOST_BROADSIDE_WIDTH = 2.4;
export const GHOST_ANCHOR_WIDTH = 3;
export const GHOST_BOARDING_WIDTH = 3;
export const GHOST_CAPTAIN_TUNING = {
  broadsideLength: 28,
  broadsideOffsets: [-10, -5, 0, 5, 10],
  anchorLength: 24,
  boardingLength: 18,
  broadsideWarning: 2.4,
  anchorWarning: 2,
  boardingWarning: 2,
  flashSeconds: 0.6,
  anchorSeconds: 2,
  recovery: 3.5,
  first: 3,
  // Existing Claw Sweep and Shell Slam rolls, redistributed across the rotation.
  broadsideMin: 90,
  broadsideMax: 110,
  anchorMin: 50,
  anchorMax: 60,
  boardingMin: 50,
  boardingMax: 60,
} as const;
export type GhostCaptainMove = 'broadside' | 'anchor' | 'boarding';
export interface GhostLane {
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
}
/** Flat-ended lane, full width. Start and yaw are locked when its tell appears. */
export function inGhostLane(
  lane: GhostLane,
  x: number,
  z: number,
  from = 0,
  to = lane.length,
): boolean {
  const dx = x - lane.x;
  const dz = z - lane.z;
  const forward = dx * Math.sin(lane.yaw) + dz * Math.cos(lane.yaw);
  const side = dx * Math.cos(lane.yaw) - dz * Math.sin(lane.yaw);
  return forward >= from && forward <= to && Math.abs(side) <= lane.width / 2;
}
