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
import { type TalentAllocation, type TalentNode, talentsFor } from '../../src/sim/content/talents';
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
        totalPoints: () => 31,
        currentAllocation: () => ({ ranks: {}, choices: {} }) as TalentAllocation,
        activeLoadout: () => -1,
        loadouts: () => [],
        currentBar: () => [],
        buildDropdown: () => document.createElement('div'),
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

// The talents choice-node flyout (openChoicePopup) is a role=menu of menuitemradio options
// that lives on document.body (OUTSIDE the dialog's focus trap), so it owns its own keyboard
// model: roving tabindex + Arrow/Home/End move focus (no select-on-move), Enter/Space pick,
// and any focus leaving it (Tab-out, click-away, Escape) dismisses it and returns focus to
// the anchor so a keyboard user cannot escape the dialog through the flyout. This behavior
// shipped with no test; this drives it on a REAL warrior choice node.
describe('keyboard-nav: the talents choice-node flyout (roving menu + focus-return)', () => {
  function openPopup(): { anchor: HTMLElement; pop: HTMLElement } {
    const root = host('talents-window');
    root.style.display = 'block';
    // A stand-in anchor inside the window root (openChoicePopup positions against it and
    // returns focus to it on dismiss); a real rendered node would do, but this keeps the
    // fixture to the one method under test.
    const anchor = document.createElement('div');
    anchor.className = 'tal-node';
    anchor.tabIndex = 0;
    root.appendChild(anchor);
    const win = new TalentsWindow(
      stubDeps({ root: () => root, playerClass: () => 'warrior', totalPoints: () => 31 }),
    );
    const node = talentsFor('warrior')?.nodes.find((n) => n.kind === 'choice');
    if (!node) throw new Error('fixture: warrior has no choice node');
    (
      win as unknown as {
        openChoicePopup(a: HTMLElement, n: TalentNode, s: TalentAllocation): void;
      }
    ).openChoicePopup(anchor, node, { ranks: {}, choices: {} } as TalentAllocation);
    const pop = document.getElementById('tal-choice-pop');
    if (!pop) throw new Error('the choice flyout did not open');
    return { anchor, pop };
  }

  it('opens as a menu with roving tabindex (exactly one option focusable, and focused)', () => {
    const { pop } = openPopup();
    expect(pop.getAttribute('role')).toBe('menu');
    const opts = Array.from(pop.querySelectorAll<HTMLElement>('.tal-choice-opt'));
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.every((o) => o.getAttribute('role') === 'menuitemradio')).toBe(true);
    // exactly one option is in the tab order (roving), and the flyout holds focus
    expect(opts.filter((o) => o.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(pop.contains(document.activeElement)).toBe(true);
  });

  it('Arrow keys move the roving focus among options without selecting or dismissing', () => {
    const { pop } = openPopup();
    const opts = Array.from(pop.querySelectorAll<HTMLElement>('.tal-choice-opt'));
    const active = document.activeElement;
    const start = active instanceof HTMLElement ? opts.indexOf(active) : -1;
    opts[start].dispatchEvent(key('ArrowDown'));
    const next = (start + 1) % opts.length;
    expect(document.activeElement).toBe(opts[next]);
    expect(opts[next].getAttribute('tabindex')).toBe('0');
    expect(opts[start].getAttribute('tabindex')).toBe('-1');
    // moving focus does NOT select or close the flyout (Enter/Space is what picks)
    expect(document.getElementById('tal-choice-pop')).toBeTruthy();
  });

  it('Escape dismisses the flyout and returns focus to the anchor', () => {
    const { anchor, pop } = openPopup();
    pop.querySelector<HTMLElement>('.tal-choice-opt[tabindex="0"]')?.dispatchEvent(key('Escape'));
    expect(document.getElementById('tal-choice-pop')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('focus leaving the flyout (Tab-out) dismisses it and returns focus to the anchor', () => {
    const { anchor } = openPopup();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus(); // focus leaves the popup -> focusout -> dismiss + return-to-anchor
    expect(document.getElementById('tal-choice-pop')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });
});

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
