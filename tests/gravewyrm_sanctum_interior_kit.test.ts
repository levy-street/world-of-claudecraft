// The Gravewyrm Sanctum's interior AAA pass (the owner's 2026-10-20 walk:
// the paths and the boss rooms wanted an AAA pass): the second Blender kit
// (scripts/assets/gravewyrm_sanctum_interior/build.mjs, built from
// docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_interior.py), its
// placement plan (src/render/gravewyrm_sanctum/sanctum_interior_plan_core.ts).
//
// - the shipped GLB is the current sources' (fingerprint, nodes, materials),
//   inside the pass's budget, every piece with a sane triangle count;
// - pure dressing: nothing it draws stands in a body's way over walkable
//   floor (the pedestal and the lips stay under the floor they hang from, the
//   curb is knee low), the pedestal clears the Chain Bridge's deck, and the
//   carved pillars stay inside their collider's skin.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  GRAVEWYRM_SANCTUM_INTERIOR_PIECES,
  sourceFingerprint,
} from '../scripts/assets/gravewyrm_sanctum_interior/build.mjs';
import { ASSET as FIRST_KIT } from '../scripts/assets/gravewyrm_sanctum_kit/build.mjs';
import { PILLAR_SCALE } from '../src/render/gravewyrm_sanctum/sanctum_chains_core';
import {
  planSanctumInteriorPlacements,
  resolveInteriorReplacements,
  SANCTUM_INTERIOR_PLAN_PIECES,
} from '../src/render/gravewyrm_sanctum/sanctum_interior_plan_core';
import { sanctumPlacementMatrix } from '../src/render/gravewyrm_sanctum/sanctum_kit';
import { planSanctumKitPlacements } from '../src/render/gravewyrm_sanctum/sanctum_kit_plan_core';
import {
  CHAIN_BRIDGE,
  GRAVEWYRM_SANCTUM_FIELD,
  LOCK_TERRACE,
  SEAL_PILLARS,
  THAW_POOLS,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';

const KIT = ASSET.target;
const FIELD = GRAVEWYRM_SANCTUM_FIELD;
const VOID = FIELD.voidHeight;
/** Under this over the floor a body steps over it (the walls test's band). */
const BAND_LOW = Math.max(MAX_STEP_HEIGHT, FIELD.cliffStep) + 0.05;

interface Shape {
  points: number[];
  triangles: number;
  materials: Set<string>;
  min: [number, number, number];
  max: [number, number, number];
}

const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];

async function io(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

beforeAll(async () => {
  const doc = await (await io()).readBinary(new Uint8Array(readFileSync(KIT)));
  const root = doc.getRoot();
  extras = (root.getExtras() ?? {}) as Record<string, unknown>;
  nodeNames = root
    .listNodes()
    .map((n) => n.getName())
    .sort();
  materialNames = root
    .listMaterials()
    .map((m) => m.getName())
    .sort();
  for (const node of root.listNodes()) {
    if (!node.getName().startsWith('Kit_')) continue;
    const m = node.getWorldMatrix();
    const s: Shape = {
      points: [],
      triangles: 0,
      materials: new Set(),
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      s.materials.add(prim.getMaterial()?.getName() ?? '');
      s.triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const p = [0, 1, 2].map((k) => m[k] * e[0] + m[4 + k] * e[1] + m[8 + k] * e[2] + m[12 + k]);
        s.points.push(p[0], p[1], p[2]);
        for (let k = 0; k < 3; k++) {
          s.min[k] = Math.min(s.min[k], p[k]);
          s.max[k] = Math.max(s.max[k], p[k]);
        }
      }
    }
    shapes.set(node.getName(), s);
  }
}, 120_000);

describe('the interior kit asset', () => {
  it('is the current sources, every piece, three slot materials at most', () => {
    expect(existsSync(KIT)).toBe(true);
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...GRAVEWYRM_SANCTUM_INTERIOR_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    for (const m of materialNames) expect(['KitStone', 'KitGlow', 'KitGlass']).toContain(m);
  });

  it('fits the pass budget (the whole interior pass under 2.5 MB) with sane pieces', () => {
    expect(statSync(KIT).size).toBeLessThan(2.5 * 1024 * 1024);
    // The dungeon's kit budget (docs/design/dungeon-rework/README.md, section 9)
    // covers both kit GLBs together: the first kit plus this interior pass.
    expect(statSync(FIRST_KIT.target).size + statSync(KIT).size).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
    const budget: [RegExp, number][] = [
      [/^Kit_LockSpur$/, 26_000],
      [/^Kit_LockCurb$/, 7_000],
      [/^Kit_SealPillar(Cracked)?V2_/, 7_000],
      [/^Kit_LipRock/, 1_800],
      [/^Kit_LipIce/, 1_800],
      [/^Kit_ThawPyreV2$/, 13_000],
      [/^Kit_BoneHeap$/, 2_600],
      [/^Kit_EdgeRubble/, 1_200],
      [/^Kit_Drift/, 900],
    ];
    for (const [name, s] of shapes) {
      const cap = budget.find(([re]) => re.test(name))?.[1] ?? 12_000;
      expect(s.triangles, name).toBeGreaterThan(200);
      expect(s.triangles, name).toBeLessThanOrEqual(cap);
    }
  });
});

