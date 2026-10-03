// The Hollow Crypt's pure render cores: the authored-field terrain plan, the
// dressing plan, the render-only set dressing and the gate reveal memory.

import { afterEach, describe, expect, it } from 'vitest';
import {
  planFieldCliffs,
  planFieldTops,
  triangulatePolygon,
} from '../src/render/authored_field/field_mesh_core';
import {
  clearGateMemoryForTest,
  gateMemoryKey,
  gateView,
  observeGate,
} from '../src/render/hollow_crypt/crypt_gate_state_core';
import {
  GATE_REVEAL_SECONDS,
  gateOpenness,
  HOLLOW_CRYPT_LIGHTS,
  HOLLOW_CRYPT_WISP_RIVERS,
  planEdgeDressing,
  RITE_RING,
  riverPointAt,
} from '../src/render/hollow_crypt/crypt_plan_core';
import { HOLLOW_CRYPT_SET_DRESSING } from '../src/render/hollow_crypt/crypt_set_dressing_core';
import {
  boneBurstPhase,
  boneBurstSpec,
  coneFan,
  cryptTelegraphSpecs,
  telegraphFill,
  telegraphYaw,
} from '../src/render/hollow_crypt/crypt_trash_fx_core';
import {
  HOLLOW_CRYPT_FIELD,
  HOLLOW_CRYPT_RING,
  RITE_DAIS,
} from '../src/sim/content/hollow_crypt_layout';
import { MOBS } from '../src/sim/data';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_GRAVE_CLEAVE,
  CRYPT_STONE_SHRIEK,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../src/sim/mob/trash_kit';

describe('authored field terrain plan', () => {
  it('ear-clips a concave polygon into triangles covering its exact area', () => {
    const l: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const tris = triangulatePolygon(l);
    expect(tris.length).toBe((l.length - 2) * 3);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [l[tris[i]], l[tris[i + 1]], l[tris[i + 2]]];
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(64, 6);
  });

  it('seats every walkable top vertex on its own surface height', () => {
    const tops = planFieldTops(HOLLOW_CRYPT_FIELD, { maxEdge: 6, layerLift: 0 });
    for (const family of ['stone', 'soil'] as const) {
      const p = tops[family].positions;
      expect(p.length).toBeGreaterThan(0);
      for (let i = 0; i < p.length; i += 3 * 97) {
        const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
        // Interior samples read back the sim height exactly (edges may belong
        // to a neighbour, so only points well inside their surface count).
        const s = authoredFieldSurfaceAt(HOLLOW_CRYPT_FIELD, x, z);
        if (!s || s.kind === 'path') continue;
        const inside = [
          [0.8, 0.8],
          [-0.8, 0.8],
          [0.8, -0.8],
          [-0.8, -0.8],
        ].every(([dx, dz]) => authoredFieldSurfaceAt(HOLLOW_CRYPT_FIELD, x + dx, z + dz) === s);
        if (inside) expect(y).toBeCloseTo(authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z), 5);
      }
    }
  });

  it('winds every walkable top to face up (front faces seen from above)', () => {
    const tops = planFieldTops(HOLLOW_CRYPT_FIELD, { maxEdge: 6, layerLift: 0 });
    for (const family of ['stone', 'soil'] as const) {
      const p = tops[family].positions;
      for (let i = 0; i < p.length; i += 9) {
        const ny =
          (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]) - (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]);
        expect(ny).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pins every cliff face top to its walkable edge and drops it into the chasm', () => {
    const cliffs = planFieldCliffs(HOLLOW_CRYPT_FIELD, {
      voidFloor: -65,
      columnStep: 2,
      rowStep: 4,
      flare: 0.2,
    });
    const ys = cliffs.positions.filter((_, i) => i % 3 === 1);
    // The Rite dais's rim (the raised floor where Morthen stands) tops them.
    expect(Math.max(...ys)).toBeCloseTo(HOLLOW_CRYPT_RING.h + RITE_DAIS.rise, 5);
    expect(Math.min(...ys)).toBeCloseTo(-65, 5);
    expect(cliffs.indices.length % 3).toBe(0);
  });
});

