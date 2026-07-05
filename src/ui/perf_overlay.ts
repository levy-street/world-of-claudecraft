// Thin DOM consumer for the performance overlay.
//
// All metric math + row selection lives in the pure core (perf_overlay_model.ts);
// this file only paints: it builds the #perf-overlay element's children, resolves
// label keys through t(), formats values through formatNumber, draws the
// frame-time sparkline to a small canvas, applies the user's colors/opacity/text
// size, and handles free drag-to-move while the options panel's placement mode is
// on. It mutates nothing in the world and is decorative (pointer-events:none)
// during normal play.

import { formatNumber, t } from './i18n';
import type { PerfOverlayConfig } from './perf_overlay_config';
import { frameGraphCanvasMetrics, paintFrameTimeGraph } from './perf_graph_painter';
import {
  DEFAULT_PERF_BG_RGB, DEFAULT_PERF_FG, overlayFractionFromPixel, overlayPixelPosition,
  PERF_OVERLAY_MARGIN, rgbaFromHex,
  type PerfMetricKey, type PerfOverlayView, type PerfValue,
} from './perf_overlay_model';

interface RowEls {
  row: HTMLDivElement;
  label: HTMLSpanElement;
  value: HTMLSpanElement;
}

interface Rect { left: number; top: number; width: number; height: number }

export class PerfOverlay {
  private readonly el: HTMLDivElement;
  private readonly badgesEl: HTMLDivElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly graphWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly rowEls = new Map<PerfMetricKey, RowEls>();

  private cfg: PerfOverlayConfig | null = null;
  private enabled = false;
  private placement = false;
  private dragging = false;
  private grabDX = 0;
  private grabDY = 0;
  private lastPx = { left: 0, top: 0 };

  /** Fired when a drag settles, with the new normalized 0..1 position. */
  onPositionChange: ((x: number, y: number) => void) | null = null;

  constructor(host: HTMLDivElement) {
    this.el = host;
    this.el.classList.add('perf-overlay');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.replaceChildren();

    this.badgesEl = document.createElement('div');
    this.badgesEl.className = 'perf-badges';
    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'perf-rows';
    // The sparkline canvas lives in a fixed-height wrapper and is absolutely
    // positioned (see CSS), so its large backing-store intrinsic width never
    // feeds the shrink-wrapped panel's width: the panel sizes to its rows, and
    // the graph can never get stuck at an old, wider metric set's width.
    this.graphWrap = document.createElement('div');
    this.graphWrap.className = 'perf-graph-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'perf-graph';
    this.graphWrap.append(this.canvas);
    this.el.append(this.badgesEl, this.rowsEl, this.graphWrap);

    // Drag-to-move (only active in placement mode). Pointer events cover mouse +
    // touch + pen consistently across Chromium/Firefox/Safari.
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('resize', () => this.reposition());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) this.reposition();
    else this.setPlacementMode(false);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Apply persisted appearance + position. Cheap; safe to call on every change. */
  applyConfig(cfg: PerfOverlayConfig): void {
    this.cfg = cfg;
    const s = this.el.style;
    s.setProperty('--perf-fg', cfg.textColor);
    s.setProperty('--perf-bg', rgbaFromHex(cfg.bgColor, cfg.solidBg ? 1 : cfg.opacity, DEFAULT_PERF_BG_RGB));
    s.setProperty('--perf-scale', String(cfg.fontScale));
    this.reposition();
  }

  /** Enter/leave reposition mode: the overlay becomes interactive + draggable and
   *  floats above the options window so it can be dragged anywhere. */
  setPlacementMode(on: boolean): void {
    this.placement = on && this.enabled;
    this.el.classList.toggle('placing', this.placement);
    if (!this.placement) {
      this.dragging = false;
      this.el.classList.remove('dragging');
    }
  }

  render(view: PerfOverlayView): void {
    if (!this.enabled) return;
    this.renderRows(view);
    this.renderBadges(view);
    this.renderGraph(view);
    if (!this.dragging) this.reposition();
  }

  // -------------------------------------------------------------------------
  // Rows / badges / graph
  // -------------------------------------------------------------------------

  private renderRows(view: PerfOverlayView): void {
    const seen = new Set<PerfMetricKey>();
    for (const row of view.rows) {
      seen.add(row.key);
      let els = this.rowEls.get(row.key);
      if (!els) {
        const rowEl = document.createElement('div');
        rowEl.className = 'perf-row';
        const label = document.createElement('span');
        label.className = 'perf-label';
        const value = document.createElement('span');
        value.className = 'perf-value';
        rowEl.append(label, value);
        els = { row: rowEl, label, value };
        this.rowEls.set(row.key, els);
      }
      els.label.textContent = t(row.labelKey);
      const text = formatValue(row.value);
      if (els.value.textContent !== text) els.value.textContent = text;
      els.row.dataset.sev = row.severity;
      // (re)append in the configured order; moving an existing node is cheap.
      this.rowsEl.appendChild(els.row);
    }
    for (const [key, els] of this.rowEls) {
      if (!seen.has(key)) {
        els.row.remove();
        this.rowEls.delete(key);
      }
    }
  }

