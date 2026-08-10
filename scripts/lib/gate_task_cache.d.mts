export const GATE_CACHEABLE_TASKS: readonly string[];
export const GATE_NON_CACHEABLE_TASKS: readonly string[];

export interface CacheTaskInventoryEntry {
  inputs: readonly string[];
  outputs: readonly string[];
}

export const GATE_CACHE_TASK_INVENTORY: Readonly<Record<string, CacheTaskInventoryEntry>>;

export const GATE_TURBO_UI_ARGS: readonly string[];

export function resolveTurboBin(repoRoot: string): string;

export function turboRunArgs(tasks: readonly string[]): string[];

export function isTurboGateStep(cmd: string, args: readonly string[]): boolean;
