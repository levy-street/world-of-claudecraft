// Thin painter for the Gauntlet HUD cluster. The pure fill/label logic lives in
// gauntlet_hud_view.ts (gauntletHudModel, i18n-free); this turns a model into DOM,
// resolving every visible label / number / money through t()/formatNumber/formatMoney
// HERE and routing EVERY write through the host's elided writers so a no-op frame
// costs no DOM mutation. It owns no state and never imports Hud.
//
// It mirrors the overhead cast bar's visual family for the countdown bar (the
// draining `.fill` + `.timer`), and drives the green/red sentinel light and the
// vitality/survivor/prize chrome from the same model. No magic values: the light
// color is the LIGHT_*_CLASS toggle (never a hex in TS), the percent precision and
// the i18n keys are named constants.

import type { GauntletHudHint, GauntletHudModel } from './gauntlet_hud_view';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// The green/red light-pill state classes (the fill color lives in CSS, never here).
const LIGHT_GREEN_CLASS = 'green';
const LIGHT_RED_CLASS = 'red';
// Court role state classes (drives the attacker/defender chip color in CSS).
const ATTACKER_CLASS = 'attacker';
const DEFENDER_CLASS = 'defender';
// Bar-fill width precision, matching the cast bar (e.g. "62.5%").
const PERCENT_FRACTION_DIGITS = 1;
// Integer formatting for vitality / survivor counts and the whole-second countdown.
const INT = { maximumFractionDigits: 0 } as const;
// Shown / hidden display values.
const SHOWN = 'flex';
const SHOWN_BLOCK = 'block';
const HIDDEN = 'none';

// The i18n keys the painter resolves (named so there is no bare string literal in
// the paint body and the completeness sweep can find them).
const K = {
  vitality: 'hudChrome.gauntlet.vitality',
  survivorsAria: 'hudChrome.gauntlet.survivorsAria',
  prizeAria: 'hudChrome.gauntlet.prizeAria',
  trialLabel: 'hudChrome.gauntlet.trialLabel',
  go: 'hudChrome.gauntlet.go',
  stop: 'hudChrome.gauntlet.stop',
  phaseLobby: 'hudChrome.gauntlet.phaseLobby',
  phaseStaging: 'hudChrome.gauntlet.phaseStaging',
  phaseInterlude: 'hudChrome.gauntlet.phaseInterlude',
  phasePodium: 'hudChrome.gauntlet.phasePodium',
  echoRound: 'hudChrome.gauntlet.echoRound',
  echoSeconds: 'hudChrome.gauntlet.echoSeconds',
  roleAttacker: 'hudChrome.gauntlet.roleAttacker',
  roleDefender: 'hudChrome.gauntlet.roleDefender',
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
  /** The survivors chip ("N / M" + accessible label). */
  survivors: HTMLElement;
  /** The prize-pool chip (localized money). */
  prize: HTMLElement;
  /** The sentinel light pill (green/red + Go/Stop text). */
  light: HTMLElement;
  /** The per-trial teaching line under the meta row. */
  hint: HTMLElement;
  /** The Keeper's Echo strip (shown only during a live duel). */
  echoStrip: HTMLElement;
  /** The "Round N of M" chip. */
  echoRound: HTMLElement;
  /** The answer-window countdown chip (hidden while the stones flash). */
  echoClock: HTMLElement;
  /** The Final Court sub-cluster (shown only during the court trial). */
  court: HTMLElement;
  /** The attacker/defender role chip (the shove itself is a click on the
   *  rival in the world; there is no button). */
  courtRole: HTMLElement;
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

    const survivors = formatNumber(model.survivors, INT);
    const total = formatNumber(model.total, INT);
    w.setText(this.el.survivors, `${survivors} / ${total}`);
    w.setAttr(this.el.survivors, 'aria-label', t(K.survivorsAria, { count: survivors, total }));

    const money = formatMoney(model.prizePool);
    w.setText(this.el.prize, money);
    w.setAttr(this.el.prize, 'aria-label', t(K.prizeAria, { amount: money }));

    w.setDisplay(this.el.light, model.showLight ? SHOWN : HIDDEN);
    if (model.showLight) {
      const red = model.light === 'red';
      w.toggleClass(this.el.light, LIGHT_RED_CLASS, red);
      w.toggleClass(this.el.light, LIGHT_GREEN_CLASS, !red);
      w.setText(this.el.light, red ? t(K.stop) : t(K.go));
    }

    w.setDisplay(this.el.hint, model.hint ? SHOWN_BLOCK : HIDDEN);
    if (model.hint) w.setText(this.el.hint, t(HINT_KEYS[model.hint]));

    w.setDisplay(this.el.echoStrip, model.echo ? SHOWN : HIDDEN);
    if (model.echo) this.paintEcho(model.echo);

    w.setDisplay(this.el.court, model.court ? SHOWN : HIDDEN);
    if (model.court) this.paintCourt(model.court);
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

  private paintCourt(court: NonNullable<GauntletHudModel['court']>): void {
    const w = this.writers;
    w.setText(this.el.courtRole, court.attacker ? t(K.roleAttacker) : t(K.roleDefender));
    w.toggleClass(this.el.court, ATTACKER_CLASS, court.attacker);
    w.toggleClass(this.el.court, DEFENDER_CLASS, !court.attacker);
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

  private readout(value: number, max: number): string {
    return `${formatNumber(value, INT)} / ${formatNumber(max, INT)}`;
  }

  private pct(frac: number): string {
    return `${(frac * 100).toFixed(PERCENT_FRACTION_DIGITS)}%`;
  }
}
