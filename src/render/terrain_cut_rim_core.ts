// The rim band a terrain cut leaves behind: marching squares over a chunk's
// own grid, extruded into a downward skirt with its own normals.
//
// WHY THIS EXISTS. v1 cut the ground with a discard in the terrain shader, so
// the opening had no rim geometry to texture, no thickness to the sheet, and
// no way to blend cave rock into terrain material at the seam. It read as a
// paper edge. Cutting at MESH BUILD time instead (terrain_chunk_build.ts drops
// the quads inside the solid) leaves a real boundary, and this is the band
// that gives it depth.
//
// Pure arithmetic over plain typed arrays. No Three, no DOM, no WebGL, so it
// runs in the chunk worker beside the mesher that calls it and the result is
// transferable. Deliberately named *_core for exactly that reason.
//
// The contour follows the SURFACE: each grid corner is tested at
// (x, terrainHeight(x, z), z), which is the same question sim movement asks
// through inTerrainCut. Both sides therefore agree on where the ground stops.

/** Everything the rim needs, all of it supplied by the caller. */
export interface CutRimInput {
  /** Grid origin (world yards) and extent. */
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  stepX: number;
  stepZ: number;
  /** How far the band hangs below the rim, in yards. */
  depth: number;
  /** Per-segment depth override, sampled at the segment midpoint. A value of
   *  0 (or less) SKIPS the segment — no lip, no wall. Carve cuts use that:
   *  their cavity mesh IS the wall (clipped to the same surface), so the
   *  ground flows straight into the interior with no skirt band at all.
   *  Legacy holes keep the full curtain. */
  depthAt?(x: number, z: number): number;
  /** How far the lip flares OUTWARD from the contour, in yards. The mesher
   *  drops a whole quad when its centre falls inside the cut, so the surviving
   *  terrain edge lands anywhere within half a cell either side of the
   *  contour; a lip at least one cell wide, sunk just under the surface, is
   *  what stops that ragged edge showing daylight. Defaults to one cell. */
  flare?: number;
  /** How far the wall's TOP edge (and the lip's inner edge) sits under the
   *  surface. Defaults to RIM_SINK, the v1 behaviour, where the ragged
   *  dropped-quad edge overhangs and hides it. The fine-clip path passes 0:
   *  its surface patch ends exactly on the contour, so the wall must meet it
   *  there. */
  sinkTop?: number;
  /** Terrain surface height at a world XZ. */
  heightAt(x: number, z: number): number;
  /** The cut field at the SURFACE point over (x, z): negative inside the cut,
   *  positive outside. Callers pass cutsSdfAt bound to the surface height. */
  fieldAt(x: number, z: number): number;
}

/** Plain arrays, the same shape the chunk mesher hands back. */
export interface CutRimArrays {
  positions: Float32Array;
  normals: Float32Array;
  /** u = distance along the rim in yards, v = 0 at the bottom, `depth` at the
   *  top. Yards, not 0..1, so one texture repeat is a fixed size whatever the
   *  opening's circumference. */
  uvs: Float32Array;
  indices: Uint32Array;
}

// A cut whose contour wanders through more cells than this in one chunk is
// either a pathological document or a bug; stop rather than grow unbounded.
const MAX_RIM_SEGMENTS = 20000;
// Contour vertices closer than this to a cell corner snap to it, which keeps
// neighbouring cells agreeing on a shared point instead of leaving a crack.
const SNAP_EPS = 1e-4;
// The lip sits this far under the terrain surface, so where it overlaps ground
// that survived the cut it hides beneath rather than z-fighting with it.
const RIM_SINK = 0.06;

/** Marching-squares edge crossing, linearly interpolated on the field.
 *  Exported so the fine-clip core (terrain_cut_clip_core.ts) resolves its
 *  crossings with the SAME arithmetic: the wall's top edge and the clipped
 *  surface edge must be one point list. */
export function lerpEdge(
  ax: number,
  az: number,
  av: number,
  bx: number,
  bz: number,
  bv: number,
): [number, number] {
  const denom = av - bv;
  let t = Math.abs(denom) < 1e-9 ? 0.5 : av / denom;
  if (t < SNAP_EPS) t = 0;
  else if (t > 1 - SNAP_EPS) t = 1;
  return [ax + (bx - ax) * t, az + (bz - az) * t];
}

