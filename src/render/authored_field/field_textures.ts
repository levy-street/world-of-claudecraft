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

export interface DetailPair {
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

/** Quarried bedrock (the Smith's Heart's Hammer vein, one tile = 10 yd):
 *  the floor left where blocks were cut out. Panels of every size (a great
 *  slab beside a cluster of small ones), each parted from its neighbours by
 *  a dark joint; the point's pocking and short claw scars over each panel
 *  (never long even strokes: those read as wood grain), smoother worn
 *  patches where the masons walked, cracks wandering across the panels,
 *  drill holes down a few joints, chips, and pale dust drifted into the
 *  joints and low spots. */
const paintQuarry: Painter = (h, size, rnd) => {
  const grain = noiseField(size, rnd, 48);
  const broad = noiseField(size, rnd, 5);
  const dust = noiseField(size, rnd, 9);
  const wear = noiseField(size, rnd, 3);
  // The panels: a recursive split of the tile (wrapped), so sizes vary.
  const panels: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const split = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const w = x1 - x0;
    const hh = y1 - y0;
    const min = size * 0.12;
    if (depth >= 4 || (w < min * 2 && hh < min * 2) || (depth >= 2 && rnd() < 0.25)) {
      panels.push({ x0, y0, x1, y1 });
      return;
    }
    if ((w > hh && w >= min * 2) || hh < min * 2) {
      const c = Math.round(x0 + w * (0.3 + rnd() * 0.4));
      split(x0, y0, c, y1, depth + 1);
      split(c, y0, x1, y1, depth + 1);
    } else {
      const c = Math.round(y0 + hh * (0.3 + rnd() * 0.4));
      split(x0, y0, x1, c, depth + 1);
      split(x0, c, x1, y1, depth + 1);
    }
  };
  const ox = Math.floor(rnd() * size);
  const oy = Math.floor(rnd() * size);
  split(ox, oy, ox + size, oy + size, 0);
  for (const p of panels) {
    // A narrow tone swing (phase 2D): wide, the panels read as a floor of
    // big painted tiles from the Gallery's camera.
    const tone = 0.5 + rnd() * 0.3;
    const sunk = rnd() < 0.25 ? -0.06 : 0;
    // Most partings show faintly (the split ran clean), a few are open.
    const joint = rnd() < 0.55 ? 0.8 : 0.55;
    // Claw scars: a few short clusters of parallel strokes, each its own way.
    const scars: { cx: number; cy: number; a: number; r: number }[] = [];
    for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
      scars.push({
        cx: p.x0 + rnd() * (p.x1 - p.x0),
        cy: p.y0 + rnd() * (p.y1 - p.y0),
        a: rnd() * Math.PI,
        r: 6 + rnd() * 14,
      });
    }
    for (let py = p.y0; py < p.y1; py++) {
      for (let px = p.x0; px < p.x1; px++) {
        const i = wrapAt(px, py, size);
        const ex = Math.min(px - p.x0, p.x1 - 1 - px);
        const ey = Math.min(py - p.y0, p.y1 - 1 - py);
        const edge = Math.min(ex, ey);
        let v = tone + sunk + (grain[i] - 0.5) * 0.18 + (broad[i] - 0.5) * 0.22;
        // Worn smooth where feet passed: the grain fades, the tone lifts.
        const smooth = Math.max(0, wear[i] - 0.55) * 1.6;
        v += smooth * 0.08 - (grain[i] - 0.5) * 0.12 * smooth;
        for (const s of scars) {
          const dx = px - s.cx;
          const dy = py - s.cy;
          const d = Math.hypot(dx, dy);
          if (d > s.r) continue;
          const u = dx * Math.cos(s.a) + dy * Math.sin(s.a);
          const stroke = Math.abs(Math.sin(u / 2.2)) ** 8;
          v -= stroke * 0.09 * (1 - d / s.r);
        }
        // The joint: dark and narrow, a bevel on the panel's lip.
        if (edge < 1.5) v *= joint;
        else if (edge < 3.5) v *= 0.5 + joint * 0.45;
        // Dust drifts into the joints' lips and the low spots.
        const drift = Math.max(0, dust[i] - 0.58) * 0.7;
        v += drift * (edge < 5 ? 1.4 : 1);
        h[i] = v;
      }
    }
    // Drill holes down one joint of some panels.
    if (rnd() < 0.08 && p.y1 - p.y0 > 40) {
      for (let py = p.y0 + 6; py < p.y1 - 4; py += 9) {
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (dx * dx + dy * dy <= 5) h[wrapAt(p.x0 + dx + 3, py + dy, size)] = 0.12;
      }
    }
  }
  // The point's pocking: small dark pits over everything.
  for (let k = 0; k < 900; k++) {
    const cx = Math.floor(rnd() * size);
    const cy = Math.floor(rnd() * size);
    h[wrapAt(cx, cy, size)] -= 0.12;
    if (rnd() < 0.4) h[wrapAt(cx + 1, cy, size)] -= 0.06;
  }
  // Cracks: wandering dark lines across the panels, narrowing.
  for (let k = 0; k < 9; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = 40 + rnd() * 120;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a);
      y += Math.sin(a);
      const w = s < len * 0.6 ? 1 : 0;
      for (let d = -w; d <= w; d++) {
        const i = wrapAt(x - Math.sin(a) * d, y + Math.cos(a) * d, size);
        h[i] *= d === 0 ? 0.35 : 0.7;
      }
    }
  }
  // Chips: small bright flakes scattered.
  for (let k = 0; k < 90; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = 1 + rnd() * 1.5;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) h[wrapAt(cx + dx, cy + dy, size)] += 0.08;
  }
};

