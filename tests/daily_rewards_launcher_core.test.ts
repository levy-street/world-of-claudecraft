// The pure launcher-poll gate (src/ui/daily_rewards_launcher_core.ts): the
// throttle arithmetic and the force bypass, tested behaviorally so a
// regression in the closed-window poll cadence fails here rather than only
// in the hud.ts source pins.

import { describe, expect, it } from 'vitest';
import {
  DAILY_REWARDS_LAUNCHER_THROTTLE_MS,
  DailyRewardsLauncherPoll,
  shouldRefreshDailyRewardsLauncher,
} from '../src/ui/daily_rewards_launcher_core';
import type { DailyRewardStatus } from '../src/world_api';

describe('shouldRefreshDailyRewardsLauncher', () => {
  it('keeps the closed-window poll floor at five minutes', () => {
    // The literal the hud used to carry inline; open/close/spin freshness is
    // what makes a slow floor safe (see the core header).
    expect(DAILY_REWARDS_LAUNCHER_THROTTLE_MS).toBe(300_000);
  });

  it('suppresses an unforced refresh inside the window and allows it at the boundary', () => {
    const last = 10_000;
    expect(shouldRefreshDailyRewardsLauncher(false, last + 1, last)).toBe(false);
    expect(
      shouldRefreshDailyRewardsLauncher(false, last + DAILY_REWARDS_LAUNCHER_THROTTLE_MS - 1, last),
    ).toBe(false);
    // Inclusive boundary: exactly one throttle window after the stamp fetches.
    expect(
      shouldRefreshDailyRewardsLauncher(false, last + DAILY_REWARDS_LAUNCHER_THROTTLE_MS, last),
    ).toBe(true);
  });

  it('a forced refresh bypasses the window entirely', () => {
    expect(shouldRefreshDailyRewardsLauncher(true, 1, 0)).toBe(true);
  });

  it('respects a caller-provided throttle', () => {
    expect(shouldRefreshDailyRewardsLauncher(false, 99, 0, 100)).toBe(false);
    expect(shouldRefreshDailyRewardsLauncher(false, 100, 0, 100)).toBe(true);
  });

  it('the first unforced tick after boot stays suppressed (boot forces its own)', () => {
    // performance.now() starts near zero, and the stamp starts at zero: the
    // slow poll must not fire immediately at boot; the boot wiring issues a
    // forced refresh instead.
    expect(shouldRefreshDailyRewardsLauncher(false, 5_000, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The poll controller itself (DailyRewardsLauncherPoll). It moved out of
// src/ui/hud.ts in Bank Storage phase 15, and the three claims that used to be
// SOURCE pins over the hud method (the core predicate gates the fetch, the
// stamp is taken before the fetch resolves, both settle arms honour the seq
// guard) are EXECUTED here instead. A regex over a method body could say the
// tokens were present; these say the behaviour is right.
// ---------------------------------------------------------------------------
interface PollHarness {
  poll: DailyRewardsLauncherPoll;
  applied: DailyRewardStatus[];
  failures: number;
  syncs: number;
  fetches: number;
  settle(index: number, status: DailyRewardStatus): void;
  reject(index: number): void;
  setNow(ms: number): void;
  enabled: boolean;
  mounted: boolean;
}

function status(claimed: boolean): DailyRewardStatus {
  return {
    enabled: true,
    eligibility: { eligible: true },
    spin: { claimed },
  } as unknown as DailyRewardStatus;
}

function harness(): PollHarness {
  const pending: { resolve: (s: DailyRewardStatus) => void; reject: () => void }[] = [];
  let now = 0;
  const h: PollHarness = {
    applied: [],
    failures: 0,
    syncs: 0,
    fetches: 0,
    enabled: true,
    mounted: true,
    setNow: (ms) => {
      now = ms;
    },
    settle: (index, s) => pending[index].resolve(s),
    reject: (index) => pending[index].reject(),
    poll: null as unknown as DailyRewardsLauncherPoll,
  };
  h.poll = new DailyRewardsLauncherPoll({
    enabled: () => h.enabled,
    mounted: () => h.mounted,
    syncVisibility: () => {
      h.syncs++;
    },
    fetch: () => {
      h.fetches++;
      return new Promise<DailyRewardStatus>((resolve, reject) => {
        pending.push({ resolve, reject: () => reject(new Error('offline')) });
      });
    },
    applyStatus: (s) => {
      h.applied.push(s);
    },
    onFailure: () => {
      h.failures++;
    },
    now: () => now,
  });
  return h;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('DailyRewardsLauncherPoll', () => {
  it('gates the unforced poll on the shared predicate, and force bypasses it', () => {
    const h = harness();
    h.poll.refresh(true);
    expect(h.fetches).toBe(1);
    // Inside the window: no second fetch, however many ticks arrive.
    h.setNow(DAILY_REWARDS_LAUNCHER_THROTTLE_MS - 1);
    h.poll.refresh();
    h.poll.refresh();
    expect(h.fetches).toBe(1);
    h.setNow(DAILY_REWARDS_LAUNCHER_THROTTLE_MS);
    h.poll.refresh();
    expect(h.fetches).toBe(2);
  });

  it('does nothing at all while disabled or before either button mounts', () => {
    const h = harness();
    h.enabled = false;
    h.poll.refresh(true);
    expect([h.fetches, h.syncs]).toEqual([0, 0]);
    h.enabled = true;
    h.mounted = false;
    h.poll.refresh(true);
    // The visibility sync must not run either: it would paint chrome that does
    // not exist yet, and the mounted() guard is what says it does not.
    expect([h.fetches, h.syncs]).toEqual([0, 0]);
    h.mounted = true;
    h.poll.refresh(true);
    expect([h.fetches, h.syncs]).toEqual([1, 1]);
  });

  it('re-syncs launcher visibility on EVERY tick, even one the throttle refuses', () => {
    // The ordering is the whole claim: syncVisibility runs before the throttle
    // gate, so the chrome's hidden state follows a settings change on the next
    // slow tick instead of once per five minutes. Moving the call below the
    // gate leaves the fetch counts identical, which is why this arm reads the
    // two counters TOGETHER.
    const h = harness();
    h.poll.refresh(true);
    expect([h.fetches, h.syncs]).toEqual([1, 1]);
    h.setNow(1);
    h.poll.refresh();
    expect([h.fetches, h.syncs]).toEqual([1, 2]);
  });

  it('stamps BEFORE the fetch resolves, so a failed fetch still waits out the window', async () => {
    const h = harness();
    // The forced refresh happens at a NONZERO clock on purpose. Stamped at
    // now = 0 the arm is vacuous: the stamp a correct implementation writes is
    // the same 0 the field already holds, so a mutant that never stamps at all
    // looks identical for the whole first throttle window.
    h.setNow(100_000);
    h.poll.refresh(true);
    h.setNow(101_000);
    h.reject(0);
    await flush();
    expect(h.failures).toBe(1);
    // Stamping only on success would retry every tick for every client through
    // a server outage; the conservative face of a missed status is a missing
    // glow, never a wrong one. Just inside the window measured from the stamp,
    // and well PAST one measured from zero, so only a real stamp suppresses it.
    h.setNow(100_000 + DAILY_REWARDS_LAUNCHER_THROTTLE_MS - 1);
    h.poll.refresh();
    expect(h.fetches).toBe(1);
    // ...and the window really does expire, so the suppression above is a
    // throttle rather than a permanently wedged poll.
    h.setNow(100_000 + DAILY_REWARDS_LAUNCHER_THROTTLE_MS);
    h.poll.refresh();
    expect(h.fetches).toBe(2);
  });

  it('drops a superseded response on BOTH settle arms', async () => {
    const h = harness();
    h.poll.refresh(true);
    // A window-pushed status supersedes the in-flight fetch.
    const fresh = status(true);
    h.poll.observeFresh(fresh);
    h.settle(0, status(false));
    await flush();
    // Only the pushed one was applied: the stale then-arm was dropped.
    expect(h.applied).toEqual([fresh]);

    // Same for the catch arm: a superseded FAILURE must not clear a fresher glow.
    h.setNow(DAILY_REWARDS_LAUNCHER_THROTTLE_MS * 2);
    h.poll.refresh(true);
    h.poll.observeFresh(status(false));
    h.reject(1);
    await flush();
    expect(h.failures).toBe(0);
  });

  it('a pushed status stamps the throttle, so the next slow tick adds nothing', () => {
    const h = harness();
    h.setNow(50_000);
    h.poll.observeFresh(status(true));
    expect(h.applied).toHaveLength(1);
    expect(h.fetches).toBe(0);
    h.setNow(50_000 + DAILY_REWARDS_LAUNCHER_THROTTLE_MS - 1);
    h.poll.refresh();
    expect(h.fetches).toBe(0);
    h.setNow(50_000 + DAILY_REWARDS_LAUNCHER_THROTTLE_MS);
    h.poll.refresh();
    expect(h.fetches).toBe(1);
  });
});
