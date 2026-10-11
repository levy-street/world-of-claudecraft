// Deterministic, original sampled masters. No rift samples are reused.
// Run: node scripts/gen_hoard_sfx.mjs, then npm run sfx:manifest.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const rate = 44100;
const tau = Math.PI * 2;
const out = join(root, 'public/audio/sfx');
mkdirSync(out, { recursive: true });

function master(key, duration, sample) {
  const count = Math.round(rate * duration);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF');
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
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    wav.writeInt16LE(
      Math.round(Math.max(-0.46, Math.min(0.46, sample(i / rate))) * 32767),
      44 + i * 2,
    );
  }
  const temporary = join(out, `.${key}.source.wav`);
  writeFileSync(temporary, wav);
  try {
    conformSfxAudio({
      inputFile: temporary,
      outputFile: join(out, `${key}.mp3`),
      duration,
      ffmpegPath: FFMPEG_PATH,
      channels: 1,
      preserveLoudness: true,
    });
  } finally {
    rmSync(temporary);
  }
}

let seed = 0x482ead;
let rumble = 0;
master('hoard_entrance_open', 1.65, (t) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const noise = seed / 2147483648 - 1;
  rumble += (noise - rumble) * 0.055;
  const earth = (rumble * 1.6 + noise * 0.08) * Math.exp(-t * 6) * Math.min(1, t * 160);
  const woodTime = Math.max(0, t - 0.18);
  const envelope = t > 0.18 ? Math.sin(Math.min(1, woodTime / 1.25) * Math.PI) ** 2 : 0;
  const friction = 0.55 + 0.45 * Math.sin(tau * (19 * woodTime + 6 * woodTime * woodTime));
  const creak =
    (Math.sin(tau * (173 * woodTime - 37 * woodTime * woodTime)) +
      0.3 * Math.sin(tau * (347 * woodTime - 61 * woodTime * woodTime))) *
    envelope *
    friction *
    0.09;
  const latchTime = Math.max(0, t - 1.08);
  const latch = t > 1.08 ? Math.sin(tau * 93 * latchTime) * Math.exp(-latchTime * 26) * 0.14 : 0;
  return earth + creak + latch;
});

// Integer-cycle harmonics and modulation close continuously at eight seconds.
master(
  'hoard_entrance_hum',
  8,
  (t) =>
    (Math.sin(tau * 82 * t) * 0.12 +
      Math.sin(tau * 123 * t) * 0.035 +
      Math.sin(tau * 164 * t) * 0.018) *
    (0.87 + 0.13 * Math.cos((tau * t) / 8)),
);
console.log('Authored Buried Hoard reveal and warm hum samples.');
