// Hand-written declarations for electron/notify_guard.cjs so the Vitest suite
// (tests/electron_notify_guard.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as power_save.d.cts).

export interface NotifyGuardDeps {
  now: () => number;
  minIntervalMs?: number;
  sessionMax?: number;
}

export interface NotifyGuard {
  allow: (kind: unknown) => boolean;
}

export const MAX_NOTIFICATIONS_PER_SESSION: number;
export const NOTIFY_MIN_INTERVAL_MS: number;
export function createNotifyGuard(deps: NotifyGuardDeps): NotifyGuard;
