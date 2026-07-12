// Filesystem discovery for sampled SFX. The legacy manifest writer remains here
// for release compatibility; the rich runtime manifest consumes the same
// discovery result so both paths agree on filenames and variant ordering.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A bare custom recording may remain lossless until the conform step converts
// it. Numbered takes are production MP3s and always use the release `_N` naming.
export const PROBE_EXTENSIONS = Object.freeze(['.mp3', '.wav', '.flac', '.ogg']);

// Valid mob vocalization actions, used as the right-hand anchor when parsing
// mob_<family>_<subfamily>_<action>_<N>.mp3.
export const MOB_ACTIONS = new Set(['aggro', 'attack', 'death', 'hurt']);

const KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

function track(id, filename) {
  return { id, filename, url: `/audio/sfx/${filename}` };
}

function variantNumber(value) {
  const match = value.filename.match(/_(\d+)\.mp3$/);
  return match ? Number(match[1]) : 0;
}

function compareTracks(left, right) {
  const numeric = variantNumber(left) - variantNumber(right);
  return numeric || left.filename.localeCompare(right.filename);
}

function sortedEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, { ...entry, tracks: [...entry.tracks].sort(compareTracks) }]),
  );
}

/**
 * Discover catalog clips plus release-compatible mob subfamily extensions.
 *
 * Catalog keys prefer contiguous numbered MP3 takes over a bare file. Dynamic
 * mob subfamily files do not need a catalog row: their action token anchors the
 * key and their numeric suffix determines deterministic runtime order.
 *
 * @param {Array<{key: string, loop?: boolean}>} catalog
 * @param {string} sfxDir
 * @returns {{ entries: Record<string, {key: string, loop: boolean, catalog: boolean, tracks: Array<{id: string, filename: string, url: string}>}>, errors: string[] }}
 */
export function discoverSfxTracks(catalog, sfxDir) {
  const entries = {};
  const errors = [];
  const catalogKeys = new Set();
  const sfxFiles = existsSync(sfxDir) ? readdirSync(sfxDir).sort() : [];

  for (const source of catalog) {
    if (!source || typeof source.key !== 'string' || !KEY_PATTERN.test(source.key)) {
      errors.push(`invalid SFX catalog key: ${String(source?.key)}`);
      continue;
    }
    if (catalogKeys.has(source.key)) {
      errors.push(`duplicate SFX catalog key: ${source.key}`);
      continue;
    }
    catalogKeys.add(source.key);

    const tracks = [];
    const numberedPattern = new RegExp(`^${source.key}_(\\d+)\\.mp3$`);
    const numbered = sfxFiles
      .map((filename) => ({ filename, id: filename.match(numberedPattern)?.[1] ?? null }))
      .filter((candidate) => candidate.id !== null);
    for (const candidate of numbered) {
      const numericId = Number(candidate.id);
      if (
        !/^[1-9]\d*$/.test(candidate.id) ||
        !Number.isSafeInteger(numericId) ||
        String(numericId) !== candidate.id
      ) {
        errors.push(`invalid SFX variant id for ${source.key}: ${candidate.filename}`);
        continue;
      }
      tracks.push(track(candidate.id, candidate.filename));
    }
    tracks.sort(compareTracks);
    for (const [index, candidate] of tracks.entries()) {
      if (candidate.id !== String(index + 1)) {
        errors.push(
          `noncontiguous SFX variants for ${source.key}: expected _${index + 1}.mp3 before ${candidate.filename}`,
        );
        break;
      }
    }

    if (tracks.length === 0) {
      for (const extension of PROBE_EXTENSIONS) {
        const filename = `${source.key}${extension}`;
        if (!existsSync(path.join(sfxDir, filename))) continue;
        tracks.push(track('main', filename));
        break;
      }
    }

    if (tracks.length > 0) {
      entries[source.key] = {
        key: source.key,
        loop: !!source.loop,
        catalog: true,
        tracks,
      };
    }
  }

  const mobFiles = sfxFiles.filter(
    (filename) => filename.startsWith('mob_') && filename.endsWith('.mp3'),
  );
  for (const filename of mobFiles) {
    const stem = filename.slice(0, -4);
    const parts = stem.split('_');
    if (parts.length < 5 || !/^\d+$/.test(parts.at(-1) ?? '')) continue;

    const variantId = parts.at(-1) ?? '';
    const variantNumber = Number(variantId);
    if (
      !/^[1-9]\d*$/.test(variantId) ||
      !Number.isSafeInteger(variantNumber) ||
      String(variantNumber) !== variantId
    ) {
      errors.push(`invalid mob sfx variant id: ${filename}`);
      continue;
    }

    const family = parts[1];
    const body = parts.slice(2, -1);
    let actionIndex = -1;
    for (let index = body.length - 1; index >= 0; index--) {
      if (MOB_ACTIONS.has(body[index])) {
        actionIndex = index;
        break;
      }
    }
    if (actionIndex === -1) {
      errors.push(`invalid mob sfx filename (no recognized action): ${filename}`);
      continue;
    }
    if (actionIndex !== body.length - 1) {
      errors.push(`invalid mob sfx filename (action must precede variant): ${filename}`);
      continue;
    }

    const subfamilyParts = body.slice(0, actionIndex);
    if (subfamilyParts.length === 0) continue;
    const action = body[actionIndex];
    const subfamily = subfamilyParts.join('_');
    const key = `mob_${family}_${subfamily}_${action}`;
    if (!KEY_PATTERN.test(key)) {
      errors.push(`invalid mob sfx key derived from filename: ${filename}`);
      continue;
    }
    if (!entries[key]) entries[key] = { key, loop: false, catalog: false, tracks: [] };
    const entry = entries[key];
    if (entry.tracks.some((value) => value.filename === filename)) continue;
    entry.tracks.push(track(variantId, filename));
  }

  return { entries: sortedEntries(entries), errors };
}

/**
 * Write the v0.25 legacy `{ urls, loop }` manifest. New code should normally use
 * scripts/sfx/manifest.mjs, but keeping this function makes `--manifest` and its
 * regression tests share the exact same discovery rules.
 */
export function buildManifest(catalog, sfxDir, manifestPath) {
  const discovered = discoverSfxTracks(catalog, sfxDir);
  const legacy = Object.fromEntries(
    Object.entries(discovered.entries).map(([key, entry]) => [
      key,
      { urls: entry.tracks.map((value) => value.url), loop: entry.loop },
    ]),
  );
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    [
      '// Generated by scripts/gen_sfx.mjs. Do not edit by hand.',
      '// Maps a sound-effect key to its public URL(s) and loop flag.',
      '// Multiple URLs use the release variant convention: <key>_1.mp3, <key>_2.mp3.',
      'export interface SfxEntry { urls: string[]; loop: boolean }',
      'export const SFX_CLIPS: Record<string, SfxEntry> =',
      `${JSON.stringify(legacy, null, 2)} as const;`,
      '',
    ].join('\n'),
  );
  return {
    count: Object.keys(legacy).length,
    errors: discovered.errors,
    entries: discovered.entries,
  };
}
