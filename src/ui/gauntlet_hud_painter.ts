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
// Tug-of-war winning/losing state classes (colors live in CSS).
const WINNING_CLASS = 'winning';
const LOSING_CLASS = 'losing';
// Court role state classes (drives the attacker/defender chip color in CSS).
const ATTACKER_CLASS = 'attacker';
const DEFENDER_CLASS = 'defender';
// A shove button on cooldown: pointer-events off + dimmed via CSS.
const DISABLED_CLASS = 'gh-disabled';
// Custom properties the pull/court sub-clusters read for positioned overlays.
const BEAT_VAR = '--gh-beat'; // metronome sweep cursor, 0..1
const TUG_VAR = '--gh-tug'; // rope knob, 0..1 (0.5 = centered)
const CD_VAR = '--gh-cd'; // shove cooldown fill, 0..1
// Fraction-digit precision for the positioned custom properties.
const FRAC_DIGITS = 3;
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
  pull: 'hudChrome.gauntlet.pull',
  pullRope: 'hudChrome.gauntlet.pullRope',
  shove: 'hudChrome.gauntlet.shove',
  roleAttacker: 'hudChrome.gauntlet.roleAttacker',
  roleDefender: 'hudChrome.gauntlet.roleDefender',
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
  /** The Great Pull sub-cluster (shown only during the pull trial). */
  pull: HTMLElement;
  /** The tug-of-war rope track (role=progressbar; winning/losing class). */
  pullTug: HTMLElement;
  /** The rope knob, positioned across the track by the --gh-tug custom prop. */
  pullTugKnob: HTMLElement;
  /** The sweeping metronome cursor, positioned by the --gh-beat custom prop. */
  pullCursor: HTMLElement;
  /** The big on-beat PULL button. */
  pullBtn: HTMLElement;
  /** The Final Court sub-cluster (shown only during the court trial). */
  court: HTMLElement;
  /** The attacker/defender role chip. */
  courtRole: HTMLElement;
  /** The SHOVE button. */
  courtBtn: HTMLElement;
  /** The shove-cooldown fill, sized by the --gh-cd custom prop. */
  courtCd: HTMLElement;
}

/** The Hud glue the interactive pull/court buttons dispatch through. */
export interface GauntletHudDeps {
  /** Fire an on-beat pull (Hud derives the beat index from the live run + time). */
  onPull(): void;
  /** Throw a shove (Hud gates it on the shove cooldown before sending). */
  onShove(): void;
}

export class GauntletHudPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly el: GauntletHudElements,
    deps: GauntletHudDeps,
  ) {
    // One-time click wiring (the painter is constructed once). The buttons live
    // inside the pointer-events:none cluster and opt back into pointer events via
    // CSS; both dispatches are gated Hud-side (the shove against its cooldown).
    this.el.pullBtn.addEventListener('click', () => deps.onPull());
    this.el.courtBtn.addEventListener('click', () => deps.onShove());
  }

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

    w.setDisplay(this.el.pull, model.pull ? SHOWN : HIDDEN);
    if (model.pull) this.paintPull(model.pull);

    w.setDisplay(this.el.court, model.court ? SHOWN : HIDDEN);
    if (model.court) this.paintCourt(model.court);
  }

  private paintPull(pull: NonNullable<GauntletHudModel['pull']>): void {
    const w = this.writers;
    // Rope knob: map the signed tug fraction (-1..1) onto 0..1 across the track.
    const knob = 0.5 + pull.tugFrac * 0.5;
    w.setStyleProp(this.el.pullTugKnob, TUG_VAR, knob.toFixed(FRAC_DIGITS));
    w.setStyleProp(this.el.pullCursor, BEAT_VAR, pull.beatPhase.toFixed(FRAC_DIGITS));
    w.toggleClass(this.el.pullTug, WINNING_CLASS, pull.winning);
    w.toggleClass(this.el.pullTug, LOSING_CLASS, !pull.winning);
    w.setAttr(this.el.pullTug, 'aria-valuenow', String(Math.round(knob * 100)));
    w.setAttr(this.el.pullTug, 'aria-label', t(K.pullRope));
    w.setText(this.el.pullBtn, t(K.pull));
    w.setAttr(this.el.pullBtn, 'aria-label', t(K.pull));
  }

  private paintCourt(court: NonNullable<GauntletHudModel['court']>): void {
    const w = this.writers;
    w.setText(this.el.courtRole, court.attacker ? t(K.roleAttacker) : t(K.roleDefender));
    w.toggleClass(this.el.court, ATTACKER_CLASS, court.attacker);
    w.toggleClass(this.el.court, DEFENDER_CLASS, !court.attacker);
    w.setText(this.el.courtBtn, t(K.shove));
    w.setAttr(this.el.courtBtn, 'aria-label', t(K.shove));
    // Kept focusable but non-actionable during cooldown: aria-disabled + a class
    // that drops pointer events (a real `disabled` would fight the elided writers
    // and drop the button from the a11y tree mid-trial).
    w.toggleClass(this.el.courtBtn, DISABLED_CLASS, !court.shoveReady);
    w.setAttr(this.el.courtBtn, 'aria-disabled', court.shoveReady ? 'false' : 'true');
    w.setStyleProp(this.el.courtCd, CD_VAR, court.cooldownFrac.toFixed(FRAC_DIGITS));
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
