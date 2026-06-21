import { generateDecorations, groundHeight } from './world';
import {
  DUNGEON_X_THRESHOLD, INSTANCE_SLOT_COUNT, PROPS, arenaOriginAt, dungeonAt, instanceOrigin, isArenaPos,
} from './data';
import { ARENA_LAYOUT, CRYPT_LAYOUT, NYTHRAXIS_LAYOUT, SANCTUM_LAYOUT, TEMPLE_LAYOUT, layoutColliders } from './dungeon_layout';

// Static world collision. Prop placement comes from the per-zone content
// modules (merged into PROPS by sim/data.ts): the renderer builds its meshes
// from the same defs, so what you see is what you collide with.
// Sim layer: no three.js imports.

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
  /** Absolute world-space top used by camera occlusion; movement ignores it. */
  cameraTopY?: number;
  /**
   * When true the chase cam ray passes straight through this collider (no
   * pull-in). Movement still collides. Used for props that the renderer hides
   * when they cross the eye-to-camera segment instead of zooming in.
   */
  camGhost?: boolean;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
  /** Absolute world-space top used by camera occlusion; movement ignores it. */
  cameraTopY?: number;
  /** See {@link CircleCollider.camGhost}. */
  camGhost?: boolean;
  /**
   * Low fence rail: a grounded mover collides normally, but a mover that is
   * airborne above the rail (see `FENCE_RAIL_HEIGHT`) jumps clear of it. Set on
   * the OBBs built from `PROPS.fences`.
   */
  isFence?: boolean;
}

export type Collider = CircleCollider | ObbCollider;

function topY(seed: number, x: number, z: number, height: number): number {
  return groundHeight(x, z, seed) + height;
}

// rotate a local offset by a three.js rotation.y angle
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

// ---------------------------------------------------------------------------
// Collider sets
// ---------------------------------------------------------------------------

function staticWorldColliders(seed: number): Collider[] {
  const out: Collider[] = [];

  // Hideable render props are `camGhost`: they keep blocking movement but the
  // chase cam no longer pulls in for them; the renderer hides whichever one
  // crosses the eye-to-camera segment instead.
  for (const b of PROPS.buildings) {
    const height = b.kind === 'chapel' ? 10.8 : b.kind === 'inn' ? 7.8 : 8.0;
    out.push({ type: 'obb', x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot, cameraTopY: topY(seed, b.x, b.z, height), camGhost: true });
  }
  for (const w of PROPS.wells) out.push({ type: 'circle', x: w.x, z: w.z, r: w.r, cameraTopY: topY(seed, w.x, w.z, 3.7), camGhost: true });
  for (const s of PROPS.stalls) out.push({ type: 'circle', x: s.x, z: s.z, r: s.r, cameraTopY: topY(seed, s.x, s.z, 3.1), camGhost: true });

  // mines: mound behind the timber portal
  for (const m of PROPS.mines) {
    const mound = rotY(0, -3.4, m.rot);
    const x = m.x + mound.x, z = m.z + mound.z;
    out.push({ type: 'circle', x, z, r: 5, cameraTopY: topY(seed, x, z, 5.2), camGhost: true });
  }

  // dock huts
  for (const d of PROPS.docks) {
    const hut = rotY(d.hutLocal.x, d.hutLocal.z, d.rot);
    const x = d.x + hut.x, z = d.z + hut.z;
    out.push({ type: 'obb', x, z, hw: d.hutLocal.hw, hd: d.hutLocal.hd, rot: d.rot, cameraTopY: topY(seed, x, z, 2.9), camGhost: true });
  }

  for (const t of PROPS.tents) out.push({ type: 'circle', x: t.x, z: t.z, r: 1.5 * t.scale, cameraTopY: topY(seed, t.x, t.z, 3.4 * t.scale), camGhost: true });
  for (const [x, z] of PROPS.crates) out.push({ type: 'circle', x, z, r: 0.65, cameraTopY: topY(seed, x, z, 1.35), camGhost: true });
  for (const [x, z] of PROPS.campfires) out.push({ type: 'circle', x, z, r: 0.85, cameraTopY: topY(seed, x, z, 1.45), camGhost: true });
  for (const [x, z] of PROPS.mudHuts) out.push({ type: 'circle', x, z, r: 1.1, cameraTopY: topY(seed, x, z, 12.5), camGhost: true });
  for (const ruin of PROPS.ruinRings) {
    for (let i = 0; i < ruin.columns; i++) {
      const ang = (i / ruin.columns) * Math.PI * 2;
      const x = ruin.x + Math.sin(ang) * ruin.ringR, z = ruin.z + Math.cos(ang) * ruin.ringR;
      out.push({ type: 'circle', x, z, r: 0.6, cameraTopY: topY(seed, x, z, 4.3), camGhost: true });
    }
  }
  for (const f of PROPS.fences) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const x = (f.x1 + f.x2) / 2, z = (f.z1 + f.z2) / 2;
    out.push({
      type: 'obb',
      x,
      z,
      hw: len / 2 + FENCE_END_PAD,
      hd: FENCE_HALF_DEPTH,
      rot: Math.atan2(-dz, dx),
      cameraTopY: topY(seed, x, z, FENCE_RAIL_HEIGHT),
      camGhost: true,
      isFence: true,
    });
  }

  // trees & large rocks from the deterministic decoration field
  for (const d of generateDecorations(seed)) {
    if (d.kind === 'rock') {
      if (d.scale >= 0.8) out.push({ type: 'circle', x: d.x, z: d.z, r: 0.7 * d.scale, cameraTopY: topY(seed, d.x, d.z, 1.25 * d.scale) });
    } else {
      // tree trunks only — canopies don't block
      out.push({ type: 'circle', x: d.x, z: d.z, r: 0.55 * d.scale, cameraTopY: topY(seed, d.x, d.z, 7.5 * d.scale), camGhost: true });
    }
  }
  return out;
}

