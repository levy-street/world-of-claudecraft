// Hand-written declarations for electron/updater.cjs so the Vitest suite
// (tests/electron_update_cadence.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts). Only the pure,
// electron-free surface is declared; initUpdater's runtime deps are injected.

export const FIRST_CHECK_DELAY_MS: number;
export const RECHECK_INTERVAL_MS: number;

export function updaterRequireCandidates(isPackaged?: boolean): string[];

export function loadAutoUpdater(opts?: { isPackaged?: boolean }): unknown;

export function initUpdater(deps: {
  ipcMain: unknown;
  log: unknown;
  getWindow: () => unknown;
  isTrusted: (event: unknown) => boolean;
  isPackaged?: boolean;
}): unknown;
