// @vitest-environment happy-dom
// The bags Sort button (the one-shot clean-up): drives the REAL BagsWindow
// against a jsdom container (the bags_window_use_routing.test.ts fixture
// idiom) and pins the press contract: exactly one world.sortInventory
// dispatch, the filter/search/view reset back to the pristine cells, and the
// one-shot settle ripple that plays only once the painted grid CONTENT
// changes (online the press repaints the still-unsorted mirror first; the
// tidied grid lands with the heavy self snapshot).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

// Each test gets FRESH stack objects (the ripple test stamps slot hints onto
// whatever it is handed), a clean woc_bag_filter (BagsWindow reads it at
// construction), and an empty document.body (harness roots would otherwise
// accumulate and turn any future document-scoped query into cross-test
// contamination), so no case depends on a predecessor's writes.
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function harness(inventory: InvSlot[]): {
  root: HTMLElement;
  window: BagsWindow;
  world: { inventory: InvSlot[] };
  sortCalls: number[];
  tooltips: Map<Element, () => string>;
} {
  const sortCalls: number[] = [];
  const tooltips = new Map<Element, () => string>();
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    sortInventory: () => {
      sortCalls.push(1);
    },
  } as unknown as IWorld & { inventory: InvSlot[] };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: (el: HTMLElement, html: () => string) => {
      tooltips.set(el, html);
    },
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
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const window = new BagsWindow(deps);
  window.render();
  return { root, window, world, sortCalls, tooltips };
}

const inv = (): InvSlot[] => [
  { itemId: 'baked_bread', count: 2 },
  { itemId: 'worn_sword', count: 1 },
  { itemId: 'baked_bread', count: 3 },
];

function clickSort(root: HTMLElement): void {
  const btn = root.querySelector('button.bag-sort-btn');
  expect(btn).not.toBeNull();
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('bags sort button', () => {
  it('renders in the tools row with a focus key and an accessible name', () => {
    const { root } = harness(inv());
    const btn = root.querySelector('button.bag-sort-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.dataset.focusKey).toBe('bag-sort-btn');
    // Non-empty AND not the raw key: the regression this catches is a missing
    // catalog entry rendering the key itself (a t()-vs-t() compare would not).
    expect(btn?.getAttribute('aria-label')).toBeTruthy();
    expect(btn?.getAttribute('aria-label')).not.toBe('hudChrome.bags.sortButtonAria');
    expect(btn?.closest('.bag-tools')).not.toBeNull();
  });

  it('dispatches exactly one world.sortInventory per press', () => {
    const { root, sortCalls } = harness(inv());
    clickSort(root);
    expect(sortCalls).toHaveLength(1);
  });

  it('resets an active category/sort/search view back to the pristine cells', () => {
    const { root } = harness(inv());
    // Arm all three dimensions: the press must reset EVERY one, not just the
    // sort (a `{ ...this.filter, sort: 'recent' }` narrowing would leave the
    // chip and the search text live over the tidied bag).
    const select = root.querySelector('select.bag-sort') as HTMLSelectElement;
    select.value = 'quality';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const chip = [...root.querySelectorAll('button.bag-chip')].find(
      (c) => c.getAttribute('aria-pressed') === 'false',
    ) as HTMLElement;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const search = root.querySelector('input.bag-search') as HTMLInputElement;
    search.value = 'bread';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    clickSort(root);
    // Back to the manual view: dropdown on recent, All chip active, search
    // empty, and the grid paints real cells again (data-bag-index only exists
    // in the manual view).
    expect((root.querySelector('select.bag-sort') as HTMLSelectElement).value).toBe('recent');
    expect((root.querySelector('input.bag-search') as HTMLInputElement).value).toBe('');
    const firstChip = root.querySelector('button.bag-chip') as HTMLElement;
    expect(firstChip.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('button.bag-item[data-bag-index]')).not.toBeNull();
  });

  it('does not persist the filter reset: the saved preference survives the press', () => {
    const { root } = harness(inv());
    const select = root.querySelector('select.bag-sort') as HTMLSelectElement;
    select.value = 'quality';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const saved = localStorage.getItem('woc_bag_filter');
    expect(saved).toContain('quality');
    clickSort(root);
    expect(localStorage.getItem('woc_bag_filter')).toBe(saved);
  });

  it('never fires the ripple from the press filter reset alone (online mirror unchanged)', () => {
    const { root } = harness(inv());
    // Arm a derived view first: the press resets it, which switches the grid
    // SHAPE (list to real cells). That alone is not a sort effect.
    const select = root.querySelector('select.bag-sort') as HTMLSelectElement;
    select.value = 'quality';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    clickSort(root);
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
  });

  it('fires the ripple when only cell hints move (a restamp with no merge)', () => {
    // Pinned clock: the armed arm must not depend on how long the test runner
    // takes between the click and the render (gate contention can exceed the
    // 3s backstop on the real wall clock).
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
    const { root, window, world } = harness(inv());
    clickSort(root);
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
    for (let i = 0; i < world.inventory.length; i++) world.inventory[i].slot = i;
    window.render();
    expect(root.querySelector('.bag-grid-settle')).not.toBeNull();
  });

  it('plays the settle ripple only once the painted content changes', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
    const { root, window, world } = harness(inv());
    // The press itself repaints an UNCHANGED grid (the online mirror has not
    // heard back yet): no ripple.
    clickSort(root);
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
    // The snapshot lands: the sorted content arrives and the next paint
    // ripples, with the stagger index stamped per square.
    world.inventory[0] = { itemId: 'baked_bread', count: 5, slot: 1 };
    world.inventory[1] = { itemId: 'worn_sword', count: 1, slot: 0 };
    world.inventory.splice(2, 1);
    window.render();
    const grid = root.querySelector('.bag-grid-settle');
    expect(grid).not.toBeNull();
    const first = grid?.children[0] as HTMLElement;
    expect(first?.style.getPropertyValue('--settle-i')).toBe('0');
    // A later ordinary repaint does not ripple again (one-shot).
    window.render();
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
  });

  it('the timeout backstop disarms a no-op sort for good', () => {
    const { root, window, world } = harness(inv());
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    clickSort(root);
    now += 3500; // past SORT_SETTLE_MS with nothing changed (already tidy)
    for (let i = 0; i < world.inventory.length; i++) world.inventory[i].slot = i;
    window.render();
    // Disarmed, not merely skipped: even a real change no longer ripples.
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
    world.inventory[0].count = 4;
    window.render();
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
  });

  it('never fires the ripple without a press: ordinary loot repaints stay still', () => {
    // A small pinned clock is what makes this decisive: with the armed-at-0
    // guard deleted, `now - 0` must read as INSIDE the settle window (a warm
    // process's large performance.now would mask the mutant by expiring it).
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
    const { root, window, world } = harness(inv());
    world.inventory.push({ itemId: 'baked_bread', count: 1 });
    window.render();
    expect(root.querySelector('.bag-grid-settle')).toBeNull();
  });

  it('renders the tooltip hint through t(), never the raw key', () => {
    const { root, tooltips } = harness(inv());
    const btn = root.querySelector('button.bag-sort-btn');
    expect(btn).not.toBeNull();
    const html = tooltips.get(btn as Element);
    expect(html).toBeDefined();
    const body = html ? html() : '';
    expect(body).toContain('tt-sub');
    expect(body).not.toContain('hudChrome.bags.sortButtonHint');
    expect(body.replace(/<[^>]*>/g, '').trim()).not.toBe('');
  });

  it('caps the stagger index so a full bag settles inside half a second', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => 1000);
    const many: InvSlot[] = Array.from({ length: 26 }, () => ({
      itemId: 'baked_bread',
      count: 1,
    }));
    const { root, window, world } = harness(many);
    (world as unknown as { bagCapacity: number }).bagCapacity = 28;
    clickSort(root);
    for (let i = 0; i < world.inventory.length; i++) world.inventory[i].slot = i;
    window.render();
    const grid = root.querySelector('.bag-grid-settle');
    expect(grid).not.toBeNull();
    if (!grid) throw new Error('settle grid missing');
    const styleAt = (i: number) =>
      (grid.children[i] as HTMLElement).style.getPropertyValue('--settle-i');
    expect(styleAt(19)).toBe('19');
    expect(styleAt(25)).toBe('20'); // clamped at SORT_SETTLE_STAGGER_CAP
  });
});

