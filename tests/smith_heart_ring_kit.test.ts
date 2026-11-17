// The Smith's Heart's Ring kit (phase 2F: scripts/assets/smith_heart_ring_kit/
// build.mjs, built from docs/design/raid/kit/build_smith_heart_ring_kit.py),
// its plan (src/render/smith_heart/ring_kit_plan_core.ts) and the seal's and
// the portal's moments (heart_seal_core.ts, heart_portal_core.ts,
// heart_rivers_core.ts, smith_heart_fx/seal_shake.ts):
//   - the shipped GLB is the current sources' (fingerprint, nodes, the two
//     slots), inside its budget; the measures the plan relies on are the
//     GLB's (the paving's sector and its flat top, a tread's run and rise,
//     the parapets and fascias past the lip, the curbs under a hand, the
//     sills flush, the seal's quarter and heart, the spire's lean);
//   - the plan paves the Ring's whole arc, inlays a channel where every river
//     crosses it, curbs its lip but where a river leaps it, steps both stairs
//     tread by tread on their walked ramp (half a riser either way) with the
//     river's chute down their middle, rails every stair, fits every Ring prop
//     with its piece, flanks the three mouths with their vein's jambs;
//   - nothing render-only stands over a walked floor beyond a hand unless it
//     stands on a layout collider (the real meshes, placed);
//   - the seal's moments: the arrival's shockwave and the spire igniting, the
//     quarters parting, the shards bursting out and turning round the portal
//     over every head, the river's surge, the camera's jolts, once each.
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
  SMITH_HEART_RING_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_ring_kit/build.mjs';
import { heartKitPlacementMatrix } from '../src/render/smith_heart/heart_kit';
import {
  HEART_ARRIVAL_SHAKES,
  HEART_PORTAL_OPEN,
  HEART_PORTAL_SHAKES,
  heartShakeDue,
} from '../src/render/smith_heart/heart_portal_core';
import {
  HEART_RIVER_RUN_SECONDS,
  heartRiverArcs,
  heartRiverSurgeHead,
  planHeartRiver,
} from '../src/render/smith_heart/heart_rivers_core';
import { planHeartLips } from '../src/render/smith_heart/heart_rock_plan_core';
import {
  HEART_SEAL_ARRIVAL,
  HEART_SEAL_WAVE_SECONDS,
  heartSealArrivalWave,
} from '../src/render/smith_heart/heart_seal_core';
import {
  planRingChannels,
  planRingEdges,
  planRingKit,
  planRingMouths,
  planRingPaving,
  planRingProps,
  planRingStairSteps,
  planRingStairs,
  RING_CHANNEL_BEARINGS,
  RING_KIT_FASCIA_DEPTH,
  RING_KIT_FASCIA_SURFACES,
  RING_KIT_KINDS,
  RING_KIT_OMIT_TOPS,
  RING_KIT_SIZES,
  RING_KIT_STAIRS,
  RING_MOUTHS,
} from '../src/render/smith_heart/ring_kit_plan_core';
import { SEAL_SHAKE_REACH, sealShakeFalloff } from '../src/render/smith_heart_fx/seal_shake';
import {
  EAST_STAIR,
  LIGHT_RIVERS,
  NORTH_STAIR,
  RING,
  RING_ARC,
  RING_PACK_DEGREES,
  SEAL_DAIS,
  SMITH_HEART_FIELD,
  WEST_STAIR,
} from '../src/sim/content/smith_heart_layout';
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

/** How far a piece reaches from its origin between a hand over the ground
 *  (flat chips a body walks over) and `below`. */
const reach = (name: string, below: number): number => {
  let r = 0;
  for (const p of shape(name).points)
    if (p[1] < below && p[1] > 0.3) r = Math.max(r, Math.hypot(p[0], p[2]));
  return r;
};

