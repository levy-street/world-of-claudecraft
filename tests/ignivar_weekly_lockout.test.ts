// The Ignivar raid's weekly lockout: one lock each for normal and heroic per
// room, expiring on the WEEKLY reset boundary (the host injects Tuesday at the
// realm's daily-reset hour; hostless runs take a flat 7-day week). Driven
// through a real Sim's ctx settle hub and the real enterDungeon door, the
// deeds_sites_pin harness idiom.
import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_X_THRESHOLD, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  DAILY_LOCKOUT_RAID_ROOMS,
  enterDungeon,
  heroicLockoutId,
  INSTANCE_CLEARED_EMPTY_TIMEOUT,
  instanceKeyFor,
  leaveDungeon,
  RAID_REQUIRED_DUNGEON_IDS,
  updateInstances,
  WEEKLY_LOCKOUT_RAID_ROOMS,
} from '../src/sim/instances/dungeons';
import { type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import {
  type DungeonDifficulty,
  type Entity,
  IGNIVAR_BOSS_ID,
  INSTANCE_EMPTY_TIMEOUT,
  type Vec3,
} from '../src/sim/types';

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
    raidReturnKeys: new Set(),
    raidBossWelcomeKeys: new Set(),
    npcIds: [],
    objectIds: [],
    exitId: null,
    bossExitId: null,
    emptyFor: 0,
    resetAvailableAt: 0,
    clearedBy: new Set(),
    enteredBy: new Set(),
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

// The cleared-claim door exception (the heroic five-man idiom applied to the
// weekly raid rooms): the kill deliberately records clearedBy so this run's
// own participants can walk back into their exact still-live claim for loot
// and corpse runs, while the boss-alive, non-participant, and expired-claim
// guards keep every other locked entrant out.
const ARENA_LOCKED_ERROR = 'You are locked to Crucible of the Last Spring.';

function raidWithAlly(sim: Sim): { lead: PlayerMeta; ally: PlayerMeta } {
  const lead = addMeta(sim, 'Lead');
  const ally = addMeta(sim, 'Ally');
  sim.partyInvite(ally.entityId, lead.entityId);
  sim.partyAccept(ally.entityId);
  for (let i = 0; i < 3; i += 1) {
    const pid = sim.addPlayer('mage', `M${i}`);
    sim.partyInvite(pid, lead.entityId);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(lead.entityId);
  if (sim.ctx.partyOf(ally.entityId)?.raid !== true) throw new Error('test raid did not form');
  return { lead, ally };
}

function liveClaim(sim: Sim, dungeonId: string): InstanceSlot {
  const claim = sim.instances.find(
    (inst) => inst.dungeonId === dungeonId && inst.partyKey !== null,
  );
  if (!claim) throw new Error(`no live claim for ${dungeonId}`);
  return claim;
}

function bossIn(sim: Sim, claim: InstanceSlot, templateId: string): Entity {
  const boss = claim.mobIds
    .map((id) => sim.entities.get(id))
    .find((mob): mob is Entity => mob !== undefined && mob.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${claim.dungeonId}`);
  return boss;
}

// Walk the real doors: the overworld keep door onto the lift first, then the
// Halls and the requested deeper rooms via the dev arm, which stands in for
// the lift-gate ride and the interior gates (the raid LOCKOUT itself is never
// dev-bypassed).
function claimRooms(
  sim: Sim,
  lead: PlayerMeta,
  difficulty: DungeonDifficulty,
  deeperRooms: string[],
): void {
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', lead.entityId);
  if (!enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, lead.entityId)) {
    throw new Error('lift entry failed');
  }
  for (const roomId of [IGNIVAR_FORGE_APPROACH_ID, ...deeperRooms]) {
    if (!enterDungeon(sim.ctx, roomId, lead.entityId, true)) {
      throw new Error(`${roomId} entry failed`);
    }
  }
}

// Step a player back into the open world. The deeper rooms route their exit
// portal BACK a floor (tests/ignivar_exit_routing.test.ts owns those pins),
// so walking out is a bounded chain of leaveDungeon hops.
function stepOutside(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing player ${pid}`);
  for (let hop = 0; hop < 6 && e.pos.x > DUNGEON_X_THRESHOLD; hop += 1) {
    if (!leaveDungeon(sim.ctx, pid)) throw new Error('raid exit chain refused a claimed floor');
  }
  if (e.pos.x > DUNGEON_X_THRESHOLD) throw new Error('raid exit chain never reached the keep');
}

function killBoss(sim: Sim, killer: PlayerMeta, boss: Entity): void {
  sim.ctx.dealDamage(entityOf(sim, killer), boss, boss.hp + 100, false, 'physical', null, 'hit');
  if (!boss.dead) throw new Error(`${boss.templateId} survived the settle kill`);
}

function drainedErrors(sim: Sim): string[] {
  return (sim.drainEvents() as { type: string; text?: string }[])
    .filter((event) => event.type === 'error')
    .map((event) => event.text ?? '');
}

describe('the cleared-claim door: participants return to their exact live weekly claim', () => {
  it('admits a normal participant back into the cleared live arena claim', () => {
    const sim = makeSim();
    const { lead } = raidWithAlly(sim);
    claimRooms(sim, lead, 'normal', [IGNIVAR_RAID_ARENA_ID]);
    const inst = liveClaim(sim, IGNIVAR_RAID_ARENA_ID);
    const exitId = inst.exitId;
    killBoss(sim, lead, bossIn(sim, inst, IGNIVAR_BOSS_ID));
    expect(lead.raidLockouts.has(IGNIVAR_RAID_ARENA_ID)).toBe(true);
    expect(inst.clearedBy.has(lead.entityId)).toBe(true);
    // Offline members carry no characterId: the durable return key falls back
    // to the entity form, and the door reads exactly this set.
    expect(inst.raidReturnKeys.has(`entity:${lead.entityId}`)).toBe(true);
    stepOutside(sim, lead.entityId);
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId)).toBe(true);

    expect(drainedErrors(sim)).toEqual([]);
    const leadEntity = entityOf(sim, lead);
    expect(sim.instanceInfoAt(leadEntity.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(
      liveClaim(sim, IGNIVAR_RAID_ARENA_ID).exitId,
      'the same exact claim, no fresh mint',
    ).toBe(exitId);
  });

  it('admits a heroic participant back into the cleared live arena claim', () => {
    const sim = makeSim();
    const { lead } = raidWithAlly(sim);
    claimRooms(sim, lead, 'heroic', [IGNIVAR_RAID_ARENA_ID]);
    const inst = liveClaim(sim, IGNIVAR_RAID_ARENA_ID);
    expect(inst.difficulty).toBe('heroic');
    const exitId = inst.exitId;
    killBoss(sim, lead, bossIn(sim, inst, IGNIVAR_BOSS_ID));
    expect(lead.raidLockouts.has(heroicLockoutId(IGNIVAR_RAID_ARENA_ID))).toBe(true);
    expect(inst.clearedBy.has(lead.entityId)).toBe(true);
    expect(inst.raidReturnKeys.has(`entity:${lead.entityId}`)).toBe(true);
    stepOutside(sim, lead.entityId);
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId)).toBe(true);

    expect(drainedErrors(sim)).toEqual([]);
    const leadEntity = entityOf(sim, lead);
    expect(sim.instanceInfoAt(leadEntity.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID).exitId).toBe(exitId);
  });

  it('admits a heroic participant back into the cleared live Varkhul claim', () => {
    const sim = makeSim();
    const { lead } = raidWithAlly(sim);
    claimRooms(sim, lead, 'heroic', [
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]);
    const inst = liveClaim(sim, IGNIVAR_SECOND_WING_ID);
    expect(inst.difficulty).toBe('heroic');
    const varkhul = bossIn(sim, inst, VARKHUL_BOSS_ID);
    // The Grand Forge Assembly threshold pins hp at 50% until the intermission
    // completes; clear the spawn-stamped floor so the settle kill can land.
    varkhul.damageFloorHp = undefined;
    killBoss(sim, lead, varkhul);
    expect(lead.raidLockouts.has(heroicLockoutId(IGNIVAR_SECOND_WING_ID))).toBe(true);
    expect(inst.clearedBy.has(lead.entityId)).toBe(true);
    stepOutside(sim, lead.entityId);
    sim.drainEvents();

    // The approach door's checkpoint redirect resolves to the deepest claimed
    // room, so the weekly lock check lands on the cleared Varkhul claim.
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId)).toBe(true);

    expect(drainedErrors(sim)).toEqual([]);
    const leadEntity = entityOf(sim, lead);
    expect(sim.instanceInfoAt(leadEntity.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
  });

  it('corpse-runs a dead participant back in and resurrects them at the claim entrance', () => {
    const sim = makeSim();
    const { lead, ally } = raidWithAlly(sim);
    claimRooms(sim, lead, 'normal', [IGNIVAR_RAID_ARENA_ID]);
    const inst = liveClaim(sim, IGNIVAR_RAID_ARENA_ID);
    // The ally walks the real approach door and rides the checkpoint redirect
    // into the claimed arena, then falls to the boss before the kill lands.
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally.entityId)).toBe(true);
    const allyEntity = entityOf(sim, ally);
    expect(sim.instanceInfoAt(allyEntity.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    const boss = bossIn(sim, inst, IGNIVAR_BOSS_ID);
    sim.ctx.handleDeath(allyEntity, boss);
    expect(allyEntity.dead).toBe(true);
    killBoss(sim, lead, boss);
    expect(inst.clearedBy.has(ally.entityId)).toBe(true);
    expect(inst.raidReturnKeys.has(`entity:${ally.entityId}`)).toBe(true);
    expect(ally.raidLockouts.has(IGNIVAR_RAID_ARENA_ID)).toBe(true);
    sim.releaseSpirit(ally.entityId);
    expect(allyEntity.ghost).toBe(true);
    expect(sim.instanceInfoAt(allyEntity.pos)).toBeNull();
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally.entityId)).toBe(true);

    expect(drainedErrors(sim)).toEqual([]);
    expect(allyEntity.dead, 'instance re-entry is the corpse run: the ghost resurrects').toBe(
      false,
    );
    expect(allyEntity.ghost).toBe(false);
    expect(sim.instanceInfoAt(allyEntity.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
  });

  it('keeps a member locked by an EARLIER run out of the cleared claim they took no part in', () => {
    const sim = makeSim();
    const { lead, ally } = raidWithAlly(sim);
    // The ally's lock predates this claim's kill, so settlement never adds
    // them to clearedBy: the door exception must not open for them.
    ally.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, Math.floor(sim.time * 1000) + WEEK_MS);
    claimRooms(sim, lead, 'normal', [IGNIVAR_RAID_ARENA_ID]);
    const inst = liveClaim(sim, IGNIVAR_RAID_ARENA_ID);
    killBoss(sim, lead, bossIn(sim, inst, IGNIVAR_BOSS_ID));
    expect(inst.clearedBy.has(lead.entityId)).toBe(true);
    expect(inst.clearedBy.has(ally.entityId)).toBe(false);
    expect(inst.raidReturnKeys.has(`entity:${ally.entityId}`)).toBe(false);
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally.entityId)).toBe(false);

    expect(drainedErrors(sim)).toContain(ARENA_LOCKED_ERROR);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)).toBeNull();
  });

  it('keeps a locked member out of a fresh live claim whose boss is still alive', () => {
    const sim = makeSim();
    const { lead, ally } = raidWithAlly(sim);
    ally.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, Math.floor(sim.time * 1000) + WEEK_MS);
    claimRooms(sim, lead, 'normal', [IGNIVAR_RAID_ARENA_ID]);
    expect(bossIn(sim, liveClaim(sim, IGNIVAR_RAID_ARENA_ID), IGNIVAR_BOSS_ID).dead).toBe(false);
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally.entityId)).toBe(false);

    expect(drainedErrors(sim)).toContain(ARENA_LOCKED_ERROR);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)).toBeNull();
  });

  it('a freed (expired) cleared claim admits nobody: the lockout bars a fresh claim again', () => {
    const sim = makeSim();
    const { lead } = raidWithAlly(sim);
    claimRooms(sim, lead, 'normal', [IGNIVAR_RAID_ARENA_ID]);
    const inst = liveClaim(sim, IGNIVAR_RAID_ARENA_ID);
    killBoss(sim, lead, bossIn(sim, inst, IGNIVAR_BOSS_ID));
    expect(inst.clearedBy.has(lead.entityId)).toBe(true);
    stepOutside(sim, lead.entityId);
    // The reaper frees the empty cleared claim once the extended grace lapses.
    for (let second = 0; second <= INSTANCE_CLEARED_EMPTY_TIMEOUT; second += 1) {
      updateInstances(sim.ctx);
    }
    expect(sim.instances.every((slot) => slot.partyKey === null)).toBe(true);
    sim.drainEvents();

    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, lead.entityId, true)).toBe(false);

    expect(drainedErrors(sim)).toContain(ARENA_LOCKED_ERROR);
    expect(sim.instances.every((slot) => slot.partyKey === null)).toBe(true);
  });
});

