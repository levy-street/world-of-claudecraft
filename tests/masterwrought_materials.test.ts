// Masterwrought phase 04: the three shared chase materials, their faucets,
// gates, and persistence (src/sim/professions/masterwrought_materials.ts and
// src/sim/professions/sundering.ts). The heroic-clear rig mirrors
// tests/dungeons.test.ts, the rift-event rig mirrors tests/rift_race.test.ts,
// and the extraction pin cases mirror
// tests/professions_enchant_family_cast.test.ts, each suite-local per the
// tests/CLAUDE.md convention.

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, ITEMS, MOBS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  awardRiftFirstClearMaterials,
  EMBER_ACCRUAL_GRANT_CAP,
  EMBER_ELIGIBLE_RIFT_TIERS,
  emberWeekAnchorOf,
  emberWeeksBetween,
  FINAL_BOSS_TEMPLATE_IDS,
  grantRiftClearEmbers,
  MAKERS_EMBER_ITEM_ID,
  SUNDERED_ESSENCE_ITEM_ID,
  tryGrantMakersEmber,
  WYRMFALL_BOSS_MAX,
  WYRMFALL_BOSS_MIN,
  WYRMFALL_CORE_ITEM_ID,
  WYRMFALL_RIFT_COUNT,
} from '../src/sim/professions/masterwrought_materials';
import { isSunderable, SUNDERED_ESSENCE_YIELD } from '../src/sim/professions/sundering';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { descendRift, updateRiftInstances } from '../src/sim/rift/runs';
import type { PlayerMeta, Sim as SimType } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { completeEnchantFamilyCast, runSunder } from './helpers/enchant_family_cast';

type AnySim = SimType & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// A raid epic (Nythraxis loot, itemFromRaid true) and the refusal control: a
// heroic FIVE-MAN epic, which is epic quality but not raid-sourced.
const RAID_EPIC = 'crownforged_dreadhelm';
const FIVEMAN_EPIC = 'morthens_cryptforged_hauberk';

// Known weekday facts for the pure week math: 2026-08-11 is a Tuesday.
const TUESDAY = '2026-08-11';
const NEXT_TUESDAY = '2026-08-18';

const DUNGEON_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeDungeonSim(seed = 99): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: DUNGEON_TEST_WORLD,
  }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedDungeon(sim: AnySim, dungeonId: string, difficulty = 'normal'): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.difficulty === difficulty && i.partyKey !== null,
  );
}

function mobInInstance(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const mob = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!mob) throw new Error(`missing ${templateId} in ${inst.dungeonId}`);
  return mob as AnyEntity;
}

// Two-player heroic hollow_crypt party standing at Morthen, ready to kill.
function heroicMorthenRig(seed = 9): {
  sim: AnySim;
  leader: number;
  member: number;
  inst: any;
  boss: AnyEntity;
} {
  const sim = makeDungeonSim(seed);
  const leader = sim.addPlayer('warrior', 'Lead');
  const member = sim.addPlayer('mage', 'Mate');
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
  sim.setDungeonDifficulty('heroic', leader);
  enterDungeon(sim.ctx, 'hollow_crypt', leader);
  enterDungeon(sim.ctx, 'hollow_crypt', member);
  const inst = claimedDungeon(sim, 'hollow_crypt', 'heroic');
  const boss = mobInInstance(sim, inst, 'morthen');
  const le = sim.entities.get(leader) as AnyEntity;
  const me = sim.entities.get(member) as AnyEntity;
  teleport(sim, le, boss.pos.x + 1, boss.pos.z);
  teleport(sim, me, boss.pos.x - 1, boss.pos.z);
  return { sim, leader, member, inst, boss };
}

function killBoss(sim: AnySim, killerPid: number, boss: AnyEntity): void {
  const killer = sim.entities.get(killerPid) as AnyEntity;
  (sim as any).dealDamage(killer, boss, boss.hp + 10, false, 'physical', null, 'hit');
}

// Count every rng draw across a call: positive-controlled below so a neutered
// observer can never silently pass (the phase 02 QA idiom).
function countDraws(sim: AnySim, run: () => void): number {
  const rng = sim.ctx.rng as { next: () => number };
  const original = rng.next.bind(rng);
  let draws = 0;
  rng.next = () => {
    draws++;
    return original();
  };
  try {
    run();
  } finally {
    rng.next = original;
  }
  return draws;
}

describe('ember week math (pure)', () => {
  it('anchors a reset day to the most recent Tuesday, identity on Tuesday itself', () => {
    expect(emberWeekAnchorOf(TUESDAY)).toBe(TUESDAY);
    expect(emberWeekAnchorOf('2026-08-12')).toBe(TUESDAY); // Wednesday
    expect(emberWeekAnchorOf('2026-08-17')).toBe(TUESDAY); // the following Monday
    expect(emberWeekAnchorOf(NEXT_TUESDAY)).toBe(NEXT_TUESDAY);
  });

  it('wraps month and year edges with pure civil math', () => {
    // 2026-01-01 is a Thursday; the most recent Tuesday is 2025-12-30.
    expect(emberWeekAnchorOf('2026-01-01')).toBe('2025-12-30');
    // 2026-03-02 is a Monday; the most recent Tuesday is 2026-02-24.
    expect(emberWeekAnchorOf('2026-03-02')).toBe('2026-02-24');
  });

  it("no calendar means no weekly boundary ('' in, '' out; junk in, '' out)", () => {
    expect(emberWeekAnchorOf('')).toBe('');
    expect(emberWeekAnchorOf('not-a-date')).toBe('');
  });

  it('normalization is single-pass: every rendered anchor re-parses or is empty', () => {
    // A well-formed but ancient year: without the year pad the render is
    // '2-12-31', which the anchor parser REJECTS, so the very act of
    // normalizing would mint a value that stalls the weekly grant for a
    // session. Padded, it round-trips and is idempotent.
    expect(emberWeekAnchorOf('0003-01-01')).toBe('0002-12-31');
    expect(emberWeekAnchorOf(emberWeekAnchorOf('0003-01-01'))).toBe('0002-12-31');
    // Out-of-calendar arithmetic that overflows four year digits cannot
    // round-trip the anchor shape at all: it degrades to '' in ONE pass
    // (no anchor, the first-grant arm recovers) instead of storing an
    // unparseable five-digit date for a session.
    expect(emberWeekAnchorOf('9999-99-99')).toBe('');
    expect(emberWeekAnchorOf('0000-00-00')).toBe('');
  });

  it('counts whole weeks between anchors, signed', () => {
    expect(emberWeeksBetween(TUESDAY, NEXT_TUESDAY)).toBe(1);
    expect(emberWeeksBetween(NEXT_TUESDAY, TUESDAY)).toBe(-1);
    expect(emberWeeksBetween(TUESDAY, TUESDAY)).toBe(0);
    expect(emberWeeksBetween(TUESDAY, '2026-09-08')).toBe(4);
    expect(emberWeeksBetween('', TUESDAY)).toBe(0);
  });
});

