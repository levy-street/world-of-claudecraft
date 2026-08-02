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
import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { HeroicShopRow, HeroicShopView } from '../src/ui/hud/vendor/heroic_vendor_view';
import { renderHeroicVendorWindow } from '../src/ui/hud/vendor/heroic_vendor_window';
import type {
  VendorBuybackRow,
  VendorGoodsRow,
  VendorView,
} from '../src/ui/hud/vendor/vendor_view';
import { renderVendorWindow, type VendorWindowDeps } from '../src/ui/hud/vendor/vendor_window';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

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

describe('renderVendorWindow: goods/buyback grid wrapping', () => {
  it('appends goods rows as children of .vendor-goods-grid', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'bread',
        item: item('bread'),
        price: { copper: 5, honor: 0 },
        quantity: 1,
        affordable: true,
      },
      {
        itemId: 'water',
        item: item('water'),
        price: { copper: 2, honor: 0 },
        quantity: 1,
        affordable: true,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
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
    const view: VendorView = { goods: [], buyback, honorBalance: 0, hasHonorGoods: false };
    const el = document.createElement('div');
    renderVendorWindow(el, 'Vendor', view, deps());

    const grids = el.querySelectorAll('.vendor-goods-grid');
    expect(grids.length).toBe(1);
    const rows = grids[0].querySelectorAll('.vendor-item');
    expect(rows.length).toBe(1);
    expect(rows[0].parentElement).toBe(grids[0]);
  });

  it('appends no empty .vendor-goods-grid when both sections are empty', () => {
    const view: VendorView = { goods: [], buyback: [], honorBalance: 0, hasHonorGoods: false };
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
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
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
        bulkQuantity: 1,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
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
        bulkQuantity: 20,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
    const el = document.createElement('div');
    let bulkCalled: [string, boolean | undefined] | undefined;
    renderVendorWindow(
      el,
      'Vendor',
      view,
      deps({ onBuy: (itemId, bulk) => (bulkCalled = [itemId, bulk]) }),
    );

    const rows = el.querySelectorAll('.vendor-item');
    expect(rows.length).toBe(2);
    const bulkRow = el.querySelector('.vendor-item-bulk') as HTMLButtonElement | null;
    expect(bulkRow).not.toBeNull();
    expect(bulkRow?.parentElement).toBe(el.querySelector('.vendor-goods-grid'));
    expect(bulkRow?.getAttribute('aria-label')).toContain('20');

    bulkRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bulkCalled).toEqual(['thread', true]);
  });

  it('the Buy Stack tile is disabled whenever the bulk purchase itself is unaffordable', () => {
    const goods: VendorGoodsRow[] = [
      {
        itemId: 'thread',
        item: item('thread'),
        price: { copper: 12, honor: 0 },
        quantity: 1,
        affordable: false,
        bulkQuantity: 3,
        bulkAffordable: false,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
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
        bulkQuantity: 3,
        bulkAffordable: true,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
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
        bulkQuantity: 20,
      },
    ];
    const view: VendorView = { goods, buyback: [], honorBalance: 0, hasHonorGoods: false };
    const el = document.createElement('div');
    const calls: (boolean | undefined)[] = [];
    renderVendorWindow(el, 'Vendor', view, deps({ onBuy: (_itemId, bulk) => calls.push(bulk) }));

    const mainRow = el.querySelector('.vendor-item:not(.vendor-item-bulk)') as HTMLButtonElement;
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    mainRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(calls).toEqual([true, true, false]);
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
});
