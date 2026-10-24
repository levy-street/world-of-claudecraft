// The Mirefen muster camps' collision: the structure pieces of the camp plan, as sim
// colliders, so a player bumps into the palisade they see instead of walking through it.
//
// Off the SAME plan the art draws (muster_camp_plan.ts), so a wall can never stand
// somewhere its collider does not. Built once per seed into the static collider grid by
// colliders.ts (built-in world only, like the art). What collides, and what never does:
//   - STRUCTURE only. Clutter (crates, barrels, sacks, the cart wheel, the extra torches)
//     is shed on the low graphics preset, and a solid a low-preset player cannot see is a
//     graphics setting changing gameplay, so clutter is walk-through on every preset.
//   - Each piece collides as the solid part of its GLB, measured off the shipped model at
//     knee-to-head height, not its dressing box: a wall is its row of stakes (the back
//     braces and front footings are walk-round dressing), a gate is its two wings with
//     the opening between them clear, a watchtower is its four legs (you can walk under
//     the platform), a tent is its canvas, the rack and the lanterns their posts.
//   - The designed openings stay open because the plan already leaves them open (a
//     picket's approach and exit gaps, the command camp's gate); nothing here adds a
//     piece. tests/muster_camp_colliders.test.ts walks them: every opening passable,
//     every soldier post clear, the rack reachable from outside the command camp's gate,
//     and no pocket of open ground inside any camp that the outside cannot reach.
//   - That last one is not left to luck. Tents stand a yard off the palisade, walls meet
//     at jittered radii, trunks stand where they grew, and between them sit slivers of
//     ground a body fits in but cannot walk to: harmless until a slam throws someone into
//     one. So once the whole grid exists, every camp is flood-filled from outside and
//     each unreachable spot is sealed (`musterPocketSeals`, called by colliders.ts after
//     the grid is published, the streetlamp arrangement). A seal is a knee-high bar with
//     no visual top, so it never touches the camera or a line of sight.
// Balgath phases through every one of these (MobTemplate.phasesThroughObstacles); the
// command camp is kept from him by his keep-out circle instead (mob/keep_out.ts).

import type { CircleCollider, Collider, ObbCollider } from './colliders';
import { MUSTER_CAMPS, MUSTER_EFFIGY_POST, type MusterCampDef } from './content/mirefen_muster';
import type { MusterKitKey, MusterPlacement } from './muster_camp_layout';
import { musterCampPlan } from './muster_camp_plan';
import { groundHeight } from './world';

/** A box in the piece's own frame (local x along its width, local z out its +Z front). */
interface LocalBox {
  kind: 'box';
  u: number;
  v: number;
  hw: number;
  hd: number;
}
/** A post in the piece's own frame. */
interface LocalPost {
  kind: 'post';
  u: number;
  v: number;
  r: number;
}

interface PieceCollision {
  parts: readonly (LocalBox | LocalPost)[];
  /** Visual top above the piece's ground (camera and sight checks). */
  height: number;
}

const box = (u: number, v: number, hw: number, hd: number): LocalBox => ({
  kind: 'box',
  u,
  v,
  hw,
  hd,
});
const post = (u: number, v: number, r: number): LocalPost => ({ kind: 'post', u, v, r });

/**
 * The solid parts of every structure piece, measured from the shipped GLBs (decoded
 * positions between 0.2 and 1.8 yd up, at half-yard resolution). Clutter keys are absent
 * on purpose (see the header).
 */
