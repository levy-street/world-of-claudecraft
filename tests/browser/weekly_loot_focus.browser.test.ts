import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { PlayerClass } from '../../src/sim/types';
import { emptyWeeklyRewards } from '../../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../../src/ui/painter_host';
import { appendWeeklyLootCategory } from '../../src/ui/weekly_reward_loot_catalog_controller';
import { appendWeeklyLootFocus } from '../../src/ui/weekly_reward_loot_focus_controller';
import { buildWeeklyRewardsView } from '../../src/ui/weekly_rewards_view';
import { WeeklyRewardsTab } from '../../src/ui/weekly_rewards_window';
import type { IWorld } from '../../src/world_api';
import { axeSeriousViolations, cleanup, host } from './_harness';

const SPECS: Record<PlayerClass, string[]> = {
  warrior: ['arms', 'fury', 'prot'],
  paladin: ['holy', 'protection', 'retribution'],
  hunter: ['beast_mastery', 'marksmanship', 'survival'],
  rogue: ['assassination', 'combat', 'subtlety'],
  priest: ['discipline', 'holy', 'shadow'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  mage: ['arcane', 'fire', 'frost'],
  warlock: ['affliction', 'demonology', 'destruction'],
  druid: ['balance', 'feral', 'restoration'],
};
const panes: WeeklyRewardsTab[] = [];
function fixture(cls: PlayerClass = 'paladin') {
  const state = emptyWeeklyRewards(604800000);
  const setWeeklyLootSpec = vi.fn();
  const world = {
    cfg: { playerClass: cls },
    weeklyRewardInfo: {
      state,
      nowMs: 1000,
      playerLevel: 60,
      canClaim: false,
      readyWeeks: 0,
      worldQuestsAvailable: true,
    },
    setWeeklyLootSpec,
  } as unknown as IWorld;
  return { world, state, setWeeklyLootSpec };
}
function mount(world: IWorld) {
  const root = host('bank-window');
  root.style.display = 'flex';
  const pane = new WeeklyRewardsTab({
    world: () => world,
    presentation: {
      itemIcon: () => '',
      attachTooltip: () => {},
    } as unknown as PainterHostPresentation,
    onInventoryChanged: () => {},
  });
  panes.push(pane);
  pane.renderInto(root);
  return { root, pane };
}
afterEach(() => {
  for (const pane of panes.splice(0)) pane.close();
  vi.useRealTimers();
  cleanup();
  document.body.className = '';
  for (const name of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(name);
});

describe('Weekly Vault loot focus', () => {
  for (const [cls, specs] of Object.entries(SPECS) as [PlayerClass, string[]][]) {
    it(`offers all three ${cls} specs and sends each choice through IWorld`, () => {
      const { world, state, setWeeklyLootSpec } = fixture(cls);
      const root = host('weekly-focus-test');
      appendWeeklyLootFocus(root, world);
      const select = root.querySelector('select')!;
      expect([...select.options].map((option) => option.value)).toEqual(['', ...specs]);
      expect(select.value).toBe('');
      expect(select.labels?.[0]?.textContent).toBe('Loot focus');
      expect(select.getAttribute('data-focus-key')).toBe('weekly-loot-focus');
      select.focus();
      for (const spec of specs) {
        select.value = spec;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(setWeeklyLootSpec).toHaveBeenLastCalledWith(spec);
        expect(document.activeElement).toBe(select);
        expect(state.lootSpec).toBeUndefined();
      }
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(setWeeklyLootSpec).toHaveBeenLastCalledWith(null);
    });
  }

  it('describes mixed-role specs and the healer mage accurately', () => {
    for (const [cls, spec, role] of [
      ['druid', 'feral', 'Damage / Tank'],
      ['shaman', 'enhancement', 'Damage / Tank'],
      ['mage', 'arcane', 'Healer'],
    ] as const) {
      const { world, state } = fixture(cls);
      state.lootSpec = spec;
      const root = host(`weekly-focus-${cls}`);
      appendWeeklyLootFocus(root, world);
      expect(root.querySelector('select')?.selectedOptions[0].textContent).toContain(role);
    }
  });

  it('refreshes the catalog after an acknowledged preference and explains missing boss clears', () => {
    const { world, state } = fixture();
    const { root, pane } = mount(world);
    state.lootSpec = 'protection';
    const repaint = vi.fn(() => {
      root.replaceChildren();
      pane.renderInto(root);
    });
    pane.refreshIfChanged(repaint);
    expect(repaint).toHaveBeenCalledTimes(1);
    expect(root.querySelector('select')?.value).toBe('protection');
    expect(root.querySelector('#weekly-pool-raid')?.textContent).toContain(
      'No eligible equipment from your recorded boss clears at this difficulty.',
    );
    pane.refreshIfChanged(repaint);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it('explains level-ineligible loot without blaming the selected focus', () => {
    const { world, state } = fixture('mage');
    state.lootSpec = 'frost';
    world.weeklyRewardInfo!.playerLevel = 1;
    const { root } = mount(world);
    const pool = root.querySelector('#weekly-pool-world')!;
    expect(pool.textContent).toContain('No eligible loot at your current level.');
    expect(pool.textContent).not.toContain('Choose another focus.');
  });

  it('explains a focus-empty catalog projection with a change-focus instruction', () => {
    const { world } = fixture();
    const row = buildWeeklyRewardsView(world.weeklyRewardInfo!, 'paladin')[2];
    const root = host('weekly-focus-empty');
    appendWeeklyLootCategory(
      root,
      {
        ...row,
        pools: row.pools.map((pool) => ({
          ...pool,
          tables: [],
          items: [],
          emptyReason: 'focus',
        })),
      },
      {} as PainterHostPresentation,
      new Set(),
    );
    expect(root.textContent).toContain('No eligible loot. Choose another focus.');
    expect(root.textContent).not.toContain('No eligible loot at your current level.');
  });

  it('keeps the same week open and preserves rolled attribution when the focus changes', () => {
    const { world, state } = fixture('mage');
    state.lootSpec = 'arcane';
    state.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          { pool: 'world', itemId: 'orb_of_the_last_spring', opened: true, lootSpec: 'fire' },
          { pool: 'world' },
        ],
      },
    ];
    world.weeklyRewardInfo!.canClaim = true;
    world.weeklyRewardInfo!.readyWeeks = 1;
    const { root, pane } = mount(world);
    root.querySelector<HTMLButtonElement>('.weekly-start-claim')!.click();
    const attribution = root.querySelector('.weekly-rolled-focus')?.textContent;
    expect(attribution).toContain('Rolled for:');
    expect(root.querySelector('.weekly-claim-active')).not.toBeNull();
    state.lootSpec = 'frost';
    state.claimSequence++;
    pane.refreshIfChanged(() => {
      root.replaceChildren();
      pane.renderInto(root);
    });
    expect(root.querySelector('.weekly-claim-active')).not.toBeNull();
    expect(root.querySelector('.weekly-start-claim')).toBeNull();
    expect(root.querySelector('.weekly-rolled-focus')?.textContent).toBe(attribution);
    expect(root.querySelectorAll('.vault-is-revealed')).toHaveLength(1);
  });

  it('allows retry after a focus acknowledgement invalidates an in-flight open token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { world, state, setWeeklyLootSpec } = fixture('mage');
    state.vaults = [{ resetAtMs: 1000, choices: [{ pool: 'world' }] }];
    world.weeklyRewardInfo!.canClaim = true;
    world.weeklyRewardInfo!.readyWeeks = 1;
    const submittedRevisions: number[] = [];
    world.openWeeklyReward = vi.fn(() => {
      submittedRevisions.push(state.claimSequence);
      // The server rejects the first request: its focus is already updated,
      // while this mirror still carries the previous command token.
    });
    const { root, pane } = mount(world);
    root.querySelector<HTMLButtonElement>('.weekly-start-claim')!.click();
    const select = root.querySelector('select')!;
    select.value = 'frost';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setWeeklyLootSpec).toHaveBeenCalledWith('frost');
    const open = () => root.querySelector<HTMLButtonElement>('[data-focus-key="weekly-open:0"]')!;
    open().click();
    expect(submittedRevisions).toEqual([0]);
    expect(open().getAttribute('aria-disabled')).toBe('true');
    open().click();
    expect(submittedRevisions).toEqual([0]);

    state.lootSpec = 'frost';
    state.claimSequence++;
    pane.refreshIfChanged(() => {
      root.replaceChildren();
      pane.renderInto(root);
    });
    expect(open().getAttribute('aria-disabled')).toBe('true');
    open().click();
    expect(submittedRevisions).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(open().getAttribute('aria-disabled')).toBeNull();
    expect(open().disabled).toBe(false);
    open().click();
    expect(submittedRevisions).toEqual([0, 1]);
    expect(open().getAttribute('aria-disabled')).toBe('true');
  });

  it('allows confirming the same reward after a focus acknowledgement rejects a stale claim', () => {
    const { world, state } = fixture('mage');
    state.vaults = [
      {
        resetAtMs: 1000,
        choices: [{ pool: 'world', itemId: 'orb_of_the_last_spring', opened: true }],
      },
    ];
    world.weeklyRewardInfo!.canClaim = true;
    world.weeklyRewardInfo!.readyWeeks = 1;
    const submittedRevisions: number[] = [];
    world.claimWeeklyReward = vi.fn(() => submittedRevisions.push(state.claimSequence));
    const { root, pane } = mount(world);
    root.querySelector<HTMLButtonElement>('.weekly-start-claim')!.click();
    root.querySelector<HTMLButtonElement>('[data-focus-key="weekly-inspect:0"]')!.click();
    const itemName = root.querySelector('.weekly-confirm-item')?.textContent;
    const select = root.querySelector('select')!;
    select.value = 'frost';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const confirm = () => root.querySelector<HTMLButtonElement>('.weekly-confirm')!;
    confirm().click();
    expect(submittedRevisions).toEqual([0]);
    expect(confirm().disabled).toBe(true);

    state.lootSpec = 'frost';
    state.claimSequence++;
    pane.refreshIfChanged(() => {
      root.replaceChildren();
      pane.renderInto(root);
    });
    expect(root.querySelector('.weekly-confirm-item')?.textContent).toBe(itemName);
    expect(confirm().disabled).toBe(false);
    confirm().click();
    expect(submittedRevisions).toEqual([0, 1]);
    expect(confirm().disabled).toBe(true);
  });

  for (const [width, height, mobile] of [
    [1440, 1000, false],
    [390, 844, true],
    [844, 390, true],
  ] as const) {
    it(`keeps the focus control and loot button usable at ${width}x${height}`, async () => {
      await page.viewport(width, height);
      document.body.className = `game-active weekly-vault-open${mobile ? ' mobile-touch' : ''}`;
      document.documentElement.style.setProperty('--app-vw', `${width}px`);
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
      document.documentElement.style.setProperty('--ui-scale', '1');
      const { world, state } = fixture('shaman');
      state.lootSpec = 'enhancement';
      const { root } = mount(world);
      const toolbar = root.querySelector<HTMLElement>('.weekly-vault-toolbar')!;
      const select = root.querySelector('select')!;
      const button = root.querySelector<HTMLButtonElement>('.weekly-possible-loot-button')!;
      const bounds = toolbar.getBoundingClientRect();
      for (const control of [select, button]) {
        const rect = control.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(40);
        expect(rect.height).toBeGreaterThanOrEqual(mobile ? 40 : 24);
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
        expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
        control.focus();
        expect(document.activeElement).toBe(control);
      }
      expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth + 1);
      expect(await axeSeriousViolations(toolbar)).toEqual([]);
    });
  }
});
