import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifySourceCaveRoster,
  SOURCE_CAVE_ROSTER_MAX,
  withBootTimeout,
} from '../../server/source_cave_boot';
import type { DevLeaderboardEntry } from '../../src/world_api';

function entry(login: string, mergedPrs: number, rank: number): DevLeaderboardEntry {
  return { rank, login, mergedPrs, devTier: 0 };
}

describe('classifySourceCaveRoster', () => {
  it('classifies an empty contributor list as placeholder (undefined roster)', () => {
    const outcome = classifySourceCaveRoster([]);
    expect(outcome.kind).toBe('placeholder');
    expect(outcome.roster).toBeUndefined();
  });

  it('classifies a list under the cap as seeded, mapping every field', () => {
    const contributors = [entry('alpha', 90, 1), entry('bravo', 8, 2)];
    const outcome = classifySourceCaveRoster(contributors);
    expect(outcome.kind).toBe('seeded');
    if (outcome.kind !== 'seeded') throw new Error('unreachable');
    expect(outcome.roster).toEqual([
      { login: 'alpha', mergedPrs: 90, rank: 1 },
      { login: 'bravo', mergedPrs: 8, rank: 2 },
    ]);
  });

  it('classifies a list exactly at the cap as seeded, not capped', () => {
    const contributors = Array.from({ length: 3 }, (_, i) => entry(`c${i}`, 1, i + 1));
    const outcome = classifySourceCaveRoster(contributors, 3);
    expect(outcome.kind).toBe('seeded');
    if (outcome.kind !== 'seeded') throw new Error('unreachable');
    expect(outcome.roster.length).toBe(3);
  });

  it('classifies a list over the cap as capped, slicing to the top N by rank order', () => {
    const contributors = Array.from({ length: 4 }, (_, i) => entry(`c${i}`, 1, i + 1));
    const outcome = classifySourceCaveRoster(contributors, 3);
    expect(outcome.kind).toBe('capped');
    if (outcome.kind !== 'capped') throw new Error('unreachable');
    expect(outcome.roster.map((r) => r.login)).toEqual(['c0', 'c1', 'c2']);
    expect(outcome.totalAvailable).toBe(4);
    expect(outcome.max).toBe(3);
  });

  it('defaults the cap to SOURCE_CAVE_ROSTER_MAX when unspecified', () => {
    const contributors = Array.from({ length: SOURCE_CAVE_ROSTER_MAX + 1 }, (_, i) =>
      entry(`c${i}`, 1, i + 1),
    );
    const outcome = classifySourceCaveRoster(contributors);
    expect(outcome.kind).toBe('capped');
    if (outcome.kind !== 'capped') throw new Error('unreachable');
    expect(outcome.roster.length).toBe(SOURCE_CAVE_ROSTER_MAX);
    expect(outcome.max).toBe(SOURCE_CAVE_ROSTER_MAX);
  });
});

describe('withBootTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the work result when it settles before the timeout', async () => {
    const result = await withBootTimeout(Promise.resolve('ok'), 20_000);
    expect(result).toEqual({ timedOut: false, value: 'ok' });
  });

  it('resolves timed-out when work never settles within the bound', async () => {
    vi.useFakeTimers();
    const stuck = new Promise<string>(() => {}); // never settles
    const done = withBootTimeout(stuck, 20_000);
    await vi.advanceTimersByTimeAsync(20_001);
    await expect(done).resolves.toEqual({ timedOut: true });
  });

  it('does not resolve timed-out before the bound elapses', async () => {
    vi.useFakeTimers();
    const stuck = new Promise<string>(() => {});
    let settled: unknown;
    withBootTimeout(stuck, 20_000).then((r) => {
      settled = r;
    });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(settled).toBeUndefined();
  });
});
