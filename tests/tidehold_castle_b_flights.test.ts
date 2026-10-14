// Every flight in Castle B is walkable end to end: the ground under a body
// climbing it rises in steps a mover can take, and nothing solid hangs in the
// head-room above the treads (SPACEY, 2026-09-11: "audit the steps on the castle
// so nothing blocks the player from going up and down the stairs + going to
// each floor"). The first cut had ceiling joists crossing every stairwell at
// head height and a balustrade standing across the last tread of flight B ,
// art, not colliders, so only the joists' absence is pinned here through the
// GLB-independent collision data; the geometry is checked in the build script.
import { describe, expect, it } from 'vitest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { setActiveWorldContent } from '../src/sim/data';
import { pol, RING_CASTLE, RING_CROWN } from '../src/sim/deepglass/citadel_ring_frame';
import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import { groundHeightNear } from '../src/sim/world';

const SEED = DEEPGLASS_MAP_ENTRY.seed;
const S = 1.35;
const seat = pol(RING_CASTLE.r, RING_CASTLE.phi);
const cb = (xk: number, yk: number) => ({ x: seat.x + xk * S, z: seat.z - yk * S });
const HEAD = 2.0; // yd of clear air a body needs over its feet
const STEP_UP = 0.62; // yd: the biggest rise between two samples 0.25 kit apart a mover takes
const STEP_DOWN = 0.2; // yd: a flight never drops on the way up
const FOOT_RISE = 1.1; // yd: a deck rides the tread nosings, so the foot sample (on the first tread) sits up to a riser plus the nosing float over the floor

interface Flight {
  name: string;
  from: [number, number]; // kit (x, y) at the foot
  to: [number, number]; // kit (x, y) at the head
  zLo: number; // kit
  zHi: number; // kit
}

// The flights of bl_castle_b.py (kit units, S = 1.35). WALK_Z = CURTAIN_H - 1.2 = 3.8; the walk flights top out at WALK_Z + 0.02.
const FLIGHTS: Flight[] = [
  { name: 'hall flight A (west bay)', from: [-11.2, -5.6], to: [-11.2, -12.4], zLo: 0.2, zHi: 5.1 },
  {
    name: 'hall flight B (back wall)',
    from: [-8.0, -13.9],
    to: [-3.0, -13.9],
    zLo: 5.1,
    zHi: 10.1,
  },
  { name: 'east wing stair', from: [21.8, -10.0], to: [21.8, -3.2], zLo: 0.2, zHi: 5.1 },
  { name: 'west wing stair', from: [-21.8, -10.0], to: [-21.8, -3.2], zLo: 0.2, zHi: 5.1 },
  { name: 'east wall-walk flight', from: [23.35, 2.0], to: [23.35, 8.0], zLo: 0.2, zHi: 3.82 },
  { name: 'west wall-walk flight', from: [-23.35, 2.0], to: [-23.35, 8.0], zLo: 0.2, zHi: 3.82 },
  { name: 'east gate-wall flight', from: [8.0, 22.4], to: [14.0, 22.4], zLo: 0.2, zHi: 3.82 },
  { name: 'west gate-wall flight', from: [-8.0, 22.4], to: [-14.0, 22.4], zLo: 0.2, zHi: 3.82 },
];

// Level walks between a flight and the floor it serves (kit points): the
// ground must stay within one step and the head-room clear the whole way.
interface Path {
  name: string;
  z: number;
  pts: [number, number][];
}
const PATHS: Path[] = [
  {
    name: 'hall floor to the foot of A',
    z: 0.2,
    pts: [
      [-6, -4],
      [-11.2, -4],
      [-11.2, -4.8],
    ],
  }, // short of the deck's run-in under the first tread
  {
    name: "A's landing to B's foot along the walkway",
    z: 5.1,
    pts: [
      [-11.2, -12.6],
      [-11.2, -13.9],
      [-9, -13.9],
      [-8.7, -13.9],
    ],
  },
  {
    name: 'the walkway onto the middle floor',
    z: 5.1,
    pts: [
      [-9, -13.9],
      [-9, -12.0],
      [-9, -8],
      [0, -8],
    ],
  },
  {
    name: "B's head onto the Warden's floor",
    z: 10.1,
    pts: [
      [-2.8, -13.9],
      [0, -13.9],
      [0, -9],
      [0, 0.2],
    ],
  }, // out through the doorway onto the balcony, short of its rail
  {
    name: 'east wing head onto its floor',
    z: 5.1,
    pts: [
      [21.8, -3.0],
      [20, -3.0],
      [17, -7],
    ],
  },
  {
    name: 'west wing head onto its floor',
    z: 5.1,
    pts: [
      [-21.8, -3.0],
      [-20, -3.0],
      [-17, -7],
    ],
  },
  {
    name: 'east wall-walk flight head along the walk',
    z: 3.82,
    pts: [
      [23.35, 8.2],
      [23.35, 15],
    ],
  },
  {
    name: 'east gate-wall flight head along the walk',
    z: 3.82,
    pts: [
      [14.2, 22.4],
      [18, 22.4],
    ],
  },
];

function inFootprint(c: Collider, x: number, z: number, pad: number): boolean {
  if (c.type === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    return dx * dx + dz * dz < (c.r + pad) * (c.r + pad);
  }
  if (c.type !== 'obb') return false;
  const dx = x - c.x;
  const dz = z - c.z;
  const inFrame = (rot: number) => {
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const lx = dx * cs + dz * sn;
    const lz = -dx * sn + dz * cs;
    return Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad;
  };
  return inFrame(c.rot ?? 0) && inFrame(-(c.rot ?? 0));
}

