import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { DUNGEONS } from '../src/sim/data';
import {
  expeditionActivity,
  expeditionProgress,
  recordExpeditionEncounterDeath,
} from '../src/sim/instances/dungeon_expeditions';
import {
  enterDungeon,
  freeInstance,
  heroicLockoutId,
  instanceKeyFor,
  instanceOriginOf,
} from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

const context = (sim: Sim) => (sim as unknown as { ctx: SimContext }).ctx;

import {
  FINDER_EXPEDITION_APPLICATION_CAP,
  FINDER_EXPEDITION_APPLICATION_SECONDS,
} from '../src/sim/social/dungeon_finder';
import { EMPTY_TEST_WORLD } from './sim_shared';

function addPlayer(sim: Sim, name: string) {
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(8, pid);
  sim.setSpec(TALENTS.warrior.specs.find((spec) => spec.role === 'dps')!.id, pid);
  sim.dungeonFinderSetRoles(['dps'], pid);
  return pid;
}

function setup(heroic = false) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const leader = addPlayer(sim, 'Leader');
  const helper = addPlayer(sim, 'Helper');
  if (heroic) sim.setDungeonDifficulty('heroic', leader);
  expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
  const claim = sim.instances.find(
    (entry) => entry.partyKey === instanceKeyFor(context(sim), leader),
  )!;
  if (heroic) {
    // Heroic finder bands use post-cap characters, with the same physical door.
    sim.setPlayerLevel(20, leader);
    sim.setPlayerLevel(20, helper);
  }
  sim.dungeonFinderExpeditionOpen(leader);
  const listing = sim.dungeonFinderBoardView()[0];
  expect(listing).toBeDefined();
  return { sim, leader, helper, claim, listing };
}

function acceptHelper(ctx: ReturnType<typeof setup>) {
  ctx.sim.dungeonFinderExpeditionApply(ctx.listing.id, 'dps', ctx.helper);
  expect(ctx.sim.dungeonFinderInfoFor(ctx.helper)?.myApplication?.listingId).toBe(ctx.listing.id);
  ctx.sim.dungeonFinderApplicationRespond(ctx.helper, true, ctx.leader);
  expect(ctx.sim.partyOf(ctx.helper)?.leader).toBe(ctx.leader);
}

