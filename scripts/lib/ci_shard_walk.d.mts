import type { Dirent } from 'node:fs';

export const SHARD_WALK_SKIP_NAMES: readonly string[];
export function isShardWalkSkipped(name: string): boolean;
export function isShardTestFileName(name: string): boolean;
export function walkShardTestFiles(
  root: string,
  io?: { readdirSync?: (dir: string, opts: { withFileTypes: true }) => Dirent[] },
): string[];
