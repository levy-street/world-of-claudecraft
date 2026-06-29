// Thin painter for the unit_frame FAMILY. The pure paint values live
// in unit_frame.ts (unitFrameView); this turns a view into DOM, routing EVERY
// write through the host's SIX elided writers so a no-op frame costs
// no DOM mutation, and caching its element refs ONCE (the player block re-queried
// `#pf-absorb` via $() every frame inside updateAbsorb, a leak this folds away).
//
// It is INSTANCE-PARAMETERIZED, not bespoke: the same class drives the player,
// target, and party frames from their own element sets. The player is the first
// instance; target and party are instances of this exact
// painter with no core change. Per-instance variation lives in the element set and
// the options, never in branches on "which frame this is":
//   - absorb / resource element groups are OPTIONAL: a party frame has no absorb
//     overlay and a target frame has no resource bar, so each instance passes only
//     the groups its DOM actually has;
//   - `shownDisplay` is the display value to set when the unit is present. A target/
//     party frame toggles between it and `none`; the player frame OMITS it (its
//     `.unitframe` display is always `flex` via CSS and must not gain an inline
//     style), so the player instance never writes the frame's display;
//   - `repaintPortrait` repaints the portrait canvas when the identity key changes.
//     The PAINTER owns that gate (so target's lastPortraitTarget gating is
//     this same code path); the player OMITS it (its portrait is drawn once at
//     character setup, not per frame).
//
// No magic values: the painter emits class DISCRIMINATORS and the
// scaleX VALUE strings the view carries, never a literal hex / px / color in TS.
// The base `bar` class and the `low` class (owned by the Hud's updateLowResource)
// are never touched here, so folding the resource-type class into toggleClass does
// not clobber the low-power pulse.

import type { PainterHostWriters } from './painter_host';
import type { UnitFrameView } from './unit_frame';

// The mutually-exclusive resource-type classes the painter toggles on the resource
// container. Exactly one is on for a live power bar; all are off for `none`.
const RES_TYPE_CLASSES = ['rage', 'energy', 'mana'] as const;
// The shield-overlay class (the shield reaches the bar's right edge).
const OVERSHIELD_CLASS = 'overshield';
// Frame-state classes target/party need; the player always passes them off.
const DEAD_CLASS = 'dead';
const OUT_OF_RANGE_CLASS = 'oor';

/** The optional resource-bar elements (a target frame has none). */
export interface UnitFrameResourceElements {
  /** The `.bar` whose class encodes the power type. */
  container: HTMLElement;
  /** The resource fill (scaleX transform). */
  fill: HTMLElement;
  /** The resource text node; omitted by a frame whose resource bar has no text
   *  label (a party frame shows the bar fill only, no "523 / 600" readout). */
  text?: HTMLElement;
}

/** The DOM element set one unit frame instance paints into. */
export interface UnitFrameElements {
  /** The `.unitframe` container (present + dead/out-of-range state). */
  frame: HTMLElement;
  /** The level chip. */
  level: HTMLElement;
  /** The hp fill (scaleX transform). */
  hpFill: HTMLElement;
  /** The hp text node; omitted by a frame with no health readout (a party frame
   *  shows the hp bar fill only, no "523 / 600" text). */
  hpText?: HTMLElement;
  /** The unit name node; omitted by a frame whose name is static and set once
   *  elsewhere (the player name is set at login, not on the hot path). A frame
   *  whose name changes per unit (target/party) supplies it. */
  name?: HTMLElement;
  /** The absorb-shield overlay; omitted by a frame with no shield bar (party). */
  absorb?: HTMLElement;
  /** The resource bar group; omitted by a frame with no resource bar (target). */
  resource?: UnitFrameResourceElements;
}

/** Per-instance options that are not DOM element refs. */
export interface UnitFrameOptions {
  /** The display value to set when the unit is present (e.g. 'flex'). Omit for an
   *  always-visible frame (the player) whose display is owned by CSS. */
  shownDisplay?: string;
  /** Repaint the portrait when the identity key changes. Omit for a frame whose
   *  portrait is drawn elsewhere (the player). */
  repaintPortrait?: (key: string) => void;
  /** Apply the dead / out-of-range frame-state classes. Party frames need them; the
   *  player and target frames never carry them, so they leave this off and pay no
   *  per-frame cost (the view still carries the flags for the family contract). */
  stateClasses?: boolean;
  /** Format a bar fraction into the `transform` string for the hp / resource /
   *  absorb fills. Omit for the byte-faithful default `scaleX(<frac>)` (player /
   *  target, which write the raw number). A party frame supplies a quantizing
   *  formatter (fixed decimals) so its bars keep their inline `.toFixed(3)`
   *  precision, which also stabilizes the write-elision cache key. */
  formatScaleX?: (frac: number) => string;
}

