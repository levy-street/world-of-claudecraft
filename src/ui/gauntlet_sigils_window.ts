// Sugarglass Sigils (Trial 2) trace panel: a centered canvas window the player
// drags along a seeded etched outline. The SIM owns all scoring; this panel only
// streams quantized shape-local trace points and mirrors the authoritative crack /
// progress the wire view carries. It opens/closes automatically as run.sigils
// appears/disappears; Hud drives it per frame and owns the focus bridge.
//
// The outline geometry is the shared, deterministic sigil_shapes module (the SAME
// vertices the sim scores against), and the shape id/seed live in the wire view, so
// the etching the player traces is byte-identical to what the server grades. On a
// shatter the wire's shapeSeed changes (and crack drops to 0); the panel redraws
// the fresh outline and clears the local trail then.
//
// This is a WINDOW module (it runs only while the trial is live, never on the
// steady HUD frame), so it paints with direct DOM/canvas writes rather than the
// per-frame elided-writer facet, like gauntlet_recruit_window / lockpick_window.

import { GAUNTLET } from '../sim/content/gauntlet';
import { sigilOutline } from '../sim/gauntlet/sigil_shapes';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

/** The viewer's live sigils substate (GauntletRunView.sigils), fed each frame. */
export interface GauntletSigilsStatus {
  shapeSeed: number;
  shapeId: number;
  crack: number;
  crackMax: number;
  progress: number;
}

/** Hud-supplied glue; the panel reaches into Hud only through these. */
export interface GauntletSigilsWindowDeps {
  root(): HTMLElement;
  /** Send a batch of quantized shape-local trace points ([x0,y0,x1,y1,...]). */
  onTrace(pts: number[]): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

// Canvas backing size (a square); PAD is the inset the unit-square outline is drawn
// inside so the etching never touches the frame. padFrac expresses it as a fraction
// so pointer mapping is resolution-independent (the canvas scales in CSS).
const CANVAS_SIZE = 260;
const PAD = 26;
const PAD_FRAC = PAD / CANVAS_SIZE;
// Trace sampling: ~30Hz point capture, flushed in <=24-point batches (48 numbers,
// under the server's 64-number cap) at ~250ms. A pointer resting still adds nothing.
const SAMPLE_MS = 33;
const FLUSH_MS = 250;
const MAX_BATCH_POINTS = 24;
// Visible trail cap (older points drop) so a long trace never grows unbounded.
const TRAIL_MAX = 320;
const INT = { maximumFractionDigits: 0 } as const;
const PCT = { maximumFractionDigits: 0 } as const;

const K = {
  title: 'hudChrome.gauntlet.sigilsTitle',
  hint: 'hudChrome.gauntlet.sigilsHint',
  cracks: 'hudChrome.gauntlet.cracks',
  traced: 'hudChrome.gauntlet.traced',
  shattered: 'hudChrome.gauntlet.sigilsShattered',
} satisfies Record<string, TranslationKey>;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Map a 0..1 canvas fraction to a shape-local 0..1 coordinate (the drawable area
 * is inset by PAD_FRAC on each side). Pure so the quantization is unit-testable. */
export function shapeLocalFromFraction(frac: number): number {
  const inner = 1 - 2 * PAD_FRAC;
  return clamp01(inner > 0 ? (frac - PAD_FRAC) / inner : 0);
}

/** Flatten up to `max` sampled points into the wire's [x0,y0,x1,y1,...] batch. The
 * cap keeps a batch at 2*max numbers, under the server's hard 64-number ceiling. */
export function traceBatchNumbers(
  points: readonly { x: number; y: number }[],
  max: number,
): number[] {
  const take = points.slice(0, max);
  const out: number[] = [];
  for (const p of take) out.push(p.x, p.y);
  return out;
}

export class GauntletSigilsWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private crackFill: HTMLElement | null = null;
  private crackText: HTMLElement | null = null;
  private crackBar: HTMLElement | null = null;
  private tracedFill: HTMLElement | null = null;
  private tracedText: HTMLElement | null = null;
  private tracedBar: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  // Offscreen outline cache, rebuilt only when the shape (seed/id) changes.
  private outlineCache: HTMLCanvasElement | null = null;
  private shapeKey = '';
  private lastCrack = 0;
  // Resolved CSS-token colors (read once per open, canvas cannot read a var directly).
  private colors = { outline: '#ffd100', thin: '#ff6b5e', trail: '#f0ebd8', cursor: '#fff' };
  // The player's shape-local trail (drawn) plus the pending send buffer.
  private trail: { x: number; y: number }[] = [];
  private buffer: { x: number; y: number }[] = [];
  private tracing = false;
  private lastSampleMs = 0;
  private lastFlushMs = 0;
  private boundDown = (e: PointerEvent): void => this.onDown(e);
  private boundMove = (e: PointerEvent): void => this.onMove(e);
  private boundUp = (e: PointerEvent): void => this.onUp(e);