// Marching-squares case table. Corner bits, counter-clockwise in XZ:
//   bit 0 = (i,   j  )   bit 1 = (i+1, j  )
//   bit 2 = (i+1, j+1)   bit 3 = (i,   j+1)
// A bit is set when that corner is INSIDE the cut. Edge ids run between
// consecutive corners: 0 = bit0-bit1, 1 = bit1-bit2, 2 = bit2-bit3,
// 3 = bit3-bit0. Each case lists the edge pairs that carry a segment; the
// two saddle cases (5 and 10) emit both segments, which keeps a pinched
// waist open rather than guessing a join.
const CASE_EDGES: readonly (readonly number[])[] = [
  [], // 0000
  [3, 0], // 0001
  [0, 1], // 0010
  [3, 1], // 0011
  [1, 2], // 0100
  [3, 0, 1, 2], // 0101 saddle
  [0, 2], // 0110
  [3, 2], // 0111
  [2, 3], // 1000
  [2, 0], // 1001
  [0, 1, 2, 3], // 1010 saddle
  [2, 1], // 1011
  [1, 3], // 1100
  [1, 0], // 1101
  [0, 3], // 1110
  [], // 1111
];

/**
 * Build the skirt band for every cut contour crossing this grid, or null when
 * the grid is entirely inside or entirely outside the cut (the overwhelmingly
 * common case, and the one that must cost nothing).
 */
