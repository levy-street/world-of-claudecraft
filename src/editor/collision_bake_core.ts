// Collision baking core: triangle soup -> a handful of tight boxes.
//
// The pipeline (all deterministic, no deps, no DOM/three - runs in the node
// bake script via esbuild-bundle AND in the browser at model-import time):
//   1. Voxelize the triangles onto a small occupancy grid (conservative
//      triangle/box overlap, Akenine-Moller separating axes).
//   2. Flood-fill the EXTERIOR air from the grid border. Anything the flood
//      cannot reach is interior and gets solidified - but openings the flood
//      walks through (archways, door gaps) stay open. This is what keeps a
//      baked arch walkable while a crate still becomes one solid box.
//   3. Greedy-merge the occupied voxels into as few axis-aligned boxes as
//      possible (grown x, then z, then y in a fixed scan order).
//   4. If the budget is exceeded, coarsen the resolution and retry; as a last
//      resort keep the biggest boxes.
//
// The grid resolution doubles as the "snag filter": features smaller than a
// voxel (door handles, pebbles, trim) simply do not register, so walls stay
// smooth to slide along. Boxes come back in the INPUT units - callers feed
// normalized world yards and get world-yard boxes.

/** Axis-aligned box in model space: center + half extents (input units). */
export interface CollisionBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface CollisionBakeOptions {
  /** Voxel edge length in input units. Features under this smooth away. */
  resolution: number;
  /** Box budget; exceeded bakes retry coarser, then keep the biggest. */
  maxBoxes: number;
  /** Trunk mode: ignore triangles whose centroid sits above this height. */
  maxHeight?: number;
  /** Trunk mode: ignore voxels beyond this XZ radius of the model's axis. */
  maxRadiusXZ?: number;
  /**
   * Leniency margin (input units): every emitted box shrinks by half a voxel
   * (the conservative-marking fat) PLUS this. Under-hugging is the point -
   * clipping slightly into a wall beats an invisible one. 0 = exact hug.
   */
  deflate?: number;
}

/** How a category of asset bakes. 'trunk' clips to the lower stem (trees);
 *  'stairs' emits a walkable ramp instead of blocking boxes; 'none' keeps the
 *  legacy collide-circle (nothing worth hugging). */
export type BakeCategory = 'default' | 'trunk' | 'stairs' | 'none';

/**
 * Type-aware bake category for a catalog asset id ('foliage/oak_1',
 * 'biome/city_wagon', 'local/<sha>', ...). Trees block at the trunk so the
 * canopy never walls the player; stairs/ramps become walkable decks;
 * grass-likes and procedural placements keep the legacy circle.
 */
export function bakeCategoryFor(assetId: string): BakeCategory {
  // Procedural placements have no GLB to bake.
  if (
    assetId.startsWith('grass/') ||
    assetId.startsWith('water/') ||
    assetId.startsWith('rock/') ||
    assetId.startsWith('collider/') ||
    assetId.startsWith('fluid/') ||
    assetId.startsWith('cave/')
  ) {
    return 'none';
  }
  const name = assetId.split('/').pop() ?? '';
  // Trees (the foliage families the renderer scales as trees) + palms.
  if (/^(oak|pine|twisted|dead)/i.test(name) && assetId.startsWith('foliage/')) return 'trunk';
  if (/palm/i.test(name)) return 'trunk';
  // Ground-cover foliage never needs a hugging shape; the circle is truer to
  // how a bush blocks (soft blob) and cheaper.
  if (assetId.startsWith('foliage/') && /^(bush|fern|mushroom|grass)/i.test(name)) return 'none';
  // Stairs, steps, and ramps: a walkable deck, not a wall.
  if (/stair|steps|_ramp|ramp_/i.test(name)) return 'stairs';
  return 'default';
}

// Opening-heavy assets (archways, gates, doors, bridges): bake finer so the
// hole the player walks through keeps its authored width.
const OPENING_HINT = /arch|gate|door|entr|portal|bridge|tunnel|window|fence/i;

/** The options a category bakes with, sized to the model (input units).
 *  `assetId` sharpens opening-heavy assets (arches/gates/doors). */
