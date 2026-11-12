// Builds six facial-hair styles of the WOC head library for both head types, each into the
// file of its own the catalog names (woc_head_catalog.ts wocHeadPieceUrl:
// head_type_<t>_beard_<id>.glb). Like the mullet and the pompadour, they are built in the repo
// from shipped files, not from the Face Studio head files.
//
// Each style is one of the shipped beards RESHAPED in place: the source piece keeps its
// vertices, triangles, uvs, texture and its chin morph target (FS_Chin_Softness, so the new
// style still follows the chin slider), and only where its vertices sit changes. A style is a
// pure function of a point and the source piece's own frame (FACIAL_STYLES), so the same
// recipe fits both head types:
//
//   forked    the long beard, parted down the middle into two points
//   wizard    the long beard, drawn down to the chest and tapered to one point
//   wild      the long beard, pushed out all round into a mane, its tufts teased
//   walrus    the moustache, thickened and hung over the mouth
//   whiskers  the handlebar, its tips hung straight down past the chin
//   imperial  the handlebar, its tips turned up toward the cheekbones
//
// Normals follow the reshape through its own derivative (no re-smoothing: the beards' hard
// facets are the look). Each file is then finished like the pack's compress step: WOC_lod
// levels against the fit's pinned anatomyTop, meshopt at 'high', the written file read back
// and every level held to the deviation it records.
//
//   node scripts/assets/woc_character/build_facial_hair.mjs [--type a|b] [--only <id>]
//     [--out-dir <dir>]
//
// Every input is a committed file, so a rebuild needs no tool outside the repo. After one:
// node scripts/build_media_manifest.mjs generate, and re-pin the head rows of
// tests/woc_character_size_budget.test.ts and tests/woc_triangle_budget.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dequantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import {
  distanceProbe,
  headFileIo,
  invertAffine,
  readHeadTriangles,
} from './build_mullet_hair.mjs';
import { addLodIndices, LOD_VERIFY_TOLERANCE, verifyLodIndices } from './lod_indices.mjs';
import { keepLodIndices, WOC_LOD } from './woc_lod_extension.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const HEAD_DIR = path.join(ROOT, 'public', 'models', 'chars', 'players', 'woc');
const HEAD_TYPE_FIT = { a: 'male', b: 'female' };

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** A repeatable value in -1..1 for a point (the wild beard's teased tufts). */
function tuft(p) {
  const s = Math.sin(p[0] * 9127.1 + p[1] * 3119.7 + p[2] * 5471.3) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * The styles. `from` is the shipped beard a style reshapes and `file` the shipped file that
 * beard is in (the group file, or the handlebar's own). `shape(p, f)` moves one point of the
 * rig's rest pose; `f` is the source piece's frame on that head type:
 *   cx          the piece's middle in x
 *   y0, y1      its bottom and top;   z0, z1   its back and front
 *   hw          its half width
 * and u = (x - cx) / hw runs -1..1 across the face, v = (y - y0) / (y1 - y0) runs 0..1 up it.
 * Lengths are rig units (the head is about 0.11 wide). `jitter`, where given, is added after
 * the shape and does not turn the normals. `clear`, where given, is the distance a point must
 * stand off the head's skin (0 for none), enforced after the shape (liftOff).
 */
export const FACIAL_STYLES = {
  forked: {
    from: 'long',
    file: 'beards',
    shape: ([x, y, z], f) => {
      const u = (x - f.cx) / f.hw;
      const v = (y - f.y0) / (f.y1 - f.y0);
      // below the chin the beard parts: each half draws in round its own tine and the two
      // tines lean apart, while the middle is lifted into the notch between them
      const t = clamp01((0.42 - v) / 0.42);
      const side = Math.tanh(u * 6);
      const tine = f.cx + side * f.hw * (0.3 + 0.22 * t);
      const notch = Math.exp(-((u / 0.16) ** 2));
      return [
        x + (tine - x) * 0.75 * t * Math.abs(side),
        y + 0.03 * t * notch - 0.012 * t * (1 - notch),
        z - 0.006 * t * notch,
      ];
    },
  },
  // (id `sage`: the legacy modular library already owns a `wizard` beard id)
  sage: {
    from: 'long',
    file: 'beards',
    shape: ([x, y, z], f) => {
      const v = (y - f.y0) / (f.y1 - f.y0);
      // from the jaw down the beard is drawn out to the crotch and tapers to one point. It
      // swings forward over the chest on the way, then hangs, with a slow wave down its length
      const t = clamp01((0.5 - v) / 0.5);
      // broad: it swells below the jaw and keeps most of that width well down its length
      const taper = (1 + 0.85 * smoothstep(0, 0.35, t)) * (1 - 0.82 * t ** 4);
      return [
        f.cx + (x - f.cx) * taper,
        y - f.sageDrop * t * t,
        f.z1 +
          f.sageSwing * Math.sin(t * Math.PI * 0.5) +
          (z - f.z1) * taper +
          0.006 * Math.sin(t * 9) * t,
      ];
    },
  },
  wild: {
    from: 'long',
    file: 'beards',
    shape: ([x, y, z], f) => {
      const v = (y - f.y0) / (f.y1 - f.y0);
      // pushed out all round from the jaw: wider, fuller in front, longer below, and held
      // where it meets the sideburns so it still grows out of the face
      const grow = 1 - smoothstep(0.4, 0.8, v);
      const low = clamp01((0.6 - v) / 0.6);
      return [
        f.cx + (x - f.cx) * (1 + 0.45 * grow),
        // only the hair under the chin is drawn longer: the part round the mouth stays put
        y - 0.035 * clamp01((0.3 - v) / 0.3) ** 2,
        z + (0.012 + 0.014 * low) * grow * smoothstep(f.z0, f.z1, z),
      ];
    },
    jitter: (p, f) => {
      const v = (p[1] - f.y0) / (f.y1 - f.y0);
      const k = 0.002 * (1 - smoothstep(0.4, 0.8, v));
      return [k * tuft(p), k * tuft([p[2], p[0], p[1]]), k * tuft([p[1], p[2], p[0]])];
    },
  },
  walrus: {
    from: 'moustache',
    file: 'beards',
    shape: ([x, y, z], f) => {
      const u = (x - f.cx) / f.hw;
      // hung from its top edge: thicker, standing off the lip, drooping over the mouth and
      // further at the corners
      const hang = f.y1 - y;
      return [f.cx + (x - f.cx) * 1.12, f.y1 - hang * 2.3 - 0.01 * u * u, z + 0.006 + 0.3 * hang];
    },
  },
  whiskers: {
    from: 'handlebar',
    file: 'beard_handlebar',
    shape: ([x, y, z], f) => {
      const u = (x - f.cx) / f.hw;
      // past the corners of the mouth the tips stop running outward and hang straight down.
      // The handlebar's tips run BACK along the cheeks, so a tip that only dropped would hang
      // inside the jaw: each is brought forward to the front of the moustache as it turns
      const s = clamp01((Math.abs(u) - 0.42) / 0.58);
      const side = Math.sign(u);
      const turn = smoothstep(0, 0.25, s);
      const hung = f.cx + side * f.hw * (0.42 + 0.1 * Math.sin(s * Math.PI * 0.5));
      // a tail is a plain strand: the handlebar's ends flick up and back, and hung down that
      // flick would stand out of the strand as a hook, so what a point keeps of its own
      // height and depth in the tail is held to the strand's thickness (its height becomes
      // the strand's width, the strand having turned to hang)
      const mid = (f.y0 + f.y1) / 2;
      const thick = 0.0035;
      const across = Math.max(-thick, Math.min(thick, y - mid));
      const front = z + (f.z1 - f.z0) * s ** 0.8;
      const depth = Math.max(f.z1 - 2 * thick, Math.min(f.z1 + thick, front));
      return [
        x + (hung + across - x) * turn,
        y + (mid - y) * turn - 0.085 * s * s - 0.006 * s,
        front + (depth - front) * turn,
      ];
    },
    // and whatever of a tail still meets the chin on this head is lifted off the skin
    clear: (p, f) => (clamp01((Math.abs((p[0] - f.cx) / f.hw) - 0.42) / 0.58) > 0 ? 0.003 : 0),
  },
  imperial: {
    from: 'handlebar',
    file: 'beard_handlebar',
    shape: ([x, y, z], f) => {
      const u = (x - f.cx) / f.hw;
      // past the corners of the mouth the tips turn up and stand tall, swinging a little
      // wide on the way before they come back in
      const s = clamp01((Math.abs(u) - 0.4) / 0.6);
      const side = Math.sign(u);
      return [
        x + side * (0.012 * Math.sin(s * Math.PI) - 0.014 * s * s),
        y + 0.05 * s ** 1.6,
        z + 0.004 * Math.sin(s * Math.PI),
      ];
    },
  },
};
export const FACIAL_STYLE_IDS = Object.keys(FACIAL_STYLES);

/**
 * What a style needs of the BODY under a head type, which the piece's own frame cannot give:
 *   sageDrop   how far the sage beard's tip is drawn down, to the crotch
 *   sageSwing  how far forward it swings on the way, to clear the chest
 */
export const FRAME_EXTRA = {
  a: { sageDrop: 0.41, sageSwing: 0.035 },
  b: { sageDrop: 0.41, sageSwing: 0.065 },
};

/** A piece's frame: the bounds of its world-space points, as FACIAL_STYLES reads them. */
export function frameOf(points, extra = {}) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p[a]);
      hi[a] = Math.max(hi[a], p[a]);
    }
  }
  return {
    cx: (lo[0] + hi[0]) / 2,
    hw: (hi[0] - lo[0]) / 2,
    y0: lo[1],
    y1: hi[1],
    z0: lo[2],
    z1: hi[2],
    ...extra,
  };
}

