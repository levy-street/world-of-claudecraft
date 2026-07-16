// "Tumbler's Path" lockpick window: the thin DOM consumer that paints
// #lockpick-panel (ante selector + live board) and owns the per-page countdown.
// It composes the pure view model in lockpick_panel.ts and renders every
// player-visible string through the lockpickUi.* t() keys.
//
// One source of truth: the board is ALWAYS painted from the authoritative
// world.lockpickState (injected as deps.getState()), never from a cached copy.
// That is what kills the old desync/jam bugs: there is no second copy of the
// position to drift. Transient step feedback (the toast tone/text) is the only
// thing driven by the lockpickStep result, because the result enum is not
// derivable from state alone. hud.ts owns open/close orchestration, focus, and
// keybinds; this module owns paint + the DISPLAY countdown and talks back through
// `deps`.
//
// The countdown is render-only. The per-step clock is SERVER-AUTHORITATIVE: the
// sim enforces the timeout on its tick (from the authoritative view.stepTimeoutMs)
// and emits the burn as a lockpickStep, identical offline, online, and headless.
// This module never reports a timeout; when the bar hits 0 it just holds there
// until that authoritative event re-anchors (a fresh try/page) or ends it. A
// generation guard (every (re)start bumps `timerGen`) means an in-flight interval
// from a superseded clock no-ops, so a page transition, a fresh try, an abort, or
// a close can never let an old timer paint a stale bar.

import type { Ante, LootTier, PickAction, StepResult } from '../../../sim/lockpick';
import type { LockpickView } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import {
  anteOptions,
  lockpickActionButtons,
  lockpickBoardModel,
  lockpickRenderSig,
  lockpickTimerKey,
  pageDots,
  stepFeedback,
} from './lockpick_panel';

/** Callbacks + reads the window needs from the HUD. It never imports Hud or a
 * concrete world; the HUD wires these to IWorld + its own orchestration. */
export interface LockpickWindowDeps {
  /** Resolve the owned panel without relying on a global document. */
  panel?(): HTMLElement | null;
  /** The authoritative fogged view (world.lockpickState), or null when idle. */
  getState(): LockpickView | null;
  /** Localized loot-tier name (shares the sim.lockpick.tier* keys). */
  tierName(tier: LootTier): string;
  /** Player chose an ante in the selector. */
  onEngage(objectId: number, ante: Ante): void;
  /** Player picked a depth action on the board. */
  onAction(action: PickAction): void;
  /** Player withdrew (closes a live session, preserving the attempt). */
  onAbort(): void;
  /** Close the panel with no live session (ante selector dismissed). */
  onClose(): void;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

export class LockpickWindow {
  private timerGen = 0;
  private timerInterval: number | null = null;
  private lastSig = '';
  private lastTimerKey = '';

  constructor(private readonly deps: LockpickWindowDeps) {}

  private panel(): HTMLElement | null {
    return this.deps.panel?.() ?? document.getElementById('lockpick-panel');
  }

  // --- Ante selector -------------------------------------------------------

