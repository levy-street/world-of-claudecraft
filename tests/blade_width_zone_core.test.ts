import { afterEach, describe, expect, it } from 'vitest';
import {
  BLADE_BASE_GLSL,
  BLADE_BASE_MIN,
  BLADE_BASE_UNIFORM,
  BLADE_COMB_GLSL,
  BLADE_COMB_VALUES,
  BLADE_EXTRA_GLSL,
  BLADE_EXTRA_VALUES,
  BLADE_FAR_END,
  BLADE_FAR_MAX,
  BLADE_FAR_START,
  BLADE_NEAR_GLSL,
  BLADE_NEAR_MIN,
  BLADE_NEAR_UNIFORM,
  BLADE_PAINT_VALUES,
  BLADE_SIZE_MAX,
  BLADE_SIZE_VALUES,
  BLADE_WIDTH_GLSL,
  BLADE_WIDTH_MIN,
  BLADE_WIDTH_UNIFORM,
  bladeLookReach,
  CARPET_GROUND_DARK,
  CARPET_GROUND_UNIFORM,
  setBladeBaseZoneShade,
  setBladeCombZone,
  setBladeExtraZone,
  setBladeNearZoneShade,
  setBladePaintZone,
  setBladeSizeZone,
  setBladeWidthZoneScale,
  setCarpetGroundZone,
} from '../src/render/blade_width_zone_core';

describe('meadow blade width and root shade (zone look arms)', () => {
  afterEach(() => {
    setBladeWidthZoneScale(1);
    setBladeBaseZoneShade(1);
  });

  it('starts at the shipped blade exactly', () => {
    expect(BLADE_WIDTH_UNIFORM.value).toBe(1);
    expect(BLADE_BASE_UNIFORM.value).toBe(1);
  });

  it('writes the shared uniform objects the blade materials bind by reference', () => {
    setBladeWidthZoneScale(0.55);
    setBladeBaseZoneShade(0.6);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(0.55);
    expect(BLADE_BASE_UNIFORM.value).toBe(0.6);
  });

  it('clamps to the floors and 1, and restores the shipped value on a non-finite one', () => {
    setBladeWidthZoneScale(0);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(BLADE_WIDTH_MIN);
    setBladeWidthZoneScale(2);
    expect(BLADE_WIDTH_UNIFORM.value).toBe(1);
    setBladeBaseZoneShade(-1);
    expect(BLADE_BASE_UNIFORM.value).toBe(BLADE_BASE_MIN);
    setBladeBaseZoneShade(0.5);
    setBladeBaseZoneShade(Number.NaN);
    expect(BLADE_BASE_UNIFORM.value).toBe(1);
  });

  it('is the identity in GLSL at the shipped values (width 1, root shade 1)', () => {
    expect(BLADE_WIDTH_GLSL).toBe('transformed -= aBladeSide * (1.0 - uBladeWidth);');
    expect(BLADE_BASE_GLSL).toContain('mix(uBladeBase, 1.0,');
    expect(BLADE_BASE_GLSL).toContain('#ifdef USE_COLOR');
  });
});

describe('near-field meadow shade and carpet floor (zone look arms)', () => {
  afterEach(() => {
    setBladeNearZoneShade(1);
    setCarpetGroundZone(0);
  });

  it('start at the shipped carpet: no near shade, the pale floor', () => {
    expect(BLADE_NEAR_UNIFORM.value).toBe(1);
    expect(CARPET_GROUND_UNIFORM.value).toBe(0);
  });

  it('clamp to their ranges and restore stock on a non-finite value', () => {
    setBladeNearZoneShade(0);
    expect(BLADE_NEAR_UNIFORM.value).toBe(BLADE_NEAR_MIN);
    setBladeNearZoneShade(Number.NaN);
    expect(BLADE_NEAR_UNIFORM.value).toBe(1);
    setCarpetGroundZone(3);
    expect(CARPET_GROUND_UNIFORM.value).toBe(1);
    setCarpetGroundZone(Number.NaN);
    expect(CARPET_GROUND_UNIFORM.value).toBe(0);
  });

  it('the near shade is the identity at 1 in GLSL', () => {
    expect(BLADE_NEAR_GLSL).toContain('mix(uBladeNear, 1.0,');
    for (const channel of CARPET_GROUND_DARK) {
      expect(channel).toBeGreaterThan(0);
      expect(channel).toBeLessThan(1);
    }
  });
});