// Interior collision sets, in instance-local coordinates. Derived from the
// SAME plain-data layouts the renderer builds the KayKit modules from
// (sim/dungeon_layout.ts), so render geometry and collision can no longer
// drift apart. The boss dais is walkable and deliberately has no collider.
const CRYPT_COLLIDERS: Collider[] = layoutColliders(CRYPT_LAYOUT);
const SANCTUM_COLLIDERS: Collider[] = layoutColliders(SANCTUM_LAYOUT);
const TEMPLE_COLLIDERS: Collider[] = layoutColliders(TEMPLE_LAYOUT);
const ARENA_COLLIDERS: Collider[] = layoutColliders(ARENA_LAYOUT);
const NYTHRAXIS_COLLIDERS: Collider[] = layoutColliders(NYTHRAXIS_LAYOUT);

// Interior collider sets keyed by DungeonDef.interior.
const INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  crypt: CRYPT_COLLIDERS,
  sanctum: SANCTUM_COLLIDERS,
  temple: TEMPLE_COLLIDERS,
  nythraxis: NYTHRAXIS_COLLIDERS,
};

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

const GRID_CELL = 16;
const MAX_BODY_RADIUS = 0.8; // largest mover we resolve for
const FENCE_HALF_DEPTH = 0.35;
const FENCE_END_PAD = 0.35;
/** Rail height of a fence (yards), used for camera occlusion. A jump passes
 * through fences while airborne regardless (see sim `Entity.jumping`). */
const FENCE_RAIL_HEIGHT = 2.8;

interface ColliderGrid {
  cells: Map<string, Collider[]>;
}

const gridCache = new Map<number, ColliderGrid>();

function colliderBounds(c: Collider): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  const ext = Math.hypot(c.hw, c.hd);
  return { minX: c.x - ext, maxX: c.x + ext, minZ: c.z - ext, maxZ: c.z + ext };
}

function gridFor(seed: number): ColliderGrid {
  let grid = gridCache.get(seed);
  if (grid) return grid;
  grid = { cells: new Map() };
  for (const c of staticWorldColliders(seed)) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx + ',' + gz;
        const list = grid.cells.get(key);
        if (list) list.push(c);
        else grid.cells.set(key, [c]);
      }
    }
  }
  gridCache.set(seed, grid);
  return grid;
}

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
function pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
  if (c.type === 'circle') {
    const dx = x - c.x, dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z };
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  // OBB: into local frame
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r, ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const pushX = ex - Math.abs(local.x);
  const pushZ = ez - Math.abs(local.z);
  const out = { x: local.x, z: local.z };
  if (pushX < pushZ) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

function resolveAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences = false,
): { x: number; z: number } {
  let px = x, pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      if (ignoreFences && c.type === 'obb' && c.isFence) continue;
      const res = pushOut(c, px, pz, r);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

function instanceLocal(x: number, z: number): { ox: number; oz: number; interior: string } {
  const dungeon = dungeonAt(x);
  const index = dungeon?.index ?? 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(index, i);
    const d = Math.abs(z - o.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  const o = instanceOrigin(index, best);
  return { ox: o.x, oz: o.z, interior: dungeon?.interior ?? 'crypt' };
}

// Resolve a movement destination against all static geometry. Movers slide
// along obstacles. `r` is the body radius.
export function resolvePosition(
  seed: number,
  x: number,
  z: number,
  r = 0.5,
  ignoreFences = false,
): { x: number; z: number } {
  if (isArenaPos(x)) {
    const o = arenaOriginAt(z);
    const local = resolveAgainst(ARENA_COLLIDERS, x - o.x, z - o.z, r, ignoreFences);
    return { x: local.x + o.x, z: local.z + o.z };
  }
  if (x > DUNGEON_X_THRESHOLD) {
    const { ox, oz, interior } = instanceLocal(x, z);
    const colliders = INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS;
    const local = resolveAgainst(colliders, x - ox, z - oz, r, ignoreFences);
    return { x: local.x + ox, z: local.z + oz };
  }
  const grid = gridFor(seed);
  const key = Math.floor(x / GRID_CELL) + ',' + Math.floor(z / GRID_CELL);
  const list = grid.cells.get(key);
  if (!list) return { x, z };
  return resolveAgainst(list, x, z, r, ignoreFences);
}

function crossesFence(fromX: number, fromZ: number, toX: number, toZ: number, r: number): boolean {
  for (const f of PROPS.fences) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;
    const fromRelX = fromX - f.x1, fromRelZ = fromZ - f.z1;
    const toRelX = toX - f.x1, toRelZ = toZ - f.z1;
    const fromSide = fromRelX * nx + fromRelZ * nz;
    const toSide = toRelX * nx + toRelZ * nz;
    if (fromSide === 0 && toSide === 0) continue;
    if (fromSide * toSide > 0) continue;
    const denom = fromSide - toSide;
    const t = Math.abs(denom) < 1e-6 ? 0 : fromSide / denom;
    if (t < 0 || t > 1) continue;
    const hitX = fromX + (toX - fromX) * t;
    const hitZ = fromZ + (toZ - fromZ) * t;
    const along = (hitX - f.x1) * ux + (hitZ - f.z1) * uz;
    if (along >= -FENCE_END_PAD - r && along <= len + FENCE_END_PAD + r) return true;
  }
  return false;
}

export function resolveMovement(
  seed: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  r = 0.5,
  ignoreFences = false,
): { x: number; z: number } {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return resolvePosition(seed, toX, toZ, r, ignoreFences);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  let x = fromX, z = fromZ;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nextX = fromX + dx * t;
    const nextZ = fromZ + dz * t;
    if (!ignoreFences && crossesFence(x, z, nextX, nextZ, r)) break;
    const resolved = resolvePosition(seed, nextX, nextZ, r, ignoreFences);
    x = resolved.x;
    z = resolved.z;
    if (Math.hypot(x - nextX, z - nextZ) > r * 0.25) {
      const remainingX = toX - nextX;
      const remainingZ = toZ - nextZ;
      const correctionX = x - nextX;
      const correctionZ = z - nextZ;
      if (remainingX * correctionX + remainingZ * correctionZ < 0) break;
    }
  }
  return { x, z };
}

export function isBlocked(seed: number, x: number, z: number, r = 0.5, ignoreFences = false): boolean {
  const res = resolvePosition(seed, x, z, r, ignoreFences);
  return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
}

// Would a straight move from (fromX,fromZ) to (toX,toZ) cross a fence line?
// Used by click-to-move to fire a jump just before reaching a fence it has
// routed through, since the player can hop over fences but not walk through.
export function pathCrossesFence(fromX: number, fromZ: number, toX: number, toZ: number, r = 0.5): boolean {
  return crossesFence(fromX, fromZ, toX, toZ, r);
}

