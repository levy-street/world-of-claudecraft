// One colour texture per head CORE (the base head and every small face piece), done in the
// build: a core shipped nine to fifteen textures (the head's skin, one per brow, ear, eyelid
// shell, eyeball, mouth and nose source), so a face drew as a dozen materials that no merge
// could fold. Every textured core material now samples ONE atlas, which is what lets the
// renderer draw a whole face as one mesh (src/render/characters/woc_head_merge.ts).
//
// Nothing is resampled. Each source texture contributes the RECTANGLE its pieces' UVs actually
// reach (an eyelid shell reads a thumbnail-sized corner of its source), copied texel for texel
// at its own resolution, with a gutter of the source's own neighbouring texels around it
// (through the sampler's wrap mode, so a UV that ran past the edge still reads what it read).
// Cell origins and sizes sit on the 4 x 4 block grid the GPU codecs encode in, and a crop
// starts on the source's own block grid, so a block of the atlas holds the texels the same
// block of the source held. UVs are remapped by a pure offset and scale into the cell.
//
// What stays as authored: every material (its name carries the tint role and the measured
// reference, woc_head_look_core.ts WOC_HEAD_TINT_TABLE), its factors and its sidedness; the
// untextured ones (the piercings' gold, Type B's eyeliner) keep their flat colour and take no
// atlas space. Hair and beard pieces are not core pieces: their files keep their own texture.
//
// The atlas also carries one WHITE cell and records its centre on every atlas material
// (`extras.wocHeadAtlas.white`, which GLTFLoader hands to the material's userData): a merged
// face gives its flat-coloured pieces that UV, so one material can draw them too. Every vertex
// of such a piece sits on that ONE uv, so the uv has no slope across a triangle and the GPU
// reads level 0 at any distance: the cell has to be white at level 0 only.
//
// The atlas's MIP LEVELS are built here too, per cell (headAtlasMipLevels), and handed to the
// encoder as they are (headAtlasLevelPngs). An encoder that makes them itself filters the
// WHOLE image (ktx: a lanczos, each level from the one above, wrapping at the image's edge).
// The gutter keeps a cell to itself while a texel is no wider than it (levels 0 to 3); from
// level 4 a texel on a cell's edge is part neighbour, part black background. Measured on the
// two shipped cores (2026-10-02), as the share of what a face's pieces read that came from
// outside their own cells, each piece at the level its texel density puts it on: 1.2 % of a
// Type A face and 2.5 % of a Type B face for a head 40 pixels tall, 5.7 and 7.8 % at 20
// pixels, a quarter to a third of it the black. Before the atlas each source had a chain of
// its own and only ever averaged with itself, and that is what a level holds again: inside
// and around every cell that cell's own source and nothing else, never black (0.3 and 0.7 %
// at 40 pixels, 3.6 and 3.7 % at 20).
//
// What is left is not in the texels. Once a texel is wider than the room between two cells'
// uvs (20 texels: barely at level 4, plainly from level 5), a bilinear tap at a cell's edge
// reaches the texel beside it, which is the neighbour's however it was made. Type A's brows
// sample level 6 for a 20 pixel head, where their cell is five texels wide, and still drift
// about 14 of 255 toward the skin beside them. Only the layout takes that away: a gutter as
// wide as the texel it has to cover. A piece that must hold its colour when a head is a few
// pixels tall wants a wider gutter here, not another filter.
import sharp from 'sharp';

/** Gutter round every cell, in texels (the source's own neighbours, by its wrap mode). */
export const HEAD_ATLAS_GUTTER = 8;
/** Texels kept beyond the UV bounds inside a cell (the bilinear footprint, and then some). */
export const HEAD_ATLAS_MARGIN = 2;
/** Cells sit on this grid (the 4 x 4 codec block). */
export const HEAD_ATLAS_BLOCK = 4;
/** The white cell's interior side, in texels. */
const WHITE_CELL = 8;
/** Largest atlas side tried (every WebGL2 device samples 4096; 2048 keeps a phone's memory). */
const MAX_SIDE = 2048;
const SIDE_STEP = 16;

const REPEAT = 10497;
const MIRRORED_REPEAT = 33648;

/** Core piece nodes: the base head and the slots that ride the core file (the split step's
 *  CORE_SLOTS). A hairstyle or a beard is never a core piece. */
export function isHeadCorePiece(nodeName) {
  return /^WocHead_[A-Z]_(base|eyes|brows|nose|mouth|ears|piercing)(_|$)/.test(nodeName);
}

