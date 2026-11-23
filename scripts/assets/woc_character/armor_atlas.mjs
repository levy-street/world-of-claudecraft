// One texture set per armor set (the 2026-09-25 character size gameplan, step 8), done in the
// build instead of by hand: every textured piece of a set is packed into ONE atlas per map kind
// (color, normal, the packed occlusion/roughness/metal "ORM", and glow for a set that has it),
// its UVs are remapped into its cell, and its material factors are baked into the texels, so a
// set ships three or four textures instead of twenty-odd. Geometry is untouched (the split
// build's check against the assembled reference still compares every vertex).
//
// Cells are sized for ONE texel density across the set: a piece's cell side follows
// sqrt(world area / UV coverage), so a chest plate keeps the texels it shows and a glove does
// not hoard them. Each cell is filled from the piece's own lossless master for the tier, the
// border repeated into a gutter so mips never bleed a neighbour in, and cells sit on the 4 x 4
// block grid the GPU codecs encode in. A material with no texture (a plain leather sole) keeps
// its own factor-only material and takes no atlas space. Materials whose cells would hold
// identical pixels (a mirrored left piece wearing its right twin's maps: the 2026-10-03 male
// warrior rebuild) share one cell sized for the more demanding of them, so a pair never pays
// twice for the same pixels.
//
// Materials that genuinely differ (double-sidedness, the specular and glow-strength extensions)
// stay separate materials over the SAME atlas textures: the texture count is what the budget
// counts. Neither is free at runtime: each separate material is one more armor draw a pass for
// its wearer (src/render/characters/woc_armor_merge_core.ts folds parts per file material), and
// a specular factor makes its material a physical one on Medium and above
// (tests/woc_material_extensions.test.ts pins both: the materials each file carries and every
// specular factor).
// Budgets: tests/woc_character_size_budget.test.ts (bytes) and
// tests/woc_texture_budget.test.ts, which pins the size of every map these layouts ship (the
// low file's, the full layout's in the top file and its half in the medium file) as literals
// of its own: change a size in ATLAS_SIZES and its pin there together, deliberately.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { m4, nodeTable, worldMatrices } from './rig_math.mjs';

/** Atlas dimensions per layout and map kind [width, height]. One aspect per layout, so one
 *  normalized layout serves every map of it. `low` is the low file's own (colour and glow
 *  only). `full` is the ONE layout the medium and high tiers share (2026-10-03): composed and
 *  encoded once at these sizes, then cut along the top mip level, the medium file shipping
 *  every map at half these sizes and the top file the top level (build_woc_split.mjs). */
export const ATLAS_SIZES = {
  low: { color: [1024, 512], emissive: [256, 128] },
  full: { color: [2048, 1024], normal: [1024, 512], data: [1024, 512], emissive: [1024, 512] },
};

/** Gutter around every cell, in texels of the tier's SMALLEST map (repeated edge texels). */
const GUTTER_TEXELS = 4;
/** Cell sides and origins sit on this grid of the smallest map (the 4 x 4 codec block). */
const BLOCK = 4;

const SLOTS = ['color', 'normal', 'data', 'emissive'];

function slotTexture(mat, slot) {
  if (slot === 'color') return mat.getBaseColorTexture();
  if (slot === 'normal') return mat.getNormalTexture();
  if (slot === 'emissive') return mat.getEmissiveTexture();
  return mat.getMetallicRoughnessTexture() ?? mat.getOcclusionTexture();
}

// ------------------------------------------------------------------------ measure

/** World-space area of a primitive at the rig's rest pose (skinned through its IBMs). */
function primitiveArea(prim, node, worlds) {
  const pos = prim.getAttribute('POSITION');
  const skin = node.getSkin();
  let transform = worlds.get(node);
  if (skin) {
    // At rest every joint's world x IBM is the same bind transform: take the first joint's.
    const ibm = skin.getInverseBindMatrices().getArray();
    transform = m4.mul(worlds.get(skin.listJoints()[0]), Array.from(ibm.subarray(0, 16)));
  }
  const p = [0, 0, 0];
  const world = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, p);
    world.push(m4.apply(transform, [p[0], p[1], p[2]]));
  }
  const idx = prim.getIndices()?.getArray();
  const n = idx ? idx.length : world.length;
  let area = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = world[idx ? idx[t] : t];
    const b = world[idx ? idx[t + 1] : t + 1];
    const c = world[idx ? idx[t + 2] : t + 2];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area +=
      0.5 *
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      );
  }
  return area;
}

