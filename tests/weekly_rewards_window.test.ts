// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { emptyWeeklyRewards, weeklyLootPool } from '../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import { WeeklyRewardsTab } from '../src/ui/weekly_rewards_window';
import type { IWorld } from '../src/world_api';

describe('weekly reward pane', () => {
  it('shows earned world vaults and their Nythraxis pool without boss unlocks', () => {
    const state = emptyWeeklyRewards(604800000);
    state.world = 8;
    state.bossUnlocks = {};
    const root = document.createElement('div');
    const pane = new WeeklyRewardsTab({
      world: () =>
        ({
          cfg: { playerClass: 'mage' },
          weeklyRewardInfo: {
            state,
            nowMs: 1000,
            playerLevel: 20,
            canClaim: true,
            worldQuestsAvailable: true,
            readyWeeks: 0,
          },
        }) as IWorld,
      presentation: {
        itemIcon: () => '',
        attachTooltip: vi.fn(),
      } as unknown as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    pane.renderInto(root);
    expect(root.querySelectorAll('.weekly-track-world .weekly-earned')).toHaveLength(3);
    expect(root.querySelector('.weekly-track-world')?.textContent).toContain(
      '8 World Quests Completed',
    );
    const pool = root.querySelector('#weekly-pool-world')!;
    expect(pool.textContent).toContain('Normal Nythraxis equipment. No raid clears required.');
    expect(pool.textContent).not.toContain('Choose a defeated boss');
    expect(pool.querySelectorAll('.weekly-loot')).toHaveLength(
      weeklyLootPool('world', 'mage').length,
    );
    expect(
      pool.querySelector('[data-focus-key="weekly-item:world:world:wraithfire_orb"]'),
    ).not.toBeNull();
    pane.close();
  });

  it('repaints after brief null info even when the restored ledger is identical', () => {
    const state = emptyWeeklyRewards(2000);
    state.vaults = [
      { resetAtMs: 1000, choices: [{ pool: 'raid', itemId: 'orb_of_the_last_spring' }] },
    ];
    const info = { state, nowMs: 1000, readyWeeks: 1, canClaim: true, worldQuestsAvailable: false };
    const world = { cfg: { playerClass: 'mage' }, weeklyRewardInfo: info as typeof info | null };
    const pane = new WeeklyRewardsTab({
      world: () => world as IWorld,
      presentation: {
        itemIcon: () => '',
        attachTooltip: vi.fn(),
      } as unknown as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    const root = document.createElement('div');
    const repaint = vi.fn(() => {
      root.replaceChildren();
      pane.renderInto(root);
    });
    pane.renderInto(root);
    pane.refreshIfChanged(repaint);
    expect(repaint).not.toHaveBeenCalled();
    world.weeklyRewardInfo = null;
    expect(pane.refreshIfChanged(repaint)).toBe(false);
    world.weeklyRewardInfo = info;
    pane.refreshIfChanged(repaint);
    expect(repaint).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('.weekly-start-claim')!.click();
    expect(root.querySelector('.vault-reveal-trigger')).not.toBeNull();
    pane.close();
  });
  it('renders a real unavailable panel during gate loss and server mirror delay', () => {
    const root = document.createElement('div');
    const pane = new WeeklyRewardsTab({
      world: () => ({ weeklyRewardInfo: null }) as IWorld,
      presentation: {} as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    pane.renderInto(root);
    expect(root.querySelector('[role="region"]')?.textContent).toContain(
      'Stand near the Vault Keeper',
    );
    expect(root.querySelector('#weekly-rewards-panel')?.getAttribute('aria-label')).toBe(
      'The Weekly Vault',
    );
  });
  it('uses icon markup and keeps the countdown node intact between ticks', () => {
    const info = {
      state: emptyWeeklyRewards(604800000),
      nowMs: 1000,
      playerLevel: 20,
      canClaim: true,
      worldQuestsAvailable: false,
      readyWeeks: 0,
    };
    info.state.raidUnlocks = [2, 2, 2];
    const root = document.createElement('div');
    const pane = new WeeklyRewardsTab({
      world: () => ({ weeklyRewardInfo: info, cfg: { playerClass: 'mage' } }) as IWorld,
      presentation: {
        itemIcon: () => '<img alt="" src="/test.webp">',
        attachTooltip: vi.fn(),
      } as unknown as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    pane.renderInto(root);
    expect(root.querySelector('.weekly-loot img')?.getAttribute('src')).toBe('/test.webp');
    const timer = root.querySelector('[role="timer"]')!;
    const previous = timer.textContent;
    info.nowMs += 1000;
    pane.refreshCountdown();
    expect(root.querySelector('[role="timer"]')).toBe(timer);
    expect(timer.textContent).not.toBe(previous);
    expect(root.querySelectorAll('.weekly-track')).toHaveLength(4);
    for (const track of root.querySelectorAll('.weekly-track')) {
      expect(track.querySelectorAll('.weekly-milestone')).toHaveLength(3);
      expect(track.getAttribute('aria-labelledby')).toBe(track.querySelector('h3')?.id);
    }
    expect(root.querySelectorAll('.weekly-track-world .weekly-earned')).toHaveLength(0);
    expect(
      root.querySelectorAll('.weekly-track-world .weekly-milestone-label')[0]?.textContent,
    ).toBe('Not yet available');
    const poolButton = root.querySelector<HTMLButtonElement>('.weekly-possible-loot-button')!;
    expect(root.querySelectorAll('.weekly-possible-loot-button')).toHaveLength(1);
    expect(poolButton.textContent).toBe('View possible loot');
    expect(root.querySelector('.weekly-track .weekly-pool')).toBeNull();
    expect(root.querySelectorAll('.weekly-possible-loot .weekly-pool')).toHaveLength(6);
    const poolId = poolButton.getAttribute('aria-controls');
    expect(poolButton.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector<HTMLElement>(`#${poolId}`)?.hidden).toBe(true);
    poolButton.click();
    expect(poolButton.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>(`#${poolId}`)?.hidden).toBe(false);
    root.replaceChildren();
    pane.renderInto(root);
    const restored = root.querySelector<HTMLButtonElement>(`[aria-controls="${poolId}"]`)!;
    expect(restored.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>(`#${poolId}`)?.hidden).toBe(false);
    restored.click();
    expect(restored.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector<HTMLElement>(`#${poolId}`)?.hidden).toBe(true);
  });
  it('marks only reached and available milestones as earned without enabling a claim', () => {
    const state = emptyWeeklyRewards(604800000);
    state.pvp = 10;
    state.world = 100;
    state.raids = [2, 1, 2];
    const root = document.createElement('div');
    const pane = new WeeklyRewardsTab({
      world: () =>
        ({
          cfg: { playerClass: 'mage' },
          weeklyRewardInfo: {
            state,
            nowMs: 0,
            playerLevel: 20,
            canClaim: true,
            worldQuestsAvailable: false,
            readyWeeks: 0,
          },
        }) as IWorld,
      presentation: {
        itemIcon: () => '',
        attachTooltip: vi.fn(),
      } as unknown as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    pane.renderInto(root);
    expect(root.querySelectorAll('.weekly-track-pvp .weekly-earned').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.weekly-track-world .weekly-earned')).toHaveLength(0);
    expect(root.querySelector('.weekly-confirm')).toBeNull();
    expect(root.querySelector('.weekly-choice')).toBeNull();
    const raidSlots = root.querySelectorAll('.weekly-track-raid .weekly-milestone');
    expect(raidSlots[0]?.textContent).toContain('1 Raid Encounter Cleared');
    expect(raidSlots[0]?.querySelector('img')?.getAttribute('src')).toBe(
      '/ui/weekly-vault/heroic.webp',
    );
    expect(raidSlots[2]?.textContent).toContain('2 Heroic / 1 Normal');
    expect(raidSlots[2]?.querySelector('img')?.getAttribute('src')).toBe(
      '/ui/weekly-vault/normal.webp',
    );
    for (const slot of raidSlots) {
      expect(slot.querySelector('.weekly-roll-label')).toBeNull();
      expect(slot.querySelector('.weekly-milestone-heading .weekly-clear-mix')).toBeNull();
    }
    expect(
      raidSlots[0]?.querySelector('.weekly-milestone-footer .weekly-clear-mix')?.textContent,
    ).toBe('1 Heroic');
    expect(
      raidSlots[2]?.querySelector('.weekly-milestone-footer .weekly-clear-mix')?.textContent,
    ).toBe('2 Heroic / 1 Normal');
    expect(root.querySelector('.weekly-track-dungeon .weekly-vault-art')?.getAttribute('src')).toBe(
      '/ui/weekly-vault/closed.webp',
    );
    expect(root.querySelector('.weekly-track-world .weekly-roll-label')).toBeNull();
    state.dungeons = [2, 2, 1, 1];
    root.replaceChildren();
    pane.renderInto(root);
    const dungeonSlots = root.querySelectorAll('.weekly-track-dungeon .weekly-milestone');
    expect(dungeonSlots[0]?.querySelector('.weekly-heroic-upgrade')).toBeNull();
    expect(dungeonSlots[2]?.querySelector('.weekly-heroic-upgrade')).toBeNull();
    expect(dungeonSlots[1]?.querySelector('.weekly-heroic-upgrade')?.textContent).toBe(
      '2 more Heroic dungeon clears to upgrade',
    );
    const label = dungeonSlots[1]?.querySelector('.weekly-milestone-label');
    expect(label?.textContent).toBe('4 Dungeons Cleared');
    expect(label?.nextElementSibling?.textContent).toBe('Normal');
    state.dungeons = [2, 2, 2, 1];
    root.replaceChildren();
    pane.renderInto(root);
    expect(root.querySelector('.weekly-heroic-upgrade')?.textContent).toBe(
      '1 more Heroic dungeon clear to upgrade',
    );
    state.dungeons = [2, 2, 2, 2];
    root.replaceChildren();
    pane.renderInto(root);
    expect(root.querySelector('.weekly-heroic-upgrade')).toBeNull();
  });
});
