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

export interface DeckStandInRuntimeHandle<TVisual> {
  cueStartSec: number | null;
  segment: unknown | null;
  deckStandIn: TVisual | null;
}

export function authoritativeDeckRigVisible(
  standInActive: boolean,
  sceneCameraActive: boolean,
): boolean {
  return !standInActive || !sceneCameraActive;
}

/** Resolve the transient visual lifecycle from the cue and local-player identity. */
export function deckStandInAction(
  cueLive: boolean,
  standInPresent: boolean,
  realLocalPlayer: boolean,
): DeckStandInAction {
  if (cueLive) {
    if (standInPresent) return 'keep';
    return realLocalPlayer ? 'build' : 'idle';
  }
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

/** Dispose one handle's transient visual and clear its ownership. */
export function disposeDeckStandIn<TVisual>(
  handle: DeckStandInRuntimeHandle<TVisual>,
  dispose: (visual: TVisual) => void,
): void {
  if (!handle.deckStandIn) return;
  dispose(handle.deckStandIn);
  handle.deckStandIn = null;
}
