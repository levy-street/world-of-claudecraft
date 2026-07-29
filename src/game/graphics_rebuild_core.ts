import { type GameSettings, SETTING_RANGES } from './settings';

export const GRAPHICS_REBUILD_KEYS = Object.freeze([
  'graphicsPreset',
  'terrainDetail',
  'foliageDensity',
  'surfaceDetail',
  'effectsQuality',
  'shadowQuality',
  'antiAliasing',
  'bloomQuality',
  'ambientOcclusion',
  'viewDistance',
  'waterQuality',
  'characterDetail',
  'dynamicLights',
  'particleEffects',
] as const);

export type GraphicsSettingsKey = (typeof GRAPHICS_REBUILD_KEYS)[number];
export type GraphicsSettingsSnapshot = Pick<GameSettings, GraphicsSettingsKey>;

export function normalizeGraphicsSettingsSnapshot(
  input: Partial<GraphicsSettingsSnapshot>,
): Readonly<GraphicsSettingsSnapshot> {
  const snapshot = {} as GraphicsSettingsSnapshot;
  for (const key of GRAPHICS_REBUILD_KEYS) {
    const range = SETTING_RANGES[key];
    const value = input[key];
    snapshot[key] =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(range.max, Math.max(range.min, value))
        : range.def;
  }
  return Object.freeze(snapshot);
}

export function graphicsSettingsSnapshotsEqual(
  a: Readonly<GraphicsSettingsSnapshot>,
  b: Readonly<GraphicsSettingsSnapshot>,
): boolean {
  return GRAPHICS_REBUILD_KEYS.every((key) => Object.is(a[key], b[key]));
}

// ---------------------------------------------------------------------------
// Per-system dial staging. The options panel shows the five per-system dials
// for EVERY preset (round 12): under a fixed preset each dial displays that
// preset's approximate level, and editing one switches the draft to the
// Advanced custom preset seeded from those same levels, so what the player saw
// is what their custom mix starts from. All pure snapshot transforms; the
// painter stages them into its disposable graphics draft.
// ---------------------------------------------------------------------------

/** The persisted graphicsPreset value that unlocks the per-system dials
 *  (gfx.ts PRESET_ADVANCED; the value is historical and can never renumber). */
export const GRAPHICS_PRESET_ADVANCED = 5;

export type GraphicsDialKey = Exclude<GraphicsSettingsKey, 'graphicsPreset'>;

// Derived, never a second literal list: a new rebuild key is automatically a
// dial key (and the seed rows' Record typing then forces a seed level for it).
export const GRAPHICS_DIAL_KEYS: readonly GraphicsDialKey[] = Object.freeze(
  GRAPHICS_REBUILD_KEYS.filter((key): key is GraphicsDialKey => key !== 'graphicsPreset'),
);

/**
 * The dial levels each fixed preset seeds the Advanced mix with, derived from
 * the tier ladder in gfx.ts settingsFor. APPROXIMATE BY DESIGN: the Advanced
 * preset always runs on the high-tier base and its dials remap only the listed
 * knobs, so a few tier-only differences cannot round-trip (low's disabled
 * dynamic shadows, ultra's full-res AO, per-tier grass radii). Each row is the
 * closest dial expression of that preset's derived profile:
 * - low: everything at the floor (splat off, sparse tufts, no worn layer,
 *   grade-only post, 1024 shadows).
 * - medium: cavity-only relief + reduced carpet, grade-only post, 2560 shadows
 *   (the exact medium-tier map size).
 * - high: the documented "Advanced-Medium" profile settingsFor's high tier
 *   copies (basic worn surface, reduced carpet, cavity relief) + the full
 *   high-tier post stack (SMAA + bloom + half-res AO) and 4096 shadows.
 * - ultra: full relief/carpet/worn layers at the ultra execution, full-res
 *   AO, the 128-cell water field.
 * - insane: ultra plus the 4-tap full-clamp worn walk and the 8yd vista grid
 *   (the ladder tops shadows at 4096, dial level 2's 8192 map is
 *   deliberately Advanced-only territory).
 * The per-effect binaries (antiAliasing, bloomQuality, characterDetail) read
 * 0 Off / 1 On; ambientOcclusion adds the 0.5 half-resolution middle; the
 * viewDistance and waterQuality ladders map 0/0.5/1/2 onto whole render
 * tiers (low/medium/high, then insane's vista grid and ultra's water field).
 */
