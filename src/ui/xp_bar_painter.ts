// Thin painter for the XP bar. The pure visual derivation lives in xp_bar.ts
// (xpBarView: the Max-Level XP Overflow rules + the already-localized hover
// label); this turns that view into DOM, routing EVERY write through the host's
// elided writers and caching its element refs ONCE (the #xpbar /
// .rested / #player-frame refs were re-queried via $() every frame, the leak this
// painter fixes). The label is already localized upstream by xpBarView, so the
// painter never calls t().

import type { PainterHostWriters } from './painter_host';
import type { XpBarView } from './xp_bar';

// The custom property the fill fraction is mirrored into (read by the bar's CSS,
// and by the player frame's portrait ring). A driven value, never a color literal.
const XP_FILL_PROP = '--xp-fill';
// The rested-overlay geometry: a standard property each, driven via setStyleProp so
// the one .rested element can hold both in the multi-slot cache.
const RESTED_LEFT_PROP = 'left';
const RESTED_WIDTH_PROP = 'width';
const XP_OVERFLOW_CLASS = 'overflow';
const XP_RESTED_CLASS = 'rested';
// Width percent precision (e.g. "62.5%"); --xp-fill keeps four decimals.
const PERCENT_FRACTION_DIGITS = 1;
const XP_FILL_FRACTION_DIGITS = 4;

export class XpBarPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly bar: HTMLElement, // #xpbar
    private readonly fill: HTMLElement, // #xpbar .fill (reuses xpFillEl)
    private readonly rested: HTMLElement, // #xpbar .rested
    private readonly label: HTMLElement, // #xpbar .label (reuses xpLabelEl)
    private readonly playerFrame: HTMLElement, // #player-frame (the second --xp-fill target)
  ) {}

  paint(view: XpBarView): void {
    const fillPct = `${(view.fillFrac * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`;
    const fillFrac4 = view.fillFrac.toFixed(XP_FILL_FRACTION_DIGITS);
    this.writers.setWidth(this.fill, fillPct);
    this.writers.setStyleProp(this.bar, XP_FILL_PROP, fillFrac4);
    this.writers.setStyleProp(this.playerFrame, XP_FILL_PROP, fillFrac4);
    // Rested overlay sits ahead of the fill (classic inn-rested bonus preview).
    this.writers.setStyleProp(this.rested, RESTED_LEFT_PROP, fillPct);
    this.writers.setStyleProp(
      this.rested,
      RESTED_WIDTH_PROP,
      `${(view.restedFrac * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`,
    );
    this.writers.setText(this.label, view.label);
    this.writers.toggleClass(this.bar, XP_OVERFLOW_CLASS, view.postCap);
    this.writers.toggleClass(this.bar, XP_RESTED_CLASS, view.restedFrac > 0);
  }
}