export class UnitFramePainter {
  // The portrait identity last painted; the gate repaints only on change. Starts
  // null so the first present frame paints once (target's lastPortraitTarget gate).
  private lastPortraitKey: string | null = null;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: UnitFrameElements,
    private readonly opts: UnitFrameOptions = {},
  ) {}

  paint(view: UnitFrameView): void {
    if (!view.present) {
      // Reset the portrait gate while the frame is hidden so that re-showing the
      // same unit redraws its portrait. This preserves the old target block's
      // `lastPortraitTarget = -999` reset on no-target (so re-targeting a mob whose
      // id was reused, or simply re-acquiring the same target, repaints). Harmless
      // for a frame with no repaint callback (the player is always present anyway).
      this.lastPortraitKey = null;
      if (this.opts.shownDisplay !== undefined) this.writers.setDisplay(this.el.frame, 'none');
      return;
    }
    if (this.opts.shownDisplay !== undefined) {
      this.writers.setDisplay(this.el.frame, this.opts.shownDisplay);
    }
    if (this.el.name) this.writers.setText(this.el.name, view.name);
    this.gatePortrait(view.portraitKey);
    this.writers.setText(this.el.level, view.levelText ?? '');
    this.writers.setTransform(this.el.hpFill, this.barScaleX(view.hpFrac));
    if (this.el.hpText) this.writers.setText(this.el.hpText, view.hpText);
    this.paintAbsorb(view);
    this.paintResource(view);
    if (this.opts.stateClasses) {
      this.writers.toggleClass(this.el.frame, DEAD_CLASS, view.dead);
      this.writers.toggleClass(this.el.frame, OUT_OF_RANGE_CLASS, view.outOfRange);
    }
  }

  // The shield overlay: a scaleX transform to (hp + absorb)/maxHp plus the
  // overshield class. Folds the former raw updateAbsorb('#pf-absorb', p) onto the
  // elided writers; skipped for a frame with no shield bar.
  private paintAbsorb(view: UnitFrameView): void {
    const absorb = this.el.absorb;
    if (!absorb) return;
    this.writers.setTransform(absorb, this.barScaleX(view.absorbFrac));
    this.writers.toggleClass(absorb, OVERSHIELD_CLASS, view.absorbOvershield);
  }

  // The resource bar: the mutually-exclusive type class (folds the former raw
  // `pfResourceEl.className` swap without clobbering the `bar`/`low` classes), the
  // fill scaleX, and the text. Skipped for a frame with no resource bar (target).
  private paintResource(view: UnitFrameView): void {
    const res = this.el.resource;
    if (!res) return;
    for (const cls of RES_TYPE_CLASSES) {
      this.writers.toggleClass(res.container, cls, view.resClass === cls);
    }
    this.writers.setTransform(res.fill, this.barScaleX(view.resFrac));
    if (res.text) this.writers.setText(res.text, view.resText);
  }

  // The bar `transform` string. The default is byte-faithful to the inline
  // `scaleX(<frac>)` (the player / target write the raw number); an instance can
  // override formatScaleX to quantize the precision (a party frame keeps its
  // `.toFixed(3)`), which also stabilizes the elided cache key.
  private barScaleX(frac: number): string {
    return this.opts.formatScaleX ? this.opts.formatScaleX(frac) : `scaleX(${frac})`;
  }

  // Repaint the portrait canvas only when the identity key changes; a no-op when no
  // repaint callback is wired (the player's portrait is drawn at character setup).
  private gatePortrait(key: string): void {
    if (key === this.lastPortraitKey) return;
    this.lastPortraitKey = key;
    this.opts.repaintPortrait?.(key);
  }

  // Force the next present paint to repaint the portrait even if the identity key is
  // unchanged. The Hud calls this when the underlying portrait ASSETS change (the 3D
  // character GLBs finish loading after the HUD mounts), where the inline target
  // block reset its `lastPortraitTarget` sentinel for the same reason.
  invalidatePortrait(): void {
    this.lastPortraitKey = null;
  }
}
