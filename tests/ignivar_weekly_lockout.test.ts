// The Ignivar raid's weekly lockout: one lock each for normal and heroic per
// room, expiring on the WEEKLY reset boundary (the host injects Tuesday at the
// realm's daily-reset hour; hostless runs take a flat 7-day week). Driven
// through a real Sim's ctx settle hub and the real enterDungeon door, the
// deeds_sites_pin harness idiom.
import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  DAILY_LOCKOUT_RAID_ROOMS,
  enterDungeon,
  heroicLockoutId,
  instanceKeyFor,
  leaveDungeon,
  RAID_REQUIRED_DUNGEON_IDS,
  WEEKLY_LOCKOUT_RAID_ROOMS,
} from '../src/sim/instances/dungeons';
import { type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import type { DungeonDifficulty, Entity, Vec3 } from '../src/sim/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function makeSim(seed = 42, weeklyRaidResetMs?: (nowMs: number) => number): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    devCommands: true,
    weeklyRaidResetMs,
  });
}

function addMeta(sim: Sim, name: string): PlayerMeta {
  const pid = sim.addPlayer('warrior', name);
  return sim.players.get(pid)!;
}

function entityOf(sim: Sim, meta: PlayerMeta): Entity {
  return sim.entities.get(meta.entityId)!;
}

function spawnMob(sim: Sim, templateId: string, pos: Vec3, level = 30): Entity {
  const e = createMob(sim.ctx.nextId++, MOBS[templateId], level, pos);
  sim.addEntity(e);
  return e;
}

function encounterInstance(
  sim: Sim,
  templateId: string,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  names: string[],
): { boss: Entity; inst: InstanceSlot; recipients: PlayerMeta[] } {
  const origin = instanceOrigin(DUNGEONS[dungeonId].index, 0);
  const boss = spawnMob(sim, templateId, { x: origin.x, y: 0, z: origin.z });
  const inst: InstanceSlot = {
    dungeonId,
    difficulty,
    slot: 0,
    partyKey: 'party:lockout-test',
    mobIds: [boss.id],
    raidBossWelcomeKeys: new Set(),
    npcIds: [],
    objectIds: [],
    exitId: null,
    bossExitId: null,
    emptyFor: 0,
    resetAvailableAt: 0,
    clearedBy: new Set(),
    enteredBy: new Set(),
    combatExitMemory: new Map(),
  };
  sim.ctx.instances.push(inst);
  const recipients = names.map((name) => {
    const meta = addMeta(sim, name);
    entityOf(sim, meta).pos = { x: origin.x, y: 0, z: origin.z };
    inst.enteredBy.add(meta.entityId);
    return meta;
  });
  return { boss, inst, recipients };
}

describe('normal-difficulty weekly lockout on the raid rooms', () => {
  it('a normal Ignivar kill locks every participant under the plain room id for a week', () => {
    const sim = makeSim();
    const { boss, inst, recipients } = encounterInstance(
      sim,
      'ignivar_herald_of_the_last_flame',
      'ignivar_raid_arena',
      'normal',
      ['Tank', 'Healer'],
    );
    const nowMs = Math.floor(sim.time * 1000);
    sim.ctx.awardHeroicMarks(boss, recipients);
    for (const meta of recipients) {
      expect(meta.raidLockouts.get('ignivar_raid_arena')).toBe(nowMs + WEEK_MS);
      // The heroic key stays free: normal and heroic lock independently.
      expect(meta.raidLockouts.has(heroicLockoutId('ignivar_raid_arena'))).toBe(false);
      // The cleared-run door exception can recognize this kill's own claim.
      expect(inst.clearedBy.has(meta.entityId)).toBe(true);
    }
  });

  it('a normal kill in a NON-raid dungeon locks nothing (the control)', () => {
    const sim = makeSim();
    const { boss, recipients } = encounterInstance(sim, 'morthen', 'hollow_crypt', 'normal', [
      'Tank',
    ]);
    sim.ctx.awardHeroicMarks(boss, recipients);
    expect(recipients[0].raidLockouts.size).toBe(0);
  });

  it('the host-injected weekly boundary wins over the flat fallback', () => {
    const untilMs = 1_777_000_000_000;
    const sim = makeSim(42, () => untilMs);
    const { boss, recipients } = encounterInstance(
      sim,
      'varkhul_forgefather_of_the_last_flame',
      'ignivar_inner_crucible',
      'normal',
      ['Tank'],
    );
    sim.ctx.awardHeroicMarks(boss, recipients);
    expect(recipients[0].raidLockouts.get('ignivar_inner_crucible')).toBe(untilMs);
  });
});

describe('heroic raid kills take the weekly boundary; ordinary heroics stay daily', () => {
  it('a heroic Varkhul kill locks the heroic key for a WEEK, not a day', () => {
    const sim = makeSim();
    const { boss, recipients } = encounterInstance(
      sim,
      'varkhul_forgefather_of_the_last_flame',
      'ignivar_inner_crucible',
      'heroic',
      ['Tank'],
    );
    const nowMs = Math.floor(sim.time * 1000);
    sim.ctx.awardHeroicMarks(boss, recipients);
    expect(recipients[0].raidLockouts.get(heroicLockoutId('ignivar_inner_crucible'))).toBe(
      nowMs + WEEK_MS,
    );
    // Normal stays free: one lock each per difficulty.
    expect(recipients[0].raidLockouts.has('ignivar_inner_crucible')).toBe(false);
  });

  it('a heroic kill in an ordinary dungeon keeps the DAILY boundary (the control)', () => {
    const sim = makeSim();
    const { boss, recipients } = encounterInstance(sim, 'morthen', 'hollow_crypt', 'heroic', [
      'Tank',
    ]);
    const nowMs = Math.floor(sim.time * 1000);
    sim.ctx.awardHeroicMarks(boss, recipients);
    expect(recipients[0].raidLockouts.get(heroicLockoutId('hollow_crypt'))).toBe(nowMs + DAY_MS);
  });
});

