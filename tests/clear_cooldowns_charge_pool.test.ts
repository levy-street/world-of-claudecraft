import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { cloneAbilityCharges } from '../src/sim/social/arena';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Bug: Winter's Recall (Cold Snap, `clearCooldowns`) refilled a charge pool's
// count but left its parallel per-charge recharge timers running. Each stale
// timer then paid out another charge, and new spends pushed beside them, so a
// 2-charge Flitstep ran 4 timers and blinked in bursts of four. The reset must
// leave the pool exactly a fresh full pool: nothing recharging.

const RUN_SECONDS = 120;

function rig(rows: Record<number, string>): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'arcane', rows })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

/** Cast Flitstep, clearing the GCD first; true when the cast went off (mana spent). */
function blink(sim: Sim, p: Entity): boolean {
  p.gcdRemaining = 0;
  p.resource = p.maxResource;
  sim.castAbility('blink');
  return p.resource < p.maxResource;
}

/** Empty the 2-charge pool the way a player does: two blinks, one GCD apart.
 *  The GCD spacing matters: it staggers the two stale timers so each lands as
 *  the GCD frees, the pool never refills to full, and the extras never clear. */
function spendPool(sim: Sim, p: Entity): void {
  let casts = 0;
  for (let i = 0; i < 100 && casts < 2; i++) {
    p.resource = p.maxResource;
    if (p.gcdRemaining <= 0) {
      sim.castAbility('blink');
      if (p.resource < p.maxResource) casts++;
    }
    sim.tick();
  }
  expect(casts).toBe(2);
}

/** Spam Flitstep whenever off the GCD for `seconds`, mana kept full. Returns the
 *  blinks cast and the worst timers-vs-missing-charges excess seen on any tick. */
function spamBlink(sim: Sim, p: Entity, seconds: number): { casts: number; excess: number } {
  let casts = 0;
  let excess = 0;
  for (let i = 0; i < Math.round(seconds * 20); i++) {
    p.resource = p.maxResource;
    if (p.gcdRemaining <= 0) {
      sim.castAbility('blink');
      if (p.resource < p.maxResource) casts++;
    }
    const pool = p.abilityCharges?.blink;
    if (pool) {
      const timers = pool.recharges?.length ?? 0;
      excess = Math.max(excess, timers - (pool.maxCharges - pool.charges));
    }
    sim.tick();
  }
  return { casts, excess };
}

describe("Winter's Recall resets a charge pool to a fresh full pool", () => {
  it('drops the spent charges recharge timers along with refilling the count', () => {
    const { sim, p } = rig({ 5: 'mag_r5_double_blink', 17: 'mag_r17_cold_snap' });
    spendPool(sim, p);
    const spent = p.abilityCharges?.blink;
    expect(spent?.charges).toBe(0);
    expect(spent?.recharges).toHaveLength(2);

    sim.castAbility('cold_snap');

    const pool = p.abilityCharges?.blink;
    expect(pool?.charges).toBe(2);
    expect(pool?.recharge).toBe(0);
    expect(pool?.recharges ?? []).toEqual([]);
    expect(p.cooldowns.has('blink')).toBe(false);
  });

  it('a reset Flitstep then recharges exactly like a fresh pool, two per cycle', () => {
    // Control: a fresh 2-charge pool spammed for the same window.
    const fresh = rig({ 5: 'mag_r5_double_blink', 17: 'mag_r17_cold_snap' });
    const control = spamBlink(fresh.sim, fresh.p, RUN_SECONDS);

    const { sim, p } = rig({ 5: 'mag_r5_double_blink', 17: 'mag_r17_cold_snap' });
    spendPool(sim, p);
    sim.castAbility('cold_snap'); // off the GCD: straight after the second blink
    const reset = spamBlink(sim, p, RUN_SECONDS);

    // Two banked uses, then one per charge per 19.5s recharge: 14 in 120s.
    // The bug cast 25 here (bursts of four) off 4 timers on the 2-charge pool.
    expect(control.casts).toBe(14);
    expect(reset.casts).toBe(control.casts);
    expect(reset.excess).toBe(0);
    expect(control.excess).toBe(0);
  });
});

describe('arena return pools copy the per-charge timers', () => {
  it('a spend on the live pool never reaches the snapshot, nor the reverse', () => {
    const { sim, p } = rig({ 5: 'mag_r5_double_blink' });
    expect(blink(sim, p)).toBe(true);
    const snapshot = cloneAbilityCharges(p.abilityCharges);
    expect(snapshot.blink.recharges).toHaveLength(1);

    expect(blink(sim, p)).toBe(true); // pushes a second timer onto the live pool
    expect(p.abilityCharges?.blink?.recharges).toHaveLength(2);
    expect(snapshot.blink.recharges).toHaveLength(1);

    const restored = cloneAbilityCharges(snapshot);
    restored.blink.recharges?.push(5);
    expect(snapshot.blink.recharges).toHaveLength(1);
  });
});
