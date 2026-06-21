// Procedural creator-skin textures from a SkinDesignSpec.
//
// A designer skin carries no hosted image — just three colours, a pattern, a
// finish, a density, and an optional glow. EVERY client rebuilds the identical
// body atlas from that spec here, so the in-browser designer preview and the
// in-world avatar always match and nothing is uploaded or moderated as a file.
// Pure 2D-canvas + fully deterministic (no Math.random / Date) so a given spec
// is byte-stable across clients — mirroring render/textures.ts's convention.
//
// The atlas is full-coverage with procedural structure (a vertical two-tone
// base, a repeating motif, accent trim bands, and a baked finish sheen), not
// per-body-part UV masking: like the flat-colour skins the engine already
// supports it reads as a themed recolour wherever the body UVs land it. assets.ts
// wraps these canvases in THREE.CanvasTexture; this module stays Three-free.
import type { SkinDesignSpec, SkinPattern } from '../../world_api';

const ATLAS = 512; // body atlas resolution — ample for a tinted/patterned body

/** Stable cache key for a spec (the texture caches key on this). */
export function designHash(spec: SkinDesignSpec): string {
  return [spec.primary, spec.secondary, spec.accent, spec.pattern, spec.finish, spec.density, spec.emissive ?? '-'].join('|');
}

// The colour helpers are exported for unit testing (pure, DOM-free). rgb() parses
// HEX only, so every value fed to it — including shade()/mix() output — must stay
// hex; that invariant is what the regression test pins (a prior bug had shade()
// returning 'rgb(...)', which rgb() then NaN-parsed).
export function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Blend two hex colours; t=0 → a, t=1 → b. Returns 'rgb(...)'. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a); const [br, bg, bb] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
}
/** Scale a hex colour's brightness (k<1 darken, k>1 lighten). Returns a HEX
 *  string so it composes with mix()/rgb() (which parse hex, not 'rgb(...)'). */
export function shade(hex: string, k: number): string {
  const [r, g, b] = rgb(hex);
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * k)));
  const h = (n: number) => c(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function newCanvas(size: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable for skin design');
  return { cv, ctx };
}

// density → motif spacing multiplier (low = larger/sparser, high = tighter).
function densityScale(d: SkinDesignSpec['density']): number {
  return d === 'low' ? 1.6 : d === 'high' ? 0.62 : 1.0;
}

// --- Pattern painters: secondary fills, accent edges; scaled by `u` (unit px) --

function paintPattern(ctx: CanvasRenderingContext2D, pattern: SkinPattern, secondary: string, accent: string, size: number, u: number): void {
  ctx.lineWidth = Math.max(1.5, size / 240);
  switch (pattern) {
    case 'solid':
      return;
    case 'scales': {
      const r = u;
      for (let row = 0, y = 0; y < size + r; row++, y += r * 0.62) {
        const off = row % 2 ? r : 0;
        for (let x = -r; x < size + r; x += r * 2) {
          ctx.beginPath(); ctx.arc(x + off, y, r, 0, Math.PI, false);
          ctx.fillStyle = rgba(secondary, 0.32); ctx.fill();
          ctx.strokeStyle = rgba(accent, 0.85); ctx.stroke();
        }
      }
      return;
    }
    case 'stripes': {
      const w = u * 1.4;
      for (let i = -size; i < size * 2; i += w * 2) {
        ctx.fillStyle = rgba(secondary, 0.6);
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + w, 0); ctx.lineTo(i + w + size, size); ctx.lineTo(i + size, size); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(accent, 0.5); ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
      }
      return;
    }
    case 'diamond': {
      const s = u * 1.2;
      ctx.strokeStyle = rgba(secondary, 0.8);
      for (let i = -size; i < size * 2; i += s) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
      }
      ctx.strokeStyle = rgba(accent, 0.4);
      for (let i = -size; i < size * 2; i += s * 2) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
      }
      return;
    }
    case 'hex': {
      const r = u * 0.9; const h = r * Math.sqrt(3);
      ctx.strokeStyle = rgba(secondary, 0.85);
      for (let row = 0, cy = 0; cy < size + h; row++, cy += h) {
        const offX = row % 2 ? r * 1.5 : 0;
        for (let cx = 0; cx < size + r * 3; cx += r * 3) {
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            const px = cx + offX + r * Math.cos(a); const py = cy + r * Math.sin(a);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.stroke();
        }
      }
      return;
    }
    case 'spots': {
      const step = u * 1.1; const r = step * 0.26;
      for (let row = 0, y = step / 2; y < size; row++, y += step) {
        const offX = row % 2 ? step / 2 : 0;
        for (let x = step / 2 + offX; x < size; x += step) {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(secondary, 0.8); ctx.fill();
          ctx.strokeStyle = rgba(accent, 0.7); ctx.stroke();
        }
      }
      return;
    }
    case 'runes': {
      const step = u * 1.8; ctx.strokeStyle = rgba(secondary, 0.85);
      let n = 0;
      for (let y = step / 2; y < size; y += step) {
        for (let x = step / 2; x < size; x += step, n++) {
          const k = n % 4; const v = step * 0.28;
          ctx.strokeStyle = rgba(n % 3 === 0 ? accent : secondary, 0.85);
          ctx.beginPath();
          ctx.moveTo(x - v, y - v); ctx.lineTo(x + v, y - v);
          if (k === 0) { ctx.lineTo(x - v, y + v); ctx.lineTo(x + v, y + v); }
          else if (k === 1) { ctx.lineTo(x, y); ctx.lineTo(x - v, y + v); ctx.moveTo(x + v, y); ctx.lineTo(x + v, y + v); }
          else if (k === 2) { ctx.moveTo(x, y - v); ctx.lineTo(x, y + v); ctx.moveTo(x - v, y); ctx.lineTo(x + v, y); }
          else { ctx.lineTo(x + v, y + v); ctx.moveTo(x - v, y + v); ctx.lineTo(x + v, y - v); }
          ctx.stroke();
        }
      }
      return;
    }
    case 'chevron': {
      const w = u * 1.3; ctx.lineWidth = Math.max(2, size / 150);
      for (let row = 0, y = -w; y < size + w; row++, y += w) {
        ctx.strokeStyle = rgba(row % 2 ? accent : secondary, 0.7);
        for (let x = -w; x < size + w; x += w * 2) {
          ctx.beginPath(); ctx.moveTo(x, y + w); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 2, y + w); ctx.stroke();
        }
      }
      return;
    }
    case 'weave': {
      const s = u; ctx.lineWidth = Math.max(2, s * 0.34);
      for (let y = 0; y < size; y += s) {
        for (let x = 0; x < size; x += s) {
          const over = ((x / s + y / s) | 0) % 2 === 0;
          ctx.strokeStyle = rgba(over ? secondary : accent, 0.7);
          ctx.beginPath();
          if (over) { ctx.moveTo(x, y + s / 2); ctx.lineTo(x + s, y + s / 2); }
          else { ctx.moveTo(x + s / 2, y); ctx.lineTo(x + s / 2, y + s); }
          ctx.stroke();
        }
      }
      return;
    }
  }
}

