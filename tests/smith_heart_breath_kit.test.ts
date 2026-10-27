// The Smith's Heart raid's Breath vein (phase 2G, docs/design/raid/smith_heart.md
// section 5.14): its storm-scoured floor, its Blender kit (scripts/assets/
// smith_heart_breath_kit/build.mjs, built from docs/design/raid/kit/
// build_smith_heart_breath_kit.py) and its plan (breath_kit_plan_core.ts):
//   - the shipped GLB is the current sources', inside its budget, crystal the
//     only light; the pieces a body touches stay within their colliders, the
//     walls and the inlays never stand over a walk, the arch never over its
//     deck;
//   - the plan fits every Breath prop, walls every Breath walk over the void
//     (never over a walk), lays the inlays flat on Breath floors, and leaves
//     the bridge's drop to the arch (no mountain lip under it).
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), so a
// piece's front (Blender -Y) is +Z here, as in the game.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_BREATH_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_breath_kit/build.mjs';
import {
  fieldFamilyUvScale,
  fieldGroundFamily,
  topColor,
} from '../src/render/authored_field/field_mesh_core';
import {
  BREATH_KIT_KINDS,
  BREATH_KIT_SHALLOW,
  BREATH_WALK_SURFACES,
  planBreathChannels,
  planBreathDressing,
  planBreathKit,
  planBreathProps,
  planBreathWalls,
  wallClear,
  windBridgeFrame,
} from '../src/render/smith_heart/breath_kit_plan_core';
import { planHeartLips } from '../src/render/smith_heart/heart_rock_plan_core';
import {
  BREATH,
  CORNICE_CHANNELS,
  SMITH_HEART_FIELD,
  WIND_BRIDGE,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;

/** Every walked floor of the Breath, its mouth to the Cornice. */
const BREATH_FLOORS = [
  'breath_mouth',
  'breath_b1',
  'breath_chimney',
  'breath_b2',
  'wind_bridge',
  'breath_b3',
  'cornice_climb',
  'storm_cornice',
];

describe("the Breath's scoured floor", () => {
  it('lays every Breath floor in storm-scoured granite, its own family and tile', () => {
    expect(fieldGroundFamily('scoured')).toBe('scoured');
    expect(fieldFamilyUvScale('scoured')).toBeCloseTo(1 / 14, 9);
    for (const id of BREATH_FLOORS)
      expect(F.surfaces.find((s) => s.id === id)?.ground, id).toBe('scoured');
  });

  it('paints the bedrock pale and cool, in drifts, never one flat colour', () => {
    const lum: number[] = [];
    let cool = 0;
    let n = 0;
    for (let x = -120; x < 40; x += 7)
      for (let z = 100; z < 230; z += 11) {
        const [r, g, b] = topColor('scoured', x, z, true);
        lum.push(0.3 * r + 0.59 * g + 0.11 * b);
        if (b >= r) cool++;
        n++;
      }
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(1.25);
    // Cool on the whole (the storm's granite, never the quarry's warm dust).
    expect(cool / n).toBeGreaterThan(0.7);
    // Pale: a value over the quarry's cut bedrock on average.
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    let quarry = 0;
    for (let x = -120; x < 40; x += 7)
      for (let z = 100; z < 230; z += 11) {
        const [r, g, b] = topColor('quarry', x, z, true);
        quarry += 0.3 * r + 0.59 * g + 0.11 * b;
      }
    expect(mean).toBeGreaterThan(quarry / lum.length);
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

/** How far a piece reaches from its origin between a hand over the ground
 *  (flat chips a body walks over) and `below` yards up. */
const reach = (name: string, below: number): number => {
  let r = 0;
  for (const p of shape(name).points)
    if (p[1] < below && p[1] > 0.3) r = Math.max(r, Math.hypot(p[0], p[2]));
  return r;
};

describe('Smith Heart Breath kit: the piece list and the shipped GLB', () => {
  it('lists every piece once: the Cornice, the bridge, the walls, the inlays', () => {
    const list = SMITH_HEART_BREATH_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'StormRod',
      'WindHorn',
      'ChannelJamb',
      'WindBridge',
      'WindShelter',
      'BreathWallA',
      'BreathWallB',
      'StormStone',
      'PlateauCrackA',
      'StrikeScar',
      'WindGroove',
    ])
      expect(list, piece).toContain(piece);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_BREATH_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const cap = /Crack|Scar|Groove|Wall/.test(name)
        ? 1200
        : name === 'Kit_WindBridge'
          ? 12500
          : 5000;
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
      total += s.triangles;
    }
    expect(total).toBeLessThan(40_000);
  });

  it.skipIf(!haveKit)('lights only crystal: the rods, the horns, the jambs, the stones', () => {
    for (const glowing of ['Kit_StormRod', 'Kit_WindHorn', 'Kit_ChannelJamb', 'Kit_StormStone'])
      expect(shape(glowing).materials.has('KitGlow'), glowing).toBe(true);
    for (const plain of ['Kit_WindBridge', 'Kit_BreathWallA', 'Kit_WindShelter', 'Kit_WindGroove'])
      expect(shape(plain).materials, plain).toEqual(new Set(['KitStone']));
  });
});

describe('Smith Heart Breath kit: the measures the plan relies on', () => {
  it.skipIf(!haveKit)('keeps every touchable foot inside its collider and a body', () => {
    // Rod and jamb: collider 1.3; stone: 1.6 (a body's width past each).
    expect(reach('Kit_StormRod', 3)).toBeLessThanOrEqual(1.3 + 0.5);
    expect(reach('Kit_ChannelJamb', 3)).toBeLessThanOrEqual(1.3 + 0.5);
    expect(reach('Kit_StormStone', 3)).toBeLessThanOrEqual(1.6 + 0.5);
    const shelter = shape('Kit_WindShelter');
    expect(Math.max(-shelter.min[0], shelter.max[0])).toBeLessThanOrEqual(2.4 + 0.05);
    expect(Math.max(-shelter.min[2], shelter.max[2])).toBeLessThanOrEqual(0.7 + 0.05);
    const horn = shape('Kit_WindHorn');
    expect(Math.max(-horn.min[0], horn.max[0])).toBeLessThanOrEqual(4.4 + 0.05);
    expect(Math.max(-horn.min[2], horn.max[2])).toBeLessThanOrEqual(7.5 + 0.05);
    // The rod is a landmark: its crown over twenty yards up.
    expect(shape('Kit_StormRod').max[1]).toBeGreaterThan(20);
  });

  it.skipIf(!haveKit)('lays the inlays flat (every telegraph draws over them)', () => {
    for (const flat of [
      'Kit_PlateauCrackA',
      'Kit_PlateauCrackB',
      'Kit_StrikeScar',
      'Kit_WindGroove',
    ])
      expect(shape(flat).max[1], flat).toBeLessThan(0.05);
  });

  it.skipIf(!haveKit)('stands the walls past the lip, a knee high, nothing over the walk', () => {
    for (const v of ['A', 'B']) {
      const s = shape(`Kit_BreathWall${v}`);
      // Over the walk (the lip's inner side, game -Z) nothing rises past it.
      for (const p of s.points) if (p[2] < 0.04) expect(p[1], v).toBeLessThan(0.05);
      expect(s.max[1], v).toBeGreaterThan(0.8);
      expect(s.max[1], v).toBeLessThan(1.1);
      expect(s.max[2], v).toBeLessThanOrEqual(1.05);
    }
  });

  it.skipIf(!haveKit)('rides the arch under the Wind Bridge, never over its deck', () => {
    const { run } = windBridgeFrame();
    const s = shape('Kit_WindBridge');
    const rise = BREATH.b3.h - BREATH.b2.h;
    for (const p of s.points) {
      if (Math.abs(p[2]) > WIND_BRIDGE.halfWidth + 0.05) continue;
      const deck = Math.min(1, Math.max(0, p[0] / run)) * rise;
      expect(p[1]).toBeLessThanOrEqual(deck - 0.2);
    }
    // Its legs plunge deep into the mist.
    expect(s.min[1]).toBeLessThan(-40);
  });
});

describe('Smith Heart Breath kit: the plan', () => {
  it('fits every Breath prop with its piece, the bridge with its arch', () => {
    const props = F.props.filter((p) => BREATH_KIT_KINDS.has(p.kind));
    const plan = planBreathProps();
    const of = (piece: string) => plan.filter((p) => p.piece === piece).length;
    const rods = F.props.filter((p) => p.kind === 'sh_lightning_rod').length;
    expect(of('Kit_StormRod')).toBe(rods);
    expect(of('Kit_StrikeScar')).toBe(rods);
    expect(of('Kit_WindHorn')).toBe(2);
    expect(of('Kit_WindShelter')).toBe(2);
    expect(of('Kit_ChannelJamb')).toBe(CORNICE_CHANNELS.length * 2);
    expect(of('Kit_StormStone')).toBe(6);
    expect(of('Kit_WindBridge')).toBe(1);
    expect(props.length).toBe(rods + 2 + 2 + CORNICE_CHANNELS.length * 2 + 6);
    // The cheek stones and the standing stones stand on their colliders, on
    // Breath floors.
    for (const p of F.props) {
      if (p.kind !== 'sh_channel_jamb' && p.kind !== 'sh_storm_stone') continue;
      expect(p.r ?? 0).toBeGreaterThan(1);
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(BREATH_WALK_SURFACES.has(s?.id ?? ''), `${p.kind} on ${s?.id}`).toBe(true);
    }
    // The horns' bells open to the rim.
    const C = BREATH.cornice;
    for (const h of plan.filter((p) => p.piece === 'Kit_WindHorn'))
      expect(Math.sin(h.rot) * (h.x - C.x) + Math.cos(h.rot) * (h.z - C.z)).toBeGreaterThan(0);
    // The arch at the ramp's foot, its run along the ramp.
    const b = plan.find((p) => p.piece === 'Kit_WindBridge');
    const f = windBridgeFrame();
    expect(b?.x).toBe(WIND_BRIDGE.fromX);
    expect(b?.z).toBe(WIND_BRIDGE.fromZ);
    expect(b?.y).toBe(BREATH.b2.h);
    expect(Math.cos(f.rot) * f.run).toBeCloseTo(WIND_BRIDGE.toX - WIND_BRIDGE.fromX, 6);
    expect(-Math.sin(f.rot) * f.run).toBeCloseTo(WIND_BRIDGE.toZ - WIND_BRIDGE.fromZ, 6);
  });

  it('walls the Breath walks over the void, never over a walk', () => {
    const walls = planBreathWalls();
    expect(walls.length).toBeGreaterThan(40);
    const near = (id: string) =>
      walls.filter((w) =>
        [-1.5, -0.5].some(
          (d) =>
            authoredFieldSurfaceAt(F, w.x + Math.sin(w.rot) * d, w.z + Math.cos(w.rot) * d)?.id ===
            id,
        ),
      ).length;
    // The bridge, the Cornice and every landing have their walls.
    for (const id of ['wind_bridge', 'storm_cornice', 'breath_b1', 'breath_b2', 'breath_b3'])
      expect(near(id), id).toBeGreaterThan(1);
    for (const w of walls)
      expect(wallClear(w.x, w.z, w.rot, w.stretch ?? 1), `${w.x} ${w.z}`).toBe(true);
  });

  it('lays the grooves and the cracks flat on the Breath floors', () => {
    const flat = [...planBreathChannels(), ...planBreathDressing()];
    expect(planBreathChannels()).toHaveLength(CORNICE_CHANNELS.length);
    expect(flat.length).toBeGreaterThan(CORNICE_CHANNELS.length + 8);
    for (const p of flat) {
      const s = authoredFieldSurfaceAt(F, p.x, p.z);
      expect(BREATH_WALK_SURFACES.has(s?.id ?? ''), `${p.piece} on ${s?.id}`).toBe(true);
      expect(Math.abs(p.y - authoredFieldHeight(F, p.x, p.z))).toBeLessThan(0.05);
      expect(p.cosmetic).toBe(true);
      expect(p.noShadow).toBe(true);
    }
  });

  it('leaves the Wind Bridge drop to its arch: no mountain lip under it', () => {
    expect(BREATH_KIT_SHALLOW.has('wind_bridge')).toBe(true);
    const { run, rot } = windBridgeFrame();
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    for (const lip of planHeartLips()) {
      const dx = lip.x - WIND_BRIDGE.fromX;
      const dz = lip.z - WIND_BRIDGE.fromZ;
      const along = dx * ux + dz * uz;
      const across = Math.abs(-dx * uz + dz * ux);
      const under = along > 2 && along < run - 2 && across < WIND_BRIDGE.halfWidth + 1.5;
      expect(under, `lip at ${lip.x} ${lip.z}`).toBe(false);
    }
    expect(planBreathKit().length).toBeGreaterThan(80);
  });
});
