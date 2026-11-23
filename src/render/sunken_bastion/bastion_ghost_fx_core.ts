// Replicated ghost-crew tells. Lane origins and timing come from the sim's
// objects, never from the captain's moving body or a local cast timer.
import {
  GHOST_ANCHOR_DRAG,
  GHOST_ANCHOR_LANE,
  GHOST_ANCHOR_WIDTH,
  GHOST_BOARDING_LANE,
  GHOST_BOARDING_SLASH,
  GHOST_BOARDING_WIDTH,
  GHOST_BROADSIDE_FIRE,
  GHOST_BROADSIDE_LANE,
  GHOST_BROADSIDE_WIDTH,
  GHOST_CAPTAIN_ID,
  GHOST_SAILOR_ID,
} from '../../sim/encounters/sunken_bastion/ghost_captain_ids';

export const GHOST_FX_SLOTS = { lanes: 16, bodies: 32, soulsPerBody: 3, chainLinks: 64 } as const;
export type GhostLaneKind = 'broadside' | 'anchor' | 'boarding';
export interface GhostLaneLook {
  kind: GhostLaneKind;
  warning: boolean;
  width: number;
}
const BROADSIDE_WARNING = {
  kind: 'broadside',
  warning: true,
  width: GHOST_BROADSIDE_WIDTH,
} as const;
const BROADSIDE_FIRE = { ...BROADSIDE_WARNING, warning: false } as const;
const ANCHOR_WARNING = { kind: 'anchor', warning: true, width: GHOST_ANCHOR_WIDTH } as const;
const ANCHOR_DRAG = { ...ANCHOR_WARNING, warning: false } as const;
const BOARDING_WARNING = { kind: 'boarding', warning: true, width: GHOST_BOARDING_WIDTH } as const;
const BOARDING_SLASH = { ...BOARDING_WARNING, warning: false } as const;

export function ghostLaneLook(template: string): GhostLaneLook | undefined {
  switch (template) {
    case GHOST_BROADSIDE_LANE:
      return BROADSIDE_WARNING;
    case GHOST_BROADSIDE_FIRE:
      return BROADSIDE_FIRE;
    case GHOST_ANCHOR_LANE:
      return ANCHOR_WARNING;
    case GHOST_ANCHOR_DRAG:
      return ANCHOR_DRAG;
    case GHOST_BOARDING_LANE:
      return BOARDING_WARNING;
    case GHOST_BOARDING_SLASH:
      return BOARDING_SLASH;
    default:
      return undefined;
  }
}

export function ghostCrewBody(template: string): boolean {
  return template === GHOST_CAPTAIN_ID || template === GHOST_SAILOR_ID;
}

export function ghostCueProgress(remaining: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 1;
}

/** Anchor returns along its locked lane; the other strikes advance away. */
export function ghostStrikeDistance(kind: GhostLaneKind, progress: number, length: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return Math.max(0, length) * (kind === 'anchor' ? 1 - t : t);
}

export const GHOST_SHIP_MUZZLE_X = 2.705;
export interface GhostShipPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
/** Authored ship faces +Z, firing from starboard +X. Position its middle
 *  muzzle on the replicated lane start, keeping all five safe gaps aligned. */
export function ghostShipPoseInto(
  out: GhostShipPose,
  x: number,
  y: number,
  z: number,
  yaw: number,
  progress: number,
  reducedMotion: boolean,
): GhostShipPose {
  out.x = x - Math.sin(yaw) * GHOST_SHIP_MUZZLE_X;
  out.z = z - Math.cos(yaw) * GHOST_SHIP_MUZZLE_X;
  out.y = y + (reducedMotion ? 0 : -(Math.max(0, 1 - progress * 5) ** 2) * 3);
  out.yaw = yaw - Math.PI / 2;
  return out;
}

export function ghostShipOpacity(progress: number): number {
  return Math.max(0, Math.min(1, progress * 8, (1 - progress) * 10)) * 0.58;
}

export interface GhostSoulPose {
  x: number;
  y: number;
  z: number;
  height: number;
  width: number;
}
/** Stable, bounded soul ribbons. A dead ghost unravels upward instead of
 *  leaving a growing emitter or looping its death burst. Reduced motion
 *  removes all orbit and vertical travel, retaining a quiet silhouette. */
export function ghostSoulPoseInto(
  out: GhostSoulPose,
  phase: number,
  index: number,
  death: number,
  reducedMotion: boolean,
): GhostSoulPose {
  const dying = Math.max(0, Math.min(1, death));
  const a = index * 2.0943951023931953 + (reducedMotion ? 0 : phase * 0.8);
  const radius = 0.55 + dying * 0.8;
  out.x = Math.cos(a) * radius;
  out.z = Math.sin(a) * radius;
  out.y = 0.7 + (reducedMotion ? 0 : Math.sin(phase * 1.7 + index) * 0.18 + dying * 3);
  out.height = (1.7 + dying * 2.4) * (1 - dying);
  out.width = (0.65 + dying * 0.7) * (1 - dying);
  return out;
}