const ADVANCED_DIAL_SEEDS: Readonly<Record<number, Readonly<Record<GraphicsDialKey, number>>>> = {
  1: Object.freeze({
    terrainDetail: 0,
    foliageDensity: 0,
    surfaceDetail: 0,
    effectsQuality: 0,
    shadowQuality: 0,
    antiAliasing: 0,
    bloomQuality: 0,
    ambientOcclusion: 0,
    viewDistance: 0,
    waterQuality: 0,
    characterDetail: 0,
    dynamicLights: 1,
    particleEffects: 1,
  }),
  2: Object.freeze({
    terrainDetail: 0.5,
    foliageDensity: 0.5,
    surfaceDetail: 0,
    effectsQuality: 0,
    shadowQuality: 0.5,
    antiAliasing: 0,
    bloomQuality: 0,
    ambientOcclusion: 0,
    viewDistance: 0.5,
    waterQuality: 0.5,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
  }),
  3: Object.freeze({
    terrainDetail: 0.5,
    foliageDensity: 0.5,
    surfaceDetail: 0.5,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 0.5,
    viewDistance: 1,
    waterQuality: 1,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
  }),
  4: Object.freeze({
    terrainDetail: 2,
    foliageDensity: 1,
    surfaceDetail: 1,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 1,
    waterQuality: 2,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
  }),
  6: Object.freeze({
    terrainDetail: 2,
    foliageDensity: 1,
    surfaceDetail: 2,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 2,
    waterQuality: 2,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
  }),
};

/** The dial levels the Advanced mix seeds from when leaving `preset`. An
 *  unknown preset (or Advanced itself) seeds the per-key stored defaults, the
 *  same values a fresh settings object carries. */
export function advancedDialSeed(preset: number): Readonly<Record<GraphicsDialKey, number>> {
  const seed = ADVANCED_DIAL_SEEDS[Math.round(preset)];
  if (seed) return seed;
  const defaults = {} as Record<GraphicsDialKey, number>;
  for (const key of GRAPHICS_DIAL_KEYS) defaults[key] = SETTING_RANGES[key].def;
  return Object.freeze(defaults);
}

/**
 * What the panel DISPLAYS for a draft: under Advanced the stored dial values;
 * under a fixed preset that preset's seed levels (so the dials always describe
 * the picture the player is looking at, not a stale stored mix).
 */
export function graphicsDisplaySnapshot(
  draft: Readonly<GraphicsSettingsSnapshot>,
): Readonly<GraphicsSettingsSnapshot> {
  if (Math.round(draft.graphicsPreset) === GRAPHICS_PRESET_ADVANCED) return draft;
  return Object.freeze({
    ...advancedDialSeed(draft.graphicsPreset),
    graphicsPreset: draft.graphicsPreset,
  });
}

/**
 * Stage one edited control value onto the draft:
 * - re-selecting the value a control already DISPLAYS is a no-op (so a tap on
 *   an already-highlighted dial level can never silently switch presets);
 * - editing a per-system dial under a fixed preset switches the draft to
 *   Advanced, seeds every dial from that preset, then applies the edit;
 * - picking Advanced in the preset row seeds the dials the same way, but ONLY
 *   for a never-customized mix (every stored dial at its default) with no
 *   Advanced snapshot applied: a stored custom mix is what "Advanced" MEANS
 *   to that player, and the try-High-then-return trip must restore it, never
 *   overwrite it with the departing preset's seed;
 * - every other edit is a plain field set.
 * Returns the draft itself on the no-op path, otherwise a new normalized
 * (clamped, frozen) snapshot.
 */
export function stageGraphicsDraftChange(
  draft: Readonly<GraphicsSettingsSnapshot>,
  key: GraphicsSettingsKey,
  value: number,
  applied?: Readonly<GraphicsSettingsSnapshot> | null,
): Readonly<GraphicsSettingsSnapshot> {
  if (graphicsDisplaySnapshot(draft)[key] === value) return draft;
  const fromPreset = Math.round(draft.graphicsPreset);
  if (key === 'graphicsPreset') {
    const toAdvanced =
      Math.round(value) === GRAPHICS_PRESET_ADVANCED && fromPreset !== GRAPHICS_PRESET_ADVANCED;
    const keepStoredMix =
      (applied != null && Math.round(applied.graphicsPreset) === GRAPHICS_PRESET_ADVANCED) ||
      GRAPHICS_DIAL_KEYS.some((dialKey) => draft[dialKey] !== SETTING_RANGES[dialKey].def);
    return normalizeGraphicsSettingsSnapshot(
      toAdvanced && !keepStoredMix
        ? { ...draft, ...advancedDialSeed(fromPreset), graphicsPreset: value }
        : { ...draft, graphicsPreset: value },
    );
  }
  if (fromPreset !== GRAPHICS_PRESET_ADVANCED) {
    return normalizeGraphicsSettingsSnapshot({
      ...draft,
      ...advancedDialSeed(fromPreset),
      graphicsPreset: GRAPHICS_PRESET_ADVANCED,
      [key]: value,
    });
  }
  return normalizeGraphicsSettingsSnapshot({ ...draft, [key]: value });
}

export type GraphicsApplyMode = 'unchanged' | 'saved' | 'rebuild';

/**
 * Decide whether a draft changes the renderer's effective derived profile.
 * Preferences that resolve to the already-active fingerprint still persist,
 * but skip the curtain/context cycle entirely.
 */
export function graphicsApplyMode(
  applied: Readonly<GraphicsSettingsSnapshot>,
  target: Readonly<GraphicsSettingsSnapshot>,
  activeFingerprint: string,
  targetFingerprint: string,
): GraphicsApplyMode {
  if (graphicsSettingsSnapshotsEqual(applied, target)) return 'unchanged';
  return activeFingerprint === targetFingerprint ? 'saved' : 'rebuild';
}
