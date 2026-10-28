import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { applyGreaterInvisibilityAftereffect } from './greater_invisibility';
import { duskLingerOnStealthBreak } from './rogue_talents';

// Breaking stealth (any damage dealt or taken, a non-preserving ability, a
// mount summon, an attack out of Tactical Camo): drop the first stealth aura,
// keep the cached flag live without waiting for updateAuras, announce the fade,
// then run the two removal riders (Dusk Linger, the Greater Invisibility
// aftereffect). Bound as the SimContext breakStealth callback; moved out of
// sim.ts unchanged. Draws no rng.
export function breakStealth(ctx: SimContext, e: Entity): void {
  const idx = e.auras.findIndex((a) => a.kind === 'stealth');
  if (idx < 0) return;
  const removed = e.auras[idx];
  e.auras.splice(idx, 1);
  e.stealthed = false; // keep the cache live without waiting for updateAuras
  ctx.emit({ type: 'aura', targetId: e.id, name: removed.name, gained: false });
  duskLingerOnStealthBreak(ctx, e);
  applyGreaterInvisibilityAftereffect(ctx, e, removed);
}
