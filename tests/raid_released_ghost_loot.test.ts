// Reproduces: "Releasing to grave when dying from raid locks you out of loot."
// A raider who dies at the back of the Nythraxis hall and releases before the
// kill used to fall outside the 80 yd kill-time participation circle when the
// boss finally dropped at the front, while the daily lockout still stamped
// them as a group member. With no loot rights the cleared-room door exception
// refused the ghost ("You are locked to ...") and every roll skipped them.
// Inside a claimed instance the whole claim footprint now shares the kill.

import { describe, expect, it } from 'vitest';
import { heroicLockoutId } from '../src/sim/instances/dungeons';
import { NYTHRAXIS_ARENA_ID } from '../src/sim/nythraxis_dev_raid';
import { Sim } from '../src/sim/sim';
import { type Entity, NYTHRAXIS_BOSS_ID, PARTY_XP_RANGE } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnyEntity = Entity & Record<string, any>;

function arena(sim: Sim) {
  const instance = sim.instances.find(
    (c) =>
      c.dungeonId === NYTHRAXIS_ARENA_ID && c.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
  );
  if (!instance) throw new Error('practice arena missing');
  return instance;
}

function bossOf(sim: Sim): AnyEntity {
  const boss = arena(sim)
    .mobIds.map((id) => sim.entities.get(id))
    .find((e) => e?.templateId === NYTHRAXIS_BOSS_ID && !e.dead);
  if (!boss) throw new Error('practice boss missing');
  return boss as AnyEntity;
}

function place(sim: Sim, e: AnyEntity, pos: { x: number; y: number; z: number }) {
  e.pos = { ...pos };
  e.prevPos = { ...pos };
  sim.rebucket(e);
}

// The dev practice raid: the tank (the local player) tags the boss, one bot
// raider dies deep in the hall, and the raid finishes the boss up front.
function setup(difficulty: 'normal' | 'heroic', corpseOffsetZ: number) {
  const sim = new Sim({
    seed: 6113,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  sim.chat(`/dev nythraxisraid ${difficulty}`);
  const boss = bossOf(sim);
  const tank = sim.player as AnyEntity;
  place(sim, tank, { ...boss.pos, z: boss.pos.z - 4 });
  sim.dealDamage(tank, boss, 1, false, 'physical', null, 'hit');
  sim.tick();
  expect(boss.tappedById).toBe(tank.id);
  const victimMeta = [...sim.players.values()].find(
    (meta) => meta.isDevBot && meta.name === 'NythraxisBot1',
  );
  if (!victimMeta) throw new Error('missing raider');
  // The bot is attuned like any raider; the dev roster skips the quest.
  victimMeta.questsDone.add('q_nythraxis_bound_guardian');
  const victim = sim.entities.get(victimMeta.entityId) as AnyEntity;
  victim.profilerInvulnerable = false;
  place(sim, victim, { ...boss.pos, z: boss.pos.z + corpseOffsetZ });
  sim.dealDamage(boss, victim, victim.hp + 1, false, 'physical', null, 'hit');
  sim.tick();
  expect(victim.dead).toBe(true);
  return { sim, boss, tank, victim, victimMeta };
}

function errorsFor(sim: Sim, pid: number): string[] {
  return sim.events.flatMap((ev) =>
    ev.type === 'error' && ev.pid === pid ? [(ev as { text: string }).text] : [],
  );
}

// Deeper into the hall than the overworld party circle reaches, but still
// well inside the 100 yd room.
const BACK_OF_HALL = PARTY_XP_RANGE + 15;

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`released back-line raider keeps Nythraxis loot rights (${difficulty})`, () => {
    it('is in the kill snapshot, re-enters the locked room, and loots the corpse', () => {
      const { sim, boss, tank, victim, victimMeta } = setup(difficulty, BACK_OF_HALL);
      sim.releaseSpirit(victim.id);
      expect(victim.ghost).toBe(true);
      expect(sim.instanceInfoAt(victim.pos)).toBeNull();
      expect(sim.instanceInfoAt(victim.corpsePos!)?.dungeonId).toBe(NYTHRAXIS_ARENA_ID);

      sim.dealDamage(tank, boss, boss.hp + 1, false, 'physical', null, 'hit');
      sim.tick();
      expect(boss.dead).toBe(true);
      // The lockout and the loot rights land together.
      const lockId =
        difficulty === 'heroic' ? heroicLockoutId(NYTHRAXIS_ARENA_ID) : NYTHRAXIS_ARENA_ID;
      expect(victimMeta.raidLockouts.has(lockId)).toBe(true);
      expect(boss.lootRecipientIds).toContain(victim.id);

      // Corpse run: the cleared room stays open for its own kill's participant.
      sim.events.length = 0;
      expect(sim.enterDungeon(NYTHRAXIS_ARENA_ID, victim.id)).toBe(true);
      expect(errorsFor(sim, victim.id)).toEqual([]);
      expect(victim.dead).toBe(false);
      expect(sim.instanceInfoAt(victim.pos)?.dungeonId).toBe(NYTHRAXIS_ARENA_ID);

      // Standing on the corpse, the shared pool is theirs and they are on every roll.
      place(sim, victim, boss.pos);
      sim.events.length = 0;
      expect(sim.lootCorpse(boss.id, victim.id)).toBe(true);
      expect(errorsFor(sim, victim.id)).toEqual([]);
      const rolls = sim.events.filter((ev) => ev.type === 'lootRoll' && ev.pid === victim.id);
      expect(rolls.length).toBeGreaterThan(0);
    });
  });
}

describe('kill participation inside a claimed instance', () => {
  it('a raider who never released, dead deep in the hall, is on the rolls too', () => {
    const { sim, boss, tank, victim } = setup('normal', BACK_OF_HALL);
    sim.dealDamage(tank, boss, boss.hp + 1, false, 'physical', null, 'hit');
    sim.tick();
    expect(boss.lootRecipientIds).toContain(victim.id);
  });

  it('a ghost whose corpse lies outside the claim is judged from the graveyard, not the body', () => {
    const { sim, boss, tank, victim } = setup('normal', 6);
    sim.releaseSpirit(victim.id);
    // Rebind the corpse to a claim that is not the boss's.
    victim.corpseInstanceId = -1;
    sim.dealDamage(tank, boss, boss.hp + 1, false, 'physical', null, 'hit');
    sim.tick();
    expect(boss.lootRecipientIds).not.toContain(victim.id);
  });
});
