import { isBlocked, pathCrossesFence, resolvePosition } from './colliders';
import { groundHeight, waterLevel } from './world';

// Local A* over a 1-yard grid, used for short forced moves (warrior Charge).
// The search window is the start/goal bounding box plus a margin, so cost
// stays tiny (Charge range is ~25yd). Cells are blocked by static colliders,
// deep water, and uphill steps too steep to climb; the caller supplies those
// thresholds so they can't drift from the movement rules in sim.ts.

export interface PathOpts {
  seed: number;
  bodyRadius: number;
  maxClimbSlope: number; // rise/run above which an uphill step is a wall
  minGround: number; // ground below this height is impassable (deep water)
  maxSpan?: number; // max searched cells per axis
  ignoreFences?: boolean; // treat fences as passable (the mover can jump them)
  // The mover swims, so water is traversable: deep-water cells stay walkable
  // (set minGround low) and for slope purposes their surface — not the lake
  // bottom — is what the body rides, so a sloped bed isn't a wall and the climb
  // check at the shore measures the real waterline-to-bank step.
  swim?: boolean;
}

// Height the mover's body actually rides at a cell: the water surface when
// swimming over submerged ground, the ground itself otherwise. Used only for
// slope/climb gating so an uneven lake bed doesn't read as a cliff.
function rideHeight(h: number, swim: boolean | undefined): number {
  const wl = waterLevel();
  return swim && h < wl ? wl : h;
}

const CELL = 1; // yards
const MARGIN = 8; // yards of slack around the start/goal bounding box
const MAX_SPAN = 64; // cells per axis; beyond this fall back to a straight line
const SMOOTH_SAMPLE_STEP = 0.25; // yards; keeps line-of-sight smoothing inside movement sweep granularity

export const PLAYER_BODY_RADIUS = 0.5;
export const PLAYER_MAX_CLIMB_SLOPE = 1.5;
export const PLAYER_SWIM_DEPTH = 0.8;

function segmentWalkable(
  from: { x: number; z: number },
  to: { x: number; z: number },
  o: PathOpts,
  allowBlockedEnd: boolean,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  if (!o.ignoreFences && pathCrossesFence(from.x, from.z, to.x, to.z, o.bodyRadius)) return false;

  const steps = Math.max(1, Math.ceil(d / SMOOTH_SAMPLE_STEP));
  let prevX = from.x;
  let prevZ = from.z;
  let prevRide = rideHeight(groundHeight(prevX, prevZ, o.seed), o.swim);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const h = groundHeight(x, z, o.seed);
    const isEnd = i === steps;
    if (
      (!isEnd || !allowBlockedEnd) &&
      (h < o.minGround || isBlocked(o.seed, x, z, o.bodyRadius, o.ignoreFences))
    ) {
      return false;
    }
    const ride = rideHeight(h, o.swim);
    const stepLen = Math.hypot(x - prevX, z - prevZ);
    const rise = ride - prevRide;
    if (stepLen > 1e-6 && rise > 0 && rise / stepLen > o.maxClimbSlope) return false;
    prevX = x;
    prevZ = z;
    prevRide = ride;
  }
  return true;
}

function smoothPath(points: { x: number; z: number }[], o: PathOpts): { x: number; z: number }[] {
  if (points.length <= 2) return points.slice(1);

  const out: { x: number; z: number }[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (
      next > anchor + 1 &&
      !segmentWalkable(points[anchor], points[next], o, next === points.length - 1)
    ) {
      next--;
    }
    out.push(points[next]);
    anchor = next;
  }

  return out;
}

