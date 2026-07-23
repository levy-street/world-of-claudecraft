import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyRewardTaskSeed } from '../server/daily_rewards_db';
import {
  buildSeedKey,
  dailyRewardSeedGateSizeForTests,
  resetDailyRewardSeedGateForTests,
  runSeedOnce,
} from '../server/daily_rewards_seed_gate';

function task(overrides: Partial<DailyRewardTaskSeed> = {}): DailyRewardTaskSeed {
  return {
    id: 'quest_completion',
    type: 'quest',
    title: 'Complete a quest',
    description: 'Turn in any quest',
    points: 20,
    sortOrder: 0,
    ...overrides,
  };
}

const CONFIG = { prizePoolUsd: 150, wocUsdPrice: 0.5, tasks: [task()] };

// A microtask flush: runSeedOnce schedules its seed thunk on a microtask, so let
// pending .then callbacks run before asserting call counts.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('daily rewards seed gate', () => {
  beforeEach(() => {
    resetDailyRewardSeedGateForTests();
  });

  describe('key composition', () => {
    it('is stable for the same day, realm, and config', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).toBe(
        buildSeedKey('2026-07-01', 'Claudemoon', CONFIG),
      );
    });

    it('changes when ONLY the day changes', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).not.toBe(
        buildSeedKey('2026-07-02', 'Claudemoon', CONFIG),
      );
    });

    it('changes when ONLY the realm changes', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).not.toBe(
        buildSeedKey('2026-07-01', 'Emberfall', CONFIG),
      );
    });

    it('changes when ONLY prizePoolUsd changes', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).not.toBe(
        buildSeedKey('2026-07-01', 'Claudemoon', { ...CONFIG, prizePoolUsd: 200 }),
      );
    });

    it('changes when ONLY wocUsdPrice changes', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).not.toBe(
        buildSeedKey('2026-07-01', 'Claudemoon', { ...CONFIG, wocUsdPrice: 0.75 }),
      );
    });

    it('changes when ONLY the tasks array changes', () => {
      expect(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG)).not.toBe(
        buildSeedKey('2026-07-01', 'Claudemoon', {
          ...CONFIG,
          tasks: [task({ points: 25 })],
        }),
      );
    });

    it('treats defaulted fields identically to their explicit equivalents', () => {
      // The signature must apply the SAME default fills seedTasks does
      // (basePoints ?? points, active ?? true, config ?? {}); otherwise two
      // configs that persist byte-identical task rows would get different keys.
      // Crucially this is the UNSAFE direction if it were wrong: two configs that
      // WOULD write different rows must never share a key, so a defaulted field
      // must equal its explicit form, not diverge from it.
      const defaulted = buildSeedKey('2026-07-01', 'Claudemoon', {
        ...CONFIG,
        tasks: [task({ points: 20 })],
      });
      const explicit = buildSeedKey('2026-07-01', 'Claudemoon', {
        ...CONFIG,
        tasks: [task({ points: 20, basePoints: 20, active: true, config: {} })],
      });
      expect(defaulted).toBe(explicit);
    });
  });

  it('runs the seed once per key and skips subsequent calls', async () => {
    let calls = 0;
    const seed = () => {
      calls++;
      return Promise.resolve();
    };
    await runSeedOnce('k', seed);
    await runSeedOnce('k', seed);
    await runSeedOnce('k', seed);
    expect(calls).toBe(1);
  });

  it('gates multiple keys independently (today and yesterday both seed once)', async () => {
    const calls: Record<string, number> = { today: 0, yesterday: 0 };
    const seedFor = (bucket: 'today' | 'yesterday') => () => {
      calls[bucket]++;
      return Promise.resolve();
    };
    await runSeedOnce('today', seedFor('today'));
    await runSeedOnce('yesterday', seedFor('yesterday'));
    await runSeedOnce('today', seedFor('today'));
    await runSeedOnce('yesterday', seedFor('yesterday'));
    expect(calls).toEqual({ today: 1, yesterday: 1 });
    expect(dailyRewardSeedGateSizeForTests()).toBe(2);
  });

  it('gates two realms for the same day independently', async () => {
    const calls: Record<string, number> = { Claudemoon: 0, Emberfall: 0 };
    const seedFor = (realm: 'Claudemoon' | 'Emberfall') => () => {
      calls[realm]++;
      return Promise.resolve();
    };
    await runSeedOnce(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG), seedFor('Claudemoon'));
    await runSeedOnce(buildSeedKey('2026-07-01', 'Emberfall', CONFIG), seedFor('Emberfall'));
    await runSeedOnce(buildSeedKey('2026-07-01', 'Claudemoon', CONFIG), seedFor('Claudemoon'));
    await runSeedOnce(buildSeedKey('2026-07-01', 'Emberfall', CONFIG), seedFor('Emberfall'));
    expect(calls).toEqual({ Claudemoon: 1, Emberfall: 1 });
    expect(dailyRewardSeedGateSizeForTests()).toBe(2);
  });

  it('bounds the memo and evicts the oldest key first', async () => {
    for (let i = 0; i < 300; i++) {
      await runSeedOnce(`k${i}`, () => Promise.resolve());
    }
    // The memo never grows past its bound.
    expect(dailyRewardSeedGateSizeForTests()).toBe(256);
    // The OLDEST key was evicted, so re-requesting it re-runs its (idempotent)
    // write; the newest key is still held and skips. Deleting the eviction
    // block in markSeeded turns the size pin red; evicting newest-first turns
    // the re-run pins red.
    let reseeds = 0;
    await runSeedOnce('k0', () => {
      reseeds++;
      return Promise.resolve();
    });
    expect(reseeds).toBe(1);
    await runSeedOnce('k299', () => {
      reseeds++;
      return Promise.resolve();
    });
    expect(reseeds).toBe(1);
  });

  it('dedupes concurrent callers for the same key onto one in-flight write', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seed = () => {
      calls++;
      return gate;
    };

    const p1 = runSeedOnce('k', seed);
    const p2 = runSeedOnce('k', seed);
    await flush();
    // The second caller joined the in-flight write instead of re-issuing it.
    expect(calls).toBe(1);

    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });

  it('does not strand a key on a failed write: a rejection is retried, then cached', async () => {
    let attempts = 0;
    const failing = () => {
      attempts++;
      return Promise.reject(new Error('seed transaction rolled back'));
    };
    await expect(runSeedOnce('k', failing)).rejects.toThrow('seed transaction rolled back');
    expect(attempts).toBe(1);
    // The failed key was NOT marked seeded and its in-flight entry was evicted.
    expect(dailyRewardSeedGateSizeForTests()).toBe(0);

    // The next caller for the SAME key re-issues the write.
    let secondAttempts = 0;
    await runSeedOnce('k', () => {
      secondAttempts++;
      return Promise.resolve();
    });
    expect(secondAttempts).toBe(1);
    expect(dailyRewardSeedGateSizeForTests()).toBe(1);

    // Now that it resolved, a third caller skips.
    let thirdAttempts = 0;
    await runSeedOnce('k', () => {
      thirdAttempts++;
      return Promise.resolve();
    });
    expect(thirdAttempts).toBe(0);
  });

  it('reset clears the memo', async () => {
    await runSeedOnce('k', () => Promise.resolve());
    expect(dailyRewardSeedGateSizeForTests()).toBe(1);
    resetDailyRewardSeedGateForTests();
    expect(dailyRewardSeedGateSizeForTests()).toBe(0);
    let calls = 0;
    await runSeedOnce('k', () => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(1);
  });
});
