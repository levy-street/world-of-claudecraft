// Fire and Fly's ladders (src/sim/fire_and_fly_scoreboards.ts, the registry rows in
// src/sim/world_quest_scoreboards.ts) and the offline records
// (src/sim/fire_and_fly_personal_records.ts, the world_quest_personal_records dispatcher).
import { describe, expect, it } from 'vitest';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import {
  FIRE_AND_FLY_SCORE_VERSIONS,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { NOTICEBOARDS } from '../src/sim/content/noticeboards';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_QUEST_ID,
} from '../src/sim/content/world_quest_fire_and_fly';
import {
  FIRE_AND_FLY_MASTERY_MAX_POINTS,
  FIRE_AND_FLY_MASTERY_MAX_STARS,
  FIRE_AND_FLY_MAX_POINTS,
  fireAndFlyMasteryValid,
  fireAndFlyScoreBetter,
  fireAndFlyScoreValid,
  type PersonalFireAndFlyRecords,
  recordPersonalFireAndFlyScore,
  sanitizeFireAndFlyRecords,
} from '../src/sim/fire_and_fly_personal_records';
import {
  FIRE_AND_FLY_MASTERY_BOARD_ID,
  FIRE_AND_FLY_RANKINGS_BOARD_ID,
  FIRE_AND_FLY_SCOREBOARD_MISSIONS,
  FIRE_AND_FLY_SCOREBOARD_TRIALS,
  fireAndFlyBoardGroup,
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
} from '../src/sim/fire_and_fly_scoreboards';
import { TURRET_PLAN_LIMITS } from '../src/sim/minigames/turret_defense_plan';
import { TURRET_BONUS_CAP, TURRET_POINTS } from '../src/sim/minigames/turret_result';
import { INTERACT_RANGE, type SimEvent } from '../src/sim/types';
import { personalWorldQuestLeaderboard } from '../src/sim/world_quest_personal_records';
import { emitWorldQuestScore } from '../src/sim/world_quest_score_events';
import {
  WORLD_QUEST_SCOREBOARDS,
  worldQuestScoreboard,
  worldQuestScoreboardForQuest,
  worldQuestScoreSortKey,
} from '../src/sim/world_quest_scoreboards';

const INTRO = 'fire_and_fly_introduction';
const DAILY = 'fire_and_fly_introduction_v2_daily';
const LIFETIME = 'fire_and_fly_introduction_v2_lifetime';

