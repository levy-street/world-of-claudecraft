// @vitest-environment happy-dom
//
// The crafting window's gathering-goal Track control (Intentional Gathering
// PR4): its OWN quantity, 1..50, uncoupled from the existing craftQty
// stepper (which clamps to the current mats-fit). Drives the REAL
// renderCraftingWindow painter over the REAL buildCraftingView pure core, the
// crafting_window_craft_fee.test.ts shape.

import { describe, expect, it, vi } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildCraftingView, type RecipeDefLike } from '../src/ui/hud/professions/crafting_view';
import {
  type CraftingWindowDeps,
  renderCraftingWindow,
} from '../src/ui/hud/professions/crafting_window';

function item(id: string): ItemDef {
  return { id, name: id, quality: 'common', kind: 'junk', sellValue: 0 } as unknown as ItemDef;
}

function table(...items: ItemDef[]): Record<string, ItemDef> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function shortageRecipe(): RecipeDefLike {
  return {
    id: 'recipe_shortage',
    professionId: 'leatherworking',
    resultItemId: 'recipe_shortage_result',
    resultCount: 1,
    reagents: [{ itemId: 'leather', count: 1 }],
    skillReq: 0,
  };
}

function baseDeps(overrides: Partial<CraftingWindowDeps> = {}): CraftingWindowDeps {
  return {
    hideTooltip: () => {},
    onCraft: () => {},
    onClose: () => {},
    onOpenOrders: () => {},
    craftQty: () => 1,
    onCraftQty: () => {},
    announce: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: vi.fn(),
    commissionChecked: () => false,
    onToggleCommission: () => {},
    selectedCraft: () => null,
    onSelectCraft: () => {},
    ...overrides,
  };
}

// Only ONE unit of leather held: mats-fit for this recipe is 1, so craftQty's
// own stepper could never exceed it. The goal quantity below deliberately
// asks for far more than that.
function viewWithShortage() {
  const items = table(item('leather'), item('recipe_shortage_result'));
  const inventory: InvSlot[] = [{ itemId: 'leather', count: 1 }];
  return buildCraftingView([shortageRecipe()], inventory, items);
}

describe('renderCraftingWindow: no goal-tracking affordance without all three optional deps', () => {
  it('renders nothing when goalQty/onGoalQty/onTrackRecipe are omitted', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, viewWithShortage(), baseDeps());
    expect(el.querySelector('.crafting-goal-row')).toBeNull();
  });

  it('still renders nothing when only ONE of the three is supplied', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, viewWithShortage(), baseDeps({ goalQty: () => 5 }));
    expect(el.querySelector('.crafting-goal-row')).toBeNull();
  });
});

describe('renderCraftingWindow: the goal quantity is independent of mats-fit', () => {
  it('the goal stepper can exceed the 1-unit mats-fit and is never clamped down to it', () => {
    const el = document.createElement('div');
    const onGoalQty = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({
        goalQty: () => 12,
        onGoalQty,
        onTrackRecipe: vi.fn(),
      }),
    );
    const goalRow = el.querySelector('.crafting-goal-row');
    expect(goalRow).not.toBeNull();
    const value = goalRow?.querySelector('.crafting-qty-value');
    expect(value?.textContent).toBe('12');
    // The existing craft qty stepper, by contrast, stays clamped to mats-fit
    // (1 unit of leather held): the two controls never share state.
    const craftQtyValue = el
      .querySelector('.crafting-recipe-item')
      ?.querySelector('.crafting-qty-value');
    expect(craftQtyValue?.textContent).toBe('1');
  });

  it('the goal stepper clamps to 1..50, uncoupled from reagent count', () => {
    const el = document.createElement('div');
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({
        goalQty: () => 999,
        onGoalQty: vi.fn(),
        onTrackRecipe: vi.fn(),
      }),
    );
    const value = el.querySelector('.crafting-goal-row .crafting-qty-value');
    expect(value?.textContent).toBe('50');
  });

  it('incrementing the goal stepper calls onGoalQty exactly once, and never onCraftQty', () => {
    const el = document.createElement('div');
    const onGoalQty = vi.fn();
    const onCraftQty = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({
        onCraftQty,
        goalQty: () => 12,
        onGoalQty,
        onTrackRecipe: vi.fn(),
      }),
    );
    const incBtn = el.querySelectorAll<HTMLButtonElement>(
      '.crafting-goal-row .crafting-qty-btn',
    )[1];
    incBtn.click();
    expect(onGoalQty).toHaveBeenCalledTimes(1);
    expect(onGoalQty).toHaveBeenCalledWith('recipe_shortage', 13);
    expect(onCraftQty).not.toHaveBeenCalled();
  });
});

describe('renderCraftingWindow: Track fires exactly once, only on explicit click', () => {
  it('never calls onTrackRecipe merely by rendering the row', () => {
    const el = document.createElement('div');
    const onTrackRecipe = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({ goalQty: () => 12, onGoalQty: vi.fn(), onTrackRecipe }),
    );
    expect(onTrackRecipe).not.toHaveBeenCalled();
  });

  it('clicking Track calls onTrackRecipe exactly once with the recipe id and current goal qty', () => {
    const el = document.createElement('div');
    const onTrackRecipe = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({ goalQty: () => 12, onGoalQty: vi.fn(), onTrackRecipe }),
    );
    const trackBtn = el.querySelector<HTMLButtonElement>('.crafting-track-goal-btn');
    expect(trackBtn).not.toBeNull();
    trackBtn?.click();
    expect(onTrackRecipe).toHaveBeenCalledTimes(1);
    expect(onTrackRecipe).toHaveBeenCalledWith('recipe_shortage', 12);
  });

  it('the Track button accessible name carries the CURRENT (non-1) goal quantity, never a bare item name', () => {
    const el = document.createElement('div');
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({ goalQty: () => 12, onGoalQty: vi.fn(), onTrackRecipe: vi.fn() }),
    );
    const trackBtn = el.querySelector<HTMLButtonElement>('.crafting-track-goal-btn');
    expect(trackBtn?.getAttribute('aria-label')).toBe(
      'Track 12 crafts of recipe_shortage_result as your gathering goal',
    );
  });

  it('clicking Create (a separate action) never calls onTrackRecipe', () => {
    const el = document.createElement('div');
    const onTrackRecipe = vi.fn();
    const onCraft = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({
        onCraft,
        goalQty: () => 12,
        onGoalQty: vi.fn(),
        onTrackRecipe,
      }),
    );
    el.querySelector<HTMLButtonElement>('.crafting-recipe-btn')?.click();
    expect(onCraft).toHaveBeenCalled();
    expect(onTrackRecipe).not.toHaveBeenCalled();
  });

  it('selecting/rendering a row never calls onGoalQty either', () => {
    const el = document.createElement('div');
    const onGoalQty = vi.fn();
    renderCraftingWindow(
      el,
      viewWithShortage(),
      baseDeps({ goalQty: () => 12, onGoalQty, onTrackRecipe: vi.fn() }),
    );
    expect(onGoalQty).not.toHaveBeenCalled();
  });
});
