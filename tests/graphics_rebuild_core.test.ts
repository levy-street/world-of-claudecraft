import { describe, expect, it } from 'vitest';
import {
  advancedDialSeed,
  GRAPHICS_DIAL_KEYS,
  GRAPHICS_PRESET_ADVANCED,
  GRAPHICS_REBUILD_KEYS,
  graphicsApplyMode,
  graphicsDisplaySnapshot,
  graphicsSettingsSnapshotsEqual,
  normalizeGraphicsSettingsSnapshot,
  stageGraphicsDraftChange,
} from '../src/game/graphics_rebuild_core';
import { SETTING_RANGES } from '../src/game/settings';
import { farVistaPlan } from '../src/render/far_terrain_core';
import { gfxInternalsForTest, graphicsPresetLabel } from '../src/render/gfx';
import { waterFieldPlan } from '../src/render/water_core';

describe('graphics rebuild settings snapshot', () => {
  it('pins the complete ordered preference surface', () => {
    expect(GRAPHICS_REBUILD_KEYS).toEqual([
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
      antiAliasing: SETTING_RANGES.antiAliasing.def,
      bloomQuality: SETTING_RANGES.bloomQuality.def,
      ambientOcclusion: SETTING_RANGES.ambientOcclusion.def,
      viewDistance: SETTING_RANGES.viewDistance.def,
      waterQuality: SETTING_RANGES.waterQuality.def,
      characterDetail: SETTING_RANGES.characterDetail.def,
      dynamicLights: SETTING_RANGES.dynamicLights.def,
      particleEffects: SETTING_RANGES.particleEffects.def,
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

describe('per-system dial staging (round 12)', () => {
  it('pins the dial-key inventory: every rebuild key except the preset row', () => {
    expect(GRAPHICS_DIAL_KEYS).toEqual(
      GRAPHICS_REBUILD_KEYS.filter((key) => key !== 'graphicsPreset'),
    );
    expect(GRAPHICS_DIAL_KEYS).toHaveLength(GRAPHICS_REBUILD_KEYS.length - 1);
    expect(GRAPHICS_PRESET_ADVANCED).toBe(5);
    expect(Object.isFrozen(GRAPHICS_DIAL_KEYS)).toBe(true);
  });

  it('pins each fixed preset seed to the tier ladder it approximates', () => {
    // Derived from gfx.ts settingsFor (see the seed-table comment): shadow 0.5
    // is medium's exact 2560 map, high is the documented Advanced-Medium
    // profile plus the full high post stack (SMAA + bloom + half-res AO),
    // ultra adds full-res AO and the 128-cell water field, insane the 4-tap
    // worn walk and the 8yd vista grid; dial shadow level 2 (8192) stays
    // Advanced-only.
    expect(advancedDialSeed(1)).toEqual({
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
    });
    expect(advancedDialSeed(2)).toEqual({
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
    });
    expect(advancedDialSeed(3)).toEqual({
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
    });
    expect(advancedDialSeed(4)).toEqual({
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
    });
    expect(advancedDialSeed(6)).toEqual({
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
    });
    // Advanced itself (and anything unknown) seeds the stored defaults.
    const defaults = Object.fromEntries(
      GRAPHICS_DIAL_KEYS.map((key) => [key, SETTING_RANGES[key].def]),
    );
    expect(advancedDialSeed(5)).toEqual(defaults);
    // Every seed value must be a legal stored level for its dial.
    for (const preset of [1, 2, 3, 4, 5, 6]) {
      const seed = advancedDialSeed(preset);
      for (const key of GRAPHICS_DIAL_KEYS) {
        expect(seed[key]).toBeGreaterThanOrEqual(SETTING_RANGES[key].min);
        expect(seed[key]).toBeLessThanOrEqual(SETTING_RANGES[key].max);
      }
    }
  });

  it('displays the stored mix under Advanced and the seeded levels under a fixed preset', () => {
    const advanced = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 5, terrainDetail: 2 });
    expect(graphicsDisplaySnapshot(advanced)).toBe(advanced);
    const high = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3, terrainDetail: 2 });
    const display = graphicsDisplaySnapshot(high);
    expect(display).toEqual({ graphicsPreset: 3, ...advancedDialSeed(3) });
    // A projection, never a mutation: the stored draft keeps its own values.
    expect(high.terrainDetail).toBe(2);
    expect(Object.isFrozen(display)).toBe(true);
  });

  it('switches a dial edit under a fixed preset to the Advanced mix seeded from it', () => {
    const high = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3, terrainDetail: 0 });
    const staged = stageGraphicsDraftChange(high, 'shadowQuality', 2);
    expect(staged).toEqual({
      graphicsPreset: 5,
      ...advancedDialSeed(3),
      shadowQuality: 2,
    });
    // What the player was LOOKING at is what the mix starts from: the seed
    // wins over the previously stored (invisible) dial values.
    expect(staged.terrainDetail).toBe(advancedDialSeed(3).terrainDetail);
    expect(Object.isFrozen(staged)).toBe(true);
    expect(high.graphicsPreset).toBe(3);
  });

  it('edits a dial in place once the draft is already Advanced', () => {
    const advanced = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 5, terrainDetail: 0 });
    const staged = stageGraphicsDraftChange(advanced, 'foliageDensity', 2);
    expect(staged).toEqual({ ...advanced, foliageDensity: 2 });
  });

  it('treats re-selecting the DISPLAYED value as a no-op (never a silent preset switch)', () => {
    // A tap on the already-highlighted dial level under a fixed preset must
    // not stage the Advanced switch: the panel shows seed(3).terrainDetail for
    // preset High, so clicking that same level changes nothing.
    const high = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3, terrainDetail: 0 });
    expect(stageGraphicsDraftChange(high, 'terrainDetail', advancedDialSeed(3).terrainDetail)).toBe(
      high,
    );
    // Same for the preset row and for an Advanced dial at its stored value.
    expect(stageGraphicsDraftChange(high, 'graphicsPreset', 3)).toBe(high);
    const advanced = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 5, terrainDetail: 2 });
    expect(stageGraphicsDraftChange(advanced, 'terrainDetail', 2)).toBe(advanced);
    expect(stageGraphicsDraftChange(advanced, 'graphicsPreset', 5)).toBe(advanced);
  });

  it('seeds a never-customized mix when the preset row picks Advanced', () => {
    // Every stored dial at its default = the player has no mix yet, so the
    // Advanced entry starts from the levels the departing preset displayed.
    const ultra = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 4 });
    const toAdvanced = stageGraphicsDraftChange(ultra, 'graphicsPreset', 5);
    expect(toAdvanced).toEqual({ graphicsPreset: 5, ...advancedDialSeed(4) });
    // A fixed-preset pick is a plain field set (the dials become display-seeded
    // projections, so their stored values are irrelevant until the next switch).
    const toLow = stageGraphicsDraftChange(ultra, 'graphicsPreset', 1);
    expect(toLow).toEqual({ ...ultra, graphicsPreset: 1 });
  });

  it('restores a stored custom mix on the Advanced round-trip instead of re-seeding', () => {
    // The try-High-then-return trip: an Advanced player compares a fixed
    // preset, then switches back. Their stored mix IS what Advanced means to
    // them; both the applied-Advanced signal and any customized dial value
    // must protect it from the departing preset's seed.
    const mix = normalizeGraphicsSettingsSnapshot({
      graphicsPreset: 5,
      terrainDetail: 2,
      foliageDensity: 0,
    });
    const onHigh = stageGraphicsDraftChange(mix, 'graphicsPreset', 3, mix);
    expect(onHigh).toEqual({ ...mix, graphicsPreset: 3 });
    const back = stageGraphicsDraftChange(onHigh, 'graphicsPreset', 5, mix);
    expect(back).toEqual(mix);
    // The customized-dial arm alone protects the mix even when the applied
    // snapshot is not Advanced (an unapplied mix left from an earlier detour).
    const backUnapplied = stageGraphicsDraftChange(
      onHigh,
      'graphicsPreset',
      5,
      normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 }),
    );
    expect(backUnapplied).toEqual(mix);
  });

  it('normalizes every staged result (clamped values, frozen snapshot)', () => {
    const high = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 });
    const staged = stageGraphicsDraftChange(high, 'terrainDetail', 99);
    expect(staged.terrainDetail).toBe(SETTING_RANGES.terrainDetail.max);
    expect(staged.graphicsPreset).toBe(5);
    expect(Object.isFrozen(staged)).toBe(true);
  });

  it('keeps the Apply-dirty question over display projections inert to dial residue', () => {
    // The load-bearing invariant of the display-vs-stored split: a draft that
    // renders pixel-identical to the applied state must not read dirty. Here
    // the draft carries Advanced dial residue from an abandoned detour, but
    // both sides display preset High with High's seeds.
    const applied = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 });
    const residue = normalizeGraphicsSettingsSnapshot({
      graphicsPreset: 3,
      terrainDetail: 2,
      shadowQuality: 0,
    });
    expect(graphicsDisplaySnapshot(residue)).toEqual(graphicsDisplaySnapshot(applied));
    const realChange = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 4 });
    expect(graphicsDisplaySnapshot(realChange)).not.toEqual(graphicsDisplaySnapshot(applied));
  });
});

