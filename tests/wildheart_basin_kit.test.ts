// The Wildheart Basin kit's contracts: the shipped piece list (scripts/assets/
// wildheart_basin_kit/build.mjs) against the pieces the placement plan
// (src/render/wildheart_basin/basin_kit_plan_core.ts) and the gates use, the
// shipped GLB against its sources (fingerprint, nodes, materials, budget),
// every sim prop kind of the layout drawn by a piece, and the dressing audited
// against the REAL floor with the REAL shipped geometry:
//   - nothing stands in a walkway's head room without a sim collider (a
//     knee-high lip, low litter and walk-through foliage or cloth excepted);
//   - nothing floats: a piece stands on the floor, rises from the gorge
//     floor, steps on the tier below it, hangs from a lip, or sits on the
//     cliff it belongs to.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  sourceFingerprint,
  WILDHEART_BASIN_KIT_PIECES,
} from '../scripts/assets/wildheart_basin_kit/build.mjs';
import {
  BASALT_CLIFF_HEIGHT,
  BASIN_COLLIDER_ONLY,
  BASIN_GATE_PIECES,
  type BasinKitPlacement,
  basinPieceForProp,
  insideCaldera,
  PYRAMID_TIER_HEIGHT,
  planBasinKitPlacements,
  planBasinPropPlacements,
  planCalderaRing,
  planGorgeJungle,
  planJaguarHead,
  planPyramidCladding,
  pyramidSolidHeight,
  RIVER_CLEAR_HALF_WIDTH,
  riverDistance,
} from '../src/render/wildheart_basin/basin_kit_plan_core';
import {
  JAGUAR_HEAD,
  JAGUAR_MAW,
  RIM_FALLS,
  WEEPING_FALLS,
  WILDHEART_BASIN_FIELD,
  WILDHEART_BASIN_VOID_HEIGHT,
} from '../src/sim/content/wildheart_basin_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  CLIFF_HALF_DEPTH,
  type FieldProp,
} from '../src/sim/instances/authored_field';

const KIT = ASSET.target;
const FIELD = WILDHEART_BASIN_FIELD;
const VOID = WILDHEART_BASIN_VOID_HEIGHT;
const floor = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);
const walkable = (x: number, z: number): boolean => floor(x, z) > VOID + 1;

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  /** Every vertex, glTF frame (x, y up, z front). */
  points: V3[];
  /** Vertex index triples (the jaguar head's surface is ray-cast). */
  triangles: number[];
}

const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];
const haveKit = existsSync(KIT);

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
    const triangles: number[] = [];
    const m = node.getWorldMatrix();
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION');
        if (!a) continue;
        const base = points.length;
        const idx = prim.getIndices()?.getArray();
        if (idx) for (let i = 0; i < idx.length; i++) triangles.push(base + idx[i]);
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
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, triangles });
  }
});

/** A local (glTF frame) point to instance-local world, as the painter does. */
function placer(p: BasinKitPlacement): (lx: number, ly: number, lz: number) => V3 {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const y0 = p.y ?? floor(p.x, p.z) + (p.lift ?? 0);
  const sx = p.scale * (p.stretch ?? 1);
  return (lx, ly, lz) => {
    const x = lx * sx;
    const y = ly * p.scale + (p.shear ?? 0) * x;
    const z = lz * p.scale;
    return [p.x + x * c + z * s, y0 + y, p.z - x * s + z * c];
  };
}

function worldBox(p: BasinKitPlacement, shape: Shape): { min: V3; max: V3 } {
  const at = placer(p);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const lx of [shape.min[0], shape.max[0]])
    for (const ly of [shape.min[1], shape.max[1]])
      for (const lz of [shape.min[2], shape.max[2]]) {
        const w = at(lx, ly, lz);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], w[k]);
          max[k] = Math.max(max[k], w[k]);
        }
      }
  return { min, max };
}

const CLIFFS = authoredFieldCliffRuns(FIELD);

/** Inside a generated cliff wall's collider (the lip dressing clads it)? */
function inCliff(x: number, z: number): boolean {
  for (const r of CLIFFS) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = ((x - r.ax) * dx + (z - r.az) * dz) / l2;
    if (t < -0.05 || t > 1.05) continue;
    if (Math.hypot(x - (r.ax + dx * t), z - (r.az + dz * t)) <= CLIFF_HALF_DEPTH + 0.05)
      return true;
  }
  return false;
}

