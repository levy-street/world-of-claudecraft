// @vitest-environment jsdom

// Thin-consumer tests for the commission order board painter (issue #1298):
// the "open a new order" form wires the right callback args, and each
// action button fires the matching deps callback with the row's order id.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { buildCommissionOrderBoardModel } from '../src/ui/commission_order_view';
import {
  type CommissionOrderWindowDeps,
  renderCommissionOrderWindow,
} from '../src/ui/commission_order_window';
import type { CommissionOrderView } from '../src/world_api/professions';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword';

function order(overrides: Partial<CommissionOrderView> = {}): CommissionOrderView {
  return {
    id: 7,
    requesterName: 'Ayla',
    recipeId: SWORD_RECIPE,
    itemId: SWORD,
    scope: 'open',
    status: 'open',
    mine: false,
    mineToCraft: false,
    ...overrides,
  };
}

function deps(): CommissionOrderWindowDeps {
  return {
    hideTooltip: vi.fn(),
    onOpen: vi.fn(),
    onCancel: vi.fn(),
    onAccept: vi.fn(),
    onDeliver: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
  };
}

describe('renderCommissionOrderWindow', () => {
  it('the submit button reads the form and calls onOpen with the picked recipe/scope', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [],
      [{ id: SWORD_RECIPE, resultItemId: SWORD }],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    (el.querySelector('#cob-submit') as HTMLButtonElement).click();
    expect(d.onOpen).toHaveBeenCalledWith(SWORD_RECIPE, 'open', undefined);
  });

  it('the crafter-name field surfaces only for scope "crafter" and rides the submit', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [],
      [{ id: SWORD_RECIPE, resultItemId: SWORD }],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    const crafterField = el.querySelector('#cob-crafter-field') as HTMLElement;
    expect(crafterField.style.display).toBe('none');
    const crafterRadio = el.querySelector('input[value="crafter"]') as HTMLInputElement;
    crafterRadio.checked = true;
    crafterRadio.dispatchEvent(new Event('change'));
    expect(crafterField.style.display).toBe('');
    (el.querySelector('#cob-crafter-name') as HTMLInputElement).value = 'Borin';
    (el.querySelector('#cob-submit') as HTMLButtonElement).click();
    expect(d.onOpen).toHaveBeenCalledWith(SWORD_RECIPE, 'crafter', 'Borin');
  });

  it('the recipe picker is absent when the viewer knows no commissionable recipe', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    expect(el.querySelector('#cob-recipe')).toBeNull();
    expect(el.querySelector('#cob-submit')).toBeNull();
  });

  it('a cancellable row fires onCancel with its order id', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([order({ mine: true })], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    const btn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    btn.click();
    expect(d.onCancel).toHaveBeenCalledWith(7);
  });

  it('an acceptable row fires onAccept, a deliverable row fires onDeliver', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [order({ id: 8, status: 'open' }), order({ id: 9, mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    const acceptBtn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Accept',
    ) as HTMLButtonElement;
    acceptBtn.click();
    expect(d.onAccept).toHaveBeenCalledWith(8);
    const deliverBtn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Deliver',
    ) as HTMLButtonElement;
    deliverBtn.click();
    expect(d.onDeliver).toHaveBeenCalledWith(9);
  });

  it('an empty section renders its localized empty line, not a blank list', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    const emptyLines = [...el.querySelectorAll('.vendor-empty')].map((n) => n.textContent);
    expect(emptyLines).toHaveLength(3); // mine, toCraft, board
  });

  it('the close button fires onClose', () => {
    const el = document.createElement('div');
    const d = deps();
    renderCommissionOrderWindow(el, buildCommissionOrderBoardModel([], [], ITEMS), d);
    (el.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(d.onClose).toHaveBeenCalledOnce();
  });
});
