// Inspect and optionally conform all audio files in public/audio/sfx/ to the project standard:
//   Format:      MP3
//   Bitrate:     192 kbps
//   Sample rate: 44.1 kHz
//   Normalization:
//     < 1 s  -> -6 dBFS peak
//     >= 1 s -> -14 LUFS  (loudnorm=I=-14:LRA=7:TP=-1)
//
// Accepted input formats: .mp3 .wav .flac .aiff .aif .ogg .opus .m4a
// All non-MP3 inputs are transcoded to <stem>.mp3 and the original is removed.
//
// Conflict resolution: if both <stem>.wav and <stem>.mp3 exist (or any two
// formats for the same stem), the lossless file takes priority. If two lossy
// files conflict, the first alphabetically wins and a warning is printed.
// This policy is intentional: lossless is always the better source.
//
// Usage:
//   node scripts/sfx_conform.mjs            # check only, exit 1 if anything is out of spec
//   node scripts/sfx_conform.mjs --fix      # check and fix non-conforming files in place

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  classify,
  DURATION_THRESHOLD,
  LOSSLESS_EXTENSIONS,
  MIN_SOURCE_BITRATE,
  TARGET_BITRATE,
  TARGET_PEAK_DBFS,
  TARGET_SAMPLE_RATE,
} from './sfx/sfx_conform_rules.mjs';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.aiff',
  '.aif',
  '.ogg',
  '.opus',
  '.m4a',
]);

const fix = process.argv.includes('--fix');
const root = process.cwd();
const sfxDir = path.join(root, 'public/audio/sfx');
const ffprobePath = ffprobeStatic.path;

function ffprobe(file) {
  const out = execFileSync(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(out.toString());
}

function getStats(file) {
  const info = ffprobe(file);
  const stream = info.streams.find((s) => s.codec_type === 'audio');
  const duration = parseFloat(info.format.duration ?? '0');
  const bitrate = Math.round(parseInt(info.format.bit_rate ?? '0') / 1000);
  const sampleRate = parseInt(stream?.sample_rate ?? '0');
  return { duration, bitrate, sampleRate };
}

// Returns the peak dBFS of a file using ffmpeg volumedetect.
// Throws if the output cannot be parsed rather than silently returning 0.
function getPeakDb(file) {
  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const match = (result.stderr || '').match(/max_volume:\s*([-\d.]+)\s*dB/);
  if (!match) throw new Error(`volumedetect parse failed for ${path.basename(file)}`);
  return parseFloat(match[1]);
}

// Returns the integrated loudness in LUFS using ffmpeg ebur128.
// Throws if the output cannot be parsed.
function getLufs(file) {
  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const match = (result.stderr || '').match(/I:\s*([-\d.]+)\s*LUFS/);
  if (!match) throw new Error(`ebur128 parse failed for ${path.basename(file)}`);
  return parseFloat(match[1]);
}

// Temp files go to the system temp directory so a crashed run cannot leave
// an orphan inside the scanned sfxDir on the next run.
// inputFile and outputFile differ when converting a non-MP3 to MP3; on success
// the original source file is removed.
function conformPeak(inputFile, outputFile, peakDb) {
  const adjustment = TARGET_PEAK_DBFS - peakDb;
  const tmp = path.join(tmpdir(), `sfx_conform_${path.basename(outputFile)}`);
  try {
    execFileSync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputFile,
      '-af',
      `volume=${adjustment}dB,aformat=sample_rates=${TARGET_SAMPLE_RATE}`,
      '-ar',
      String(TARGET_SAMPLE_RATE),
      '-b:a',
      `${TARGET_BITRATE}k`,
      '-codec:a',
      'libmp3lame',
      tmp,
    ]);
    renameSync(tmp, outputFile);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* already renamed or never created */
    }
  }
  if (inputFile !== outputFile) {
    try {
      unlinkSync(inputFile);
    } catch (e) {
      console.warn(`  WARN could not remove source file ${path.basename(inputFile)}: ${e.message}`);
    }
  }
}

function conformLufs(inputFile, outputFile) {
  const tmp = path.join(tmpdir(), `sfx_conform_${path.basename(outputFile)}`);
  try {
    execFileSync(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputFile,
      '-af',
      `loudnorm=I=-14:LRA=7:TP=-1,aformat=sample_rates=${TARGET_SAMPLE_RATE}`,
      '-ar',
      String(TARGET_SAMPLE_RATE),
      '-b:a',
      `${TARGET_BITRATE}k`,
      '-codec:a',
      'libmp3lame',
      tmp,
    ]);
    renameSync(tmp, outputFile);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* already renamed or never created */
    }
  }
  if (inputFile !== outputFile) {
    try {
      unlinkSync(inputFile);
    } catch (e) {
      console.warn(`  WARN could not remove source file ${path.basename(inputFile)}: ${e.message}`);
    }
  }
}

