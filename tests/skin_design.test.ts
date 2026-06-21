import { describe, expect, it } from 'vitest';
import { rgb, mix, shade, designHash } from '../src/render/characters/skin_design';
import { SKIN_PATTERNS, SKIN_FINISHES, SKIN_DENSITIES, defaultDesignSpec, type SkinDesignSpec } from '../src/world_api';

// The canvas builder itself needs a DOM 2D context (covered by the headless
// capture), but its colour math is pure + DOM-free. These guard the regression
// that broke in-world rendering for every design skin: shade() returned an
// 'rgb(...)' string that mix()/rgb() then NaN-parsed into 'rgb(NaN,NaN,..)',
// which threw inside the renderer's per-frame setCreatorSkin().
const HEX6 = /^#[0-9a-f]{6}$/;

describe('skin_design colour helpers — hex invariant (render-loop safety)', () => {
  it('rgb() parses a hex triplet', () => {
    expect(rgb('#2e8b57')).toEqual([0x2e, 0x8b, 0x57]);
    expect(rgb('#000000')).toEqual([0, 0, 0]);
    expect(rgb('#ffffff')).toEqual([255, 255, 255]);
  });

  it('shade() returns a valid hex (so it composes with mix/rgb) and clamps', () => {
    expect(shade('#2e8b57', 0.78)).toMatch(HEX6);
    expect(shade('#ffffff', 2)).toBe('#ffffff');   // lighten clamps at 255
    expect(shade('#202020', 0)).toBe('#000000');   // darken to black
    expect(rgb(shade('#2e8b57', 0.78)).some(Number.isNaN)).toBe(false);
  });

  it('mix() blends to valid rgb() with no NaN at the endpoints or middle', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('rgb(0,0,0)');
    expect(mix('#000000', '#ffffff', 1)).toBe('rgb(255,255,255)');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });

  it('REGRESSION: mix(shade(primary), secondary) never yields NaN — the exact crash', () => {
    for (const primary of ['#2e8b57', '#8b1a1a', '#3a2a6e', '#1a4a6e', '#c9851a', '#000000', '#ffffff']) {
      const blended = mix(shade(primary, 0.78), '#0b3d2e', 0.35);
      expect(blended).not.toContain('NaN');
      expect(blended).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });
});

describe('designHash — stable cache key over the full spec', () => {
  const base = defaultDesignSpec();
  it('is deterministic for the same spec', () => {
    expect(designHash(base)).toBe(designHash({ ...base }));
  });
  it('changes when ANY field changes (so the texture cache never serves a stale skin)', () => {
    const variants: Partial<SkinDesignSpec>[] = [
      { primary: '#111111' }, { secondary: '#222222' }, { accent: '#333333' },
      { pattern: SKIN_PATTERNS[2] }, { finish: SKIN_FINISHES[2] }, { density: SKIN_DENSITIES[2] },
      { emissive: '#39ff88' },
    ];
    const seen = new Set([designHash(base)]);
    for (const v of variants) {
      const h = designHash({ ...base, ...v });
      expect(seen.has(h)).toBe(false); // each field independently moves the hash
      seen.add(h);
    }
  });
});