  /** Paint the three-ante engage selector (one ante for a Bountiful Coffer). */
  renderAnte(objectId: number, coffer: boolean): void {
    const el = this.panel();
    if (!el) return;
    this.lastSig = '';
    const buttons = anteOptions(coffer)
      .map(
        (o) =>
          `<button type="button" class="lp-ante-btn" data-ante="${o.ante}">` +
          `<span class="lp-ante-tier">${esc(t('lockpickUi.cache', { tier: this.deps.tierName(o.tier) }))}</span>` +
          `<span class="lp-ante-badges">` +
          `<span class="lp-ante-pages" aria-label="${esc(t('lockpickUi.pagesAria', { count: formatNumber(o.pages, NUM0) }))}">${esc(formatNumber(o.pages, NUM0))}</span>` +
          `<span class="lp-ante-tries">${esc(o.tries > 1 ? t('lockpickUi.tries', { count: formatNumber(o.tries, NUM0) }) : t('lockpickUi.triesOne'))}</span>` +
          `</span>` +
          `<span class="lp-ante-timer">${esc(t('lockpickUi.perMove', { seconds: formatNumber(o.timerSeconds, NUM0) }))}</span>` +
          `</button>`,
      )
      .join('');
    const title = coffer ? t('lockpickUi.cofferTitle') : t('lockpickUi.pickTitle');
    const blurb = coffer ? t('lockpickUi.cofferBlurb') : t('lockpickUi.pickBlurb');
    el.innerHTML =
      `<div class="panel-title"><span>${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('lockpickUi.closeAria'))}">${svgIcon('close')}</button></div>` +
      `<div class="lp-blurb${coffer ? ' lp-blurb-coffer' : ''}">${esc(blurb)}</div>` +
      `<div class="lp-ante-row${coffer ? ' lp-ante-row-coffer' : ''}">${buttons}</div>`;
    el.querySelectorAll('[data-ante]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ante = Number((btn as HTMLElement).dataset.ante) as Ante;
        this.deps.onEngage(objectId, ante);
      });
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.deps.onClose());
  }

  // --- Live board ----------------------------------------------------------

  /** First paint of a freshly opened board, plus its full-length clock. */
  openBoard(): void {
    this.lastTimerKey = '';
    this.renderBoard();
    this.syncTimer();
  }

  /** Apply a step result: repaint with its feedback toast, then let the clock
   * follow the authoritative state (a new pin/try/page refills it; the lock
   * ending stops it). Driven by the lockpickStep event in both hosts. */
  onStep(result: StepResult): void {
    const fb = stepFeedback(result);
    // stepFeedback returns English text only for the known step results; localize
    // those via t() and leave the (empty) default unlocalized.
    this.renderBoard(fb.text ? t(`lockpickUi.feedback.${result}` as TranslationKey) : '', fb.tone);
    this.syncTimer();
  }

  /** Per-frame safety net: realign the DOM AND the clock to authoritative state
   * if anything moved the position without going through onStep (keeps offline +
   * online in lockstep no matter how state arrived). Cheap: repaints only on a
   * sig change, restarts the clock only on a timer-key change. */
  repaintIfChanged(): void {
    const el = this.panel();
    if (el?.style.display !== 'block') return;
    const view = this.deps.getState();
    if (!view) return;
    if (lockpickRenderSig(view) !== this.lastSig) this.renderBoard();
    this.syncTimer();
  }

  /** Refill the per-page clock whenever the timed move changes (a new pin, try,
   * page, or session); stop it when the lock ends. State-driven so a correct move
   * ALWAYS rewinds the clock to full, regardless of how/when events were drained. */
  private syncTimer(): void {
    const view = this.deps.getState();
    if (!view) {
      this.lastTimerKey = '';
      this.stopTimer();
      return;
    }
    const key = lockpickTimerKey(view);
    if (key !== this.lastTimerKey) {
      this.lastTimerKey = key;
      this.startTimer();
    }
  }

  private renderBoard(feedback = '', tone: 'good' | 'bad' | 'win' = 'good'): void {
    const el = this.panel();
    if (!el) return;
    const view = this.deps.getState();
    if (!view) {
      this.deps.onClose();
      return;
    }
    this.lastSig = lockpickRenderSig(view);
    const m = lockpickBoardModel(view);
    const rowH = (r: number): string => `${(r / Math.max(1, m.h - 1)) * 100}%`;
    // Tumbler tracks: one brass column per lock column. Only lit wards (open /
    // gate / seat / trap) show as notches; the rest of the face is solid metal.
    // Fogged columns are a covered plate. The pick marker rides the active track.
    let tracks = '';
    for (const c of m.columns) {
      let notches = '';
      for (const n of c.notches) {
        notches += `<span class="lp-notch lp-notch-${n.kind}" style="top:${rowH(n.row)}"></span>`;
      }
      const marker =
        c.markerRow !== null
          ? `<span class="lp-pick" style="top:${rowH(c.markerRow)}"></span>`
          : '';
      tracks +=
        `<div class="lp-track lp-track-${c.state}${c.isGate ? ' lp-track-gate' : ''}">` +
        `<div class="lp-track-face">${notches}${marker}</div></div>`;
    }
    const dots = pageDots(view.page, view.pageCount)
      .map((d) => `<span class="lp-page-dot lp-page-${d}"></span>`)
      .join('');
    const actions = lockpickActionButtons(view.allowed)
      .map(
        (b) =>
          `<button type="button" class="lp-action-btn"` +
          ` data-action="${esc(b.action)}"${b.enabled ? '' : ' disabled'}>` +
          `<span class="lp-action-key">${esc(b.key)}</span>` +
          `<span class="lp-action-glyph">${b.glyph}</span>` +
          `<span class="lp-action-label">${esc(t(`lockpickUi.action.${b.action}` as TranslationKey))}</span></button>`,
      )
      .join('');
    const page = formatNumber(view.page, NUM0);
    const total = formatNumber(view.pageCount, NUM0);
    const tries = formatNumber(view.tries, NUM0);
    const triesTotal = formatNumber(view.triesTotal, NUM0);
    // The per-step budget is authoritative (view.stepTimeoutMs from the sim); a
    // null budget means no clock, so the bar is simply not drawn.
    const timerSecs = view.stepTimeoutMs != null ? view.stepTimeoutMs / 1000 : null;
    const timerBlock =
      timerSecs != null
        ? `<div class="lp-timer" aria-label="${esc(t('lockpickUi.timerAria'))}"><div class="lp-timer-track"><div class="lp-timer-bar" id="lp-timer-bar" style="width:100%"></div></div>` +
          `<span class="lp-timer-value" id="lp-timer-value">${esc(t('lockpickUi.seconds', { seconds: timerSecs.toFixed(1) }))}</span></div>`
        : '';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('lockpickUi.boardTitle', { tier: this.deps.tierName(view.lootTier) }))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('lockpickUi.withdrawAria'))}">${svgIcon('close')}</button></div>` +
      `<div class="lp-status"><span class="lp-pages" aria-label="${esc(t('lockpickUi.lockOfAria', { page, total }))}">${dots}` +
      `<span class="lp-pages-label">${esc(t('lockpickUi.lockOf', { page, total }))}</span></span>` +
      `<span class="lp-tries" aria-label="${esc(t('lockpickUi.triesOfAria', { tries, total: triesTotal }))}">${esc(t('lockpickUi.triesOf', { tries, total: triesTotal }))}</span>` +
      `<span class="lp-col">${esc(t('lockpickUi.ward', { col: formatNumber(m.activeCol + 1, NUM0), total: formatNumber(m.w, NUM0) }))}</span></div>` +
      timerBlock +
      `<div class="lp-board" style="grid-template-columns:repeat(${m.w},1fr)">${tracks}</div>` +
      `<div class="lp-feedback lp-tone-${tone}" role="status" aria-live="polite">${esc(feedback)}</div>` +
      `<div class="lp-actions-hint">${esc(t('lockpickUi.depthKeys'))}</div>` +
      `<div class="lp-actions">${actions}</div>` +
      `<button type="button" class="btn lp-withdraw" data-withdraw>${esc(t('lockpickUi.withdraw'))}</button>`;
    el.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if ((btn as HTMLButtonElement).disabled) return;
        this.deps.onAction((btn as HTMLElement).dataset.action as PickAction);
      });
    });
    el.querySelector('[data-withdraw]')?.addEventListener('click', () => this.deps.onAbort());
    el.querySelector('[data-close]')?.addEventListener('click', () => this.deps.onAbort());
  }

  // --- Countdown (generation-guarded) --------------------------------------

  /** (Re)start the DISPLAY countdown from the authoritative per-step budget
   * (view.stepTimeoutMs). This is render-only: it never decides the outcome. The
   * SIM enforces the real timeout on its tick and emits the burn as a
   * lockpickStep, which re-anchors (retry) or ends (fail) this bar. When the bar
   * reaches 0 we just hold it there and wait for that authoritative event; we
   * never report a timeout to the server. performance.now() is fine here (UI
   * interpolation between authoritative updates, not gameplay logic). A null
   * budget means no clock. Any prior clock is invalidated by the generation bump. */
  private startTimer(): void {
    const view = this.deps.getState();
    if (!view || view.stepTimeoutMs == null) {
      this.stopTimer();
      return;
    }
    const seconds = view.stepTimeoutMs / 1000;
    const gen = ++this.timerGen;
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    const end = performance.now() + seconds * 1000;
    this.paintTimer(seconds, seconds);
    this.timerInterval = window.setInterval(() => {
      if (gen !== this.timerGen) return; // superseded by a newer clock
      const remaining = Math.max(0, (end - performance.now()) / 1000);
      this.paintTimer(remaining, seconds);
      if (remaining <= 0) this.stopTimer(); // hold at 0; the sim sends the burn
    }, 100);
  }

  /** Stop the clock and invalidate any in-flight callback. */
  stopTimer(): void {
    this.timerGen++;
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private paintTimer(remaining: number, seconds: number): void {
    const panel = this.panel();
    const bar = panel?.querySelector<HTMLElement>('#lp-timer-bar') ?? null;
    if (bar) bar.style.width = `${(remaining / seconds) * 100}%`;
    const val = panel?.querySelector<HTMLElement>('#lp-timer-value') ?? null;
    if (val) val.textContent = t('lockpickUi.seconds', { seconds: remaining.toFixed(1) });
    const wrap = panel?.querySelector<HTMLElement>('.lp-timer') ?? null;
    if (wrap) wrap.classList.toggle('lp-timer-urgent', remaining < 3);
  }

  /** Tear down on panel close: stop the clock and forget the last paint. */
  close(): void {
    this.stopTimer();
    this.lastSig = '';
    this.lastTimerKey = '';
  }
}