/** A source coordinate folded back into [0, size) by a glTF wrap mode. */
export function wrapTexel(i, size, wrap) {
  if (wrap === REPEAT) return ((i % size) + size) % size;
  if (wrap === MIRRORED_REPEAT) {
    const period = 2 * size;
    const m = ((i % period) + period) % period;
    return m < size ? m : period - 1 - m;
  }
  return Math.min(size - 1, Math.max(0, i));
}

/**
 * The texel rectangle a cell copies for UV bounds [lo, hi] on one axis of a `size` texel source:
 * the texels the bounds touch plus the margin, opened out to the source's block grid on both
 * ends (so the crop starts on a block and spans whole blocks). Returns its origin and length;
 * the origin may be negative or the end past `size` when a UV leaves the square (the copy then
 * reads through the wrap mode).
 */
export function cropSpan(lo, hi, size) {
  const b = HEAD_ATLAS_BLOCK;
  const first = Math.floor(lo * size) - HEAD_ATLAS_MARGIN;
  const last = Math.ceil(hi * size) + HEAD_ATLAS_MARGIN;
  const origin = Math.floor(first / b) * b;
  const end = Math.ceil(last / b) * b;
  return { origin, length: Math.max(b, end - origin) };
}

/**
 * MaxRects (best short side fit) packing of `rects` ({w, h}, already including their gutters)
 * into a W x H bin. Returns each rect's origin in input order, or null when they do not fit.
 * Deterministic: ties break on input order.
 */
export function packRects(rects, W, H) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const order = rects
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
  const placed = new Array(rects.length);
  for (const r of order) {
    let best = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const f of free) {
      if (f.w < r.w || f.h < r.h) continue;
      const short = Math.min(f.w - r.w, f.h - r.h);
      const long = Math.max(f.w - r.w, f.h - r.h);
      if (
        short < bestShort ||
        (short === bestShort && long < bestLong) ||
        (short === bestShort &&
          long === bestLong &&
          best &&
          (f.y < best.y || (f.y === best.y && f.x < best.x)))
      ) {
        best = f;
        bestShort = short;
        bestLong = long;
      }
    }
    if (!best) return null;
    const p = { x: best.x, y: best.y, w: r.w, h: r.h };
    placed[r.i] = { x: p.x, y: p.y };
    const next = [];
    for (const f of free) {
      if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) {
        next.push(f);
        continue;
      }
      if (p.x > f.x) next.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
      if (p.x + p.w < f.x + f.w) {
        next.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - p.x - p.w, h: f.h });
      }
      if (p.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
      if (p.y + p.h < f.y + f.h) {
        next.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - p.y - p.h });
      }
    }
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
  return placed;
}

/** The smallest bin (by area, then the squarer one) on the SIDE_STEP grid that packs `rects`. */
export function smallestBin(rects) {
  const minW = Math.max(...rects.map((r) => r.w));
  const minH = Math.max(...rects.map((r) => r.h));
  const area = rects.reduce((a, r) => a + r.w * r.h, 0);
  const candidates = [];
  for (let W = Math.ceil(minW / SIDE_STEP) * SIDE_STEP; W <= MAX_SIDE; W += SIDE_STEP) {
    for (let H = Math.ceil(minH / SIDE_STEP) * SIDE_STEP; H <= MAX_SIDE; H += SIDE_STEP) {
      if (W * H >= area) candidates.push([W, H]);
    }
  }
  candidates.sort(
    (a, b) =>
      a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]) || a[0] - b[0],
  );
  for (const [W, H] of candidates) {
    const placed = packRects(rects, W, H);
    if (placed) return { W, H, placed };
  }
  return null;
}

/** Copy a (w x h) rectangle at (x0, y0) of an RGBA source, read through its wrap modes, into an
 *  opaque RGBA buffer (the atlas is opaque: every core material is OPAQUE, so a source's alpha
 *  never reached a pixel; its colour is copied as it stands). */
