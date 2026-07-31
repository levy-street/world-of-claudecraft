// The Thornhollow Fields GROUND PAINT: which of the map's eighteen photographed
// ground textures every quarter-yard of the hollow is dressed in.
//
// The swatch table is Thornhollow's, unchanged, because the ground is half of
// what made that field read as a place: meadow through the field chambers,
// trodden earth worn into the routes people actually run, garrison flagstone on
// the keep terraces, broken rock in the sunken Ruin Courtyard, root mats
// creeping out from the ramparts.
//
// Painted as a PAINTER'S ALGORITHM over the canonical (Crimson, -z) half and
// then MIRRORED cell for cell through the field centre, so the two halves are
// the same ground to the pixel and no amount of later editing can favour one
// team. Region edges are pushed around by a smooth analytic warp, so a border
// meanders like worn ground instead of showing the authoring rectangle; the
// warp is a sum of sines, never per-cell noise, which keeps the compiled
// run-length encoding compact.
//
// Pure and deterministic: no rng, no clock, no filesystem.

import {
  COVER_PILLARS,
  FLAG_Z,
  GATEHOUSE_ROOMS,
  GRAVEYARDS,
  HALF_X,
  HALF_Z,
  KEEP_HALF_X,
  KEEP_MOUTH_DZ,
  MAIN_GATES,
  POWER_RUNES,
  planWalls,
  ROUTE_LINES,
  RUBBLE_PILES,
  SPEED_RUNES,
} from './field_plan.mjs';

/** Authoring resolution of the painted index grid, yards. */
export const PAINT_CELL = 0.25;
/** The unpainted sentinel: the terrain's own base tone shows through. */
export const BARE = 255;

/**
 * The swatch table: NINE materials, three of each family, grass, cobble,
 * dirt. It was eighteen, and the field paid for it twice. Once in coherence (a
 * ground made of eighteen photographs reads as noise however carefully each
 * region is drawn) and once at load, since every entry is a layer of the
 * terrain texture array whether or not a single cell is painted with it.
 *
 * Ids are the original ones and are NOT renumbered: the shader indexes layers
 * by array POSITION (bgPaintLookup remaps id -> index), so the ids are free to
 * be sparse and keeping them stable keeps this table diffable against the
 * Thornhollow original.
 */
export const SWATCHES = [
  { id: 200, color: 5204764, label: 'Hollow Meadow', textureSha: 'builtin:Grass002', tileSize: 26 },
  {
    id: 201,
    color: 4548132,
    label: 'Ridge Grass',
    textureSha: 'builtin:Grass004',
    tileSize: 11,
    light: -0.08,
  },
  {
    id: 206,
    color: 3618364,
    label: 'Old Cobblestone',
    textureSha: 'builtin:Cobblestone002',
    tileSize: 14,
  },
  { id: 211, color: 3880492, label: 'Stony Dirt', textureSha: 'builtin:Ground116', tileSize: 14 },
  { id: 212, color: 4140834, label: 'Dusty Earth', textureSha: 'builtin:Ground107', tileSize: 14 },
  { id: 216, color: 6520097, label: 'Spring Sward', textureSha: 'builtin:Grass003', tileSize: 14 },
  {
    id: 217,
    color: 4145222,
    label: 'Cobbled Road',
    textureSha: 'builtin:Cobblestone001',
    tileSize: 14,
  },
];

/**
 * Named handles so the region program below reads as ground, not as numbers.
 * Grouped by family, because the family is the art direction: grass is the
 * default, cobble means someone BUILT here, dirt means the ground is broken or
 * worn. A region that is none of those three has no business being painted.
 */
const MEADOW = 200; // grass: the hollow floor
const SWARD = 216; // grass: lusher, open chambers
const RIDGE_GRASS = 201; // grass: thinner, along the ramparts
const FLAGSTONE = 206; // cobble: laid grey stone, floors and footings
const COBBLED = 217; // cobble: rounded grey stone, rune pads, thresholds
const WORN_EARTH = 212; // dirt: worn routes and scuff
const SCREE = 211; // dirt: pebbled broken ground around rubble

