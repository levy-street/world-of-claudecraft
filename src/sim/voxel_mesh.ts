// Seam-free chunked Surface Nets mesher for the voxel density field
// (voxel.ts). Pure and host-agnostic (no Three.js/DOM): returns plain typed
// arrays a renderer builds a BufferGeometry from, and a Vitest can exercise
// directly.
//
// Chunk boundary contract: `density` is a pure function of WORLD space
// (x, y, z, seed), so two chunks meshed with any overlap agree bit-for-bit on
// vertex position and normal in that overlap (no chunk-index-dependent
// state to drift). But a chunk meshed to EXACTLY its own bounds still cracks
// at the shared face: the face-quad passes below only emit a quad for a cell
// edge whose four surrounding cells are all inside the chunk, so the edges
// that straddle two exact-abutting chunks are never emitted by either side.
// Callers MUST mesh a volume padded at least one voxel past the chunk's own
// bounds on every side (as `voxel_terrain.ts` does) so the padding bands
// overlap and the shared boundary is covered twice, not zero times.
export type DensityFn = (x: number, y: number, z: number) => number;

export interface VoxelMesh {
  positions: Float32Array; // xyz per vertex
  normals: Float32Array; // xyz per vertex
  indices: Uint32Array; // triangle list
}

export interface VoxelChunkBounds {
  x0: number;
  y0: number;
  z0: number;
  size: number; // cube side length in world units
  resolution: number; // voxels per axis (e.g. 16)
}

const NORMAL_EPS = 0.05;

