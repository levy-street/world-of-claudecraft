// Procedural detail textures for authored open-air fields: worn flagstones,
// grave soil, jungle moss over loam, wet basalt column tops and cliff rock,
// each an albedo multiplier (tinted by the vertex paint) plus a matching
// normal map baked from the same height field, so the stone reads carved
// under a raking light. Built once per page and shared by
// every field (markSharedTexture semantics via the material cache).
//
// Deterministic: a local LCG, never Math.random.

import * as THREE from 'three';

type Painter = (height: Float32Array, size: number, rnd: () => number) => void;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function blurWrap(src: Float32Array, size: number, radius: number): Float32Array {
  const out = new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[y * size + ((x + k + size) % size)];
      tmp[y * size + x] = s / (radius * 2 + 1);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[((y + k + size) % size) * size + x];
      out[y * size + x] = s / (radius * 2 + 1);
    }
  }
  return out;
}

function noiseField(size: number, rnd: () => number, cells: number): Float32Array {
  // Tileable value noise: a random lattice sampled with smooth interpolation.
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) =>
        lattice[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

/** Irregular flagstones: slabs of varied tone with sunken, gritty joints. */
const paintFlagstone: Painter = (h, size, rnd) => {
  const rows = 4;
  const slab = size / rows;
  const tone = new Float32Array(size * size);
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * slab * 0.5 + rnd() * slab * 0.2;
    const widths: number[] = [];
    let total = 0;
    while (total < size) {
      const w = slab * (0.7 + rnd() * 0.8);
      widths.push(w);
      total += w;
    }
    const scale = size / total;
    let x0 = offset;
    for (const w0 of widths) {
      const w = w0 * scale;
      const t = 0.55 + rnd() * 0.35;
      for (let y = Math.floor(r * slab); y < Math.floor((r + 1) * slab); y++) {
        for (let xi = Math.floor(x0); xi < Math.floor(x0 + w); xi++) {
          const x = ((xi % size) + size) % size;
          const ex = Math.min(xi - x0, x0 + w - xi);
          const ey = Math.min(y - r * slab, (r + 1) * slab - y);
          const edge = Math.min(ex, ey);
          const joint = edge < 2 ? 0.12 : edge < 4 ? 0.45 + t * 0.3 : t;
          tone[y * size + x] = joint;
        }
      }
      x0 += w;
    }
  }
  const grain = noiseField(size, rnd, 32);
  const broad = noiseField(size, rnd, 6);
  for (let i = 0; i < h.length; i++) {
    h[i] = tone[i] * (0.82 + grain[i] * 0.22) + (broad[i] - 0.5) * 0.12;
  }
  // Chips and cracks: a few dark scratches per slab row.
  for (let k = 0; k < 90; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    const a = rnd() * Math.PI * 2;
    const len = 6 + rnd() * 22;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a + (rnd() - 0.5) * 0.8);
      y += Math.sin(a + (rnd() - 0.5) * 0.8);
      const i =
        (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
      h[i] *= 0.55;
    }
  }
};

/** Grave soil: clods, pebbles and root litter. */
const paintSoil: Painter = (h, size, rnd) => {
  const a = noiseField(size, rnd, 8);
  const b = noiseField(size, rnd, 24);
  const c = noiseField(size, rnd, 64);
  for (let i = 0; i < h.length; i++) h[i] = 0.35 + a[i] * 0.25 + b[i] * 0.25 + c[i] * 0.2;
  for (let k = 0; k < 420; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = 1 + rnd() * 3.2;
    const lift = 0.15 + rnd() * 0.3;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const i =
          (((Math.floor(cy + y) % size) + size) % size) * size +
          (((Math.floor(cx + x) % size) + size) % size);
        h[i] += lift * (1 - d / r);
      }
    }
  }
};