describe('wyrmfall cores: the boss faucet', () => {
  it('a heroic final-boss kill pays every present participant the same rolled count', () => {
    const { sim, leader, member, boss } = heroicMorthenRig();
    killBoss(sim, leader, boss);
    const leaderCores = sim.countItem(WYRMFALL_CORE_ITEM_ID, leader);
    const memberCores = sim.countItem(WYRMFALL_CORE_ITEM_ID, member);
    expect(leaderCores).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
    expect(leaderCores).toBeLessThanOrEqual(WYRMFALL_BOSS_MAX);
    expect(memberCores).toBe(leaderCores);
    // Tradable by ruling R2's catalyst design: the def carries no binding.
    expect(ITEMS[WYRMFALL_CORE_ITEM_ID].soulbound).toBeUndefined();
    expect(ITEMS[WYRMFALL_CORE_ITEM_ID].noMarketList).toBeUndefined();
  });

  it('the same seed rolls the same count twice (rng, not wall clock)', () => {
    const counts: number[] = [];
    for (let run = 0; run < 2; run++) {
      const { sim, leader, boss } = heroicMorthenRig(31);
      killBoss(sim, leader, boss);
      counts.push(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader));
    }
    expect(counts[0]).toBe(counts[1]);
  });

  it('the daily gate closes the source after one payout and reopens on the reset-day flip', () => {
    const { sim, leader, member, boss } = heroicMorthenRig();
    (sim as any).resetDay = '2026-08-12';
    killBoss(sim, leader, boss);
    const first = sim.countItem(WYRMFALL_CORE_ITEM_ID, leader);
    expect(first).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
    // Direct re-award on the same corpse the same day: the per-source stamp
    // refuses a second payout even though the lockout is not consulted.
    const leaderMeta = sim.players.get(leader)! as PlayerMeta;
    const memberMeta = sim.players.get(member)! as PlayerMeta;
    sim.ctx.awardWyrmfallCores(boss, [leaderMeta, memberMeta]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBe(first);
    expect(leaderMeta.wyrmfallDaily.sources.has('hollow_crypt:heroic')).toBe(true);
    // The realm's day rolls over: the same source pays again.
    (sim as any).resetDay = '2026-08-13';
    sim.ctx.awardWyrmfallCores(boss, [leaderMeta, memberMeta]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBeGreaterThan(first);
    expect(leaderMeta.wyrmfallDaily.date).toBe('2026-08-13');
  });

  it('a normal five-man final boss pays nothing and draws nothing', () => {
    const sim = makeDungeonSim(7);
    const leader = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'hollow_crypt', leader);
    const inst = claimedDungeon(sim, 'hollow_crypt', 'normal');
    const boss = mobInInstance(sim, inst, 'morthen');
    teleport(sim, sim.entities.get(leader) as AnyEntity, boss.pos.x + 1, boss.pos.z);
    const meta = sim.players.get(leader)! as PlayerMeta;
    const draws = countDraws(sim, () => sim.ctx.awardWyrmfallCores(boss, [meta]));
    expect(draws).toBe(0);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBe(0);
  });

  it('an uncredited kill pays nobody and draws nothing; a credited one draws exactly once', () => {
    const { sim, leader, member, boss } = heroicMorthenRig();
    const leaderMeta = sim.players.get(leader)! as PlayerMeta;
    const memberMeta = sim.players.get(member)! as PlayerMeta;
    expect(countDraws(sim, () => sim.ctx.awardWyrmfallCores(boss, []))).toBe(0);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBe(0);
    // Positive control: the credited call draws exactly the one count roll,
    // proving the observer counts and the refusal arms above are honestly dry.
    expect(countDraws(sim, () => sim.ctx.awardWyrmfallCores(boss, [leaderMeta, memberMeta]))).toBe(
      1,
    );
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
  });

  it('a door-camper on the claim who never entered is paid nothing, mailed nothing', () => {
    const { sim, leader, boss } = heroicMorthenRig();
    // Joins the party (so the claim holds them) AFTER the instance exists,
    // but never walks through the door: not present, not in enteredBy.
    const camper = sim.addPlayer('rogue', 'Camper');
    sim.partyInvite(camper, leader);
    sim.partyAccept(camper);
    const leaderMeta = sim.players.get(leader)! as PlayerMeta;
    const camperMeta = sim.players.get(camper)! as PlayerMeta;
    sim.ctx.awardWyrmfallCores(boss, [leaderMeta]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, camper)).toBe(0);
    const camperName = sim.players.get(camper)!.name;
    // Filter by letterId: every fresh character also holds the Ravenpost
    // welcome letter, which is not this faucet's mail.
    const letters = ((sim.postOffice as any).mail as any[]).filter(
      (m) => m.recipientName === camperName && m.letterId === 'wyrmfall_core_reward',
    );
    expect(letters).toHaveLength(0);
    // Their daily gate is untouched: roster membership alone is not income,
    // and it must not burn the day's source either.
    expect(camperMeta.wyrmfallDaily.sources.size).toBe(0);
  });

  it('a kill with no hosting instance draws nothing (the world-boss shape)', () => {
    const sim = makeDungeonSim(11);
    const pid = sim.addPlayer('warrior', 'Wanderer');
    const meta = sim.players.get(pid)! as PlayerMeta;
    // A final-boss TEMPLATE outside any instance slot (the world-boss
    // coupling the death-hub comment names): passes the template precheck,
    // then exits on the instance scan, before the count draw.
    const strayBoss = { id: 999999, templateId: 'nythraxis_scourge_of_thornpeak' } as AnyEntity;
    const draws = countDraws(sim, () => sim.ctx.awardWyrmfallCores(strayBoss, [meta]));
    expect(draws).toBe(0);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, pid)).toBe(0);
  });

  it('no world-boss template is a faucet template (the death-hub placement invariant)', () => {
    // The moved death-hub call sits below rollWorldBossLoot with the comment
    // "no kill reaches both a wyrmfall draw and a world-boss roll". That
    // rests on this disjointness; a worldBoss template entering the faucet
    // set would put a draw above every contributor's personal loot roll.
    const worldBossIds = Object.values(MOBS)
      .filter((t: any) => t.worldBoss)
      .map((t: any) => t.id);
    expect(worldBossIds.length).toBeGreaterThan(0);
    for (const id of worldBossIds) {
      expect(FINAL_BOSS_TEMPLATE_IDS.has(id), id).toBe(false);
    }
    // Positive controls: the set genuinely carries both faucet arms.
    expect(FINAL_BOSS_TEMPLATE_IDS.has('morthen')).toBe(true);
    expect(FINAL_BOSS_TEMPLATE_IDS.has('nythraxis_scourge_of_thornpeak')).toBe(true);
  });

  it('a participant absent from the corpse but on the claim is paid by raven, not bags', () => {
    const { sim, leader, member, boss } = heroicMorthenRig();
    const leaderMeta = sim.players.get(leader)! as PlayerMeta;
    // The member stays in the party (the claim holds them) but is not in the
    // death-time participation snapshot: the mail arm owes them their share.
    sim.ctx.awardWyrmfallCores(boss, [leaderMeta]);
    const granted = sim.countItem(WYRMFALL_CORE_ITEM_ID, leader);
    expect(granted).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, member)).toBe(0);
    const memberName = sim.players.get(member)!.name;
    const letters = ((sim.postOffice as any).mail as any[]).filter(
      (m) => m.recipientName === memberName && m.letterId === 'wyrmfall_core_reward',
    );
    expect(letters).toHaveLength(1);
    expect(letters[0].items).toEqual([{ itemId: WYRMFALL_CORE_ITEM_ID, count: granted }]);
    expect(letters[0].kind).toBe('system');
    // System parcels with attachments never expire (the marks contract).
    expect(letters[0].expiresAt).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('wyrmfall cores: the two raid arms', () => {
  // Compact attuned-raid harness (the tests/dungeons.test.ts shape): five
  // raiders, all attuned, the tank claims the arena, everyone walks in.
  function raidRig(difficulty: 'normal' | 'heroic') {
    const sim = makeDungeonSim(77);
    const tank = sim.addPlayer('warrior', 'Tank');
    sim.players.get(tank)!.questsDone.add('q_nythraxis_bound_guardian');
    const raiders: number[] = [tank];
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('mage', `Dps${i}`);
      sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
      sim.partyInvite(pid, tank);
      sim.partyAccept(pid);
      raiders.push(pid);
    }
    sim.convertPartyToRaid(tank);
    if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', tank);
    for (const pid of raiders) {
      enterDungeon(sim.ctx, 'nythraxis_crypt', pid);
      enterDungeon(sim.ctx, 'nythraxis_boss_arena', pid);
    }
    const inst = claimedDungeon(sim, 'nythraxis_boss_arena', difficulty);
    expect(inst).toBeTruthy();
    const boss = mobInInstance(sim, inst, 'nythraxis_scourge_of_thornpeak');
    return { sim, raiders, boss };
  }

  it('the NORMAL raid pays cores even though it pays no marks', () => {
    const { sim, raiders, boss } = raidRig('normal');
    const metas = raiders.map((pid) => sim.players.get(pid)! as PlayerMeta);
    const draws = countDraws(sim, () => sim.ctx.awardWyrmfallCores(boss, metas));
    expect(draws).toBe(1);
    const first = sim.countItem(WYRMFALL_CORE_ITEM_ID, raiders[0]);
    expect(first).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
    for (const pid of raiders) expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, pid)).toBe(first);
    expect(metas[0].wyrmfallDaily.sources.has('nythraxis_boss_arena:normal')).toBe(true);
  });

  it('the HEROIC raid pays cores through the heroic tuning row', () => {
    const { sim, raiders, boss } = raidRig('heroic');
    const metas = raiders.map((pid) => sim.players.get(pid)! as PlayerMeta);
    expect(countDraws(sim, () => sim.ctx.awardWyrmfallCores(boss, metas))).toBe(1);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, raiders[0])).toBeGreaterThanOrEqual(
      WYRMFALL_BOSS_MIN,
    );
    expect(metas[0].wyrmfallDaily.sources.has('nythraxis_boss_arena:heroic')).toBe(true);
  });

  it('normal then heroic the same day: two sources, two payouts on one character', () => {
    // The raid's difficulty-scoped source keys are the DELIBERATE double
    // faucet (the ledger mirrors the difficulty-scoped lockout): a character
    // who clears both difficulties in one reset day is paid once per source.
    // A refactor that collapses the key to the dungeonId alone fails here.
    const { sim, raiders, boss } = raidRig('normal');
    const metas = raiders.map((pid) => sim.players.get(pid)! as PlayerMeta);
    sim.ctx.awardWyrmfallCores(boss, metas);
    const afterNormal = sim.countItem(WYRMFALL_CORE_ITEM_ID, raiders[0]);
    expect(afterNormal).toBeGreaterThanOrEqual(WYRMFALL_BOSS_MIN);
    const tank = raiders[0];
    // Retire the normal claim (an existing claim always wins re-entry): the
    // live run is over for this probe, and no lockout bars the heroic door
    // because the daily source gate, not the lockout, is what is under test.
    const normalInst = claimedDungeon(sim, 'nythraxis_boss_arena', 'normal');
    (sim.instances as any[]).splice((sim.instances as any[]).indexOf(normalInst), 1);
    sim.setDungeonDifficulty('heroic', tank);
    for (const pid of raiders) enterDungeon(sim.ctx, 'nythraxis_boss_arena', pid);
    const heroicInst = claimedDungeon(sim, 'nythraxis_boss_arena', 'heroic');
    expect(heroicInst).toBeTruthy();
    const heroicBoss = mobInInstance(sim, heroicInst, 'nythraxis_scourge_of_thornpeak');
    sim.ctx.awardWyrmfallCores(heroicBoss, metas);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, raiders[0])).toBeGreaterThan(afterNormal);
    expect(metas[0].wyrmfallDaily.sources.has('nythraxis_boss_arena:normal')).toBe(true);
    expect(metas[0].wyrmfallDaily.sources.has('nythraxis_boss_arena:heroic')).toBe(true);
  });
});