export const MUSTER_PIECE_COLLISION: Readonly<Partial<Record<MusterKitKey, PieceCollision>>> =
  Object.freeze({
    // The stake row sits 0.45 yd forward of the model origin; 0.8 deep closes the seam
    // between two neighbouring sections set at slightly different radii.
    musterPalisade: { parts: [box(0, 0.3, 3.15, 0.8)], height: 4.5 },
    musterBarricade: { parts: [box(0, -0.25, 3.1, 0.85)], height: 3.9 },
    // Two wings, 1.95 yd either side of the centre line: the 3.9-yard gap is the way in.
    musterGate: { parts: [box(-3.65, 0.45, 1.7, 0.6), box(3.65, 0.45, 1.7, 0.6)], height: 5.9 },
    // Front legs at +1.42, back legs at -1.95 (the ladder side is the front).
    musterWatchtower: {
      parts: [
        post(-1.68, 1.42, 0.5),
        post(1.68, 1.42, 0.5),
        post(-1.68, -1.95, 0.5),
        post(1.68, -1.95, 0.5),
      ],
      height: 10,
    },
    // A tent's canvas, run on back through the narrow gap behind it to the wall line: a
    // tent stands with its back a yard or so off the palisade, and that sliver (too
    // narrow to walk, wide enough to be thrown into by a slam) would be a pocket nobody
    // could walk back out of. Sealed, it is simply part of the tent.
    musterTentLarge: { parts: [box(0, -1.0, 1.9, 3.0)], height: 3.5 },
    musterTentSmall: { parts: [box(0, -1.0, 1.35, 2.45)], height: 2.6 },
    musterWeaponRack: { parts: [box(0, 0, 1.7, 0.6)], height: 3.0 },
    musterLanternPost: { parts: [post(0, 0, 0.35)], height: 2.95 },
    // Only ever reached as structure (the command camp's gate torches).
    musterTorch: { parts: [post(0, 0, 0.25)], height: 2.3 },
  });

/** The colliders one placement contributes (none for clutter or a key with no row). */
export function musterPlacementColliders(p: MusterPlacement, seed: number): Collider[] {
  if (p.tierClass !== 'structure') return [];
  const spec = MUSTER_PIECE_COLLISION[p.key];
  if (!spec) return [];
  const cameraTopY = groundHeight(p.x, p.z, seed) + spec.height;
  const cos = Math.cos(p.rot);
  const sin = Math.sin(p.rot);
  const out: Collider[] = [];
  for (const part of spec.parts) {
    // three's rotation.y: local x runs along (cos, -sin), local z along (sin, cos)
    const x = p.x + part.u * cos + part.v * sin;
    const z = p.z - part.u * sin + part.v * cos;
    if (part.kind === 'post') {
      const c: CircleCollider = { type: 'circle', x, z, r: part.r, cameraTopY };
      out.push(c);
    } else {
      const c: ObbCollider = {
        type: 'obb',
        x,
        z,
        hw: part.hw,
        hd: part.hd,
        rot: p.rot,
        cameraTopY,
      };
      out.push(c);
    }
  }
  return out;
}

/** Every muster camp collider for a world seed (colliders.ts, built-in world only). */
export function musterCampColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  for (const p of musterCampPlan(seed)) {
    for (const c of musterPlacementColliders(p, seed)) out.push(c);
  }
  out.push(musterEffigyCollider(seed));
  return out;
}

/** The Straw Foreman's legs and frame (the drill yard's effigy): one post a player stops at,
 *  set a little forward of its footprint centre where the legs stand, so nobody walks
 *  through a six-yard figure to swing at it (and melee reach from its edge still lands). */
export const MUSTER_EFFIGY_COLLIDER_RADIUS = 1.3;

export function musterEffigyCollider(seed: number): CircleCollider {
  const f = MUSTER_EFFIGY_POST.facing;
  const x = MUSTER_EFFIGY_POST.x + Math.sin(f) * 0.45;
  const z = MUSTER_EFFIGY_POST.z + Math.cos(f) * 0.45;
  return {
    type: 'circle',
    x,
    z,
    r: MUSTER_EFFIGY_COLLIDER_RADIUS,
    cameraTopY: groundHeight(x, z, seed) + 6.7,
  };
}

