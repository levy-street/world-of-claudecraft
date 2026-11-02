// The Quartered Isle's quarter-blended ground palette (quartered_ground_core.ts).
// Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { srgbHexToLinear } from '../src/render/far_terrain_core';
import { setGroundPaletteOverrides } from '../src/render/ground_palette_override_core';
import {
  blendQuarterGround,
  makeQuarterGroundLinear,
  QUARTER_GROUND_PALETTES,
  quarteredBlendActive,
  quarteredGroundAt,
  quarterHexToLinear,
} from '../src/render/quartered_ground_core';
import { QUARTER_CENTERS, type QuarterId } from '../src/sim/quartered_quarters';

const QUARTERS: QuarterId[] = ['ice', 'fire', 'earth', 'wind'];
const TONES = ['grass', 'grassDark', 'grassYellow', 'dirt', 'sand'] as const;

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('quartered ground palette', () => {
  it('converts sRGB exactly like the far vista does', () => {
    for (const q of QUARTERS) {
      for (const tone of TONES) {
        const hex = QUARTER_GROUND_PALETTES[q][tone];
        expect(quarterHexToLinear(hex)).toEqual(srgbHexToLinear(hex));
      }
    }
  });

  it('a pure weight reproduces that quarter exactly', () => {
    for (const q of QUARTERS) {
      const w = { ice: 0, fire: 0, earth: 0, wind: 0, [q]: 1 };
      const out = blendQuarterGround(w, makeQuarterGroundLinear());
      for (const tone of TONES) {
        const want = quarterHexToLinear(QUARTER_GROUND_PALETTES[q][tone]);
        for (let i = 0; i < 3; i++) expect(out[tone][i]).toBeCloseTo(want[i], 12);
      }
    }
  });

  it("each quarter's heart wears its own ground, closer to it than to any other", () => {
    const out = makeQuarterGroundLinear();
    for (const q of QUARTERS) {
      const c = QUARTER_CENTERS[q];
      quarteredGroundAt(c.x, c.z, out);
      const own = dist(out.grass, quarterHexToLinear(QUARTER_GROUND_PALETTES[q].grass));
      for (const other of QUARTERS) {
        if (other === q) continue;
        const d = dist(out.grass, quarterHexToLinear(QUARTER_GROUND_PALETTES[other].grass));
        expect(own, `${q} heart vs ${other}`).toBeLessThan(d);
      }
    }
  });

  it('the quarters blend softly: no hard seam between neighbouring hearts', () => {
    const out = makeQuarterGroundLinear();
    const pairs: [QuarterId, QuarterId][] = [
      ['ice', 'fire'],
      ['fire', 'wind'],
      ['wind', 'earth'],
      ['earth', 'ice'],
      ['fire', 'earth'],
    ];
    for (const [a, b] of pairs) {
      const ca = QUARTER_CENTERS[a];
      const cb = QUARTER_CENTERS[b];
      const steps = 200;
      let prev: number[] | null = null;
      let maxStep = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        quarteredGroundAt(ca.x + (cb.x - ca.x) * t, ca.z + (cb.z - ca.z) * t, out);
        const cur = [...out.grass];
        if (prev) maxStep = Math.max(maxStep, dist(cur, prev));
        prev = cur;
      }
      // the whole walk spans at most ~0.75 linear units; a hard seam would
      // put most of that in one ~1 yard step
      expect(maxStep, `${a} to ${b}`).toBeLessThan(0.02);
    }
  });

  it('stays finite and in range far offshore', () => {
    const out = quarteredGroundAt(4000, -4000, makeQuarterGroundLinear());
    for (const tone of TONES) {
      for (const v of out[tone]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('blends only the quartered biome, and yields to a palette-lab override', () => {
    expect(quarteredBlendActive('quartered_isle', 'quartered')).toBe(true);
    expect(quarteredBlendActive('frostveil', 'frost')).toBe(false);
    const row = { grass: 1, grassDark: 2, grassYellow: 3, dirt: 4, sand: 5 };
    try {
      setGroundPaletteOverrides({ quartered_isle: row });
      expect(quarteredBlendActive('quartered_isle', 'quartered')).toBe(false);
      setGroundPaletteOverrides({ frostveil: row });
      expect(quarteredBlendActive('quartered_isle', 'quartered')).toBe(true);
    } finally {
      setGroundPaletteOverrides(null);
    }
  });

  it('both terrain tiers route the quartered strip through this one core', () => {
    for (const file of ['src/render/terrain_chunk_build.ts', 'src/render/far_terrain_core.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain("from './quartered_ground_core'");
      expect(src, file).toMatch(
        /quarteredBlendActive\(zn\.id, zn\.biome\)\s*\?\s*quartered(Ground|Palette)At\(x, z/,
      );
    }
  });
});
