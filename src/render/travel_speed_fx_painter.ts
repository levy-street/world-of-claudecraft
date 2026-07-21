// Thin DOM/canvas consumer for the travel-form speed-illusion cue.
//
// Owns a full-viewport, pointer-transparent <canvas> overlay laid over the
// nameplate layer and paints the radial speed streaks + motion vignette the
// pure core (travel_speed_fx.ts) lays out. All gameplay/easing decisions live
// in the pure core; this file only turns a state into pixels.

import { speedStreaksInto, stepIntensity, vignetteAlpha, type SpeedStreak } from './travel_speed_fx';

export class TravelSpeedFxPainter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private intensity = 0;
  private phase = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  // Persistent streak buffer, refilled in place each frame (no per-frame alloc).
  private streaks: SpeedStreak[] = [];
  // Vignette geometry depends only on canvas size, so cache it across frames and
  // modulate per-frame darkness via globalAlpha instead of rebuilding a gradient.
  private vignetteGrad: CanvasGradient | null = null;

  constructor(parent: HTMLElement) {
    const c = document.createElement('canvas');
    c.style.position = 'absolute';
    c.style.inset = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.pointerEvents = 'none';
    c.style.display = 'none';
    // sit above the world canvas / nameplates but stay inert.
    c.style.zIndex = '5';
    parent.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
  }

  /**
   * Advance and paint one frame. `target` is the pure-core target intensity for
   * this frame (0 when the cue should fade out). The painter eases toward it and
   * skips all canvas work once both the target and the eased value are ~0.
   */
  update(target: number, dt: number): void {
    this.intensity = stepIntensity(this.intensity, target, dt);
    this.phase += dt;
    if (this.intensity < 0.004 && target <= 0) {
      if (this.canvas.style.display !== 'none') this.canvas.style.display = 'none';
      return;
    }
    if (this.canvas.style.display === 'none') this.canvas.style.display = 'block';
    this.resizeIfNeeded();
    this.paint();
  }

  private resizeIfNeeded(): void {
    const w = this.canvas.clientWidth | 0;
    const h = this.canvas.clientHeight | 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.rebuildVignette();
  }

  // Rebuild the cached transparent-center to opaque-rim radial used for the
  // vignette. Only the canvas geometry feeds it, so this runs on resize, not per
  // frame; paint() scales the rim darkness with globalAlpha.
  private rebuildVignette(): void {
    const ctx = this.ctx;
    if (!ctx) { this.vignetteGrad = null; return; }
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const half = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, half * 0.45, cx, cy, half);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    this.vignetteGrad = grad;
  }

  private paint(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const half = Math.hypot(cx, cy); // half-diagonal in device px

    // soft edge vignette: cached transparent-center to opaque-rim gradient, scaled
    // to this frame's darkness with globalAlpha (no per-frame gradient alloc).
    const va = vignetteAlpha(this.intensity);
    if (va > 0.001 && this.vignetteGrad) {
      ctx.save();
      ctx.globalAlpha = va;
      ctx.fillStyle = this.vignetteGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // radial speed streaks fanning outward from screen center.
    const streaks = speedStreaksInto(this.streaks, this.intensity, this.phase);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, this.dpr);
    for (const s of streaks) {
      const dx = Math.cos(s.angle);
      const dy = Math.sin(s.angle);
      const x0 = cx + dx * s.inner * half;
      const y0 = cy + dy * s.inner * half;
      const x1 = cx + dx * s.outer * half;
      const y1 = cy + dy * s.outer * half;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(220,235,255,0)');
      g.addColorStop(1, `rgba(220,235,255,${(s.alpha * 0.5).toFixed(3)})`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
