// Thin painter for the unit_frame FAMILY. The pure paint values live
// in unit_frame.ts (unitFrameView); this turns a view into DOM, routing EVERY
// write through the host's SEVEN elided writers so a no-op frame costs
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
//   - `shownDisplay` is the display value to set when a unit is present. Party
//     frames toggle between it and `none`; the target uses `animatedPresence` so
//     it stays measurable while CSS fades it, and the player omits both options;
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
import { type UnitFrameView, unitHealthImpact } from './unit_frame';

// The mutually-exclusive resource-type classes the painter toggles on the resource
// container. Exactly one is on for a live power bar; all are off for `none`.
const RES_TYPE_CLASSES = ['rage', 'energy', 'mana'] as const;
// The shield-overlay class (the shield reaches the bar's right edge).
const OVERSHIELD_CLASS = 'overshield';
// Frame-state classes target/party need; the player always passes them off.
const DEAD_CLASS = 'dead';
const OUT_OF_RANGE_CLASS = 'oor';
const ABSENT_CLASS = 'unitframe-absent';
const DANGER_CLASS = 'health-danger';
const FULL_HEALTH_CLASS = 'health-full';
const HEALTH_STATE_CLASSES = [
  'health-healthy',
  'health-wounded',
  'health-critical',
  'health-dead',
] as const;
const HEALTH_FEEDBACK_CLASSES = [
  'health-damage-a',
  'health-damage-b',
  'health-damage-heavy-a',
  'health-damage-heavy-b',
  'health-heal-a',
  'health-heal-b',
] as const;
const PORTRAIT_STATE_CLASSES = [
  'portrait-normal',
  'portrait-dead',
  'portrait-ghost',
  'portrait-form',
  'portrait-polymorph',
  'portrait-mech',
  'portrait-transformed',
] as const;

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
  /** The level chip, omitted by compact satellites. */
  level?: HTMLElement;
  /** The hp fill (scaleX transform). */
  hpFill: HTMLElement;
  /** The semantic health rail that owns recent-change feedback classes. */
  hpBar?: HTMLElement;
  /** Delayed damage fill behind the immediate health fill. */
  hpTrail?: HTMLElement;
  /** Expected incoming-heal segment, positioned after current health. */
  hpPrediction?: HTMLElement;
  /** The hp text node; omitted by a frame with no health readout (a party frame
   *  shows the hp bar fill only, no "523 / 600" text). */
  hpText?: HTMLElement;
  /** Secondary localized percent readout; omitted by compact party rows. */
  hpPercent?: HTMLElement;
  /** The unit name node; omitted by a frame whose name is static and set once
   *  elsewhere (the player name is set at login, not on the hot path). A frame
   *  whose name changes per unit (target/party) supplies it. */
  name?: HTMLElement;
  /** The title-decoration spans around the name (Book of Deeds display title),
   *  written from the view's pre-localized titlePre/titlePost strings; omitted
   *  by frames without a title surface (player, party), which then pay zero
   *  writes. A supplying instance keeps `name` pointing at a TEXT-ONLY sibling
   *  node (setText clobbers children). */
  titlePre?: HTMLElement;
  titlePost?: HTMLElement;
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
  /** Keep the frame measurable and use opacity/scale classes for presence. */
  animatedPresence?: boolean;
  /** Enable critical state, change flashes, a delayed damage trail, and ARIA values. */
  healthFeedback?: boolean;
  /** Apply contextual portrait classes to a frame that actually owns a portrait. */
  portraitStateClasses?: boolean;
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
  private lastHpFrac: number | null = null;
  private feedbackFlip = false;
  private activeHealthFeedback: (typeof HEALTH_FEEDBACK_CLASSES)[number] | null = null;

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
      this.lastHpFrac = null;
      this.activeHealthFeedback = null;
      if (this.opts.animatedPresence) {
        this.writers.toggleClass(this.el.frame, ABSENT_CLASS, true);
        this.writers.setAttr(this.el.frame, 'aria-hidden', 'true');
      }
      if (this.opts.shownDisplay !== undefined) this.writers.setDisplay(this.el.frame, 'none');
      return;
    }
    if (this.opts.animatedPresence) {
      this.writers.toggleClass(this.el.frame, ABSENT_CLASS, false);
      this.writers.setAttr(this.el.frame, 'aria-hidden', 'false');
    }
    if (this.opts.shownDisplay !== undefined) {
      this.writers.setDisplay(this.el.frame, this.opts.shownDisplay);
    }
    if (this.el.name) this.writers.setText(this.el.name, view.name);
    if (this.el.titlePre) this.writers.setText(this.el.titlePre, view.titlePre);
    if (this.el.titlePost) this.writers.setText(this.el.titlePost, view.titlePost);
    this.gatePortrait(view.portraitKey);
    if (this.opts.portraitStateClasses) {
      for (const cls of PORTRAIT_STATE_CLASSES) {
        this.writers.toggleClass(this.el.frame, cls, cls === `portrait-${view.portraitState}`);
      }
    }
    if (this.el.level) this.writers.setText(this.el.level, view.levelText ?? '');
    this.paintHealth(view);
    if (this.el.hpText) this.writers.setText(this.el.hpText, view.hpText);
    if (this.el.hpPercent) this.writers.setText(this.el.hpPercent, view.hpPercentText);
    this.paintAbsorb(view);
    this.paintResource(view);
    if (this.opts.stateClasses) {
      this.writers.toggleClass(this.el.frame, DEAD_CLASS, view.dead);
      this.writers.toggleClass(this.el.frame, OUT_OF_RANGE_CLASS, view.outOfRange);
    }
  }

  private paintHealth(view: UnitFrameView): void {
    if (this.opts.healthFeedback) {
      const impact = unitHealthImpact(this.lastHpFrac, view.hpFrac);
      if (impact !== 'stable') {
        this.feedbackFlip = !this.feedbackFlip;
        const family =
          impact === 'heal'
            ? 'health-heal'
            : impact === 'damage-heavy'
              ? 'health-damage-heavy'
              : 'health-damage';
        this.activeHealthFeedback =
          `${family}-${this.feedbackFlip ? 'a' : 'b'}` as (typeof HEALTH_FEEDBACK_CLASSES)[number];
      }
      if (this.el.hpBar) {
        for (const cls of HEALTH_FEEDBACK_CLASSES) {
          this.writers.toggleClass(this.el.hpBar, cls, this.activeHealthFeedback === cls);
        }
        this.writers.setAttr(this.el.hpBar, 'aria-valuenow', String(view.hpPercent));
        this.writers.setAttr(this.el.hpBar, 'aria-valuetext', view.hpText);
      }
      for (const cls of HEALTH_STATE_CLASSES) {
        this.writers.toggleClass(this.el.frame, cls, cls === `health-${view.hpState}`);
      }
      this.writers.toggleClass(this.el.frame, FULL_HEALTH_CLASS, view.hpFull);
      this.writers.toggleClass(this.el.frame, DANGER_CLASS, view.hpDanger);
      this.lastHpFrac = view.hpFrac;
    }
    if (this.el.hpPrediction) {
      this.writers.setStyleProp(
        this.el.hpPrediction,
        '--incoming-start',
        `${(view.healPredictionStartFrac * 100).toFixed(1)}%`,
      );
      this.writers.setWidth(
        this.el.hpPrediction,
        `${(view.healPredictionSizeFrac * 100).toFixed(1)}%`,
      );
    }
    const transform = this.barScaleX(view.hpFrac);
    if (this.el.hpTrail) this.writers.setTransform(this.el.hpTrail, transform);
    this.writers.setTransform(this.el.hpFill, transform);
  }

  // The shield overlay is a positioned segment that starts at current HP and spans
  // only the absorb amount. A unit with no shield therefore paints zero hatch instead
  // of tinting its whole health fill. Skipped for a frame with no shield bar.
  private paintAbsorb(view: UnitFrameView): void {
    const absorb = this.el.absorb;
    if (!absorb) return;
    this.writers.setStyleProp(
      absorb,
      '--absorb-start',
      `${(view.absorbStartFrac * 100).toFixed(1)}%`,
    );
    this.writers.setTransform(absorb, this.barScaleX(view.absorbSizeFrac));
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
