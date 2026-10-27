// The Smith's Heart raid's Quench vein (phase 2H, docs/design/raid/smith_heart.md
// section 5.15): its frost-bound and lake-ice floors, its Blender kit
// (scripts/assets/smith_heart_quench_kit/build.mjs, built from
// docs/design/raid/kit/build_smith_heart_quench_kit.py) and its plan
// (quench_kit_plan_core.ts):
//   - the floors: every Quench walk frost-bound granite, the Frozen Lake and
//     the Singing Ice their own clear ice;
//   - the shipped GLB is the current sources', inside its budget, crystal,
//     coals and the vein's light the only glow, the ice on its own slot; the
//     pieces a body touches stay within their colliders, the walls, the
//     inlays, the drifts and the vent never stand over a walk, the heaped ice
//     never reaches the shelf, the falls stand out of the rock no further
//     than the plan allows;
//   - the plan fits every Quench prop, walls every Quench walk over the void
//     (never over a walk), hangs the falls on rock facing a Quench walk and
//     never over a floor, lays the inlays flat on their floors and the drifts
//     at the lake's edge.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), so a
// piece's front (Blender -Y) is +Z here, as in the game.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_QUENCH_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_quench_kit/build.mjs';
import {
  fieldFamilyUvScale,
  fieldGroundFamily,
  topColor,
} from '../src/render/authored_field/field_mesh_core';
import { HEART_KIT_SLOTS } from '../src/render/smith_heart/heart_kit';
import {
  planQuenchDressing,
  planQuenchFalls,
  planQuenchKit,
  planQuenchProps,
  planQuenchWalls,
  QUENCH_BRAZIER_FIRE,
  QUENCH_DRIFT_FLOORS,
  QUENCH_FALLS,
  QUENCH_KIT_KINDS,
  QUENCH_WALK_SURFACES,
  quenchWallClear,
} from '../src/render/smith_heart/quench_kit_plan_core';
import { QUENCH, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;

/** Every walked floor of the Quench but the two sheets of ice. */
const RIME_FLOORS = [
  'quench_mouth',
  'quench_q1',
  'quench_stair',
  'quench_q2',
  'quench_shelf_stair',
  'lake_descent',
  'lake_shelf',
];

describe("the Quench's floors", () => {
  it('lays every Quench walk in frost-bound granite, the lake and the sheet in clear ice', () => {
    expect(fieldGroundFamily('rime')).toBe('rime');
    expect(fieldGroundFamily('lake_ice')).toBe('lake_ice');
    expect(fieldFamilyUvScale('rime')).toBeCloseTo(1 / 12, 9);
    expect(fieldFamilyUvScale('lake_ice')).toBeCloseTo(1 / 18, 9);
    for (const id of RIME_FLOORS)
      expect(F.surfaces.find((s) => s.id === id)?.ground, id).toBe('rime');
    for (const id of ['frozen_lake', 'singing_ice'])
      expect(F.surfaces.find((s) => s.id === id)?.ground, id).toBe('lake_ice');
  });

  it('paints the frost-bound granite cool, a rock under drifts of snow, never one flat colour', () => {
    const lum: number[] = [];
    let cool = 0;
    let white = 0;
    let n = 0;
    for (let x = 100; x < 240; x += 7)
      for (let z = -100; z < 40; z += 11) {
        const [r, g, b] = topColor('rime', x, z, false);
        lum.push(0.3 * r + 0.59 * g + 0.11 * b);
        if (b > r) cool++;
        if (r > 0.45) white++;
        n++;
      }
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(1.4);
    expect(cool / n).toBeGreaterThan(0.9);
    // Snow drifts over the rock, never a white sheet (a three-value read).
    expect(white / n).toBeGreaterThan(0.03);
    expect(white / n).toBeLessThan(0.5);
  });
});

// ---- the kit's GLB ---------------------------------------------------------------

const KIT = ASSET.target;
const haveKit = existsSync(KIT);

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  points: V3[];
  /** The points per material (KitStone, KitGlow, KitIce). */
  byMaterial: Map<string, V3[]>;
  triangles: number;
  materials: Set<string>;
}
const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  extras = (doc.getRoot().getExtras() ?? {}) as Record<string, unknown>;
  nodeNames = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName())
    .sort();
  materialNames = doc
    .getRoot()
    .listMaterials()
    .map((m) => m.getName())
    .sort();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const points: V3[] = [];
    const byMaterial = new Map<string, V3[]>();
    const materials = new Set<string>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      materials.add(mat);
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const list = byMaterial.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const p: V3 = [
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ];
        points.push(p);
        list.push(p);
      }
      byMaterial.set(mat, list);
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, byMaterial, triangles, materials });
  }
});

