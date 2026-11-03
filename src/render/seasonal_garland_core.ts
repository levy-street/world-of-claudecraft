// The strung seasonal garland's shape (pure, no Three): the sagging curve
// between its two posts and where its leaf clusters and lantern beads hang along
// it. The resolver (src/sim/seasonal_decor_layout.ts) decides WHICH posts are
// strung; this decides how the rope hangs between them. Deterministic: ornament
// variety comes from the garland's own index, never from a random draw.

export interface GarlandEnds {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  sag: number;
}

export interface GarlandPoint {
  x: number;
  y: number;
  z: number;
}

export interface GarlandOrnament extends GarlandPoint {
  kind: 'leaf' | 'bead';
  /** Yaw of the rope's run at that point, so a leaf cluster faces across it. */
  yaw: number;
  /** A small per-ornament spin and size so a run never looks stamped. */
  spin: number;
  scale: number;
}

/** A point on the rope at t in [0, 1]: the straight line between the posts,
 *  dropped by a parabolic sag that is deepest at the middle. */
export function garlandPointAt(g: GarlandEnds, t: number): GarlandPoint {
  return {
    x: g.ax + (g.bx - g.ax) * t,
    y: g.ay + (g.by - g.ay) * t - g.sag * 4 * t * (1 - t),
    z: g.az + (g.bz - g.az) * t,
  };
}

/** The rope as a polyline: about one sample per half yard, at least 8. */
export function garlandPolyline(g: GarlandEnds): GarlandPoint[] {
  const span = Math.hypot(g.bx - g.ax, g.bz - g.az);
  const n = Math.max(8, Math.ceil(span * 2));
  const out: GarlandPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(garlandPointAt(g, i / n));
  return out;
}

const LEAF_STEP = 0.42;
const BEAD_STEP = 1.9;
const END_MARGIN = 0.5;

function fract(v: number): number {
  return v - Math.floor(v);
}

/** Leaf clusters every ~0.4 yd and a paper bead every ~1.9 yd, hung under the
 *  rope, skipping the knots at each post. `index` seeds the variety. */
export function garlandOrnaments(g: GarlandEnds, index: number): GarlandOrnament[] {
  const span = Math.hypot(g.bx - g.ax, g.bz - g.az);
  if (span < END_MARGIN * 3) return [];
  const yaw = Math.atan2(g.bx - g.ax, g.bz - g.az);
  const out: GarlandOrnament[] = [];
  let k = 0;
  for (let d = END_MARGIN; d <= span - END_MARGIN; d += LEAF_STEP, k++) {
    const p = garlandPointAt(g, d / span);
    const h = fract(Math.sin(index * 12.9898 + k * 78.233) * 43758.5453);
    out.push({
      ...p,
      y: p.y - 0.06,
      kind: 'leaf',
      yaw,
      spin: h * Math.PI * 2,
      scale: 0.85 + 0.35 * h,
    });
  }
  let j = 0;
  for (let d = BEAD_STEP * 0.5; d <= span - END_MARGIN; d += BEAD_STEP, j++) {
    const p = garlandPointAt(g, d / span);
    const h = fract(Math.sin(index * 4.1414 + j * 19.19) * 23421.631);
    out.push({
      ...p,
      y: p.y - 0.16,
      kind: 'bead',
      yaw,
      spin: h * Math.PI * 2,
      scale: 0.9 + 0.2 * h,
    });
  }
  return out;
}
