// Shared sampled-SFX conformance primitives. The bulk CLI, deterministic UI
// generator, and Studio publisher can all use this module without importing a
// command with top-level side effects.

import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  classify,
  DURATION_THRESHOLD,
  LOSSLESS_EXTENSIONS,
  NORM_TOLERANCE,
  TARGET_BITRATE,
  TARGET_LUFS,
  TARGET_MONO_CHANNELS,
  TARGET_PEAK_DBFS,
  TARGET_SAMPLE_RATE,
  TARGET_STEREO_CHANNELS,
} from './sfx_conform_rules.mjs';

export const SFX_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.aiff',
  '.aif',
  '.ogg',
  '.opus',
  '.m4a',
]);

const MAX_TOOL_OUTPUT = 16 * 1024 * 1024;
const EBUR128_FILTER = 'ebur128=peak=true';

function toolError(binary, detail) {
  return new Error(String(detail).trim() || `${basename(binary)} failed`);
}

function run(binary, args, options = {}) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      maxBuffer: MAX_TOOL_OUTPUT,
      stdio: ['ignore', options.capture ? 'pipe' : 'ignore', options.capture ? 'pipe' : 'ignore'],
    });
  } catch (error) {
    throw toolError(binary, error?.stderr ?? error?.message ?? error);
  }
}

// Async twin of run(..., { capture: true }) for callers that inspect many files
// at once: process creation dominates a short probe (about 25 ms per spawn on
// Windows), so serial spawnSync calls, not the analysis, set the wall clock.
// A tool that exits nonzero fails with the same message as run(); a binary that
// cannot start (ENOENT, EACCES) has no stderr, so both report Node's own launch
// error, which names spawn here and spawnSync there.
function runCaptureAsync(binary, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      { encoding: 'utf8', maxBuffer: MAX_TOOL_OUTPUT },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        reject(toolError(binary, typeof error.code === 'string' ? error.message : stderr));
      },
    );
    // run() gives the tool no stdin; close it so nothing can wait on input.
    child.stdin?.end();
  });
}

function probeArgs(file) {
  return ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file];
}

function parseSfxProbe(output, file) {
  const info = JSON.parse(output);
  const stream = info.streams?.find((value) => value.codec_type === 'audio');
  const duration = Number.parseFloat(info.format?.duration ?? '0');
  // Container overhead dominates very short MP3s, so format.bit_rate can report
  // well above the actual encoded stream rate. The stream value is the quality
  // contract; retain the format value only as a fallback for codecs that omit it.
  const bitrate = Math.round(
    Number.parseInt(stream?.bit_rate ?? info.format?.bit_rate ?? '0', 10) / 1000,
  );
  const sampleRate = Number.parseInt(stream?.sample_rate ?? '0', 10);
  if (!(duration > 0) || !(sampleRate > 0)) {
    throw new Error(`ffprobe returned invalid audio metadata for ${basename(file)}`);
  }
  return {
    duration,
    bitrate,
    sampleRate,
    codec: stream?.codec_name ?? '',
    channels: Number(stream?.channels) || 0,
  };
}

export function probeSfxAudio(file, ffprobePath) {
  return parseSfxProbe(run(ffprobePath, probeArgs(file), { capture: true }), file);
}

function reportArgs(file, filter) {
  return ['-hide_banner', '-nostdin', '-i', file, '-af', filter, '-f', 'null', '-'];
}

function captureFfmpegReport(file, filter, ffmpegPath) {
  const result = spawnSync(ffmpegPath, reportArgs(file, filter), {
    encoding: 'utf8',
    maxBuffer: MAX_TOOL_OUTPUT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || `${basename(ffmpegPath)} failed`).trim());
  }
  return String(result.stderr ?? '');
}

function captureFfmpegReportAsync(file, filter, ffmpegPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, reportArgs(file, filter), {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let stderrBytes = 0;
    let overflow = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      stderrBytes += Buffer.byteLength(chunk);
      if (!overflow && stderrBytes > MAX_TOOL_OUTPUT) {
        overflow = new Error(`${basename(ffmpegPath)} stderr maxBuffer length exceeded`);
        child.kill();
      }
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (overflow) return reject(overflow);
      if (status !== 0) {
        return reject(new Error(String(stderr || `${basename(ffmpegPath)} failed`).trim()));
      }
      resolve(stderr);
    });
  });
}