/** Solid colliders whose body occupies the air a mover's head needs at (x, z, feet). */
function headBlockers(x: number, z: number, feetY: number): Collider[] {
  const out = queryOpenWorldColliders(SEED, x - 0.5, z - 0.5, x + 0.5, z + 0.5, []);
  return out.filter((c) => {
    if (!inFootprint(c, x, z, 0.3)) return false;
    const base = (c as { baseY?: number }).baseY;
    const top = (c as { moveTopY?: number }).moveTopY;
    // base absent = full height (walls): always solid. Otherwise the body
    // must span the head-room: start under the head, end above the knees.
    const startsUnderHead = base === undefined || base < feetY + HEAD;
    const endsAboveKnee = top === undefined || top > feetY + 0.35;
    return startsUnderHead && endsAboveKnee;
  });
}

describe('Castle B flights', () => {
  it('each flight climbs in walkable steps to its summit and nothing hangs in the head-room over it', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const problems: string[] = [];
    for (const f of FLIGHTS) {
      const len = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
      const n = Math.max(4, Math.round(len / 0.25));
      let prev = f.zLo * S;
      let start = Number.NaN;
      let end = Number.NaN;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const xk = f.from[0] + (f.to[0] - f.from[0]) * t;
        const yk = f.from[1] + (f.to[1] - f.from[1]) * t;
        const p = cb(xk, yk);
        const g = groundHeightNear(p.x, p.z, SEED, base + prev + 0.5) - base;
        if (i === 0) start = g;
        if (i === n) end = g;
        if (i > 0) {
          if (g - prev > STEP_UP)
            problems.push(
              `${f.name}: a ${(g - prev).toFixed(2)} yd step up at kit (${xk.toFixed(2)}, ${yk.toFixed(2)})`,
            );
          if (prev - g > STEP_DOWN)
            problems.push(
              `${f.name}: drops ${(prev - g).toFixed(2)} yd at kit (${xk.toFixed(2)}, ${yk.toFixed(2)})`,
            );
        }
        for (const side of [-0.45, 0, 0.45]) {
          // lateral offset across the flight, in world yards
          const ax = f.to[0] - f.from[0];
          const ay = f.to[1] - f.from[1];
          const nx = -ay / len;
          const ny = ax / len;
          const q = { x: p.x + nx * side, z: p.z - ny * side };
          for (const c of headBlockers(q.x, q.z, base + g)) {
            const desc =
              c.type === 'obb'
                ? `box ${c.hw.toFixed(2)}x${c.hd.toFixed(2)}`
                : `circle r${(c as { r: number }).r.toFixed(2)}`;
            const b = (c as { baseY?: number }).baseY;
            const tp = (c as { moveTopY?: number }).moveTopY;
            problems.push(
              `${f.name}: ${desc} at world (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) base ${b === undefined ? 'full' : (b - base).toFixed(2)} top ${tp === undefined ? 'full' : (tp - base).toFixed(2)} stands in the head-room at kit (${xk.toFixed(2)}, ${yk.toFixed(2)}) ${side ? `side ${side}` : ''} feet ${g.toFixed(2)}`,
            );
          }
        }
        prev = g;
      }
      const wantLo = f.zLo * S;
      const wantHi = f.zHi * S;
      if (start - wantLo < -0.6 || start - wantLo > FOOT_RISE)
        problems.push(`${f.name}: foot at ${start.toFixed(2)} yd, expected ~${wantLo.toFixed(2)}`);
      if (Math.abs(end - wantHi) > 0.6)
        problems.push(`${f.name}: head at ${end.toFixed(2)} yd, expected ~${wantHi.toFixed(2)}`);
    }
    for (const path of PATHS) {
      let prev = path.z * S;
      for (let k = 0; k + 1 < path.pts.length; k++) {
        const [x0, y0] = path.pts[k];
        const [x1, y1] = path.pts[k + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(2, Math.round(len / 0.25));
        for (let i = 0; i <= n; i++) {
          const xk = x0 + (x1 - x0) * (i / n);
          const yk = y0 + (y1 - y0) * (i / n);
          const p = cb(xk, yk);
          const g = groundHeightNear(p.x, p.z, SEED, base + prev + 0.5) - base;
          if (Math.abs(g - prev) > 0.35)
            problems.push(
              `${path.name}: ground jumps ${(g - prev).toFixed(2)} yd at kit (${xk.toFixed(2)}, ${yk.toFixed(2)})`,
            );
          if (Math.abs(g - path.z * S) > 0.6)
            problems.push(
              `${path.name}: ground at ${g.toFixed(2)} yd, expected ~${(path.z * S).toFixed(2)} at kit (${xk.toFixed(2)}, ${yk.toFixed(2)})`,
            );
          for (const c of headBlockers(p.x, p.z, base + g)) {
            const b = (c as { baseY?: number }).baseY;
            problems.push(
              `${path.name}: a collider at world (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) base ${b === undefined ? 'full' : (b - base).toFixed(2)} stands in the head-room at kit (${xk.toFixed(2)}, ${yk.toFixed(2)}) feet ${g.toFixed(2)}`,
            );
          }
          prev = g;
        }
      }
    }
    // dedupe the head-room lines (a blocker repeats at every sample under it)
    const seen = new Set<string>();
    const unique = problems.filter((p) => {
      const key = p.replace(/at kit \([^)]*\)( side -?[\d.]+)? feet [\d.]+/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    expect(unique).toEqual([]);
  });
});
