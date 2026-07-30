// @vitest-environment jsdom

// Professions 2.0 UI: the commission opt-in control in the crafting
// window (pure-core eligibility flag + the painter's pill toggle-chip + the
// Hud-held state contract), and the Maker's Bond unbind window (unbind_view
// pure core + unbind_window painter). The sim-side arcs live in
// tests/professions_commissions.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
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
    selectedCraft: () => null as string | null,
    onSelectCraft: vi.fn(),
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

describe('renderCraftingWindow commission toggle-chip', () => {
  it('renders the pill toggle ONLY on eligible rows, pressed from the HUD state', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    deps.commissionChecked = vi.fn((recipeId: string) => recipeId === SWORD_RECIPE);
    const view = buildCraftingView(recipeRows([SWORD_RECIPE, POTION_RECIPE]), [], ITEMS);
    renderCraftingWindow(el, view, deps);
    const rows = el.querySelectorAll('.crafting-commission-row');
    expect(rows).toHaveLength(1);
    const chip = rows[0].querySelector('button.crafting-commission-chip') as HTMLButtonElement;
    // A real toggle button: the accessible name is the commission label and
    // the armed state rides aria-pressed, seeded from the HUD-held set.
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.textContent).toContain('Commission piece');
    // The state pip is a decorative doubling of the pressed signal, never an
    // accessible surface of its own.
    expect(chip.querySelector('.crafting-commission-pip')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('defaults off and reports toggles through onToggleCommission, mirroring aria-pressed', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    const view = buildCraftingView(recipeRows([SWORD_RECIPE]), [], ITEMS);
    renderCraftingWindow(el, view, deps);
    const chip = el.querySelector('.crafting-commission-chip') as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    chip.click();
    expect(deps.onToggleCommission).toHaveBeenCalledWith(SWORD_RECIPE, true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    expect(deps.onToggleCommission).toHaveBeenCalledWith(SWORD_RECIPE, false);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('the recipe scroll pane never shrink-clips a card (the commission footer stays whole)', () => {
    // jsdom does no layout, so the flex behavior is pinned at the source: the
    // scroll pane's children carry an explicit shrink guard, else an
    // overflowing list compresses each card below its content height and the
    // card's overflow:hidden clips the commission chip.
    const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
    const start = css.indexOf('.crafting-body > * {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('flex-shrink: 0');
  });

  it('hovering the recipe card keeps its inset fill (the vendor-family wash cannot blank it)', () => {
    // jsdom applies no CSS, so the cascade fix is pinned at the source: the
    // family's .vendor-item:hover wash outranks the single-class card fill,
    // and the card restates its fill at matching specificity (the card is not
    // interactive, so it takes no wash; its chips carry the affordances).
    const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
    const start = css.indexOf('.vendor-item.crafting-recipe-item:hover {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24)');
  });

  it('docks the chip in the card footer after the craft button, hint tooltip on the chip', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    const view = buildCraftingView(recipeRows([SWORD_RECIPE]), [], ITEMS);
    renderCraftingWindow(el, view, deps);
    const card = el.querySelector('.crafting-recipe-item') as HTMLElement;
    const classes = [...card.children].map((child) => child.className);
    expect(classes[0]).toContain('crafting-recipe-btn');
    expect(classes[1]).toBe('crafting-commission-row');
    const chip = card.querySelector('.crafting-commission-chip');
    expect(deps.attachTooltip.mock.calls.some((call) => call[0] === chip)).toBe(true);
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
    // The card treatment: an affordable fee rides the gold action chip (never
    // the plain price), and the icon sits in the shared quality-glow socket.
    const chip = row.querySelector('.vi-price-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('25');
    expect(row.querySelector('.vi-price')).toBeNull();
    expect(row.querySelector('.crafting-recipe-socket')).not.toBeNull();
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
    const brokeRow = el.querySelector('.unbind-row') as HTMLButtonElement;
    expect(brokeRow.disabled).toBe(true);
    // The unaffordable arm keeps the plain error-tint price, never the chip.
    expect(brokeRow.querySelector('.vi-price-chip')).toBeNull();
    expect(brokeRow.querySelector('.vi-price')?.classList.contains('unaffordable')).toBe(true);

    const el2 = document.createElement('div');
    renderUnbindWindow(el2, 'Darva', { rows: [] }, deps);
    expect(el2.querySelector('.vendor-empty')?.textContent).toContain(
      'You carry no bound commission pieces.',
    );
    (el2.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(deps.onClose).toHaveBeenCalled();
  });
});
