import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// The shared walk for the guards that scan a directory of STYLESHEETS, the
// counterpart to helpers/ts_files_under.ts for `src/styles`. It is a separate
// module rather than an extension knob on that one because that module's header
// rules it so: one contract per corpus, and a caller wanting another extension
// keeps its own walk. Five readers over `src/styles` wanted the same one
// (#2502), so this is that one walk shared by them, not a walker framework.
//
// Unlike the .ts walk it returns the SUBDIRECTORIES alongside the files, because
// the `src/styles` readers split two ways (the ruling in #2499). A guard whose
// miss is a silent PASS (a malformed value that the browser drops, an animated
// focus ring, an unbalanced brace) wants every sheet at any depth. A guard that
// models the sheets an entry actually LOADS stays flat on purpose: crediting a
// sheet parked in a subfolder, which no entry imports, would be a false green.
// The flat ones still have to NOTICE a subdirectory rather than quietly covering
// less, and `dirs` lets each check that premise off the same read it already
// does, so no file needs a second directory reader. Deriving it from a `Dirent`
// instead (`entries.some((e) => e.isDirectory())`) misses a symlinked directory,
// which is the same silent narrowing arriving one door over.

/** One stylesheet found by {@link cssTreeUnder}. */
export interface CssSourceFile {
  /** Path relative to the scan root, joined with forward slashes at every depth. */
  readonly file: string;
  /** Absolute path, for `readFileSync`. */
  readonly full: string;
}

/** Everything {@link cssTreeUnder} found under one root. */
export interface CssTree {
  /** Every `.css` file at any depth, sorted by name within each directory. */
  readonly files: CssSourceFile[];
  /**
   * Every subdirectory at any depth, relative to the root and forward-slashed.
   * A directory is listed whether or not it holds a stylesheet, so a
   * flat-by-design consumer refuses the day the directory grows one, not the
   * later day a `.css` lands inside it.
   */
  readonly dirs: string[];
}

/**
 * Every `.css` file under `root`, RECURSIVELY, plus every subdirectory it
 * passed through, sorted by name within each directory.
 *
 * The sort matters: readdir returns byte-lexicographic order on a dev APFS
 * checkout and hash order on the ext4 CI runner, so an unsorted walk pins a
 * label list that only holds on one of them.
 *
 * Symlinks are followed on BOTH arms, for the reasons written out in
 * helpers/ts_files_under.ts: a `Dirent` reports lstat, so `isFile()` and
 * `isDirectory()` both read false for one, and taking either at face value drops
 * a linked sheet or a whole linked subtree silently. A symlink is resolved once
 * and treated as whatever it points at; a broken one resolves to neither and, if
 * it is named `.css`, is still returned so the consumer's own read fails loudly
 * rather than the file leaving the scan. A symlink CYCLE recurses until the
 * stack ends, which is loud in the same way.
 *
 * Walks by hand rather than through `readdirSync`'s `recursive: true`, which
 * emits directory entries into its own result (so a directory named `x.css`
 * reaches `readFileSync` and throws EISDIR), returns platform-separator paths,
 * and does not sort.
 */
export function cssTreeUnder(root: string): CssTree {
  const files: CssSourceFile[] = [];
  const dirs: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (statSync(full, { throwIfNoEntry: false })?.isDirectory() ?? false));
      if (isDir) {
        dirs.push(`${prefix}${entry.name}`);
        walk(full, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.css')) {
        files.push({ file: `${prefix}${entry.name}`, full });
      }
    }
  };
  walk(root, '');
  return { files, dirs };
}