describe('wyrmfall cores: the rift first-clear arm', () => {
  function riftEventRig(tier: 'A' | 'S' | 'B') {
    const sim = new Sim({
      seed: 99117,
      playerClass: 'warrior',
      noPlayer: true,
      autoEquip: true,
      devCommands: true,
      riftPortals: true,
      world: DUNGEON_TEST_WORLD,
    }) as AnySim;
    const winner = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, winner);
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const portalInfo = sim.naturalRiftPortals[0];
    const event = sim.riftEvents.find((e: any) => e.eventId === portalInfo.eventId)!;
    // Pin the arm under test through the portal's BASE LEVEL: the grant reads
    // the clear's rank from riftRankForBaseLevel(inst.baseLevel), the
    // creditRiftClearDeeds precedent, so the event tier is kept in sync only
    // for the world-race bookkeeping.
    event.tier = tier;
    const portal = sim.entities.get(portalInfo.id)! as AnyEntity;
    portal.riftBaseLevel = RIFT_RANK_BASE_LEVEL[tier];
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, winner, undefined, portal as any);
    const inst = sim.riftInstances.find((i: any) => i.memberIds.has(winner))!;
    expect(inst.baseLevel).toBe(RIFT_RANK_BASE_LEVEL[tier]);
    return { sim, winner, inst, portal, portalInfo };
  }

  function winRace(sim: AnySim, inst: any, pid: number): void {
    while (inst.floorIndex < inst.floorCount - 1) {
      for (const id of inst.mobIds) {
        const mob = sim.entities.get(id);
        if (mob) (mob as AnyEntity).dead = true;
      }
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true;
      sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
      updateRiftInstances(sim.ctx);
      descendRift(sim.ctx, pid);
    }
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) (mob as AnyEntity).dead = true;
    }
    sim.drainEvents();
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    updateRiftInstances(sim.ctx);
  }

  it('an A-rank first clear grants the deterministic A count, once per day', () => {
    const { sim, winner, inst } = riftEventRig('A');
    (sim as any).resetDay = '2026-08-12';
    winRace(sim, inst, winner);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(WYRMFALL_RIFT_COUNT.A);
    const meta = sim.players.get(winner)! as PlayerMeta;
    expect(meta.wyrmfallDaily.sources.has('rift')).toBe(true);
    // A second A/S first clear the same day grants nothing more (R9's cap),
    // and a rank RE-ROLL (finishing S after claiming A) pays no top-up: the
    // shared 'rift' source token is the whole gate.
    awardRiftFirstClearMaterials(sim.ctx, 'A', [winner]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(WYRMFALL_RIFT_COUNT.A);
    awardRiftFirstClearMaterials(sim.ctx, 'S', [winner]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(WYRMFALL_RIFT_COUNT.A);
    // Next reset day: the rift source pays again.
    (sim as any).resetDay = '2026-08-13';
    awardRiftFirstClearMaterials(sim.ctx, 'A', [winner]);
    // The literal, not 2 * WYRMFALL_RIFT_COUNT.A: a deleted A row would move
    // the derived expectation to 0 and pass this arm vacuously.
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(2);
  });

  it('an S-rank first clear pays the risk premium; B pays nothing', () => {
    const { sim, winner, inst } = riftEventRig('S');
    winRace(sim, inst, winner);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(WYRMFALL_RIFT_COUNT.S);
    expect(WYRMFALL_RIFT_COUNT.S).toBe(2);
    expect(WYRMFALL_RIFT_COUNT.A).toBe(1);

    const bRig = riftEventRig('B');
    winRace(bRig.sim, bRig.inst, bRig.winner);
    expect(bRig.sim.countItem(WYRMFALL_CORE_ITEM_ID, bRig.winner)).toBe(0);
  });

  it('the ember gates on EMBER_ELIGIBLE_RIFT_TIERS, never on the core count table', () => {
    // R4 and R9 are independent rulings: a tier present in the ember set but
    // absent from the core table must pay the keystone WITH ZERO CORES on the
    // winning arm (the variant that derives ember eligibility from the core
    // table pays winners nothing and losers the ember, inverting the
    // incentive). B is in neither set today, so probe by widening the ember
    // set at the seam and restoring it.
    const { sim } = riftEventRig('A');
    (sim as any).resetDay = TUESDAY;
    const pid = sim.addPlayer('mage', 'Probe');
    const emberSet = EMBER_ELIGIBLE_RIFT_TIERS as Set<'A' | 'S' | 'B'>;
    emberSet.add('B');
    try {
      awardRiftFirstClearMaterials(sim.ctx, 'B', [pid]);
      expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, pid)).toBe(0);
      expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(1);
    } finally {
      emberSet.delete('B');
    }
    // Control with the live tables: B pays neither.
    const control = sim.addPlayer('mage', 'Ctrl');
    awardRiftFirstClearMaterials(sim.ctx, 'B', [control]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, control)).toBe(0);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, control)).toBe(0);
  });

  it('a departing character (leave snapshot captured) earns nothing from either rift arm', () => {
    const { sim } = riftEventRig('A');
    (sim as any).resetDay = TUESDAY;
    const pid = sim.addPlayer('mage', 'Ghost');
    const meta = sim.players.get(pid)! as PlayerMeta;
    meta.leaving = true;
    awardRiftFirstClearMaterials(sim.ctx, 'A', [pid]);
    grantRiftClearEmbers(sim.ctx, 'A', [pid], 'ev_race');
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, pid)).toBe(0);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(0);
    expect(meta.wyrmfallDaily.sources.size).toBe(0);
    // Positive control: the same character pays once the flag drops.
    meta.leaving = false;
    awardRiftFirstClearMaterials(sim.ctx, 'A', [pid]);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, pid)).toBe(WYRMFALL_RIFT_COUNT.A);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(1);
  });

  it('a dev-portal clear (no world event) pays no cores and no ember, end to end', () => {
    const { sim } = riftEventRig('A');
    (sim as any).resetDay = TUESDAY;
    const dev = sim.addPlayer('warrior', 'Devver');
    sim.setPlayerLevel(20, dev);
    // Dev entry: no portal entity, no raced event; the instance carries
    // eventId null and claimRiftFirstClear returns {won: true, event: null}.
    sim.enterRift(4242, RIFT_RANK_BASE_LEVEL.A, dev);
    const devRun = sim.riftInstances.find((i: any) => i.memberIds.has(dev))!;
    expect(devRun.eventId).toBeNull();
    winRace(sim, devRun, dev);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, dev)).toBe(0);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, dev)).toBe(0);
    const meta = sim.players.get(dev)! as PlayerMeta;
    expect(meta.wyrmfallDaily.sources.size).toBe(0);
  });

  it('a losing A-rank crew gets the ember and no cores, end to end', () => {
    const { sim, winner, inst, portal } = riftEventRig('A');
    (sim as any).resetDay = TUESDAY;
    const loser = sim.addPlayer('mage', 'Bet');
    sim.setPlayerLevel(20, loser);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, loser, undefined, portal as any);
    const loserRun = sim.riftInstances.find((i: any) => i.memberIds.has(loser))!;
    expect(loserRun.instanceId).not.toBe(inst.instanceId);
    winRace(sim, inst, winner);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, winner)).toBe(WYRMFALL_RIFT_COUNT.A);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, winner)).toBe(1);
    // The competitor finishes their own run and completes as a loser: the
    // race forfeits the cores, never the weekly keystone (mercy, not a prize).
    winRace(sim, loserRun, loser);
    expect(sim.countItem(WYRMFALL_CORE_ITEM_ID, loser)).toBe(0);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, loser)).toBe(1);
  });
});