function copyWrapped(raw, W, H, x0, y0, w, h, wrapS, wrapT) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = wrapTexel(y0 + y, H, wrapT);
    for (let x = 0; x < w; x++) {
      const sx = wrapTexel(x0 + x, W, wrapS);
      const s = (sy * W + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = raw[s];
      out[d + 1] = raw[s + 1];
      out[d + 2] = raw[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

// --- the atlas's own mip levels --------------------------------------------------------------

/** 8 bit sRGB to linear light and back: a level is averaged in linear light, as the encoder's
 *  own generator averages and as the GPU filters an sRGB texture. */
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb8(v) {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}

/** The sizes of a W x H texture's levels, level 0 first, down to 1 x 1 (each side halves and
 *  rounds down, never under 1: the chain the GPU and the KTX2 container both expect). */
export function headAtlasLevelSizes(W, H) {
  const out = [[W, H]];
  for (let k = 1; W >> k > 0 || H >> k > 0; k++) {
    out.push([Math.max(1, W >> k), Math.max(1, H >> k)]);
  }
  return out;
}

/** How far from a triangle an atlas pixel still counts as read by it, in texels. The pixel
 *  centre nearest to any point of a triangle is within 0.71 of it; the rest is room for a uv
 *  the rasterizer extrapolates just past a triangle's edge. */
const READ_REACH = 1.5;

/**
 * Which atlas pixels the pieces READ: `cellTriangles[c]` lists cell c's uv triangles, six
 * numbers each (three corners, in atlas pixels). Returns a W x H map, row major: for every
 * pixel whose centre lies within READ_REACH of a triangle, that triangle's cell index + 1;
 * 0 where no triangle comes (the gutters, the bin's unused space, and the parts of a cell no
 * uv island reaches).
 */
export function headAtlasCoverage(W, H, cellTriangles) {
  if (cellTriangles.length > 255) throw new Error('head atlas: more than 255 cells');
  const cover = new Uint8Array(W * H);
  cellTriangles.forEach((triangles, c) => {
    for (let t = 0; t + 5 < triangles.length; t += 6) {
      const xs = [triangles[t], triangles[t + 2], triangles[t + 4]];
      const ys = [triangles[t + 1], triangles[t + 3], triangles[t + 5]];
      // each edge as a line with its normal pointing at the third corner: a pixel is in reach
      // when it is no further than READ_REACH outside any of the three (an edge of no length,
      // or a triangle of no area, leaves the box below to bound it)
      const edges = [];
      for (let e = 0; e < 3; e++) {
        const [i, j, k] = [e, (e + 1) % 3, (e + 2) % 3];
        let nx = ys[i] - ys[j];
        let ny = xs[j] - xs[i];
        const length = Math.hypot(nx, ny);
        if (!(length > 0)) continue;
        const side = Math.sign(nx * (xs[k] - xs[i]) + ny * (ys[k] - ys[i])) || 1;
        nx *= side / length;
        ny *= side / length;
        edges.push([nx, ny, -(nx * xs[i] + ny * ys[i])]);
      }
      // the pixels whose CENTRE is within reach of the triangle's box, across and down
      const x0 = Math.max(0, Math.ceil(Math.min(...xs) - READ_REACH - 0.5));
      const x1 = Math.min(W - 1, Math.floor(Math.max(...xs) + READ_REACH - 0.5));
      const y0 = Math.max(0, Math.ceil(Math.min(...ys) - READ_REACH - 0.5));
      const y1 = Math.min(H - 1, Math.floor(Math.max(...ys) + READ_REACH - 0.5));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (edges.every(([nx, ny, d]) => nx * (x + 0.5) + ny * (y + 0.5) + d >= -READ_REACH)) {
            cover[y * W + x] = c + 1;
          }
        }
      }
    }
  });
  return cover;
}

/**
 * Which cell every texel of a Wk x Hk level of a W x H atlas stands for. A texel covers the
 * rectangle of level 0 its uv range covers ([i W / Wk, (i + 1) W / Wk) across, the same down:
 * a 2^k block only while the atlas side divides by 2^k). `rects` are the cells with their
 * gutters, in atlas pixels, and `cover` (headAtlasCoverage, optional) the pixels each reads.
 *  - A texel belongs to the cell that READS it: every pixel a cell's triangles cover leans on
 *    the four texels a bilinear tap at its centre takes, by the tap's own weights, and the
 *    cell with at least half of what leans on a texel has it whole (an even split goes to
 *    the first). From level 4 two cells' uvs can both reach the texel on the edge between
 *    them; by what merely lies under it, a cell could lose its whole rim to neighbours whose
 *    islands never come near (measured on Type B at level 5: worse than the encoder's levels
 *    for a brow and three eyelids, 9 % of the brow more than 16 of 255 off against 4 %).
 *  - A texel nobody reads goes by what lies UNDER it, the same way: the cell that holds at
 *    least half of what it covers of the cells; over no cell at all (the bin's unused
 *    space), the NEAREST cell, so a tap that strays past a cell's edge still reads that
 *    cell's colours, never black.
 *  - A texel no cell has half of (the last levels, where one texel spans several cells) is
 *    the mix of its cells, each by its share. One of them alone would hand every other cell
 *    there a colour that is not its own (measured on Type A: at the 3 x 1 level the ears
 *    read the eyeball's colour).
 * Returns `owner` (a cell index per texel, row major, or -1 for a mixed one) and `mixed` (the
 * [cell index, share] lists of the mixed texels, by texel index; shares sum to 1).
 */
export function headAtlasTexelCells(W, H, Wk, Hk, rects, cover = null) {
  const n = Wk * Hk;
  const owner = new Int32Array(n);
  const mixed = new Map();
  // what leans on each texel, per cell: the transpose of the bilinear tap (clamped at the
  // atlas's edge, as its sampler is)
  let reads = null;
  if (cover) {
    reads = new Float32Array(rects.length * n);
    for (let y = 0; y < H; y++) {
      const ty = ((y + 0.5) * Hk) / H - 0.5;
      const fy = ty - Math.floor(ty);
      const ja = Math.min(Hk - 1, Math.max(0, Math.floor(ty)));
      const jb = Math.min(Hk - 1, Math.max(0, Math.floor(ty) + 1));
      for (let x = 0; x < W; x++) {
        const cell = cover[y * W + x] - 1;
        if (cell < 0) continue;
        const tx = ((x + 0.5) * Wk) / W - 0.5;
        const fx = tx - Math.floor(tx);
        const ia = Math.min(Wk - 1, Math.max(0, Math.floor(tx)));
        const ib = Math.min(Wk - 1, Math.max(0, Math.floor(tx) + 1));
        reads[cell * n + ja * Wk + ia] += (1 - fx) * (1 - fy);
        reads[cell * n + ja * Wk + ib] += fx * (1 - fy);
        reads[cell * n + jb * Wk + ia] += (1 - fx) * fy;
        reads[cell * n + jb * Wk + ib] += fx * fy;
      }
    }
  }
  const share = new Float64Array(rects.length);
  for (let j = 0; j < Hk; j++) {
    const y0 = (j * H) / Hk;
    const y1 = ((j + 1) * H) / Hk;
    for (let i = 0; i < Wk; i++) {
      const x0 = (i * W) / Wk;
      const x1 = ((i + 1) * W) / Wk;
      const t = j * Wk + i;
      let total = 0;
      if (reads) {
        for (let c = 0; c < rects.length; c++) {
          share[c] = reads[c * n + t];
          total += share[c];
        }
      }
      if (!(total > 0)) {
        // nobody reads it: what lies under it
        total = 0;
        for (let c = 0; c < rects.length; c++) {
          const r = rects[c];
          const w = Math.min(x1, r.x + r.w) - Math.max(x0, r.x);
          const h = Math.min(y1, r.y + r.h) - Math.max(y0, r.y);
          share[c] = w > 0 && h > 0 ? w * h : 0;
          total += share[c];
        }
      }
      let best = -1;
      for (let c = 0; c < rects.length; c++) {
        if (share[c] > 0 && (best < 0 || share[c] > share[best])) best = c;
      }
      if (best < 0) {
        // nothing under it either: the nearest cell to its centre (the first of equals)
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        let near = Infinity;
        for (let c = 0; c < rects.length; c++) {
          const r = rects[c];
          const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w));
          const dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
          if (dx * dx + dy * dy < near) {
            near = dx * dx + dy * dy;
            best = c;
          }
        }
        owner[t] = best;
      } else if (share[best] * 2 >= total) {
        owner[t] = best;
      } else {
        owner[t] = -1;
        const list = [];
        for (let c = 0; c < rects.length; c++) if (share[c] > 0) list.push([c, share[c] / total]);
        mixed.set(t, list);
      }
    }
  }
  return { owner, mixed };
}

