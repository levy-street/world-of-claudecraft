// The Ravenrift field's GROUND PAINT: which of the map's eighteen photographed
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
  CURTAIN_Z,
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
 * The swatch table, carried over from Thornhollow unchanged: same ids, same
 * texture files, same tiling periods and albedo lifts, so the field is dressed
 * in exactly the ground the art direction was built around.
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
    id: 202,
    color: 3813156,
    label: 'Trodden Path',
    textureSha: 'builtin:Ground100',
    tileSize: 7,
    light: 0.12,
  },
  {
    id: 203,
    color: 5917244,
    label: 'Keep Stone',
    textureSha: 'builtin:Rock054',
    tileSize: 6,
    light: -0.05,
  },
  { id: 204, color: 3948343, label: 'Fightpit Rock', textureSha: 'builtin:Cliff002', tileSize: 8 },
  {
    id: 205,
    color: 2564120,
    label: 'Forest Loam',
    textureSha: 'builtin:Ground101',
    tileSize: 8,
    light: 0.1,
  },
  {
    id: 206,
    color: 3618364,
    label: 'Old Cobblestone',
    textureSha: 'builtin:Cobblestone002',
    tileSize: 14,
  },
  { id: 207, color: 4740397, label: 'Living Roots', textureSha: 'builtin:Roots002', tileSize: 15 },
  { id: 208, color: 4143656, label: 'Mossy Bark', textureSha: 'builtin:Wood004', tileSize: 29 },
  {
    id: 209,
    color: 2829351,
    label: 'Shadowed Earth',
    textureSha: 'builtin:Ground118',
    tileSize: 14,
  },
  {
    id: 210,
    color: 4865588,
    label: 'Sunbaked Cliff',
    textureSha: 'builtin:Cliff006',
    tileSize: 14,
  },
  { id: 211, color: 3880492, label: 'Stony Dirt', textureSha: 'builtin:Ground116', tileSize: 14 },
  { id: 212, color: 4140834, label: 'Dusty Earth', textureSha: 'builtin:Ground107', tileSize: 14 },
  { id: 213, color: 6380598, label: 'Tangled Roots', textureSha: 'builtin:Roots001', tileSize: 14 },
  {
    id: 214,
    color: 5063216,
    label: 'Pebbled Ground',
    textureSha: 'builtin:Ground115',
    tileSize: 14,
  },
  { id: 215, color: 6122821, label: 'Meadow Stones', textureSha: 'builtin:Rock056', tileSize: 14 },
  { id: 216, color: 6520097, label: 'Spring Sward', textureSha: 'builtin:Grass003', tileSize: 14 },
  {
    id: 217,
    color: 4145222,
    label: 'Cobbled Road',
    textureSha: 'builtin:Cobblestone001',
    tileSize: 14,
  },
];

/** Named handles so the region list below reads as ground, not as numbers. */
const MEADOW = 200;
const RIDGE_GRASS = 201;
const TRODDEN = 202;
const KEEP_STONE = 203;
const RUIN_ROCK = 204;
const LOAM = 205;
const FLAGSTONE = 206;
const LIVING_ROOTS = 207;
const MOSSY_TIMBER = 208;
const SHADOWED = 209;
const SUNBAKED = 210;
const STONY_DIRT = 211;
const DUSTY = 212;
const TANGLED_ROOTS = 213;
const PEBBLED = 214;
const MEADOW_STONES = 215;
const SWARD = 216;
const COBBLED = 217;

/** The Crimson flag stand: the one objective mark authored in canonical space
 *  (its Azure twin arrives with the mirror pass). */
const FLAG_STANDS_CANONICAL = [{ x: 0, z: -FLAG_Z }];