// Two textures were CUT here rather than merely left unpainted, because both
// were actively wrong against a green field:
//   Ground100 'Trodden Path', very nearly black. As a route through grass it
//     read as a burn scar, not a path.
//   Rock054 'Keep Stone', warm pink cobble flecked with purple crystal. It
//     belongs in a cave, and as a wall footing it ringed the whole field in
//     pink. Footings are Cobblestone002 now, which is the grey the walls
//     themselves are built from.

/** The Crimson flag stand: the one objective mark authored in canonical space
 *  (its Azure twin arrives with the mirror pass). */
const FLAG_STANDS_CANONICAL = [{ x: 0, z: -FLAG_Z }];

/** Ground that grows: where a grass tuft belongs. */
export const GRASS_GROUND = new Set([MEADOW, SWARD, RIDGE_GRASS]);
/**
 * Ground that holds undergrowth. Now the same set as GRASS_GROUND: the soft
 * shaded floors it used to also cover (loam, root mats) are no longer painted,
 * and a fern has no business on cobble, dirt or a worn route.
 */
export const SOFT_GROUND = new Set([MEADOW, SWARD, RIDGE_GRASS]);

/**
 * Nearest-cell swatch lookup over a built paint grid. The dressing pass uses it
 * so a tuft of grass only ever grows out of painted grass and a fern only ever
 * sits on soft ground: the scatter follows the ground it was painted on rather
 * than dropping plants onto flagstone and road.
 */
export function makePaintSampler(paint) {
  return (x, z) => {
    const c = Math.round((x - paint.originX) / paint.cell);
    const r = Math.round((z - paint.originZ) / paint.cell);
    if (c < 0 || r < 0 || c >= paint.cols || r >= paint.rows) return BARE;
    return paint.ids[r * paint.cols + c];
  };
}

/** Smooth analytic edge warp, yards. A sum of sines: no per-cell noise, so a
 *  painted border wanders without shredding the run-length encoding. */
function warp(x, z) {
  return (
    1.55 * Math.sin(x * 0.213 + z * 0.129) +
    1.05 * Math.sin(x * 0.091 - z * 0.307 + 1.7) +
    0.65 * Math.sin(x * 0.541 + z * 0.417 + 3.1)
  );
}

/** Deterministic 0..1 hash for the blotch lattices. Static layout, not rng. */
function hash01(a, b) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

class PaintGrid {
  constructor() {
    this.cell = PAINT_CELL;
    this.cols = Math.round((HALF_X * 2) / PAINT_CELL) + 1;
    this.rows = Math.round((HALF_Z * 2) / PAINT_CELL) + 1;
    this.originX = -HALF_X;
    this.originZ = -HALF_Z;
    this.ids = new Uint8Array(this.cols * this.rows).fill(BARE);
    /** Last row of the canonical half: z <= 0. */
    this.midRow = Math.round(HALF_Z / PAINT_CELL);
  }

  xAt(col) {
    return this.originX + col * this.cell;
  }

  zAt(row) {
    return this.originZ + row * this.cell;
  }

  colRange(minX, maxX) {
    return [
      Math.max(0, Math.floor((minX - this.originX) / this.cell)),
      Math.min(this.cols - 1, Math.ceil((maxX - this.originX) / this.cell)),
    ];
  }

  rowRange(minZ, maxZ) {
    return [
      Math.max(0, Math.floor((minZ - this.originZ) / this.cell)),
      Math.min(this.midRow, Math.ceil((maxZ - this.originZ) / this.cell)),
    ];
  }

