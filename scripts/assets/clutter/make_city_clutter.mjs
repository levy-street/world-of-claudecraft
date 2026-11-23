// City ground clutter: ten tiny, flat-shaded, vertex-coloured GLBs the Studio's
// Paint Clutter brush scatters (render/city_clutter.ts). Authored in yards with
// the ground at y = 0 and the origin at the footprint centre, no textures, no
// collision (data/asset_collision_overrides.json marks them mode 'none').
//
//   node scripts/assets/clutter/make_city_clutter.mjs        # -> tmp/asset_src/clutter/*.glb
//   node scripts/assets/build_assets.mjs scripts/assets/specs/city_clutter.json
//
// Every shape is a deterministic triangle soup (one normal per face) from a
// seeded RNG, so a rebuild ships byte-identical models. The script prints the
// per-model max dimension for render/asset_scale.ts (CITY_CLUTTER_MAX_DIM).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_DIR = path.join(root, 'tmp/asset_src/clutter');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sRGB author colours -> linear vertex colours (glTF COLOR_0 is linear)
const lin = (r, g, b) => [r, g, b].map((c) => c ** 2.2);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

class Soup {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
  }
  tri(a, b, c, col) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
    }
  }
  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }
  /** Convex polygon (counter-clockwise from above) extruded up from y0 by h:
   *  top fan + side walls, no underside (never seen on the ground). */
  extrude(pts, y0, h, col, sideCol = col) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const y1 = y0 + h;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      this.tri([cx, y1, cz], [q[0], y1, q[1]], [p[0], y1, p[1]], col);
      this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], sideCol);
    }
  }
  /** Low-poly irregular ellipsoid (2 rings of 6 + poles = 24 faces). */
  pebble(cx, cy, cz, rx, ry, rz, col, rng, yaw = 0) {
    const rings = [0.5, -0.5];
    const ringPts = rings.map((lat) => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + yaw;
        const j = 0.82 + rng() * 0.36;
        const c = Math.cos(lat * Math.PI * 0.5) * j;
        pts.push([
          cx + Math.cos(a) * rx * c,
          cy + Math.sin(lat * Math.PI * 0.5) * ry * (0.85 + rng() * 0.3),
          cz + Math.sin(a) * rz * c,
        ]);
      }
      return pts;
    });
    const top = [cx, cy + ry, cz];
    const bot = [cx, cy - ry * 0.9, cz];
    for (let i = 0; i < 6; i++) {
      const n = (i + 1) % 6;
      this.tri(top, ringPts[0][n], ringPts[0][i], col);
      this.quad(ringPts[0][i], ringPts[0][n], ringPts[1][n], ringPts[1][i], col);
      this.tri(bot, ringPts[1][i], ringPts[1][n], col);
    }
  }
  /** Thin flat card lying on the ground (double-sided material), slightly bent
   *  along its length so it never reads as a perfect plane. */
  card(cx, cz, len, wid, yaw, col, lift = 0.004, bend = 0.01) {
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const P = (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
    const a = P(-len / 2, -wid / 2, lift),
      b = P(0, -wid / 2, lift + bend);
    const cc = P(len / 2, -wid / 2, lift),
      d = P(len / 2, wid / 2, lift);
    const e = P(0, wid / 2, lift + bend),
      f = P(-len / 2, wid / 2, lift);
    this.quad(a, b, e, f, col);
    this.quad(b, cc, d, e, col);
  }
  /** Thin box (splinter / strand) lying flat, rotated by yaw. */
  slat(cx, cz, len, wid, h, yaw, col, tilt = 0) {
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const P = (u, v, y) => [cx + u * c - v * s, y + u * tilt, cz + u * s + v * c];
    const a0 = P(-len / 2, -wid / 2, 0),
      b0 = P(len / 2, -wid / 2, 0);
    const c0 = P(len / 2, wid / 2, 0),
      d0 = P(-len / 2, wid / 2, 0);
    const a1 = P(-len / 2, -wid / 2, h),
      b1 = P(len / 2, -wid / 2, h);
    const c1 = P(len / 2, wid / 2, h),
      d1 = P(-len / 2, wid / 2, h);
    this.quad(a1, b1, c1, d1, col); // top
    this.quad(a0, b0, b1, a1, col); // sides
    this.quad(b0, c0, c1, b1, col);
    this.quad(c0, d0, d1, c1, col);
    this.quad(d0, a0, a1, d1, col);
  }
  maxDim() {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], this.pos[i + k]);
        max[k] = Math.max(max[k], this.pos[i + k]);
      }
    return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  }
}

