// Offline original masters through the same production conform path as the hatch.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { HOARD_TIDE_MASTERS, renderHoardTideSamples } from './sfx/hoard_tide_samples.mjs';

const out = fileURLToPath(new URL('../public/audio/sfx/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const master of HOARD_TIDE_MASTERS) {
  const samples = renderHoardTideSamples(master.key, master.duration);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++)
    wav.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  const temporary = `${out}.${master.key}.source.wav`;
  writeFileSync(temporary, wav);
  try {
    conformSfxAudio({
      inputFile: temporary,
      outputFile: `${out}${master.key}.mp3`,
      duration: samples.length / 44100,
      ffmpegPath: FFMPEG_PATH,
      channels: 1,
    });
  } finally {
    rmSync(temporary);
  }
}
console.log('Authored tide build, moving rush, crash and contact masters.');
