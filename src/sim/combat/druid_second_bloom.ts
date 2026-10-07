// Second Bloom's closing heal (Groveheart rework pass 2).
//
// Second Bloom (`regrowth`) heals once up front and then over 15 sec. If that
// heal-over-time effect runs its FULL duration, it heals the target one more
// time for the amount the opening heal produced (Spell Power rider and any
// cast-scoped multiplier included, before a critical doubling). The cast
// stamps that amount on the HoT as `closingHeal` (combat/effect_dispatch.ts
// 'hot' arm, `closingHealFromDirect`); the natural-expiry path in
// combat/auras.ts calls in here. Every early end skips it by construction:
// Fleetmend's consume, Overbloom's harvest, a dispel, and a recast all remove
// or replace the aura without reaching natural expiry, and a recast stamps a
// fresh amount on the fresh HoT.
//
// Draws no rng: the closing heal cannot critically strike.
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export function secondBloomOnHotExpired(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  aura: Aura,
): void {
  const amount = aura.closingHeal;
  if (amount === undefined || amount <= 0 || target.dead) return;
  if (aura.sourceId !== source.id) return;
  ctx.applyHeal(source, target, amount, aura.name, aura.id, false, false);
}
