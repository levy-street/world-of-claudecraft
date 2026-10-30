// World-scale tiling for the Eastbrook surface atlas (pure, Three-free).
//
// The atlas (eastbrook_surface_atlas.ts) packs sixteen 128px material cells
// into one 512px texture, so hardware wrapping cannot repeat a cell: a mesh
// whose UVs leave a cell samples its neighbour. The original synthesis
// therefore stretched ONE cell across each mesh's whole bounding box, so a
// stall's canvas stripes were most of a yard wide and a nine-yard fence wore
// one plank texture end to end. This core tiles a cell at a fixed WORLD size
// instead, with no shader change: every triangle is projected into its face's
// own frame (v up the face, so shingle rows and plank grain stay level on
// walls and run down roof slopes), the projection is divided by the cell's
// repeat size in yards, and the triangle is clipped along the integer repeat
// lines, so each piece lies inside one repeat and maps into the cell's usable
// rectangle. Neighbouring pieces meet on the same world grid, so the pattern
// runs continuously across them.
//
// Three ways to map a triangle, chosen per triangle by the caller:
//   - 'grid': clip along the world repeat grid (any size, continuous across
//     every triangle that shares the face's plane). The default.
//   - 'island': a face that fits inside one repeat keeps its own origin, with
//     a deterministic offset inside the cell taken from its centre, so a wall
//     of separately modelled blocks shows a different patch of grain on each
//     block instead of the same corner of the cell. Falls back to 'grid' when
//     the face is larger than one repeat.
//   - 'fit': one repeat stretched over the face (faces nobody sees, such as a
//     core box behind its ashlar).
// Optional horizontal split planes (world heights) clip faces too, so a
// per-vertex grime gradient has vertices at the band it fades across.

/** Atlas grid: 4 x 4 cells of 128px in a 512px texture, 4px of padding each side. */
export const EASTBROOK_ATLAS_COLUMNS = 4;
export const EASTBROOK_ATLAS_ROWS = 4;
export const EASTBROOK_ATLAS_PIXELS = 512;
export const EASTBROOK_ATLAS_CELL_PADDING_PIXELS = 4;

const CELL_UV = 1 / EASTBROOK_ATLAS_COLUMNS;
const PADDING_UV = EASTBROOK_ATLAS_CELL_PADDING_PIXELS / EASTBROOK_ATLAS_PIXELS;
/** The usable square of one cell in UV units (the padding is never addressed directly). */
export const EASTBROOK_ATLAS_CELL_USABLE_UV = CELL_UV - PADDING_UV * 2;

export interface AtlasCellRect {
  u0: number;
  v0: number;
  size: number;
}

/** The usable rectangle of `cell` (row-major from the top-left, flipY texture). */
export function eastbrookAtlasCellRect(cell: number): AtlasCellRect {
  const column = cell % EASTBROOK_ATLAS_COLUMNS;
  const rowFromTop = Math.floor(cell / EASTBROOK_ATLAS_COLUMNS);
  return {
    u0: column * CELL_UV + PADDING_UV,
    v0: 1 - (rowFromTop + 1) * CELL_UV + PADDING_UV,
    size: EASTBROOK_ATLAS_CELL_USABLE_UV,
  };
}

/** The cell an atlas UV lands in (the inverse of eastbrookAtlasCellRect). */
export function eastbrookAtlasCellOfUv(u: number, v: number): number {
  const column = Math.min(
    EASTBROOK_ATLAS_COLUMNS - 1,
    Math.max(0, Math.floor(u * EASTBROOK_ATLAS_COLUMNS)),
  );
  const rowFromTop = Math.min(
    EASTBROOK_ATLAS_ROWS - 1,
    Math.max(0, Math.floor((1 - v) * EASTBROOK_ATLAS_ROWS)),
  );
  return rowFromTop * EASTBROOK_ATLAS_COLUMNS + column;
}