/** Cliff rock: fractured faces (tileable Worley cells with dark cracks) and pitting. */
const paintRock: Painter = (h, size, rnd) => {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 46; i++) pts.push([rnd() * size, rnd() * size, 0.55 + rnd() * 0.45]);
  const b = noiseField(size, rnd, 17);
  const c = noiseField(size, rnd, 48);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let tone = 0.7;
      for (const [px, py, t] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, size - dx);
        dy = Math.min(dy, size - dy);
        // Stretched cells: the rock fractures in slabs.
        const d = Math.hypot(dx * 0.7, dy * 1.25);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = t;
        } else if (d < d2) d2 = d;
      }
      const crack = Math.min(1, (d2 - d1) / 3.5);
      const i = y * size + x;
      h[i] = (0.25 + tone * 0.45 + b[i] * 0.2 + c[i] * 0.12) * (0.25 + 0.75 * crack) + d1 * 0.002;
    }
  }
};

/** Jungle loam under moss: soft cushions of moss over dark loam, with leaf
 *  litter and root threads between the clumps. */
const paintMoss: Painter = (h, size, rnd) => {
  const broad = noiseField(size, rnd, 5);
  const clumps = noiseField(size, rnd, 22);
  const fine = noiseField(size, rnd, 80);
  for (let i = 0; i < h.length; i++) {
    // Moss cushions swell where the clump field is high; loam sinks between.
    const cushion = Math.max(0, clumps[i] - 0.42) * 1.9;
    h[i] = 0.32 + broad[i] * 0.2 + cushion * 0.34 + fine[i] * 0.06;
  }
  // Leaf litter: small flat ovals pressed into the loam.
  for (let k = 0; k < 70; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const a = rnd() * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 2 + rnd() * 3.5;
    for (let y = -5; y <= 5; y++) {
      for (let x = -5; x <= 5; x++) {
        const u = (x * ca + y * sa) / len;
        const v = (-x * sa + y * ca) / (len * 0.45);
        if (u * u + v * v > 1) continue;
        const i =
          (((Math.floor(cy + y) % size) + size) % size) * size +
          (((Math.floor(cx + x) % size) + size) % size);
        h[i] = h[i] * 0.75 + 0.18;
      }
    }
  }
  // Root threads: thin raised lines wandering across.
  for (let k = 0; k < 9; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = 30 + rnd() * 70;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.35;
      x += Math.cos(a);
      y += Math.sin(a);
      const i =
        (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
      h[i] += 0.12;
    }
  }
};

/** Wet basalt: the tops of hexagonal columns, each a slab of its own tone
 *  with dark sunken joints, fine pitting and a polished wet sheen. */
const paintBasalt: Painter = (h, size, rnd) => {
  // A tileable hex lattice: cells of 4 across the tile, jittered.
  const cols = 4;
  const rows = 4;
  const pts: [number, number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const ox = (q + (r % 2) * 0.5 + (rnd() - 0.5) * 0.25) * (size / cols);
      const oy = (r + (rnd() - 0.5) * 0.25) * (size / rows);
      pts.push([ox, oy, 0.5 + rnd() * 0.4]);
    }
  }
  const grain = noiseField(size, rnd, 64);
  const broad = noiseField(size, rnd, 7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let tone = 0.6;
      for (const [px, py, t] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, size - dx);
        dy = Math.min(dy, size - dy);
        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = t;
        } else if (d < d2) d2 = d;
      }
      const joint = Math.min(1, (d2 - d1) / 4);
      const i = y * size + x;
      // A slight dome on each column top, darker grout in the joints.
      const dome = Math.max(0, 1 - d1 / (size / cols)) * 0.12;
      h[i] = (tone + dome + grain[i] * 0.12 + (broad[i] - 0.5) * 0.1) * (0.18 + 0.82 * joint);
    }
  }
};

/** Riveted steel deck plate (a steel-works floor): four plates to the
 *  tile, each with a diamond tread, sunken weld seams, a rivet row along every
 *  edge, and scuffs where boots and carts wear it. */
