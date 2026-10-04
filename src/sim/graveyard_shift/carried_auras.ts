// The auras a player carries into a Graveyard Shift, handed back on the way out
// (owner decision): food, flasks and buffs are not lost to a shift, and a
// penalty aura is not shed by starting one and leaving at once. The run is a
// parenthesis, so their timers are frozen at the start, as the pools are.
// Not carried: what cannot outlive the parenthesis (shapeshift forms and warrior
// stances, which own their transitions; stealth; crowd control and forced moves)
// and the two recovery sicknesses, which the pools snapshot hands back itself.
// Draws no rng.

import { SICKNESS_AURA_IDS } from '../resurrection';
import type { SimContext } from '../sim_context';
import { type Aura, type AuraKind, type Entity, FORM_AURA_KINDS } from '../types';

const NOT_CARRIED: ReadonlySet<AuraKind> = new Set<AuraKind>([
  ...FORM_AURA_KINDS,
  'battle_stance',
  'defensive_stance',
  'berserker_stance',
  'stealth',
  'stun',
  'stasis',
  'root',
  'incapacitate',
  'polymorph',
  'forced_move',
]);

function carried(a: Aura): boolean {
  return !NOT_CARRIED.has(a.kind) && !SICKNESS_AURA_IDS.has(a.id) && a.remaining > 0;
}

/** What the player carries in, cloned, at the run's start (before the clean slate). */
export function snapshotCarriedAuras(e: Pick<Entity, 'auras'>): Aura[] {
  return e.auras.filter(carried).map((a) => ({ ...a }));
}

/** Hands the carried auras back on the teardown, never doubling one the clean
 *  slate kept (the operator's Cheater mark), then folds them into the stats. */
export function restoreCarriedAuras(ctx: SimContext, e: Entity, auras: readonly Aura[]): void {
  for (const a of auras) if (!e.auras.some((x) => x.id === a.id)) e.auras.push({ ...a });
  ctx.recalcPlayer(e);
}