/** The area average (linear light) of ONE cell's own source over the rectangle
 *  [x0, x1) x [y0, y1) of the atlas, read through the source's wrap modes: past the cell the
 *  source carries on as its own sampler would have carried it on, so the average takes in the
 *  source's own surroundings exactly as the source's own chain took them in. */
function cellMean(cell, plane, x0, x1, y0, y1, out) {
  if (!plane) {
    out[0] = out[1] = out[2] = 1;
    return;
  }
  const { width, height, wrapS, wrapT } = cell.source;
  let r = 0;
  let g = 0;
  let b = 0;
  let area = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const rows = Math.min(y1, y + 1) - Math.max(y0, y);
    const row = wrapTexel(y - cell.at[1], height, wrapT) * width;
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const weight = rows * (Math.min(x1, x + 1) - Math.max(x0, x));
      const s = (row + wrapTexel(x - cell.at[0], width, wrapS)) * 3;
      r += plane[s] * weight;
      g += plane[s + 1] * weight;
      b += plane[s + 2] * weight;
      area += weight;
    }
  }
  out[0] = r / area;
  out[1] = g / area;
  out[2] = b / area;
}

/**
 * The levels of a W x H atlas BELOW level 0, built per cell. `cells` are the atlas's cells:
 * `rect` (the cell with its gutter, in atlas pixels), `source` (its RGBA image, row major from
 * the top, with its size and wrap modes; null for a flat white cell) and `at` (the atlas pixel
 * its source texel (0, 0) sits on); `cover` (headAtlasCoverage, optional) says which pixels
 * each cell's pieces read. Every texel takes the cell headAtlasTexelCells gives it and holds
 * the average of that cell's SOURCE over the texel's own footprint (cellMean), opaque. The average is a plain box in linear light, what a GPU's own mip generator
 * computes: it cannot ring, so a texel never leaves the range of the texels it averages. The
 * encoder's generator is a sharper lanczos; against its levels, inside the cells and before
 * encoding, these measure 48 to 50 dB at level 1 and 44 to 47 dB at level 2 (2026-10-02),
 * under what the encoding itself loses. Returns [{ width, height, data }] from level 1 down
 * to 1 x 1, data RGBA.
 */
