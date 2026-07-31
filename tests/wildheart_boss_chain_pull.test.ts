// The premature-boss-pull punish (src/sim/instances/boss_chain_pull.ts), opted
// into by DungeonDef.bossChainPull and live only in the Wildheart Basin.
//
// The basin is an open field with two routes to the shrine, so running past
// every pack to pull Zulgar alone is trivial there in a way it is not in a
// corridor dungeon. With the flag on, pulling him while ANY of the route is
// still alive sends the whole instance at the puller at once.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const WILDHEART_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 91): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WILDHEART_TEST_WORLD });
}

interface Claimed {
  sim: Sim;
  instance: InstanceSlot;
  player: Entity;
  boss: Entity;
  others: Entity[];
}

function claim(dungeonId: string, finalBossId: string): Claimed {
  const sim = makeSim();
  const pid = sim.addPlayer('warrior', 'Alpha');
  expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
  const instance = sim.instances.find((c) => c.dungeonId === dungeonId && c.partyKey !== null);
  if (!instance) throw new Error(`${dungeonId} instance was not claimed`);
  const player = sim.entities.get(sim.players.get(pid)!.entityId);
  if (!player) throw new Error('player entity missing');
  const mobs = instance.mobIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && e.kind === 'mob');
  const boss = mobs.find((m) => m.templateId === finalBossId);
  if (!boss) throw new Error(`${finalBossId} did not spawn`);
  return { sim, instance, player, boss, others: mobs.filter((m) => m.id !== boss.id) };
}

describe('Wildheart Basin premature boss pull', () => {
  it('opts in through content, not through a hardcoded dungeon id in sim logic', () => {
    expect(DUNGEONS.wildheart_basin.bossChainPull).toBe(true);
    // Every other dungeon keeps classic pull behavior.
    for (const dungeon of Object.values(DUNGEONS)) {
      if (dungeon.id === 'wildheart_basin') continue;
      expect(dungeon.bossChainPull, dungeon.id).toBeUndefined();
    }
  });

  it('sends every living mob in the instance at the puller when Zulgar is pulled early', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    // The whole authored route is standing: 20 spawns, so 19 besides Zulgar.
    expect(others.length).toBe(19);
    for (const mob of others) expect(mob.aiState).toBe('idle');

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    for (const mob of others) {
      expect(mob.aiState, mob.templateId).toBe('chase');
      expect(mob.aggroTargetId, mob.templateId).toBe(player.id);
      expect(mob.inCombat, mob.templateId).toBe(true);
      // Hate table seeded, so a taunt or a heal has a baseline to work against.
      expect(mob.threat.get(player.id), mob.templateId).toBeGreaterThan(0);
      // Leash anchored on the PULLER, not where the mob stood: the route is
      // ~180 yards end to end against a 70-yard dungeon leash, so a
      // self-anchored mob would evade home before reaching the shrine and the
      // mechanic would silently do nothing for the far half of the dungeon.
      expect(mob.leashAnchor, mob.templateId).toEqual({ ...player.pos });
    }
  });

  it('is a no-op once the route is cleared, so a clean clear fights the boss alone', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    for (const mob of others) mob.dead = true;

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    expect(boss.aggroTargetId).toBe(player.id);
    for (const mob of others) {
      expect(mob.aiState, mob.templateId).toBe('idle');
      expect(mob.aggroTargetId, mob.templateId).toBeNull();
    }
  });

  it('never fires for a mob that is not the boss', () => {
    const { sim, player, boss, others } = claim('wildheart_basin', 'wildheart_high_priest');
    const trash = others.find((m) => m.templateId === 'wildheart_ravager');
    if (!trash) throw new Error('no ravager spawned');

    sim.aggroMob(trash, player, false);

    expect(trash.aiState).toBe('chase');
    expect(boss.aiState).toBe('idle');
    // Everything else stays asleep: a trash pull is still a local pull.
    const stillIdle = others.filter((m) => m.id !== trash.id && m.aiState === 'idle');
    expect(stillIdle.length).toBe(others.length - 1);
  });

  it('leaves a dungeon that did not opt in on classic boss-pull behavior', () => {
    const { sim, player, boss, others } = claim('gravewyrm_sanctum', 'korzul_the_gravewyrm');

    sim.aggroMob(boss, player, false);

    expect(boss.aiState).toBe('chase');
    for (const mob of others) expect(mob.aiState, mob.templateId).toBe('idle');
  });

  it('draws no rng, so the shared draw order and the parity goldens are unaffected', () => {
    const { sim, player, boss } = claim('wildheart_basin', 'wildheart_high_priest');
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.aggroMob(boss, player, false);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});
