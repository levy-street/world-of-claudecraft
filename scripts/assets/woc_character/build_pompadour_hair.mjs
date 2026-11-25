// Builds the WOC head library's `pompadour` hairstyle for both head types, straight into the
// split file the catalog names (woc_head_catalog.ts wocHeadPieceUrl:
// head_type_<t>_hair_pompadour.glb). Like the mullet (build_mullet_hair.mjs, whose file
// reading and writing this shares), it is built in the repo from shipped files, not from the
// Face Studio head files.
//
// The look is the rockabilly pompadour: sides and back slicked tight to the head, the top
// combed up and back, and a tall rounded front that stands over the forehead. It is sculpted
// from the shipped mohawk (head_type_a_hair_mohawk.glb), which already has the hairline, the
// tight sides and the nape:
//
//   1. the mohawk's strands are welded into one surface and combed (combSurface): every
//      vertex relaxes toward the mean of its neighbours, the hairline held where it is, until
//      the spikes are gone and what is left is a sleek cap;
//   2. the front is raised (raisePomp): over the front of the top, a rounded mass lifts up and
//      forward, highest just behind the hairline and falling away to the crown and the
//      temples, with the hairline itself held so the front wall stands up from the forehead;
//   3. the surface is carried onto the head type (the mullet's placeTop offsets), and any
//      vertex the combing drew into the scalp is pushed back out along the head's own
//      gradient (clearHead), so no skin shows through a cap that sits this close;
//   4. it is painted with the mohawk's texture: the uvs are laid over one clean patch of that
//      atlas (POMP_PATCH), across the head in u and along the comb's direction in v, so the
//      style tints as the mohawk does and nothing is encoded;
//   5. it is written by the mullet build's writeHairPiece (the undercut file's rig and node,
//      WOC_lod levels, meshopt, the written file read back and checked).
//
//   node scripts/assets/woc_character/build_pompadour_hair.mjs [--type a|b] [--out-dir <dir>]
//     [--shape '<json>']
//
// Every input is a committed file, so a rebuild needs no tool outside the repo. After one:
// node scripts/build_media_manifest.mjs generate, and re-pin the head rows of
// tests/woc_character_size_budget.test.ts and tests/woc_triangle_budget.test.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  distanceProbe,
  headFileIo,
  MULLET_FIT,
  placeTop,
  readHeadTriangles,
  readTop,
  writeHairPiece,
} from './build_mullet_hair.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HEAD_DIR = path.resolve(SCRIPT_DIR, '..', '..', '..', 'public/models/chars/players/woc');
export const POMPADOUR_ID = 'pompadour';

/**
 * The patch of the mohawk's atlas (uv, v down the image) the style is painted with: a
 * rectangle of it painted edge to edge at the brightness of the mohawk's own top, held a few
 * texels inside, so no tap or mip level reaches the background.
 */
export const POMP_PATCH = { u0: 0.428, u1: 0.51, v0: 0.479, v1: 0.607 };

/**
 * The shape, in the Type A head's rest pose (rig units, y up, the face down +z):
 *   combPasses          relaxation passes that take the mohawk's spikes down to a cap
 *   frontZ, crownZ      where the raised front is at full strength, and where it has gone
 *   topY0, topY1        heights between which a vertex comes to count as "on top"
 *   halfWidth           the raised front's half width: a round dome across the head, full
 *                       on the centre line and gone at this distance from it
 *   rise, reach         how far the front lifts, and how far it comes forward
 *   swell               how much wider the raised front stands than the head under it
 *   crownLift           a little height over the whole top, so it reads combed up, not flat
 *   roundPasses         relaxation passes after the raise, which round the front wall
 *   clearance           the least distance the surface keeps from the scalp
 *   spanX, spanZ        the extents the patch is laid over (across, and front to back)
 */
