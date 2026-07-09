// Thin painter for the Gauntlet HUD cluster. The pure fill/label logic lives in
// gauntlet_hud_view.ts (gauntletHudModel, i18n-free); this turns a model into DOM,
// resolving every visible label / number through t()/formatNumber HERE and routing
// EVERY write through the host's elided writers so a no-op frame costs no DOM
// mutation. It owns no state and never imports Hud.
//
// It mirrors the overhead cast bar's visual family for the countdown bar (the
// draining `.fill` + `.timer`), and drives the Keeper's Echo round strip and the
// pre-trial tutorial banner from the same model. The Final Court has no HUD
// controls (it is plain auto-attack: target a foe and the standings board +
// health frame carry the fight), so there is no court block here.

import type { GauntletHudHint, GauntletHudModel } from './gauntlet_hud_view';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// Bar-fill width precision, matching the cast bar (e.g. "62.5%").
const PERCENT_FRACTION_DIGITS = 1;
// Integer formatting for the whole-second countdown and the echo round/answer counts.
const INT = { maximumFractionDigits: 0 } as const;
// Shown / hidden display values.
const SHOWN = 'flex';
const SHOWN_BLOCK = 'block';
const HIDDEN = 'none';

// The i18n keys the painter resolves (named so there is no bare string literal in
// the paint body and the completeness sweep can find them).
const K = {
  trialLabel: 'hudChrome.gauntlet.trialLabel',
  phaseLobby: 'hudChrome.gauntlet.phaseLobby',
  phaseStaging: 'hudChrome.gauntlet.phaseStaging',
  phaseInterlude: 'hudChrome.gauntlet.phaseInterlude',
  phasePodium: 'hudChrome.gauntlet.phasePodium',
  echoRound: 'hudChrome.gauntlet.echoRound',
  echoSeconds: 'hudChrome.gauntlet.echoSeconds',
} satisfies Record<string, TranslationKey>;

// The per-trial teaching line, keyed by the model's hint discriminator.
const HINT_KEYS = {
  sentinel: 'hudChrome.gauntlet.hint.sentinel',
  sigils: 'hudChrome.gauntlet.hint.sigils',
  pull: 'hudChrome.gauntlet.hint.pull',
  echoWatch: 'hudChrome.gauntlet.hint.echoWatch',
  echoAnswer: 'hudChrome.gauntlet.hint.echoAnswer',
  span: 'hudChrome.gauntlet.hint.span',
  court: 'hudChrome.gauntlet.hint.court',
} satisfies Record<GauntletHudHint, TranslationKey>;

/** The DOM nodes one gauntlet HUD instance paints into. */
export interface GauntletHudElements {
  /** The cluster container (#gauntlet-hud): shown while a run is live. */
  root: HTMLElement;
  /** The phase / "Trial N of M" caption. */
  phase: HTMLElement;
  /** The phase-countdown bar container (shown/hidden). */
  countdownBar: HTMLElement;
  /** The countdown fill (draining width percent). */
  countdownFill: HTMLElement;
  /** The countdown seconds-remaining text. */
  countdownTimer: HTMLElement;
  /** The big centered pre-trial tutorial banner (the UPCOMING trial's
   *  teaching line during the last seconds of staging/interlude). */
  tutorial: HTMLElement;
  /** The Keeper's Echo strip (shown only during a live duel). */
  echoStrip: HTMLElement;
  /** The "Round N of M" chip. */
  echoRound: HTMLElement;
  /** The answer-window countdown chip (hidden while the stones flash). */
  echoClock: HTMLElement;
}

export class GauntletHudPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: GauntletHudElements,
  ) {}

  paint(model: GauntletHudModel): void {
    const w = this.writers;
    if (!model.visible) {
      w.setDisplay(this.el.root, HIDDEN);
      return;
    }
    w.setDisplay(this.el.root, SHOWN);
    w.setText(this.el.phase, this.phaseLabel(model));

    w.setDisplay(this.el.countdownBar, model.showCountdown ? SHOWN_BLOCK : HIDDEN);
    if (model.showCountdown) {
      w.setWidth(this.el.countdownFill, this.pct(model.countdownFrac));
      w.setText(this.el.countdownTimer, formatNumber(Math.ceil(model.countdownSeconds), INT));
    }

    // The pre-trial tutorial banner reuses the same teaching lines, rendered
    // big and centered while the countdown runs out.
    w.setDisplay(this.el.tutorial, model.tutorial ? SHOWN_BLOCK : HIDDEN);
    if (model.tutorial) w.setText(this.el.tutorial, t(HINT_KEYS[model.tutorial]));

    w.setDisplay(this.el.echoStrip, model.echo ? SHOWN : HIDDEN);
    if (model.echo) this.paintEcho(model.echo);
  }

  private paintEcho(echo: NonNullable<GauntletHudModel['echo']>): void {
    const w = this.writers;
    w.setText(
      this.el.echoRound,
      t(K.echoRound, {
        n: formatNumber(echo.round, INT),
        total: formatNumber(echo.rounds, INT),
      }),
    );
    // The clock only runs while the answer window is open (the flashing
    // stones are the watch phase's whole show).
    w.setDisplay(this.el.echoClock, echo.answerSeconds !== null ? '' : HIDDEN);
    if (echo.answerSeconds !== null) {
      w.setText(
        this.el.echoClock,
        t(K.echoSeconds, { seconds: formatNumber(Math.ceil(echo.answerSeconds), INT) }),
      );
    }
  }

  private phaseLabel(model: GauntletHudModel): string {
    switch (model.phase) {
      case 'lobby':
        return t(K.phaseLobby);
      case 'staging':
        return t(K.phaseStaging);
      case 'trial':
        return t(K.trialLabel, {
          n: formatNumber(model.trialIndex + 1, INT),
          total: formatNumber(model.trialCount, INT),
        });
      case 'interlude':
        return t(K.phaseInterlude);
      case 'podium':
        return t(K.phasePodium);
      default:
        return '';
    }
  }

  private pct(frac: number): string {
    return `${(frac * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`;
  }
}