/** The Hammer Gallery's paving (phase 2E), one tile = 10 yd: dressed granite
 *  flags laid in courses along the walk (each course its own height, each
 *  flag its own length, so no joint runs on for long), every flag its own
 *  tone of the warm and cool greys and tipped a hair, its arrises worn
 *  round by centuries of feet, a corner chipped off here and there, a crack
 *  across a few; the joints dark and narrow with dust packed in stretches
 *  of them. Broad relief only (the low sun turned fine line work to grit). */
const paintPaving: ColorPainter = (h, rgb, size, rnd) => {
  const pxPerYd = size / 10;
  // The courses: heights that tile the texture exactly.
  const rows: number[] = [];
  let total = 0;
  while (total < size) {
    const r = Math.round(pxPerYd * (1.1 + rnd() * 0.65));
    rows.push(r);
    total += r;
  }
  const scaleRows = size / total;
  const rowY: number[] = [];
  let acc = 0;
  for (const r of rows) {
    rowY.push(Math.round(acc));
    acc += r * scaleRows;
  }
  rowY.push(size);
  const mottle = noiseField(size, rnd, 6);
  const grain = noiseField(size, rnd, 40);
  const dust = noiseField(size, rnd, 10);
  const chip = noiseField(size, rnd, 24);
  for (let r = 0; r < rowY.length - 1; r++) {
    const y0 = rowY[r];
    const y1 = rowY[r + 1];
    // The flags of this course: lengths that tile the row exactly, from a
    // random start (wrapped), so courses never share a joint line.
    const lens: number[] = [];
    let t = 0;
    while (t < size) {
      const l = Math.round(pxPerYd * (1.2 + rnd() * 1.5));
      lens.push(l);
      t += l;
    }
    const k = size / t;
    let x = Math.floor(rnd() * size);
    for (const l0 of lens) {
      const l = Math.max(8, Math.round(l0 * k));
      const x0 = x;
      const x1 = x + l;
      x = x1;
      const pick = rnd();
      const hue: [number, number, number] =
        pick < 0.08
          ? [1.1, 1.0, 0.86] // an iron-stained flag
          : pick < 0.42
            ? [1.04, 1.0, 0.95] // warmer
            : pick < 0.74
              ? [0.95, 0.98, 1.04] // cooler
              : [1, 1, 1];
      const tone = 0.74 + rnd() * 0.24;
      const gx = (rnd() - 0.5) * 0.25;
      const gy = (rnd() - 0.5) * 0.25;
      // A chipped corner (a bite out of one of its four corners), a crack.
      const corner = rnd() < 0.35 ? Math.floor(rnd() * 4) : -1;
      const bite = pxPerYd * (0.2 + rnd() * 0.35);
      const crack = rnd() < 0.22;
      const ca = rnd() * Math.PI;
      const cc = rnd() * (x1 - x0);
      const packed = rnd() < 0.4;
      for (let py = y0; py < y1; py++) {
        for (let pxl = x0; pxl < x1; pxl++) {
          const i = wrapAt(pxl, py, size);
          const ex = Math.min(pxl - x0, x1 - 1 - pxl);
          const ey = Math.min(py - y0, y1 - 1 - py);
          let edge = Math.min(ex, ey);
          // The chipped corner: the flag's edge pulled in round it.
          if (corner >= 0) {
            const cx = corner & 1 ? x1 : x0;
            const cy = corner & 2 ? y1 : y0;
            const d = Math.hypot(pxl - cx, py - cy) - bite * (0.75 + chip[i] * 0.5);
            edge = Math.min(edge, Math.max(-4, d));
          }
          const u = (pxl - (x0 + x1) / 2) / pxPerYd;
          const v = (py - (y0 + y1) / 2) / pxPerYd;
          let hv = 0.62 + u * gx + v * gy + (mottle[i] - 0.5) * 0.1 + (grain[i] - 0.5) * 0.05;
          // Worn arris: the flag falls away round over its last few pixels.
          const arris = 7;
          if (edge < arris) hv -= ((arris - Math.max(0, edge)) / arris) ** 1.6 * 0.42;
          const joint = edge < 1.5;
          let c = tone * (0.9 + mottle[i] * 0.2);
          if (edge < arris && edge >= 1.5) c *= 1.06; // the worn arris catches the light
          let cr = c * hue[0];
          let cg = c * hue[1];
          let cb = c * hue[2];
          if (joint) {
            // The joint: dark, or packed with dust in stretches.
            const pd = packed && dust[i] > 0.5;
            const j = pd ? 0.82 : 0.32;
            cr = j * (pd ? 1.04 : 0.98);
            cg = j * (pd ? 0.98 : 0.97);
            cb = j * (pd ? 0.9 : 1.02);
            hv = pd ? 0.3 : 0.05;
          }
          if (crack) {
            const lx = pxl - x0 - cc;
            const ly = py - y0 - (y1 - y0) / 2;
            const dd = Math.abs(lx * Math.sin(ca) - ly * Math.cos(ca));
            if (dd < 1.2 && edge > 2) {
              cr *= 0.55;
              cg *= 0.55;
              cb *= 0.58;
              hv -= 0.2;
            }
          }
          // Dust drifted onto the flags in broad patches.
          const drift = Math.max(0, dust[i] - 0.62) * 0.9;
          cr += drift * 0.12;
          cg += drift * 0.1;
          cb += drift * 0.06;
          h[i] = hv;
          rgb[i * 3] = cr;
          rgb[i * 3 + 1] = cg;
          rgb[i * 3 + 2] = cb;
        }
      }
    }
  }
};