  constructor(private readonly deps: GauntletSigilsWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** Per-frame entry point: opens on first non-null status, refreshes, closes on null. */
  sync(status: GauntletSigilsStatus | null): void {
    if (!status) {
      this.close();
      return;
    }
    if (!this.opened) this.open();
    this.update(status);
  }

  private open(): void {
    this.openerFocus = this.deps.captureFocus();
    this.build();
    const el = this.deps.root();
    el.style.display = 'block';
    el.dataset.windowOpen = '1';
    this.opened = true;
    this.trail = [];
    this.buffer = [];
    this.shapeKey = '';
    this.lastCrack = 0;
    el.focus();
  }

  close(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    el.style.display = 'none';
    delete el.dataset.windowOpen;
    this.opened = false;
    this.tracing = false;
    this.trail = [];
    this.buffer = [];
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  private build(): void {
    const el = this.deps.root();
    markDialogRoot(el, { labelledBy: 'gauntlet-sigils-title', modal: true });
    const cracks = esc(t(K.cracks));
    const traced = esc(t(K.traced));
    el.innerHTML =
      `<div class="panel-title"><span id="gauntlet-sigils-title">${esc(t(K.title))}</span></div>` +
      `<div class="gs-hint">${esc(t(K.hint))}</div>` +
      `<canvas class="gs-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" aria-hidden="true"></canvas>` +
      `<div class="gs-meter gs-crack" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="${cracks}">` +
      `<div class="gs-meter-track"><div class="gs-meter-fill gs-crack-fill"></div></div>` +
      `<span class="gs-meter-val gs-crack-val"></span></div>` +
      `<div class="gs-meter gs-traced" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="${traced}">` +
      `<div class="gs-meter-track"><div class="gs-meter-fill gs-traced-fill"></div></div>` +
      `<span class="gs-meter-val gs-traced-val"></span></div>` +
      `<div class="gs-live" role="status" aria-live="polite"></div>`;
    this.canvas = el.querySelector('.gs-canvas');
    this.ctx = this.canvas?.getContext('2d') ?? null;
    this.crackBar = el.querySelector('.gs-crack');
    this.crackFill = el.querySelector('.gs-crack-fill');
    this.crackText = el.querySelector('.gs-crack-val');
    this.tracedBar = el.querySelector('.gs-traced');
    this.tracedFill = el.querySelector('.gs-traced-fill');
    this.tracedText = el.querySelector('.gs-traced-val');
    this.live = el.querySelector('.gs-live');
    this.resolveColors(el);
    if (this.canvas) {
      this.canvas.addEventListener('pointerdown', this.boundDown);
      this.canvas.addEventListener('pointermove', this.boundMove);
      this.canvas.addEventListener('pointerup', this.boundUp);
      this.canvas.addEventListener('pointercancel', this.boundUp);
    }
  }

  private resolveColors(el: HTMLElement): void {
    const cs = getComputedStyle(el);
    const pick = (name: string, fallback: string): string =>
      cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      outline: pick('--color-primary', '#ffd100'),
      thin: pick('--color-hostile', '#ff6b5e'),
      trail: pick('--color-text-light', '#f0ebd8'),
      cursor: '#ffffff',
    };
  }

  private update(status: GauntletSigilsStatus): void {
    const key = `${status.shapeSeed}:${status.shapeId}`;
    const shattered = status.crack < this.lastCrack; // crack only drops on a fresh pane
    if (key !== this.shapeKey) {
      this.shapeKey = key;
      this.buildOutline(status.shapeSeed, status.shapeId);
      this.trail = [];
      this.buffer = [];
    }
    if (shattered && this.live) this.live.textContent = t(K.shattered);
    this.lastCrack = status.crack;
    this.flushIfDue(false);
    this.draw();
    this.paintMeters(status);
  }

  private paintMeters(status: GauntletSigilsStatus): void {
    const crackPct = clamp01(status.crackMax > 0 ? status.crack / status.crackMax : 0) * 100;
    const tracedPct = clamp01(status.progress) * 100;
    if (this.crackFill) this.crackFill.style.width = `${crackPct}%`;
    if (this.crackText) this.crackText.textContent = formatNumber(Math.round(crackPct), PCT);
    if (this.crackBar) this.crackBar.setAttribute('aria-valuenow', String(Math.round(crackPct)));
    if (this.tracedFill) this.tracedFill.style.width = `${tracedPct}%`;
    if (this.tracedText) this.tracedText.textContent = formatNumber(Math.round(tracedPct), INT);
    if (this.tracedBar) this.tracedBar.setAttribute('aria-valuenow', String(Math.round(tracedPct)));
  }

  private buildOutline(seed: number, shapeId: number): void {
    const o = sigilOutline(seed, shapeId, GAUNTLET.sigils.outlinePoints);
    const off = this.outlineCache ?? document.createElement('canvas');
    off.width = CANVAS_SIZE;
    off.height = CANVAS_SIZE;
    const c = off.getContext('2d');
    this.outlineCache = off;
    if (!c) return;
    c.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const drawable = CANVAS_SIZE - 2 * PAD;
    const cx = (x: number): number => PAD + x * drawable;
    const cy = (y: number): number => PAD + y * drawable;
    const n = o.xs.length;
    c.lineWidth = 6;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    // Stroke each segment, tinting the fragile (thin) sections so the player sees
    // where crack accrues fastest (matches the sim's thinSectionMult).
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      c.strokeStyle = o.thin[i] || o.thin[j] ? this.colors.thin : this.colors.outline;
      c.beginPath();
      c.moveTo(cx(o.xs[i]), cy(o.ys[i]));
      c.lineTo(cx(o.xs[j]), cy(o.ys[j]));
      c.stroke();
    }
  }