// A raid-group leader with a full group, the nythraxis entry recipe: the raid
// door requires a converted raid group before any lock check is reachable.
function raidLeader(sim: Sim): PlayerMeta {
  const lead = addMeta(sim, 'Lead');
  for (let i = 0; i < 4; i += 1) {
    const pid = sim.addPlayer('mage', `M${i}`);
    sim.partyInvite(pid, lead.entityId);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(lead.entityId);
  return lead;
}

describe('the door: a locked player cannot mint a fresh raid claim', () => {
  it('a normal lock bars fresh normal entry with the lockout error, heroic entry stays open', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const nowMs = Math.floor(sim.time * 1000);
    lead.raidLockouts.set('ignivar_raid_arena', nowMs + WEEK_MS);
    const errors: string[] = [];
    const restore = sim.ctx.error;
    sim.ctx.error = (pid: number, text: string) => {
      errors.push(text);
      restore(pid, text);
    };
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(false);
    expect(errors.some((text) => text === 'You are locked to Crucible of the Last Spring.')).toBe(
      true,
    );
    sim.ctx.error = restore;
    // The heroic difficulty is a separate weekly lock: still enterable.
    sim.setDungeonDifficulty('heroic', lead.entityId);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
  });

  it('an expired lock clears at the door and entry proceeds', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    lead.raidLockouts.set('ignivar_raid_arena', Math.floor(sim.time * 1000) - 1);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
    expect(lead.raidLockouts.has('ignivar_raid_arena')).toBe(false);
  });
});

// A real claimed run through the real door: enter, find the claim and its own
// final boss, kill it via the real stamping path, then exercise re-entry.
function clearedClaimRun(sim: Sim, lead: PlayerMeta): { inst: InstanceSlot; boss: Entity } {
  expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
  const key = instanceKeyFor(sim.ctx, lead.entityId);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'ignivar_raid_arena' && i.partyKey === key,
  )!;
  expect(inst).toBeDefined();
  const finalBossId = HEROIC_DUNGEON_TUNING.ignivar_raid_arena.finalBossId;
  const boss = inst.mobIds
    .map((id) => sim.entities.get(id))
    .find((e): e is Entity => e !== undefined && e.templateId === finalBossId)!;
  expect(boss).toBeDefined();
  boss.hp = 0;
  boss.dead = true;
  sim.ctx.awardHeroicMarks(boss, [lead]);
  expect(lead.raidLockouts.has('ignivar_raid_arena')).toBe(true);
  expect(inst.clearedBy.has(lead.entityId)).toBe(true);
  return { inst, boss };
}

describe('the cleared-run door exception on the weekly rooms', () => {
  it('a participant who steps out after the kill re-enters the cleared claim for loot', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    clearedClaimRun(sim, lead);
    expect(leaveDungeon(sim.ctx, lead.entityId)).toBe(true);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
  });

  it('a released ghost locked by its own kill walks back in to resurrect', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const { inst } = clearedClaimRun(sim, lead);
    const e = entityOf(sim, lead);
    const corpsePos = { ...e.pos };
    expect(leaveDungeon(sim.ctx, lead.entityId)).toBe(true);
    e.dead = true;
    e.ghost = true;
    e.corpsePos = corpsePos;
    e.corpseInstanceId = inst.exitId;
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
  });

  it('a player locked by an earlier run is still barred from someone else cleared claim', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    clearedClaimRun(sim, lead);
    // Late joins the raid AFTER the kill, carrying a lock from an earlier run:
    // not in this claim's clearedBy, so the door must still refuse the ferry.
    const latePid = sim.addPlayer('mage', 'Late');
    sim.partyInvite(latePid, lead.entityId);
    sim.partyAccept(latePid);
    const late = sim.players.get(latePid)!;
    late.raidLockouts.set('ignivar_raid_arena', Math.floor(sim.time * 1000) + WEEK_MS);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', latePid, true)).toBe(false);
  });
});

describe('every raid boss room declares its lockout boundary explicitly', () => {
  it('raid rooms with a final boss sit in exactly one of the weekly/daily sets', () => {
    for (const dungeonId of RAID_REQUIRED_DUNGEON_IDS) {
      const hasFinalBoss = HEROIC_DUNGEON_TUNING[dungeonId]?.finalBossId !== undefined;
      const weekly = WEEKLY_LOCKOUT_RAID_ROOMS.has(dungeonId);
      const daily = DAILY_LOCKOUT_RAID_ROOMS.has(dungeonId);
      if (!hasFinalBoss) {
        expect(weekly || daily, `${dungeonId} has no final boss, so no lockout set`).toBe(false);
        continue;
      }
      expect(
        weekly !== daily,
        `${dungeonId} must declare weekly or daily lockout, exactly one`,
      ).toBe(true);
    }
  });

  it('the two sets never overlap and name only raid-tier rooms', () => {
    for (const dungeonId of WEEKLY_LOCKOUT_RAID_ROOMS) {
      expect(DAILY_LOCKOUT_RAID_ROOMS.has(dungeonId), dungeonId).toBe(false);
      expect(RAID_REQUIRED_DUNGEON_IDS.has(dungeonId), dungeonId).toBe(true);
    }
    for (const dungeonId of DAILY_LOCKOUT_RAID_ROOMS) {
      expect(RAID_REQUIRED_DUNGEON_IDS.has(dungeonId), dungeonId).toBe(true);
    }
  });
});
