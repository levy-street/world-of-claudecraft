export const TEST_FILE_RE: RegExp;
export const SKIP_DIRS: readonly string[];

export function isCollectedTestFile(relPath: string): boolean;

export function listTestFiles(io: {
  root: string;
  dir: string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => Array<{ name: string; isDirectory(): boolean }>;
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  sep: string;
}): string[];

export function resolveSelectBase(io: {
  env?: Record<string, string | undefined>;
  run: (cmd: string, args: string[]) => { status: number | null; stdout?: string };
}): { base: string | null; reason: string };

export function listChangedPaths(io: {
  base: string | null;
  run: (cmd: string, args: string[]) => { status: number | null; stdout?: string; stderr?: string };
}): string[];

export function filterExisting(opts: { files: string[]; exists: (p: string) => boolean }): string[];

export function compareSelection(opts: {
  selected: Set<string>;
  fullRan: Set<string>;
  fullFailed: Set<string>;
}): { escapes: string[]; unselected: string[]; selectedCount: number; fullCount: number };

export function chunkFileArgs(opts: { files: string[]; limit?: number }): string[][];
