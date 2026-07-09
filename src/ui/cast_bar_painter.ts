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
//     castDisplayName (the ability's localized name); the target can pass the same
//     resolver so boss/scripted ids do not leak through as raw tokens.
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

import type {
  CastBarInterrupt,
  CastBarKind,
  CastBarSource,
  CastBarState,
  ConsumeBarState,
  ConsumeMode,
} from '../render/cast_bar';
import type { CastOutcomeKind, CastOutcomeState } from './cast_outcome_core';
import { castCueText, castLabelWithCue } from './cast_presentation';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// The channel class drives the draining (vs filling) fill color via CSS; a channel,
// a fishing channel, and the eat/drink overlay all use it.
const CHANNEL_CLASS = 'channel';
const KIND_CLASSES: Record<CastBarKind | 'consume', string> = {
  cast: 'cast-kind-cast',
  channel: 'cast-kind-channel',
  consume: 'cast-kind-consume',
};
type PaintKind = CastBarKind | 'consume' | 'none';
const PET_SOURCE_CLASS = 'cast-source-pet';
const INTERRUPTIBLE_CLASS = 'interruptible';
const UNINTERRUPTIBLE_CLASS = 'uninterruptible';
const IMPORTANT_CLASS = 'important';
const OUTCOME_CLASSES: Record<CastOutcomeKind, string> = {
  success: 'outcome-success',
  interrupted: 'outcome-interrupted',
  failed: 'outcome-failed',
};
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
  /** Localized base accessible-name key for this bar instance. */
  barLabelKey: TranslationKey;
  /** Player bars can suppress enemy interrupt cues while target/nameplate bars show them. */
  showInterruptCues?: boolean;
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
  /** Short success/interrupted/failed presentation pulse after the live cast ends. */
  outcome?: CastOutcomeState;
}