describe('windswept comb, painted field and blade size (zone look arms)', () => {
  afterEach(() => {
    setBladeCombZone(0, 0, 0, 0);
    setBladePaintZone(0, 0);
    setBladeSizeZone(1, 1);
  });

  it('start at the shipped upright, unpainted, full-size blade', () => {
    expect([...BLADE_COMB_VALUES]).toEqual([0, 0, 0, 0]);
    expect([...BLADE_PAINT_VALUES]).toEqual([0, 0, 0, 0]);
    expect([...BLADE_SIZE_VALUES]).toEqual([1, 1, 0, 0]);
  });

  it('packs the comb as (dirX, lean, dirZ, droop), the layout the GLSL reads', () => {
    setBladeCombZone(0.9, -0.1, 0.62, 0.22);
    expect(BLADE_COMB_VALUES[0]).toBeCloseTo(0.9, 6);
    expect(BLADE_COMB_VALUES[1]).toBeCloseTo(0.62, 6);
    expect(BLADE_COMB_VALUES[2]).toBeCloseTo(-0.1, 6);
    expect(BLADE_COMB_VALUES[3]).toBeCloseTo(0.22, 6);
    expect(BLADE_COMB_GLSL).toContain('uBladeComb.x * cos(wocTurn) - uBladeComb.z * sin(wocTurn)');
    expect(BLADE_COMB_GLSL).toContain('uBladeComb.y * wocCombK');
    expect(BLADE_COMB_GLSL).toContain('uBladeComb.w * wocCombK');
  });

  it('restores the upright blade on any non-finite comb value and clamps the rest', () => {
    setBladeCombZone(1, 0, 9, 9);
    expect(BLADE_COMB_VALUES[1]).toBe(2);
    expect(BLADE_COMB_VALUES[3]).toBe(1);
    setBladeCombZone(1, Number.NaN, 0.5, 0.2);
    expect([...BLADE_COMB_VALUES]).toEqual([0, 0, 0, 0]);
    setBladePaintZone(5, -1);
    expect(BLADE_PAINT_VALUES[0]).toBe(0.5);
    expect(BLADE_PAINT_VALUES[1]).toBe(0);
    setBladeSizeZone(0, Number.NaN);
    expect(BLADE_SIZE_VALUES[0]).toBeCloseTo(0.3, 6);
    expect(BLADE_SIZE_VALUES[1]).toBe(1);
  });

  it('skips the comb and paint work at the shipped zeros (uniform branches)', () => {
    expect(BLADE_COMB_GLSL).toContain('if (uBladeComb.y > 0.0)');
    expect(BLADE_COMB_GLSL).toContain('if (uBladePaint.x > 0.0 || uBladePaint.y > 0.0)');
    // the field's warm and cool drifts ride the painted patches: off at stock,
    // and shared by the carpet and band, which both splice this block
    const paint = BLADE_COMB_GLSL.indexOf('if (uBladePaint.x > 0.0 || uBladePaint.y > 0.0)');
    const drift = BLADE_COMB_GLSL.indexOf('float wocDrift');
    expect(drift).toBeGreaterThan(paint);
    expect(BLADE_COMB_GLSL.slice(paint, drift)).toContain('if (uBladePaint.x > 0.0) {');
    // the warm tips ride paintTip, read back from the grey cluster ramp
    const tips = BLADE_COMB_GLSL.indexOf('float wocTipT');
    expect(tips).toBeGreaterThan(paint);
    expect(BLADE_COMB_GLSL.slice(paint, tips)).toContain('if (uBladePaint.y > 0.0) {');
    expect(BLADE_COMB_GLSL).toContain('(color.g - 0.86) / 0.24');
    expect(BLADE_COMB_GLSL.startsWith('transformed.y *= uBladeSize.x;')).toBe(true);
  });
});