describe('open dungeon expeditions through the real Sim', () => {
  it('starts private, can publish later, and closing recruitment keeps the live run', () => {
    const { sim, leader, claim } = setup();
    sim.dungeonFinderListingClose(leader);
    const privateRun = sim.dungeonFinderInfoFor(leader)?.expedition;
    expect(privateRun).toMatchObject({
      exitId: claim.exitId,
      isLeader: true,
      isInside: true,
      open: false,
    });
    const mobs = [...claim.mobIds];
    sim.dungeonFinderExpeditionOpen(leader);
    expect(sim.dungeonFinderInfoFor(leader)?.expedition?.open).toBe(true);
    expect(claim.mobIds).toEqual(mobs);
  });

  it('promotes a solo live claim on the first accepted helper without respawning or teleporting', () => {
    const ctx = setup();
    const { sim, leader, helper, claim } = ctx;
    const original = {
      exit: claim.exitId,
      mobs: [...claim.mobIds],
      difficulty: claim.difficulty,
      claimedAt: claim.claimedAt,
      cleared: claim.clearedBy,
      entered: claim.enteredBy,
    };
    const leaderPos = { ...sim.entities.get(leader)!.pos };
    const helperPos = { ...sim.entities.get(helper)!.pos };
    acceptHelper(ctx);
    expect(claim.partyKey).toBe(`party:${sim.partyOf(leader)!.id}`);
    expect(claim.exitId).toBe(original.exit);
    expect(claim.mobIds).toEqual(original.mobs);
    expect(claim.difficulty).toBe(original.difficulty);
    expect(claim.claimedAt).toBe(original.claimedAt);
    expect(claim.clearedBy).toBe(original.cleared);
    expect(claim.enteredBy).toBe(original.entered);
    expect(sim.entities.get(leader)!.pos).toEqual(leaderPos);
    expect(sim.entities.get(helper)!.pos).toEqual(helperPos);
    expect(sim.dungeonFinderInfoFor(helper)?.expedition).toMatchObject({
      exitId: original.exit,
      isLeader: false,
      isInside: false,
      canTravel: true,
    });
  });

  it('keeps composition informational and freezes an explicit compatible applicant role', () => {
    const ctx = setup();
    const { sim, helper, leader, listing } = ctx;
    sim.dungeonFinderSetRoles([], helper);
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants[0].roles).toEqual(['dps']);
    expect(sim.dungeonFinderInfoFor(helper)?.roles).toEqual([]);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(helper)?.members).toEqual([leader, helper]);
    expect(sim.dungeonFinderBoardView()[0].needed).toBeNull();
  });

  it('travels only after acceptance into the same claim at its authored entrance', () => {
    const ctx = setup();
    const { sim, leader, helper, claim } = ctx;
    const before = { ...sim.entities.get(helper)!.pos };
    sim.dungeonFinderExpeditionTravel(helper);
    expect(sim.entities.get(helper)!.pos).toEqual(before);
    acceptHelper(ctx);
    const origin = instanceOriginOf(claim);
    sim.dungeonFinderExpeditionTravel(helper);
    expect(sim.entities.get(helper)!.pos).toEqual(
      sim.groundPos(
        origin.x + DUNGEONS.hollow_crypt.entry.x,
        origin.z + DUNGEONS.hollow_crypt.entry.z,
      ),
    );
    expect(sim.instanceClaimIdAt(sim.entities.get(helper)!.pos)).toBe(claim.exitId);
    expect(claim.enteredBy.has(helper)).toBe(true);
    expect(sim.dungeonFinderInfoFor(helper)?.expedition?.isInside).toBe(true);
    expect(sim.instanceClaimIdAt(sim.entities.get(leader)!.pos)).toBe(claim.exitId);
  });

  it.each(['applicant combat', 'target mob combat', 'target hate table', 'leader combat'])(
    'refuses travel atomically during %s',
    (state) => {
      const ctx = setup();
      acceptHelper(ctx);
      const { sim, leader, helper, claim } = ctx;
      if (state === 'applicant combat') sim.entities.get(helper)!.inCombat = true;
      if (state === 'leader combat') sim.entities.get(leader)!.inCombat = true;
      const mob = sim.entities.get(claim.mobIds[0])!;
      if (state === 'target mob combat') mob.inCombat = true;
      if (state === 'target hate table') mob.threat.set(leader, 1);
      const before = sim.serializeCharacter(helper);
      const position = { ...sim.entities.get(helper)!.pos };
      const entered = [...claim.enteredBy];
      const exit = claim.exitId;
      expect(sim.dungeonFinderInfoFor(helper)?.expedition?.canTravel).toBe(false);
      sim.dungeonFinderExpeditionTravel(helper);
      expect(sim.serializeCharacter(helper)).toEqual(before);
      expect(sim.entities.get(helper)!.pos).toEqual(position);
      expect([...claim.enteredBy]).toEqual(entered);
      expect(claim.exitId).toBe(exit);
    },
  );

  it.each(['dead', 'ghost', 'casting', 'channeling', 'vehicle', 'disconnecting'])(
    'revalidates %s applicants before accepting',
    (state) => {
      const { sim, leader, helper, listing, claim } = setup();
      sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
      const player = sim.entities.get(helper)!;
      if (state === 'dead') player.dead = true;
      if (state === 'ghost') player.ghost = true;
      if (state === 'casting') player.castingAbility = 'fireball';
      if (state === 'channeling') player.channeling = true;
      if (state === 'vehicle') sim.players.get(helper)!.vehicle = {} as never;
      if (state === 'disconnecting') sim.players.get(helper)!.leaving = true;
      const key = claim.partyKey;
      sim.dungeonFinderApplicationRespond(helper, true, leader);
      expect(sim.partyOf(helper)).toBeNull();
      expect(sim.partyOf(leader)).toBeNull();
      expect(claim.partyKey).toBe(key);
    },
  );

  it('rejects incompatible role and level changes before formation', () => {
    const ctx = setup();
    const { sim, leader, helper, listing } = ctx;
    sim.dungeonFinderExpeditionApply(listing.id, 'healer', helper);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.setPlayerLevel(1, helper);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(helper)).toBeNull();
  });

  it('rejects an incompatible heroic lockout both when applying and after acceptance', () => {
    const ctx = setup(true);
    const { sim, leader, helper, listing, claim } = ctx;
    const key = heroicLockoutId(claim.dungeonId);
    sim.players.get(helper)!.raidLockouts.set(key, 999999999);
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
    sim.players.get(helper)!.raidLockouts.delete(key);
    acceptHelper(ctx);
    sim.players.get(helper)!.raidLockouts.set(key, 999999999);
    const position = { ...sim.entities.get(helper)!.pos };
    sim.dungeonFinderExpeditionTravel(helper);
    expect(sim.entities.get(helper)!.pos).toEqual(position);
    expect(claim.enteredBy.has(helper)).toBe(false);
    expect(sim.partyOf(helper)?.leader).toBe(leader);
  });

  it('retains real boss deaths after corpses disappear and closes a completed expedition', () => {
    const { sim, leader, claim } = setup();
    const boss = claim.mobIds
      .map((id) => sim.entities.get(id)!)
      .find((mob) => mob.templateId === 'sexton_marrow')!;
    sim.dealDamage(
      sim.entities.get(leader)!,
      boss,
      boss.hp + 100000,
      false,
      'physical',
      null,
      'hit',
    );
    context(sim).dropEntity(boss.id);
    expect(sim.dungeonFinderInfoFor(leader)?.expedition).toMatchObject({
      bossesDefeated: 1,
      bossesTotal: 2,
    });
    const final = claim.mobIds
      .map((id) => sim.entities.get(id))
      .find((mob) => mob?.templateId === 'morthen')!;
    sim.dealDamage(
      sim.entities.get(leader)!,
      final,
      final.hp + 100000,
      false,
      'physical',
      null,
      'hit',
    );
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.dungeonFinderBoardView()).toEqual([]);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing).toBeNull();
    expect(sim.dungeonFinderInfoFor(leader)?.expedition).toBeNull();
  });

  it('bounds pending applications, deduplicates retries, and expires unanswered requests', () => {
    const { sim, leader, helper, listing } = setup();
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toHaveLength(1);
    expect(FINDER_EXPEDITION_APPLICATION_CAP).toBe(20);
    for (let i = 0; i < 20; i++) {
      const applicant = addPlayer(sim, `Applicant${i}`);
      sim.dungeonFinderExpeditionApply(listing.id, 'dps', applicant);
    }
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toHaveLength(20);
    sim.time += FINDER_EXPEDITION_APPLICATION_SECONDS;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toHaveLength(0);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
  });

  it('rate limits reapplications after decline without changing the sticky role selection', () => {
    const { sim, leader, helper, listing } = setup();
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.dungeonFinderApplicationRespond(helper, false, leader);
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
    sim.time += 11;
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication?.listingId).toBe(listing.id);
  });

  it('closes recruitment when full and refuses the remaining applicant', () => {
    const ctx = setup();
    const { sim, leader, claim, listing } = ctx;
    const applicants = [
      ctx.helper,
      ...Array.from({ length: 4 }, (_, i) => addPlayer(sim, `Dps${i}`)),
    ];
    for (const pid of applicants) sim.dungeonFinderExpeditionApply(listing.id, 'dps', pid);
    for (const pid of applicants.slice(0, 4))
      sim.dungeonFinderApplicationRespond(pid, true, leader);
    expect(sim.partyOf(leader)?.members).toHaveLength(5);
    expect(sim.dungeonFinderBoardView()).toEqual([]);
    sim.dungeonFinderApplicationRespond(applicants[4], true, leader);
    expect(sim.partyOf(applicants[4])).toBeNull();
    expect(sim.dungeonFinderInfoFor(applicants[4])?.myApplication).toBeNull();
    expect(claim.partyKey).toBe(instanceKeyFor(context(sim), leader));
  });

  it('invalidates recruitment and helper travel when leadership changes', () => {
    const ctx = setup();
    acceptHelper(ctx);
    const { sim, leader, helper } = ctx;
    sim.partyPromote(helper, leader);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.dungeonFinderBoardView()).toEqual([]);
    expect(sim.dungeonFinderInfoFor(helper)?.expedition).toBeNull();
  });

  it('rejects first-helper promotion before mutation if the future party key already owns a competing claim', () => {
    const { sim, leader, helper, listing, claim } = setup();
    const collision = sim.instances.find(
      (entry) => entry !== claim && entry.dungeonId === claim.dungeonId,
    )!;
    collision.partyKey = 'party:1';
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    const key = claim.partyKey;
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(leader)).toBeNull();
    expect(sim.partyOf(helper)).toBeNull();
    expect(claim.partyKey).toBe(key);
    expect(collision.partyKey).toBe('party:1');
  });

  it('accepts an applicant inside another dungeon without using travel to pull them out of that activity', () => {
    const ctx = setup();
    const { sim, helper } = ctx;
    expect(sim.enterDungeon('sunken_bastion', helper)).toBe(true);
    const otherClaim = sim.instanceClaimIdAt(sim.entities.get(helper)!.pos);
    acceptHelper(ctx);
    const position = { ...sim.entities.get(helper)!.pos };
    sim.dungeonFinderExpeditionTravel(helper);
    expect(sim.entities.get(helper)!.pos).toEqual(position);
    expect(sim.instanceClaimIdAt(position)).toBe(otherClaim);
  });

  it('does not redirect an approved helper into a recycled claim belonging to another group', () => {
    const ctx = setup();
    acceptHelper(ctx);
    const { sim, helper, claim } = ctx;
    const oldExit = claim.exitId;
    freeInstance(context(sim), claim);
    const stranger = addPlayer(sim, 'Stranger');
    expect(sim.enterDungeon('hollow_crypt', stranger)).toBe(true);
    expect(claim.exitId).not.toBe(oldExit);
    const position = { ...sim.entities.get(helper)!.pos };
    sim.dungeonFinderExpeditionTravel(helper);
    expect(sim.entities.get(helper)!.pos).toEqual(position);
    expect(sim.dungeonFinderInfoFor(helper)?.expedition).toBeNull();
    expect(claim.partyKey).toBe(instanceKeyFor(context(sim), stranger));
  });

  it('removes a disconnected applicant and closes a disconnected leader publication', () => {
    const { sim, leader, helper, listing } = setup();
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.removePlayer(helper);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toEqual([]);
    const replacement = addPlayer(sim, 'Replacement');
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', replacement);
    sim.removePlayer(leader);
    expect(sim.dungeonFinderBoardView()).toEqual([]);
    expect(sim.dungeonFinderInfoFor(replacement)?.myApplication).toBeNull();
  });
});

