// Pure wall-face segment math for parameterized dungeon layouts (procedural
// rift halls and the classic interiors that share their shape). Derives every
// RENDERED wall face from the same DungeonLayout fields layoutColliders()
// turns into collision OBBs, so the drawn walls and the solid walls can never
// drift apart.
//
// Why this module exists: the renderer used to place the rectangular shell by
// stepping a fixed 8u module grid (leaving up to an 8u visual gap at end-wall
// corners whenever endWallHw is not module-aligned, which a rift's arbitrary
// wallX + 1 almost never is), and drew chamber-waist stubs with HARDCODED
// classic-dungeon coordinates (pier faces spanning |x| 5..23, passage cap at
// |x| = 6). Rift waists are generated with a passage half-width of 7 to 8.5
// and piers reaching a variable wallX, so every rift waist rendered a wall
// panel INSIDE the open passage (a "phantom wall" the player must run
// through to reach the next chamber) plus an invisible collider strip beyond
// |x| 23 that no wall was drawn for. Deriving the faces from each stub's own
// collider fields reproduces the classic interiors (whose stubs are exactly
// hw 9 around |x| 14 with a half-5 passage) and fixes every parameterized
// layout at once. The polygon-shell path already works this way
// (polygonWallSegments); this module extends the idea to the rectangular
// shell and the stub piers.
//
// Render-layer sibling (not sim): only the renderer consumes these placements.
// It imports types from src/sim/dungeon_layout, never three.js, so a Vitest
// can sweep it directly against layoutColliders (tests/rift_wall_render_parity).
import type { DungeonLayout, WallStub } from '../sim/dungeon_layout';

export interface WallFaceSegment {
  x: number;
  z: number;
  /** Euler-Y for the module (the renderer passes it straight to Placements). */
  ry: number;
  /** Half-length of the face span this segment covers, along the run axis. */
  halfLength: number;
}

/** One KayKit wall module at room scale spans 8u (4u model x MODULE_SCALE 2).
 * Runs are split into equal segments no longer than this, then each module is
 * scaled to its exact segment span (the polygonWallSegments approach), so a
 * run always reads as individual wall modules yet covers its collider exactly. */
export const WALL_MODULE_SPAN = 8;

function splitRun(x0: number, z0: number, x1: number, z1: number, ry: number): WallFaceSegment[] {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [];
  const segCount = Math.max(1, Math.ceil(len / WALL_MODULE_SPAN));
  const out: WallFaceSegment[] = [];
  for (let s = 0; s < segCount; s++) {
    const midT = (s + 0.5) / segCount;
    out.push({
      x: x0 + dx * midT,
      z: z0 + dz * midT,
      ry,
      halfLength: len / segCount / 2,
    });
  }
  return out;
}

export interface RectShellSegments {
  /** Keyed by side sign so the renderer can route arena wall placements. */
  left: WallFaceSegment[];
  right: WallFaceSegment[];
  front: WallFaceSegment[];
  back: WallFaceSegment[];
}

/** Wall-face segments for a rectangular shell, spanning EXACTLY the collider
 * runs layoutColliders() builds: side walls at +-wallX over sideWallZ +-
 * sideWallHd, end walls at zMin/zMax over +-endWallHw. Module ry matches the
 * legacy fixed-grid loops (side detail faces the room; ends face inward). */
export function rectShellWallSegments(
  layout: Pick<DungeonLayout, 'wallX' | 'endWallHw' | 'sideWallZ' | 'sideWallHd' | 'zMin' | 'zMax'>,
  defaultWallX: number,
  defaultEndWallHw: number,
): RectShellSegments {
  const wallX = layout.wallX ?? defaultWallX;
  const endWallHw = layout.endWallHw ?? defaultEndWallHw;
  return {
    left: splitRun(
      -wallX,
      layout.sideWallZ - layout.sideWallHd,
      -wallX,
      layout.sideWallZ + layout.sideWallHd,
      Math.PI / 2,
    ),
    right: splitRun(
      wallX,
      layout.sideWallZ - layout.sideWallHd,
      wallX,
      layout.sideWallZ + layout.sideWallHd,
      -Math.PI / 2,
    ),
    front: splitRun(-endWallHw, layout.zMin, endWallHw, layout.zMin, 0),
    back: splitRun(-endWallHw, layout.zMax, endWallHw, layout.zMax, Math.PI),
  };
}

export interface StubFaceSegments {
  /** Both x-end cap slabs (visible surfaces flush with the collider faces).
   * The centre-facing cap matters for waist piers; the outer cap closes the
   * free-standing wall fins (a flush waist pier's outer cap merges invisibly
   * into the side wall mass, still collider-backed). */
  caps: WallFaceSegment[];
  /** Front/back pier faces (toward zMin / toward zMax). */
  faces: WallFaceSegment[];
  /** The pier's centre-side collider face |x|, for arch-fit decisions. */
  innerFaceX: number;
}

/** Wall-face segments wrapping one stub OBB (x, z, hw, hd), derived from the
 * stub's own collider fields the way the Bell Niche delve already renders its
 * piers: each slab centreline sits 1u inside the collider face (the module's
 * half-thickness) so the visible surface lands exactly ON the face and the
 * player stands flush instead of clipping in. Handles both stub kinds the
 * rift generator emits: side-wall-flush waist pairs AND free-standing wall
 * fins, which is why all four faces are covered. */
export function stubFaceSegments(s: WallStub): StubFaceSegments {
  const sign = s.x < 0 ? -1 : 1;
  const innerFaceX = s.x - sign * s.hw;
  const outerFaceX = s.x + sign * s.hw;
  const caps: WallFaceSegment[] = [
    // centreline 1u inside the pier from each x face
    ...splitRun(
      innerFaceX + sign,
      s.z - s.hd,
      innerFaceX + sign,
      s.z + s.hd,
      sign < 0 ? Math.PI / 2 : -Math.PI / 2,
    ),
    ...splitRun(
      outerFaceX - sign,
      s.z - s.hd,
      outerFaceX - sign,
      s.z + s.hd,
      sign < 0 ? -Math.PI / 2 : Math.PI / 2,
    ),
  ];
  const faces: WallFaceSegment[] = [];
  for (const front of [true, false]) {
    const fz = front ? s.z - (s.hd - 1) : s.z + (s.hd - 1);
    faces.push(...splitRun(s.x - s.hw, fz, s.x + s.hw, fz, front ? 0 : Math.PI));
  }
  return { caps, faces, innerFaceX: Math.abs(innerFaceX) };
}
