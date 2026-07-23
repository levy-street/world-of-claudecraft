import { describe, expect, it } from 'vitest';
import { releaseEmpoweredAbility } from '../src/sim/combat/casting_lifecycle';
import {
  empoweredStageForProgress,
  glacialFrontContains,
  glacialFrontPresentationRange,
} from '../src/sim/combat/glacial_front';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(e: Entity): void; ctx: never };

function frostMage(): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed: 87, playerClass: 'mage', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('frost')).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  sim.player.facing = 0;
  return { sim, p: sim.player };
}

function dummy(sim: TestSim, x: number, z: number): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: p.pos.x + x,
    y: p.pos.y,
    z: p.pos.z + z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100_000;
  sim.addEntity(mob);
  return mob;
}

describe('Frente Glacial charge contract', () => {
  it('uses four deterministic quarter stages and grows its preview continuously', () => {
    expect(empoweredStageForProgress(0, 4)).toBe(1);
    expect(empoweredStageForProgress(0.249, 4)).toBe(1);
    expect(empoweredStageForProgress(0.25, 4)).toBe(2);
    expect(empoweredStageForProgress(0.5, 4)).toBe(3);
    expect(empoweredStageForProgress(0.75, 4)).toBe(4);
    expect(empoweredStageForProgress(2, 4)).toBe(4);
    expect(glacialFrontPresentationRange(0)).toBe(7);
    expect(glacialFrontPresentationRange(0.249)).toBe(7);
    expect(glacialFrontPresentationRange(0.25)).toBe(10);
    expect(glacialFrontPresentationRange(0.5)).toBe(13);
    expect(glacialFrontPresentationRange(1)).toBe(16);
  });

  it('accepts only points inside the forward 70-degree cone', () => {
    expect(glacialFrontContains({ x: 0, z: 0 }, 0, { x: 0, z: 10 }, 10, 70)).toBe(true);
    expect(glacialFrontContains({ x: 0, z: 0 }, 0, { x: 5, z: 8 }, 10, 70)).toBe(true);
    expect(glacialFrontContains({ x: 0, z: 0 }, 0, { x: 8, z: 5 }, 10, 70)).toBe(false);
    expect(glacialFrontContains({ x: 0, z: 0 }, 0, { x: 0, z: -3 }, 10, 70)).toBe(false);
    expect(glacialFrontContains({ x: 0, z: 0 }, 0, { x: 0, z: 11 }, 10, 70)).toBe(false);
  });
});

describe('Frente Glacial simulation', () => {
  it('releases stage II from authoritative cast progress, damaging only its cone and slowing hits', () => {
    const { sim, p } = frostMage();
    const near = dummy(sim, 0, 9);
    const tooFar = dummy(sim, 0, 11);
    const behind = dummy(sim, 0, -4);
    const mana = p.resource;

    sim.castAbility('glacial_front');
    expect(p.castingAbility).toBe('glacial_front');
    for (let i = 0; i < 13; i++) sim.tick(); // 0.65s => stage II
    releaseEmpoweredAbility(
      (sim as never as { ctx: Parameters<typeof releaseEmpoweredAbility>[0] }).ctx,
      'glacial_front',
      p.id,
    );

    expect(p.castingAbility).toBeNull();
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(tooFar.hp).toBe(tooFar.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
    expect(near.auras.some((a) => a.id === 'glacial_front_slow' && a.value === 0.5)).toBe(true);
    expect(near.auras.some((a) => a.id === 'glacial_front_root')).toBe(false);
    expect(p.resource).toBe(mana - 80);
    expect(p.cooldowns.get('glacial_front')).toBeCloseTo(12, 3);
  });

  it('auto-releases stage IV at maximum charge and roots survivors for one second', () => {
    const { sim, p } = frostMage();
    const far = dummy(sim, 0, 15);
    sim.castAbility('glacial_front');
    for (let i = 0; i < 60 && p.castingAbility; i++) sim.tick();
    expect(p.castingAbility).toBeNull();
    expect(far.hp).toBeLessThan(far.maxHp);
    const root = far.auras.find((a) => a.id === 'glacial_front_root');
    expect(root?.remaining).toBeGreaterThan(0.8);
    expect(root?.remaining).toBeLessThanOrEqual(1);
  });

  it('reaches every empowered stage sooner with spell haste', () => {
    const { sim, p } = frostMage();
    const stageTwoTarget = dummy(sim, 0, 9);
    p.auras.push({
      id: 'test_spell_haste',
      name: 'Test Spell Haste',
      kind: 'buff_spellhaste',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: p.id,
      school: 'arcane',
    });

    sim.castAbility('glacial_front');
    expect(p.castTotal).toBeCloseTo(1.2, 3);
    for (let i = 0; i < 7; i++) sim.tick(); // 0.35s: stage II at 100% spell haste
    sim.releaseEmpoweredAbility('glacial_front');

    expect(stageTwoTarget.hp).toBeLessThan(stageTwoTarget.maxHp);
  });

  it('cannot be released through a same-tick stun', () => {
    const { sim, p } = frostMage();
    const target = dummy(sim, 0, 5);
    const mana = p.resource;
    sim.castAbility('glacial_front');
    p.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 1,
      duration: 1,
      value: 0,
      sourceId: target.id,
      school: 'physical',
    });
    releaseEmpoweredAbility(
      (sim as never as { ctx: Parameters<typeof releaseEmpoweredAbility>[0] }).ctx,
      'glacial_front',
      p.id,
    );
    expect(target.hp).toBe(target.maxHp);
    expect(p.resource).toBe(mana);
    expect(p.cooldowns.has('glacial_front')).toBe(false);
    expect(p.castingAbility).toBeNull();
  });

  it('lets Overload amplify nested stage damage as well as its mana cost', () => {
    const normal = frostMage();
    const normalTarget = dummy(normal.sim, 0, 5);
    normal.sim.castAbility('glacial_front');
    normal.sim.releaseEmpoweredAbility('glacial_front');
    const normalDamage = normalTarget.maxHp - normalTarget.hp;

    const overloaded = frostMage();
    const overloadedTarget = dummy(overloaded.sim, 0, 5);
    overloaded.p.auras.push({
      id: 'overload_test',
      name: 'Overload',
      kind: 'overload',
      remaining: 10,
      duration: 10,
      value: 0.4,
      sourceId: overloaded.p.id,
      school: 'arcane',
    });
    const mana = overloaded.p.resource;
    overloaded.sim.castAbility('glacial_front');
    overloaded.sim.releaseEmpoweredAbility('glacial_front');
    const overloadedDamage = overloadedTarget.maxHp - overloadedTarget.hp;
    expect(overloadedDamage).toBeGreaterThan(normalDamage * 1.3);
    expect(overloaded.p.resource).toBe(mana - 120);
  });
});
