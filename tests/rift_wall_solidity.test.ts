import { describe, expect, it } from 'vitest';
import {
  allocRiftCollisionToken,
  clearRiftRegion,
  resolveMovement,
  setRiftRegion,
} from '../src/sim/colliders';
import {
  INFERNAL_DOORS,
  INFERNAL_PIT_DOORS,
  INFERNAL_PIT_ROOMS,
  INFERNAL_ROOMS,
} from '../src/sim/content/rift/infernal_citadel';
import { riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import { generateRiftFloor, isSetPieceSeed, riftFloorCount } from '../src/sim/rift/rift_gen';

// Every rift wall is SOLID: no swept move that starts inside a room may end
// outside its shell. The historical failure class was not a missing collider but
// a push-through: a wide obstacle abutting the thin side wall (the seed-2
// chamber-waist stub below) let chained pushOuts walk the mover's centre past
// the wall centreline, and the wall then ejected them OUTSIDE. resolveMovement's
// rift-scoped displacement guard (colliders.ts) treats any teleport-scale
// resolution as a hard block; this suite is its regression pin.

const WORLD_SEED = 42;
const BODY_R = 0.6;

function sweep(
  token: number,
  origin: { x: number; z: number },
  sx: number,
  sz: number,
  tx: number,
  tz: number,
): { x: number; z: number } {
  const res = resolveMovement(
    WORLD_SEED,
    origin.x + sx,
    origin.z + sz,
    origin.x + tx,
    origin.z + tz,
    BODY_R,
    false,
    undefined,
    undefined,
    token,
  );
  return { x: res.x - origin.x, z: res.z - origin.z };
}

describe('rift walls are solid (no push-through, no leaks)', () => {
  it('pins the seed-2 stub ejection: pressing into the waist stub never exits the room', () => {
    // Seed 2 floor 0 carries a chamber-waist stub whose OBB reaches the side
    // wall at x=35. Before the guard, a mover pressed inside it resolved from
    // x 33.1 straight to 36.6 (outside). It must stay inside the room now.
    const token = allocRiftCollisionToken();
    const origin = riftInstanceOrigin(0, 0);
    const floor = generateRiftFloor(2, 20, 0);
    setRiftRegion(token, origin.x, origin.z, layoutColliders(floor.layout));
    const end = sweep(token, origin, 32.5, 61, 46.5, 61);
    expect(Math.abs(end.x), 'pinned at the wall, never ejected').toBeLessThan(36);
    clearRiftRegion(token, origin.x, origin.z);
  });

  it('procedural floors: outward sweeps from inside never escape the shell', () => {
    const token = allocRiftCollisionToken();
    const origin = riftInstanceOrigin(0, 0);
    const leaks: string[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      if (isSetPieceSeed(seed)) continue; // the authored citadel has its own sweep below
      const fc = riftFloorCount(seed);
      for (let fi = 0; fi < fc; fi++) {
        const floor = generateRiftFloor(seed, 20, fi);
        const layout = floor.layout;
        setRiftRegion(token, origin.x, origin.z, layoutColliders(layout));
        const poly = layout.shellPolygon;
        const inside = (x: number, z: number): boolean =>
          poly
            ? polygonContainsPoint(poly, x, z)
            : Math.abs(x) < (layout.wallX ?? 20) && z > layout.zMin && z < layout.zMax;
        const boundary: Array<{ x: number; z: number; nx: number; nz: number }> = [];
        if (poly) {
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            const steps = Math.max(1, Math.ceil(len / 2));
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const x = a.x + (b.x - a.x) * t;
              const z = a.z + (b.z - a.z) * t;
              let nx = (b.z - a.z) / len;
              let nz = -(b.x - a.x) / len;
              if (inside(x + nx * 2, z + nz * 2) && !inside(x - nx * 2, z - nz * 2)) {
                nx = -nx;
                nz = -nz;
              }
              boundary.push({ x, z, nx, nz });
            }
          }
        } else {
          const wx = layout.wallX ?? 20;
          for (let z = layout.zMin + 2; z <= layout.zMax - 2; z += 2) {
            boundary.push({ x: wx, z, nx: 1, nz: 0 });
            boundary.push({ x: -wx, z, nx: -1, nz: 0 });
          }
          for (let x = -wx + 2; x <= wx - 2; x += 2) {
            boundary.push({ x, z: layout.zMax, nx: 0, nz: 1 });
            boundary.push({ x, z: layout.zMin, nx: 0, nz: -1 });
          }
        }
        for (const b of boundary) {
          const sx = b.x - b.nx * 2.5;
          const sz = b.z - b.nz * 2.5;
          if (!inside(sx, sz)) continue;
          for (const ang of [-0.7, 0, 0.7]) {
            const cos = Math.cos(ang);
            const sin = Math.sin(ang);
            const dx = b.nx * cos - b.nz * sin;
            const dz = b.nx * sin + b.nz * cos;
            const end = sweep(token, origin, sx, sz, sx + dx * 14, sz + dz * 14);
            if (!inside(end.x, end.z) && Math.hypot(end.x - b.x, end.z - b.z) > 3.5) {
              leaks.push(
                `seed ${seed} f${fi} @(${b.x.toFixed(1)},${b.z.toFixed(1)}) ang ${ang} ended (${end.x.toFixed(1)},${end.z.toFixed(1)})`,
              );
            }
          }
        }
        clearRiftRegion(token, origin.x, origin.z);
      }
    }
    expect(leaks, leaks.slice(0, 10).join('; ')).toHaveLength(0);
  });

  it('authored citadel floors: outward sweeps through room walls never escape', () => {
    const token = allocRiftCollisionToken();
    const origin = riftInstanceOrigin(0, 0);
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed).toBeGreaterThan(0);
    const leaks: string[] = [];
    const floors: Array<{ rooms: typeof INFERNAL_ROOMS; doors: typeof INFERNAL_DOORS }> = [
      { rooms: INFERNAL_ROOMS, doors: INFERNAL_DOORS },
      { rooms: INFERNAL_PIT_ROOMS, doors: INFERNAL_PIT_DOORS },
    ];
    for (let fi = 0; fi < floors.length; fi++) {
      const floor = generateRiftFloor(seed, 20, fi);
      setRiftRegion(token, origin.x, origin.z, layoutColliders(floor.layout));
      const { rooms, doors } = floors[fi];
      const insideAny = (x: number, z: number): boolean =>
        rooms.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
      const nearDoor = (x: number, z: number): boolean =>
        doors.some((d) => Math.abs(x - d.x) <= d.hw + 2 && Math.abs(z - d.z) <= d.hd + 2);
      for (const room of rooms) {
        const faces: Array<{ x: number; z: number; nx: number; nz: number }> = [];
        for (let z = room.z0 + 1.5; z <= room.z1 - 1.5; z += 2) {
          faces.push({ x: room.x0, z, nx: -1, nz: 0 }, { x: room.x1, z, nx: 1, nz: 0 });
        }
        for (let x = room.x0 + 1.5; x <= room.x1 - 1.5; x += 2) {
          faces.push({ x, z: room.z0, nx: 0, nz: -1 }, { x, z: room.z1, nx: 0, nz: 1 });
        }
        for (const f of faces) {
          if (nearDoor(f.x, f.z)) continue; // doorways are open by design
          const sx = f.x - f.nx * 2;
          const sz = f.z - f.nz * 2;
          const end = sweep(token, origin, sx, sz, sx + f.nx * 12, sz + f.nz * 12);
          // The end must still be inside SOME room (crossing into a neighbor
          // through a shared doorway is fine; the void outside is not).
          if (!insideAny(end.x, end.z)) {
            leaks.push(
              `citadel f${fi} room ${room.id} @(${f.x},${f.z.toFixed(1)}) ended (${end.x.toFixed(1)},${end.z.toFixed(1)})`,
            );
          }
        }
      }
      clearRiftRegion(token, origin.x, origin.z);
    }
    expect(leaks, leaks.slice(0, 10).join('; ')).toHaveLength(0);
  });
});