// Returns world-space waypoints from `from` to `to`, excluding the start and
// ending exactly at `to`. Falls back to [to] (straight line) when the window
// is too large, the goal is unreachable, or start and goal share a cell.
export function findPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
  o: PathOpts,
): { x: number; z: number }[] {
  const minX = Math.min(from.x, to.x) - MARGIN;
  const minZ = Math.min(from.z, to.z) - MARGIN;
  const W = Math.ceil((Math.max(from.x, to.x) + MARGIN - minX) / CELL);
  const H = Math.ceil((Math.max(from.z, to.z) + MARGIN - minZ) / CELL);
  const maxSpan = o.maxSpan ?? MAX_SPAN;
  if (W > maxSpan || H > maxSpan) return [{ x: to.x, z: to.z }];
  const cx = (gx: number) => minX + (gx + 0.5) * CELL;
  const cz = (gz: number) => minZ + (gz + 0.5) * CELL;
  const toCell = (x: number, z: number) => ({
    gx: Math.min(W - 1, Math.max(0, Math.floor((x - minX) / CELL))),
    gz: Math.min(H - 1, Math.max(0, Math.floor((z - minZ) / CELL))),
  });
  const start = toCell(from.x, from.z);
  const goal = toCell(to.x, to.z);
  const startIdx = start.gz * W + start.gx;
  const goalIdx = goal.gz * W + goal.gx;
  if (startIdx === goalIdx) return [{ x: to.x, z: to.z }];

  // lazy per-cell caches: walkability and ground height
  const walk = new Int8Array(W * H); // 0 unknown, 1 walkable, -1 blocked
  const height = new Float64Array(W * H).fill(NaN);
  const groundAt = (i: number): number => {
    if (Number.isNaN(height[i])) height[i] = groundHeight(cx(i % W), cz((i / W) | 0), o.seed);
    return height[i];
  };
  const walkable = (i: number): boolean => {
    if (walk[i] === 0) {
      // the start and goal cells are always traversable: the mover is already
      // standing on one, and the slide in resolvePosition owns the last yard
      const ok =
        i === startIdx ||
        i === goalIdx ||
        (groundAt(i) >= o.minGround &&
          !isBlocked(o.seed, cx(i % W), cz((i / W) | 0), o.bodyRadius, o.ignoreFences));
      walk[i] = ok ? 1 : -1;
    }
    return walk[i] === 1;
  };

  const gScore = new Float64Array(W * H).fill(Infinity);
  const cameFrom = new Int32Array(W * H).fill(-1);
  // binary min-heap of [fScore, idx]
  const heap: number[][] = [];
  const heapPush = (item: number[]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (heap[par][0] <= heap[i][0]) break;
      [heap[par], heap[i]] = [heap[i], heap[par]];
      i = par;
    }
  };
  const heapPop = (): number[] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const octile = (gx: number, gz: number): number => {
    const dx = Math.abs(gx - goal.gx),
      dz = Math.abs(gz - goal.gz);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL;
  };

  gScore[startIdx] = 0;
  heapPush([octile(start.gx, start.gz), startIdx]);
  let found = false;
  while (heap.length > 0) {
    const [, cur] = heapPop();
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const gx = cur % W,
      gz = (cur / W) | 0;
    const hCur = rideHeight(groundAt(cur), o.swim);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = gx + dx,
          nz = gz + dz;
        if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
        const n = nz * W + nx;
        if (!walkable(n)) continue;
        // diagonals only when both orthogonal cells are clear (no corner clipping)
        if (dx !== 0 && dz !== 0 && (!walkable(gz * W + nx) || !walkable(nz * W + gx))) continue;
        const stepLen = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * CELL;
        const rise = rideHeight(groundAt(n), o.swim) - hCur;
        if (rise > 0 && rise / stepLen > o.maxClimbSlope) continue;
        const g = gScore[cur] + stepLen;
        if (g < gScore[n]) {
          gScore[n] = g;
          cameFrom[n] = cur;
          heapPush([g + octile(nx, nz), n]);
        }
      }
    }
  }
  if (!found) return [{ x: to.x, z: to.z }];

  // reconstruct, then string-pull through any intermediate grid corners that
  // have a direct walkable segment. A* gives legal cells; this converts the
  // 1-yard stair-step route into longer natural legs for movement followers.
  const cells: number[] = [];
  for (let i = goalIdx; i !== -1; i = cameFrom[i]) cells.push(i);
  cells.reverse();
  const points = [
    from,
    ...cells.slice(1, -1).map((cell) => ({ x: cx(cell % W), z: cz((cell / W) | 0) })),
    to,
  ];
  return smoothPath(points, o);
}

export function findPlayerPath(
  seed: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
  maxSpan = 128,
  ignoreFences = false,
  swim = false,
): { x: number; z: number }[] {
  return findPath(from, to, {
    seed,
    bodyRadius: PLAYER_BODY_RADIUS,
    maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
    // Players float on any depth (they tread water at the surface), so when
    // swimming is allowed no ground is "too deep" to enter — only colliders and
    // un-climbable banks stop them. Charge keeps the deep-water cutoff.
    minGround: swim ? -Infinity : waterLevel() - PLAYER_SWIM_DEPTH,
    maxSpan,
    ignoreFences,
    swim,
  });
}

function playerDestinationWalkable(
  seed: number,
  p: { x: number; z: number },
  swim: boolean,
): boolean {
  if (isBlocked(seed, p.x, p.z, PLAYER_BODY_RADIUS)) return false;
  // Swimmers can stop on the water; walkers can't, so deep water is rejected and
  // the caller snaps to the nearest shore.
  return swim || groundHeight(p.x, p.z, seed) >= waterLevel() - PLAYER_SWIM_DEPTH;
}

export function resolvePlayerDestination(
  seed: number,
  target: { x: number; z: number },
  swim = false,
): { x: number; z: number } {
  const pushed = resolvePosition(seed, target.x, target.z, PLAYER_BODY_RADIUS);
  if (playerDestinationWalkable(seed, pushed, swim)) return pushed;

  let best: { x: number; z: number } | null = null;
  let bestD2 = Infinity;
  const rings = 24;
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring * 0.75;
    const samples = Math.max(12, Math.ceil(radius * 10));
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const raw = {
        x: target.x + Math.sin(a) * radius,
        z: target.z + Math.cos(a) * radius,
      };
      const p = resolvePosition(seed, raw.x, raw.z, PLAYER_BODY_RADIUS);
      if (!playerDestinationWalkable(seed, p, swim)) continue;
      const dx = p.x - target.x,
        dz = p.z - target.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        best = p;
        bestD2 = d2;
      }
    }
    if (best) return best;
  }
  return pushed;
}
