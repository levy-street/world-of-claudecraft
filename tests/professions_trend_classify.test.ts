// Pure leading-pair classifier arm of the Guild letter suite. Split from
// tests/professions_trend.test.ts along describe boundaries for CI shard
// balance (a pure move; shared constants in professions_trend_util.ts).

import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PAIR_TARGETS, craftsForPairTarget } from '../src/sim/professions/archetype';
import { classifyCraftTrend, GUILD_LETTER_SKILL_THRESHOLD } from '../src/sim/professions/trend';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import { RING_PAIR_IDS } from './professions_trend_util';

describe('classifyCraftTrend: the pure leading-pair classifier', () => {
  it('pins the letter threshold to 25, the tier step', () => {
    expect(GUILD_LETTER_SKILL_THRESHOLD).toBe(25);
    expect(GUILD_LETTER_SKILL_THRESHOLD).toBe(TIER_SKILL_STEP);
  });

  it('pins the ten adjacent pair ids in locked ring order', () => {
    expect([...ARCHETYPE_PAIR_TARGETS]).toEqual([...RING_PAIR_IDS]);
  });

  it('selects the clear highest-sum pair with its member crafts and score', () => {
    const trend = classifyCraftTrend({ engineering: 20, alchemy: 30 });
    expect(trend).toEqual({
      pairId: 'engineering+alchemy',
      crafts: ['engineering', 'alchemy'],
      score: 50,
      crossed: true,
    });
    expect(trend?.crafts).toEqual(craftsForPairTarget('engineering+alchemy'));
    const low = classifyCraftTrend({ tailoring: 10, inscription: 12 });
    expect(low).toEqual({
      pairId: 'tailoring+inscription',
      crafts: ['tailoring', 'inscription'],
      score: 22,
      crossed: false,
    });
  });

  it('breaks a sum tie by the higher minimum member skill', () => {
    // engineering+alchemy and tailoring+inscription both sum to 30; the
    // tailoring pair's weakest member (15) beats the alchemy pair's (5).
    const trend = classifyCraftTrend({
      engineering: 25,
      alchemy: 5,
      tailoring: 15,
      inscription: 15,
    });
    expect(trend).toEqual({
      pairId: 'tailoring+inscription',
      crafts: ['tailoring', 'inscription'],
      score: 30,
      crossed: true,
    });
  });

  it('a single-craft specialist selects the pair that craft leads (first-member tie-break)', () => {
    // jewelcrafting+weaponcrafting and weaponcrafting+armorcrafting tie on
    // score (30) and on min member (0); the FIRST ring member's skill
    // (weaponcrafting 30 vs jewelcrafting 0) decides.
    const trend = classifyCraftTrend({ weaponcrafting: 30 });
    expect(trend).toEqual({
      pairId: 'weaponcrafting+armorcrafting',
      crafts: ['weaponcrafting', 'armorcrafting'],
      score: 30,
      crossed: true,
    });
  });

  it('falls back to ring order when score, min member, and first member all tie', () => {
    // Every craft at 10: all ten pairs tie on score 20, min 10, first member
    // 10, so the lowest ring index (engineering+alchemy) wins.
    const uniform: Record<string, number> = {};
    for (const pairId of RING_PAIR_IDS) uniform[pairId.split('+')[0]] = 10;
    expect(classifyCraftTrend(uniform)).toEqual({
      pairId: 'engineering+alchemy',
      crafts: ['engineering', 'alchemy'],
      score: 20,
      crossed: false,
    });
  });

  it('crosses exactly at the threshold: sum 24 is short, sum 25 crosses', () => {
    const short = classifyCraftTrend({ engineering: 12, alchemy: 12 });
    expect(short?.pairId).toBe('engineering+alchemy');
    expect(short?.score).toBe(24);
    expect(short?.crossed).toBe(false);
    const crossed = classifyCraftTrend({ engineering: 12, alchemy: 13 });
    expect(crossed?.pairId).toBe('engineering+alchemy');
    expect(crossed?.score).toBe(25);
    expect(crossed?.crossed).toBe(true);
  });

  it('returns null when no pair has a positive score', () => {
    expect(classifyCraftTrend({})).toBeNull();
    const zero: Record<string, number> = {};
    for (const pairId of RING_PAIR_IDS) zero[pairId.split('+')[0]] = 0;
    expect(classifyCraftTrend(zero)).toBeNull();
    // Non-positive entries count as 0, so a lone negative is still null.
    expect(classifyCraftTrend({ engineering: -5 })).toBeNull();
    // Malformed values never count either: only positive FINITE numbers score,
    // so an Infinity or NaN entry can never classify a pair as crossed.
    expect(classifyCraftTrend({ engineering: Number.POSITIVE_INFINITY })).toBeNull();
    expect(classifyCraftTrend({ engineering: Number.NaN })).toBeNull();
  });

  it('is deterministic and never mutates its input', () => {
    const input = { engineering: 20, alchemy: 30, cooking: 7 };
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(classifyCraftTrend(input)).toEqual(classifyCraftTrend(input));
    expect(input).toEqual(snapshot);
    // A frozen input throws on any write in strict mode, so a clean call on it
    // doubles as the no-write proof.
    const frozen = Object.freeze({ ...input });
    expect(classifyCraftTrend(frozen)).toEqual(classifyCraftTrend(input));
  });
});
