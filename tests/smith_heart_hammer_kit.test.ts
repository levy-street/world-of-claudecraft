// The Smith's Heart raid's Hammer vein kit (scripts/assets/smith_heart_hammer_kit/
// build.mjs, built from docs/design/raid/kit/build_smith_heart_hammer_kit.py)
// and its plan (src/render/smith_heart/hammer_kit_plan_core.ts):
//   - the shipped GLB is the current sources' (fingerprint, nodes, materials),
//     inside the dungeon kit budget, every piece with a sane triangle count;
//   - the pieces a body touches stay within their layout colliders (plus a
//     body's width), the edge modules keep their lip frame (a rim never stands
//     proud of the floor below it), the Slab's halves fill the gate, the
//     Slab's frame clears the stair, the Cleft's gate keeps the landing clear;
//   - the plan fits every vein prop with its piece, kneels the colossi on the
//     first step, and stands nothing render-only over a walked floor (the
//     terraces are dressing floors nobody reaches; the chips lie flat).
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), so a
// piece's front (Blender -Y) is +Z here, as in the game.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_HAMMER_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_hammer_kit/build.mjs';
import {
  FIELD_GROUND_COLORS,
  fieldFamilyUvScale,
  fieldGroundFamily,
  topColor,
} from '../src/render/authored_field/field_mesh_core';
import {
  collapseSpot,
  HAMMER_COLOSSI,
  HAMMER_CROWN,
  HAMMER_KIT_KINDS,
  HAMMER_KIT_SIZES,
  isQuarryStep,
  planHammerDressing,
  planHammerEdges,
  planHammerKit,
  planHammerProps,
} from '../src/render/smith_heart/hammer_kit_plan_core';
import {
  HAMMER_WALK_SURFACES,
  planHammerWalk,
} from '../src/render/smith_heart/hammer_walk_plan_core';
import { heartKitPlacementMatrix, mergeHeartKitParts } from '../src/render/smith_heart/heart_kit';
import { HEART_PROP_RECIPES } from '../src/render/smith_heart/heart_plan_core';
import { SMITH_HEART_GATES } from '../src/sim/content/smith_heart';
import { QUARRY_TERRACES, SLAB, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const KIT = ASSET.target;
const haveKit = existsSync(KIT);
const F = SMITH_HEART_FIELD;

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  points: V3[];
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
    const materials = new Set<string>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      materials.add(prim.getMaterial()?.getName() ?? '');
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        points.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, triangles, materials });
  }
});

const shape = (name: string): Shape => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  return s;
};

/** How far a piece reaches from its origin across the ground below `top`. */
function footReach(name: string, top: number): number {
  let r = 0;
  for (const p of shape(name).points) if (p[1] < top) r = Math.max(r, Math.hypot(p[0], p[2]));
  return r;
}

describe('Smith Heart Hammer kit: the piece list and the shipped GLB', () => {
  it('lists every piece once, the colossi, the Slab and the edges included', () => {
    const list = SMITH_HEART_HAMMER_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'ColossusVigil',
      'ColossusWaking',
      'ColossusBearer',
      'PitColumn',
      'QuarryFaceA',
      'QuarryRimA',
      'CleftGate',
      'WalkCurbA',
      'WalkRail',
      'FallenBlockA',
      'CollapseOverhang',
      'SlabHalfL',
      'SlabHalfR',
      'SlabFrame',
      'GreatCliffA',
      'FloorCrackA',
    ])
      expect(list, piece).toContain(piece);
    for (const p of list) expect(p, p).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_HAMMER_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    // The edge modules are drawn by the dozen: light. A colossus at most 20k.
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const tile =
        /Quarry(Face|Rim)|ChipScatter|RubblePile|SlabChunk|FloorCrack|Walk|FallenBlock/.test(name);
      expect(s.triangles, name).toBeLessThanOrEqual(tile ? 2500 : 20000);
      total += s.triangles;
    }
    expect(total).toBeLessThan(200_000);
  });

  it.skipIf(!haveKit)('lights only the vein, the geodes and the runes', () => {
    for (const glowing of [
      'Kit_GeodeA',
      'Kit_GeodeB',
      'Kit_PitColumn',
      'Kit_SlabHalfL',
      'Kit_SlabFrame',
    ])
      expect(shape(glowing).materials.has('KitGlow'), glowing).toBe(true);
    for (const plain of ['Kit_QuarryFaceA', 'Kit_QuarryRimA', 'Kit_Scaffold', 'Kit_CutBlockA'])
      expect(shape(plain).materials, plain).toEqual(new Set(['KitStone']));
  });
});

