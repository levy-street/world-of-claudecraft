// The pure half of the weapon-skin emissive derivation: which texels are
// promoted into the emissive map, how hard the albedo is de-baked under them,
// and the memo signature that lets one derivation serve every wearer of a skin.
import { describe, expect, it } from 'vitest';
import {
  deriveEmissiveTexels,
  type WeaponEmissiveSignatureSpec,
  type WeaponEmissiveWindow,
  weaponEmissiveCacheKey,
  weaponEmissiveSignature,
} from '../src/render/weapon_vfx_emissive_core';

// The shipped Hoarfrost (epic) window: saturated cyan/azure paint is the frozen
// core, bright desaturated ice picks up a residual glow.
const FROST: WeaponEmissiveWindow = {
  hue: [150, 245],
  minS: 0.18,
  minL: 0.5,
  whiteL: 0.85,
  whiteScale: 0.4,
};

const FROST_SPEC: WeaponEmissiveSignatureSpec = {
  ...FROST,
  tint: 0x66ccff,
  intensity: 1.0,
  pulse: 0.3,
  pulseHz: 0.55,
};

// Working-color-space tint, as THREE.Color would hand it over.
const TINT = { r: 0.14, g: 0.6, b: 1 };

function rgba(...texels: [number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(texels.length * 4);
  texels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

function derive(texels: [number, number, number][]) {
  const emissive = rgba(...texels);
  const albedo = rgba(...texels);
  deriveEmissiveTexels(emissive, albedo, FROST, TINT);
  return { emissive, albedo };
}

describe('deriveEmissiveTexels', () => {
  it('promotes a saturated in-window texel and de-bakes the albedo under it', () => {
    // Bright azure: hue ~200, s ~1, l ~0.6, squarely inside the frost window.
    const { emissive, albedo } = derive([[51, 187, 255]]);

    expect(emissive[0]).toBeGreaterThan(0);
    expect(emissive[1]).toBeGreaterThan(0);
    expect(emissive[2]).toBeGreaterThan(0);
    // De-baked: the base color is pulled down where the glow now lives, and by
    // strictly more than nothing on every channel.
    expect(albedo[0]).toBeLessThan(51);
    expect(albedo[1]).toBeLessThan(187);
    expect(albedo[2]).toBeLessThan(255);
    // Alpha is never touched.
    expect(emissive[3]).toBe(255);
    expect(albedo[3]).toBe(255);
  });

  it('leaves an out-of-window hue black in the emissive map and the albedo intact', () => {
    // Saturated red (hue 0) at the same lightness: outside [150, 245].
    const { emissive, albedo } = derive([[255, 51, 51]]);

    expect([emissive[0], emissive[1], emissive[2]]).toEqual([0, 0, 0]);
    expect([albedo[0], albedo[1], albedo[2]]).toEqual([255, 51, 51]);
  });

  it('rejects an in-window hue that is too desaturated or too dark to score', () => {
    // Hue 200 but s below minS (0.18) and lightness below minL (0.5).
    const dull = derive([[110, 120, 128]]);
    expect([dull.emissive[0], dull.emissive[1], dull.emissive[2]]).toEqual([0, 0, 0]);
    expect([dull.albedo[0], dull.albedo[1], dull.albedo[2]]).toEqual([110, 120, 128]);

    // Hue 200, saturated, but dark (l ~0.25): fails minL, and is not white.
    const dark = derive([[0, 64, 128]]);
    expect([dark.emissive[0], dark.emissive[1], dark.emissive[2]]).toEqual([0, 0, 0]);
    expect([dark.albedo[0], dark.albedo[1], dark.albedo[2]]).toEqual([0, 64, 128]);
  });

  it('gives near-white texels the scaled-down residual glow, weaker than the core', () => {
    const white = derive([[250, 250, 250]]); // s = 0, l ~0.98: the whiteL arm
    const core = derive([[51, 187, 255]]);

    expect(white.emissive[0]).toBeGreaterThan(0);
    // whiteScale (0.4) caps the residual well under the in-window core score,
    // so a white highlight glows without becoming the brightest thing on the
    // weapon.
    expect(white.emissive[2]).toBeLessThan(core.emissive[2]);
    expect(white.albedo[0]).toBeLessThan(250);
  });

  it('leaves a near-white texel that is not bright enough alone', () => {
    // s = 0 but l ~0.78, below whiteL (0.85).
    const { emissive, albedo } = derive([[200, 200, 200]]);
    expect([emissive[0], emissive[1], emissive[2]]).toEqual([0, 0, 0]);
    expect([albedo[0], albedo[1], albedo[2]]).toEqual([200, 200, 200]);
  });

  it('grades toward the tier tint rather than copying the source color', () => {
    // A green-leaning in-window texel (hue ~160) still lands blue-dominant
    // after the 0.62 pull toward the azure tint.
    const { emissive } = derive([[60, 255, 190]]);
    expect(emissive[2]).toBeGreaterThan(emissive[0]);
  });

  it('walks every texel of a multi-texel buffer independently', () => {
    const { emissive, albedo } = derive([
      [51, 187, 255],
      [255, 51, 51],
      [51, 187, 255],
    ]);

    expect(emissive[0]).toBeGreaterThan(0);
    expect([emissive[4], emissive[5], emissive[6]]).toEqual([0, 0, 0]);
    expect(emissive[8]).toBe(emissive[0]);
    expect(albedo[4]).toBe(255);
    expect(albedo[8]).toBe(albedo[0]);
  });
});

describe('weaponEmissiveSignature / weaponEmissiveCacheKey', () => {
  it('is stable for an equal spec and distinct per source map', () => {
    const a = weaponEmissiveCacheKey('map-uuid-1', FROST_SPEC);
    const b = weaponEmissiveCacheKey('map-uuid-1', { ...FROST_SPEC });
    expect(a).toBe(b);
    expect(weaponEmissiveCacheKey('map-uuid-2', FROST_SPEC)).not.toBe(a);
  });

  it('changes when ANY authored emissive field changes', () => {
    const base = weaponEmissiveSignature(FROST_SPEC);
    const variants: WeaponEmissiveSignatureSpec[] = [
      { ...FROST_SPEC, hue: [151, 245] },
      { ...FROST_SPEC, hue: [150, 246] },
      { ...FROST_SPEC, minS: 0.19 },
      { ...FROST_SPEC, minL: 0.51 },
      { ...FROST_SPEC, whiteL: 0.86 },
      { ...FROST_SPEC, whiteScale: 0.41 },
      { ...FROST_SPEC, tint: 0x66ccfe },
      { ...FROST_SPEC, intensity: 1.01 },
      { ...FROST_SPEC, pulse: 0.31 },
      { ...FROST_SPEC, pulseHz: 0.56 },
    ];
    for (const variant of variants) {
      expect(weaponEmissiveSignature(variant), JSON.stringify(variant)).not.toBe(base);
    }
    // And every variant is distinct from every other, so no two authored looks
    // can collide onto one cached texture pair.
    const keys = new Set(variants.map((spec) => weaponEmissiveSignature(spec)));
    expect(keys.size).toBe(variants.length);
  });

  it('separates the source map from the spec in the key', () => {
    expect(weaponEmissiveCacheKey('uuid', FROST_SPEC)).toBe(
      `uuid|${weaponEmissiveSignature(FROST_SPEC)}`,
    );
  });
});
