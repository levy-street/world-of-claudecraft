// The interior surface a boolean carve leaves in the ground: an isosurface
// mesh of the carve field, clipped to below the terrain surface. This is what
// turns the Carve tool's solids into rooms, floor, walls, ceiling, instead
// of a rim skirt over a void.
//
// Marching TETRAHEDRA over a uniform grid (six tets per cell), not marching
// cubes: the tet case table is four bits and derivable in code, there are no
// ambiguous saddle cases, and the output is watertight by construction. The
// extra triangles it emits over MC are irrelevant next to the placement art
// budget, and vertex normals come from the field gradient anyway so the
// surface shades smooth at any tessellation.
//
// Pure arithmetic over plain typed arrays: no Three, no DOM, no WebGL, the
// same contract as terrain_cut_rim_core.ts, so it could move into the chunk
// worker unchanged. The FIELD closure must be the sim's own carve field
// (sim/terrain_cuts.ts carveFieldAt over the same cut/patch lists), which is
// the whole contract: the floor this mesh draws is the floor movement stands
// on.
//
// Grid alignment: callers pass a grid ORIGIN snapped to a multiple of `cell`
// in world space. Two adjacent tiles meshed at the same cell size then sample
// identical corner positions along their shared face and interpolate identical
// crossings, so tile borders cannot crack.

export interface CavityMeshInput {
  /** Grid origin (world yards), the min corner of cell (0,0,0). */
  x0: number;
  y0: number;
  z0: number;
  /** Cell edge length in yards. */
  cell: number;
  /** Cell counts along each axis. Corner grids are one larger. */
  nx: number;
  ny: number;
  nz: number;
  /** The carve field: negative inside the cavity. */
  fieldAt(x: number, y: number, z: number): number;
  /** Terrain surface height, for the underground clip. */
  heightAt(x: number, z: number): number;
  /** Yards below the surface at which the vertex tint reaches full dark. */
  darkDepth?: number;
  /** The tint floor at full depth (default CAVITY_DARK): a map's cave
   *  brightness lifts it toward 1 so big caverns stay readable. */
  caveDark?: number;
  /**
   * Mixed-resolution stitching: the integer cell RATIO of the neighbouring
   * grid across each face, in order [-x, +x, -z, +z] (1 = same cell or no
   * neighbour; y-neighbours always share this grid's cell). A face with
   * ratio m has its field samples LINEARIZED per coarse face-triangle (the
   * same (+,+) diagonal split marching tetrahedra gives every cube face), so
   * the crossings this grid interpolates on the face land exactly on the
   * coarse neighbour's - a fine tile meets a coarse one watertight.
   */
  faceCoarse?: readonly [number, number, number, number];
}

export interface CavityMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex tint: 1 at the surface fading to CAVITY_DARK at darkDepth. */
  colors: Float32Array;
  /** Planar UVs by the vertex normal's dominant axis, in yards. */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Vertices from this index on belong to the mouth COLLAR (see
   *  RIM_COLLAR): they hang just under the terrain surface around the
   *  opening rather than on the field's zero set. Absent = no collar. */
  collarVertexStart?: number;
}

// How dark the deepest rock tints (multiplied over the material's own map).
const CAVITY_DARK = 0.46;
const DEFAULT_DARK_DEPTH = 10;
// Fake bounce shading by surface facing: floors catch light from the mouth,
// ceilings hang in their own shadow. Reads the cavity's shape where no real
// light reaches, for a couple of multiplies per vertex.
const FLOOR_BOUNCE = 0.3;
const CEILING_SHADE = 0.22;
// The clip keeps a hair of overshoot above the surface so the cavity wall
// tucks under the rim skirt's sunken lip instead of stopping short of it.
const CLIP_LIFT = 0.04;
// Where the clipped wall meets the surface, a horizontal COLLAR hangs just
// under the terrain around the whole opening: RIM_COLLAR yards outward from
// the rim (scaled with the cell, the marching error grows with it), sunk
// RIM_COLLAR_SINK so surviving ground hides it from above. The tetrahedra
// land the wall's rim within a fraction of a cell of the terrain's exact
// cut contour (terrain_cut_clip_core.ts), and wherever the rim fell INSIDE
// that contour the strip between them was open air: daylight slivers along
// every cave mouth (SPACEY, 2026-09-18: "the caves have this really bad gap
// seams clean up the seams"). The collar covers that strip from below;
// where the rim fell outside the contour it sits under the ground, unseen.
const RIM_COLLAR = 0.6;
const RIM_COLLAR_MIN = 0.3;
const RIM_COLLAR_SINK = 0.06;
// The tile-seam skirt's reach into the rock, in cells (see the emit site).
const SEAM_SKIRT = 2;
const SEAM_SKIRT_MIN = 0.75;