export function bakeOptionsFor(
  category: BakeCategory,
  size: { x: number; y: number; z: number },
  assetId?: string,
): CollisionBakeOptions {
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  // Fine grids hug real silhouettes: ~32 cells across the largest dimension,
  // floored so sub-step detail still smooths away, capped for tiny props.
  let resolution = Math.min(0.35, Math.max(0.15, maxDim / 32));
  if (assetId && OPENING_HINT.test(assetId)) resolution = Math.min(resolution, 0.16);
  // Lenient by default: boxes shrink half a voxel (the conservative-marking
  // fat) + this margin, absorbing a chunk of the mover radius too.
  const deflate = 0.12;
  if (category === 'trunk') {
    return {
      resolution: Math.max(0.2, maxDim / 24),
      maxBoxes: 4,
      deflate,
      // The stem: the lower ~38% of the model, near its vertical axis.
      maxHeight: size.y * 0.38,
      maxRadiusXZ: Math.max(size.x, size.z) * 0.18,
    };
  }
  // The box budget scales with the PLAYER, not the mesh. Collision fidelity
  // only matters at gaps a body could occupy: a cup, sack or skull can never
  // be walked through, so it collides as one blob no matter how ornate its
  // silhouette (unbudgeted, small curvy props fragmented into 20+ boxes and
  // the per-placement collider count tripled on dressed maps). Only assets
  // with a walk-through opening keep the fine multi-box hug.
  if (maxDim <= 1.6) {
    // Hand props: a single union blob (bakeCollisionBoxes special-cases 1),
    // on a coarser grid, the boxes are about to be unioned anyway.
    return { resolution: Math.min(0.35, Math.max(0.2, maxDim / 8)), maxBoxes: 1, deflate };
  }
  if (maxDim <= 3.5 && !(assetId && OPENING_HINT.test(assetId))) {
    // Furniture / market clutter: a handful of boxes reads as its shape.
    return { resolution, maxBoxes: 6, deflate };
  }
  return { resolution, maxBoxes: assetId && OPENING_HINT.test(assetId) ? 20 : 12, deflate };
}

// Grid cells are capped so a degenerate model can never explode memory.
const MAX_CELLS_PER_AXIS = 64;

interface Grid {
  nx: number;
  ny: number;
  nz: number;
  minX: number;
  minY: number;
  minZ: number;
  res: number;
  // 0 = air, 1 = occupied.
  cells: Uint8Array;
}

function idx(g: Grid, x: number, y: number, z: number): number {
  return (y * g.nz + z) * g.nx + x;
}

// ---- triangle/box overlap (separating axis, Akenine-Moller) ----------------

function planeBoxOverlap(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  const r = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
  return Math.abs(d) <= r;
}

/** Triangle (translated so the box center is the origin) vs box half-extents. */
function triBoxOverlap(
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  // 1) AABB of the triangle vs box.
  if (Math.min(v0x, v1x, v2x) > hx || Math.max(v0x, v1x, v2x) < -hx) return false;
  if (Math.min(v0y, v1y, v2y) > hy || Math.max(v0y, v1y, v2y) < -hy) return false;
  if (Math.min(v0z, v1z, v2z) > hz || Math.max(v0z, v1z, v2z) < -hz) return false;
  // 2) Nine cross-axis tests.
  const e0x = v1x - v0x,
    e0y = v1y - v0y,
    e0z = v1z - v0z;
  const e1x = v2x - v1x,
    e1y = v2y - v1y,
    e1z = v2z - v1z;
  const e2x = v0x - v2x,
    e2y = v0y - v2y,
    e2z = v0z - v2z;
  const axis = (
    ax: number,
    ay: number,
    az: number,
    p0: number,
    p1: number,
    p2: number,
  ): boolean => {
    const r = hx * Math.abs(ax) + hy * Math.abs(ay) + hz * Math.abs(az);
    const mn = Math.min(p0, p1, p2);
    const mx = Math.max(p0, p1, p2);
    return mn <= r && mx >= -r;
  };
  // a = e cross unit axes; p_i = a . v_i
  if (!axis(0, -e0z, e0y, -e0z * v0y + e0y * v0z, -e0z * v1y + e0y * v1z, -e0z * v2y + e0y * v2z))
    return false;
  if (!axis(0, -e1z, e1y, -e1z * v0y + e1y * v0z, -e1z * v1y + e1y * v1z, -e1z * v2y + e1y * v2z))
    return false;
  if (!axis(0, -e2z, e2y, -e2z * v0y + e2y * v0z, -e2z * v1y + e2y * v1z, -e2z * v2y + e2y * v2z))
    return false;
  if (!axis(e0z, 0, -e0x, e0z * v0x - e0x * v0z, e0z * v1x - e0x * v1z, e0z * v2x - e0x * v2z))
    return false;
  if (!axis(e1z, 0, -e1x, e1z * v0x - e1x * v0z, e1z * v1x - e1x * v1z, e1z * v2x - e1x * v2z))
    return false;
  if (!axis(e2z, 0, -e2x, e2z * v0x - e2x * v0z, e2z * v1x - e2x * v1z, e2z * v2x - e2x * v2z))
    return false;
  if (!axis(-e0y, e0x, 0, -e0y * v0x + e0x * v0y, -e0y * v1x + e0x * v1y, -e0y * v2x + e0x * v2y))
    return false;
  if (!axis(-e1y, e1x, 0, -e1y * v0x + e1x * v0y, -e1y * v1x + e1x * v1y, -e1y * v2x + e1x * v2y))
    return false;
  if (!axis(-e2y, e2x, 0, -e2y * v0x + e2x * v0y, -e2y * v1x + e2x * v1y, -e2y * v2x + e2x * v2y))
    return false;
  // 3) Triangle plane vs box.
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  return planeBoxOverlap(nx, ny, nz, nx * v0x + ny * v0y + nz * v0z, hx, hy, hz);
}