function gradientNormal(
  density: DensityFn,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  // Outward normal points from solid (negative density) toward air (positive
  // density), i.e. in the direction density INCREASES: the forward
  // difference (x+e) - (x-e), not the reverse.
  const e = NORMAL_EPS;
  const nx = density(x + e, y, z) - density(x - e, y, z);
  const ny = density(x, y + e, z) - density(x, y - e, z);
  const nz = density(x, y, z + e) - density(x, y, z - e);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// The 8 corner offsets of a unit cell, in the fixed order the edge table below
// assumes: 0..3 are the z0 face (bottom), 4..7 the z1 face (top), each in
// (x0,y0) (x1,y0) (x0,y1) (x1,y1) order.
const CORNER_OFFSETS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

// The 12 cell edges as [cornerA, cornerB] indices into CORNER_OFFSETS.
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

// Builds a Surface Nets mesh for exactly one chunk's cells. `density` must be
// the SAME pure function every chunk uses (voxelDensity bound to a seed);
// nothing about `bounds` leaks into the density samples' world coordinates.
export function meshVoxelChunk(density: DensityFn, bounds: VoxelChunkBounds): VoxelMesh {
  const { x0, y0, z0, size, resolution: n } = bounds;
  const step = size / n;

  // Corner density grid: (n+1)^3 points, indexed [ix][iy][iz].
  const stride = n + 1;
  const corner = new Float64Array(stride * stride * stride);
  const idx = (ix: number, iy: number, iz: number) => (ix * stride + iy) * stride + iz;
  for (let ix = 0; ix <= n; ix++) {
    for (let iy = 0; iy <= n; iy++) {
      for (let iz = 0; iz <= n; iz++) {
        corner[idx(ix, iy, iz)] = density(x0 + ix * step, y0 + iy * step, z0 + iz * step);
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  // cellVertex[cx][cy][cz] -> vertex index, or -1 if that cell has no crossing.
  const cellVertex = new Int32Array(n * n * n).fill(-1);
  const cellIdx = (cx: number, cy: number, cz: number) => (cx * n + cy) * n + cz;

  for (let cx = 0; cx < n; cx++) {
    for (let cy = 0; cy < n; cy++) {
      for (let cz = 0; cz < n; cz++) {
        const cornerVal: number[] = new Array(8);
        let signBits = 0;
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = CORNER_OFFSETS[c];
          const v = corner[idx(cx + ox, cy + oy, cz + oz)];
          cornerVal[c] = v;
          if (v < 0) signBits |= 1 << c;
        }
        if (signBits === 0 || signBits === 255) continue; // uniform cell, no surface

        let ex = 0;
        let ey = 0;
        let ez = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          const va = cornerVal[a];
          const vb = cornerVal[b];
          if (va < 0 === vb < 0) continue; // no sign change on this edge
          const t = va / (va - vb); // linear interpolation fraction toward b
          const [ax, ay, az] = CORNER_OFFSETS[a];
          const [bx, by, bz] = CORNER_OFFSETS[b];
          ex += ax + (bx - ax) * t;
          ey += ay + (by - ay) * t;
          ez += az + (bz - az) * t;
          crossings++;
        }
        const wx = x0 + (cx + ex / crossings) * step;
        const wy = y0 + (cy + ey / crossings) * step;
        const wz = z0 + (cz + ez / crossings) * step;

        cellVertex[cellIdx(cx, cy, cz)] = positions.length / 3;
        positions.push(wx, wy, wz);
        const n3 = gradientNormal(density, wx, wy, wz);
        normals.push(n3[0], n3[1], n3[2]);
      }
    }
  }

  const indices: number[] = [];
  // One quad per grid edge whose two endpoints have opposite solid/air sign,
  // connecting the (up to 4) cells that share that edge. Standard Surface
  // Nets face pass, axis by axis.
  const emitQuad = (solidAtA: boolean, v00: number, v10: number, v11: number, v01: number) => {
    if (v00 < 0 || v10 < 0 || v11 < 0 || v01 < 0) return;
    if (solidAtA) {
      indices.push(v00, v10, v11, v00, v11, v01);
    } else {
      indices.push(v00, v11, v10, v00, v01, v11);
    }
  };

  // X-aligned edges: for each grid point (ix, iy, iz) with iy,iz in [1,n-1]
  // range of shared cells, look at the edge from (ix,iy,iz) to (ix+1,iy,iz).
  for (let ix = 0; ix < n; ix++) {
    for (let iy = 1; iy < n; iy++) {
      for (let iz = 1; iz < n; iz++) {
        const a = corner[idx(ix, iy, iz)];
        const b = corner[idx(ix + 1, iy, iz)];
        if (a < 0 === b < 0) continue;
        const v00 = cellVertex[cellIdx(ix, iy - 1, iz - 1)];
        const v10 = cellVertex[cellIdx(ix, iy, iz - 1)];
        const v11 = cellVertex[cellIdx(ix, iy, iz)];
        const v01 = cellVertex[cellIdx(ix, iy - 1, iz)];
        emitQuad(a < 0, v00, v10, v11, v01);
      }
    }
  }
  // Y-aligned edges.
  for (let ix = 1; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      for (let iz = 1; iz < n; iz++) {
        const a = corner[idx(ix, iy, iz)];
        const b = corner[idx(ix, iy + 1, iz)];
        if (a < 0 === b < 0) continue;
        const v00 = cellVertex[cellIdx(ix - 1, iy, iz - 1)];
        const v10 = cellVertex[cellIdx(ix, iy, iz - 1)];
        const v11 = cellVertex[cellIdx(ix, iy, iz)];
        const v01 = cellVertex[cellIdx(ix - 1, iy, iz)];
        emitQuad(a >= 0, v00, v10, v11, v01);
      }
    }
  }
  // Z-aligned edges.
  for (let ix = 1; ix < n; ix++) {
    for (let iy = 1; iy < n; iy++) {
      for (let iz = 0; iz < n; iz++) {
        const a = corner[idx(ix, iy, iz)];
        const b = corner[idx(ix, iy, iz + 1)];
        if (a < 0 === b < 0) continue;
        const v00 = cellVertex[cellIdx(ix - 1, iy - 1, iz)];
        const v10 = cellVertex[cellIdx(ix, iy - 1, iz)];
        const v11 = cellVertex[cellIdx(ix, iy, iz)];
        const v01 = cellVertex[cellIdx(ix - 1, iy, iz)];
        emitQuad(a < 0, v00, v10, v11, v01);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
