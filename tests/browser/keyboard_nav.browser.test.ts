// Keyboard-navigation E2E over the REAL focus manager (src/ui/focus_manager.ts),
// run in a real browser so synthetic Tab keydowns drive the actual document-level trap. It
// proves the three properties required of an open window:
//   - focus-first on open lands on the first interactive, SKIPPING the close (X) button;
//   - Tab / Shift+Tab cycle WITHIN the window (including the close button) and never escape;
//   - the close path (release(true), which the Esc -> closeAll -> windowFocus.restoreFocus
//     route ends in) returns focus to the opener;
//   - and the gameplay guard: Tab is NOT trapped while focus is OUTSIDE the window, so the
//     game's Tab-target-nearest-enemy key still works when no modal owns focus.
// The final block wires a REAL window painter (TalentsWindow) to a REAL FocusManager through
// the actual makeWindowFocus bridge (the same src/ui/window_focus.ts helper hud.ts wires), so
// the open()->trap and close()->return-to-opener integration is driven, not just source-scanned.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TalentAllocation } from '../../src/sim/content/talents';
import { FocusManager } from '../../src/ui/focus_manager';
import { MarketWindow } from '../../src/ui/market_window';
import { TalentsWindow } from '../../src/ui/talents_window';
import { makeWindowFocus } from '../../src/ui/window_focus';
import { cleanup, host, stubDeps } from './_harness';

function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
}

function req<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`fixture: ${what} not found`);
  return value;
}

afterEach(cleanup);

function buildWindow(): {
  root: HTMLElement;
  opener: HTMLElement;
  close: HTMLElement;
  btns: HTMLElement[];
} {
  const opener = document.createElement('button');
  opener.id = 'kbd-opener';
  opener.textContent = 'open';
  document.body.appendChild(opener);
  const root = host('kbd-window');
  root.style.display = 'block';
  // DOM order: the close (X) button first, then two ordinary controls. The full Tab cycle
  // INCLUDES [data-close]; focus-first SKIPS it.
  const close = document.createElement('button');
  close.setAttribute('data-close', '');
  close.setAttribute('aria-label', 'Close');
  close.textContent = 'X';
  const a = document.createElement('button');
  a.textContent = 'A';
  const b = document.createElement('button');
  b.textContent = 'B';
  root.append(close, a, b);
  return { root, opener, close, btns: [a, b] };
}

