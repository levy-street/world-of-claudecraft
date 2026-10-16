// The Hollow Crypt's "nothing floats" audit. Every kit placement of the
// necropolis (sim props, the arcade, cliff-edge rails, curtain walls, light
// holders, render-only set dressing) is checked against the REAL shipped
// geometry (public/models/props/hollow_crypt_kit.glb) and the REAL floor
// (the authored field's height function):
//   - every contact patch of a piece's base stands on the floor, or on the top
//     of the piece that carries it (an arch on two capitals), or in the chasm
//     floor under the mist (the bell tower's massif);
//   - a hanging piece's top is fixed inside the piece it hangs from;
//   - every flame burns inside its holder, never in mid-air;
//   - a rail on a ramp follows the incline at both ends.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  KIT_SINK_TOLERANCE,
  KIT_SUPPORT,
  planCryptKitPlacements,
} from '../src/render/hollow_crypt/crypt_kit_plan_core';
import {
  HOLLOW_CRYPT_LIGHTS,
  KIT_FLAME_SOCKETS,
  lightFlamePosition,
  planEdgeDressing,
} from '../src/render/hollow_crypt/crypt_plan_core';
import type { KitPlacement } from '../src/render/hollow_crypt/crypt_set_dressing_core';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

const KIT = 'public/models/props/hollow_crypt_kit.glb';
const floor = (x: number, z: number): number => authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);
const VOID = HOLLOW_CRYPT_FIELD.voidHeight;

type V3 = [number, number, number];
interface Patch {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}
interface PieceShape {
  min: V3;
  max: V3;
  /** Connected blobs of the base (the verts it stands on), local frame. */
  contacts: Patch[];
  /** Verts within 0.35 of the top (what a piece carries on, or hangs by). */
  top: Patch[];
}

/** Grid-cluster points into connected patches (`cell` yard cells). */
function patches(points: V3[], cell: number): Patch[] {
  const cells = new Map<string, V3[]>();
  for (const p of points) {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
    const list = cells.get(k) ?? [];
    list.push(p);
    cells.set(k, list);
  }
  const seen = new Set<string>();
  const out: Patch[] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const patch: Patch = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y: Infinity };
    while (stack.length) {
      const k = stack.pop() as string;
      for (const p of cells.get(k) as V3[]) {
        patch.x0 = Math.min(patch.x0, p[0]);
        patch.x1 = Math.max(patch.x1, p[0]);
        patch.z0 = Math.min(patch.z0, p[2]);
        patch.z1 = Math.max(patch.z1, p[2]);
        patch.y = Math.min(patch.y, p[1]);
      }
      const [cx, cz] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const n = `${cx + dx},${cz + dz}`;
          if (cells.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
    }
    out.push(patch);
  }
  return out;
}

const shapes = new Map<string, PieceShape>();

beforeAll(async () => {
  if (!existsSync(KIT)) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const pts: V3[] = [];
    const visit = (n: typeof node): void => {
      const mesh = n.getMesh();
      if (mesh) {
        const m = n.getWorldMatrix();
        for (const prim of mesh.listPrimitives()) {
          const a = prim.getAttribute('POSITION');
          if (!a) continue;
          const e: number[] = [];
          for (let i = 0; i < a.getCount(); i++) {
            a.getElement(i, e);
            pts.push([
              m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
              m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
              m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
            ]);
          }
        }
      }
      for (const c of n.listChildren()) visit(c);
    };
    visit(node);
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    // The base: everything within 0.3 of the lowest point, or of the origin
    // plane for a piece authored to stand at y = 0 over a sunk footing.
    const base = pts.filter((p) => p[1] <= Math.max(min[1], 0) + 0.3);
    shapes.set(name, {
      min,
      max,
      // Fine cells for the base (each foot on its own); coarse cells for the
      // top, whose verts may be far apart (the rim of a levelled rock cap).
      contacts: patches(base, 0.5),
      top: patches(
        pts.filter((p) => p[1] >= max[1] - 0.35),
        8,
      ),
    });
  }
});