function parseSfxTruePeakDb(report, file) {
  const match = report.match(/True peak:\s*Peak:\s*(-?inf|[-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*dBFS/i);
  if (!match || match[1].toLowerCase() === '-inf') {
    throw new Error(`ebur128 true-peak parse failed for ${basename(file)}`);
  }
  return Number.parseFloat(match[1]);
}

function parseSfxLufs(report, file) {
  const matches = [...report.matchAll(/I:\s*(-?inf|[-\d.]+)\s*LUFS/gi)];
  const value = matches.at(-1)?.[1];
  if (!value || value.toLowerCase() === '-inf') {
    throw new Error(`ebur128 parse failed for ${basename(file)}`);
  }
  return Number.parseFloat(value);
}

export function measureSfxTruePeakDb(file, ffmpegPath) {
  return parseSfxTruePeakDb(captureFfmpegReport(file, EBUR128_FILTER, ffmpegPath), file);
}

export function measureSfxLufs(file, ffmpegPath) {
  return parseSfxLufs(captureFfmpegReport(file, EBUR128_FILTER, ffmpegPath), file);
}

// measureSfxTruePeakDb and measureSfxLufs run the identical ebur128 pass, so a
// caller that needs both parses one report instead of decoding the file twice.
// LUFS parses first, the order the two separate passes used to run in.
export function measureSfxLoudness(file, ffmpegPath) {
  const report = captureFfmpegReport(file, EBUR128_FILTER, ffmpegPath);
  const lufs = parseSfxLufs(report, file);
  return { lufs, truePeakDb: parseSfxTruePeakDb(report, file) };
}

// MP3 encoding can push a clip's TRUE peak (the oversampled, post-decode
// reconstruction peak measured below) above whatever peak the pre-encode PCM
// signal fed to the encoder actually had; this is the standard lossy-codec
// inter-sample-overshoot problem, not specific to this pipeline. The
// pre-encode limiter ceiling therefore needs real headroom below the actual
// enforced target (TARGET_PEAK_DBFS, verified post-encode below), not a
// magic number decoupled from it: previously this was a hardcoded -1dBFS,
// which was a safe distant ceiling only while TARGET_PEAK_DBFS sat far below
// it (-6dBFS); raising the target closer to -1dBFS would silently let
// LUFS-target (>=1s) clips clip on real playback, since this branch never
// re-measured its own post-encode true peak (see the loop below, now fixed).
const LONG_FORM_LIMIT_DB = TARGET_PEAK_DBFS - 1;
const LONG_FORM_LIMIT = Number((10 ** (LONG_FORM_LIMIT_DB / 20)).toFixed(8));

function filterNumber(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function buildSfxConformArgs({ inputFile, outputFile, duration, gainDb, channels = null }) {
  const normBranch = duration < DURATION_THRESHOLD ? 'peak' : 'lufs';
  if (!Number.isFinite(gainDb)) throw new Error('SFX conformance requires a finite gain');
  if (
    channels !== null &&
    channels !== TARGET_MONO_CHANNELS &&
    channels !== TARGET_STEREO_CHANNELS
  ) {
    throw new Error(
      `SFX channel target must be ${TARGET_MONO_CHANNELS} or ${TARGET_STEREO_CHANNELS}, got ${channels}`,
    );
  }
  const filters = [`volume=${filterNumber(gainDb)}dB`];
  if (normBranch === 'lufs') {
    // Sustained material can have a crest factor that makes -14 LUFS exceed a
    // safe codec peak. A fixed limiter controls only that true-peak edge while
    // the iterative linear gain below closes the integrated-loudness error.
    // This remains an overall-level/peak operation, never a timing or EQ edit.
    filters.push(`alimiter=limit=${LONG_FORM_LIMIT}:attack=5:release=50:level=false:latency=true`);
  }
  filters.push(`aformat=sample_rates=${TARGET_SAMPLE_RATE}`);
  // Channel downmix is an output remap (`-ac`), applied before the encoder and
  // after the level filters so loudness is measured on the retained channels.
  // Omitting `channels` preserves the source channel count (UI generator, Studio).
  const channelArgs = channels === null ? [] : ['-ac', String(channels)];
  return {
    normBranch,
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      inputFile,
      '-af',
      filters.join(','),
      '-ar',
      String(TARGET_SAMPLE_RATE),
      ...channelArgs,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      `${TARGET_BITRATE}k`,
      '-write_xing',
      '1',
      '-map_metadata',
      '-1',
      outputFile,
    ],
  };
}

/** Conform one source to an MP3 without changing or deleting the input file.
 *  `preserveLoudness: true` (a custom/hand-mastered key, see
 *  sfx_conform_inventory.mjs's isCustomMaster) skips loudness re-targeting
 *  entirely: the author's own mix is authoritative, likely measured against a
 *  different metric than this pipeline's integrated-LUFS target (e.g.
 *  momentary LUFS in their own DAW), so re-targeting it here would silently
 *  stack a second, mismatched loudness pass on top of an already-finished
 *  mix. Only the true-peak safety ceiling is enforced, and only downward:
 *  a file already under the ceiling passes through with format-only changes
 *  (bitrate/sample-rate/channels), never gets boosted. */
export function conformSfxAudio({
  inputFile,
  outputFile,
  duration,
  ffmpegPath,
  peakDb = null,
  channels = null,
  preserveLoudness = false,
}) {
  if (preserveLoudness) {
    return conformCustomMaster({ inputFile, outputFile, duration, ffmpegPath, peakDb, channels });
  }
  const normBranch = duration < DURATION_THRESHOLD ? 'peak' : 'lufs';
  const measuredInput =
    normBranch === 'peak'
      ? Number.isFinite(peakDb)
        ? peakDb
        : measureSfxTruePeakDb(inputFile, ffmpegPath)
      : measureSfxLufs(inputFile, ffmpegPath);
  const target = normBranch === 'peak' ? TARGET_PEAK_DBFS : TARGET_LUFS;
  let gainDb = target - measuredInput;
  const temporary = join(
    dirname(outputFile),
    `.${basename(outputFile, extname(outputFile))}.${process.pid}.${randomBytes(6).toString('hex')}.tmp.mp3`,
  );
  const attempts = [];
  let bestPeakSafeAttempt = null;
  // A peak-overshoot correction (below) spends an attempt purely pulling
  // gain down rather than converging LUFS, so the lufs branch gets a larger
  // budget than the simpler peak branch: without it, a file whose peak only
  // transiently overshoots mid-search (but has real headroom overall) could
  // exhaust its attempts before fully reconverging and fall back to a
  // needlessly-quiet peak-safe result instead of a real LUFS match.
  const maxAttempts = normBranch === 'lufs' ? 40 : 16;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const plan = buildSfxConformArgs({
        inputFile,
        outputFile: temporary,
        duration,
        gainDb,
        channels,
      });
      run(ffmpegPath, plan.args);
      // The LUFS branch's pre-encode limiter cannot see MP3's own inter-sample
      // overshoot, so the loudness convergence loop must independently verify
      // the ACTUAL post-encode true peak on every attempt: peak safety is a
      // hard ceiling that wins over hitting the loudness target exactly (a
      // clip landing a little under TARGET_LUFS is fine; one that clips is not).
      // Both figures come from the one ebur128 report.
      const loudness = normBranch === 'lufs' ? measureSfxLoudness(temporary, ffmpegPath) : null;
      const measuredOutput = loudness ? loudness.lufs : measureSfxTruePeakDb(temporary, ffmpegPath);
      const measuredPeakDb = loudness ? loudness.truePeakDb : measuredOutput;
      const peakOver = normBranch === 'lufs' ? measuredPeakDb - TARGET_PEAK_DBFS : 0;
      const error = target - measuredOutput;
      attempts.push({ gainDb: filterNumber(gainDb), measuredOutput, measuredPeakDb, error });
      if (Math.abs(error) <= NORM_TOLERANCE && peakOver <= NORM_TOLERANCE) {
        renameSync(temporary, outputFile);
        return {
          outputFile,
          normBranch,
          inputLevel: measuredInput,
          outputLevel: measuredOutput,
          gainDb: filterNumber(gainDb),
          attempts,
        };
      }
      // A wide-crest-factor source (a sharp transient over a quiet bed) can
      // make TARGET_LUFS structurally unreachable without breaching the peak
      // ceiling: keep the best peak-safe candidate seen so far so the loop can
      // fall back to it (quieter than the nominal target, never clipped)
      // instead of hard-failing content that is safe but merely under-loud.
      if (peakOver <= NORM_TOLERANCE) {
        if (!bestPeakSafeAttempt || measuredOutput > bestPeakSafeAttempt.measuredOutput) {
          bestPeakSafeAttempt = { gainDb, measuredOutput, measuredPeakDb };
        }
      }
      if (peakOver > NORM_TOLERANCE) {
        // Peak is the binding constraint this attempt: pull gain down by the
        // overshoot directly rather than the damped LUFS correction below,
        // which would otherwise keep chasing loudness into more overshoot.
        gainDb -= peakOver;
        continue;
      }
      // MP3 true-peak measurements are quantized and a limiter makes sustained
      // loudness response non-linear. A damped correction avoids oscillating
      // across the tolerance window while still converging quickly.
      gainDb += error * 0.5;
    }
    if (bestPeakSafeAttempt) {
      const plan = buildSfxConformArgs({
        inputFile,
        outputFile: temporary,
        duration,
        gainDb: bestPeakSafeAttempt.gainDb,
        channels,
      });
      run(ffmpegPath, plan.args);
      renameSync(temporary, outputFile);
      return {
        outputFile,
        normBranch,
        inputLevel: measuredInput,
        outputLevel: bestPeakSafeAttempt.measuredOutput,
        gainDb: filterNumber(bestPeakSafeAttempt.gainDb),
        peakLimited: true,
        attempts,
      };
    }
    throw new Error(
      `${normBranch} conformance did not reach ${target} within ${NORM_TOLERANCE}: ${JSON.stringify(attempts)}`,
    );
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Peak-safety-only conform for a preserved-loudness (custom/hand-mastered)
 *  key: never re-targets loudness, only pulls true peak down if it exceeds
 *  the safety ceiling. See conformSfxAudio's preserveLoudness doc comment. */
function conformCustomMaster({ inputFile, outputFile, duration, ffmpegPath, peakDb, channels }) {
  const measuredInput = Number.isFinite(peakDb)
    ? peakDb
    : measureSfxTruePeakDb(inputFile, ffmpegPath);
  const overshoot = measuredInput - TARGET_PEAK_DBFS;
  // Only ever attenuate (never boost): an already-safe file gets format-only
  // changes (bitrate/sample-rate/channels via buildSfxConformArgs's fixed
  // aformat/encoder args), preserving the author's own gain decision exactly.
  let gainDb = overshoot > 0 ? -overshoot : 0;
  const temporary = join(
    dirname(outputFile),
    `.${basename(outputFile, extname(outputFile))}.${process.pid}.${randomBytes(6).toString('hex')}.tmp.mp3`,
  );
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const plan = buildSfxConformArgs({
        inputFile,
        outputFile: temporary,
        duration,
        gainDb,
        channels,
      });
      run(ffmpegPath, plan.args);
      const measuredOutput = measureSfxTruePeakDb(temporary, ffmpegPath);
      const stillOver = measuredOutput - TARGET_PEAK_DBFS;
      if (stillOver <= NORM_TOLERANCE) {
        renameSync(temporary, outputFile);
        return {
          outputFile,
          normBranch: 'preserve',
          inputLevel: measuredInput,
          outputLevel: measuredOutput,
          gainDb: filterNumber(gainDb),
        };
      }
      // MP3 encoding overshoot (see the LONG_FORM_LIMIT_DB comment above) can
      // still leave real peak slightly over even after an attenuating pass;
      // pull down by the residual and re-encode rather than accept a clip.
      gainDb -= stillOver;
    }
    throw new Error(
      `preserved-loudness master could not be brought under ${TARGET_PEAK_DBFS}dBFS true peak`,
    );
  } finally {
    rmSync(temporary, { force: true });
  }
}

