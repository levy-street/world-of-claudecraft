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
import { markDialogRoot } from '../../dialog_root';
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
// The countdown's one decimal. `toFixed(1)` rendered `12.3` in every locale, where ru_RU and
// de want a comma; English output is byte-identical through formatNumber either way.
const NUM1 = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false } as const;

/** The three countdown nodes `renderBoard` emits, resolved once per board paint. */
interface TimerEls {
  readonly bar: HTMLElement;
  readonly value: HTMLElement;
  readonly wrap: HTMLElement;
}

export class LockpickWindow {
  private timerGen = 0;
  private timerInterval: number | null = null;
  private lastSig = '';
  private lastTimerKey = '';
  // The ante selector's own inputs, retained only so a language switch can
  // repaint it (see renderAnte); null whenever the selector is not what the
  // panel is showing.
  private ante: { objectId: number; coffer: boolean } | null = null;
  // The live clock's deadline, retained so a rebuild that does NOT restart the
  // clock can still paint the bar at where the clock actually is (see
  // relocalize); null whenever no clock is running.
  private timerDeadline: { end: number; seconds: number } | null = null;
  // The countdown's element refs, and the urgent-class latch that rides with them.
  //
  // RESOLVED PER BOARD PAINT, not once at construction, and that distinction is the whole
  // reason this is not the ordinary "cache refs in the constructor" of src/ui/CLAUDE.md.
  // renderBoard() replaces the panel's entire subtree, and it runs on a DIFFERENT trigger
  // than the clock does: lockpickRenderSig covers `row` and `visible.length` while
  // lockpickTimerKey (sessionId:page:tries:col) covers neither, so moving the pick up a row
  // or revealing fog rebuilds these three nodes WITHOUT restarting the interval. Refs taken
  // at startTimer() would then paint into a detached subtree and the bar would freeze for the
  // rest of the attempt. Re-resolving here, at the one innerHTML site that destroys them,
  // keeps that correct while taking the three querySelector walks off the 10 Hz path.
  private timerEls: TimerEls | null = null;
  private lastUrgent = false;

  constructor(private readonly deps: LockpickWindowDeps) {}

  private panel(): HTMLElement | null {
    return this.deps.panel?.() ?? document.getElementById('lockpick-panel');
  }

  // --- Ante selector -------------------------------------------------------

  /** Paint the three-ante engage selector (one ante for a Bountiful Coffer). */
  renderAnte(objectId: number, coffer: boolean): void {
    const el = this.panel();
    if (!el) return;
    // Retained so relocalize() can repaint this half of the panel. The ante
    // selector is the state where getState() is still null (the player opened
    // the chest and has not picked an ante yet), so the board path below cannot
    // reach it, and a language switch spent staring at the selector would
    // otherwise leave every one of its labels in the old locale.
    this.ante = { objectId, coffer };
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
    // A standalone trapping window: announce it as a labeled dialog for the
    // focus contract. Re-run on every ante/board repaint (including a
    // language-switch relocalize), so the accessible name never goes stale.
    markDialogRoot(el, { label: title });
    el.innerHTML =
      `<div class="panel-title"><span>${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('lockpickUi.closeAria'))}">${svgIcon('close')}</button></div>` +
      `<div class="lp-blurb${coffer ? ' lp-blurb-coffer' : ''}">${esc(blurb)}</div>` +
      `<div class="lp-ante-row${coffer ? ' lp-ante-row-coffer' : ''}">${buttons}</div>`;
    // The ante markup carries no countdown, so any refs from a previous board are stale.
    this.forgetTimerEls();
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
    // The guard repaintIfChanged already carries, and load-bearing since #2517 gave the panel
    // a close-while-the-session-is-live path: requestClose's repeat arm closes without waiting
    // for the server's lockpickEnd, so a lockpickStep still in flight would otherwise land
    // here, rewrite the hidden panel's markup, and (because close() cleared lastTimerKey)
    // restart the 100ms countdown against a subtree nobody can see. That is exactly the leak
    // this issue is about, arriving from the other direction.
    if (this.panel()?.style.display !== 'block') return;
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

  /**
   * Re-localize after an in-game language switch (the Hud's woc:languagechange
   * fan-out). Self-gated on the panel being up, so the fan-out can call it
   * unconditionally.
   *
   * BOTH halves of the panel need it, and they need different treatment.
   * The board's lockpickRenderSig is rows, columns, tries and the pick position,
   * all numbers, so a switch alone never moves it and the per-frame
   * repaintIfChanged above would leave the board in the old locale; clearing
   * forces exactly one renderBoard, which re-latches the signature in the same
   * call. The ante selector has no signature and no driver at all: it is painted
   * once by openAnte and sits there until the player chooses, so it repaints
   * straight from its retained inputs.
   */
  relocalize(): void {
    if (this.panel()?.style.display !== 'block') return;
    if (!this.deps.getState()) {
      if (this.ante) this.renderAnte(this.ante.objectId, this.ante.coffer);
      return;
    }
    this.lastSig = '';
    this.repaintIfChanged();
    // renderBoard re-emits the countdown at width:100% and the full-duration
    // label, and syncTimer correctly does NOT restart the clock (the timer key
    // did not move), so without this the bar would read a full budget until the
    // running interval's next tick. That is up to 100 ms of a TIMED minigame
    // showing the wrong remaining time, which is not something a cosmetic
    // repaint is allowed to do.
    const clock = this.timerDeadline;
    if (clock) {
      this.paintTimer(Math.max(0, (clock.end - performance.now()) / 1000), clock.seconds);
    }
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
      // The one exit from renderBoard that leaves the subtree alone. Dropping the refs here
      // is hygiene rather than behavior, like close()'s: every caller runs syncTimer() next,
      // which stops the clock on a null state, so nothing can paint afterwards. It is here
      // so the module upholds "the refs go wherever they stop being current" by itself
      // rather than leaning on that ordering.
      this.forgetTimerEls();
      this.deps.onClose();
      return;
    }
    this.lastSig = lockpickRenderSig(view);
    // The board markup replaces the ante selector's, so the retained selector
    // inputs stop being what the panel shows here (a stale pair would let a
    // relocalize repaint the selector back over a live board).
    this.ante = null;
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
          `<span class="lp-timer-value" id="lp-timer-value">${esc(t('lockpickUi.seconds', { seconds: formatNumber(timerSecs, NUM1) }))}</span></div>`
        : '';
    // Re-run every board repaint (a relocalize forces one via lastSig reset), so
    // the accessible name never goes stale against the last-painted lock tier.
    markDialogRoot(el, {
      label: t('lockpickUi.boardTitle', { tier: this.deps.tierName(view.lootTier) }),
    });
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
    this.cacheTimerEls(el);
  }

