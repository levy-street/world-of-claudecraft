// Patrol routing (G8 follow-up): the loop-aware pieces mob/patrol.ts leans on
// so a ground patrol never cuts across the void between the legs of its loop.
//
//   - projectOntoLoop: the nearest point of a closed loop to a body, with its
//     arc length, so a displaced patroller knows where on its loop it stands.
//   - loopRouteTarget: the next point to steer at when the patroller is off
//     its time point: first back onto the loop, then ALONG the loop toward the
//     goal arc (the shorter way round), a few yards at a time. A straight chase
//     across a zigzag road (the Gravewyrm Sanctum's haul road) runs a body off
//     a terrace edge into the cliff wall; the loop itself is authored on
//     walkable ground, so following it never does.
//   - shuttleLoop: an out-and-back route as a closed racetrack: two lanes either
//     side of the authored centre line, a half-circle turn at each end and an
//     arc round each interior corner, so a big body turns round instead of
//     flipping on the spot.
//
// Pure geometry: no sim state, no rng, deterministic. Coordinates are any
// one frame (instance-local in content, world space once stamped).

export interface LoopPoint {
  readonly x: number;
  readonly z: number;
}

export interface LoopProjection {
  /** Arc length of the nearest point from the loop's first point. */
  s: number;
  x: number;
  z: number;
  /** Distance from the queried point to the loop. */
  d: number;
}

/** A body farther than this from its loop walks straight back onto it first. */
export const LOOP_REJOIN_OFFSET = 1.5;
/** How far ahead along the loop a routed body steers (yards). Short enough
 *  that the chord to the steer point stays on a road a few yards wide. */
export const LOOP_ROUTE_LOOKAHEAD = 3;

function loopLength(points: readonly LoopPoint[]): number {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

/** The point `s` yards along the closed loop (wrapping). */
function pointAt(points: readonly LoopPoint[], s: number, len: number): LoopPoint {
  let d = ((s % len) + len) % len;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= seg || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, d / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    d -= seg;
  }
  return points[0];
}

/** The nearest point of the closed loop to (x, z). Ties go to the earlier
 *  segment, so an out-and-back loop resolves to its outbound leg. */
export function projectOntoLoop(
  points: readonly LoopPoint[],
  x: number,
  z: number,
): LoopProjection {
  let best: LoopProjection = { s: 0, x: points[0]?.x ?? x, z: points[0]?.z ?? z, d: Infinity };
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const seg2 = ex * ex + ez * ez;
    const t = seg2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / seg2)) : 0;
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d - 1e-9) best = { s: acc + Math.sqrt(seg2) * t, x: px, z: pz, d };
    acc += Math.sqrt(seg2);
  }
  return best;
}

/**
 * Where a patroller at (x, z) steers to reach the loop point at arc `goalS`
 * without leaving the loop: its foot on the loop while it is off it, else a
 * point LOOP_ROUTE_LOOKAHEAD yards along the loop toward the goal, the shorter
 * way round (never past the goal).
 */
export function loopRouteTarget(
  points: readonly LoopPoint[],
  x: number,
  z: number,
  goalS: number,
  lookahead = LOOP_ROUTE_LOOKAHEAD,
): LoopPoint {
  const len = loopLength(points);
  if (points.length < 2 || len <= 0) return points[0] ?? { x, z };
  const at = projectOntoLoop(points, x, z);
  if (at.d > LOOP_REJOIN_OFFSET) return { x: at.x, z: at.z };
  const fwd = (((goalS - at.s) % len) + len) % len;
  const step = fwd <= len / 2 ? Math.min(fwd, lookahead) : -Math.min(len - fwd, lookahead);
  return pointAt(points, at.s + step, len);
}

/** Unit direction a to b, and its side normal (dz, -dx) in the x/z frame. */
function dirOf(a: LoopPoint, b: LoopPoint): { dx: number; dz: number; nx: number; nz: number } {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  return { dx, dz, nx: dz, nz: -dx };
}

/** Points of an arc round (cx, cz) from angle a0 to a1 (radians, atan2(x, z)
 *  convention), `steps` segments, both ends included. */
function arc(
  cx: number,
  cz: number,
  r: number,
  a0: number,
  a1: number,
  steps: number,
  out: LoopPoint[],
): void {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
  }
}