// The six tetrahedra of a cube around the main diagonal c0-c6. Corner ids:
// bit0 = +x, bit1 = +y, bit2 = +z (c0 = origin, c6 = +x+y+z).
const TETS: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

const CORNER_DX = [0, 1, 1, 0, 0, 1, 1, 0];
const CORNER_DY = [0, 0, 1, 1, 0, 0, 1, 1];
const CORNER_DZ = [0, 0, 0, 0, 1, 1, 1, 1];

/**
 * Mesh the cavity surface inside one grid, or null when the grid is entirely
 * inside or entirely outside the field (the common case for most tiles of a
 * large carve, and the one that must cost only the corner sampling).
 */
export function buildCavityMesh(input: CavityMeshInput): CavityMeshArrays | null {
  const { x0, y0, z0, cell, nx, ny, nz } = input;
  if (nx < 1 || ny < 1 || nz < 1 || !(cell > 0)) return null;
  const gx = nx + 1;
  const gy = ny + 1;
  const gz = nz + 1;

  // One field sample per grid corner, shared by every tet that meets on it.
  const field = new Float32Array(gx * gy * gz);
  let anyIn = false;
  let anyOut = false;
  for (let k = 0; k < gz; k++) {
    const z = z0 + k * cell;
    for (let j = 0; j < gy; j++) {
      const y = y0 + j * cell;
      const row = (k * gy + j) * gx;
      for (let i = 0; i < gx; i++) {
        const v = input.fieldAt(x0 + i * cell, y, z);
        field[row + i] = v;
        if (v < 0) anyIn = true;
        else anyOut = true;
      }
    }
  }
  if (!anyIn || !anyOut) return null;

  // Mixed-resolution faces: overwrite the face's in-between samples with the
  // coarse neighbour's own piecewise-linear interpolation. The m-aligned
  // samples are exact field samples both sides share; the diagonal split per
  // coarse square matches the tet decomposition's face triangles, so the
  // zero-set on the face is IDENTICAL from both tiles.
  const fc = input.faceCoarse;
  if (fc) {
    const cornerIdx = (i: number, j: number, k: number): number => (k * gy + j) * gx + i;
    // Linear on the two face triangles split along the (0,0)->(1,1) diagonal
    // of local axes (u, v).
    const triLerp = (
      f00: number,
      f10: number,
      f01: number,
      f11: number,
      u: number,
      v: number,
    ): number =>
      u >= v ? f00 + (f10 - f00) * u + (f11 - f10) * v : f00 + (f01 - f00) * v + (f11 - f01) * u;
    // X faces: local axes (u, v) = (y, z).
    const constrainX = (i: number, m: number): void => {
      for (let k0 = 0; k0 + m <= nz; k0 += m) {
        for (let j0 = 0; j0 + m <= ny; j0 += m) {
          const f00 = field[cornerIdx(i, j0, k0)];
          const f10 = field[cornerIdx(i, j0 + m, k0)];
          const f01 = field[cornerIdx(i, j0, k0 + m)];
          const f11 = field[cornerIdx(i, j0 + m, k0 + m)];
          for (let dj = 0; dj <= m; dj++) {
            for (let dk = 0; dk <= m; dk++) {
              if (dj % m === 0 && dk % m === 0) continue;
              field[cornerIdx(i, j0 + dj, k0 + dk)] = triLerp(f00, f10, f01, f11, dj / m, dk / m);
            }
          }
        }
      }
    };
    // Z faces: local axes (u, v) = (x, y).
    const constrainZ = (k: number, m: number): void => {
      for (let j0 = 0; j0 + m <= ny; j0 += m) {
        for (let i0 = 0; i0 + m <= nx; i0 += m) {
          const f00 = field[cornerIdx(i0, j0, k)];
          const f10 = field[cornerIdx(i0 + m, j0, k)];
          const f01 = field[cornerIdx(i0, j0 + m, k)];
          const f11 = field[cornerIdx(i0 + m, j0 + m, k)];
          for (let di = 0; di <= m; di++) {
            for (let dj = 0; dj <= m; dj++) {
              if (di % m === 0 && dj % m === 0) continue;
              field[cornerIdx(i0 + di, j0 + dj, k)] = triLerp(f00, f10, f01, f11, di / m, dj / m);
            }
          }
        }
      }
    };
    // Coarsest faces write LAST so a shared edge between two constrained
    // faces takes the coarser linearization on both.
    const jobs: { m: number; run: () => void }[] = [];
    if (fc[0] > 1) jobs.push({ m: fc[0], run: () => constrainX(0, fc[0]) });
    if (fc[1] > 1) jobs.push({ m: fc[1], run: () => constrainX(gx - 1, fc[1]) });
    if (fc[2] > 1) jobs.push({ m: fc[2], run: () => constrainZ(0, fc[2]) });
    if (fc[3] > 1) jobs.push({ m: fc[3], run: () => constrainZ(gz - 1, fc[3]) });
    jobs.sort((a, b) => a.m - b.m);
    for (const job of jobs) job.run();
  }

  // Terrain heights on the XZ corner grid, for the underground clip. One
  // sample per column, shared by the whole column's vertices.
  const heights = new Float32Array(gx * gz);
  for (let k = 0; k < gz; k++) {
    for (let i = 0; i < gx; i++) {
      heights[k * gx + i] = input.heightAt(x0 + i * cell, z0 + k * cell);
    }
  }

  const cornerIndex = (i: number, j: number, k: number): number => (k * gy + j) * gx + i;

  // Shared crossing vertices: one per grid EDGE with a sign change, keyed by
  // the two corner ids. Interpolation is on the field values alone, so two
  // tets (or two tiles) sharing the edge produce the same point exactly.
  const edgeVerts = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Field gradient at a corner by CENTRAL differences everywhere. Neighbours
  // that fall outside this grid are sampled live from the field (a one-cell
  // halo): the old one-sided fallback at the borders gave two adjacent TILES
  // different normals along their shared face, which lit as a hairline seam
  // grid across every large carve, worst on high-contrast interiors (lava).
  // The vertex normal is MINUS the gradient: the viewer stands in the cavity,
  // where the field decreases.
  const sampleAt = (i: number, j: number, k: number): number => {
    if (i >= 0 && i < gx && j >= 0 && j < gy && k >= 0 && k < gz) {
      return field[cornerIndex(i, j, k)];
    }
    return input.fieldAt(x0 + i * cell, y0 + j * cell, z0 + k * cell);
  };
  const gradAt = (i: number, j: number, k: number, out: number[]): void => {
    out[0] = (sampleAt(i + 1, j, k) - sampleAt(i - 1, j, k)) / (2 * cell);
    out[1] = (sampleAt(i, j + 1, k) - sampleAt(i, j - 1, k)) / (2 * cell);
    out[2] = (sampleAt(i, j, k + 1) - sampleAt(i, j, k - 1)) / (2 * cell);
  };
  const gA: number[] = [0, 0, 0];
  const gB: number[] = [0, 0, 0];

  const vertexOnEdge = (ca: number, cb: number): number => {
    const key = ca < cb ? ca * field.length + cb : cb * field.length + ca;
    const found = edgeVerts.get(key);
    if (found !== undefined) return found;
    const fa = field[ca];
    const fb = field[cb];
    const denom = fa - fb;
    const t = Math.abs(denom) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, fa / denom));
    const ia = ca % gx;
    const ja = ((ca / gx) | 0) % gy;
    const ka = (ca / (gx * gy)) | 0;
    const ib = cb % gx;
    const jb = ((cb / gx) | 0) % gy;
    const kb = (cb / (gx * gy)) | 0;
    const x = x0 + (ia + (ib - ia) * t) * cell;
    const y = y0 + (ja + (jb - ja) * t) * cell;
    const z = z0 + (ka + (kb - ka) * t) * cell;
    gradAt(ia, ja, ka, gA);
    gradAt(ib, jb, kb, gB);
    let nxv = -(gA[0] + (gB[0] - gA[0]) * t);
    let nyv = -(gA[1] + (gB[1] - gA[1]) * t);
    let nzv = -(gA[2] + (gB[2] - gA[2]) * t);
    const len = Math.hypot(nxv, nyv, nzv);
    if (len > 1e-9) {
      nxv /= len;
      nyv /= len;
      nzv /= len;
    } else {
      nxv = 0;
      nyv = 1;
      nzv = 0;
    }
    const vi = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nxv, nyv, nzv);
    edgeVerts.set(key, vi);
    return vi;
  };

  // Emit one tet's triangles. Inside = field < 0.
  const corner: number[] = [0, 0, 0, 0];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Skip cells with no sign change at all (fast reject on the 8 corners).
        let cin = 0;
        for (let c = 0; c < 8; c++) {
          if (field[cornerIndex(i + CORNER_DX[c], j + CORNER_DY[c], k + CORNER_DZ[c])] < 0) {
            cin++;
          }
        }
        if (cin === 0 || cin === 8) continue;
        for (const tet of TETS) {
          for (let c = 0; c < 4; c++) {
            const cid = tet[c];
            corner[c] = cornerIndex(i + CORNER_DX[cid], j + CORNER_DY[cid], k + CORNER_DZ[cid]);
          }
          let mask = 0;
          for (let c = 0; c < 4; c++) if (field[corner[c]] < 0) mask |= 1 << c;
          if (mask === 0 || mask === 15) continue;
          // Vertices ON each crossing edge of the tet, then triangles by case.
          const inside: number[] = [];
          const outside: number[] = [];
          for (let c = 0; c < 4; c++) {
            (mask & (1 << c) ? inside : outside).push(corner[c]);
          }
          if (inside.length === 1) {
            const a = vertexOnEdge(inside[0], outside[0]);
            const b = vertexOnEdge(inside[0], outside[1]);
            const c = vertexOnEdge(inside[0], outside[2]);
            indices.push(a, b, c);
          } else if (inside.length === 3) {
            const a = vertexOnEdge(inside[0], outside[0]);
            const b = vertexOnEdge(inside[1], outside[0]);
            const c = vertexOnEdge(inside[2], outside[0]);
            indices.push(a, b, c);
          } else {
            // Two in, two out: a quad between the four crossed edges.
            const a = vertexOnEdge(inside[0], outside[0]);
            const b = vertexOnEdge(inside[0], outside[1]);
            const c = vertexOnEdge(inside[1], outside[1]);
            const d = vertexOnEdge(inside[1], outside[0]);
            indices.push(a, b, c, a, c, d);
          }
        }
      }
    }
  }
  if (indices.length === 0) return null;

  // Orient every triangle to face INTO the cavity: the case emission above
  // makes no winding promise (three of the six tets are mirror-oriented), so
  // agreement with the vertex normals is enforced here instead.
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const dot =
      fx * (normals[a] + normals[b] + normals[c]) +
      fy * (normals[a + 1] + normals[b + 1] + normals[c + 1]) +
      fz * (normals[a + 2] + normals[b + 2] + normals[c + 2]);
    if (dot < 0) {
      const swap = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = swap;
    }
  }

  // Clip against the terrain surface: keep the underground part. The signed
  // clip value s = surface - y is sampled bilinearly from the height grid and
  // lerped along split edges, which lands within a fraction of a cell of the
  // true contour, under the rim skirt's lip by construction.
  const clipS = (vi: number): number => {
    const px = positions[vi * 3];
    const py = positions[vi * 3 + 1];
    const pz = positions[vi * 3 + 2];
    const fx = Math.max(0, Math.min(gx - 1 - 1e-6, (px - x0) / cell));
    const fz = Math.max(0, Math.min(gz - 1 - 1e-6, (pz - z0) / cell));
    const i = fx | 0;
    const k = fz | 0;
    const tx = fx - i;
    const tz = fz - k;
    const h00 = heights[k * gx + i];
    const h10 = heights[k * gx + i + 1];
    const h01 = heights[(k + 1) * gx + i];
    const h11 = heights[(k + 1) * gx + i + 1];
    const h = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
    return h + CLIP_LIFT - py;
  };
  const clipLerp = (va: number, vb: number, sa: number, sb: number): number => {
    const t = sa / (sa - sb);
    const vi = positions.length / 3;
    for (let c = 0; c < 3; c++) {
      positions.push(positions[va * 3 + c] + (positions[vb * 3 + c] - positions[va * 3 + c]) * t);
      normals.push(normals[va * 3 + c] + (normals[vb * 3 + c] - normals[va * 3 + c]) * t);
    }
    return vi;
  };
  const kept: number[] = [];
  const sCache = new Float32Array(positions.length / 3).fill(Number.NaN);
  const sOf = (vi: number): number => {
    let s = sCache[vi];
    if (Number.isNaN(s)) {
      s = clipS(vi);
      sCache[vi] = s;
    }
    return s;
  };
  const clipEdgeCache = new Map<number, number>();
  const clipVert = (va: number, vb: number): number => {
    const key = va < vb ? va * 1e7 + vb : vb * 1e7 + va;
    const found = clipEdgeCache.get(key);
    if (found !== undefined) return found;
    const vi = clipLerp(va, vb, sOf(va), sOf(vb));
    clipEdgeCache.set(key, vi);
    return vi;
  };
  // Rim edges: the clipped-off boundary along the surface, as vertex pairs.
  const rimEdges: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const s = [sOf(tri[0]), sOf(tri[1]), sOf(tri[2])];
    const insideCount = (s[0] >= 0 ? 1 : 0) + (s[1] >= 0 ? 1 : 0) + (s[2] >= 0 ? 1 : 0);
    if (insideCount === 3) {
      kept.push(tri[0], tri[1], tri[2]);
      continue;
    }
    if (insideCount === 0) continue;
    if (insideCount === 1) {
      const a = s[0] >= 0 ? 0 : s[1] >= 0 ? 1 : 2;
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      const cab = clipVert(tri[a], tri[b]);
      const cac = clipVert(tri[a], tri[c]);
      kept.push(tri[a], cab, cac);
      rimEdges.push(cab, cac);
    } else {
      const out = s[0] < 0 ? 0 : s[1] < 0 ? 1 : 2;
      const a = (out + 1) % 3;
      const b = (out + 2) % 3;
      const ai = tri[a];
      const bi = tri[b];
      const abOut = clipVert(bi, tri[out]);
      const aaOut = clipVert(ai, tri[out]);
      kept.push(ai, bi, abOut, ai, abOut, aaOut);
      rimEdges.push(abOut, aaOut);
    }
  }
  if (kept.length === 0) return null;

  // Compact to the vertices the clipped index list actually uses.
  const used = new Map<number, number>();
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  let outIndices = new Uint32Array(kept.length);
  for (let t = 0; t < kept.length; t++) {
    const old = kept[t];
    let next = used.get(old);
    if (next === undefined) {
      next = outPositions.length / 3;
      used.set(old, next);
      outPositions.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2]);
      // Clip verts inherit lerped (unnormalized) normals; normalize here once.
      let nxv = normals[old * 3];
      let nyv = normals[old * 3 + 1];
      let nzv = normals[old * 3 + 2];
      const len = Math.hypot(nxv, nyv, nzv);
      if (len > 1e-9) {
        nxv /= len;
        nyv /= len;
        nzv /= len;
      } else {
        nxv = 0;
        nyv = 1;
        nzv = 0;
      }
      outNormals.push(nxv, nyv, nzv);
    }
    outIndices[t] = next;
  }

  // The mouth collar (RIM_COLLAR): for every rim edge, a quad from the two
  // rim vertices to their outward-offset, sunk twins, wound to face DOWN
  // (visible from inside the cavity and from under the ground). Emitted
  // before the tint pass so the collar takes the same depth shade and
  // planar UVs as the wall it extends.
  const collarVertexStart = outPositions.length / 3;
  if (rimEdges.length > 0) {
    const surfaceAt = (px: number, pz: number): number => {
      const fx = Math.max(0, Math.min(gx - 1 - 1e-6, (px - x0) / cell));
      const fz = Math.max(0, Math.min(gz - 1 - 1e-6, (pz - z0) / cell));
      const i = fx | 0;
      const k = fz | 0;
      const tx = fx - i;
      const tz = fz - k;
      return (
        heights[k * gx + i] * (1 - tx) * (1 - tz) +
        heights[k * gx + i + 1] * tx * (1 - tz) +
        heights[(k + 1) * gx + i] * (1 - tx) * tz +
        heights[(k + 1) * gx + i + 1] * tx * tz
      );
    };
    const reach = Math.max(RIM_COLLAR_MIN, RIM_COLLAR * cell);
    const collarIndices: number[] = [];
    // Outward = away from the cavity: the wall's normals face the air inside.
    const outwardOf = (vi: number): [number, number] | null => {
      const nx = -outNormals[vi * 3];
      const nz = -outNormals[vi * 3 + 2];
      const len = Math.hypot(nx, nz);
      if (len < 0.25) return null; // a floor or ceiling meeting the surface: no rim here
      return [nx / len, nz / len];
    };
    const sunkTwin = (vi: number, out: [number, number]): number => {
      const px = outPositions[vi * 3] + out[0] * reach;
      const pz = outPositions[vi * 3 + 2] + out[1] * reach;
      const next = outPositions.length / 3;
      outPositions.push(px, surfaceAt(px, pz) - RIM_COLLAR_SINK, pz);
      outNormals.push(0, -1, 0);
      return next;
    };
    const downward = (a: number, b: number, c: number): void => {
      // wind so the face normal points down (visible from below)
      const ax = outPositions[a * 3];
      const ay = outPositions[a * 3 + 1];
      const az = outPositions[a * 3 + 2];
      const ux = outPositions[b * 3] - ax;
      const uy = outPositions[b * 3 + 1] - ay;
      const uz = outPositions[b * 3 + 2] - az;
      const vx = outPositions[c * 3] - ax;
      const vy = outPositions[c * 3 + 1] - ay;
      const vz = outPositions[c * 3 + 2] - az;
      const ny = uz * vx - ux * vz;
      if (ny > 0) collarIndices.push(a, c, b);
      else collarIndices.push(a, b, c);
      void uy;
      void vy;
    };
    for (let e = 0; e < rimEdges.length; e += 2) {
      const p = used.get(rimEdges[e]);
      const q = used.get(rimEdges[e + 1]);
      if (p === undefined || q === undefined || p === q) continue;
      const op = outwardOf(p);
      const oq = outwardOf(q);
      if (!op || !oq) continue;
      const p2 = sunkTwin(p, op);
      const q2 = sunkTwin(q, oq);
      downward(p, q, q2);
      downward(p, q2, p2);
    }
    if (collarIndices.length > 0) {
      const merged = new Uint32Array(outIndices.length + collarIndices.length);
      merged.set(outIndices);
      merged.set(collarIndices, outIndices.length);
      outIndices = merged;
    }
  }

  // The tile-seam SKIRT (SEAM_SKIRT): a wall that crosses a tile face ends
  // there in a border polyline, and the neighbouring tile's polyline only
  // matches it while both tiles stand at the keys they were stitched for.
  // Walking through a cave re-meshes tiles one at a time as the LOD rings
  // move, so for a few frames a fine border faces a coarse one and the gap
  // between the two polylines (it lies IN the face plane) shows daylight
  // (SPACEY, 2026-09-19: "still some slight gaps popping up in the caves
  // especially when moving thorugh it"). Every border edge therefore drags a
  // flange back into the rock, in the face plane: whichever polyline stands
  // proud, its neighbour's flange closes the slot behind it. Both windings,
  // since the slot is seen from either tile. Appended after the collar so
  // clusterCavityMesh leaves these vertices unmerged too.
  {
    const xMax = x0 + nx * cell;
    const yMax = y0 + ny * cell;
    const zMax = z0 + nz * cell;
    const eps = cell * 1e-3;
    // bit per face plane a vertex lies on: -x +x -y +y -z +z
    const planesOf = (vi: number): number => {
      const px = outPositions[vi * 3];
      const py = outPositions[vi * 3 + 1];
      const pz = outPositions[vi * 3 + 2];
      return (
        (Math.abs(px - x0) < eps ? 1 : 0) |
        (Math.abs(px - xMax) < eps ? 2 : 0) |
        (Math.abs(py - y0) < eps ? 4 : 0) |
        (Math.abs(py - yMax) < eps ? 8 : 0) |
        (Math.abs(pz - z0) < eps ? 16 : 0) |
        (Math.abs(pz - zMax) < eps ? 32 : 0)
      );
    };
    const wallCount = collarVertexStart;
    const planeBits = new Uint8Array(wallCount);
    let anyBorder = false;
    for (let v = 0; v < wallCount; v++) {
      planeBits[v] = planesOf(v);
      if (planeBits[v] !== 0) anyBorder = true;
    }
    if (anyBorder) {
      const reach = Math.max(SEAM_SKIRT_MIN, SEAM_SKIRT * cell);
      const skirtIndices: number[] = [];
      const twins = new Map<number, number>();
      const twinOf = (vi: number, axis: number): number => {
        const key = vi * 3 + axis;
        const found = twins.get(key);
        if (found !== undefined) return found;
        // into the rock = against the normal, flattened into the face plane
        let dx = axis === 0 ? 0 : -outNormals[vi * 3];
        let dy = axis === 1 ? 0 : -outNormals[vi * 3 + 1];
        let dz = axis === 2 ? 0 : -outNormals[vi * 3 + 2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.2) {
          twins.set(key, -1); // the wall runs along the face: nothing to close
          return -1;
        }
        dx /= len;
        dy /= len;
        dz /= len;
        const next = outPositions.length / 3;
        outPositions.push(
          outPositions[vi * 3] + dx * reach,
          outPositions[vi * 3 + 1] + dy * reach,
          outPositions[vi * 3 + 2] + dz * reach,
        );
        outNormals.push(outNormals[vi * 3], outNormals[vi * 3 + 1], outNormals[vi * 3 + 2]);
        twins.set(key, next);
        return next;
      };
      const wallIndexCount = outIndices.length;
      for (let t = 0; t < wallIndexCount; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = outIndices[t + e];
          const b = outIndices[t + ((e + 1) % 3)];
          if (a >= wallCount || b >= wallCount) continue;
          const shared = planeBits[a] & planeBits[b];
          if (shared === 0) continue;
          for (let bit = 0; bit < 6; bit++) {
            if ((shared & (1 << bit)) === 0) continue;
            const axis = bit >> 1;
            const a2 = twinOf(a, axis);
            const b2 = twinOf(b, axis);
            if (a2 < 0 || b2 < 0) continue;
            skirtIndices.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
          }
        }
      }
      if (skirtIndices.length > 0) {
        const merged = new Uint32Array(outIndices.length + skirtIndices.length);
        merged.set(outIndices);
        merged.set(skirtIndices, outIndices.length);
        outIndices = merged;
      }
    }
  }

  // Vertex tint (depth darkening) and dominant-axis planar UVs.
  const darkDepth = Math.max(1, input.darkDepth ?? DEFAULT_DARK_DEPTH);
  const darkFloor = Math.min(1, Math.max(CAVITY_DARK, input.caveDark ?? CAVITY_DARK));
  const count = outPositions.length / 3;
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const px = outPositions[v * 3];
    const py = outPositions[v * 3 + 1];
    const pz = outPositions[v * 3 + 2];
    const fx = Math.max(0, Math.min(gx - 1 - 1e-6, (px - x0) / cell));
    const fz = Math.max(0, Math.min(gz - 1 - 1e-6, (pz - z0) / cell));
    const i = fx | 0;
    const k = fz | 0;
    const tx = fx - i;
    const tz = fz - k;
    const h00 = heights[k * gx + i];
    const h10 = heights[k * gx + i + 1];
    const h01 = heights[(k + 1) * gx + i];
    const h11 = heights[(k + 1) * gx + i + 1];
    const h = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
    let depth = Math.max(0, h - py);
    // Sky-openness: a carve open to the sky (a crater, a bowl, a pit) is
    // sunlit ground, not cave dark. March straight up from the vertex to the
    // ORIGINAL surface height through the carve field: rock anywhere on the
    // way (a ceiling, however thin) keeps the cave shade; clear air stands
    // the depth tint almost fully down so paint and texture read in daylight.
    if (depth > 0.6) {
      let open = true;
      const step = Math.max(0.75, cell * 0.75);
      for (let y = py + step * 0.8; y < h - 0.05; y += step) {
        if (input.fieldAt(px, y, pz) >= 0.1) {
          open = false;
          break;
        }
      }
      if (open) depth *= 0.12;
    }
    const ny = outNormals[v * 3 + 1];
    const facing = ny > 0 ? 1 + FLOOR_BOUNCE * ny : 1 + CEILING_SHADE * ny;
    const tint = Math.min(1.2, (1 - (1 - darkFloor) * Math.min(1, depth / darkDepth)) * facing);
    colors[v * 3] = tint;
    colors[v * 3 + 1] = tint;
    colors[v * 3 + 2] = tint;
    const nxa = Math.abs(outNormals[v * 3]);
    const nya = Math.abs(outNormals[v * 3 + 1]);
    const nza = Math.abs(outNormals[v * 3 + 2]);
    if (nya >= nxa && nya >= nza) {
      uvs[v * 2] = px;
      uvs[v * 2 + 1] = pz;
    } else if (nxa >= nza) {
      uvs[v * 2] = pz;
      uvs[v * 2 + 1] = py;
    } else {
      uvs[v * 2] = px;
      uvs[v * 2 + 1] = py;
    }
  }

  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    colors,
    uvs,
    indices: outIndices,
    collarVertexStart,
  };
}