/** Jagged convex-ish outline: n points around (cx, cz) at radius r with noise. */
function jaggedPoly(rng, cx, cz, r, n, noise = 0.3) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * (0.6 / n);
    const rr = r * (1 - noise + rng() * noise * 2);
    pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return pts;
}

const STONE = lin(0.56, 0.54, 0.5);
const STONE_DARK = lin(0.42, 0.4, 0.37);
const STONE_WARM = lin(0.6, 0.55, 0.47);
const PAPER = lin(0.93, 0.89, 0.78);
const PAPER_SHADE = lin(0.8, 0.76, 0.64);
const WOOD = lin(0.48, 0.34, 0.19);
const WOOD_DARK = lin(0.32, 0.22, 0.12);
const TERRACOTTA = lin(0.7, 0.38, 0.24);
const TERRACOTTA_IN = lin(0.55, 0.3, 0.2);
const STRAW = lin(0.82, 0.7, 0.38);
const LEAF = [
  lin(0.74, 0.44, 0.14),
  lin(0.58, 0.31, 0.12),
  lin(0.82, 0.62, 0.2),
  lin(0.45, 0.4, 0.18),
];

const BUILDERS = {
  // a cracked paving slab: two halves of one 0.55 yd tile, one half lifted at a lean
  tile_broken(soup, rng) {
    const w = 0.28,
      d = 0.27,
      h = 0.035;
    const crack = [
      [-0.02, -d],
      [0.05, -0.1],
      [-0.04, 0.05],
      [0.03, d],
    ];
    const left = [[-w, -d], ...crack, [-w, d]].map((p) => [p[0] - 0.02, p[1]]);
    const right = [[w, d], ...[...crack].reverse(), [w, -d]].map((p) => [p[0] + 0.03, p[1]]);
    soup.extrude(left.reverse(), 0, h, STONE, STONE_DARK);
    soup.extrude(right.reverse(), 0.012, h, mix(STONE, STONE_WARM, 0.5), STONE_DARK);
  },
  // five flat shards of a shattered tile scattered over ~0.7 yd
  tile_shards(soup, rng) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng();
      const rr = 0.08 + rng() * 0.22;
      const pts = jaggedPoly(
        rng,
        Math.cos(a) * rr,
        Math.sin(a) * rr,
        0.06 + rng() * 0.06,
        3 + Math.floor(rng() * 3),
        0.35,
      );
      soup.extrude(
        pts.reverse(),
        0,
        0.02 + rng() * 0.015,
        mix(STONE, STONE_WARM, rng()),
        STONE_DARK,
      );
    }
  },
  // a spill of seven small pebbles
  pebbles(soup, rng) {
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2,
        rr = Math.sqrt(rng()) * 0.26;
      const r = 0.035 + rng() * 0.035;
      const col = mix(STONE, i % 2 ? STONE_DARK : STONE_WARM, rng() * 0.8);
      soup.pebble(
        Math.cos(a) * rr,
        r * 0.55,
        Math.sin(a) * rr,
        r * (0.9 + rng() * 0.5),
        r * 0.6,
        r,
        col,
        rng,
        rng() * 3,
      );
    }
  },
  // three fist-sized stones
  stones(soup, rng) {
    const spots = [
      [-0.12, 0.05],
      [0.1, -0.09],
      [0.06, 0.13],
    ];
    for (let i = 0; i < 3; i++) {
      const r = 0.09 + rng() * 0.06;
      soup.pebble(
        spots[i][0],
        r * 0.6,
        spots[i][1],
        r * (1 + rng() * 0.4),
        r * 0.65,
        r,
        mix(STONE_DARK, STONE, rng()),
        rng,
        rng() * 3,
      );
    }
  },
  // a letter lying open, folded once across the middle
  letter(soup, rng) {
    const yaw = 0.3;
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const P = (u, v, y) => [u * c - v * s, y, u * s + v * c];
    const w = 0.16,
      l = 0.21;
    const a = P(-l, -w, 0.004),
      b = P(0, -w, 0.03),
      cc = P(l, -w, 0.004);
    const d = P(l, w, 0.004),
      e = P(0, w, 0.03),
      f = P(-l, w, 0.004);
    soup.quad(a, b, e, f, PAPER);
    soup.quad(b, cc, d, e, mix(PAPER, PAPER_SHADE, 0.35));
    // a wax seal dab
    soup.pebble(
      P(-l * 0.5, 0, 0)[0],
      0.012,
      P(-l * 0.5, 0, 0)[2],
      0.02,
      0.012,
      0.02,
      lin(0.55, 0.12, 0.1),
      rng,
    );
  },
  // three crumpled scraps of paper
  paper_scraps(soup, rng) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng();
      const rr = 0.1 + rng() * 0.12;
      const cx = Math.cos(a) * rr,
        cz = Math.sin(a) * rr;
      const pts = jaggedPoly(rng, cx, cz, 0.05 + rng() * 0.04, 5, 0.4);
      soup.extrude(
        pts.reverse(),
        0,
        0.02 + rng() * 0.02,
        mix(PAPER, PAPER_SHADE, rng() * 0.5),
        PAPER_SHADE,
      );
    }
  },
  // six fallen leaves in autumn tones
  leaves(soup, rng) {
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2,
        rr = Math.sqrt(rng()) * 0.3;
      const cx = Math.cos(a) * rr,
        cz = Math.sin(a) * rr;
      const yaw = rng() * Math.PI * 2;
      const len = 0.09 + rng() * 0.06;
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      const P = (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
      const col = LEAF[Math.floor(rng() * LEAF.length)];
      // a diamond leaf with a lifted tip
      soup.quad(
        P(-len / 2, 0, 0.003),
        P(0, -len * 0.3, 0.006),
        P(len / 2, 0, 0.02),
        P(0, len * 0.3, 0.006),
        col,
      );
    }
  },
  // nine strands of straw
  straw(soup, rng) {
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2,
        rr = Math.sqrt(rng()) * 0.22;
      soup.slat(
        Math.cos(a) * rr,
        Math.sin(a) * rr,
        0.18 + rng() * 0.14,
        0.012,
        0.008,
        rng() * Math.PI,
        mix(STRAW, PAPER_SHADE, rng() * 0.4),
        (rng() - 0.5) * 0.05,
      );
    }
  },
  // four wood splinters from a broken crate
  splinters(soup, rng) {
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2,
        rr = Math.sqrt(rng()) * 0.2;
      soup.slat(
        Math.cos(a) * rr,
        Math.sin(a) * rr,
        0.16 + rng() * 0.18,
        0.02 + rng() * 0.02,
        0.015 + rng() * 0.012,
        rng() * Math.PI,
        mix(WOOD, WOOD_DARK, rng() * 0.6),
        (rng() - 0.5) * 0.12,
      );
    }
  },
  // four curved terracotta pot shards
  pot_shards(soup, rng) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng();
      const rr = 0.06 + rng() * 0.16;
      const cx = Math.cos(a) * rr,
        cz = Math.sin(a) * rr;
      const yaw = rng() * Math.PI * 2,
        c = Math.cos(yaw),
        s = Math.sin(yaw);
      const P = (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
      const len = 0.1 + rng() * 0.08,
        wid = 0.07 + rng() * 0.05;
      // a 3-segment arc across the width so the shard cups the ground
      const ys = [0.002, 0.03, 0.002];
      const vs = [-wid / 2, 0, wid / 2];
      for (let k = 0; k < 2; k++) {
        const a0 = P(-len / 2, vs[k], ys[k]),
          b0 = P(len / 2, vs[k], ys[k]);
        const a1 = P(-len / 2, vs[k + 1], ys[k + 1]),
          b1 = P(len / 2, vs[k + 1], ys[k + 1]);
        soup.quad(a0, b0, b1, a1, k === 0 ? TERRACOTTA : TERRACOTTA_IN);
      }
    }
  },
};

// kinds whose faces are cards seen from either side (thin, no volume)
const DOUBLE_SIDED = new Set(['letter', 'leaves', 'pot_shards']);

mkdirSync(OUT_DIR, { recursive: true });
const io = new NodeIO();
const dims = {};
let seed = 1101;
for (const [name, build] of Object.entries(BUILDERS)) {
  const soup = new Soup();
  build(soup, mulberry32(seed++));
  const doc = new Document();
  const buffer = doc.createBuffer();
  const material = doc
    .createMaterial('clutter')
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.92)
    .setMetallicFactor(0)
    .setDoubleSided(DOUBLE_SIDED.has(name));
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(soup.pos)).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(soup.nrm)).setBuffer(buffer),
    )
    .setAttribute(
      'COLOR_0',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(soup.col)).setBuffer(buffer),
    );
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  const out = path.join(OUT_DIR, `${name}.glb`);
  await io.write(out, doc);
  dims[name] = Math.round(soup.maxDim() * 1000) / 1000;
  console.log(
    `${name}: ${soup.pos.length / 9} tris, max dim ${dims[name]} yd -> ${path.relative(root, out)}`,
  );
}
console.log('CITY_CLUTTER_MAX_DIM =', JSON.stringify(dims));