// Baked surface finish — a sheen overlay so the body reads with some material.
function paintFinish(ctx: CanvasRenderingContext2D, finish: SkinDesignSpec['finish'], size: number): void {
  if (finish === 'matte') {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  if (finish === 'metallic') {
    // a hard diagonal glint streak for a polished-metal read
    ctx.save();
    ctx.translate(size / 2, size / 2); ctx.rotate(-Math.PI / 5); ctx.translate(-size / 2, -size / 2);
    const streak = ctx.createLinearGradient(0, size * 0.2, 0, size * 0.5);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = streak; ctx.fillRect(-size, size * 0.2, size * 3, size * 0.3);
    ctx.restore();
  }
}

/** Build the body-atlas canvas for a design: two-tone base + motif + accent trim
 *  bands + baked finish sheen. */
export function buildSkinCanvas(spec: SkinDesignSpec, size = ATLAS): HTMLCanvasElement {
  const { cv, ctx } = newCanvas(size);
  // two-tone vertical base: primary up top easing into a darker primary/secondary
  // blend toward the bottom (a believable upper/lower split without UV masks).
  const base = ctx.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, spec.primary);
  base.addColorStop(0.55, spec.primary);
  base.addColorStop(1, mix(shade(spec.primary, 0.78), spec.secondary, 0.35));
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);

  paintPattern(ctx, spec.pattern, spec.secondary, spec.accent, size, (size / 14) * densityScale(spec.density));

  // accent trim bands (collar/belt approximation)
  ctx.fillStyle = rgba(spec.accent, 0.9);
  for (const yFrac of [0.30, 0.62]) {
    ctx.fillRect(0, Math.round(size * yFrac), size, Math.max(3, size / 90));
  }

  paintFinish(ctx, spec.finish, size);
  return cv;
}

/** Build the emissive (glow) atlas — the motif + trim lit in the emissive colour
 *  over black — or null when the design has no glow. */
export function buildSkinEmissiveCanvas(spec: SkinDesignSpec, size = ATLAS): HTMLCanvasElement | null {
  if (!spec.emissive) return null;
  const { cv, ctx } = newCanvas(size);
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, size, size);
  // re-draw the motif in the emissive colour (both fill + edge) so it glows
  paintPattern(ctx, spec.pattern, spec.emissive, spec.emissive, size, (size / 14) * densityScale(spec.density));
  ctx.fillStyle = rgba(spec.emissive, 0.85);
  for (const yFrac of [0.30, 0.62]) ctx.fillRect(0, Math.round(size * yFrac), size, Math.max(3, size / 90));
  return cv;
}

/** A small thumbnail data URL for marketplace cards / designer swatches. */
export function designSwatchDataUrl(spec: SkinDesignSpec, size = 96): string {
  return buildSkinCanvas(spec, size).toDataURL('image/png');
}
