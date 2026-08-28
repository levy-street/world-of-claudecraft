// Render the Solana Seeker engine takes and put them through the SAME conform
// path every other custom source uses, so the shipped files carry the catalog's
// loudness, bitrate, sample rate and channel contract rather than whatever the
// synth happened to produce.
//
//   node scripts/sfx/build_seeker_board_sfx.mjs
//
// Writes public/audio/sfx/mount_run_seeker_board{,_start,_stop}.mp3.
// Run `npm run sfx:manifest` afterwards to refresh the manifest and runtime pack.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conformSfxAudio } from './conform_audio.mjs';
import { FFMPEG_PATH } from './ffmpeg_paths.mjs';
import { RATE, TAKES, wav32 } from './synth_seeker_board.mjs';

const OUT_DIR = path.join(process.cwd(), 'public/audio/sfx');
const ffmpegPath = FFMPEG_PATH;
const scratch = mkdtempSync(path.join(tmpdir(), 'seeker-sfx-'));

/** Peak-normalise with headroom; absolute level is the conform path's call. */
function normalise(buf, peak = 0.89) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return buf;
  const g = peak / max;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}

try {
  for (const [key, render] of Object.entries(TAKES)) {
    const buf = normalise(render());
    const duration = buf.length / RATE;
    const source = path.join(scratch, `${key}.wav`);
    writeFileSync(source, wav32(buf));
    const outputFile = path.join(OUT_DIR, `${key}.mp3`);
    conformSfxAudio({
      inputFile: source,
      outputFile,
      duration,
      ffmpegPath,
      // Mono: these are positional, spatialised at the mount's position.
      channels: 1,
    });
    console.log(`${key.padEnd(34)}${duration.toFixed(2)}s -> ${outputFile}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
