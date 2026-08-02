// @vitest-environment jsdom

// The lockpick panel's managed-window close path (#2517).
//
// `#lockpick-panel` is a `.window.panel`, so `Hud.closeAll()` picks it up through
// `topmostOpenWindow()` and hands it to `closeManagedWindow`. With no `case` for its id it
// fell to the `default:` arm, which is `el.style.display = 'none'` and nothing else: the
// 100ms countdown interval kept firing into a hidden subtree for the rest of the attempt,
// the focus trap stayed armed on an invisible panel, and the live session was never
// withdrawn (the server kept burning the per-step clock on a board the player could not see).
//
// The keyboard Escape never showed this. `LockpickController` installs a capture-phase
// window keydown handler that calls `stopImmediatePropagation`, so Escape is handled by the
// controller and never reaches `src/game/input.ts`'s bubble listener at all. The GAMEPAD
// escape is the reachable path: `dispatchGamepadAction('escape')` in `src/main.ts` calls
// `hud.closeAll()` directly, with no DOM event for that capture handler to intercept.
//
// So these cases drive `closeAll()` (not a synthetic key event) over a REAL controller and a
// REAL window, and pin that the two dismissal paths produce the same observable teardown.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { Hud } from '../src/ui/hud';
import { LockpickController } from '../src/ui/hud/delve/lockpick_controller';
import type { LockpickView } from '../src/world_api';

const LIVE: LockpickView = {
  sessionId: 'lp_9_0',
  objectId: 9,
  w: 4,
  h: 4,
  col: 0,
  row: 2,
  page: 1,
  pageCount: 2,
  tries: 2,
  triesTotal: 2,
  lootTier: 'premium',
  allowed: ['set', 'steady', 'ease'],
  visible: [],
  stepTimeoutMs: 15000,
};

// Only the members closeAll -> closeManagedWindow actually read; closeManagedWindow is
// private, so the bare-prototype harness is the hud_confirm_gates / profession_tutorial
// precedent. `windowDragController` is deliberately left undefined: the real field is
// optional-chained, and Object.create skips field initializers.
interface CloseAllHarness {
  lockpickController: LockpickController;
  lootWindow: { hasOpenChest: boolean };
  playerCard: { isOpen: boolean };
  emoteWheelOpen: boolean;
  syncAnyWindowOpenState(): void;
  hideTooltip(): void;
  closeAll(): boolean;
  topmostOpenWindow(): HTMLElement | null;
}

// Every controller a case builds, so afterEach can drop its capture-phase window keydown
// listener. Without this a controller left OPEN by one case (which is exactly what the bug
// under test does) keeps a live handler on the shared jsdom window, and its
// stopImmediatePropagation eats the next case's Escape before the new controller sees it.
const built: LockpickController[] = [];

/**
 * @param host which IWorld the deps model, and the distinction is the whole point.
 *   'online' (the default): `abort` only sends, so `getState()` keeps returning the live view
 *   and the panel is still up when requestClose returns, exactly like ClientWorld waiting on
 *   the server's lockpickEnd. 'offline': `abort` does what Sim does, emitting lockpickEnd
 *   into the drain that `submitAbort`'s own `flushEvents()` reads, so the whole teardown
 *   lands inside the one closeAll call.
 */