/** Fraction of the 0..1 UV square a material's primitives cover (a coarse raster, so mirrored
 *  or stacked islands count once). */
function uvCoverage(prims, res = 128) {
  const grid = new Uint8Array(res * res);
  const uv = [0, 0];
  for (const prim of prims) {
    const acc = prim.getAttribute('TEXCOORD_0');
    if (!acc) continue;
    const idx = prim.getIndices()?.getArray();
    const n = idx ? idx.length : acc.getCount();
    const at = (k) => {
      acc.getElement(idx ? idx[k] : k, uv);
      return [uv[0] * res, uv[1] * res];
    };
    for (let t = 0; t + 2 < n; t += 3) {
      const [a, b, c] = [at(t), at(t + 1), at(t + 2)];
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(res - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(res - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (area === 0) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
          const w1 = (c[0] - b[0]) * (py - b[1]) - (px - b[0]) * (c[1] - b[1]);
          const w2 = (a[0] - c[0]) * (py - c[1]) - (px - c[0]) * (a[1] - c[1]);
          if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
            grid[y * res + x] = 1;
          }
        }
      }
    }
  }
  let covered = 0;
  for (const v of grid) covered += v;
  return Math.max(0.05, covered / grid.length);
}

// ------------------------------------------------------------------------ pack

/**
 * MaxRects (best short side fit) packing of squares of integer side `sides[i]` (texels of the
 * smallest map, multiples of BLOCK), each ringed by a GUTTER_TEXELS gutter, into a W x H grid.
 * Returns each cell's interior origin, or null when they do not all fit.
 */
function maxRectsPack(sides, W, H) {
  const g = GUTTER_TEXELS;
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const order = sides.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const cells = new Array(sides.length);
  for (const [s, i] of order) {
    const box = s + 2 * g;
    let best = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const r of free) {
      if (r.w < box || r.h < box) continue;
      const short = Math.min(r.w - box, r.h - box);
      const long = Math.max(r.w - box, r.h - box);
      if (short < bestShort || (short === bestShort && long < bestLong)) {
        best = r;
        bestShort = short;
        bestLong = long;
      }
    }
    if (!best) return null;
    const placed = { x: best.x, y: best.y, w: box, h: box };
    cells[i] = { x: placed.x + g, y: placed.y + g, side: s };
    // split every free rect the placement overlaps into the up to four rects around it
    const next = [];
    for (const r of free) {
      if (
        placed.x >= r.x + r.w ||
        placed.x + placed.w <= r.x ||
        placed.y >= r.y + r.h ||
        placed.y + placed.h <= r.y
      ) {
        next.push(r);
        continue;
      }
      if (placed.x > r.x) next.push({ x: r.x, y: r.y, w: placed.x - r.x, h: r.h });
      if (placed.x + placed.w < r.x + r.w) {
        next.push({ x: placed.x + placed.w, y: r.y, w: r.x + r.w - placed.x - placed.w, h: r.h });
      }
      if (placed.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: placed.y - r.y });
      if (placed.y + placed.h < r.y + r.h) {
        next.push({ x: r.x, y: placed.y + placed.h, w: r.w, h: r.y + r.h - placed.y - placed.h });
      }
    }
    // drop free rects wholly inside another
    free = next.filter(
      (a, ai) =>
        !next.some(
          (b, bi) =>
            bi !== ai &&
            a.x >= b.x &&
            a.y >= b.y &&
            a.x + a.w <= b.x + b.w &&
            a.y + a.h <= b.y + b.h &&
            (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || bi < ai),
        ),
    );
  }
  return cells;
}

/** The layout: the largest uniform scale of the density weights whose block-snapped squares
 *  still pack into the smallest map (every larger map is an integer multiple of it). */
function layout(weights, W, H) {
  const sides = (k) => weights.map((w) => Math.max(BLOCK, Math.floor((w * k) / BLOCK) * BLOCK));
  let lo = 0;
  let hi = Math.max(W, H) / Math.min(...weights);
  for (let it = 0; it < 48; it++) {
    const mid = (lo + hi) / 2;
    if (maxRectsPack(sides(mid), W, H)) lo = mid;
    else hi = mid;
  }
  return maxRectsPack(sides(lo), W, H);
}

