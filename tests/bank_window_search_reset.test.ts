// @vitest-environment happy-dom
//
// The bank search is a per-visit filter: closing the window resets it, no
// persist write ever stores it, and construction never restores one (and
// eagerly scrubs a stranded stored query), so a reopen never starts
// pre-narrowed to a stale query (items silently hidden with no cue why). The
// persisted category/sort preferences still survive the close/reopen and the
// session boundary; only the search is transient. Drives the REAL BankWindow
// (the bags_window_focus_restore harness idiom) against a stubbed IWorld bank
// mirror, in both the offline Sim shape (bonusSources: []) and the online
// ClientWorld shape (a server-stamped bonus breakdown).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BAG_CATEGORIES, type BagCategory } from '../src/ui/bag_filter';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld } from '../src/world_api';

const BANK_FILTER_KEY = 'woc_bank_filter';

// Real catalog ids with distinct names/kinds so a search and a category chip
// both narrow the grid: 'worn_sword' (Pitted Shortsword, weapon) and
// 'copper_ore' (Copper Ore, junk/material-tier).
function bankInfo(overrides?: Partial<BankInfo>): BankInfo {
  return {
    slots: [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'copper_ore', count: 5 },
    ],
    capacity: 12,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 1000,
    bonusSources: [],
    ...overrides,
  };
}

interface HarnessWorld {
  bankInfo: BankInfo | null;
  inventory: InvSlot[];
  bankDeposit(): void;
  bankWithdraw(): void;
  bankBuySlots(): void;
}