const shape = (name: string): Shape => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  return s;
};

/** How far a piece reaches from its origin between a hand over the ground
 *  (flat chips a body walks over) and `below` yards up. */
const reach = (name: string, below: number): number => {
  let r = 0;
  for (const p of shape(name).points)
    if (p[1] < below && p[1] > 0.3) r = Math.max(r, Math.hypot(p[0], p[2]));
  return r;
};

describe('Smith Heart Quench kit: the piece list and the shipped GLB', () => {
  it('lists every piece once: the basin, the lake, the Singing Ice, the landings, the walls', () => {
    const list = SMITH_HEART_QUENCH_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'LakeBrazier',
      'SteamVent',
      'IceShelfA',
      'IceShelfB',
      'SunkBlade',
      'IceBlade',
      'IceCrackA',
      'IceCrackB',
      'FrostStone',
      'QuenchWallA',
      'QuenchWallB',
      'FrozenFallA',
      'FrozenFallB',
      'SnowDriftA',
      'SnowDriftB',
    ])
      expect(list, piece).toContain(piece);
  });

  it('bakes the ice on its own slot (the kits know three)', () => {
    expect(HEART_KIT_SLOTS).toEqual(['stone', 'glow', 'ice']);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_QUENCH_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const cap = /Crack|Drift|Vent|Wall/.test(name) ? 2000 : 7000;
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
      total += s.triangles;
    }
    expect(total).toBeLessThan(45_000);
  });

  it.skipIf(!haveKit)(
    'glows only in the coals, the crystal and the vein light; the ice is ice',
    () => {
      for (const glowing of [
        'Kit_LakeBrazier',
        'Kit_SunkBlade',
        'Kit_FrostStone',
        'Kit_SteamVent',
        'Kit_IceCrackA',
      ])
        expect(shape(glowing).materials.has('KitGlow'), glowing).toBe(true);
      for (const icy of [
        'Kit_SunkBlade',
        'Kit_IceShelfA',
        'Kit_IceShelfB',
        'Kit_IceBlade',
        'Kit_FrozenFallA',
        'Kit_FrozenFallB',
        'Kit_FrostStone',
      ])
        expect(shape(icy).materials.has('KitIce'), icy).toBe(true);
      for (const plain of ['Kit_QuenchWallA', 'Kit_SnowDriftA', 'Kit_SnowDriftB'])
        expect(shape(plain).materials.has('KitGlow'), plain).toBe(false);
    },
  );
});

