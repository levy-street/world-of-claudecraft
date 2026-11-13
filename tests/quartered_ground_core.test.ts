// The Quartered Isle's quarter-blended ground palette (quartered_ground_core.ts).
// Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { srgbHexToLinear } from '../src/render/far_terrain_core';
import { setGroundPaletteOverrides } from '../src/render/ground_palette_override_core';
import {
  ARENA_SCAR_HEX,
  arenaQuarterWeights,
  blendQuarterGround,
  FISSURE_GROUND_PALETTES,
  LANDMARK_GROUND_PALETTES,
  makeQuarterGroundLinear,
  QUARTER_CLIFF_HEX,
  QUARTER_CLIFF_ROCK_SPLAT,
  QUARTER_CLIFF_SHARE,
  QUARTER_GROUND_PALETTES,
  QUARTER_GROUND_SHARPEN,
  QUARTERED_MESH_SPACING,
  quarteredBlendActive,
  quarteredCliffAt,
  quarteredGroundAt,
  quarteredMeshSpacing,
  quarterHexToLinear,
  sharpenQuarterWeights,
} from '../src/render/quartered_ground_core';
import { CHALLENGERS_RING, RIVALMOOT_HILL } from '../src/sim/quartered_isle_terrain';
import {
  CINDERSCAR_BURNWAYS,
  CINDERSCAR_GLASSFIELD,
  FIREICE_RIFT,
  quarteredLandmarkTint,
  RIMEGLASS_TARN,
} from '../src/sim/quartered_landmarks';
import { QUARTER_CENTERS, type QuarterId, quarterWeightsAt } from '../src/sim/quartered_quarters';

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
        // the quarter blend alone: the landmarks lay their own hard-edged
        // surfaces over it on purpose (the rift's basalt splits ice from fire)
        const x = ca.x + (cb.x - ca.x) * t;
        const z = ca.z + (cb.z - ca.z) * t;
        blendQuarterGround(quarterWeightsAt(x, z), out);
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

  it('lays each landmark surface over the quarter blend where its ground shows', () => {
    const out = makeQuarterGroundLinear();
    const at = (x: number, z: number) => {
      quarteredGroundAt(x, z, out);
      return [...out.grass];
    };
    const tone = (hex: number) => quarterHexToLinear(hex);
    // dead centre of each surface the overlay IS the landmark's own tone
    expect(
      dist(at(RIMEGLASS_TARN.x, RIMEGLASS_TARN.z), tone(LANDMARK_GROUND_PALETTES.ice.grass)),
    ).toBeLessThan(1e-6);
    expect(
      dist(
        at(CINDERSCAR_GLASSFIELD.x, CINDERSCAR_GLASSFIELD.z),
        tone(LANDMARK_GROUND_PALETTES.glass.grass),
      ),
    ).toBeLessThan(1e-6);
    const bed = CINDERSCAR_BURNWAYS[0][1];
    expect(dist(at(bed.x, bed.z), tone(LANDMARK_GROUND_PALETTES.ember.grass))).toBeLessThan(1e-6);
    const rift = FIREICE_RIFT.line[3];
    expect(dist(at(rift.x, rift.z), tone(LANDMARK_GROUND_PALETTES.basalt.grass))).toBeLessThan(
      1e-6,
    );
    // Rivalmoot's paving, whole under the plaza: a cool mid grey, not sand
    const moot = at(RIVALMOOT_HILL.x, RIVALMOOT_HILL.z);
    expect(dist(moot, tone(LANDMARK_GROUND_PALETTES.moot.grass))).toBeLessThan(1e-6);
    const hex = LANDMARK_GROUND_PALETTES.moot.grass;
    const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    expect(Math.abs(r - g)).toBeLessThan(12);
    expect(b).toBeGreaterThanOrEqual(r);
    // and away from every landmark and fissure the ground is the plain
    // quarter blend (found by search: the shattering covers most of the isle)
    const tint = { fissure: 0, ice: 0, ember: 0, glass: 0, stone: 0, basalt: 0, moot: 0 };
    let spot: [number, number] | null = null;
    for (let x = -200; x <= 200 && !spot; x += 7) {
      for (let z = 2000; z <= 2380 && !spot; z += 7) {
        quarteredLandmarkTint(x, z, tint);
        const offArena =
          arenaQuarterWeights(x, z, { ice: 0, fire: 0, earth: 0, wind: 0 }).share === 0;
        if (offArena && Object.values(tint).every((v) => v === 0)) spot = [x, z];
      }
    }
    expect(spot).not.toBeNull();
    const [px, pz] = spot ?? [0, 0];
    const plain = makeQuarterGroundLinear();
    blendQuarterGround({ ...sharpenQuarterWeights(quarterWeightsAt(px, pz)) }, plain);
    expect(dist(at(px, pz), plain.grass)).toBeLessThan(1e-9);
  });

  it('reads the quarters as the inspiration art: blue snow, red-hot rock, warm sand', () => {
    const rgb = (hex: number) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
    for (const tone of TONES) {
      // cold snow, never flat white: every ice tone is blue-led and visibly
      // tinted (a flat white has red, green and blue within a few steps)
      for (const hex of [
        QUARTER_GROUND_PALETTES.ice[tone],
        LANDMARK_GROUND_PALETTES.ice[tone],
        FISSURE_GROUND_PALETTES.ice[tone],
      ]) {
        const [r, g, b] = rgb(hex);
        expect(b, `ice ${tone}`).toBeGreaterThan(r + 20);
        expect(b).toBeGreaterThanOrEqual(g);
      }
      // the Cinderscar's ground is red terracotta: red leads green leads (or ties) blue
      const [fr, fg, fb] = rgb(QUARTER_GROUND_PALETTES.fire[tone]);
      expect(fr, `fire ${tone}`).toBeGreaterThan(fg);
      expect(fg).toBeGreaterThanOrEqual(fb - 8);
      // and its cracks glow molten orange and red
      const [mr, mg, mb] = rgb(FISSURE_GROUND_PALETTES.fire[tone]);
      expect(mr, `fire fissure ${tone}`).toBeGreaterThan(0xa0);
      expect(mr).toBeGreaterThan(mg * 1.4);
      expect(mg).toBeGreaterThan(mb);
      // the Wilds are warm sand with umber cracks: no green and
      // no crystal glow (red leads green leads blue, and the cracks stay dark)
      for (const hex of [
        QUARTER_GROUND_PALETTES.earth[tone],
        FISSURE_GROUND_PALETTES.earth[tone],
      ]) {
        const [r, g, b] = rgb(hex);
        expect(r, `earth ${tone}`).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
      }
      const [er, eg, eb] = rgb(FISSURE_GROUND_PALETTES.earth[tone]);
      expect(Math.max(er, eg, eb), `earth fissure ${tone}`).toBeLessThan(0x80);
    }
  });
});

