// Brush alphas for the texture paint tool: grayscale masks modulating which
// cells a stamp covers, giving strokes a material character (speckle,
// splatter, streaks, ...) instead of a uniform disc. The built-in set is
// procedurally generated here (original, license-free); makers can import
// their own grayscale images, persisted per browser in localStorage.
//
// Sampling is deterministic (integer hash noise, no Math.random), so the same
// stroke over the same cells always paints the same set: undo/redo and
// re-strokes never flicker.

export const ALPHA_SIZE = 64;
const IMPORT_PREF_KEY = 'woc_editor_brush_alphas';
const MAX_IMPORTED_ALPHAS = 12;

export interface BrushAlpha {
  id: string;
  name: string;
  /** Square grayscale mask, ALPHA_SIZE x ALPHA_SIZE, 0..255 (255 = paints). */
  data: Uint8Array;
  /** Imported by the user (deletable), vs a built-in. */
  imported?: boolean;
}

// Integer hash to [0,1) (same family as the paint dither gate).
function hash01(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise on the alpha grid (bilinear over hashed lattice points).
function valueNoise(x: number, y: number, freq: number, salt: number): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash01(x0, y0, salt);
  const b = hash01(x0 + 1, y0, salt);
  const c = hash01(x0, y0 + 1, salt);
  const d = hash01(x0 + 1, y0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractalNoise(x: number, y: number, salt: number): number {
  return (
    valueNoise(x, y, 0.09, salt) * 0.55 +
    valueNoise(x, y, 0.21, salt + 1) * 0.3 +
    valueNoise(x, y, 0.47, salt + 2) * 0.15
  );
}

function makeAlpha(id: string, name: string, fn: (u: number, v: number) => number): BrushAlpha {
  const data = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE);
  for (let y = 0; y < ALPHA_SIZE; y++) {
    for (let x = 0; x < ALPHA_SIZE; x++) {
      // u,v in [-1, 1] across the mask.
      const u = (x + 0.5) / (ALPHA_SIZE / 2) - 1;
      const v = (y + 0.5) / (ALPHA_SIZE / 2) - 1;
      data[y * ALPHA_SIZE + x] = Math.round(Math.max(0, Math.min(1, fn(u, v))) * 255);
    }
  }
  return { id, name, data };
}

function px(u: number): number {
  return ((u + 1) * ALPHA_SIZE) / 2;
}

// ---- the built-in set ---------------------------------------------------------

function buildBuiltins(): BrushAlpha[] {
  const out: BrushAlpha[] = [];
  // Speckled noise: organic breakup, denser toward the center.
  out.push(
    makeAlpha('noise', 'Noise', (u, v) => {
      const n = fractalNoise(px(u), px(v), 11);
      const center = 1 - Math.min(1, Math.hypot(u, v));
      return n * 0.75 + center * 0.45;
    }),
  );
  // Splatter: a handful of hashed blobs of varying radius.
  out.push(
    makeAlpha('splatter', 'Splatter', (u, v) => {
      let best = 0;
      for (let i = 0; i < 26; i++) {
        const bx = hash01(i, 3, 71) * 1.7 - 0.85;
        const by = hash01(i, 7, 71) * 1.7 - 0.85;
        const br = 0.05 + hash01(i, 11, 71) * 0.22;
        const d = Math.hypot(u - bx, v - by);
        if (d < br) best = Math.max(best, 1 - (d / br) * (d / br));
      }
      return best;
    }),
  );
  // Streaks: directional grunge stripes (nice for wear/flow along a stroke).
  out.push(
    makeAlpha('streaks', 'Streaks', (u, v) => {
      const band = valueNoise(px(u) * 0.15, px(v) * 1.4, 1, 29);
      const grain = valueNoise(px(u), px(v), 0.5, 31);
      const s = band * 0.75 + grain * 0.35;
      return s * s * 1.4;
    }),
  );
  // Halftone dots on a jittered grid.
  out.push(
    makeAlpha('dots', 'Dots', (u, v) => {
      const g = 5.5;
      const cx = Math.floor((u + 1) * 0.5 * g);
      const cy = Math.floor((v + 1) * 0.5 * g);
      const jx = (hash01(cx, cy, 41) - 0.5) * 0.5;
      const jy = (hash01(cy, cx, 43) - 0.5) * 0.5;
      const lx = ((u + 1) * 0.5 * g - cx - 0.5 - jx) * 2;
      const ly = ((v + 1) * 0.5 * g - cy - 0.5 - jy) * 2;
      const d = Math.hypot(lx, ly);
      const r = 0.45 + hash01(cx, cy, 47) * 0.4;
      return d < r ? 1 - (d / r) * (d / r) : 0;
    }),
  );
  // Cellular chunks: voronoi-style plates with cracks between them.
  out.push(
    makeAlpha('chunks', 'Chunks', (u, v) => {
      const g = 4;
      const fx = (u + 1) * 0.5 * g;
      const fy = (v + 1) * 0.5 * g;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let d1 = 9;
      let d2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const sx = cx + ox + hash01(cx + ox, cy + oy, 53) - 0.5;
          const sy = cy + oy + hash01(cy + oy, cx + ox, 59) - 0.5;
          const d = Math.hypot(fx - sx, fy - sy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1;
      return edge > 0.14 ? 1 : edge / 0.14;
    }),
  );
  return out;
}

export const BUILTIN_ALPHAS: readonly BrushAlpha[] = buildBuiltins();

// ---- imported alphas (persisted per browser) -----------------------------------

let imported: BrushAlpha[] | null = null;

interface StoredAlpha {
  id: string;
  name: string;
  dataB64: string;
}

function loadImported(): BrushAlpha[] {
  if (imported) return imported;
  imported = [];
  try {
    const raw = localStorage.getItem(IMPORT_PREF_KEY);
    if (raw) {
      for (const s of JSON.parse(raw) as StoredAlpha[]) {
        if (!s || typeof s.id !== 'string' || typeof s.dataB64 !== 'string') continue;
        const bin = atob(s.dataB64);
        if (bin.length !== ALPHA_SIZE * ALPHA_SIZE) continue;
        const data = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        imported.push({
          id: s.id,
          name: typeof s.name === 'string' ? s.name : s.id,
          data,
          imported: true,
        });
      }
    }
  } catch {
    // Blocked/corrupt storage: session starts with the builtins only.
  }
  return imported;
}

function saveImported(): void {
  if (!imported) return;
  try {
    const stored: StoredAlpha[] = imported.map((a) => {
      let bin = '';
      for (const b of a.data) bin += String.fromCharCode(b);
      return { id: a.id, name: a.name, dataB64: btoa(bin) };
    });
    localStorage.setItem(IMPORT_PREF_KEY, JSON.stringify(stored));
  } catch {
    // Blocked storage: imports stay session-only.
  }
}

export function listBrushAlphas(): BrushAlpha[] {
  return [...BUILTIN_ALPHAS, ...loadImported()];
}

export function brushAlphaById(id: string | null): BrushAlpha | null {
  if (!id) return null;
  return listBrushAlphas().find((a) => a.id === id) ?? null;
}

/** Decode an image file into a 64x64 luminance mask and persist it. */
export async function importBrushAlpha(file: File): Promise<BrushAlpha> {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = ALPHA_SIZE;
  c.height = ALPHA_SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, ALPHA_SIZE, ALPHA_SIZE);
  bitmap.close();
  const img = ctx.getImageData(0, 0, ALPHA_SIZE, ALPHA_SIZE).data;
  const data = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE);
  for (let i = 0; i < data.length; i++) {
    const r = img[i * 4];
    const g = img[i * 4 + 1];
    const b = img[i * 4 + 2];
    const a = img[i * 4 + 3] / 255;
    // Luminance x alpha: white/opaque paints, black/transparent masks out.
    data[i] = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * a);
  }
  const list = loadImported();
  const alpha: BrushAlpha = {
    id: `import-${Date.now().toString(36)}-${list.length}`,
    name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 20) || 'Imported',
    data,
    imported: true,
  };
  list.push(alpha);
  while (list.length > MAX_IMPORTED_ALPHAS) list.shift();
  saveImported();
  return alpha;
}

export function removeBrushAlpha(id: string): void {
  const list = loadImported();
  const i = list.findIndex((a) => a.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    saveImported();
  }
}

/**
 * Sample a mask at brush-space (u, v) in [-1, 1] (0,0 = brush center), 0..1.
 * Nearest-texel: the paint grid is far coarser than the mask anyway.
 */
export function sampleBrushAlpha(alpha: BrushAlpha, u: number, v: number): number {
  const x = Math.max(0, Math.min(ALPHA_SIZE - 1, Math.floor(((u + 1) / 2) * ALPHA_SIZE)));
  const y = Math.max(0, Math.min(ALPHA_SIZE - 1, Math.floor(((v + 1) / 2) * ALPHA_SIZE)));
  return alpha.data[y * ALPHA_SIZE + x] / 255;
}

/** Render a mask to a small canvas for the picker UI (white on dark). */
export function brushAlphaThumb(alpha: BrushAlpha, size = 36): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x / size) * ALPHA_SIZE);
      const sy = Math.floor((y / size) * ALPHA_SIZE);
      const v = alpha.data[sy * ALPHA_SIZE + sx];
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 235;
      img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