/**
 * Yards per repeat of each cell, [along the face, up the face], in
 * EASTBROOK_SURFACE_CELLS order. Sized from the features each cell paints so
 * they read at a believable size beside a 2-yard character: dressed blocks
 * about 0.75 x 0.4 yd, rubble about 0.55 yd, boards and planks about 0.25 yd,
 * shingles about 0.3 yd, canvas stripes about 0.2 to 0.3 yd, riveted plates
 * about a yard. The old bounding-box mapping put one repeat across a whole
 * mesh (2.8 yd on a stall, up to 9.4 yd on a fence), so these are 1.4x to 7x
 * denser per yard on the shipped placements (2.3x on the stall canvas).
 */
export const EASTBROOK_SURFACE_REPEAT_YARDS: readonly (readonly [number, number])[] = Object.freeze(
  [
    [1.6, 1.6], // darkStoneBlocks: ~2 blocks by 3.5 courses
    [1.8, 1.8], // lightStoneBlocks: ~2.5 blocks by 4.5 courses
    [2.0, 2.0], // warmPlaster: trowelled grain
    [1.25, 2.0], // verticalDarkTimber: ~5 boards across, grain runs up
    [1.5, 1.5], // cobaltRoofShingles: ~5 shingles by 5.5 rows
    [1.0, 1.0], // darkForgedMetal: one riveted plate
    [1.0, 1.0], // warmGoldMetal: one riveted plate
    [2.0, 1.25], // horizontalWarmTimber: ~5 planks up, grain runs along
    [1.2, 1.2], // blueCreamCanvas: ~4 stripes
    [1.4, 1.4], // redCreamCanvas: ~7 stripes
    [1.2, 1.2], // darkBrownLeather: grain
    [1.6, 1.6], // irregularDarkStone: ~3 flags across
    [1.2, 1.2], // cyanCrystal: crystal scatter
    [2.0, 1.2], // cobaltPaintedPlanks: ~4 planks up
    [2.0, 2.0], // lightGrayStone: granite grain (no joints: a long repeat hides it)
    [2.0, 2.0], // mediumGrayStone: granite grain
  ].map((pair) => Object.freeze(pair as [number, number])),
);

export type SurfaceTileMode = 'grid' | 'island' | 'fit';

export interface SurfaceTilingInput {
  /** Non-indexed triangle soup, xyz per vertex, in yards in the frame the grid is laid in. */
  positions: ArrayLike<number>;
  /** Per-vertex normals (orient the face frame when winding is ambiguous), or null. */
  normals: ArrayLike<number> | null;
  /** Per-vertex rgb, carried through the clip, or null. */
  colors: ArrayLike<number> | null;
  /** The atlas cell of triangle `index`. */
  cellOfTriangle: (index: number) => number;
  /** The mapping of triangle `index` (default 'grid'). */
  modeOfTriangle?: (index: number) => SurfaceTileMode;
  /** World heights (frame y) every face is also clipped along. */
  heightSplits?: readonly number[];
  /** Repeat sizes per cell (default EASTBROOK_SURFACE_REPEAT_YARDS). */
  repeatYards?: readonly (readonly [number, number])[];
  /** Value spread of each 'island' face (plus or minus this fraction of its
   *  colour), seeded by the same hash as its patch: separately modelled
   *  blocks read as separately quarried stones. 0 or absent for none. */
  islandValueSpread?: number;
}

export interface SurfaceTilingOutput {
  positions: Float32Array;
  normals: Float32Array | null;
  colors: Float32Array | null;
  uvs: Float32Array;
  triangleCount: number;
}

// Per-vertex record while clipping: position, normal, colour, then the two
// projected repeat coordinates. Attributes interpolate linearly along an edge.
const Y = 1;
const S = 9;
const T = 10;
const STRIDE = 11;
/** Cuts closer than this (in repeats) to a face's own edge are skipped: no slivers. */
const CUT_EPSILON = 1e-5;
/** Pieces under this area (square yards) are dropped. */
const MIN_PIECE_AREA = 1e-9;
/** Face-frame bands on |n.y|: walls below, flat floors and tops above. */
const WALL_NY = 0.35;
const FLAT_NY = 0.95;
/** An 'island' face up to this many repeats across is squeezed into one
 *  repeat (at most 20 percent, unreadable on grain) rather than clipped: a
 *  1.64-yard ashlar face on a 1.6-yard repeat stays two triangles. */
