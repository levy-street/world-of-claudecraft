// Cauterize (fire-spec passive, owner 2026-07-13): the first lethal hit heals you to
// 25% max HP and sets you burning (5% max HP/s for 6s, +12% Fire damage while burning),
// on a 5 min internal cooldown. Frost/Arcane never trigger it.
import { describe, expect, it } from 'vitest';
import {
  CAUTERIZE_FIRE_DMG_BONUS,
  CAUTERIZE_HEAL_FRAC,
  cauterizeFireDamageMult,
} from '../src/sim/combat/fire_mage';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { revivePlayerAt } from '../src/sim/spirit';
import type { Entity } from '../src/sim/types';

function mage(spec: 'fire' | 'frost'): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  const p = sim.player;
  p.hp = p.maxHp; // full, real level-20 pool (recalc keeps maxHp stable across ticks)
  return { sim, p };
}

function enemy(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(9200, MOBS.forest_wolf, 20, { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z });
  mob.hostile = true;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

function hit(sim: Sim, source: Entity | null, target: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(source, target, amount, false, 'physical', null, 'hit');
}

describe('Cauterize', () => {
  it('the first lethal hit heals a fire mage to 25% max HP instead of killing', () => {
    const { sim, p } = mage('fire');
    hit(sim, enemy(sim), p, 999_999); // would kill
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.round(p.maxHp * CAUTERIZE_HEAL_FRAC)); // 2500
    expect(p.auras.some((a) => a.id === 'cauterizing' && a.kind === 'dot')).toBe(true);
  });

  it('the burn ticks 5% max HP per second while it rides', () => {
    const { sim, p } = mage('fire');
    hit(sim, enemy(sim), p, 999_999);
    const afterSave = p.hp; // 2500
    for (let i = 0; i < 20; i++) sim.tick(); // 1 second -> one 5% tick
    expect(afterSave - p.hp).toBe(Math.round(p.maxHp * 0.05)); // 500 burned
  });

  it('grants +12% Fire damage to enemies while burning, but never to the self-burn', () => {
    const { sim, p } = mage('fire');
    const mob = enemy(sim);
    hit(sim, mob, p, 999_999); // p is now burning (cauterizing)
    expect(cauterizeFireDamageMult(p, mob, 'fire')).toBeCloseTo(1 + CAUTERIZE_FIRE_DMG_BONUS, 6);
    expect(cauterizeFireDamageMult(p, p, 'fire')).toBe(1); // self-burn not boosted
    expect(cauterizeFireDamageMult(p, mob, 'frost')).toBe(1); // only Fire
  });

  it('applies the visible 5 min fatigue debuff and refuses a second save while it rides', () => {
    const { sim, p } = mage('fire');
    const mob = enemy(sim);
    hit(sim, mob, p, 999_999);
    expect(p.dead).toBe(false);
    const fatigue = p.auras.find((a) => a.kind === 'cauterize_fatigue');
    expect(fatigue).toBeTruthy();
    expect(fatigue?.remaining).toBe(300); // 5 minutes
    p.auras = p.auras.filter((a) => a.id !== 'cauterizing'); // clear the burn to isolate
    p.hp = p.maxHp;
    hit(sim, mob, p, 999_999); // still fatigued
    expect(p.dead).toBe(true);
  });

  it('the fatigue survives death and revive: die-revive-die never double-saves', () => {
    const { sim, p } = mage('fire');
    const mob = enemy(sim);
    hit(sim, mob, p, 999_999); // first lethal: saved + fatigued
    expect(p.dead).toBe(false);
    hit(sim, mob, p, 999_999); // second lethal while fatigued: dies for real
    expect(p.dead).toBe(true);
    // The fatigue is one of the few auras that SURVIVES death (resurrection.ts).
    expect(p.auras.some((a) => a.kind === 'cauterize_fatigue')).toBe(true);
    // Revive and take another killing blow inside the window: no save.
    revivePlayerAt(
      (sim as unknown as { ctx: Parameters<typeof revivePlayerAt>[0] }).ctx,
      p.id,
      p.pos,
      1,
    );
    expect(p.dead).toBe(false);
    expect(p.auras.some((a) => a.kind === 'cauterize_fatigue')).toBe(true); // still worn
    hit(sim, mob, p, 999_999);
    expect(p.dead).toBe(true); // no second Cauterize within the 5 minutes
  });

  it('saves again once the fatigue has expired', () => {
    const { sim, p } = mage('fire');
    const mob = enemy(sim);
    hit(sim, mob, p, 999_999);
    expect(p.dead).toBe(false);
    // Simulate the 5 minutes elapsing: drop the fatigue (and the burn), heal up.
    p.auras = p.auras.filter((a) => a.kind !== 'cauterize_fatigue' && a.id !== 'cauterizing');
    p.hp = p.maxHp;
    hit(sim, mob, p, 999_999); // fatigue gone: Cauterize saves again
    expect(p.dead).toBe(false);
    expect(p.auras.some((a) => a.kind === 'cauterize_fatigue')).toBe(true); // re-armed
  });

  it('never triggers for a non-fire mage', () => {
    const { sim, p } = mage('frost');
    hit(sim, enemy(sim), p, 999_999);
    expect(p.dead).toBe(true);
    expect(p.auras.some((a) => a.id === 'cauterizing')).toBe(false);
  });
});
