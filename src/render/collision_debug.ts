// Dev-cheat collision wireframe: draws the SIM'S OWN colliders (the exact
// shapes resolvePosition blocks with, record colliders, placement boxes and
// prisms, lamps, everything) as line geometry around a point. This is the
// playtest twin of the editor's hitbox overlay, except it cannot lie: it
// renders the resolved collider list itself, so "what you see IS how it
// feels", any disagreement with the editor overlay is a real pipeline bug
// made visible.
//
// The outlines are the RAW collider surfaces, matching the editor overlay
// 1:1. (A felt-wall variant inflated by the 0.5yd body radius was tried and
// reverted: it made every authored shape read as "bigger than what I built
// in Collision Master". The character's centre stopping half a yard before
// the line is expected capsule behavior, not a mismatch.)
import * as THREE from 'three';
import {
  type Collider,
  colliderInternalsForTest,
  colliderTopAt,
  MOVE_TOP_EPS,
  passesUnder,
  prismPolyAt,
} from '../sim/colliders';
import { terrainHeight } from '../sim/world';

const OBB_COLOR = 0x39e6ff; // boxes/prisms: cyan, like the editor overlay
const PRISM_COLOR = 0x7a9bff; // Collision Master banded volumes
const CIRCLE_COLOR = 0xffd100; // legacy circles: gold
const CIRCLE_SEGMENTS = 20;
/** Standing body height (yards): the span a collider must reach into to be
 *  felt by a player on the ground. */
const BODY_HEIGHT = 1.8;
/** Cells of unwalkably steep ground (the live Sim's climb gate) draw as
 *  orange floor markers: that gate blocks movement while emitting NO
 *  collider, which made it the map's one truly invisible wall. */
const STEEP_COLOR = 0xff7a2a;
const STEEP_STEP = 1;

// The static world does not change during a playtest session: resolve the
// collider list once per (seed, generation) and slice it per refresh.
let cached: { seed: number; colliders: readonly Collider[] } | null = null;

function worldColliders(seed: number): readonly Collider[] {
  if (!cached || cached.seed !== seed) {
    cached = { seed, colliders: colliderInternalsForTest.staticWorldColliders(seed) };
  }
  return cached.colliders;
}

/** Drop the cache (a new session/world). */
export function resetCollisionDebugCache(): void {
  cached = null;
}

function pushSeg(
  out: number[],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
): void {
  out.push(x1, y1, z1, x2, y2, z2);
}

function ring(out: number[], x: number, z: number, r: number, y: number): void {
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    pushSeg(
      out,
      x + Math.cos(a0) * r,
      y,
      z + Math.sin(a0) * r,
      x + Math.cos(a1) * r,
      y,
      z + Math.sin(a1) * r,
    );
  }
}

function boxWire(
  out: number[],
  x: number,
  z: number,
  hw: number,
  hd: number,
  rot: number,
  lo: number,
  hi: number,
): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corner = (lx: number, lz: number): [number, number] => [
    x + lx * c + lz * s,
    z - lx * s + lz * c,
  ];
  const pts = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % 4];
    pushSeg(out, ax, lo, az, bx, lo, bz);
    pushSeg(out, ax, hi, az, bx, hi, bz);
    pushSeg(out, ax, lo, az, ax, hi, az);
  }
}

/**
 * Line wireframes for every static collider within `radius` of (x, z).
 * Cheap enough to rebuild every second or two while the cheat is on.
 */
