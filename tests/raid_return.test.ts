// The raid return route (src/sim/instances/raid_return.ts): a raider who
// cleared a run and took its lockout, but no longer belongs to the group that
// owns it, walks back through the raid door into THAT run, so a corpse run or
// an award held on a corpse (loot/awarded_loot_hold.ts) stays reachable.
// Before the route, leaving the raid stranded them: a solo entrant was refused
// for having no raid group, a new raid's fresh claim was barred by the
// lockout, and the held item rotted on the corpse. Driven through a real Sim
// and the real enterDungeon door (the tests/ignivar_weekly_lockout.test.ts
// harness idiom).
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { DUNGEON_X_THRESHOLD, ITEMS } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_RAID_ROOM_IDS,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  enterDungeon,
  INSTANCE_CLEARED_EMPTY_TIMEOUT,
  instanceKeyFor,
  leaveDungeon,
  nythraxisInstanceSealed,
  updateInstances,
} from '../src/sim/instances/dungeons';
import { raidFamilyOf, raidReturnClaimFor } from '../src/sim/instances/raid_return';
import { grantOrHoldAwardedLoot, rebindHeldAwardsOnJoin } from '../src/sim/loot/awarded_loot_hold';
import { type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import {
  type DungeonDifficulty,
  type Entity,
  IGNIVAR_BOSS_ID,
  NYTHRAXIS_BOSS_ID,
} from '../src/sim/types';

const ARENA_LOCKED_ERROR = 'You are locked to Crucible of the Last Spring.';
const GATE_SEALED_ERROR = 'The forge gate is sealed to you.';
const NEEDS_RAID_ERROR = 'You must convert your party to a raid group first.';
const HELD_ITEM = 'worn_sword';
const NYTHRAXIS_ATTUNEMENT = 'q_nythraxis_bound_guardian';

// The setup walks the interior gates with the dev arm (it stands in for the
// lift ride and the Halls gate; the raid LOCKOUT is never dev-bypassed), and
// the dev flag also waives the raid-group gate. productionDoor turns the flag
// off afterwards, so every assertion runs the door exactly as a live realm does.
function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
}

function productionDoor(sim: Sim): void {
  (sim as { devCommands: boolean }).devCommands = false;
}

function addMeta(sim: Sim, name: string, characterId?: number): PlayerMeta {
  const pid = sim.addPlayer(
    'warrior',
    name,
    characterId === undefined ? undefined : { characterId },
  );
  return sim.players.get(pid)!;
}

function entityOf(sim: Sim, meta: PlayerMeta): Entity {
  return sim.entities.get(meta.entityId)!;
}

// A five-player raid: the leader, the ally whose return the tests follow, and
// three fillers who never step inside.
function ignivarRaid(sim: Sim, allyCharacterId?: number) {
  const lead = addMeta(sim, 'Lead');
  const ally = addMeta(sim, 'Ally', allyCharacterId);
  const fillers: number[] = [];
  sim.partyInvite(ally.entityId, lead.entityId);
  sim.partyAccept(ally.entityId);
  for (let i = 0; i < 3; i += 1) {
    const pid = sim.addPlayer('mage', `M${i}`);
    sim.partyInvite(pid, lead.entityId);
    sim.partyAccept(pid);
    fillers.push(pid);
  }
  sim.convertPartyToRaid(lead.entityId);
  return { lead, ally, fillers };
}

function liveClaim(sim: Sim, dungeonId: string, partyKey: string): InstanceSlot {
  const claim = sim.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === partyKey);
  if (!claim) throw new Error(`no live ${dungeonId} claim for ${partyKey}`);
  return claim;
}