// Source pins over the CSS half of the settle contract (the TS side above can
// only see the --settle-i indices). Each regex is a CONTIGUOUS block match,
// never a lazy span that could satisfy itself across a neighboring rule (the
// reduced-motion media block holds exactly the one settle rule, so the pin
// closes the block it opened).
describe('settle ripple CSS contract (components.css)', () => {
  // join(__dirname, ...) rather than an import.meta URL: the DOM environment
  // rewrites import.meta.url to an http scheme (the instance-marker suite's
  // documented workaround).
  const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  it('pins the 160ms duration and the 14ms per-cell stagger, both motion-scaled', () => {
    // The half-second claim in the stagger-cap test above is 160 + 20 * 14 =
    // 440ms; these literals are its CSS half, so a delay bump cannot silently
    // outgrow the budget while every test stays green.
    expect(css).toMatch(
      /\.bag-grid-settle\s*>\s*\*\s*\{\s*animation:\s*bag-sort-settle\s+calc\(160ms\s*\*\s*var\(--motion-scale,\s*1\)\)\s+ease-out\s+backwards;\s*animation-delay:\s*calc\(var\(--settle-i,\s*0\)\s*\*\s*14ms\s*\*\s*var\(--motion-scale,\s*1\)\);\s*\}/,
    );
  });

  it('pins BOTH reduced-motion off switches (media query and body class)', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.bag-grid-settle\s*>\s*\*\s*\{\s*animation:\s*none;\s*\}\s*\}/,
    );
    expect(css).toMatch(
      /body\.reduce-motion\s+\.bag-grid-settle\s*>\s*\*\s*\{\s*animation:\s*none;\s*\}/,
    );
  });
});
