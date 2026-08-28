// @vitest-environment jsdom

// Thin-consumer tests for the commission order board painter (issue #1298):
// the "open a new order" form wires the right callback args, and each
// action button fires the matching deps callback with the row's order id.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { buildCommissionOrderBoardModel } from '../src/ui/hud/professions/commission_order_view';
import {
  type CommissionOrderWindowDeps,
  renderCommissionOrderWindow,
} from '../src/ui/hud/professions/commission_order_window';
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
    const emptyLines = [...el.querySelectorAll('.prof-empty')].map((n) => n.textContent);
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

// The crafter's-record quality signal (Masterwrought phase 14): the compact
// line renders exactly when the view model resolved a record, with both
// counts formatted, and never invents one on an open or record-less row.
describe('the crafter record line', () => {
  it('renders label and both pluralized counts on an accepted row', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [
        order({
          status: 'accepted',
          acceptedByName: 'Borin',
          crafterMasterworks: 12,
          crafterLegendaries: 1,
        }),
      ],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    const line = el.querySelector('.commission-crafter-record');
    expect(line).not.toBeNull();
    expect(line?.querySelector('.ccr-label')?.textContent).toContain("Crafter's record");
    const values = line?.querySelector('.ccr-values')?.textContent ?? '';
    expect(values).toContain('12 masterworks');
    expect(values).toContain('1 legendary');
  });

  it('renders nothing on an open row, and nothing when the wire carried no record', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [
        order({ id: 1, status: 'open', crafterMasterworks: 4, crafterLegendaries: 4 }),
        order({ id: 2, status: 'accepted', acceptedByName: 'Borin' }),
      ],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    expect(el.querySelector('.commission-crafter-record')).toBeNull();
  });
});