/** Ground that grows: where a grass tuft belongs. */
export const GRASS_GROUND = new Set([MEADOW, SWARD, RIDGE_GRASS]);
/** Ground that holds undergrowth: grass plus the soft, shaded floors. */
export const SOFT_GROUND = new Set([
  MEADOW,
  SWARD,
  RIDGE_GRASS,
  LOAM,
  LIVING_ROOTS,
  TANGLED_ROOTS,
  PEBBLED,
]);

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

  // --- the hollow floor -----------------------------------------------------
  g.rect(MEADOW, 0, 0, HALF_X + 6, HALF_Z + 6, 0);

  // Field chambers: meadow broken by lusher sward, thin ridge grass toward the
  // ramparts, and loam creeping out of the wall feet.
  g.blotches(SWARD, [-HALF_X, -104, HALF_X, -CURTAIN_Z], 26, 5, 11, 11);
  g.blotches(RIDGE_GRASS, [-HALF_X, -HALF_Z, -30, -CURTAIN_Z], 16, 5, 12, 23);
  g.blotches(RIDGE_GRASS, [30, -HALF_Z, HALF_X, -CURTAIN_Z], 16, 5, 12, 31);
  g.blotches(PEBBLED, [-HALF_X, -100, HALF_X, -CURTAIN_Z], 14, 3, 7, 47);
  g.blotches(LOAM, [-HALF_X, -HALF_Z, -34, -20], 14, 4, 10, 53);
  g.blotches(LOAM, [34, -HALF_Z, HALF_X, -20], 14, 4, 10, 59);

  // Rampart feet: root mats creeping in from the walls, all the way round.
  g.rect(LIVING_ROOTS, -HALF_X, 0, 4.5, HALF_Z, 1.6);
  g.rect(LIVING_ROOTS, HALF_X, 0, 4.5, HALF_Z, 1.6);
  g.rect(LIVING_ROOTS, 0, -HALF_Z, HALF_X, 4.5, 1.6);
  g.blotches(TANGLED_ROOTS, [-HALF_X, -HALF_Z, -40, 0], 18, 3, 8, 67);
  g.blotches(TANGLED_ROOTS, [40, -HALF_Z, HALF_X, 0], 18, 3, 8, 71);

  // --- the Ruin Courtyard ---------------------------------------------------
  // A sunk bowl of broken ground: stony dirt to the curtains, shadowed earth in
  // the dish, bare rock over the heart, with dust and meadow stones between.
  g.rect(STONY_DIRT, 0, 0, HALF_X + 4, CURTAIN_Z + 3, 1.9);
  g.disc(SHADOWED, 0, 0, 44, 2.1);
  g.disc(RUIN_ROCK, 0, 0, 25, 2.1);
  g.blotches(DUSTY, [-44, -CURTAIN_Z, 44, 0], 20, 4, 9, 83);
  g.blotches(MEADOW_STONES, [-HALF_X, -CURTAIN_Z, HALF_X, 0], 18, 3, 8, 89);
  g.blotches(SUNBAKED, [-30, -34, 30, 0], 12, 3, 7, 97);
  // The heart ruin's own apron: broken paving spilling out of the shell.
  g.rect(COBBLED, 0, 0, 14, 14, 2.2);
  g.rect(RUIN_ROCK, 0, 0, 8.6, 8.6, 0.5);
  // Ruined timber decking at each gatehouse's courtyard mouth.
  for (const room of GATEHOUSE_ROOMS) {
    if (room.z > 0) continue;
    g.blotches(
      MOSSY_TIMBER,
      [room.x - 10, room.z - 16, room.x + 10, room.z + 16],
      7,
      2.5,
      5.5,
      101 + room.x,
    );
  }

  // Rubble formations sit in their own apron of stone, so a low mound reads as
  // ground rather than as props dropped on grass.
  for (const pile of RUBBLE_PILES) {
    if (pile.z > 0.5) continue;
    g.disc(MEADOW_STONES, pile.x, pile.z, (pile.kind === 'large' ? 4.6 : 2) + 2.6, 0.8);
  }
  for (const p of COVER_PILLARS) {
    if (p.z > 0.5) continue;
    g.disc(KEEP_STONE, p.x, p.z, 3.4, 0.5);
  }

  // --- the keep terraces ----------------------------------------------------
  // Packed earth over the whole terrace, garrison flagstone in the keep court
  // and out through the mouth.
  g.rect(STONY_DIRT, 0, -HALF_Z, HALF_X + 4, HALF_Z - 106, 1.7);
  g.blotches(DUSTY, [-HALF_X, -HALF_Z, HALF_X, -108], 12, 4, 9, 107);
  g.rect(FLAGSTONE, 0, -(FLAG_Z + 1), KEEP_HALF_X + 1.5, 13, 1.1);
  g.rect(FLAGSTONE, 0, keepFront + 2, KEEP_HALF_X - 3, 6, 1.2);
  // The pocket behind the keep, where the great hall stands.
  g.rect(FLAGSTONE, 0, -HALF_Z + 6, 15, 7, 1.1);

  // Graveyard plots: turned dirt inside the rails, roots at the edges.
  for (const plot of GRAVEYARDS) {
    if (plot.z > 0) continue;
    g.rect(SHADOWED, plot.x, plot.z, plot.hw + 1, plot.hd + 1, 0.9);
    g.blotches(
      TANGLED_ROOTS,
      [plot.x - plot.hw, plot.z - plot.hd, plot.x + plot.hw, plot.z + plot.hd],
      6,
      1.6,
      3.2,
      113,
    );
  }

  // --- built surfaces -------------------------------------------------------
  // Gatehouse floors: laid road cobble, so a crossing reads as a built room.
  for (const room of GATEHOUSE_ROOMS) {
    if (room.z > 0) continue;
    g.rect(COBBLED, room.x, room.z, room.hw + 0.5, room.hd + 0.5, 0.7);
  }
  // The main gate's threshold, carried a few yards each side of the curtain.
  for (const gate of MAIN_GATES) {
    if (gate.z > 0) continue;
    g.rect(COBBLED, gate.x, gate.z, gate.half + 4, 7, 0.8);
  }

  // Every wall stands on its own stone footing, so no run floats on grass.
  for (const w of planWalls()) {
    if (w.z - w.hd > 0.5) continue;
    g.rect(KEEP_STONE, w.x, w.z, w.hw + 1.1, w.hd + 1.1, 0.35);
  }

  // --- the routes people actually run --------------------------------------
  for (const pts of ROUTE_LINES) g.line(TRODDEN, pts, 2.6);
  // The keep mouth and the gate thresholds are the busiest ground on the field.
  g.line(
    TRODDEN,
    [
      { x: 0, z: -128 },
      { x: 0, z: -104 },
    ],
    3.4,
  );

  // --- objective marks: nothing is allowed to cover these -------------------
  for (const stand of FLAG_STANDS_CANONICAL) {
    g.disc(KEEP_STONE, stand.x, stand.z, 6.2, 0.5);
    g.disc(COBBLED, stand.x, stand.z, 3.4, 0.3);
  }
  for (const pad of SPEED_RUNES) {
    if (pad.z > 0.5) continue;
    g.disc(KEEP_STONE, pad.x, pad.z, 3.6, 0.35);
  }
  for (const pad of POWER_RUNES) {
    if (pad.z > 0.5) continue;
    g.disc(KEEP_STONE, pad.x, pad.z, 3.6, 0.35);
    g.disc(SUNBAKED, pad.x, pad.z, 1.9, 0.2);
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
