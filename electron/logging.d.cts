// Hand-written declarations for electron/logging.cjs so the Vitest suite
// (tests/electron_vendor_loading.test.ts) type-checks its imports. Keep in
// sync with the .cjs exports (same convention as shell_guards.d.cts).

export function logRequireCandidates(isPackaged?: boolean): string[];
export function loadElectronLog(opts?: { isPackaged?: boolean }): unknown;
export function consoleShim(): unknown;
export function initLogging(opts: { isPackaged: boolean }): {
  log: unknown;
  filePath: string | null;
};