// ---- bake ------------------------------------------------------------------

/**
 * Bake `triangles` (xyz per vertex, 9 floats per triangle, input units) into
 * a small set of tight axis-aligned boxes. Empty result = nothing to bake
 * (degenerate mesh or everything filtered by trunk mode).
 */
export function bakeCollisionBoxes(
  triangles: Float32Array | number[],
  opts: CollisionBakeOptions,
): CollisionBox[] {
  // Blob mode (maxBoxes 1): the union AABB of whatever baked, not the biggest
  // fragment, a small prop blocks as its whole body, never as a shard of it.
  if (opts.maxBoxes === 1) {
    const boxes = finishBoxes(bakeOnce(triangles, opts), opts.resolution, opts);
    if (boxes.length <= 1) return boxes;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.cx - b.hx);
      maxX = Math.max(maxX, b.cx + b.hx);
      minY = Math.min(minY, b.cy - b.hy);
      maxY = Math.max(maxY, b.cy + b.hy);
      minZ = Math.min(minZ, b.cz - b.hz);
      maxZ = Math.max(maxZ, b.cz + b.hz);
    }
    return [
      {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        cz: (minZ + maxZ) / 2,
        hx: (maxX - minX) / 2,
        hy: (maxY - minY) / 2,
        hz: (maxZ - minZ) / 2,
      },
    ];
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = opts.resolution * 1.5 ** attempt;
    const boxes = finishBoxes(bakeOnce(triangles, { ...opts, resolution: res }), res, opts);
    if (boxes.length <= opts.maxBoxes) return boxes;
    if (attempt === 2) {
      // Last resort: the biggest boxes win (ties break on position so the
      // result stays deterministic).
      boxes.sort(
        (a, b) =>
          b.hx * b.hy * b.hz - a.hx * a.hy * a.hz || a.cy - b.cy || a.cx - b.cx || a.cz - b.cz,
      );
      return boxes.slice(0, opts.maxBoxes);
    }
  }
  return [];
}

// A deflated box whose horizontal footprint is this thin is a snag hazard
// (chair legs, trim) unless it is tall enough to be a real pole/wall.
const SLIVER_EXTENT = 0.07;
const SLIVER_KEEP_HEIGHT = 0.9;

/**
 * The leniency pass: shrink every merged box by half a voxel (the amount
 * conservative marking over-fattens by construction) plus opts.deflate, so
 * colliders sit slightly INSIDE the visual surface - grazing a wall clips a
 * little instead of hitting an invisible one - and drop sliver boxes that
 * would only ever snag. Openings (archways, gaps between jambs) widen back to
 * their authored size as a direct consequence.
 */
function finishBoxes(
  boxes: CollisionBox[],
  res: number,
  opts: CollisionBakeOptions,
): CollisionBox[] {
  const shrink = res * 0.5 + (opts.deflate ?? 0);
  const out: CollisionBox[] = [];
  for (const b of boxes) {
    // Never eat more than ~45% of an extent: a small prop's thin panels keep
    // their substance while a building's thick walls give the full margin.
    const hx = b.hx - Math.min(shrink, b.hx * 0.45);
    const hz = b.hz - Math.min(shrink, b.hz * 0.45);
    // Vertical shrink comes off the BOTTOM only: the step-over gate reads box
    // TOPS, so deflating a crate's top would flip it from blocker to vaultable.
    const vy = Math.min(shrink * 0.5, b.hy * 0.45);
    const hy = b.hy - vy / 2;
    const cy = b.cy + vy / 2;
    if ((hx < SLIVER_EXTENT || hz < SLIVER_EXTENT) && hy * 2 < SLIVER_KEEP_HEIGHT) continue;
    out.push({ cx: b.cx, cy, cz: b.cz, hx, hy, hz });
  }
  return out;
}

