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

import type { GauntletHudModel } from './gauntlet_hud_view';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';

// The green/red light-pill state classes (the fill color lives in CSS, never here).
const LIGHT_GREEN_CLASS = 'green';
const LIGHT_RED_CLASS = 'red';
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
} satisfies Record<string, TranslationKey>;

/** The DOM nodes one gauntlet HUD instance paints into. */
export interface GauntletHudElements {
  /** The cluster container (#gauntlet-hud): shown while a run is live. */
  root: HTMLElement;
  /** The phase / "Trial N of M" caption. */
  phase: HTMLElement;
  /** The vitality bar container (role=progressbar; aria-valuenow). */
  vitalityBar: HTMLElement;
  /** The vitality fill (width percent). */
  vitalityFill: HTMLElement;
  /** The vitality "value / max" readout. */
  vitalityText: HTMLElement;
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

    const vitalityText = this.readout(model.vitalityValue, model.vitalityMax);
    w.setWidth(this.el.vitalityFill, this.pct(model.vitalityFrac));
    w.setText(this.el.vitalityText, vitalityText);
    w.setAttr(this.el.vitalityBar, 'aria-valuenow', String(Math.round(model.vitalityFrac * 100)));
    w.setAttr(this.el.vitalityBar, 'aria-label', `${t(K.vitality)} ${vitalityText}`);

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
