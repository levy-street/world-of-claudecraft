import { describe, expect, it } from 'vitest';
import {
  FACTION_IDS,
  LOW_LEVEL_MAX_STANDING,
  MAX_STANDING,
  STANDING_THRESHOLDS,
} from '../src/sim/factions';
import type { WorldQuestProgress } from '../src/sim/types';
import { buildReputationRow, buildReputationView } from '../src/ui/hud/reputation/reputation_view';

const log = (rows: Array<[string, WorldQuestProgress['state']]>) =>
  new Map<string, WorldQuestProgress>(
    rows.map(([questId, state]) => [questId, { questId, count: 0, state } as WorldQuestProgress]),
  );

describe('reputation view: one row per allied faction', () => {
  it('lists every faction in catalogue order with its hub zone, even at zero standing', () => {
    const view = buildReputationView({
      factions: {},
      level: 20,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 0,
      nowMs: 0,
    });
    expect(view.rows.map((row) => row.factionId)).toEqual([...FACTION_IDS]);
    expect(view.rows.map((row) => row.hubZoneId)).toEqual([
      'palmreach',
      'eastbrook_vale',
      'drakelands',
    ]);
    for (const row of view.rows) {
      expect(row.tier).toBe('unknown');
      expect(row.nextTier).toBe('recognized');
      expect(row.percent).toBe(0);
      expect(row.current).toBe(0);
    }
  });

  it('fills the bar inside the current tier and names the tier that comes next', () => {
    const row = buildReputationRow('rift_watch', 3_400, 20);
    expect(row.tier).toBe('trusted');
    expect(row.nextTier).toBe('proven');
    expect(row.tierProgress).toBe(3_400 - STANDING_THRESHOLDS.trusted);
    expect(row.tierRequired).toBe(STANDING_THRESHOLDS.proven - STANDING_THRESHOLDS.trusted);
    expect(row.percent).toBe(10);
    expect(row.cappedByLevel).toBe(false);
  });

  it('a Champion row has no next tier and reads full', () => {
    const row = buildReputationRow('church_order', MAX_STANDING + 500, 20);
    expect(row.tier).toBe('champion');
    expect(row.nextTier).toBeNull();
    expect(row.percent).toBe(100);
    expect(row.current).toBe(MAX_STANDING);
  });

  it('says when the character level, not the points, is what caps the track', () => {
    const atCap = buildReputationRow('automatons', LOW_LEVEL_MAX_STANDING, 12);
    expect(atCap.tier).toBe('trusted');
    expect(atCap.cappedByLevel).toBe(true);
    expect(atCap.levelCap).toBe(LOW_LEVEL_MAX_STANDING);
    const belowCap = buildReputationRow('automatons', 500, 12);
    expect(belowCap.cappedByLevel).toBe(false);
    const sameAtSixteen = buildReputationRow('automatons', LOW_LEVEL_MAX_STANDING, 16);
    expect(sameAtSixteen.cappedByLevel).toBe(false);
  });
});

describe('reputation view: the day summary', () => {
  it('counts completed quests against the board and the time until the reset', () => {
    const view = buildReputationView({
      factions: { rift_watch: 30 },
      level: 20,
      worldQuestLog: log([
        ['wq_a', 'completed'],
        ['wq_b', 'active'],
        ['wq_c', 'completed'],
      ]),
      worldQuestExpiresAtMs: 10_000,
      nowMs: 4_000,
    });
    expect(view.day).toEqual({ completed: 2, total: 3, resetsInMs: 6_000 });
    expect(view.tiers).toEqual([
      'unknown',
      'recognized',
      'trusted',
      'proven',
      'vanguard',
      'champion',
    ]);
  });

  it('reports no reset time for an unknown or past expiry instead of a negative one', () => {
    const past = buildReputationView({
      factions: {},
      level: 20,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 1_000,
      nowMs: 5_000,
    });
    expect(past.day.resetsInMs).toBe(0);
    const unknown = buildReputationView({
      factions: {},
      level: 20,
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: Number.NaN,
      nowMs: 5_000,
    });
    expect(unknown.day.resetsInMs).toBe(0);
  });
});
