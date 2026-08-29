// The stuck-custody monitor (server/woc_market_monitor.ts): the consumer of
// the marketplace's "visible and stuck" failure direction. These tests pin
// the cached-read cost model (one refresh per TTL window, shared by every
// caller), the cutoff math the db read receives, the only-when-stuck log
// contract, the staleness stamp, and the cold-failure negative cache.

import { describe, expect, it, vi } from 'vitest';
import type { WocStuckCustodyClasses } from '../../server/woc_market';
import {
  createWocMarketMonitor,
  WOC_MONITOR_BOND_STUCK_AGE_MS,
  WOC_MONITOR_COLD_FAIL_TTL_MS,
  WOC_MONITOR_COUNT_CAP,
  WOC_MONITOR_LOG_INTERVAL_MS,
  WOC_MONITOR_SAMPLE_LIMIT,
  WOC_MONITOR_STALE_WARN_MS,
  WOC_MONITOR_STUCK_AGE_MS,
  WOC_MONITOR_TTL_MS,
} from '../../server/woc_market_monitor';

const emptyClasses = (): WocStuckCustodyClasses => ({
  unbookedClaims: { count: 0, saturated: false, sample: [] },
  stuckDelivering: { count: 0, saturated: false, sample: [] },
  undisposedListings: { count: 0, saturated: false, sample: [] },
  reviewSettlements: { count: 0, saturated: false, sample: [] },
  stuckBonds: { count: 0, saturated: false, sample: [] },
});