function harness(initial: LockpickView | null, host: 'online' | 'offline' = 'online') {
  // closeAll reads #ctx-menu and #delve-rite-panel before it ever reaches the topmost
  // scan, and `$` returns null for a missing id, so both must exist.
  document.body.innerHTML =
    '<div id="ctx-menu" style="display:none"></div>' +
    '<div id="delve-rite-panel" class="window panel" style="display:none"></div>' +
    '<div id="lockpick-panel" class="window panel" style="display:none"></div>';
  const panel = document.getElementById('lockpick-panel') as HTMLElement;
  const release = vi.fn();
  const trap: FocusTrapHandle = { focusFirst: vi.fn(), release, opener: vi.fn(() => null) };
  // Two spies for ATTRIBUTION only. Production wires the dep as
  // `hideTooltip: () => this.hideTooltip()` where the controller is built, so in the client
  // these ARE one call; splitting them here lets a case say which caller owed the hide, and
  // never claims the two can diverge.
  const hudHideTooltip = vi.fn();
  const depsHideTooltip = vi.fn();
  let state: LockpickView | null = initial;
  let pending: SimEvent[] = [];
  const queued: SimEvent[] = [];
  const abort = vi.fn(() => {
    if (queued.length > 0) {
      pending.push(...queued.splice(0));
      return;
    }
    if (host !== 'offline') return;
    // What src/sim/delves/lockpick_controller.ts does: ABANDON the session and emit, both
    // synchronously, so drainEvents returns it inside the same call stack.
    state = null;
    pending.push({ type: 'lockpickEnd', sessionId: LIVE.sessionId, outcome: 'abandoned' });
  });
  const controller = new LockpickController({
    panel,
    keyboardTarget: window,
    openFocusTrap: () => trap,
    getState: () => state,
    engage: vi.fn(),
    act: vi.fn(),
    abort,
    drainEvents: () => {
      const out = pending;
      pending = [];
      return out;
    },
    // The one arm of Hud.handleEvents this path reaches, transcribed from
    // src/ui/hud.ts's `case 'lockpickEnd': this.endLockpick(...)` ->
    // controller.end(outcome, tier, sessionId). Transcribed, NOT pinned: no guard ties this
    // fake to that switch, so a rewrite there would leave these cases green against a mapping
    // the client no longer has.
    handleEvents: (events) => {
      for (const ev of events) {
        if (ev.type === 'lockpickEnd') controller.end(ev.outcome, undefined, ev.sessionId);
        // hud.ts's `case 'lockpickSession': this.openLockpickBoard()`. Faithful because the
        // repeat arm's statement ORDER depends on it: a drained event can re-open this panel.
        if (ev.type === 'lockpickSession') controller.openBoard();
      }
    },
    showBanner: vi.fn(),
    log: vi.fn(),
    hideTooltip: depsHideTooltip,
  });
  built.push(controller);
  const hud = Object.create(Hud.prototype) as unknown as CloseAllHarness;
  hud.lockpickController = controller;
  hud.lootWindow = { hasOpenChest: false };
  hud.playerCard = { isOpen: false };
  hud.emoteWheelOpen = false;
  hud.syncAnyWindowOpenState = vi.fn();
  hud.hideTooltip = hudHideTooltip;
  return {
    controller,
    hud,
    panel,
    release,
    abort,
    hudHideTooltip,
    depsHideTooltip,
    bar: () => panel.querySelector<HTMLElement>('.lp-timer-bar'),
    setState(next: LockpickView | null): void {
      state = next;
    },
    /** Make the NEXT abort's flushEvents drain carry these events. */
    queueOnAbort(...events: SimEvent[]): void {
      queued.push(...events);
    },
  };
}

function tick(ticks: number): void {
  for (let i = 0; i < ticks; i++) vi.advanceTimersByTime(100);
}

/** The observable teardown a dismissal must produce, whichever path asked for it. */
function teardown(h: ReturnType<typeof harness>) {
  return {
    aborts: h.abort.mock.calls.length,
    releases: h.release.mock.calls.length,
    timers: vi.getTimerCount(),
    display: h.panel.style.display,
  };
}