describe("maker's ember: the weekly bankable keystone", () => {
  let sim: AnySim;
  let pid: number;
  let meta: PlayerMeta;

  beforeEach(() => {
    sim = makeDungeonSim(5);
    pid = sim.addPlayer('warrior', 'Smith');
    meta = sim.players.get(pid)! as PlayerMeta;
  });

  it('grants one on the first eligible completion and banks missed weeks uncapped', () => {
    (sim as any).resetDay = TUESDAY;
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(1);
    expect(meta.emberWeekAnchor).toBe(TUESDAY);
    // Same week, second completion: nothing.
    (sim as any).resetDay = '2026-08-14';
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(1);
    // Next week: one more.
    (sim as any).resetDay = NEXT_TUESDAY;
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(2);
    expect(meta.emberWeekAnchor).toBe(NEXT_TUESDAY);
    // Three missed weeks accrue and pay together on the next completion (R4).
    (sim as any).resetDay = '2026-09-09'; // three weeks after NEXT_TUESDAY's week
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(5);
  });

  it('one completion pays at most a stack; the over-cap backlog stays banked', () => {
    (sim as any).resetDay = TUESDAY;
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(1);
    // 25 weeks pass: the payout caps at one stack (20) and the anchor only
    // advances 20 weeks, so the remaining 5 pay on the very next completion.
    (sim as any).resetDay = '2027-02-02'; // a Tuesday 25 weeks after TUESDAY
    expect(emberWeeksBetween(TUESDAY, '2027-02-02')).toBe(25);
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(21);
    // The literal, not emberWeekAnchorPlusWeeks(TUESDAY, 20): re-running the
    // production helper would move both sides of a broken helper together.
    expect(meta.emberWeekAnchor).toBe('2026-12-29');
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(26);
    expect(meta.emberWeekAnchor).toBe('2027-02-02');
  });

  it('no calendar means no grant, and a future-dated anchor self-heals silently', () => {
    (sim as any).resetDay = '';
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(0);
    expect(meta.emberWeekAnchor).toBe('');
    // A rolled-back realm clock: the stored anchor is AHEAD. Nothing grants,
    // nothing corrupts, and the anchor stays until the calendar catches up.
    meta.emberWeekAnchor = NEXT_TUESDAY;
    (sim as any).resetDay = TUESDAY;
    tryGrantMakersEmber(sim.ctx, meta);
    expect(sim.countItem(MAKERS_EMBER_ITEM_ID, pid)).toBe(0);
    expect(meta.emberWeekAnchor).toBe(NEXT_TUESDAY);
  });

  it('rides the heroic kill for present participants and losing A/S rift crews', () => {
    const { sim: dsim, leader, member, boss } = heroicMorthenRig();
    (dsim as any).resetDay = TUESDAY;
    killBoss(dsim, leader, boss);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, leader)).toBe(1);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, member)).toBe(1);
    // The ember rides completion, not the core gate: a second eligible
    // completion the same day still checks the week (and finds it granted).
    const leaderMeta = dsim.players.get(leader)! as PlayerMeta;
    dsim.ctx.awardWyrmfallCores(boss, [leaderMeta]);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, leader)).toBe(1);
    // A losing A/S rift crew still ticks the weekly check (mercy, not a race
    // prize); a B-rank loss does not.
    const other = dsim.addPlayer('mage', 'Loser');
    grantRiftClearEmbers(dsim.ctx, 'B', [other], 'ev_race');
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, other)).toBe(0);
    grantRiftClearEmbers(dsim.ctx, 'S', [other], 'ev_race');
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, other)).toBe(1);
    // A run outside the race (a dev portal has no event) is not a faucet on
    // the losing arm either: the guard is local, not a claim-shape accident.
    const dev = dsim.addPlayer('mage', 'Devver');
    grantRiftClearEmbers(dsim.ctx, 'S', [dev], null);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, dev)).toBe(0);
  });

  it('rides completion, not the core gate: a closed daily source still pays the week', () => {
    const { sim: dsim, leader, boss } = heroicMorthenRig();
    (dsim as any).resetDay = TUESDAY;
    killBoss(dsim, leader, boss);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, leader)).toBe(1);
    const leaderMeta = dsim.players.get(leader)! as PlayerMeta;
    // Rewind the stored anchor one week and re-run the SAME source the same
    // day: the core gate is closed (no second core payout), but the ember
    // check must still run and pay the elapsed week. A variant that tucks the
    // ember call inside the daily-gate block passes every other arm and
    // fails exactly here.
    const before = dsim.countItem(WYRMFALL_CORE_ITEM_ID, leader);
    leaderMeta.emberWeekAnchor = '2026-08-04';
    dsim.ctx.awardWyrmfallCores(boss, [leaderMeta]);
    expect(dsim.countItem(WYRMFALL_CORE_ITEM_ID, leader)).toBe(before);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, leader)).toBe(2);
  });

  it('present participants only: the raven-paid absentee banks the week, no ember now', () => {
    const { sim: dsim, leader, member, boss } = heroicMorthenRig();
    (dsim as any).resetDay = TUESDAY;
    const leaderMeta = dsim.players.get(leader)! as PlayerMeta;
    // Only the leader is in the death-time snapshot: the member takes cores
    // by raven and must NOT tick the weekly ember (their week stays banked
    // for their own next completion; dropping the present guard pays them
    // here and fails this arm).
    dsim.ctx.awardWyrmfallCores(boss, [leaderMeta]);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, leader)).toBe(1);
    expect(dsim.countItem(MAKERS_EMBER_ITEM_ID, member)).toBe(0);
    const memberMeta = dsim.players.get(member)! as PlayerMeta;
    expect(memberMeta.emberWeekAnchor).toBe('');
  });

  it('the ember and essence defs are bound tokens (soulbound, noDiscard, stack 20)', () => {
    for (const id of [MAKERS_EMBER_ITEM_ID, SUNDERED_ESSENCE_ITEM_ID]) {
      expect(ITEMS[id].soulbound, id).toBe(true);
      expect(ITEMS[id].noDiscard, id).toBe(true);
      expect(ITEMS[id].kind, id).toBe('tool');
      expect(ITEMS[id].quality, id).toBe('epic');
      expect(ITEMS[id].stackSize, id).toBe(20);
      expect(ITEMS[id].sellValue, id).toBe(0);
    }
    // The accrual payout cap IS "one full stack": tie the two so a stack
    // retune cannot silently falsify the cap's stated meaning.
    expect(EMBER_ACCRUAL_GRANT_CAP).toBe(ITEMS[MAKERS_EMBER_ITEM_ID].stackSize);
  });

  it('the recorded faucet numbers are literals, not whatever the constants say', () => {
    // Each of these is a recorded decision in the Phase 04 ledger; comparing
    // grants against the imported constants alone lets a silent retune pass
    // every behavioral arm (the constant-self-comparison trap).
    expect([WYRMFALL_BOSS_MIN, WYRMFALL_BOSS_MAX]).toEqual([1, 3]);
    expect(SUNDERED_ESSENCE_YIELD).toBe(1);
    const core = ITEMS[WYRMFALL_CORE_ITEM_ID];
    expect(core.kind).toBe('junk');
    expect(core.quality).toBe('rare');
    expect(core.stackSize).toBe(20);
    expect(core.sellValue).toBe(50);
    // Freely tradable per R2's catalyst design: neither bound nor delisted.
    expect(core.soulbound).toBeUndefined();
    expect((core as { noMarketList?: boolean }).noMarketList).toBeUndefined();
  });
});

