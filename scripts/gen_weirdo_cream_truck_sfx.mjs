// Generate the Weirdo Cream truck's two cues from the procedural synth.
//
//   node scripts/gen_weirdo_cream_truck_sfx.mjs
//
// The synthesis lives in scripts/sfx/weirdo_cream_audio.mjs (pure, unit-tested
// in tests/weirdo_cream_audio.test.ts); this entry only renders, writes the
// intermediate WAVs, and hands them to the shared conform step so both clips
// land on the asset standard in docs/design/sound_effects.md.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  CHIME_DURATION,
  ENGINE_DURATION,
  encodeWav,
  renderChime,
  renderEngineChug,
} from './sfx/weirdo_cream_audio.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SFX_DIR = join(REPO_ROOT, 'public/audio/sfx');

const CUES = [
  {
    key: 'mount_chug_weirdo_cream_truck',
    duration: ENGINE_DURATION,
    render: renderEngineChug,
  },
  {
    key: 'mount_chime_weirdo_cream_truck',
    duration: CHIME_DURATION,
    render: renderChime,
  },
];

mkdirSync(SFX_DIR, { recursive: true });
for (const cue of CUES) {
  const output = join(SFX_DIR, `${cue.key}.mp3`);
  const source = join(SFX_DIR, `.${cue.key}.source.wav`);
  rmSync(source, { force: true });
  try {
    writeFileSync(source, encodeWav(cue.render()));
    conformSfxAudio({
      inputFile: source,
      outputFile: output,
      duration: cue.duration,
      ffmpegPath: FFMPEG_PATH,
      channels: 1,
    });
    console.log(`Weirdo Cream SFX: wrote ${output}`);
  } finally {
    rmSync(source, { force: true });
  }
}