const paintPlate: Painter = (h, size, rnd) => {
  const cells = 2;
  const cell = size / cells;
  const tone: number[] = [];
  for (let i = 0; i < cells * cells; i++) tone.push(0.56 + rnd() * 0.16);
  const grain = noiseField(size, rnd, 40);
  const broad = noiseField(size, rnd, 5);
  const tread = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = x - cx * cell;
      const ly = y - cy * cell;
      const edge = Math.min(lx, ly, cell - 1 - lx, cell - 1 - ly);
      let v =
        tone[cy * cells + cx] +
        (grain[y * size + x] - 0.5) * 0.08 +
        (broad[y * size + x] - 0.5) * 0.08;
      // The diamond tread: short raised lozenges, alternating diagonals.
      if (edge > 6) {
        const ty = Math.floor(ly / tread);
        const tx = Math.floor(lx / tread);
        const fx = lx / tread - tx - 0.5;
        const fy = ly / tread - ty - 0.5;
        const flip = (tx + ty) % 2 === 0 ? 1 : -1;
        const u = (fx + fy * flip) * Math.SQRT1_2;
        const w = (fx - fy * flip) * Math.SQRT1_2;
        if (Math.abs(u) < 0.32 && Math.abs(w) < 0.08) v += 0.13;
      }
      // Sunken weld seams between the plates.
      if (edge < 2) v = 0.18 + edge * 0.08;
      h[y * size + x] = v;
    }
  }
  // Rivets: a row of domes a few pixels in from every plate edge.
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const x0 = cx * cell;
      const y0 = cy * cell;
      for (let t = 6; t < cell - 3; t += 12) {
        for (const [rx, ry] of [
          [x0 + t, y0 + 5],
          [x0 + t, y0 + cell - 6],
          [x0 + 5, y0 + t],
          [x0 + cell - 6, y0 + t],
        ]) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const d = Math.hypot(dx, dy);
              if (d > 2.3) continue;
              const i = ((ry + dy + size) % size) * size + ((rx + dx + size) % size);
              h[i] = Math.max(h[i], 0.78 - d * 0.1);
            }
          }
        }
      }
    }
  }
  // Scuffs and gouges.
  for (let k = 0; k < 60; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    const a = rnd() * Math.PI * 2;
    const len = 5 + rnd() * 18;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a);
      y += Math.sin(a);
      const i =
        (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
      h[i] *= 0.82;
    }
  }
};

/** Catwalk bar grating: load bars along the tile, cross rods every few
 *  inches, the dark drop showing through every gap. */
const paintGrating: Painter = (h, size, rnd) => {
  const pitch = 8;
  const cross = 32;
  const grain = noiseField(size, rnd, 48);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bar = x % pitch < 3;
      const rod = y % cross < 2;
      let v = 0.04;
      if (bar) v = 0.62 + (x % pitch === 1 ? 0.12 : 0) + (grain[y * size + x] - 0.5) * 0.12;
      else if (rod) v = 0.5 + (grain[y * size + x] - 0.5) * 0.1;
      // A frame band every tile edge (the panel's own border).
      if (y % (size / 2) < 3) v = 0.58 + (grain[y * size + x] - 0.5) * 0.08;
      h[y * size + x] = v;
    }
  }
};

