// @vitest-environment jsdom

// The crafting window's craft tab strip: the pure tab model (craftingTabs and
// resolveSelectedCraft in crafting_view.ts) plus the painter DOM contract in
// crafting_window.ts. The strip exists so a many-craft recipe book shows one
// craft at a time: tab order follows first appearance in the recipe list, a
// stale pick falls back to the first tab, only the selected craft's rows
// paint, tab clicks route through the HUD-held selection, the learn hint is
// scoped to the selected craft, and an empty book keeps the vendor-empty
// state with no strip at all.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { stationsOfType, stationTypeForCraft } from '../src/sim/professions/stations';
import {
  buildCraftingView,
  type CraftingRecipeRow,
  type CraftingView,
  craftingTabs,
  resolveSelectedCraft,
} from '../src/ui/crafting_view';
import { renderCraftingWindow } from '../src/ui/crafting_window';

// Two weaponcrafting recipes that STRADDLE an alchemy recipe in ALL_RECIPES
// order (recipes.ts is not contiguous per craft), so the grouping rule is
// exercised against a genuinely interleaved book.
const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const POTION_RECIPE = 'recipe_minor_healing_potion';
const GAUNTLET_RECIPE = 'recipe_forgeguard_bulwark_gauntlets';

function recipeRows(recipeIds: string[]) {
  return ALL_RECIPES.filter((r) => recipeIds.includes(r.id));
}

