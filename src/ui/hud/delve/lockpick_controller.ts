import type { Ante, LootTier, PickAction, StepResult } from '../../../sim/lockpick';
import { PICK_ACTIONS } from '../../../sim/lockpick';
import type { SimEvent } from '../../../sim/types';
import type { LockpickView } from '../../../world_api';
import type { FocusTrapHandle } from '../../focus_manager';
import { t } from '../../i18n';
import { PICK_ACTION_HOTKEYS } from './lockpick_panel';
import { LockpickWindow } from './lockpick_window';

export interface LockpickControllerDeps {
  panel: HTMLElement;
  keyboardTarget: Window;
  openFocusTrap(): FocusTrapHandle;
  getState(): LockpickView | null;
  engage(objectId: number, ante: Ante): void;
  act(action: PickAction): void;
  abort(): void;
  drainEvents(): SimEvent[] | null;
  handleEvents(events: SimEvent[]): void;
  showBanner(text: string): void;
  log(text: string, color: string): void;
  hideTooltip(): void;
}

/** Owns lockpick panel state, focus, keyboard input, and authoritative command routing. */
export class LockpickController {
  private trap: FocusTrapHandle | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  /** The session `requestClose` has already asked the server to withdraw from. A repeat
   *  request for that same session re-sends the abort ONCE as a hedge and then closes,
   *  rather than withdrawing and waiting forever on an answer that may never come. Keyed on
   *  the id rather than a bare flag so a fresh engage can never inherit a stale one. */
  private withdrawnSessionId: string | null = null;
  private readonly window: LockpickWindow;

  constructor(private readonly deps: LockpickControllerDeps) {
    this.window = new LockpickWindow({
      panel: () => this.deps.panel,
      getState: () => this.deps.getState(),
      tierName: (tier) => this.tierName(tier),
      onEngage: (objectId, ante) => this.submitEngage(objectId, ante),
      onAction: (action) => this.submitAction(action),
      onAbort: () => this.submitAbort(),
      onClose: () => this.close(),
    });
  }

  openAnte(objectId: number, bountiful = false): void {
    this.openPanel();
    this.window.renderAnte(objectId, bountiful);
    this.trap?.focusFirst('.lp-ante-btn');
  }

  openBoard(): void {
    this.openPanel();
    this.window.openBoard();
  }

  onStep(result: StepResult): void {
    this.window.onStep(result);
  }

  repaintIfChanged(): void {
    this.window.repaintIfChanged();
  }

  end(outcome: 'success' | 'fail' | 'abandoned', tier?: LootTier): void {
    const summary =
      outcome === 'success'
        ? tier
          ? t('lockpickUi.summary.success', { tier: this.tierName(tier) })
          : t('lockpickUi.summary.successGeneric')
        : outcome === 'fail'
          ? t('lockpickUi.summary.fail')
          : t('lockpickUi.summary.abandoned');
    if (outcome === 'success') this.deps.showBanner(summary);
    this.deps.log(
      summary,
      outcome === 'success' ? '#7fdc4f' : outcome === 'fail' ? '#ff7a6a' : '#ccc',
    );
    this.close();
  }

  flushEvents(): void {
    const events = this.deps.drainEvents();
    if (events && events.length > 0) this.deps.handleEvents(events);
  }

  submitEngage(objectId: number, ante: Ante): void {
    this.deps.engage(objectId, ante);
    this.flushEvents();
  }

  submitAction(action: PickAction): void {
    this.deps.act(action);
    this.flushEvents();
    this.window.repaintIfChanged();
  }

  submitAbort(): void {
    this.window.stopTimer();
    this.deps.abort();
    this.flushEvents();
  }