/** Wrapped index of a (possibly fractional, possibly negative) pixel. */
function wrapAt(x: number, y: number, size: number): number {
  return (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
}

/** Wind-packed snow (the Gravewyrm Sanctum): sastrugi, the sharp-prowed
 *  wind ridges all running one way, a soft broad swell under them, scoured
 *  flats of harder crust between, and a fine matte grain (no sparkle). */
const paintSnow: Painter = (h, size, rnd) => {
  const swell = noiseField(size, rnd, 4);
  const grain = noiseField(size, rnd, 72);
  const warp = noiseField(size, rnd, 6);
  for (let i = 0; i < h.length; i++) h[i] = 0.5 + (swell[i] - 0.5) * 0.25 + (grain[i] - 0.5) * 0.06;
  // The ridges: long low drifts along x, each with a gentle windward rise
  // and a steep lee drop, their crests wandering on the warp field.
  for (let k = 0; k < 46; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const len = size * (0.12 + rnd() * 0.28);
    const amp = 0.08 + rnd() * 0.16;
    const wide = 3 + rnd() * 5;
    for (let s = -len / 2; s < len / 2; s++) {
      const fall = Math.cos((s / len) * Math.PI);
      const x = cx + s;
      const bend = (warp[wrapAt(x, cy, size)] - 0.5) * 18;
      for (let d = -wide * 2; d <= wide * 0.6; d++) {
        // Windward (negative d) a long slope, lee a short cliff.
        const prof = d < 0 ? 1 + d / (wide * 2) : 1 - d / (wide * 0.6);
        if (prof <= 0) continue;
        h[wrapAt(x, cy + bend + d, size)] += amp * fall * prof ** 1.4;
      }
    }
  }
  // Scoured flats: smoothed patches pressed a little lower.
  const flat = noiseField(size, rnd, 9);
  for (let i = 0; i < h.length; i++) {
    const f = Math.max(0, flat[i] - 0.62) * 2.2;
    h[i] = h[i] * (1 - f * 0.5) + 0.45 * f * 0.5;
  }
};

/** Glacier and lake ice: cloudy depth, pale planes of trapped bubbles,
 *  long hairline cracks (fresh fractures read white) and the faint frost
 *  bloom round them; low relief so it never turns to a polished mirror. */
const paintIce: Painter = (h, size, rnd) => {
  const cloud = noiseField(size, rnd, 5);
  const mid = noiseField(size, rnd, 14);
  const grain = noiseField(size, rnd, 60);
  for (let i = 0; i < h.length; i++) {
    h[i] = 0.42 + (cloud[i] - 0.5) * 0.32 + (mid[i] - 0.5) * 0.14 + (grain[i] - 0.5) * 0.05;
  }
  // Bubble planes: clusters of small pale specks.
  for (let k = 0; k < 40; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const spread = 6 + rnd() * 16;
    for (let b = 0; b < 26; b++) {
      const x = cx + (rnd() - 0.5) * spread * 2;
      const y = cy + (rnd() - 0.5) * spread;
      const r = 0.6 + rnd() * 1.4;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          h[wrapAt(x + dx, y + dy, size)] += 0.1 * (1 - d / r);
        }
    }
  }
  // Hairline cracks: long wandering polylines, a bright core and a soft halo.
  for (let k = 0; k < 22; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = 40 + rnd() * 120;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.35;
      x += Math.cos(a);
      y += Math.sin(a);
      h[wrapAt(x, y, size)] += 0.28;
      h[wrapAt(x + 1, y, size)] += 0.06;
      h[wrapAt(x, y + 1, size)] += 0.06;
      // A short branch now and then.
      if (rnd() < 0.03) {
        let bx = x;
        let by = y;
        const ba = a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.8);
        const bl = 6 + rnd() * 18;
        for (let t = 0; t < bl; t++) {
          bx += Math.cos(ba);
          by += Math.sin(ba);
          h[wrapAt(bx, by, size)] += 0.16;
        }
      }
    }
  }
};

/** A colour painter: fills the height field AND a linear rgb albedo
 *  multiplier per pixel (3 floats each), for families whose colour does not
 *  follow their relief (frost caught low in a seam reads pale, not dark). */
type ColorPainter = (
  height: Float32Array,
  rgb: Float32Array,
  size: number,
  rnd: () => number,
) => void;