/** Inside a sim prop's collider footprint (grown by `margin`)? */
function inCollider(props: readonly FieldProp[], x: number, z: number, margin: number): boolean {
  for (const p of props) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (p.r !== undefined && p.r > 0) {
      if (Math.hypot(dx, dz) <= p.r + margin) return true;
    } else if (p.hw !== undefined && p.hd !== undefined) {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) <= p.hw + margin && Math.abs(lz) <= p.hd + margin) return true;
    }
  }
  return false;
}

describe('Wildheart Basin kit: the piece list and the shipped GLB', () => {
  it('ships exactly the pieces the plan and the gates use', () => {
    const shipped = new Set(WILDHEART_BASIN_KIT_PIECES.map((p) => `Kit_${p}`));
    const used = new Set(planBasinKitPlacements().map((p) => p.piece));
    for (const piece of BASIN_GATE_PIECES) used.add(piece);
    expect([...used].sort()).toEqual([...shipped].sort());
    // The render agent's contract pieces exist.
    for (const piece of ['Kit_JaguarHead', 'Kit_JaguarEyes', 'Kit_VineBridge', 'Kit_ThornWall'])
      expect(shipped.has(piece), piece).toBe(true);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...WILDHEART_BASIN_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps the gate pieces to their contract sizes', () => {
    const bridge = shapes.get('Kit_VineBridge') as Shape;
    // A 4 yd deck segment along X, 8 wide, its walking surface on the origin.
    expect(bridge.max[0] - bridge.min[0]).toBeGreaterThan(3.9);
    expect(bridge.max[0] - bridge.min[0]).toBeLessThan(4.6);
    expect(bridge.max[2] - bridge.min[2]).toBeGreaterThan(8);
    const deckTop = bridge.points
      .filter((p) => Math.abs(p[2]) < 3.5 && Math.abs(p[0]) < 1.8 && p[1] < 0.3)
      .reduce((m, p) => Math.max(m, p[1]), -Infinity);
    expect(Math.abs(deckTop)).toBeLessThan(0.15);
    const thorns = shapes.get('Kit_ThornWall') as Shape;
    expect(thorns.max[1]).toBeGreaterThan(4);
    expect(thorns.max[1]).toBeLessThan(5.5);
    expect(thorns.max[0] - thorns.min[0]).toBeLessThan(5.2);
    // The eyes sit inside the head's sockets (same transform).
    const head = shapes.get('Kit_JaguarHead') as Shape;
    const eyes = shapes.get('Kit_JaguarEyes') as Shape;
    for (let k = 0; k < 3; k++) {
      expect(eyes.min[k]).toBeGreaterThan(head.min[k]);
      expect(eyes.max[k]).toBeLessThan(head.max[k]);
    }
  });
});

describe('Wildheart Basin kit: the layout props', () => {
  it('draws every wb_ prop kind with a piece, or names it collider-only', () => {
    const kinds = new Set(FIELD.props.map((p) => p.kind));
    expect(kinds.size).toBeGreaterThan(10);
    for (const kind of kinds) {
      expect(kind.startsWith('wb_'), kind).toBe(true);
      const sample = FIELD.props.find((p) => p.kind === kind) as FieldProp;
      const piece = basinPieceForProp(sample);
      expect(piece !== '' || BASIN_COLLIDER_ONLY.has(kind), kind).toBe(true);
    }
    expect(basinPieceForProp({ kind: 'wb_not_a_kind', x: 0, z: 0, rot: 0 })).toBe('');
  });

  it('stands the pool rims in the plunge pool and any other off-floor prop on the gorge floor', () => {
    for (const p of planBasinPropPlacements()) {
      if (p.piece === 'Kit_IdolMaw' || walkable(p.x, p.z)) {
        if (p.piece !== 'Kit_IdolMaw') expect(p.y).toBeUndefined();
        continue;
      }
      expect(p.y, `${p.piece} at ${p.x}, ${p.z}`).toBe(
        p.piece === 'Kit_PoolRim' ? WEEPING_FALLS.poolY - 0.6 : VOID,
      );
    }
  });
});