describe('lockpick panel: Hud.closeAll (the gamepad escape path)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    for (const controller of built.splice(0)) controller.close(false);
    // Not the inline mockRestore()s a failing expect would skip: a spy left on the shared
    // jsdom window turns one red case into a cascade in every case after it.
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('is the topmost scan hit while the board is up', () => {
    // If the scan did not select it, every other case below would pass vacuously by
    // closing something else (or nothing).
    const h = harness(LIVE);
    h.controller.openBoard();
    expect(h.hud.topmostOpenWindow()).toBe(h.panel);
  });

  it('withdraws from the live session and stops the 100ms countdown', () => {
    const h = harness(LIVE);
    h.controller.openBoard();
    // Exactly one pending timer: the countdown startTimer armed.
    expect(vi.getTimerCount(), 'the board arms its countdown').toBe(1);
    const bar = h.bar() as HTMLElement;
    tick(20);
    const frozen = bar.style.width;
    expect(frozen).not.toBe('100%');

    expect(h.hud.closeAll(), 'closeAll reports it closed something').toBe(true);

    // The server is told to withdraw, so the attempt is preserved instead of being
    // burned down by a per-step clock the player can no longer see.
    expect(h.abort).toHaveBeenCalledTimes(1);
    // Asserted as "the clock is GONE", not "nothing throws": painting a detached or
    // hidden subtree throws nothing at all, so a no-throw assertion passes with the
    // whole fix reverted.
    expect(vi.getTimerCount(), 'the countdown interval is cleared').toBe(0);
    tick(20);
    expect(bar.style.width, 'the hidden subtree stops being repainted').toBe(frozen);

    // The post-condition a reader most needs, and it is deliberate rather than a shortfall:
    // the withdrawal does NOT close. Online the panel stands and the trap stays armed until
    // the server's lockpickEnd, which is what the offline case below drives to completion.
    expect(h.release, 'the trap is released by end(), not by the withdraw').not.toHaveBeenCalled();
    expect(h.panel.style.display, 'still up until lockpickEnd lands').toBe('block');
    // The arm owes its own tooltip hide, since close() (which would have done it) has not run.
    expect(h.hudHideTooltip).toHaveBeenCalledTimes(1);
    expect(
      h.depsHideTooltip,
      'close() has not run, so the controller owed no hide',
    ).not.toHaveBeenCalled();
  });

  it('completes the teardown offline, inside the one closeAll call', () => {
    // The other host. Sim.lockpickAbort emits lockpickEnd synchronously and submitAbort's own
    // flushEvents drains it, so end() -> close() runs before closeAll returns. Without this
    // case every assertion in the suite describes only the online (deferred) shape.
    const h = harness(LIVE, 'offline');
    h.controller.openBoard();
    expect(vi.getTimerCount()).toBe(1);

    expect(h.hud.closeAll()).toBe(true);

    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.panel.style.display, 'the round trip landed in the same stack').toBe('none');
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
    // Nothing is left selectable, so a repeat sweep moves on to the next window.
    expect(h.hud.topmostOpenWindow()).not.toBe(h.panel);
  });

  it('withdraws, re-sends once, then closes, so a repeat closeAll cannot wedge on the panel', () => {
    // SkinEventController.open() sweeps `for (i < 20 && closeTop())` to clear the stack before
    // a roll reveal, and closeTop IS closeAll. Online the withdrawal leaves the panel up, so
    // without the per-session latch this spins all 20 iterations here, fires 20 aborts, and
    // never reaches the windows underneath. Three calls, not two: the third proves the panel
    // has actually left the scan rather than merely stopped aborting.
    const h = harness(LIVE);
    h.controller.openBoard();

    expect(h.hud.closeAll(), 'first: withdraw').toBe(true);
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.panel.style.display).toBe('block');

    expect(h.hud.closeAll(), 'second: re-send, then close').toBe(true);
    // Two, not one and not one per iteration. ClientWorld.rawCmd drops on a closed socket
    // with no queue and no retry, so a repeat request has to hedge that the first abort was
    // never sent; closing on the assumption it landed would hide a live board and forfeit
    // the chest. Closing anyway on the same pass is what bounds it at two.
    expect(h.abort, 'one hedge re-send, not one per sweep pass').toHaveBeenCalledTimes(2);
    expect(h.panel.style.display).toBe('none');
    expect(h.release).toHaveBeenCalledWith(true);

    expect(h.hud.topmostOpenWindow(), 'the sweep can move on').not.toBe(h.panel);
    expect(h.hud.closeAll(), 'nothing left for this harness to close').toBe(false);
  });

  it('re-arms the withdrawal for a NEW session, so the latch cannot silence a real abort', () => {
    // Pick one lock, withdraw, engage another: the second withdraw must still reach the
    // server, or the latch would have converted #2517's forfeiture into a subtler one.
    //
    // Honest about what this can and cannot separate: the id keying and openPanel's reset
    // BOTH satisfy it, and no reachable input tells them apart (openBoard runs openPanel on
    // every lockpickSession). It pins the behavior, not the mechanism; the reset carries its
    // own comment saying which case it is really there for.
    const h = harness(LIVE);
    h.controller.openBoard();
    h.hud.closeAll();
    expect(h.abort).toHaveBeenCalledTimes(1);

    h.setState({ ...LIVE, sessionId: 'lp_9_1' });
    h.controller.openBoard();
    h.hud.closeAll();
    expect(h.abort, 'a fresh session withdraws on its own').toHaveBeenCalledTimes(2);
    // The count alone stopped separating the arms once the repeat arm started re-sending:
    // both send an abort. What still tells them apart is that the FRESH arm defers the close.
    expect(h.panel.style.display, 'a fresh session withdraws and waits, it does not close').toBe(
      'block',
    );
    expect(h.release, 'and its trap survives until lockpickEnd').not.toHaveBeenCalled();
  });

  it("does not clobber a board that the withdrawal's own event drain re-opened", () => {
    // Why the repeat arm closes BEFORE it re-sends. submitAbort ends in flushEvents, which
    // runs the whole handleEvents switch, and its lockpickSession / lockpickOffer arms call
    // openPanel. With the statements the other way round the close lands last and tears down
    // a board the drain had just legitimately opened, leaving the player staring at nothing
    // while the server believes a fresh lock is live.
    const h = harness(LIVE);
    h.controller.openBoard();
    h.hud.closeAll(); // withdraw, latch set, panel still up (online shape)
    expect(h.abort).toHaveBeenCalledTimes(1);

    // The next abort's drain carries a fresh session, the way a re-engage would.
    h.queueOnAbort({ type: 'lockpickSession', sessionId: 'lp_9_2' } as SimEvent);

    h.hud.closeAll(); // repeat arm: close, then re-send, whose drain re-opens the board

    expect(h.abort).toHaveBeenCalledTimes(2);
    expect(h.panel.style.display, 'the re-opened board survives the dismissal').toBe('block');
  });

  it('re-arms after a same-id re-engage, which the id keying alone cannot catch', () => {
    // The collision openPanel's reset exists for. The sim mints
    // `lp_${objectId}_${ctx.tickCount}`, so a withdraw and a re-engage on one chest inside a
    // tick reuse the string. Reachable here, and NOT vacuous: without the reset the reopened
    // board takes the repeat arm on its first dismissal and closes optimistically.
    const h = harness(LIVE);
    h.controller.openBoard();
    h.hud.closeAll();
    expect(h.abort).toHaveBeenCalledTimes(1);

    // Same session id, fresh board.
    h.controller.openBoard();
    h.hud.closeAll();
    expect(h.panel.style.display, 'the reopened board withdraws and waits').toBe('block');
    expect(h.release, 'no optimistic close on a re-engaged board').not.toHaveBeenCalled();
  });

  it('routes the keyboard Escape through the same funnel, latch included', () => {
    // The fix's central claim is that the key handler and the managed-window case share one
    // method. Nothing pinned it: reverting bindKeys to its old inline
    // `if (live) this.submitAbort(); else this.close();` left all cases green, because a
    // FIRST dismissal is identical either way. The latch is what separates them, so press
    // Escape twice and require the second press to behave like requestClose's repeat arm.
    const h = harness(LIVE);
    h.controller.openBoard();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.panel.style.display, 'the first Escape withdraws and waits').toBe('block');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(h.abort, 'the second hedges the re-send').toHaveBeenCalledTimes(2);
    expect(h.panel.style.display, 'and closes').toBe('none');
    expect(h.release).toHaveBeenCalledWith(true);
  });

  it('dismisses the ante selector outright, releasing the trap and returning focus', () => {
    // No live session to withdraw from, so this is the arm that must reach close():
    // the trap release (and with it the WCAG 2.4.3 focus return) has no other route.
    const h = harness(null);
    h.controller.openAnte(9);
    expect(h.panel.style.display).toBe('block');

    expect(h.hud.closeAll()).toBe(true);

    expect(h.abort, 'nothing live to abort').not.toHaveBeenCalled();
    // release(true), the FocusManager's restoreFocus flag: focus goes back to the opener
    // (WCAG 2.4.3). A release(false) regression, or the default arm's bare hide, fails here.
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledWith(true);
    expect(h.panel.style.display).toBe('none');
  });

  it('drops the capture-phase key handler, so a later Escape cannot re-fire on a closed panel', () => {
    // NAMED for the listener, and it has to be probed AS the listener. The obvious version
    // (close, dispatch Escape, assert nothing happened) is worthless: close() sets
    // display:none BEFORE it unbinds, and the handler's own first line bails on
    // `display !== 'block'`, so a stale listener is silent anyway and the case stays green
    // with the whole removeEventListener block deleted.
    const remove = vi.spyOn(window, 'removeEventListener');
    const h = harness(null);
    h.controller.openAnte(9);
    h.hud.closeAll();
    // The registration is on the CAPTURE phase, which is what lets the controller beat
    // src/game/input.ts's bubble listener; unbinding without that flag is a silent no-op.
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    // And the behavioral half: with the panel shown again, a surviving listener WOULD act,
    // so this distinguishes "unbound" from "merely short-circuited by the display guard".
    h.panel.style.display = 'block';
    h.release.mockClear();
    h.abort.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(h.release, 'no handler is left on the window').not.toHaveBeenCalled();
    expect(h.abort).not.toHaveBeenCalled();

    // The FIELD was cleared alongside the unbind, which neither assertion above can see.
    // bindKeys() early-returns on a non-null keyHandler, so dropping just the
    // `this.keyHandler = null` line leaves the next open with no Escape and no pick hotkeys
    // at all, while the removeEventListener spy stays perfectly green.
    const add = vi.spyOn(window, 'addEventListener');
    h.controller.openAnte(9);
    expect(
      add.mock.calls.filter(([type]) => type === 'keydown'),
      'the reopened panel rebinds its keyboard',
    ).toHaveLength(1);
  });

  it('produces the same teardown as the Escape key, live board and ante selector alike', () => {
    // The two paths are the same funnel or they drift: the keyboard one aborts a live
    // session and closes an idle one, and the pad must not do something else.
    //
    // SCOPED to what `teardown()` reads. The paths are NOT byte-identical: the managed-window
    // arm adds its own `this.hideTooltip()`, which the controller's keydown handler has no
    // way to reach. That difference is deliberate (the arm owes the hide the default arm used
    // to guarantee) and is pinned in the live case above, not here.
    for (const initial of [LIVE, null]) {
      const viaKey = harness(initial);
      if (initial) viaKey.controller.openBoard();
      else viaKey.controller.openAnte(9);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      const keyResult = teardown(viaKey);
      viaKey.controller.close();

      const viaPad = harness(initial);
      if (initial) viaPad.controller.openBoard();
      else viaPad.controller.openAnte(9);
      viaPad.hud.closeAll();
      const padResult = teardown(viaPad);
      viaPad.controller.close();

      expect(padResult, `gamepad and keyboard must agree (live=${initial !== null})`).toEqual(
        keyResult,
      );
      // The comparison alone is RELATIVE: both paths run the same funnel, so it survives any
      // change made to the funnel itself, including inverting it (close a live board, abort an
      // idle one) which keeps the two sides equal and non-empty. Pin the absolute shape too.
      expect(keyResult, `the shape itself (live=${initial !== null})`).toEqual(
        initial
          ? { aborts: 1, releases: 0, timers: 0, display: 'block' }
          : { aborts: 0, releases: 1, timers: 0, display: 'none' },
      );
    }
  });
});