describe('Smith Heart Ring kit: the piece list and the shipped GLB', () => {
  it('lists every piece once: the Ring, the stairs, the seal, the spires, the mouths', () => {
    const list = SMITH_HEART_RING_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'RingPaveA',
      'RingPaveStart',
      'RingPaveEnd',
      'RingChannel',
      'RingCurbA',
      'RingFootA',
      'StairTreadA',
      'StairTreadLongA',
      'StairChute',
      'StairParapetA',
      'SealDais',
      'SealQuarter',
      'SealHeart',
      'SealShardA',
      'SealSpire',
      'RingMonolith',
      'RingCairnA',
      'JambHammer',
      'JambBreath',
      'JambQuench',
      'JambHeat',
    ])
      expect(list, piece).toContain(piece);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_RING_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    // The modules drawn by the dozen are light; the dais (one) carries the
    // inverted mountain under it.
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      const cap = /StairTread|StairChute|Shard|Sill/.test(name)
        ? 400
        : /RingPave|Curb|Foot|Parapet|Channel/.test(name)
          ? 2000
          : name === 'Kit_SealDais'
            ? 32000
            : 4500;
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
      total += s.triangles;
    }
    expect(total).toBeLessThan(90_000);
  });

  it.skipIf(!haveKit)('lights only crystal: the seal, the spires, the lamps, the jambs', () => {
    for (const glowing of [
      'Kit_SealQuarter',
      'Kit_SealHeart',
      'Kit_SealSpire',
      'Kit_SealShardA',
      'Kit_SealDais',
      'Kit_RingMonolith',
      'Kit_RingCairnA',
      'Kit_JambBreath',
      'Kit_JambHeat',
    ])
      expect(shape(glowing).materials.has('KitGlow'), glowing).toBe(true);
    for (const plain of ['Kit_RingPaveA', 'Kit_RingCurbA', 'Kit_StairTreadA', 'Kit_StairParapetA'])
      expect(shape(plain).materials, plain).toEqual(new Set(['KitStone']));
  });
});

describe('Smith Heart Ring kit: the measures the plan relies on', () => {
  it.skipIf(!haveKit)('paves a 6 degree sector of the Ring, flat, a breath over the walk', () => {
    for (const v of ['A', 'B', 'C', 'D', 'Start', 'End']) {
      const s = shape(`Kit_RingPave${v}`);
      for (const p of s.points) {
        const r = Math.hypot(p[0], p[2]);
        expect(r, v).toBeGreaterThan(RING.innerR - 0.15);
        expect(r, v).toBeLessThan(RING.outerR + 0.15);
      }
      // Every flag a breath over the field's own walk, spalls under a hand.
      expect(s.max[1], v).toBeLessThan(0.08);
      // The middle bearing is +Z (the game's north once turned).
      expect(s.max[2], v).toBeGreaterThan(RING.outerR - 0.3);
    }
    const flags = shape('Kit_RingPaveA').points.filter((p) => p[1] > 0.005);
    expect(Math.min(...flags.map((p) => p[1]))).toBeGreaterThan(0.005);
  });

  it.skipIf(!haveKit)('sizes a tread to its run and rise, its top the stair line', () => {
    const short = shape('Kit_StairTreadA');
    expect(short.max[0] - short.min[0]).toBeCloseTo(RING_KIT_SIZES.treadRun, 1);
    expect(short.max[1]).toBeLessThan(0.03);
    expect(-short.min[1]).toBeGreaterThan(RING_KIT_SIZES.treadRise);
    expect(short.max[2] - short.min[2]).toBeCloseTo(RING_KIT_SIZES.sideWidth - 0.06, 1);
    const long = shape('Kit_StairTreadLongA');
    expect(long.max[0] - long.min[0]).toBeCloseTo(RING_KIT_SIZES.longRun, 0);
    expect(-long.min[1]).toBeGreaterThan(RING_KIT_SIZES.longRise);
    const chute = shape('Kit_StairChute');
    expect(chute.max[0] - chute.min[0]).toBeCloseTo(RING_KIT_SIZES.chuteLength, 0);
    expect(Math.max(-chute.min[2], chute.max[2])).toBeLessThanOrEqual(
      RING_KIT_SIZES.chuteHalf + 0.01,
    );
    // The chute's bed under the ribbon (the ribbon rides 0.12 over the ramp).
    expect(chute.max[1]).toBeLessThan(0.26);
  });

  it.skipIf(!haveKit)(
    'stands the parapets and fascias past the lip, the curbs under a hand',
    () => {
      for (const name of ['Kit_StairParapetA', 'Kit_StairParapetB']) {
        const s = shape(name);
        // Wholly past the lip (the walk is glTF -Z).
        expect(s.min[2], name).toBeGreaterThan(-0.05);
        expect(s.max[1], name).toBeLessThan(0.95);
        expect(s.min[1], name).toBeLessThan(-RING_KIT_FASCIA_DEPTH + 0.1);
      }
      for (const name of ['Kit_RingCurbA', 'Kit_RingCurbB']) {
        const s = shape(name);
        expect(s.max[1], name).toBeLessThan(0.3);
        expect(s.min[1], name).toBeLessThan(-RING_KIT_FASCIA_DEPTH + 0.1);
        // Over the walk only the curbstones (a hand high).
        for (const p of s.points) if (p[2] < -0.05) expect(p[1], name).toBeLessThan(0.3);
      }
      for (const name of ['Kit_RingFootA', 'Kit_RingFootB']) {
        // On the walk (glTF -Z) only the flush gutter and the spilt chips.
        for (const p of shape(name).points) if (p[2] < -0.1) expect(p[1], name).toBeLessThan(0.12);
      }
      expect(shape('Kit_RingSill').max[1]).toBeLessThan(0.06);
      expect(shape('Kit_RingChannel').max[1]).toBeLessThan(0.1);
    },
  );

  it.skipIf(!haveKit)('shapes the dais: its walk flush, the inverted mountain under it', () => {
    const d = shape('Kit_SealDais');
    // The dais's walk (and its landings out to the stairs) is flush.
    for (const p of d.points) {
      const r = Math.hypot(p[0], p[2]);
      if (r < 18.9 && Math.abs(p[0]) > 0.1) expect(p[1]).toBeLessThan(0.1);
    }
    const walk = d.points.filter((p) => p[1] > -1);
    expect(Math.max(...walk.map((p) => Math.abs(p[2])))).toBeCloseTo(RING_KIT_SIZES.apron, 0);
    // The inverted mountain under it.
    expect(d.min[1]).toBeLessThan(-40);
  });

  it.skipIf(!haveKit)('keeps every prop piece a body can touch within its collider', () => {
    const fits: [string, string][] = [
      ['Kit_RingMonolith', 'sh_ring_pillar'],
      ['Kit_RingCairnA', 'sh_ring_cairn'],
      ['Kit_RingCairnB', 'sh_ring_cairn'],
      ['Kit_JambHammer', 'sh_hammer_jamb'],
    ];
    for (const [piece, kind] of fits) {
      const p = F.props.find((q) => q.kind === kind);
      if (!p?.r) throw new Error(kind);
      expect(reach(piece, 2.2), piece).toBeLessThanOrEqual(p.r + 0.6);
    }
  });
});