  /** Paint every canonical-half cell whose warped signed distance is inside. */
  stroke(id, bounds, signedDistance, amp = 1) {
    const [c0, c1] = this.colRange(bounds[0], bounds[2]);
    const [r0, r1] = this.rowRange(bounds[1], bounds[3]);
    for (let r = r0; r <= r1; r++) {
      const z = this.zAt(r);
      const base = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const x = this.xAt(c);
        if (signedDistance(x, z) + (amp === 0 ? 0 : warp(x, z) * amp) > 0) continue;
        this.ids[base + c] = id;
      }
    }
  }

  rect(id, cx, cz, hw, hd, amp = 0.55) {
    const pad = 4;
    this.stroke(
      id,
      [cx - hw - pad, cz - hd - pad, cx + hw + pad, cz + hd + pad],
      (x, z) => Math.max(Math.abs(x - cx) - hw, Math.abs(z - cz) - hd),
      amp,
    );
  }

  disc(id, cx, cz, r, amp = 0.55) {
    const pad = 4;
    this.stroke(
      id,
      [cx - r - pad, cz - r - pad, cx + r + pad, cz + r + pad],
      (x, z) => Math.hypot(x - cx, z - cz) - r,
      amp,
    );
  }

  /** A rounded band along a polyline: how a route wears into the ground. */
  line(id, pts, width, amp = 0.7) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = width + 5;
    this.stroke(
      id,
      [minX - pad, minZ - pad, maxX + pad, maxZ + pad],
      (x, z) => {
        let best = Infinity;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const len2 = dx * dx + dz * dz || 1;
          let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
        }
        return best - width;
      },
      amp,
    );
  }

  /**
   * A scattered field of soft blotches over a rect: how one ground type breaks
   * into another without a hard line. Large radii on a hashed lattice, so the
   * result stays legible at play distance and compresses well.
   */
  blotches(id, area, count, rMin, rMax, salt) {
    for (let i = 0; i < count; i++) {
      const hx = hash01(i * 1.7 + salt, salt * 3.1 + 2);
      const hz = hash01(salt * 5.9 + 3, i * 2.3 + salt);
      const hr = hash01(i * 4.1 + salt, i * 0.7 + salt * 1.3);
      const x = area[0] + hx * (area[2] - area[0]);
      const z = area[1] + hz * (area[3] - area[1]);
      if (z > 0.5) continue; // canonical half only; the mirror completes it
      this.disc(id, x, z, rMin + hr * (rMax - rMin), 0.5);
    }
  }

  /** Mirror the canonical half through the field centre, cell for cell. */
  mirror() {
    const { cols, rows, ids } = this;
    for (let r = 0; r <= this.midRow; r++) {
      const src = r * cols;
      const dst = (rows - 1 - r) * cols;
      for (let c = 0; c < cols; c++) ids[dst + (cols - 1 - c)] = ids[src + c];
    }
  }
}

/**
 * Build the painted index grid for the whole field.
 *
 * Order IS the art direction: broad ground first, then the built surfaces
 * standing on it, then the routes worn over the top, then the objective marks
 * that must never be lost under anything.
 */