  private draw(): void {
    const c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (this.outlineCache) c.drawImage(this.outlineCache, 0, 0);
    if (this.trail.length > 0) {
      const drawable = CANVAS_SIZE - 2 * PAD;
      const cx = (x: number): number => PAD + x * drawable;
      const cy = (y: number): number => PAD + y * drawable;
      c.strokeStyle = this.colors.trail;
      c.lineWidth = 2.5;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cx(this.trail[0].x), cy(this.trail[0].y));
      for (let i = 1; i < this.trail.length; i++)
        c.lineTo(cx(this.trail[i].x), cy(this.trail[i].y));
      c.stroke();
      const last = this.trail[this.trail.length - 1];
      c.fillStyle = this.colors.cursor;
      c.beginPath();
      c.arc(cx(last.x), cy(last.y), 4, 0, Math.PI * 2);
      c.fill();
    }
  }

  private onDown(e: PointerEvent): void {
    if (!this.canvas) return;
    e.preventDefault();
    this.tracing = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.lastSampleMs = 0;
    this.sample(e);
  }

  private onMove(e: PointerEvent): void {
    if (!this.tracing) return;
    e.preventDefault();
    const now = performance.now();
    if (now - this.lastSampleMs < SAMPLE_MS) return;
    this.sample(e);
  }

  private onUp(e: PointerEvent): void {
    if (!this.tracing) return;
    e.preventDefault();
    this.tracing = false;
    this.canvas?.releasePointerCapture?.(e.pointerId);
    this.flushIfDue(true);
  }

  private sample(e: PointerEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const p = { x: shapeLocalFromFraction(nx), y: shapeLocalFromFraction(ny) };
    this.lastSampleMs = performance.now();
    this.buffer.push(p);
    this.trail.push(p);
    if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
  }

  private flushIfDue(force: boolean): void {
    if (this.buffer.length === 0) return;
    const now = performance.now();
    if (!force && now - this.lastFlushMs < FLUSH_MS && this.buffer.length < MAX_BATCH_POINTS)
      return;
    const pts = traceBatchNumbers(this.buffer, MAX_BATCH_POINTS);
    this.buffer = [];
    this.lastFlushMs = now;
    if (pts.length > 0) this.deps.onTrace(pts);
  }
}
