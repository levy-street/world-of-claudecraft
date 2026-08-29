export function resolveEntryTimeouts(env: Record<string, string | undefined>): {
  navTimeoutMs: number;
  selectorTimeoutMs: number;
};
