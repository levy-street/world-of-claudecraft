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
import type { TalentAllocation, TalentRowLevel } from '../../src/sim/content/talents';
import {
  MARKET_BAG_SIZE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  type MarketQuery,
} from '../../src/sim/market_query';
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
    const allocation: TalentAllocation = { spec: null, rows: {} };
    const win = new TalentsWindow(
      stubDeps({
        root: () => root,
        ...makeWindowFocus(fm, () => root),
        playerClass: () => 'warrior',
        playerLevel: () => 20,
        currentAllocation: () => allocation,
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

// Talents V2 has no staged point-tree flyout. These tests drive the real painter and prove
// that spec/row controls issue authoritative commands, then repaint only from the allocation
// snapshot supplied by the world seam.
describe('keyboard-nav: Talents V2 authoritative choices', () => {
  function openTalents(initial: TalentAllocation): {
    root: HTMLElement;
    win: TalentsWindow;
    allocation: { value: TalentAllocation };
    commits: string[];
    rowSelections: [TalentRowLevel, string | null][];
  } {
    const root = host('talents-window');
    root.style.display = 'none';
    const allocation = { value: initial };
    const commits: string[] = [];
    const rowSelections: [TalentRowLevel, string | null][] = [];
    const win = new TalentsWindow(
      stubDeps({
        root: () => root,
        captureFocus: () => null,
        playerClass: () => 'warrior',
        playerLevel: () => 20,
        currentAllocation: () => allocation.value,
        activeLoadout: () => -1,
        loadouts: () => [],
        currentBar: () => [],
        commitSpec: (specId: string) => commits.push(specId),
        selectRow: (level: TalentRowLevel, optionId: string | null) => {
          rowSelections.push([level, optionId]);
        },
      }),
    );
    win.open();
    return { root, win, allocation, commits, rowSelections };
  }

  it('commits an unselected spec, then navigates to its six choice rows', () => {
    // The ported spec-panel design splits the two actions: clicking a panel
    // commits (and stays on the tab); View talents commits if needed AND jumps
    // to Choices. Drive the single-action path through View talents.
    const fixture = openTalents({ spec: null, rows: {} });
    const viewTalents = req(
      fixture.root.querySelector<HTMLButtonElement>('.ts-panel .ts-view-talents'),
      'first spec View talents',
    );
    viewTalents.click();

    expect(fixture.commits).toEqual(['arms']);
    expect(fixture.root.querySelector('[data-tab="rows"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(fixture.root.querySelectorAll('.tal-row')).toHaveLength(6);
    expect(fixture.root.querySelectorAll('.tal-row-opt')).toHaveLength(18);
    fixture.root.style.display = 'none';
  });

  it('clicking the committed spec only navigates and does not recommit it', () => {
    const fixture = openTalents({ spec: 'arms', rows: {} });
    // Clicking the committed panel is a no-op (no recommit, no navigation).
    req(fixture.root.querySelector<HTMLElement>('.ts-panel.sel'), 'committed spec panel').click();
    expect(fixture.commits).toEqual([]);
    // Its View talents button navigates to Choices without recommitting.
    req(
      fixture.root.querySelector<HTMLButtonElement>('.ts-panel.sel .ts-view-talents'),
      'committed spec View talents',
    ).click();

    expect(fixture.commits).toEqual([]);
    expect(fixture.root.querySelector('[data-tab="rows"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    fixture.root.style.display = 'none';
  });

  it('selects and clears a row through the world seam without optimistic mutation', () => {
    const fixture = openTalents({ spec: 'arms', rows: {} });
    req(fixture.root.querySelector<HTMLButtonElement>('[data-tab="rows"]'), 'choices tab').click();
    const first = req(
      fixture.root.querySelector<HTMLButtonElement>('.tal-row-opt:not(:disabled)'),
      'first unlocked option',
    );
    const optionId = req(first.dataset.optionId, 'row option id');
    const level = Number(req(first.dataset.rowLevel, 'row level')) as TalentRowLevel;
    first.click();

    expect(fixture.rowSelections).toEqual([[level, optionId]]);
    expect(
      fixture.root.querySelector(`[data-option-id="${optionId}"]`)?.getAttribute('aria-pressed'),
    ).toBe('false');

    fixture.allocation.value = { spec: 'arms', rows: { [level]: optionId } };
    fixture.win.render();
    const selected = req(
      fixture.root.querySelector<HTMLButtonElement>(`[data-option-id="${optionId}"]`),
      'authoritative selected option',
    );
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    selected.click();
    expect(fixture.rowSelections).toEqual([
      [level, optionId],
      [level, null],
    ]);
    fixture.root.style.display = 'none';
  });
});

// The market browse-tab filter menus advertise role=listbox; they were carried byte-faithful
// with NO keyboard nav, then wired with the EXISTING pure
// dropdownKeyNav core onto them. This drives the real MarketWindow painter: open a filter
// listbox by keyboard, rove with arrows, commit with Enter, and close (Escape / Tab) returning
// focus to the trigger. The filter chrome renders on the browse tab regardless of marketInfo,
// so a null-merchant fixture is enough to exercise the menus.
describe('keyboard-nav: the market filter listbox (dropdownKeyNav wiring)', () => {
  function openMarket(queries: MarketQuery[] = []): HTMLElement {
    const root = host('market-window');
    root.style.display = 'none';
    const win = new MarketWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            marketInfo: null,
            copper: 0,
            marketSearch: (query: MarketQuery) => queries.push(query),
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
  // The visible caption sitting above a dropdown (the `.mkt-filter > span`).
  const filterLabel = (root: HTMLElement, menu: string) =>
    req(
      root
        .querySelector<HTMLElement>(`[data-market-filter-menu="${menu}"]`)
        ?.closest('.mkt-filter')
        ?.querySelector<HTMLElement>('span'),
      `${menu} filter label`,
    ).textContent;
  const optionLabels = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll<HTMLElement>('.mkt-select-option')).map((o) => o.textContent);
  const pickItemType = (root: HTMLElement, value: string) =>
    req(
      itemTypeMenu(root).querySelector<HTMLButtonElement>(`[data-market-filter-option="${value}"]`),
      `${value} item type option`,
    ).click();

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

  it('reveals armor class and primary-stat menus for armor and commits their options', () => {
    const queries: MarketQuery[] = [];
    const root = openMarket(queries);
    // Both advanced menus are gated: neither exists on the default 'all' browse.
    expect(root.querySelector('[data-market-filter-menu="armorClass"]')).toBeNull();
    expect(root.querySelector('[data-market-filter-menu="primaryStat"]')).toBeNull();
    pickItemType(root, 'armor');

    const armorClass = req(
      root.querySelector<HTMLElement>('[data-market-filter-menu="armorClass"]'),
      'armor class filter menu',
    );
    expect(
      Array.from(armorClass.querySelectorAll<HTMLElement>('[data-market-filter-option]')).map(
        (option) => option.dataset.marketFilterOption,
      ),
    ).toEqual(['all', 'cloth', 'leather', 'mail']);
    // The rendered copy, not just the option keys: the whole point of the new
    // filterArmorSlot key is that the two armor dropdowns no longer BOTH read "Armor type".
    expect(optionLabels(armorClass)).toEqual(['All armor types', 'Cloth', 'Leather', 'Mail']);
    expect(filterLabel(root, 'subtype')).toBe('Armor slot');
    expect(filterLabel(root, 'armorClass')).toBe('Armor type');
    req(
      armorClass.querySelector<HTMLButtonElement>('[data-market-filter-option="mail"]'),
      'mail option',
    ).click();

    const primaryStat = req(
      root.querySelector<HTMLElement>('[data-market-filter-menu="primaryStat"]'),
      'primary stat filter menu',
    );
    expect(
      Array.from(primaryStat.querySelectorAll<HTMLElement>('[data-market-filter-option]')).map(
        (option) => option.dataset.marketFilterOption,
      ),
    ).toEqual(['all', 'str', 'agi', 'int']);
    expect(optionLabels(primaryStat)).toEqual([
      'Any primary stat',
      'Strength',
      'Agility',
      'Intellect',
    ]);
    expect(filterLabel(root, 'primaryStat')).toBe('Primary stat');
    req(
      primaryStat.querySelector<HTMLButtonElement>('[data-market-filter-option="int"]'),
      'intellect option',
    ).click();

    expect(
      root
        .querySelector('[data-market-filter-menu="armorClass"] [aria-selected="true"]')
        ?.getAttribute('data-market-filter-option'),
    ).toBe('mail');
    expect(
      root
        .querySelector('[data-market-filter-menu="primaryStat"] [aria-selected="true"]')
        ?.getAttribute('data-market-filter-option'),
    ).toBe('int');
    // The trigger's accessible name is the localized "{label}: {value}" pattern, not a
    // hand-concatenated string, and it reflects the committed value.
    expect(
      req(
        root.querySelector<HTMLElement>('[data-market-filter-menu="primaryStat"] .mkt-select-btn'),
        'primaryStat trigger',
      ).getAttribute('aria-label'),
    ).toBe('Primary stat: Intellect');
    // toEqual, not toMatchObject: a dropped or stray sibling field must redden here too.
    expect(queries.at(-1)).toEqual({
      search: '',
      itemType: 'armor',
      subtype: 'all',
      armorClass: 'mail',
      primaryStat: 'int',
      rarity: 'all',
      page: 0,
    });

    pickItemType(root, 'weapon');
    expect(root.querySelector('[data-market-filter-menu="armorClass"]')).toBeNull();
    expect(root.querySelector('[data-market-filter-menu="primaryStat"]')).toBeTruthy();
    expect(queries.at(-1)).toEqual({
      search: '',
      itemType: 'weapon',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      page: 0,
    });

    // ...and both advanced menus disappear again for a type that has neither.
    pickItemType(root, 'consumable');
    expect(root.querySelector('[data-market-filter-menu="armorClass"]')).toBeNull();
    expect(root.querySelector('[data-market-filter-menu="primaryStat"]')).toBeNull();
  });

  it('keeps search and armor filters aligned in shared columns as the window narrows', () => {
    const root = openMarket();
    pickItemType(root, 'armor');
    const controls = req(root.querySelector<HTMLElement>('.mkt-controls'), 'market controls');
    const search = req(root.querySelector<HTMLElement>('.mkt-search'), 'market search');
    const fields = Array.from(root.querySelectorAll<HTMLElement>('.mkt-filter'));
    expect(fields).toHaveLength(5);

    const layout = (width: number) => {
      controls.style.width = `${width}px`;
      const fieldRects = fields.map((field) => field.getBoundingClientRect());
      const typeButton = req(
        fields[0].querySelector<HTMLElement>('.mkt-select-btn'),
        'item type filter button',
      ).getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      return {
        columns: getComputedStyle(controls).gridTemplateColumns.split(' ').length,
        fieldWidths: fieldRects.map((rect) => Math.round(rect.width)),
        searchWidth: Math.round(searchRect.width),
        searchBottom: Math.round(searchRect.bottom),
        typeButtonBottom: Math.round(typeButton.bottom),
      };
    };

    // With an 8px column gap: (832 - 2 * 8) / 3 = 272, (596 - 8) / 2 = 294.
    const wide = layout(832);
    expect(wide.columns).toBe(3);
    expect(new Set([...wide.fieldWidths, wide.searchWidth])).toEqual(new Set([272]));
    expect(wide.searchBottom).toBe(wide.typeButtonBottom);

    const compact = layout(596);
    expect(compact.columns).toBe(2);
    expect(new Set([...compact.fieldWidths, compact.searchWidth])).toEqual(new Set([294]));
    expect(compact.searchBottom).toBe(compact.typeButtonBottom);
  });

  // Issue #2189: bags matched no item-type option at all, so this asserts the whole
  // rendered chain for the new category: the option exists, its capacity menu is built
  // from the catalog-derived sizes, the labels are the localized bag strings (NOT the
  // weapon-family fallthrough "Other weapons"), the stat menu stays away, and the
  // committed query that reaches the server carries itemType 'bag' plus the size.
  it('browses bags by capacity, with no armor-class or primary-stat menu', () => {
    const queries: MarketQuery[] = [];
    const root = openMarket(queries);

    // Every filter option in the shared vocabulary reaches the menu, in order. A value
    // added to MARKET_ITEM_TYPE_FILTERS that never renders would be as unbrowsable as
    // bags were, and the sim-side never-assertion cannot see the menu.
    expect(
      Array.from(
        itemTypeMenu(root).querySelectorAll<HTMLElement>('[data-market-filter-option]'),
      ).map((option) => option.dataset.marketFilterOption),
    ).toEqual([...MARKET_ITEM_TYPE_FILTERS]);

    pickItemType(root, 'bag');
    expect(root.querySelector('[data-market-filter-menu="armorClass"]')).toBeNull();
    expect(
      root.querySelector('[data-market-filter-menu="primaryStat"]'),
      'bags carry no str/agi/int, so a primary-stat menu could only ever narrow nothing',
    ).toBeNull();

    const subtype = req(
      root.querySelector<HTMLElement>('[data-market-filter-menu="subtype"]'),
      'bag capacity filter menu',
    );
    expect(
      Array.from(subtype.querySelectorAll<HTMLElement>('[data-market-filter-option]')).map(
        (option) => option.dataset.marketFilterOption,
      ),
    ).toEqual(['all', ...MARKET_BAG_SIZE_FILTERS.slice(1)]);
    expect(filterLabel(root, 'subtype')).toBe('Bag size');
    expect(optionLabels(subtype)).toEqual([
      'All bags',
      ...MARKET_BAG_SIZE_FILTERS.slice(1).map((slots) => `${slots} Slot Bag`),
    ]);
    expect(
      optionLabels(subtype),
      'a bag size must never fall through to the weapon-family label chain',
    ).not.toContain('Other weapons');
    expect(
      Array.from(itemTypeMenu(root).querySelectorAll<HTMLElement>('.mkt-select-option')).find(
        (o) => o.dataset.marketFilterOption === 'bag',
      )?.textContent,
    ).toBe('Bags');

    const size = MARKET_BAG_SIZE_FILTERS[1];
    req(
      subtype.querySelector<HTMLButtonElement>(`[data-market-filter-option="${size}"]`),
      `${size} slot option`,
    ).click();
    // toEqual, not toMatchObject: a dropped or stray sibling field must redden here too.
    expect(queries.at(-1)).toEqual({
      search: '',
      itemType: 'bag',
      subtype: size,
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      page: 0,
    });

    // Leaving the bag category clears the capacity back to 'all' rather than sending a
    // size the next item type cannot mean.
    pickItemType(root, 'armor');
    expect(filterLabel(root, 'subtype')).toBe('Armor slot');
    expect(queries.at(-1)?.subtype).toBe('all');
    // The option list swaps too, not just the caption and the committed value: a stale
    // capacity list under an "Armor slot" caption would be unusable chrome.
    const armorOptions = Array.from(
      req(
        root.querySelector<HTMLElement>('[data-market-filter-menu="subtype"]'),
        'armor slot filter menu',
      ).querySelectorAll<HTMLElement>('[data-market-filter-option]'),
    ).map((option) => option.dataset.marketFilterOption);
    expect(armorOptions).toContain('chest');
    expect(armorOptions).not.toContain(MARKET_BAG_SIZE_FILTERS[1]);
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