// A real claimed run through the real door: enter, find the claim and its own
// final boss, kill it via the real stamping path, then exercise re-entry.
function clearedClaimRun(sim: Sim, lead: PlayerMeta): { inst: InstanceSlot; boss: Entity } {
  expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId, true)).toBe(true);
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
  // Offline members key by entity id; only the entrant minted a return key.
  expect(inst.raidReturnKeys.has(`entity:${lead.entityId}`)).toBe(true);
  return { inst, boss };
}

// The file's ctx.error capture idiom, shared by the refusal pins below.
function captureErrors(sim: Sim): string[] {
  const errors: string[] = [];
  const restore = sim.ctx.error;
  sim.ctx.error = (pid: number, text: string) => {
    errors.push(text);
    restore(pid, text);
  };
  return errors;
}

function arenaClaimsFor(sim: Sim, pid: number): InstanceSlot[] {
  const key = instanceKeyFor(sim.ctx, pid);
  return sim.ctx.instances.filter(
    (i) => i.dungeonId === 'ignivar_raid_arena' && i.partyKey === key,
  );
}

const HEROIC_ARENA_LOCKED_ERROR = 'You are locked to Heroic Crucible of the Last Spring.';

// The heroic twin of clearedClaimRun: the leader flips the party selection to
// Heroic first, so the settle runs awardHeroicMarks' HEROIC branch and the
// return key is minted through lockToHeroicClaim, the separate stamping path
// the normal-difficulty tests above never touch.
function heroicClearedClaimRun(sim: Sim, lead: PlayerMeta, participant: PlayerMeta): InstanceSlot {
  sim.setDungeonDifficulty('heroic', lead.entityId);
  expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, participant.entityId, true)).toBe(true);
  expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', participant.entityId, true)).toBe(true);
  const inst = arenaClaimsFor(sim, participant.entityId)[0];
  expect(inst.difficulty).toBe('heroic');
  const finalBossId = HEROIC_DUNGEON_TUNING.ignivar_raid_arena.finalBossId;
  const boss = inst.mobIds
    .map((id) => sim.entities.get(id))
    .find((e): e is Entity => e !== undefined && e.templateId === finalBossId)!;
  expect(boss).toBeDefined();
  boss.hp = 0;
  boss.dead = true;
  sim.ctx.awardHeroicMarks(boss, [participant]);
  expect(participant.raidLockouts.has(heroicLockoutId('ignivar_raid_arena'))).toBe(true);
  return inst;
}

