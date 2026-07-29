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

/**
 * Synchronize every moving ship's local-player stand-in and report whether
 * the authoritative rig must be hidden for this frame.
 */
export function updateDeckStandIns<TVisual, THandle extends DeckStandInRuntimeHandle<TVisual>>(
  handles: Iterable<THandle>,
  realLocalPlayer: boolean,
  create: (handle: THandle) => TVisual | null,
  update: (visual: TVisual) => void,
  dispose: (visual: TVisual) => void,
): boolean {
  let active = false;
  for (const handle of handles) {
    const cueLive = handle.cueStartSec !== null && handle.segment !== null;
    const action = deckStandInAction(cueLive, handle.deckStandIn !== null, realLocalPlayer);
    if (action === 'build') handle.deckStandIn = create(handle);
    else if (action === 'dispose') disposeDeckStandIn(handle, dispose);
    if (!handle.deckStandIn) continue;
    active = true;
    update(handle.deckStandIn);
  }
  return active;
}
