// The Knotted Gale's load is carried on foot: its carrier cannot blink, charge or leap
// it across the Cornice (encounters/smith_heart/breath_heart.ts). Gated on the effect,
// never on an ability id, so every self-moving ability added later inherits it. Pure.

import { BREATH_AURAS } from '../encounters/smith_heart/breath_ids';
import type { Entity } from '../types';

/** The effects that move their caster. */
const SELF_MOVING: ReadonlySet<string> = new Set([
  'charge',
  'blinkForward',
  'repositionToAim',
  'hunterTrailbreak',
]);

/** Does an ability with these effects move its caster? */
export function movesCaster(effects: readonly { type: string }[]): boolean {
  return effects.some((e) => SELF_MOVING.has(e.type));
}

/** Is `p` carrying a Knotted Gale? */
export function carriesLoad(p: Entity): boolean {
  return p.auras.some((a) => a.id === BREATH_AURAS.laden);
}
