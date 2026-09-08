import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { SIGNATURE_SFX } from './sfx/signature_sfx.mjs';

const rate = 44100,
  scratch = resolve('node_modules/.cache/signature-sfx');
mkdirSync(scratch, { recursive: true });
for (const cue of SIGNATURE_SFX) {
  const samples = new Float64Array(Math.ceil(cue.duration * rate));
  let seed = 12345 + cue.mode * 997,
    low = 0,
    mid = 0,
    peak = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296) * 2 - 1,
      t = i / rate,
      u = t / cue.duration;
    low += 0.025 * (noise - low);
    mid += 0.22 * (noise - mid);
    const attack = 1 - Math.exp(-t * 90),
      tail = (1 - u) ** 2;
    const freq = cue.base,
      tone = Math.sin(2 * Math.PI * (freq * t - (cue.mode === 3 ? -80 : freq * 0.2) * t * t));
    let s = 0;
    switch (cue.mode) {
      case 0:
        s =
          low * 4 * Math.exp(-t * 1.6) +
          tone * 0.38 * Math.exp(-t * 5) +
          noise * Math.max(0, Math.sin(t * 79)) ** 20 * 0.1;
        break;
      case 1:
        s =
          [1, 1.49, 2.76, 4.12].reduce(
            (v, m) => v + Math.sin(2 * Math.PI * freq * m * t) * Math.exp(-t * (1.8 + m)) * 0.15,
            0,
          ) +
          (noise - mid) * 0.3 * Math.exp(-t * 14);
        break;
      case 2:
        s =
          low * 5 * Math.exp(-t * 2) +
          tone * 0.45 * Math.exp(-t * 7) +
          noise * 0.5 * Math.exp(-t * 55);
        break;
      case 3:
        s =
          tone * 0.16 * (0.5 + 0.5 * Math.sin(t * 29)) ** 4 +
          mid * 0.35 +
          Math.sin(2 * Math.PI * (680 * t + 140 * t * t)) * 0.07;
        break;
      case 4:
        s =
          (tone * 0.24 + Math.sin(2 * Math.PI * freq * 1.006 * t) * 0.2) * Math.sin(Math.PI * u) +
          mid * 0.45;
        break;
      case 5:
        s = [1, 2.01, 2.73, 4.07].reduce(
          (v, m) =>
            v + Math.sin(2 * Math.PI * freq * m * t) * Math.exp(-t * (0.8 + m * 0.35)) * 0.13,
          0,
        );
        break;
      case 6:
        s =
          tone * 0.5 * Math.exp(-t * 17) +
          noise * 0.3 * Math.exp(-t * 32) +
          Math.sin(t * 2 * Math.PI * 1337) * 0.08 * Math.exp(-t * 12);
        break;
      case 7:
        s =
          low * 2.5 +
          tone * 0.24 * (0.6 + 0.4 * Math.sin(t * 37)) +
          Math.sin(2 * Math.PI * freq * 1.51 * t) * 0.1;
        break;
    }
    samples[i] = s * attack * tail;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++)
    wav.writeInt16LE(Math.round((samples[i] / Math.max(peak, 0.001)) * 11000), 44 + i * 2);
  const input = resolve(scratch, `${cue.key}.wav`);
  writeFileSync(input, wav);
  const output = resolve('public/audio/sfx', `${cue.key}.mp3`);
  const result = spawnSync(
    FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-b:a',
      '192k',
      output,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(result.stderr || 'Signature audio encode failed');
  console.log(`${cue.key}: ${cue.duration}s`);
}