/** Thornpeak slate flags (the Gravewyrm Sanctum), one tile = 12 yd: cleaved
 *  plates of uneven size (about 1.5 to 4 yd: neighbouring cells of a
 *  jittered lattice fuse into one plate, split only by a faint hairline),
 *  each tilted a hair and its own tone (most a cold blue-grey, some greyer,
 *  some bluer, a rare rust stain), parted by chipped dark seams with frost
 *  and old snow packed into stretches of them, and a few pale quartz veins.
 *  Broad, low-frequency relief only: no fine line work to alias at range. */
const paintSlateFlags: ColorPainter = (h, rgb, size, rnd) => {
  const grid = 6;
  const cell = size / grid;
  const n = grid * grid;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const group = new Int32Array(n);
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const k = j * grid + i;
      sx[k] = (i + 0.15 + rnd() * 0.7) * cell;
      sy[k] = (j + 0.15 + rnd() * 0.7) * cell;
      group[k] = k;
      // Fuse into the left or upper neighbour now and then: uneven plates.
      const fuse = rnd();
      if (fuse < 0.34 && i > 0) group[k] = group[k - 1];
      else if (fuse < 0.5 && j > 0) group[k] = group[k - grid];
    }
  }
  const tone = new Float32Array(n);
  const hue = new Float32Array(n * 3);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const pick = rnd();
    const hh: [number, number, number] =
      pick < 0.07
        ? [1.16, 1.0, 0.86] // a rust stain
        : pick < 0.4
          ? [1.06, 1.04, 0.98] // greyer
          : pick < 0.72
            ? [0.94, 0.98, 1.06] // bluer
            : [1, 1, 1];
    tone[k] = 0.74 + rnd() * 0.26;
    hue.set(hh, k * 3);
    gx[k] = (rnd() - 0.5) * 0.3;
    gy[k] = (rnd() - 0.5) * 0.3;
  }
  const soft = noiseField(size, rnd, 12);
  const chip = noiseField(size, rnd, 30);
  const frost = noiseField(size, rnd, 9);
  const mottle = noiseField(size, rnd, 4);
  const near = (x: number, y: number, k: number) => {
    let dx = Math.abs(x - sx[k]);
    let dy = Math.abs(y - sy[k]);
    dx = Math.min(dx, size - dx);
    dy = Math.min(dy, size - dy);
    return Math.hypot(dx, dy);
  };
  for (let y = 0; y < size; y++) {
    const cj = Math.floor(y / cell);
    for (let x = 0; x < size; x++) {
      const ci = Math.floor(x / cell);
      let f1 = Infinity;
      let f2 = Infinity;
      let k1 = 0;
      let k2 = 0;
      for (let oj = -2; oj <= 2; oj++) {
        for (let oi = -2; oi <= 2; oi++) {
          const k =
            ((((cj + oj) % grid) + grid) % grid) * grid + ((((ci + oi) % grid) + grid) % grid);
          const d = near(x, y, k);
          if (d < f1) {
            f2 = f1;
            k2 = k1;
            f1 = d;
            k1 = k;
          } else if (d < f2) {
            f2 = d;
            k2 = k;
          }
        }
      }
      const i = y * size + x;
      const g = group[k1];
      const same = group[k2] === g;
      const edge = (f2 - f1) * 0.5;
      // A plate edge: a chipped seam a few pixels wide; inside a fused plate
      // only a faint hairline.
      const w = same ? 1.4 : 2.5 + chip[i] * 6;
      const seam = edge < w ? 1 - edge / w : 0;
      let dx = x - sx[g];
      let dy = y - sy[g];
      if (dx > size / 2) dx -= size;
      if (dx < -size / 2) dx += size;
      if (dy > size / 2) dy -= size;
      if (dy < -size / 2) dy += size;
      const tilt = (dx * gx[g] + dy * gy[g]) / cell;
      const plate = 0.62 + tilt * 0.3 + (soft[i] - 0.5) * 0.12;
      h[i] = plate * (1 - seam * seam * (same ? 0.12 : 0.7));
      const t = tone[g] * (0.9 + mottle[i] * 0.2) * (!same && edge < w * 2 ? 0.93 : 1);
      let r = t * hue[g * 3];
      let gg = t * hue[g * 3 + 1];
      let bb = t * hue[g * 3 + 2];
      if (seam > 0) {
        const packed = !same && frost[i] > 0.62 ? Math.min(1, (frost[i] - 0.62) * 6) : 0;
        const dark = same ? 0.78 : 0.38;
        const k = seam ** 0.7 * (same ? 0.6 : 1);
        r += (dark + (1.5 - dark) * packed - r) * k;
        gg += (dark + (1.55 - dark) * packed - gg) * k;
        bb += (dark + (1.62 - dark) * packed - bb) * k;
      }
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = gg;
      rgb[i * 3 + 2] = bb;
    }
  }
  // Quartz veins: a few long pale wandering threads across the plates.
  for (let v = 0; v < 3; v++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = rnd() * Math.PI * 2;
    const len = size * (0.25 + rnd() * 0.35);
    for (let st = 0; st < len; st++) {
      ang += (rnd() - 0.5) * 0.12;
      x += Math.cos(ang);
      y += Math.sin(ang);
      for (const [ox, oy, k] of [
        [0, 0, 1],
        [1, 0, 0.5],
        [0, 1, 0.5],
      ] as const) {
        const i = wrapAt(x + ox, y + oy, size);
        rgb[i * 3] += (1.4 - rgb[i * 3]) * 0.6 * k;
        rgb[i * 3 + 1] += (1.43 - rgb[i * 3 + 1]) * 0.6 * k;
        rgb[i * 3 + 2] += (1.46 - rgb[i * 3 + 2]) * 0.6 * k;
      }
    }
  }
};

