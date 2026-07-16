import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARENA_X,
  DELVE_BAND_X_MIN,
  DUNGEON_X_THRESHOLD,
  ITEMS,
  isArenaPos,
  isDelvePos,
  isYumiMazePos,
  MOBS,
  QUESTS,
  YUMI_BAND_X_MAX,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { itemLevel } from '../src/sim/item_level';
import {
  FIESTA_KILL_HONOR,
  FRONTIER_DAILY_HONOR,
  FRONTIER_HUB,
  FRONTIER_KILL_HONOR_MULT,
  FRONTIER_MIN_LEVEL,
  FRONTIER_RARE_HERO_POINTS,
  FRONTIER_RARE_HONOR,
  FRONTIER_X_MAX,
  FRONTIER_X_MIN,
  grantHeroPoints,
  inFrontierHub,
  isFrontierPos,
  normalizeHeroPoints,
  spendHeroPoints,
} from '../src/sim/pvp';
import {
  dailyQuestDoneToday,
  normalizeDailyQuestState,
  recordDailyQuestDone,
} from '../src/sim/quests/daily_quest';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';

const makeSim = (seed = 7) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

describe('Frontier band geometry', () => {
  it('sits past every other far-off band and never overlaps one', () => {
    // Sampled across the whole far-east x-range: no x is BOTH frontier and
    // (arena | delve | yumi), so hostility/instance routing never collide.
    for (let x = 0; x <= 32000; x += 100) {
      const inFrontier = isFrontierPos(x);
      if (inFrontier) {
        expect(isArenaPos(x)).toBe(false);
        expect(isDelvePos(x)).toBe(false);
        expect(isYumiMazePos(x)).toBe(false);
      }
    }
    // The band opens past the yumi maze band and the delve band.
    expect(FRONTIER_X_MIN).toBeGreaterThan(YUMI_BAND_X_MAX);
    expect(FRONTIER_X_MIN).toBeGreaterThan(DELVE_BAND_X_MIN);
    expect(isFrontierPos(FRONTIER_X_MIN)).toBe(true);
    expect(isFrontierPos(FRONTIER_X_MAX)).toBe(false);
    expect(isFrontierPos(FRONTIER_X_MIN - 1)).toBe(false);
  });

  it('marks the safe hub perimeter', () => {
    expect(inFrontierHub(FRONTIER_HUB.x, FRONTIER_HUB.z)).toBe(true);
    expect(inFrontierHub(FRONTIER_HUB.x + 200, FRONTIER_HUB.z)).toBe(false);
  });
});

describe('Hero points currency', () => {
  it('normalizes junk to a non-negative integer', () => {
    expect(normalizeHeroPoints(undefined)).toBe(0);
    expect(normalizeHeroPoints(-5)).toBe(0);
    expect(normalizeHeroPoints(3.9)).toBe(3);
    expect(normalizeHeroPoints(Number.NaN)).toBe(0);
  });

  it('grants and spends, moving spendable and lifetime together', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.player.id)!;
    grantHeroPoints(sim.ctx, meta, 10, 'frontier_rare');
    expect(meta.heroPoints).toBe(10);
    expect(meta.lifetimeHeroPoints).toBe(10);
    expect(spendHeroPoints(meta, 4)).toBe(true);
    expect(meta.heroPoints).toBe(6);
    expect(meta.lifetimeHeroPoints).toBe(10); // lifetime never drops
    expect(spendHeroPoints(meta, 999)).toBe(false); // insufficient, no mutation
    expect(meta.heroPoints).toBe(6);
  });

  it('round-trips through serializeCharacter / addPlayer', () => {
    const sim = makeSim();
    grantHeroPoints(sim.ctx, sim.meta(sim.player.id)!, 42, 'frontier_rare');
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.heroPoints).toBe(42);
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Alt', { state });
    expect(sim2.meta(pid)!.heroPoints).toBe(42);
    expect(sim2.meta(pid)!.lifetimeHeroPoints).toBe(42);
  });
});