  private renderBadges(view: PerfOverlayView): void {
    if (view.badges.length === 0) {
      if (this.badgesEl.childElementCount) this.badgesEl.replaceChildren();
      return;
    }
    this.badgesEl.replaceChildren();
    for (const badge of view.badges) {
      const chip = document.createElement('span');
      chip.className = `perf-badge perf-badge-${badge}`;
      chip.textContent = badge === 'offline'
        ? t('hudChrome.perf.badges.offline')
        : t('hudChrome.perf.badges.backgrounded');
      this.badgesEl.appendChild(chip);
    }
  }

  private renderGraph(view: PerfOverlayView): void {
    if (!view.graph || view.graph.samples.length < 2) {
      this.graphWrap.style.display = 'none';
      return;
    }
    this.graphWrap.style.display = 'block';
    // Measure the wrapper, not the canvas: the wrapper follows the panel (which
    // is sized by its rows), so the width never feeds back from the canvas.
    const cssW = Math.max(60, this.graphWrap.clientWidth || this.rowsEl.clientWidth || this.el.clientWidth || 120);
    const cssH = 26;
    const { pxW, pxH, dpr } = frameGraphCanvasMetrics(cssW, cssH, window.devicePixelRatio || 1);
    // Only the HiDPI backing store is set here; the canvas display size is the
    // wrapper's (CSS `position:absolute; inset:0`), so it can't pin the panel.
    if (this.canvas.width !== pxW) this.canvas.width = pxW;
    if (this.canvas.height !== pxH) this.canvas.height = pxH;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFrameTimeGraph(ctx, {
      samples: view.graph.samples,
      targetMs: view.graph.targetMs,
      cssW,
      cssH,
      color: this.cfg?.textColor ?? DEFAULT_PERF_FG,
    });
  }

  // -------------------------------------------------------------------------
  // Positioning + drag
  // -------------------------------------------------------------------------

  private parentRect(): Rect {
    const parent = this.el.offsetParent as HTMLElement | null;
    if (parent) {
      const r = parent.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  /** Place the overlay from its normalized position, clamped fully on-screen. */
  reposition(): void {
    if (!this.enabled || !this.cfg) return;
    const parent = this.parentRect();
    const ow = this.el.offsetWidth || 120;
    const oh = this.el.offsetHeight || 40;
    const { left, top } = overlayPixelPosition(this.cfg.posX, this.cfg.posY, parent.width, parent.height, ow, oh);
    this.lastPx = { left, top };
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.placement) return;
    e.preventDefault();
    this.dragging = true;
    const rect = this.el.getBoundingClientRect();
    this.grabDX = e.clientX - rect.left;
    this.grabDY = e.clientY - rect.top;
    // Capture so a fast drag that leaves the element keeps delivering events.
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    this.el.classList.add('dragging');
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const parent = this.parentRect();
    const ow = this.el.offsetWidth;
    const oh = this.el.offsetHeight;
    const maxL = Math.max(PERF_OVERLAY_MARGIN, parent.width - ow - PERF_OVERLAY_MARGIN);
    const maxT = Math.max(PERF_OVERLAY_MARGIN, parent.height - oh - PERF_OVERLAY_MARGIN);
    const left = Math.min(maxL, Math.max(PERF_OVERLAY_MARGIN, e.clientX - parent.left - this.grabDX));
    const top = Math.min(maxT, Math.max(PERF_OVERLAY_MARGIN, e.clientY - parent.top - this.grabDY));
    this.lastPx = { left, top };
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.el.classList.remove('dragging');
    const parent = this.parentRect();
    const ow = this.el.offsetWidth;
    const oh = this.el.offsetHeight;
    const frac = overlayFractionFromPixel(this.lastPx.left, this.lastPx.top, parent.width, parent.height, ow, oh);
    this.onPositionChange?.(frac.x, frac.y);
  }
}

// ---------------------------------------------------------------------------
// Value formatting (locale-aware)
// ---------------------------------------------------------------------------

function formatValue(v: PerfValue): string {
  switch (v.kind) {
    case 'fps':
      return formatNumber(Math.round(v.v));
    case 'int':
      return formatNumber(Math.round(v.v));
    case 'compact':
      return formatNumber(v.v, { notation: 'compact', maximumFractionDigits: 1 });
    case 'percent':
      return formatNumber(v.v, { style: 'percent', maximumFractionDigits: 0 });
    case 'ms':
      return t('hudChrome.perf.units.ms', {
        value: formatNumber(v.v, { minimumFractionDigits: v.digits, maximumFractionDigits: v.digits }),
      });
    case 'hz':
      return t('hudChrome.perf.units.hz', { value: formatNumber(Math.round(v.v)) });
    case 'memPair':
      return v.limitMb != null
        ? t('hudChrome.perf.units.memPair', {
          used: formatNumber(Math.round(v.usedMb)),
          limit: formatNumber(Math.round(v.limitMb)),
        })
        : t('hudChrome.perf.units.mb', { value: formatNumber(Math.round(v.usedMb)) });
    case 'text':
      return v.text;
  }
}
