// Builds the WOC head library's `monk` hairstyle (a tonsure) for both head types, straight
// into the split file the catalog names (woc_head_catalog.ts wocHeadPieceUrl:
// head_type_<t>_hair_monk.glb). Built in the repo from shipped files, like the mullet and the
// pompadour, whose file reading and writing it shares.
//
// The look is a bowl-cut ring: a thick band of hair round the head at the brow line, the
// crown bare above it and the sides shaved below. No shipped style is near it, so the ring is
// GROWN on each head: for every direction round the skull's axis and every step down the
// band, a ray is cast outward from the axis to find the scalp, and the band's surface is set
// off it by the profile (MONK_SHAPE): a hair's breadth at the top edge, where it lies on the
// crown, swelling to its full thickness near the bottom, then tucked back under to the scalp
// so the band has an underside. The band dips a little at the brow, a fringe.
// Being measured off the head it stands on, it fits both head types with one recipe.
//
// It is painted with the mohawk's texture, laid over one clean patch of that atlas (the
// pompadour's POMP_PATCH), down the band in v and back and forth round the head in u, so it
// tints as the mohawk does and nothing is encoded. It is written by the mullet build's
// writeHairPiece (the undercut file's rig and node, WOC_lod levels, meshopt, the written file
// read back and checked).
//
//   node scripts/assets/woc_character/build_monk_hair.mjs [--type a|b] [--out-dir <dir>]
//     [--shape '<json>']
//
// Every input is a committed file, so a rebuild needs no tool outside the repo. After one:
// node scripts/build_media_manifest.mjs generate, and re-pin the head rows of
// tests/woc_character_size_budget.test.ts and tests/woc_triangle_budget.test.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  headFileIo,
  MULLET_FIT,
  readHeadTriangles,
  readTop,
  writeHairPiece,
} from './build_mullet_hair.mjs';
import { POMP_PATCH } from './build_pompadour_hair.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HEAD_DIR = path.resolve(SCRIPT_DIR, '..', '..', '..', 'public/models/chars/players/woc');
export const MONK_ID = 'monk';

/**
 * The ring, measured from the top of the head it stands on (rig units, y up, face down +z):
 *   around             steps round the head
 *   topDrop            how far below the top of the head the band's upper edge lies
 *   height             the band's height at the brow
 *   browDrop           how much lower the whole band sits at the brow, where it falls as a
 *                      fringe, than at the nape
 *   thick              the band's full thickness off the scalp
 *   lift               how far off the scalp its upper edge and its tucked underside sit
 *   profile            the band's cross-section, top to bottom then back under: for each
 *                      step, how far down the band (0 to 1) and what share of `thick`
 *   repeats            how many times the paint runs back and forth round the head
 */