function classifyProbe(file, stats, preserveLoudness) {
  const extension = extname(file);
  const isLossless = LOSSLESS_EXTENSIONS.has(extension.toLowerCase());
  const isMp3 = extension === '.mp3' && stats.codec.toLowerCase() === 'mp3';
  const facts = { ...stats, isLossless, isMp3 };
  return { facts, preliminary: classify({ ...facts, preserveLoudness }) };
}

function rejectedInspection(facts, preliminary) {
  return { ...facts, ...preliminary, peakDb: null, lufs: null };
}

function measuredInspection(file, facts, preliminary, report, preserveLoudness) {
  // Measured for BOTH branches: the lufs branch's own loudness figure cannot
  // reveal a true-peak overshoot (see classify's peak check above), so a
  // LUFS-target file needs its real peak measured too, not just its LUFS.
  // LUFS is measured for a preserveLoudness file too (not to re-target it,
  // classify() never does that for preserveLoudness): the wrong-branch
  // fingerprint check below needs the real value to compare against
  // TARGET_LUFS. Both figures come from the one ebur128 report.
  const peakDb = parseSfxTruePeakDb(report, file);
  const lufs = preliminary.normBranch === 'lufs' ? parseSfxLufs(report, file) : null;
  return {
    ...facts,
    peakDb,
    lufs,
    ...classify({ ...facts, peakDb, lufs, preserveLoudness }),
  };
}

export function inspectSfxConformance(file, { ffmpegPath, ffprobePath, preserveLoudness = false }) {
  const stats = probeSfxAudio(file, ffprobePath);
  const { facts, preliminary } = classifyProbe(file, stats, preserveLoudness);
  if (preliminary.reject) return rejectedInspection(facts, preliminary);
  const report = captureFfmpegReport(file, EBUR128_FILTER, ffmpegPath);
  return measuredInspection(file, facts, preliminary, report, preserveLoudness);
}

/** Same verdict as inspectSfxConformance through non-blocking spawns, so a
 *  caller can inspect many files concurrently. */
export async function inspectSfxConformanceAsync(
  file,
  { ffmpegPath, ffprobePath, preserveLoudness = false },
) {
  const stats = parseSfxProbe(await runCaptureAsync(ffprobePath, probeArgs(file)), file);
  const { facts, preliminary } = classifyProbe(file, stats, preserveLoudness);
  if (preliminary.reject) return rejectedInspection(facts, preliminary);
  const report = await captureFfmpegReportAsync(file, EBUR128_FILTER, ffmpegPath);
  return measuredInspection(file, facts, preliminary, report, preserveLoudness);
}
