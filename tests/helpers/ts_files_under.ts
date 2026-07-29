import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// The shared recursive source walk for guards that scan a directory of .ts
// files. It exists because the single-level `readdirSync(dir).filter(...)` it
// replaces was a silent-coverage bug four times over: #2485 in the professions
// grant sweep, then #2489 in the forbidden-login scan, the S3 emit drift guard,
// and the mobile window scrape. In every case a module moved into a
// subdirectory would leave the scan while the guard stayed green, covering less
// than the day before with no diff for a reviewer to notice.
//
// ONE argument, and it is meant to stay that way. A caller that wants less
// filters the returned list. A caller that wants a genuinely different corpus
// (another extension, absolute paths, a hashed record) writes its own walk
// rather than growing a knob here: the point of this module is one contract
// shared by the guards that want exactly this one, not a walker framework with a
// knob per caller. The concrete case that stayed OUT and then earned a sibling is
// the `src/styles` stylesheet corpus, now helpers/css_tree_under.ts (#2502): five
// readers over that one directory wanted the same walk, and it has to report the
// SUBDIRECTORIES as well, because two of them are single-level by ruling (#2499)
// and refuse rather than narrow. Sibling, still not a knob.

/** One source file found by {@link tsFilesUnder}. */
export interface TsSourceFile {
  /** Path relative to the scan root, joined with forward slashes at every depth. */
  readonly file: string;
  /** Absolute path, for `readFileSync`. */
  readonly full: string;
}

/**
 * Every `.ts` file under `root`, RECURSIVELY, sorted by name within each
 * directory.
 *
 * The sort matters: readdir returns byte-lexicographic order on a dev APFS
 * checkout and hash order on the ext4 CI runner, so an unsorted walk pins a
 * label list that only holds on one of them.
 *
 * Symlinks are followed on BOTH arms, which takes deciding rather than
 * defaulting: a `Dirent` reports lstat, so `isFile()` and `isDirectory()` both
 * read false for one. Gating the file arm on `isFile()` would drop a symlinked
 * module the flat `readdirSync().filter()` reads this replace would have read,
 * and taking `isDirectory()` at face value would drop a whole symlinked
 * subtree. Either is the silent narrowing this module exists to stop, so a
 * symlink is resolved once and treated as whatever it points at. A broken one
 * resolves to neither and, if it is named `.ts`, is still returned, so the
 * consumer's own read fails loudly rather than the file leaving the scan.
 *
 * Walks by hand rather than through `readdirSync`'s `recursive: true`, which
 * emits directory entries into its own result (so a directory named `x.ts`
 * reaches `readFileSync` and throws EISDIR), returns platform-separator paths,
 * and does not sort.
 */
export function tsFilesUnder(root: string): TsSourceFile[] {
  const walk = (dir: string, prefix: string): TsSourceFile[] => {
    const out: TsSourceFile[] = [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (statSync(full, { throwIfNoEntry: false })?.isDirectory() ?? false));
      if (isDir) out.push(...walk(full, `${prefix}${entry.name}/`));
      else if (entry.name.endsWith('.ts')) out.push({ file: `${prefix}${entry.name}`, full });
    }
    return out;
  };
  return walk(root, '');
}
