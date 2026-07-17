// Checked-in runtime-only SFX gain and playback-rate profiles.
//
// These values are resolved into the generated runtime manifest. They never
// enter the Studio render graph or alter a published audio file.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSfxGainCeilings } from './sfx_gain_ceiling.mjs';
import { SFX } from './sfx_prompts.mjs';

export const DEFAULT_SFX_PROFILE_REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SFX_GAIN_MAP_PATH = 'scripts/sfx/sfx_gain_map.json';
export const SFX_SPEED_MAP_PATH = 'scripts/sfx/sfx_speed_map.json';
export const SFX_PLAYBACK_CATEGORIES = Object.freeze([
  'ui',
  'movement',
  'combat',
  'spells',
  'voices',
  'ambience',
  'other',
]);

const CATEGORY_BASELINE_MIN_DB = -60;
const CATEGORY_BASELINE_MAX_DB = 0;
const KEY_TRIM_MIN_DB = -60;
const KEY_TRIM_MAX_DB = 24;
const RESOLVED_GAIN_MIN_DB = -60;
const RESOLVED_GAIN_MAX_DB = 0;
const PLAYBACK_RATE_MIN = 0.25;
const PLAYBACK_RATE_MAX = 4;
const SFX_KEYS = new Set(SFX.map((entry) => entry.key));
const CATEGORY_SET = new Set(SFX_PLAYBACK_CATEGORIES);
// Computed per-key headroom for custom (hand-mastered) keys only, see
// sfx_gain_ceiling.mjs: a key with a real generated entry here may resolve
// ABOVE RESOLVED_GAIN_MAX_DB, up to its own measured-headroom ceiling. Every
// other key keeps the flat 0dB ceiling exactly as before. Read once at module
// load from the committed, regenerated-alongside-the-manifest artifact, not
// re-measured live: this file's callers (Studio, the manifest builder) run in
// short-lived Node processes, so a stale in-process cache is not a concern.
const SFX_GAIN_CEILINGS = readSfxGainCeilings(DEFAULT_SFX_PROFILE_REPO_ROOT);

const neutralCategories = () =>
  Object.fromEntries(SFX_PLAYBACK_CATEGORIES.map((category) => [category, 0]));

export const DEFAULT_SFX_GAIN_MAP = Object.freeze({
  version: 1,
  categoryBaselineDb: Object.freeze(neutralCategories()),
  keyTrimDb: Object.freeze({}),
});