describe('the trial boards', () => {
  it('versions a daily and a lifetime board per trial, in the order the instructor offers them', () => {
    expect(FIRE_AND_FLY_SCOREBOARD_TRIALS.map((trial) => trial.scenarioId)).toEqual(
      TURRET_SCENARIOS.map((scenario) => scenario.id),
    );
    for (const scenario of TURRET_SCENARIOS) {
      const version = FIRE_AND_FLY_SCORE_VERSIONS[scenario.boardKey];
      expect(Number.isSafeInteger(version) && version > 0, scenario.id).toBe(true);
      for (const period of ['daily', 'lifetime'] as const) {
        const id = fireAndFlyScoreboardId(scenario.id, period);
        expect(id).toBe(`fire_and_fly_${scenario.boardKey}_v${version}_${period}`);
        expect(fireAndFlyScoreboardInfo(id!)).toEqual({
          scenarioId: scenario.id,
          key: scenario.boardKey,
          version,
          kind: 'trial',
          period,
        });
      }
    }
    expect(fireAndFlyScoreboardId(INTRO, 'daily')).toBe(DAILY);
    expect(fireAndFlyScoreboardId('fire_and_fly_nightmare', 'daily')).toBeNull();
    expect(fireAndFlyScoreboardInfo('fire_and_fly_introduction_v0_daily')).toBeNull();
    expect(fireAndFlyScoreboardInfo('glider_downs_v2_daily')).toBeNull();
  });

  it('registers each trial board, each mission lifetime board and the Mastery as medal-first points ladders of the quest, and no quest-wide board', () => {
    const rows = WORLD_QUEST_SCOREBOARDS.filter((board) => fireAndFlyBoardGroup(board.id));
    expect(rows.map((board) => [board.id, fireAndFlyBoardGroup(board.id)])).toEqual([
      ['fire_and_fly_introduction_v2_daily', 'trials'],
      ['fire_and_fly_introduction_v2_lifetime', 'trials'],
      ['fire_and_fly_standard_v2_daily', 'trials'],
      ['fire_and_fly_standard_v2_lifetime', 'trials'],
      ['fire_and_fly_hard_v2_daily', 'trials'],
      ['fire_and_fly_hard_v2_lifetime', 'trials'],
      ['fire_and_fly_pack_v1_lifetime', 'missions'],
      ['fire_and_fly_giants_v1_lifetime', 'missions'],
      ['fire_and_fly_deluge_v1_lifetime', 'missions'],
      ['fire_and_fly_brittle_v1_lifetime', 'missions'],
      ['fire_and_fly_powder_v1_lifetime', 'missions'],
      [FIRE_AND_FLY_MASTERY_BOARD_ID, 'mastery'],
    ]);
    expect(
      FIRE_AND_FLY_SCOREBOARD_MISSIONS.map((m) => fireAndFlyScoreboardId(m.scenarioId, 'lifetime')),
    ).toEqual(TURRET_MISSIONS.map((m) => `fire_and_fly_${m.boardKey}_v1_lifetime`));
    for (const mission of TURRET_MISSIONS) {
      expect(fireAndFlyScoreboardId(mission.id, 'daily')).toBeNull();
      expect(worldQuestScoreboard(`fire_and_fly_${mission.boardKey}_v1_daily`)).toBeUndefined();
    }
    expect(fireAndFlyBoardGroup('glider_downs_v2_daily')).toBeNull();
    expect(fireAndFlyBoardGroup('fire_and_fly_mastery_v0_lifetime')).toBeNull();
    for (const board of rows) {
      expect(board).toMatchObject({
        questId: FIRE_AND_FLY_QUEST_ID,
        metric: 'points',
        primary: 'medal',
      });
    }
    expect(worldQuestScoreboardForQuest(FIRE_AND_FLY_QUEST_ID)).toBeUndefined();
    const events: SimEvent[] = [];
    expect(
      emitWorldQuestScore(
        { emit: (ev) => void events.push(ev) },
        1,
        FIRE_AND_FLY_QUEST_ID,
        'gold',
        9,
      ),
    ).toBe(false);
    expect(events).toEqual([]);
  });

  it('sorts a better medal above any points, then more points above fewer', () => {
    const board = worldQuestScoreboard(LIFETIME)!;
    expect(worldQuestScoreSortKey(board, 'silver', 0)).toBeGreaterThan(
      worldQuestScoreSortKey(board, 'bronze', 40_000),
    );
    expect(worldQuestScoreSortKey(board, 'gold', 30_021)).toBeGreaterThan(
      worldQuestScoreSortKey(board, 'gold', 30_020),
    );
    expect(
      fireAndFlyScoreBetter({ medal: 'silver', metric: 0 }, { medal: 'bronze', metric: 9 }),
    ).toBe(true);
    expect(fireAndFlyScoreBetter({ medal: 'gold', metric: 5 }, { medal: 'gold', metric: 5 })).toBe(
      false,
    );
  });

  it('bounds the points by the most a resolvable plan can hold', () => {
    expect(FIRE_AND_FLY_MAX_POINTS).toBe(
      TURRET_PLAN_LIMITS.waves * TURRET_PLAN_LIMITS.spawnsPerWave * TURRET_POINTS.kill +
        TURRET_PLAN_LIMITS.integrity * TURRET_POINTS.integrity +
        TURRET_BONUS_CAP +
        2 * (TURRET_PLAN_LIMITS.charges + TURRET_PLAN_LIMITS.waves) * TURRET_POINTS.unusedCharge,
    );
    expect(fireAndFlyScoreValid('gold', 0)).toBe(true);
    expect(fireAndFlyScoreValid('bronze', FIRE_AND_FLY_MAX_POINTS)).toBe(true);
    for (const [medal, points] of [
      [null, 10],
      ['platinum', 10],
      ['gold', FIRE_AND_FLY_MAX_POINTS + 1],
      ['gold', -1],
      ['gold', 10.5],
      ['gold', Number.NaN],
      ['gold', Number.POSITIVE_INFINITY],
      ['gold', '10'],
    ] as const) {
      expect(fireAndFlyScoreValid(medal, points), `${medal} ${points}`).toBe(false);
    }
  });

  it('stands the records board beside Master Gunner Alder, its reading spot within talking range', () => {
    const board = NOTICEBOARDS.find((def) => def.id === FIRE_AND_FLY_RANKINGS_BOARD_ID);
    expect(board).toBeDefined();
    expect(board!.entityId).toBe(2_000_000_017);
    const spot = board!.frontStandingPoint;
    const { x, z } = FIRE_AND_FLY_NPC_DEF.pos;
    expect(Math.hypot(spot.x - x, spot.z - z)).toBeLessThan(INTERACT_RANGE);
    expect(Math.hypot(board!.x - x, board!.z - z)).toBeLessThan(8);
  });
});

