import { describe, expect, it, vi } from 'vitest';

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
import type { ArmorySkinRow } from '../src/ui/woc_store_view';
import type { IWorld } from '../src/world_api';

function worldStub(): IWorld {
  return {
    player: { templateId: 'warrior', mainhandItemId: null },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
  } as unknown as IWorld;
}

function rootStub(body: Record<string, unknown> | null = null): HTMLElement {
  const indicator = {
    classList: { toggle: vi.fn() },
    setAttribute: vi.fn(),
  };
  return {
    style: { display: 'block' },
    querySelector(selector: string) {
      if (selector === '.dr-body') return body;
      if (selector === '[data-woc-store-loading]') return indicator;
      return null;
    },
  } as unknown as HTMLElement;
}

describe('DailyRewardsWindow store refresh behavior', () => {
  it('preserves the last successful store state when a background snapshot is unavailable', async () => {
    const body = {
      innerHTML: 'existing store',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const root = rootStub(body);
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: async () => ({ available: false, balance: 100, items: [] }),
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      tab: 'store',
      storeReady: true,
      storeBalance: 750,
      storeItems: [],
      armorySections: [],
    });

    await (window as unknown as { renderStore(focus: 'open' | null): Promise<void> }).renderStore(
      null,
    );

    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(750);
    expect((window as unknown as { storeError: boolean }).storeError).toBe(false);
    expect(body.innerHTML).not.toContain('dr-error');
  });

  it('opens the top-up dialog from an authoritative insufficient-balance response', async () => {
    const root = rootStub();
    const dialog: { body: string; onOk?: () => void } = { body: '' };
    const openClaudium = vi.fn();
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      spendStoreItem: async () => ({
        granted: false,
        balance: 100,
        costClaudium: 700,
        reason: 'insufficient_balance',
      }),
      openClaudium,
      confirmDialog: (_title, body, _ok, _cancel, onOk) => {
        dialog.body = body;
        dialog.onOk = onOk;
      },
    });
    const row = {
      skin: { id: 'emberfang_sword', name: 'Emberfang' },
      costClaudium: 500,
    } as ArmorySkinRow;

    await (
      window as unknown as { purchaseArmorySkin(row: ArmorySkinRow): Promise<void> }
    ).purchaseArmorySkin(row);

    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(100);
    expect(dialog.body).toContain('600');
    expect(dialog.body).toContain('Emberfang');
    expect(dialog.onOk).toBeTypeOf('function');
    dialog.onOk?.();
    expect(openClaudium).toHaveBeenCalledOnce();
  });
});