describe('Wildheart Basin kit: the dressing outside the field', () => {
  it('rings the caldera with walls that come nowhere near a walkway', () => {
    const ring = planCalderaRing().filter((p) => p.piece === 'Kit_BasaltCliff');
    expect(ring.length).toBeGreaterThan(40);
    for (const p of ring) {
      // The module's footprint (32 wide, 4 in front of its face, 27 behind).
      const at = placer(p);
      for (const lx of [-16, -8, 0, 8, 16])
        for (const lz of [4.5, 0, -10, -26]) {
          const [x, , z] = at(lx, 0, lz);
          expect(walkable(x, z), `cliff at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`).toBe(false);
        }
      // Its foot is sunk in the gorge floor.
      expect(p.y as number).toBeLessThanOrEqual(VOID);
    }
    // A notch under every fall: a lip the water leaves from at its top.
    for (const f of RIM_FALLS) {
      const lip = planCalderaRing().find(
        (p) => p.piece === 'Kit_WaterfallLip' && Math.hypot(p.x - f.x, p.z - f.z) < 0.01,
      );
      expect(lip?.y, f.id).toBe(f.topY);
      // No full-height wall stands in the curtain's way.
      for (const p of ring) {
        const top = (p.y as number) + BASALT_CLIFF_HEIGHT * p.scale;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (top > f.topY + 1) expect(d, f.id).toBeGreaterThan(f.width / 2 + 14);
      }
    }
  });

  it('leaves the river open and keeps the gorge jungle under every walkway', () => {
    const gorge = planGorgeJungle();
    expect(gorge.filter((p) => p.piece === 'Kit_CanopyClump').length).toBeGreaterThan(100);
    for (const p of gorge) {
      if (p.piece === 'Kit_CanopyClump')
        expect(riverDistance(p.x, p.z)).toBeGreaterThan(RIVER_CLEAR_HALF_WIDTH + 3);
      expect(insideCaldera(p.x, p.z), `${p.piece} at ${p.x}, ${p.z}`).toBe(true);
      expect(walkable(p.x, p.z), `${p.piece} at ${p.x}, ${p.z}`).toBe(false);
    }
  });

  it('steps the pyramid down to the gorge, every tier on the one below', () => {
    const tiers = planPyramidCladding().filter((p) => p.piece === 'Kit_PyramidTier');
    expect(tiers.length).toBeGreaterThan(60);
    for (const p of tiers) {
      const base = p.y as number;
      if (base <= VOID + 0.5) continue;
      // The ring below reaches under this tier's outer face.
      const ox = p.x + Math.sin(p.rot) * 1.5;
      const oz = p.z + Math.cos(p.rot) * 1.5;
      const carried = pyramidSolidHeight(ox, oz) >= base - 0.1 || floor(ox, oz) >= base - 0.3;
      expect(carried, `tier at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}, base ${base}`).toBe(true);
      expect(base + PYRAMID_TIER_HEIGHT).toBeGreaterThan(VOID);
    }
  });

  it('carves the jaguar head into the north rim, outside the field', () => {
    const head = planBasinKitPlacements().filter(
      (p) => p.piece === 'Kit_JaguarHead' || p.piece === 'Kit_JaguarEyes',
    );
    expect(head).toHaveLength(2);
    for (const p of head) {
      expect(p.x).toBe(JAGUAR_HEAD.x);
      expect(p.z).toBe(JAGUAR_HEAD.z);
      expect(p.y).toBe(JAGUAR_HEAD.y);
      expect(walkable(p.x, p.z)).toBe(false);
    }
    expect(head[0].rot).toBe(head[1].rot);
  });

  it.skipIf(!haveKit)('lays the maw walkway on the carved jaw (feet on the stone)', () => {
    // The exit portal's walkway into the jaguar's mouth (JAGUAR_MAW): over
    // every stretch of it inside the jaws the head's own jaw stone lies within
    // a knee of the walked floor (never a gap a player floats over), and the
    // head-room audit below keeps the stone from rising through the feet.
    const p = planJaguarHead()[0];
    const at = placer(p);
    const shape = shapes.get('Kit_JaguarHead') as Shape;
    const w = shape.points.map((v) => at(v[0], v[1], v[2]));
    const t = shape.triangles;
    expect(t.length).toBeGreaterThan(3000);
    /** The highest stone straight under (x, z), below `cap` (a downward ray). */
    const stoneUnder = (x: number, z: number, cap: number): number => {
      let top = -Infinity;
      for (let i = 0; i < t.length; i += 3) {
        const a = w[t[i]];
        const b = w[t[i + 1]];
        const c = w[t[i + 2]];
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
        if (y < cap && y > top) top = y;
      }
      return top;
    };
    const floats: string[] = [];
    for (let z = 236.5; z <= (JAGUAR_MAW.floor.at(-1)?.[0] ?? 0) - 0.25; z += 0.5) {
      for (let x = -3; x <= 3; x += 1) {
        const g = floor(x, z);
        expect(walkable(x, z), `walkway at ${x},${z}`).toBe(true);
        const top = stoneUnder(x, z, g + 1.6);
        if (!(g - top <= 1.6)) floats.push(`${x},${z}: ${(g - top).toFixed(2)} over the jaw`);
      }
    }
    expect(floats, floats.slice(0, 20).join('\n')).toEqual([]);
  });
});