/**
 * One point and its normal through a style: the point by the shape (and its jitter), the
 * normal by the inverse transpose of the shape's derivative there, taken numerically.
 */
export function reshape(style, p, n, frame) {
  const moved = style.shape(p, frame);
  const h = 1e-5;
  // columns of the derivative: how the moved point changes per unit step along each axis
  const cols = [0, 1, 2].map((a) => {
    const q = [...p];
    q[a] += h;
    const m = style.shape(q, frame);
    return [(m[0] - moved[0]) / h, (m[1] - moved[1]) / h, (m[2] - moved[2]) / h];
  });
  // J^-T n is the cofactor matrix applied to n, up to the determinant's sign
  const [c0, c1, c2] = cols;
  const cof = [
    [c1[1] * c2[2] - c1[2] * c2[1], c1[2] * c2[0] - c1[0] * c2[2], c1[0] * c2[1] - c1[1] * c2[0]],
    [c2[1] * c0[2] - c2[2] * c0[1], c2[2] * c0[0] - c2[0] * c0[2], c2[0] * c0[1] - c2[1] * c0[0]],
    [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]],
  ];
  const det = c0[0] * cof[0][0] + c0[1] * cof[0][1] + c0[2] * cof[0][2];
  const turned = [0, 1, 2].map(
    (r) => (cof[0][r] * n[0] + cof[1][r] * n[1] + cof[2][r] * n[2]) * Math.sign(det || 1),
  );
  const len = Math.hypot(turned[0], turned[1], turned[2]);
  const j = style.jitter ? style.jitter(p, frame) : [0, 0, 0];
  return {
    p: [moved[0] + j[0], moved[1] + j[1], moved[2] + j[2]],
    n: len ? turned.map((x) => x / len) : n,
  };
}

