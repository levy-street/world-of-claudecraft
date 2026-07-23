import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/armory_inspect', () => ({
  ArmoryInspect: class {
    openSkinId: string | null = null;
    close(): void {}
    open(): void {}
    refresh(): void {}
  },
  badgeLabel: () => '',
  rarityLabel: () => '',
  weaponTypeLabel: () => '',
}));
vi.mock('../src/ui/portrait_chip', () => ({ portraitChipHtml: () => '' }));

import { DailyRewardsWindow } from '../src/ui/daily_rewards_window';
import type { DailyRewardStatus, IWorld } from '../src/world_api';

function worldStub(): IWorld {
  const status = {
    day: '2026-01-01',
    resetAt: '2026-01-02T00:00:00Z',
    prizePoolUsd: 0,
    prizePoolSol: null,
    eligibility: { eligible: false, reason: 'no_wallet' },
    score: 0,
    rank: null,
    spin: { claimed: false },
    tasks: [],
    leaderboard: [],
    leaderboardTotal: 0,
  } as unknown as DailyRewardStatus;
  return {
    player: { templateId: 'warrior', mainhandItemId: null },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
    dailyRewards: async () => status,
    dailyRewardHistory: async () => ({ payouts: [] }),
  } as unknown as IWorld;
}

function rootStub(): HTMLElement {
  return {
    style: { display: 'none' },
    dataset: {} as Record<string, string>,
    innerHTML: '',
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
}

function makeWindow() {
  const root = rootStub();
  const onClose = vi.fn();
  const onVisibilityChange = vi.fn();
  const win = new DailyRewardsWindow({
    root: () => root,
    world: worldStub,
    closeOthers: () => undefined,
    captureFocus: () => null,
    restoreFocus: () => undefined,
    onVisibilityChange,
    onClose,
  });
  // The async render path is exercised elsewhere; stub it so toggle()/close()
  // drive only the open/closed transitions under test.
  vi.spyOn(
    win as unknown as { renderCurrent(focus: 'open' | null): Promise<void> },
    'renderCurrent',
  ).mockResolvedValue();
  return { win, root, onClose, onVisibilityChange };
}

describe('DailyRewardsWindow close notification', () => {
  beforeEach(() => {
    // toggle() starts window.setInterval polls and close() clears them.
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires onClose exactly once per toggle open-then-close cycle', () => {
    const { win, root, onClose } = makeWindow();

    win.toggle();
    expect(root.style.display).toBe('block');
    expect(onClose).not.toHaveBeenCalled();

    win.toggle();
    expect(root.style.display).toBe('none');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not fire onClose when the window is already closed', () => {
    const { win, onClose } = makeWindow();

    win.close();
    expect(onClose).not.toHaveBeenCalled();

    win.toggle();
    win.close();
    win.close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fires onClose once on a direct close() after open (managed dispatch and X button path)', () => {
    const { win, root, onClose, onVisibilityChange } = makeWindow();

    win.toggle();
    win.close();

    expect(root.style.display).toBe('none');
    expect(onClose).toHaveBeenCalledOnce();
    // Both open and close still report visibility; onClose fires only for the close.
    expect(onVisibilityChange).toHaveBeenCalledTimes(2);
  });

  it('exposes isOpen so the opener can distinguish the toggle direction', () => {
    const { win } = makeWindow();

    expect(win.isOpen).toBe(false);
    win.toggle();
    expect(win.isOpen).toBe(true);
    win.toggle();
    expect(win.isOpen).toBe(false);
    win.close();
    expect(win.isOpen).toBe(false);
  });
});
