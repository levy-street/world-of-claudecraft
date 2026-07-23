// @vitest-environment jsdom

// Painter pins for the train window's card treatment: the two-arm fee
// rendering (the gold action chip on an AFFORDABLE teachable row only, the
// plain error-tint price when the fee is short, the muted plain price on
// locked rows, no price on known rows), the shared quality-glow socket on
// every row, and the card-fill hover restores in CSS (jsdom runs no layout,
// so the cascade arms are pinned at the source). The pure ladder model is
// tests/train_view.test.ts; the unbind window's matching arms are pinned in
// tests/professions_commissions_ui.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { TrainRow, TrainView } from '../src/ui/hud/vendor/train_view';
import { renderTrainWindow } from '../src/ui/hud/vendor/train_window';

const SWORD = 'eastbrook_arming_sword';

function deps() {
  return {
    hideTooltip: vi.fn(),
    onTrain: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => '<img class="item-icon">'),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
  };
}

function row(over: Partial<TrainRow>): TrainRow {
  return {
    recipeId: 'recipe_qa_train_painter',
    professionId: 'weaponcrafting',
    resultItemId: SWORD,
    item: ITEMS[SWORD],
    skillReq: 0,
    state: 'teachable',
    feeCopper: 2500,
    affordable: true,
    ...over,
  };
}

function paint(rows: TrainRow[]): HTMLElement {
  const el = document.createElement('div');
  const view: TrainView = { stationType: 'forge', rows };
  renderTrainWindow(el, 'Darva', view, deps());
  return el;
}

describe('renderTrainWindow fee arms (gold chip on affordable rows ONLY)', () => {
  it('an affordable teachable row renders the gold fee chip and no plain price', () => {
    const el = paint([row({})]);
    const button = el.querySelector('.train-teachable') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const chip = button.querySelector('.vi-price-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('25');
    expect(button.querySelector('.vi-price')).toBeNull();
  });

  it('an unaffordable teachable row keeps the plain error-tint price, never the chip', () => {
    const el = paint([row({ affordable: false })]);
    const button = el.querySelector('.train-teachable') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.vi-price-chip')).toBeNull();
    const price = button.querySelector('.vi-price');
    expect(price?.classList.contains('unaffordable')).toBe(true);
    expect(price?.textContent).toContain('25');
  });

  it('a locked row renders the muted plain price and a known row no price at all', () => {
    const el = paint([
      row({
        recipeId: 'r_locked',
        state: 'locked',
        requirement: { craft: 'weaponcrafting', skill: 25 },
      }),
      row({ recipeId: 'r_known', state: 'known', feeCopper: 0 }),
    ]);
    const locked = el.querySelector('.train-locked') as HTMLButtonElement;
    expect(locked.querySelector('.vi-price-chip')).toBeNull();
    const lockedPrice = locked.querySelector('.vi-price');
    expect(lockedPrice).not.toBeNull();
    expect(lockedPrice?.classList.contains('unaffordable')).toBe(false);
    const known = el.querySelector('.train-known') as HTMLElement;
    expect(known.querySelector('.vi-price')).toBeNull();
    expect(known.querySelector('.vi-price-chip')).toBeNull();
  });
});

describe('renderTrainWindow quality-glow socket', () => {
  it('every row carries the shared socket span, glowing from the item quality', () => {
    const el = paint([
      row({}),
      row({ recipeId: 'r_known', state: 'known' }),
      row({ recipeId: 'r_locked', state: 'locked' }),
    ]);
    const sockets = el.querySelectorAll('.crafting-recipe-socket');
    expect(sockets).toHaveLength(3);
    // The arming sword def carries a quality, so the socket derives a glow;
    // the icon itself still comes from the presentation bag.
    const socket = sockets[0] as HTMLElement;
    expect(ITEMS[SWORD].quality).toBeTruthy();
    expect(socket.getAttribute('style') ?? '').toContain('box-shadow');
    expect(socket.querySelector('.item-icon')).not.toBeNull();
  });
});

describe('train/unbind card hover restores (CSS source pins)', () => {
  // jsdom runs no layout or cascade, so the two rules that keep the card fill
  // under the vendor family's higher-specificity hover arms are pinned at the
  // source: without them, .vendor-item:disabled:hover blanks a disabled card
  // to transparent and the known row's wash suppressor did the same.
  const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  it('restates the card fill on disabled hover for both service windows', () => {
    const start = css.indexOf('.train-row:disabled:hover,\n  .unbind-row:disabled:hover {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24)');
  });

  it('keeps the card fill (never transparent) on the known-row hover', () => {
    const start = css.indexOf('.train-row.train-known:hover {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24)');
    expect(rule).not.toContain('background: transparent');
  });
});
