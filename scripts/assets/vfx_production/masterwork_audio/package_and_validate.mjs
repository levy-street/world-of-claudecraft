// Preserve authored envelopes with linear peak-constrained normalization.
// Canonical repository helpers measure and classify the actual encoded result.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const game = resolve(process.argv[2] ?? join(root, '../woc-vfx-studio'));
const helper = await import(pathToFileURL(join(game, 'scripts/sfx/conform_audio.mjs')));
const { FFMPEG_PATH, FFPROBE_PATH } = await import(
  pathToFileURL(join(game, 'scripts/sfx/ffmpeg_paths.mjs'))
);
const manifest = JSON.parse(readFileSync(join(root, 'asset_manifest.json'), 'utf8'));
mkdirSync(join(root, 'runtime'), { recursive: true });
const results = [];
for (const entry of manifest.entries) {
  const inputFile = join(root, entry.master),
    outputFile = join(root, entry.file);
  const sourcePeakDb = helper.measureSfxTruePeakDb(inputFile, FFMPEG_PATH);
  const sourceLufs =
    entry.durationSeconds >= 1 ? helper.measureSfxLufs(inputFile, FFMPEG_PATH) : null;
  const desiredGainDb = sourceLufs === null ? -6.25 - sourcePeakDb : -14 - sourceLufs;
  let gainDb = Math.min(desiredGainDb, -6.25 - sourcePeakDb);
  let inspect;
  const safetyCorrections = [];
  for (let i = 0; i < 10; i++) {
    // The standard explicitly accepts quieter, peak-constrained long cues.
    // A linear gain preserves the designed material decay and dry contact.
    execFileSync(
      FFMPEG_PATH,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        inputFile,
        '-af',
        `volume=${gainDb.toFixed(6)}dB`,
        '-ar',
        '44100',
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '192k',
        '-write_xing',
        '1',
        outputFile,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    inspect = helper.inspectSfxConformance(outputFile, {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
    });
    if (inspect.peakDb <= -6.1) break;
    gainDb -= inspect.peakDb + 6.3;
    safetyCorrections.push({ gainDb, priorTruePeakDbfs: inspect.peakDb });
  }
  const conform = {
    method: 'linear peak-constrained normalization from pristine WAV',
    sourcePeakDb,
    sourceLufs,
    desiredGainDb,
    gainDb,
    peakLimited: gainDb < desiredGainDb - 0.5,
    policy:
      'sound_effects.md peak-safety binding constraint; validated by repository inspectSfxConformance/classify',
  };
  const pcm = execFileSync(
    FFMPEG_PATH,
    ['-v', 'error', '-i', outputFile, '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  const count = pcm.byteLength / 4;
  let power = 0,
    differencePower = 0,
    min = Infinity,
    max = -Infinity,
    nan = 0;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const x = pcm.readFloatLE(i * 4);
    if (!Number.isFinite(x)) nan++;
    min = Math.min(min, x);
    max = Math.max(max, x);
    power += x * x;
    if (i) differencePower += (x - previous) ** 2;
    previous = x;
  }
  const loopStartSample = entry.loop ? Math.round(entry.loopStart * 44100) : 0;
  const loopEndSample = entry.loop ? Math.round(entry.loopEnd * 44100) : count;
  const seamDelta = Math.abs(
    pcm.readFloatLE(loopStartSample * 4) - pcm.readFloatLE((loopEndSample - 1) * 4),
  );
  const decoded = {
    samples: count,
    durationSeconds: count / 44100,
    samplePeakDbfs: 20 * Math.log10(Math.max(-min, max)),
    rmsDbfs: 10 * Math.log10(power / count),
    nonFiniteSamples: nan,
    loopStartSample: entry.loop ? loopStartSample : null,
    loopEndSample: entry.loop ? loopEndSample : null,
    loopSeamDelta: entry.loop ? seamDelta : null,
    loopSeamVsAdjacentRms: entry.loop ? seamDelta / Math.sqrt(differencePower / (count - 1)) : null,
  };
  const passed =
    inspect.problems.length === 0 &&
    !inspect.reject &&
    inspect.peakDb <= -6 &&
    inspect.sampleRate === 44100 &&
    inspect.channels === 1 &&
    inspect.bitrate === 192 &&
    nan === 0 &&
    Math.abs(decoded.durationSeconds - entry.durationSeconds) < 0.002;
  results.push({
    key: entry.key,
    file: entry.file,
    bytes: statSync(outputFile).size,
    sha256: createHash('sha256').update(readFileSync(outputFile)).digest('hex'),
    passed,
    conform,
    safetyCorrections,
    inspect,
    decoded,
  });
  console.log(
    JSON.stringify({
      key: entry.key,
      passed,
      peak: inspect.peakDb,
      lufs: inspect.lufs,
      bytes: statSync(outputFile).size,
      loopSeam: decoded.loopSeamVsAdjacentRms,
    }),
  );
}
const report = {
  assetCount: results.length,
  allPassed: results.every((r) => r.passed),
  runtimeBytes: results.reduce((v, r) => v + r.bytes, 0),
  verification:
    'Canonical repository post-MP3 conformance plus complete 44.1kHz mono float decode, exact decoded sample counts, finite samples, literal -6dBFS true peak ceiling, and measured loop seam transitions. Auditory listening was not available through an enabled tool.',
  results,
};
writeFileSync(join(root, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.allPassed || report.runtimeBytes > 2 * 1024 * 1024) process.exitCode = 1;
