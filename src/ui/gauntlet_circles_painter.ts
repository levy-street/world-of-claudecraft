// Thin painter for the Great Pull's shrinking-circle overlay. The pure size
// math lives in gauntlet_circles_view.ts (gauntletCircleModel, i18n-free);
// this turns a model into DOM, routing EVERY write through the host's elided
// writers so a no-op frame costs no DOM mutation (the per-frame size write is
// pre-quantized to whole px by the core). It owns no cross-frame state beyond
// the live circle id, used to reposition ONCE per spawn and to name the id a
// click sends. No magic values in TS: the geometry rides the --gc-* custom
// properties and the near-state class; colors live entirely in CSS.
//
// The screen position is CLIENT-CHOSEN (rolled here per circle id, kept inside
// safe bounds clear of the top HUD cluster, the screen edges, and the mobile
// controls). It is cosmetic and never scored: the sim grades a click purely by
// the circle's size at receipt. The viewport and the roll are injected deps,
// so the painter never reads a window global and tests stay deterministic.

import type { GauntletCircleModel } from './gauntlet_circles_view';
import type { PainterHostWriters } from './painter_host';

// Shown / hidden display values.
const SHOWN = 'block';
const HIDDEN = 'none';
// The CSS custom properties the painter drives (geometry lives in CSS).
const X_VAR = '--gc-x';
const Y_VAR = '--gc-y';
const SIZE_VAR = '--gc-size';
const TARGET_VAR = '--gc-target-size';
// The near-target ring state class (the glow color lives in CSS, never here).
const NEAR_CLASS = 'near';
// Safe-position bounds, viewport fractions: clear of the screen edges (a full
// 200px spawn stays on screen at any sane viewport), the top gauntlet/HUD
// cluster, and the bottom mobile-controls band.
const X_MIN_FRAC = 0.18;
const X_MAX_FRAC = 0.82;
const Y_MIN_FRAC = 0.28;
const Y_MAX_FRAC = 0.72;

/** The DOM nodes one circles-overlay instance paints into. */
export interface GauntletCirclesElements {
  /** The one pooled circle (#gauntlet-circle): positioned once per spawn via
   *  --gc-x/--gc-y, shrunk per frame via --gc-size. */
  circle: HTMLElement;
  /** The shrinking ring, the actual click/tap target (pointer-events: auto;
   *  the layer and everything else stay pointer-transparent). */
  ring: HTMLElement;
}

/** Host glue injected by Hud. */
export interface GauntletCirclesDeps {
  /** Send the authoritative pull for the clicked circle id. */
  onCircleClick(id: number): void;
  /** Current viewport size in CSS px (spawn-time only, never per frame). */
  viewport(): { w: number; h: number };
  /** A 0..1 roll for the cosmetic spawn point (Math.random in the host). */
  random(): number;
}

export class GauntletCirclesPainter {
  /** The id of the circle currently on screen, -1 when hidden. Names the id a
   *  click sends and keys the once-per-spawn reposition. */
  private liveId = -1;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: GauntletCirclesElements,
    private readonly deps: GauntletCirclesDeps,
  ) {
    // Build-time wire: pointerdown (not click) so the tap lands the moment the
    // finger does; the timing minigame is lost on click's up-edge latency.
    el.ring.addEventListener('pointerdown', (e) => {
      if (this.liveId < 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.deps.onCircleClick(this.liveId);
    });
  }

  paint(model: GauntletCircleModel): void {
    const w = this.writers;
    if (!model.visible) {
      this.liveId = -1;
      w.setDisplay(this.el.circle, HIDDEN);
      return;
    }
    if (model.id !== this.liveId) {
      // A fresh circle: roll its screen point once (cosmetic, never scored).
      this.liveId = model.id;
      const v = this.deps.viewport();
      const x = (X_MIN_FRAC + this.deps.random() * (X_MAX_FRAC - X_MIN_FRAC)) * v.w;
      const y = (Y_MIN_FRAC + this.deps.random() * (Y_MAX_FRAC - Y_MIN_FRAC)) * v.h;
      w.setStyleProp(this.el.circle, X_VAR, `${Math.round(x)}px`);
      w.setStyleProp(this.el.circle, Y_VAR, `${Math.round(y)}px`);
      w.setStyleProp(this.el.circle, TARGET_VAR, `${model.targetPx}px`);
    }
    w.setDisplay(this.el.circle, SHOWN);
    w.setStyleProp(this.el.circle, SIZE_VAR, `${model.sizePx}px`);
    w.toggleClass(this.el.ring, NEAR_CLASS, model.near);
  }
}
