// ---------------------------------------------------------------------------
// Unit-frame portrait painter
//
// Paints the circular portrait shared by the player frame and the target frame:
// a procedural crest (mob family / NPC / class fallback) or a 3D-headshot data
// URL, blitted into the small <canvas> that CSS clips to a circle.
//
// Extracted from hud.ts so the player and target frames share one correct,
// HiDPI-crisp, disc-filling implementation. The pure geometry it relies on
// lives in unit_portrait.ts (and is unit-tested there).
// ---------------------------------------------------------------------------

import { playerPortraitDataUrl } from '../render/characters/portrait';
import type { PlayerClass } from '../sim/types';
import { iconCanvas } from './icons';
import {
  CREST_OVERSCAN,
  overscanRect,
  PORTRAIT_CSS_SIZE,
  portraitBackingPx,
} from './unit_portrait';

/** Default device-pixel-ratio probe (1 outside the browser, e.g. under vitest). */
function defaultDpr(): number {
  return typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
}

const HEADSHOT_CACHE_MAX = 32;

/**
 * Owns painting for the unit-frame portrait canvases. One instance is shared by
 * the player and target frames; it caches decoded headshot images by URL.
 */
export class UnitPortraitPainter {
  private readonly imgCache = new Map<string, HTMLImageElement>();

  constructor(private readonly dpr: () => number = defaultDpr) {}

  private cachedImage(url: string): HTMLImageElement | undefined {
    const img = this.imgCache.get(url);
    if (!img) return undefined;
    this.imgCache.delete(url);
    this.imgCache.set(url, img);
    return img;
  }

  private rememberImage(url: string, img: HTMLImageElement): void {
    this.imgCache.set(url, img);
    if (this.imgCache.size <= HEADSHOT_CACHE_MAX) return;
    const oldest = this.imgCache.keys().next().value;
    if (oldest !== undefined) this.imgCache.delete(oldest);
  }

  /** Size the canvas backing store for the current DPR (clearing it) and return
   *  a ready 2D context plus the backing px to draw at. */
  private begin(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; size: number } {
    const size = portraitBackingPx(PORTRAIT_CSS_SIZE, this.dpr());
    // Assigning width/height always clears the canvas, so only resize when the
    // DPR actually changed; otherwise an explicit clearRect is enough.
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { ctx, size };
  }

  /** Paint a procedural crest, overscanned so the emblem fills the circle.
   *  Also clears any pending headshot decode for this canvas (a late `load`
   *  checks `dataset.portrait` and bails) so it can't repaint over the crest. */
  drawCrest(canvas: HTMLCanvasElement, crestId: string): void {
    canvas.dataset.portrait = '';
    const { ctx, size } = this.begin(canvas);
    const { dx, dy, dw, dh } = overscanRect(size, CREST_OVERSCAN);
    ctx.drawImage(iconCanvas('crest', crestId, size), dx, dy, dw, dh);
  }

  /** Paint a 3D-headshot data URL. The decode is async even for a data URL, so
   *  tag the canvas with the desired URL and only draw if it still matches on
   *  load (the framed unit may have changed mid-decode). */
  drawHeadshot(canvas: HTMLCanvasElement, url: string, onError?: () => void): void {
    canvas.dataset.portrait = url;
    const draw = (img: HTMLImageElement) => {
      if (canvas.dataset.portrait !== url) return; // unit changed mid-decode
      const { ctx, size } = this.begin(canvas);
      ctx.drawImage(img, 0, 0, size, size);
    };
    const fail = () => {
      if (canvas.dataset.portrait !== url) return; // unit changed mid-decode
      this.imgCache.delete(url);
      onError?.();
    };
    const cached = this.cachedImage(url);
    if (cached?.complete) {
      if (cached.naturalWidth) draw(cached);
      else fail();
      return;
    }
    const img = cached ?? new Image();
    img.addEventListener('load', () => draw(img), { once: true });
    img.addEventListener('error', fail, { once: true });
    if (!cached) {
      this.rememberImage(url, img);
      img.src = url;
    }
  }

  /** Paint a (class, skin) headshot, falling back to the class crest until the
   *  3D portraits have finished loading. */
  drawClass(canvas: HTMLCanvasElement, cls: PlayerClass, skin: number): void {
    const url = playerPortraitDataUrl(cls, skin);
    if (url) this.drawHeadshot(canvas, url);
    else this.drawCrest(canvas, `class_${cls}`);
  }
}
