// The Smith's Heart's final room dressed (phase 2J, docs/design/raid/smith_heart.md
// section 5.17): its Blender kit (scripts/assets/smith_heart_heart_kit/build.mjs,
// built from docs/design/raid/kit/build_smith_heart_heart_kit.py), its plan
// (heart_room_kit_plan_core.ts) and its crown of rock (heart_crown_core.ts):
//   - the shipped GLB is the current sources', inside its budget, no chain
//     (the raid has no metal: the roots of the mountain hold the platform);
//   - the walks are flat where bodies stand: the platform's and the
//     terrace's paving a breath over the walk inside their lips, the bridge's
//     deck on the field's own ramp, nothing standing over a walk but past the
//     lips (the balustrades, the newels, the portal's stones);
//   - each altar's body stays inside its collider (r 3) below 3 yd and stands
//     taller than it (a body hidden behind it reads hidden), its vein's heart
//     in crystal;
//   - the plan stands every piece on the layout's own spots (ids frozen),
//     the roots rise out of each altar's crown over the walk, well over head
//     height, and into the mountain's crown;
//   - the crown's rock paint lives in the Heart alone.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_HEART_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_heart_kit/build.mjs';
import {
  HEART_CROWN,
  heartCrownQuarter,
  heartCrownWeight,
} from '../src/render/smith_heart/heart_crown_core';
import { heartMountainHeight } from '../src/render/smith_heart/heart_mountain_core';
import {
  HEART_ALTAR_PIECES,
  HEART_ALTAR_RISE,
  HEART_KIT_KEELS,
  HEART_KIT_KINDS,
  HEART_KIT_OMIT_TOPS,
  HEART_KIT_SHALLOW,
  HEART_ROOT_LIFT,
  heartAltarFrame,
  heartBridgeYaw,
  heartRootPoint,
  planHeartRoomKit,
  planHeartVeinPieces,
} from '../src/render/smith_heart/heart_room_kit_plan_core';
import {
  HEART_ALTARS,
  HEART_ROOM,
  HEART_TERRACE,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

const KIT = ASSET.target;
const haveKit = existsSync(KIT);

type V3 = [number, number, number];
interface Shape {
  byMaterial: Map<string, V3[]>;
  triangles: number;
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
    const byMaterial = new Map<string, V3[]>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const list = byMaterial.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        list.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
      byMaterial.set(mat, list);
    }
    shapes.set(name, { byMaterial, triangles });
  }
});

const points = (name: string, material?: string): V3[] => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  if (material) return s.byMaterial.get(material) ?? [];
  return [...s.byMaterial.values()].flat();
};

/** The bridge deck's height along the bridge (the field's path). */
const deckHeight = (s: number) => (s <= 12 ? 4 : s >= 27 ? 0 : 4 - ((s - 12) * 4) / 15);

describe('Smith Heart Heart kit: the piece list and the shipped GLB', () => {
  it('lists the room, the altars, the roots, the heart and the colossus, and never a chain', () => {
    const list = SMITH_HEART_HEART_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'AnvilFloor',
      'AnvilKeel',
      'TerraceFloor',
      'TerraceKeel',
      'HeartBridge',
      'AltarHammer',
      'AltarBreath',
      'AltarQuench',
      'AltarHeat',
      'HeartRoot',
      'HeartCrystal',
      'CoreBed',
      'ColTorso',
      'ColHead',
      'ColFist',
      'TornSocket',
      'RubbleScatter',
    ])
      expect(list, piece).toContain(piece);
    for (const p of list) expect(p, p).not.toMatch(/Chain|Bronze|Iron/);
  });

  it.skipIf(!haveKit)(
    'was built from the current sources, nodes and materials intact, in budget',
    () => {
      expect(extras.sourceFingerprint).toBe(sourceFingerprint());
      expect(nodeNames).toEqual(
        [ASSET.root, ...SMITH_HEART_HEART_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
      );
      expect(materialNames).toEqual(ASSET.materials);
      expect(statSync(KIT).size).toBeLessThanOrEqual(5 * 1024 * 1024);
      let tris = 0;
      for (const s of shapes.values()) tris += s.triangles;
      expect(tris).toBeLessThanOrEqual(215000);
    },
  );
});