describe('dial seeds versus the real gfx.ts tier ladder', () => {
  // The seed table is hand-derived from settingsFor's 100-line Advanced branch
  // in another module; these assertions keep the exact correspondences the
  // table's comment claims from silently drifting when that ladder is retuned.
  // Only the knobs the seeds CAN express are compared (the documented
  // divergences, like low's disabled dynamic shadows, ultra's full-res AO and
  // the per-tier grass floors, are deliberately not asserted).
  const { settingsFor } = gfxInternalsForTest;
  const desktopHints = {
    search: '',
    maxTouchPoints: 0,
    coarsePointer: false,
    narrowViewport: false,
    platform: 'other' as const,
  };
  const advancedFor = (preset: number) =>
    settingsFor('high', { ...desktopHints, graphicsPreset: 5, ...advancedDialSeed(preset) });

  it('agrees with gfx.ts on the Advanced preset number', () => {
    expect(graphicsPresetLabel(GRAPHICS_PRESET_ADVANCED)).toBe('advanced');
  });

  it('reproduces each preset tier on every dial-expressible knob', () => {
    const low = settingsFor('low', desktopHints);
    expect(advancedFor(1).terrainSplat).toBe(low.terrainSplat);
    expect(advancedFor(1).terrainRelief).toBe(low.terrainRelief);
    expect(advancedFor(1).surfaceDetail).toBe(low.surfaceDetail);
    expect(advancedFor(1).ao).toBe(low.ao);
    expect(advancedFor(1).bloom).toBe(low.bloom);
    expect(advancedFor(1).smaa).toBe(low.smaa);
    expect(advancedFor(1).farCharacterAnimScale).toBe(low.farCharacterAnimScale);

    const medium = settingsFor('medium', desktopHints);
    expect(advancedFor(2).shadowMap).toBe(medium.shadowMap);
    expect(advancedFor(2).composer).toBe(medium.composer);
    expect(advancedFor(2).gradePass).toBe(medium.gradePass);
    expect(advancedFor(2).ao).toBe(medium.ao);
    expect(advancedFor(2).bloom).toBe(medium.bloom);

    const high = settingsFor('high', desktopHints);
    const highKnobs = [
      'terrainRelief',
      'terrainSplat',
      'bladeCarpetRadius',
      'cliffScree',
      'canopyDetail',
      'surfaceDetail',
      'surfaceDetailTaps',
      'surfaceDetailClampK',
      'shadowMap',
      'composer',
      'ao',
      'aoFullRes',
      'bloom',
      'smaa',
      'farCharacterAnimScale',
    ] as const;
    for (const knob of highKnobs) expect(advancedFor(3)[knob], `high ${knob}`).toEqual(high[knob]);

    const ultra = settingsFor('ultra', desktopHints);
    const ultraKnobs = [
      'terrainRelief',
      'bladeCarpetRadius',
      'cliffScree',
      'canopyDetail',
      'surfaceDetailTaps',
      'surfaceDetailClampK',
      'shadowMap',
      // Ambient Occlusion Full is the new dial capability: an Advanced mix
      // now reaches ultra's full-resolution AO.
      'ao',
      'aoFullRes',
      'bloom',
      'smaa',
    ] as const;
    for (const knob of ultraKnobs)
      expect(advancedFor(4)[knob], `ultra ${knob}`).toEqual(ultra[knob]);

    const insane = settingsFor('insane', desktopHints);
    expect(advancedFor(6).surfaceDetailTaps).toBe(insane.surfaceDetailTaps);
    expect(advancedFor(6).surfaceDetailClampK).toBe(insane.surfaceDetailClampK);
    expect(advancedFor(6).terrainRelief).toBe(insane.terrainRelief);
    expect(advancedFor(6).bladeCarpetRadius).toBe(insane.bladeCarpetRadius);

    // The two whole-tier remaps compare by the PLAN each tier resolves to,
    // not the tier string (high and ultra share one vista plan; insane and
    // ultra share one water plan), so a ladder retune shows up here. The
    // seeds' High Dynamic Lights / High Particle Effects leave the pool and
    // the vfx band exactly as the tier ladder set them.
    for (const [preset, tier] of [
      [1, 'low'],
      [2, 'medium'],
      [3, 'high'],
      [4, 'ultra'],
      [6, 'insane'],
    ] as const) {
      expect(farVistaPlan(advancedFor(preset).vistaTier, false), `vista ${tier}`).toEqual(
        farVistaPlan(tier, false),
      );
      expect(waterFieldPlan(advancedFor(preset).waterTier), `water ${tier}`).toEqual(
        waterFieldPlan(tier),
      );
      const tierSettings = settingsFor(tier, desktopHints);
      // The light pool matches only where the seed keeps the full post chain:
      // the low/medium seeds carry Effects Low, whose pre-existing arm caps
      // the pool at 3 (a documented approximation, not the lights dial).
      if (preset >= 3)
        expect(advancedFor(preset).maxPointLights, `lights ${tier}`).toBe(
          tierSettings.maxPointLights,
        );
    }
    // The vfx budget band is BASE-TIER territory (Advanced always runs on the
    // high base and the dial only narrows that band), so untouched-band
    // equality is meaningful exactly for the High preset; the dial's own
    // clamps are pinned in the dedicated test below.
    expect(advancedFor(3).bucketBands.vfx).toEqual(
      settingsFor('high', desktopHints).bucketBands.vfx,
    );
  });

  it('Dynamic Lights Low keeps the constrained pool; Particle Effects narrows the vfx band', () => {
    const base = advancedFor(4);
    const dimLights = settingsFor('high', {
      ...desktopHints,
      graphicsPreset: 5,
      ...advancedDialSeed(4),
      dynamicLights: 0,
    });
    expect(dimLights.maxPointLights).toBe(3);
    expect(dimLights.maxPointLights).toBeLessThan(base.maxPointLights);

    const mediumVfx = settingsFor('high', {
      ...desktopHints,
      graphicsPreset: 5,
      ...advancedDialSeed(4),
      particleEffects: 0.5,
    });
    // Medium stops the governor raising past the tier baseline.
    expect(mediumVfx.bucketBands.vfx.max).toBe(base.bucketBands.vfx.baseline);
    expect(mediumVfx.bucketBands.vfx.min).toBe(base.bucketBands.vfx.min);

    const lowVfx = settingsFor('high', {
      ...desktopHints,
      graphicsPreset: 5,
      ...advancedDialSeed(4),
      particleEffects: 0,
    });
    // Low pins the whole band at its floor; the baseline projection follows.
    expect(lowVfx.bucketBands.vfx.baseline).toBe(base.bucketBands.vfx.min);
    expect(lowVfx.bucketBands.vfx.max).toBe(base.bucketBands.vfx.min);
    expect(lowVfx.bucketBaselines.vfx).toBe(base.bucketBands.vfx.min);
    // Non-vfx buckets are untouched by the dial.
    expect(lowVfx.bucketBands.grass).toEqual(base.bucketBands.grass);
  });
});