describe('the interior pieces keep their frames', () => {
  it('the pedestal and the lips never rise to the floor they hang from', () => {
    expect(shapes.get('Kit_LockSpur')?.max[1]).toBeLessThan(-0.05);
    for (const v of ['RockA', 'RockB', 'RockC', 'IceA', 'IceB']) {
      const s = shapes.get(`Kit_Lip${v}`);
      expect(s?.max[1], v).toBeLessThan(-0.05);
      // Nothing behind the lip, under the walkway's own body (glTF -z).
      expect(s?.min[2], v).toBeGreaterThan(-0.5);
    }
  });

  it('the curb is knee low, round the arena rim, never in its middle', () => {
    const s = shapes.get('Kit_LockCurb');
    if (!s) throw new Error('no curb');
    expect(s.max[1]).toBeLessThan(0.5);
    for (let i = 0; i < s.points.length; i += 3) {
      const r = Math.hypot(s.points[i], s.points[i + 2]);
      expect(r).toBeGreaterThan(LOCK_TERRACE.r - 4);
      expect(r).toBeLessThan(LOCK_TERRACE.r + 0.6);
    }
  });

  it('the carved pillars stand their 15 yd frame inside the collider skin', () => {
    for (const tool of ['Hammer', 'Tongs', 'Anvil', 'Bellows']) {
      for (const name of [`Kit_SealPillarV2_${tool}`, `Kit_SealPillarCrackedV2_${tool}`]) {
        const s = shapes.get(name);
        if (!s) throw new Error(`no ${name}`);
        expect(s.max[1], name).toBeGreaterThan(14);
        expect(s.max[1], name).toBeLessThan(15.6);
        const reach = Math.max(-s.min[0], s.max[0], -s.min[2], s.max[2]) * PILLAR_SCALE;
        // The collider's radius plus a body's width (the walls test's skin).
        expect(reach, name).toBeLessThan(SEAL_PILLARS[0].r + 1.6);
      }
    }
  });
});

