// Rebuild contact layers from the original September 10 ElevenLabs masters.
// No new generation, pitch randomization, runtime voices or audio timing changes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { conformSfxAudio, inspectSfxConformance } from './conform_audio.mjs';
import { FFMPEG_PATH, FFPROBE_PATH } from './ffmpeg_paths.mjs';

const work = 'tmp/harvest-crunch-audio';
mkdirSync(work, { recursive: true });
const reports = [];
for (const [beat, duration, delay] of [
  ['first', 0.16, 18],
  ['second', 0.16, 20],
  ['finish', 0.25, 42],
]) {
  for (const variant of [1, 2]) {
    const key = `impact_warrior_red_harvest_${beat}_${variant}`;
    const input = `scripts/sfx/sources/harvest/${key}.wav`;
    const layered = `${work}/${key}.wav`;
    const final = beat === 'finish';
    // Three frequency/time envelopes keep the low body, dry blade crack and
    // delayed fibre tear legible as one collision, even through small speakers.
    const filter = [
      '[0:a]asplit=3[b][c][t]',
      `[b]highpass=f=45,lowpass=f=${final ? 280 : 230},acompressor=threshold=0.06:ratio=3:attack=0.1:release=35,volume=${final ? 1.55 : 1.15},afade=t=out:st=0.025:d=${final ? 0.12 : 0.075}[body]`,
      '[c]highpass=f=650,lowpass=f=5500,atrim=end=0.045,afade=t=out:st=0.01:d=0.035,volume=1.3[crack]',
      `[t]highpass=f=250,lowpass=f=4600,afade=t=in:d=0.012,volume=0.7,adelay=${delay}:all=1[tear]`,
      `[body][crack][tear]amix=inputs=3:normalize=0,atrim=end=${duration},afade=t=out:st=${duration - 0.03}:d=0.03[out]`,
    ].join(';');
    execFileSync(FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      '-ar',
      '44100',
      '-ac',
      '1',
      layered,
    ]);
    const output = `public/audio/sfx/${key}.mp3`;
    conformSfxAudio({ inputFile: layered, outputFile: output, duration, ffmpegPath: FFMPEG_PATH });
    // Leave measured headroom for the existing per-key artistic playback trim.
    const attenuated = `${work}/${key}-headroom.wav`;
    execFileSync(FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      output,
      '-af',
      'volume=-3dB',
      '-ar',
      '44100',
      '-ac',
      '1',
      attenuated,
    ]);
    conformSfxAudio({
      inputFile: attenuated,
      outputFile: output,
      duration,
      ffmpegPath: FFMPEG_PATH,
      preserveLoudness: true,
    });
    const report = inspectSfxConformance(output, {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
      preserveLoudness: true,
    });
    if (report.reject || report.problems.length)
      throw new Error(`${key}: ${report.problems.join(', ')}`);
    reports.push({
      key,
      source: input,
      layers: ['body', 'crack', 'tear'],
      tearDelayMs: delay,
      report,
    });
  }
}
writeFileSync(`${work}/conformance.json`, `${JSON.stringify(reports, null, 2)}\n`);
console.log(JSON.stringify(reports));