describe('Smith Heart Quench kit: the measures the plan relies on', () => {
  it.skipIf(!haveKit)('keeps every touchable foot inside its collider and a body', () => {
    const prop = (kind: string) => F.props.find((p) => p.kind === kind);
    // Brazier 1.5, blade 1.6, stone 1.6, ice blade 0.8 (a body's width past each).
    expect(reach('Kit_LakeBrazier', 3)).toBeLessThanOrEqual((prop('sh_brazier')?.r ?? 0) + 0.5);
    expect(reach('Kit_SunkBlade', 3)).toBeLessThanOrEqual((prop('sh_sunk_blade')?.r ?? 0) + 0.5);
    expect(reach('Kit_FrostStone', 3)).toBeLessThanOrEqual((prop('sh_frost_stone')?.r ?? 0) + 0.5);
    expect(reach('Kit_IceBlade', 3)).toBeLessThanOrEqual((prop('sh_ice_blade')?.r ?? 0) + 0.5);
    // The blades are landmarks: the Smith's sword stands twice a body's
    // height and more over the lake.
    expect(shape('Kit_SunkBlade').max[1]).toBeGreaterThan(11);
  });

  it.skipIf(!haveKit)('burns the bowl’s fire where the plan lights its flame', () => {
    const coals = shape('Kit_LakeBrazier').byMaterial.get('KitGlow') ?? [];
    expect(coals.length).toBeGreaterThan(0);
    const top = Math.max(...coals.map((p) => p[1]));
    const low = Math.min(...coals.map((p) => p[1]));
    expect(low).toBeGreaterThan(QUENCH_BRAZIER_FIRE - 0.3);
    expect(top).toBeLessThan(QUENCH_BRAZIER_FIRE + 0.45);
  });

  it.skipIf(!haveKit)('lays the inlays, the drifts and the vent flat under every telegraph', () => {
    for (const flat of ['Kit_IceCrackA', 'Kit_IceCrackB'])
      expect(shape(flat).max[1], flat).toBeLessThan(0.05);
    for (const low of ['Kit_SnowDriftA', 'Kit_SnowDriftB', 'Kit_SteamVent'])
      expect(shape(low).max[1], low).toBeLessThanOrEqual(0.3);
  });

  it.skipIf(!haveKit)('stands the walls past the lip, a knee high, nothing over the walk', () => {
    for (const v of ['A', 'B']) {
      const s = shape(`Kit_QuenchWall${v}`);
      for (const p of s.points) if (p[2] < 0.04) expect(p[1], v).toBeLessThan(0.05);
      expect(s.max[1], v).toBeGreaterThan(0.8);
      expect(s.max[1], v).toBeLessThan(1.1);
      expect(s.max[2], v).toBeLessThanOrEqual(1.05);
    }
  });

  it.skipIf(!haveKit)(
    'heaps the old ice short of the shelf, and hangs the falls their height',
    () => {
      for (const v of ['A', 'B']) {
        const s = shape(`Kit_IceShelf${v}`);
        // Its face toward the lake (+Z) stands at most 6 out of its origin
        // (its icicles a hair more; the plan sets the origin 9 past the
        // shelf's rim).
        expect(s.max[2], v).toBeLessThanOrEqual(6.4);
        // Its root plunges into the mist (never a lid floating on the void).
        expect(s.min[1], v).toBeLessThan(-12);
      }
      for (const [piece, m] of Object.entries(QUENCH_FALLS)) {
        const s = shape(piece);
        expect(Math.abs(s.max[1] - s.min[1] - (m.height + 1.9)), piece).toBeLessThan(1.2);
        // Out of the rock's face no further than its front (2.6).
        expect(s.max[2], piece).toBeLessThanOrEqual(2.65);
      }
    },
  );
});

