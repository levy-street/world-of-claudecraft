// Breaking a prefab building into its pieces must not change what the player
// bumps into. SPACEY, 2026-09-09: "make sure the collision remains, right now it
// switches to basic collision". Before this, every piece fell back to a solid
// box round its own mesh: the bank's 31 authored boxes (doorways left open) and
// 7 walkable ramps became 233 lumps.
//
// The proof here is a world-space one, taken through the SAME math colliders.ts
// and placement_ramps.ts use: map the building's authored shapes to world,
// map every exploded placement's shapes to world, and require the two sets to
// be equal. That catches a wrong frame, a dropped box and a silent cap.
import { describe, expect, it } from 'vitest';
import {
  applyCollisionShare,
  type PrefabAuthoredCollision,
  splitPrefabCollision,
} from '../src/editor/prefab_collision_core';
import { PREFAB_PIECES } from '../src/editor/prefab_pieces.generated';
import { explodePrefab, type PrefabPiecesDef } from '../src/editor/prefab_pieces_core';
import { collisionOverrideFor } from '../src/sim/asset_collision';
import { MAX_PLACEMENT_HITBOXES, MAX_PLACEMENT_RAMPS } from '../src/sim/map_doc';

const DEFS = (
  Array.isArray(PREFAB_PIECES) ? PREFAB_PIECES : Object.values(PREFAB_PIECES)
) as PrefabPiecesDef[];
const GROUND = 20;
const groundAt = (): number => GROUND;

function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

interface Placementish {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  y?: number;
  scaleY?: number;
  scaleZ?: number;
  detached?: boolean;
  groundY?: number;
}

/** colliders.ts emitPlacementBoxes, in world yards. */
function worldBox(
  p: Placementish,
  b: { x: number; y: number; z: number; hx: number; hy: number; hz: number; ry?: number },
) {
  const s = p.scale;
  const sx = s;
  const sy = s * (p.scaleY ?? 1);
  const sz = s * (p.scaleZ ?? 1);
  const base = (p.detached ? (p.groundY ?? 0) : GROUND) + (p.y ?? 0);
  const off = rotY(b.x * sx, b.z * sz, p.rotY);
  return {
    x: p.x + off.x,
    z: p.z + off.z,
    lo: base + (b.y - b.hy) * sy,
    hi: base + (b.y + b.hy) * sy,
    hw: b.hx * sx,
    hd: b.hz * sz,
    rot: p.rotY + (b.ry ?? 0),
  };
}

/** placement_ramps.ts, in world yards. */
function worldRamp(
  p: Placementish,
  r: { x: number; z: number; hx: number; hz: number; y0: number; y1: number; ry?: number },
) {
  const s = p.scale;
  const base = (p.detached ? (p.groundY ?? 0) : GROUND) + (p.y ?? 0);
  // placement_ramps maps world -> local by dividing z by sz, so local -> world
  // multiplies it back: a piece with its own scaleZ moves its deck with it.
  const off = rotY(r.x * s, r.z * (s * (p.scaleZ ?? 1)), p.rotY);
  return {
    x: p.x + off.x,
    z: p.z + off.z,
    hx: r.hx * s,
    hz: r.hz * (s * (p.scaleZ ?? 1)),
    y0: base + r.y0 * (s * (p.scaleY ?? 1)),
    y1: base + r.y1 * (s * (p.scaleY ?? 1)),
    rot: p.rotY + (r.ry ?? 0),
  };
}

const key = (o: Record<string, number>): string =>
  Object.keys(o)
    .sort()
    .map((k) => `${k}:${o[k].toFixed(3)}`)
    .join(' ');

/** Exact-up-to-float-noise world-space shape equality. The split re-expresses
 *  each shape in a piece frame and back, which is exact math but not exact
 *  floats (about 1e-14 yd of drift), so comparing toFixed(3) strings flips
 *  whenever a coordinate sits on a rounding boundary (35.3625 vs 35.36250..1).
 *  Every wanted shape must match a distinct produced shape on EVERY field to
 *  within EPS, which is far tighter than the old 3-decimal quantization. */
const EPS = 1e-9;
function expectSameShapes(
  got: Record<string, number>[],
  want: Record<string, number>[],
  label: string,
): void {
  expect(got.length, `${label}: shape count`).toBe(want.length);
  const used = new Set<number>();
  for (const w of want) {
    const i = got.findIndex(
      (g, gi) =>
        !used.has(gi) &&
        Object.keys(w).length === Object.keys(g).length &&
        Object.keys(w).every((k) => Math.abs(w[k] - g[k]) <= EPS),
    );
    expect(i, `${label}: nothing produced for ${key(w)}`).toBeGreaterThanOrEqual(0);
    used.add(i);
  }
}