export const ISLAND_SQUEEZE_LIMIT = 1.25;
/** Faces shorter than this (yards, frame y) are not cut along the height
 *  splits: their own vertices already sample a grime band finely. */
export const HEIGHT_SPLIT_MIN_SPAN = 0.6;
/** A face narrower than this share of a repeat along an axis is not cut
 *  along that axis's repeat lines: it takes the repeat its centre lies in
 *  and the sliver past the line clamps to the cell edge (under 5 texels of a
 *  120px repeat). The props' small bevels, rivets and crate edges would
 *  otherwise each turn into two or three triangles for nothing visible. */
export const GRID_MIN_SPLIT_SPAN = 0.04;

type Vertex = Float64Array;

function lerpVertex(a: Vertex, b: Vertex, t: number): Vertex {
  const out = new Float64Array(STRIDE);
  for (let k = 0; k < STRIDE; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Sutherland-Hodgman against one axis-aligned line: keeps the side where
 *  `sign * (value - v[axis]) >= 0`. Preserves winding. */
function clipAgainst(poly: Vertex[], axis: number, value: number, keepBelow: boolean): Vertex[] {
  const out: Vertex[] = [];
  const count = poly.length;
  for (let index = 0; index < count; index++) {
    const a = poly[index];
    const b = poly[(index + 1) % count];
    const da = keepBelow ? value - a[axis] : a[axis] - value;
    const db = keepBelow ? value - b[axis] : b[axis] - value;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const crossing = lerpVertex(a, b, da / (da - db));
      crossing[axis] = value;
      out.push(crossing);
    }
  }
  return out;
}

/** Split `poly` along every cut strictly inside its range on `axis`. */
function splitAlong(poly: Vertex[], axis: number, cuts: readonly number[]): Vertex[][] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const vertex of poly) {
    low = Math.min(low, vertex[axis]);
    high = Math.max(high, vertex[axis]);
  }
  const pieces: Vertex[][] = [];
  let rest = poly;
  for (const cut of cuts) {
    if (cut <= low + CUT_EPSILON || cut >= high - CUT_EPSILON) continue;
    const below = clipAgainst(rest, axis, cut, true);
    if (below.length >= 3) pieces.push(below);
    rest = clipAgainst(rest, axis, cut, false);
    if (rest.length < 3) return pieces;
  }
  pieces.push(rest);
  return pieces;
}

function integerCuts(poly: Vertex[], axis: number): number[] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const vertex of poly) {
    low = Math.min(low, vertex[axis]);
    high = Math.max(high, vertex[axis]);
  }
  const cuts: number[] = [];
  for (let cut = Math.floor(low) + 1; cut < high; cut++) cuts.push(cut);
  return cuts;
}

function polygonArea(poly: Vertex[]): number {
  let ax = 0;
  let ay = 0;
  let az = 0;
  const p0 = poly[0];
  for (let index = 1; index + 1 < poly.length; index++) {
    const p1 = poly[index];
    const p2 = poly[index + 1];
    const e1x = p1[0] - p0[0];
    const e1y = p1[1] - p0[1];
    const e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0];
    const e2y = p2[1] - p0[1];
    const e2z = p2[2] - p0[2];
    ax += e1y * e2z - e1z * e2y;
    ay += e1z * e2x - e1x * e2z;
    az += e1x * e2y - e1y * e2x;
  }
  return 0.5 * Math.hypot(ax, ay, az);
}

