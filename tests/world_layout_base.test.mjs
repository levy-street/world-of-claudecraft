import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { canonicalWorldLayoutBase } from '../scripts/lib/world_layout_base.mjs';

it('re-exports canonical data with a previous nonempty layout installed, without modifying that file', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'layout-base-test-'));
  const active = path.join(scratch, 'sim/world_layout/active.ts');
  mkdirSync(path.dirname(active), { recursive: true });
  const previous = `export const WORLD_LAYOUT = { version: 1, buildings: {}, npcs: { fury: { pos: { x: 900, z: 901 } } }, camps: [{ sources: [{mobId:'forest_wolf', center:{x:-10,z:6}}], placements:[{center:{x:902,z:903},radius:2,count:6}]}], groundObjects:{}, objectMoves:{} };`;
  writeFileSync(active, previous);
  const redirectedActive = {
    name: 'previously-installed-layout-fixture',
    setup(plugin) {
      plugin.onResolve({ filter: /world_layout\/active$/ }, () => ({ path: active }));
      plugin.onResolve({ filter: /^\.\/active$/ }, (args) =>
        args.importer.includes('/world_layout/') ? { path: active } : null,
      );
    },
  };
  async function compile(name, canonical) {
    const outfile = path.join(scratch, `${name}.mjs`);
    await build({
      stdin: {
        contents: `import { BUILTIN_WORLD } from './src/sim/data'; export const value = {npc:BUILTIN_WORLD.npcs.fury.pos, camp:BUILTIN_WORLD.camps[0].center};`,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'silent',
      define: { 'import.meta.env': '{}' },
      plugins: [redirectedActive, ...(canonical ? [canonicalWorldLayoutBase()] : [])],
    });
    return (await import(pathToFileURL(outfile).href)).value;
  }
  try {
    expect(await compile('installed', false)).toEqual({
      npc: { x: 900, z: 901 },
      camp: { x: 902, z: 903 },
    });
    const first = await compile('canonical-first', true);
    expect(first.camp).toEqual({ x: -10, z: 6 });
    expect(first.npc).not.toEqual({ x: 900, z: 901 });
    expect(await compile('canonical-repeat', true)).toEqual(first);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