  /** The dismissal funnel for every caller that has to CHOOSE an arm: withdraw from a live
   *  lock, or just close the ante selector when there is nothing left to withdraw from. The
   *  panel's own buttons do not come through here and do not need to, because each one is
   *  bound to the arm its markup already implies (the board's X and Withdraw to onAbort, the
   *  ante selector's X to onClose); the capture-phase Escape handler below and the HUD's
   *  managed-window case are the callers that face either markup, and they share this.
   *
   *  It is a named method rather than inline because a THIRD caller needs it and cannot
   *  reach the handler: `Hud.closeManagedWindow`'s `lockpick-panel` case. A gamepad escape
   *  goes `main.ts dispatchGamepadAction('escape') -> hud.closeAll()` with no DOM event for
   *  a keydown listener to intercept, so before #2517 that path fell to the managed-window
   *  `default:` arm (a bare `display: none`), leaving the 100ms countdown running against a
   *  hidden subtree, the focus trap armed on an invisible panel, and the session live on the
   *  server, which then burned the tries out and FORFEITED the chest a withdrawal preserves.
   *
   *  WITHDRAW, THEN RE-SEND ONCE AND CLOSE. `submitAbort()` deliberately does not hide the
   *  panel: the close comes from the authoritative lockpickEnd, which offline the sim emits
   *  and `flushEvents()` drains inside this very call, but ONLINE is a wire command whose
   *  answer is a frame away. So online the panel is still up when `requestClose` returns, and
   *  a caller that asks again would withdraw forever. `SkinEventController.open()` is exactly
   *  that caller: it sweeps `for (i < 20 && closeTop())` to clear the stack before a roll
   *  reveal, and without the latch it would spin all 20 iterations here and never reach the
   *  windows underneath. Latching also unwedges the panel when the answer never comes at all:
   *  `ClientWorld.lockpickState` is rebuilt purely from events and is not reset on reconnect,
   *  so a stale one would otherwise leave a board that no input could dismiss. The repeat arm
   *  hedges with a second abort before it closes, because a dropped first send and one still
   *  in flight look identical from here; see the comment on that arm for why. */
  requestClose(): void {
    const live = this.deps.getState();
    if (live && live.sessionId !== this.withdrawnSessionId) {
      this.withdrawnSessionId = live.sessionId;
      this.submitAbort();
      return;
    }
    // A repeat request for a session we already asked to withdraw from means the answer
    // never came, and only one of the two reasons is benign. Either the abort is still in
    // flight (the re-send is a server-side no-op: the sim's lockpickAbort returns early once
    // run.lockpick is null), or it was never sent at all, because ClientWorld.rawCmd DROPS
    // on a closed socket with no queue and no retry. Closing without asking again in that
    // second case hides a board the server still considers live and lets the per-step clock
    // burn the tries down to lockpickFail, which is #2517's forfeited chest arriving by the
    // other road. So close, then ask once more, which keeps the repeat callers (the closeTop
    // sweep) advancing at a cost of two commands per dismissal on this path.
    //
    // CLOSE FIRST, and the order is load-bearing rather than tidy: submitAbort ends in
    // flushEvents, which runs the whole Hud.handleEvents switch, and two of its arms
    // (lockpickOffer, lockpickSession) call openPanel and put this panel back up. Closing
    // afterwards would tear down a board the drain had just legitimately opened.
    this.close();
    if (live) this.submitAbort();
  }

  close(restoreFocus = true): void {
    this.deps.panel.style.display = 'none';
    this.window.close();
    this.deps.hideTooltip();
    if (this.keyHandler) {
      this.deps.keyboardTarget.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.trap?.release(restoreFocus);
    this.trap = null;
  }

  private openPanel(): void {
    // A fresh ante selector or board is a fresh dismissal. Belt to the id keying's braces:
    // every ordinary re-engage already gets a different sessionId, so the comparison in
    // requestClose alone would do. What this covers is the one case it cannot, an id
    // COLLISION: the sim mints `lp_${objectId}_${ctx.tickCount}`, so a withdraw and a
    // re-engage on the same chest inside one tick produce the same string. Without the reset
    // that second board would take the REPEAT arm on its very first dismissal, closing
    // optimistically instead of withdrawing and waiting for the server to confirm.
    this.withdrawnSessionId = null;
    if (this.deps.panel.style.display !== 'block') this.trap = this.deps.openFocusTrap();
    this.deps.panel.style.display = 'block';
    this.bindKeys();
  }

  private bindKeys(): void {
    if (this.keyHandler) return;
    const handler = (event: KeyboardEvent): void => {
      if (this.deps.panel.style.display !== 'block') return;
      const live = this.deps.getState();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.requestClose();
        return;
      }
      if (!live || event.repeat) return;
      const index = (PICK_ACTION_HOTKEYS as readonly string[]).indexOf(event.key.toLowerCase());
      if (index < 0) return;
      const action = PICK_ACTIONS[index];
      if (!live.allowed.includes(action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.submitAction(action);
    };
    this.keyHandler = handler;
    this.deps.keyboardTarget.addEventListener('keydown', handler, true);
  }

  private tierName(tier: LootTier): string {
    return t(
      tier === 'premium'
        ? 'sim.lockpick.tierPremium'
        : tier === 'medium'
          ? 'sim.lockpick.tierMedium'
          : 'sim.lockpick.tierLow',
    );
  }
}