describe('Smith Heart Heart kit: the walks stay flat where bodies stand', () => {
  it.skipIf(!haveKit)(
    "lays the platform's paving a breath over its walk, everything taller past its lip",
    () => {
      for (const [x, y, z] of points('Kit_AnvilFloor')) {
        const r = Math.hypot(x, z);
        if (r < HEART_ROOM.r - 0.2) {
          expect(y, `r ${r.toFixed(2)}`).toBeLessThanOrEqual(0.1);
          expect(y).toBeGreaterThanOrEqual(-0.45);
        }
        // The fascia and its keel's drum below it, nothing deeper here.
        expect(y).toBeGreaterThanOrEqual(-3.3);
      }
    },
  );

  it.skipIf(!haveKit)("lays the terrace's paving the same, its portal's kerb under a hand", () => {
    for (const [x, y, z] of points('Kit_TerraceFloor')) {
      const r = Math.hypot(x, z);
      if (r < HEART_TERRACE.r - 0.2) expect(y, `r ${r.toFixed(2)}`).toBeLessThanOrEqual(0.32);
    }
  });

  it.skipIf(!haveKit)(
    "runs the bridge's deck down the field's own ramp, its parapets past the walk",
    () => {
      const pts = points('Kit_HeartBridge');
      let onDeck = 0;
      for (const [s, y, zt] of pts) {
        const t = Math.abs(zt);
        const inTerrace = Math.hypot(s, t) < HEART_TERRACE.r;
        const inRoom = Math.hypot(70 - s, t) < HEART_ROOM.r;
        if (t < 6.9 && !inTerrace && !inRoom) {
          // Nothing stands over the deck.
          expect(y, `s ${s.toFixed(2)} t ${t.toFixed(2)}`).toBeLessThanOrEqual(
            deckHeight(s) + 0.06,
          );
          if (y > deckHeight(s) - 0.02) onDeck++;
        }
        // Over the deck's line only the parapets, standing on its lip (a
        // hand into its outer joint at most).
        if (y > deckHeight(s) + 0.12 && !inTerrace && !inRoom)
          expect(t, `s ${s.toFixed(2)} y ${y.toFixed(2)}`).toBeGreaterThanOrEqual(6.85);
      }
      expect(onDeck).toBeGreaterThan(200);
      // The deck's line is the field's.
      const ux = Math.SQRT1_2;
      for (const s of [14, 18, 22, 26]) {
        const fx = HEART_TERRACE.x + ux * s;
        const fz = HEART_TERRACE.z + ux * s;
        expect(authoredFieldHeight(SMITH_HEART_FIELD, fx, fz)).toBeCloseTo(deckHeight(s), 3);
      }
    },
  );
});

describe('Smith Heart Heart kit: the altars', () => {
  it.skipIf(!haveKit)(
    'keeps each body in its collider low, taller than it, its heart in crystal',
    () => {
      for (const vein of SMITH_HEART_VEINS) {
        const piece = HEART_ALTAR_PIECES[vein];
        let top = 0;
        for (const [x, y, z] of points(piece)) {
          top = Math.max(top, y);
          if (y > 0.3 && y < 3 / HEART_ALTAR_RISE)
            expect(Math.hypot(x, z), `${piece} at ${y.toFixed(2)}`).toBeLessThanOrEqual(3.12);
        }
        expect(top * HEART_ALTAR_RISE, piece).toBeGreaterThan(9);
        expect(points(piece, 'KitGlow').length, piece).toBeGreaterThan(20);
      }
      // The Quench's under its mantle of ice.
      expect(points('Kit_AltarQuench', 'KitIce').length).toBeGreaterThan(20);
    },
  );
});