function sameVertex(a: Vertex, b: Vertex): boolean {
  for (let k = 0; k < S; k++) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Two triangles of one flat quad (a box face, a plane: the two halves of a
 * rectangle share an edge, every attribute and the face's normal) are clipped
 * as ONE polygon: a quad spanning k repeats then costs about 2k triangles
 * instead of about 3k. Returns the quad in the first triangle's winding, or
 * null when the pair is not a convex coplanar quad with a shared edge.
 */
function mergedQuad(first: Vertex[], second: Vertex[], normal: readonly number[]): Vertex[] | null {
  for (let i = 0; i < 3; i++) {
    const v0 = first[i];
    const v1 = first[(i + 1) % 3];
    for (let j = 0; j < 3; j++) {
      // the shared edge runs the other way round in a consistently wound pair
      if (!sameVertex(second[j], v1) || !sameVertex(second[(j + 1) % 3], v0)) continue;
      const quad = [v1, first[(i + 2) % 3], v0, second[(j + 2) % 3]];
      // convex and planar: every corner turns the same way as the face normal
      for (let k = 0; k < 4; k++) {
        const a = quad[k];
        const b = quad[(k + 1) % 4];
        const c = quad[(k + 2) % 4];
        const e1x = b[0] - a[0];
        const e1y = b[1] - a[1];
        const e1z = b[2] - a[2];
        const e2x = c[0] - b[0];
        const e2y = c[1] - b[1];
        const e2z = c[2] - b[2];
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        const length = Math.hypot(cx, cy, cz);
        if (length < 1e-12) return null;
        if ((cx * normal[0] + cy * normal[1] + cz * normal[2]) / length < 0.999999) return null;
      }
      return quad;
    }
  }
  return null;
}

/** Small deterministic hash of a quantized point, in [0, 1). */
function hashPoint(x: number, y: number, z: number): number {
  let h = 0x811c9dc5;
  for (const value of [x, y, z]) {
    const q = Math.round(value * 64) | 0;
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export interface FaceFrame {
  /** Unit direction along the face (u). */
  right: readonly [number, number, number];
  /** Unit direction up the face (v): world up on walls, up-slope on roofs. */
  up: readonly [number, number, number];
}

/**
 * The projection frame of a face with unit normal `n`. Walls take the
 * dominant horizontal axis (adjacent facets of a post or barrel that share it
 * share one continuous projection) with v = world up; slopes take the face's
 * own up-slope direction, so roof rows run level; floors and tops take world
 * x and z. Every frame reads the face from outside (no mirrored pattern).
 */
export function eastbrookFaceFrame(nx: number, ny: number, nz: number): FaceFrame {
  const absY = Math.abs(ny);
  if (absY < WALL_NY) {
    if (Math.abs(nz) >= Math.abs(nx)) {
      return { right: [nz >= 0 ? 1 : -1, 0, 0], up: [0, 1, 0] };
    }
    return { right: [0, 0, nx >= 0 ? -1 : 1], up: [0, 1, 0] };
  }
  if (absY > FLAT_NY) {
    return { right: [1, 0, 0], up: [0, 0, ny >= 0 ? -1 : 1] };
  }
  // right = normalize(worldUp x n), up = n x right
  const length = Math.hypot(nz, nx);
  const rx = nz / length;
  const rz = -nx / length;
  return {
    right: [rx, 0, rz],
    up: [ny * rz, nz * rx - nx * rz, -ny * rx],
  };
}

/**
 * Tile every triangle of `input` into its atlas cell at world scale. Output is
 * a new non-indexed soup whose triangles each lie inside one repeat, winding
 * preserved, with atlas UVs inside the cell's usable rectangle.
 */
export function tileEastbrookSurface(input: SurfaceTilingInput): SurfaceTilingOutput {
  const { positions, normals, colors } = input;
  const repeat = input.repeatYards ?? EASTBROOK_SURFACE_REPEAT_YARDS;
  const heightSplits = [...(input.heightSplits ?? [])].sort((a, b) => a - b);
  const triangleCount = Math.floor(positions.length / 9);
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outColors: number[] = [];
  const outUvs: number[] = [];

  const corner = (vertexIndex: number): Vertex => {
    const vertex = new Float64Array(STRIDE);
    vertex[0] = positions[vertexIndex * 3];
    vertex[1] = positions[vertexIndex * 3 + 1];
    vertex[2] = positions[vertexIndex * 3 + 2];
    if (normals) {
      vertex[3] = normals[vertexIndex * 3];
      vertex[4] = normals[vertexIndex * 3 + 1];
      vertex[5] = normals[vertexIndex * 3 + 2];
    }
    if (colors) {
      vertex[6] = colors[vertexIndex * 3];
      vertex[7] = colors[vertexIndex * 3 + 1];
      vertex[8] = colors[vertexIndex * 3 + 2];
    }
    return vertex;
  };

  let shade = 1;
  const emit = (vertex: Vertex, u: number, v: number): void => {
    outPositions.push(vertex[0], vertex[1], vertex[2]);
    if (normals) outNormals.push(vertex[3], vertex[4], vertex[5]);
    if (colors) outColors.push(vertex[6] * shade, vertex[7] * shade, vertex[8] * shade);
    outUvs.push(u, v);
  };
  const islandValueSpread = input.islandValueSpread ?? 0;

  /** Unit face normal of a triangle from its winding, turned to agree with the
   *  authored vertex normals; null for a degenerate triangle. */
  const faceNormal = (tri: Vertex[]): [number, number, number] | null => {
    const [a, b, c] = tri;
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    let fx = e1y * e2z - e1z * e2y;
    let fy = e1z * e2x - e1x * e2z;
    let fz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(fx, fy, fz);
    if (length < 1e-12) return null;
    fx /= length;
    fy /= length;
    fz /= length;
    if (normals) {
      const sx = a[3] + b[3] + c[3];
      const sy = a[4] + b[4] + c[4];
      const sz = a[5] + b[5] + c[5];
      if (sx * fx + sy * fy + sz * fz < 0) return [-fx, -fy, -fz];
    }
    return [fx, fy, fz];
  };
  const triangleAt = (index: number): Vertex[] => [
    corner(index * 3),
    corner(index * 3 + 1),
    corner(index * 3 + 2),
  ];

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    let polygon = triangleAt(triangle);
    const cell = input.cellOfTriangle(triangle);
    const rect = eastbrookAtlasCellRect(cell);
    const [repeatU, repeatV] = repeat[cell] ?? [1.6, 1.6];
    const normal = faceNormal(polygon);
    if (!normal) continue; // degenerate: draws nothing either way
    const [fx, fy, fz] = normal;
    const mode = input.modeOfTriangle?.(triangle) ?? 'grid';
    // The second half of the same flat quad joins this one (same cell, same
    // mapping, same plane, a shared edge): clipped once, as one polygon.
    if (
      triangle + 1 < triangleCount &&
      input.cellOfTriangle(triangle + 1) === cell &&
      (input.modeOfTriangle?.(triangle + 1) ?? 'grid') === mode
    ) {
      const next = triangleAt(triangle + 1);
      const nextNormal = faceNormal(next);
      if (nextNormal && nextNormal[0] * fx + nextNormal[1] * fy + nextNormal[2] * fz > 0.999999) {
        const quad = mergedQuad(polygon, next, normal);
        if (quad) {
          polygon = quad;
          triangle++;
        }
      }
    }
    const frame = eastbrookFaceFrame(fx, fy, fz);
    let lowS = Number.POSITIVE_INFINITY;
    let lowT = Number.POSITIVE_INFINITY;
    let highS = Number.NEGATIVE_INFINITY;
    let highT = Number.NEGATIVE_INFINITY;
    let lowY = Number.POSITIVE_INFINITY;
    let highY = Number.NEGATIVE_INFINITY;
    for (const vertex of polygon) {
      lowY = Math.min(lowY, vertex[Y]);
      highY = Math.max(highY, vertex[Y]);
      vertex[S] =
        (vertex[0] * frame.right[0] + vertex[1] * frame.right[1] + vertex[2] * frame.right[2]) /
        repeatU;
      vertex[T] =
        (vertex[0] * frame.up[0] + vertex[1] * frame.up[1] + vertex[2] * frame.up[2]) / repeatV;
      lowS = Math.min(lowS, vertex[S]);
      lowT = Math.min(lowT, vertex[T]);
      highS = Math.max(highS, vertex[S]);
      highT = Math.max(highT, vertex[T]);
    }
    const spanS = highS - lowS;
    const spanT = highT - lowT;
    // Per axis: 'grid' clips along the world repeat lines; 'island' keeps the
    // face's own origin and squeezes a face up to ISLAND_SQUEEZE_LIMIT
    // repeats into one, so an island face longer than that grids along THAT
    // axis only (a tower's narrow face tiles up its height in one column);
    // 'fit' squeezes any span into one repeat.
    const gridS = mode === 'grid' || (mode === 'island' && spanS > ISLAND_SQUEEZE_LIMIT);
    const gridT = mode === 'grid' || (mode === 'island' && spanT > ISLAND_SQUEEZE_LIMIT);
    const cutS = gridS && spanS >= GRID_MIN_SPLIT_SPAN;
    const cutT = gridT && spanT >= GRID_MIN_SPLIT_SPAN;

    // Island and fit axes keep ONE origin for every piece the height splits
    // (and the other axis's grid) make, so no cut shows as a seam.
    let originS = lowS;
    let originT = lowT;
    const scaleS = !gridS && spanS > 1 ? 1 / spanS : 1;
    const scaleT = !gridT && spanT > 1 ? 1 / spanT : 1;
    shade = 1;
    if (mode === 'island') {
      // The two triangles of a rectangle share its bounds, so a hash of the
      // bounds' centre (not of the triangle's own centroid) keeps both on one
      // patch of the cell, and on one shade.
      const boxCentreS = (lowS + highS) / 2;
      const boxCentreT = (lowT + highT) / 2;
      if (!gridS) {
        originS = lowS - (hashPoint(boxCentreS, boxCentreT, 0) * (1 - spanS * scaleS)) / scaleS;
      }
      if (!gridT) {
        originT = lowT - (hashPoint(boxCentreT, boxCentreS, 1) * (1 - spanT * scaleT)) / scaleT;
      }
      if (islandValueSpread > 0) {
        shade = 1 + (hashPoint(boxCentreS, boxCentreT, 2) * 2 - 1) * islandValueSpread;
      }
    }

    let pieces: Vertex[][] = [polygon];
    if (heightSplits.length > 0 && highY - lowY >= HEIGHT_SPLIT_MIN_SPAN) {
      pieces = pieces.flatMap((piece) => splitAlong(piece, Y, heightSplits));
    }
    if (cutS) pieces = pieces.flatMap((piece) => splitAlong(piece, S, integerCuts(piece, S)));
    if (cutT) pieces = pieces.flatMap((piece) => splitAlong(piece, T, integerCuts(piece, T)));

    for (const piece of pieces) {
      if (piece.length < 3 || polygonArea(piece) < MIN_PIECE_AREA) continue;
      let cellS = originS;
      let cellT = originT;
      if (gridS || gridT) {
        let meanS = 0;
        let meanT = 0;
        for (const vertex of piece) {
          meanS += vertex[S];
          meanT += vertex[T];
        }
        if (gridS) cellS = Math.floor(meanS / piece.length);
        if (gridT) cellT = Math.floor(meanT / piece.length);
      }
      const local = piece.map((vertex) => {
        const fu = Math.min(1, Math.max(0, (vertex[S] - cellS) * scaleS));
        const fv = Math.min(1, Math.max(0, (vertex[T] - cellT) * scaleT));
        return [rect.u0 + fu * rect.size, rect.v0 + fv * rect.size] as const;
      });
      for (let index = 1; index + 1 < piece.length; index++) {
        emit(piece[0], local[0][0], local[0][1]);
        emit(piece[index], local[index][0], local[index][1]);
        emit(piece[index + 1], local[index + 1][0], local[index + 1][1]);
      }
    }
  }

  return {
    positions: Float32Array.from(outPositions),
    normals: normals ? Float32Array.from(outNormals) : null,
    colors: colors ? Float32Array.from(outColors) : null,
    uvs: Float32Array.from(outUvs),
    triangleCount: outPositions.length / 9,
  };
}
