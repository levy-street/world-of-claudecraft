export type DeckStandInAction = 'build' | 'keep' | 'dispose' | 'idle';

export interface DeckStandInAttachPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface DeckStandInParentTransform extends DeckStandInAttachPoint {
  scale: number;
}

/** Resolve the transient visual lifecycle from the live prop cue alone. */
export function deckStandInAction(cueLive: boolean, standInPresent: boolean): DeckStandInAction {
  if (cueLive) return standInPresent ? 'keep' : 'build';
  return standInPresent ? 'dispose' : 'idle';
}

/** Convert ship-local world yards into a uniformly scaled ship group. */
export function deckStandInParentTransform(
  attachPoint: DeckStandInAttachPoint,
  shipScale: number,
  playerScale: number,
): DeckStandInParentTransform {
  const inverseShipScale = 1 / shipScale;
  return {
    x: attachPoint.x * inverseShipScale,
    y: attachPoint.y * inverseShipScale,
    z: attachPoint.z * inverseShipScale,
    yaw: attachPoint.yaw,
    scale: playerScale * inverseShipScale,
  };
}
