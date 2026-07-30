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

export function computeSfxGainCeilings(repoRoot, ffmpegPath) {
  const sfxDirectory = join(repoRoot, 'public/audio/sfx');
  const discovered = discoverSfxTracks(SFX, sfxDirectory);
  const customKeys = new Set(
    SFX.filter((entry) => entry.custom === true).map((entry) => entry.key),
  );
  const ceilings = {};
  for (const key of [...customKeys].sort()) {
    const source = discovered.entries[key];
    if (!source) continue;
    let loudestPeakDb = -Infinity;
    for (const track of source.tracks) {
      const path = join(sfxDirectory, track.filename);
      if (!existsSync(path)) continue;
      const peakDb = measureSfxTruePeakDb(path, ffmpegPath);
      if (peakDb > loudestPeakDb) loudestPeakDb = peakDb;
    }
    if (loudestPeakDb === -Infinity) continue;
    const ceilingDb = Math.max(0, SAFETY_FLOOR_DBFS - loudestPeakDb);
    ceilings[key] = Number(ceilingDb.toFixed(2));
  }
  return ceilings;
}

export function readSfxGainCeilings(repoRoot) {
  const path = join(repoRoot, SFX_GAIN_CEILING_PATH);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeSfxGainCeilings(repoRoot, ffmpegPath) {
  const ceilings = computeSfxGainCeilings(repoRoot, ffmpegPath);
  const path = join(repoRoot, SFX_GAIN_CEILING_PATH);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(ceilings, null, 2)}\n`);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { path, ceilings };
}