/** A point pushed out along a distance field's gradient until it stands `clearance` off the
 *  surface (untouched when it already does, or when no clearance is asked). */
export function liftOff(p, probe, clearance) {
  if (!(clearance > 0)) return p;
  let at = p;
  // the head's field is not a plane: a couple of steps settle a point that started inside
  for (let step = 0; step < 3; step++) {
    const d = probe(at);
    if (d >= clearance) break;
    const h = 5e-4;
    const g = [0, 1, 2].map((a) => {
      const q = [...at];
      q[a] += h;
      return (probe(q) - d) / h;
    });
    const len = Math.hypot(g[0], g[1], g[2]);
    if (!len) break;
    at = at.map((x, a) => x + (g[a] / len) * (clearance - d));
  }
  return at;
}

async function buildStyle(io, type, id, outDir) {
  const style = FACIAL_STYLES[id];
  const T = type.toUpperCase();
  const doc = await io.read(path.join(HEAD_DIR, `head_type_${type}_${style.file}.glb`));
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const source = `WocHead_${T}_beard_${style.from}`;
  const node = root.listNodes().find((n) => n.getName() === source);
  if (!node) throw new Error(`head type ${type}: no ${style.from} beard in ${style.file}`);
  // every other piece of the file goes: this file ships one style
  for (const other of root.listNodes()) {
    if (other !== node && other.getMesh()) other.dispose();
  }
  const mesh = node.getMesh();
  const prims = mesh.listPrimitives();
  if (prims.length !== 1) throw new Error(`${source}: ${prims.length} primitives (1 expected)`);
  const [prim] = prims;

  const m = node.getWorldMatrix();
  const toWorld = (v, w) =>
    [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
  const local = invertAffine(m);
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const world = [];
  for (let k = 0; k < pos.getCount(); k++) world.push(toWorld(pos.getElement(k, []), 1));
  const frame = frameOf(world, FRAME_EXTRA[type]);
  const probe = style.clear ? distanceProbe(await readHeadTriangles(io, type)) : null;
  for (let k = 0; k < pos.getCount(); k++) {
    const n = toWorld(nor.getElement(k, []), 0);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const out = reshape(style, world[k], [n[0] / len, n[1] / len, n[2] / len], frame);
    if (probe) out.p = liftOff(out.p, probe, style.clear(world[k], frame));
    pos.setElement(k, local.point(out.p));
    nor.setElement(k, local.direction(out.n));
  }

  node.setName(`WocHead_${T}_beard_${id}`);
  mesh.setName(`WocHead_${T}_beard_${id}`);
  // two sided, like the group's beards: a reshaped tip is seen from behind as well
  prim.getMaterial().setName(`hair_beard_${id}`).setDoubleSided(true);
  // the source's levels were measured on the source's shape: measure this one's afresh
  prim.setExtension(WOC_LOD, null);
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
  const height = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'export_split.json'), 'utf8'))
    .anatomyTop[HEAD_TYPE_FIT[type]];
  const lod = await addLodIndices(doc, { height });
  const step = meshopt({ encoder: MeshoptEncoder, level: 'high' });
  await doc.transform(keepLodIndices([step], { encoder: MeshoptEncoder }));
  const out = await io.writeBinary(doc);
  const check = verifyLodIndices(await io.readBinary(out), {
    tolerance: LOD_VERIFY_TOLERANCE * height,
  });
  if (check.failures.length) {
    throw new Error(`WOC_lod levels fail their check:\n  ${check.failures.join('\n  ')}`);
  }
  const file = path.join(outDir, `head_type_${type}_beard_${id}.glb`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, out);
  return {
    type,
    id,
    file: path.relative(ROOT, file),
    bytes: out.length,
    morphs: mesh.getExtras()?.targetNames ?? [],
    lod: lod.totals,
  };
}

function parseArgs(argv) {
  const opts = { types: ['a', 'b'], ids: FACIAL_STYLE_IDS, outDir: HEAD_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') opts.types = [argv[++i]];
    else if (a === '--only') opts.ids = [argv[++i]];
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of opts.types) if (!HEAD_TYPE_FIT[t]) throw new Error(`unknown head type ${t}`);
  for (const id of opts.ids) if (!FACIAL_STYLES[id]) throw new Error(`unknown style ${id}`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const io = await headFileIo();
  const built = [];
  for (const type of opts.types) {
    for (const id of opts.ids) built.push(await buildStyle(io, type, id, opts.outDir));
  }
  console.log(JSON.stringify({ built }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
