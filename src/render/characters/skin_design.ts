// Procedural creator-skin textures from a tiny SkinDesignSpec.
//
// A designer skin carries no hosted image — just two colours, a pattern, and an
// optional glow. EVERY client rebuilds the identical body atlas from that spec
// here, so the in-browser designer preview and the in-world avatar always match
// and nothing has to be uploaded or moderated as a file. Pure 2D-canvas + fully
// deterministic (no Math.random / Date) so a given spec is byte-stable across
// clients — mirroring the procedural-texture convention in render/textures.ts.
//
// The atlas is full-coverage (a tint + repeating pattern), not body-part-mapped:
// like the flat-colour skins the engine already supports, it reads as a themed
// recolour wherever the body UVs land it. assets.ts wraps these canvases in
// THREE.CanvasTexture; this module stays Three-free.
import type { SkinDesignSpec } from '../../world_api';

const ATLAS = 512; // body atlas resolution — ample for a tinted/patterned body

/** Stable cache key for a spec (the texture caches key on this). */
export function designHash(spec: SkinDesignSpec): string {
  return `${spec.primary}|${spec.secondary}|${spec.pattern}|${spec.emissive ?? '-'}`;
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function newCanvas(size: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable for skin design');
  return { cv, ctx };
}

// --- Pattern painters (deterministic; secondary colour over the primary fill) --

function paintPattern(ctx: CanvasRenderingContext2D, spec: SkinDesignSpec, size: number): void {
  const c = spec.secondary;
  switch (spec.pattern) {
    case 'solid':
      return; // primary fill only
    case 'scales': {
      const r = size / 14;
      ctx.lineWidth = Math.max(2, size / 220);
      ctx.strokeStyle = rgba(c, 0.85);
      for (let row = 0, y = 0; y < size + r; row++, y += r * 0.62) {
        const off = row % 2 ? r : 0;
        for (let x = -r; x < size + r; x += r * 2) {
          ctx.beginPath();
          ctx.arc(x + off, y, r, 0, Math.PI, false);
          ctx.fillStyle = rgba(c, 0.22);
          ctx.fill();
          ctx.stroke();
        }
      }
      return;
    }
    case 'stripes': {
      const w = size / 12;
      ctx.strokeStyle = rgba(c, 0.7);
      ctx.lineWidth = w * 0.5;
      for (let i = -size; i < size * 2; i += w) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size, size);
        ctx.stroke();
      }
      return;
    }
    case 'diamond': {
      const s = size / 10;
      ctx.strokeStyle = rgba(c, 0.75);
      ctx.lineWidth = Math.max(2, size / 240);
      for (let i = -size; i < size * 2; i += s) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
      }
      return;
    }
    case 'hex': {
      const r = size / 16;
      const h = r * Math.sqrt(3);
      ctx.strokeStyle = rgba(c, 0.8);
      ctx.lineWidth = Math.max(2, size / 250);
      for (let row = 0, cy = 0; cy < size + h; row++, cy += h) {
        const offX = row % 2 ? r * 1.5 : 0;
        for (let cx = 0; cx < size + r * 3; cx += r * 3) {
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            const px = cx + offX + r * Math.cos(a);
            const py = cy + r * Math.sin(a);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      return;
    }
    case 'spots': {
      const step = size / 12;
      const r = step * 0.26;
      ctx.fillStyle = rgba(c, 0.8);
      for (let row = 0, y = step / 2; y < size; row++, y += step) {
        const offX = row % 2 ? step / 2 : 0;
        for (let x = step / 2 + offX; x < size; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    case 'runes': {
      const step = size / 8;
      ctx.strokeStyle = rgba(c, 0.85);
      ctx.lineWidth = Math.max(2, size / 200);
      let n = 0;
      for (let y = step / 2; y < size; y += step) {
        for (let x = step / 2; x < size; x += step, n++) {
          const k = n % 4;
          const u = step * 0.28;
          ctx.beginPath();
          // a small deterministic glyph that varies by cell index
          ctx.moveTo(x - u, y - u);
          ctx.lineTo(x + u, y - u);
          if (k === 0) { ctx.lineTo(x - u, y + u); ctx.lineTo(x + u, y + u); }
          else if (k === 1) { ctx.lineTo(x, y); ctx.lineTo(x - u, y + u); ctx.moveTo(x + u, y); ctx.lineTo(x + u, y + u); }
          else if (k === 2) { ctx.moveTo(x, y - u); ctx.lineTo(x, y + u); ctx.moveTo(x - u, y); ctx.lineTo(x + u, y); }
          else { ctx.lineTo(x + u, y + u); ctx.moveTo(x - u, y + u); ctx.lineTo(x + u, y - u); }
          ctx.stroke();
        }
      }
      return;
    }
  }
}

/** Build the body-atlas canvas for a design (tint + pattern + soft form light). */
export function buildSkinCanvas(spec: SkinDesignSpec, size = ATLAS): HTMLCanvasElement {
  const { cv, ctx } = newCanvas(size);
  ctx.fillStyle = spec.primary;
  ctx.fillRect(0, 0, size, size);
  paintPattern(ctx, spec, size);
  // gentle top-down light so the body reads with a little dimensionality
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return cv;
}

/** Build the emissive (glow) atlas — the pattern marks lit in the emissive colour
 *  over black — or null when the design has no glow. */
export function buildSkinEmissiveCanvas(spec: SkinDesignSpec, size = ATLAS): HTMLCanvasElement | null {
  if (!spec.emissive) return null;
  const { cv, ctx } = newCanvas(size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  // re-draw the pattern in the emissive colour so the same marks glow
  paintPattern(ctx, { ...spec, secondary: spec.emissive }, size);
  return cv;
}

/** A small thumbnail data URL for marketplace cards / designer swatches. */
export function designSwatchDataUrl(spec: SkinDesignSpec, size = 96): string {
  return buildSkinCanvas(spec, size).toDataURL('image/png');
}