describe('the quartered cliff stone', () => {
  it("gives each quarter's crags the inspiration's stone, blended like the ground", () => {
    const rgb = (hex: number) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
    const [fr, fg, fb] = rgb(QUARTER_CLIFF_HEX.fire);
    // blue-grey, a shade under the pale columns that stand on it: at the
    // columns' own pale tone the sunlit slopes read as snow on the red ground
    expect(fb).toBeGreaterThan(fr + 16);
    expect(Math.min(fr, fg, fb)).toBeGreaterThan(0x60);
    expect(Math.max(fr, fg, fb)).toBeLessThan(0x90);
    const [er, eg, eb] = rgb(QUARTER_CLIFF_HEX.earth);
    expect(er).toBeGreaterThan(eg); // warm sandstone
    expect(eg).toBeGreaterThan(eb);
    expect(Math.max(...rgb(QUARTER_CLIFF_HEX.ice))).toBeLessThan(0x78); // dark cold rock
    const out: [number, number, number] = [0, 0, 0];
    for (const q of ['ice', 'fire', 'earth', 'wind'] as const) {
      const c = QUARTER_CENTERS[q];
      quarteredCliffAt(c.x, c.z, out);
      const own = quarterHexToLinear(QUARTER_CLIFF_HEX[q]);
      const d = Math.hypot(out[0] - own[0], out[1] - own[1], out[2] - own[2]);
      expect(d, q).toBeLessThan(0.08);
    }
    expect(QUARTER_CLIFF_SHARE).toBeGreaterThan(0.5);
  });

  it('the near terrain tints the quartered biome cliffs through this core', () => {
    const src = readFileSync('src/render/terrain_chunk_build.ts', 'utf8');
    expect(src).toMatch(/biome === 'quartered' && rockTintW > 0/);
    expect(src).toMatch(/quarteredCliffAt\(x, z, /);
    // and holds the rock photo layer down there, so the tint shows on the
    // textured tier (that layer takes only a third of the ground tint)
    expect(src).toMatch(/biome === 'quartered' \? t \* QUARTER_CLIFF_ROCK_SPLAT : t/);
    expect(QUARTER_CLIFF_ROCK_SPLAT).toBeGreaterThan(0);
    expect(QUARTER_CLIFF_ROCK_SPLAT).toBeLessThanOrEqual(0.5);
  });
});

describe('the sharpened quarter borders', () => {
  it('keeps the weights a partition and the dominant quarter dominant', () => {
    expect(QUARTER_GROUND_SHARPEN).toBeGreaterThan(1);
    for (const [x, z] of [
      [90, 2100],
      [-90, 2150],
      [0, 2290],
      [-150, 2060],
    ]) {
      const raw = quarterWeightsAt(x, z);
      const w = { ...sharpenQuarterWeights(raw) };
      expect(w.ice + w.fire + w.earth + w.wind).toBeCloseTo(1, 9);
      const top = (q: typeof raw) =>
        (Object.keys(q) as QuarterId[]).reduce((a, b) => (q[b] > q[a] ? b : a));
      expect(top(w)).toBe(top(raw));
      // the leader's share only grows: no half and half mud between two grounds
      expect(w[top(raw)]).toBeGreaterThanOrEqual(raw[top(raw)]);
    }
  });

  it('turns a two-quarter mix into the stronger quarter with a trace of the other', () => {
    const w = { ...sharpenQuarterWeights({ ice: 0.63, fire: 0.37, earth: 0, wind: 0 }) };
    expect(w.ice).toBeGreaterThan(0.8);
    expect(w.fire).toBeLessThan(0.2);
    const even = { ...sharpenQuarterWeights({ ice: 0.5, fire: 0.5, earth: 0, wind: 0 }) };
    expect(even.ice).toBeCloseTo(0.5, 9);
  });
});

describe("the Challenger's Ring floor", () => {
  const a = CHALLENGERS_RING;
  const w = { ice: 0, fire: 0, earth: 0, wind: 0 };
  const at = (bearingDeg: number, r: number) => {
    const b = (bearingDeg * Math.PI) / 180;
    return arenaQuarterWeights(a.x + Math.cos(b) * r, a.z + Math.sin(b) * r, w);
  };

  it('gives each ramp its own quarter as a full wedge of the floor', () => {
    const order: QuarterId[] = ['ice', 'fire', 'earth', 'wind'];
    a.ramps.forEach((bearing, i) => {
      const res = at(bearing, a.floorR * 0.6);
      expect(res.share).toBe(1);
      expect(res.scar).toBe(0);
      expect(w[order[i]], order[i]).toBeCloseTo(1, 9);
    });
  });

  it('scorches a dark seam down each diagonal between two wedges', () => {
    for (const bearing of [45, 135, -45, -135]) {
      const res = at(bearing, a.floorR * 0.6);
      expect(res.scar).toBeCloseTo(1, 6);
      expect(w.ice + w.fire + w.earth + w.wind).toBeCloseTo(1, 9);
      expect(Math.max(w.ice, w.fire, w.earth, w.wind)).toBeLessThan(0.6);
    }
    // the seam is pulled most of the way to the scar tone
    const out = makeQuarterGroundLinear();
    const b = Math.PI / 4;
    quarteredGroundAt(a.x + Math.cos(b) * 30, a.z + Math.sin(b) * 30, out);
    const scar = quarterHexToLinear(ARENA_SCAR_HEX);
    expect(dist([...out.grass], scar)).toBeLessThan(0.15);
  });

  it('fades out up the crater wall and is gone beyond it', () => {
    expect(at(0, a.floorR - 1).share).toBe(1);
    const mid = at(0, (a.floorR + a.wallR) / 2).share;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(at(0, a.wallR + 3).share).toBe(0);
    expect(at(0, a.outerR).share).toBe(0);
  });

  it('leaves the floor clear of the basalt the walls wear', () => {
    const tint = { fissure: 0, ice: 0, ember: 0, glass: 0, stone: 0, basalt: 0, moot: 0 };
    quarteredLandmarkTint(a.x + 20, a.z + 5, tint);
    expect(tint.basalt).toBe(0);
    quarteredLandmarkTint(a.x + a.wallR, a.z, tint);
    expect(tint.basalt).toBeGreaterThan(0.8);
  });
});

describe('the isle terrain mesh spacing', () => {
  it('meshes every chunk over the isle finer than the world bands, and nothing off it', () => {
    // the world's bands run to 2.6yd (high) and 6.5yd (low): the isle's
    // fissure walls and plate edges turn over a few yards, so its chunks
    // mesh finer on both tiers
    expect(QUARTERED_MESH_SPACING.high).toBeLessThanOrEqual(1.2);
    expect(QUARTERED_MESH_SPACING.low).toBeLessThan(2.6);
    expect(quarteredMeshSpacing(0, 2100, 60, false)).toBe(QUARTERED_MESH_SPACING.high);
    expect(quarteredMeshSpacing(0, 2100, 60, true)).toBe(QUARTERED_MESH_SPACING.low);
    // a chunk only touching the isle's edge still counts
    expect(quarteredMeshSpacing(-300, 2100, 60, false)).toBe(QUARTERED_MESH_SPACING.high);
    expect(quarteredMeshSpacing(0, -40, 60, false)).toBe(Infinity);
    expect(quarteredMeshSpacing(600, 2100, 60, false)).toBe(Infinity);
  });
});
