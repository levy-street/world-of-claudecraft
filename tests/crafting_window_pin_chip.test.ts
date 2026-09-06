// @vitest-environment happy-dom
// The crafting window's per-recipe "Pin" chip (src/ui/crafting_window.ts): its
// pressed state and labels follow deps.recipePinned, a click routes through
// deps.onToggleRecipePin and mirrors the result locally, and a refused add at
// the cap announces the pinFull line instead of silently doing nothing.
import { describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { buildCraftingView } from '../src/ui/crafting_view';
import { renderCraftingWindow } from '../src/ui/crafting_window';
import { t } from '../src/ui/i18n';
import { RECIPE_TRACK_CAP, type RecipePinToggleResult } from '../src/ui/recipe_tracker_view';

const POTION = 'recipe_minor_healing_potion';

function deps(pinned: Set<string>, toggle: (id: string) => RecipePinToggleResult) {
  return {
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    onOpenOrders: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    commissionChecked: vi.fn(() => false),
    onToggleCommission: vi.fn(),
    recipePinned: (id: string) => pinned.has(id),
    onToggleRecipePin: vi.fn(toggle),
    craftQty: () => 1,
    onCraftQty: vi.fn(),
    announce: vi.fn(),
    selectedCraft: () => null as string | null,
    onSelectCraft: vi.fn(),
  };
}

function render(d: ReturnType<typeof deps>) {
  const el = document.createElement('div');
  const recipes = ALL_RECIPES.filter((r) => r.id === POTION);
  renderCraftingWindow(el, buildCraftingView(recipes, [], ITEMS), d);
  return el.querySelector('.crafting-pin-chip') as HTMLButtonElement;
}

describe('crafting window pin chip', () => {
  it('renders unpressed with the Pin label and the recipe-named aria-label', () => {
    const chip = render(deps(new Set(), () => ({ pinned: new Set(), full: false, changed: true })));
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.textContent).toBe(t('hudChrome.recipeTracker.pin'));
    expect(chip.getAttribute('aria-label')).toBe(
      t('hudChrome.recipeTracker.pinAria', { name: 'Minor Healing Potion' }),
    );
    expect(chip.dataset.focusKey).toBe(`pin:${POTION}`);
  });

  it('renders pressed with the Unpin label when the store already holds the recipe', () => {
    const chip = render(
      deps(new Set([POTION]), () => ({ pinned: new Set(), full: false, changed: true })),
    );
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.textContent).toBe(t('hudChrome.recipeTracker.unpin'));
    expect(chip.getAttribute('aria-label')).toBe(
      t('hudChrome.recipeTracker.unpinAria', { name: 'Minor Healing Potion' }),
    );
  });

  it('mirrors a successful toggle locally without a repaint', () => {
    let pinned = new Set<string>();
    const d = deps(pinned, (id) => {
      pinned = pinned.has(id) ? new Set() : new Set([id]);
      return { pinned, full: false, changed: true };
    });
    const chip = render(d);
    chip.click();
    expect(d.onToggleRecipePin).toHaveBeenCalledWith(POTION);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.textContent).toBe(t('hudChrome.recipeTracker.unpin'));
    chip.click();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(d.announce).not.toHaveBeenCalled();
  });

  it('announces the cap refusal and leaves the chip unpressed', () => {
    const d = deps(new Set(), () => ({ pinned: new Set(), full: true, changed: false }));
    const chip = render(d);
    chip.click();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(d.announce).toHaveBeenCalledWith(
      t('hudChrome.recipeTracker.pinFull', { cap: String(RECIPE_TRACK_CAP) }),
    );
  });
});