// Build the list of files to process, one per stem.
// If multiple formats share a stem, lossless wins over lossy.
// Two lossless or two lossy files for the same stem: first alphabetically wins, warn.
const allFiles = existsSync(sfxDir)
  ? readdirSync(sfxDir)
      .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort()
  : [];

const byKey = new Map(); // stem -> filename
const conflicts = []; // stems with ambiguous duplicates that block processing

for (const name of allFiles) {
  const stem = path.basename(name, path.extname(name));
  const ext = path.extname(name).toLowerCase();
  const existing = byKey.get(stem);
  if (!existing) {
    byKey.set(stem, name);
    continue;
  }
  const existingExt = path.extname(existing).toLowerCase();
  const newIsLossless = LOSSLESS_EXTENSIONS.has(ext);
  const existingIsLossless = LOSSLESS_EXTENSIONS.has(existingExt);
  if (newIsLossless && !existingIsLossless) {
    // Unambiguous: lossless always beats lossy.
    console.log(
      `  WARN ${stem}: ${name} (lossless) takes priority over ${existing} -- remove the lossy copy after conforming`,
    );
    byKey.set(stem, name);
  } else if (!newIsLossless && existingIsLossless) {
    // Unambiguous: existing lossless stays.
    console.log(
      `  WARN ${stem}: ${existing} (lossless) takes priority over ${name} -- remove the lossy copy after conforming`,
    );
  } else {
    // Two lossless or two lossy files for the same key: ambiguous, cannot determine
    // which is correct. Skip both and force the contributor to resolve it manually.
    console.log(
      `  ERROR ${stem}: ambiguous duplicate (${existing} vs ${name}) -- remove one and rerun`,
    );
    byKey.delete(stem);
    conflicts.push(stem);
  }
}

const files = [...byKey.values()].sort();

let issues = 0;
let fixed = 0;
let failures = 0;
let rejected = 0;

for (const name of files) {
  const file = path.join(sfxDir, name);
  const ext = path.extname(name).toLowerCase();
  const stem = path.basename(name, ext);
  const isLossless = LOSSLESS_EXTENSIONS.has(ext);
  const outputFile = path.join(sfxDir, `${stem}.mp3`);
  const { duration, bitrate, sampleRate } = getStats(file);

  // Source quality gate (lossy only): re-encoding a low-bitrate MP3 to 192kbps
  // does not recover lost quality. The floor is 112kbps, not 128kbps, because
  // ElevenLabs 128kbps exports can probe slightly low due to encoding variance.
  // Lossless sources skip this gate entirely.
  const preliminary = classify({ duration, bitrate, sampleRate, isLossless });
  if (preliminary.reject) {
    console.log(
      `  REJECT ${name}  [${bitrate}kbps source, minimum ${MIN_SOURCE_BITRATE}kbps; re-export at 128kbps or higher]`,
    );
    rejected++;
    continue;
  }

  // Measure actual loudness so check mode catches loudness drift, not just bitrate/rate.
  let peakDb = null;
  let lufs = null;
  if (preliminary.normBranch === 'peak') {
    peakDb = getPeakDb(file);
  } else {
    lufs = getLufs(file);
  }

  const { problems, normBranch } = classify({
    duration,
    bitrate,
    sampleRate,
    peakDb,
    lufs,
    isLossless,
  });

  if (problems.length === 0) {
    console.log(`  ok   ${name}`);
    continue;
  }

  issues++;
  const normLabel = normBranch === 'peak' ? `peak ${TARGET_PEAK_DBFS}dBFS` : '-14 LUFS';

  if (fix) {
    process.stdout.write(`  fix  ${name}  [${problems.join(', ')}]  (${normLabel})... `);
    try {
      if (normBranch === 'peak') {
        conformPeak(file, outputFile, peakDb);
      } else {
        conformLufs(file, outputFile);
      }
      console.log('done');
      fixed++;
    } catch (err) {
      console.log('FAILED');
      console.error(`       ${err.message}`);
      failures++;
    }
  } else {
    console.log(`  FAIL ${name}  [${problems.join(', ')}]  (would apply ${normLabel})`);
  }
}

console.log('');
if (conflicts.length > 0) {
  console.log(
    `${conflicts.length} key(s) skipped due to ambiguous duplicates: ${conflicts.join(', ')}. Remove one file per key and rerun.`,
  );
}
if (rejected > 0) {
  console.log(
    `${rejected} file(s) rejected: source bitrate below ${MIN_SOURCE_BITRATE}kbps. Re-export from your DAW and resubmit.`,
  );
}
if (fix) {
  console.log(
    `${fixed}/${issues} files conformed. ${files.length - issues - rejected} already at spec.`,
  );
} else if (issues > 0) {
  console.log(`${issues} file(s) out of spec. Run with --fix to conform them.`);
}
if (failures > 0 || conflicts.length > 0 || rejected > 0 || (!fix && issues > 0)) process.exit(1);