describe('the offline records', () => {
  it('keeps the day best (a newer day replaces it) and the all-time best, two rows per trial', () => {
    const records: PersonalFireAndFlyRecords = {};
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-23', 'silver', 30_500);
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-23', 'bronze', 31_000);
    expect(records[DAILY]).toEqual({ metric: 30_500, medal: 'silver', day: '2026-09-23' });
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-23', 'gold', 29_000);
    expect(records[DAILY]).toEqual({ metric: 29_000, medal: 'gold', day: '2026-09-23' });
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-24', 'bronze', 12_000);
    expect(records[DAILY]).toEqual({ metric: 12_000, medal: 'bronze', day: '2026-09-24' });
    expect(records[LIFETIME]).toEqual({ metric: 29_000, medal: 'gold', day: '2026-09-23' });
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-23', 'gold', 40_000);
    expect(records[DAILY].day).toBe('2026-09-24');
    expect(records[LIFETIME].metric).toBe(40_000);
    recordPersonalFireAndFlyScore(records, 'fire_and_fly_nightmare', '2026-09-24', 'gold', 1);
    recordPersonalFireAndFlyScore(records, INTRO, 'bad', 'gold', 99_999);
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-24', 'gold', 10.5);
    expect(Object.keys(records).sort()).toEqual([DAILY, LIFETIME]);
  });

  it('restores only known boards and valid rows from a save', () => {
    expect(sanitizeFireAndFlyRecords(null)).toEqual({});
    expect(
      sanitizeFireAndFlyRecords({
        [LIFETIME]: { metric: 30_000, medal: 'gold', day: '2026-09-23', extra: 1 },
        fire_and_fly_introduction_v0_lifetime: { metric: 1, medal: 'gold', day: '2026-09-23' },
        [DAILY]: { metric: 30_000, medal: null, day: '2026-09-23' },
        fire_and_fly_hard_v2_daily: { metric: -5, medal: 'gold', day: '2026-09-23' },
      }),
    ).toEqual({ [LIFETIME]: { metric: 30_000, medal: 'gold', day: '2026-09-23' } });
  });

  it("serves the character's own rows as a personal page, today's daily row only", () => {
    const player = {
      name: 'Ari',
      gliderRecords: {},
      fireAndFlyRecords: {
        [DAILY]: { metric: 30_000, medal: 'gold' as const, day: '2026-09-23' },
        [LIFETIME]: { metric: 31_000, medal: 'gold' as const, day: '2026-09-22' },
      },
    };
    const today = personalWorldQuestLeaderboard(player, DAILY, '2026-09-23', 0, 50);
    expect(today).toMatchObject({ board: DAILY, personal: true, total: 1 });
    expect(today.leaders).toEqual([{ rank: 1, name: 'Ari', medal: 'gold', metric: 30_000 }]);
    expect(today.self).toEqual(today.leaders[0]);
    expect(personalWorldQuestLeaderboard(player, DAILY, '2026-09-24', 0, 50)).toMatchObject({
      leaders: [],
      self: null,
      personal: true,
    });
    expect(personalWorldQuestLeaderboard(player, LIFETIME, '2026-09-24', 0, 50).self?.metric).toBe(
      31_000,
    );
    const other = personalWorldQuestLeaderboard(player, 'forge', '2026-09-24', 0, 50);
    expect(other).toMatchObject({ board: 'forge', leaders: [], self: null });
    expect(other).not.toHaveProperty('personal');
  });
});

