// @vitest-environment jsdom
// Behavioral pin for the vendor / Heroic Quartermaster grid painters (round 4
// review on PR #2101, EnriqueGF: neither renderVendorWindow nor
// renderHeroicVendorWindow was ever driven against a real DOM, so the
// .vendor-goods-grid wrapping and the two `length > 0` empty-grid guards
// added in earlier rounds were untested). Drives the real painters against a
// jsdom container and asserts goods/buyback rows land as children of
// .vendor-goods-grid, and that no empty grid node is appended when a section
// has no rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { VendorBuyOptions } from '../src/sim/vendor_buy_stack';
import { dismissBuyQuantityPrompts } from '../src/ui/hud/vendor/buy_quantity_prompt_window';
import type { HeroicShopRow, HeroicShopView } from '../src/ui/hud/vendor/heroic_vendor_view';
import { renderHeroicVendorWindow } from '../src/ui/hud/vendor/heroic_vendor_window';
import type {
  VendorBuybackRow,
  VendorGoodsRow,
  VendorView,
} from '../src/ui/hud/vendor/vendor_view';
import { renderVendorWindow, type VendorWindowDeps } from '../src/ui/hud/vendor/vendor_window';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

// Select a prompt button by its rendered accessible name, never by position:
// a reorder of confirm/cancel must fail loudly here, not silently swap which
// button a test clicks.
function promptButton(prompt: Element, label: 'Buy' | 'Cancel'): HTMLButtonElement {
  const match = [...prompt.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  expect(match, `prompt button labelled ${label}`).toBeDefined();
  return match as HTMLButtonElement;
}

function item(id: string): ItemDef {
  return {
    id,
    name: id,
    quality: 'common',
    kind: 'junk',
    slot: 'trinket',
    sellValue: 0,
  } as unknown as ItemDef;
}

function deps(overrides: Partial<VendorWindowDeps> = {}): VendorWindowDeps {
  return {
    itemIcon: () => '<img>',
    moneyHtml: (copper) => `${copper}c`,
    itemTooltip: () => '<div></div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onBuy: () => {},
    onQtyChange: () => {},
    buyCustomMax: () => 0,
    onBuyBack: () => {},
    onSellJunk: () => {},
    onClose: () => {},
    sellJunk: { enabled: false, proceeds: 0 },
    ...overrides,
  };
}

function heroicDeps(overrides: Partial<Parameters<typeof renderHeroicVendorWindow>[3]> = {}) {
  return {
    itemIcon: () => '<img>',
    moneyHtml: (copper: number) => `${copper}c`,
    itemTooltip: () => '<div></div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onBuy: () => {},
    onClose: () => {},
    ...overrides,
  };
}

describe('renderVendorWindow / renderHeroicVendorWindow: dialog root (accessible name, #2808)', () => {
  it('renderVendorWindow marks #vendor-window as a labeled dialog', () => {
    const view: VendorView = {
      goods: [],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Darva', view, deps());

    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('false');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('aria-label')).toBe('Darva: Goods');
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('renderHeroicVendorWindow marks #vendor-window as a labeled dialog', () => {
    const view: HeroicShopView = { rows: [], balance: 0 };
    const el = document.createElement('div');
    renderHeroicVendorWindow(el, 'Quartermaster', view, heroicDeps());

    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('false');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('aria-label')).toBe('Quartermaster: Goods');
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });
});

describe('renderVendorWindow: goods/buyback grid wrapping', () => {
  it('appends goods rows as children of .vendor-goods-grid', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'bread',
        item: item('bread'),
        price: { copper: 5, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
      },
      {
        itemId: 'water',
        item: item('water'),
        price: { copper: 2, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const grids = el.querySelectorAll('.vendor-goods-grid');
    expect(grids.length).toBe(1);
    const rows = grids[0].querySelectorAll('.vendor-item');
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.parentElement).toBe(grids[0]);
  });

  it('appends buyback rows as children of their own .vendor-goods-grid', () => {
    const buyback: VendorBuybackRow[] = [
      { itemId: 'sword', item: item('sword'), count: 1, price: 100, index: 0 },
    ];
    const view: VendorView = {
      goods: [],
      buyback,
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const grids = el.querySelectorAll('.vendor-goods-grid');
    expect(grids.length).toBe(1);
    const rows = grids[0].querySelectorAll('.vendor-item');
    expect(rows.length).toBe(1);
    expect(rows[0].parentElement).toBe(grids[0]);
  });

  it('paints a requirement-unmet row ENABLED with its advisory line and the buy aria-label (R22)', () => {
    // The advisory contract, driven through the real painter: the row stays
    // in the grid, it SELLS (never disabled for proficiency; the wield gate
    // at the harvest owns enforcement), it says what the tool will ask of
    // its buyer, and the accessible name keeps the honest buy promise.
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'iron_mining_pick',
        item: item('iron_mining_pick'),
        price: { copper: 120, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: true,
        requirement: { professionId: 'mining', proficiency: 40 },
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const row = el.querySelector('.vendor-item') as HTMLButtonElement;
    expect(row).not.toBeNull();
    // The class survives purely as the sub-line tint hook.
    expect(row.classList.contains('vendor-locked')).toBe(true);
    // ENABLED although the requirement is unmet: the sale is real (R22).
    expect(row.disabled).toBe(false);
    // The accessible name states the buy promise AND the requirement: an
    // aria-label replaces the button's content as its name, so without the
    // combined key a screen reader would never hear what the sighted
    // sub-line says.
    expect(row.getAttribute('aria-label')).toContain('Iron Mining Pick');
    expect(row.getAttribute('aria-label')).toContain('Requires Mining 40');
    expect(row.querySelector('.vi-sub')?.textContent).toBe('Requires Mining 40');
    // The price still renders: the row shows what it will cost.
    expect(row.querySelector('.vi-price')?.textContent).toContain('120');
  });

  it('a requirement-unmet row with no printable requirement still sells with the buy aria-label', () => {
    // The no-display-name corner: a profession missing from the shared name
    // table renders no sub-line. Under the advisory model that must not
    // change anything else about the row: it stays enabled and keeps its
    // honest buy label (the old model suppressed the label here, which is
    // exactly the behavior the retirement of the purchase deny removed).
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'iron_mining_pick',
        item: item('iron_mining_pick'),
        price: { copper: 120, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: true,
        // An id with no entry in the shared name table.
        requirement: { professionId: 'not_a_profession' as never, proficiency: 40 },
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const row = el.querySelector('.vendor-item') as HTMLButtonElement;
    expect(row.classList.contains('vendor-locked')).toBe(true);
    expect(row.disabled).toBe(false);
    // No requirement line is printable; the buy label stands regardless.
    expect(row.querySelector('.vi-sub')).toBeNull();
    expect(row.getAttribute('aria-label')).toContain('Iron Mining Pick');
  });

  it('the requirement-unmet row TOOLTIP invites the click and appends NO second requirement line', () => {
    // The deps bag's attachTooltip is a no-op by default, so the tooltip
    // builder closure never runs and this branch was invisible. Capture the
    // builder and invoke it: the shared item tooltip (deps.itemTooltip, which
    // resolves gatherToolTooltipLines) already carries the requirement
    // sentence on every requirement-carrying tool, so the painter appending
    // it again rendered the line twice on every gated row. The painter owes
    // the click invitation only; the requirement rides the item tooltip.
    const built: string[] = [];
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'iron_mining_pick',
        item: item('iron_mining_pick'),
        price: { copper: 120, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: true,
        requirement: { professionId: 'mining', proficiency: 40 },
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(
      el,
      'Vendor',
      view,
      deps({
        attachTooltip: (_node: HTMLElement, build: () => string) => {
          built.push(build());
        },
      }),
    );

    // The goods row is the first tooltip attached (sell-junk and buyback rows
    // attach their own after it).
    expect(built.length).toBeGreaterThan(0);
    expect(built[0]).toContain('Click to buy');
    // The painter itself adds no requirement line (the stubbed itemTooltip
    // here proves the appended half is gone; the real one carries it once).
    expect(built[0]).not.toContain('Requires Mining 40');
  });

  it('keeps click-to-buy on an unlocked row TOOLTIP', () => {
    // The counter-example: without it the arm above passes on a painter that
    // dropped the click hint from every row.
    const built: string[] = [];
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'copper_mining_pick',
        item: item('copper_mining_pick'),
        price: { copper: 20, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(
      el,
      'Vendor',
      view,
      deps({
        attachTooltip: (_node: HTMLElement, build: () => string) => {
          built.push(build());
        },
      }),
    );

    expect(built[0]).toContain('Click to buy');
    expect(built[0]).not.toContain('Requires');
  });

  it('leaves an unlocked row interactive, aria-labelled, and free of a requirement line', () => {
    // The counter-example that keeps the arm above from passing on a painter
    // that marked every row locked.
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'copper_mining_pick',
        item: item('copper_mining_pick'),
        price: { copper: 20, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const row = el.querySelector('.vendor-item') as HTMLButtonElement;
    expect(row.classList.contains('vendor-locked')).toBe(false);
    expect(row.disabled).toBe(false);
    expect(row.getAttribute('aria-label')).toBe('Buy Copper Mining Pick for 20c');
    expect(row.querySelector('.vi-sub')).toBeNull();
  });

  it('an unaffordable but UNGATED row disables without claiming a requirement', () => {
    // Distinguishes the two disabled states: only the gated one grows the
    // .vendor-locked class and the requirement line.
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'copper_mining_pick',
        item: item('copper_mining_pick'),
        price: { copper: 20, honor: 0 },
        quantity: 1,
        affordable: false,
        requirementUnmet: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const row = el.querySelector('.vendor-item') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.classList.contains('vendor-locked')).toBe(false);
    expect(row.querySelector('.vi-sub')).toBeNull();
    expect(row.hasAttribute('aria-label')).toBe(true);
  });

  it('appends no empty .vendor-goods-grid when both sections are empty', () => {
    const view: VendorView = {
      goods: [],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    expect(el.querySelectorAll('.vendor-goods-grid').length).toBe(0);
    // The empty-buyback state message still renders in its place.
    expect(el.querySelector('.vendor-empty')).not.toBeNull();
  });
});

describe('renderVendorWindow: bulk purchase (#2374)', () => {
  it('a row with no bulkQuantity renders only the ordinary buy tile', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'bread',
        item: item('bread'),
        price: { copper: 5, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    expect(el.querySelectorAll('.vendor-item').length).toBe(1);
    expect(el.querySelector('.vendor-item-bulk')).toBeNull();
  });

  it('a row with bulkQuantity of exactly 1 stays a single tile (no redundant Buy Stack)', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'thread',
        item: item('thread'),
        price: { copper: 12, honor: 0 },
        quantity: 1,
        affordable: false,
        requirementUnmet: false,
        bulkQuantity: 1,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    expect(el.querySelectorAll('.vendor-item').length).toBe(1);
    expect(el.querySelector('.vendor-item-bulk')).toBeNull();
  });

  it('a row with bulkQuantity > 1 renders a second, always-visible Buy Stack tile', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'thread',
        item: item('thread'),
        price: { copper: 12, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
        bulkQuantity: 20,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    let bulkCalled: [string, VendorBuyOptions | undefined] | undefined;
    renderVendorWindow(
      el,
      'Vendor',
      view,
      deps({ onBuy: (itemId, opts) => (bulkCalled = [itemId, opts]) }),
    );

    const rows = el.querySelectorAll('.vendor-item');
    expect(rows.length).toBe(2);
    const bulkRow = el.querySelector('.vendor-item-bulk') as HTMLButtonElement | null;
    expect(bulkRow).not.toBeNull();
    expect(bulkRow?.parentElement).toBe(el.querySelector('.vendor-goods-grid'));
    expect(bulkRow?.getAttribute('aria-label')).toContain('20');

    bulkRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bulkCalled).toEqual(['thread', { bulk: true }]);
  });

  it('the Buy Stack tile is disabled whenever the bulk purchase itself is unaffordable', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'thread',
        item: item('thread'),
        price: { copper: 12, honor: 0 },
        quantity: 1,
        affordable: false,
        requirementUnmet: false,
        bulkQuantity: 3,
        bulkAffordable: false,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const bulkRow = el.querySelector('.vendor-item-bulk') as HTMLButtonElement | null;
    expect(bulkRow?.disabled).toBe(true);
  });

  it('the Buy Stack tile stays enabled when the ordinary row is unaffordable but the bulk purchase is (food/drink stack-of-5 case)', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'loaf',
        item: item('loaf'),
        price: { copper: 50, honor: 0 },
        quantity: 5,
        affordable: false,
        requirementUnmet: false,
        bulkQuantity: 3,
        bulkAffordable: true,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const row = el.querySelector('.vendor-item:not(.vendor-item-bulk)') as HTMLButtonElement | null;
    const bulkRow = el.querySelector('.vendor-item-bulk') as HTMLButtonElement | null;
    expect(row?.disabled).toBe(true);
    expect(bulkRow?.disabled).toBe(false);
  });

  it('ctrl-click and cmd-click on the ordinary tile also request a bulk purchase', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'thread',
        item: item('thread'),
        price: { copper: 12, honor: 0 },
        quantity: 1,
        affordable: true,
        requirementUnmet: false,
        bulkQuantity: 20,
      },
    ];
    const view: VendorView = {
      goods,
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    const calls: (VendorBuyOptions | undefined)[] = [];
    renderVendorWindow(el, 'Vendor', view, deps({ onBuy: (_itemId, opts) => calls.push(opts) }));

    const mainRow = el.querySelector('.vendor-item:not(.vendor-item-bulk)') as HTMLButtonElement;
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(calls).toEqual([{ bulk: true }, { bulk: true }, undefined]);
  });
});

describe('renderHeroicVendorWindow: goods grid wrapping', () => {
  it('appends rows as children of .vendor-goods-grid', () => {
    const rows: HeroicShopRow[] = [
      { itemId: 'trinket', item: item('trinket'), marks: 10, affordable: true },
    ];
    const view: HeroicShopView = { rows, balance: 20 };
    const el = document.createElement('div');
    renderHeroicVendorWindow(el, 'Quartermaster', view, heroicDeps());

    const grids = el.querySelectorAll('.vendor-goods-grid');
    expect(grids.length).toBe(1);
    const itemRows = grids[0].querySelectorAll('.vendor-item');
    expect(itemRows.length).toBe(1);
    expect(itemRows[0].parentElement).toBe(grids[0]);
  });

  it('appends no empty .vendor-goods-grid when there are no rows', () => {
    const view: HeroicShopView = { rows: [], balance: 0 };
    const el = document.createElement('div');
    renderHeroicVendorWindow(el, 'Quartermaster', view, heroicDeps());

    expect(el.querySelectorAll('.vendor-goods-grid').length).toBe(0);
  });

  it('carries keyboard focus across a repaint (uninitiated rebuilds, #2931)', () => {
    // Marks are a bag count, so ANY inventory delta repaints this window
    // uninitiated through Hud.repaintOpenServiceWindows; the
    // focus-across-a-REBUILD contract applies (the train/unbind idiom).
    // Attached to document.body: focus() is inert on a detached tree.
    const rows: HeroicShopRow[] = [
      { itemId: 'trinket', item: item('trinket'), marks: 10, affordable: true },
      { itemId: 'charm', item: item('charm'), marks: 10, affordable: true },
    ];
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderHeroicVendorWindow(el, 'Quartermaster', { rows, balance: 20 }, heroicDeps());
    el.querySelector<HTMLButtonElement>('[data-focus-key="buy:trinket"]')?.focus();
    renderHeroicVendorWindow(el, 'Quartermaster', { rows, balance: 20 }, heroicDeps());
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('buy:trinket');
    // The focused tile going disabled falls to the grid neighbor, never to
    // <body>: the rung an uninitiated marks repaint actually exercises.
    renderHeroicVendorWindow(
      el,
      'Quartermaster',
      { rows: [{ ...rows[0], affordable: false }, rows[1]], balance: 5 },
      heroicDeps(),
    );
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('buy:charm');
    // Every tile disabled falls to the close button.
    renderHeroicVendorWindow(
      el,
      'Quartermaster',
      { rows: rows.map((r) => ({ ...r, affordable: false })), balance: 0 },
      heroicDeps(),
    );
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('close');
    el.remove();
  });

  // The focus test attaches to document.body; a mid-test failure must not
  // leak a focused node into the shared document for later tests.
  afterEach(() => {
    document.body.innerHTML = '';
  });
});

describe('#vendor-window desktop width cap: divides by --window-scale and clears #bags', () => {
  // jsdom gives import.meta.url an http URL, which readFileSync(new URL(...)) rejects
  // (see deeds_window.test.ts): resolve from __dirname instead.
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
  const marker = '#vendor-window {\n    width:';
  const firstIndex = components.indexOf(marker);
  const occurrences = components.split(marker).length - 1;
  const start = firstIndex;
  const block = components.slice(start, components.indexOf('}', start));
  // Normalized so the pin survives Biome reflowing the multi-line calc()
  // (round 5 review, PR #2101: the raw multi-line substring never matched).
  const normalized = block.replace(/\s+/g, ' ');

  it('exists exactly once', () => {
    expect(occurrences).toBe(1);
  });

  it('divides the viewport term by --window-scale, not --ui-scale (round 4 review, PR #2101)', () => {
    expect(normalized).toContain('var(--app-vw, 100vw) / var(--window-scale)');
    expect(normalized).not.toContain('var(--app-vw, 100vw) - 2 *');
  });

  it('floors the width at 400px so it never regresses below the pre-PR fixed window', () => {
    expect(normalized).toMatch(/width: max\( 400px, min\( 860px,/);
  });

  it('caps the width so it clears the #bags left edge at any viewport/scale (round 5 review, PR #2101)', () => {
    // #bags centres itself at left: ((100% + 50% + bar-half + gap - micro-r) / 2)
    // then translateX(-50%), with micro-r = 50px + gap (gap cancels) and a
    // steady-state width of 310px once --bags-slot-w stops binding: its left
    // edge is 0.75 * VW + (barHalf - 50) / 2 - 155. #vendor-window is centred
    // (right edge = VW / 2 + width / 2) and must stay clear of that edge.
    const barHalf = 306;
    for (const scale of [0.8, 1, 1.25, 1.4]) {
      for (const vw of [700, 900, 1024, 1100, 1280, 1400, 1600, 1920, 2560]) {
        const authorVw = vw / scale;
        const width = Math.max(400, Math.min(860, 0.5 * authorVw + barHalf - 362));
        const vendorRightEdge = authorVw / 2 + width / 2;
        const bagsLeftEdge = 0.75 * authorVw + (barHalf - 50) / 2 - 155;
        // Small viewports keep the 400px floor: #bags is bottom-anchored and
        // #vendor-window top-anchored, so any residual overlap there is
        // vertical, not horizontal (see the CSS comment); only assert
        // clearance once the floor is no longer the binding constraint.
        if (width > 400) {
          expect(vendorRightEdge).toBeLessThanOrEqual(bagsLeftEdge + 1);
        }
      }
    }
  });
});

describe('renderVendorWindow: focus across the rebuild (the R22 advisory widening)', () => {
  function goodsRow(itemId: string): VendorGoodsRow {
    return {
      itemId,
      item: item(itemId),
      price: { copper: 5, honor: 0 },
      quantity: 1,
      affordable: true,
      requirementUnmet: false,
    };
  }

  it('a focused goods row keeps focus when the rebuild repaints it', () => {
    // The buy path rebuilds the whole grid with fresh elements; before the
    // capture-and-restore wiring a keyboard buy dropped focus to <body> on
    // every purchase (pre-existing for affordable rows, widened by the
    // advisory turn making requirement rows focusable for the first time).
    const view: VendorView = {
      goods: [goodsRow('bread'), goodsRow('water')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', view, deps());
      const water = el.querySelector<HTMLButtonElement>('[data-focus-key="buy:water"]');
      expect(water).not.toBeNull();
      water?.focus();
      expect(document.activeElement).toBe(water);
      renderVendorWindow(el, 'Vendor', view, deps());
      const rebuilt = el.querySelector<HTMLButtonElement>('[data-focus-key="buy:water"]');
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).not.toBe(water); // genuinely a fresh element
      expect(document.activeElement).toBe(rebuilt);
    } finally {
      el.remove();
    }
  });

  it('a focused Buy Stack tile keeps focus when the rebuild repaints it (the merge seam)', () => {
    // The release's bulk tile (#2374) landed beside this branch's
    // focus-across-a-rebuild contract without a focus key, so a keyboard
    // bulk buy dropped focus to <body> on the repaint its own purchase
    // triggers: exactly the defect class the ordinary row already guards.
    const view: VendorView = {
      goods: [{ ...goodsRow('thread'), bulkQuantity: 20, bulkAffordable: true }],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', view, deps());
      const tile = el.querySelector<HTMLButtonElement>('[data-focus-key="buy-stack:thread"]');
      expect(tile, 'the bulk tile must carry its own focus key').not.toBeNull();
      tile?.focus();
      expect(document.activeElement).toBe(tile);
      renderVendorWindow(el, 'Vendor', view, deps());
      const rebuilt = el.querySelector<HTMLButtonElement>('[data-focus-key="buy-stack:thread"]');
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).not.toBe(tile); // genuinely a fresh element
      expect(document.activeElement).toBe(rebuilt);
    } finally {
      el.remove();
    }
  });

  it('a focused qty control keeps focus when its own activation rebuilds the window (acceptance f)', () => {
    // Every control-row activation forces a full rebuild through onQtyChange,
    // so the qty buttons are the one surface where the player's OWN click
    // repaints the node under their finger; the restore must land back on the
    // same key with the pressed state flipped.
    const before: VendorView = {
      goods: [goodsRow('bread')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', before, deps());
      const five = el.querySelector<HTMLButtonElement>('[data-focus-key="qty:5"]')!;
      five.focus();
      expect(five.getAttribute('aria-pressed')).toBe('false');
      // The activation's rebuild, as the Hud performs it: same container,
      // the view rebuilt for the newly selected multiple.
      renderVendorWindow(el, 'Vendor', { ...before, multiple: 5 }, deps());
      const rebuilt = el.querySelector<HTMLButtonElement>('[data-focus-key="qty:5"]')!;
      expect(rebuilt).not.toBe(five); // genuinely a fresh element
      expect(document.activeElement).toBe(rebuilt);
      expect(rebuilt.getAttribute('aria-pressed')).toBe('true');
    } finally {
      el.remove();
    }
  });

  it('a row that comes back DISABLED yields to its enabled grid neighbor (the last-stack buy)', () => {
    // The primary degradation the focus_restore family documents: buying the
    // last affordable stack drains copper, so the SAME row returns from the
    // rebuild disabled (row.disabled = !affordable) and cannot take focus.
    // The restore must stay INSIDE the row (the sibling item), never jump to
    // Close, where a reflexive Enter would shut the vendor.
    const before: VendorView = {
      goods: [goodsRow('bread'), goodsRow('water')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const after: VendorView = {
      ...before,
      goods: [goodsRow('bread'), { ...goodsRow('water'), affordable: false }],
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', before, deps());
      el.querySelector<HTMLButtonElement>('[data-focus-key="buy:water"]')?.focus();
      renderVendorWindow(el, 'Vendor', after, deps());
      const rebuilt = el.querySelector<HTMLButtonElement>('[data-focus-key="buy:water"]');
      expect(rebuilt?.disabled).toBe(true);
      expect(document.activeElement).not.toBe(rebuilt);
      expect(document.activeElement).toBe(el.querySelector('[data-focus-key="buy:bread"]'));
    } finally {
      el.remove();
    }
  });

  it('a vanished row lands on the same grid slot, not on Close', () => {
    const two: VendorView = {
      goods: [goodsRow('bread'), goodsRow('water')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const one: VendorView = { ...two, goods: [goodsRow('bread')] };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', two, deps());
      el.querySelector<HTMLButtonElement>('[data-focus-key="buy:water"]')?.focus();
      // The focused row is gone; the slot clamps to the surviving sibling,
      // which is exactly where a browsing player expects to continue.
      renderVendorWindow(el, 'Vendor', one, deps());
      expect(document.activeElement).toBe(el.querySelector('[data-focus-key="buy:bread"]'));
    } finally {
      el.remove();
    }
  });

  it('an emptied grid falls to an ENABLED sell-junk before Close (the ladder rung is real)', () => {
    // The middle rung by identity: with the goods grid gone entirely, an
    // enabled sell-junk takes focus ahead of Close. This is the arm that
    // kills a deleted rung: the default deps disable sell-junk, so only an
    // enabled-sell-junk drive can tell the rung from its absence.
    const before: VendorView = {
      goods: [goodsRow('bread')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const after: VendorView = { ...before, goods: [] };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', before, deps({ sellJunk: { enabled: true, proceeds: 5 } }));
      el.querySelector<HTMLButtonElement>('[data-focus-key="buy:bread"]')?.focus();
      renderVendorWindow(el, 'Vendor', after, deps({ sellJunk: { enabled: true, proceeds: 5 } }));
      expect(document.activeElement).toBe(el.querySelector('.vendor-sell-junk'));
    } finally {
      el.remove();
    }
  });

  it('focus OUTSIDE the window is untouched by a rebuild (containment)', () => {
    // The vendor repaints from onInventoryChanged and the online vendor
    // event, neither of which is a vendor click, and it sits open beside
    // #bags; a sell from bags must not have the vendor repaint steal focus.
    const view: VendorView = {
      goods: [goodsRow('bread')],
      buyback: [],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const el = document.createElement('div');
    const outside = document.createElement('button');
    document.body.appendChild(el);
    document.body.appendChild(outside);
    try {
      renderVendorWindow(el, 'Vendor', view, deps());
      outside.focus();
      renderVendorWindow(el, 'Vendor', view, deps());
      expect(document.activeElement).toBe(outside);
    } finally {
      el.remove();
      outside.remove();
    }
  });

  it('a buyback reclaim keeps focus at the same SLOT: the next item to reclaim', () => {
    // The positional-key design, pinned instead of hand-checked: buyBackItem
    // compacts the list, so after reclaiming slot 0 the old second item now
    // holds buyback:0 and the exact-key match lands on it.
    const sword = { itemId: 'sword', item: item('sword'), count: 1, price: 10, index: 0 };
    const shield = { itemId: 'shield', item: item('shield'), count: 1, price: 12, index: 1 };
    const before: VendorView = {
      goods: [],
      buyback: [sword, shield],
      honorBalance: 0,
      hasHonorGoods: false,
      multiple: 1,
    };
    const after: VendorView = {
      ...before,
      buyback: [{ ...shield, index: 0 }],
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(el, 'Vendor', before, deps());
      el.querySelector<HTMLButtonElement>('[data-focus-key="buyback:0"]')?.focus();
      renderVendorWindow(el, 'Vendor', after, deps());
      const landed = document.activeElement as HTMLElement | null;
      expect(landed?.dataset.focusKey).toBe('buyback:0');
      expect(landed?.textContent).toContain('shield');
    } finally {
      el.remove();
    }
  });
});

describe('vendor window family: hud.ts focus-management wiring (WCAG 2.4.3)', () => {
  // Unlike vendor_view.ts/vendor_window.ts (pure core + thin painter), the
  // open/close/focus lifecycle for #vendor-window lives directly on the Hud
  // coordinator (openVendor/closeVendor/openHeroicVendor/closeHeroicVendor),
  // the same shape openBank/closeBank use for the bank companion. So this
  // suite pins the SOURCE wiring the bank_window.test.ts "hud.ts wiring"
  // section pins for bank: the non-trapping capture/return pair, matching
  // bankWindow (NOT windowFocus, which would install a Tab trap and break the
  // vendor + bags cluster, which is documented as a companion, not modal).
  // Anchors resolve with indexOf, which returns -1 (not undefined) on a miss;
  // a slice built from two -1s or one -1 plus a real offset can still
  // silently contain the expected substring (e.g. slice(-1, 40) === the
  // WHOLE tail of the file), so a renamed anchor must be caught explicitly
  // rather than trusted to make the body assertions fail for the right
  // reason.
  const anchor = (needle: string): number => {
    const at = hud.indexOf(needle);
    expect(at, `anchor not found in hud.ts: ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
    return at;
  };
  const openVendorStart = anchor('openVendor(npcId: number, opener?: HTMLElement | null): void {');
  const openVendorEnd = anchor('private renderVendor(): void {');
  const openHeroicVendorStart = anchor(
    'openHeroicVendor(npcId: number, opener?: HTMLElement | null): void {',
  );
  const openHeroicVendorEnd = anchor('private renderHeroicVendor(): void {');
  const closeHeroicVendorStart = anchor('closeHeroicVendor(): void {');
  const closeVendorStart = anchor('closeVendor(): void {');
  const vendorOpenGetterStart = anchor('get vendorOpen(): boolean {');
  expect(openVendorEnd).toBeGreaterThan(openVendorStart);
  expect(openHeroicVendorEnd).toBeGreaterThan(openHeroicVendorStart);
  expect(closeVendorStart).toBeGreaterThan(closeHeroicVendorStart);
  expect(vendorOpenGetterStart).toBeGreaterThan(closeVendorStart);
  const openVendorBody = hud.slice(openVendorStart, openVendorEnd);
  const openHeroicVendorBody = hud.slice(openHeroicVendorStart, openHeroicVendorEnd);
  const closeHeroicVendorBody = hud.slice(closeHeroicVendorStart, closeVendorStart);
  const closeVendorBody = hud.slice(closeVendorStart, vendorOpenGetterStart);

  it('captures the opener on openVendor and openHeroicVendor via the shared FocusManager, with an explicit opener overriding the fallback', () => {
    expect(openVendorBody).toContain(
      'this.vendorOpenerFocus = opener !== undefined ? opener : this.focusManager.activeFocusable();',
    );
    expect(openHeroicVendorBody).toContain(
      'this.vendorOpenerFocus = opener !== undefined ? opener : this.focusManager.activeFocusable();',
    );
  });

  it('returns focus to the opener on closeVendor and closeHeroicVendor', () => {
    expect(closeVendorBody).toContain('this.focusManager.restore(this.vendorOpenerFocus);');
    expect(closeHeroicVendorBody).toContain('this.focusManager.restore(this.vendorOpenerFocus);');
  });

  it('never installs a Tab trap for #vendor-window (non-modal bags companion)', () => {
    expect(hud).not.toMatch(/this\.windowFocus\('#vendor-window'\)/);
  });

  it('closeVendor is a no-op when the copper vendor tenant is not open (Esc/generic close on the heroic tenant)', () => {
    // closeManagedWindow('vendor-window') calls closeVendor() then closeHeroicVendor()
    // unconditionally, since either tenant can hold the shared #vendor-window container.
    // Without this guard, closeVendor still ran while only the heroic tenant was open,
    // clearing the shared vendorOpenerFocus (and firing hideTooltip/mobile-bags teardown)
    // before closeHeroicVendor got a chance to restore it, so the generic close path
    // (Escape, walking out of range via the topmost-window dispatcher) dropped the
    // WCAG 2.4.3 focus return even though the explicit close button worked.
    expect(closeVendorBody).toContain('// Guard');
    expect(closeVendorBody).toContain('if (this.openVendorNpcId === null) return;');
  });

  it('every vendor lifecycle path runs the custom-prompt force-close backstop (phase 21)', () => {
    // The prompt marks #vendor-window inert while open, and only these three
    // paths can tear the window down around it: closeVendor (the ordinary
    // close), openVendor re-entry (a second merchant over a live prompt,
    // whose stale onBuy closure would aim at the previous npc), and
    // openHeroicVendor (the marks shop takes the shared container WITHOUT
    // closeVendor, which then early-returns on its null guard). Dropping any
    // one strands the window inert under an orphaned aria-modal (the
    // dismissBankPrompts precedent in bank_window.test.ts).
    expect(openVendorBody).toContain("dismissBuyQuantityPrompts($('#vendor-window'));");
    expect(openHeroicVendorBody).toContain("dismissBuyQuantityPrompts($('#vendor-window'));");
    expect(closeVendorBody).toContain("dismissBuyQuantityPrompts($('#vendor-window'));");
  });

  it('the control-row selection resets to 1x on every vendor open (recorded judgment, phase 21)', () => {
    // The build record pins this as deliberate least-surprise: a 10x selection
    // must not silently carry into the next merchant, where a reflexive
    // counter click would spend tenfold.
    expect(openVendorBody).toContain('this.vendorQtyMultiple = 1;');
  });

  it('renderVendor caps the custom prompt from the sim leaf, with unknown ids capped at 0', () => {
    // The one cheap pin on the buyCustomMax wiring: the cap must come from
    // maxBuyCount over the LIVE inventory (never a cached view), and a stale
    // bundle's unknown id caps at 0 so the prompt floor-of-1 lets the server
    // answer honestly.
    const renderVendorStart = anchor('private renderVendor(): void {');
    expect(openHeroicVendorStart).toBeGreaterThan(renderVendorStart);
    const renderVendorBody = hud.slice(renderVendorStart, openHeroicVendorStart);
    expect(renderVendorBody).toContain(
      'return def ? maxBuyCount(this.sim.inventory, this.sim.bagCapacity, def) : 0;',
    );
  });
});

describe('renderVendorWindow: the 1x/5x/10x/custom control row (phase 21)', () => {
  function goodsRow(itemId: string, over: Partial<VendorGoodsRow> = {}): VendorGoodsRow {
    return {
      itemId,
      item: item(itemId),
      price: { copper: 25, honor: 0 },
      quantity: 1,
      affordable: true,
      requirementUnmet: false,
      ...over,
    };
  }
  function view(goods: VendorGoodsRow[], multiple: VendorView['multiple']): VendorView {
    return { goods, buyback: [], honorBalance: 0, hasHonorGoods: false, multiple };
  }

  it('renders the four controls with focus keys and aria-pressed on the selection', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view([goodsRow('bread')], 5), deps());
    const btns = [...el.querySelectorAll<HTMLButtonElement>('.vendor-qty-btn')];
    expect(btns.map((b) => b.dataset.focusKey)).toEqual(['qty:1', 'qty:5', 'qty:10', 'qty:custom']);
    expect(btns.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    // The strip is a named group for screen readers.
    const row = el.querySelector('.vendor-qty-row');
    expect(row?.getAttribute('role')).toBe('group');
    expect(row?.getAttribute('aria-label')).toBeTruthy();
  });

  it('clicking a control reports the multiple through onQtyChange', () => {
    const el = document.createElement('div');
    const picked: unknown[] = [];
    renderVendorWindow(
      el,
      'Vendor',
      view([goodsRow('bread')], 1),
      deps({ onQtyChange: (m) => picked.push(m) }),
    );
    const btns = [...el.querySelectorAll<HTMLButtonElement>('.vendor-qty-btn')];
    for (const b of btns) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toEqual([1, 5, 10, 'custom']);
  });

  it('renders no control row when the vendor has no goods', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view([], 1), deps());
    expect(el.querySelector('.vendor-qty-row')).toBeNull();
  });

  it('the pressed chip keeps a non-author cue under forced-colors (never colour-only)', () => {
    // forced-colors drops the gold border/fill/text tints to the same system
    // values as an unpressed chip; the armed multiple must survive on the
    // system highlight pair (the ctx-menu danger-line pin shape).
    const components = readFileSync(
      join(__dirname, '../src/styles/components.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const forced = components.match(
      /@media \(forced-colors: active\) \{\s*\.vendor-qty-btn\[aria-pressed="true"\]\s*\{[^}]*\}/,
    );
    expect(forced, 'the pressed qty chip needs a forced-colors arm').not.toBeNull();
    const arm = forced?.[0] ?? '';
    expect(arm).toMatch(/background:\s*Highlight/);
    expect(arm).toMatch(/color:\s*HighlightText/);
    expect(arm).toMatch(/forced-color-adjust:\s*none/);
  });

  it('a count row shows the count chip and whole-count total, and disables on the count total', () => {
    const el = document.createElement('div');
    renderVendorWindow(
      el,
      'Vendor',
      view(
        [
          goodsRow('bread', {
            quantity: 5,
            countBuy: { count: 5, copper: 125, affordable: true },
          }),
          goodsRow('water', { countBuy: { count: 5, copper: 250, affordable: false } }),
        ],
        5,
      ),
      deps(),
    );
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.vendor-item')];
    // The chip wears the control row's {count}x grammar, EXACTLY: the bags
    // x{count} face would collide with the food row's own "x5" name suffix
    // (both render on this row, and they mean different quantities).
    expect(rows[0].querySelector('.vi-qty')?.textContent).toBe('5x');
    expect(rows[0].querySelector('.vi-name')?.textContent).toContain('x5');
    expect(rows[0].querySelector('.vi-price')?.textContent).toContain('125');
    expect(rows[0].disabled).toBe(false);
    // The second row is 1x-affordable (the baseline field says true) but the
    // 5x total is not: the disable state must track the SELECTED multiple.
    expect(rows[1].disabled).toBe(true);
    // The accessible name states qty and TOTAL price (acceptance f): the
    // 125c count total renders through the money formatter as 1s 25c, which
    // also pins that the aria carries the formatted read, not raw copper.
    expect(rows[0].getAttribute('aria-label')).toContain('5');
    expect(rows[0].getAttribute('aria-label')).toContain('1s 25c');
  });

  it('a count row click sends the count and ctrl/cmd still wins with bulk', () => {
    const el = document.createElement('div');
    const calls: [string, VendorBuyOptions | undefined][] = [];
    renderVendorWindow(
      el,
      'Vendor',
      view([goodsRow('bread', { countBuy: { count: 5, copper: 125, affordable: true } })], 5),
      deps({ onBuy: (id, opts) => calls.push([id, opts]) }),
    );
    const row = el.querySelector<HTMLButtonElement>('.vendor-item')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(calls).toEqual([
      ['bread', { count: 5 }],
      ['bread', { bulk: true }],
    ]);
  });

  it('a force-1 row at a fixed multiple keeps its plain 1x rendering (no chip, no count aria)', () => {
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view([goodsRow('marks_blade')], 5), deps());
    const row = el.querySelector<HTMLButtonElement>('.vendor-item')!;
    expect(row.querySelector('.vi-qty')).toBeNull();
    expect(row.getAttribute('aria-label')).toContain('marks_blade');
  });
});

describe('renderVendorWindow: the custom-amount prompt (phase 21, Q19)', () => {
  function customRow(itemId: string): VendorGoodsRow {
    return {
      itemId,
      item: item(itemId),
      price: { copper: 25, honor: 0 },
      quantity: 1,
      affordable: true,
      requirementUnmet: false,
      customBuy: true,
    };
  }
  function mountStack(): HTMLElement {
    for (const n of document.querySelectorAll('#prompt-stack')) n.remove();
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.appendChild(stack);
    return stack;
  }

  it('a custom row click opens the capped prompt instead of buying', () => {
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const calls: unknown[] = [];
    renderVendorWindow(
      el,
      'Vendor',
      {
        goods: [customRow('bread')],
        buyback: [],
        honorBalance: 0,
        hasHonorGoods: false,
        multiple: 'custom',
      },
      deps({ onBuy: (id, opts) => calls.push([id, opts]), buyCustomMax: () => 64 }),
    );
    el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(calls).toEqual([]);
    const prompt = stack.querySelector('.buy-quantity-prompt') as HTMLElement | null;
    expect(prompt).not.toBeNull();
    if (!prompt) return;
    // The computed max is shown in the title and caps the input (Q19).
    expect(prompt.querySelector('.prompt-text')?.textContent).toContain('64');
    const input = prompt.querySelector<HTMLInputElement>('.prompt-number');
    expect(input?.max).toBe('64');
    // The window behind the modal is inert while it is open (the shared recipe).
    expect(el.inert).toBe(true);
    // Confirm submits the typed count through the same onBuy seam and clears inert.
    if (input) input.value = '12';
    promptButton(prompt, 'Buy').click();
    expect(calls).toEqual([['bread', { count: 12 }]]);
    expect(el.inert).toBe(false);
    expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
    el.remove();
    stack.remove();
  });

  it('a zero-fit cap floors to 1 so a full-bag attempt reaches the server refusal honestly', () => {
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderVendorWindow(
      el,
      'Vendor',
      {
        goods: [customRow('bread')],
        buyback: [],
        honorBalance: 0,
        hasHonorGoods: false,
        multiple: 'custom',
      },
      deps({ buyCustomMax: () => 0 }),
    );
    el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const input = stack.querySelector<HTMLInputElement>('.buy-quantity-prompt .prompt-number');
    expect(input?.max).toBe('1');
    el.remove();
    stack.remove();
  });

  it('the typed amount is clamped to the cap at submit, never sent past it', () => {
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const calls: unknown[] = [];
    renderVendorWindow(
      el,
      'Vendor',
      {
        goods: [customRow('bread')],
        buyback: [],
        honorBalance: 0,
        hasHonorGoods: false,
        multiple: 'custom',
      },
      deps({ onBuy: (id, opts) => calls.push([id, opts]), buyCustomMax: () => 10 }),
    );
    el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const prompt = stack.querySelector('.buy-quantity-prompt')!;
    const input = prompt.querySelector<HTMLInputElement>('.prompt-number')!;
    input.value = '999';
    promptButton(prompt, 'Buy').click();
    expect(calls).toEqual([['bread', { count: 10 }]]);
    el.remove();
    stack.remove();
  });

  it('every degenerate typed value floors to a legal request: empty, non-numeric, negative, fractional', () => {
    // The one place a human types the number. Each arm of
    // Math.max(1, Math.min(cap, Math.floor(Number(v) || 0))) gets its own
    // case; the server re-sanitizes anyway, but the prompt must never emit a
    // count the sim would deny for shape.
    const cases: Array<[string, number]> = [
      ['', 1],
      ['abc', 1],
      ['-5', 1],
      ['3.9', 3],
    ];
    for (const [typed, expected] of cases) {
      const stack = mountStack();
      const el = document.createElement('div');
      document.body.appendChild(el);
      const calls: unknown[] = [];
      renderVendorWindow(
        el,
        'Vendor',
        {
          goods: [customRow('bread')],
          buyback: [],
          honorBalance: 0,
          hasHonorGoods: false,
          multiple: 'custom',
        },
        deps({ onBuy: (id, opts) => calls.push([id, opts]), buyCustomMax: () => 10 }),
      );
      el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      const prompt = stack.querySelector('.buy-quantity-prompt')!;
      prompt.querySelector<HTMLInputElement>('.prompt-number')!.value = typed;
      promptButton(prompt, 'Buy').click();
      expect(calls, `typed ${JSON.stringify(typed)}`).toEqual([['bread', { count: expected }]]);
      el.remove();
      stack.remove();
    }
  });

  it('a force-1 row at the custom multiple plain-buys instead of opening the prompt', () => {
    // The view withholds customBuy from force-1 rows, so the painter must
    // treat them as ordinary 1x rows even while 'custom' is selected: the
    // composition of the two pinned halves.
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const calls: unknown[] = [];
    renderVendorWindow(
      el,
      'Vendor',
      {
        goods: [{ ...customRow('marks_blade'), customBuy: undefined }],
        buyback: [],
        honorBalance: 0,
        hasHonorGoods: false,
        multiple: 'custom',
      },
      deps({ onBuy: (id, opts) => calls.push([id, opts]) }),
    );
    el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
    expect(calls).toEqual([['marks_blade', undefined]]);
    el.remove();
    stack.remove();
  });
});

describe('buy_quantity_prompt_window: force-close backstop and focus landing net (phase 21 QA)', () => {
  function customRow(itemId: string): VendorGoodsRow {
    return {
      itemId,
      item: item(itemId),
      price: { copper: 25, honor: 0 },
      quantity: 1,
      affordable: true,
      requirementUnmet: false,
      customBuy: true,
    };
  }
  function customView(goods: VendorGoodsRow[]): VendorView {
    return { goods, buyback: [], honorBalance: 0, hasHonorGoods: false, multiple: 'custom' };
  }
  function mountStack(): HTMLElement {
    for (const n of document.querySelectorAll('#prompt-stack')) n.remove();
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.appendChild(stack);
    return stack;
  }
  function openPrompt(
    el: HTMLElement,
    stack: HTMLElement,
    onBuy?: VendorWindowDeps['onBuy'],
  ): HTMLElement {
    renderVendorWindow(
      el,
      'Vendor',
      customView([customRow('bread')]),
      deps(onBuy ? { onBuy, buyCustomMax: () => 10 } : { buyCustomMax: () => 10 }),
    );
    el.querySelector<HTMLButtonElement>('.vendor-item')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const prompt = stack.querySelector<HTMLElement>('.buy-quantity-prompt');
    expect(prompt, 'prompt must open').not.toBeNull();
    return prompt as HTMLElement;
  }

  it('dismissBuyQuantityPrompts removes every open prompt and clears the window inert (the backstop the hud paths call)', () => {
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    openPrompt(el, stack);
    expect(el.inert).toBe(true);
    dismissBuyQuantityPrompts(el);
    expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
    expect(el.inert).toBe(false);
    // Idempotent on an already-clean window (the closeVendor path re-runs it).
    dismissBuyQuantityPrompts(el);
    expect(el.inert).toBe(false);
    el.remove();
    stack.remove();
  });

  it('submit lands focus on the rebuilt row by key when the opener was never focused (the pointer path)', () => {
    // macOS Safari/Firefox and iOS do not focus a <button> on click, so the
    // captured opener is <body> with no focus key. Without the item-row rung
    // the ladder fell straight to Close, where a reflexive Enter shuts the
    // whole vendor (the hazard the window's own ladder documents).
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const onBuy: VendorWindowDeps['onBuy'] = () => {
        // The buy-driven repaint: fresh nodes, the captured opener detaches.
        // Sell-junk comes back ENABLED so this also pins the RUNG ORDER: the
        // item row must win over an enabled sell-junk, not just over Close.
        renderVendorWindow(
          el,
          'Vendor',
          customView([customRow('bread')]),
          deps({ sellJunk: { enabled: true, proceeds: 5 } }),
        );
      };
      const prompt = openPrompt(el, stack, onBuy);
      prompt.querySelector<HTMLInputElement>('.prompt-number')!.value = '3';
      promptButton(prompt, 'Buy').click();
      expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
      expect(el.inert).toBe(false);
      const landed = document.activeElement as HTMLElement;
      expect(landed.dataset.focusKey).toBe('buy:bread');
    } finally {
      el.remove();
      stack.remove();
    }
  });

  it('Escape after a mid-prompt rebuild re-lands focus by the opener key on the fresh DOM (the keyboard path)', () => {
    // A renderVendor while the prompt is open (an inventory delta, a party
    // loot) detaches the captured opener, so the recipe's opener.focus()
    // silently no-ops; the net must re-find the SAME key on the new DOM.
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderVendorWindow(
        el,
        'Vendor',
        customView([customRow('bread')]),
        deps({ buyCustomMax: () => 10 }),
      );
      const row = el.querySelector<HTMLButtonElement>('[data-focus-key="buy:bread"]')!;
      row.focus();
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const prompt = stack.querySelector<HTMLElement>('.buy-quantity-prompt')!;
      // The mid-prompt rebuild: the captured opener row is now detached.
      renderVendorWindow(el, 'Vendor', customView([customRow('bread')]), deps());
      expect(row.isConnected).toBe(false);
      prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
      expect(el.inert).toBe(false);
      const landed = document.activeElement as HTMLElement;
      expect(landed.dataset.focusKey).toBe('buy:bread');
      expect(landed).not.toBe(row);
    } finally {
      el.remove();
      stack.remove();
    }
  });

  it('cancel with the row vanished falls down the ladder to sell-junk, never Close-first', () => {
    const stack = mountStack();
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const prompt = openPrompt(el, stack);
      // The row vanishes from the rebuilt window (sold out mid-prompt); the
      // sell-junk rung must be ENABLED to take focus (restoreFirstEnabled
      // skips disabled rungs).
      renderVendorWindow(
        el,
        'Vendor',
        customView([]),
        deps({ sellJunk: { enabled: true, proceeds: 5 } }),
      );
      promptButton(prompt, 'Cancel').click();
      expect(stack.querySelector('.buy-quantity-prompt')).toBeNull();
      expect(el.inert).toBe(false);
      const landed = document.activeElement as HTMLElement;
      expect(landed.dataset.focusKey).toBe('sell-junk');
    } finally {
      el.remove();
      stack.remove();
    }
  });
});