describe('Open-world PvP flagging in the Frontier', () => {
  let sim: Sim;
  beforeEach(() => {
    sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true });
  });

  function placePlayer(name: string, x: number, z: number) {
    const pid = sim.addPlayer('warrior', name);
    const e = sim.entities.get(pid)!;
    e.pos = { x, y: 1, z };
    e.prevPos = { ...e.pos };
    return e;
  }

  it('makes two players hostile inside the band, friendly outside', () => {
    const a = placePlayer('Aaa', FRONTIER_X_MIN + 200, 20);
    const b = placePlayer('Bbb', FRONTIER_X_MIN + 210, 25);
    expect(sim.isHostileTo(a, b)).toBe(true);
    expect(sim.isHostileTo(b, a)).toBe(true);
    // Move B out of the band: no longer hostile.
    b.pos = { x: 0, y: 1, z: 0 };
    expect(sim.isHostileTo(a, b)).toBe(false);
  });

  it('never flags players inside the safe hub', () => {
    const a = placePlayer('Ccc', FRONTIER_HUB.x, FRONTIER_HUB.z);
    const b = placePlayer('Ddd', FRONTIER_HUB.x + 2, FRONTIER_HUB.z + 2);
    expect(sim.isHostileTo(a, b)).toBe(false);
  });

  it('does not flag two overworld players', () => {
    const a = placePlayer('Eee', 0, 0);
    const b = placePlayer('Fff', 5, 5);
    expect(sim.isHostileTo(a, b)).toBe(false);
  });

  it('floors player-vs-player damage (a bleed carried in) to 0 inside the safe hub', () => {
    const a = placePlayer('Ggg', FRONTIER_X_MIN + 300, 40);
    const b = placePlayer('Hhh', FRONTIER_X_MIN + 305, 42);
    // Out in the band: hostile, so a bleed tick (dealDamage, what a DoT calls) lands.
    const hpOutside = b.hp;
    sim.dealDamage(a, b, 60, false, 'physical', null, 'hit');
    expect(b.hp).toBeLessThan(hpOutside);
    // The victim reaches the hub: the same carried-in bleed tick is floored to 0, so
    // it can never finish them at the vendor.
    b.pos = { x: FRONTIER_HUB.x, y: 1, z: FRONTIER_HUB.z };
    b.prevPos = { ...b.pos };
    sim.rebucket(b);
    const hpInHub = b.hp;
    sim.dealDamage(a, b, 60, false, 'physical', null, 'hit');
    expect(b.hp).toBe(hpInHub);
  });

  it('exempts party members from hostility so a group can heal and AoE together', () => {
    const a = placePlayer('Iii', FRONTIER_X_MIN + 200, 20);
    const b = placePlayer('Jjj', FRONTIER_X_MIN + 205, 22);
    // Ungrouped in the band: hostile.
    expect(sim.isHostileTo(a, b)).toBe(true);
    // Same party: no longer hostile (heals/shields/AoE work), the rares being group
    // content. isFriendlyTo (derived from !isHostileTo) flips to true.
    sim.partyInvite(b.id, a.id);
    sim.partyAccept(b.id);
    expect(sim.isHostileTo(a, b)).toBe(false);
    expect(sim.isHostileTo(b, a)).toBe(false);
  });

  it('pays the killer the Frontier premium honor for a player kill out in the band', () => {
    const a = placePlayer('Kkk', FRONTIER_X_MIN + 300, 30);
    const b = placePlayer('Lll', FRONTIER_X_MIN + 305, 32);
    const meta = sim.meta(a.id)!;
    const honorBefore = meta.honor;
    sim.dealDamage(a, b, b.hp, false, 'physical', null, 'hit'); // lethal
    expect(b.dead).toBe(true);
    expect(meta.honor).toBe(honorBefore + FIESTA_KILL_HONOR * FRONTIER_KILL_HONOR_MULT);
  });
});

