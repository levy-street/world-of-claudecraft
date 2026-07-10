#!/usr/bin/env node
// Validate public/audio/sfx against the documented SFX asset standard.
// Requires local ffmpeg + ffprobe; this is an offline asset-quality check.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildSfxCatalogMap,
  channelLabel,
  filenameForKey,
  keyFromFilename,
  SFX_STANDARD,
  validateSfxCatalog,
} from './sfx/sfx_asset_standard.mjs';
import { measurePeakDbfs, probeAudio } from './sfx/sfx_ffmpeg.mjs';
import { SFX } from './sfx/sfx_prompts.mjs';

const root = process.cwd();
const sfxDir = path.join(root, 'public/audio/sfx');

function walkFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full));
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

function kbps(bitRateBps) {
  return bitRateBps / 1000;
}

function fmtDb(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}dBFS` : '-inf dBFS';
}

function add(violations, file, reason) {
  violations.push({ file, reason });
}

const violations = [];
for (const err of validateSfxCatalog(SFX)) add(violations, '[catalog]', err);

let catalog;
try {
  catalog = buildSfxCatalogMap(SFX);
} catch (err) {
  add(violations, '[catalog]', err.message);
  catalog = new Map();
}
const catalogByFilename = new Map([...catalog.values()].map((entry) => [entry.filename, entry]));

if (!existsSync(sfxDir)) {
  console.error(`SFX directory missing: ${path.relative(root, sfxDir)}`);
  process.exit(1);
}

const files = walkFiles(sfxDir);
let checked = 0;

for (const file of files) {
  const rel = path.relative(sfxDir, file).split(path.sep).join('/');
  const filename = path.basename(file);
  const entry = catalogByFilename.get(filename);
  const customContainer = entry?.custom === true && entry.filename !== filenameForKey(entry.key);
  const key = entry?.key ?? keyFromFilename(filename);

  if (rel !== filename)
    add(
      violations,
      rel,
      'audio clips must live directly under public/audio/sfx, not nested directories',
    );
  if (!customContainer && !SFX_STANDARD.filenamePattern.test(filename)) {
    add(violations, rel, 'filename must be lowercase snake_case and end in .mp3');
  }
  if (!key) {
    add(violations, rel, 'wrong container: only .mp3 files are allowed');
    continue;
  }
  if (!entry) {
    add(violations, rel, `filename key "${key}" is not present in scripts/sfx/sfx_prompts.mjs`);
    continue;
  }

  try {
    const probe = await probeAudio(file);
    checked++;
    if (
      (!customContainer && probe.codec !== SFX_STANDARD.codec) ||
      (!customContainer && !probe.formatName.split(',').includes(SFX_STANDARD.codec))
    ) {
      add(
        violations,
        rel,
        `wrong container/codec: expected MP3, got codec=${probe.codec || 'unknown'} format=${probe.formatName || 'unknown'}`,
      );
    }
    if (probe.sampleRateHz !== SFX_STANDARD.sampleRateHz) {
      add(
        violations,
        rel,
        `wrong sample rate: expected ${SFX_STANDARD.sampleRateHz}Hz, got ${probe.sampleRateHz || 'unknown'}Hz`,
      );
    }
    const expectedChannels = entry?.channels ?? SFX_STANDARD.monoChannels;
    if (probe.channels !== expectedChannels) {
      add(
        violations,
        rel,
        `wrong channel count: expected ${channelLabel(expectedChannels)}, got ${channelLabel(probe.channels || 0)}`,
      );
    }
    if (!customContainer) {
      if (!probe.bitRateBps) {
        add(violations, rel, 'could not determine bitrate');
      } else if (kbps(probe.bitRateBps) > SFX_STANDARD.bitrateCeilingKbps) {
        add(
          violations,
          rel,
          `bitrate above ceiling: expected <= ${SFX_STANDARD.bitrateCeilingKbps}kbps, got ${Math.round(kbps(probe.bitRateBps))}kbps`,
        );
      }
    }

    const peak = await measurePeakDbfs(file);
    if (peak > SFX_STANDARD.peakDbfs + SFX_STANDARD.peakToleranceDb) {
      add(
        violations,
        rel,
        `peak above target: expected <= ${SFX_STANDARD.peakDbfs}dBFS, got ${fmtDb(peak)}`,
      );
    }
  } catch (err) {
    add(violations, rel, err.message);
  }
}

if (violations.length) {
  console.error(
    `SFX conformance failed (${violations.length} violation${violations.length === 1 ? '' : 's'}):`,
  );
  for (const v of violations) console.error(`- ${v.file}: ${v.reason}`);
  process.exit(1);
}

console.log(
  `SFX conformance passed: ${checked} audio file${checked === 1 ? '' : 's'} in ${path.relative(root, sfxDir)}.`,
);