describe('the cleared-run door exception on the weekly rooms', () => {
  it('a participant who steps out after the kill re-enters the cleared claim for loot', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const { inst } = clearedClaimRun(sim, lead);
    stepOutside(sim, lead.entityId);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
    // Back into the SAME claim: no parallel run was minted for a second loot pass.
    expect(arenaClaimsFor(sim, lead.entityId)).toEqual([inst]);
  });

  it('a released ghost locked by its own kill walks back through the door', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const { inst } = clearedClaimRun(sim, lead);
    const e = entityOf(sim, lead);
    const corpsePos = { ...e.pos };
    stepOutside(sim, lead.entityId);
    e.dead = true;
    e.ghost = true;
    e.corpsePos = corpsePos;
    e.corpseInstanceId = inst.exitId;
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(true);
    expect(arenaClaimsFor(sim, lead.entityId)).toEqual([inst]);
  });

  it('a relog that mints a new entity id keeps the durable return key working', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    // The killer is a raid member with a durable character id, the server shape.
    const memPid = sim.addPlayer('warrior', 'Mem', { characterId: 777 });
    sim.partyInvite(memPid, lead.entityId);
    sim.partyAccept(memPid);
    const mem = sim.players.get(memPid)!;
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, memPid, true)).toBe(true);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', memPid, true)).toBe(true);
    const inst = arenaClaimsFor(sim, memPid)[0];
    const finalBossId = HEROIC_DUNGEON_TUNING.ignivar_raid_arena.finalBossId;
    const boss = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e !== undefined && e.templateId === finalBossId)!;
    boss.hp = 0;
    boss.dead = true;
    sim.ctx.awardHeroicMarks(boss, [mem]);
    expect(inst.raidReturnKeys.has('character:777')).toBe(true);
    stepOutside(sim, memPid);
    // Relog: the old session's entity id is gone, the character id survives,
    // and the durable lockout rides back in the way hydration restores it.
    sim.removePlayer(memPid);
    const backPid = sim.addPlayer('warrior', 'Mem', { characterId: 777 });
    sim.partyInvite(backPid, lead.entityId);
    sim.partyAccept(backPid);
    const back = sim.players.get(backPid)!;
    back.raidLockouts.set('ignivar_raid_arena', Math.floor(sim.time * 1000) + WEEK_MS);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', backPid, true)).toBe(true);
  });

  it('a claim whose boss is back up is a fresh farm: the lockout still bars it', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const { boss } = clearedClaimRun(sim, lead);
    stepOutside(sim, lead.entityId);
    boss.dead = false;
    const errors = captureErrors(sim);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', lead.entityId, true)).toBe(false);
    expect(errors).toContain(ARENA_LOCKED_ERROR);
  });

  it('a raid member who never entered takes the lockout but earns no return key', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const { inst } = clearedClaimRun(sim, lead);
    // The parked alt: locked with the roster (instanceLockoutMetas), but it
    // never stepped through the door, so the cleared claim stays shut to it.
    const parked = [...sim.players.values()].find((m) => m.name === 'M0')!;
    expect(parked.raidLockouts.has('ignivar_raid_arena')).toBe(true);
    expect(inst.raidReturnKeys.has(`entity:${parked.entityId}`)).toBe(false);
    const errors = captureErrors(sim);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', parked.entityId, true)).toBe(false);
    expect(errors).toContain(ARENA_LOCKED_ERROR);
  });

  it('a heroic relog that mints a new entity id is re-admitted via the character return key', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    // The participant carries a durable character id, the server shape; the
    // kill settles through the HEROIC branch (lockToHeroicClaim minting).
    const memPid = sim.addPlayer('warrior', 'Mem', { characterId: 777 });
    sim.partyInvite(memPid, lead.entityId);
    sim.partyAccept(memPid);
    const mem = sim.players.get(memPid)!;
    const inst = heroicClearedClaimRun(sim, lead, mem);
    expect(inst.raidReturnKeys.has('character:777')).toBe(true);
    expect(inst.raidReturnKeys.has(`entity:${mem.entityId}`)).toBe(false);
    stepOutside(sim, memPid);
    // Relog: the old session's entity id is gone, the character id survives,
    // and the durable heroic lockout rides back in the way hydration restores it.
    sim.removePlayer(memPid);
    const backPid = sim.addPlayer('warrior', 'Mem', { characterId: 777 });
    sim.partyInvite(backPid, lead.entityId);
    sim.partyAccept(backPid);
    const back = sim.players.get(backPid)!;
    expect(back.entityId).not.toBe(mem.entityId);
    back.raidLockouts.set(
      heroicLockoutId('ignivar_raid_arena'),
      Math.floor(sim.time * 1000) + WEEK_MS,
    );
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', backPid, true)).toBe(true);
    // Back into the SAME live heroic claim, no parallel run minted.
    expect(arenaClaimsFor(sim, backPid)).toEqual([inst]);
  });

  it('a heroic roster member who never entered takes the lockout but is refused at the door', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    const inst = heroicClearedClaimRun(sim, lead, lead);
    // The parked alt: the heroic settlement locks it with the roster and adds
    // it to clearedBy, but it never stepped through the door, so no return key
    // and the cleared heroic claim stays shut to it.
    const parked = [...sim.players.values()].find((m) => m.name === 'M0')!;
    expect(parked.raidLockouts.has(heroicLockoutId('ignivar_raid_arena'))).toBe(true);
    expect(inst.clearedBy.has(parked.entityId)).toBe(true);
    expect(inst.raidReturnKeys.has(`entity:${parked.entityId}`)).toBe(false);
    const errors = captureErrors(sim);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', parked.entityId, true)).toBe(false);
    expect(errors).toContain(HEROIC_ARENA_LOCKED_ERROR);
  });

  it('a player locked by an earlier run is still barred from someone else cleared claim', () => {
    const sim = makeSim();
    const lead = raidLeader(sim);
    clearedClaimRun(sim, lead);
    // Late joins the raid AFTER the kill, carrying a lock from an earlier run:
    // no return key on this claim, so the door must still refuse the ferry.
    const latePid = sim.addPlayer('mage', 'Late');
    sim.partyInvite(latePid, lead.entityId);
    sim.partyAccept(latePid);
    // The join must have landed, or the refusal below proves nothing.
    expect(instanceKeyFor(sim.ctx, latePid)).toBe(instanceKeyFor(sim.ctx, lead.entityId));
    const late = sim.players.get(latePid)!;
    late.raidLockouts.set('ignivar_raid_arena', Math.floor(sim.time * 1000) + WEEK_MS);
    const errors = captureErrors(sim);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', latePid, true)).toBe(false);
    expect(errors).toContain(ARENA_LOCKED_ERROR);
  });
});

