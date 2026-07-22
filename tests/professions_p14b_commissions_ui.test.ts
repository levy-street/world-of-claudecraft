// @vitest-environment jsdom

// Professions 2.0 Phase 14b UI: the commission opt-in control in the crafting
// window (pure-core eligibility flag + painter checkbox + Hud-held state
// contract), and the Maker's Bond unbind window (unbind_view pure core +
// unbind_window painter). The sim-side arcs live in
// tests/professions_p14b_commissions.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildCraftingView } from '../src/ui/crafting_view';
import { renderCraftingWindow } from '../src/ui/crafting_window';
import { buildUnbindView } from '../src/ui/hud/vendor/unbind_view';
import { renderUnbindWindow } from '../src/ui/hud/vendor/unbind_window';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword';
const VESTMENTS = 'eastbrook_ritual_vestments';
const POTION_RECIPE = 'recipe_minor_healing_potion';

function recipeRows(recipeIds: string[]) {
  return ALL_RECIPES.filter((r) => recipeIds.includes(r.id));
}

function craftingDeps() {
  return {
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    commissionChecked: vi.fn((_recipeId: string) => false),
    onToggleCommission: vi.fn(),
  };
}

function unbindDeps() {
  return {
    hideTooltip: vi.fn(),
    onUnbind: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
  };
}

describe('crafting_view commissionEligible (the sim predicate on the row)', () => {
  it('equipment outputs flag eligible; a potion does not', () => {
    const view = buildCraftingView(recipeRows([SWORD_RECIPE, POTION_RECIPE]), [], ITEMS);
    const sword = view.recipes.find((r) => r.recipeId === SWORD_RECIPE);
    const potion = view.recipes.find((r) => r.recipeId === POTION_RECIPE);
    expect(sword?.commissionEligible).toBe(true);
    expect(potion?.commissionEligible).toBe(false);
  });

  it('an unresolvable result item def is never eligible (no control on a broken row)', () => {
    const synthetic = [
      {
        id: 'qa_p14b_ui_missing',
        professionId: 'blacksmithing',
        resultItemId: 'qa_p14b_ui_no_such_item',
        resultCount: 1,
        reagents: [],
        skillReq: 0,
      },
    ];
    const view = buildCraftingView(synthetic, [], ITEMS);
    expect(view.recipes[0].commissionEligible).toBe(false);
  });
});

describe('renderCraftingWindow commission checkbox', () => {
  it('renders the label-wrapped checkbox ONLY on eligible rows, checked from the HUD state', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    deps.commissionChecked = vi.fn((recipeId: string) => recipeId === SWORD_RECIPE);
    const view = buildCraftingView(recipeRows([SWORD_RECIPE, POTION_RECIPE]), [], ITEMS);
    renderCraftingWindow(el, view, deps);
    const rows = el.querySelectorAll('.crafting-commission-row');
    expect(rows).toHaveLength(1);
    const checkbox = rows[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(rows[0].textContent).toContain('Commission piece');
  });

  it('toggling the checkbox reports through onToggleCommission with the recipe id', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    const view = buildCraftingView(recipeRows([SWORD_RECIPE]), [], ITEMS);
    renderCraftingWindow(el, view, deps);
    const checkbox = el.querySelector(
      '.crafting-commission-row input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(deps.onToggleCommission).toHaveBeenCalledWith(SWORD_RECIPE, true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(deps.onToggleCommission).toHaveBeenCalledWith(SWORD_RECIPE, false);
  });
});

describe('buildUnbindView (the service rows mirror the resolver)', () => {
  const boundSword: InvSlot = {
    itemId: SWORD,
    count: 1,
    instance: { bindOnTrade: true, boundTo: 5 },
  };

  it('lists ONLY bound copies of eligible equipment, with the DEF-quality fee', () => {
    const inventory: InvSlot[] = [
      boundSword,
      // Armed but unbound: nothing to unbind, no row.
      { itemId: VESTMENTS, count: 1, instance: { bindOnTrade: true } },
      // Bound reagent (junk kind): the service refuses it, no row.
      { itemId: 'resonant_steel', count: 1, instance: { bindOnTrade: true, boundTo: 5 } },
      // Plain fungible stack: no row.
      { itemId: SWORD, count: 3 },
    ];
    const view = buildUnbindView({ inventory, copper: 50000, items: ITEMS });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      itemId: SWORD,
      boundCount: 1,
      feeCopper: 2500,
      affordable: true,
    });
  });

  it('aggregates bound copies across slots per item id and prices affordability off copper', () => {
    const inventory: InvSlot[] = [
      boundSword,
      { itemId: SWORD, count: 1, instance: { bindOnTrade: true, boundTo: 6, signer: 'A' } },
    ];
    const view = buildUnbindView({ inventory, copper: 100, items: ITEMS });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].boundCount).toBe(2);
    expect(view.rows[0].affordable).toBe(false);
    // The row carries the FIRST bound copy's payload (the copy the resolver
    // will actually unbind).
    expect(view.rows[0].instance).toEqual({ bindOnTrade: true, boundTo: 5 });
  });
});

describe('renderUnbindWindow painter', () => {
  it('paints an affordable row with the fee and reports the unbind click', () => {
    const el = document.createElement('div');
    const deps = unbindDeps();
    const view = buildUnbindView({
      inventory: [{ itemId: SWORD, count: 1, instance: { bindOnTrade: true, boundTo: 5 } }],
      copper: 50000,
      items: ITEMS,
    });
    renderUnbindWindow(el, 'Forgemistress Darva', view, deps);
    expect(el.textContent).toContain('Unbinding: Forgemistress Darva');
    const row = el.querySelector('.unbind-row') as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    row.click();
    expect(deps.onUnbind).toHaveBeenCalledWith(SWORD, 2500);
  });

  it('disables an unaffordable row, paints the empty state, and routes the close click', () => {
    const el = document.createElement('div');
    const deps = unbindDeps();
    const broke = buildUnbindView({
      inventory: [{ itemId: SWORD, count: 1, instance: { bindOnTrade: true, boundTo: 5 } }],
      copper: 0,
      items: ITEMS,
    });
    renderUnbindWindow(el, 'Darva', broke, deps);
    expect((el.querySelector('.unbind-row') as HTMLButtonElement).disabled).toBe(true);

    const el2 = document.createElement('div');
    renderUnbindWindow(el2, 'Darva', { rows: [] }, deps);
    expect(el2.querySelector('.vendor-empty')?.textContent).toContain(
      'You carry no bound commission pieces.',
    );
    (el2.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(deps.onClose).toHaveBeenCalled();
  });
});