describe('the Hollow Crypt dressing plan', () => {
  it('every soul river ends in the column over the Rite Ring', () => {
    for (const r of HOLLOW_CRYPT_WISP_RIVERS) {
      const end = riverPointAt(r, 0.99999);
      expect(Math.hypot(end[0] - RITE_RING.x, end[2] - RITE_RING.z), r.id).toBeLessThan(2);
      expect(end[1]).toBeGreaterThan(RITE_RING.h);
    }
  });

  it('keeps at most eight point lights per light zone', () => {
    for (const zone of HOLLOW_CRYPT_FIELD.lightZones) {
      const inside = HOLLOW_CRYPT_LIGHTS.filter(
        (l) => Math.hypot(l.x - zone.x, l.z - zone.z) <= zone.r,
      );
      expect(inside.length, zone.id).toBeLessThanOrEqual(8);
    }
  });

  it('dresses cliff edges on the high side, never over the chasm', () => {
    const edges = planEdgeDressing();
    expect(edges.length).toBeGreaterThan(40);
    for (const e of edges) {
      expect(authoredFieldHeight(HOLLOW_CRYPT_FIELD, e.x, e.z)).toBeGreaterThan(
        HOLLOW_CRYPT_FIELD.voidHeight,
      );
    }
  });

  it('stands no tall render-only piece on walkable ground', () => {
    const TALL = /ChapelRuin|RockPillar|BoneCrown|TraceryWindow|DistantSpire|BellTower/;
    for (const p of HOLLOW_CRYPT_SET_DRESSING) {
      if (!TALL.test(p.piece)) continue;
      // Anchored on the void side (or an authored absolute height off the
      // walkable terrain), never in the middle of a floor players cross.
      const floor = authoredFieldHeight(HOLLOW_CRYPT_FIELD, p.x, p.z);
      const onWalkable = floor > HOLLOW_CRYPT_FIELD.voidHeight;
      if (onWalkable) expect(p.piece, `${p.piece} at ${p.x},${p.z}`).toMatch(/BoneCrown/);
    }
  });
});

describe('gate reveal memory', () => {
  afterEach(() => clearGateMemoryForTest());

  it('snaps on first sight and plays the reveal on a later change', () => {
    const key = gateMemoryKey(100, 200, 'grille');
    expect(gateView(key, 0).openness).toBe(0);
    observeGate(key, 'dungeon_gate_open', 10);
    expect(gateView(key, 10).openness).toBe(1); // arrived to an open gate: no replay
    observeGate(key, 'dungeon_gate_sealed', 20);
    expect(gateView(key, 20).openness).toBeCloseTo(1, 5);
    expect(gateView(key, 20 + GATE_REVEAL_SECONDS / 2).openness).toBeCloseTo(0.5, 5);
    expect(gateView(key, 20 + GATE_REVEAL_SECONDS + 1).openness).toBe(0);
    expect(gateView(key, 21).state).toBe('sealed');
  });

  it('eases monotonically from closed to open', () => {
    let prev = -1;
    for (let t = 0; t <= GATE_REVEAL_SECONDS; t += 0.1) {
      const o = gateOpenness(0, 1, t);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    expect(gateOpenness(0, 1, GATE_REVEAL_SECONDS)).toBe(1);
  });
});

describe('crypt trash telegraphs', () => {
  it('draws every dodge-able trash cast at the size the sim resolves it at', () => {
    const specs = cryptTelegraphSpecs();
    const warrior = MOBS.crypt_ossuary_warrior.breathCone;
    expect(specs[CRYPT_GRAVE_CLEAVE]).toMatchObject({
      shape: 'cone',
      range: warrior?.range,
      arcDeg: warrior?.arcDeg,
    });
    const drake = MOBS.crypt_ossuary_drake;
    expect(specs[CRYPT_BARROWFLAME_BREATH].range).toBe(drake.breathCone?.range);
    expect(specs[CRYPT_TAIL_LASH]).toMatchObject({
      shape: 'rearCone',
      range: drake.trashKit?.tailLash?.range,
    });
    expect(specs[CRYPT_WING_GUST].range).toBe(drake.trashKit?.wingGust?.radius);
    expect(specs[CRYPT_STONE_SHRIEK].range).toBe(
      MOBS.crypt_chapel_gargoyle.trashKit?.screech?.radius,
    );
    // The tail lash points behind the drake.
    expect(telegraphYaw('rearCone', 0.3)).toBeCloseTo(0.3 + Math.PI, 9);
    expect(telegraphYaw('cone', 0.3)).toBe(0.3);
  });

  it('fills as the bar runs and lays a cone fan about +z', () => {
    expect(telegraphFill(2, 2)).toBe(0);
    expect(telegraphFill(0.5, 2)).toBeCloseTo(0.75, 9);
    expect(telegraphFill(0, 2)).toBe(1);
    const fan = coneFan(8, 90, 4);
    expect(fan[0]).toEqual([0, 0]);
    expect(fan).toHaveLength(6);
    for (const [x, z] of fan.slice(1)) expect(Math.hypot(x, z)).toBeCloseTo(8, 9);
    expect(fan[3][0]).toBeCloseTo(0, 9);
    expect(fan[3][1]).toBeCloseTo(8, 9);
  });

  it('warns for the whole Bone Burst fuse, then flashes once', () => {
    const { radius, delay } = boneBurstSpec();
    expect(radius).toBe(MOBS.crypt_bone_minion.deathThroes?.radius);
    expect(boneBurstPhase(0, delay)).toEqual({ stage: 'fuse', fill: 0 });
    expect(boneBurstPhase(delay / 2, delay).fill).toBeCloseTo(0.5, 9);
    expect(boneBurstPhase(delay + 0.1, delay).stage).toBe('flash');
    expect(boneBurstPhase(delay + 5, delay).stage).toBe('done');
  });
});