// ------------------------------------------------------------------------ compose

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** The neutral texel of a slot, where a piece carries no map of that kind. */
function neutralTexel(slot, mat) {
  if (slot === 'normal') return [128, 128, 255, 255];
  if (slot === 'data') {
    return [
      255,
      Math.round(255 * mat.getRoughnessFactor()),
      Math.round(255 * mat.getMetallicFactor()),
      255,
    ];
  }
  if (slot === 'emissive') {
    const e = mat.getEmissiveFactor();
    return [...e.map((v) => Math.round(255 * linearToSrgb(Math.min(1, v)))), 255];
  }
  const f = mat.getBaseColorFactor();
  return [...f.slice(0, 3).map((v) => Math.round(255 * linearToSrgb(v))), 255];
}

/** Bake a piece's material factors into its RGBA texels (raw, in place). */
function bakeFactors(raw, slot, mat, common) {
  if (slot === 'color') {
    const f = mat.getBaseColorFactor();
    if (f.every((v) => Math.abs(v - 1) < 1e-6)) return;
    for (let i = 0; i < raw.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        raw[i + c] = Math.round(255 * linearToSrgb(srgbToLinear(raw[i + c] / 255) * f[c]));
      }
      raw[i + 3] = Math.round(raw[i + 3] * f[3]);
    }
  } else if (slot === 'data') {
    // occlusion R (toward 1 by the strength the shared material does not carry), roughness G,
    // metal B, each by its factor
    // a piece whose map carries no occlusion reads none (R = 1), whatever its R channel holds
    const occ = mat.getOcclusionTexture()
      ? mat.getOcclusionStrength() / common.occlusionStrength
      : 0;
    const rough = mat.getRoughnessFactor();
    const metal = mat.getMetallicFactor();
    if (Math.abs(occ - 1) < 1e-6 && Math.abs(rough - 1) < 1e-6 && Math.abs(metal - 1) < 1e-6)
      return;
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = Math.round(255 - (255 - raw[i]) * Math.min(1, occ));
      raw[i + 1] = Math.round(raw[i + 1] * rough);
      raw[i + 2] = Math.round(raw[i + 2] * metal);
    }
  } else if (slot === 'emissive') {
    const e = mat.getEmissiveFactor();
    if (e.every((v) => Math.abs(v - 1) < 1e-6)) return;
    for (let i = 0; i < raw.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        raw[i + c] = Math.round(255 * linearToSrgb(srgbToLinear(raw[i + c] / 255) * e[c]));
      }
    }
  } else if (slot === 'normal') {
    // a resize shortens normals: renormalize (the scale factor rides the shared material)
    for (let i = 0; i < raw.length; i += 4) {
      const x = raw[i] / 127.5 - 1;
      const y = raw[i + 1] / 127.5 - 1;
      const z = raw[i + 2] / 127.5 - 1;
      const l = Math.hypot(x, y, z) || 1;
      raw[i] = Math.round((x / l + 1) * 127.5);
      raw[i + 1] = Math.round((y / l + 1) * 127.5);
      raw[i + 2] = Math.round((z / l + 1) * 127.5);
    }
  }
}

/** One cell's pixels: the master resized to the cell, factors baked, the border repeated out
 *  into the gutter. Returns a PNG buffer of (w + 2g) x (h + 2g). */
async function cellImage(master, slot, mat, common, w, h, g) {
  let raw;
  if (master) {
    raw = await sharp(master)
      .resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } else {
    raw = Buffer.alloc(w * h * 4);
    const t = neutralTexel(slot, mat);
    for (let i = 0; i < raw.length; i += 4) raw.set(t, i);
  }
  if (master) bakeFactors(raw, slot, mat, common);
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } })
    .extend({ top: g, bottom: g, left: g, right: g, extendWith: 'copy' })
    .png()
    .toBuffer();
}

// ------------------------------------------------------------------------ atlas

/** What a material's cell would hold, as a key: per shipped slot, the sha1 of the master it
 *  is filled from (or `-` for a factor-only slot), plus every factor bakeFactors and
 *  neutralTexel fold into the pixels. Two materials with one key paint identical cells. */
function cellKey(mat, slots, masterFor) {
  const masters = slots.map((slot) => {
    const tex = slotTexture(mat, slot);
    const master = tex ? masterFor(tex, mat, slot) : null;
    return master ? crypto.createHash('sha1').update(master).digest('hex') : '-';
  });
  return JSON.stringify([
    masters,
    mat.getBaseColorFactor(),
    mat.getEmissiveFactor(),
    mat.getRoughnessFactor(),
    mat.getMetallicFactor(),
    mat.getOcclusionStrength(),
    !!mat.getOcclusionTexture(),
  ]);
}