/** The Breath's summit (phase 2G), one tile = 14 yd: pale granite bedrock
 *  the storm has scoured. Broad slabs of every shape (a jittered lattice's
 *  cells, about three to five yards), each its own tone of the cool and pale
 *  greys and tipped a hair, parted by narrow wandering cracks; a few long
 *  cracks running on across the slabs (the cracked plateau); shallow wind
 *  flutes polished down one diagonal (the prevailing wind) catching the
 *  light in pale streaks; a cold wet darkening in the low hollows and a few
 *  pale lichen rosettes on the high spots. Broad relief only. */
const paintScoured: ColorPainter = (h, rgb, size, rnd) => {
  const cells = 4;
  const pts: [number, number][] = [];
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++)
      pts.push([
        ((i + 0.15 + rnd() * 0.7) / cells) * size,
        ((j + 0.15 + rnd() * 0.7) / cells) * size,
      ]);
  const tones = pts.map(() => 0.8 + rnd() * 0.28);
  const warm = pts.map(() => rnd() < 0.25);
  const tilt = pts.map(() => [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3] as const);
  const mottle = noiseField(size, rnd, 7);
  const wet = noiseField(size, rnd, 5);
  const grain = noiseField(size, rnd, 36);
  const wobble = noiseField(size, rnd, 12);
  // Long cracks across the slabs: a few slow arcs each.
  const longCracks: { x: number; y: number; a: number; bend: number; len: number }[] = [];
  for (let k = 0; k < 4; k++)
    longCracks.push({
      x: rnd() * size,
      y: rnd() * size,
      a: rnd() * Math.PI,
      bend: (rnd() - 0.5) * 0.004,
      len: size * (0.35 + rnd() * 0.4),
    });
  const crackMask = new Float32Array(size * size);
  for (const c of longCracks) {
    let x = c.x;
    let y = c.y;
    let a = c.a;
    for (let s = 0; s < c.len; s += 0.7) {
      a += c.bend + (wobble[wrapAt(x, y, size)] - 0.5) * 0.02;
      x += Math.cos(a) * 0.7;
      y += Math.sin(a) * 0.7;
      const w = s < c.len * 0.8 ? 1 : 0;
      for (let d = -w; d <= w; d++) {
        const i = wrapAt(x - Math.sin(a) * d, y + Math.cos(a) * d, size);
        crackMask[i] = Math.max(crackMask[i], d === 0 ? 1 : 0.55);
      }
    }
  }
  const wind = { x: Math.cos(0.65), y: Math.sin(0.65) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // The two nearest slab centres (wrapped): the slab and its parting.
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      const jx = x + (wobble[i] - 0.5) * 10;
      const jy = y + (wobble[(i + 97) % (size * size)] - 0.5) * 10;
      for (let k = 0; k < pts.length; k++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = jx - (pts[k][0] + ox * size);
            const dy = jy - (pts[k][1] + oy * size);
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = k;
            } else if (d < d2) d2 = d;
          }
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const u = (jx - pts[best][0]) / size;
      const v = (jy - pts[best][1]) / size;
      // Wind flutes: shallow grooves across the wind, polished pale.
      const along = x * wind.x + y * wind.y;
      const across = -x * wind.y + y * wind.x;
      const flute = Math.sin(across * 0.19 + Math.sin(along * 0.012) * 3 + mottle[i] * 4);
      let hv =
        0.6 +
        u * tilt[best][0] * 4 +
        v * tilt[best][1] * 4 +
        (mottle[i] - 0.5) * 0.12 +
        flute * 0.035;
      let c = tones[best] * (0.92 + mottle[i] * 0.14 + (grain[i] - 0.5) * 0.06);
      c *= 1 + Math.max(0, flute) * 0.05;
      const hue: [number, number, number] = warm[best] ? [1.03, 1.0, 0.95] : [0.97, 0.99, 1.03];
      let cr = c * hue[0];
      let cg = c * hue[1];
      let cb = c * hue[2];
      // The parting between slabs: a worn shoulder, a narrow dark crack.
      if (edge < 7) hv -= ((7 - edge) / 7) ** 1.8 * 0.3;
      if (edge < 1.6) {
        const j = 0.36;
        cr = j * 0.96;
        cg = j * 0.98;
        cb = j * 1.06;
        hv = 0.08;
      }
      const cm = crackMask[i];
      if (cm > 0 && edge > 2) {
        cr *= 1 - cm * 0.5;
        cg *= 1 - cm * 0.5;
        cb *= 1 - cm * 0.46;
        hv -= cm * 0.22;
      }
      // Wet hollows: cooler and darker where the rain stands.
      const w = Math.max(0, 0.38 - wet[i]) * 1.4;
      cr *= 1 - w * 0.3;
      cg *= 1 - w * 0.26;
      cb *= 1 - w * 0.18;
      // Lichen rosettes on the high spots: a pale grey-green, sparse.
      const lich = Math.max(0, grain[i] - 0.86) * 5 * Math.max(0, hv - 0.55) * 4;
      cr += lich * 0.05;
      cg += lich * 0.08;
      cb += lich * 0.04;
      h[i] = hv;
      rgb[i * 3] = cr;
      rgb[i * 3 + 1] = cg;
      rgb[i * 3 + 2] = cb;
    }
  }
};

