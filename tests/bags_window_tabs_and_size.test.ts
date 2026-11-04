// @vitest-environment happy-dom
// The bag tabs and the view size (the inventory UX phase 1): drives the REAL
// BagsWindow against a happy-dom container (the bags_window_sort_button.test.ts
// harness) and pins the player-visible contract: the chip row order with the new
// Favorites and Junk tabs, the Junk count badge, each tab showing exactly the
// copies its predicate claims, and the Compact / Large / List size select that
// restyles the grid, persists, and never moves a stack's real cell index.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGearSet } from '../src/sim/loadout_gear';
import type { InvSlot } from '../src/sim/types';
import { BAG_CATEGORIES } from '../src/ui/bag_filter';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function harness(
  inventory: InvSlot[],
  extra: Record<string, unknown> = {},
): { root: HTMLElement; window: BagsWindow; errors: string[] } {
  const errors: string[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    sortInventory: () => {},
    loadouts: [],
    ...extra,
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    tradeOfferHeadroom: () => 0,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: (text: string) => {
      errors.push(text);
    },
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    sellConfirmPolicy: () => ({ enabled: true, minQualityRank: 1 }),
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const window = new BagsWindow(deps);
  window.render();
  return { root, window, errors };
}

// soggy_boot is grey vendor trash (what Sell Junk sells); the locked sword is a
// favorite; the plain sword and the bread are neither.
const inv = (): InvSlot[] => [
  { itemId: 'baked_bread', count: 2 },
  { itemId: 'soggy_boot', count: 3 },
  { itemId: 'worn_sword', count: 1, instance: { locked: true } },
  { itemId: 'worn_sword', count: 1 },
];

function chip(root: HTMLElement, category: string): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(`[data-focus-key="bagchip:${category}"]`);
  expect(el, category).not.toBeNull();
  return el as HTMLButtonElement;
}

function shownItemIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('.bag-grid .bag-item:not(.empty)')].map(
    (el) => el.dataset.coachItem ?? '',
  );
}

function sizeSelect(root: HTMLElement): HTMLSelectElement {
  const el = root.querySelector<HTMLSelectElement>('select.bag-size');
  expect(el).not.toBeNull();
  return el as HTMLSelectElement;
}

function pickSize(root: HTMLElement, value: string): void {
  const select = sizeSelect(root);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('bag tabs: Favorites and Junk', () => {
  it('paints one chip per category in the pinned rail order, each with a real label', () => {
    const { root } = harness(inv());
    const keys = [...root.querySelectorAll<HTMLElement>('.bag-chips .bag-chip')].map((el) =>
      (el.dataset.focusKey ?? '').replace('bagchip:', ''),
    );
    expect(keys).toEqual([...BAG_CATEGORIES]);
    expect(chip(root, 'favourite').textContent).toBe('Favorites');
    expect(chip(root, 'junk').textContent).toContain('Junk');
  });

  it('badges the Junk chip with the sellable junk count and names it for assistive tech', () => {
    const { root } = harness(inv());
    const junk = chip(root, 'junk');
    expect(junk.querySelector('.bag-chip-count')?.textContent).toBe('3');
    expect(junk.getAttribute('aria-label')).toBe('Junk, 3 items');
  });

  it('leaves the Junk chip quiet when nothing would sell', () => {
    const { root } = harness([{ itemId: 'baked_bread', count: 2 }]);
    const junk = chip(root, 'junk');
    expect(junk.querySelector('.bag-chip-count')).toBeNull();
    expect(junk.getAttribute('aria-label')).toBeNull();
  });

  it('Favorites shows exactly the locked copy, Junk exactly the grey trash', () => {
    const { root } = harness(inv());
    chip(root, 'favourite').click();
    expect(shownItemIds(root)).toEqual(['worn_sword']);
    expect(chip(root, 'favourite').getAttribute('aria-pressed')).toBe('true');
    chip(root, 'junk').click();
    expect(shownItemIds(root)).toEqual(['soggy_boot']);
  });
});

describe('bag view size', () => {
  it('defaults to the classic compact grid', () => {
    const { root } = harness(inv());
    expect(sizeSelect(root).value).toBe('compact');
    expect(sizeSelect(root).getAttribute('aria-label')).toBe('Bag view size');
    const grid = root.querySelector('.bag-grid') as HTMLElement;
    expect(grid.classList.contains('bag-size-compact')).toBe(true);
  });

  it('switches the grid class, persists the choice, and a fresh window reads it back', () => {
    const { root } = harness(inv());
    pickSize(root, 'list');
    const grid = root.querySelector('.bag-grid') as HTMLElement;
    expect(grid.classList.contains('bag-size-list')).toBe(true);
    expect(grid.classList.contains('bag-size-compact')).toBe(false);
    expect(localStorage.getItem('woc_bag_view_size')).toBe('list');
    document.body.innerHTML = '';
    const again = harness(inv());
    expect(sizeSelect(again.root).value).toBe('list');
    expect(again.root.querySelector('.bag-grid')?.classList.contains('bag-size-list')).toBe(true);
  });

  it('a corrupt stored size falls back to compact', () => {
    localStorage.setItem('woc_bag_view_size', 'enormous');
    const { root } = harness(inv());
    expect(sizeSelect(root).value).toBe('compact');
  });

  it('every stack cell carries its aria-hidden name for the List view', () => {
    const { root } = harness(inv());
    pickSize(root, 'list');
    const names = [...root.querySelectorAll<HTMLElement>('.bag-grid .bag-item .bi-name')];
    expect(names).toHaveLength(4);
    for (const n of names) {
      expect(n.getAttribute('aria-hidden')).toBe('true');
      expect(n.textContent?.length).toBeGreaterThan(0);
    }
  });

  it('never moves a stack: every size paints the same real cell indices', () => {
    const indices = (root: HTMLElement): string[] =>
      [...root.querySelectorAll<HTMLElement>('.bag-grid .bag-item')].map(
        (el) => `${el.dataset.coachItem ?? 'empty'}@${el.dataset.bagIndex ?? '-'}`,
      );
    const { root } = harness(inv());
    const compact = indices(root);
    pickSize(root, 'large');
    expect(indices(root)).toEqual(compact);
    pickSize(root, 'list');
    expect(indices(root)).toEqual(compact);
  });
});

// Phase 2 and 3: captions over the derived lists, and the All view's Sections toggle.
function captions(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('.bag-grid .bag-section-header')].map(
    (el) => `${el.classList.contains('bag-section-sub') ? '  ' : ''}${el.textContent ?? ''}`,
  );
}

function sectionsButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('button.bag-sections-btn');
}

const gearInv = (): InvSlot[] => [
  { itemId: 'baked_bread', count: 2 },
  { itemId: 'eastbrook_greatsword', count: 1 },
  { itemId: 'worn_sword', count: 1 },
  { itemId: 'recruit_tunic', count: 1 },
  { itemId: 'soggy_boot', count: 3 },
];

describe('bag captions', () => {
  it('Weapons captions each hand group', () => {
    const { root } = harness(gearInv());
    chip(root, 'weapon').click();
    expect(captions(root)).toEqual(['One-Hand', 'Two-Hand']);
    expect(shownItemIds(root)).toEqual(['worn_sword', 'eastbrook_greatsword']);
  });

  it('the Sections toggle shows only on All, is off by default, and keeps the real cells', () => {
    const { root } = harness(gearInv());
    const btn = sectionsButton(root);
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(captions(root)).toEqual([]);
    expect(root.querySelector('.bag-grid .bag-item[data-bag-index="0"]')).not.toBeNull();
    chip(root, 'weapon').click();
    expect(sectionsButton(root)).toBeNull();
  });

  it('Sections on groups All by category with nested slot captions, and persists', () => {
    const { root, errors } = harness(gearInv());
    sectionsButton(root)?.click();
    expect(sectionsButton(root)?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('woc_bag_sections')).toBe('on');
    expect(captions(root)).toEqual([
      'Weapons',
      '  One-Hand',
      '  Two-Hand',
      'Armor',
      '  Chest',
      'Consumables',
      'Junk',
    ]);
    // A list now: no stack names a real cell, and the free squares still paint.
    expect(root.querySelector('.bag-grid .bag-item[data-bag-index]')).toBeNull();
    expect(root.querySelectorAll('.bag-grid .bag-item.empty').length).toBe(16 - 5);
    // A fresh window reads the toggle back.
    document.body.innerHTML = '';
    const again = harness(gearInv());
    expect(captions(again.root)[0]).toBe('Weapons');
    expect(errors).toEqual([]);
  });

  it('Favorites captions each gear set by its loadout name, as text', () => {
    const loadouts = [
      {
        name: '<b>Tank</b> set',
        alloc: {},
        bar: [],
        gear: buildGearSet({ mainhand: 'worn_sword', chest: 'recruit_tunic' }, undefined),
      },
    ];
    const inventory = gearInv();
    inventory.push({ itemId: 'baked_bread', count: 1, instance: { locked: true } });
    const { root } = harness(inventory, { loadouts });
    chip(root, 'favourite').click();
    expect(captions(root)).toEqual(['<b>Tank</b> set', 'Locked']);
    expect(root.querySelector('.bag-section-header b')).toBeNull();
    expect(shownItemIds(root)).toEqual(['worn_sword', 'recruit_tunic', 'baked_bread']);
  });
});
