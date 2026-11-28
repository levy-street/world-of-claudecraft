// Healing a body has just RECEIVED, for the rules that answer to it (the
// Guardian of the Quench's Living Warmth: healing received lowers the
// receiver's cold, encounters/smith_heart/quench_life_warmth.ts).
//
// Every recipient-side heal path that a heal absorb drinks from (the paths
// that call combat/heal.ts consumeHealAbsorb) calls `noteHealTaken` with the
// EFFECTIVE amount it landed (after the absorb and the missing-health clamp,
// the number its `heal2` event carries): applyHeal and Beacon's copy
// (heal.ts), a HoT's tick and a leech (auras.ts), Cascade (chronomancy.ts) and
// the Temporal Hourglass's mend (temporal_hourglass.ts). Paths a heal absorb
// never sees (a potion, Second Wind, a drain's self-heal, a death save's
// restore) stay out of it too, so the two rules always agree on what counts.
// A reader calls `takeHealTaken` once a tick: it returns what landed since
// its last read and empties the tally.
//
// The tally rides the entity (`healTakenTick`, `healTakenAmount`: transient,
// never persisted or wired), stamped with the tick it was last written, so
// healing noted while nobody reads (a player healed far from any fight that
// asks) is dropped instead of arriving later as one burst, and a stamp from
// another timeline (a tick count that went back) is never fresh. Deterministic:
// no rng, no clock but the tick count.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Healing older than this many ticks is stale: never handed to a reader. */
const STALE_TICKS = 1;

/** Is a stamp from `tick` still fresh at `now`? */
function fresh(now: number, tick: number | undefined): boolean {
  return tick !== undefined && now >= tick && now - tick <= STALE_TICKS;
}

/** Record `healed` effective healing landed on `target` this tick. */
export function noteHealTaken(
  ctx: Pick<SimContext, 'tickCount'>,
  target: Entity,
  healed: number,
): void {
  if (!(healed > 0)) return;
  const now = ctx.tickCount;
  const kept = fresh(now, target.healTakenTick) ? (target.healTakenAmount ?? 0) : 0;
  target.healTakenTick = now;
  target.healTakenAmount = kept + healed;
}

/** The healing `target` received since the last read (this tick or the one
 *  before), emptied as it is read. */
export function takeHealTaken(ctx: Pick<SimContext, 'tickCount'>, target: Entity): number {
  const amount = target.healTakenAmount ?? 0;
  if (amount <= 0) return 0;
  target.healTakenAmount = 0;
  return fresh(ctx.tickCount, target.healTakenTick) ? amount : 0;
}