/** The Quench's frost-bound granite (phase 2H), one tile = 12 yd: the
 *  mountain's bedrock split by the freeze into slabs (a jittered lattice's
 *  cells, about two to four yards), each its own cool tone and tipped a
 *  hair, parted by joints packed with rime (a pale seam round a thin dark
 *  core: the frost lights the cracks, never darkens them); a few long frost
 *  cracks run on across the slabs, a pale hoar film lies in soft mottles,
 *  cold blue in the low hollows. Broad relief only. */
const paintRime: ColorPainter = (h, rgb, size, rnd) => {
  const cells = 5;
  const pts: [number, number][] = [];
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++)
      pts.push([
        ((i + 0.15 + rnd() * 0.7) / cells) * size,
        ((j + 0.15 + rnd() * 0.7) / cells) * size,
      ]);
  const tones = pts.map(() => 0.82 + rnd() * 0.24);
  const blue = pts.map(() => rnd() < 0.4);
  const tilt = pts.map(() => [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3] as const);
  const mottle = noiseField(size, rnd, 6);
  const hoar = noiseField(size, rnd, 9);
  const grain = noiseField(size, rnd, 40);
  const wobble = noiseField(size, rnd, 12);
  const longCracks: { x: number; y: number; a: number; bend: number; len: number }[] = [];
  for (let k = 0; k < 5; k++)
    longCracks.push({
      x: rnd() * size,
      y: rnd() * size,
      a: rnd() * Math.PI,
      bend: (rnd() - 0.5) * 0.006,
      len: size * (0.3 + rnd() * 0.4),
    });
  const crackMask = new Float32Array(size * size);
  for (const c of longCracks) {
    let x = c.x;
    let y = c.y;
    let a = c.a;
    for (let s = 0; s < c.len; s += 0.7) {
      a += c.bend + (wobble[wrapAt(x, y, size)] - 0.5) * 0.03;
      x += Math.cos(a) * 0.7;
      y += Math.sin(a) * 0.7;
      for (let d = -2; d <= 2; d++) {
        const i = wrapAt(x - Math.sin(a) * d, y + Math.cos(a) * d, size);
        crackMask[i] = Math.max(crackMask[i], d === 0 ? 1 : Math.abs(d) === 1 ? 0.6 : 0.25);
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      const jx = x + (wobble[i] - 0.5) * 9;
      const jy = y + (wobble[(i + 131) % (size * size)] - 0.5) * 9;
      // Each point is jittered inside its own lattice cell, so the nearest
      // two lie in the 5 by 5 cells round this pixel's (wrapped): never
      // the whole lattice.
      const cs = size / cells;
      const ci = Math.floor(jx / cs);
      const cj = Math.floor(jy / cs);
      for (let oj = -2; oj <= 2; oj++) {
        for (let oi = -2; oi <= 2; oi++) {
          const ii = ci + oi;
          const jj = cj + oj;
          const wi = ((ii % cells) + cells) % cells;
          const wj = ((jj % cells) + cells) % cells;
          const k = wj * cells + wi;
          const dx = jx - (pts[k][0] + (ii - wi) * cs);
          const dy = jy - (pts[k][1] + (jj - wj) * cs);
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const u = (jx - pts[best][0]) / size;
      const v = (jy - pts[best][1]) / size;
      let hv = 0.6 + u * tilt[best][0] * 4 + v * tilt[best][1] * 4 + (mottle[i] - 0.5) * 0.12;
      const c = tones[best] * (0.92 + mottle[i] * 0.14 + (grain[i] - 0.5) * 0.05);
      const hue: [number, number, number] = blue[best] ? [0.95, 0.99, 1.06] : [1.0, 1.0, 1.02];
      let cr = c * hue[0];
      let cg = c * hue[1];
      let cb = c * hue[2];
      // The joint: a worn shoulder sinking to it, rime packed in it (a pale
      // seam) round a thin dark core.
      if (edge < 6) hv -= ((6 - edge) / 6) ** 1.8 * 0.28;
      if (edge < 3.2) {
        const t = 1 - edge / 3.2;
        cr += (1.35 - cr) * t * 0.75;
        cg += (1.42 - cg) * t * 0.75;
        cb += (1.5 - cb) * t * 0.75;
      }
      if (edge < 0.9) {
        cr = 0.42;
        cg = 0.47;
        cb = 0.56;
        hv = 0.1;
      }
      const cm = crackMask[i];
      if (cm > 0 && edge > 2) {
        const pale = cm < 0.9 ? cm * 0.55 : 0;
        cr = cr * (1 - cm * 0.35) + pale * 1.3;
        cg = cg * (1 - cm * 0.33) + pale * 1.36;
        cb = cb * (1 - cm * 0.28) + pale * 1.45;
        hv -= cm * 0.16;
      }
      // The hoar film: a pale bloom in soft mottles over the slabs.
      const hr = Math.max(0, hoar[i] - 0.56) * 2.2;
      cr += (1.32 - cr) * hr * 0.5;
      cg += (1.38 - cg) * hr * 0.5;
      cb += (1.46 - cb) * hr * 0.5;
      // Cold blue in the low hollows.
      const low = Math.max(0, 0.36 - mottle[i]) * 1.4;
      cr *= 1 - low * 0.22;
      cg *= 1 - low * 0.14;
      cb *= 1 - low * 0.04;
      h[i] = hv;
      rgb[i * 3] = cr;
      rgb[i * 3 + 1] = cg;
      rgb[i * 3 + 2] = cb;
    }
  }
};

/** The Quench's frost-bound granite (one tile = 12 yd: the family's UV scale). */
export function rimeDetail(): DetailPair {
  return bakeColored('rime', paintRime, 0x7e1c, 512, 2.2, 1);
}

/** The Frozen Lake's surface (phase 2H), one tile = 18 yd: clear lake ice
 *  under a skin of frost. Long pressure cracks wander across it (a white
 *  frosted seam round a dark core), shorter hairlines branch off them, the
 *  wind lays powder in soft streaks and the ice clouds paler in broad
 *  patches; everywhere else it stays dark and clear, so the lake shader's
 *  depth (the water, the bubbles, the deep cracks) shows through. Low
 *  relief: a polished floor, still readable under every telegraph. */
const paintLakeIce: ColorPainter = (h, rgb, size, rnd) => {
  const cloud = noiseField(size, rnd, 5);
  const streak = noiseField(size, rnd, 10);
  const wobble = noiseField(size, rnd, 14);
  for (let i = 0; i < size * size; i++) {
    h[i] = 0.5 + (cloud[i] - 0.5) * 0.12;
    const c = 0.62 + (cloud[i] - 0.5) * 0.36;
    rgb[i * 3] = c * 0.96;
    rgb[i * 3 + 1] = c;
    rgb[i * 3 + 2] = c * 1.04;
  }
  const mark = (x: number, y: number, w: number, tone: number, dh: number) => {
    const i = wrapAt(x, y, size);
    rgb[i * 3] += (tone * 1.3 - rgb[i * 3]) * w;
    rgb[i * 3 + 1] += (tone * 1.4 - rgb[i * 3 + 1]) * w;
    rgb[i * 3 + 2] += (tone * 1.5 - rgb[i * 3 + 2]) * w;
    h[i] += dh * w;
  };
  // The pressure cracks: long slow arcs, a frosted seam round a dark core,
  // hairlines branching off them.
  const crack = (x0: number, y0: number, a0: number, len: number, wide: number, depth: number) => {
    let x = x0;
    let y = y0;
    let a = a0;
    for (let s = 0; s < len; s += 0.8) {
      // Fractures run straight and kink now and then (never a scribble).
      a += (wobble[wrapAt(x, y, size)] - 0.5) * 0.03 + (rnd() < 0.03 ? (rnd() - 0.5) * 0.9 : 0);
      x += Math.cos(a) * 0.8;
      y += Math.sin(a) * 0.8;
      const fade = 1 - s / len;
      for (let d = -wide; d <= wide; d++) {
        const k = 1 - Math.abs(d) / (wide + 1);
        mark(x - Math.sin(a) * d, y + Math.cos(a) * d, k * 0.55 * (0.5 + fade * 0.5), 1, 0.05);
      }
      mark(x, y, 0.9, 0.18, -0.2);
      if (depth < 2 && rnd() < 0.025)
        crack(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd()), len * 0.3, 1, depth + 1);
    }
  };
  for (let k = 0; k < 3; k++)
    crack(rnd() * size, rnd() * size, rnd() * Math.PI * 2, size * (0.5 + rnd() * 0.5), 1, 0);
  for (let k = 0; k < 5; k++)
    crack(rnd() * size, rnd() * size, rnd() * Math.PI * 2, size * (0.08 + rnd() * 0.14), 0, 1);
  // The wind's powder in soft streaks.
  for (let i = 0; i < size * size; i++) {
    const p = Math.max(0, streak[i] - 0.66) * 2.2;
    rgb[i * 3] += (1.2 - rgb[i * 3]) * p * 0.4;
    rgb[i * 3 + 1] += (1.27 - rgb[i * 3 + 1]) * p * 0.4;
    rgb[i * 3 + 2] += (1.35 - rgb[i * 3 + 2]) * p * 0.4;
  }
};

/** The Frozen Lake's surface (one tile = 18 yd: the family's UV scale). */
export function lakeIceDetail(): DetailPair {
  return bakeColored('lakeIce', paintLakeIce, 0x1a6e, 512, 1.2, 1);
}

/** The colour the Heat's floor paints its burning joints in: a hue nothing
 *  else in the tile carries (the basalt is grey, the ash pale, the baked
 *  rims umber), so the floor's material (smith_heart/heat_hearth_floor.ts)
 *  finds them in the map and lights them. Stored at 1/1.6, as every tile. */
export const HEARTH_SEAM_PAINT: readonly [number, number, number] = [1.5, 0.95, 0.25];

/** The Heat's floor (phase 2I), one tile = 10 yd: the heads of the basalt
 *  columns the mountain cooled into (a jittered hexagonal lattice's cells,
 *  a yard and a half to two across), each its own warm dark grey, worn to a
 *  low dome and tipped a hair, parted by deep joints; pale ash settled in
 *  soft drifts and packed into stretches of the joints; and in a few
 *  wandering bands the joints burn (painted HEARTH_SEAM_PAINT), the heads
 *  either side baked a warm umber. Broad relief only. */
const paintHearth: ColorPainter = (h, rgb, size, rnd) => {
  const cols = 6;
  const rows = 8;
  const cw = size / cols;
  const ch = size / rows;
  const pts: [number, number][] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      pts.push([
        (i + 0.5 + (j % 2) * 0.5 + (rnd() - 0.5) * 0.46) * cw,
        (j + 0.5 + (rnd() - 0.5) * 0.46) * ch,
      ]);
  const tones = pts.map(() => 0.8 + rnd() * 0.32);
  const warmth = pts.map(() => rnd());
  const tilt = pts.map(() => [(rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24] as const);
  const ash = noiseField(size, rnd, 5);
  const ashFine = noiseField(size, rnd, 14);
  const grain = noiseField(size, rnd, 40);
  const wobble = noiseField(size, rnd, 10);
  // The burning bands: slow wandering paths across the tile; every joint
  // within a band burns (a trail of lit joints, the fire running under).
  const band = new Float32Array(size * size);
  for (let k = 0; k < 3; k++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = size * (0.45 + rnd() * 0.4);
    const bend = (rnd() - 0.5) * 0.008;
    for (let s = 0; s < len; s += 1.5) {
      a += bend + (wobble[wrapAt(x, y, size)] - 0.5) * 0.06;
      x += Math.cos(a) * 1.5;
      y += Math.sin(a) * 1.5;
      const w = 30 * (0.55 + 0.45 * Math.sin((s / len) * Math.PI));
      for (let d = -w; d <= w; d += 1.5) {
        const i = wrapAt(x - Math.sin(a) * d, y + Math.cos(a) * d, size);
        band[i] = Math.max(band[i], 1 - Math.abs(d) / w);
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // The nearest two lattice points (only the cells round this pixel's).
      const jy = y + (wobble[i] - 0.5) * 6;
      const jx = x + (wobble[(i + 97) % (size * size)] - 0.5) * 6;
      const cj = Math.floor(jy / ch);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      let second = 0;
      for (let oj = -2; oj <= 2; oj++) {
        const jj = cj + oj;
        const wj = ((jj % rows) + rows) % rows;
        const shift = (wj % 2) * 0.5;
        const ci = Math.floor(jx / cw - shift);
        for (let oi = -2; oi <= 2; oi++) {
          const ii = ci + oi;
          const wi = ((ii % cols) + cols) % cols;
          const k = wj * cols + wi;
          const dx = jx - (pts[k][0] + (ii - wi) * cw);
          const dy = jy - (pts[k][1] + (jj - wj) * ch);
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            second = best;
            d1 = d;
            best = k;
          } else if (d < d2) {
            d2 = d;
            second = k;
          }
        }
      }
      // A few neighbouring heads are one column split by a hairline only
      // (never the same lattice twice over).
      const pair = Math.min(best, second) * 131 + Math.max(best, second);
      const fused = ((pair * 2654435761) >>> 0) / 4294967296 < 0.2;
      const edge = (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5 + (fused ? 3.5 : 0);
      const r = Math.sqrt(d1) / (cw * 0.55);
      const u = (jx - pts[best][0]) / cw;
      const v = (jy - pts[best][1]) / ch;
      // The head: worn to a low dome, tipped a hair.
      let hv = 0.6 + u * tilt[best][0] + v * tilt[best][1] + (1 - Math.min(1, r * r)) * 0.08;
      const c = tones[best] * (0.92 + (grain[i] - 0.5) * 0.08);
      const wk = warmth[best];
      let cr = c * (1.02 + wk * 0.06);
      let cg = c * (0.98 + wk * 0.02);
      let cb = c * (0.94 - wk * 0.03);
      // The joint: the head's worn shoulder sinking into it, deep and dark.
      if (edge < 6) hv -= ((6 - edge) / 6) ** 1.7 * 0.24;
      const burning = band[i] > 0.15 && !fused;
      if (edge < 1.6) {
        hv = 0.08;
        if (burning) {
          cr = HEARTH_SEAM_PAINT[0];
          cg = HEARTH_SEAM_PAINT[1];
          cb = HEARTH_SEAM_PAINT[2];
        } else {
          cr = 0.5;
          cg = 0.47;
          cb = 0.45;
        }
      } else if (burning && edge < 9) {
        // The heads either side of a burning joint baked a warm umber.
        const t = (1 - (edge - 1.6) / 7.4) * Math.min(1, band[i] * 2);
        cr += (1.05 - cr) * t * 0.5;
        cg += (0.72 - cg) * t * 0.5;
        cb += (0.5 - cb) * t * 0.5;
      }
      // Ash: soft drifts over the heads, packed into the joints where it
      // lies (never over a burning joint: the fire keeps it clear).
      const drift = Math.max(0, ash[i] - 0.55) * 2.2 + Math.max(0, ashFine[i] - 0.7) * 0.8;
      if (!(burning && edge < 1.6)) {
        const inJoint = edge < 4 ? Math.max(0, ash[i] - 0.42) * 2.5 : 0;
        const w = Math.min(0.55, drift * 0.45 + inJoint * 0.7);
        cr += (1.32 - cr) * w;
        cg += (1.26 - cg) * w;
        cb += (1.18 - cb) * w;
        hv += w * 0.06;
      }
      h[i] = hv;
      rgb[i * 3] = cr;
      rgb[i * 3 + 1] = cg;
      rgb[i * 3 + 2] = cb;
    }
  }
};

/** The Heat's columnar basalt (one tile = 10 yd: the family's UV scale). */
export function hearthDetail(): DetailPair {
  return bakeColored('hearth', paintHearth, 0x4e47, 512, 2.6, 1);
}

/** The Breath's scoured bedrock (one tile = 14 yd: the family's UV scale). */
export function scouredDetail(): DetailPair {
  return bakeColored('scoured', paintScoured, 0x9b21, 512, 2.4, 1);
}

/** The Hammer Gallery's worn paving (one tile = 10 yd: the family's UV scale). */
export function pavingDetail(): DetailPair {
  return bakeColored('paving', paintPaving, 0x9a7e, 512, 2.6, 1);
}

/** Quarried bedrock panels (one tile = 16 yd: the family's UV scale). */
export function quarryDetail(): DetailPair {
  // Softer relief (phase 2D): at 5 the joints' bevels turned from the low
  // sun into hard blue lines.
  return bake('quarry', paintQuarry, 0x9a77, 512, 3.2, 1, 125);
}

export function strataDetail(): DetailPair {
  // Soft relief and a gentler swing (the Smith's Heart, phase 2D): at 6 and
  // 150 the fine lamination's normals flipped faces edge-on to a low sun
  // between lit and dark, a hard camouflage of flecks over every cliff.
  return bake('strata', paintStrata, 0x57a7, 256, 2.4, 2, 105);
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
