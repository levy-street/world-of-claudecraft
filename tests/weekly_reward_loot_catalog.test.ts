// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import { emptyWeeklyRewards } from '../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import { appendWeeklyLootCategory } from '../src/ui/weekly_reward_loot_catalog_controller';
import { buildWeeklyRewardsView } from '../src/ui/weekly_rewards_view';

describe('possible loot catalog', () => {
  it('nests collapsed tables under each content category and preserves expansion on repaint', () => {
    const state = emptyWeeklyRewards(604800000);
    state.bossUnlocks = { sexton_marrow: 1, morthen: 2, nythraxis_scourge_of_thornpeak: 1 };
    const info = {
      state,
      playerLevel: 20,
      nowMs: 1000,
      canClaim: true,
      worldQuestsAvailable: true,
      readyWeeks: 0,
    };
    const host = document.createElement('div');
    const expanded = new Set<string>();
    const attachTooltip = vi.fn();
    const presentation = {
      itemIcon: () => '<img alt="" src="/test.webp">',
      attachTooltip,
    } as unknown as PainterHostPresentation;
    const render = () => {
      host.replaceChildren();
      for (const row of buildWeeklyRewardsView(info, 'mage'))
        appendWeeklyLootCategory(host, row, presentation, expanded);
    };
    render();
    expect([...host.querySelectorAll('h3')].map((el) => el.textContent)).toEqual([
      'Raids',
      'Dungeons',
      'World Quests',
      'PvP',
    ]);
    expect([...host.querySelectorAll('details')].every((el) => !el.open)).toBe(true);
    const normal = host.querySelector<HTMLDetailsElement>('#weekly-pool-dungeon details')!;
    expect(normal.querySelector('summary')!.textContent).toContain('Hollow Crypt');
    expect(normal.querySelector('summary')!.tabIndex).toBe(0);
    const union = new Set(
      ['sexton_marrow', 'morthen'].flatMap((id) => weeklyBossLootPool(id, 'dungeon', 'mage')),
    );
    expect(normal.querySelectorAll('.weekly-loot')).toHaveLength(union.size);
    expect(normal.querySelector('.weekly-loot img')!.getAttribute('src')).toBe('/test.webp');
    expect(attachTooltip).toHaveBeenCalled();
    normal.open = true;
    normal.dispatchEvent(new Event('toggle'));
    render();
    expect(host.querySelector<HTMLDetailsElement>('#weekly-pool-dungeon details')!.open).toBe(true);
    expect(host.querySelectorAll('#weekly-pool-dungeon_heroic details')).toHaveLength(1);
    expect(host.querySelectorAll('#weekly-pool-raid_heroic details')).toHaveLength(0);
    info.playerLevel = 1;
    render();
    expect(host.querySelectorAll('#weekly-pool-world .weekly-loot')).toHaveLength(0);
  });
});
