// @vitest-environment happy-dom
//
// DOM behavioral guard: keyboard focus and search/filter/tab state across
// LootExplorerWindow rebuilds (the professions_window_focus.test.ts family).
// relocalize() (Hud's language-change fan-out, wired at src/ui/hud.ts) forces
// a full render() and carries the focused control across by data-focus-key;
// this pins the review defect where the four filter <select>s and the
// tab-strip buttons carried no key, so a player focused on one of them at a
// language switch fell through to <body> instead of landing back on the
// role-equivalent fresh control. Drives the real LootExplorerWindow over
// happy-dom with stub deps.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LootExplorerWindow,
  type LootExplorerWindowDeps,
} from '../src/ui/hud/loot_explorer/loot_explorer_window';

function makeWindow(depsOver: Partial<LootExplorerWindowDeps> = {}): {
  w: LootExplorerWindow;
  el: HTMLElement;
} {
  const el = document.createElement('div');
  el.id = 'loot-explorer-window';
  document.body.appendChild(el);
  const deps: LootExplorerWindowDeps = {
    root: () => el,
    closeOthers: () => {},
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    ...depsOver,
  };
  const w = new LootExplorerWindow(deps);
  w.open();
  return { w, el };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('LootExplorerWindow: focus survives relocalize()', () => {
  it('focuses the search input on open, matching the existing open contract', () => {
    const { el } = makeWindow();
    expect(document.activeElement).toBe(el.querySelector('input[data-search]'));
  });

  it('carries focus across relocalize() to the SAME filter select by its key', () => {
    const { w, el } = makeWindow();
    const select = el.querySelector<HTMLSelectElement>('[data-focus-key="filter:category"]');
    if (!select) throw new Error('category filter select rendered with a focus key');
    select.focus();
    expect(document.activeElement).toBe(select);

    w.relocalize();

    const fresh = document.activeElement as HTMLSelectElement | null;
    expect(fresh).not.toBe(select); // really rebuilt, not the same node
    expect(fresh?.dataset.focusKey).toBe('filter:category');
    expect(fresh?.dataset.filter).toBe('category');
  });

  it('carries focus across relocalize() for EACH of the four filter selects', () => {
    for (const key of ['category', 'requiredClass', 'statKey', 'quality']) {
      document.body.innerHTML = '';
      const { w, el } = makeWindow();
      const select = el.querySelector<HTMLElement>(`[data-focus-key="filter:${key}"]`);
      if (!select) throw new Error(`filter select for ${key} rendered with a focus key`);
      select.focus();
      w.relocalize();
      expect(document.activeElement).not.toBe(select);
      expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe(
        `filter:${key}`,
      );
    }
  });

  it('carries focus across relocalize() to the SAME tab-strip button by its key', () => {
    const { w, el } = makeWindow();
    const itemsTab = el.querySelector<HTMLElement>('[data-tab="items"]');
    if (!itemsTab) throw new Error('items tab rendered');
    itemsTab.focus();
    // A keyboard-driven tab move (roving ArrowRight, focusFollow=true) is the
    // real path that lands document focus on a freshly rendered tab button.
    itemsTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    const encountersTab = document.activeElement as HTMLElement | null;
    expect(encountersTab?.dataset.tab).toBe('encounters');
    expect(encountersTab?.dataset.focusKey).toBe('tab:encounters');

    w.relocalize();

    const fresh = document.activeElement as HTMLElement | null;
    expect(fresh).not.toBe(encountersTab); // really rebuilt, not the same node
    expect(fresh?.dataset.focusKey).toBe('tab:encounters');
    expect(fresh?.dataset.tab).toBe('encounters');
    expect(fresh?.classList.contains('on')).toBe(true);
  });

  it('leaves focus on the dialog root itself when pointer focus was parked there', () => {
    // A dialog-root park (mouse-click focus drop, src/ui/pointer_blur.ts)
    // parks focus on the window root itself, which carries no data-focus-key
    // and is refused by focusedWithin (the #2377 family): captureFocusKey
    // resolves null, so relocalize() skips restoreFirstEnabled entirely and
    // never yanks focus onto Search or Close. The root node itself survives
    // the innerHTML rebuild (only its children are replaced), so focus stays
    // put without any explicit restore.
    const { w, el } = makeWindow();
    el.focus();
    expect(document.activeElement).toBe(el);

    w.relocalize();

    expect(document.activeElement).toBe(el);
  });
});

describe('LootExplorerWindow: search/filter/tab state survives relocalize()', () => {
  it('preserves typed search text, every active filter, and the active tab', () => {
    const { w, el } = makeWindow();
    const search = el.querySelector<HTMLInputElement>('input[data-search]');
    if (!search) throw new Error('search input rendered');
    search.value = 'boots';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const category = el.querySelector<HTMLSelectElement>('select[data-filter="category"]');
    if (!category) throw new Error('category filter rendered');
    category.value = 'vendor';
    category.dispatchEvent(new Event('change', { bubbles: true }));

    const itemsTab = el.querySelector<HTMLElement>('[data-tab="items"]');
    itemsTab?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    w.relocalize();

    expect(el.querySelector<HTMLInputElement>('input[data-search]')?.value).toBe('boots');
    // happy-dom's <select> does not correctly compute `.value`/`.selected` for
    // an innerHTML-parsed `selected` option past the first (a known
    // environment gap, unrelated to this window's markup), so the rendered
    // MARKUP is asserted directly: the attribute the real DOM would honor.
    expect(
      el
        .querySelector('select[data-filter="category"] option[value="vendor"]')
        ?.hasAttribute('selected'),
    ).toBe(true);
    expect(el.querySelector('[data-tab="encounters"]')?.classList.contains('on')).toBe(true);
    expect(el.querySelector('[data-tab="items"]')?.classList.contains('on')).toBe(false);
  });
});