/** How far out from a camp's centre the pocket flood runs (clear of its outermost piece). */
export function musterCampFloodRadius(camp: MusterCampDef): number {
  return camp.onCircuit ? 18 : 23;
}

/** The pocket flood's grid step, yards. */
export const MUSTER_POCKET_CELL = 0.25;

/**
 * Open spots around a camp the outside cannot reach: a flood on a MUSTER_POCKET_CELL grid
 * centred on the camp, seeded from every open cell on its rim, stepping only between open
 * neighbours. `blocked(x, z)` is "can a body stand here" (colliders.ts isBlocked).
 */
export function musterCampPockets(
  camp: MusterCampDef,
  blocked: (x: number, z: number) => boolean,
): { x: number; z: number }[] {
  const radius = musterCampFloodRadius(camp);
  const cell = MUSTER_POCKET_CELL;
  const n = Math.ceil(radius / cell);
  const side = 2 * n + 1;
  const index = (i: number, j: number) => (i + n) * side + (j + n);
  // 0 unknown, 1 open, 2 blocked, 3 reached
  const state = new Uint8Array(side * side);
  const inside = (i: number, j: number) => Math.hypot(i, j) * cell <= radius;
  const open = (i: number, j: number): boolean => {
    const k = index(i, j);
    if (state[k] === 0) {
      state[k] = blocked(camp.center.x + i * cell, camp.center.z + j * cell) ? 2 : 1;
    }
    return state[k] !== 2;
  };
  const queue: number[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (!inside(i, j) || Math.hypot(i, j) * cell <= radius - cell) continue;
      if (open(i, j)) {
        state[index(i, j)] = 3;
        queue.push(i, j);
      }
    }
  }
  while (queue.length > 0) {
    const j = queue.pop() as number;
    const i = queue.pop() as number;
    for (const [a, b] of [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ]) {
      if (!inside(a, b) || !open(a, b) || state[index(a, b)] === 3) continue;
      state[index(a, b)] = 3;
      queue.push(a, b);
    }
  }
  const out: { x: number; z: number }[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (inside(i, j) && open(i, j) && state[index(i, j)] !== 3) {
        out.push({ x: camp.center.x + i * cell, z: camp.center.z + j * cell });
      }
    }
  }
  return out;
}

/** Half-thickness of a seal: with a body's 0.5 it covers the quarter-yard between rows. */
const SEAL_HALF = MUSTER_POCKET_CELL * 0.6;

/**
 * Seal every camp's pockets (see the header). Each run of pocket cells down one grid
 * column becomes ONE thin knee-high bar rather than a post per cell, so a camp's handful of
 * slivers costs the movement solver a few colliders, not hundreds.
 */
export function musterPocketSeals(
  seed: number,
  isBlocked: (seed: number, x: number, z: number) => boolean,
): ObbCollider[] {
  const blocked = (x: number, z: number) => isBlocked(seed, x, z);
  const out: ObbCollider[] = [];
  const seal = (x: number, z0: number, z1: number) => {
    const z = (z0 + z1) / 2;
    out.push({
      type: 'obb',
      x,
      z,
      hw: SEAL_HALF,
      hd: (z1 - z0) / 2 + SEAL_HALF,
      rot: 0,
      cameraTopY: groundHeight(x, z, seed) + 0.1,
    });
  };
  for (const camp of MUSTER_CAMPS) {
    // musterCampPockets walks column by column (x outer, z inner), so a run is a stretch
    // of consecutive cells sharing an x.
    let run: { x: number; z0: number; z1: number } | null = null;
    for (const p of musterCampPockets(camp, blocked)) {
      if (run && p.x === run.x && Math.abs(p.z - run.z1 - MUSTER_POCKET_CELL) < 1e-6) {
        run.z1 = p.z;
        continue;
      }
      if (run) seal(run.x, run.z0, run.z1);
      run = { x: p.x, z0: p.z, z1: p.z };
    }
    if (run) seal(run.x, run.z0, run.z1);
  }
  return out;
}