describe('the interior plan stands clear of every walk', () => {
  const placed = planSanctumInteriorPlacements();

  function worldPoints(piece: string, k: (typeof placed)[number]): [number, number, number][] {
    const s = shapes.get(piece);
    if (!s) throw new Error(`no ${piece}`);
    const m = sanctumPlacementMatrix(k, new THREE.Matrix4(), (x, z) =>
      authoredFieldHeight(FIELD, x, z),
    ).elements;
    const out: [number, number, number][] = [];
    for (let i = 0; i < s.points.length; i += 3) {
      const x = s.points[i];
      const y = s.points[i + 1];
      const z = s.points[i + 2];
      out.push([
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ]);
    }
    return out;
  }

  it('places the Lock Terrace pieces and lips along both chain stairs', () => {
    const pieces = placed.map((p) => p.piece);
    expect(pieces).toContain('Kit_LockSpur');
    expect(pieces).toContain('Kit_LockCurb');
    expect(pieces.filter((p) => p.startsWith('Kit_LipRock')).length).toBeGreaterThanOrEqual(4);
    for (const p of placed) expect(shapes.has(p.piece), p.piece).toBe(true);
  });

  it('names every piece it places up front (the load-time stand-in list)', () => {
    expect([...SANCTUM_INTERIOR_PLAN_PIECES].sort()).toEqual(
      [...new Set(placed.map((p) => p.piece))].sort(),
    );
  });

  it('keeps the shed floor dressing knee low: a body steps over it', () => {
    // Rubble, drifts, lips and bone heaps (the cosmetic pieces) stay under one
    // step over the floor they sit on, not merely under the waist band.
    const bad: string[] = [];
    let worst = 0;
    for (const k of placed) {
      if (!k.cosmetic) continue;
      for (const [x, y, z] of worldPoints(k.piece, k)) {
        const floor = authoredFieldHeight(FIELD, x, z);
        if (floor <= VOID + 1) continue;
        worst = Math.max(worst, y - floor);
        if (y > floor + MAX_STEP_HEIGHT && bad.length < 20)
          bad.push(`${k.piece} at (${x.toFixed(1)}, ${z.toFixed(1)}) ${(y - floor).toFixed(2)}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
    expect(worst).toBeGreaterThan(0.2);
  });

  it('keeps the Lock Terrace curb on the rim, ankle low, off the fight floor', () => {
    // Korgath's lanes and rings lay on the terrace floor (the shared, depth
    // tested TelegraphKit): the curb's stones stay in the outer rim band and
    // under shin height, its snow skirt lower still.
    const curb = placed.find((p) => p.piece === 'Kit_LockCurb');
    if (!curb) throw new Error('no curb');
    let stones = 0;
    for (const [x, y, z] of worldPoints('Kit_LockCurb', curb)) {
      const r = Math.hypot(x - LOCK_TERRACE.x, z - LOCK_TERRACE.z);
      const over = y - LOCK_TERRACE.h;
      expect(r, `curb vertex at r ${r.toFixed(2)}`).toBeGreaterThan(LOCK_TERRACE.r - 4.2);
      expect(over).toBeLessThan(0.45);
      if (over > 0.25) {
        stones++;
        expect(r, `curb stone at r ${r.toFixed(2)}`).toBeGreaterThan(LOCK_TERRACE.r - 2.2);
      }
    }
    expect(stones).toBeGreaterThan(100);
  });

  it('no piece stands through a body over walkable floor', () => {
    const bad: string[] = [];
    for (const k of placed) {
      // The thaw pyres' standards on their pools' rims are render-only reach
      // on purpose, as the first kit's (the walls test's RENDER_ONLY_REACH:
      // the pools stay open to walk in and out, design 6.2); their pyre is
      // checked against its collider below.
      if (k.piece === 'Kit_ThawPyreV2') continue;
      for (const [x, y, z] of worldPoints(k.piece, k)) {
        const floor = authoredFieldHeight(FIELD, x, z);
        if (floor <= VOID + 1) continue;
        if (y > floor + BAND_LOW)
          bad.push(
            `${k.piece} at (${x.toFixed(1)}, ${z.toFixed(1)}) ${(y - floor).toFixed(2)} over`,
          );
        if (bad.length > 20) break;
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the thaw pyres stand in place of the boxed ones, the cairn inside its collider', () => {
    const pyres = placed.filter((p) => p.piece === 'Kit_ThawPyreV2');
    expect(pyres).toHaveLength(THAW_POOLS.length);
    const s = shapes.get('Kit_ThawPyreV2');
    if (!s) throw new Error('no pyre');
    // Above knee height, within the standards' ring: the cairn and its
    // uprights, inside the prop's collider (r 1.6) and a body's skin.
    for (let i = 0; i < s.points.length; i += 3) {
      const r = Math.hypot(s.points[i], s.points[i + 2]);
      if (s.points[i + 1] > BAND_LOW && r < 6) expect(r).toBeLessThan(1.6 + 1.6);
    }
    // The rim stays knee low.
    for (let i = 0; i < s.points.length; i += 3) {
      const r = Math.hypot(s.points[i], s.points[i + 2]);
      if (r > 5.5 && r < 7.3) expect(s.points[i + 1]).toBeLessThan(1.0);
    }
    // Never both: the interior piece where its kit is there, else the old.
    const both = [
      ...pyres,
      { piece: 'Kit_ThawPyre', x: 0, z: 0, rot: 0, scale: 1 },
      { piece: 'Kit_SeracS', x: 0, z: 0, rot: 0, scale: 1 },
    ];
    const withKit = resolveInteriorReplacements(both, () => true).map((p) => p.piece);
    expect(withKit).not.toContain('Kit_ThawPyre');
    expect(withKit).toContain('Kit_ThawPyreV2');
    expect(withKit).toContain('Kit_SeracS');
    const without = resolveInteriorReplacements(both, (p) => p !== 'Kit_ThawPyreV2').map(
      (p) => p.piece,
    );
    expect(without).toEqual(['Kit_ThawPyre', 'Kit_SeracS']);
  });

  it("keeps the first kit's terrace falls only while the interior pedestal is missing", () => {
    const plan = [...planSanctumKitPlacements(), ...placed];
    const falls = (resolved: readonly { piece: string; x: number; z: number }[]) =>
      resolved.filter((p) => p.piece === 'Kit_FrozenFall');
    const onTerrace = (p: { x: number; z: number }) =>
      Math.hypot(p.x - LOCK_TERRACE.x, p.z - LOCK_TERRACE.z) < LOCK_TERRACE.r + 6;
    // The interior kit failed to load: the terrace keeps its two falls.
    const interior = new Set(SANCTUM_INTERIOR_PLAN_PIECES);
    const without = falls(resolveInteriorReplacements(plan, (p) => !interior.has(p)));
    expect(without.filter(onTerrace)).toHaveLength(2);
    // Both kits landed: the pedestal's own falls replace them, the shore's stay.
    const withKit = falls(resolveInteriorReplacements(plan, () => true));
    expect(withKit.filter(onTerrace)).toHaveLength(0);
    expect(withKit).toHaveLength(without.length - 2);
  });

  it('the pedestal clears the Chain Bridge deck by a body', () => {
    const k = placed.find((p) => p.piece === 'Kit_LockSpur');
    if (!k) throw new Error('no spur');
    const span = CHAIN_BRIDGE.toZ - CHAIN_BRIDGE.fromZ;
    for (const [x, y, z] of worldPoints('Kit_LockSpur', k)) {
      if (Math.abs(x - CHAIN_BRIDGE.x) > CHAIN_BRIDGE.halfWidth) continue;
      if (z < CHAIN_BRIDGE.fromZ || z > CHAIN_BRIDGE.toZ) continue;
      const t = (z - CHAIN_BRIDGE.fromZ) / span;
      const deck = CHAIN_BRIDGE.fromH + (CHAIN_BRIDGE.toH - CHAIN_BRIDGE.fromH) * t;
      expect(y, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(deck - 1.5);
    }
  });
});