/**
 * Atlas a set's textured materials in place, at one of ATLAS_SIZES' layouts (`tier`: `low` or
 * `full`, which also names the atlases and materials it makes). `masterFor(texture, material,
 * slot)` returns the lossless PNG master a texture encodes from. Returns a summary.
 */
export async function atlasArmorSet(doc, tier, masterFor) {
  const sizes = ATLAS_SIZES[tier];
  if (!sizes) throw new Error(`atlas: no layout ${tier}`);
  const table = nodeTable(doc);
  const worlds = worldMatrices(table);
  // every textured material and the primitives (with their nodes) drawing it
  const entries = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat?.getBaseColorTexture()) continue;
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) throw new Error(`atlas: ${node.getName()} is textured but has no TEXCOORD_0`);
      const e = entries.get(mat) ?? { mat, prims: [], area: 0 };
      e.prims.push(prim);
      e.area += primitiveArea(prim, node, worlds);
      entries.set(mat, e);
    }
  }
  const list = [...entries.values()];
  if (list.length === 0) return { materials: 0 };
  // UVs must stay inside the square (no tiling): a cell cannot wrap
  for (const e of list) {
    for (const prim of e.prims) {
      const acc = prim.getAttribute('TEXCOORD_0');
      const lo = acc.getMin([]);
      const hi = acc.getMax([]);
      if (lo[0] < -1e-4 || lo[1] < -1e-4 || hi[0] > 1 + 1e-4 || hi[1] > 1 + 1e-4) {
        throw new Error(`atlas: ${e.mat.getName()} UVs leave the 0..1 square`);
      }
    }
    e.coverage = uvCoverage(e.prims);
    e.weight = Math.sqrt(Math.max(e.area, 1e-8) / e.coverage);
  }
  // the kinds this tier ships, the ones any piece carries
  const slots = SLOTS.filter((s) => sizes[s] && list.some((e) => slotTexture(e.mat, s)));
  const dims = slots.map((s) => sizes[s]);
  const minW = Math.min(...dims.map(([w]) => w));
  const minH = Math.min(...dims.map(([, h]) => h));
  for (const [w, h] of dims) {
    if (w % minW || h % minH || w / minW !== h / minH) {
      throw new Error(`atlas: ${tier} maps are not integer multiples of one grid`);
    }
  }
  // Materials that would paint IDENTICAL cell pixels (the same master bytes in every slot and
  // the same factors baked into them: a mirrored left piece wearing its right twin's maps)
  // share ONE cell, sized for the most demanding of them, so a twin pair no longer pays for
  // the same pixels twice. Every piece keeps at least the texel density it would get alone.
  const groups = new Map();
  for (const e of list) {
    const key = cellKey(e.mat, slots, masterFor);
    const group = groups.get(key) ?? { entries: [], weight: 0 };
    group.entries.push(e);
    group.weight = Math.max(group.weight, e.weight);
    groups.set(key, group);
  }
  const cellGroups = [...groups.values()];
  const top = Math.max(...cellGroups.map((g) => g.weight));
  const cells = layout(
    cellGroups.map((g) => g.weight / top),
    minW,
    minH,
  );
  if (!cells) throw new Error(`atlas: ${tier} layout failed`);
  cellGroups.forEach((group, i) => {
    for (const e of group.entries) e.cell = cells[i];
  });
  // occlusion strength shared by every textured piece (each piece's is baked relative to it)
  const occl = list
    .filter((e) => e.mat.getOcclusionTexture())
    .map((e) => e.mat.getOcclusionStrength());
  const common = { occlusionStrength: occl.length ? Math.max(...occl) : 1 };

  const atlases = new Map();
  for (const slot of slots) {
    const [W, H] = sizes[slot];
    const scale = W / minW;
    const g = GUTTER_TEXELS * scale;
    const composites = [];
    // one composite per cell: a shared cell's twins would paint the same pixels again
    for (const e of cellGroups.map((group) => group.entries[0])) {
      const side = e.cell.side * scale;
      const tex = slotTexture(e.mat, slot);
      const master = tex ? masterFor(tex, e.mat, slot) : null;
      if (tex && !master) throw new Error(`atlas: no master for ${e.mat.getName()} ${slot}`);
      composites.push({
        input: await cellImage(master, slot, e.mat, common, side, side, g),
        left: e.cell.x * scale - g,
        top: e.cell.y * scale - g,
      });
    }
    const background =
      slot === 'normal' ? { r: 128, g: 128, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 1 };
    const png = await sharp({ create: { width: W, height: H, channels: 4, background } })
      .composite(composites)
      .png()
      .toBuffer();
    // WOC_ATLAS_DUMP=<dir>: write each composed atlas out for a look (review aid, off by default)
    if (process.env.WOC_ATLAS_DUMP) {
      const fs = await import('node:fs');
      fs.mkdirSync(process.env.WOC_ATLAS_DUMP, { recursive: true });
      const name = `${
        doc
          .getRoot()
          .listNodes()
          .find((n) => n.getMesh())
          ?.getName() ?? 'set'
      }_${tier}_${slot}.png`;
      fs.writeFileSync(`${process.env.WOC_ATLAS_DUMP}/${name}`, png);
    }
    const texture = doc
      .createTexture(`${tier}_${slot}_atlas`)
      .setImage(new Uint8Array(png))
      .setMimeType('image/png')
      .setURI(`${tier}_${slot}_atlas.png`);
    atlases.set(slot, texture);
  }

  // remap every textured primitive's UVs into its cell's interior (an accessor two primitives
  // share is cloned first, so each is remapped exactly once)
  const users = new Map();
  for (const e of list) {
    for (const prim of e.prims) {
      const acc = prim.getAttribute('TEXCOORD_0');
      users.set(acc, (users.get(acc) ?? 0) + 1);
    }
  }
  for (const e of list) {
    const r = {
      x: e.cell.x / minW,
      y: e.cell.y / minH,
      w: e.cell.side / minW,
      h: e.cell.side / minH,
    };
    for (const prim of e.prims) {
      let acc = prim.getAttribute('TEXCOORD_0');
      if ((users.get(acc) ?? 0) > 1) {
        users.set(acc, users.get(acc) - 1);
        acc = acc.clone();
        prim.setAttribute('TEXCOORD_0', acc);
      }
      const uv = [0, 0];
      const out = new Float32Array(acc.getCount() * 2);
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, uv);
        out[i * 2] = r.x + uv[0] * r.w;
        out[i * 2 + 1] = r.y + uv[1] * r.h;
      }
      acc.setArray(out).setNormalized(false);
    }
  }

  // one material per genuinely different signature, all over the same atlas textures
  const signature = (m) =>
    JSON.stringify([
      m.getDoubleSided(),
      m.getAlphaMode(),
      m.getAlphaCutoff(),
      m
        .listExtensions()
        .map((x) => [
          x.extensionName,
          x.getSpecularFactor?.(),
          x.getSpecularColorFactor?.(),
          x.getEmissiveStrength?.(),
        ])
        .sort(),
      !!m.getEmissiveTexture(),
    ]);
  // (the group's first material is reused, extensions and all; the rest prune away)
  const shared = new Map();
  const keys = list.map((e) => signature(e.mat));
  for (const [i, e] of list.entries()) {
    const key = keys[i];
    let mat = shared.get(key);
    if (!mat) {
      mat = e.mat;
      const hadGlow = !!mat.getEmissiveTexture();
      const ownEmissive = mat.getEmissiveFactor();
      mat.setName(`${tier} atlas ${shared.size}`);
      mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(atlases.get('color') ?? null);
      mat.setNormalTexture(atlases.get('normal') ?? null).setNormalScale(1);
      const data = atlases.get('data') ?? null;
      mat.setMetallicRoughnessTexture(data).setOcclusionTexture(data);
      mat.setRoughnessFactor(data ? 1 : e.mat.getRoughnessFactor());
      mat.setMetallicFactor(data ? 1 : e.mat.getMetallicFactor());
      mat.setOcclusionStrength(common.occlusionStrength);
      const glow = atlases.get('emissive') ?? null;
      mat.setEmissiveTexture(hadGlow ? glow : null);
      mat.setEmissiveFactor(hadGlow ? [1, 1, 1] : ownEmissive);
      shared.set(key, mat);
    }
    for (const prim of e.prims) prim.setMaterial(mat);
  }
  return {
    materials: list.length,
    shared: shared.size,
    cellsShared: list.length - cellGroups.length,
    maps: slots.map((s) => `${s} ${sizes[s].join('x')}`),
    cells: list.map((e) => ({
      area: +e.area.toFixed(5),
      coverage: +e.coverage.toFixed(3),
      px: e.cell.side * (sizes[slots[0]][0] / minW),
    })),
  };
}