describe('Smith Heart Quench kit: the plan', () => {
  it('fits every Quench prop with its piece', () => {
    const props = F.props.filter((p) => QUENCH_KIT_KINDS.has(p.kind));
    const plan = planQuenchProps();
    const of = (piece: string) => plan.filter((p) => p.piece === piece).length;
    const kinds = (kind: string) => F.props.filter((p) => p.kind === kind).length;
    expect(of('Kit_LakeBrazier')).toBe(kinds('sh_brazier'));
    expect(of('Kit_LakeBrazier')).toBe(4);
    expect(of('Kit_SteamVent')).toBe(kinds('sh_steam_vent'));
    expect(of('Kit_IceShelfA') + of('Kit_IceShelfB')).toBe(kinds('sh_ice_shelf'));
    expect(of('Kit_IceShelfB')).toBeGreaterThan(0);
    // The Smith's four blades are their fight's (encounter-owned: the
    // Guardian of the Quench's renderer draws them, sunk or risen).
    expect(kinds('sh_sunk_blade')).toBe(4);
    expect(F.props.filter((p) => p.kind === 'sh_sunk_blade').every((p) => p.encounterOwned)).toBe(
      true,
    );
    expect(of('Kit_SunkBlade')).toBe(0);
    expect(of('Kit_IceBlade')).toBe(kinds('sh_ice_blade'));
    expect(of('Kit_FrostStone')).toBe(kinds('sh_frost_stone'));
    expect(of('Kit_FrostStone')).toBe(5);
    expect(plan.length).toBe(props.filter((p) => !p.encounterOwned).length);
    // The stones stand on colliders on the Quench's landings.
    for (const p of F.props.filter((q) => q.kind === 'sh_frost_stone')) {
      expect(p.r ?? 0).toBeGreaterThan(1);
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(['quench_q1', 'quench_q2'], `${p.kind} on ${s?.id}`).toContain(s?.id);
    }
    // The braziers stand on the shelf round the lake, on colliders.
    for (const p of F.props.filter((q) => q.kind === 'sh_brazier')) {
      expect(p.r ?? 0).toBeGreaterThanOrEqual(1.5);
      expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id).toBe('lake_shelf');
    }
  });

  it('heaps the old ice past the shelf, never over a walk', () => {
    for (const p of planQuenchProps().filter((q) => q.piece.startsWith('Kit_IceShelf'))) {
      const k = p.scale ?? 1;
      for (let lx = -10.5; lx <= 10.5; lx += 1.5)
        for (let lz = -6; lz <= 6.4; lz += 1.55) {
          const x = p.x + (lx * Math.cos(p.rot) + lz * Math.sin(p.rot)) * k;
          const z = p.z + (-lx * Math.sin(p.rot) + lz * Math.cos(p.rot)) * k;
          expect(authoredFieldSurfaceAt(F, x, z), `${p.piece} at ${x} ${z}`).toBeNull();
        }
    }
  });

  it('walls the Quench walks over the void, never over a walk', () => {
    const walls = planQuenchWalls();
    expect(walls.length).toBeGreaterThan(30);
    const near = (id: string) =>
      walls.filter((w) =>
        [-1.5, -0.5].some(
          (d) =>
            authoredFieldSurfaceAt(F, w.x + Math.sin(w.rot) * d, w.z + Math.cos(w.rot) * d)?.id ===
            id,
        ),
      ).length;
    for (const id of ['quench_q1', 'quench_q2', 'singing_ice', 'lake_shelf'])
      expect(near(id), id).toBeGreaterThan(1);
    for (const w of walls)
      expect(quenchWallClear(w.x, w.z, w.rot, w.stretch ?? 1), `${w.x} ${w.z}`).toBe(true);
    expect(walls.some((w) => w.piece === 'Kit_QuenchWallB')).toBe(true);
  });

  it('hangs the frozen falls on the rock facing a Quench walk, never over a floor', () => {
    const falls = planQuenchFalls();
    expect(falls.length).toBeGreaterThanOrEqual(6);
    for (const f of falls) {
      const k = f.scale ?? 1;
      for (const out of [0, 1.3, 2.6]) {
        const x = f.x + Math.sin(f.rot) * out * k;
        const z = f.z + Math.cos(f.rot) * out * k;
        expect(authoredFieldSurfaceAt(F, x, z), `${f.piece} at ${f.x} ${f.z}`).toBeNull();
      }
      // It faces a Quench walk a few yards off.
      let faces = false;
      for (let d = 4; d < 24 && !faces; d += 1) {
        const s = authoredFieldSurfaceAt(F, f.x + Math.sin(f.rot) * d, f.z + Math.cos(f.rot) * d);
        if (s && QUENCH_WALK_SURFACES.has(s.id)) faces = true;
      }
      expect(faces, `${f.piece} at ${f.x} ${f.z}`).toBe(true);
      expect(f.cosmetic).toBe(true);
    }
  });

  it('lays the cracks flat on the ice and the drifts at the lake edge', () => {
    const flat = planQuenchDressing();
    const cracks = flat.filter((p) => p.piece.startsWith('Kit_IceCrack'));
    const drifts = flat.filter((p) => p.piece.startsWith('Kit_SnowDrift'));
    expect(
      cracks.filter((p) => authoredFieldSurfaceAt(F, p.x, p.z)?.id === 'singing_ice').length,
    ).toBeGreaterThanOrEqual(6);
    for (const p of cracks) {
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(['singing_ice', 'frozen_lake'], `${p.piece} on ${s?.id}`).toContain(s?.id);
      expect(Math.abs(p.y - authoredFieldHeight(F, p.x, p.z))).toBeLessThan(0.05);
    }
    // The drifts lie on Quench walks, never on the lake: a ring of them at
    // the lake's edge and more banked against the low walls.
    const L = QUENCH.lake;
    const edge = (p: { x: number; z: number }) =>
      Math.hypot((p.x - L.x) / L.rx, (p.z - L.z) / L.rz);
    for (const p of drifts) {
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(QUENCH_DRIFT_FLOORS.has(s?.id ?? ''), `${p.piece} on ${s?.id}`).toBe(true);
      expect(s?.id).not.toBe('frozen_lake');
      expect(p.scale ?? 1).toBeLessThanOrEqual(1.1);
    }
    const atLake = drifts.filter((p) => edge(p) > 1 && edge(p) < 1.12);
    expect(atLake.length).toBeGreaterThan(8);
    expect(drifts.length - atLake.length).toBeGreaterThan(8);
    for (const p of flat) {
      expect(p.cosmetic).toBe(true);
      expect(p.noShadow).toBe(true);
    }
    expect(planQuenchKit().length).toBeGreaterThan(70);
  });
});