/** A glacier crevasse wall (the Gravewyrm Sanctum's cliff faces, one tile =
 *  20 yd square): broad vertical flutes and dished scallops a few yards
 *  wide where meltwater has run, a handful of wandering annual bands (pale
 *  and bubbly or dark and clear), large milky and clear zones, and a few
 *  sparse dark fissures. Low frequencies only: no regular fine striping. */
const paintGlacierWall: Painter = (h, size, rnd) => {
  const zones = noiseField(size, rnd, 3);
  const warp = noiseField(size, rnd, 4);
  const faint = noiseField(size, rnd, 40);
  for (let i = 0; i < h.length; i++) h[i] = 0.5 + (zones[i] - 0.5) * 0.36 + (faint[i] - 0.5) * 0.03;
  // Flutes: wide vertical troughs that wander, swell and fade along y.
  const flutes = 6 + Math.floor(rnd() * 3);
  for (let k = 0; k < flutes; k++) {
    const cx = rnd() * size;
    const w = size * (0.05 + rnd() * 0.07);
    const depth = 0.1 + rnd() * 0.12;
    const phase = rnd() * Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const shift = (warp[y * size + (Math.floor(cx) % size)] - 0.5) * w * 1.6;
      const fade = 0.55 + 0.45 * Math.sin((y / size) * Math.PI * 2 + phase);
      for (let x = Math.floor(cx - w * 1.5); x <= cx + w * 1.5; x++) {
        const d = Math.abs(x - cx - shift) / w;
        if (d >= 1) continue;
        const i = y * size + (((x % size) + size) % size);
        h[i] -= depth * fade * Math.cos(d * Math.PI * 0.5) ** 2;
      }
    }
  }
  // Scallops: shallow dished ovals, taller than wide.
  for (let k = 0; k < 18; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const rx = size * (0.03 + rnd() * 0.04);
    const ry = rx * (1.2 + rnd() * 0.8);
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d >= 1) continue;
        h[wrapAt(x, y, size)] -= 0.07 * (1 - d);
      }
    }
  }
  // Annual bands: a few wandering horizontal layers.
  const bands = 7 + Math.floor(rnd() * 3);
  for (let k = 0; k < bands; k++) {
    const cy = rnd() * size;
    const thick = 3 + rnd() * 12;
    const lift = rnd() < 0.55 ? 0.1 + rnd() * 0.08 : -(0.06 + rnd() * 0.06);
    const amp = 6 + rnd() * 18;
    const freq = 1 + Math.floor(rnd() * 3);
    const ph = rnd() * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const yc = cy + Math.sin((x / size) * Math.PI * 2 * freq + ph) * amp + (warp[x] - 0.5) * 10;
      for (let dy = -thick; dy <= thick; dy++) {
        const k2 = 1 - Math.abs(dy) / thick;
        h[wrapAt(x, yc + dy, size)] += lift * k2 * k2;
      }
    }
  }
  // Fissures: a few thin dark cracks, mostly running down the wall.
  for (let k = 0; k < 6; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let ang = Math.PI / 2 + (rnd() - 0.5) * 0.8;
    const len = size * (0.12 + rnd() * 0.25);
    for (let s = 0; s < len; s++) {
      ang += (rnd() - 0.5) * 0.25;
      x += Math.cos(ang);
      y += Math.sin(ang);
      h[wrapAt(x, y, size)] -= 0.22;
      h[wrapAt(x + 1, y, size)] -= 0.08;
    }
  }
};