describe('woc market stuck-custody monitor', () => {
  it('pins the production knobs as literals', () => {
    // Every test below injects its own overrides, so nothing else would red
    // if a default drifted (a TTL of 0 is a query per request; a 5ms log
    // interval is a flood). One literal pin per knob.
    expect(WOC_MONITOR_TTL_MS).toBe(30_000);
    expect(WOC_MONITOR_STUCK_AGE_MS).toBe(600_000);
    expect(WOC_MONITOR_SAMPLE_LIMIT).toBe(20);
    expect(WOC_MONITOR_COUNT_CAP).toBe(1000);
    expect(WOC_MONITOR_LOG_INTERVAL_MS).toBe(300_000);
    expect(WOC_MONITOR_COLD_FAIL_TTL_MS).toBe(5_000);
    expect(WOC_MONITOR_STALE_WARN_MS).toBe(300_000);
    // The fallback only: main.ts wires the env-derived confirming bound.
    expect(WOC_MONITOR_BOND_STUCK_AGE_MS).toBe(21_600_000);
  });

  it('serves every caller through ONE cached refresh per TTL window', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          calls++;
          return emptyClasses();
        },
      },
      realm: 'r',
      log: () => {},
      now: () => clock,
      ttlMs: 30_000,
    });
    await Promise.all([monitor.read(), monitor.read(), monitor.read()]);
    expect(calls, 'concurrent misses collapse into one flight').toBe(1);
    clock += 29_999;
    await monitor.read();
    expect(calls, 'inside the TTL the installed value serves').toBe(1);
    clock += 2;
    await monitor.read();
    expect(calls, 'past the TTL exactly one refresh runs').toBe(2);
  });

  it('passes the realm, the stuck-age cutoff, the sample cap and the count cap', async () => {
    let seen: {
      realm: string;
      olderThanMs: number;
      limit: number;
      countCap: number;
      bondOlderThanMs: number;
    } | null = null;
    const clock = 5_000_000;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async (realm, olderThanMs, limit, countCap, bondOlderThanMs) => {
          seen = { realm, olderThanMs, limit, countCap, bondOlderThanMs };
          return emptyClasses();
        },
      },
      realm: 'the-realm',
      log: () => {},
      now: () => clock,
      stuckAgeMs: 600_000,
      sampleLimit: 7,
      bondStuckAgeMs: 900_000,
    });
    await monitor.read();
    // The default cap is pinned as the LITERAL, not the imported constant:
    // comparing the constant against itself stayed green at any value.
    expect(seen).toEqual({
      realm: 'the-realm',
      olderThanMs: clock - 600_000,
      limit: 7,
      countCap: 1000,
      bondOlderThanMs: clock - 900_000,
    });
  });

  it('honors a countCap override like every other knob', async () => {
    let seenCap = -1;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async (_realm, _olderThanMs, _limit, countCap) => {
          seenCap = countCap;
          return emptyClasses();
        },
      },
      realm: 'r',
      log: () => {},
      now: () => 0,
      countCap: 9,
    });
    await monitor.read();
    expect(seenCap).toBe(9);
  });

  it('stamps asOfMs inside the refresh so a stale-served readout is datable', async () => {
    let clock = 100_000;
    let fail = false;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          if (fail) throw new Error('db down');
          return emptyClasses();
        },
      },
      realm: 'r',
      log: () => {},
      now: () => clock,
      ttlMs: 10,
    });
    const fresh = await monitor.read();
    expect(fresh.asOfMs).toBe(100_000);
    fail = true;
    clock += 50;
    const stale = await monitor.read();
    expect(stale.asOfMs, 'a stale-serve keeps the LAST refresh stamp').toBe(100_000);
  });

  it('hands out a FROZEN readout: one consumer cannot corrupt the shared value', async () => {
    const readout = emptyClasses();
    readout.unbookedClaims = {
      count: 1,
      saturated: false,
      sample: [{ custodyRef: 'r', claimedAtMs: 1, grantCharacterId: null, mailIntent: false }],
    };
    const monitor = createWocMarketMonitor({
      db: { stuckCustodyReadout: async () => structuredClone(readout) },
      realm: 'r',
      log: () => {},
      now: () => 0,
    });
    const served = await monitor.read();
    expect(Object.isFrozen(served)).toBe(true);
    expect(Object.isFrozen(served.unbookedClaims.sample)).toBe(true);
    expect(Object.isFrozen(served.unbookedClaims.sample[0])).toBe(true);
    // Every class is in the freeze walk, the two newest included.
    expect(Object.isFrozen(served.reviewSettlements)).toBe(true);
    expect(Object.isFrozen(served.reviewSettlements.sample)).toBe(true);
    expect(Object.isFrozen(served.stuckBonds)).toBe(true);
    expect(Object.isFrozen(served.stuckBonds.sample)).toBe(true);
  });

  it('logs ONLY when something is stuck, one line with every class count', async () => {
    const lines: string[] = [];
    let readout = emptyClasses();
    let clock = 0;
    const monitor = createWocMarketMonitor({
      db: { stuckCustodyReadout: async () => structuredClone(readout) },
      realm: 'r',
      log: (line) => lines.push(line),
      now: () => clock,
      ttlMs: 5,
    });
    await monitor.logTick();
    expect(lines, 'a healthy marketplace stays silent').toHaveLength(0);
    readout = emptyClasses();
    readout.stuckDelivering = { count: 2, saturated: false, sample: [] };
    readout.unbookedClaims = { count: 1, saturated: false, sample: [] };
    clock += 10;
    await monitor.logTick();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[woc_market] stuck custody');
    expect(lines[0]).toContain('"unbookedClaims":1');
    expect(lines[0]).toContain('"stuckDelivering":2');
    expect(lines[0]).toContain('"undisposedListings":0');
    expect(lines[0]).toContain('"reviewSettlements":0');
    expect(lines[0]).toContain('"stuckBonds":0');
  });

  it('logs on each stuck class ALONE: every predicate arm carries the line', async () => {
    // One case per class on purpose: a combined fixture would keep this green
    // with an arm deleted from the stuck predicate.
    for (const cls of [
      'unbookedClaims',
      'stuckDelivering',
      'undisposedListings',
      'reviewSettlements',
      'stuckBonds',
    ] as const) {
      const lines: string[] = [];
      const readout = emptyClasses();
      readout[cls] = { count: 3, saturated: false, sample: [] };
      const monitor = createWocMarketMonitor({
        db: { stuckCustodyReadout: async () => structuredClone(readout) },
        realm: 'r',
        log: (line) => lines.push(line),
        now: () => 0,
      });
      await monitor.logTick();
      expect(lines, cls).toHaveLength(1);
      expect(lines[0], cls).toContain(`"${cls}":3`);
    }
  });

  it('warns once per failure streak, even from a cold cache, then recovers', async () => {
    // The cached read's own stale-serve warning needs a first success; a
    // monitor failing from boot (migration lag, revoked grant) must still say
    // so ONCE, not flood, and must recover silently. Clock strides exceed the
    // cold-failure negative-cache window so recovery genuinely re-queries.
    const lines: string[] = [];
    let fail = true;
    let clock = 0;
    const stuck = emptyClasses();
    stuck.unbookedClaims = { count: 1, saturated: false, sample: [] };
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          if (fail) throw new Error('db down');
          return structuredClone(stuck);
        },
      },
      realm: 'r',
      log: (line) => lines.push(line),
      now: () => clock,
      ttlMs: 5,
    });
    await expect(monitor.logTick()).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('stuck custody readout failing');
    clock += 10_000;
    await monitor.logTick();
    expect(lines, 'the streak warns once').toHaveLength(1);
    fail = false;
    clock += 10_000;
    await monitor.logTick();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"unbookedClaims":1');
  });

  it('a warm brownout warns once about staleness instead of going silent', async () => {
    // After one success the cached read stale-serves and never rejects, so
    // without the age check a broken refresh prints the last good counts (or
    // nothing at all) forever, which is exactly the silence the monitor
    // exists to prevent.
    const lines: string[] = [];
    let fail = false;
    let clock = 0;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          if (fail) throw new Error('db down');
          return emptyClasses();
        },
      },
      realm: 'r',
      log: (line) => lines.push(line),
      now: () => clock,
      ttlMs: 10,
    });
    await monitor.logTick();
    expect(lines, 'healthy and empty stays silent').toHaveLength(0);
    fail = true;
    // Past the stale-warn horizon (ttl x 10): the served value is now old.
    clock += 10 * 10 + 1;
    await monitor.logTick();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('STALE');
    clock += 50;
    await monitor.logTick();
    expect(lines, 'the stale streak warns once').toHaveLength(1);
    fail = false;
    clock += 50;
    await monitor.logTick();
    expect(lines, 'a fresh refresh clears the streak silently').toHaveLength(1);
  });

  it('a cold failure short-circuits new flights for the negative-cache window', async () => {
    let calls = 0;
    let clock = 0;
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          calls++;
          throw new Error('db down');
        },
      },
      realm: 'r',
      log: () => {},
      now: () => clock,
      ttlMs: 5,
    });
    await expect(monitor.read()).rejects.toThrow('db down');
    expect(calls).toBe(1);
    clock += WOC_MONITOR_COLD_FAIL_TTL_MS - 1;
    await expect(monitor.read()).rejects.toThrow('db down');
    expect(calls, 'inside the window the cached error serves').toBe(1);
    clock += 2;
    await expect(monitor.read()).rejects.toThrow('db down');
    expect(calls, 'past the window a real flight runs').toBe(2);
  });

  it('start is idempotent and stop really clears the beat', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const monitor = createWocMarketMonitor({
        db: {
          stuckCustodyReadout: async () => {
            calls++;
            return emptyClasses();
          },
        },
        realm: 'r',
        log: () => {},
        ttlMs: 1,
        logIntervalMs: 1000,
      });
      monitor.start();
      monitor.start();
      await vi.advanceTimersByTimeAsync(3000);
      expect(calls, 'one beat per interval, not two').toBe(3);
      await monitor.stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(calls, 'no beats after stop').toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop waits for an in-flight beat, so a shutdown never races the pool', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const monitor = createWocMarketMonitor({
      db: {
        stuckCustodyReadout: async () => {
          await gate;
          return emptyClasses();
        },
      },
      realm: 'r',
      log: () => {},
      now: () => 0,
    });
    const beat = monitor.logTick();
    let stopped = false;
    const stopping = monitor.stop().then(() => {
      stopped = true;
    });
    // Give stop a macrotask's worth of chances to (incorrectly) resolve early.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped, 'stop must not resolve while the beat is in flight').toBe(false);
    release();
    await beat;
    await stopping;
    expect(stopped).toBe(true);
  });
});
