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
      { itemId: 'sword', item: item('sword'), count: 1, price: 100 },
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
