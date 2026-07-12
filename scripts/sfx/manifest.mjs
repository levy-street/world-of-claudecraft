// Deterministic runtime manifest builder for the sampled SFX catalog.
//
// The sound studio and the ElevenLabs generator both call this module. Keeping
// manifest emission separate from generation means a sound engineer can publish
// a local edit without an API key or another paid generation pass.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  categoryForSfx,
  readSfxPlaybackProfile,
  resolveSfxPlaybackProfile,
} from './playback_profile.mjs';
import { discoverSfxTracks } from './sfx_manifest_builder.mjs';
import { MOB_VOICE_FAMILIES, SFX } from './sfx_prompts.mjs';

export { categoryForSfx } from './playback_profile.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_REPO_ROOT = SCRIPT_ROOT;

export const SFX_MIX_PATH = 'scripts/sfx/sfx_mix.json';
export const SFX_MANIFEST_PATH = 'src/game/sfx_manifest.generated.ts';
export const SFX_RUNTIME_PACK_PATH = 'public/audio/sfx/runtime-pack.json';
export const SFX_RUNTIME_PACK_FORMAT = 'woc-sfx-runtime-pack';
export const SFX_RUNTIME_PACK_VERSION = 1;
export const SFX_MAX_TRACKS_PER_KEY = 8;
export const SFX_MAX_TRACK_BYTES = 4 * 1024 * 1024;
export const SFX_MAX_TOTAL_AUDIO_BYTES = 128 * 1024 * 1024;
export const SFX_MAX_RUNTIME_PACK_BYTES = 512 * 1024;

export const SFX_FIXED_CATALOG_KEYS = Object.freeze(SFX.map((source) => source.key).sort());
export const SFX_MOB_EXTENSION_FAMILIES = Object.freeze([...MOB_VOICE_FAMILIES].sort());
export const SFX_MOB_EXTENSION_KEY_PATTERN =
  /^mob_([a-z0-9]+)_([a-z0-9]+(?:_[a-z0-9]+)*)_(aggro|attack|death|hurt)$/;

const CATALOG_KEYS = new Set(SFX_FIXED_CATALOG_KEYS);
const MOB_EXTENSION_FAMILIES = new Set(SFX_MOB_EXTENSION_FAMILIES);

export function isSfxMobExtensionKey(key) {
  if (typeof key !== 'string' || CATALOG_KEYS.has(key)) return false;
  const match = key.match(SFX_MOB_EXTENSION_KEY_PATTERN);
  return !!match && MOB_EXTENSION_FAMILIES.has(match[1]);
}

export function preloadForSfx(key) {
  const category = categoryForSfx(key);
  if (
    category === 'ui' ||
    category === 'movement' ||
    category === 'combat' ||
    key.startsWith('player_')
  ) {
    return 'startup';
  }
  return 'lazy';
}

export function spatialForSfx(key) {
  if (key.startsWith('ui_')) return false;
  return !key.startsWith('amb_') || ['amb_water', 'amb_campfire', 'amb_forge'].includes(key);
}

export function readSfxMix(repoRoot = DEFAULT_REPO_ROOT) {
  const path = join(repoRoot, SFX_MIX_PATH);
  if (!existsSync(path)) return { version: 1, clips: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.clips ||
      typeof parsed.clips !== 'object'
    ) {
      throw new Error('expected an object with a clips object');
    }
    return {
      version: Number(parsed.version) || 1,
      clips: parsed.clips,
    };
  } catch (error) {
    throw new Error(`invalid SFX mix file ${path}: ${error.message ?? error}`);
  }
}

function sampledFileIdentity(path, remainingTotalBytes) {
  const descriptor = openSync(path, 'r');
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > SFX_MAX_TRACK_BYTES) {
      throw new Error(
        `sampled SFX file must be 1..${SFX_MAX_TRACK_BYTES} bytes: ${path} (${before.size})`,
      );
    }
    if (before.size > remainingTotalBytes) {
      throw new Error(`sampled SFX exceed ${SFX_MAX_TOTAL_AUDIO_BYTES} total bytes`);
    }
    const contents = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (contents.length !== before.size || after.size !== before.size) {
      throw new Error(`sampled SFX changed while building the manifest: ${path}`);
    }
    return {
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  } finally {
    closeSync(descriptor);
  }
}

