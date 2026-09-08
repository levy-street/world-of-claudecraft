// Packs only the curated Fury takes through the existing conformance path.
// Raw provider outputs and onset choices stay in tmp/fury-audio for review.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conformSfxAudio, probeSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH, FFPROBE_PATH } from './sfx/ffmpeg_paths.mjs';
import { FURY_SFX } from './sfx/fury_sfx.mjs';

const root = 'tmp/fury-audio';
mkdirSync(join(root, 'curated'), { recursive: true });
const review = [];
for (const cue of FURY_SFX)
  for (let take = 1; take <= cue.variants.length; take++) {
    const filename = `${cue.key}_${take}.mp3`;
    const raw = join(root, 'raw', filename);
    if (!existsSync(raw)) throw new Error(`Missing raw take ${filename}`);
    const pcm = execFileSync(FFMPEG_PATH, [
      '-v',
      'error',
      '-i',
      raw,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-f',
      'f32le',
      'pipe:1',
    ]);
    const values = new Float32Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
    let peak = 0;
    for (const value of values) peak = Math.max(peak, Math.abs(value));
    if (peak < 0.005) throw new Error(`Silent take ${filename}`);
    const first = values.findIndex((value) => Math.abs(value) > peak * 0.15);
    const onset = Math.max(0, first / 44100 - 0.004);
    const curated = join(root, 'curated', filename.replace('.mp3', '.wav'));
    const fade = 0.035;
    execFileSync(FFMPEG_PATH, [
      '-v',
      'error',
      '-y',
      '-i',
      raw,
      '-af',
      `atrim=start=${onset}:duration=${cue.duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.002,afade=t=out:st=${cue.duration - fade}:d=${fade}`,
      '-ac',
      '1',
      '-ar',
      '44100',
      curated,
    ]);
    const outputFile = join('public/audio/sfx', filename);
    const conform = conformSfxAudio({
      inputFile: curated,
      outputFile,
      duration: cue.duration,
      ffmpegPath: FFMPEG_PATH,
      channels: 1,
    });
    review.push({
      filename,
      onset,
      intendedDuration: cue.duration,
      sourcePeak: peak,
      conform,
      output: probeSfxAudio(outputFile, FFPROBE_PATH),
    });
  }
writeFileSync(join(root, 'conformance-review.json'), JSON.stringify(review, null, 2) + '\n');
console.log(`Conformed ${review.length} Fury takes; onset choices retained for auditory review`);
