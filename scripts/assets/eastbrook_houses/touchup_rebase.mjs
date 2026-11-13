#!/usr/bin/env node
// The live-world touch-up is bound to a hash of the built-in world it patches. A change to
// native town content (a building's model in eastbrook_layout.ts) moves that hash, and the
// documented rebase is a pure bump of it in the touch-up document, after which the owning
// step (scripts/world_touchup.mjs export) rewrites the document and its generated twin.
// This script works out the new hash, makes that bump and runs the owning step itself.
//
// The generated twin is never left as this script wrote it. The export cannot load while the
// twin still names the old hash (the sim refuses a patch drawn over another world), so the
// twin's base line is moved first, only so that the export can run. The export then rewrites
// the whole file from the document, and a failed export puts both files back as they were.
//
//   node scripts/assets/eastbrook_houses/touchup_rebase.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const doc = 'data/world_touchup/current.map.json';
const generated = 'src/sim/world_touchup.generated.ts';

/** The hash of the built-in world as the source stands now, read with the patch left out. */
async function builtInWorldBase() {
  const temp = mkdtempSync(path.join(tmpdir(), 'woc-touchup-rebase-'));
  try {
    const entry = path.join(temp, 'entry.ts');
    writeFileSync(
      entry,
      `import { BASE_WORLD } from '${path.resolve('src/sim/data.ts')}';\nimport { worldTouchupBase } from '${path.resolve('src/sim/world_touchup.ts')}';\nexport const base = worldTouchupBase(BASE_WORLD);\n`,
    );
    const outfile = path.join(temp, 'entry.mjs');
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'silent',
      define: { 'import.meta.env': '{}' },
      plugins: [
        {
          // the patch itself is left out, so the built-in world can be read without applying it
          name: 'no-touchup',
          setup(b) {
            b.onLoad({ filter: /world_touchup\.generated\.ts$/ }, () => ({
              contents:
                'export const WORLD_TOUCHUP = { version: 1, base: null, changes: {} };\nexport const WORLD_TOUCHUP_SOURCE = null;\n',
              loader: 'ts',
            }));
          },
        },
      ],
    });
    return (await import(pathToFileURL(outfile).href)).base;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const base = await builtInWorldBase();
const docBefore = readFileSync(doc, 'utf8');
const old = JSON.parse(docBefore).meta.overworldBase;
if (old === base) {
  console.log(`touch-up base unchanged: ${base}`);
} else {
  const generatedBefore = readFileSync(generated, 'utf8');
  const baseLine = (hash) => `  "base": ${JSON.stringify(hash)},`;
  if (generatedBefore.split(baseLine(old)).length !== 2)
    throw new Error(`${generated} does not carry the document's base ${old} exactly once`);
  try {
    // the bump: the document's own two mentions of the hash (its base and its id)
    writeFileSync(doc, docBefore.split(old).join(base));
    // not the result, only what lets the export load: the export rewrites this whole file
    writeFileSync(generated, generatedBefore.replace(baseLine(old), baseLine(base)));
    execFileSync('node', ['scripts/world_touchup.mjs', 'export', doc], { stdio: 'inherit' });
    // the document is kept in the repo formatter's layout, so its diff stays the rows changed
    execFileSync('npx', ['@biomejs/biome', 'format', '--write', doc], { stdio: 'inherit' });
  } catch (error) {
    writeFileSync(doc, docBefore);
    writeFileSync(generated, generatedBefore);
    throw error;
  }
  console.log(`touch-up rebased: ${old} -> ${base}`);
}