describe('the family reaper honors a cleared sibling claim', () => {
  it('a bossless sibling room does not reap the cleared arena at the short timeout', () => {
    // The shipped boundary values are the promise this test guards: pin them
    // as literals so a silent retune of either constant fails HERE rather than
    // letting the loop arithmetic below self-adjust around the change.
    expect(INSTANCE_EMPTY_TIMEOUT).toBe(300);
    expect(INSTANCE_CLEARED_EMPTY_TIMEOUT).toBe(900);
    const sim = makeSim();
    const lead = raidLeader(sim);
    // Claim the bossless front room first, then the arena, so the family holds
    // two live claims under one party key.
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId, true)).toBe(true);
    const key = instanceKeyFor(sim.ctx, lead.entityId);
    const approach = sim.ctx.instances.find(
      (i) => i.dungeonId === IGNIVAR_FORGE_APPROACH_ID && i.partyKey === key,
    )!;
    expect(approach).toBeDefined();
    const { inst } = clearedClaimRun(sim, lead);
    stepOutside(sim, lead.entityId);
    // Past the SHORT 300-second timeout, the bossless approach used to free
    // the whole family, cleared arena and boss corpse included; the cleared
    // grace now extends to every sibling. Each reaper pass counts one empty
    // second, so emptyFor tracks the elapsed empty time exactly.
    for (let i = 0; i < INSTANCE_EMPTY_TIMEOUT + 1; i += 1) updateInstances(sim.ctx);
    expect(inst.emptyFor).toBe(INSTANCE_EMPTY_TIMEOUT + 1);
    expect(inst.partyKey, 'cleared arena survives the short family timeout').toBe(key);
    expect(approach.partyKey, 'sibling rides the same grace').toBe(key);
    // One empty second shy of the 900-second cleared grace: the whole family
    // is still live, so the promised loot-recovery window really is 900, not
    // some shorter figure the loop above would have silently absorbed. The
    // pass count is a FIXED number derived from the elapsed passes, never a
    // loop on emptyFor itself: a premature family free resets that field to 0
    // and the reaper skips freed slots, so an unbounded condition would spin
    // forever instead of letting the live-at-899 asserts below fail normally.
    const passesTo899 = INSTANCE_CLEARED_EMPTY_TIMEOUT - 1 - (INSTANCE_EMPTY_TIMEOUT + 1);
    for (let i = 0; i < passesTo899; i += 1) updateInstances(sim.ctx);
    expect(inst.emptyFor).toBe(INSTANCE_CLEARED_EMPTY_TIMEOUT - 1);
    expect(approach.emptyFor).toBe(INSTANCE_CLEARED_EMPTY_TIMEOUT - 1);
    expect(inst.partyKey, 'still live at 899 empty seconds').toBe(key);
    expect(approach.partyKey, 'sibling still live at 899 empty seconds').toBe(key);
    // The 900th empty second frees the whole family together, at the boundary,
    // not at some later drift the old two-loop arithmetic could not see.
    updateInstances(sim.ctx);
    expect(inst.partyKey, 'freed exactly at the 900-second boundary').toBeNull();
    expect(approach.partyKey, 'family freed together at the boundary').toBeNull();
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

  it('pins the shipped memberships, so a silent weekly/daily swap fails loudly here', () => {
    // The guard loops above are structural; this floor is the literal anchor.
    // NOTE: the guard's reach is exactly RAID_REQUIRED_DUNGEON_IDS, so a future
    // raid-tier boss room must join that set (it must, for the raid-group door
    // rule) before the declaration guard can see it.
    expect([...WEEKLY_LOCKOUT_RAID_ROOMS].sort()).toEqual([
      'ignivar_inner_crucible',
      'ignivar_raid_arena',
    ]);
    expect([...DAILY_LOCKOUT_RAID_ROOMS]).toEqual(['nythraxis_boss_arena']);
  });
});