function harness(info: BankInfo = bankInfo()): {
  root: HTMLElement;
  w: BankWindow;
  world: HarnessWorld;
} {
  const world: HarnessWorld = {
    bankInfo: info,
    inventory: [],
    bankDeposit: () => {},
    bankWithdraw: () => {},
    bankBuySlots: () => {},
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return { root, w: new BankWindow(deps), world };
}

function searchInput(root: HTMLElement): HTMLInputElement {
  const el = root.querySelector('.bag-search') as HTMLInputElement | null;
  expect(el, 'search input missing').toBeTruthy();
  return el as HTMLInputElement;
}

function typeSearch(root: HTMLElement, query: string): void {
  const el = searchInput(root);
  el.value = query;
  el.dispatchEvent(new Event('input'));
}

// Chips render in BAG_CATEGORIES order, so lookup goes by index, not by the
// localized label (an English reword must not red this suite).
function chip(root: HTMLElement, category: BagCategory): HTMLButtonElement {
  const chips = [...root.querySelectorAll<HTMLButtonElement>('.bag-chip')];
  const el = chips[BAG_CATEGORIES.indexOf(category)];
  expect(el, `chip ${category} missing`).toBeTruthy();
  return el;
}

function activeCategory(root: HTMLElement): BagCategory | undefined {
  const chips = [...root.querySelectorAll<HTMLButtonElement>('.bag-chip')];
  const idx = chips.findIndex((c) => c.getAttribute('aria-pressed') === 'true');
  return idx < 0 ? undefined : BAG_CATEGORIES[idx];
}

function occupiedCells(root: HTMLElement): number {
  return root.querySelectorAll('button.bank-item').length;
}

function emptyPadCells(root: HTMLElement): number {
  return root.querySelectorAll('div.bank-item.empty').length;
}

function storedFilter(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(BANK_FILTER_KEY) ?? '{}');
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('bank window search reset on close', () => {
  it('clears the search when the window closes, so a reopen starts unfiltered', () => {
    const { root, w } = harness();
    w.open();
    typeSearch(root, 'copper');
    // The live search narrowed the grid to the one matching stack and dropped
    // the free-slot pad (proves the real filter path ran, not just the input
    // value).
    expect(occupiedCells(root)).toBe(1);
    expect(emptyPadCells(root)).toBe(0);
    w.close();
    w.open();
    expect(searchInput(root).value).toBe('');
    expect(occupiedCells(root)).toBe(2);
    // The unfiltered view's decorative capacity pad is back too: 12 - 2.
    expect(emptyPadCells(root)).toBe(10);
    w.close();
  });

  it('never lands the search query in storage (every persist write strips it)', () => {
    const { root, w } = harness();
    w.open();
    typeSearch(root, 'copper');
    // The keystroke persist strips the query at the serialize boundary...
    expect(storedFilter().search).toBe('');
    // ...so does the chip-click write, driven WHILE the query is live (a future
    // second write path in the handler must not store it)...
    chip(root, 'weapon').click();
    expect(storedFilter().search).toBe('');
    // ...and the sort-change write (the chip click rebuilt the window, so both
    // the select and the search need re-driving on the fresh nodes)...
    typeSearch(root, 'copper');
    const sort = root.querySelector('.bag-sort') as HTMLSelectElement;
    sort.value = 'name';
    sort.dispatchEvent(new Event('change'));
    expect(storedFilter().search).toBe('');
    // ...and the close-path rewrite leaves it scrubbed as well.
    w.close();
    expect(storedFilter().search).toBe('');
  });

  it('a data-driven rebuild restores the live query into the fresh input (mid-visit repaint)', () => {
    const { root, w } = harness();
    w.open();
    typeSearch(root, 'copper');
    // A slow-band data repaint (a deposit echo) rebuilds the whole window while
    // the player is mid-search; the fresh input must carry the live query, not
    // blank the box over a still-narrowed grid. This pins the restore the reset
    // cases above read as their evidence channel.
    w.render();
    expect(searchInput(root).value).toBe('copper');
    expect(occupiedCells(root)).toBe(1);
    w.close();
  });

  it('keeps the persisted category and sort across close/reopen (only search is transient)', () => {
    const { root, w } = harness();
    w.open();
    chip(root, 'weapon').click();
    const sort = root.querySelector('.bag-sort') as HTMLSelectElement;
    sort.value = 'name';
    sort.dispatchEvent(new Event('change'));
    typeSearch(root, 'pitted');
    w.close();
    w.open();
    expect(activeCategory(root)).toBe('weapon');
    expect(searchInput(root).value).toBe('');
    expect(storedFilter()).toEqual({ category: 'weapon', sort: 'name', search: '' });
    // The LIVE sort survived too, not just the stored copy: widening back to All
    // paints the grid name-sorted (Copper Ore before Pitted Shortsword), the
    // reverse of the recent/slot order. (The select's .value is not read here:
    // happy-dom mis-selects when option.selected is set pre-append. The name
    // literals are inherent to a name-sort proof; the ids are pinned real
    // catalog entries.)
    chip(root, 'all').click();
    const labels = [...root.querySelectorAll<HTMLButtonElement>('button.bank-item')].map(
      (c) => c.getAttribute('aria-label') ?? '',
    );
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Copper Ore');
    expect(labels[1]).toContain('Pitted Shortsword');
    w.close();
  });

  it('never restores a stale persisted search on construction (reload while the bank was open)', () => {
    // A reload while the bank sat open never runs close(), so a pre-fix session
    // can have left a query in the stored filter; the next session must not
    // resurface it, while the category/sort preferences do come back. Construction
    // also eagerly rewrites the stranded query out of storage (no need to open
    // or close the bank for the scrub to land).
    localStorage.setItem(
      BANK_FILTER_KEY,
      JSON.stringify({ category: 'weapon', sort: 'name', search: 'copper' }),
    );
    const { root, w } = harness();
    // Scrub is construction-time, before open: storage must already be clean.
    expect(storedFilter()).toEqual({ category: 'weapon', sort: 'name', search: '' });
    w.open();
    expect(searchInput(root).value).toBe('');
    expect(activeCategory(root)).toBe('weapon');
    // The weapon chip narrows to the one weapon; the empty-cell pad is a
    // narrowed-view drop, so exactly one occupied cell renders. Were the stale
    // 'copper' search still applied, ZERO cells would match (the ore is no weapon).
    expect(occupiedCells(root)).toBe(1);
    w.close();
    expect(storedFilter()).toEqual({ category: 'weapon', sort: 'name', search: '' });
  });

  it('round-trips category/sort to a fresh instance while the search stays per-visit', () => {
    // The real cross-session shape: instance A writes its preferences and closes;
    // a second BankWindow (a new session over the same storage) restores the
    // category live AND the sort live (proven by rendered order, not just the
    // stored shape), with the search gone.
    const a = harness();
    a.w.open();
    chip(a.root, 'weapon').click();
    const sort = a.root.querySelector('.bag-sort') as HTMLSelectElement;
    sort.value = 'name';
    sort.dispatchEvent(new Event('change'));
    typeSearch(a.root, 'pitted');
    a.w.close();
    const b = harness();
    b.w.open();
    expect(activeCategory(b.root)).toBe('weapon');
    expect(searchInput(b.root).value).toBe('');
    chip(b.root, 'all').click();
    const labels = [...b.root.querySelectorAll<HTMLButtonElement>('button.bank-item')].map(
      (c) => c.getAttribute('aria-label') ?? '',
    );
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Copper Ore');
    expect(labels[1]).toContain('Pitted Shortsword');
    b.w.close();
  });

  it('the walk-away grace close resets the search like any other close', () => {
    const { root, w, world } = harness();
    w.open();
    typeSearch(root, 'copper');
    // The player walks out of banker range: the mirror goes null and, past the
    // grace window, refreshIfChanged force-closes the window (no x-btn click).
    world.bankInfo = null;
    const now = performance.now();
    const spy = vi.spyOn(performance, 'now').mockReturnValue(now + 60_000);
    try {
      w.refreshIfChanged();
      expect(w.isOpen).toBe(false);
    } finally {
      spy.mockRestore();
    }
    world.bankInfo = bankInfo();
    w.open();
    expect(searchInput(root).value).toBe('');
    expect(occupiedCells(root)).toBe(2);
    w.close();
  });

  it('resets identically under a server-stamped bonus breakdown (the online mirror shape)', () => {
    // Online, bankInfo carries the server-stamped bonus sources and the window
    // renders the bonus footer in the same rebuild; the per-visit reset must
    // behave the same there as in the offline Sim shape above.
    const { root, w } = harness(
      bankInfo({
        bonusSlots: 2,
        bonusSources: [{ id: 'referral', slots: 2, maxSlots: 6, count: 1, cap: 3 }],
      }),
    );
    w.open();
    expect(root.querySelector('.bank-bonus'), 'bonus section missing').toBeTruthy();
    typeSearch(root, 'copper');
    expect(occupiedCells(root)).toBe(1);
    w.close();
    w.open();
    expect(searchInput(root).value).toBe('');
    expect(occupiedCells(root)).toBe(2);
    expect(root.querySelector('.bank-bonus'), 'bonus section missing after reopen').toBeTruthy();
    w.close();
  });
});
