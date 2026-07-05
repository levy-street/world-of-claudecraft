// Before/after spectrograms for the footstep-sound-toggle PR. "Before" is a short
// walk's worth of footfalls (the foot_grass clip retriggered at the run cadence,
// the audio the renderer emits when footsteps are ON). "After" is the same window
// with footsteps OFF — i.e. silence, since footstep() is now a no-op by default.
// Rendered as PNG spectrograms via ffmpeg showspectrumpic so the PR can show the
// gate at a glance. Requires ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'tmp/footstep_toggle';
fs.mkdirSync(OUT, { recursive: true });
const CLIP = 'public/audio/sfx/foot_grass.mp3';
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// ~3s window. At a run, footfalls fire roughly every 0.22s; lay the clip down at
// that cadence (alternating pitch like the engine does) to approximate "ON".
const STEP = 0.22;
const STEPS = Math.floor(3 / STEP);
const inputs = [];
const filters = [];
for (let i = 0; i < STEPS; i++) {
  inputs.push('-i', CLIP);
  const rate = i % 2 === 0 ? 0.97 : 1.04; // left/right foot, mirrors sfx.footstep
  filters.push(`[${i}:a]adelay=${Math.round(i * STEP * 1000)}|${Math.round(i * STEP * 1000)},atempo=1.0,asetrate=44100*${rate},aresample=44100[s${i}]`);
}
const mixInputs = Array.from({ length: STEPS }, (_, i) => `[s${i}]`).join('');
filters.push(`${mixInputs}amix=inputs=${STEPS}:normalize=0,atrim=0:3,asetpts=N/SR/TB[mix]`);

// BEFORE: footsteps on
ff([...inputs, '-filter_complex', `${filters.join(';')}`, '-map', '[mix]', `${OUT}/walk_on.wav`]);
ff(['-i', `${OUT}/walk_on.wav`, '-lavfi', 'showspectrumpic=s=1000x420:legend=1:color=intensity', `${OUT}/spectrogram_before_on.png`]);

// AFTER: footsteps off → the engine emits nothing, so a matched 3s silence.
ff(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '3', `${OUT}/walk_off.wav`]);
ff(['-i', `${OUT}/walk_off.wav`, '-lavfi', 'showspectrumpic=s=1000x420:legend=1:color=intensity', `${OUT}/spectrogram_after_off.png`]);

console.log('wrote', `${OUT}/spectrogram_before_on.png`, 'and', `${OUT}/spectrogram_after_off.png`);