describe('extra blades and flowers (zone look arm)', () => {
  afterEach(() => setBladeExtraZone(0, 0));

  it('starts with every extra hidden (the shipped nine-blade tuft)', () => {
    expect([...BLADE_EXTRA_VALUES]).toEqual([0, 0, 0, 0]);
  });

  it('clamps the switches and restores hidden extras on a non-finite value', () => {
    setBladeExtraZone(4, 0.22);
    expect(BLADE_EXTRA_VALUES[0]).toBe(1);
    expect(BLADE_EXTRA_VALUES[1]).toBeCloseTo(0.22, 6);
    setBladeExtraZone(Number.NaN, Number.NaN);
    expect([...BLADE_EXTRA_VALUES]).toEqual([0, 0, 0, 0]);
  });

  it('collapses a hidden extra AFTER sway, so nothing re-inflates it', () => {
    expect(BLADE_EXTRA_GLSL).toContain('if (!wocShow) transformed = vec3(0.0);');
    expect(BLADE_EXTRA_GLSL).toContain('uBladeExtra.x > 0.5');
    expect(BLADE_EXTRA_GLSL).toContain('< uBladeExtra.y');
  });
});

describe('clumping and view-space widening (zone look arms)', () => {
  afterEach(() => {
    setBladePaintZone(0, 0, 0);
    setBladeSizeZone(1, 1, 0);
  });

  it('default to off, so a two-argument call keeps the shipped field', () => {
    setBladePaintZone(0.2, 0.5);
    setBladeSizeZone(0.8, 1.1);
    expect(BLADE_PAINT_VALUES[2]).toBe(0);
    expect(BLADE_SIZE_VALUES[2]).toBe(0);
  });

  it('clamp clumping to 0..1 and widening to 0..2, non-finite to off', () => {
    setBladePaintZone(0, 0, 3);
    expect(BLADE_PAINT_VALUES[2]).toBe(1);
    setBladeSizeZone(1, 1, 9);
    expect(BLADE_SIZE_VALUES[2]).toBe(2);
    setBladePaintZone(0, 0, Number.NaN);
    setBladeSizeZone(1, 1, Number.NaN);
    expect(BLADE_PAINT_VALUES[2]).toBe(0);
    expect(BLADE_SIZE_VALUES[2]).toBe(0);
  });

  it('branches both out at zero in GLSL', () => {
    expect(BLADE_COMB_GLSL).toContain('if (wocClump > 0.0)');
    expect(BLADE_COMB_GLSL).toContain('if (uBladeSize.z > 0.0)');
  });
});

describe('bladeLookReach (the cull pad for look-stretched tufts)', () => {
  it('is the largest spread up close and adds the full far widening by its end', () => {
    expect(bladeLookReach(0)).toBeCloseTo(BLADE_SIZE_MAX, 6);
    expect(bladeLookReach(BLADE_FAR_START)).toBeCloseTo(BLADE_SIZE_MAX, 6);
    expect(bladeLookReach(BLADE_FAR_END)).toBeCloseTo(BLADE_SIZE_MAX * (1 + BLADE_FAR_MAX), 6);
    expect(bladeLookReach(500)).toBeCloseTo(BLADE_SIZE_MAX * (1 + BLADE_FAR_MAX), 6);
  });

  it('covers the most setBladeSizeZone lets a look ask for', () => {
    setBladeSizeZone(99, 99, 0, 99);
    expect(BLADE_SIZE_VALUES[1]).toBeCloseTo(BLADE_SIZE_MAX, 6);
    expect(BLADE_SIZE_VALUES[3]).toBe(BLADE_FAR_MAX);
    setBladeSizeZone(1, 1, 0, 0);
  });

  it('feeds the shader the same distance band', () => {
    expect(BLADE_COMB_GLSL).toContain(
      `smoothstep(${BLADE_FAR_START.toFixed(1)}, ${BLADE_FAR_END.toFixed(1)},`,
    );
  });
});
