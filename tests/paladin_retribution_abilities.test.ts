import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion, MAX_DEVOTION } from '../src/sim/paladin_devotion';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
  dealDamage(
    source: Entity,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string,
    kind: 'hit',
  ): void;
};

function makeRet(): TestSim {
  const sim = new Sim({ seed: 90210, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetAt(sim: TestSim, distance: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  sim.player.facing = 0;
  sim.targetEntity(mob.id);
  return mob;
}

function resolve(sim: TestSim, abilityId: string): ResolvedAbility {
  const resolved = sim.resolvedAbility(abilityId);
  if (!resolved) throw new Error(`missing ${abilityId}`);
  return resolved;
}

function runEffects(sim: TestSim, target: Entity | null, abilityId: string): void {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  sim.ctx.runEffects(sim.player, meta, target, resolve(sim, abilityId));
}

function advance(sim: Sim, seconds: number): void {
  for (let tick = 0; tick < seconds * 20; tick++) sim.tick();
}

describe('Paladin Retribution abilities', () => {
  it('emits Dawnfall windup and per-target impact visuals at its real radius', () => {
    const sim = makeRet();
    const target = targetAt(sim, 2);
    sim.drainEvents();

    runEffects(sim, null, 'dawnfall');

    const events = sim.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinDawnfall',
        sourceId: sim.playerId,
        range: 6,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinDawnfallImpact',
        targetId: target.id,
      }),
    );
  });

  it('gates Hammer of Wrath by target health, Ascension, or Avenging Wrath', () => {
    const blocked = makeRet();
    const healthy = targetAt(blocked, 20);
    blocked.castAbility('hammer_of_wrath');
    expect(blocked.player.cooldowns.has('hammer_of_wrath')).toBe(false);
    expect(healthy.hp).toBe(healthy.maxHp);

    const threshold = makeRet();
    const exactlyTwenty = targetAt(threshold, 20);
    exactlyTwenty.hp = exactlyTwenty.maxHp * 0.2;
    threshold.castAbility('hammer_of_wrath');
    expect(threshold.player.cooldowns.has('hammer_of_wrath')).toBe(false);
    expect(exactlyTwenty.hp).toBe(exactlyTwenty.maxHp * 0.2);

    const execute = makeRet();
    const wounded = targetAt(execute, 20);
    wounded.hp = Math.floor(wounded.maxHp * 0.19);
    execute.castAbility('hammer_of_wrath');
    advance(execute, 2);
    expect(wounded.hp).toBeLessThan(Math.floor(wounded.maxHp * 0.19));
    expect(execute.player.paladinDevotion?.value).toBe(1);

    const ascended = makeRet();
    const ascendedTarget = targetAt(ascended, 20);
    grantDevotion(ascended.player, MAX_DEVOTION);
    expect(activateDivineAscension(ascended.player)).toBe(true);
    ascended.castAbility('hammer_of_wrath');
    advance(ascended, 2);
    expect(ascendedTarget.hp).toBeLessThan(ascendedTarget.maxHp);

    const avenging = makeRet();
    const avengingTarget = targetAt(avenging, 20);
    avenging.castAbility('avenging_wrath');
    avenging.castAbility('hammer_of_wrath');
    advance(avenging, 2);
    expect(avengingTarget.hp).toBeLessThan(avengingTarget.maxHp);
  });

  it('Avenging Wrath grants 10 Devotion, doubles generation, increases damage and healing, and expires', () => {
    const sim = makeRet();
    const target = targetAt(sim, 2);

    const hit = (): number => {
      const before = target.hp;
      sim.dealDamage(sim.player, target, 100, false, 'holy', 'Test hit', 'hit');
      return before - target.hp;
    };

    expect(hit()).toBe(100);
    sim.castAbility('avenging_wrath');
    expect(sim.player.paladinDevotion?.value).toBe(10);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'avenging_wrath', kind: 'buff_dmg_done', value: 0.2 }),
    );
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ kind: 'buff_healing_done', value: 0.2 }),
    );
    expect(hit()).toBe(120);

    sim.player.hp = 1;
    sim.rng.next = () => 0.9;
    expect(sim.ctx.applyHeal(sim.player, sim.player, 100, 'Test heal', null, false)).toBe(120);
    sim.player.hp = sim.player.maxHp;

    runEffects(sim, target, 'final_edict');
    expect(sim.player.paladinDevotion?.value).toBe(12);

    advance(sim, 15.1);
    expect(sim.player.auras.some((aura) => aura.id === 'avenging_wrath')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'buff_healing_done')).toBe(false);
    expect(hit()).toBe(100);
    sim.player.hp = 1;
    expect(sim.ctx.applyHeal(sim.player, sim.player, 100, 'Expired heal', null, false)).toBe(100);
    runEffects(sim, target, 'final_edict');
    expect(sim.player.paladinDevotion?.value).toBe(13);
  });
});