interface Placed {
  p: KitPlacement;
  shape: PieceShape;
  /** Local (glTF frame) point to instance-local world. */
  at: (lx: number, ly: number, lz: number) => V3;
  box: { min: V3; max: V3 };
}

function place(p: KitPlacement, shape: PieceShape): Placed {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const y0 = p.y ?? floor(p.x, p.z) + (p.lift ?? 0);
  const sx = p.scale * (p.stretch ?? 1);
  const at = (lx: number, ly: number, lz: number): V3 => {
    const x = lx * sx;
    const y = ly * p.scale + (p.shear ?? 0) * x;
    const z = lz * p.scale;
    return [p.x + x * c + z * s, y0 + y, p.z - x * s + z * c];
  };
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
  return { p, shape, at, box: { min, max } };
}

/** Sample points of a local patch: centre and corners pulled 0.15 inside. */
function patchSamples(q: Patch): [number, number][] {
  const inset = (a: number, b: number): [number, number] =>
    b - a > 0.3 ? [a + 0.15, b - 0.15] : [(a + b) / 2, (a + b) / 2];
  const [x0, x1] = inset(q.x0, q.x1);
  const [z0, z1] = inset(q.z0, q.z1);
  return [
    [(x0 + x1) / 2, (z0 + z1) / 2],
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ];
}

const TOO_HIGH = 0.2; // a base may hover this much at most
const TOO_DEEP = 0.45; // and sink this much into the floor