describe('ring_kit_plan_core: the Ring, its stairs and its mouths', () => {
  it('paves the whole arc, Start and End closing it, no module twice', () => {
    const pave = planRingPaving();
    expect(pave.length).toBe((RING_ARC.toDeg - RING_ARC.fromDeg) / RING_KIT_SIZES.sector);
    expect(pave[0].piece).toBe('Kit_RingPaveStart');
    expect(pave[pave.length - 1].piece).toBe('Kit_RingPaveEnd');
    const bearings = pave.map((p) => Math.round((p.rot * 180) / Math.PI));
    expect(new Set(bearings).size).toBe(bearings.length);
    expect(bearings[0] - RING_KIT_SIZES.sector / 2).toBe(RING_ARC.fromDeg);
    expect(bearings[bearings.length - 1] + RING_KIT_SIZES.sector / 2).toBe(RING_ARC.toDeg);
  });

  it('inlays a channel where every river crosses the Ring, on its line', () => {
    const channels = planRingChannels();
    expect(channels.map((c) => Math.round((c.rot * 180) / Math.PI))).toEqual([
      ...RING_CHANNEL_BEARINGS,
    ]);
    for (const vein of ['breath', 'quench', 'heat'] as const) {
      const line = LIGHT_RIVERS[vein];
      const crossing = line.find((p) => Math.abs(Math.hypot(p.x, p.z) - RING.innerR) < 0.5);
      if (!crossing) throw new Error(vein);
      expect(
        channels.some(
          (c) =>
            Math.abs(Math.atan2(c.x, c.z) - Math.atan2(crossing.x, crossing.z)) < 1e-6 ||
            Math.hypot(c.x - crossing.x, c.z - crossing.z) < RING.R - RING.innerR + 0.1,
        ),
        vein,
      ).toBe(true);
    }
  });

  it("curbs the Ring's lip but where a river leaps it, and footes its rim", () => {
    const edges = planRingEdges();
    const curbs = edges.filter((e) => e.piece.startsWith('Kit_RingCurb'));
    const feet = edges.filter((e) => e.piece.startsWith('Kit_RingFoot'));
    expect(curbs.length).toBeGreaterThan(30);
    expect(feet.length).toBeGreaterThan(30);
    for (const c of curbs) expect(Math.hypot(c.x, c.z)).toBeLessThan(RING.R);
    for (const f of feet) expect(Math.hypot(f.x, f.z)).toBeGreaterThan(RING.R);
    // No curb across the Quench's and the Heat's leap.
    for (const deg of [90, 270]) {
      const a = (deg * Math.PI) / 180;
      const p = { x: Math.sin(a) * RING.innerR, z: Math.cos(a) * RING.innerR };
      expect(
        curbs.every((c) => Math.hypot(c.x - p.x, c.z - p.z) > 2),
        `${deg}`,
      ).toBe(true);
    }
  });

  it('rails every stair down to the seal on both sides', () => {
    const rails = planRingEdges().filter((e) => e.piece.startsWith('Kit_StairParapet'));
    for (const id of [...RING_KIT_STAIRS, 'balcony_stair_east', 'balcony_stair_west']) {
      const mine = rails.filter((e) => {
        const s = authoredFieldSurfaceAt(
          F,
          e.x - Math.sin(e.rot) * 0.8,
          e.z - Math.cos(e.rot) * 0.8,
        );
        return s?.id === id;
      });
      expect(mine.length, id).toBeGreaterThan(6);
      // Both sides (the outward normals point two ways across the stair's axis).
      const across = id === 'east_stair' || id === 'west_stair' ? 'z' : 'x';
      const sides = new Set(
        mine.map((e) =>
          Math.sign(Math.round((across === 'x' ? Math.sin(e.rot) : Math.cos(e.rot)) * 10) || 1),
        ),
      );
      if (RING_KIT_STAIRS.includes(id)) expect(sides.size, id).toBe(2);
    }
  });

  it('steps every stair tread by tread on the walked ramp, half a riser either way', () => {
    for (const id of RING_KIT_STAIRS) {
      const steps = planRingStairSteps(id);
      expect(steps.length, id).toBeGreaterThan(10);
      for (const st of steps) {
        const walked = authoredFieldHeight(F, st.x, st.z);
        expect(Math.abs(st.y - walked), id).toBeLessThan(0.02);
        expect(st.rise, id).toBeLessThan(0.4);
        // The tread's back half a riser over the ramp, its nosing half under.
        const back = authoredFieldHeight(
          F,
          st.x - (st.dx * st.run) / 2,
          st.z - (st.dz * st.run) / 2,
        );
        expect(back - st.y, id).toBeCloseTo(st.rise / 2, 1);
      }
    }
    // The Grand Stair in short treads, the gentle Ring stairs in long ones.
    expect(planRingStairSteps('grand_stair').every((s) => !s.long)).toBe(true);
    for (const id of ['north_stair', 'east_stair', 'west_stair'])
      expect(
        planRingStairSteps(id).every((s) => s.long),
        id,
      ).toBe(true);
    // Two side modules per tread, a chute down the middle on the ramp.
    const plan = planRingStairs();
    const treads = plan.filter((p) => p.piece.startsWith('Kit_StairTread'));
    const steps = RING_KIT_STAIRS.reduce((n, id) => n + planRingStairSteps(id).length, 0);
    expect(treads.length).toBe(steps * 2);
    for (const c of plan.filter((p) => p.piece === 'Kit_StairChute')) {
      expect(Math.abs(c.y - authoredFieldHeight(F, c.x, c.z))).toBeLessThan(0.05);
      expect(c.shear ?? 0).toBeLessThan(0);
    }
  });

  it('omits the field tops it draws, and only those', () => {
    expect([...RING_KIT_OMIT_TOPS].sort()).toEqual(
      [...RING_KIT_STAIRS, 'ring', 'seal_dais'].sort(),
    );
    for (const id of RING_KIT_OMIT_TOPS)
      expect(
        F.surfaces.some((s) => s.id === id),
        id,
      ).toBe(true);
  });

  it('fits every Ring prop with its piece, a cairn behind every pack', () => {
    const props = planRingProps();
    expect(props.filter((p) => p.piece === 'Kit_SealDais')).toHaveLength(1);
    expect(props.filter((p) => p.piece === 'Kit_RingMonolith')).toHaveLength(
      F.props.filter((p) => p.kind === 'sh_ring_pillar').length,
    );
    expect(props.filter((p) => p.piece.startsWith('Kit_RingCairn'))).toHaveLength(
      RING_PACK_DEGREES.length,
    );
    expect(props.filter((p) => p.piece === 'Kit_JambHammer')).toHaveLength(2);
    for (const k of RING_KIT_KINDS)
      expect(
        F.props.some((p) => p.kind === k),
        k,
      ).toBe(true);
  });

  it("flanks the three mouths with their vein's jambs, clear of the walk", () => {
    const jambs = planRingMouths().filter((p) => p.piece.startsWith('Kit_Jamb'));
    expect(jambs).toHaveLength(RING_MOUTHS.length * 2);
    for (const m of RING_MOUTHS)
      expect(
        jambs.filter((j) => j.piece === m.piece),
        m.vein,
      ).toHaveLength(2);
    for (const j of jambs) expect(authoredFieldSurfaceAt(F, j.x, j.z), j.piece).toBeFalsy();
  });

  it('drops the hanging lips under the fascias', () => {
    const lips = planHeartLips();
    for (const l of lips) {
      const s = authoredFieldSurfaceAt(F, l.x - Math.sin(l.rot) * 2.4, l.z - Math.cos(l.rot) * 2.4);
      if (!s || !RING_KIT_FASCIA_SURFACES.has(s.id)) continue;
      expect(l.y).toBeLessThan(
        authoredFieldHeight(F, l.x - Math.sin(l.rot) * 2.4, l.z - Math.cos(l.rot) * 2.4) -
          RING_KIT_FASCIA_DEPTH +
          0.5,
      );
    }
  });

  it.skipIf(!haveKit)('stands nothing render-only over a walked floor beyond a hand', () => {
    // Every placed piece's real mesh: a vertex over a walked floor, more than
    // a hand above it and under a body's height, must stand on a layout
    // collider (a standing stone, a cairn, a jamb).
    const colliders = F.props.filter((p) => p.r !== undefined);
    const onCollider = (x: number, z: number) =>
      colliders.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r ?? 0) + 0.6);
    const bad: string[] = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const p of planRingKit()) {
      if (p.piece === 'Kit_SealDais') continue;
      heartKitPlacementMatrix(p, m);
      const pts = shape(p.piece).points;
      for (let i = 0; i < pts.length; i += 3) {
        v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(m);
        if (!authoredFieldSurfaceAt(F, v.x, v.z)) continue;
        const floor = authoredFieldHeight(F, v.x, v.z);
        if (v.y > floor + 0.33 && v.y < floor + 2.2 && !onCollider(v.x, v.z)) {
          bad.push(`${p.piece} at (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`);
          break;
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('the seal and the portal: the moments', () => {
  it("runs the arrival's shockwave across once, from the moment the light reaches the seal", () => {
    expect(heartSealArrivalWave(HEART_SEAL_ARRIVAL - 0.01)).toBe(0);
    expect(heartSealArrivalWave(HEART_SEAL_ARRIVAL + 0.01)).toBeGreaterThan(0);
    const mid = heartSealArrivalWave(HEART_SEAL_ARRIVAL + HEART_SEAL_WAVE_SECONDS / 2);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    expect(heartSealArrivalWave(HEART_SEAL_ARRIVAL + HEART_SEAL_WAVE_SECONDS + 0.1)).toBe(0);
    expect(heartSealArrivalWave(999)).toBe(0);
  });

  it("rides the river's surge with the light's front, then lets it go", () => {
    const strip = planHeartRiver(LIGHT_RIVERS.breath, () => 0);
    const arcs = heartRiverArcs(strip);
    expect(arcs).toHaveLength(strip.segments * 4);
    const total = arcs[arcs.length - 1];
    expect(total).toBeGreaterThan(200);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]).toBeGreaterThanOrEqual(arcs[i - 1]);
    expect(heartRiverSurgeHead(-1, total)).toBe(-1);
    expect(heartRiverSurgeHead(HEART_RIVER_RUN_SECONDS / 2, total)).toBeCloseTo(total / 2, 3);
    expect(heartRiverSurgeHead(HEART_RIVER_RUN_SECONDS * 2, total)).toBe(-1);
  });

  it('jolts the camera once per moment, never for a moment met long done', () => {
    expect(heartShakeDue(HEART_PORTAL_SHAKES, null, 999)).toBe(0);
    expect(heartShakeDue(HEART_PORTAL_SHAKES, -1, -1)).toBe(0);
    const all = HEART_PORTAL_SHAKES.reduce((a, s) => a + s.amount, 0);
    expect(heartShakeDue(HEART_PORTAL_SHAKES, -1, 5)).toBeCloseTo(all, 6);
    // The heavy jolt is the flash's.
    expect(
      heartShakeDue(HEART_PORTAL_SHAKES, HEART_PORTAL_OPEN.charge - 0.01, HEART_PORTAL_OPEN.charge),
    ).toBeGreaterThan(0.5);
    // Twice over the same span: once.
    expect(heartShakeDue(HEART_PORTAL_SHAKES, 5, 6)).toBe(0);
    expect(heartShakeDue(HEART_ARRIVAL_SHAKES, 0, HEART_SEAL_ARRIVAL)).toBeGreaterThan(0);
    // Felt in full near the seal, fading out across the main map.
    expect(sealShakeFalloff(0)).toBe(1);
    expect(sealShakeFalloff(SEAL_SHAKE_REACH.far)).toBe(0);
    expect(sealShakeFalloff((SEAL_SHAKE_REACH.near + SEAL_SHAKE_REACH.far) / 2)).toBeCloseTo(
      0.5,
      6,
    );
  });
});

// The owner's review of 2026-11-18: the bridges the Quench's and the Heat's light-rivers
// crossed on were too thin, so the dais gets the same broad stairs the Breath's river
// has (the North Stair), one at the Ring's east and one at its west.
describe('ring_kit_plan_core: the East and West Stairs are the North Stair turned', () => {
  const STAIRS = [
    { id: 'north_stair', axis: 'z', sign: 1, spec: NORTH_STAIR },
    { id: 'east_stair', axis: 'x', sign: 1, spec: EAST_STAIR },
    { id: 'west_stair', axis: 'x', sign: -1, spec: WEST_STAIR },
  ] as const;
  /** A point `d` yards from the seal along a stair's axis and `o` yards across it. */
  const at = (st: (typeof STAIRS)[number], d: number, o = 0) =>
    st.axis === 'z' ? { x: o, z: d } : { x: st.sign * d, z: o };

  it('are the same stair: as broad, as long and as gentle, from the Ring to the dais', () => {
    for (const st of STAIRS) {
      expect(st.spec, st.id).toEqual({ halfWidth: 8, top: RING.innerR, foot: SEAL_DAIS.r });
      const top = at(st, st.spec.top + 1);
      const foot = at(st, st.spec.foot - 2);
      expect(authoredFieldHeight(F, top.x, top.z), st.id).toBe(RING.h);
      expect(authoredFieldHeight(F, foot.x, foot.z), st.id).toBe(SEAL_DAIS.h);
      // Walkable the whole way and as wide as the Grand Stair, void either side of it.
      for (let d = st.spec.top - 2; d > st.spec.foot + 1; d--) {
        for (const o of [-st.spec.halfWidth + 0.5, 0, st.spec.halfWidth - 0.5]) {
          const p = at(st, d, o);
          expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id, `${st.id} ${d} ${o}`).toBe(st.id);
        }
        for (const o of [-st.spec.halfWidth - 3, st.spec.halfWidth + 3]) {
          const p = at(st, d, o);
          expect(authoredFieldSurfaceAt(F, p.x, p.z), `${st.id} ${d} ${o}`).toBeNull();
        }
      }
    }
    expect(NORTH_STAIR.halfWidth * 2).toBeGreaterThanOrEqual(12);
  });

  it('are built tread by tread alike, in the long gentle treads, railed on both sides', () => {
    const counts = STAIRS.map((st) => planRingStairSteps(st.id).length);
    expect(new Set(counts).size).toBe(1);
    for (const st of STAIRS) {
      expect(
        planRingStairSteps(st.id).every((x) => x.long),
        st.id,
      ).toBe(true);
      expect(RING_KIT_STAIRS, st.id).toContain(st.id);
    }
  });

  it('carry the rivers down their chutes: the Quench from the east, the Heat from the west', () => {
    for (const [vein, st] of [
      ['quench', STAIRS[1]],
      ['heat', STAIRS[2]],
    ] as const) {
      const river = LIGHT_RIVERS[vein];
      // The river's last legs lie along the stair's axis, from the Ring in to the seal.
      const onStair = river.filter(
        (p) => Math.abs(p.z) < 1e-9 && Math.abs(p.x) <= RING.innerR && Math.abs(p.x) >= 9,
      );
      expect(onStair.length, vein).toBeGreaterThanOrEqual(2);
      for (let d = st.spec.top - 1; d > st.spec.foot + 1; d -= 2) {
        const p = at(st, d);
        expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id, `${vein} ${d}`).toBe(st.id);
      }
    }
  });

  it('leave no conduit over the chasm: the stairs are the way the light crosses', () => {
    const pieces = new Set(planRingKit().map((p) => p.piece));
    expect(pieces.has('Kit_ConduitSpan')).toBe(false);
    expect(pieces.has('Kit_ConduitPier')).toBe(false);
  });
});
