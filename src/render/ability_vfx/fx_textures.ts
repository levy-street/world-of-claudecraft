import * as THREE from 'three';

// Procedural canvas textures for the ability VFX primitives, ported from the
// Ability VFX Gallery (arc_bolt_preview.js texture section). Built once at
// first use; the module-local rnd() keeps generation deterministic (the
// textures.ts idiom: never Math.random in texture generation).

let seedState = 77031;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}
const rr = (a: number, b: number): number => a + (b - a) * rnd();
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

function makeCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// Value-noise fBm, sampled by the ring band shader and the decal dissolve.
function fbmTexture(size = 128, oct = 4): THREE.CanvasTexture {
  const tex = makeCanvas(size, (g, s) => {
    const img = g.createImageData(s, s);
    const grid = 8;
    const layers: { n: number; layer: Float32Array }[] = [];
    for (let o = 0; o < oct; o++) {
      const n = grid << o;
      const layer = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) layer[i] = rnd();
      layers.push({ n, layer });
    }
    const sample = (l: { n: number; layer: Float32Array }, x: number, y: number): number => {
      const n = l.n;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const sx = xf * xf * (3 - 2 * xf);
      const sy = yf * yf * (3 - 2 * yf);
      const at = (ix: number, iy: number): number =>
        l.layer[(((iy % n) + n) % n) * n + (((ix % n) + n) % n)];
      const a = at(xi, yi);
      const b = at(xi + 1, yi);
      const c2 = at(xi, yi + 1);
      const d = at(xi + 1, yi + 1);
      return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let v = 0;
        let amp = 0.5;
        for (let o = 0; o < oct; o++) {
          v += sample(layers[o], (x / s) * layers[o].n, (y / s) * layers[o].n) * amp;
          amp *= 0.5;
        }
        const q = Math.floor(Math.min(1, Math.max(0, v)) * 255);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = q;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Soft horizontal energy strip: bright core, feathered edges (ribbon cross
// section). RepeatWrapping so u can scroll past 1.
function ribbonTexture(): THREE.CanvasTexture {
  const tex = makeCanvas(64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0.0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.32, 'rgba(255,255,255,0.25)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(0.68, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Arcane rune circle: concentric rings, glyph band, inner spokes. Near-white
// so the decal shader's uColor carries the school palette.
function runeRingTexture(): THREE.CanvasTexture {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    const k = s / 512;
    g.strokeStyle = 'rgba(240,245,255,0.95)';
    g.lineCap = 'round';
    for (const [r, w] of [
      [224, 9],
      [204, 4],
      [140, 6],
      [126, 3],
    ]) {
      g.lineWidth = w * k;
      g.beginPath();
      g.arc(c, c, r * k, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const gx = c + Math.cos(a) * 172 * k;
      const gy = c + Math.sin(a) * 172 * k;
      g.save();
      g.translate(gx, gy);
      g.rotate(a + Math.PI / 2);
      g.lineWidth = 5.5 * k;
      const strokes = 3 + Math.floor(rnd() * 3);
      for (let st = 0; st < strokes; st++) {
        g.beginPath();
        g.moveTo(rr(-16, 16) * k, rr(-20, 20) * k);
        g.lineTo(rr(-16, 16) * k, rr(-20, 20) * k);
        if (rnd() < 0.6) g.lineTo(rr(-16, 16) * k, rr(-20, 20) * k);
        g.stroke();
      }
      g.restore();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      g.lineWidth = 3.5 * k;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 46 * k, c + Math.sin(a) * 46 * k);
      g.lineTo(c + Math.cos(a) * (86 + rnd() * 24) * k, c + Math.sin(a) * (86 + rnd() * 24) * k);
      g.stroke();
    }
  });
}

// Ember ring: glowing clumps biased to an annulus. Additive-tinted it reads as
// cooling scorch for fire/blood novas (the gallery's dark soot pass needs
// normal blending; one additive path keeps the decal pool to one material).
function emberRingTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    for (let i = 0; i < 190; i++) {
      const a = rnd() * Math.PI * 2;
      const d = (0.35 + rnd() ** 1.4 * 0.55) * c;
      const rad = rr(1.5, 5) * (1 - (d / c) * 0.5);
      const alpha = 0.5 * (1 - Math.abs(d / c - 0.62));
      g.fillStyle = `rgba(255,255,255,${Math.max(0, alpha).toFixed(3)})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// Rime bloom: crystalline streaks radiating from center (frost/moon decals).
function rimeTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rr(-0.09, 0.09);
      const r0 = rr(4, 12);
      const r1 = rr(0.45, 0.95) * c;
      g.lineWidth = rr(1, 3);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      if (rnd() < 0.6) {
        const fa = a + rr(-0.45, 0.45);
        const fr = r1 * rr(0.55, 0.8);
        g.lineTo(c + Math.cos(fa) * fr, c + Math.sin(fa) * fr);
      }
      g.stroke();
    }
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// Jagged radiating fissures with branch offshoots, ported from the gallery's
// crackGlowTex (earthquake cracks). Near-white so the decal shader's uColor
// carries the school; its dissolve edge supplies the hot rim.
function crackTexture(): THREE.CanvasTexture {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(245,248,255,0.9)';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(215,220,235,0.9)';
    g.shadowBlur = 7;
    for (let k = 0; k < 7; k++) {
      const a0 = (k / 7) * Math.PI * 2 + rr(-0.2, 0.2);
      let x = c;
      let y = c;
      let a = a0;
      let d = 0;
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(x, y);
      while (d < c * 0.86) {
        const step = rr(9, 20);
        a += rr(-0.55, 0.55);
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        d += step;
        g.lineTo(x, y);
        if (rnd() < 0.3) {
          // branch offshoot, then keep walking the main fissure
          g.moveTo(x, y);
          g.lineTo(
            x + Math.cos(a + rr(-1.4, 1.4)) * rr(8, 22),
            y + Math.sin(a + rr(-1.4, 1.4)) * rr(8, 22),
          );
          g.moveTo(x, y);
        }
        g.lineWidth = Math.max(0.6, g.lineWidth * 0.92);
      }
      g.stroke();
    }
    g.shadowBlur = 0;
  });
}

// Scorched sunburst: broken radiating burn streaks over a mottled soot annulus
// (the gallery 'char' ground residue, recut for the pool's single additive
// decal path, structure carries the burnt read, uColor the school).
function charTexture(): THREE.CanvasTexture {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, c * 0.45, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + rr(-0.08, 0.08);
      const inner = c * rr(0.16, 0.24);
      const outer = c * (k % 2 ? rr(0.5, 0.65) : rr(0.7, 0.92));
      g.strokeStyle = `rgba(255,255,255,${rr(0.35, 0.6).toFixed(3)})`;
      g.lineWidth = k % 2 ? rr(2, 3.5) : rr(4, 6.5);
      // a gap partway along each streak sells the charred crumble
      const gap0 = rr(0.45, 0.7);
      const gap1 = gap0 + rr(0.06, 0.14);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      g.lineTo(
        c + Math.cos(a) * (inner + (outer - inner) * gap0),
        c + Math.sin(a) * (inner + (outer - inner) * gap0),
      );
      g.moveTo(
        c + Math.cos(a) * (inner + (outer - inner) * gap1),
        c + Math.sin(a) * (inner + (outer - inner) * gap1),
      );
      g.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
      g.stroke();
    }
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2;
      const d = (0.3 + rnd() ** 1.5 * 0.55) * c;
      const rad = rr(2, 7) * (1 - (d / c) * 0.45);
      const alpha = 0.22 * (1 - Math.abs(d / c - 0.5));
      g.fillStyle = `rgba(255,255,255,${Math.max(0, alpha).toFixed(3)})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// 2x2 overlay sprite atlas: soft glow, four-point star, rune diamond, spark.
// Cell indices are the OVERLAY_CELL constants; append means a bigger grid.
export const OVERLAY_ATLAS_GRID = 2;
export const OVERLAY_CELL = { glow: 0, star: 1, rune: 2, spark: 3 } as const;

function overlayAtlasTexture(): THREE.CanvasTexture {
  const cell = 64;
  return makeCanvas(cell * OVERLAY_ATLAS_GRID, (g) => {
    const at = (ix: number, iy: number, draw: (cx: number, cy: number) => void): void => {
      g.save();
      draw(ix * cell + cell / 2, iy * cell + cell / 2);
      g.restore();
    };
    // glow: soft radial dot
    at(0, 0, (cx, cy) => {
      const r = g.createRadialGradient(cx, cy, 0, cx, cy, cell / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.3, 'rgba(255,255,255,0.6)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    });
    // star: 5-point
    at(1, 0, (cx, cy) => {
      g.translate(cx, cy);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? cell * 0.42 : cell * 0.16;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    });
    // rune: hollow diamond with a center tick
    at(0, 1, (cx, cy) => {
      g.translate(cx, cy);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, -cell * 0.36);
      g.lineTo(cell * 0.26, 0);
      g.lineTo(0, cell * 0.36);
      g.lineTo(-cell * 0.26, 0);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(0, -cell * 0.14);
      g.lineTo(0, cell * 0.14);
      g.stroke();
    });
    // spark: thin elongated flash
    at(1, 1, (cx, cy) => {
      g.translate(cx, cy);
      const grad = g.createLinearGradient(0, -cell * 0.42, 0, cell * 0.42);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(-cell * 0.07, -cell * 0.42, cell * 0.14, cell * 0.84);
      g.fillRect(-cell * 0.24, -cell * 0.07, cell * 0.48, cell * 0.14);
    });
  });
}

// ---- impact flipbook sheets (gallery flipbookSheet, arc_bolt_preview.js) ---
// 8x8 grayscale explosion sheets, one NEUTRAL sheet per elemental school,
// tinted by the flipbook shader's uTint. Built lazily per style and cached
// (~4 MB GPU each); ImpactFlipbooks.prewarm builds and binds all six during
// the boot prewarm so none first-uploads mid-combat.

export const FLIPBOOK_GRID = 8;
export const FLIPBOOK_STYLES = [
  'flame',
  'shatter',
  'electric',
  'void',
  'verdant',
  'radiance',
] as const;
export type FlipbookStyle = (typeof FLIPBOOK_STYLES)[number];

const flipbookCache = new Map<FlipbookStyle, THREE.CanvasTexture>();

// The frame painters below author in a fixed 128 px cell space (their arc radii
// and filament lengths are absolute pixels), so the authored size and the
// SHIPPED size are separate numbers: the sheet rasterizes at FLIP_CELL_PX and a
// single canvas scale maps the 128 px authoring space onto it. Halving the
// shipped cell therefore shrinks the artwork instead of clipping it against the
// per-cell clip rect.
//
// Sizing: 64 px per cell is an 8x8 sheet at 512 px, 1 MB on the GPU per style
// and 6 MB across the six (a 128 px cell is 1024 px and 4 MB per style, 25 MB
// across the set). An impact reads for about 0.2 s at roughly a coin's size on
// screen, so the authored resolution was never reaching a pixel.
//
// Known tradeoff: canvas scales stroke widths too, so the thinnest filament
// strokes in the painters below (lineWidth 1.1, and the 0.5 tail of the
// eroding ring) land sub-pixel here and antialias to a fainter line rather
// than a crisp one. Both occur late in the animation, where the frame is
// already fading out on alpha, so the loss is at the dimmest moment of the
// effect. Raise this back to 128 if an A/B shows the filaments reading too
// weak; do not raise it on suspicion, the memory is real and the detail is not.
const FLIP_AUTHOR_CELL_PX = 128;
const FLIP_CELL_PX = 64;

export function flipbookSheet(style: FlipbookStyle): THREE.CanvasTexture {
  let tex = flipbookCache.get(style);
  if (!tex) {
    const cell = FLIP_AUTHOR_CELL_PX;
    tex = makeCanvas(FLIPBOOK_GRID * FLIP_CELL_PX, (g) => {
      g.scale(FLIP_CELL_PX / cell, FLIP_CELL_PX / cell);
      for (let f = 0; f < FLIPBOOK_GRID * FLIPBOOK_GRID; f++) {
        const t = f / (FLIPBOOK_GRID * FLIPBOOK_GRID - 1);
        const cx = (f % FLIPBOOK_GRID) * cell + cell / 2;
        const cy = Math.floor(f / FLIPBOOK_GRID) * cell + cell / 2;
        g.save();
        g.beginPath();
        g.rect(cx - cell / 2, cy - cell / 2, cell, cell);
        g.clip();
        g.globalCompositeOperation = 'lighter';
        FLIP_FRAME[style](g, cx, cy, t);
        g.restore();
      }
    });
    flipbookCache.set(style, tex);
  }
  return tex;
}

// Per-style frame painters (gallery drawFlipFrame), each drawing one frame of
// the school's explosion anatomy at time t in [0, 1].
const FLIP_FRAME: Record<
  FlipbookStyle,
  (g: CanvasRenderingContext2D, cx: number, cy: number, t: number) => void
> = {
  electric(g, cx, cy, t) {
    // the original: flash → eroding ring → filaments
    const flashA = Math.max(0, 1 - t * 2.6) ** 1.7;
    if (flashA > 0.01) {
      const r0 = 8 + 30 * easeOutCubic(Math.min(1, t * 3));
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r0);
      grad.addColorStop(0, `rgba(255,255,255,${flashA})`);
      grad.addColorStop(0.5, `rgba(210,214,224,${(flashA * 0.6).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(150,155,170,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r0, 0, Math.PI * 2);
      g.fill();
    }
    const ringR = 8 + 50 * easeOutQuart(t);
    g.strokeStyle = `rgba(215,220,232,${((1 - t) ** 1.4 * 0.9).toFixed(3)})`;
    g.lineWidth = 6.5 * (1 - t) + 1.2;
    g.shadowColor = 'rgba(210,214,226,0.8)';
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    const nFil = Math.max(2, Math.floor(11 * (1 - t * 0.7)));
    g.strokeStyle = `rgba(240,243,250,${((1 - t) ** 1.2).toFixed(3)})`;
    g.lineWidth = 2.1 * (1 - t) + 0.5;
    for (let k = 0; k < nFil; k++) {
      const a = rnd() * Math.PI * 2;
      let x = cx + Math.cos(a) * 6;
      let y = cy + Math.sin(a) * 6;
      let ang = a;
      let d = 0;
      g.beginPath();
      g.moveTo(x, y);
      const reach = ringR * rr(0.75, 1.2);
      while (d < reach) {
        const step = rr(5, 11);
        ang += rr(-0.6, 0.6);
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
        d += step;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    if (t > 0.45) drawSmokeBlobs(g, cx, cy, t, 5, 8 + 50 * easeOutQuart(t) * 0.7);
  },
  flame(g, cx, cy, t) {
    // roiling fire: blobs rise and lick upward
    const n = Math.max(3, Math.floor(12 * (1 - t * 0.5)));
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const spread = 10 + 34 * easeOutCubic(t);
      const x = cx + Math.cos(a) * spread * rr(0.2, 1);
      const y = cy + Math.sin(a) * spread * rr(0.15, 0.7) - t * 34 * rr(0.4, 1); // rises
      const rad = rr(8, 22) * (1 - t * 0.45);
      const heat = rr(0.55, 1);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(255,255,255,${((1 - t) ** 1.1 * heat).toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(200,200,205,${((1 - t) ** 1.3 * heat * 0.7).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(120,120,125,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    if (t < 0.3) {
      // ignition flash
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 26);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - t / 0.3).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 26, 0, Math.PI * 2);
      g.fill();
    }
    if (t > 0.4) drawSmokeBlobs(g, cx, cy - t * 26, t, 6, 34);
  },
  shatter(g, cx, cy, t) {
    // angular shards flying outward + glints
    const e = easeOutQuart(t);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.4;
      const d = 6 + 52 * e * rr(0.75, 1);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const len = rr(8, 18) * (1 - t * 0.5);
      const wid = len * 0.36;
      const rot = a + e * rr(1, 3);
      const alpha = (1 - t) ** 1.15;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = `rgba(235,240,248,${alpha.toFixed(3)})`;
      g.beginPath();
      g.moveTo(0, -len / 2);
      g.lineTo(wid / 2, len / 4);
      g.lineTo(0, len / 2);
      g.lineTo(-wid / 2, len / 4);
      g.closePath();
      g.fill();
      g.restore();
    }
    // crystalline glints (plus signs)
    g.strokeStyle = `rgba(255,255,255,${((1 - t) ** 1.6).toFixed(3)})`;
    g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2;
      const d = rr(4, 40 * e + 8);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const s = rr(3, 7);
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
      g.stroke();
    }
    if (t < 0.25) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 24);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - t / 0.25).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 24, 0, Math.PI * 2);
      g.fill();
    }
  },
  radiance(g, cx, cy, t) {
    // gentle glory: soft bloom + rotating rays
    const glowR = 14 + 30 * easeOutCubic(Math.min(1, t * 1.6));
    const alpha = (1 - t) ** 1.15;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(230,232,238,${(alpha * 0.5).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(200,202,210,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, glowR, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${(alpha * 0.85).toFixed(3)})`;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t * 0.7;
      const inner = glowR * 0.4;
      const outer = glowR * rr(1.15, 1.7);
      g.lineWidth = k % 3 === 0 ? 2.4 : 1.1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      g.stroke();
    }
  },
  void(g, cx, cy, t) {
    // implosion: ring contracts, tendrils curl inward
    const ringR = 56 * (1 - easeOutCubic(t)) + 7;
    const alpha = Math.min(1, t * 2.5) ** 0.8 * (1 - t) ** 0.55;
    g.strokeStyle = `rgba(225,220,240,${alpha.toFixed(3)})`;
    g.lineWidth = 5 * (1 - t) + 1.6;
    g.shadowColor = 'rgba(200,190,230,0.8)';
    g.shadowBlur = 9;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    g.lineWidth = 1.8;
    for (let k = 0; k < 7; k++) {
      const a0 = (k / 7) * Math.PI * 2 + t * 2;
      g.beginPath();
      for (let s = 0; s <= 8; s++) {
        const u = s / 8;
        const a = a0 + u * 1.6;
        const d = ringR + (1 - u) * 22;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(210,205,232,${(alpha * 0.7).toFixed(3)})`;
      g.stroke();
    }
    if (t > 0.72) {
      // collapse pop
      const p = (t - 0.72) / 0.28;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 30 * p + 6);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - p).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 30 * p + 6, 0, Math.PI * 2);
      g.fill();
    }
  },
  verdant(g, cx, cy, t) {
    // petals/leaves spiraling out on soft bloom
    const e = easeOutCubic(t);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 20 + 18 * e);
    grad.addColorStop(0, `rgba(245,248,242,${((1 - t) ** 1.3).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(210,220,205,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, 20 + 18 * e, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + e * 2.4 + k * 0.4;
      const d = 6 + 44 * e * rr(0.7, 1);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const alpha = (1 - t) ** 1.1;
      g.save();
      g.translate(x, y);
      g.rotate(a + e * 3);
      g.fillStyle = `rgba(235,242,230,${alpha.toFixed(3)})`;
      g.beginPath();
      g.ellipse(0, 0, rr(6, 10) * (1 - t * 0.4), rr(2.5, 4), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  },
};

function drawSmokeBlobs(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  t: number,
  n: number,
  spread: number,
): void {
  const sA = Math.max(0, (t - 0.4) * 0.55 * (1 - t));
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rr(8, spread);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const rad = rr(12, 26);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(120,124,136,${sA.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(120,124,136,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
}

export interface AbilityVfxTextures {
  noise: THREE.CanvasTexture;
  ribbon: THREE.CanvasTexture;
  rune: THREE.CanvasTexture;
  ember: THREE.CanvasTexture;
  rime: THREE.CanvasTexture;
  crack: THREE.CanvasTexture;
  char: THREE.CanvasTexture;
  overlay: THREE.CanvasTexture;
}

let cached: AbilityVfxTextures | null = null;

// Build the whole set once (roughly 140 KB of canvases); every pool shares it.
export function abilityVfxTextures(): AbilityVfxTextures {
  if (!cached) {
    cached = {
      noise: fbmTexture(),
      ribbon: ribbonTexture(),
      rune: runeRingTexture(),
      ember: emberRingTexture(),
      rime: rimeTexture(),
      crack: crackTexture(),
      char: charTexture(),
      overlay: overlayAtlasTexture(),
    };
  }
  return cached;
}