export const POMP_SHAPE = {
  combPasses: 40,
  frontZ: 0.075,
  crownZ: -0.03,
  topY0: 1.105,
  topY1: 1.15,
  halfWidth: 0.085,
  rise: 0.026,
  reach: 0.048,
  swell: 0.35,
  crownLift: 0.006,
  roundPasses: 14,
  clearance: 0.003,
  spanX: 0.075,
  spanZ: [-0.06, 0.15],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A triangle soup's corners joined where they coincide: { positions, triangles, edge }, with
 * `edge[i]` true for a vertex on the surface's open edge (the hairline).
 */
export function weldSurface(corners) {
  const ids = new Map();
  const positions = [];
  const index = corners.map((c) => {
    const key = c.p.map((x) => Math.round(x * 1e5)).join(',');
    if (!ids.has(key)) {
      ids.set(key, positions.length);
      positions.push([...c.p]);
    }
    return ids.get(key);
  });
  const triangles = [];
  const uses = new Map();
  for (let k = 0; k < index.length; k += 3) {
    const tri = [index[k], index[k + 1], index[k + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    triangles.push(tri);
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const edge = positions.map(() => false);
  for (const [key, count] of uses) {
    if (count !== 1) continue;
    for (const i of key.split(':')) edge[Number(i)] = true;
  }
  return { positions, triangles, edge };
}

/** Each vertex's neighbours across the surface's triangles. */
function neighbours(surface) {
  const out = surface.positions.map(() => new Set());
  for (const tri of surface.triangles) {
    for (let e = 0; e < 3; e++) {
      out[tri[e]].add(tri[(e + 1) % 3]);
      out[tri[e]].add(tri[(e + 2) % 3]);
    }
  }
  return out;
}

/** Relaxes every vertex off the open edge halfway toward the mean of its neighbours,
 *  `passes` times, in place. The edge is held, so the hairline does not move. */
export function combSurface(surface, passes) {
  const around = neighbours(surface);
  const { positions, edge } = surface;
  for (let pass = 0; pass < passes; pass++) {
    const next = positions.map((p, i) => {
      if (edge[i] || !around[i].size) return p;
      const mean = [0, 0, 0];
      for (const j of around[i]) for (let a = 0; a < 3; a++) mean[a] += positions[j][a];
      return p.map((x, a) => x + (mean[a] / around[i].size - x) * 0.5);
    });
    for (let i = 0; i < positions.length; i++) positions[i] = next[i];
  }
  return surface;
}

/** How much of the raised front a point takes, 0 to 1: full just behind the hairline on the
 *  centre line, gone by the crown, the temples and below the top. */
export function pompWeight(p, shape) {
  const front = smoothstep(shape.crownZ, shape.frontZ, p[2]);
  const top = smoothstep(shape.topY0, shape.topY1, p[1]);
  const across = Math.sqrt(Math.max(0, 1 - (p[0] / shape.halfWidth) ** 2));
  return front * top * across;
}

/** Raises the front, in place: up by `rise` and forward by `reach` at full weight, plus the
 *  crown's small lift over the whole top. The open edge is held. */
export function raisePomp(surface, shape) {
  surface.positions.forEach((p, i) => {
    if (surface.edge[i]) return;
    const w = pompWeight(p, shape);
    const front = smoothstep(shape.crownZ, shape.frontZ, p[2]);
    const top = smoothstep(shape.topY0, shape.topY1, p[1]);
    p[1] += shape.rise * w + shape.crownLift * top;
    p[2] += shape.reach * w * front;
    p[0] *= 1 + shape.swell * w;
  });
  return surface;
}

/** Pushes every vertex nearer the head than `clearance` back out along the distance field's
 *  gradient, in place. Returns how many it moved. */
export function clearHead(surface, probe, clearance) {
  const h = 5e-4;
  let moved = 0;
  for (const p of surface.positions) {
    const d = probe(p);
    if (d >= clearance) continue;
    const g = [0, 1, 2].map((a) => {
      const q = [...p];
      q[a] += h;
      return (probe(q) - d) / h;
    });
    const len = Math.hypot(g[0], g[1], g[2]);
    if (!len) continue;
    for (let a = 0; a < 3; a++) p[a] += (g[a] / len) * (clearance - d);
    moved++;
  }
  return moved;
}

/** The surface's own vertex normals: each triangle's, area weighted, as the winding has it. */
function surfaceNormals(surface) {
  const normals = surface.positions.map(() => [0, 0, 0]);
  for (const tri of surface.triangles) {
    const [a, b, c] = tri.map((i) => surface.positions[i]);
    const face = cross(sub(b, a), sub(c, a));
    for (const i of tri) for (let x = 0; x < 3; x++) normals[i][x] += face[x];
  }
  return normals.map((n) => {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  });
}

/** A point's uv on the patch: across the head in u, front to back in v (the comb's way). */
export function pompUv(p, shape) {
  const across = Math.min(1, Math.max(0, p[0] / shape.spanX / 2 + 0.5));
  const back = Math.min(
    1,
    Math.max(0, (shape.spanZ[1] - p[2]) / (shape.spanZ[1] - shape.spanZ[0])),
  );
  return [
    POMP_PATCH.u0 + (POMP_PATCH.u1 - POMP_PATCH.u0) * across,
    POMP_PATCH.v0 + (POMP_PATCH.v1 - POMP_PATCH.v0) * back,
  ];
}

/** The pompadour as a welded surface in the Type A head's rest pose, sculpted from the
 *  mohawk's corners. */
export function sculptPompadour(corners, shape) {
  const surface = weldSurface(corners);
  combSurface(surface, shape.combPasses);
  raisePomp(surface, shape);
  combSurface(surface, shape.roundPasses);
  return surface;
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
  const shape = { ...POMP_SHAPE, ...opts.shape };
  const io = await headFileIo();
  const top = await readTop(io);
  const built = [];
  for (const type of opts.types) {
    const surface = sculptPompadour(top.corners, shape);
    // the uv is taken on the Type A sculpt, so both types carry the same paint
    const uvs = surface.positions.map((p) => pompUv(p, shape));
    const placed = placeTop(
      surface.positions.map((p) => ({ p })),
      MULLET_FIT[type].topPlace,
    );
    placed.forEach((c, i) => {
      surface.positions[i] = c.p;
    });
    const cleared = clearHead(
      surface,
      distanceProbe(await readHeadTriangles(io, type)),
      shape.clearance,
    );
    const normals = surfaceNormals(surface);
    const soup = surface.triangles.flatMap((tri) =>
      tri.map((i) => ({ p: surface.positions[i], n: normals[i], t: uvs[i] })),
    );
    const written = await writeHairPiece(io, type, POMPADOUR_ID, soup, top, opts.outDir);
    built.push({ ...written, triangles: surface.triangles.length, clearedVertices: cleared });
  }
  console.log(JSON.stringify({ built }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