export function buildCutRim(input: CutRimInput): CutRimArrays | null {
  const { x0, z0, nx, nz, stepX, stepZ, depth } = input;
  if (nx < 1 || nz < 1 || !(depth > 0)) return null;

  // One field sample per grid corner, shared by the four cells that meet on it.
  const gw = nx + 1;
  const field = new Float32Array(gw * (nz + 1));
  let anyInside = false;
  let anyOutside = false;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const v = input.fieldAt(x0 + i * stepX, z0 + j * stepZ);
      field[j * gw + i] = v;
      if (v < 0) anyInside = true;
      else anyOutside = true;
    }
  }
  if (!anyInside || !anyOutside) return null;

  // Walk the cells and collect contour segments.
  const segs: number[] = []; // px, pz, qx, qz per segment
  for (let j = 0; j < nz && segs.length < MAX_RIM_SEGMENTS * 4; j++) {
    for (let i = 0; i < nx; i++) {
      const va = field[j * gw + i];
      const vb = field[j * gw + i + 1];
      const vc = field[(j + 1) * gw + i + 1];
      const vd = field[(j + 1) * gw + i];
      const code = (va < 0 ? 1 : 0) | (vb < 0 ? 2 : 0) | (vc < 0 ? 4 : 0) | (vd < 0 ? 8 : 0);
      const edges = CASE_EDGES[code];
      if (edges.length === 0) continue;
      const ax = x0 + i * stepX;
      const az = z0 + j * stepZ;
      const bx = ax + stepX;
      const bz = az;
      const cx = bx;
      const cz = az + stepZ;
      const dx = ax;
      const dz = cz;
      const point = (edge: number): [number, number] => {
        switch (edge) {
          case 0:
            return lerpEdge(ax, az, va, bx, bz, vb);
          case 1:
            return lerpEdge(bx, bz, vb, cx, cz, vc);
          case 2:
            return lerpEdge(cx, cz, vc, dx, dz, vd);
          default:
            return lerpEdge(dx, dz, vd, ax, az, va);
        }
      };
      for (let e = 0; e + 1 < edges.length; e += 2) {
        const p = point(edges[e]);
        const q = point(edges[e + 1]);
        if (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
        segs.push(p[0], p[1], q[0], q[1]);
      }
    }
  }
  const segCount = segs.length / 4;
  if (segCount === 0) return null;

  // Two quads per segment: the sunken lip that covers the mesher's ragged
  // edge, and the vertical wall that gives the opening its depth.
  const flare = input.flare ?? Math.max(stepX, stepZ);
  const sinkTop = input.sinkTop ?? RIM_SINK;
  const positions = new Float32Array(segCount * 8 * 3);
  const normals = new Float32Array(segCount * 8 * 3);
  const uvs = new Float32Array(segCount * 8 * 2);
  const indices = new Uint32Array(segCount * 12);
  let vi = 0;
  let ii = 0;
  // u runs along the rim so a rock texture tiles by distance rather than by
  // segment. Segments arrive in scan order rather than walked order, so this
  // is an accumulating ruler, not an arc-length parameterisation of one loop;
  // that is enough to stop visible stretching and costs no contour stitching.
  let u = 0;
  for (let s = 0; s < segCount; s++) {
    let px = segs[s * 4];
    let pz = segs[s * 4 + 1];
    let qx = segs[s * 4 + 2];
    let qz = segs[s * 4 + 3];
    // The band's visible face looks INTO the opening: standing outside a well
    // you see the far wall, and that wall faces back across the hole. Sample
    // the field just off the segment's midpoint to find which side that is,
    // and swap the endpoints when the winding would face the wrong way.
    let ex = qx - px;
    let ez = qz - pz;
    const len = Math.hypot(ex, ez) || 1;
    const midX = (px + qx) / 2;
    const midZ = (pz + qz) / 2;
    const probe = Math.max(stepX, stepZ) * 0.25;
    // The quad order below yields the face normal (-ez, 0, ex) / len.
    const nInside = input.fieldAt(midX - (ez / len) * probe, midZ + (ex / len) * probe) < 0;
    if (!nInside) {
      const tx = px;
      const tz = pz;
      px = qx;
      pz = qz;
      qx = tx;
      qz = tz;
      ex = -ex;
      ez = -ez;
    }
    const nx2 = -ez / len;
    const nz2 = ex / len;
    const segDepth = input.depthAt ? input.depthAt(midX, midZ) : depth;
    if (!(segDepth > 0)) {
      // Skipped segment (a carve's contour): the cavity mesh owns this edge.
      u += len;
      continue;
    }
    const pTop = input.heightAt(px, pz) - sinkTop;
    const qTop = input.heightAt(qx, qz) - sinkTop;
    // Outward is the far side of the inward normal.
    const opx = px - nx2 * flare;
    const opz = pz - nz2 * flare;
    const oqx = qx - nx2 * flare;
    const oqz = qz - nz2 * flare;
    const put = (
      x: number,
      y: number,
      z: number,
      normX: number,
      normY: number,
      normZ: number,
      uu: number,
      vv: number,
    ): void => {
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;
      normals[vi * 3] = normX;
      normals[vi * 3 + 1] = normY;
      normals[vi * 3 + 2] = normZ;
      uvs[vi * 2] = uu;
      uvs[vi * 2 + 1] = vv;
      vi++;
    };
    const quad = (base: number): void => {
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    };
    // Lip: outer-p, inner-p, inner-q, outer-q, facing up.
    const lip = vi;
    put(opx, input.heightAt(opx, opz) - RIM_SINK, opz, 0, 1, 0, u, segDepth + flare);
    put(px, pTop, pz, 0, 1, 0, u, segDepth);
    put(qx, qTop, qz, 0, 1, 0, u + len, segDepth);
    put(oqx, input.heightAt(oqx, oqz) - RIM_SINK, oqz, 0, 1, 0, u + len, segDepth + flare);
    quad(lip);
    // Wall: top-p, bottom-p, bottom-q, top-q, facing into the opening.
    const wall = vi;
    put(px, pTop, pz, nx2, 0, nz2, u, segDepth);
    put(px, pTop - segDepth, pz, nx2, 0, nz2, u, 0);
    put(qx, qTop - segDepth, qz, nx2, 0, nz2, u + len, 0);
    put(qx, qTop, qz, nx2, 0, nz2, u + len, segDepth);
    quad(wall);
    u += len;
  }
  if (vi === 0) return null;
  // Compact away the slots of skipped segments (subarray views, no copy).
  if (vi < segCount * 8) {
    return {
      positions: positions.subarray(0, vi * 3),
      normals: normals.subarray(0, vi * 3),
      uvs: uvs.subarray(0, vi * 2),
      indices: indices.subarray(0, ii),
    };
  }
  return { positions, normals, uvs, indices };
}