/** Pieces allowed in a walkway's head room without a collider, and why. */
const HEAD_ROOM_ALLOWANCE: Readonly<Record<string, number>> = {
  // Walk-through foliage and cloth (fronds, a hanging banner).
  Kit_GiantFern: Infinity,
  Kit_Palm: Infinity,
  Kit_SunboneBanner: Infinity,
  // A rail on the lip, inside the cliff collider's reach (the Temple's
  // balustrade precedent).
  Kit_BoneEdge: 2.2,
};
/** Knee-high litter (roots, fern tufts, coping, stones) is fine anywhere. */
const KNEE = 1.6;
/** A player's head room above the floor. */
const HEAD = 4.5;
/** Collider margin per piece (trees: buttress fins taper low near the trunk). */
const COLLIDER_MARGIN: Readonly<Record<string, number>> = {
  Kit_JungleTree: 1.3,
};

describe('Wildheart Basin kit: nothing stands in a walkway without a collider', () => {
  it.skipIf(!haveKit)('keeps every vertex out of the head room over every floor', () => {
    const failures: string[] = [];
    const props = FIELD.props;
    for (const p of planBasinKitPlacements()) {
      const shape = shapes.get(p.piece);
      if (!shape) continue;
      const allow = HEAD_ROOM_ALLOWANCE[p.piece] ?? KNEE;
      if (allow === Infinity) continue;
      const box = worldBox(p, shape);
      // Skip pieces whose box meets no floor's head room (a coarse sweep).
      let meets = false;
      for (let x = box.min[0]; x <= box.max[0] + 1e-6 && !meets; x += 1.5)
        for (let z = box.min[2]; z <= box.max[2] + 1e-6 && !meets; z += 1.5) {
          const g = floor(x, z);
          if (g > VOID + 1 && box.max[1] > g + allow && box.min[1] < g + HEAD) meets = true;
        }
      if (!meets) continue;
      const at = placer(p);
      const margin = COLLIDER_MARGIN[p.piece] ?? 0.5;
      for (const v of shape.points) {
        const w = at(v[0], v[1], v[2]);
        const g = floor(w[0], w[2]);
        if (g <= VOID + 1) continue;
        const d = w[1] - g;
        if (d <= allow || d >= HEAD) continue;
        if (inCollider(props, w[0], w[2], margin) || inCliff(w[0], w[2])) continue;
        failures.push(
          `${p.piece} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}): a vertex ${d.toFixed(2)} over the floor at (${w[0].toFixed(1)}, ${w[2].toFixed(1)})`,
        );
        break;
      }
    }
    expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
  });

  it.skipIf(!haveKit)('floats nothing: every piece stands, steps, sits or hangs', () => {
    const failures: string[] = [];
    const all = planBasinKitPlacements();
    const cliffs = all.filter((p) => p.piece === 'Kit_BasaltCliff');
    for (const p of all) {
      const shape = shapes.get(p.piece);
      if (!shape) continue;
      const box = worldBox(p, shape);
      const tag = `${p.piece} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
      if (p.piece === 'Kit_HangingVines') {
        // Its top tucks under the lip it hangs from.
        const back = floor(p.x - Math.sin(p.rot) * 1.4, p.z - Math.cos(p.rot) * 1.4);
        if (!(back > VOID + 1 && box.max[1] <= back + 0.6 && box.max[1] >= back - 1.6))
          failures.push(`${tag}: hangs from nothing`);
        continue;
      }
      if (p.piece === 'Kit_WaterfallLip') {
        const on = cliffs.some(
          (c) =>
            Math.hypot(c.x - p.x, c.z - p.z) < 4 &&
            (c.y as number) + BASALT_CLIFF_HEIGHT * c.scale >= (p.y as number) - 1.5,
        );
        if (!on) failures.push(`${tag}: no cliff under the lip`);
        continue;
      }
      // Tiers are audited ring by ring above; the eyes sit in the head's sockets.
      if (p.piece === 'Kit_PyramidTier' || p.piece === 'Kit_PyramidCorner') continue;
      if (p.piece === 'Kit_JaguarEyes') continue;
      const support = Math.max(floor(p.x, p.z), VOID);
      if (box.min[1] > support + 0.3)
        failures.push(`${tag}: base ${box.min[1].toFixed(2)} over ${support}`);
    }
    expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
  });
});
