// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import {
  DEFAULT_WEEKLY_LOOT_SELECTION,
  type WeeklyLootSelection,
  weeklyLootCatalogView,
} from '../src/ui/weekly_loot_catalog_view';
import { renderWeeklyLootCatalog } from '../src/ui/weekly_reward_loot_catalog_controller';

function rig(lootSpec?: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const expanded = new Set<string>();
  let selection: WeeklyLootSelection = DEFAULT_WEEKLY_LOOT_SELECTION;
  const attachTooltip = vi.fn();
  const presentation = {
    itemIcon: () => '<img alt="" src="/test.webp">',
    attachTooltip,
    itemTooltip: () => '',
  } as unknown as PainterHostPresentation;
  const render = (spec = lootSpec) => {
    host.replaceChildren();
    renderWeeklyLootCatalog(host, {
      playerClass: 'paladin',
      lootSpec: spec,
      presentation,
      expanded,
      selection: () => selection,
      select: (next) => {
        selection = next;
      },
    });
  };
  render();
  const choice = (key: string) =>
    host.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`)!;
  const pressed = (group: string) =>
    [...host.querySelectorAll(`.${group} button[aria-pressed="true"]`)].map((b) => b.textContent);
  return { host, render, choice, pressed, attachTooltip, selection: () => selection };
}

describe('possible loot catalog painter', () => {
  it('opens on Raids, Normal, with every raid table listed and collapsed', () => {
    const r = rig();
    expect(
      [...r.host.querySelectorAll('.weekly-loot-content button')].map((b) => b.textContent),
    ).toEqual(['Raids', 'Dungeons', 'World Quests', 'PvP']);
    expect(r.pressed('weekly-loot-content')).toEqual(['Raids']);
    expect(r.pressed('weekly-loot-difficulty')).toEqual(['Normal']);
    expect(r.host.querySelector('.weekly-loot-content')?.getAttribute('role')).toBe('group');
    const view = weeklyLootCatalogView(DEFAULT_WEEKLY_LOOT_SELECTION, 'paladin');
    expect(r.host.querySelectorAll('#weekly-pool-raid details')).toHaveLength(view.tables.length);
    expect([...r.host.querySelectorAll('details')].every((el) => !el.open)).toBe(true);
    expect(r.host.querySelector('.weekly-pool h4')?.textContent).toBe('Normal raid loot');
  });

  it('shows one pool at a time: content first, then difficulty', () => {
    const r = rig();
    r.choice('weekly-loot-content:dungeon').click();
    expect(r.pressed('weekly-loot-content')).toEqual(['Dungeons']);
    expect(r.host.querySelectorAll('.weekly-pool')).toHaveLength(1);
    expect(r.host.querySelector('#weekly-pool-dungeon')).not.toBeNull();
    const names = [...r.host.querySelectorAll('summary > span:first-of-type')].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(expect.arrayContaining(['The Hollow Crypt', 'The Wildheart Basin']));
    r.choice('weekly-loot-difficulty:heroic').click();
    expect(r.selection()).toEqual({ content: 'dungeon', difficulty: 'heroic' });
    expect(r.host.querySelector('#weekly-pool-dungeon_heroic')).not.toBeNull();
    // Focus stays on the button that was pressed, across the repaint.
    expect(document.activeElement).toBe(r.choice('weekly-loot-difficulty:heroic'));
  });

  it('drops the difficulty row for World Quests and PvP and gives PvP its own rule', () => {
    const r = rig();
    r.choice('weekly-loot-content:pvp').click();
    expect(r.host.querySelector('.weekly-loot-difficulty')).toBeNull();
    const rule = r.host.querySelector('.weekly-pool-rule')!.textContent!;
    expect(rule).toContain('WARFARE equipment');
    expect(rule).not.toContain('raids and dungeons');
    r.choice('weekly-loot-content:world').click();
    const worldRule = r.host.querySelector('.weekly-pool-rule')!.textContent!;
    expect(worldRule).toContain('Normal Nythraxis equipment');
    expect(worldRule).toContain('more than 3 levels above your level');
    expect(r.host.querySelectorAll('#weekly-pool-world details')).toHaveLength(1);
  });

  it('keeps the selection and open tables across a repaint and lists items with tooltips', () => {
    const r = rig();
    r.choice('weekly-loot-content:world').click();
    const table = r.host.querySelector<HTMLDetailsElement>('#weekly-pool-world details')!;
    table.open = true;
    table.dispatchEvent(new Event('toggle'));
    r.render();
    const again = r.host.querySelector<HTMLDetailsElement>('#weekly-pool-world details')!;
    expect(again.open).toBe(true);
    expect(again.querySelectorAll('.weekly-loot').length).toBeGreaterThan(0);
    expect(again.querySelector('.weekly-loot img')!.getAttribute('src')).toBe('/test.webp');
    expect(r.attachTooltip).toHaveBeenCalled();
  });

  it('filters the listed items by the loot focus', () => {
    const all = rig();
    const count = (r: ReturnType<typeof rig>) => r.host.querySelectorAll('.weekly-loot').length;
    const focused = rig('holy');
    expect(count(focused)).toBeLessThan(count(all));
    expect(count(focused)).toBeGreaterThan(0);
  });
});
