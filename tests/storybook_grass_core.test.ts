// The storybook meadow grass every zone's looks share (RENDER_PURE_CORES):
// the ramp keeps each field's own hue, flowerless fields stay flowerless and
// bladeless fields take nothing. Node-only: no Three, no DOM.
import { describe, expect, it } from 'vitest';
import {
  BLADELESS_BIOMES,
  FLOWERLESS_BIOMES,
  STORYBOOK_GRASS_RENDER,
  storybookGrassFor,
  storybookGrassForBiome,
  storybookRampFor,
} from '../src/render/palette_lab/storybook_grass_core';
import { BIOME_PALETTE } from '../src/render/terrain_palette';

function hsl(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe('storybookRampFor', () => {
  it('keeps the hue of a pink, a gold and a green field', () => {
    const fields: Array<[number, number]> = [
      [0xd890b8, 0x9a5a80], // pink
      [0xc8a040, 0x806020], // gold
      [0x6a9a48, 0x3a6a30], // green
    ];
    for (const [grass, grassDark] of fields) {
      const ramp = storybookRampFor(grass, grassDark);
      expect(hueGap(hsl(ramp.rampLight)[0], hsl(grass)[0])).toBeLessThan(4);
      expect(hueGap(hsl(ramp.rampShadow)[0], hsl(grassDark)[0])).toBeLessThan(4);
    }
  });

  it('darkens the shadow end and lightens the light end', () => {
    const ramp = storybookRampFor(0x6a9a48, 0x3a6a30);
    expect(hsl(ramp.rampShadow)[2]).toBeLessThan(hsl(0x3a6a30)[2]);
    expect(hsl(ramp.rampLight)[2]).toBeGreaterThan(hsl(0x6a9a48)[2]);
    expect(hsl(ramp.rampLight)[1]).toBeGreaterThan(hsl(0x6a9a48)[1]);
  });

  it('leaves a grey field grey', () => {
    const ramp = storybookRampFor(0x808080, 0x404040);
    expect(hsl(ramp.rampLight)[1]).toBe(0);
    expect(hsl(ramp.rampShadow)[1]).toBe(0);
  });

  it('clamps a near-white field instead of overflowing', () => {
    // 0.98 lightness times 1.2 caps at 1: pure white, not a wrapped channel
    const ramp = storybookRampFor(0xfafafa, 0xf0f0f0);
    expect(ramp.rampLight).toBe(0xffffff);
  });
});

describe('storybookGrassFor', () => {
  it('carries the shared blades and the recoloured ramp', () => {
    const grass = storybookGrassFor(0x6a9a48, 0x3a6a30, false);
    expect(grass.bladeExtra).toBe(1);
    expect(grass.rampStrength).toBe(STORYBOOK_GRASS_RENDER.rampStrength);
    expect(grass.flowerShare).toBe(STORYBOOK_GRASS_RENDER.flowerShare);
    expect(grass.rampLight).toBe(storybookRampFor(0x6a9a48, 0x3a6a30).rampLight);
  });

  it('shows no flowers on a flowerless field', () => {
    expect(storybookGrassFor(0x6a9a48, 0x3a6a30, true).flowerShare).toBe(0);
  });

  it('never brings the meadow rim, ink, canopy or shadow keys', () => {
    for (const key of ['rim', 'ink', 'canopyLift', 'shadowStrength']) {
      expect(Object.keys(STORYBOOK_GRASS_RENDER)).not.toContain(key);
    }
  });
});

describe('storybookGrassForBiome', () => {
  it('gives a bladeless field nothing', () => {
    for (const biome of BLADELESS_BIOMES) {
      const p = BIOME_PALETTE[biome];
      expect(storybookGrassForBiome(biome, p.grass, p.grassDark)).toEqual({});
    }
  });

  it('gives a flowerless field with blades its blades but no flowers', () => {
    const p = BIOME_PALETTE.haunt;
    expect(FLOWERLESS_BIOMES.has('haunt')).toBe(true);
    const grass = storybookGrassForBiome('haunt', p.grass, p.grassDark);
    expect(grass.bladeExtra).toBe(1);
    expect(grass.flowerShare).toBe(0);
  });

  it('gives a vale field the blades and flowers', () => {
    const p = BIOME_PALETTE.vale;
    const grass = storybookGrassForBiome('vale', p.grass, p.grassDark);
    expect(grass.bladeExtra).toBe(1);
    expect(grass.flowerShare).toBe(STORYBOOK_GRASS_RENDER.flowerShare);
  });
});
