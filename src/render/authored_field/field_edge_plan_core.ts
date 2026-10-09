// Pure plan for the dressing along an authored field's cliff edges (a
// balustrade on a temple terrace, a kerb on a causeway): pieces placed on the
// high side just inside the wall collider, each reading the REAL floor under
// its ends so a rail follows a stair with its posts plumb, and shortened or
// split where it would overhang a bend. The field-generic form of the Sunken
// Bastion's edge dressing (sunken_bastion/bastion_plan_core.ts), parameterized
// by the dungeon's piece table. Three-free, DOM-free, deterministic.

import {
  type AuthoredFieldDef,
  authoredFieldCliffRuns,
  authoredFieldHeight,
  type FieldCliffRun,
} from '../../sim/instances/authored_field';

export interface FieldEdgePiece {
  /** The kit piece (Kit_*) this edge draws. */
  piece: string;
  x: number;
  z: number;
  /** Ground height under the piece's centre, on the high side of the lip. */
  y: number;
  /** Yaw so the piece runs along the edge (three.js rotation.y); the piece's
   *  outer face (its local +Z) turns toward the drop. */
  rot: number;
  length: number;
  /** Stretch along local X so the piece's full extent spans exactly `length`. */
  stretch: number;
  /** Rise per yard along local +X (a SHEARED rail follows a stair, posts plumb). */
  shear: number;
}

/** One kind of edge piece: its kit node and extents. */
export interface FieldEdgeKind {
  piece: string;
  /** How far inside the lip it stands (its half depth: flush outer face). */
  inset: number;
  /** Half its length along local X at stretch 1. */
  halfLength: number;
  /** Half its depth across the lip. */
  halfDepth: number;
}

export interface FieldEdgeOptions {
  /** The edge kind a cliff run takes (null: leave it bare). */
  kindFor(run: FieldCliffRun, index: number): FieldEdgeKind | null;
  /** Surfaces whose lip stays bare (hidden bridges are always bare). */
  bare?: ReadonlySet<string>;
  /** Only drops at least this tall are dressed (default 2.5). */
  minDrop?: number;
  /** Target piece length (default 4). */
  segment?: number;
}

const EDGE_PROBE = 0.35;
const EDGE_FIT = 0.2;

/** Rise per yard from the floor at a piece's centre and its two ends. */
export function fieldEdgeShear(y: number, yMinus: number, yPlus: number, half: number): number {
  const okMinus = Math.abs(yMinus - y) <= half * 1.2;
  const okPlus = Math.abs(yPlus - y) <= half * 1.2;
  if (okMinus && okPlus) return (yPlus - yMinus) / (2 * half);
  if (okPlus) return (yPlus - y) / half;
  if (okMinus) return (y - yMinus) / half;
  return 0;
}

function edgePiece(
  field: AuthoredFieldDef,
  run: FieldCliffRun,
  kind: FieldEdgeKind,
  s0: number,
  s1: number,
): FieldEdgePiece {
  const ground = (x: number, z: number): number => authoredFieldHeight(field, x, z);
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const mid = (s0 + s1) / 2;
  const x = run.ax + ux * mid - run.nx * kind.inset;
  const z = run.az + uz * mid - run.nz * kind.inset;
  const rot = Math.atan2(run.nx, run.nz);
  const lx = Math.cos(rot);
  const lz = -Math.sin(rot);
  const length = s1 - s0;
  const px = x - run.nx * EDGE_PROBE;
  const pz = z - run.nz * EDGE_PROBE;
  const y = ground(px, pz);
  const half = Math.max(0.4, length / 2 - 0.3);
  const shear = fieldEdgeShear(
    y,
    ground(px - lx * half, pz - lz * half),
    ground(px + lx * half, pz + lz * half),
    half,
  );
  return {
    piece: kind.piece,
    x,
    z,
    y,
    rot,
    length,
    stretch: length / (2 * kind.halfLength),
    shear: Math.abs(shear) < 1e-9 ? 0 : shear,
  };
}

function edgeMisfit(
  field: AuthoredFieldDef,
  run: FieldCliffRun,
  kind: FieldEdgeKind,
  e: FieldEdgePiece,
  s0: number,
  s1: number,
): number {
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const lx = Math.cos(e.rot);
  const lz = -Math.sin(e.rot);
  let bad = 0;
  const ends: [number, number][] = [
    [s0 + 0.12, 1],
    [(s0 + s1) / 2, 3],
    [s1 - 0.12, 2],
  ];
  for (const [s, bit] of ends) {
    for (const back of [
      Math.max(0.05, kind.inset - kind.halfDepth) + 0.1,
      kind.inset + kind.halfDepth - 0.1,
    ]) {
      const wx = run.ax + ux * s - run.nx * back;
      const wz = run.az + uz * s - run.nz * back;
      const f = authoredFieldHeight(field, wx, wz);
      const along = (wx - e.x) * lx + (wz - e.z) * lz;
      if (f <= field.voidHeight + 1e-6 || Math.abs(f - (e.y + e.shear * along)) > EDGE_FIT)
        bad |= bit;
    }
  }
  return bad;
}

function fit(
  field: AuthoredFieldDef,
  run: FieldCliffRun,
  kind: FieldEdgeKind,
  s0: number,
  s1: number,
  depth: number,
  out: FieldEdgePiece[],
): void {
  let a = s0;
  let b = s1;
  while (b - a >= 1.2) {
    const e = edgePiece(field, run, kind, a, b);
    const bad = edgeMisfit(field, run, kind, e, a, b);
    if (bad === 0) {
      out.push(e);
      return;
    }
    if (bad === 3 || (bad & 1 && bad & 2)) break;
    if (bad & 1) a += 0.25;
    if (bad & 2) b -= 0.25;
  }
  if (depth < 2 && s1 - s0 >= 2.4) {
    const m = (s0 + s1) / 2;
    fit(field, run, kind, s0, m, depth + 1, out);
    fit(field, run, kind, m, s1, depth + 1, out);
  }
}

/** Every edge piece of a field, in cliff-run order. */
export function planFieldEdgePieces(
  field: AuthoredFieldDef,
  opts: FieldEdgeOptions,
): FieldEdgePiece[] {
  const out: FieldEdgePiece[] = [];
  const segment = opts.segment ?? 4;
  const minDrop = opts.minDrop ?? 2.5;
  const hidden = new Set(field.surfaces.filter((s) => s.hidden).map((s) => s.id));
  let index = 0;
  for (const run of authoredFieldCliffRuns(field)) {
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    if (len < 1.5 || hidden.has(run.surface) || opts.bare?.has(run.surface)) continue;
    if (run.high - run.low < minDrop) continue;
    const pieces = Math.max(1, Math.round(len / segment));
    const step = len / pieces;
    for (let i = 0; i < pieces; i++) {
      const kind = opts.kindFor(run, index++);
      if (!kind) continue;
      fit(field, run, kind, step * i, step * (i + 1), 0, out);
    }
  }
  return out;
}