export function headAtlasMipLevels(W, H, cells, cover = null) {
  const sizes = headAtlasLevelSizes(W, H);
  const rects = cells.map((c) => c.rect);
  const planes = cells.map((c) => {
    if (!c.source) return null;
    const { data, width, height } = c.source;
    const plane = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      plane[i * 3] = SRGB_TO_LINEAR[data[i * 4]];
      plane[i * 3 + 1] = SRGB_TO_LINEAR[data[i * 4 + 1]];
      plane[i * 3 + 2] = SRGB_TO_LINEAR[data[i * 4 + 2]];
    }
    return plane;
  });
  const one = [0, 0, 0];
  const levels = [];
  for (let k = 1; k < sizes.length; k++) {
    const [Wk, Hk] = sizes[k];
    const { owner, mixed } = headAtlasTexelCells(W, H, Wk, Hk, rects, cover);
    const data = Buffer.alloc(Wk * Hk * 4, 255);
    for (let j = 0; j < Hk; j++) {
      const y0 = (j * H) / Hk;
      const y1 = ((j + 1) * H) / Hk;
      for (let i = 0; i < Wk; i++) {
        const x0 = (i * W) / Wk;
        const x1 = ((i + 1) * W) / Wk;
        const t = j * Wk + i;
        let r = 0;
        let g = 0;
        let b = 0;
        if (owner[t] >= 0) {
          cellMean(cells[owner[t]], planes[owner[t]], x0, x1, y0, y1, one);
          [r, g, b] = one;
        } else {
          for (const [c, part] of mixed.get(t)) {
            cellMean(cells[c], planes[c], x0, x1, y0, y1, one);
            r += one[0] * part;
            g += one[1] * part;
            b += one[2] * part;
          }
        }
        data[t * 4] = linearToSrgb8(r);
        data[t * 4 + 1] = linearToSrgb8(g);
        data[t * 4 + 2] = linearToSrgb8(b);
      }
    }
    levels.push({ width: Wk, height: Hk, data });
  }
  return levels;
}

/** The level PNGs of every atlas atlasHeadCore built, by its texture: level 0 (the texture's
 *  own image) first. A side channel, not a property of the document: the levels are build
 *  input for the encoder (woc_head_pack_compress.mjs) and must never be written into a GLB. */
const LEVEL_PNGS = new WeakMap();

/** The level PNGs (level 0 first, down to 1 x 1) of an atlas texture atlasHeadCore built, or
 *  null for any other texture. */
export function headAtlasLevelPngs(texture) {
  return LEVEL_PNGS.get(texture) ?? null;
}

// --- the core's uv precision ------------------------------------------------------------------
//
// The pack's geometry is quantized as one (woc_head_pack_compress.mjs, gltf-transform's meshopt
// step), uvs to 12 bits of the unit square. On a source of its own that put a uv within a
// twentieth to an eighth of a texel of where it was authored; on the atlas the same 12 bits are
// a step of HALF a texel (2032 texels over 4095 steps), so a uv could land a quarter of a texel
// off and read that far from where it was authored. The core's uvs are therefore held out of
// that step and written at the full 16 bits their accessor stores anyway (a step of a thirty
// second of a texel on the widest atlas this builds), and nothing else in the pack is
// quantized any differently: a hairstyle's file stays byte for byte what it was.

