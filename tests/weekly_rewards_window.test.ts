// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { emptyWeeklyRewards } from '../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import { WeeklyRewardsTab } from '../src/ui/weekly_rewards_window';
import type { IWorld } from '../src/world_api';

describe('weekly reward pane', () => {
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
  });
  it('requires selecting a fixed candidate then confirming one weekly choice, and restores focus', () => {
    const state = emptyWeeklyRewards(604800000);
    state.vaults = [
      { resetAtMs: 1, choices: [{ pool: 'raid', itemId: 'orb_of_the_last_spring' }] },
    ];
    const root = document.createElement('div');
    document.body.appendChild(root);
    const claim = vi.fn();
    const pane = new WeeklyRewardsTab({
      world: () =>
        ({
          cfg: { playerClass: 'mage' },
          weeklyRewardInfo: {
            state,
            nowMs: 0,
            canClaim: true,
            worldQuestsAvailable: false,
            readyWeeks: 1,
          },
          claimWeeklyReward: claim,
        }) as unknown as IWorld,
      presentation: {
        itemIcon: () => '',
        attachTooltip: vi.fn(),
      } as unknown as PainterHostPresentation,
      onInventoryChanged: vi.fn(),
    });
    pane.renderInto(root);
    const confirm = root.querySelector<HTMLButtonElement>('.weekly-confirm')!;
    expect(confirm.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('.weekly-choice')!.click();
    expect(claim).not.toHaveBeenCalled();
    expect(confirm.disabled).toBe(false);
    confirm.focus();
    confirm.click();
    expect(claim).toHaveBeenCalledWith('1:0');
    expect(document.activeElement).toBe(root.querySelector('[data-focus-key="weekly-status"]'));
    expect(confirm.disabled).toBe(true);
    root.remove();
  });
});
