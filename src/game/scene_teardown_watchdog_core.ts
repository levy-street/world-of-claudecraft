// Shared client-side scene teardown deadline. Both the camera director and
// HUD overlay arm and consume this state on the mirrored simulation clock,
// so a missing end event cannot leave either surface active indefinitely.

/** Grace after the authored scene end before missing-end teardown fires. */
export const SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC = 1;

export interface SceneTeardownWatchdogState {
  deadlineSec: number | null;
}

export function createSceneTeardownWatchdogState(): SceneTeardownWatchdogState {
  return { deadlineSec: null };
}

/** Arm from either a start duration or reconnect remainingSeconds value. */
export function armSceneTeardownWatchdog(
  state: SceneTeardownWatchdogState,
  nowSec: number,
  remainingSeconds: number,
): void {
  const remaining = Number.isFinite(remainingSeconds) ? Math.max(0, remainingSeconds) : 0;
  state.deadlineSec = nowSec + remaining + SCENE_TEARDOWN_WATCHDOG_MARGIN_SEC;
}

export function clearSceneTeardownWatchdog(state: SceneTeardownWatchdogState): void {
  state.deadlineSec = null;
}

/** Consume one expiry edge so teardown side effects run exactly once. */
export function consumeSceneTeardownWatchdog(
  state: SceneTeardownWatchdogState,
  nowSec: number,
): boolean {
  if (state.deadlineSec === null || nowSec < state.deadlineSec) return false;
  state.deadlineSec = null;
  return true;
}
