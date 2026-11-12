import type { Entity } from '../sim/types';

export function isStealthed(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'stealth');
}

/** A player drawn in the stealth veil: a stealth aura, or unseen in Footprints
 *  in Ash (only ever your own body: other unseen fighters are not drawn). */
export function shouldRenderStealthGhost(viewerId: number, e: Entity): boolean {
  return e.kind === 'player' && (isStealthed(e) || !!e.eventUnseen);
}
