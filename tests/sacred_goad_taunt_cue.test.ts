import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { grantDevotion } from '../src/sim/paladin_devotion';
import { Sim } from '../src/sim/sim';
import { tauntLeavesMobUnforced } from '../src/sim/threat';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void };

function protection(): TestSim {
  const sim = new Sim({ seed: 4242, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('protection')).toBe(true);
  return sim;
}

function enemy(sim: TestSim, template: string): Entity {
  const mob = createMob(sim.nextId++, MOBS[template], 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 6,
  });
  mob.hostile = true;
  sim.addEntity(mob);
  return mob;
}

function goad(sim: TestSim, target: Entity): Extract<SimEvent, { type: 'spellfx' }> | undefined {
  sim.drainEvents();
  sim.targetEntity(target.id);
  sim.castAbility('sacred_challenge');
  return sim
    .drainEvents()
    .find(
      (e): e is Extract<SimEvent, { type: 'spellfx' }> =>
        e.type === 'spellfx' && e.fx === 'selfCast' && e.ability === 'sacred_challenge',
    );
}

describe("Sacred Goad's cue says when the enemy cannot be taunted", () => {
  it('marks the cue at an untauntable enemy, which the taunt still leaves unforced', () => {
    for (const template of ['training_dummy', 'nythraxis_heroic_rogue_add']) {
      const sim = protection();
      const mob = enemy(sim, template);
      const cue = goad(sim, mob);
      expect(cue).toMatchObject({ targetId: mob.id, immune: true });
      // The sim's own taunt rule is unchanged: threat, but never forced.
      expect(mob.forcedTargetId ?? null).toBeNull();
      expect(mob.threat.get(sim.player.id)).toBeGreaterThan(0);
    }
  });

  it('leaves the cue plain at an enemy the taunt forces', () => {
    const sim = protection();
    const wolf = enemy(sim, 'forest_wolf');
    const cue = goad(sim, wolf);
    expect(cue).toBeDefined();
    expect(cue?.immune).toBeUndefined();
    expect(wolf.forcedTargetId).toBe(sim.player.id);
  });

  it("grants Ascension's guard under the aura the kit's shimmer follows", () => {
    const sim = protection();
    const wolf = enemy(sim, 'forest_wolf');
    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');
    goad(sim, wolf);
    const guard = sim.player.auras.find((a) => a.kind === 'buff_dr');
    expect(guard).toMatchObject({ value: 0.15, duration: 4 });
    // paladin_kit.ts presence(): a buff_dr whose id is Sacred Goad's.
    expect(guard?.id.startsWith('sacred_challenge')).toBe(true);
  });

  it('shares one rule with the sim for which mobs a taunt cannot turn', () => {
    expect(tauntLeavesMobUnforced(MOBS.training_dummy, false)).toBe(true);
    expect(tauntLeavesMobUnforced(MOBS.nythraxis_heroic_rogue_add, false)).toBe(true);
    expect(tauntLeavesMobUnforced(MOBS.forest_wolf, false)).toBe(false);
    expect(tauntLeavesMobUnforced({ boss: true }, false)).toBe(false);
    expect(tauntLeavesMobUnforced({ boss: true }, true)).toBe(true);
  });
});
