import { type GameSettings, SETTING_RANGES } from './settings';

export const GRAPHICS_REBUILD_KEYS = Object.freeze([
  'graphicsPreset',
  'terrainDetail',
  'foliageDensity',
  'surfaceDetail',
  'effectsQuality',
  'shadowQuality',
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
