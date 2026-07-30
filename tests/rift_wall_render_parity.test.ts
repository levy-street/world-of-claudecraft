import { describe, expect, it } from 'vitest';
import {
  rectShellWallSegments,
  stubFaceSegments,
  type WallFaceSegment,
} from '../src/render/dungeon_wall_segments';
import type { Collider } from '../src/sim/colliders';
import { polygonWallSegments } from '../src/sim/delve_litany_layout';
import { DUNGEON_END_WALL_HW, DUNGEON_WALL_X, layoutColliders } from '../src/sim/dungeon_layout';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, generateRiftPlan, isSetPieceSeed } from '../src/sim/rift/rift_gen';

// Every rendered wall face must sit ON collision, and every wall collider must
// be visually covered. The renderer used to hardcode the classic-dungeon stub
// geometry (passage cap at |x| 6, pier faces spanning |x| 5..23) while rift
// waists are generated with a passage half-width of 7 to 8.5 and piers out to
// a variable wallX: every rift waist drew a phantom wall panel INSIDE the open
// passage (the "run through a wall to reach the next chamber" playtest bug)
// plus an uncovered invisible collider strip beyond |x| 23. The end walls also
// tiled a fixed 8u grid that left visual corner gaps for any endWallHw not
// module-aligned (a rift's is wallX + 1). This sweep pins the shared-segment
// replacement across seeds, ranks, and floors.

/** The rendered module is 2u thick around its centreline (KayKit 1u half
 * thickness x MODULE_SCALE 2); segment centrelines sit on or 1u inside the
 * collider centreline, so a 1.2u inflation covers every legal offset. */
const FACE_TOLERANCE = 1.2;
const SAMPLE_STEP = 1;

function obbContains(c: Collider, x: number, z: number, tol: number): boolean {
  if (c.type !== 'obb') return false;
  const rot = c.rot ?? 0;
  const dx = x - c.x;
  const dz = z - c.z;
  // colliders.ts rotY convention: local +x maps to world (cos rot, -sin rot).
  const u = dx * Math.cos(rot) - dz * Math.sin(rot);
  const v = dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.abs(u) <= c.hw + tol && Math.abs(v) <= c.hd + tol;
}

/** Sample points along a face segment's centreline, ends inset slightly so a
 * corner sample never falls just past an adjacent run's collider end. */
function segmentSamples(seg: WallFaceSegment): Array<{ x: number; z: number }> {
  // ry aligns the module's local +x with the run axis: world (cos ry, -sin ry).
  const ax = Math.cos(seg.ry);
  const az = -Math.sin(seg.ry);
  const half = Math.max(0, seg.halfLength - 0.15);
  const out: Array<{ x: number; z: number }> = [];
  const count = Math.max(2, Math.ceil((half * 2) / SAMPLE_STEP) + 1);
  for (let i = 0; i < count; i++) {
    const t = -half + (i * (half * 2)) / (count - 1);
    out.push({ x: seg.x + ax * t, z: seg.z + az * t });
  }
  return out;
}

function coveredBySegments(
  segments: readonly WallFaceSegment[],
  x: number,
  z: number,
  tol: number,
): boolean {
  return segments.some((seg) => {
    const ax = Math.cos(seg.ry);
    const az = -Math.sin(seg.ry);
    const dx = x - seg.x;
    const dz = z - seg.z;
    const along = dx * ax + dz * az;
    const across = dx * az * -1 + dz * ax; // perpendicular in the run plane
    return Math.abs(along) <= seg.halfLength + 0.15 && Math.abs(across) <= tol;
  });
}

interface SweptFloor {
  seed: number;
  baseLevel: number;
  floorIndex: number;
  floor: ReturnType<typeof generateRiftFloor>;
  colliders: Collider[];
}

