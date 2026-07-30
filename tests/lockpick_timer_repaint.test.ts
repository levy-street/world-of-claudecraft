// @vitest-environment jsdom

// The lockpick countdown's repaint contract (#2498).
//
// `paintTimer` runs 10 times a second for the length of an attempt, and used to re-resolve
// all three of its element refs on every tick. That is the shape `src/ui/CLAUDE.md` bans
// ("Resolve element refs ONCE into a field at construction, never `$()`/`querySelector` from
// a per-frame path"), and no gate could see it: `querySelector` is not in the painter gate's
// vocabulary, and the cold bucket's `setInterval` allowance says a module repaints on a
// cadence without implying anything about what runs inside the callback.
//
// THE LITERAL FORM OF THAT RULE WOULD HAVE BROKEN THIS WINDOW, which is why the invariant is
// pinned here rather than left to review. `renderBoard()` replaces the panel subtree, and it
// fires on `lockpickRenderSig` (which covers `row` and `visible.length`) while the interval
// restarts on `lockpickTimerKey` (`sessionId:page:tries:col`, covering neither). So moving
// the pick up a row rebuilds the three countdown nodes and does NOT restart the clock. Refs
// taken once at construction, or at `startTimer()`, would paint into a detached subtree from
// there on and the bar would freeze for the rest of the attempt. The refs must be re-resolved
// at the rebuild, and the case below is the one that fails if they are not.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lockpickRenderSig, lockpickTimerKey } from '../src/ui/hud/delve/lockpick_panel';
import { LockpickWindow } from '../src/ui/hud/delve/lockpick_window';
import type { LockpickView } from '../src/world_api';