export function buildPaint() {
  const g = new PaintGrid();
  const keepFront = -(FLAG_Z - KEEP_MOUTH_DZ); // -108, the keep mouth line

  // --- 1. the hollow floor is GRASS -----------------------------------------
  // The whole field, wall to wall. Everything below is an exception carved out
  // of it, which is the point: this is a green hollow with things built in it,
  // not a quarry with grass at the edges.
  g.rect(MEADOW, 0, 0, HALF_X + 6, HALF_Z + 6, 0);
  // Lusher sward through the open chambers, where nothing is built and nothing
  // is walked hard enough to wear it.
  g.blotches(SWARD, [-HALF_X, -HALF_Z + 8, HALF_X, 0], 34, 6, 13, 11);
  // Thinner ridge grass down the ramparts, where the hollow's own walls shade
  // the ground: the field reads as a bowl instead of as a flat green sheet.
  g.blotches(RIDGE_GRASS, [-HALF_X, -HALF_Z, -30, 0], 14, 4, 10, 23);
  g.blotches(RIDGE_GRASS, [30, -HALF_Z, HALF_X, 0], 14, 4, 10, 31);
  g.rect(RIDGE_GRASS, -HALF_X, 0, 3.2, HALF_Z, 1.8);
  g.rect(RIDGE_GRASS, HALF_X, 0, 3.2, HALF_Z, 1.8);
  g.rect(RIDGE_GRASS, 0, -HALF_Z, HALF_X, 3.2, 1.8);

  // --- 2. DIRT, only where the ground is genuinely broken -------------------
  // Rubble formations sit in their own apron of pebbled scree, so a low mound
  // reads as ground that has collapsed rather than as props dropped on a lawn.
  // Kept TIGHT to the pile: a generous apron on every mound turns the field
  // into brown blobs on green, which is the single easiest way to make an
  // otherwise good ground plan look amateur.
  for (const pile of RUBBLE_PILES) {
    if (pile.z > 0.5) continue;
    g.disc(SCREE, pile.x, pile.z, (pile.kind === 'large' ? 4.6 : 2) + 1.3, 0.7);
  }
  // A little scuff where the courtyard has been fought over, and nothing else:
  // the rest of the dirt on this field is the routes below, which is dirt that
  // MEANS something.
  g.blotches(WORN_EARTH, [-26, -26, 26, 0], 7, 2.5, 5.5, 83);
  // Graveyard plots: turned earth inside the rails.
  for (const plot of GRAVEYARDS) {
    if (plot.z > 0) continue;
    g.rect(WORN_EARTH, plot.x, plot.z, plot.hw + 1, plot.hd + 1, 0.9);
  }

  // --- 3. BUILT ground is COBBLE --------------------------------------------
  // Footings first: every wall run stands on its own stone, so no masonry
  // floats on grass.
  for (const w of planWalls()) {
    if (w.z - w.hd > 0.5) continue;
    g.rect(FLAGSTONE, w.x, w.z, w.hw + 0.7, w.hd + 0.7, 0.35);
  }
  for (const p of COVER_PILLARS) {
    if (p.z > 0.5) continue;
    g.disc(FLAGSTONE, p.x, p.z, 2.7, 0.5);
  }
  // The heart ruin: a laid flagstone floor inside its shell, spilling out as
  // broken road cobble.
  g.rect(COBBLED, 0, 0, 15, 15, 2.2);
  g.rect(FLAGSTONE, 0, 0, 8.8, 8.8, 0.6);
  // Gatehouse floors: laid cobble, so a crossing reads as a built room.
  for (const room of GATEHOUSE_ROOMS) {
    if (room.z > 0) continue;
    g.rect(COBBLED, room.x, room.z, room.hw + 0.5, room.hd + 0.5, 0.7);
  }
  // The main gate's threshold, carried a few yards each side of the curtain.
  for (const gate of MAIN_GATES) {
    if (gate.z > 0) continue;
    g.rect(COBBLED, gate.x, gate.z, gate.half + 4, 7, 0.8);
  }
  // The keep: garrison flagstone through the court, out through the mouth, and
  // in the pocket behind where the great hall stands. The terrace AROUND it
  // stays grass, the keep is a building, not a compound.
  g.rect(FLAGSTONE, 0, -(FLAG_Z + 1), KEEP_HALF_X + 2.5, 14, 1.1);
  g.rect(FLAGSTONE, 0, keepFront + 2, KEEP_HALF_X - 3, 6, 1.2);
  g.rect(FLAGSTONE, 0, -HALF_Z + 6, 15, 7, 1.1);

  // --- 4. the routes people actually run ------------------------------------
  // Worn over the top of everything: a path crosses a gatehouse floor because
  // that is where the feet go.
  for (const pts of ROUTE_LINES) g.line(WORN_EARTH, pts, 2.6);
  // The keep mouth is the busiest ground on the field.
  g.line(
    WORN_EARTH,
    [
      { x: 0, z: -128 },
      { x: 0, z: -104 },
    ],
    3.4,
  );

  // --- 5. objective marks: nothing is allowed to cover these ----------------
  for (const stand of FLAG_STANDS_CANONICAL) {
    g.disc(FLAGSTONE, stand.x, stand.z, 6.2, 0.5);
  }
  // Every rune pad sits on its own round of natural cobble. Painted LAST and
  // for all six alike, so the ground under a pad is the same wherever it is on
  // the field and no route or apron can eat into it.
  for (const pad of [...SPEED_RUNES, ...POWER_RUNES]) {
    if (pad.z > 0.5) continue;
    g.disc(COBBLED, pad.x, pad.z, 3.6, 0.4);
  }

  g.mirror();
  return {
    cell: g.cell,
    cols: g.cols,
    rows: g.rows,
    originX: g.originX,
    originZ: g.originZ,
    ids: Array.from(g.ids),
    custom: SWATCHES,
  };
}