/** Bits an atlas uv is stored at (a normalized unsigned 16 bit accessor, all of it used). */
export const HEAD_ATLAS_UV_BITS = 16;
/** The attribute an atlas uv rides under while the pack-wide quantization runs: a custom
 *  semantic is carried through a vertex reorder and left as it is by the quantizer. */
const UV_HOLD = '_WOC_ATLAS_UV';

/** The stored code of one atlas uv coordinate at HEAD_ATLAS_UV_BITS. Throws for a coordinate
 *  outside the atlas (the atlas never repeats: a uv past its edge reads nothing of its cell). */
export function headAtlasUvCode(u) {
  if (!(u >= 0 && u <= 1)) throw new Error(`head atlas: uv coordinate ${u} is outside the atlas`);
  return Math.round(u * (2 ** HEAD_ATLAS_UV_BITS - 1));
}

/**
 * Take every atlas uv out of the pack-wide quantization's reach: the TEXCOORD_0 of each
 * primitive that samples an atlas atlasHeadCore built moves to a custom attribute. Call it
 * after atlasHeadCore and before the quantizing transform, and releaseHeadAtlasUvs after it.
 * Returns the number of primitives held.
 */
export function holdHeadAtlasUvs(doc) {
  let held = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv || !LEVEL_PNGS.has(prim.getMaterial()?.getBaseColorTexture())) continue;
      prim.setAttribute('TEXCOORD_0', null).setAttribute(UV_HOLD, uv);
      held++;
    }
  }
  return held;
}

/**
 * Put the held atlas uvs back as TEXCOORD_0, written at HEAD_ATLAS_UV_BITS (headAtlasUvCode).
 * An accessor several primitives share is written once. Returns the number of primitives
 * released.
 */
export function releaseHeadAtlasUvs(doc) {
  const written = new Set();
  let released = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute(UV_HOLD);
      if (!uv) continue;
      prim.setAttribute(UV_HOLD, null).setAttribute('TEXCOORD_0', uv);
      released++;
      if (written.has(uv)) continue;
      written.add(uv);
      const el = [0, 0];
      const codes = new Uint16Array(uv.getCount() * 2);
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, el);
        codes[i * 2] = headAtlasUvCode(el[0]);
        codes[i * 2 + 1] = headAtlasUvCode(el[1]);
      }
      uv.setArray(codes).setNormalized(true);
    }
  }
  return released;
}

// --- the atlas step --------------------------------------------------------------------------

/** The first texture a material samples besides its colour: the slot's name (an extension's
 *  by the extension), or null when the colour is its only map. */
function otherTexture(mat) {
  if (mat.getNormalTexture()) return 'normal';
  if (mat.getOcclusionTexture()) return 'occlusion';
  if (mat.getEmissiveTexture()) return 'emissive';
  if (mat.getMetallicRoughnessTexture()) return 'metallic roughness';
  const graph = mat.getGraph();
  for (const ext of mat.listExtensions()) {
    if (graph.listChildren(ext).some((child) => child.propertyType === 'Texture')) {
      return ext.extensionName;
    }
  }
  return null;
}

/**
 * Atlas a head pack's core in place (a gltf-transform Document whose textures are still the
 * PNG masters). Returns a summary, or null when the pack has no textured core piece. The
 * atlas texture carries level 0; its other levels wait in headAtlasLevelPngs. Throws, before
 * it touches anything, on a core it cannot atlas faithfully.
 */