export const DEFAULT_SFX_SPEED_MAP = Object.freeze({
  version: 1,
  rateByKey: Object.freeze({}),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function boundedNumber(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertVersion(value, label) {
  if (value !== 1) throw new Error(`${label} version must be 1`);
}

export function categoryForSfx(key) {
  if (key.startsWith('ui_')) return 'ui';
  if (key.startsWith('foot_') || key.startsWith('move_')) return 'movement';
  if (key.startsWith('melee_') || key.startsWith('combat_')) return 'combat';
  if (key.startsWith('impact_') && !key.match(/_(fire|frost|arcane|shadow|holy|nature)$/)) {
    return 'combat';
  }
  if (key.startsWith('cast_') || key.startsWith('proj_') || key.startsWith('spell_')) {
    return 'spells';
  }
  if (key.startsWith('impact_') || key === 'heal_impact' || key.endsWith('_apply')) {
    return 'spells';
  }
  if (key.startsWith('mob_') || key.startsWith('player_')) return 'voices';
  if (key.startsWith('amb_')) return 'ambience';
  return 'other';
}

// A custom key with a computed ceiling (see sfx_gain_ceiling.mjs) may resolve
// above the flat 0dB default, up to its own measured-headroom ceiling; every
// other key is unaffected (ceiling falls back to the original flat max).
export function resolvedGainCeilingDb(key) {
  return SFX_GAIN_CEILINGS[key] ?? RESOLVED_GAIN_MAX_DB;
}

// Linear form of resolvedGainCeilingDb, for callers (the generated manifest,
// the runtime pack validator) that work in gain multipliers, not dB.
export function resolvedGainCeiling(key) {
  return Number((10 ** (resolvedGainCeilingDb(key) / 20)).toFixed(6));
}

function resolvedGainDb(key, gainMap) {
  const category = categoryForSfx(key);
  const baseline = gainMap.categoryBaselineDb[category];
  const trim = gainMap.keyTrimDb[key] ?? 0;
  const maxDb = resolvedGainCeilingDb(key);
  return boundedNumber(baseline + trim, RESOLVED_GAIN_MIN_DB, maxDb, `resolved gain for ${key}`);
}

export function normalizeSfxGainMap(raw) {
  const value = assertObject(raw, 'SFX gain map');
  assertOnlyKeys(value, new Set(['version', 'categoryBaselineDb', 'keyTrimDb']), 'SFX gain map');
  assertVersion(value.version, 'SFX gain map');
  const rawCategories = assertObject(value.categoryBaselineDb, 'categoryBaselineDb');
  const rawTrims = assertObject(value.keyTrimDb, 'keyTrimDb');

  for (const category of Object.keys(rawCategories)) {
    if (!CATEGORY_SET.has(category)) throw new Error(`unknown SFX gain category: ${category}`);
  }
  const categoryBaselineDb = {};
  for (const category of SFX_PLAYBACK_CATEGORIES) {
    categoryBaselineDb[category] = boundedNumber(
      Object.hasOwn(rawCategories, category) ? rawCategories[category] : 0,
      CATEGORY_BASELINE_MIN_DB,
      CATEGORY_BASELINE_MAX_DB,
      `categoryBaselineDb.${category}`,
    );
  }

  const keyTrimDb = {};
  for (const key of Object.keys(rawTrims).sort()) {
    if (!SFX_KEYS.has(key)) throw new Error(`unknown SFX gain key: ${key}`);
    keyTrimDb[key] = boundedNumber(
      rawTrims[key],
      KEY_TRIM_MIN_DB,
      KEY_TRIM_MAX_DB,
      `keyTrimDb.${key}`,
    );
  }

  const normalized = { version: 1, categoryBaselineDb, keyTrimDb };
  for (const { key } of SFX) resolvedGainDb(key, normalized);
  return normalized;
}

export function normalizeSfxSpeedMap(raw) {
  const value = assertObject(raw, 'SFX speed map');
  assertOnlyKeys(value, new Set(['version', 'rateByKey']), 'SFX speed map');
  assertVersion(value.version, 'SFX speed map');
  const rawRates = assertObject(value.rateByKey, 'rateByKey');
  const rateByKey = {};
  for (const key of Object.keys(rawRates).sort()) {
    if (!SFX_KEYS.has(key)) throw new Error(`unknown SFX speed key: ${key}`);
    rateByKey[key] = boundedNumber(
      rawRates[key],
      PLAYBACK_RATE_MIN,
      PLAYBACK_RATE_MAX,
      `rateByKey.${key}`,
    );
  }
  return { version: 1, rateByKey };
}

function readMap(repoRoot, relativePath, fallback, normalize, label) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) return normalize(fallback);
  try {
    return normalize(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    throw new Error(`invalid ${label} ${path}: ${error.message ?? error}`);
  }
}

export function readSfxGainMap(repoRoot = DEFAULT_SFX_PROFILE_REPO_ROOT) {
  return readMap(
    repoRoot,
    SFX_GAIN_MAP_PATH,
    DEFAULT_SFX_GAIN_MAP,
    normalizeSfxGainMap,
    'SFX gain map',
  );
}

export function readSfxSpeedMap(repoRoot = DEFAULT_SFX_PROFILE_REPO_ROOT) {
  return readMap(
    repoRoot,
    SFX_SPEED_MAP_PATH,
    DEFAULT_SFX_SPEED_MAP,
    normalizeSfxSpeedMap,
    'SFX speed map',
  );
}

export function readSfxPlaybackProfile(repoRoot = DEFAULT_SFX_PROFILE_REPO_ROOT) {
  return {
    gainMap: readSfxGainMap(repoRoot),
    speedMap: readSfxSpeedMap(repoRoot),
  };
}

export function resolveSfxPlaybackProfile(key, rawProfile = {}) {
  if (!SFX_KEYS.has(key)) throw new Error(`unknown SFX playback key: ${key}`);
  const gainMap = normalizeSfxGainMap(rawProfile.gainMap ?? DEFAULT_SFX_GAIN_MAP);
  const speedMap = normalizeSfxSpeedMap(rawProfile.speedMap ?? DEFAULT_SFX_SPEED_MAP);
  const gainDb = resolvedGainDb(key, gainMap);
  return {
    gainDb,
    gain: Number((10 ** (gainDb / 20)).toFixed(6)),
    playbackRate: speedMap.rateByKey[key] ?? 1,
  };
}

function atomicJson(repoRoot, relativePath, value) {
  const path = join(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o644,
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return path;
}

export function writeSfxGainMap(repoRoot, raw) {
  const value = normalizeSfxGainMap(raw);
  return { path: atomicJson(repoRoot, SFX_GAIN_MAP_PATH, value), value };
}

export function writeSfxSpeedMap(repoRoot, raw) {
  const value = normalizeSfxSpeedMap(raw);
  return { path: atomicJson(repoRoot, SFX_SPEED_MAP_PATH, value), value };
}

export function writeSfxPlaybackProfile(repoRoot, rawProfile) {
  const gainMap = normalizeSfxGainMap(rawProfile?.gainMap ?? DEFAULT_SFX_GAIN_MAP);
  const speedMap = normalizeSfxSpeedMap(rawProfile?.speedMap ?? DEFAULT_SFX_SPEED_MAP);
  return {
    gainMap: {
      path: atomicJson(repoRoot, SFX_GAIN_MAP_PATH, gainMap),
      value: gainMap,
    },
    speedMap: {
      path: atomicJson(repoRoot, SFX_SPEED_MAP_PATH, speedMap),
      value: speedMap,
    },
  };
}
