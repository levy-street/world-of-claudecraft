// Hand-written declarations for electron/diagnostics.cjs so the Vitest suite
// (tests/electron_diagnostics.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

export const MAX_ERROR_TEXT: number;
export const MAX_FORWARDED_ERRORS: number;
export const MAX_MIRRORED_CONSOLE_LINES: number;

export function flattenControlChars(text: string): string;
export function clampText(value: unknown, maxLength: number): string;
export function redactSecrets(text: string): string;

export interface RendererErrorLogEntry {
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack: string;
  source: string;
  line?: number;
  col?: number;
}
export function rendererErrorLogEntry(payload: unknown): RendererErrorLogEntry | null;

export interface NormalizedConsoleMessage {
  level: string;
  message: string;
  source: string;
}
export function normalizeConsoleMessage(
  details: unknown,
  legacyLevel?: unknown,
  legacyMessage?: unknown,
  legacyLine?: unknown,
  legacySource?: unknown,
): NormalizedConsoleMessage | null;

export function shouldLogConsoleLevel(level: string): boolean;
export function classifyRendererExit(reason: unknown): 'benign' | 'crash';
export function rendererCrashAction(
  recentCrashTimes: number[],
  nowMs: number,
  options?: { windowMs?: number; maxAutoReloads?: number },
): { action: 'reload' | 'dialog'; times: number[] };