describe('Frontier entry level gate', () => {
  it('refuses travel below the endgame level, allows it at the cap', () => {
    const sim = new Sim({ seed: 44, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    p.pos = { x: 12, y: 1, z: -7 };
    p.prevPos = { ...p.pos };
    // Below the gate: entering is a no-op.
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL - 1);
    sim.frontierEnter(p.id);
    expect(isFrontierPos(p.pos.x)).toBe(false);
    // At the cap: travel works.
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    sim.frontierEnter(p.id);
    expect(isFrontierPos(p.pos.x)).toBe(true);
  });
});

describe('Frost rare kill reward', () => {
  it('drops honor and hero points to a contributor when a frost rare dies in the band', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const meta = sim.meta(player.id)!;
    const x = FRONTIER_X_MIN + 300;
    player.pos = { x, y: 1, z: 40 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    const rare = createMob(90101, MOBS.rimefang_stalker, 20, sim.groundPos(x, 44));
    sim.addEntity(rare);
    const honorBefore = meta.honor;
    const heroBefore = meta.heroPoints;
    // Land a hit (registers the contributor), then the lethal blow.
    sim.dealDamage(player, rare, 50, false, 'physical', null, 'hit');
    sim.dealDamage(player, rare, rare.hp, false, 'physical', null, 'hit');
    sim.tick();
    expect(rare.dead).toBe(true);
    expect(meta.honor).toBe(honorBefore + FRONTIER_RARE_HONOR);
    expect(meta.heroPoints).toBe(heroBefore + FRONTIER_RARE_HERO_POINTS);
  });

  it('does not reward a rare killed OUTSIDE the band', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const meta = sim.meta(player.id)!;
    player.pos = { x: 0, y: 1, z: 0 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    const rare = createMob(90102, MOBS.rimefang_stalker, 20, sim.groundPos(2, 2));
    sim.addEntity(rare);
    sim.dealDamage(player, rare, 50, false, 'physical', null, 'hit');
    sim.dealDamage(player, rare, rare.hp, false, 'physical', null, 'hit');
    sim.tick();
    expect(meta.honor).toBe(0);
    expect(meta.heroPoints).toBe(0);
  });
});

describe('Frostreach Quartermaster (Season 1 hero-points vendor)', () => {
  it('sells the item-level-31 set for hero points, sparing lifetime', () => {
    const sim = new Sim({ seed: 8, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    const meta = sim.meta(pid)!;
    const qm = [...sim.entities.values()].find((e) => e.templateId === 'frostreach_quartermaster')!;
    expect(qm).toBeTruthy();
    const player = sim.entities.get(pid)!;
    player.pos = { x: qm.pos.x, y: 1, z: qm.pos.z };
    player.prevPos = { ...player.pos };
    meta.inventory.length = 0;
    grantHeroPoints(sim.ctx, meta, 200, 'frontier_rare');
    // frostrend_hauberk (chest) costs priceHero 90.
    sim.buyItem(qm.id, 'frostrend_hauberk', pid);
    expect(sim.countItem('frostrend_hauberk', pid)).toBe(1);
    expect(meta.heroPoints).toBe(110);
    expect(meta.lifetimeHeroPoints).toBe(200); // lifetime never drops on spend
  });

  it('refuses a purchase the player cannot afford', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    const meta = sim.meta(pid)!;
    const qm = [...sim.entities.values()].find((e) => e.templateId === 'frostreach_quartermaster')!;
    const player = sim.entities.get(pid)!;
    player.pos = { x: qm.pos.x, y: 1, z: qm.pos.z };
    player.prevPos = { ...player.pos };
    meta.heroPoints = 10; // below every price
    sim.buyItem(qm.id, 'frostrend_hauberk', pid);
    expect(sim.countItem('frostrend_hauberk', pid)).toBe(0);
    expect(meta.heroPoints).toBe(10);
  });

  it('prices the whole set at item level 31 (epic, one tier above FURY)', () => {
    for (const id of [
      'frostrend_helm',
      'frostrend_hauberk',
      'frostrend_legguards',
      'frostrend_choker',
      'frostrend_band',
    ]) {
      expect(itemLevel(ITEMS[id])).toBe(31);
    }
  });
});

describe('Daily quest reset logic (pure leaf)', () => {
  it('normalizes junk to a well-formed state or undefined', () => {
    expect(normalizeDailyQuestState(undefined)).toBeUndefined();
    expect(normalizeDailyQuestState({ date: '', done: [] })).toBeUndefined();
    expect(normalizeDailyQuestState({ date: '2026-07-14', done: ['a', 2, 'b'] })).toEqual({
      date: '2026-07-14',
      done: ['a', 'b'],
    });
  });

  it('treats a stale record from a previous day as not-done', () => {
    const state = { date: '2026-07-14', done: ['q'] };
    expect(dailyQuestDoneToday(state, '2026-07-14', 'q')).toBe(true);
    expect(dailyQuestDoneToday(state, '2026-07-15', 'q')).toBe(false); // day rolled
    expect(dailyQuestDoneToday(state, '2026-07-14', 'other')).toBe(false);
    expect(dailyQuestDoneToday(undefined, '2026-07-14', 'q')).toBe(false);
  });

  it('records a completion, resetting the list when the day rolls', () => {
    const day1 = recordDailyQuestDone(undefined, '2026-07-14', 'q1');
    expect(day1).toEqual({ date: '2026-07-14', done: ['q1'] });
    const both = recordDailyQuestDone(day1, '2026-07-14', 'q2');
    expect(both).toEqual({ date: '2026-07-14', done: ['q1', 'q2'] });
    const day2 = recordDailyQuestDone(both, '2026-07-15', 'q1');
    expect(day2).toEqual({ date: '2026-07-15', done: ['q1'] }); // rolled, list reset
  });
});

describe('Frontier honor daily quest', () => {
  const QID = 'frontier_daily_muster';

  it('pays honor on turn-in, stays out of questsDone, and re-opens next day', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const pid = sim.player.id;
    const meta = sim.meta(pid)!;
    sim.utcDay = '2026-07-14';
    // Simulate an accepted daily with its interact objective satisfied.
    meta.questLog.set(QID, { questId: QID, counts: [1], state: 'ready' });
    const honorBefore = meta.honor;

    turnInQuestCore(sim.ctx, QID, QUESTS[QID], meta);

    expect(meta.honor).toBe(honorBefore + FRONTIER_DAILY_HONOR);
    expect(meta.lifetimeHonor).toBe(honorBefore + FRONTIER_DAILY_HONOR);
    expect(meta.questsDone.has(QID)).toBe(false); // dailies never permanently done
    expect(meta.dailyQuests).toEqual({ date: '2026-07-14', done: [QID] });
    // On cooldown for the rest of the day, then available again once the day rolls.
    expect(sim.questState(QID, pid)).toBe('done');
    sim.utcDay = '2026-07-15';
    expect(sim.questState(QID, pid)).toBe('available');
  });

  it('pays 100 honor', () => {
    expect(FRONTIER_DAILY_HONOR).toBe(100);
    expect(QUESTS.frontier_daily_muster.honorReward).toBe(100);
  });

  it('grants a repeatable daily giver at the Frontier hub', () => {
    const sim = new Sim({ seed: 12, playerClass: 'warrior', autoEquip: true });
    const marshal = [...sim.entities.values()].find((e) => e.templateId === 'frontier_marshal');
    expect(marshal).toBeTruthy();
    expect(isFrontierPos(marshal!.pos.x)).toBe(true);
    const quest = QUESTS[QID];
    expect(quest.daily).toBe(true);
    expect(quest.honorReward).toBe(FRONTIER_DAILY_HONOR);
    expect(quest.objectives[0]).toMatchObject({
      type: 'interact',
      targetNpcId: 'frostreach_quartermaster',
    });
  });
});

describe('Frontier enter/leave (PvP-window travel surface)', () => {
  it('teleports into the hub, remembers the return spot, and teleports back', () => {
    const sim = new Sim({ seed: 21, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    const pid = sim.player.id;
    const player = sim.entities.get(pid)!;
    const meta = sim.meta(pid)!;
    player.pos = { x: 12, y: 1, z: -7 };
    player.prevPos = { ...player.pos };
    player.facing = 1.2;

    sim.frontierEnter(pid);
    // Arrived inside the band, in the safe hub, with the return spot remembered.
    expect(isFrontierPos(player.pos.x)).toBe(true);
    expect(inFrontierHub(player.pos.x, player.pos.z)).toBe(true);
    expect(meta.frontierReturn).toMatchObject({ x: 12, z: -7, facing: 1.2 });

    sim.frontierLeave(pid);
    // Back to the overworld spot; the return record is cleared.
    expect(isFrontierPos(player.pos.x)).toBe(false);
    expect(player.pos.x).toBeCloseTo(12, 5);
    expect(player.pos.z).toBeCloseTo(-7, 5);
    expect(player.facing).toBeCloseTo(1.2, 5);
    expect(meta.frontierReturn).toBeUndefined();
  });

  it('is a no-op when already inside, dead, or in combat', () => {
    const sim = new Sim({ seed: 22, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    const pid = sim.player.id;
    const player = sim.entities.get(pid)!;
    player.pos = { x: 5, y: 1, z: 5 };
    player.prevPos = { ...player.pos };

    // In combat: enter refused (no teleport, no return saved).
    player.inCombat = true;
    sim.frontierEnter(pid);
    expect(isFrontierPos(player.pos.x)).toBe(false);
    expect(sim.meta(pid)!.frontierReturn).toBeUndefined();

    // Out of combat: enter works; a second enter while inside is a no-op that does
    // not overwrite the saved return spot.
    player.inCombat = false;
    sim.frontierEnter(pid);
    const savedReturn = { ...sim.meta(pid)!.frontierReturn! };
    sim.frontierEnter(pid);
    expect(sim.meta(pid)!.frontierReturn).toEqual(savedReturn);
  });

  it('persists the return spot across serialize / addPlayer', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    const pid = sim.player.id;
    const player = sim.entities.get(pid)!;
    player.pos = { x: 40, y: 1, z: 9 };
    player.prevPos = { ...player.pos };
    player.facing = 2.5;
    sim.frontierEnter(pid);
    const state = sim.serializeCharacter(pid)!;
    expect(state.frontierReturn).toMatchObject({ x: 40, z: 9, facing: 2.5 });

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Alt', { state });
    expect(sim2.meta(pid2)!.frontierReturn).toMatchObject({ x: 40, z: 9, facing: 2.5 });
  });

  it('refuses entry for a player seated in a live arena match (the countdown escape)', () => {
    // The reviewer's scenario: two seated fighters are NOT inCombat during the
    // countdown, so without the arenaMatches guard frontier_enter deserts the match
    // AND records the arena-slot coordinates as the return spot.
    const sim = new Sim({ seed: 24, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('rogue', 'Bet');
    for (const pid of [a, b]) {
      const e = sim.entities.get(pid)!;
      e.level = FRONTIER_MIN_LEVEL; // clear the level gate so only the match guard refuses
      sim.arenaQueueJoin(pid);
    }
    sim.tick(); // matchmaking seats both in an arena slot (countdown, not inCombat)
    expect(sim.arenaMatchFor(a)).toBeTruthy();
    const ea = sim.entities.get(a)!;
    expect(isArenaPos(ea.pos.x)).toBe(true);
    expect(ea.inCombat).toBe(false);

    sim.frontierEnter(a);
    // Still seated in the match, and no arena-band return spot was recorded.
    expect(isArenaPos(ea.pos.x)).toBe(true);
    expect(isFrontierPos(ea.pos.x)).toBe(false);
    expect(sim.meta(a)!.frontierReturn).toBeUndefined();
  });

  it('refuses entry from inside a dungeon instance', () => {
    const sim = new Sim({ seed: 25, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    const pid = sim.player.id;
    const player = sim.entities.get(pid)!;
    player.pos = { x: 80, y: 1, z: 88 };
    player.prevPos = { ...player.pos };
    sim.enterCrypt(pid); // now standing in a far-off instance band
    expect(player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);

    sim.frontierEnter(pid);
    expect(isFrontierPos(player.pos.x)).toBe(false);
    expect(player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD); // still inside the instance
    expect(sim.meta(pid)!.frontierReturn).toBeUndefined();
  });

  it('never teleports a poisoned return spot into the arena band on leave', () => {
    const sim = new Sim({ seed: 26, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(FRONTIER_MIN_LEVEL);
    const pid = sim.player.id;
    const player = sim.entities.get(pid)!;
    // Inside the band, with a persisted return record poisoning an arena slot
    // (the shape an old save could carry from before the entry guards existed).
    player.pos = { x: FRONTIER_HUB.x, y: 1, z: FRONTIER_HUB.z };
    player.prevPos = { ...player.pos };
    sim.meta(pid)!.frontierReturn = { x: ARENA_X + 6, z: -1250, facing: 0 };

    sim.frontierLeave(pid);
    // Rejected: falls back to the sane overworld origin, never the arena band.
    expect(isArenaPos(player.pos.x)).toBe(false);
    expect(isFrontierPos(player.pos.x)).toBe(false);
    expect(player.pos.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD);
    expect(player.pos.x).toBeCloseTo(0, 5);
    expect(player.pos.z).toBeCloseTo(0, 5);
    expect(sim.meta(pid)!.frontierReturn).toBeUndefined();
  });
});
