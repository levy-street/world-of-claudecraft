// @vitest-environment happy-dom
//
// DOM behavioral guard for the Loot Explorer's Encounter dropdown: it shows
// only for the raid, dungeon, and world boss categories, swaps its list (and
// drops the old pick) on a category change, keeps keyboard focus on the
// category select across that rebuild, and a boss pick narrows the
// "By Encounter" tab to that boss with its Normal card right before its
// Heroic one. Drives the real LootExplorerWindow over happy-dom with stub deps.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LootExplorerWindow,
  type LootExplorerWindowDeps,
} from '../src/ui/hud/loot_explorer/loot_explorer_window';

function makeWindow(): HTMLElement {
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
  };
  new LootExplorerWindow(deps).open();
  return el;
}

const select = (el: HTMLElement, key: string) =>
  el.querySelector<HTMLSelectElement>(`select[data-filter="${key}"]`);

function choose(el: HTMLElement, key: string, value: string): void {
  const s = select(el, key);
  if (!s) throw new Error(`no ${key} select`);
  s.value = value;
  s.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('LootExplorerWindow: Encounter dropdown', () => {
  it('appears only for raid, dungeon, and world boss', () => {
    const el = makeWindow();
    expect(select(el, 'encounter')).toBeNull();
    for (const category of ['raid', 'dungeon', 'world_boss']) {
      choose(el, 'category', category);
      expect(select(el, 'encounter'), category).not.toBeNull();
    }
    for (const category of ['vendor', 'open_world', 'all']) {
      choose(el, 'category', category);
      expect(select(el, 'encounter'), category).toBeNull();
    }
  });

  it('groups raid bosses under their instance and keeps focus on the category select', () => {
    const el = makeWindow();
    select(el, 'category')?.focus();
    choose(el, 'category', 'raid');
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe(
      'filter:category',
    );
    const enc = select(el, 'encounter');
    const groups = enc?.querySelectorAll('optgroup') ?? [];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const values = [...g.querySelectorAll('option')].map((o) => o.value);
      expect(values[0]).toMatch(/^instance:/);
      expect(values.slice(1).every((v) => v.startsWith('mob:'))).toBe(true);
    }
  });

  it('a boss pick shows only that boss, Normal then Heroic, and a category change resets it', () => {
    const el = makeWindow();
    el.querySelector<HTMLElement>('[data-tab="encounters"]')?.click();
    choose(el, 'category', 'dungeon');
    const allCards = el.querySelectorAll('.loot-explorer-encounter').length;
    const bossOption = [...(select(el, 'encounter')?.options ?? [])].find((o) =>
      o.value.startsWith('mob:'),
    );
    if (!bossOption) throw new Error('no boss option');
    choose(el, 'encounter', bossOption.value);
    const titles = [...el.querySelectorAll('.loot-explorer-encounter-title')].map(
      (t) => t.textContent ?? '',
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.length).toBeLessThan(allCards);
    for (const title of titles) expect(title).toContain(bossOption.textContent ?? '');
    const normal = titles.findIndex((t) => t.includes('Normal'));
    const heroic = titles.findIndex((t) => t.includes('Heroic'));
    if (normal >= 0 && heroic >= 0) expect(heroic).toBe(normal + 1);

    choose(el, 'category', 'raid');
    expect(select(el, 'encounter')?.value).toBe('all');
  });
});