export const MONK_SHAPE = {
  around: 56,
  topDrop: 0.022,
  height: 0.04,
  browDrop: 0.01,
  thick: 0.012,
  lift: 0.0015,
  profile: [
    [0, 0],
    [0.15, 0.3],
    [0.4, 0.65],
    [0.7, 0.92],
    [0.92, 1],
    [1, 0.85],
    [0.98, 0.3],
    [0.93, 0],
  ],
  repeats: 10,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** How far along a ray (origin, unit direction) it last leaves a triangle mesh, or 0 when it
 *  never meets it (Moller-Trumbore over every triangle: the farthest hit). */
export function farthestHit(origin, dir, triangles) {
  let far = 0;
  for (const [a, b, c] of triangles) {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(dir, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const t = sub(origin, a);
    const u = dot(t, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(t, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const along = dot(e2, q) / det;
    if (along > far) far = along;
  }
  return far;
}

/** The skull's frame: the top of the head and the axis the ring is grown round (the middle
 *  of everything within 6 cm of the top). */
export function skullFrame(triangles) {
  let top = -Infinity;
  for (const tri of triangles) for (const p of tri) top = Math.max(top, p[1]);
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const tri of triangles) {
    for (const p of tri) {
      if (p[1] < top - 0.06) continue;
      lo[0] = Math.min(lo[0], p[0]);
      hi[0] = Math.max(hi[0], p[0]);
      lo[1] = Math.min(lo[1], p[2]);
      hi[1] = Math.max(hi[1], p[2]);
    }
  }
  return { top, cx: (lo[0] + hi[0]) / 2, cz: (lo[1] + hi[1]) / 2 };
}

/** The paint's u for a step round the head: back and forth across the patch, so the ring
 *  closes with no seam. */
export function ringU(step, shape) {
  const phase = ((step / shape.around) * shape.repeats) % 2;
  const wave = phase < 1 ? phase : 2 - phase;
  return POMP_PATCH.u0 + (POMP_PATCH.u1 - POMP_PATCH.u0) * wave;
}

/**
 * The ring grown on a head, as a triangle soup of { p, n, t } in the rig's rest pose. `scalp`
 * gives, for a point on the axis and a unit direction, how far out the scalp is.
 */
export function growRing(frame, scalp, shape) {
  const rows = shape.profile.length;
  const grid = [];
  for (let i = 0; i <= shape.around; i++) {
    const angle = (i / shape.around) * Math.PI * 2;
    const dir = [Math.sin(angle), 0, Math.cos(angle)];
    // lower at the brow, a fringe (the face is direction +z, angle 0)
    const sag = shape.browDrop * (0.5 + 0.5 * Math.cos(angle));
    const column = [];
    for (let j = 0; j < rows; j++) {
      const [down, share] = shape.profile[j];
      const y = frame.top - shape.topDrop - sag - shape.height * down;
      const origin = [frame.cx, y, frame.cz];
      const r = scalp(origin, dir) + shape.lift + shape.thick * share;
      column.push({
        p: [origin[0] + dir[0] * r, y, origin[2] + dir[2] * r],
        t: [ringU(i, shape), POMP_PATCH.v0 + ((POMP_PATCH.v1 - POMP_PATCH.v0) * j) / (rows - 1)],
      });
    }
    grid.push(column);
  }
  // normals off the grid itself: the cross of the step round and the step down, turned out
  for (let i = 0; i <= shape.around; i++) {
    for (let j = 0; j < rows; j++) {
      const round = sub(grid[Math.min(shape.around, i + 1)][j].p, grid[Math.max(0, i - 1)][j].p);
      const down = sub(grid[i][Math.min(rows - 1, j + 1)].p, grid[i][Math.max(0, j - 1)].p);
      const n = cross(down, round);
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      grid[i][j].n = [n[0] / len, n[1] / len, n[2] / len];
    }
  }
  // the seam column shares its neighbours' normals with the first, so the ring shades closed
  for (let j = 0; j < rows; j++) {
    const a = grid[0][j].n;
    const b = grid[shape.around][j].n;
    const n = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    grid[0][j].n = grid[shape.around][j].n = [n[0] / len, n[1] / len, n[2] / len];
  }
  const soup = [];
  for (let i = 0; i < shape.around; i++) {
    for (let j = 0; j + 1 < rows; j++) {
      const [a, b, c, d] = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      soup.push(a, d, b, b, d, c);
    }
  }
  return soup;
}

function parseArgs(argv) {
  const opts = { types: ['a', 'b'], outDir: HEAD_DIR, shape: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') opts.types = [argv[++i]];
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else if (a === '--shape') opts.shape = JSON.parse(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of opts.types) if (!MULLET_FIT[t]) throw new Error(`unknown head type ${t}`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const shape = { ...MONK_SHAPE, ...opts.shape };
  const io = await headFileIo();
  const top = await readTop(io);
  const built = [];
  for (const type of opts.types) {
    const triangles = await readHeadTriangles(io, type);
    const frame = skullFrame(triangles);
    const soup = growRing(frame, (origin, dir) => farthestHit(origin, dir, triangles), shape);
    const written = await writeHairPiece(io, type, MONK_ID, soup, top, opts.outDir);
    built.push({ ...written, triangles: soup.length / 3, frame });
  }
  console.log(JSON.stringify({ built }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