describe('Hollow Crypt kit: nothing floats', () => {
  const haveKit = existsSync(KIT);

  it.skipIf(!haveKit)('seats every placed piece on the floor or on what carries it', () => {
    const all = planCryptKitPlacements()
      .filter((p) => shapes.has(p.piece))
      .map((p) => place(p, shapes.get(p.piece) as PieceShape));
    // Pieces other pieces may stand on (anything with body; not grass or rails).
    const carriers = all.filter((q) => q.box.max[1] - q.box.min[1] > 0.8 && !q.p.cosmetic);
    const failures: string[] = [];
    const b = HOLLOW_CRYPT_FIELD.bounds;
    for (const q of all) {
      const rule = KIT_SUPPORT[q.p.piece] ?? 'ground';
      const tag = `${q.p.piece} at (${q.p.x.toFixed(1)}, ${q.p.z.toFixed(1)})`;
      if (rule === 'backdrop') {
        const out = Math.max(b.minX - q.p.x, q.p.x - b.maxX, b.minZ - q.p.z, q.p.z - b.maxZ);
        if (out < 60) failures.push(`${tag}: a backdrop silhouette only ${out.toFixed(0)} yd out`);
        continue;
      }
      if (rule === 'rooted') {
        // A rock column: its foot is down in the chasm floor under the mist.
        if (q.box.min[1] > VOID + 0.5)
          failures.push(`${tag}: its foot hangs at ${q.box.min[1].toFixed(1)} over the chasm`);
        continue;
      }
      if (rule === 'hangs') {
        // At least one fixing of its top is inside the piece that carries it.
        const hung = q.shape.top.some((t) => {
          const w = q.at((t.x0 + t.x1) / 2, t.y, (t.z0 + t.z1) / 2);
          return carriers.some(
            (c) =>
              c !== q &&
              w[0] >= c.box.min[0] - 0.3 &&
              w[0] <= c.box.max[0] + 0.3 &&
              w[2] >= c.box.min[2] - 0.3 &&
              w[2] <= c.box.max[2] + 0.3 &&
              w[1] >= c.box.min[1] &&
              w[1] <= c.box.max[1] + 0.3,
          );
        });
        if (!hung) failures.push(`${tag}: hangs from nothing`);
        continue;
      }
      for (const patch of q.shape.contacts) {
        for (const [lx, lz] of patchSamples(patch)) {
          const w = q.at(lx, patch.y, lz);
          const f = floor(w[0], w[2]);
          const d = w[1] - f;
          if (f <= VOID + 1e-6) {
            // Over the chasm: fine only when the base goes down into the chasm floor.
            if (w[1] <= VOID + 0.5) continue;
          } else if (d <= TOO_HIGH && d >= -TOO_DEEP) {
            continue;
          }
          const carried = carriers.some((c) => {
            if (c === q) return false;
            if (
              w[0] < c.box.min[0] - 0.05 ||
              w[0] > c.box.max[0] + 0.05 ||
              w[2] < c.box.min[2] - 0.05 ||
              w[2] > c.box.max[2] + 0.05
            )
              return false;
            const sink = KIT_SINK_TOLERANCE[c.p.piece] ?? TOO_DEEP;
            // Standing on one of the carrier's top patches.
            return c.shape.top.some((t) => {
              // The top patch's four corners (the carrier may be turned).
              const cs = [
                c.at(t.x0, t.y, t.z0),
                c.at(t.x1, t.y, t.z0),
                c.at(t.x0, t.y, t.z1),
                c.at(t.x1, t.y, t.z1),
              ];
              const xs = cs.map((v) => v[0]);
              const zs = cs.map((v) => v[2]);
              const inX = w[0] >= Math.min(...xs) - 0.2 && w[0] <= Math.max(...xs) + 0.2;
              const inZ = w[2] >= Math.min(...zs) - 0.2 && w[2] <= Math.max(...zs) + 0.2;
              const top = c.box.max[1];
              return inX && inZ && w[1] <= top + TOO_HIGH && w[1] >= top - sink;
            });
          });
          if (!carried) {
            failures.push(
              `${tag}: base at y ${w[1].toFixed(2)} over floor ${f.toFixed(2)} at (${w[0].toFixed(1)}, ${w[2].toFixed(1)})`,
            );
            break;
          }
        }
      }
    }
    expect(failures, failures.slice(0, 60).join('\n')).toEqual([]);
  });

  it('burns every flame inside a holder that is actually placed', () => {
    const placed = planCryptKitPlacements();
    for (const spot of HOLLOW_CRYPT_LIGHTS) {
      if (!spot.holder) {
        expect(spot.kind).toBe('soul');
        continue;
      }
      expect(KIT_FLAME_SOCKETS[spot.holder], spot.holder).toBeDefined();
      // A socket off the holder's axis needs the holder's yaw too.
      const [sx, , sz] = KIT_FLAME_SOCKETS[spot.holder];
      const onAxis = Math.hypot(sx, sz) < 1e-6;
      const holder = placed.find(
        (p) =>
          p.piece === spot.holder &&
          Math.hypot(p.x - spot.x, p.z - spot.z) < 1e-6 &&
          (onAxis || Math.abs(p.rot - spot.rot) < 1e-6),
      );
      expect(holder, `${spot.kind} light at ${spot.x}, ${spot.z}`).toBeDefined();
      const [, y] = lightFlamePosition(spot);
      expect(y).toBeGreaterThan(floor(spot.x, spot.z));
    }
  });

  it('shears every rail on a ramp so both of its ends meet the floor', () => {
    let sloped = 0;
    for (const e of planEdgeDressing()) {
      if (Math.abs(e.shear) < 1e-6) continue;
      sloped++;
      const lx = Math.cos(e.rot);
      const lz = -Math.sin(e.rot);
      let checked = 0;
      for (const side of [-1, 1]) {
        const d = side * Math.max(0.5, e.length / 2 - 0.3);
        const x = e.x + lx * d;
        const z = e.z + lz * d;
        // Read the floor just inside the lip, where the piece's plinth stands.
        const nx = Math.sin(e.rot);
        const nz = Math.cos(e.rot);
        const f = floor(x - nx * 0.35, z - nz * 0.35);
        // An end past a corner reads another surface: its slope came from the other end.
        if (Math.abs(f - e.y) > Math.abs(d) * 1.2) continue;
        checked++;
        expect(Math.abs(e.y + e.shear * d - f), `${e.kind} at ${e.x}, ${e.z}`).toBeLessThan(0.25);
      }
      expect(checked, `${e.kind} at ${e.x}, ${e.z}`).toBeGreaterThan(0);
    }
    // The chapel stair, both causeways, the ramps and the Bone Stair are sloped.
    expect(sloped).toBeGreaterThan(20);
  });
});