function bossIn(sim: Sim, claim: InstanceSlot, templateId: string): Entity {
  const boss = claim.mobIds
    .map((id) => sim.entities.get(id))
    .find((mob): mob is Entity => mob !== undefined && mob.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${claim.dungeonId}`);
  return boss;
}

// The leader claims the lift, the Halls and the arena; the ally then walks the
// keep door and the checkpoint redirect drops them straight into the arena.
// Both have entered, so the kill mints both a return key.
function clearIgnivarArena(sim: Sim, difficulty: DungeonDifficulty = 'normal') {
  const raid = ignivarRaid(sim);
  return { ...raid, ...clearArenaFor(sim, raid.lead, raid.ally, difficulty) };
}

function clearArenaFor(
  sim: Sim,
  lead: PlayerMeta,
  ally: PlayerMeta,
  difficulty: DungeonDifficulty,
) {
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', lead.entityId);
  expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, lead.entityId)).toBe(true);
  expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, lead.entityId, true)).toBe(true);
  expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, lead.entityId, true)).toBe(true);
  expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
  const raidKey = instanceKeyFor(sim.ctx, lead.entityId);
  const arena = liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey);
  expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
  const boss = bossIn(sim, arena, IGNIVAR_BOSS_ID);
  sim.ctx.dealDamage(entityOf(sim, lead), boss, boss.hp + 100, false, 'physical', null, 'hit');
  expect(boss.dead).toBe(true);
  const allyKey =
    ally.characterId === undefined ? `entity:${ally.entityId}` : `character:${ally.characterId}`;
  expect(arena.raidReturnKeys.has(allyKey)).toBe(true);
  return { raidKey, arena, boss };
}

// Walk out through the exit chain (the deeper rooms route their exit BACK a
// floor; tests/ignivar_exit_routing.test.ts owns those pins).
function stepOutside(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid)!;
  for (let hop = 0; hop < 6 && e.pos.x > DUNGEON_X_THRESHOLD; hop += 1) {
    if (!leaveDungeon(sim.ctx, pid)) throw new Error('raid exit chain refused a claimed floor');
  }
  if (e.pos.x > DUNGEON_X_THRESHOLD) throw new Error('raid exit chain never reached the keep');
}

// Form a NEW raid group (a fresh party id) led by `leader`, topped up to the
// five members a raid conversion requires with fresh players.
function formRaid(sim: Sim, leader: number, members: number[]): string {
  const all = [...members];
  while (all.length < 4) all.push(sim.addPlayer('mage', `New${all.length}`));
  for (const pid of all) {
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(leader);
  expect(sim.ctx.partyOf(leader)?.raid).toBe(true);
  return instanceKeyFor(sim.ctx, leader);
}

function captureErrors(sim: Sim): string[] {
  const errors: string[] = [];
  const restore = sim.ctx.error;
  sim.ctx.error = (pid: number, text: string) => {
    errors.push(text);
    restore(pid, text);
  };
  return errors;
}

function ignivarClaimsFor(sim: Sim, partyKey: string): InstanceSlot[] {
  return sim.instances.filter(
    (i) =>
      i.partyKey === partyKey && (IGNIVAR_RAID_ROOM_IDS as readonly string[]).includes(i.dungeonId),
  );
}

// Fill every free bag slot with distinct gear (the tests/awarded_loot_hold idiom).
function fillBags(sim: Sim, meta: PlayerMeta): void {
  const gearIds = Object.values(ITEMS)
    .filter((d) => (d.kind === 'weapon' || d.kind === 'armor') && d.id !== HELD_ITEM)
    .map((d) => d.id);
  for (let i = 0; meta.inventory.length < bagCapacity(meta.bags); i += 1) {
    sim.addItem(gearIds[i % gearIds.length], 1, meta.entityId);
  }
}

describe('raid return route: a cleared Ignivar raider who left the raid', () => {
  it('walks back through the keep door into the exact run they cleared', () => {
    const sim = makeSim();
    const { ally, raidKey, arena } = clearIgnivarArena(sim);
    const exitId = arena.exitId;
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    expect(sim.ctx.partyOf(ally.entityId)).toBeNull();
    expect(ally.raidLockouts.has(IGNIVAR_RAID_ARENA_ID)).toBe(true);
    productionDoor(sim);
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);

    expect(errors).toEqual([]);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey).exitId, 'the same run').toBe(exitId);
    expect(arena.enteredBy.has(ally.entityId)).toBe(true);
    expect(
      ignivarClaimsFor(sim, instanceKeyFor(sim.ctx, ally.entityId)),
      'no fresh run minted under the solo key',
    ).toEqual([]);
  });

  it('reaches the award held on the boss corpse for their full bags and loots it', () => {
    const sim = makeSim();
    const { ally, boss } = clearIgnivarArena(sim);
    fillBags(sim, ally);
    grantOrHoldAwardedLoot(sim.ctx, boss.id, HELD_ITEM, ally.entityId, {
      names: [],
      characterIds: [],
    });
    expect(sim.countItem(HELD_ITEM, ally.entityId)).toBe(0);
    expect(boss.loot?.items.some((s) => s.itemId === HELD_ITEM && s.personalFor)).toBe(true);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
    const allyEntity = entityOf(sim, ally);
    allyEntity.pos = { ...boss.pos };
    allyEntity.prevPos = { ...boss.pos };
    sim.rebucket(allyEntity);
    const last = ally.inventory[ally.inventory.length - 1];
    sim.removeItem(last.itemId, last.count, ally.entityId);
    sim.lootCorpse(boss.id, ally.entityId);

    expect(sim.countItem(HELD_ITEM, ally.entityId)).toBe(1);
    expect(boss.loot?.items.some((s) => s.itemId === HELD_ITEM && s.personalFor)).toBe(false);
  });

  it('keeps the route across a relog that mints a new entity id', () => {
    const sim = makeSim();
    const raid = ignivarRaid(sim, 4242);
    const { raidKey, arena } = clearArenaFor(sim, raid.lead, raid.ally, 'normal');
    expect(arena.raidReturnKeys.has('character:4242')).toBe(true);
    stepOutside(sim, raid.ally.entityId);
    const lockedUntil = raid.ally.raidLockouts.get(IGNIVAR_RAID_ARENA_ID)!;
    sim.removePlayer(raid.ally.entityId);
    const back = addMeta(sim, 'Ally', 4242);
    // Hydration restores the durable lockout with the character.
    back.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, lockedUntil);
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, back.entityId)).toBe(true);

    expect(sim.instanceInfoAt(entityOf(sim, back).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey)).toBe(arena);
  });

  it('a raid that disbanded and reformed under a new party id goes back to its run', () => {
    const sim = makeSim();
    const { lead, ally, fillers, raidKey, arena } = clearIgnivarArena(sim);
    for (const pid of [lead.entityId, ally.entityId]) stepOutside(sim, pid);
    for (const pid of [ally.entityId, ...fillers, lead.entityId]) sim.partyLeave(pid);
    // The ally re-forms the raid: a brand new party id, same Normal selection.
    const newKey = formRaid(sim, ally.entityId, [...fillers, lead.entityId]);
    expect(newKey).not.toBe(raidKey);
    productionDoor(sim);

    for (const member of [ally, lead]) {
      expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, member.entityId)).toBe(true);
      expect(sim.instanceInfoAt(entityOf(sim, member).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    }
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey)).toBe(arena);
    expect(ignivarClaimsFor(sim, newKey)).toEqual([]);
  });

  it('a raid group set to the OTHER difficulty starts its own fresh run instead', () => {
    const sim = makeSim();
    const { ally, fillers, raidKey } = clearIgnivarArena(sim, 'normal');
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    for (const pid of fillers) sim.partyLeave(pid);
    const newKey = formRaid(sim, ally.entityId, fillers);
    sim.setDungeonDifficulty('heroic', ally.entityId);
    expect(sim.ctx.dungeonDifficulty(ally.entityId)).toBe('heroic');
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);

    const fresh = liveClaim(sim, IGNIVAR_LIFT_ROOM_ID, newKey);
    expect(fresh.difficulty).toBe('heroic');
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_LIFT_ROOM_ID);
    expect(liveClaim(sim, IGNIVAR_LIFT_ROOM_ID, raidKey)).not.toBe(fresh);
  });

  it('a raid member who never entered the run has no way back in', () => {
    const sim = makeSim();
    const { fillers, arena } = clearIgnivarArena(sim);
    const camper = sim.players.get(fillers[0])!;
    // The kill locks the whole raid, the camper included, but only entrants
    // earn a return key.
    expect(camper.raidLockouts.has(IGNIVAR_RAID_ARENA_ID)).toBe(true);
    expect(arena.raidReturnKeys.has(`entity:${camper.entityId}`)).toBe(false);
    sim.partyLeave(camper.entityId);
    productionDoor(sim);
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, camper.entityId)).toBe(false);

    expect(errors).toEqual([NEEDS_RAID_ERROR]);
    expect(entityOf(sim, camper).pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('a run whose final boss is back up is never a return target', () => {
    const sim = makeSim();
    const { ally, boss } = clearIgnivarArena(sim);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    boss.dead = false;
    productionDoor(sim);
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(false);

    expect(errors).toEqual([NEEDS_RAID_ERROR]);
  });

  it('once the cleared run is freed the route is gone, and the lockout bars a fresh run', () => {
    const sim = makeSim();
    const { lead, ally, fillers } = clearIgnivarArena(sim);
    for (const pid of [lead.entityId, ally.entityId]) stepOutside(sim, pid);
    sim.partyLeave(ally.entityId);
    for (const pid of fillers) sim.partyLeave(pid);
    formRaid(sim, ally.entityId, fillers);
    for (let second = 0; second <= INSTANCE_CLEARED_EMPTY_TIMEOUT; second += 1) {
      updateInstances(sim.ctx);
    }
    expect(sim.instances.every((slot) => slot.partyKey === null)).toBe(true);
    productionDoor(sim);
    const errors = captureErrors(sim);

    // The lift itself carries no lock: the fresh run starts, then the arena bars it.
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_LIFT_ROOM_ID);
    (sim as { devCommands: boolean }).devCommands = true;
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally.entityId, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, ally.entityId, true)).toBe(false);

    expect(errors).toContain(ARENA_LOCKED_ERROR);
  });

  it('lands in the cleared arena, never in the deeper rooms the raid pushed on into', () => {
    const sim = makeSim();
    const { lead, ally, raidKey } = clearIgnivarArena(sim);
    // The raid moves on: the Molten Assembly and the inner crucible, Varkhul alive.
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, lead.entityId, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, lead.entityId, true)).toBe(true);
    const crucible = liveClaim(sim, IGNIVAR_SECOND_WING_ID, raidKey);
    expect(bossIn(sim, crucible, VARKHUL_BOSS_ID).dead).toBe(false);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    productionDoor(sim);
    const claimsBefore = sim.instances.filter((i) => i.partyKey !== null).length;
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    // From inside the cleared arena, the way forward stays shut to them.
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, ally.entityId)).toBe(false);

    expect(errors).toEqual([GATE_SEALED_ERROR]);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(sim.instances.filter((i) => i.partyKey !== null).length).toBe(claimsBefore);
  });

  it('a raider whose raid was converted back to a party still reaches the room they cleared', () => {
    const sim = makeSim();
    const { lead, ally, raidKey, arena } = clearIgnivarArena(sim);
    stepOutside(sim, ally.entityId);
    sim.convertRaidToParty(lead.entityId);
    expect(sim.ctx.partyOf(ally.entityId)?.raid).toBe(false);
    expect(instanceKeyFor(sim.ctx, ally.entityId)).toBe(raidKey);
    productionDoor(sim);
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);

    expect(errors).toEqual([]);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey)).toBe(arena);
  });

  it('a heroic clear routes back into its heroic run', () => {
    const sim = makeSim();
    const { ally, raidKey, arena } = clearIgnivarArena(sim, 'heroic');
    expect(arena.difficulty).toBe('heroic');
    expect(ally.raidLockouts.has(`${IGNIVAR_RAID_ARENA_ID}:heroic`)).toBe(true);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);

    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(liveClaim(sim, IGNIVAR_RAID_ARENA_ID, raidKey)).toBe(arena);
  });

  it('a released ghost corpse-runs back in and resurrects in the cleared run', () => {
    const sim = makeSim();
    const { ally, arena } = clearIgnivarArena(sim);
    const e = entityOf(sim, ally);
    const corpsePos = { ...e.pos };
    stepOutside(sim, ally.entityId);
    e.dead = true;
    e.ghost = true;
    e.corpsePos = corpsePos;
    e.corpseInstanceId = arena.exitId;
    sim.partyLeave(ally.entityId);
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);

    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(sim.instanceInfoAt(e.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
  });

  it('once their lock lapses at the reset the route lets go of them', () => {
    const sim = makeSim();
    const { ally } = clearIgnivarArena(sim);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    // The door treats a lock as lapsed once now reaches it (isRaidLocked).
    ally.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, sim.ctx.lockoutNowMs());
    productionDoor(sim);
    const errors = captureErrors(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(false);

    expect(errors).toEqual([NEEDS_RAID_ERROR]);
  });

  it('walks back out through the old run even after their new raid claims the lift', () => {
    const sim = makeSim();
    const { ally, raidKey } = clearIgnivarArena(sim);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    productionDoor(sim);
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
    // While they stand in the old arena, a new raid of theirs claims the lift.
    const newKey = formRaid(sim, ally.entityId, []);
    const recruit = sim.ctx.partyOf(ally.entityId)!.members.find((m) => m !== ally.entityId)!;
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, recruit)).toBe(true);
    const newLift = liveClaim(sim, IGNIVAR_LIFT_ROOM_ID, newKey);
    const errors = captureErrors(sim);

    // The arena exit steps BACK a floor, into the old run's Halls, then out.
    expect(leaveDungeon(sim.ctx, ally.entityId)).toBe(true);
    expect(sim.instanceInfoAt(entityOf(sim, ally).pos)?.dungeonId).toBe(IGNIVAR_FORGE_APPROACH_ID);
    expect(
      liveClaim(sim, IGNIVAR_FORGE_APPROACH_ID, raidKey).dungeonId,
      'the old run, not the new one',
    ).toBe(IGNIVAR_FORGE_APPROACH_ID);
    stepOutside(sim, ally.entityId);

    expect(errors).toEqual([]);
    expect(newLift.enteredBy.has(ally.entityId)).toBe(false);
  });

  it('can still walk out if their lock lapses at a reset while they are inside', () => {
    const sim = makeSim();
    const { ally } = clearIgnivarArena(sim);
    stepOutside(sim, ally.entityId);
    sim.partyLeave(ally.entityId);
    productionDoor(sim);
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, ally.entityId)).toBe(true);
    ally.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, sim.ctx.lockoutNowMs());
    const errors = captureErrors(sim);

    // Forward stays shut without the lock; the way out does not.
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, ally.entityId)).toBe(false);
    stepOutside(sim, ally.entityId);

    expect(errors).toEqual([GATE_SEALED_ERROR]);
    expect(entityOf(sim, ally).pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('a relog on the way back still takes the held award off the corpse', () => {
    const sim = makeSim();
    const raid = ignivarRaid(sim, 4242);
    const { boss } = clearArenaFor(sim, raid.lead, raid.ally, 'normal');
    fillBags(sim, raid.ally);
    grantOrHoldAwardedLoot(sim.ctx, boss.id, HELD_ITEM, raid.ally.entityId, {
      names: [],
      characterIds: [],
    });
    stepOutside(sim, raid.ally.entityId);
    sim.partyLeave(raid.ally.entityId);
    const lockedUntil = raid.ally.raidLockouts.get(IGNIVAR_RAID_ARENA_ID)!;
    const oldId = raid.ally.entityId;
    sim.removePlayer(oldId);
    const back = addMeta(sim, 'Ally', 4242);
    back.raidLockouts.set(IGNIVAR_RAID_ARENA_ID, lockedUntil);
    expect(back.entityId).not.toBe(oldId);
    const held = boss.loot?.items.find((s) => s.itemId === HELD_ITEM && s.personalFor);
    expect(held?.personalFor).toEqual([back.entityId]);
    productionDoor(sim);

    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, back.entityId)).toBe(true);
    const backEntity = entityOf(sim, back);
    backEntity.pos = { ...boss.pos };
    backEntity.prevPos = { ...boss.pos };
    sim.rebucket(backEntity);
    sim.lootCorpse(boss.id, back.entityId);

    expect(sim.countItem(HELD_ITEM, back.entityId)).toBe(1);
  });
});

describe('rebindHeldAwardsOnJoin: held awards follow the character across a relog', () => {
  it('leaves a slot alone while its previous entity id is still a live session', () => {
    const sim = makeSim();
    const { ally, boss } = clearIgnivarArena(sim);
    boss.loot = {
      copper: 0,
      items: [{ itemId: HELD_ITEM, count: 1, personalFor: [ally.entityId] }],
    };
    boss.heldLootOwners = new Map([[ally.entityId, 4242]]);
    const twin = addMeta(sim, 'Twin', 4242);

    rebindHeldAwardsOnJoin(sim.ctx, twin.entityId);

    expect(boss.loot.items[0].personalFor).toEqual([ally.entityId]);
  });

  it('re-points only the slots of the joining character', () => {
    const sim = makeSim();
    const { boss } = clearIgnivarArena(sim);
    boss.loot = {
      copper: 0,
      items: [
        { itemId: HELD_ITEM, count: 1, personalFor: [9001] },
        { itemId: HELD_ITEM, count: 1, personalFor: [9002] },
      ],
    };
    boss.heldLootOwners = new Map([
      [9001, 4242],
      [9002, 5353],
    ]);
    const back = addMeta(sim, 'Back', 4242);

    expect(boss.loot.items.map((s) => s.personalFor)).toEqual([[back.entityId], [9002]]);
    expect([...boss.heldLootOwners]).toEqual([
      [9002, 5353],
      [back.entityId, 4242],
    ]);
  });
});

describe('raid return route: a cleared Nythraxis raider who left the raid', () => {
  function nythraxisRaid(sim: Sim) {
    const tank = sim.addPlayer('warrior', 'Tank');
    const raiders = [tank];
    sim.players.get(tank)!.questsDone.add(NYTHRAXIS_ATTUNEMENT);
    for (let i = 0; i < 4; i += 1) {
      const pid = sim.addPlayer('mage', `Dps${i}`);
      sim.players.get(pid)!.questsDone.add(NYTHRAXIS_ATTUNEMENT);
      sim.partyInvite(pid, tank);
      sim.partyAccept(pid);
      raiders.push(pid);
    }
    sim.convertPartyToRaid(tank);
    for (const pid of raiders) {
      expect(sim.enterDungeon('nythraxis_crypt', pid)).toBe(true);
      expect(sim.enterDungeon('nythraxis_boss_arena', pid)).toBe(true);
    }
    const raidKey = instanceKeyFor(sim.ctx, tank);
    const arena = liveClaim(sim, 'nythraxis_boss_arena', raidKey);
    const boss = bossIn(sim, arena, NYTHRAXIS_BOSS_ID);
    for (const pid of raiders) {
      const e = sim.entities.get(pid)!;
      e.pos = { x: boss.pos.x, y: e.pos.y, z: boss.pos.z - 4 };
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
    }
    sim.ctx.dealDamage(
      sim.entities.get(raiders[1])!,
      boss,
      boss.hp + 100,
      false,
      'physical',
      null,
      'hit',
    );
    expect(boss.dead).toBe(true);
    return { tank, raiders, raidKey, arena, boss };
  }

  it('a normal kill records its entrants as cleared participants of the arena run', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', noPlayer: true });
    const { raiders, arena } = nythraxisRaid(sim);
    for (const pid of raiders) {
      expect(sim.players.get(pid)!.raidLockouts.has('nythraxis_boss_arena')).toBe(true);
      expect(arena.clearedBy.has(pid), `cleared pid ${pid}`).toBe(true);
      expect(arena.raidReturnKeys.has(`entity:${pid}`), `return key pid ${pid}`).toBe(true);
    }
  });

  it('walks the crypt door straight back into the cleared arena run, solo', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', noPlayer: true });
    const { raiders, raidKey, arena } = nythraxisRaid(sim);
    const leaver = raiders[2];
    expect(sim.leaveDungeon(leaver)).toBe(true);
    expect(sim.entities.get(leaver)!.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    sim.partyLeave(leaver);
    const errors = captureErrors(sim);

    expect(sim.enterDungeon('nythraxis_crypt', leaver)).toBe(true);

    expect(errors).toEqual([]);
    expect(sim.instanceInfoAt(sim.entities.get(leaver)!.pos)).toEqual({
      slot: arena.slot,
      dungeonId: 'nythraxis_boss_arena',
    });
    expect(liveClaim(sim, 'nythraxis_boss_arena', raidKey)).toBe(arena);
  });

  it('is never held in the old arena by a Nythraxis fight in their new raid', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', noPlayer: true });
    const { raiders, raidKey, arena } = nythraxisRaid(sim);
    const leaver = raiders[2];
    expect(sim.leaveDungeon(leaver)).toBe(true);
    sim.partyLeave(leaver);
    expect(sim.enterDungeon('nythraxis_crypt', leaver)).toBe(true);
    expect(sim.instanceInfoAt(sim.entities.get(leaver)!.pos)?.slot).toBe(arena.slot);
    // Their new raid claims its own arena and engages Nythraxis there.
    const newKey = formRaid(sim, leaver, []);
    const recruit = sim.ctx.partyOf(leaver)!.members.find((m) => m !== leaver)!;
    sim.players.get(recruit)!.questsDone.add(NYTHRAXIS_ATTUNEMENT);
    expect(sim.enterDungeon('nythraxis_boss_arena', recruit)).toBe(true);
    const fresh = liveClaim(sim, 'nythraxis_boss_arena', newKey);
    expect(fresh).not.toBe(arena);
    // Engage the fresh boss on the recruit (the nythraxis_raid_unit idiom);
    // one tick starts the encounter, which seals that arena's royal door.
    const freshBoss = bossIn(sim, fresh, NYTHRAXIS_BOSS_ID);
    freshBoss.inCombat = true;
    freshBoss.aiState = 'attack';
    freshBoss.aggroTargetId = recruit;
    freshBoss.threat.set(recruit, 1000);
    sim.tick();
    expect(nythraxisInstanceSealed(sim.ctx, fresh)).toBe(true);
    expect(liveClaim(sim, 'nythraxis_boss_arena', raidKey)).toBe(arena);

    expect(sim.leaveDungeon(leaver)).toBe(true);

    expect(sim.entities.get(leaver)!.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('a returner in a five-player party runs the attunement crypt with that party', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', noPlayer: true });
    const { raiders, raidKey } = nythraxisRaid(sim);
    const leaver = raiders[2];
    expect(sim.leaveDungeon(leaver)).toBe(true);
    sim.partyLeave(leaver);
    for (let i = 0; i < 2; i += 1) {
      const pid = sim.addPlayer('mage', `Friend${i}`);
      sim.partyInvite(pid, leaver);
      sim.partyAccept(pid);
    }
    const partyKey = instanceKeyFor(sim.ctx, leaver);
    expect(sim.ctx.partyOf(leaver)?.raid).toBe(false);
    const oldCrypt = liveClaim(sim, 'nythraxis_crypt', raidKey);

    expect(sim.enterDungeon('nythraxis_crypt', leaver)).toBe(true);

    const own = liveClaim(sim, 'nythraxis_crypt', partyKey);
    expect(own).not.toBe(oldCrypt);
    expect(sim.instanceInfoAt(sim.entities.get(leaver)!.pos)).toEqual({
      slot: own.slot,
      dungeonId: 'nythraxis_crypt',
    });
  });
});

describe('raidReturnClaimFor: which cleared run a returner is routed to', () => {
  it('names the raid families and nothing else', () => {
    expect(raidFamilyOf(IGNIVAR_RAID_ARENA_ID)).toEqual(IGNIVAR_RAID_ROOM_IDS);
    expect(raidFamilyOf(IGNIVAR_LIFT_ROOM_ID)).toEqual(IGNIVAR_RAID_ROOM_IDS);
    expect(raidFamilyOf('nythraxis_crypt')).toEqual(['nythraxis_crypt', 'nythraxis_boss_arena']);
    expect(raidFamilyOf('nythraxis_boss_arena')).toEqual([
      'nythraxis_crypt',
      'nythraxis_boss_arena',
    ]);
    expect(raidFamilyOf('hollow_crypt')).toBeNull();
  });

  it('prefers the most recently claimed run when two cleared runs name the player', () => {
    const sim = makeSim();
    const { ally, arena } = clearIgnivarArena(sim);
    const older: InstanceSlot = {
      ...arena,
      partyKey: 'party:older-run',
      slot: arena.slot + 1,
      claimedAt: (arena.claimedAt ?? 0) - 100,
    };
    sim.instances.push(older);
    const soloKey = 'solo:test';

    expect(raidReturnClaimFor(sim.ctx, ally.entityId, IGNIVAR_LIFT_ROOM_ID, soloKey)).toBe(arena);
    older.claimedAt = (arena.claimedAt ?? 0) + 100;
    expect(raidReturnClaimFor(sim.ctx, ally.entityId, IGNIVAR_LIFT_ROOM_ID, soloKey)).toBe(older);
    // The entrant's own key is never a return target: that is the ordinary door.
    expect(raidReturnClaimFor(sim.ctx, ally.entityId, IGNIVAR_LIFT_ROOM_ID, older.partyKey!)).toBe(
      arena,
    );
    expect(raidReturnClaimFor(sim.ctx, ally.entityId, 'hollow_crypt', soloKey)).toBeNull();
  });
});