  /**
   * Re-point the countdown at the nodes this paint just created. Called at the END of
   * renderBoard, after the innerHTML write that destroyed the previous ones. A board with no
   * per-step budget emits no timer block, so the refs go null and paintTimer writes nothing.
   */
  private cacheTimerEls(el: HTMLElement): void {
    // By CLASS, not by the ids the markup also carries: this window is
    // instance-parameterized on deps.panel, so a second panel would make the ids collide
    // while a query scoped to the panel's own class stays correct.
    const bar = el.querySelector<HTMLElement>('.lp-timer-bar');
    const value = el.querySelector<HTMLElement>('.lp-timer-value');
    const wrap = el.querySelector<HTMLElement>('.lp-timer');
    this.timerEls = bar && value && wrap ? { bar, value, wrap } : null;
    // The fresh markup carries no urgent class, so the latch starts from that.
    this.lastUrgent = false;
  }

  /**
   * Drop the refs when the subtree they point into is gone or replaced.
   *
   * From `renderAnte()` this is a real behavior and is pinned: the ante selector replaces
   * the board's subtree and deliberately does NOT stop the clock, so stale refs would keep
   * being painted. From `close()` and from `renderBoard()`'s state-less exit it is hygiene
   * only, because both stop the clock (directly, or via the `syncTimer()` that follows), so
   * nothing can paint afterwards and no test can tell the difference. Said here rather than
   * left for the next reader to re-derive from three call sites.
   */
  private forgetTimerEls(): void {
    this.timerEls = null;
    this.lastUrgent = false;
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
    this.timerDeadline = { end, seconds };
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
    this.timerDeadline = null;
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * One tick of the countdown, 10x a second for the length of an attempt. Reads the refs
   * renderBoard cached rather than re-resolving them (three querySelector subtree walks per
   * tick before #2498). The width and the label move every tick by definition; the urgent
   * class flips at most once per attempt, so it rides a latch instead of a blind toggle.
   */
  private paintTimer(remaining: number, seconds: number): void {
    const els = this.timerEls;
    if (!els) return;
    els.bar.style.width = `${(remaining / seconds) * 100}%`;
    els.value.textContent = t('lockpickUi.seconds', { seconds: formatNumber(remaining, NUM1) });
    const urgent = remaining < 3;
    if (urgent !== this.lastUrgent) {
      this.lastUrgent = urgent;
      els.wrap.classList.toggle('lp-timer-urgent', urgent);
    }
  }

  /** Tear down on panel close: stop the clock and forget the last paint. */
  close(): void {
    this.stopTimer();
    this.forgetTimerEls();
    this.lastSig = '';
    this.lastTimerKey = '';
    this.ante = null;
  }
}