describe('Smith Heart Hammer kit: sizes the sim and the plan rely on', () => {
  it.skipIf(!haveKit)('keeps every piece a body can touch within its collider', () => {
    const body = 0.6;
    const collider = (kind: string) => {
      const p = F.props.find((q) => q.kind === kind);
      if (!p) throw new Error(kind);
      return { foot: p.r ?? Math.hypot(p.hw ?? 0, p.hd ?? 0), h: p.h ?? 0 };
    };
    const fits: [string, string][] = [
      ['Kit_PitColumn', 'sh_pit_column'],
      ['Kit_CutBlockA', 'sh_quarry_block'],
      ['Kit_CutBlockB', 'sh_quarry_block'],
      ['Kit_Derrick', 'sh_quarry_derrick'],
      ['Kit_GeodeA', 'sh_geode'],
      ['Kit_GeodeB', 'sh_geode'],
      ['Kit_RoughStatueA', 'sh_rough_statue'],
      ['Kit_RoughStatueB', 'sh_rough_statue'],
      ['Kit_FallenBlockA', 'sh_fallen_block'],
      ['Kit_FallenBlockB', 'sh_fallen_block'],
    ];
    for (const [piece, kind] of fits) {
      const c = collider(kind);
      expect(footReach(piece, 2.6), piece).toBeLessThanOrEqual(c.foot + body);
    }
    // A column stands no taller than its sight-blocking collider.
    expect(shape('Kit_PitColumn').max[1]).toBeLessThanOrEqual(collider('sh_pit_column').h);
    expect(shape('Kit_PitColumn').max[1]).toBeGreaterThan(11);
  });

  it.skipIf(!haveKit)('keeps the edge modules on their lip, never proud of a walked floor', () => {
    for (const name of ['Kit_QuarryFaceA', 'Kit_QuarryFaceB', 'Kit_QuarryFaceC']) {
      const s = shape(name);
      expect(s.max[1], name).toBeLessThanOrEqual(0.15);
      expect(s.min[1], name).toBeLessThan(-7);
    }
    for (const name of ['Kit_QuarryRimA', 'Kit_QuarryRimB']) {
      const s = shape(name);
      expect(s.max[1], name).toBeLessThanOrEqual(0.15);
      expect(s.min[1], name).toBeLessThan(-7);
      // The rim faces the pit's walked floor: it never stands out over it.
      expect(s.max[2], name).toBeLessThanOrEqual(0.35);
    }
    // The flat floor dressing stays under a hand's height; so does the
    // Gallery's kerb (phase 2E), and its chain rail stands wholly past the
    // lip, over the drop (glTF +Z is the drop side).
    expect(shape('Kit_ChipScatter').max[1]).toBeLessThan(0.3);
    for (const name of ['Kit_WalkCurbA', 'Kit_WalkCurbB'])
      expect(shape(name).max[1], name).toBeLessThan(0.3);
    expect(shape('Kit_WalkRail').min[2]).toBeGreaterThan(0.25);
    expect(shape('Kit_PitColumnSocket').max[1]).toBeLessThan(0.3);
    // The floor's cracks are inlays under the telegraphs' lift (0.06): the
    // sight field of Mountain's Wrath always draws over them.
    for (const name of ['Kit_FloorCrackA', 'Kit_FloorCrackB']) {
      expect(shape(name).max[1], name).toBeLessThan(0.05);
      expect(shape(name).min[1], name).toBeGreaterThan(-0.02);
    }
  });

  it.skipIf(!haveKit)('fills the Slab gate with its two halves and clears its stair', () => {
    const gate = SMITH_HEART_GATES.find((g) => g.id === 'the_slab');
    if (!gate) throw new Error('no slab gate');
    const L = shape('Kit_SlabHalfL');
    const R = shape('Kit_SlabHalfR');
    expect(L.min[0]).toBeCloseTo(-gate.hw, 1);
    expect(R.max[0]).toBeCloseTo(gate.hw, 1);
    expect(Math.max(L.max[1], R.max[1])).toBeGreaterThan(8.5);
    expect(Math.min(L.min[1], R.min[1])).toBeGreaterThan(-0.05);
    // The frame's jambs stand clear of the stair (half width 7) at a walk's height.
    const frame = shape('Kit_SlabFrame');
    const low = frame.points.filter((p) => p[1] > -1 && p[1] < 9);
    expect(Math.min(...low.map((p) => Math.abs(p[0])))).toBeGreaterThan(7.6);
  });

  it.skipIf(!haveKit)('crowns the quarry with mountain crests, never a broken wall top', () => {
    // Phase 2D: each great cliff's skyline (its highest point per 1.5 yd
    // across) falls to low shoulders at both ends and peaks only briefly: a
    // massif's silhouette. 2C's crests ran level across most of the piece.
    for (const name of ['Kit_GreatCliffA', 'Kit_GreatCliffB', 'Kit_GreatCliffC']) {
      const bins = new Map<number, number>();
      for (const p of shape(name).points) {
        const b = Math.floor(p[0] / 1.5);
        bins.set(b, Math.max(bins.get(b) ?? -Infinity, p[1]));
      }
      const top = [...bins.keys()].sort((a, b) => a - b).map((k) => bins.get(k) ?? 0);
      const peak = Math.max(...top);
      expect(peak - Math.max(top[0], top[top.length - 1]), name).toBeGreaterThan(peak * 0.45);
      let run = 0;
      let longest = 0;
      for (const t of top) {
        run = t > peak - 0.6 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      expect(longest, name).toBeLessThanOrEqual(4);
    }
  });

  it.skipIf(!haveKit)('keeps the Cleft landing clear and the colossi colossal', () => {
    // Nothing of the gate reaches more than 7.8 yd toward the landing.
    expect(shape('Kit_CleftGate').max[2]).toBeLessThanOrEqual(7.9);
    // Each colossus towers over a body (about two yards) many times over,
    // and is wider still with its block: the player must feel tiny.
    for (const c of HAMMER_COLOSSI) {
      const s = shape(c);
      expect(s.max[1], c).toBeGreaterThan(22);
      expect(s.max[1], c).toBeLessThan(30);
      expect(Math.max(s.max[0] - s.min[0], s.max[2] - s.min[2]), c).toBeGreaterThan(24);
    }
  });
});

describe('hammer_kit_plan_core: the Hammer vein dressed', () => {
  it('fits every vein prop with its piece, the colossi kneeling on the first step', () => {
    const props = planHammerProps();
    const vein = F.props.filter((p) => HAMMER_KIT_KINDS.has(p.kind));
    expect(vein.length).toBeGreaterThan(15);
    for (const k of HAMMER_KIT_KINDS) expect(HEART_PROP_RECIPES[k], k).toBeDefined();
    // Every prop has its piece; a column's is only its socket (the column
    // itself is the Hammer Council's pillar object: smith_heart_fx/council_fx.ts).
    expect(props.length).toBe(vein.length);
    const columns = vein.filter((p) => p.kind === 'sh_pit_column').length;
    expect(props.filter((p) => p.piece === 'Kit_PitColumnSocket').length).toBe(columns);
    expect(props.some((p) => p.piece === 'Kit_PitColumn')).toBe(false);
    const colossi = props.filter((p) => p.piece.startsWith('Kit_Colossus'));
    expect(colossi.map((c) => c.piece).sort()).toEqual([...HAMMER_COLOSSI].sort());
    for (const c of colossi) {
      expect(c.y).toBe(QUARRY_TERRACES.steps[0].h);
      expect(isQuarryStep(authoredFieldSurfaceAt(F, c.x, c.z)?.id), c.piece).toBe(true);
    }
    expect(props.find((p) => p.piece === 'Kit_SlabFrame')).toMatchObject({ x: SLAB.x, z: SLAB.z });
  });

  it('dresses every terrace riser, the pit rim and the void lips of the vein', () => {
    const edges = planHammerEdges();
    const count = (re: RegExp) => edges.filter((e) => re.test(e.piece)).length;
    expect(count(/QuarryFace/)).toBeGreaterThan(30);
    expect(count(/QuarryRim/)).toBeGreaterThan(10);
    expect(count(/QuarryLip/)).toBeGreaterThan(60);
    for (const e of edges) {
      expect(Number.isFinite(e.y), e.piece).toBe(true);
      expect(e.stretch, e.piece).toBeGreaterThanOrEqual(0.4);
      expect(e.stretch, e.piece).toBeLessThan(1.6);
    }
  });

  it.skipIf(!haveKit)('stands nothing render-only over a walked floor', () => {
    // Every render-only piece's real mesh, placed: no vertex between a hand and
    // a head over a floor somebody walks (the terraces nobody reaches are
    // dressing floors; the edge modules sit on their lips, pinned above).
    const flat = new Set([
      'Kit_ChipScatter',
      'Kit_PitColumnSocket',
      'Kit_FloorCrackA',
      'Kit_FloorCrackB',
      // The kerb: under a hand's height (pinned above).
      'Kit_WalkCurbA',
      'Kit_WalkCurbB',
    ]);
    const bad: string[] = [];
    for (const p of [...planHammerDressing(), ...planHammerWalk()]) {
      if (flat.has(p.piece)) continue;
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const k = p.scale ?? 1;
      const pts = shape(p.piece).points;
      for (let i = 0; i < pts.length; i += 3) {
        const [lx, ly, lz] = pts[i];
        const x = p.x + (lx * c + lz * s) * k;
        const z = p.z + (-lx * s + lz * c) * k;
        const y = p.y + ly * k;
        const surface = authoredFieldSurfaceAt(F, x, z);
        if (!surface || isQuarryStep(surface.id)) continue;
        const floor = authoredFieldHeight(F, x, z);
        if (y > floor + 0.35 && y < floor + 2.6) {
          bad.push(`${p.piece} over ${surface.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('crowns the back wall with great cliffs on the top step, never floating over the step below', () => {
    const crown = planHammerDressing().filter((p) => p.piece.startsWith('Kit_GreatCliff'));
    expect(crown).toHaveLength(HAMMER_CROWN.length);
    const top = QUARRY_TERRACES.steps[QUARRY_TERRACES.steps.length - 1];
    const topId = `quarry_step_${QUARRY_TERRACES.steps.length}`;
    for (const c of crown) {
      expect(c.y).toBe(top.h);
      expect(authoredFieldSurfaceAt(F, c.x, c.z)?.id, c.piece).toBe(topId);
      // Its face's foot (toward the pit) still stands on the top step.
      const reach = HAMMER_KIT_SIZES.crownFront * (c.scale ?? 1);
      const fx = c.x + Math.sin(c.rot) * reach;
      const fz = c.z + Math.cos(c.rot) * reach;
      expect(authoredFieldSurfaceAt(F, fx, fz)?.id, `${c.piece} front`).toBe(topId);
      // Facing the pit.
      const toPit = Math.atan2(8 - c.x, -170 - c.z);
      expect(Math.cos(c.rot - toPit)).toBeGreaterThan(0.99);
      // Far dressing: shed on the low tier, no shadow pass.
      expect(c.cosmetic).toBe(true);
      expect(c.noShadow).toBe(true);
    }
  });

  it.skipIf(!haveKit)('keeps the great cliffs within the face reach the plan assumes', () => {
    for (const name of ['Kit_GreatCliffA', 'Kit_GreatCliffB', 'Kit_GreatCliffC']) {
      const s = shape(name);
      // glTF +Z is the face's front (Blender -Y).
      expect(s.max[2], name).toBeLessThanOrEqual(HAMMER_KIT_SIZES.crownFront);
      expect(s.min[1], name).toBeGreaterThan(-0.1);
      // Tall enough to break the skyline over the top step.
      expect(s.max[1], name).toBeGreaterThan(18);
    }
  });

  it('cracks the pit floor clear of the columns', () => {
    const cracks = planHammerDressing().filter((p) => p.piece.startsWith('Kit_FloorCrack'));
    expect(cracks.length).toBeGreaterThan(6);
    const columns = F.props.filter((p) => p.kind === 'sh_pit_column');
    for (const c of cracks) {
      expect(authoredFieldSurfaceAt(F, c.x, c.z)?.id).toBe('hammer_pit');
      expect(c.y - authoredFieldHeight(F, c.x, c.z)).toBeLessThan(0.02);
      for (const col of columns) expect(Math.hypot(col.x - c.x, col.z - c.z)).toBeGreaterThan(8);
    }
  });

  it('hangs the collapse spot over the lower Gallery, high over its walk', () => {
    const c = collapseSpot();
    // Its origin is off the path, on the rim; its front turns over the path.
    expect(authoredFieldSurfaceAt(F, c.x, c.z)).toBeNull();
    const ahead = { x: c.x + Math.sin(c.rot) * 8, z: c.z + Math.cos(c.rot) * 8 };
    expect(authoredFieldSurfaceAt(F, ahead.x, ahead.z)?.id).toBe('gallery_lower');
    expect(planHammerKit().filter((p) => p.piece === 'Kit_CollapseOverhang')).toHaveLength(1);
  });
});

describe('hammer_walk_plan_core: the Gallery walk (phase 2E)', () => {
  it('kerbs every Gallery lip over the chasm and rails most of it', () => {
    const walk = planHammerWalk();
    const kerbs = walk.filter((p) => p.piece.startsWith('Kit_WalkCurb'));
    const rails = walk.filter((p) => p.piece === 'Kit_WalkRail');
    expect(kerbs.length).toBeGreaterThan(40);
    // Broken away into rubble here and there, never all of it.
    const broken = kerbs.filter((p) => p.piece === 'Kit_WalkCurbB').length;
    expect(broken).toBeGreaterThan(4);
    expect(broken).toBeLessThan(kerbs.length / 2);
    expect(rails.length).toBeGreaterThan(kerbs.length * 0.75);
    expect(rails.length).toBeLessThanOrEqual(kerbs.length);
    for (const p of walk) {
      // On a Gallery floor's lip, the drop in front of it.
      const back = authoredFieldSurfaceAt(
        F,
        p.x - Math.sin(p.rot) * 0.6,
        p.z - Math.cos(p.rot) * 0.6,
      );
      expect(HAMMER_WALK_SURFACES.has(back?.id ?? ''), `${p.piece} on ${back?.id}`).toBe(true);
      const ahead = authoredFieldHeight(
        F,
        p.x + Math.sin(p.rot) * 1.2,
        p.z + Math.cos(p.rot) * 1.2,
      );
      expect(ahead, p.piece).toBeLessThan(p.y - 6);
      expect(p.cosmetic).toBe(true);
    }
  });

  it('paves the Gallery in worn flags, its own ground, and lays fallen blocks at its edges', () => {
    expect(fieldGroundFamily('paving')).toBe('paving');
    expect(fieldFamilyUvScale('paving')).toBeCloseTo(1 / 10, 9);
    for (const id of HAMMER_WALK_SURFACES)
      expect(F.surfaces.find((s) => s.id === id)?.ground, id).toBe('paving');
    // A painted floor, never one flat colour.
    const lum: number[] = [];
    for (let x = 0; x < 120; x += 7)
      for (let z = 0; z < 120; z += 11) {
        const [r, g, b] = topColor('paving', x, z, true);
        lum.push(0.3 * r + 0.59 * g + 0.11 * b);
      }
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(1.4);
    const blocks = F.props.filter((p) => p.kind === 'sh_fallen_block');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      const s = authoredFieldSurfaceAt(F, b.x, b.z);
      expect(HAMMER_WALK_SURFACES.has(s?.id ?? ''), s?.id).toBe(true);
      // On a collider (a body walks round it, never through it).
      expect(b.hw ?? 0).toBeGreaterThan(0);
      expect(b.h ?? 0).toBeGreaterThan(1);
    }
    expect(planHammerProps().filter((p) => p.piece.startsWith('Kit_FallenBlock'))).toHaveLength(
      blocks.length,
    );
  });

  it('leaves the void lips to the rock kit, the hoists hung where they were', () => {
    expect(planHammerKit().some((p) => p.piece.startsWith('Kit_QuarryLip'))).toBe(false);
    expect(planHammerKit().filter((p) => p.piece === 'Kit_ChainHoist').length).toBeGreaterThan(4);
  });
});

describe('the Hammer vein floor and the kit instancer', () => {
  it('paves the vein in cut bedrock: its own texture family and tile', () => {
    expect(fieldGroundFamily('quarry')).toBe('quarry');
    expect(fieldFamilyUvScale('quarry')).toBeCloseTo(1 / 16, 9);
    const pit = F.surfaces.find((s) => s.id === 'hammer_pit');
    const steps = F.surfaces.filter((s) => isQuarryStep(s.id));
    expect(pit?.ground).toBe('quarry');
    expect(steps.length).toBe(4);
    for (const s of steps) expect(s.ground, s.id).toBe('quarry');
    // Cool grey granite (phase 2C): the warm lives in the sun and the dust,
    // never in the stone's own colour.
    const [r, g, b] = FIELD_GROUND_COLORS.quarry;
    expect(b).toBeGreaterThanOrEqual(r);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.03);
    // Its painted floor ranges in value (dark worked hollows to pale dust)
    // and only the dust drifts run warm.
    const samples: (readonly [number, number, number])[] = [];
    for (let x = 0; x < 200; x += 7)
      for (let z = 0; z < 200; z += 11) samples.push(topColor('quarry', x, z, false));
    const lum = samples.map(([a, c, d]) => 0.3 * a + 0.59 * c + 0.11 * d);
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(1.6);
    const warm = samples.filter(([a, , d]) => a > d * 1.04);
    const cool = samples.filter(([a, , d]) => d >= a);
    expect(warm.length).toBeGreaterThan(0);
    expect(cool.length).toBeGreaterThan(warm.length);
  });

  it('places, stretches and shears an edge module as planned', () => {
    const m = new THREE.Matrix4();
    heartKitPlacementMatrix(
      { piece: 'Kit_QuarryLipA', x: 10, y: 5, z: -3, rot: 0, stretch: 2, shear: 0.25 },
      m,
    );
    // A point 2 yd along the module's local X lands 4 yd along (stretched)
    // and 1 yd higher (the shear follows the slope per stretched yard).
    const p = new THREE.Vector3(2, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(14, 6);
    expect(p.y).toBeCloseTo(6, 6);
    expect(p.z).toBeCloseTo(-3, 6);
    // Turned: rot pi/2 sends its front (+Z) to +X.
    heartKitPlacementMatrix({ piece: 'Kit_PitColumn', x: 0, y: 0, z: 0, rot: Math.PI / 2 }, m);
    const f = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.z).toBeCloseTo(0, 6);
  });

  it("merges a piece's parts into one indexed geometry, colours kept", () => {
    const a = new THREE.BufferGeometry();
    a.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    a.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    a.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    a.setIndex([0, 1, 2]);
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1, 0, 1, 1], 3));
    const m = mergeHeartKitParts([a, b]);
    expect(m.attributes.position.count).toBe(6);
    expect(Array.from(m.index?.array ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
    // The first part's red survives; a part without colour stays white.
    expect(m.attributes.color.getX(0)).toBe(1);
    expect(m.attributes.color.getY(0)).toBe(0);
    expect(m.attributes.color.getY(4)).toBe(1);
  });
});