function authoredOf(assetId: string): PrefabAuthoredCollision | null {
  const o = collisionOverrideFor(assetId);
  if (!o || o.mode !== 'baked' || !o.boxes || o.boxes.length === 0) return null;
  return { boxes: o.boxes, ramps: o.ramps ?? [] };
}

describe('exploding a prefab keeps the building’s collision', () => {
  const building = (
    assetId: string,
  ): Placementish & { assetId: string; collide: boolean; collisionMode: string } => ({
    assetId,
    x: -74.3,
    z: 393.9,
    rotY: 0.62,
    scale: 12.29,
    collide: true,
    collisionMode: 'baked',
  });

  for (const def of DEFS) {
    it(`${def.assetId}: same boxes and ramps in world space`, () => {
      const authored = authoredOf(def.assetId);
      expect(authored, `${def.assetId} has no authored collision`).toBeTruthy();
      if (!authored) return;
      const b = building(def.assetId);
      const pieces = explodePrefab(b as never, def, { groundAt });
      const split = splitPrefabCollision(authored, def);
      let k = 0;
      if (def.shell) applyCollisionShare(pieces[k++] as never, split.shell);
      for (let i = 0; i < def.pieces.length; i++) {
        applyCollisionShare(pieces[k + i] as never, split.pieces[i]);
      }

      const want = authored.boxes.map((x) => worldBox(b, x));
      const got = pieces.flatMap((p) =>
        (p.hitboxes ?? []).map((x) => worldBox(p as Placementish, x)),
      );
      expectSameShapes(got, want, `${def.assetId} boxes`);

      const wantR = authored.ramps.map((r) => worldRamp(b, r));
      const gotR = pieces.flatMap((p) =>
        (p.ramps ?? []).map((r) => worldRamp(p as Placementish, r)),
      );
      expectSameShapes(gotR, wantR, `${def.assetId} ramps`);
    });
  }

  it('never leaves a piece on its own bounding box, and honours the per-placement caps', () => {
    for (const def of DEFS) {
      const authored = authoredOf(def.assetId);
      if (!authored) continue;
      const b = building(def.assetId);
      const pieces = explodePrefab(b as never, def, { groundAt });
      const split = splitPrefabCollision(authored, def);
      let k = 0;
      if (def.shell) applyCollisionShare(pieces[k++] as never, split.shell);
      for (let i = 0; i < def.pieces.length; i++) {
        applyCollisionShare(pieces[k + i] as never, split.pieces[i]);
      }
      for (const p of pieces) {
        // An undefined mode falls back to the piece's solid bounding box: the
        // exact regression this module exists to stop.
        expect(p.collisionMode, `${def.assetId} piece ${p.assetId}`).toBeDefined();
        expect((p.hitboxes ?? []).length).toBeLessThanOrEqual(MAX_PLACEMENT_HITBOXES);
        expect((p.ramps ?? []).length).toBeLessThanOrEqual(MAX_PLACEMENT_RAMPS);
        // A deck only counts on a placement that collides at all.
        if ((p.ramps ?? []).length > 0) {
          expect(
            (p.hitboxes ?? []).length,
            `${def.assetId} ramp carrier has no box`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('leaves the bank’s doorway open, as the whole building did', () => {
    const def = DEFS.find((d) => d.assetId === 'tidehold/bank');
    expect(def).toBeTruthy();
    if (!def) return;
    const authored = authoredOf(def.assetId);
    if (!authored) return;
    const b = building(def.assetId);
    const pieces = explodePrefab(b as never, def, { groundAt });
    const split = splitPrefabCollision(authored, def);
    let k = 0;
    if (def.shell) applyCollisionShare(pieces[k++] as never, split.shell);
    for (let i = 0; i < def.pieces.length; i++) {
      applyCollisionShare(pieces[k + i] as never, split.pieces[i]);
    }
    const inside = (
      list: { x: number; z: number; lo: number; hi: number; hw: number; hd: number; rot: number }[],
      x: number,
      y: number,
      z: number,
    ): boolean =>
      list.some((o) => {
        if (y < o.lo || y > o.hi) return false;
        const l = rotY(x - o.x, z - o.z, -o.rot);
        return Math.abs(l.x) <= o.hw && Math.abs(l.z) <= o.hd;
      });
    const before = authored.boxes.map((x) => worldBox(b, x));
    const after = pieces.flatMap((p) =>
      (p.hitboxes ?? []).map((x) => worldBox(p as Placementish, x)),
    );
    // Sample the whole ground storey: wherever the building let a body stand,
    // the exploded pieces must too (and nowhere new is blocked).
    let checked = 0;
    for (let dx = -14; dx <= 14; dx += 1) {
      for (let dz = -14; dz <= 14; dz += 1) {
        const wx = b.x + dx;
        const wz = b.z + dz;
        for (const y of [GROUND + 1, GROUND + 4]) {
          expect(inside(after, wx, y, wz), `differs at ${dx},${dz},${y}`).toBe(
            inside(before, wx, y, wz),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