export function buildCollisionWireframe(
  seed: number,
  x: number,
  z: number,
  radius: number,
  isSteepAt?: (px: number, pz: number) => boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'collision-debug';
  const r2 = radius * radius;
  const obb: number[] = [];
  const prism: number[] = [];
  const circle: number[] = [];
  for (const col of worldColliders(seed)) {
    const dx = col.x - x;
    const dz = col.z - z;
    if (dx * dx + dz * dz > r2) continue;
    const ground = terrainHeight(col.x, col.z, seed);
    const lo = col.baseY ?? ground;
    const hi = col.cameraTopY ?? col.moveTopY ?? lo + 2.5;
    if (col.type === 'circle') {
      ring(circle, col.x, col.z, col.r, lo + 0.05);
      ring(circle, col.x, col.z, col.r, hi);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        pushSeg(
          circle,
          col.x + Math.cos(a) * col.r,
          lo + 0.05,
          col.z + Math.sin(a) * col.r,
          col.x + Math.cos(a) * col.r,
          hi,
          col.z + Math.sin(a) * col.r,
        );
      }
    } else if (col.type === 'obb') {
      boxWire(obb, col.x, col.z, col.hw, col.hd, col.rot, lo + 0.05, hi);
    } else {
      // Prism: a LOFTED band draws its authored bottom and top sections with
      // slanted connecting edges - the exact tapered silhouette the maker
      // sees in Collision Master - instead of a flat-walled extrusion of the
      // union hull. Flat bands keep the plain extrusion.
      const bot = col.polyLo ?? col.poly;
      const top = col.polyHi ?? col.poly;
      const n = col.poly.length / 2;
      for (let i = 0; i < n; i++) {
        const j = ((i + 1) % n) * 2;
        pushSeg(
          prism,
          col.x + bot[i * 2],
          lo + 0.05,
          col.z + bot[i * 2 + 1],
          col.x + bot[j],
          lo + 0.05,
          col.z + bot[j + 1],
        );
        pushSeg(
          prism,
          col.x + top[i * 2],
          hi,
          col.z + top[i * 2 + 1],
          col.x + top[j],
          hi,
          col.z + top[j + 1],
        );
        pushSeg(
          prism,
          col.x + bot[i * 2],
          lo + 0.05,
          col.z + bot[i * 2 + 1],
          col.x + top[i * 2],
          hi,
          col.z + top[i * 2 + 1],
        );
      }
    }
  }
  // Steep-ground markers: the climb gate is part of how movement blocks but
  // has no collider, so the wireframe shows it as an orange floor grid, an
  // "invisible wall" made visible. Sampled on a coarse step; only cells the
  // supplied predicate flags draw.
  const steep: number[] = [];
  if (isSteepAt) {
    const reach = Math.min(radius, 30);
    for (let gx = -reach; gx <= reach; gx += STEEP_STEP) {
      for (let gz = -reach; gz <= reach; gz += STEEP_STEP) {
        if (gx * gx + gz * gz > reach * reach) continue;
        const px = x + gx;
        const pz = z + gz;
        if (!isSteepAt(px, pz)) continue;
        const gy = terrainHeight(px, pz, seed) + 0.12;
        const h = STEEP_STEP * 0.45;
        pushSeg(steep, px - h, gy, pz - h, px + h, gy, pz + h);
        pushSeg(steep, px - h, gy, pz + h, px + h, gy, pz - h);
      }
    }
  }
  const addLines = (positions: number[], color: number): void => {
    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 5;
    group.add(lines);
  };
  addLines(obb, OBB_COLOR);
  addLines(prism, PRISM_COLOR);
  addLines(circle, CIRCLE_COLOR);
  addLines(steep, STEEP_COLOR);
  return group;
}

/**
 * Human-readable list of the colliders whose shape comes within `reach` yards
 * of (x, z) at body height y, "what is blocking me HERE". Each line is the
 * collider's src stamp (model path + lane) or, for built-in record colliders,
 * its bare shape. Dedup'd, nearest first.
 */
export function describeNearbyColliders(
  seed: number,
  x: number,
  z: number,
  y: number,
  reach = 2.5,
): string[] {
  const hits = new Map<string, number>();
  for (const col of worldColliders(seed)) {
    const d = Math.hypot(col.x - x, col.z - z);
    const extent =
      col.type === 'circle' ? col.r : col.type === 'obb' ? Math.hypot(col.hw, col.hd) : col.br;
    if (d > extent + reach) continue;
    const ground = terrainHeight(col.x, col.z, seed);
    const lo = col.baseY ?? ground;
    const hi = col.moveTopY ?? col.cameraTopY ?? lo + 2.5;
    if (lo > y + 1.8 || hi < y + 0.1) continue;
    const label = col.src ?? `builtin ${col.type}`;
    const prev = hits.get(label);
    if (prev === undefined || d < prev) hits.set(label, d);
  }
  return [...hits.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([label, d]) => `${d.toFixed(1)}yd ${label}`);
}

/**
 * Can this collider block a body standing with its feet at `y`?
 *
 * Uses the SIM'S OWN gates rather than a hand-rolled height span: a
 * hand-rolled one disagrees at the margins (the resolver requires 2.4yd of
 * clearance to pass beneath, not a 1.8yd body) and every disagreement shows
 * up as a phantom defect in the audit below. Grounded body, so the mantle
 * lift is zero.
 */
export function blocksAtBodyHeight(c: Collider, _seed: number, y: number): boolean {
  if (passesUnder(c, y)) return false;
  if (c.moveTopY !== undefined && colliderTopAt(c, c.x, c.z) <= y + MOVE_TOP_EPS) return false;
  return true;
}

/** Signed distance from (px,pz) to a collider's DRAWN outline: negative
 *  inside. Uses the exact geometry buildCollisionWireframe draws, so an
 *  audit against it is a true self-test rather than a second opinion. */
function signedDistToDrawn(c: Collider, px: number, pz: number, feetY?: number): number {
  if (c.type === 'circle') return Math.hypot(c.x - px, c.z - pz) - c.r;
  if (c.type === 'obb') {
    const co = Math.cos(c.rot);
    const si = Math.sin(c.rot);
    const lx = (px - c.x) * co - (pz - c.z) * si;
    const lz = (px - c.x) * si + (pz - c.z) * co;
    const dx = Math.abs(lx) - c.hw;
    const dz = Math.abs(lz) - c.hd;
    if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
    return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  }
  const poly = prismPolyAt(c, feetY);
  const n = poly.length / 2;
  let inside = true;
  let minD = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = c.x + poly[i * 2];
    const az = c.z + poly[i * 2 + 1];
    const bx = c.x + poly[((i + 1) % n) * 2];
    const bz = c.z + poly[((i + 1) % n) * 2 + 1];
    if ((bx - ax) * (pz - az) - (bz - az) * (px - ax) < 0) inside = false;
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)),
    );
    minD = Math.min(minD, Math.hypot(px - (ax + vx * t), pz - (az + vz * t)));
  }
  return inside ? -minD : minD;
}