export class CastBarPainter {
  private classSignature = '';

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: CastBarElements,
    private readonly opts: CastBarOptions,
  ) {}

  paint(input: CastBarPaintInput): void {
    if (input.cast.visible) {
      const label = this.opts.resolveCastLabel(input.cast);
      const cue = castCueText(input.cast, { showInterruptCues: this.opts.showInterruptCues });
      const status =
        input.cast.kind === 'channel'
          ? t('hudChrome.castBar.channeling')
          : t('hudChrome.castBar.casting');
      const timer = this.timerText(input.castRemaining);
      this.paintBar({
        channel: input.cast.channel,
        kind: input.cast.kind,
        source: input.cast.source,
        interrupt: input.cast.interrupt,
        important: input.cast.important,
        fill: input.cast.fill,
        label,
        visibleLabel: castLabelWithCue(label, cue),
        timer,
        status,
        ariaLabel: this.statusAria(status, label, timer),
      });
    } else if (input.consume?.visible) {
      // PLAYER-ONLY: the consume overlay uses the channel styling and the localized
      // eat/drink label resolved from the core's stable mode discriminator.
      const label = t(CONSUME_LABEL_KEYS[input.consume.mode]);
      const timer = this.timerText(input.consume.remaining);
      this.paintBar({
        channel: true,
        kind: 'consume',
        source: 'player',
        interrupt: 'unknown',
        important: false,
        fill: input.consume.fill,
        label,
        visibleLabel: label,
        timer,
        status: label,
        ariaLabel: this.statusAria(label, label, timer),
      });
    } else if (input.outcome) {
      this.paintOutcome(input.outcome);
    } else {
      this.writers.setDisplay(this.el.bar, HIDDEN_DISPLAY);
      if (this.opts.clearOnHide) {
        this.applyClasses({
          channel: false,
          kind: 'none',
          source: 'unit',
          interrupt: 'unknown',
          important: false,
        });
        this.writers.setWidth(this.el.fill, EMPTY_FILL);
        this.writers.setText(this.el.label, '');
        this.writers.setText(this.el.timer, '');
      }
    }
  }

  // Show the bar with a fill/label/timer. Dynamic classes only rewrite when their
  // signature changes; width/timer keep updating per tick through the elided writers.
  private paintBar(model: {
    channel: boolean;
    kind: PaintKind;
    source: CastBarSource;
    interrupt: CastBarInterrupt;
    important: boolean;
    fill: number;
    label: string;
    visibleLabel: string;
    timer: string;
    status: string;
    ariaLabel: string;
  }): void {
    this.writers.setDisplay(this.el.bar, SHOWN_DISPLAY);
    this.applyClasses(model);
    this.writers.setWidth(this.el.fill, `${(model.fill * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`);
    this.writers.setText(this.el.label, model.visibleLabel);
    this.writers.setText(this.el.timer, model.timer);
    // Report the progress value: the bar is role="progressbar" with static
    // aria-valuemin/max but never exposed a value. Numeric, so no i18n key and no
    // hardcoded literal; routes through the elided setAttr so an unchanged percent does not write.
    this.writers.setAttr(this.el.bar, 'aria-valuenow', String(Math.round(model.fill * 100)));
    this.writers.setAttr(this.el.bar, 'aria-label', model.ariaLabel);
  }

  private paintOutcome(outcome: CastOutcomeState): void {
    const status = this.outcomeStatus(outcome.kind);
    this.writers.setDisplay(this.el.bar, SHOWN_DISPLAY);
    this.applyClasses({
      channel: false,
      kind: 'cast',
      source: 'unit',
      interrupt: 'unknown',
      important: false,
      outcome: outcome.kind,
    });
    this.writers.setWidth(this.el.fill, `${(100).toFixed(PERCENT_FRACTION_DIGITS)}%`);
    this.writers.setText(this.el.label, castLabelWithCue(outcome.label, status));
    this.writers.setText(this.el.timer, '');
    this.writers.setAttr(this.el.bar, 'aria-valuenow', '100');
    this.writers.setAttr(
      this.el.bar,
      'aria-label',
      t('hudChrome.castBar.ariaOutcome', {
        bar: t(this.opts.barLabelKey),
        status,
        label: outcome.label,
      }),
    );
  }

  private timerText(remaining: number): string {
    const seconds = formatNumber(Math.max(0, remaining), {
      minimumFractionDigits: TIMER_FRACTION_DIGITS,
      maximumFractionDigits: TIMER_FRACTION_DIGITS,
    });
    return t('hudChrome.castBar.secondsShort', { seconds });
  }

  private statusAria(status: string, label: string, seconds: string): string {
    return t('hudChrome.castBar.ariaStatus', {
      bar: t(this.opts.barLabelKey),
      status,
      label,
      seconds,
    });
  }

  private outcomeStatus(kind: CastOutcomeKind): string {
    switch (kind) {
      case 'success':
        return t('hudChrome.castBar.complete');
      case 'interrupted':
        return t('hudChrome.castBar.interrupted');
      case 'failed':
        return t('hudChrome.castBar.failed');
    }
  }

  private applyClasses(model: {
    channel: boolean;
    kind: PaintKind;
    source: CastBarSource;
    interrupt: CastBarInterrupt;
    important: boolean;
    outcome?: CastOutcomeKind;
  }): void {
    const sig = [
      model.channel ? '1' : '0',
      model.kind,
      model.source,
      model.interrupt,
      model.important ? '1' : '0',
      model.outcome ?? '',
    ].join(':');
    if (sig === this.classSignature) return;
    this.classSignature = sig;
    this.writers.toggleClass(this.el.bar, CHANNEL_CLASS, model.channel);
    this.writers.toggleClass(this.el.bar, KIND_CLASSES.cast, model.kind === 'cast');
    this.writers.toggleClass(this.el.bar, KIND_CLASSES.channel, model.kind === 'channel');
    this.writers.toggleClass(this.el.bar, KIND_CLASSES.consume, model.kind === 'consume');
    this.writers.toggleClass(this.el.bar, PET_SOURCE_CLASS, model.source === 'pet');
    this.writers.toggleClass(this.el.bar, INTERRUPTIBLE_CLASS, model.interrupt === 'interruptible');
    this.writers.toggleClass(
      this.el.bar,
      UNINTERRUPTIBLE_CLASS,
      model.interrupt === 'uninterruptible',
    );
    this.writers.toggleClass(this.el.bar, IMPORTANT_CLASS, model.important);
    for (const [kind, className] of Object.entries(OUTCOME_CLASSES) as [
      CastOutcomeKind,
      string,
    ][]) {
      this.writers.toggleClass(this.el.bar, className, model.outcome === kind);
    }
  }
}
