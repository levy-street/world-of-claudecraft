// QA renders: for every (character, theme) with composed atlases, build a
// full-set preview GLB and render hero/front shots via the pipeline previewer.
// Run from repo root: node tmp/asset_pipeline/armor_picker/qa_renders.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const DIR = 'tmp/asset_pipeline/armor_picker';
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
for (const [char, def] of Object.entries(manifest.chars)) {
  for (const theme of manifest.themes) {
    const pairs = Object.entries(def.pieces)
      .filter(([, meta]) => meta.variants[theme])
      .map(([piece, meta]) => `${piece}=${DIR}/${meta.variants[theme]}`);
    if (!pairs.length) continue;
    const outGlb = `${DIR}/work/${char}_${theme}_preview.glb`;
    const outDir = `${DIR}/qa/${char}_${theme}`;
    if (existsSync(`${outDir}/hero.png`)) continue;
    execFileSync('node', [join(SCRIPTS, 'apply_pieces.mjs'), `${DIR}/${def.glb}`, outGlb, ...pairs], {
      stdio: 'inherit',
      env: { ...process.env, APPLY_NO_ANIMS: '1' },
    });
    execFileSync(
      'node',
      ['scripts/asset_pipeline/pipeline.mjs', 'preview', '--file', outGlb, '--out', outDir],
      { stdio: 'ignore' },
    );
    console.log(`rendered ${outDir}`);
  }
}
console.log('qa renders complete');