function bakeOnce(triangles: Float32Array | number[], opts: CollisionBakeOptions): CollisionBox[] {
  const triCount = Math.floor(triangles.length / 9);
  if (triCount === 0) return [];
  const maxH = opts.maxHeight ?? Infinity;
  // Bounds over the (height-filtered) triangles.
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let any = false;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cy = (triangles[o + 1] + triangles[o + 4] + triangles[o + 7]) / 3;
    if (cy > maxH) continue;
    any = true;
    for (let v = 0; v < 3; v++) {
      const x = triangles[o + v * 3];
      const y = triangles[o + v * 3 + 1];
      const z = triangles[o + v * 3 + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (!any) return [];
  const res = opts.resolution;
  const nx = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxX - minX) / res)));
  const ny = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxY - minY) / res)));
  const nz = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxZ - minZ) / res)));
  const g: Grid = { nx, ny, nz, minX, minY, minZ, res, cells: new Uint8Array(nx * ny * nz) };
  // Conservative pad: a face lying EXACTLY on a voxel boundary must still
  // register (float error otherwise loses the equality by ~1e-16 and a whole
  // wall goes unbaked, unsealing the interior flood fill).
  const half = res / 2 + res * 1e-6;
  // Trunk mode: the model's vertical axis (XZ center of the full bounds).
  const axisX = (minX + maxX) / 2;
  const axisZ = (minZ + maxZ) / 2;
  const maxRad = opts.maxRadiusXZ ?? Infinity;
  // 1) surface voxelization
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cyTri = (triangles[o + 1] + triangles[o + 4] + triangles[o + 7]) / 3;
    if (cyTri > maxH) continue;
    const tminx = Math.min(triangles[o], triangles[o + 3], triangles[o + 6]);
    const tmaxx = Math.max(triangles[o], triangles[o + 3], triangles[o + 6]);
    const tminy = Math.min(triangles[o + 1], triangles[o + 4], triangles[o + 7]);
    const tmaxy = Math.max(triangles[o + 1], triangles[o + 4], triangles[o + 7]);
    const tminz = Math.min(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    const tmaxz = Math.max(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    // Clamp BOTH ends into the grid: a triangle lying exactly on the max
    // bounds plane floors to cell nx (one past the end) and would otherwise
    // produce an empty range - the whole far wall of a crate went unbaked.
    const x0 = Math.min(nx - 1, Math.max(0, Math.floor((tminx - minX) / res)));
    const x1 = Math.min(nx - 1, Math.max(0, Math.floor((tmaxx - minX) / res)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor((tminy - minY) / res)));
    const y1 = Math.min(ny - 1, Math.max(0, Math.floor((tmaxy - minY) / res)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor((tminz - minZ) / res)));
    const z1 = Math.min(nz - 1, Math.max(0, Math.floor((tmaxz - minZ) / res)));
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const i = idx(g, x, y, z);
          if (g.cells[i]) continue;
          const cx = minX + (x + 0.5) * res;
          const cy = minY + (y + 0.5) * res;
          const cz = minZ + (z + 0.5) * res;
          if (Math.hypot(cx - axisX, cz - axisZ) > maxRad) continue;
          if (
            triBoxOverlap(
              triangles[o] - cx,
              triangles[o + 1] - cy,
              triangles[o + 2] - cz,
              triangles[o + 3] - cx,
              triangles[o + 4] - cy,
              triangles[o + 5] - cz,
              triangles[o + 6] - cx,
              triangles[o + 7] - cy,
              triangles[o + 8] - cz,
              half,
              half,
              half,
            )
          ) {
            g.cells[i] = 1;
          }
        }
      }
    }
  }
  // 2) exterior flood fill: air reachable from the border stays air; every
  // unreachable pocket solidifies. Openings the flood walks through (arches)
  // stay open by construction.
  const exterior = new Uint8Array(nx * ny * nz);
  const queue: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = idx(g, x, y, z);
    if (exterior[i] || g.cells[i]) return;
    exterior[i] = 1;
    queue.push(x, y, z);
  };
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      push(0, y, z);
      push(nx - 1, y, z);
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      push(x, y, 0);
      push(x, y, nz - 1);
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      push(x, 0, z);
      push(x, ny - 1, z);
    }
  }
  while (queue.length > 0) {
    const z = queue.pop() as number;
    const y = queue.pop() as number;
    const x = queue.pop() as number;
    push(x + 1, y, z);
    push(x - 1, y, z);
    push(x, y + 1, z);
    push(x, y - 1, z);
    push(x, y, z + 1);
    push(x, y, z - 1);
  }
  for (let i = 0; i < g.cells.length; i++) {
    if (!g.cells[i] && !exterior[i]) g.cells[i] = 1; // interior pocket
  }
  // 3) greedy merge into boxes (fixed scan order = deterministic output).
  const consumed = new Uint8Array(nx * ny * nz);
  const boxes: CollisionBox[] = [];
  const filled = (x: number, y: number, z: number): boolean => {
    const i = idx(g, x, y, z);
    return g.cells[i] === 1 && consumed[i] === 0;
  };
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!filled(x, y, z)) continue;
        // Grow along +x.
        let ex = x;
        while (ex + 1 < nx && filled(ex + 1, y, z)) ex++;
        // Grow along +z while the whole x-run stays filled.
        let ez = z;
        outerZ: while (ez + 1 < nz) {
          for (let xi = x; xi <= ex; xi++) if (!filled(xi, y, ez + 1)) break outerZ;
          ez++;
        }
        // Grow along +y while the whole xz-slab stays filled.
        let ey = y;
        outerY: while (ey + 1 < ny) {
          for (let zi = z; zi <= ez; zi++) {
            for (let xi = x; xi <= ex; xi++) if (!filled(xi, ey + 1, zi)) break outerY;
          }
          ey++;
        }
        for (let yi = y; yi <= ey; yi++) {
          for (let zi = z; zi <= ez; zi++) {
            for (let xi = x; xi <= ex; xi++) consumed[idx(g, xi, yi, zi)] = 1;
          }
        }
        boxes.push({
          cx: minX + ((x + ex + 1) / 2) * res,
          cy: minY + ((y + ey + 1) / 2) * res,
          cz: minZ + ((z + ez + 1) / 2) * res,
          hx: ((ex - x + 1) / 2) * res,
          hy: ((ey - y + 1) / 2) * res,
          hz: ((ez - z + 1) / 2) * res,
        });
      }
    }
  }
  return boxes;
}

