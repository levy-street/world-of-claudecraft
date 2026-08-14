// Guards the scripts/ AND tests/ tooling against the Windows path-resolution
// trap: `new URL(import.meta.url).pathname` keeps a leading slash before a
// drive letter ("/D:/..."), which path.resolve/path.dirname then mangle into
// "D:\D:\...", so any script resolving its repo root that way cannot run on
// Windows at all. The portable form is fileURLToPath(import.meta.url)
// (node:url), correct on every OS; see scripts/assets/build_assets.mjs.
// Originally scripts/-only (#3225): four tests/ files carried the same trap
// with nothing scanning for it, so the walk now covers both roots.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsRoot = join(repoRoot, 'scripts');
const testsRoot = join(repoRoot, 'tests');

describe('scripts/ and tests/ Windows path safety', () => {
  it('no script or test takes .pathname off a file URL (breaks on Windows drive letters)', () => {
    const banned = /new URL\([^)]*import\.meta\.url[^)]*\)\s*\.pathname/;
    const offenders = [
      ...sourceFilesUnder(scriptsRoot, { skipDirectories: ['node_modules'] }),
      ...sourceFilesUnder(testsRoot, { skipDirectories: ['node_modules'] }),
    ]
      .filter((file) => {
        // Strip comments first: this guard polices CODE, not its own header
        // prose (above) naming the trap, or any future file that documents
        // it too. The line-comment strip keeps a `://` in a URL from eating
        // the rest of its line (same technique as scan_guard_self_audit.ts).
        const code = readFileSync(file.full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        return banned.test(code);
      })
      .map((file) => relative(repoRoot, file.full));
    expect(
      offenders,
      `use path.dirname(fileURLToPath(import.meta.url)) from node:url instead: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('scans source trees only through the shared recursive walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  it('the asset pipeline entries resolve ROOT via fileURLToPath (the fixed form)', () => {
    for (const entry of ['assets/build_assets.mjs', 'assets/build_foliage.mjs']) {
      const src = readFileSync(join(scriptsRoot, entry), 'utf8');
      expect(src, entry).toContain(
        "path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')",
      );
      expect(src, entry).toContain("import { fileURLToPath } from 'node:url';");
    }
  });
});