function sweepFloors(): SweptFloor[] {
  const out: SweptFloor[] = [];
  const ranks = Object.values(RIFT_RANK_BASE_LEVEL);
  let seed = 1;
  let procedural = 0;
  while (procedural < 25 && seed < 500) {
    if (!isSetPieceSeed(seed)) {
      procedural++;
      for (const baseLevel of ranks) {
        const plan = generateRiftPlan(seed, baseLevel);
        for (const floorIndex of [0, plan.floorCount - 1]) {
          const floor = generateRiftFloor(seed, baseLevel, floorIndex, null);
          out.push({
            seed,
            baseLevel,
            floorIndex,
            floor,
            colliders: layoutColliders(floor.layout),
          });
        }
      }
    }
    seed++;
  }
  return out;
}

const SWEPT = sweepFloors();

describe('rift wall render/collision parity', () => {
  it('sweeps a non-vacuous mix of rectangular, polygon, and stub floors', () => {
    expect(SWEPT.length).toBeGreaterThan(100);
    expect(SWEPT.some((f) => f.floor.layout.shellPolygon)).toBe(true);
    expect(SWEPT.some((f) => !f.floor.layout.shellPolygon)).toBe(true);
    expect(SWEPT.some((f) => f.floor.layout.stubs.length > 0)).toBe(true);
  });

  it('every rendered shell and stub wall segment sits on a collider (no phantom walls)', () => {
    for (const { seed, baseLevel, floorIndex, floor, colliders } of SWEPT) {
      const layout = floor.layout;
      const segments: WallFaceSegment[] = [];
      if (layout.shellPolygon) {
        // The renderer walks the delve segmenter for polygon shells; its split
        // pitch differs from the collision segmenter, so pin coverage here too.
        for (const seg of polygonWallSegments(layout.shellPolygon)) {
          segments.push({ x: seg.x, z: seg.z, ry: seg.rot, halfLength: seg.halfLength });
        }
      } else {
        const shell = rectShellWallSegments(layout, DUNGEON_WALL_X, DUNGEON_END_WALL_HW);
        segments.push(...shell.left, ...shell.right, ...shell.front, ...shell.back);
      }
      for (const s of layout.stubs) {
        const faces = stubFaceSegments(s);
        segments.push(...faces.caps, ...faces.faces);
      }
      for (const seg of segments) {
        for (const p of segmentSamples(seg)) {
          const onCollider = colliders.some((c) => obbContains(c, p.x, p.z, FACE_TOLERANCE));
          expect(
            onCollider,
            `phantom wall segment at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ` +
              `seed ${seed} L${baseLevel} floor ${floorIndex}`,
          ).toBe(true);
        }
      }
    }
  });

  it('every rectangular wall collider run is visually covered (no invisible walls)', () => {
    for (const { seed, baseLevel, floorIndex, floor } of SWEPT) {
      const layout = floor.layout;
      if (layout.shellPolygon) continue;
      const shell = rectShellWallSegments(layout, DUNGEON_WALL_X, DUNGEON_END_WALL_HW);
      const wallX = layout.wallX ?? DUNGEON_WALL_X;
      const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
      const label = (what: string, x: number, z: number) =>
        `invisible wall: ${what} uncovered at (${x.toFixed(1)}, ${z.toFixed(1)}) ` +
        `seed ${seed} L${baseLevel} floor ${floorIndex}`;
      for (const [sideSegs, sx] of [
        [shell.left, -wallX],
        [shell.right, wallX],
      ] as const) {
        const z0 = layout.sideWallZ - layout.sideWallHd;
        const z1 = layout.sideWallZ + layout.sideWallHd;
        for (let z = z0 + 0.2; z <= z1 - 0.2; z += SAMPLE_STEP) {
          expect(coveredBySegments(sideSegs, sx, z, 0.5), label('side wall', sx, z)).toBe(true);
        }
      }
      for (const [endSegs, ez] of [
        [shell.front, layout.zMin],
        [shell.back, layout.zMax],
      ] as const) {
        for (let x = -endWallHw + 0.2; x <= endWallHw - 0.2; x += SAMPLE_STEP) {
          expect(coveredBySegments(endSegs, x, ez, 0.5), label('end wall', x, ez)).toBe(true);
        }
      }
      for (const s of layout.stubs) {
        const faces = stubFaceSegments(s);
        const sign = s.x < 0 ? -1 : 1;
        const innerX = s.x - sign * s.hw;
        const outerX = s.x + sign * s.hw;
        for (let z = s.z - s.hd + 0.2; z <= s.z + s.hd - 0.2; z += SAMPLE_STEP) {
          expect(
            coveredBySegments(faces.caps, innerX + sign, z, 0.5),
            label('stub inner cap', innerX, z),
          ).toBe(true);
          expect(
            coveredBySegments(faces.caps, outerX - sign, z, 0.5),
            label('stub outer cap', outerX, z),
          ).toBe(true);
        }
        for (const fz of [s.z - (s.hd - 1), s.z + (s.hd - 1)]) {
          for (let x = s.x - s.hw + 0.2; x <= s.x + s.hw - 0.2; x += SAMPLE_STEP) {
            expect(coveredBySegments(faces.faces, x, fz, 0.5), label('stub face', x, fz)).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it('no wall segment intrudes into a waist passage (the run-through-the-doorway bug)', () => {
    let waists = 0;
    for (const { seed, baseLevel, floorIndex, floor } of SWEPT) {
      const layout = floor.layout;
      if (layout.shellPolygon || layout.stubs.length === 0) continue;
      const wallX = layout.wallX ?? DUNGEON_WALL_X;
      const shell = rectShellWallSegments(layout, DUNGEON_WALL_X, DUNGEON_END_WALL_HW);
      const segments: WallFaceSegment[] = [
        ...shell.left,
        ...shell.right,
        ...shell.front,
        ...shell.back,
      ];
      for (const s of layout.stubs) {
        const faces = stubFaceSegments(s);
        segments.push(...faces.caps, ...faces.faces);
      }
      // True waists are the side-wall-flush mirrored pairs (the generator also
      // emits free-standing wall fins, which have no passage of their own).
      const flush = layout.stubs.filter((s) => Math.abs(s.x) + s.hw >= wallX - 0.6);
      for (const s of flush) {
        if (s.x >= 0) continue;
        const mirror = flush.find((m) => m.z === s.z && m.x > 0);
        if (!mirror) continue;
        waists++;
        const passageHalf = Math.min(Math.abs(s.x) - s.hw, Math.abs(mirror.x) - mirror.hw);
        for (const seg of segments) {
          for (const p of segmentSamples(seg)) {
            const inPassage = Math.abs(p.x) < passageHalf - 0.2 && Math.abs(p.z - s.z) < s.hd - 0.2;
            expect(
              inPassage,
              `wall segment inside the waist passage at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ` +
                `seed ${seed} L${baseLevel} floor ${floorIndex}`,
            ).toBe(false);
          }
        }
      }
    }
    expect(waists).toBeGreaterThan(0);
  });

  it('stub wall segments never enter the walkable centre aisle', () => {
    // Both stub kinds (waist piers, wall fins) keep their inner collider face
    // at |x| >= 7 (AISLE_HALF 5.5 plus the generator margins). The legacy
    // renderer ignored the stub fields entirely and drew hardcoded panels from
    // |x| 5 inward across the aisle; pin that every stub-derived segment stays
    // outside the spine so that class of phantom wall cannot return.
    let checked = 0;
    for (const { seed, baseLevel, floorIndex, floor } of SWEPT) {
      for (const s of floor.layout.stubs) {
        expect(Math.abs(s.x) - s.hw).toBeGreaterThanOrEqual(7);
        const faces = stubFaceSegments(s);
        for (const seg of [...faces.caps, ...faces.faces]) {
          for (const p of segmentSamples(seg)) {
            expect(
              Math.abs(p.x) >= 6.5,
              `stub segment in the aisle at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ` +
                `seed ${seed} L${baseLevel} floor ${floorIndex}`,
            ).toBe(true);
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