const VIEW: LockpickView = {
  sessionId: 'lp_1_0',
  objectId: 1,
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

function harness(initial: LockpickView | null = VIEW) {
  document.body.innerHTML = '<div id="lockpick-panel" style="display:block"></div>';
  const panel = document.getElementById('lockpick-panel') as HTMLElement;
  let state: LockpickView | null = initial;
  const win = new LockpickWindow({
    panel: () => panel,
    getState: () => state,
    tierName: (tier) => tier,
    onEngage: () => {},
    onAction: () => {},
    onAbort: () => {},
    onClose: () => {},
  });
  return {
    win,
    panel,
    set(next: LockpickView | null): void {
      state = next;
    },
    bar: () => panel.querySelector<HTMLElement>('#lp-timer-bar'),
    value: () => panel.querySelector<HTMLElement>('#lp-timer-value'),
    wrap: () => panel.querySelector<HTMLElement>('.lp-timer'),
  };
}

/** Run the countdown interval's callback exactly `ticks` times. */
function tick(ticks: number): void {
  for (let i = 0; i < ticks; i++) vi.advanceTimersByTime(100);
}

describe('lockpick countdown repaint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('paints the bar without re-querying the panel on every tick', () => {
    const h = harness();
    h.win.openBoard();
    // All three resolvers, not just the injected panel's: `panel()` itself falls back to
    // `document.getElementById`, so an instance-scoped spy alone would miss a regression
    // that re-queried through the document instead.
    const spies = [
      vi.spyOn(h.panel, 'querySelector'),
      vi.spyOn(document, 'querySelector'),
      vi.spyOn(document, 'getElementById'),
    ];
    tick(5);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(h.bar()?.style.width).not.toBe('');
    for (const spy of spies) spy.mockRestore();
  });

  it('re-applies the urgent class after a rebuild that happens WHILE urgent', () => {
    // The two arms of the latch only meet here: the rebuild case above happens at 13s
    // (never urgent) and the latch case below never rebuilds, so neither notices if
    // cacheTimerEls stops resetting lastUrgent. It would then stay true against fresh
    // markup that carries no urgent class, and the player loses the cue for the rest of
    // the attempt.
    const h = harness();
    h.win.openBoard();
    tick(130); // past the 3s threshold
    expect(h.wrap()?.classList.contains('lp-timer-urgent')).toBe(true);

    h.set({ ...VIEW, row: 3 });
    h.win.repaintIfChanged();
    expect(h.wrap()?.classList.contains('lp-timer-urgent'), 'fresh markup starts clean').toBe(
      false,
    );

    tick(1);
    expect(h.wrap()?.classList.contains('lp-timer-urgent')).toBe(true);
  });

  it('keeps painting the LIVE nodes after a rebuild that does not restart the clock', () => {
    // The correctness case. A row move changes the render signature but not the timer key,
    // so renderBoard() replaces the countdown nodes while the same interval keeps running.
    const moved = { ...VIEW, row: 3 };
    expect(lockpickRenderSig(moved)).not.toBe(lockpickRenderSig(VIEW));
    expect(lockpickTimerKey(moved)).toBe(lockpickTimerKey(VIEW));

    const h = harness();
    h.win.openBoard();
    const before = h.bar();
    tick(20); // 2s in
    const midWidth = before?.style.width;

    h.set(moved);
    h.win.repaintIfChanged();
    const after = h.bar();
    expect(after, 'the rebuild should have replaced the timer nodes').not.toBe(before);
    expect(after?.style.width, 'a fresh board starts the bar full').toBe('100%');

    tick(20); // 2 more seconds, on the SAME interval
    expect(after?.style.width).not.toBe('100%');
    expect(after?.style.width).not.toBe(midWidth);
    // ...and the stale node is not being written any more.
    expect(before?.style.width).toBe(midWidth);
    // The LABEL is half the countdown and nothing else in the repo touches #lp-timer-value.
    // Deleting the textContent write, or reverting formatNumber back to toFixed(1), was
    // green before this. The literal pins the one decimal `NUM1` exists for.
    // 15s budget, 4s of ticks on the one uninterrupted interval: the rebuild resets the
    // BAR to full markup but not the clock's end, so the label keeps counting down.
    expect(h.value()?.textContent).toContain('11.0');
  });

  it('writes the urgent class only when it flips', () => {
    const h = harness();
    h.win.openBoard();
    const wrap = h.wrap() as HTMLElement;
    const toggle = vi.spyOn(wrap.classList, 'toggle');
    tick(20); // 13s remaining, nowhere near urgent
    expect(toggle).not.toHaveBeenCalled();
    expect(wrap.classList.contains('lp-timer-urgent')).toBe(false);

    tick(110); // past the 3s threshold
    expect(wrap.classList.contains('lp-timer-urgent')).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);

    tick(10); // still urgent: no second write
    expect(toggle).toHaveBeenCalledTimes(1);
    toggle.mockRestore();
  });

  it('flips urgent at 3s, not somewhere in a ten-second band', () => {
    // The case above samples 13s then 2s, so any threshold in (0, 13) satisfies it. This
    // straddles the real boundary instead.
    const h = harness();
    h.win.openBoard();
    tick(119); // 3.1s remaining
    expect(h.wrap()?.classList.contains('lp-timer-urgent')).toBe(false);
    tick(2); // 2.9s remaining
    expect(h.wrap()?.classList.contains('lp-timer-urgent')).toBe(true);
  });

  it('stops writing the detached nodes when the ante selector replaces the board', () => {
    // Asserted as "the stale node stops moving", not as "nothing throws": writing into a
    // detached subtree throws nothing at all, so the no-throw version of this passes with
    // forgetTimerEls() deleted. renderAnte deliberately does NOT stop the interval, which
    // is what makes this reachable.
    const h = harness();
    h.win.openBoard();
    const stale = h.bar() as HTMLElement;
    tick(20);
    const frozen = stale.style.width;
    expect(frozen).not.toBe('100%');

    h.win.renderAnte(1, false);
    expect(h.bar(), 'the ante markup carries no countdown').toBeNull();
    tick(20);
    expect(stale.style.width, 'the replaced node must stop being painted').toBe(frozen);
  });

  it('stops painting when the authoritative state goes null', () => {
    // NAMED for what it actually pins. renderBoard's state-less exit also drops the refs,
    // but syncTimer stops the clock on the very next line, so that teardown is reference
    // hygiene no test can observe (same as close()'s). What IS observable, and what this
    // holds, is that the countdown goes quiet the moment the sim says the lock is over.
    const h = harness();
    h.win.openBoard();
    const bar = h.bar() as HTMLElement;
    tick(20);
    const frozen = bar.style.width;

    h.set(null);
    h.win.onStep('advanced');
    tick(20);
    expect(bar.style.width).toBe(frozen);
  });

  it('paints its OWN panel when a second window instance exists', () => {
    // What the class-scoped lookup buys, and the reason it is not an id lookup: the window
    // is instance-parameterized on deps.panel, so two instances must not fight over one
    // pair of element ids. Without this the id-versus-class choice is unpinned either way.
    document.body.innerHTML =
      '<div id="lockpick-panel" style="display:block"></div><div id="second-panel" style="display:block"></div>';
    const first = document.getElementById('lockpick-panel') as HTMLElement;
    const second = document.getElementById('second-panel') as HTMLElement;
    const make = (panel: HTMLElement): LockpickWindow =>
      new LockpickWindow({
        panel: () => panel,
        getState: () => VIEW,
        tierName: (tier) => tier,
        onEngage: () => {},
        onAction: () => {},
        onAbort: () => {},
        onClose: () => {},
      });
    const a = make(first);
    const b = make(second);
    a.openBoard();
    b.openBoard();
    tick(20);

    const barA = first.querySelector<HTMLElement>('.lp-timer-bar') as HTMLElement;
    const barB = second.querySelector<HTMLElement>('.lp-timer-bar') as HTMLElement;
    expect(barA).not.toBe(barB);
    expect(barA.style.width).not.toBe('100%');
    expect(barB.style.width, 'the second instance must paint its own node').toBe(barA.style.width);
  });

  it('ignores a step that lands after the panel was closed while the session is still live', () => {
    // #2517's repeat-dismissal arm closes the board without waiting for the server's
    // lockpickEnd, so a lockpickStep can still arrive for a session the player has already
    // walked away from. Without the display guard, onStep repaints the hidden panel and
    // (because close() cleared lastTimerKey) syncTimer starts a FRESH 100ms interval on it,
    // which is the leak the whole issue is about, re-created from the other side.
    const h = harness();
    h.win.openBoard();
    const bar = h.bar() as HTMLElement;
    tick(20);
    const frozen = bar.style.width;

    // What the controller's repeat arm does: close the window, state still live.
    h.panel.style.display = 'none';
    h.win.close();
    expect(vi.getTimerCount(), 'close stops the clock').toBe(0);

    h.win.onStep('advanced');

    expect(vi.getTimerCount(), 'a straggler step must not re-arm the countdown').toBe(0);
    tick(20);
    expect(bar.style.width, 'and must not repaint the hidden subtree').toBe(frozen);
  });

  it('paints nothing when the board carries no per-step budget', () => {
    const h = harness({ ...VIEW, stepTimeoutMs: null });
    h.win.openBoard();
    expect(h.wrap(), 'no budget means no timer block is emitted').toBeNull();
    expect(() => tick(5)).not.toThrow();
  });

  it('goes quiet when a rebuild drops the timer block out from under a running clock', () => {
    // The one path that reaches cacheTimerEls' null fallback with an interval still armed,
    // and the reason the fallback is a null rather than three non-null assertions. Opening
    // with a budget arms the clock; dropping stepTimeoutMs while moving `row` changes
    // lockpickRenderSig (so renderBoard runs and emits no timer block) but NOT
    // lockpickTimerKey (so syncTimer neither restarts nor stops the interval).
    const h = harness();
    h.win.openBoard();
    const stale = h.bar() as HTMLElement;
    tick(20);
    const frozen = stale.style.width;

    h.set({ ...VIEW, stepTimeoutMs: null, row: 3 });
    h.win.repaintIfChanged();
    expect(h.wrap(), 'the rebuilt board carries no countdown').toBeNull();
    expect(() => tick(20)).not.toThrow();
    expect(stale.style.width, 'the dropped node must stop being painted').toBe(frozen);
  });
});
