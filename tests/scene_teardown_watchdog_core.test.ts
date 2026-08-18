import { describe, expect, it } from 'vitest';
import {
  armSceneTeardownWatchdog,
  clearSceneTeardownWatchdog,
  consumeSceneTeardownWatchdog,
  createSceneTeardownWatchdogState,
  SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC,
} from '../src/game/scene_teardown_watchdog_core';

describe('scene teardown watchdog core', () => {
  it('pins the grace margin', () => {
    expect(SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC).toBe(1);
  });

  it('consumes one expiry edge at remaining seconds plus the named margin', () => {
    const state = createSceneTeardownWatchdogState();
    armSceneTeardownWatchdog(state, 10, 4);

    expect(
      consumeSceneTeardownWatchdog(state, 10 + 4 + SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC - 0.001),
    ).toBe(false);
    expect(consumeSceneTeardownWatchdog(state, 10 + 4 + SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC)).toBe(
      true,
    );
    expect(consumeSceneTeardownWatchdog(state, 100)).toBe(false);
  });

  it('clears a live deadline and fails safe for invalid remaining time', () => {
    const state = createSceneTeardownWatchdogState();
    armSceneTeardownWatchdog(state, 20, 5);
    clearSceneTeardownWatchdog(state);
    expect(consumeSceneTeardownWatchdog(state, 100)).toBe(false);

    armSceneTeardownWatchdog(state, 30, Number.NaN);
    expect(consumeSceneTeardownWatchdog(state, 30 + SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC)).toBe(true);
  });
});