/** The shorter signed sweep from angle a0 to a1. */
function sweep(a0: number, a1: number): number {
  let d = (a1 - a0) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** One lane of the shuttle: the centre line offset `side` yards along its
 *  side normal (negative: the other side), each interior corner rounded on an
 *  arc concentric with the centre line's own fillet of radius `cornerR`. */
function lane(
  line: readonly LoopPoint[],
  side: number,
  cornerR: number,
  arcStep: number,
): LoopPoint[] {
  const out: LoopPoint[] = [];
  const first = dirOf(line[0], line[1]);
  out.push({ x: line[0].x + first.nx * side, z: line[0].z + first.nz * side });
  for (let i = 1; i < line.length - 1; i++) {
    const v = line[i];
    const inD = dirOf(line[i - 1], v);
    const outD = dirOf(v, line[i + 1]);
    // The centre line's fillet: its centre on the inner bisector.
    const cross = inD.dx * outD.dz - inD.dz * outD.dx;
    const turn = Math.acos(Math.max(-1, Math.min(1, inD.dx * outD.dx + inD.dz * outD.dz)));
    if (turn < 1e-3) {
      out.push({ x: v.x + inD.nx * side, z: v.z + inD.nz * side });
      continue;
    }
    // Inner side: the side normal's way when the line turns toward it (cross < 0).
    const inner = cross < 0 ? 1 : -1;
    const tangent = cornerR * Math.tan(turn / 2);
    const t1 = { x: v.x - inD.dx * tangent, z: v.z - inD.dz * tangent };
    const cx = t1.x + inD.nx * inner * cornerR;
    const cz = t1.z + inD.nz * inner * cornerR;
    // This lane's arc: the same centre, radius shrunk on the inner side.
    const r = cornerR - side * inner;
    const p1 = {
      x: v.x - inD.dx * tangent + inD.nx * side,
      z: v.z - inD.dz * tangent + inD.nz * side,
    };
    const p2 = {
      x: v.x + outD.dx * tangent + outD.nx * side,
      z: v.z + outD.dz * tangent + outD.nz * side,
    };
    const a0 = Math.atan2(p1.x - cx, p1.z - cz);
    const a1 = a0 + sweep(a0, Math.atan2(p2.x - cx, p2.z - cz));
    const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / arcStep));
    arc(cx, cz, r, a0, a1, steps, out);
  }
  const n = line.length;
  const last = dirOf(line[n - 2], line[n - 1]);
  out.push({ x: line[n - 1].x + last.nx * side, z: line[n - 1].z + last.nz * side });
  return out;
}

/**
 * An out-and-back patrol along `line` as a closed racetrack: out on the lane
 * `halfGap` yards to one side of the line, a half-circle of radius `halfGap` round
 * the far end, back on the other lane, a half-circle round the near end.
 * Interior corners arc round on a centre-line radius of `cornerR` (which must
 * exceed `halfGap`). Arc points sit about `arcStep` yards apart.
 */
export function shuttleLoop(
  line: readonly LoopPoint[],
  halfGap: number,
  cornerR: number,
  arcStep = 1,
): LoopPoint[] {
  if (line.length < 2) return line.map((p) => ({ x: p.x, z: p.z }));
  const out = lane(line, halfGap, cornerR, arcStep);
  const back = lane([...line].reverse(), halfGap, cornerR, arcStep);
  const capSteps = Math.max(4, Math.ceil((Math.PI * halfGap) / arcStep));
  const capAt = (end: LoopPoint, from: LoopPoint, to: LoopPoint, outPts: LoopPoint[]): void => {
    const a0 = Math.atan2(from.x - end.x, from.z - end.z);
    const d = dirOf(to, end);
    // The turn bulges past the end, along the line's own heading there.
    const mid = Math.atan2(d.dx, d.dz);
    const s = sweep(a0, mid);
    const pts: LoopPoint[] = [];
    arc(end.x, end.z, halfGap, a0, a0 + 2 * s, capSteps, pts);
    // The two lane ends are the arc's ends already: keep the inner points.
    for (let i = 1; i < pts.length - 1; i++) outPts.push(pts[i]);
  };
  const loop: LoopPoint[] = [...out];
  const n = line.length;
  capAt(line[n - 1], out[out.length - 1], line[n - 2], loop);
  loop.push(...back);
  capAt(line[0], back[back.length - 1], line[1], loop);
  return loop.map((p) => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }));
}
