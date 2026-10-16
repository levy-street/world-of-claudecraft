// Pure cave-generation math for the map editor's Caves tool: the maker drops
// a rig of control points (entrance first, exit last, any number of blue
// waypoints between), and the cave's node chain is GENERATED through them
// (and re-generated whenever any point moves). Vitest-importable: all wobble
// noise is seeded.
//
// TERRAIN-INDEPENDENT BY CONTRACT. The generator never reads the surface: a
// control point's y IS the cave floor there, its girth IS the bore radius
// there, and the two mouths land EXACTLY on their rig points at exactly their
// authored size. Translating every control point by one delta translates the
// generated cave rigidly (the same wobble re-derives from arc length), which
// is what lets the editor move a whole finished cave into place without the
// shape drifting.

import { hash2, noise2 } from '../sim/rng';
import type { CaveNode } from '../sim/types';

// Radius clamps mirrored from sim/caves.ts sanitizer bounds.
const GEN_MIN_RADIUS = 1.5;
const GEN_MAX_RADIUS = 20;
// Lateral wobble amplitude at variance 1, in bore radii; radius wobble share.
const WOBBLE_LATERAL = 1.6;
const WOBBLE_RADIUS = 0.45;
// The wobble fades to ZERO across this many yards at each end (scaled by the
// bore radius, see mouthFadeYards): the mouths are the one non-negotiable ?
// they stay exactly where and exactly as big as authored.
const MOUTH_FADE_MIN_YARDS = 3;
const MOUTH_FADE_MAX_YARDS = 10;
// Spline sub-sampling per control segment before the even arc resample.
const SPLINE_SUBDIV = 12;

export interface CaveRigOptions {
  /** Organic wobble [0,1]: lateral path noise + radius variation. */
  variance?: number;
  /** Seed for the deterministic wobble noise. */
  seed?: number;
}

export interface CaveRigPoint {
  x: number;
  /** ABSOLUTE floor height of the cave at this point. */
  y: number;
  z: number;
  /** Per-point girth multiplier (the editor maps a rig point's gizmo scale
   *  here), applied to the cave's base radius. */
  r?: number;
}

/** Catmull-Rom basis (uniform): smooth interpolation through p1..p2. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Generate the node chain for a cave through a rig of control points
 * (entrance first, exit last, any number of waypoints between).
 * - The path is a Catmull-Rom spline through the control points in FULL 3D
 *   (x, y, z): the floor runs exactly through every authored height. No
 *   terrain reads, no clamping, no grade relaxation ? what you model is what
 *   you get.
 * - Per-point girth multipliers interpolate along the path; the mouths keep
 *   their authored girth EXACTLY.
 * - `variance` bends the path organically and wobbles the bore radius
 *   between the control points; it fades to zero at both mouths.
 */
export function generateCaveRigNodes(
  points: readonly CaveRigPoint[],
  radius: number,
  opts: CaveRigOptions = {},
): CaveNode[] {
  // Drop consecutive near-duplicates (a double-clicked rig point).
  const pts: { x: number; y: number; z: number; r: number }[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= 0.75) {
      pts.push({
        x: p.x,
        y: p.y,
        z: p.z,
        r: Math.min(6, Math.max(0.25, p.r ?? 1)),
      });
    }
  }
  if (pts.length < 2) return [];

  // Densely sub-sample the spline, then resample evenly by XZ arc length so
  // node spacing tracks the bore scale (the sim's capsule chain interpolates
  // linearly between nodes; even short spacing keeps that faithful).
  const fine: { x: number; y: number; z: number; r: number; arc: number }[] = [];
  const at = (i: number): { x: number; y: number; z: number; r: number } =>
    pts[Math.max(0, Math.min(pts.length - 1, i))];
  let arc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const from = i === 0 ? 0 : 1; // segment joints share a sample
    for (let k = from; k <= SPLINE_SUBDIV; k++) {
      const t = k / SPLINE_SUBDIV;
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);
      // Girth interpolates LINEARLY (a spline could overshoot through zero).
      const r = p1.r + (p2.r - p1.r) * t;
      const prev = fine[fine.length - 1];
      if (prev) arc += Math.hypot(x - prev.x, z - prev.z);
      fine.push({ x, y, z, r, arc });
    }
  }
  const total = fine[fine.length - 1]?.arc ?? 0;
  if (total < 2) return [];

  const variance = Math.min(1, Math.max(0, opts.variance ?? 0));
  const seed = opts.seed ?? 0;
  const step = Math.max(2, Math.min(6, radius * 0.6));
  const n = Math.max(2, Math.ceil(total / step));
  const mouthFade = Math.max(MOUTH_FADE_MIN_YARDS, Math.min(MOUTH_FADE_MAX_YARDS, radius * 1.5));

  const nodes: CaveNode[] = [];
  let fi = 0;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * total;
    while (fi + 1 < fine.length && fine[fi + 1].arc < target) fi++;
    const a = fine[fi];
    const b = fine[Math.min(fine.length - 1, fi + 1)];
    const span = b.arc - a.arc;
    const u = span > 1e-9 ? Math.min(1, Math.max(0, (target - a.arc) / span)) : 0;
    let x = a.x + (b.x - a.x) * u;
    let z = a.z + (b.z - a.z) * u;
    const y = a.y + (b.y - a.y) * u;
    let rMult = a.r + (b.r - a.r) * u;

    // Wobble fade: 0 at both mouths, 1 past mouthFade yards inside.
    const endDist = Math.min(target, total - target);
    const wRaw = Math.min(1, endDist / mouthFade);
    const fade = wRaw * wRaw * (3 - 2 * wRaw);
    if (variance > 0 && fade > 0.001) {
      // Lateral (perpendicular) offset from seeded value noise, applied in XZ.
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-6) {
        const wave = noise2(target * 0.12, 7.3, seed) - 0.5;
        const amp = variance * radius * WOBBLE_LATERAL * fade;
        x += (-dz / len) * wave * 2 * amp;
        z += (dx / len) * wave * 2 * amp;
      }
      const rWave = hash2(i, 31.7, seed) - 0.5;
      rMult *= 1 + rWave * 2 * variance * WOBBLE_RADIUS * fade;
    }
    nodes.push({
      x,
      y,
      z,
      radius: Math.min(GEN_MAX_RADIUS, Math.max(GEN_MIN_RADIUS, radius * rMult)),
    });
  }
  // The mouths land EXACTLY on their rig points at exactly the authored size
  // (the resample above already puts i=0 / i=n on the endpoints; restate the
  // girth so no clamp/rounding drifts it).
  const first = pts[0];
  const last = pts[pts.length - 1];
  nodes[0] = {
    x: first.x,
    y: first.y,
    z: first.z,
    radius: Math.min(GEN_MAX_RADIUS, Math.max(GEN_MIN_RADIUS, radius * first.r)),
  };
  nodes[nodes.length - 1] = {
    x: last.x,
    y: last.y,
    z: last.z,
    radius: Math.min(GEN_MAX_RADIUS, Math.max(GEN_MIN_RADIUS, radius * last.r)),
  };
  return nodes;
}