// ---------------------------------------------------------------------------
// Camera occlusion — third-person chase-cam pull-in
// ---------------------------------------------------------------------------
// The renderer sweeps a ray from the player's head (`a`) toward the desired
// camera position (`b`) and pulls the camera in to the surface of the first
// static obstacle in between, so the chase cam never sits inside a wall.
// Pure XZ math against the SAME colliders movement uses (what you see is what
// you collide with). Returns the fraction of the a->b segment the camera may
// travel before the first occluder (1 = unobstructed). Open-world colliders
// carry precomputed `cameraTopY` values, so large rocks still pull the camera
// in only when the ray passes below their visual top. Hideable props are
// flagged `camGhost` and skipped entirely (the renderer hides them instead).

// First entry param t along a->b for a circle (radius already padded).
// Infinity = no hit; we also bail when `a` is already inside (never slam the
// camera onto the player).
function rayCircleEntry(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number,
): number {
  const dx = bx - ax, dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx, fz = az - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c < 0) return Infinity; // origin inside the circle
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

// First entry param t along a->b for an OBB (extents already padded).
function rayObbEntry(c: ObbCollider, ax: number, az: number, bx: number, bz: number, pad: number): number {
  const la = rotY(ax - c.x, az - c.z, -c.rot);
  const lb = rotY(bx - c.x, bz - c.z, -c.rot);
  const ex = c.hw + pad, ez = c.hd + pad;
  if (Math.abs(la.x) < ex && Math.abs(la.z) < ez) return Infinity; // origin inside the box
  const dx = lb.x - la.x, dz = lb.z - la.z;
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (la.x < -ex || la.x > ex) return Infinity;
  } else {
    let t1 = (-ex - la.x) / dx, t2 = (ex - la.x) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (la.z < -ez || la.z > ez) return Infinity;
  } else {
    let t1 = (-ez - la.z) / dz, t2 = (ez - la.z) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin;
}

// Minimum entry fraction over one collider list (1 = clear). `infinite` skips
// the height gate (interior walls are full-height; the open world is not).
function sweepColliders(
  list: Collider[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  pad: number, infinite: boolean,
): number {
  let best = 1;
  for (const c of list) {
    if (c.camGhost) continue; // chase cam passes through; renderer hides it instead
    const t = c.type === 'circle'
      ? rayCircleEntry(ax, az, bx, bz, c.x, c.z, c.r + pad)
      : rayObbEntry(c, ax, az, bx, bz, pad);
    if (!(t > 1e-4) || t >= best) continue;
    if (!infinite && c.cameraTopY !== undefined && ay + (by - ay) * t > c.cameraTopY) continue;
    best = t;
  }
  return best;
}

// Fraction of the head->camera segment the chase cam may travel before the
// first static occluder. `a` is the look-at pivot (player head), `b` the
// desired camera position. Mirrors resolvePosition's region split.
export function cameraOcclusion(
  seed: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  pad = 0.35,
): number {
  if (isArenaPos(ax)) {
    const o = arenaOriginAt(az);
    return sweepColliders(ARENA_COLLIDERS, ax - o.x, ay, az - o.z, bx - o.x, by, bz - o.z, pad, true);
  }
  if (ax > DUNGEON_X_THRESHOLD) {
    const { ox, oz, interior } = instanceLocal(ax, az);
    const colliders = INTERIOR_COLLIDERS[interior] ?? CRYPT_COLLIDERS;
    return sweepColliders(colliders, ax - ox, ay, az - oz, bx - ox, by, bz - oz, pad, true);
  }
  const grid = gridFor(seed);
  const gx0 = Math.floor(Math.min(ax, bx) / GRID_CELL), gx1 = Math.floor(Math.max(ax, bx) / GRID_CELL);
  const gz0 = Math.floor(Math.min(az, bz) / GRID_CELL), gz1 = Math.floor(Math.max(az, bz) / GRID_CELL);
  let best = 1;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const list = grid.cells.get(gx + ',' + gz);
      if (list) best = Math.min(best, sweepColliders(list, ax, ay, az, bx, by, bz, pad, false));
    }
  }
  return best;
}

export function lineOfSightClear(
  seed: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
  r = 0.05,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const steps = Math.max(2, Math.ceil(d / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (isBlocked(seed, x, z, r)) return false;
  }
  return true;
}