function pressTab(shift = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('keyboard-nav: the focus trap (trap + focus-first + return)', () => {
  it('focusFirst lands on the first interactive, skipping the close (X) button', async () => {
    const { root, opener, btns } = buildWindow();
    opener.focus();
    const fm = new FocusManager();
    const handle = fm.open({ root: () => root, returnFocusTo: opener });
    handle.focusFirst(); // the manager defers the focus a tick (setTimeout 0)
    await vi.waitFor(() => expect(document.activeElement).toBe(btns[0]));
    handle.release(false);
  });

  it('Tab / Shift+Tab cycle within the window and never escape', () => {
    const { root, close, btns } = buildWindow();
    const fm = new FocusManager();
    const handle = fm.open({ root: () => root, returnFocusTo: null });
    // From the LAST focusable, Tab wraps to the FIRST in the cycle (the close button).
    btns[1].focus();
    const fwd = pressTab();
    expect(fwd.defaultPrevented).toBe(true);
    expect(root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(close);
    // From the FIRST, Shift+Tab wraps to the LAST.
    close.focus();
    const back = pressTab(true);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(btns[1]);
    handle.release(false);
  });

  it('the close path (release with returnFocus) restores focus to the opener', async () => {
    const { root, opener, btns } = buildWindow();
    opener.focus();
    const fm = new FocusManager();
    const handle = fm.open({ root: () => root, returnFocusTo: opener });
    handle.focusFirst(); // deferred a tick
    await vi.waitFor(() => expect(document.activeElement).toBe(btns[0]));
    handle.release(true);
    // The manager defers the restore a tick (setTimeout 0) as well.
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('does NOT trap Tab while focus is outside the window (world Tab-target preserved)', () => {
    const { root, opener } = buildWindow();
    const fm = new FocusManager();
    const handle = fm.open({ root: () => root, returnFocusTo: opener });
    opener.focus(); // outside the trapped root
    const ev = pressTab();
    // The trap intercepts Tab ONLY when the root contains the active element, so here it must
    // pass the key through (defaultPrevented stays false) and the game keeps Tab-targeting.
    expect(ev.defaultPrevented).toBe(false);
    handle.release(false);
  });
});

describe('keyboard-nav: a REAL window painter through the captureFocus bridge', () => {
  it('TalentsWindow.open() arms the trap and close() returns focus to the opener', async () => {
    const opener = document.createElement('button');
    opener.id = 'kbd-real-opener';
    document.body.appendChild(opener);
    const root = host('talents-window');
    root.style.display = 'none';
    const fm = new FocusManager();
    let stage: TalentAllocation | null = null;
    const win = new TalentsWindow(
      stubDeps({
        root: () => root,
        ...makeWindowFocus(fm, () => root),
        getStage: () => stage,
        setStage: (s: TalentAllocation | null) => {
          stage = s;
        },
        playerClass: () => 'warrior',
        currentAllocation: () => ({ ranks: {}, choices: {} }) as TalentAllocation,
        activeLoadout: () => -1,
        loadouts: () => [],
        currentBar: () => [],
      }),
    );
    opener.focus();
    win.open(); // captureFocus records the opener + arms the trap
    // The trap is live: Tab from a control inside the window is intercepted and cycles within.
    const inside = root.querySelector<HTMLElement>('button[data-close]');
    expect(inside, 'the window rendered its close button').toBeTruthy();
    inside?.focus();
    const ev = pressTab();
    expect(ev.defaultPrevented).toBe(true);
    expect(root.contains(document.activeElement)).toBe(true);
    // close() -> restoreFocus(opener): the real end of the Esc -> closeAll route. The manager
    // defers the restore a tick.
    win.close();
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('keyboard-nav: TalentsWindow Choices row radios', () => {
  it('keeps one tab stop per row and ArrowRight moves the checked choice', () => {
    const root = host('talents-window');
    root.style.display = 'none';
    let stage: TalentAllocation | null = null;
    const win = new TalentsWindow(
      stubDeps({
        root: () => root,
        captureFocus: () => null,
        restoreFocus: () => undefined,
        getStage: () => stage,
        setStage: (s: TalentAllocation | null) => {
          stage = s;
        },
        playerClass: () => 'warrior',
        playerLevel: () => 20,
        currentAllocation: () =>
          ({ spec: 'arms', ranks: {}, choices: {}, rows: {} }) as TalentAllocation,
        activeLoadout: () => -1,
        loadouts: () => [],
        currentBar: () => [],
      }),
    );
    win.open();

    const group = req(root.querySelector<HTMLElement>('.tal-row-opts'), 'first choice row');
    const opts = Array.from(group.querySelectorAll<HTMLElement>('.tal-row-opt'));
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.map((opt) => opt.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    opts[0].focus();
    const ev = key('ArrowRight');
    opts[0].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const rerenderedGroup = req(
      root.querySelector<HTMLElement>('.tal-row-opts'),
      'rerendered first choice row',
    );
    const rerenderedOpts = Array.from(
      rerenderedGroup.querySelectorAll<HTMLElement>('.tal-row-opt'),
    );
    expect(rerenderedOpts.map((opt) => opt.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(rerenderedOpts[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(rerenderedOpts[1]);
  });
});

// The talents choice-node flyout (openChoicePopup) is a role=menu of menuitemradio options
// that lives on document.body (OUTSIDE the dialog's focus trap), so it owns its own keyboard
// model: roving tabindex + Arrow/Home/End move focus (no select-on-move), Enter/Space pick,
// and any focus leaving it (Tab-out, click-away, Escape) dismisses it and returns focus to
// the anchor so a keyboard user cannot escape the dialog through the flyout. This behavior
// shipped with no test; this drives it on a REAL warrior choice node.
// The tree choice-node flyout died with the point trees (Talents 2.0 flip);
// the Choices tab uses radiogroup option cards covered by the picker tests.
// The market browse-tab filter menus advertise role=listbox; they were carried byte-faithful
// with NO keyboard nav, then wired with the EXISTING pure
// dropdownKeyNav core onto them. This drives the real MarketWindow painter: open a filter
// listbox by keyboard, rove with arrows, commit with Enter, and close (Escape / Tab) returning
// focus to the trigger. The filter chrome renders on the browse tab regardless of marketInfo,
// so a null-merchant fixture is enough to exercise the menus.
describe('keyboard-nav: the market filter listbox (dropdownKeyNav wiring)', () => {
  function openMarket(): HTMLElement {
    const root = host('market-window');
    root.style.display = 'none';
    const win = new MarketWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            marketInfo: null,
            copper: 0,
            marketSearch: () => undefined,
            inventory: [],
          }) as never,
        closeOthers: () => undefined,
        captureFocus: () => null,
        hideTooltip: () => undefined,
        syncBags: () => undefined,
      }),
    );
    win.open();
    return root;
  }
  const itemTypeMenu = (root: HTMLElement) =>
    req(
      root.querySelector<HTMLElement>('[data-market-filter-menu="itemType"]'),
      'itemType filter menu',
    );

  it('opens by keyboard, roves with arrows, and commits the focused filter with Enter', () => {
    const root = openMarket();
    const select = itemTypeMenu(root);
    const trigger = req(select.querySelector<HTMLElement>('.mkt-select-btn'), 'itemType trigger');
    trigger.focus();
    // ArrowDown on the collapsed trigger opens the listbox and focuses the first option.
    trigger.dispatchEvent(key('ArrowDown'));
    expect(select.classList.contains('open')).toBe(true);
    const options = Array.from(select.querySelectorAll<HTMLElement>('.mkt-select-option'));
    expect(options.every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
    expect(document.activeElement).toBe(options[0]); // 'all'
    // ArrowDown moves the roving focus to the next option WITHOUT committing or closing.
    options[0].dispatchEvent(key('ArrowDown'));
    expect(document.activeElement).toBe(options[1]); // 'weapon'
    expect(select.classList.contains('open')).toBe(true);
    const committed = options[1].getAttribute('data-market-filter-option');
    expect(committed).toBe('weapon');
    // Enter commits the focused filter; render() rebuilds and returns focus to the trigger.
    options[1].dispatchEvent(key('Enter'));
    // 'weapon' selected -> the subtype menu now appears, proving the filter actually changed.
    expect(root.querySelector('[data-market-filter-menu="subtype"]')).toBeTruthy();
    const reSelect = itemTypeMenu(root);
    expect(
      reSelect.querySelector('[aria-selected="true"]')?.getAttribute('data-market-filter-option'),
    ).toBe(committed);
    expect(document.activeElement).toBe(reSelect.querySelector('.mkt-select-btn'));
  });

  it('Escape closes the listbox and returns focus to the trigger', () => {
    const root = openMarket();
    const select = itemTypeMenu(root);
    const trigger = req(select.querySelector<HTMLElement>('.mkt-select-btn'), 'itemType trigger');
    trigger.focus();
    trigger.dispatchEvent(key('ArrowDown'));
    expect(select.classList.contains('open')).toBe(true);
    req(select.querySelector<HTMLElement>('.mkt-select-option'), 'first option').dispatchEvent(
      key('Escape'),
    );
    expect(select.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab closes the listbox and returns focus to the trigger without preventing native Tab', () => {
    const root = openMarket();
    const select = itemTypeMenu(root);
    const trigger = req(select.querySelector<HTMLElement>('.mkt-select-btn'), 'itemType trigger');
    trigger.focus();
    trigger.dispatchEvent(key('ArrowDown'));
    const ev = key('Tab');
    req(select.querySelector<HTMLElement>('.mkt-select-option'), 'first option').dispatchEvent(ev);
    expect(select.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    // Tab is NOT preventDefaulted, so native Tab traversal continues from the trigger.
    expect(ev.defaultPrevented).toBe(false);
  });
});
