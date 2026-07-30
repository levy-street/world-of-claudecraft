import { describe, expect, it } from 'vitest';
import { releaseEmpoweredAbility } from '../src/sim/combat/casting_lifecycle';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(e: Entity): void; ctx: never };

function fireMage(): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed: 141, playerClass: 'mage', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fire')).toBe(true);
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

function releaseAt(sim: TestSim, progressTicks: number): void {
  sim.castAbility('dragons_breath');
  for (let i = 0; i < progressTicks && sim.player.castingAbility; i++) sim.tick();
  releaseEmpoweredAbility(
    (sim as never as { ctx: Parameters<typeof releaseEmpoweredAbility>[0] }).ctx,
    'dragons_breath',
    sim.player.id,
  );
}

describe("Dragon's Breath", () => {
  it('uses the four staged ranges and the authoritative release clock', () => {
    const { sim, p } = fireMage();
    const near = dummy(sim, 0, 7);
    const tooFar = dummy(sim, 0, 9);
    releaseAt(sim, 13); // 0.65 sec, stage II
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(tooFar.hp).toBe(tooFar.maxHp);
    expect(p.resource).toBe(p.maxResource - 90);
    expect(p.cooldowns.get('dragons_breath')).toBeCloseTo(20, 3);
  });

  it('auto-releases the maximum stage and guarantees one Hot Streak contribution', () => {
    const { sim, p } = fireMage();
    const first = dummy(sim, 0, 10);
    const second = dummy(sim, 2, 10);
    releaseAt(sim, 60);
    expect(p.castingAbility).toBeNull();
    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(first.auras.some((a) => a.id === 'ignite')).toBe(true);
    expect(p.auras.some((a) => a.id === 'heating_up')).toBe(true);
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(false);
    expect(first.auras.find((a) => a.id === 'dragons_breath_incap')?.remaining).toBeCloseTo(3, 1);
  });

  it('applies breakable disorientation after the hit, and later damage breaks it', () => {
    const { sim, p } = fireMage();
    const target = dummy(sim, 0, 5);
    releaseAt(sim, 1);
    expect(target.auras.some((a) => a.id === 'dragons_breath_incap' && a.breaksOnDamage)).toBe(
      true,
    );
    const damage = (
      sim as never as {
        ctx: {
          dealDamage: (
            source: Entity,
            victim: Entity,
            amount: number,
            crit: boolean,
            school: string,
            ability: string,
            kind: 'hit',
          ) => void;
        };
      }
    ).ctx.dealDamage;
    damage(p, target, 1, false, 'fire', 'Cinderbolt', 'hit');
    expect(target.auras.some((a) => a.id === 'dragons_breath_incap')).toBe(false);
  });

  it('cancels without mana or cooldown when silenced before release', () => {
    const { sim, p } = fireMage();
    const target = dummy(sim, 0, 5);
    const mana = p.resource;
    sim.castAbility('dragons_breath');
    p.auras.push({
      id: 'test_silence',
      name: 'Test Silence',
      kind: 'silence',
      remaining: 1,
      duration: 1,
      value: 0,
      sourceId: target.id,
      school: 'shadow',
    });
    releaseEmpoweredAbility(
      (sim as never as { ctx: Parameters<typeof releaseEmpoweredAbility>[0] }).ctx,
      'dragons_breath',
      p.id,
    );
    expect(p.resource).toBe(mana);
    expect(p.cooldowns.has('dragons_breath')).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });
});
