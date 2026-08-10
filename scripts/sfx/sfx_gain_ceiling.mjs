// Computed per-key gain-map ceiling for custom (hand-mastered) SFX keys.
//
// The gain map is attenuation-only by default (resolved gain capped at 0dB,
// see playback_profile.mjs) so a category/key trim can never push a normally-
// conformed key back into clipping. That flat 0dB ceiling is unnecessarily
// conservative for a custom key: conform never boosts a `custom: true` key
// (see conform_audio.mjs's conformCustomMaster), only ever pulling its true
// peak DOWN if it exceeds the safety floor, so a quiet custom recording can
// sit well under the floor with real, measurable headroom nobody is using.
//
// This module computes, per custom key, exactly how much of that headroom is
// safe to expose as a gain-map boost: SAFETY_FLOOR_DBFS minus the key's own
// WORST-CASE (loudest) measured true peak across every recorded take, since a
// keyTrimDb boost applies uniformly to every variant of a key, not per-take.
// A key with zero measured headroom (already at/over the floor) gets a 0dB
// ceiling, identical to today's flat behavior; only genuinely quiet custom
// content gets real room. This is the actual enforcement mechanism (consumed
// by playback_profile.mjs's validator), not just documentation: a PR that
// tries to set a keyTrimDb value past the computed ceiling fails outright.
//
// measureSfxTruePeakDb spawns ffmpeg, so re-running this over the whole
// custom-key catalog (every `sfx:manifest` build) is one subprocess per take
// even when nobody touched the audio since the last run. The generated JSON
// therefore also carries each take's fingerprint (a content sha256 + byte
// size) and its measured peak alongside the key's ceiling: a track whose
// fingerprint still matches the stored one reuses the stored peak instead of
// re-invoking ffmpeg, and only a changed (or new) take pays the measurement
// cost. The fingerprint is content-based, not mtime-based: git does not
// preserve mtime, so a fingerprint keyed on it would never hit on a fresh
// clone, worktree, or CI checkout, defeating the whole point of the cache.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureSfxTruePeakDb } from './conform_audio.mjs';
import { discoverSfxTracks } from './sfx_manifest_builder.mjs';
import { SFX } from './sfx_prompts.mjs';

export const SFX_GAIN_CEILING_PATH = 'scripts/sfx/sfx_gain_ceiling.generated.json';

// Real headroom before the absolute 0dBFS ceiling, accounting for MP3's own
// inter-sample encoding overshoot: the same margin conform's peak-safety
// enforcement already uses (see conform_audio.mjs's LONG_FORM_LIMIT_DB).
const SAFETY_FLOOR_DBFS = -1;

// Tolerant read for the CACHE path only: a corrupt or unreadable stored file
// just means "nothing cached", falling back to a full re-measure of every
// track. Never use this for the consumer-facing read (readSfxGainCeilings
// below), which must propagate a genuinely corrupt file loudly instead of
// silently dropping every custom key back to an 0dB ceiling.
function readStoredGainCeilingRecordsTolerant(repoRoot) {
  const path = join(repoRoot, SFX_GAIN_CEILING_PATH);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

// Content sha256 + byte size: deterministic across machines, unlike mtime,
// which git does not preserve, so it detects "this take was re-recorded,
// re-conformed, or replaced since we last measured it" without ever missing
// a cache hit purely because of a fresh checkout.
function trackFingerprint(path) {
  const contents = readFileSync(path);
  return { sha256: createHash('sha256').update(contents).digest('hex'), size: contents.length };
}

function fingerprintsMatch(a, b) {
  return !!a && !!b && a.sha256 === b.sha256 && a.size === b.size;
}

// Older (pre-fingerprint) generated files stored a bare number per key; treat
// that shape, or any record missing a matching track, as "nothing cached".
function storedTrackPeakDb(storedRecord, filename, fingerprint) {
  if (!storedRecord || typeof storedRecord !== 'object' || !Array.isArray(storedRecord.tracks)) {
    return null;
  }
  const stored = storedRecord.tracks.find((entry) => entry.filename === filename);
  if (!stored || typeof stored.peakDb !== 'number') return null;
  return fingerprintsMatch(stored, fingerprint) ? stored.peakDb : null;
}

// Full computed records: per-key ceilingDb plus the per-track fingerprint and
// measured peak that produced it, the shape persisted to SFX_GAIN_CEILING_PATH.
export function computeSfxGainCeilingRecords(repoRoot, ffmpegPath) {
  const sfxDirectory = join(repoRoot, 'public/audio/sfx');
  const discovered = discoverSfxTracks(SFX, sfxDirectory);
  const customKeys = new Set(
    SFX.filter((entry) => entry.custom === true).map((entry) => entry.key),
  );
  const stored = readStoredGainCeilingRecordsTolerant(repoRoot);
  const records = {};
  for (const key of [...customKeys].sort()) {
    const source = discovered.entries[key];
    if (!source) continue;
    let loudestPeakDb = -Infinity;
    const tracks = [];
    for (const track of source.tracks) {
      const path = join(sfxDirectory, track.filename);
      if (!existsSync(path)) continue;
      const fingerprint = trackFingerprint(path);
      const cachedPeakDb = storedTrackPeakDb(stored[key], track.filename, fingerprint);
      const peakDb = cachedPeakDb ?? measureSfxTruePeakDb(path, ffmpegPath);
      tracks.push({ filename: track.filename, ...fingerprint, peakDb });
      if (peakDb > loudestPeakDb) loudestPeakDb = peakDb;
    }
    if (loudestPeakDb === -Infinity) continue;
    const ceilingDb = Math.max(0, SAFETY_FLOOR_DBFS - loudestPeakDb);
    records[key] = { ceilingDb: Number(ceilingDb.toFixed(2)), tracks };
  }
  return records;
}

function ceilingsFromRecords(records) {
  const ceilings = {};
  for (const [key, record] of Object.entries(records)) ceilings[key] = record.ceilingDb;
  return ceilings;
}

export function computeSfxGainCeilings(repoRoot, ffmpegPath) {
  return ceilingsFromRecords(computeSfxGainCeilingRecords(repoRoot, ffmpegPath));
}

// Consumer-facing read (the playback_profile.mjs validator's source of
// truth): a missing file is legitimately "no custom keys yet" and returns
// empty, but a PRESENT, unparsable file is a real corruption and must throw
// rather than silently resolving every custom key back to an 0dB ceiling.
export function readSfxGainCeilings(repoRoot) {
  const path = join(repoRoot, SFX_GAIN_CEILING_PATH);
  if (!existsSync(path)) return {};
  const records = JSON.parse(readFileSync(path, 'utf8'));
  const ceilings = {};
  for (const [key, value] of Object.entries(records)) {
    ceilings[key] = typeof value === 'number' ? value : value?.ceilingDb;
  }
  return ceilings;
}

export function writeSfxGainCeilings(repoRoot, ffmpegPath) {
  const records = computeSfxGainCeilingRecords(repoRoot, ffmpegPath);
  const path = join(repoRoot, SFX_GAIN_CEILING_PATH);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { path, ceilings: ceilingsFromRecords(records) };
}