describe('sundered essence: the extraction', () => {
  function makeSunderSim(seed = 42): Sim {
    return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
  }

  function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!;
    return { p, meta, pid };
  }

  it('breaks a raid epic into the deterministic yield with the sunder log line', () => {
    const sim = makeSunderSim();
    const { pid } = playerOf(sim);
    sim.addItem(RAID_EPIC, 1, pid);
    sim.drainEvents();
    const draws = countDraws(sim as AnySim, () => runSunder(sim, RAID_EPIC));
    expect(draws).toBe(0); // the extraction is draw-free by design
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(SUNDERED_ESSENCE_YIELD);
    const events = sim.drainEvents() as any[];
    const line = events.find((e) => e.type === 'log' && /sunder/i.test(e.text ?? ''));
    // The id is frozen; the DISPLAY name is what the line carries (the phase
    // 03 rename discipline: crownforged_dreadhelm renders Bonewrought).
    expect(line?.text).toBe('You sunder Bonewrought Dreadhelm into Sundered Essence.');
    // silent + callerLogs: the sunder line above owns both halves of the
    // grant feedback (the #2458 stand-down rule; no generic hub line or ding).
    expect(
      events.filter((e) => e.type === 'loot' && /Sundered Essence/.test(e.text ?? '')),
    ).toEqual([expect.objectContaining({ callerLogs: true, silent: true })]);
  });

  it('refuses a non-raid epic, an unknown id, and an unheld item, consuming nothing', () => {
    const sim = makeSunderSim();
    const { pid } = playerOf(sim);
    sim.addItem(FIVEMAN_EPIC, 1, pid);
    sim.drainEvents();
    runSunder(sim, FIVEMAN_EPIC);
    let errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['Only raid-won epics can be sundered.']);
    expect(sim.countItem(FIVEMAN_EPIC, pid)).toBe(1);
    expect(isSunderable(ITEMS[FIVEMAN_EPIC])).toBe(false);
    expect(isSunderable(ITEMS[RAID_EPIC])).toBe(true);

    runSunder(sim, 'no_such_item');
    errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['Only raid-won epics can be sundered.']);

    runSunder(sim, RAID_EPIC); // sunderable id, zero copies held
    errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['You are not holding that item.']);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });

  it('the eligibility boundary: raid legendaries, heroic-raid epics, rift gear all refuse', () => {
    // Deleting the quality === 'epic' clause makes the two RAID LEGENDARIES
    // sunderable (they are the only raid-sourced non-epics); deleting the
    // itemFromRaid clause admits five-man and rift gear. One negative per
    // clause so each is load-bearing on its own.
    const sim = makeSunderSim();
    const { pid } = playerOf(sim);
    sim.addItem('deathless_heartwood', 1, pid); // raid-sourced LEGENDARY
    sim.drainEvents();
    runSunder(sim, 'deathless_heartwood');
    const errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['Only raid-won epics can be sundered.']);
    expect(sim.countItem('deathless_heartwood', pid)).toBe(1);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
    // The scope AS SHIPPED (open item: pending a ruling before phase 12):
    // the source index registers heroic-raid variants raid: false, so a
    // heroic Nythraxis epic is NOT sunderable; neither is rift gear.
    expect(ITEMS.deathless_greatblade.quality).toBe('epic');
    expect(isSunderable(ITEMS.deathless_greatblade)).toBe(false);
    expect(isSunderable(ITEMS.heart_of_the_rift)).toBe(false);
    expect(isSunderable(ITEMS.deathless_heartwood)).toBe(false);
  });

  it('refuses while busy and while dead', () => {
    const sim = makeSunderSim();
    const { p, pid } = playerOf(sim);
    sim.addItem(RAID_EPIC, 2, pid);
    // The OTHER busy arm first: eating blocks the start just like a cast.
    (p as AnyEntity).eating = {
      itemId: 'conjured_bread4',
      kind: 'food',
      hpPer2s: 5,
      manaPer2s: 0,
      remaining: 10,
      ticksElapsed: 0,
    };
    sim.drainEvents();
    sim.extractEssence(RAID_EPIC);
    const eating = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(eating.map((e) => e.text)).toEqual(['You are busy.']);
    (p as AnyEntity).eating = null;
    sim.extractEssence(RAID_EPIC);
    expect(p.castingAbility).toBe('sundering');
    sim.drainEvents();
    sim.extractEssence(RAID_EPIC); // second start while the first cast runs
    const busy = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(busy.map((e) => e.text)).toEqual(['You are busy.']);
    completeEnchantFamilyCast(sim);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(SUNDERED_ESSENCE_YIELD);

    p.dead = true;
    sim.drainEvents();
    sim.extractEssence(RAID_EPIC);
    const dead = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(dead.length).toBe(1); // refusedWhileDead owns the line
    expect(p.castingAbility).toBeNull();
  });

  it('the slot pin denies when a mid-cast splice slides a different copy under the index', () => {
    const sim = makeSunderSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 3, pid); // index 0: the slot that goes away
    sim.addItem(RAID_EPIC, 1, pid); // index 1: the plain copy the player picked
    sim.addItemInstance(RAID_EPIC, { signer: meta.name }, pid, 1); // index 2
    expect(meta.inventory[1].instance).toBeUndefined();

    sim.extractEssence(RAID_EPIC, pid, 1);
    sim.removeItem('linen_scrap', 3, pid); // the splice shifts the signed copy under index 1
    expect(meta.inventory[1].instance?.signer).toBe(meta.name);
    sim.drainEvents();
    completeEnchantFamilyCast(sim);

    const errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['The item moved; sundering canceled.']);
    // Neither copy died: without the re-check the id-only walk would have
    // eaten the signed copy the player never selected.
    expect(sim.countItem(RAID_EPIC, pid)).toBe(2);
    expect(meta.inventory.filter((s) => s.itemId === RAID_EPIC && s.instance?.signer)).toHaveLength(
      1,
    );
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });

  it("the amendment's named hazard: a mid-cast bag sort consolidation denies the pin", () => {
    const sim = makeSunderSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    // Two partial stacks of one material: sort's consolidation merges them and
    // splices the emptied donor, which is exactly the index shift that must
    // deny (the phase 03 QA amendment names inv_sort for this cast).
    meta.inventory.push({ itemId: 'arcane_dust', count: 2 });
    meta.inventory.push({ itemId: 'arcane_dust', count: 3 });
    sim.addItem(RAID_EPIC, 1, pid); // index 2: the pinned target
    sim.addItemInstance(RAID_EPIC, { signer: meta.name }, pid, 1); // index 3

    sim.extractEssence(RAID_EPIC, pid, 2);
    sim.sortInventory(pid);
    sim.drainEvents();
    completeEnchantFamilyCast(sim);

    const errors = (sim.drainEvents() as any[]).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.text)).toEqual(['The item moved; sundering canceled.']);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(2);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('an unpinned sunder re-resolves fresh and prefers the plain copy', () => {
    const sim = makeSunderSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItemInstance(RAID_EPIC, { signer: meta.name }, pid, 1);
    sim.addItem(RAID_EPIC, 1, pid);
    runSunder(sim, RAID_EPIC);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(SUNDERED_ESSENCE_YIELD);
    // The signed copy survives; the plain one died (the disenchant victim order).
    const left = meta.inventory.filter((s) => s.itemId === RAID_EPIC);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.signer).toBe(meta.name);
  });

  it('a cancelled cast consumes nothing and leaves no stale session', () => {
    const sim = makeSunderSim();
    const { p, meta, pid } = playerOf(sim);
    meta.inventory = []; // starter rations would shift the pinned index
    sim.addItem(RAID_EPIC, 1, pid);
    sim.extractEssence(RAID_EPIC, pid, 0);
    expect(p.castingAbility).toBe('sundering');
    expect(p.enchantCastItemId).toBe(RAID_EPIC);
    sim.ctx.cancelCast(p);
    expect(p.castingAbility).toBeNull();
    expect(p.enchantCastItemId).toBe('');
    expect(p.enchantCastTargetPin).toBe('');
    expect(sim.countItem(RAID_EPIC, pid)).toBe(1);
    expect(sim.countItem(SUNDERED_ESSENCE_ITEM_ID, pid)).toBe(0);
  });
});

