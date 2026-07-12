// @vitest-environment jsdom
//
// Behavioral guards for the crafting window painter (the pure craftable/reagent
// decisions are unit-tested in crafting_view.test.ts). These render the real DOM
// through the shared window-frame builder and assert: the frame chrome is stamped
// on an INNER mount (the shared #crafting-window root stays pristine), the recipe
// rows adopt the AAA .list-rows / .vendor-row / .item-cell grammar grouped by
// profession, interpolated result names pass through esc(), an unaffordable
// recipe is disabled, the empty state renders, craft dispatch fires only for a
// craftable recipe, and the close routes to the injected onClose dep.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { CraftingRecipeRow, CraftingView } from '../src/ui/crafting_view';
import { type CraftingWindowDeps, renderCraftingWindow } from '../src/ui/crafting_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

// Force a controllable item name so the esc() path is testable without depending
// on the tEntity resolver internals.
vi.mock('../src/ui/entity_i18n', () => ({
  itemDisplayName: () => '<img src=x onerror=alert(1)>',
}));

function item(id: string, quality: ItemDef['quality'] = 'common'): ItemDef {
  return { id, name: id, quality, kind: 'material', slot: 'trinket' } as unknown as ItemDef;
}

function recipe(over: Partial<CraftingRecipeRow> = {}): CraftingRecipeRow {
  return {
    recipeId: 'r1',
    professionId: 'engineering',
    resultItemId: 'widget',
    result: item('widget', 'rare'),
    resultCount: 1,
    reagents: [{ itemId: 'bolt', item: item('bolt'), required: 2, have: 5, satisfied: true }],
    craftable: true,
    ...over,
  };
}

function fakeDeps(overrides: Partial<CraftingWindowDeps> = {}): CraftingWindowDeps {
  return {
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onCraft: () => {},
    onClose: () => {},
    ...overrides,
  };
}

function craftingEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'crafting-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.classList.remove('mobile-touch');
  document.body.innerHTML = '';
});

describe('renderCraftingWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, body, close, and NO footer', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps());
    expect(el.classList.contains('window-frame')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('crafting-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // No transactional footer: the craft action is per-row.
    expect(frame?.querySelector('.window-footer')).toBeNull();
  });

  it('titles the frame "Crafting" and keeps display:block (hud.ts reads it)', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps());
    expect(el.querySelector('.window-title')?.textContent).toBe('Crafting');
    expect(el.style.display).toBe('block');
  });

  it('keeps the shared root a pristine .window.panel (no builder class / role / aria)', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [recipe()] }, fakeDeps());
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [recipe()] }, fakeDeps());
    const firstBody = el.querySelector('.window-body');
    renderCraftingWindow(el, { recipes: [recipe()] }, fakeDeps());
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('renderCraftingWindow: move / resize / fit parity', () => {
  it('makes the frame titlebar a Hud drag handle, but never the close button', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD, and recognizes it again without it', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('renderCraftingWindow: body grammar', () => {
  it('groups recipes by profession into .vendor-section + .list-rows, in first-appearance order', () => {
    const el = craftingEl();
    const view: CraftingView = {
      recipes: [
        recipe({ recipeId: 'a', professionId: 'engineering' }),
        recipe({ recipeId: 'b', professionId: 'alchemy' }),
        recipe({ recipeId: 'c', professionId: 'engineering' }),
      ],
    };
    renderCraftingWindow(el, view, fakeDeps());
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    const sections = [...body.querySelectorAll('.vendor-section')].map((s) => s.textContent);
    // engineering (Tinkerer) appears first; alchemy (Alchemist) second; the
    // non-contiguous engineering recipe folds back into the first section.
    expect(sections).toEqual(['Tinkerer', 'Alchemist']);
    expect(body.querySelectorAll('.list-rows').length).toBe(2);
    // 2 engineering rows + 1 alchemy row.
    expect(body.querySelectorAll('.vendor-row').length).toBe(3);
  });

  it('renders a recipe row with a rarity item-cell, the reagent sub-line, and the Craft label', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [recipe({ resultCount: 3 })] }, fakeDeps());
    const row = el.querySelector<HTMLElement>('.vendor-row') as HTMLElement;
    expect(row.querySelector('.item-cell')?.getAttribute('data-quality')).toBe('rare');
    expect(row.querySelector('.vendor-row-name .craft-reagents')).not.toBeNull();
    expect(row.querySelector('.vendor-row-name')?.textContent).toContain('x3');
    expect(row.querySelector('.vendor-row-price')?.textContent).toBe('Craft');
  });

  it('escapes interpolated result names through esc() (no live injection)', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [recipe()] }, fakeDeps());
    const name = el.querySelector('.vendor-row-name');
    expect(name?.querySelector('img')).toBeNull();
    expect(name?.innerHTML).toContain('&lt;img');
  });

  it('disables an unaffordable recipe (the shared .vendor-row:disabled dim)', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [recipe({ craftable: false })] }, fakeDeps());
    const row = el.querySelector<HTMLButtonElement>('.vendor-row') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
  });

  it('renders the empty state when no recipes are known', () => {
    const el = craftingEl();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps());
    expect(el.querySelector('.window-body .empty-state')?.textContent).toBe(
      'No recipes known yet.',
    );
  });
});

describe('renderCraftingWindow: craft + close callbacks', () => {
  it('fires onCraft only for a craftable recipe', () => {
    const el = craftingEl();
    const onCraft = vi.fn();
    const view: CraftingView = {
      recipes: [
        recipe({ recipeId: 'ok', craftable: true }),
        recipe({ recipeId: 'no', craftable: false }),
      ],
    };
    renderCraftingWindow(el, view, fakeDeps({ onCraft }));
    const rows = el.querySelectorAll<HTMLButtonElement>('.vendor-row');
    rows[0].click();
    rows[1].click(); // disabled + guarded: no dispatch
    expect(onCraft).toHaveBeenCalledTimes(1);
    expect(onCraft).toHaveBeenCalledWith('ok');
  });

  it('routes the close control to the injected onClose dep', () => {
    const el = craftingEl();
    const onClose = vi.fn();
    renderCraftingWindow(el, { recipes: [] }, fakeDeps({ onClose }));
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// The crafting window's dialog chrome is a full framed window, so hud.ts must wire
// it into the shared FocusManager like every other one (the trap mechanics are
// unit-tested in focus_manager.test.ts): TRAP Tab inside on open, focus-first, and
// RETURN focus to the opener on close (WCAG 2.4.3 / 2.1.2). This guards the I3 fix.
describe('crafting window: hud installs the WCAG focus trap (I3)', () => {
  // cwd-relative (not import.meta.url): the jsdom env makes import.meta.url a
  // non-file URL, so new URL(..., import.meta.url) would not resolve to a path.
  const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('opens a focus trap + focus-first on open, releases + returns focus on close', () => {
    const open = hud.slice(hud.indexOf('openCrafting(): void {'));
    const openBody = open.slice(0, open.indexOf('\n  }'));
    // Installed on a FRESH open only (a re-open while shown must not stack a trap).
    expect(openBody).toContain('if (wasHidden)');
    expect(openBody).toContain("this.focusManager.open({ root: () => $('#crafting-window') })");
    expect(openBody).toContain('this.craftingTrap?.focusFirst();');
    const close = hud.slice(hud.indexOf('closeCrafting(): void {'));
    const closeBody = close.slice(0, close.indexOf('\n  }'));
    // release() (default returnFocus=true) returns focus to the opener, then clears.
    expect(closeBody).toContain('this.craftingTrap?.release();');
    expect(closeBody).toContain('this.craftingTrap = null;');
  });
});
