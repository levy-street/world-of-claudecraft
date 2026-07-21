// Thin painter for the overhead cast bars. The pure fill/discriminator logic lives
// in src/render/cast_bar.ts (castBarState + consumeBarState, both i18n-free); this
// turns those states into DOM, resolving the visible LABEL via i18n in the PAINTER
// (the core emits a stable discriminator only) and routing EVERY write through the
// host's elided writers so a no-op frame costs no DOM mutation. The
// `.channel` class goes through toggleClass (the multi-slot writer): the
// four single-slot writers cannot express a classList toggle, and a raw classList
// write would silently collapse the skip-rate (Top risk 1).
//
// It is INSTANCE-PARAMETERIZED, not bespoke: the same class drives the
// PLAYER bar (#castbar) and the TARGET bar (#tf-castbar) from their own element
// sets. The two differ only in their options, never in a branch on "which bar":
//   - `resolveCastLabel` localizes the cast id. The player resolves it through
//     castDisplayName (the ability's localized name); the target shows the raw cast
//     id, byte-faithful to its inline block, by passing the identity resolver.
//   - the eat/drink overlay is PLAYER-ONLY: the target never eats/drinks, so its
//     paint input simply omits `consume` and the consume branch is unreachable for
//     it (the generic-Entity cast path stays the target's whole story).
//   - `clearOnHide` clears the inner fill/label/timer + channel class when hidden.
//     The player's inline block did this; the target's hidden path only set
//     display:none, so the target leaves it off and stays byte-faithful.
//
// No magic values: the cast-vs-channel-vs-eat/drink fill color is the
// `.channel` CSS class, never a hex in TS; the percent precision and the consume
// label keys are named constants; CONSUME_DURATION lives in the core, not here.

import type { CastBarState, ConsumeBarState, ConsumeMode } from '../render/cast_bar';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// The channel class drives the draining (vs filling) fill color via CSS; a channel,
// a fishing channel, and the eat/drink overlay all use it.
const CHANNEL_CLASS = 'channel';
// The display value when the bar is shown, and the hidden value.
const SHOWN_DISPLAY = 'block';
const HIDDEN_DISPLAY = 'none';
// The fill width written on the player's hidden-clear path.
const EMPTY_FILL = '0%';
// Width percent precision (e.g. "62.5%") and the cast/consume timer precision
// (e.g. "1.5"), both one decimal, matching the inline blocks this replaced.
const PERCENT_FRACTION_DIGITS = 1;
const TIMER_FRACTION_DIGITS = 1;

// The eat/drink mode -> the EXISTING localized label keys (reused, no new keys).
const CONSUME_LABEL_KEYS: Record<ConsumeMode, TranslationKey> = {
  eat: 'hud.core.eating',
  drink: 'hud.core.drinking',
  eatdrink: 'hud.core.eatingDrinking',
};

/** The four DOM nodes one cast-bar instance paints into. */
export interface CastBarElements {
  /** The bar container (#castbar / #tf-castbar): shown/hidden + the channel class. */
  bar: HTMLElement;
  /** The fill (width percent). */
  fill: HTMLElement;
  /** The label node (the localized ability / fishing / eat-drink text). */
  label: HTMLElement;
  /** The timer node (the localized seconds-remaining). */
  timer: HTMLElement;
}

/** Per-instance options that are not DOM element refs. */
export interface CastBarOptions {
  /** Resolve the cast id into the visible label. The player localizes it
   *  (castDisplayName); the target shows the raw id (the identity resolver),
   *  byte-faithful to its inline block. */
  resolveCastLabel: (state: CastBarState) => string;
  /** Clear the inner fill/label/timer + channel class when the bar is hidden (the
   *  player's inline block did; the target only set display:none). */
  clearOnHide?: boolean;
}

/** The per-frame source the painter draws from. */
export interface CastBarPaintInput {
  /** The cast/channel state from castBarState(entity). */
  cast: CastBarState;
  /** The entity's castRemaining, for the cast timer text. */
  castRemaining: number;
  /** The player's eat/drink overlay from consumeBarState; the target OMITS it, so
   *  the target instance can never render eat/drink. */
  consume?: ConsumeBarState;
}

export class CastBarPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: CastBarElements,
    private readonly opts: CastBarOptions,
  ) {}

  paint(input: CastBarPaintInput): void {
    if (input.cast.visible) {
      this.paintBar(
        input.cast.channel,
        input.cast.fill,
        this.opts.resolveCastLabel(input.cast),
        input.castRemaining,
      );
    } else if (input.consume?.visible) {
      // PLAYER-ONLY: the consume overlay uses the channel styling and the localized
      // eat/drink label resolved from the core's stable mode discriminator.
      this.paintBar(
        true,
        input.consume.fill,
        t(CONSUME_LABEL_KEYS[input.consume.mode]),
        input.consume.remaining,
      );
    } else {
      this.writers.setDisplay(this.el.bar, HIDDEN_DISPLAY);
      if (this.opts.clearOnHide) {
        this.writers.toggleClass(this.el.bar, CHANNEL_CLASS, false);
        this.writers.setWidth(this.el.fill, EMPTY_FILL);
        this.writers.setText(this.el.label, '');
        this.writers.setText(this.el.timer, '');
      }
    }
  }

  // Show the bar with a fill/label/timer, in the exact write order of the inline
  // blocks (display, channel, width, label, timer) so the elided-writer cache keys
  // line up byte-for-byte and the skip-rate accounting is unchanged.
  private paintBar(channel: boolean, fill: number, label: string, remaining: number): void {
    this.writers.setDisplay(this.el.bar, SHOWN_DISPLAY);
    this.writers.toggleClass(this.el.bar, CHANNEL_CLASS, channel);
    this.writers.setWidth(this.el.fill, `${(fill * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`);
    this.writers.setText(this.el.label, label);
    this.writers.setText(this.el.timer, this.timerText(remaining));
    // Report the progress value: the bar is role="progressbar" with static
    // aria-valuemin/max but never exposed a value. Numeric, so no i18n key and no
    // hardcoded literal; routes through the elided setAttr so an unchanged percent does not write.
    this.writers.setAttr(this.el.bar, 'aria-valuenow', String(Math.round(fill * 100)));
  }

  private timerText(remaining: number): string {
    return formatNumber(Math.max(0, remaining), {
      minimumFractionDigits: TIMER_FRACTION_DIGITS,
      maximumFractionDigits: TIMER_FRACTION_DIGITS,
    });
  }
}
