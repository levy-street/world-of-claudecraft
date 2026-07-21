// Rewind damage history: a per-player, bounded ring of the REAL HP loss each
// player took, tagged by sim tick. It backs Chronomancy's Rewind (combat/rewind.ts),
// which restores a fraction of the damage a group/raid took over a short window.
//
// Determinism: entries are tagged with the integer sim tick (DT = 1/20), never a
// wall clock; there is no rng here and no module-global state. The ring is pruned
// on every write to the window length, so it can never grow unbounded, and it lives
// on the Entity (Entity.damageHistory), so it is dropped automatically when the
// entity is removed and rebuilt fresh on a reset. It is runtime-only: never
// serialized, wired, or pinned by the parity digest.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import type { DamageTick, Entity } from '../types';

// The Rewind look-back window. 5 seconds at the fixed 20 Hz tick is 100 ticks.
export const REWIND_WINDOW_SEC = 5;
export const REWIND_WINDOW_TICKS = REWIND_WINDOW_SEC * 20;

// Record REAL HP loss (`amount`, already post-mitigation and post-absorb: the
// difference between pre-hit and post-hit HP) against the sim tick it landed on.
// Called only for players and only when amount > 0 (fully absorbed / avoided hits
// never reach here). Prunes anything older than the window so the ring stays small.
export function recordDamageTaken(target: Entity, amount: number, tick: number): void {
  if (amount <= 0) return;
  if (!target.damageHistory) target.damageHistory = [];
  const history = target.damageHistory;
  history.push({ tick, amount });
  pruneDamageHistory(history, tick);
}

// Drop entries that fell outside the window relative to `now`. Amortized O(1): old
// ticks are always at the FRONT (append-only in tick order), so we splice a prefix.
export function pruneDamageHistory(history: DamageTick[], now: number): void {
  const cutoff = now - REWIND_WINDOW_TICKS;
  let drop = 0;
  while (drop < history.length && history[drop].tick <= cutoff) drop++;
  if (drop > 0) history.splice(0, drop);
}

// Sum the REAL HP loss the target took within the last `windowTicks` ticks (default
// the Rewind window) as of tick `now`. Reads only; never mutates or prunes, so
// several Chronomancers can query the same history independently. Draws no rng.
export function damageTakenWithin(
  target: Entity,
  now: number,
  windowTicks: number = REWIND_WINDOW_TICKS,
): number {
  const history = target.damageHistory;
  if (!history || history.length === 0) return 0;
  const cutoff = now - windowTicks;
  let sum = 0;
  for (const entry of history) {
    if (entry.tick > cutoff) sum += entry.amount;
  }
  return sum;
}
