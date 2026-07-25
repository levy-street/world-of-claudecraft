// The pure launcher-poll gate (src/ui/daily_rewards_launcher_core.ts): the
// throttle arithmetic and the force bypass, tested behaviorally so a
// regression in the closed-window poll cadence fails here rather than only
// in the hud.ts source pins.

import { describe, expect, it } from 'vitest';
import {
  DAILY_REWARDS_LAUNCHER_THROTTLE_MS,
  shouldRefreshDailyRewardsLauncher,
} from '../src/ui/daily_rewards_launcher_core';

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
