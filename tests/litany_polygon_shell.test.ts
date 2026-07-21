// Tests for the polygon-boundary shell colliders that back the 7 Drowned
// Litany rooms (src/sim/delve_litany_layout.ts). Stage B derives the OBB
// rotation convention with a single 45-degree edge before any collider code
// exists; Stage D extends this file with full per-room authoring checks.
import { describe, expect, it } from 'vitest';
import { DELVE_MODULES } from '../src/sim/data';
import {
  LITANY_MODULE_IDS,
  litanyModuleColliders,
  litanyModuleDressing,
  litanyModuleGeometry,
  polygonShellColliders,
} from '../src/sim/delve_litany_layout';
import { DUNGEON_WALL_HW } from '../src/sim/dungeon_layout';
import {
  polygonContainsPoint,
  polygonIsStarShaped,
  polygonSelfIntersects,
  polygonSignedArea,
} from '../src/sim/geometry2d';

// ---------------------------------------------------------------------------
// Stage B: rotation-sign spot check for a single 45-degree edge.
// ---------------------------------------------------------------------------
describe('polygonShellColliders: OBB rotation convention', () => {
  it('blocks a point just outside a 45-degree edge and frees a point just inside it', () => {
    // A single edge running from (0,0) to (10,10): a 45-degree NE diagonal.
    // Two points close it into a simple CCW triangle so signed area > 0 (not
    // load-bearing for this spot check, just keeps the fixture a valid simple
    // polygon rather than a degenerate 2-point "polygon").
    const points = [
      { x: 0, z: 0 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
    ];
    const colliders = polygonShellColliders(points);
    expect(colliders.length).toBeGreaterThan(0);

    // The edge (0,0)->(10,10) has outward normal pointing to the lower-right
    // (+x,-z) side for this CCW winding (interior is up-left, toward -x/+z).
    // The wall OBB straddles the edge line: it spans DUNGEON_WALL_HW on both
    // sides of the edge, so a point a half-thickness past the edge along the
    // OUTWARD normal is still inside that thin band (BLOCKED), while a point
    // 1.5x the thickness past the edge along the INWARD (interior) direction
    // has cleared the band entirely (FREE, out in the open room).
    const midX = 5;
    const midZ = 5;
    const nx = Math.SQRT1_2;
    const nz = -Math.SQRT1_2;
    const outsideX = midX + nx * (DUNGEON_WALL_HW * 0.5);
    const outsideZ = midZ + nz * (DUNGEON_WALL_HW * 0.5);
    const insideX = midX - nx * (DUNGEON_WALL_HW * 1.5);
    const insideZ = midZ - nz * (DUNGEON_WALL_HW * 1.5);

    const blocked = (x: number, z: number): boolean => {
      for (const c of colliders) {
        if (c.type !== 'obb') continue;
        // Mirror resolvePosition/pushOut's rotY(-rot) local-frame test.
        const cos = Math.cos(-c.rot);
        const sin = Math.sin(-c.rot);
        const lx = (x - c.x) * cos + (z - c.z) * sin;
        const lz = -(x - c.x) * sin + (z - c.z) * cos;
        if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) return true;
      }
      return false;
    };

    expect(blocked(outsideX, outsideZ), 'point just outside the edge should be blocked').toBe(true);
    expect(blocked(insideX, insideZ), 'point just inside the edge should be free').toBe(false);
  });

  it('segments a long edge into pieces no longer than WALL_SEGMENT_MAX (6)', () => {
    const points = [
      { x: -5, z: 0 },
      { x: 25, z: 0 }, // a 30-unit edge: ceil(30/6) = 5 segments
      { x: 25, z: 10 },
      { x: -5, z: 10 },
    ];
    const colliders = polygonShellColliders(points);
    const bottomEdgeSegs = colliders.filter((c) => c.type === 'obb' && c.z === 0 && c.hw <= 3);
    expect(bottomEdgeSegs.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Stage D: full per-room authoring checks.
// ---------------------------------------------------------------------------

const BODY_R = 1.0;

function blockedAt(
  colliders: ReturnType<typeof litanyModuleColliders>,
  x: number,
  z: number,
  r: number,
): boolean {
  for (const c of colliders) {
    if (c.type === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    } else {
      const cos = Math.cos(-c.rot);
      const sin = Math.sin(-c.rot);
      const lx = (x - c.x) * cos + (z - c.z) * sin;
      const lz = -(x - c.x) * sin + (z - c.z) * cos;
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return true;
    }
  }
  return false;
}

/** Minimum clearance (world units) from (x,z) to the nearest shell segment surface. */
function clearanceFromShell(
  colliders: ReturnType<typeof litanyModuleColliders>,
  x: number,
  z: number,
): number {
  let min = Infinity;
  for (const c of colliders) {
    if (c.type !== 'obb') continue;
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos + (z - c.z) * sin;
    const lz = -(x - c.x) * sin + (z - c.z) * cos;
    // Distance from local point to the box surface (0 or negative if inside).
    const dx = Math.abs(lx) - c.hw;
    const dz = Math.abs(lz) - c.hd;
    const dist = dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz); // inside on one axis: negative means overlap depth
    min = Math.min(min, dist);
  }
  return min;
}

describe('The Drowned Litany: authored room boundary polygons', () => {
  for (const moduleId of LITANY_MODULE_IDS) {
    const geo = litanyModuleGeometry(moduleId);
    if (!geo) continue;
    const poly = geo.walkable[0]?.points ?? [];

    describe(moduleId, () => {
      it('is wound CCW (positive signed area)', () => {
        expect(poly.length).toBeGreaterThanOrEqual(3);
        expect(polygonSignedArea(poly)).toBeGreaterThan(0);
      });

      it('is simple (no self-intersection)', () => {
        expect(polygonSelfIntersects(poly)).toBe(false);
      });

      it('is star-shaped from its pole', () => {
        expect(polygonIsStarShaped(poly, geo.pole)).toBe(true);
      });

      it('generates at most 60 shell colliders', () => {
        expect(polygonShellColliders(poly).length).toBeLessThanOrEqual(60);
      });

      it('strictly contains every island corner with margin >= 1', () => {
        for (const isl of geo.islands) {
          for (const dx of [-isl.hw, isl.hw]) {
            for (const dz of [-isl.hd, isl.hd]) {
              const x = isl.x + dx;
              const z = isl.z + dz;
              expect(
                polygonContainsPoint(poly, x, z),
                `${moduleId} island corner (${x},${z}) inside polygon`,
              ).toBe(true);
            }
          }
        }
      });

      it('strictly contains every pillar plus a 1.2 radius, with margin >= 1', () => {
        const r = 1.2;
        for (const p of geo.pillars) {
          for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
            const x = p.x + Math.cos(ang) * r;
            const z = p.z + Math.sin(ang) * r;
            expect(
              polygonContainsPoint(poly, x, z),
              `${moduleId} pillar (${p.x},${p.z}) ring inside polygon`,
            ).toBe(true);
          }
        }
      });

      it('strictly contains the dais circle', () => {
        const { x, z, r } = geo.dais;
        for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
          const px = x + Math.cos(ang) * r;
          const pz = z + Math.sin(ang) * r;
          expect(polygonContainsPoint(poly, px, pz), `${moduleId} dais ring inside polygon`).toBe(
            true,
          );
        }
      });

      it('strictly contains every dressing anchor', () => {
        for (const d of litanyModuleDressing(moduleId)) {
          expect(
            polygonContainsPoint(poly, d.x, d.z),
            `${moduleId} dressing ${d.kind} (${d.x},${d.z}) inside polygon`,
          ).toBe(true);
        }
      });

      it('strictly contains every spawn and interactable slot for this module', () => {
        const def = DELVE_MODULES[moduleId];
        if (!def) return;
        for (const set of def.spawnSets ?? []) {
          for (const sp of set.spawns) {
            expect(
              polygonContainsPoint(poly, sp.x, sp.z),
              `${moduleId} spawn ${sp.mobId} (${sp.x},${sp.z}) inside polygon`,
            ).toBe(true);
          }
        }
        for (const slot of def.interactableSlots ?? []) {
          expect(
            polygonContainsPoint(poly, slot.x, slot.z),
            `${moduleId} interactable (${slot.x},${slot.z}) inside polygon`,
          ).toBe(true);
        }
      });

      it('only requires hazard CENTERS inside (pools may clip the shell)', () => {
        for (const hz of geo.hazards) {
          expect(
            polygonContainsPoint(poly, hz.x, hz.z),
            `${moduleId} hazard center (${hz.x},${hz.z}) inside polygon`,
          ).toBe(true);
        }
      });

      it('entry and exit are inside with clearance >= 2 from the shell', () => {
        const colliders = litanyModuleColliders(moduleId);
        const entry = { x: 0, z: geo.zMin + 8 };
        const exit = { x: 0, z: geo.zMax - 2 };
        expect(polygonContainsPoint(poly, entry.x, entry.z), `${moduleId} entry inside`).toBe(true);
        expect(polygonContainsPoint(poly, exit.x, exit.z), `${moduleId} exit inside`).toBe(true);
        expect(
          clearanceFromShell(colliders, entry.x, entry.z),
          `${moduleId} entry clearance`,
        ).toBeGreaterThanOrEqual(2);
        expect(
          clearanceFromShell(colliders, exit.x, exit.z),
          `${moduleId} exit clearance`,
        ).toBeGreaterThanOrEqual(2);
      });
    });
  }

  it('the apse polygon only pulls inward south of z=50 (keeps |x| >= 23.4 north of it, short of the exempt end cap)', () => {
    const geo = litanyModuleGeometry('litany_apse')!;
    const poly = geo.walkable[0].points;
    // Mirrors the stomp-ring test's exemption window (c.z < zMax - 2): a
    // vertex at or beyond that z is the true end-cap taper, which the
    // interior-cover filter in tests/delves.test.ts never inspects, so it is
    // allowed to narrow. Everything strictly between z=50 and that boundary
    // must stay wide.
    const capZ = geo.zMax - 2;
    for (const pt of poly) {
      if (pt.z > 50 && pt.z < capZ) {
        expect(
          Math.abs(pt.x),
          `apse vertex (${pt.x},${pt.z}) north of z=50`,
        ).toBeGreaterThanOrEqual(23.4);
      }
    }
  });

  it('the apse stomp-ring interior-cover test stays clean with the polygon shell active', () => {
    const layout = litanyModuleGeometry('litany_apse')!;
    const wallX = layout.wallX;
    const hazardSet = new Set(layout.hazards.map((h) => `${h.x},${h.z}`));
    const interior = litanyModuleColliders('litany_apse').filter(
      (c) =>
        Math.abs(c.x) < wallX - 2 &&
        c.z > layout.zMin + 2 &&
        c.z < layout.zMax - 2 &&
        !hazardSet.has(`${c.x},${c.z}`),
    );
    for (let r = 0; r <= layout.dais.r; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = layout.dais.x + Math.cos(a) * r;
        const z = layout.dais.z + Math.sin(a) * r;
        expect(blockedAt(interior, x, z, BODY_R), `apse stomp ring blocked at r=${r}`).toBe(false);
      }
    }
    for (const c of interior) {
      expect(c.z, 'apse cover must stay in the south half').toBeLessThanOrEqual(50);
    }
  });

  it('the ring polygon keeps |x| >= 24 near the root_wall anchor z values', () => {
    const geo = litanyModuleGeometry('litany_ring')!;
    const poly = geo.walkable[0].points;
    for (const targetZ of [4, 26, 52, 72]) {
      const westCandidates = poly.filter((p) => Math.abs(p.z - targetZ) < 6 && p.x < 0);
      const eastCandidates = poly.filter((p) => Math.abs(p.z - targetZ) < 6 && p.x > 0);
      for (const p of westCandidates) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(24);
      for (const p of eastCandidates) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(24);
    }
  });
});