export function sfxTrackDescriptors(source) {
  const raw = source.variants ?? [];
  if (!Array.isArray(raw)) throw new Error(`SFX variants for ${source.key} must be an array`);
  if (raw.length === 0) {
    return [{ id: 'main', filename: `${source.key}.mp3`, overrides: {} }];
  }
  if (raw.length > SFX_MAX_TRACKS_PER_KEY) {
    throw new Error(
      `SFX ${source.key} has ${raw.length} tracks; maximum is ${SFX_MAX_TRACKS_PER_KEY}`,
    );
  }
  const descriptors = [];
  for (const [index, value] of raw.entries()) {
    descriptors.push({
      id: String(index + 1),
      filename: `${source.key}_${index + 1}.mp3`,
      overrides: typeof value === 'string' ? {} : value,
    });
  }
  return descriptors;
}

function playbackProfileForKey(key, playbackProfile) {
  if (CATALOG_KEYS.has(key)) return resolveSfxPlaybackProfile(key, playbackProfile);
  // Mob subfamily extensions are intentionally absent from the fixed catalog.
  // They inherit their family category baseline and remain neutral for key trim
  // and playback rate until explicitly promoted into the catalog.
  const category = categoryForSfx(key);
  const gainDb = playbackProfile.gainMap.categoryBaselineDb[category] ?? 0;
  return {
    gainDb,
    gain: Number((10 ** (gainDb / 20)).toFixed(6)),
    playbackRate: 1,
  };
}

export function catalogHashForEntries() {
  const contract = Object.fromEntries(
    [...SFX]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((source) => [
        source.key,
        {
          loop: !!source.loop,
          category: categoryForSfx(source.key),
          preload: preloadForSfx(source.key),
          spatial: spatialForSfx(source.key),
        },
      ]),
  );
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function buildRuntimeSfxPack(entries) {
  const catalogHash = catalogHashForEntries(entries);
  const clips = Object.fromEntries(
    Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [
        key,
        {
          variants: entry.variants,
          gain: entry.gain,
          playbackRate: entry.playbackRate,
        },
      ]),
  );
  const bundleId = createHash('sha256')
    .update(JSON.stringify({ catalogHash, clips }))
    .digest('hex');
  return {
    format: SFX_RUNTIME_PACK_FORMAT,
    version: SFX_RUNTIME_PACK_VERSION,
    bundleId,
    catalogHash,
    clips,
  };
}

export function serializeRuntimeSfxPack(pack) {
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > SFX_MAX_RUNTIME_PACK_BYTES) {
    throw new Error(`SFX runtime pack exceeds ${SFX_MAX_RUNTIME_PACK_BYTES} bytes`);
  }
  return serialized;
}