/**
 * FORK: lighten a marched tile. Marching tetrahedra spends six tetrahedra a
 * cube and lands a vertex on almost every cube edge, so a smooth wall reads as
 * a dense sliver mesh. Cluster vertices on a world-anchored lattice of `q`
 * yards (averaging position, normal and tint), drop the triangles that
 * collapse, and rebuild the planar UVs. Vertices within `q` of the tile's own
 * faces are NEVER merged: they are the shared-edge crossings a neighbouring
 * tile computed identically, so the seam stays watertight with no per-tile
 * knowledge of its neighbours.
 */
export function clusterCavityMesh(
  arrays: CavityMeshArrays,
  q: number,
  tile: { x0: number; y0: number; z0: number; size: number },
): CavityMeshArrays {
  const { positions, normals, colors, indices } = arrays;
  const count = positions.length / 3;
  if (q <= 0 || count === 0) return arrays;
  // The mouth collar (RIM_COLLAR) hangs 0.06 yd under rim vertices that sit
  // 0.04 yd above the surface: one lattice cell would fuse the two and fold
  // the collar into the wall. Collar vertices never merge; they are few.
  const collarStart = arrays.collarVertexStart ?? count;
  const near = (v: number, lo: number, hi: number): boolean => v - lo < q || hi - v < q;
  const key = new Map<string, number>();
  const remap = new Int32Array(count);
  const accPos: number[] = [];
  const accNrm: number[] = [];
  const accCol: number[] = [];
  const accN: number[] = [];
  let next = 0;
  let collarOut = -1;
  for (let v = 0; v < count; v++) {
    if (v === collarStart) collarOut = next;
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const border =
      v >= collarStart ||
      near(px, tile.x0, tile.x0 + tile.size) ||
      near(py, tile.y0, tile.y0 + tile.size) ||
      near(pz, tile.z0, tile.z0 + tile.size);
    let id: number | undefined;
    if (!border) {
      const k = `${Math.floor(px / q)},${Math.floor(py / q)},${Math.floor(pz / q)}`;
      id = key.get(k);
      if (id === undefined) {
        id = next++;
        key.set(k, id);
        accPos.push(0, 0, 0);
        accNrm.push(0, 0, 0);
        accCol.push(0, 0, 0);
        accN.push(0);
      }
    } else {
      id = next++;
      accPos.push(0, 0, 0);
      accNrm.push(0, 0, 0);
      accCol.push(0, 0, 0);
      accN.push(0);
    }
    remap[v] = id;
    accPos[id * 3] += px;
    accPos[id * 3 + 1] += py;
    accPos[id * 3 + 2] += pz;
    accNrm[id * 3] += normals[v * 3];
    accNrm[id * 3 + 1] += normals[v * 3 + 1];
    accNrm[id * 3 + 2] += normals[v * 3 + 2];
    accCol[id * 3] += colors[v * 3];
    accCol[id * 3 + 1] += colors[v * 3 + 1];
    accCol[id * 3 + 2] += colors[v * 3 + 2];
    accN[id]++;
  }
  const outPos = new Float32Array(next * 3);
  const outNrm = new Float32Array(next * 3);
  const outCol = new Float32Array(next * 3);
  const outUv = new Float32Array(next * 2);
  for (let i = 0; i < next; i++) {
    const n = accN[i];
    const px = accPos[i * 3] / n;
    const py = accPos[i * 3 + 1] / n;
    const pz = accPos[i * 3 + 2] / n;
    outPos[i * 3] = px;
    outPos[i * 3 + 1] = py;
    outPos[i * 3 + 2] = pz;
    let nx = accNrm[i * 3];
    let ny = accNrm[i * 3 + 1];
    let nz = accNrm[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    outNrm[i * 3] = nx;
    outNrm[i * 3 + 1] = ny;
    outNrm[i * 3 + 2] = nz;
    outCol[i * 3] = accCol[i * 3] / n;
    outCol[i * 3 + 1] = accCol[i * 3 + 1] / n;
    outCol[i * 3 + 2] = accCol[i * 3 + 2] / n;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (ay >= ax && ay >= az) {
      outUv[i * 2] = px;
      outUv[i * 2 + 1] = pz;
    } else if (ax >= az) {
      outUv[i * 2] = pz;
      outUv[i * 2 + 1] = py;
    } else {
      outUv[i * 2] = px;
      outUv[i * 2 + 1] = py;
    }
  }
  const outIdx: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    outIdx.push(a, b, c);
  }
  return {
    positions: outPos,
    normals: outNrm,
    colors: outCol,
    uvs: outUv,
    collarVertexStart: collarOut < 0 ? next : collarOut,
    indices: Uint32Array.from(outIdx),
  };
}
