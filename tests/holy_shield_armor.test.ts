import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { armorReduction } from '../src/sim/types';

type EntityAdder = { addEntity(e: Entity): void };

function makePaladin(): { sim: Sim; paladin: Entity; target: Entity } {
  const sim = new Sim({ seed: 19, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('protection')).toBe(true);
  const paladin = sim.entities.get(sim.playerId);
  if (!paladin) throw new Error('missing paladin');
  paladin.resource = paladin.maxResource;
  paladin.hp = paladin.maxHp;

  const target = createMob(9001, MOBS.ridge_stalker, 20, {
    x: paladin.pos.x,
    y: paladin.pos.y,
    z: paladin.pos.z + 12,
  });
  target.maxHp = target.hp = 1_000_000;
  (sim as unknown as EntityAdder).addEntity(target);
  paladin.targetId = target.id;
  return { sim, paladin, target };
}

function holyShieldAura(paladin: Entity): Aura | undefined {
  return paladin.auras.find((aura) => aura.id === 'holy_shield' && aura.kind === 'buff_armor');
}

function castHallowedWall(sim: Sim, paladin: Entity, previousAura?: Aura): void {
  paladin.resource = paladin.maxResource;
  const previousRemaining = previousAura?.remaining ?? null;
  sim.castAbility('holy_shield', paladin.id);
  for (let i = 0; i < 60; i++) {
    const aura = holyShieldAura(paladin);
    if (aura && (previousRemaining === null || aura.remaining > previousRemaining)) return;
    sim.tick();
  }
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

describe('Hallowed Wall armor bonus', () => {
  it('applies a visible temporary armor bonus that improves physical mitigation', () => {
    const { sim, paladin } = makePaladin();
    const baseArmor = paladin.stats.armor;
    const baseReduction = armorReduction(sim.ctx.effectiveArmor(paladin), paladin.level);

    castHallowedWall(sim, paladin);

    const aura = holyShieldAura(paladin);
    expect(aura?.value).toBe(150);
    expect(aura?.duration).toBe(10);
    expect(aura?.remaining).toBeGreaterThan(9);
    expect(paladin.stats.armor).toBe(baseArmor + 150);
    expect(sim.ctx.effectiveArmor(paladin)).toBe(paladin.stats.armor);
    expect(armorReduction(sim.ctx.effectiveArmor(paladin), paladin.level)).toBeGreaterThan(
      baseReduction,
    );
  });

  it('refreshes instead of stacking while the first shield is still active', () => {
    const { sim, paladin } = makePaladin();
    const baseArmor = paladin.stats.armor;

    castHallowedWall(sim, paladin);
    tickSeconds(sim, 8);
    const beforeRefresh = holyShieldAura(paladin);
    expect(beforeRefresh?.remaining).toBeLessThan(3);

    castHallowedWall(sim, paladin, beforeRefresh);

    const auras = paladin.auras.filter(
      (aura) => aura.id === 'holy_shield' && aura.kind === 'buff_armor',
    );
    expect(auras).toHaveLength(1);
    expect(auras[0].remaining).toBeGreaterThan(9);
    expect(paladin.stats.armor).toBe(baseArmor + 150);
  });

  it('expires cleanly and removes the derived armor bonus', () => {
    const { sim, paladin } = makePaladin();
    const baseArmor = paladin.stats.armor;

    castHallowedWall(sim, paladin);
    expect(paladin.stats.armor).toBeGreaterThan(baseArmor);

    tickSeconds(sim, 11);

    expect(holyShieldAura(paladin)).toBeUndefined();
    expect(paladin.stats.armor).toBe(baseArmor);
    expect(sim.ctx.effectiveArmor(paladin)).toBe(baseArmor);
  });
});
