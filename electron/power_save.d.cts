// Hand-written declarations for electron/power_save.cjs so the Vitest suite
// (tests/electron_power_save.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as desktop_prefs.d.cts).

export interface PowerSaveDeps {
  start: (type: string) => number;
  stop: (id: number) => unknown;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  idleMs?: number;
  minPingIntervalMs?: number;
}

export interface PowerSave {
  notifyActivity: () => void;
  setHidden: (hidden: unknown) => void;
  shutdown: () => void;
}

export const POWER_SAVE_IDLE_MS: number;
export const POWER_SAVE_MIN_PING_INTERVAL_MS: number;
export function createPowerSave(deps: PowerSaveDeps): PowerSave;
