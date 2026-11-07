// The Quench vein's air, weather, frost and light (phase 2H, presentation only:
// quench_air_core.ts, quench_frost_core.ts, heart_environment.ts): the Singing
// Ice's creak schedule (the same arithmetic the shaders run) and its cracks
// kept on the sheet, the mist under the walks and past the rims, the steam
// at the vents, the braziers' fire on every tier, the tier's thinning, the
// frost's reach over the mountain, and the Quench's own light: a pale cold
// key over a pale blue-grey fill, never navy, its air a pale mist.

import { describe, expect, it } from 'vitest';
import {
  inQuenchLight,
  SMITH_HEART_QUENCH_FOG,
  SMITH_HEART_QUENCH_LIGHT,
} from '../src/render/smith_heart/heart_environment';
import {
  planQuenchAir,
  planSingingCracks,
  QUENCH_CREAK,
  quenchCreakAt,
  quenchCreakLook,
} from '../src/render/smith_heart/quench_air_core';
import { quenchCliffPaint, quenchFrostWeight } from '../src/render/smith_heart/quench_frost_core';
import { QUENCH_BRAZIER_FIRE } from '../src/render/smith_heart/quench_kit_plan_core';
import {
  BREATH,
  HEART_ROOM,
  LAKE_BRAZIERS,
  QUENCH,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;

describe("the Quench's air and weather", () => {
  it('creaks every crack of the Singing Ice in turn, one a cell, growing then fading', () => {
    const seen = new Set<number>();
    for (let k = 0; k < QUENCH_CREAK.cracks; k++) {
      const c = quenchCreakAt(k * QUENCH_CREAK.cell + 0.01, QUENCH_CREAK.cracks);
      seen.add(c.crack);
      expect(c.crack).toBeGreaterThanOrEqual(0);
      expect(c.crack).toBeLessThan(QUENCH_CREAK.cracks);
      expect(c.since).toBeLessThan(QUENCH_CREAK.cell);
    }
    expect(seen.size).toBe(QUENCH_CREAK.cracks);
    // A creak fits its cell: grown, held and faded before the next begins.
    expect(QUENCH_CREAK.grow + QUENCH_CREAK.hold + QUENCH_CREAK.fade).toBeLessThanOrEqual(
      QUENCH_CREAK.cell,
    );
    expect(quenchCreakLook(0).grown).toBe(0);
    expect(quenchCreakLook(QUENCH_CREAK.grow).grown).toBe(1);
    expect(quenchCreakLook(QUENCH_CREAK.grow + 0.01).burst).toBeGreaterThan(0.9);
    expect(quenchCreakLook(QUENCH_CREAK.grow / 2).burst).toBe(0);
    expect(
      quenchCreakLook(QUENCH_CREAK.grow + QUENCH_CREAK.hold + QUENCH_CREAK.fade + 0.1).glow,
    ).toBe(0);
  });

  it('runs every crack on the Singing Ice, a yard inside its edge', () => {
    const I = QUENCH.ice;
    const cracks = planSingingCracks();
    expect(cracks).toHaveLength(QUENCH_CREAK.cracks);
    for (const c of cracks) {
      expect(c.pts.length).toBeGreaterThan(10);
      for (const p of c.pts) {
        expect(p.x).toBeGreaterThanOrEqual(I.x0 + 1 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(I.x1 - 1 + 1e-9);
        expect(p.z).toBeGreaterThanOrEqual(I.z0 + 1 - 1e-9);
        expect(p.z).toBeLessThanOrEqual(I.z1 - 1 + 1e-9);
        expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id).toBe('singing_ice');
      }
    }
  });

  it('lays the mist in the void under the walks, the steam at the vents, the fire in the bowls', () => {
    const full = planQuenchAir(1);
    const low = planQuenchAir(0.35);
    for (const m of full.mists) {
      // Never over a walk thicker than its own floor: a card over a floor
      // lies well under it.
      const s = authoredFieldSurfaceAt(F, m.x, m.z);
      if (s) expect(m.y, `${m.x} ${m.z}`).toBeLessThan(authoredFieldHeight(F, m.x, m.z) - 4);
    }
    const vents = F.props.filter((p) => p.kind === 'sh_steam_vent');
    for (const v of vents)
      expect(full.steam.some((s) => Math.hypot(s.x - v.x, s.z - v.z) < 0.01)).toBe(true);
    expect(full.fires).toHaveLength(LAKE_BRAZIERS.length);
    for (const [i, b] of LAKE_BRAZIERS.entries()) {
      expect(full.fires[i].x).toBe(b.x);
      expect(full.fires[i].y).toBeCloseTo(
        authoredFieldHeight(F, b.x, b.z) + QUENCH_BRAZIER_FIRE,
        6,
      );
    }
    const count = (p: typeof full) => p.volumes.reduce((n, v) => n + v.flakes + v.motes, 0);
    expect(count(low)).toBeLessThan(count(full) * 0.45);
    // The fire and the creaks stay on every tier.
    expect(low.fires).toEqual(full.fires);
    expect(low.cracks).toEqual(full.cracks);
  });
});

describe("the Quench's frost on the mountain", () => {
  it('frosts the Quench, fades out at the Ring, the Breath and the Heart', () => {
    expect(quenchFrostWeight(QUENCH.lake.x, QUENCH.lake.z)).toBeCloseTo(1, 6);
    expect(quenchFrostWeight(QUENCH.q2.x, QUENCH.q2.z)).toBeCloseTo(1, 6);
    expect(quenchFrostWeight(0, 0)).toBe(0);
    expect(quenchFrostWeight(70, 0)).toBe(0);
    expect(quenchFrostWeight(BREATH.cornice.x, BREATH.cornice.z)).toBe(0);
    expect(quenchFrostWeight(HEART_ROOM.x, HEART_ROOM.z)).toBe(0);
    expect(quenchFrostWeight(-200, 0)).toBe(0);
  });

  it('paints the Quench cliffs a pale cold granite, snow on their lips, never black', () => {
    const lip = quenchCliffPaint(150, -24.2, -60, -24);
    const deep = quenchCliffPaint(150, -60, -60, -24);
    expect(lip[0]).toBeGreaterThan(deep[0]);
    for (const c of [lip, deep]) {
      expect(c[2]).toBeGreaterThan(c[0]);
      expect(Math.min(...c)).toBeGreaterThan(0.18);
    }
  });
});

describe("the Quench's light", () => {
  it('wins east of the Ring past its mouth, never on the Ring', () => {
    expect(inQuenchLight(QUENCH.lake.x, QUENCH.lake.z)).toBe(true);
    expect(inQuenchLight(QUENCH.q1.x, QUENCH.q1.z)).toBe(true);
    expect(inQuenchLight(150, -86)).toBe(true);
    expect(inQuenchLight(84, 0)).toBe(false);
    expect(inQuenchLight(0, 70)).toBe(false);
    expect(inQuenchLight(BREATH.cornice.x, BREATH.cornice.z)).toBe(false);
  });

  it('lights the Quench its own: a pale cold key over a pale blue-grey fill, never navy', () => {
    const L = SMITH_HEART_QUENCH_LIGHT;
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const [r, g, b] = rgb(L.hemiSky);
    expect(b).toBeGreaterThan(r);
    expect(b - r).toBeLessThan(50);
    expect(Math.min(r, g, b)).toBeGreaterThan(130);
    const [kr, , kb] = rgb(L.sunColor);
    expect(kb).toBeGreaterThanOrEqual(kr);
    expect(L.env).toBeLessThanOrEqual(0.05);
    // A pale mist, not a dark storm: the fog's value a light grey-blue.
    const [fr, fg, fb] = rgb(SMITH_HEART_QUENCH_FOG.color);
    expect(fb).toBeGreaterThan(fr);
    expect(Math.min(fr, fg, fb)).toBeGreaterThan(110);
    // Readable across the lake: the mist starts past the arena's width.
    expect(SMITH_HEART_QUENCH_FOG.near).toBeGreaterThanOrEqual(QUENCH.lake.rx * 1.8);
  });
});
