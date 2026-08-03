import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_REBUILD_KEYS,
  graphicsApplyMode,
  graphicsSettingsSnapshotsEqual,
  normalizeGraphicsSettingsSnapshot,
} from '../src/game/graphics_rebuild_core';
import { SETTING_RANGES } from '../src/game/settings';

describe('graphics rebuild settings snapshot', () => {
  it('pins the complete ordered preference surface', () => {
    expect(GRAPHICS_REBUILD_KEYS).toEqual([
      'graphicsPreset',
      'terrainDetail',
      'foliageDensity',
      'surfaceDetail',
      'effectsQuality',
      'shadowQuality',
    ]);
    expect(Object.isFrozen(GRAPHICS_REBUILD_KEYS)).toBe(true);
  });

  it('normalizes missing, non-finite, and out-of-range values into a frozen snapshot', () => {
    const snapshot = normalizeGraphicsSettingsSnapshot({
      graphicsPreset: 99,
      terrainDetail: -1,
      foliageDensity: Number.NaN,
      effectsQuality: 0.5,
    });

    expect(snapshot).toEqual({
      graphicsPreset: SETTING_RANGES.graphicsPreset.max,
      terrainDetail: SETTING_RANGES.terrainDetail.min,
      foliageDensity: SETTING_RANGES.foliageDensity.def,
      surfaceDetail: SETTING_RANGES.surfaceDetail.def,
      effectsQuality: 0.5,
      shadowQuality: SETTING_RANGES.shadowQuality.def,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('compares only the normalized graphics preference values', () => {
    const base = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 });
    const same = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 });
    const changed = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 4 });

    expect(graphicsSettingsSnapshotsEqual(base, same)).toBe(true);
    expect(graphicsSettingsSnapshotsEqual(base, changed)).toBe(false);
  });

  it('saves a changed draft without rebuilding when its effective profile is unchanged', () => {
    const applied = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3, terrainDetail: 2 });
    const target = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3, terrainDetail: 1 });

    expect(graphicsApplyMode(applied, applied, 'active', 'active')).toBe('unchanged');
    expect(graphicsApplyMode(applied, target, 'same-profile', 'same-profile')).toBe('saved');
    expect(graphicsApplyMode(applied, target, 'old-profile', 'new-profile')).toBe('rebuild');
  });
});
