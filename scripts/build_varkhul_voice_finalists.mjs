// Render the two Varkhul performances selected during review with reversible
// final treatments. The selected source files and original copies stay untouched.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  buildVarkhulFinalistFilter,
  VARKHUL_FINALIST_TREATMENTS,
  VARKHUL_FINALISTS,
} from './voices/varkhul_voice_finalists.mjs';

const root = process.cwd();
const force = process.argv.slice(2).includes('--force');
const unknown = process.argv.slice(2).find((arg) => arg !== '--force');
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const auditionRoot = path.join(root, 'tmp', 'raid-boss-voice-auditions', 'varkhul');
const sourceDir = path.join(auditionRoot, 'nonhuman-review');
const outputDir = path.join(auditionRoot, 'finalists-review');
mkdirSync(outputDir, { recursive: true });

const rendered = [];
let outputIndex = 0;
for (const finalist of VARKHUL_FINALISTS) {
  const input = path.join(sourceDir, finalist.source);
  if (!existsSync(input)) throw new Error(`Missing Varkhul finalist source: ${input}`);

  for (const treatment of VARKHUL_FINALIST_TREATMENTS) {
    outputIndex += 1;
    const prefix = String(outputIndex).padStart(2, '0');
    const outputName = `${prefix}-${finalist.id}-${treatment.id}.mp3`;
    const output = path.join(outputDir, outputName);
    if (existsSync(output) && !force) {
      throw new Error(`Output already exists: ${output}. Pass --force to replace it.`);
    }

    const filter = buildVarkhulFinalistFilter(treatment.id);
    if (filter === null) {
      copyFileSync(input, output);
    } else {
      const result = spawnSync(
        FFMPEG_PATH,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          force ? '-y' : '-n',
          '-i',
          input,
          '-filter_complex',
          filter,
          '-map',
          '[out]',
          '-ac',
          '1',
          '-ar',
          '44100',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '192k',
          output,
        ],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
      }
    }

    rendered.push({
      finalist: finalist.id,
      source: finalist.source,
      treatment: treatment.id,
      treatmentLabel: treatment.label,
      output: outputName,
    });
    console.log(`saved ${path.relative(root, output)}`);
  }
}

writeFileSync(
  path.join(outputDir, 'review.json'),
  `${JSON.stringify({ boss: 'varkhul', clips: rendered }, null, 2)}\n`,
);
console.log(`Varkhul finalists: ${path.relative(root, outputDir)}`);
