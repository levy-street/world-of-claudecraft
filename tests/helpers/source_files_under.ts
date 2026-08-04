import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

// The shared recursive walk for guards whose corpus is SOURCE files rather than
// the `.ts` modules helpers/ts_files_under.ts returns. Same contract, same
// reasoning (a single-level `readdirSync().filter()` is silent-coverage debt:
// #2485, #2489, #2502), different extension set.
//
// A sibling rather than a knob on ts_files_under.ts, which is `.ts`-only by
// explicit ruling and directs a caller wanting another extension to write its
// own walk. Writing that walk per caller is how the extension policy ends up
// restated, and drifting, in each guard, so the policy lives HERE, once: the
// shader-domain guard needs the `.js`/`.mjs` half of the tree because the
// offline asset-pipeline inspector ships its own JS copy of the weapon shaders,
// and it needs standalone shader files because a `.frag` that never existed on
// the day a guard was written is exactly the file that leaves the scan silently.
//
// SOURCE_EXTENSIONS is therefore the complete policy, deliberately wider than
// today's tree: every GLSL string in this repo currently lives in a TS/JS
// template literal, and no `.glsl`, `.frag` or `.vert` file exists yet. Listing
// them costs nothing and means the first one added is scanned rather than
// ignored.

/** The complete source-extension policy for guards that scan a source tree. */
export const SOURCE_EXTENSIONS = [
  // The JS/TS module family, in every spelling this repo's toolchain resolves.
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  // Standalone shader sources. None exist today; see the header.
  '.glsl',
  '.frag',
  '.vert',
] as const;

/** One source file found by {@link sourceFilesUnder}. */
export interface SourceFile {
  /** Path relative to the scan root, joined with forward slashes at every depth. */
  readonly file: string;
  /** Absolute path, for `readFileSync`. */
  readonly full: string;
}

/** Options for {@link sourceFilesUnder}. */
export interface SourceWalkOptions {
  /**
   * Directory NAMES never descended into, matched at any depth. Only for
   * directories a scan must not read at all (`node_modules`, generated bundles);
   * a caller that merely wants fewer results filters the returned list.
   */
  readonly skipDirectories?: Iterable<string>;
}

/** `.d.ts` is a declaration, never a shader host, and its `pow` is a type. */
const DECLARATION = /\.d\.[cm]?ts$/;

function hasSourceExtension(name: string): boolean {
  if (DECLARATION.test(name)) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Every source file under `root`, RECURSIVELY, sorted by name within each
 * directory. See {@link SOURCE_EXTENSIONS} for what counts as a source file.
 *
 * The sort matters: readdir returns byte-lexicographic order on a dev APFS
 * checkout and hash order on the ext4 CI runner, so an unsorted walk pins a
 * label list that only holds on one of them.
 *
 * Symlinks are followed on BOTH arms, for the reason ts_files_under.ts spells
 * out: a `Dirent` reports lstat, so `isFile()` and `isDirectory()` both read
 * false for one, and gating on either drops a linked module or a whole linked
 * subtree out of the scan. Two things this walk adds on top, because following
 * links unconditionally is what makes them possible:
 *
 * - A directory's resolved realpath is visited AT MOST ONCE. Without that, a
 *   link pointing at one of its own ancestors recurses until the process dies,
 *   taking the whole suite's collection with it, and two links to one subtree
 *   return every file in it twice, which double-counts any per-file pin.
 * - A directory link resolving OUTSIDE the root THROWS, naming both paths. It
 *   refuses rather than filtering, the ruling of #2499: silently skipping it
 *   would narrow the scan invisibly, and silently following it would put files
 *   no reviewer of this repo can see into a corpus pinned as a file set.
 *
 * Walks by hand rather than through `readdirSync`'s `recursive: true`, which
 * emits directory entries into its own result (so a directory named `x.ts`
 * reaches `readFileSync` and throws EISDIR), returns platform-separator paths,
 * and does not sort.
 */
export function sourceFilesUnder(root: string, options: SourceWalkOptions = {}): SourceFile[] {
  const skip = new Set(options.skipDirectories ?? []);
  const rootReal = realpathSync(root);
  const visited = new Set<string>([rootReal]);

  const walk = (dir: string, prefix: string): SourceFile[] => {
    const out: SourceFile[] = [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (statSync(full, { throwIfNoEntry: false })?.isDirectory() ?? false));
      if (isDir) {
        const real = realpathSync(full);
        if (!contains(rootReal, real)) {
          throw new Error(
            `sourceFilesUnder: ${full} links outside the scan root (${real} is not under ${rootReal})`,
          );
        }
        if (visited.has(real)) continue;
        visited.add(real);
        out.push(...walk(full, `${prefix}${entry.name}/`));
      } else if (hasSourceExtension(entry.name)) {
        out.push({ file: `${prefix}${entry.name}`, full });
      }
    }
    return out;
  };

  return walk(root, '');
}
