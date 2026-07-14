// Guards the scripts/ tooling against the Windows path-resolution trap:
// `new URL(import.meta.url).pathname` keeps a leading slash before a drive
// letter ("/D:/..."), which path.resolve/path.dirname then mangle into
// "D:\D:\...", so any script resolving its repo root that way cannot run on
// Windows at all. The portable form is fileURLToPath(import.meta.url)
// (node:url), correct on every OS; see scripts/assets/build_assets.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsRoot = join(repoRoot, 'scripts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(?:mjs|cjs|js|ts)$/.test(name) && !/\.d\.m?ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('scripts/ Windows path safety', () => {
  it('no script takes .pathname off a file URL (breaks on Windows drive letters)', () => {
    const banned = /new URL\([^)]*import\.meta\.url[^)]*\)\s*\.pathname/;
    const offenders = walk(scriptsRoot)
      .filter((file) => banned.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file));
    expect(
      offenders,
      `use path.dirname(fileURLToPath(import.meta.url)) from node:url instead: ${offenders.join(', ')}`,
    ).toEqual([]);
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
