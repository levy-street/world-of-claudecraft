// Batch armor-variant repaints: every (character, theme) pair through Tripo
// /models/texture with concurrency 3. Resumable: pairs whose output GLB
// already exists are skipped. Run from repo root:
//   node tmp/asset_pipeline/armor_picker/batch_retex.mjs
import { existsSync } from 'node:fs';
import {
  textureModel,
  download,
  getTask,
} from '../lib/tripo.mjs';

const DIR = 'tmp/asset_pipeline/armor_picker';
const STYLE =
  'Keep the flat-shaded stylized low-poly game look with clean saturated colors, ' +
  'and keep the skin, face, hands and hair natural and unchanged.';
const CHARS = {
  warrior: `${DIR}/work/warrior_plain.glb`,
  paladin: `${DIR}/work/paladin_plain.glb`,
  druid: `${DIR}/work/druid_plain.glb`,
  hunter: `${DIR}/work/hunter_chibi.glb`,
  shaman: `${DIR}/work/shaman_chibi.glb`,
};
const THEMES = {
  obsidian:
    'Repaint the armor and clothing as blackened obsidian plate armor with glowing ' +
    'orange lava cracks and ember-gold trim edges.',
  frost:
    'Repaint the armor and clothing as polished frost-blue steel armor with bright ' +
    'silver trim and glowing pale ice-crystal accents.',
  gilded:
    'Repaint the armor and clothing as ivory white ceremonial armor with rich gold ' +
    'filigree trim and deep royal blue cloth accents.',
  verdant:
    'Repaint the armor and clothing as wild leather and bark armor in deep forest ' +
    'greens with moss, carved leaf and vine details and aged bronze buckles.',
};

const jobs = [];
for (const [char, glb] of Object.entries(CHARS)) {
  for (const [theme, ask] of Object.entries(THEMES)) {
    const out = `${DIR}/work/${char}_${theme}_textured.glb`;
    if (existsSync(out)) {
      console.log(`skip ${char}/${theme} (exists)`);
      continue;
    }
    jobs.push({ char, theme, glb, out, prompt: `Low-poly chibi fantasy character. ${ask} ${STYLE}` });
  }
}
console.log(`${jobs.length} repaints to run`);
let next = 0;
let spent = 0;
const failures = [];
async function worker(w) {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      console.log(`[w${w}] start ${j.char}/${j.theme}`);
      const { taskId, task } = await textureModel({
        input: j.glb,
        prompt: j.prompt,
        textureQuality: 'detailed',
        onTaskCreated: (id) => console.log(`[w${w}] ${j.char}/${j.theme} task ${id}`),
      });
      const url = task.output?.model_url ?? task.output?.model_urls?.[0];
      if (!url) throw new Error(`no model_url on ${taskId}`);
      await download(url, j.out);
      const detail = await getTask(taskId);
      const credits = detail?.credits_consumed ?? 0;
      spent += credits;
      console.log(`[w${w}] DONE ${j.char}/${j.theme} (${credits} credits)`);
    } catch (err) {
      failures.push(`${j.char}/${j.theme}: ${err.message}`);
      console.error(`[w${w}] FAIL ${j.char}/${j.theme}: ${err.message}`);
    }
  }
}
await Promise.all([1, 2, 3].map(worker));
console.log(`ALL DONE. credits spent this run: ${spent}. failures: ${failures.length}`);
for (const f of failures) console.log('  FAILED ' + f);
process.exit(failures.length ? 1 : 0);
