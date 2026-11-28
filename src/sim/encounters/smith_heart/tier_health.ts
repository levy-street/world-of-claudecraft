// A Smith's Heart boss's health pool per tier: each encounter's difficulty
// row carries a `healthMult` (Normal 1); a body at rest shows that pool from
// the start (showTierHealth), the pull scales the body's pool by it
// (its current share kept, so a pull that already landed a hit keeps that
// share) and remembers the pool it had, and the fight's end (a wipe's reset)
// gives that pool back. The raid has no heroic tier of its own yet (no
// `HEROIC_DUNGEON_IDS` row scales its spawns), so the tier's pool lives here
// with the rest of its tier numbers.
//
// Pure over the entity: no rng, no clock. `src/sim`-pure.

import type { InstanceSlot } from '../../sim';
import type { Entity } from '../../types';

/** DEV ONLY (`/dev heart pool <k>`): a run's pools times `k`, the bot
 *  raid's human-equivalent check (bots deal about 65 percent of a decent
 *  human raid's damage, so a 0.65 pool plays out a human raid's clock). */
const devPoolScale = new WeakMap<InstanceSlot, number>();

/** Set (or with 1, clear) a run's dev pool scale. */
export function setTierHealthDevScale(inst: InstanceSlot, k: number): void {
  if (k === 1) devPoolScale.delete(inst);
  else devPoolScale.set(inst, k);
}

/** The pull's pool factor in `inst`: the tier's, times any dev scale. */
export function tierPoolMult(inst: InstanceSlot, mult: number): number {
  return mult * (devPoolScale.get(inst) ?? 1);
}

/** DEV ONLY: an add the encounter spawns in `inst` takes the run's dev pool
 *  scale too (the human-equivalent clock shrinks every pool the raid must
 *  burn, not only the bosses'). No scale set: nothing changes. */
export function applyDevAddPool(inst: InstanceSlot, e: Entity): void {
  const k = devPoolScale.get(inst);
  if (k === undefined || e.dead) return;
  e.maxHp = Math.max(1, Math.round(e.maxHp * k));
  e.hp = e.maxHp;
}

/** Each boss body's template pool, seen once (the pool its claim spawned
 *  it with), so showing the tier's pool before the pull and scaling it at
 *  the pull never compound. */
const basePools = new WeakMap<Entity, number>();

function baseOf(e: Entity): number {
  let b = basePools.get(e);
  if (b === undefined) {
    b = e.maxHp;
    basePools.set(e, b);
  }
  return b;
}

/** Scale `e`'s pool to its tier's (`mult` times its template pool) for the
 *  fight, its current share kept; returns the pool to restore. */
export function applyTierHealth(e: Entity, mult: number): number {
  const base = baseOf(e);
  if (e.dead) return base;
  const target = Math.max(1, Math.round(base * mult));
  if (target === e.maxHp) return base;
  const share = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  e.maxHp = target;
  e.hp = Math.max(1, Math.round(e.maxHp * share));
  return base;
}

/** Before the pull (no fight, the body whole and out of combat): show the
 *  tier's real pool from the start, so a raid inspecting the boss reads the
 *  pool it will fight (the owner's run of 2026-11-17 saw a Heroic Quench
 *  read 309,000 until the pull, then 670,000: the template's Normal pool
 *  until the pull scaled it). */
export function showTierHealth(e: Entity, mult: number): void {
  if (e.dead || e.inCombat) return;
  const target = Math.max(1, Math.round(baseOf(e) * mult));
  if (e.maxHp === target && e.hp === target) return;
  e.maxHp = target;
  e.hp = target;
}

/** Give `e` back the pool it had before the tier's (a living body comes back whole). */
export function restoreTierHealth(e: Entity, base: number | undefined): void {
  if (base === undefined || base === e.maxHp) return;
  e.maxHp = base;
  if (!e.dead) e.hp = base;
}
