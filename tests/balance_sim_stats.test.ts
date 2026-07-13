import { describe, expect, it } from 'vitest';
import {
  aggregatePvp,
  matchupMatrix,
  mean,
  type PvpOutcome,
  rankBrokenness,
  stddev,
  wilsonInterval,
  zScores,
} from '../scripts/balance_sim/stats';

describe('balance sim statistics', () => {
  it('mean and stddev match hand-computed values', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
    expect(stddev([2, 4, 6])).toBe(2);
    expect(stddev([5])).toBe(0);
  });

  it('wilson interval brackets the observed proportion and tightens with n', () => {
    const small = wilsonInterval(8, 10);
    const large = wilsonInterval(800, 1000);
    expect(small.low).toBeGreaterThan(0.4);
    expect(small.low).toBeLessThan(0.8);
    expect(small.high).toBeGreaterThan(0.8);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
    expect(large.low).toBeGreaterThan(0.77);
    expect(large.high).toBeLessThan(0.83);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('z-scores are zero-centred and flag the outlier', () => {
    const zs = zScores([10, 10, 10, 20]);
    expect(mean(zs)).toBeCloseTo(0, 10);
    expect(zs[3]).toBeGreaterThan(1);
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
  });

  it('aggregatePvp counts wins, losses, and half-weight draws', () => {
    const outcomes: PvpOutcome[] = [
      { aKey: 'x', bKey: 'y', winner: 'a' },
      { aKey: 'x', bKey: 'y', winner: 'a' },
      { aKey: 'x', bKey: 'y', winner: 'b' },
      { aKey: 'x', bKey: 'z', winner: 'draw' },
    ];
    const standings = aggregatePvp(outcomes);
    const x = standings.find((s) => s.key === 'x')!;
    const y = standings.find((s) => s.key === 'y')!;
    const z = standings.find((s) => s.key === 'z')!;
    expect(x.games).toBe(4);
    expect(x.wins).toBe(2);
    expect(x.losses).toBe(1);
    expect(x.draws).toBe(1);
    expect(x.winRate).toBeCloseTo(2.5 / 4, 10);
    expect(y.winRate).toBeCloseTo(1 / 3, 10);
    expect(z.winRate).toBe(0.5);
    expect(standings[0].key).toBe('x');
  });

  it('matchupMatrix reports each direction of a pairing', () => {
    const outcomes: PvpOutcome[] = [
      { aKey: 'x', bKey: 'y', winner: 'a' },
      { aKey: 'x', bKey: 'y', winner: 'a' },
      { aKey: 'x', bKey: 'y', winner: 'draw' },
      { aKey: 'x', bKey: 'y', winner: 'b' },
    ];
    const m = matchupMatrix(outcomes);
    expect(m.x.y).toBeCloseTo(2.5 / 4, 10);
    expect(m.y.x).toBeCloseTo(1.5 / 4, 10);
  });

  it('rankBrokenness averages pvp and inverted pve z-scores', () => {
    const ranking = rankBrokenness(
      [
        { key: 'op', zScore: 2 },
        { key: 'mid', zScore: 0 },
        { key: 'weak', zScore: -2 },
      ],
      [
        // Fast kills = negative time z-score = positive contribution.
        { key: 'op', zScore: -2 },
        { key: 'mid', zScore: 0 },
        { key: 'weak', zScore: 2 },
      ],
    );
    expect(ranking[0]).toMatchObject({ key: 'op', brokenScore: 2, verdict: 'overpowered' });
    expect(ranking[1]).toMatchObject({ key: 'mid', brokenScore: 0, verdict: 'balanced' });
    expect(ranking[2]).toMatchObject({ key: 'weak', brokenScore: -2, verdict: 'underpowered' });
  });

  it('rankBrokenness handles a spec missing one dimension, in both directions', () => {
    const pvpOnly = rankBrokenness([{ key: 'pvp_only', zScore: 1 }], []);
    expect(pvpOnly[0].brokenScore).toBe(1);
    expect(pvpOnly[0].pveZ).toBeNull();
    const pveOnly = rankBrokenness([], [{ key: 'pve_only', zScore: -1 }]);
    expect(pveOnly[0].brokenScore).toBe(1);
    expect(pveOnly[0].pvpZ).toBeNull();
  });

  it('rankBrokenness marks the intermediate strong and weak bands', () => {
    const ranking = rankBrokenness(
      [
        { key: 'strongish', zScore: 1 },
        { key: 'weakish', zScore: -1 },
      ],
      [
        { key: 'strongish', zScore: -1 },
        { key: 'weakish', zScore: 1 },
      ],
    );
    expect(ranking.find((r) => r.key === 'strongish')?.verdict).toBe('strong');
    expect(ranking.find((r) => r.key === 'weakish')?.verdict).toBe('weak');
  });
});
