// @vitest-environment happy-dom
//
// The longest crafting bill, rendered whole, on every surface that draws one.
//
// The claim this file pins was previously carried only by a source scan
// ("nothing in src/ or server/ slices a reagent list") and then by a reading of
// four call sites. A source scan cannot see a cap introduced through a helper,
// a CSS line-clamp, or a painter that stops early, and a reading rots the day
// the code moves; the shipped content already contains a bill long enough to
// expose any of those, so the honest pin is BEHAVIORAL: build the real view,
// paint the real window, render the real wiki cell, and count.
//
// The bill is DERIVED, never named: the longest row in the merged table today is
// eight reagents and FOUR rows hold it (an older comment in recipes.ts still
// says seven and one row, which is exactly the rot a hand-named id would
// inherit). Every max-length row is swept, so a ninth-reagent row authored later
// joins on the day it ships.
//
// The window surfaces live under happy-dom because renderCraftingWindow is a DOM
// painter; the view core and the wiki cell are host-agnostic and run there too.
import { describe, expect, it, vi } from 'vitest';
import { GUIDE_PROF_CRAFTS } from '../src/guide/content.generated';
import { craftDetailHtml } from '../src/guide/pages/professions_craft';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { InvSlot } from '../src/sim/types';
import { buildCraftingView } from '../src/ui/hud/professions/crafting_view';
import {
  type CraftingWindowDeps,
  renderCraftingWindow,
} from '../src/ui/hud/professions/crafting_window';
import { setLanguage } from '../src/ui/i18n';

const LONGEST_BILL = Math.max(...ALL_RECIPES.map((r) => r.reagents.length));
const LONGEST: readonly ProfessionRecipeRecord[] = ALL_RECIPES.filter(
  (r) => r.reagents.length === LONGEST_BILL,
);

function windowDeps(): CraftingWindowDeps {
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
  };
}

function paint(recipe: ProfessionRecipeRecord): { el: HTMLElement; deps: CraftingWindowDeps } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const deps = windowDeps();
  renderCraftingWindow(el, buildCraftingView([recipe], [] as InvSlot[], ITEMS), deps);
  return { el, deps };
}

/** The tooltip HTML the window attaches to a recipe's craft button. */
function recipeTooltip(deps: CraftingWindowDeps): string {
  const attach = deps.attachTooltip as ReturnType<typeof vi.fn>;
  const call = attach.mock.calls.find((args) =>
    (args[0] as HTMLElement).classList.contains('crafting-recipe-btn'),
  );
  if (!call) throw new Error('the window attached no tooltip to a .crafting-recipe-btn');
  return (call[1] as () => string)();
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('the longest reagent bill renders whole on every surface that draws one', () => {
  it('the premise: the live catalog really holds a bill long enough to expose a cap', () => {
    // Non-vacuity for everything below. A four-reagent maximum would make the
    // sweeps pass over rows no plausible cap would ever truncate.
    expect(LONGEST_BILL, 'the longest bill in the merged table').toBeGreaterThanOrEqual(8);
    expect(LONGEST.length, 'rows holding the longest bill').toBeGreaterThanOrEqual(1);
    for (const recipe of LONGEST) {
      // Every reagent resolves, so a missing def cannot be what a surface drops.
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId], `${recipe.id} reagent ${reagent.itemId}`).toBeDefined();
      }
      // And the bill is really distinct ids, not one id repeated: a de-duplicating
      // surface has to be caught by count, which needs the ids to differ.
      expect(
        new Set(recipe.reagents.map((g) => g.itemId)).size,
        `${recipe.id} distinct reagent ids`,
      ).toBe(LONGEST_BILL);
    }
  });

  it.each(LONGEST.map((r) => r.id))(
    '%s: the crafting view core carries every reagent, in authored order',
    (id) => {
      const recipe = LONGEST.find((r) => r.id === id) as ProfessionRecipeRecord;
      const view = buildCraftingView([recipe], [] as InvSlot[], ITEMS);
      expect(view.recipes, 'the row is in the view').toHaveLength(1);
      const rows = view.recipes[0].reagents;
      expect(rows).toHaveLength(LONGEST_BILL);
      // Order too, not just count: a surface that reordered would still be a
      // regression against the authored bill the window and wiki both print.
      expect(rows.map((r) => r.itemId)).toEqual(recipe.reagents.map((g) => g.itemId));
      // Every row resolved its def, so nothing renders as a bare id.
      for (const row of rows) expect(row.item, `${row.itemId} def`).toBeDefined();
    },
  );

  it.each(LONGEST.map((r) => r.id))(
    '%s: the crafting window paints every reagent in the line, the tooltip and the label',
    (id) => {
      const recipe = LONGEST.find((r) => r.id === id) as ProfessionRecipeRecord;
      const { el, deps } = paint(recipe);
      // The visible inline list.
      const spans = el.querySelectorAll('.crafting-reagent-line .crafting-reagent');
      expect(spans.length, 'inline reagent spans').toBe(LONGEST_BILL);
      // The hover tooltip and the accessible name, which are built from the same
      // array but joined separately: all three are asserted so a cap introduced
      // at any ONE of the three render sites is caught.
      const tooltip = recipeTooltip(deps);
      const label = (el.querySelector('.crafting-recipe-btn') as HTMLElement).getAttribute(
        'aria-label',
      ) as string;
      for (const reagent of recipe.reagents) {
        const name = ITEMS[reagent.itemId].name;
        expect(tooltip, `${id} tooltip names ${reagent.itemId}`).toContain(name);
        expect(label, `${id} aria-label names ${reagent.itemId}`).toContain(name);
      }
      // Counting, not just containment: a surface that printed the first N and
      // an ellipsis would still contain the early names.
      expect(
        occurrences(tooltip, '/'),
        'one have/required pair per reagent in the tooltip',
      ).toBeGreaterThanOrEqual(LONGEST_BILL);
      el.remove();
    },
  );

  it('the wiki materials cell prints every reagent of every recipe on the page', () => {
    setLanguage('en');
    // Driven over the WHOLE craft page rather than one row: the cell builder is
    // module-private, so the honest unit is the rendered page, and a page-wide
    // count catches a cap wherever in the table it was introduced.
    const cookingRecipeIds = new Set(
      ALL_RECIPES.filter((r) => r.professionId === 'cooking').map((r) => r.id),
    );
    const cooking = GUIDE_PROF_CRAFTS.find((c) => c.id === 'cooking');
    expect(cooking, 'the cooking craft page').toBeDefined();
    const page = craftDetailHtml(cooking as (typeof GUIDE_PROF_CRAFTS)[number]);
    const expected = (cooking?.recipes ?? []).reduce((sum, r) => sum + r.materials.length, 0);
    expect(occurrences(page, 'class="guide-prof-mat"'), 'material spans on the page').toBe(
      expected,
    );
    // And the longest bills are really on this page, so the count above is not a
    // total over short rows: each max-length row's every material is named.
    const onPage = LONGEST.filter((r) => cookingRecipeIds.has(r.id));
    expect(onPage.length, 'longest-bill rows on the cooking page').toBeGreaterThanOrEqual(1);
    for (const recipe of onPage) {
      const generated = cooking?.recipes.find((r) => r.id === recipe.id);
      expect(generated, `${recipe.id} on the generated page`).toBeDefined();
      expect(generated?.materials, `${recipe.id} materials`).toHaveLength(LONGEST_BILL);
      for (const material of generated?.materials ?? []) {
        expect(page, `${recipe.id} cell names ${material.name}`).toContain(
          `${material.name} x${material.count}`,
        );
      }
    }
  });
});