// ---- stairs: walkable ramp fitting ------------------------------------------

/**
 * A walkable deck fitted over a stairs/ramp asset, in normalized model space
 * (axis-aligned before placement yaw). The deck rises from `yNeg` at the
 * footprint's negative edge along `axis` to `yPos` at its positive edge; the
 * sim raises the walkable ground along it (and stairs bake NO blocking boxes:
 * you walk up them, and grazing the sides clips instead of walling).
 */
export interface CollisionRamp {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  axis: 'x' | 'z';
  yNeg: number;
  yPos: number;
}

/**
 * Fit the ramp for a stairs-category asset: voxelize, take each XZ column's
 * TOP surface, pick the longer horizontal axis as the climb direction, and
 * average the tops in the end bands to get the deck's two edge heights.
 * Straight flights fit exactly; curved stairs get a serviceable approximation.
 * Null = nothing to stand on (degenerate mesh).
 */
export function bakeRampSurface(
  triangles: Float32Array | number[],
  opts: CollisionBakeOptions,
): CollisionRamp | null {
  const grid = voxelizeForRamp(triangles, opts);
  if (!grid) return null;
  const { g } = grid;
  // Column tops: highest occupied voxel per (x, z) column.
  const tops = new Float32Array(g.nx * g.nz).fill(Number.NaN);
  let colMinX = Infinity;
  let colMaxX = -Infinity;
  let colMinZ = Infinity;
  let colMaxZ = -Infinity;
  let any = false;
  for (let z = 0; z < g.nz; z++) {
    for (let x = 0; x < g.nx; x++) {
      for (let y = g.ny - 1; y >= 0; y--) {
        if (g.cells[idx(g, x, y, z)]) {
          tops[z * g.nx + x] = g.minY + (y + 1) * g.res;
          any = true;
          colMinX = Math.min(colMinX, x);
          colMaxX = Math.max(colMaxX, x);
          colMinZ = Math.min(colMinZ, z);
          colMaxZ = Math.max(colMaxZ, z);
          break;
        }
      }
    }
  }
  if (!any) return null;
  const cx = g.minX + ((colMinX + colMaxX + 1) / 2) * g.res;
  const cz = g.minZ + ((colMinZ + colMaxZ + 1) / 2) * g.res;
  const hx = ((colMaxX - colMinX + 1) / 2) * g.res;
  const hz = ((colMaxZ - colMinZ + 1) / 2) * g.res;
  const axis: 'x' | 'z' = hx >= hz ? 'x' : 'z';
  // Average column tops in the 25% band at each end of the climb axis.
  const bandAvg = (positive: boolean): number => {
    let sum = 0;
    let n = 0;
    const lo = axis === 'x' ? colMinX : colMinZ;
    const hi = axis === 'x' ? colMaxX : colMaxZ;
    const band = Math.max(1, Math.round((hi - lo + 1) * 0.25));
    for (let z = colMinZ; z <= colMaxZ; z++) {
      for (let x = colMinX; x <= colMaxX; x++) {
        const along = axis === 'x' ? x : z;
        const inBand = positive ? along > hi - band : along < lo + band;
        if (!inBand) continue;
        const top = tops[z * g.nx + x];
        if (!Number.isNaN(top)) {
          sum += top;
          n++;
        }
      }
    }
    return n > 0 ? sum / n : 0;
  };
  return { cx, cz, hx, hz, axis, yNeg: bandAvg(false), yPos: bandAvg(true) };
}