describe('Smith Heart Heart kit: the plan', () => {
  it('stands the static pieces on the layout, the bridge along its line', () => {
    const plan = planHeartRoomKit();
    const at = (piece: string) => plan.find((p) => p.piece === piece);
    expect(at('Kit_AnvilFloor')).toMatchObject({
      x: HEART_ROOM.x,
      y: HEART_ROOM.h,
      z: HEART_ROOM.z,
    });
    expect(at('Kit_TerraceFloor')).toMatchObject({
      x: HEART_TERRACE.x,
      y: HEART_TERRACE.h,
      z: HEART_TERRACE.z,
    });
    const b = at('Kit_HeartBridge');
    expect(b).toBeDefined();
    // Its local +X turns along the line from the terrace to the platform.
    const yaw = heartBridgeYaw();
    const dx = HEART_ROOM.x - HEART_TERRACE.x;
    const dz = HEART_ROOM.z - HEART_TERRACE.z;
    const l = Math.hypot(dx, dz);
    expect(Math.cos(yaw)).toBeCloseTo(dx / l, 6);
    expect(-Math.sin(yaw)).toBeCloseTo(dz / l, 6);
    if (b) expect(b.rot).toBeCloseTo(yaw, 9);
  });

  it("dresses each altar's prop, its front to the platform's centre, its root in the same frame", () => {
    const kinds = new Set(HEART_ALTARS.map((a) => `sh_altar_${a.vein}`));
    expect([...HEART_KIT_KINDS].sort()).toEqual([...kinds].sort());
    for (const p of SMITH_HEART_FIELD.props.filter((q) => kinds.has(q.kind))) {
      const vein = p.kind.replace('sh_altar_', '') as (typeof SMITH_HEART_VEINS)[number];
      const f = heartAltarFrame(vein);
      expect(f.x).toBeCloseTo(p.x, 9);
      expect(f.z).toBeCloseTo(p.z, 9);
      expect(f.rot).toBeCloseTo(p.rot, 9);
      const [altar, root] = planHeartVeinPieces(vein);
      expect(altar.piece).toBe(HEART_ALTAR_PIECES[vein]);
      expect(altar.rise).toBe(HEART_ALTAR_RISE);
      expect(root.piece).toBe('Kit_HeartRoot');
      expect(root.rot).toBeCloseTo(altar.rot, 9);
      expect(root.y).toBeCloseTo(HEART_ROOM.h + HEART_ROOT_LIFT, 9);
    }
  });

  it('raises each root out of its altar over every walk, well over head height, into the crown', () => {
    for (const vein of SMITH_HEART_VEINS) {
      const start = heartRootPoint(vein, 0);
      const f = heartAltarFrame(vein);
      expect(Math.hypot(start.x - f.x, start.z - f.z)).toBeLessThan(3);
      for (let t = 0; t <= 1; t += 0.02) {
        const p = heartRootPoint(vein, t);
        const r = Math.hypot(p.x - HEART_ROOM.x, p.z - HEART_ROOM.z);
        if (r > 39 && r < HEART_ROOM.r + 1) expect(p.y).toBeGreaterThan(8);
      }
      // Its far end lies in the mountain's rock (the crown holds it).
      const end = heartRootPoint(vein, 1);
      expect(heartMountainHeight(end.x, end.z), vein).toBeGreaterThan(end.y - 8);
    }
  });

  it('omits the tops it paves, keeps a shallow keel under the bridge, replaces the lathe keels', () => {
    expect([...HEART_KIT_OMIT_TOPS].sort()).toEqual([
      'heart_anvil',
      'heart_bridge',
      'heart_terrace',
    ]);
    expect(HEART_KIT_SHALLOW).toEqual(['heart_bridge']);
    expect([...HEART_KIT_KEELS].sort()).toEqual(['heart_anvil', 'heart_terrace']);
    for (const id of HEART_KIT_OMIT_TOPS)
      expect(
        SMITH_HEART_FIELD.surfaces.some((s) => s.id === id),
        id,
      ).toBe(true);
  });
});

describe("the Heart's crown of rock", () => {
  it('paints the crown alone: none on the main map, all of it round the chamber', () => {
    expect(heartCrownWeight(0, 0)).toBe(0);
    expect(heartCrownWeight(-236, 0)).toBe(0);
    expect(heartCrownWeight(HEART_ROOM.x, HEART_ROOM.z)).toBe(0);
    const mid = (HEART_CROWN.in1 + HEART_CROWN.out0) / 2;
    for (let a = 0; a < 360; a += 30) {
      const r = (a * Math.PI) / 180;
      expect(
        heartCrownWeight(HEART_ROOM.x + Math.sin(r) * mid, HEART_ROOM.z + Math.cos(r) * mid),
      ).toBe(1);
    }
  });

  it("gives each quarter its altar's vein", () => {
    expect(heartCrownQuarter(0)).toBe('breath');
    expect(heartCrownQuarter(Math.PI / 2)).toBe('quench');
    expect(heartCrownQuarter(Math.PI)).toBe('hammer');
    expect(heartCrownQuarter(-Math.PI / 2)).toBe('heat');
    for (const a of HEART_ALTARS) {
      const b = Math.atan2(a.x - HEART_ROOM.x, a.z - HEART_ROOM.z);
      expect(heartCrownQuarter(b)).toBe(a.vein);
    }
  });
});