function setupRaidFamily() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  const leader = addPlayer(sim, 'RaidLeader');
  const helper = addPlayer(sim, 'RaidHelper');
  sim.setPlayerLevel(20, leader);
  sim.setPlayerLevel(20, helper);
  // Dev entry is used only to build a solo live multi-room fixture; every
  // publication/application/acceptance below runs the actual finder machine.
  expect(enterDungeon(context(sim), 'ignivar_raid_arena', leader, true)).toBe(true);
  const arena = sim.instances.find(
    (claim) =>
      claim.dungeonId === 'ignivar_raid_arena' &&
      claim.partyKey === instanceKeyFor(context(sim), leader),
  )!;
  expect(enterDungeon(context(sim), 'ignivar_inner_crucible', leader, true)).toBe(true);
  const inner = sim.instances.find(
    (claim) =>
      claim.dungeonId === 'ignivar_inner_crucible' &&
      claim.partyKey === instanceKeyFor(context(sim), leader),
  )!;
  sim.dungeonFinderExpeditionOpen(leader);
  const listing = sim.dungeonFinderBoardView()[0];
  expect(listing?.activityId).toBe('ignivar_raid_arena_normal');
  return { sim, leader, helper, arena, inner, listing };
}

describe('open multi-room raid expeditions', () => {
  it('combines actual encounter deaths across owned rooms and preserves both claims on first-helper promotion', () => {
    const { sim, leader, helper, arena, inner, listing } = setupRaidFamily();
    const boss = arena.mobIds
      .map((id) => sim.entities.get(id))
      .find((mob) => mob?.templateId === 'ignivar_herald_of_the_last_flame')!;
    recordExpeditionEncounterDeath(arena, boss);
    const activity = expeditionActivity(inner)!;
    expect(expeditionProgress(context(sim), inner, activity)).toEqual({
      bossesDefeated: 1,
      bossesTotal: 2,
    });
    const claims = [arena, inner].map((claim) => ({
      claim,
      exitId: claim.exitId,
      mobIds: [...claim.mobIds],
      resetAvailableAt: claim.resetAvailableAt,
      defeated: claim.defeatedEncounterIds,
    }));
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(helper)?.leader).toBe(leader);
    for (const saved of claims) {
      expect(saved.claim.partyKey).toBe(`party:${sim.partyOf(leader)!.id}`);
      expect(saved.claim.exitId).toBe(saved.exitId);
      expect(saved.claim.mobIds).toEqual(saved.mobIds);
      expect(saved.claim.resetAvailableAt).toBe(saved.resetAvailableAt);
      expect(saved.claim.defeatedEncounterIds).toBe(saved.defeated);
    }
    const final = inner.mobIds
      .map((id) => sim.entities.get(id))
      .find((mob) => mob?.templateId === 'varkhul_forgefather_of_the_last_flame')!;
    recordExpeditionEncounterDeath(inner, final);
    expect(sim.dungeonFinderInfoFor(leader)?.expedition).toBeNull();
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.dungeonFinderBoardView()).toEqual([]);
  });

  it('rejects a collision in another family room before promoting any claim or forming a party', () => {
    const { sim, leader, helper, arena, inner, listing } = setupRaidFamily();
    const collision = sim.instances.find(
      (claim) => claim !== arena && claim.dungeonId === arena.dungeonId,
    )!;
    collision.partyKey = 'party:1';
    const owner = arena.partyKey;
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(leader)).toBeNull();
    expect(sim.partyOf(helper)).toBeNull();
    expect(arena.partyKey).toBe(owner);
    expect(inner.partyKey).toBe(owner);
  });
});