interface DetailPair {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

const cache = new Map<string, DetailPair>();

function bake(
  key: string,
  painter: Painter,
  seed: number,
  size: number,
  relief: number,
  blur = 1,
  /** Albedo swing from the deepest to the highest point (out of 255). */
  contrast = 145,
): DetailPair {
  const cached = cache.get(key);
  if (cached) return cached;
  const rnd = lcg(seed);
  const raw = new Float32Array(size * size);
  painter(raw, size, rnd);
  const height = blurWrap(raw, size, blur);
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = size;
  const normal = document.createElement('canvas');
  normal.width = normal.height = size;
  const actx = albedo.getContext('2d');
  const nctx = normal.getContext('2d');
  if (!actx || !nctx) throw new Error('authored field texture canvas unavailable');
  const aimg = actx.createImageData(size, size);
  const nimg = nctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hv = Math.max(0, Math.min(1, height[i]));
      const v = Math.round(255 - contrast + hv * contrast);
      aimg.data[i * 4] = v;
      aimg.data[i * 4 + 1] = v;
      aimg.data[i * 4 + 2] = v;
      aimg.data[i * 4 + 3] = 255;
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      const nx = (l - r) * relief;
      const ny = (u - d) * relief;
      const len = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

/** `bake` for a colour painter: the albedo is the painter's rgb (a linear
 *  multiplier, stored sRGB), the normal map from its blurred height. */
function bakeColored(
  key: string,
  painter: ColorPainter,
  seed: number,
  size: number,
  relief: number,
  blur: number,
): DetailPair {
  const cached = cache.get(key);
  if (cached) return cached;
  const rnd = lcg(seed);
  const raw = new Float32Array(size * size);
  const rgb = new Float32Array(size * size * 3);
  painter(raw, rgb, size, rnd);
  const height = blurWrap(raw, size, blur);
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = size;
  const normal = document.createElement('canvas');
  normal.width = normal.height = size;
  const actx = albedo.getContext('2d');
  const nctx = normal.getContext('2d');
  if (!actx || !nctx) throw new Error('authored field texture canvas unavailable');
  const aimg = actx.createImageData(size, size);
  const nimg = nctx.createImageData(size, size);
  // The multiplier tops out at 1.6 (frost, quartz): stored at 1/1.6 so it
  // fits a byte; the vertex paint carries the family's value back up.
  const enc = (v: number) => Math.round(Math.max(0, Math.min(1, v / 1.6)) ** (1 / 2.2) * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      aimg.data[i * 4] = enc(rgb[i * 3]);
      aimg.data[i * 4 + 1] = enc(rgb[i * 3 + 1]);
      aimg.data[i * 4 + 2] = enc(rgb[i * 3 + 2]);
      aimg.data[i * 4 + 3] = 255;
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      const nx = (l - r) * relief;
      const ny = (u - d) * relief;
      const len = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

export function flagstoneDetail(): DetailPair {
  return bake('flagstone', paintFlagstone, 0x51a7, 256, 6);
}

export function soilDetail(): DetailPair {
  return bake('soil', paintSoil, 0x2c3d, 256, 5);
}

export function rockDetail(): DetailPair {
  return bake('rock', paintRock, 0x9e11, 256, 7);
}

/** Bedded mountain rock (a shelf cut into a mountain): level beds of
 *  uneven thickness, each its own tone, a dark parting between them, fine
 *  lamination and a slow warp so no bed runs dead straight. */
const paintStrata: Painter = (h, size, rnd) => {
  const fine = noiseField(size, rnd, 44);
  const broad = noiseField(size, rnd, 6);
  const bed = new Float32Array(size);
  let y = 0;
  while (y < size) {
    const thick = 5 + Math.floor(rnd() * 24);
    const tone = 0.32 + rnd() * 0.58;
    for (let k = 0; k < thick && y + k < size; k++) bed[y + k] = k === 0 ? tone * 0.35 : tone;
    y += thick;
  }
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const warped = (((py + Math.round((broad[i] - 0.5) * 12)) % size) + size) % size;
      h[i] = bed[warped] * 0.72 + fine[i] * 0.2 + Math.sin(warped * 1.9) * 0.04;
    }
  }
};

export function strataDetail(): DetailPair {
  return bake('strata', paintStrata, 0x57a7, 256, 6, 1, 150);
}

export function mossDetail(): DetailPair {
  // Soft cushions: a wider blur and a low relief (no pixel grit at range).
  return bake('moss', paintMoss, 0x6d0b, 256, 3, 2, 80);
}

export function basaltDetail(): DetailPair {
  return bake('basalt', paintBasalt, 0xba5a, 256, 8);
}

export function plateDetail(): DetailPair {
  return bake('plate', paintPlate, 0x7a7e, 256, 7, 0, 160);
}

export function gratingDetail(): DetailPair {
  // Hard bar edges: no blur, a deep relief and the full albedo swing (the
  // gaps read black, the drop showing through).
  return bake('grating', paintGrating, 0x96a1, 256, 9, 0, 200);
}

/** Wind-packed snow: a bright, low-contrast matte (the vertex paint carries
 *  the blue of the dusk), soft relief so the sastrugi read under a raking
 *  light without grit at range. */
export function snowDetail(): DetailPair {
  return bake('snow', paintSnow, 0x5e0a, 256, 5, 1, 70);
}

/** Glacier and lake ice: cloudy depth, bubble planes and hairline cracks. */
export function iceDetail(): DetailPair {
  return bake('ice', paintIce, 0x1ce5, 256, 3, 0, 110);
}

/** Thornpeak slate flags (one tile = 12 yd: the family's UV scale): plates
 *  1.5 to 3 yd across with chipped, frost-packed seams. A soft normal map
 *  (blurred twice, low relief) so nothing aliases at range. */
export function slateDetail(): DetailPair {
  return bakeColored('slateFlags3', paintSlateFlags, 0x51a7e, 512, 3, 2);
}

/** A glacier crevasse wall (one tile = 20 yd: GLACIER_CLIFF_UV): flutes,
 *  scallops, wandering bands, milky and clear zones, sparse fissures. */
export function glacierWallDetail(): DetailPair {
  return bake('glacierWall2', paintGlacierWall, 0x61ac, 512, 4, 1, 105);
}