describe('the missions and the Mastery offline', () => {
  const PACK = TURRET_MISSIONS[0];
  const GIANTS = TURRET_MISSIONS[1];
  const PACK_BOARD = 'fire_and_fly_pack_v1_lifetime';

  it('bounds a Mastery row by a gold and the most points on every mission', () => {
    expect(FIRE_AND_FLY_MASTERY_MAX_STARS).toBe(15);
    expect(FIRE_AND_FLY_MASTERY_MAX_POINTS).toBe(5 * FIRE_AND_FLY_MAX_POINTS);
    expect(fireAndFlyMasteryValid(0, 0)).toBe(true);
    expect(fireAndFlyMasteryValid(15, FIRE_AND_FLY_MASTERY_MAX_POINTS)).toBe(true);
    for (const [stars, points] of [
      [16, 10],
      [-1, 10],
      [2.5, 10],
      ['3', 10],
      [Number.NaN, 10],
      [3, FIRE_AND_FLY_MASTERY_MAX_POINTS + 1],
      [3, -1],
      [3, 10.5],
      [3, Number.POSITIVE_INFINITY],
      [3, Number.NaN],
    ] as const) {
      expect(fireAndFlyMasteryValid(stars, points), `${stars} ${points}`).toBe(false);
    }
  });

  it("serves a mission's all-time best and never a daily mission row", () => {
    const records: PersonalFireAndFlyRecords = {};
    recordPersonalFireAndFlyScore(records, PACK.id, '2026-09-23', 'silver', 18_000);
    recordPersonalFireAndFlyScore(records, PACK.id, '2026-09-24', 'bronze', 25_000);
    expect(records).toEqual({
      [PACK_BOARD]: { metric: 18_000, medal: 'silver', day: '2026-09-23' },
    });
    const player = { name: 'Ari', gliderRecords: {}, fireAndFlyRecords: records };
    const page = personalWorldQuestLeaderboard(player, PACK_BOARD, '2026-09-30', 0, 50);
    expect(page).toMatchObject({ board: PACK_BOARD, personal: true, total: 1 });
    expect(page.leaders).toEqual([{ rank: 1, name: 'Ari', medal: 'silver', metric: 18_000 }]);
  });

  it("serves the character's Mastery as stars and summed points, empty before any mission", () => {
    const records: PersonalFireAndFlyRecords = {};
    const player = { name: 'Ari', gliderRecords: {}, fireAndFlyRecords: records };
    expect(
      personalWorldQuestLeaderboard(player, FIRE_AND_FLY_MASTERY_BOARD_ID, '2026-09-30', 0, 50),
    ).toMatchObject({
      board: FIRE_AND_FLY_MASTERY_BOARD_ID,
      leaders: [],
      self: null,
      personal: true,
    });
    recordPersonalFireAndFlyScore(records, PACK.id, '2026-09-23', 'gold', 20_000);
    recordPersonalFireAndFlyScore(records, GIANTS.id, '2026-09-23', 'bronze', 9_000);
    recordPersonalFireAndFlyScore(records, INTRO, '2026-09-23', 'gold', 40_000);
    const page = personalWorldQuestLeaderboard(
      player,
      FIRE_AND_FLY_MASTERY_BOARD_ID,
      '2026-09-30',
      0,
      50,
    );
    expect(page.leaders).toEqual([{ rank: 1, name: 'Ari', medal: null, metric: 29_000, stars: 4 }]);
    expect(page.self).toEqual(page.leaders[0]);
    expect(page.personal).toBe(true);
  });
});