/** Voxelize triangles for the ramp fit (occupancy only, no flood/merge). */
function voxelizeForRamp(
  triangles: Float32Array | number[],
  opts: CollisionBakeOptions,
): { g: Grid } | null {
  // Reuse the main pipeline's grid by running its voxelization: bakeOnce is
  // structured around box output, so keep this small and independent instead.
  const triCount = Math.floor(triangles.length / 9);
  if (triCount === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let t = 0; t < triCount * 9; t += 3) {
    minX = Math.min(minX, triangles[t]);
    maxX = Math.max(maxX, triangles[t]);
    minY = Math.min(minY, triangles[t + 1]);
    maxY = Math.max(maxY, triangles[t + 1]);
    minZ = Math.min(minZ, triangles[t + 2]);
    maxZ = Math.max(maxZ, triangles[t + 2]);
  }
  const res = opts.resolution;
  const nx = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxX - minX) / res)));
  const ny = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxY - minY) / res)));
  const nz = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((maxZ - minZ) / res)));
  const g: Grid = { nx, ny, nz, minX, minY, minZ, res, cells: new Uint8Array(nx * ny * nz) };
  const half = res / 2 + res * 1e-6;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const tminx = Math.min(triangles[o], triangles[o + 3], triangles[o + 6]);
    const tmaxx = Math.max(triangles[o], triangles[o + 3], triangles[o + 6]);
    const tminy = Math.min(triangles[o + 1], triangles[o + 4], triangles[o + 7]);
    const tmaxy = Math.max(triangles[o + 1], triangles[o + 4], triangles[o + 7]);
    const tminz = Math.min(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    const tmaxz = Math.max(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    const x0 = Math.min(nx - 1, Math.max(0, Math.floor((tminx - minX) / res)));
    const x1 = Math.min(nx - 1, Math.max(0, Math.floor((tmaxx - minX) / res)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor((tminy - minY) / res)));
    const y1 = Math.min(ny - 1, Math.max(0, Math.floor((tmaxy - minY) / res)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor((tminz - minZ) / res)));
    const z1 = Math.min(nz - 1, Math.max(0, Math.floor((tmaxz - minZ) / res)));
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const i = idx(g, x, y, z);
          if (g.cells[i]) continue;
          const cxV = minX + (x + 0.5) * res;
          const cyV = minY + (y + 0.5) * res;
          const czV = minZ + (z + 0.5) * res;
          if (
            triBoxOverlap(
              triangles[o] - cxV,
              triangles[o + 1] - cyV,
              triangles[o + 2] - czV,
              triangles[o + 3] - cxV,
              triangles[o + 4] - cyV,
              triangles[o + 5] - czV,
              triangles[o + 6] - cxV,
              triangles[o + 7] - cyV,
              triangles[o + 8] - czV,
              half,
              half,
              half,
            )
          ) {
            g.cells[i] = 1;
          }
        }
      }
    }
  }
  return { g };
}