function interleavedView(): CraftingView {
  return buildCraftingView(recipeRows([SWORD_RECIPE, POTION_RECIPE, GAUNTLET_RECIPE]), [], ITEMS);
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

// Minimal full-shape row for the pure-core tests: craftingTabs and
// resolveSelectedCraft read only professionId, everything else is inert.
function rowFor(professionId: string, recipeId: string): CraftingRecipeRow {
  return {
    recipeId,
    professionId,
    resultItemId: 'qa_tabs_result',
    resultCount: 1,
    reagents: [],
    skillReq: 0,
    difficulty: 'full',
    station: null,
    commissionEligible: false,
    craftable: false,
  };
}

describe('craftingTabs (the pure tab model)', () => {
  it('orders tabs by first appearance and sums an interleaved craft into ONE tab', () => {
    const view: CraftingView = {
      recipes: [
        rowFor('craft_a', 'r1'),
        rowFor('craft_a', 'r2'),
        rowFor('craft_b', 'r3'),
        // craft_a returns AFTER craft_b: no second craft_a tab, the count sums.
        rowFor('craft_a', 'r4'),
      ],
    };
    expect(craftingTabs(view)).toEqual([
      { professionId: 'craft_a', recipeCount: 3 },
      { professionId: 'craft_b', recipeCount: 1 },
    ]);
  });

  it('an empty view yields no tabs', () => {
    expect(craftingTabs({ recipes: [] })).toEqual([]);
  });
});

describe('resolveSelectedCraft (the selection fallback)', () => {
  const tabs = [
    { professionId: 'craft_a', recipeCount: 2 },
    { professionId: 'craft_b', recipeCount: 1 },
  ];

  it('keeps the requested craft while it still owns a tab', () => {
    expect(resolveSelectedCraft(tabs, 'craft_b')).toBe('craft_b');
  });

  it('falls back to the first tab on a stale pick or no pick', () => {
    expect(resolveSelectedCraft(tabs, 'craft_gone')).toBe('craft_a');
    expect(resolveSelectedCraft(tabs, null)).toBe('craft_a');
  });

  it('resolves null for an empty book, whatever was requested', () => {
    expect(resolveSelectedCraft([], 'craft_a')).toBeNull();
    expect(resolveSelectedCraft([], null)).toBeNull();
  });
});

describe('renderCraftingWindow tab strip', () => {
  it('the interleaved fixture really interleaves (content-order precondition)', () => {
    expect(interleavedView().recipes.map((r) => r.professionId)).toEqual([
      'weaponcrafting',
      'alchemy',
      'weaponcrafting',
    ]);
  });

  it('paints one button per craft with pinned order, counts, selection state, and icon', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, interleavedView(), craftingDeps());
    const tabs = Array.from(el.querySelectorAll('.crafting-tab')) as HTMLButtonElement[];
    expect(tabs).toHaveLength(2);
    expect(tabs.every((tab) => tab.tagName === 'BUTTON')).toBe(true);
    expect(tabs.map((tab) => tab.dataset.craft)).toEqual(['weaponcrafting', 'alchemy']);

    // No pick yet: the FIRST tab is selected, and only it.
    expect(tabs[0].classList.contains('sel')).toBe(true);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    expect(tabs[1].classList.contains('sel')).toBe(false);
    expect(tabs[1].getAttribute('aria-pressed')).toBe('false');

    // Display name plus recipe-count badge (the interleaved craft sums to 2).
    expect(tabs[0].querySelector('.crafting-tab-label')?.textContent).toBe('Weaponcrafting');
    expect(tabs[1].querySelector('.crafting-tab-label')?.textContent).toBe('Alchemy');
    expect(tabs[0].querySelector('.crafting-tab-count')?.textContent).toBe('2');
    expect(tabs[1].querySelector('.crafting-tab-count')?.textContent).toBe('1');

    // The profession art icon is decorative: empty alt, not draggable.
    const icon = tabs[0].querySelector('img.crafting-tab-icon');
    expect(icon?.getAttribute('src')).toBe('/ui/professions/prof_weaponcrafting.webp');
    expect(icon?.getAttribute('alt')).toBe('');
    expect(icon?.getAttribute('draggable')).toBe('false');
    expect(tabs[1].querySelector('img.crafting-tab-icon')?.getAttribute('src')).toBe(
      '/ui/professions/prof_alchemy.webp',
    );
  });

  it('with no pick, ONLY the first craft rows render (the other craft is absent)', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, interleavedView(), craftingDeps());
    const names = Array.from(el.querySelectorAll('.crafting-recipe-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Eastbrook Arming Sword', 'Gravewyrm Gauntlets']);
    expect(el.textContent).not.toContain('Minor Healing Potion');
    expect(el.querySelector('.crafting-section-title')?.textContent).toBe('Weaponcrafting');
  });

  it('with the second craft picked, only its rows render and the header names it', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    deps.selectedCraft = () => 'alchemy';
    renderCraftingWindow(el, interleavedView(), deps);
    const names = Array.from(el.querySelectorAll('.crafting-recipe-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Minor Healing Potion']);
    expect(el.textContent).not.toContain('Eastbrook Arming Sword');
    expect(el.textContent).not.toContain('Gravewyrm Gauntlets');
    expect(el.querySelector('.crafting-section-title')?.textContent).toBe('Alchemy');

    // The selection markers follow the pick.
    const tabs = Array.from(el.querySelectorAll('.crafting-tab'));
    expect(tabs[0].classList.contains('sel')).toBe(false);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('false');
    expect(tabs[1].classList.contains('sel')).toBe(true);
    expect(tabs[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a non-selected tab reports its craft once; the selected tab is a no-op', () => {
    const el = document.createElement('div');
    const deps = craftingDeps();
    renderCraftingWindow(el, interleavedView(), deps);
    const tabs = Array.from(el.querySelectorAll('.crafting-tab')) as HTMLButtonElement[];

    tabs[1].click();
    expect(deps.onSelectCraft).toHaveBeenCalledTimes(1);
    expect(deps.onSelectCraft).toHaveBeenCalledWith('alchemy');

    // The already selected first tab must NOT re-report.
    tabs[0].click();
    expect(deps.onSelectCraft).toHaveBeenCalledTimes(1);
  });

  it('the learn hint renders ONLY when the selected craft is the hinted one', () => {
    const stationType = stationTypeForCraft('weaponcrafting');
    expect(stationType).toBeDefined();
    if (!stationType) return;
    const station = stationsOfType(stationType)[0];
    expect(station).toBeDefined();
    const hint = { stationType, masterNpcId: station.masterNpcId };
    const deps = craftingDeps();
    deps.selectedCraft = () => 'weaponcrafting';

    // Hint the NON-selected craft: no hint anywhere in the window.
    const el = document.createElement('div');
    renderCraftingWindow(el, interleavedView(), deps, undefined, new Map([['alchemy', hint]]));
    expect(el.querySelectorAll('.crafting-learn-hint')).toHaveLength(0);

    // Control: the SAME hint under the selected craft renders exactly once.
    const el2 = document.createElement('div');
    renderCraftingWindow(
      el2,
      interleavedView(),
      deps,
      undefined,
      new Map([['weaponcrafting', hint]]),
    );
    expect(el2.querySelectorAll('.crafting-learn-hint')).toHaveLength(1);
  });

  it('the HUD refocuses the surviving selected tab after a tab-switch repaint (source pin)', () => {
    // A tab click triggers a full innerHTML rebuild that destroys the button
    // the keyboard just activated; without a refocus, focus falls to body and
    // the next Tab press hits the game's target key instead of the window.
    // The wiring lives in Hud's onSelectCraft closure, so it is source-pinned
    // beside the render and scroll-reset steps it must follow.
    const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');
    const onSelect = hud.slice(hud.indexOf('onSelectCraft: (professionId) =>'));
    const closure = onSelect.slice(0, onSelect.indexOf('},'));
    expect(closure).toContain('this.renderCrafting();');
    expect(closure).toContain("querySelector('.crafting-tab.sel')");
    expect(closure).toContain('?.focus();');
  });

  it('an empty book paints no tab strip and keeps the vendor-empty state', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, buildCraftingView([], [], ITEMS), craftingDeps());
    expect(el.querySelector('.crafting-tabs')).toBeNull();
    expect(el.querySelectorAll('.crafting-tab')).toHaveLength(0);
    expect(el.querySelector('.crafting-section-title')).toBeNull();
    expect(el.querySelector('.vendor-empty')?.textContent).toBe('No recipes known yet.');
  });
});
