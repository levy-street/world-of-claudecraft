// Mech Bird mount SFX assembly: deterministic ffmpeg edits of the hand-authored
// recordings in tmp/asset_src/Mount/Mech_Bird/SFX/ into the four catalog masters:
//
//   mount_run_mech_bird   the per-stride gait beat: Footstep_01 + Footstep_02 +
//                         Footstep_01 (the authored 1-2-1 servo step cycle) at
//                         0.00 / 0.15 / 0.30s, under 0.7s total so each beat
//                         decays before the next 5.8-unit stride fires.
//   mount_idle_mech_bird  the standstill powered-on hum loop. The source is
//                         rotated by half its length with a short crossfade at
//                         the join, so the shipped head/tail are contiguous
//                         source samples and the loop wrap is click-free by
//                         construction.
//   mount_jump_mech_bird  the launch servo one-shot, as recorded.
//   mount_land_mech_bird  the landing clank one-shot, as recorded.
//
// Outputs land as lossless wavs in public/audio/sfx/; run the conform step
// afterwards (scripts/sfx_conform.mjs --fix) to loudness-normalize, downmix,
// and transcode to the shipped mp3 masters, then `npm run sfx:manifest`.
//
// No package.json alias on purpose: tests fingerprint package.json as a
// shipping-asset input (scripts/CLAUDE.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tmp', 'asset_src', 'Mount', 'Mech_Bird', 'SFX');
const OUT = path.join(ROOT, 'public', 'audio', 'sfx');

function ff(args) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

const src = (name) => {
  const p = path.join(SRC, name);
  if (!fs.existsSync(p)) throw new Error(`missing source: ${p}`);
  return p;
};

// The 1-2-1 gait beat. amix normalize=0 keeps authored levels; the conform
// step owns final loudness.
ff([
  '-i',
  src('Mech_Chicken_Footstep_01.wav'),
  '-i',
  src('Mech_Chicken_Footstep_02.wav'),
  '-i',
  src('Mech_Chicken_Footstep_01.wav'),
  '-filter_complex',
  '[1:a]adelay=150|150[s2];[2:a]adelay=300|300[s3];' +
    '[0:a][s2][s3]amix=inputs=3:normalize=0:dropout_transition=0,atrim=0:0.68[out]',
  '-map',
  '[out]',
  path.join(OUT, 'mount_run_mech_bird.wav'),
]);

// The idle hum loop, rotated so the wrap point is mid-recording: second half,
// then a 0.25s crossfade into the first half. Head and tail of the result are
// contiguous samples from the middle of the source, so the runtime loop wrap
// cannot click.
ff([
  '-i',
  src('Mech_Chicken_Idle_v02.wav'),
  '-i',
  src('Mech_Chicken_Idle_v02.wav'),
  '-filter_complex',
  '[0:a]atrim=5.0:9.999,asetpts=PTS-STARTPTS[back];' +
    '[1:a]atrim=0:5.0,asetpts=PTS-STARTPTS[front];' +
    '[back][front]acrossfade=d=0.25:c1=tri:c2=tri[out]',
  '-map',
  '[out]',
  path.join(OUT, 'mount_idle_mech_bird.wav'),
]);

// Jump / land one-shots ship as recorded; conform owns loudness and format.
ff(['-i', src('Mech_Chicken_Jump.wav'), path.join(OUT, 'mount_jump_mech_bird.wav')]);
ff(['-i', src('Mech_Chicken_Land.wav'), path.join(OUT, 'mount_land_mech_bird.wav')]);

console.log('mech bird sfx masters written to public/audio/sfx/ (run conform + manifest next)');