export async function atlasHeadCore(doc) {
  const root = doc.getRoot();
  // every source texture a core primitive samples, with the primitives (and materials) on it
  const sources = new Map();
  const uvSource = new Map();
  let type = null;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !isHeadCorePiece(node.getName())) continue;
    type ??= /^WocHead_([A-Z])_/.exec(node.getName())?.[1] ?? null;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      if (!mat || !tex) continue;
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) throw new Error(`head atlas: ${node.getName()} is textured but has no TEXCOORD_0`);
      // one accessor moves into one cell: it cannot serve pieces on two sources
      if ((uvSource.get(uv) ?? tex) !== tex) {
        throw new Error(
          `head atlas: ${node.getName()} shares a uv accessor with a piece on another texture`,
        );
      }
      uvSource.set(uv, tex);
      if (mat.getAlphaMode() !== 'OPAQUE') {
        throw new Error(
          `head atlas: ${mat.getName()} is ${mat.getAlphaMode()}, the atlas is opaque`,
        );
      }
      const info = mat.getBaseColorTextureInfo();
      if (info.getTexCoord() !== 0) {
        throw new Error(`head atlas: ${mat.getName()} samples TEXCOORD_${info.getTexCoord()}`);
      }
      // a cell is cut from the raw uvs and the uvs are moved into it: a texture transform would
      // go on being applied on top of the moved uvs, and sample somewhere else
      if (info.getExtension('KHR_texture_transform')) {
        throw new Error(
          `head atlas: ${mat.getName()} carries KHR_texture_transform, a cell is cut from the raw uvs`,
        );
      }
      // the uvs move into the atlas with the colour texture: any other map would stay behind
      const left = otherTexture(mat);
      if (left) {
        throw new Error(
          `head atlas: ${mat.getName()} carries a ${left} texture, only its colour moves into the atlas`,
        );
      }
      const e = sources.get(tex) ?? {
        tex,
        prims: [],
        mats: new Set(),
        wrapS: info.getWrapS(),
        wrapT: info.getWrapT(),
        lo: [Infinity, Infinity],
        hi: [-Infinity, -Infinity],
      };
      if (e.wrapS !== info.getWrapS() || e.wrapT !== info.getWrapT()) {
        throw new Error(`head atlas: ${tex.getName()} is sampled with two wrap modes`);
      }
      e.prims.push(prim);
      e.mats.add(mat);
      const el = [0, 0];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, el);
        e.lo[0] = Math.min(e.lo[0], el[0]);
        e.lo[1] = Math.min(e.lo[1], el[1]);
        e.hi[0] = Math.max(e.hi[0], el[0]);
        e.hi[1] = Math.max(e.hi[1], el[1]);
      }
      sources.set(tex, e);
    }
  }
  const list = [...sources.values()];
  if (list.length === 0) return null;
  // a core material must not be shared with a hair or beard piece (its texture would move), nor
  // a core uv accessor (its uvs would move, under a texture that does not)
  const coreMats = new Set(list.flatMap((e) => [...e.mats]));
  const coreUvs = new Set(list.flatMap((e) => e.prims.map((p) => p.getAttribute('TEXCOORD_0'))));
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || isHeadCorePiece(node.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      if (coreMats.has(prim.getMaterial())) {
        throw new Error(`head atlas: ${node.getName()} shares a core material`);
      }
      const attributes = [prim, ...prim.listTargets()].flatMap((p) => p.listAttributes());
      if (attributes.some((a) => coreUvs.has(a))) {
        throw new Error(`head atlas: ${node.getName()} shares a uv accessor with a core piece`);
      }
    }
  }

  const g = HEAD_ATLAS_GUTTER;
  for (const e of list) {
    const img = e.tex.getImage();
    if (!img || e.tex.getMimeType() !== 'image/png') {
      throw new Error(`head atlas: ${e.tex.getName()} is not a PNG master`);
    }
    const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    e.raw = data;
    e.W = info.width;
    e.H = info.height;
    const sx = cropSpan(e.lo[0], e.hi[0], e.W);
    const sy = cropSpan(e.lo[1], e.hi[1], e.H);
    e.crop = { x: sx.origin, y: sy.origin, w: sx.length, h: sy.length };
  }
  const rects = list.map((e) => ({ w: e.crop.w + 2 * g, h: e.crop.h + 2 * g }));
  rects.push({ w: WHITE_CELL + 2 * g, h: WHITE_CELL + 2 * g });
  const bin = smallestBin(rects);
  if (!bin) throw new Error('head atlas: the core textures do not fit one atlas');
  const { W, H, placed } = bin;

  const composites = [];
  list.forEach((e, i) => {
    e.cell = { x: placed[i].x + g, y: placed[i].y + g };
    composites.push({
      input: copyWrapped(
        e.raw,
        e.W,
        e.H,
        e.crop.x - g,
        e.crop.y - g,
        e.crop.w + 2 * g,
        e.crop.h + 2 * g,
        e.wrapS,
        e.wrapT,
      ),
      raw: { width: e.crop.w + 2 * g, height: e.crop.h + 2 * g, channels: 4 },
      left: placed[i].x,
      top: placed[i].y,
    });
  });
  const whiteAt = placed[list.length];
  const whiteSide = WHITE_CELL + 2 * g;
  composites.push({
    input: Buffer.alloc(whiteSide * whiteSide * 4, 255),
    raw: { width: whiteSide, height: whiteSide, channels: 4 },
    left: whiteAt.x,
    top: whiteAt.y,
  });
  const png = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
  // the levels below it, per cell (level 0 above is the composite, texel for texel)
  const levelCells = list.map((e, i) => ({
    rect: { x: placed[i].x, y: placed[i].y, w: e.crop.w + 2 * g, h: e.crop.h + 2 * g },
    source: { data: e.raw, width: e.W, height: e.H, wrapS: e.wrapS, wrapT: e.wrapT },
    at: [e.cell.x - e.crop.x, e.cell.y - e.crop.y],
  }));
  levelCells.push({
    rect: { x: whiteAt.x, y: whiteAt.y, w: whiteSide, h: whiteSide },
    source: null,
    at: [0, 0],
  });
  // the pixels each cell's pieces read (their uv triangles, moved into the cell as the uvs
  // are below): a level's texel goes to the cell that reads it. Nothing reads the white cell
  // below level 0 (the header)
  const read = list.map((e) => {
    const corners = [];
    const uv = [0, 0];
    for (const prim of e.prims) {
      // a triangle list only (glTF mode 4): anything else is left to what lies under a texel
      if (prim.getMode() !== 4) continue;
      const acc = prim.getAttribute('TEXCOORD_0');
      const index = prim.getIndices();
      const count = index ? index.getCount() : acc.getCount();
      for (let i = 0; i + 2 < count; i += 3) {
        for (let v = i; v < i + 3; v++) {
          acc.getElement(index ? index.getScalar(v) : v, uv);
          corners.push(e.cell.x + (uv[0] * e.W - e.crop.x), e.cell.y + (uv[1] * e.H - e.crop.y));
        }
      }
    }
    return corners;
  });
  const cover = headAtlasCoverage(W, H, read);
  const levelPngs = [png];
  for (const level of headAtlasMipLevels(W, H, levelCells, cover)) {
    levelPngs.push(
      await sharp(level.data, { raw: { width: level.width, height: level.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }
  const name = `WocHead_${type ?? 'X'}_core_atlas`;
  // WOC_ATLAS_DUMP=<dir>: write the composed atlas and its levels out for a look (review aid,
  // off by default)
  const dump = process.env.WOC_ATLAS_DUMP;
  if (dump) {
    const fs = await import('node:fs');
    fs.mkdirSync(dump, { recursive: true });
    fs.writeFileSync(`${dump}/${name}.png`, png);
    levelPngs.forEach((level, k) => {
      if (k > 0) fs.writeFileSync(`${dump}/${name}.level${k}.png`, level);
    });
  }
  const atlas = doc
    .createTexture(name)
    .setImage(new Uint8Array(png))
    .setMimeType('image/png')
    .setURI(`${name}.png`);
  LEVEL_PNGS.set(
    atlas,
    levelPngs.map((level) => new Uint8Array(level)),
  );

  // remap every textured core primitive's UVs into its cell (an accessor two primitives share
  // is remapped once)
  const done = new Set();
  for (const e of list) {
    for (const prim of e.prims) {
      const acc = prim.getAttribute('TEXCOORD_0');
      if (done.has(acc)) continue;
      done.add(acc);
      const uv = [0, 0];
      const out = new Float32Array(acc.getCount() * 2);
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, uv);
        out[i * 2] = (e.cell.x + (uv[0] * e.W - e.crop.x)) / W;
        out[i * 2 + 1] = (e.cell.y + (uv[1] * e.H - e.crop.y)) / H;
      }
      acc.setArray(out).setNormalized(false);
    }
  }
  const white = [(whiteAt.x + g + WHITE_CELL / 2) / W, (whiteAt.y + g + WHITE_CELL / 2) / H];
  for (const mat of coreMats) {
    mat.setBaseColorTexture(atlas);
    mat.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);
    mat.setExtras({ ...mat.getExtras(), wocHeadAtlas: { white } });
  }
  // the untextured core materials record the white cell too: a merged face maps them onto it
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !isHeadCorePiece(node.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat && !coreMats.has(mat)) mat.setExtras({ ...mat.getExtras(), wocHeadAtlas: { white } });
    }
  }
  const summary = {
    atlas: name,
    size: [W, H],
    levels: headAtlasLevelSizes(W, H),
    white,
    sources: list.length,
    materials: coreMats.size,
    cells: list.map((e) => ({
      texture: e.tex.getName(),
      source: [e.W, e.H],
      crop: [e.crop.x, e.crop.y, e.crop.w, e.crop.h],
      at: [e.cell.x, e.cell.y],
    })),
  };
  // the sources no material samples any more (only the document root still holds them)
  for (const e of list) {
    if (e.tex.listParents().every((p) => p === root)) e.tex.dispose();
  }
  return summary;
}