export function buildSfxManifestData(
  repoRoot = DEFAULT_REPO_ROOT,
  { requireComplete = true } = {},
) {
  for (const source of SFX) sfxTrackDescriptors(source);
  const playbackProfile = readSfxPlaybackProfile(repoRoot);
  const sfxDirectory = join(repoRoot, 'public/audio/sfx');
  const discovered = discoverSfxTracks(SFX, sfxDirectory);
  if (discovered.errors.length > 0) {
    throw new Error(`invalid sampled SFX inventory: ${discovered.errors.join('; ')}`);
  }
  for (const [key, source] of Object.entries(discovered.entries)) {
    if (!source.catalog && !isSfxMobExtensionKey(key)) {
      throw new Error(`invalid sampled SFX inventory: unsupported mob extension key ${key}`);
    }
  }
  if (requireComplete) {
    for (const source of SFX) {
      if (!discovered.entries[source.key]) {
        throw new Error(`missing sampled SFX file: ${join(sfxDirectory, `${source.key}.mp3`)}`);
      }
    }
  }
  const entries = {};
  let totalAudioBytes = 0;
  for (const [key, source] of Object.entries(discovered.entries)) {
    if (source.tracks.length > SFX_MAX_TRACKS_PER_KEY) {
      throw new Error(
        `SFX ${key} has ${source.tracks.length} tracks; maximum is ${SFX_MAX_TRACKS_PER_KEY}`,
      );
    }
    const variants = [];
    for (const track of source.tracks) {
      const path = join(sfxDirectory, track.filename);
      if (!existsSync(path)) {
        if (requireComplete) throw new Error(`missing sampled SFX file: ${path}`);
        continue;
      }
      const { bytes, sha256 } = sampledFileIdentity(
        path,
        SFX_MAX_TOTAL_AUDIO_BYTES - totalAudioBytes,
      );
      totalAudioBytes += bytes;
      variants.push({
        id: track.id,
        url: `/audio/sfx/${track.filename}?v=${sha256.slice(0, 12)}`,
        bytes,
        sha256,
      });
    }
    if (!variants.length) {
      continue;
    }
    const profile = playbackProfileForKey(key, playbackProfile);
    const primary = variants[0];
    entries[key] = {
      url: primary.url,
      loop: source.loop,
      category: categoryForSfx(key),
      preload: preloadForSfx(key),
      spatial: spatialForSfx(key),
      gain: profile.gain,
      playbackRate: profile.playbackRate,
      bytes: primary.bytes,
      hash: primary.sha256.slice(0, 12),
      variants,
    };
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
}

export function serializeSfxManifest(entries) {
  const catalogHash = catalogHashForEntries(entries);
  return [
    '// Generated by scripts/build_sfx_manifest.mjs. Do not edit by hand.',
    '// Studio DSP is baked into each file. Gain and playback rate are runtime-only.',
    "export type SfxPreload = 'startup' | 'lazy';",
    'export interface SfxVariant {',
    '  id: string;',
    '  url: string;',
    '  bytes: number;',
    '  sha256: string;',
    '}',
    'export interface SfxEntry {',
    '  url: string;',
    '  loop: boolean;',
    '  category: string;',
    '  preload: SfxPreload;',
    '  spatial: boolean;',
    '  gain: number;',
    '  playbackRate: number;',
    '  bytes: number;',
    '  hash: string;',
    '  variants: readonly SfxVariant[];',
    '}',
    `export const SFX_CATALOG_HASH = '${catalogHash}';`,
    `export const SFX_FIXED_CATALOG_KEYS = ${JSON.stringify(SFX_FIXED_CATALOG_KEYS)} as const;`,
    `export const SFX_MOB_EXTENSION_FAMILIES = ${JSON.stringify(SFX_MOB_EXTENSION_FAMILIES)} as const;`,
    `export const SFX_MOB_EXTENSION_KEY_SOURCE = ${JSON.stringify(SFX_MOB_EXTENSION_KEY_PATTERN.source)};`,
    "export const SFX_RUNTIME_PACK_URL = '/audio/sfx/runtime-pack.json';",
    `export const SFX_MAX_TRACKS_PER_KEY = ${SFX_MAX_TRACKS_PER_KEY};`,
    `export const SFX_MAX_TRACK_BYTES = ${SFX_MAX_TRACK_BYTES};`,
    `export const SFX_MAX_TOTAL_AUDIO_BYTES = ${SFX_MAX_TOTAL_AUDIO_BYTES};`,
    `export const SFX_MAX_RUNTIME_PACK_BYTES = ${SFX_MAX_RUNTIME_PACK_BYTES};`,
    'export const SFX_CLIPS =',
    `${JSON.stringify(entries, null, 2)} satisfies Record<string, SfxEntry>;`,
    'export type SfxId = keyof typeof SFX_CLIPS;',
    '',
  ].join('\n');
}

export function writeSfxManifest(repoRoot = DEFAULT_REPO_ROOT) {
  const entries = buildSfxManifestData(repoRoot);
  const path = join(repoRoot, SFX_MANIFEST_PATH);
  const runtimePath = join(repoRoot, SFX_RUNTIME_PACK_PATH);
  const suffix = `${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const temporary = `${path}.${suffix}`;
  const runtimeTemporary = `${runtimePath}.${suffix}`;
  const runtimePack = buildRuntimeSfxPack(entries);
  try {
    writeFileSync(temporary, serializeSfxManifest(entries));
    writeFileSync(runtimeTemporary, serializeRuntimeSfxPack(runtimePack));
    renameSync(runtimeTemporary, runtimePath);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
    rmSync(runtimeTemporary, { force: true });
  }
  return { path, runtimePath, entries, runtimePack };
}
