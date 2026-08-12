// Town static-cull first-reveal policy (hitch-hunt P3a), shared by the
// Eastbrook and Fenbridge views. The static batches' FIRST fog-cull reveal
// waits for a reveal gate so a walking approach never links the town's
// programs inside a live frame; but a camera already among the buildings
// (login, hearth, teleport: arrivals that ride the loading cover, whose zone
// prepare compiles the scene) must NEVER be held, because the sim colliders
// would block movement against invisible walls. Once revealed, the gate is
// never consulted again.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/town_reveal_core.test.ts.

export interface TownRevealGate {
  allow(key: string): boolean;
}

/**
 * 'hidden': the fog cull hides the batches this frame (the caller's revealed
 * latch is untouched either way). 'held': first reveal deferred by the gate,
 * batches stay hidden. 'revealed': batches visible; the caller latches so
 * the gate is never consulted again.
 */
export type TownStaticReveal = 'hidden' | 'held' | 'revealed';

export function townStaticReveal(
  fogVisible: boolean,
  alreadyRevealed: boolean,
  camDistSqToCenter: number,
  cullRadius: number,
  gate: TownRevealGate | null,
  key: string,
): TownStaticReveal {
  if (!fogVisible) return 'hidden';
  if (alreadyRevealed) return 'revealed';
  const insideTown = camDistSqToCenter <= cullRadius * cullRadius;
  if (insideTown || gate === null || gate.allow(key)) return 'revealed';
  return 'held';
}