/**
 * Self-test: does the world actually BLOCK where the wireframe is DRAWN?
 *
 * Samples a grid around (x, z) at the body's own height and compares two
 * independent answers per cell, "is a body of `body` radius pushed out here"
 * (the sim's resolver, i.e. what the player feels) against "is this cell
 * within `body` of a drawn outline" (what the player sees). Any disagreement
 * is a real pipeline bug, named by the offending collider's `src` stamp.
 *
 * `resolve` is injected so this module keeps importing only collider TYPES
 * from the sim and the caller supplies the live resolver.
 */
export function auditCollisionAround(
  seed: number,
  x: number,
  z: number,
  y: number,
  resolve: (px: number, pz: number, r: number) => { x: number; z: number },
  radius = 10,
  body = 0.5,
): string[] {
  // EXACTLY the set buildCollisionWireframe draws: every collider whose
  // shape reaches the sweep, with NO height filter, the wireframe has none
  // either, and the resolver this audits is likewise height-agnostic, so
  // filtering one side and not the other invents mismatches that no player
  // can feel. (`y` is kept for callers/telemetry and future mover-aware runs.)
  const cols = worldColliders(seed).filter((c) => {
    const ext = c.type === 'circle' ? c.r : c.type === 'obb' ? Math.hypot(c.hw, c.hd) : c.br;
    // Must keep every collider that can reach ANY sampled cell, or a real
    // blocker drops out of the drawn set and the audit invents an invisible
    // wall out of its own windowing. Cells are sampled inside `radius`, so
    // reach is radius + the collider's own extent + one body.
    if (Math.hypot(c.x - x, c.z - z) > radius + ext + body + 1) return false;
    // ...and only the ones that can block a body STANDING HERE. The resolver
    // this audits is mover-aware (it passes a body under an overhang and over
    // a low top), so comparing it against every drawn line, including the
    // upper bands of a tall authored volume, would report the overhang the
    // player correctly walks under as a defect.
    return blocksAtBodyHeight(c, seed, y);
  });
  // Below the sampling step the numbers are quantization, not a defect.
  const NOISE = 0.15;
  let wallWorst = 0;
  let wallAt: Collider | null = null;
  let ghostWorst = 0;
  let ghostAt: Collider | null = null;
  let samples = 0;
  for (let gx = -radius; gx <= radius; gx += 0.25) {
    for (let gz = -radius; gz <= radius; gz += 0.25) {
      // Sample the DISC, not the square: a square's corners sit radius*sqrt2
      // out, past what the collider window above can honestly cover.
      if (gx * gx + gz * gz > radius * radius) continue;
      const px = x + gx;
      const pz = z + gz;
      samples++;
      let sd = Infinity;
      let nearest: Collider | null = null;
      for (const c of cols) {
        const d = signedDistToDrawn(c, px, pz, y);
        if (d < sd) {
          sd = d;
          nearest = c;
        }
      }
      if (!Number.isFinite(sd)) continue;
      const r = resolve(px, pz, body);
      const push = Math.hypot(r.x - px, r.z - pz);
      const blocked = push > 0.02;
      const shouldBlock = sd < body - 0.02;
      // An invisible wall has to be BOTH: a real shove (not the resolver's
      // epsilon nudge) AND a cell that no drawn line reaches. Requiring only
      // the second turned 4cm nudges into "5yd wall" reports whose number was
      // really just the distance to the nearest line.
      if (blocked && push > NOISE && !shouldBlock && sd - body > wallWorst) {
        wallWorst = sd - body;
        wallAt = nearest;
      }
      if (!blocked && sd < -NOISE && -sd > ghostWorst) {
        ghostWorst = -sd;
        ghostAt = nearest;
      }
    }
  }
  const out = [`${samples} cells checked, r=${radius}yd`];
  if (wallWorst > NOISE) {
    out.push(`INVISIBLE WALL ${wallWorst.toFixed(2)}yd past the line, ${wallAt?.src ?? 'builtin'}`);
  }
  if (ghostWorst > NOISE) {
    out.push(
      `WALK-THROUGH ${ghostWorst.toFixed(2)}yd inside the line, ${ghostAt?.src ?? 'builtin'}`,
    );
  }
  if (out.length === 1) out.push('MATCHES: blocking agrees with every drawn line');
  return out;
}

/** Dispose a group built by buildCollisionWireframe. */
export function disposeCollisionWireframe(group: THREE.Group): void {
  for (const child of group.children) {
    const lines = child as THREE.LineSegments;
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
  }
  group.clear();
}
