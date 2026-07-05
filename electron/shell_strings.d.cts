// Hand-written declarations for electron/shell_strings.cjs so the Vitest suite
// (tests/electron_shell_strings.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

export interface ShellStrings {
  crashTitle: string;
  crashBody: string;
  crashReload: string;
  crashQuit: string;
  fatalTitle: string;
  fatalBody: string;
}

export const DEFAULT_SHELL_STRINGS: ShellStrings;
export const MAX_SHELL_STRING_LENGTH: number;
export function sanitizeShellStrings(input: unknown, current?: ShellStrings): ShellStrings;
