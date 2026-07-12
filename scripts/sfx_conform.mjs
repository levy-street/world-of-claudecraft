// Inspect and optionally conform public/audio/sfx to the project standard:
//   MP3, 192 kbps, 44.1 kHz
//   duration < 1 s:  -6 dBFS true peak
//   duration >= 1 s: -14 LUFS
//
// Lossless sources always transcode and skip the lossy bitrate floor. Lossy
// sources below 112 kbps are rejected because re-encoding cannot restore them.
//
// Usage:
//   node scripts/sfx_conform.mjs
//   node scripts/sfx_conform.mjs --fix

import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  conformSfxAudio,
  inspectSfxConformance,
  SFX_AUDIO_EXTENSIONS,
} from './sfx/conform_audio.mjs';
import {
  LOSSLESS_EXTENSIONS,
  MIN_SOURCE_BITRATE,
  TARGET_LUFS,
  TARGET_PEAK_DBFS,
} from './sfx/sfx_conform_rules.mjs';

const fix = process.argv.includes('--fix');
const sfxDirectory = path.join(process.cwd(), 'public/audio/sfx');
const ffprobePath = ffprobeStatic.path;

const allFiles = existsSync(sfxDirectory)
  ? readdirSync(sfxDirectory)
      .filter((filename) => SFX_AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase()))
      .sort()
  : [];

// Select one source per stem. Lossless beats lossy; equally ranked duplicates
// are ambiguous and must be resolved by the author.
const byStem = new Map();
const conflicts = [];
for (const filename of allFiles) {
  const extension = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, extension);
  const existing = byStem.get(stem);
  if (!existing) {
    byStem.set(stem, filename);
    continue;
  }
  const existingExtension = path.extname(existing).toLowerCase();
  const incomingLossless = LOSSLESS_EXTENSIONS.has(extension);
  const existingLossless = LOSSLESS_EXTENSIONS.has(existingExtension);
  if (incomingLossless && !existingLossless) {
    console.log(`  WARN ${stem}: ${filename} (lossless) takes priority over ${existing}`);
    byStem.set(stem, filename);
  } else if (!incomingLossless && existingLossless) {
    console.log(`  WARN ${stem}: ${existing} (lossless) takes priority over ${filename}`);
  } else {
    console.log(`  ERROR ${stem}: ambiguous duplicate (${existing} vs ${filename})`);
    byStem.delete(stem);
    conflicts.push(stem);
  }
}

const files = [...byStem.values()].sort();
let issues = 0;
let fixed = 0;
let failures = 0;
let rejected = 0;

for (const filename of files) {
  const file = path.join(sfxDirectory, filename);
  const extension = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, extension);
  const outputFile = path.join(sfxDirectory, `${stem}.mp3`);
  const report = inspectSfxConformance(file, { ffmpegPath, ffprobePath });

  if (report.reject) {
    console.log(
      `  REJECT ${filename}  [${report.bitrate}kbps source, minimum ${MIN_SOURCE_BITRATE}kbps; re-export at 128kbps or higher]`,
    );
    rejected++;
    continue;
  }
  if (report.problems.length === 0) {
    console.log(`  ok   ${filename}`);
    continue;
  }

  issues++;
  const normLabel =
    report.normBranch === 'peak' ? `true peak ${TARGET_PEAK_DBFS}dBFS` : `${TARGET_LUFS} LUFS`;
  if (!fix) {
    console.log(`  FAIL ${filename}  [${report.problems.join(', ')}]  (would apply ${normLabel})`);
    continue;
  }

  process.stdout.write(`  fix  ${filename}  [${report.problems.join(', ')}]  (${normLabel})... `);
  try {
    conformSfxAudio({
      inputFile: file,
      outputFile,
      duration: report.duration,
      peakDb: report.peakDb,
      ffmpegPath,
    });
    if (file !== outputFile) unlinkSync(file);
    console.log('done');
    fixed++;
  } catch (error) {
    console.log('FAILED');
    console.error(`       ${error.message ?? error}`);
    failures++;
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
    `${rejected} file(s) rejected: source bitrate below ${MIN_SOURCE_BITRATE}kbps. Re-export from the original source and resubmit.`,
  );
}
if (fix) {
  console.log(
    `${fixed}/${issues} files conformed. ${files.length - issues - rejected} already at spec.`,
  );
} else if (issues > 0) {
  console.log(`${issues} file(s) out of spec. Run with --fix to conform them.`);
}

if (failures > 0 || conflicts.length > 0 || rejected > 0 || (!fix && issues > 0)) {
  process.exitCode = 1;
}