describe('persistence: the two new PlayerMeta fields', () => {
  it('round-trips wyrmfallDaily and emberWeekAnchor through CharacterState JSON', () => {
    const sim = makeDungeonSim(3);
    const pid = sim.addPlayer('warrior', 'Saver');
    const meta = sim.players.get(pid)! as PlayerMeta;
    (sim as any).resetDay = TUESDAY;
    meta.wyrmfallDaily = { date: TUESDAY, sources: new Set(['rift', 'hollow_crypt:heroic']) };
    tryGrantMakersEmber(sim.ctx, meta);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    expect(state.wyrmfallDaily).toEqual({
      date: TUESDAY,
      sources: ['rift', 'hollow_crypt:heroic'],
    });
    expect(state.emberWeekAnchor).toBe(TUESDAY);

    const sim2 = makeDungeonSim(3);
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state });
    const meta2 = sim2.players.get(pid2)! as PlayerMeta;
    expect(meta2.wyrmfallDaily.date).toBe(TUESDAY);
    expect(meta2.wyrmfallDaily.sources).toEqual(new Set(['rift', 'hollow_crypt:heroic']));
    expect(meta2.emberWeekAnchor).toBe(TUESDAY);
    // Re-serialize equality: the fields survive a second trip unchanged.
    const again = JSON.parse(JSON.stringify(sim2.serializeCharacter(pid2)));
    expect(again.wyrmfallDaily).toEqual(state.wyrmfallDaily);
    expect(again.emberWeekAnchor).toBe(state.emberWeekAnchor);
  });

  it('a pre-materials save loads with fresh defaults (old saves load unchanged)', () => {
    const sim = makeDungeonSim(3);
    const pid = sim.addPlayer('warrior', 'Old');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    delete state.wyrmfallDaily;
    delete state.emberWeekAnchor;
    const sim2 = makeDungeonSim(3);
    const pid2 = sim2.addPlayer('warrior', 'Old', { state });
    const meta2 = sim2.players.get(pid2)! as PlayerMeta;
    expect(meta2.wyrmfallDaily).toEqual({ date: '', sources: new Set() });
    expect(meta2.emberWeekAnchor).toBe('');
  });

  it('a corrupt row degrades to defaults instead of throwing or stalling', () => {
    const sim = makeDungeonSim(3);
    const pid = sim.addPlayer('warrior', 'Bad');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    // A malformed anchor would stall the weekly grant forever (weeksBetween
    // reads unparseable as 0 = same week); a non-array sources would throw in
    // addPlayer or poison the gate with per-character junk entries.
    state.emberWeekAnchor = 42;
    state.wyrmfallDaily = { date: 7, sources: 'rift' };
    const sim2 = makeDungeonSim(3);
    const pid2 = sim2.addPlayer('warrior', 'Bad', { state });
    const meta2 = sim2.players.get(pid2)! as PlayerMeta;
    expect(meta2.emberWeekAnchor).toBe('');
    expect(meta2.wyrmfallDaily).toEqual({ date: '', sources: new Set() });
    // The degraded anchor takes the first-grant arm again: no permanent stall.
    (sim2 as any).resetDay = TUESDAY;
    tryGrantMakersEmber(sim2.ctx, meta2);
    expect(sim2.countItem(MAKERS_EMBER_ITEM_ID, pid2)).toBe(1);
    // A parseable but OFF-ANCHOR stored value (a Thursday) normalizes to its
    // week's Tuesday on load, so the weekly math never sees a mid-week base.
    state.emberWeekAnchor = '2026-08-13';
    const sim3 = makeDungeonSim(3);
    const pid3 = sim3.addPlayer('warrior', 'Bad', { state });
    expect((sim3.players.get(pid3)! as PlayerMeta).emberWeekAnchor).toBe(TUESDAY);
    // A well-formed but OUT-OF-RANGE year: the load normalization must yield
    // a state the weekly grant recovers from IN THIS SESSION (the padded
    // renderer keeps ancient years parseable; overflow degrades to '').
    // Before the year pad, this normalized to the unparseable '2-12-31' and
    // the grant silently stalled until the NEXT load.
    state.emberWeekAnchor = '0003-01-01';
    const sim4 = makeDungeonSim(3);
    const pid4 = sim4.addPlayer('warrior', 'Bad', { state });
    const meta4 = sim4.players.get(pid4)! as PlayerMeta;
    expect(meta4.emberWeekAnchor).toBe('0002-12-31');
    (sim4 as any).resetDay = TUESDAY;
    tryGrantMakersEmber(sim4.ctx, meta4);
    // The ancient anchor accrues a giant backlog: the capped payout proves
    // the weekly math ran (a stalled grant would pay zero).
    expect(sim4.countItem(MAKERS_EMBER_ITEM_ID, pid4)).toBe(EMBER_ACCRUAL_GRANT_CAP);
  });

  it('oversized junk in the sources array drops at the load clamp', () => {
    const sim = makeDungeonSim(3);
    const pid = sim.addPlayer('warrior', 'Fat');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    // This field sits outside the professions byte ceiling, so the load
    // clamp is what bounds the blob (the knownRecipes doctrine): oversized
    // tokens drop, and the set caps well above the content-bounded real
    // cardinality (about ten sources).
    state.wyrmfallDaily = {
      date: TUESDAY,
      sources: ['rift', 'x'.repeat(65), ...Array.from({ length: 60 }, (_, i) => `s${i}`)],
    };
    const sim2 = makeDungeonSim(3);
    const pid2 = sim2.addPlayer('warrior', 'Fat', { state });
    const meta2 = sim2.players.get(pid2)! as PlayerMeta;
    expect(meta2.wyrmfallDaily.sources.has('rift')).toBe(true);
    expect(meta2.wyrmfallDaily.sources.has('x'.repeat(65))).toBe(false);
    expect(meta2.wyrmfallDaily.sources.size).toBeLessThanOrEqual(32);
    // The DATE half carries the same cap: an uncapped corrupt date would
    // re-save verbatim on every autosave forever (the omission arm keeps any
    // non-empty date, and only the award paths ever rewrite it).
    state.wyrmfallDaily = { date: 'x'.repeat(100), sources: ['rift'] };
    const sim3 = makeDungeonSim(3);
    const pid3 = sim3.addPlayer('warrior', 'Fat', { state });
    const meta3 = sim3.players.get(pid3)! as PlayerMeta;
    expect(meta3.wyrmfallDaily.date).toBe('');
    // A real date is untouched by the cap (positive control).
    expect(meta2.wyrmfallDaily.date).toBe(TUESDAY);
  });

  it('zero-default omission: an untouched character serializes without the keys', () => {
    const sim = makeDungeonSim(3);
    const pid = sim.addPlayer('warrior', 'Fresh');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    expect('wyrmfallDaily' in state).toBe(false);
    expect('emberWeekAnchor' in state).toBe(false);
  });
});
