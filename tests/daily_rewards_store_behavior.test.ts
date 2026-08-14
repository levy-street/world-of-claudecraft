import { describe, expect, it, vi } from 'vitest';

// Counters live outside the factory so a test can assert WHEN the Armory stage
// is constructed, which is the whole point of the intent invariant below.
const armorySpy = vi.hoisted(() => ({ constructed: 0, opened: 0 }));
vi.mock('../src/ui/armory_inspect', () => ({
  ArmoryInspect: class {
    openSkinId: string | null = null;
    constructor() {
      armorySpy.constructed++;
    }
    close(): void {}
    destroy(): void {}
    open(): void {
      armorySpy.opened++;
    }
    refresh(): void {}
  },
  badgeLabel: () => '',
  rarityLabel: () => '',
  weaponTypeLabel: () => '',
}));
vi.mock('../src/ui/portrait_chip', () => ({
  hydratePortraits: () => undefined,
  portraitChipHtml: () => '',
}));

import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
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

describe('DailyRewardsWindow store intent', () => {
  // The invariant this branch ships: NO Armory preparation on store open, the
  // stage built only by the click that opens a card. Source walks cannot lock
  // it (an early call added inside paintStore, where the click handler is
  // wired, passed every one of them), so this drives the real path and counts
  // constructions.
  it('builds the Armory stage on a card click and on nothing else', async () => {
    armorySpy.constructed = 0;
    armorySpy.opened = 0;
    const clicks = new Map<string, () => void>();
    let html = '';
    const body = {
      dataset: {} as Record<string, string>,
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
      },
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector !== '[data-armory-skin]') return [];
        // One button per catalogue skin, exactly as the painted markup carries.
        return Object.keys(WEAPON_SKINS).map((id) => ({
          dataset: { armorySkin: id },
          addEventListener: (_type: string, handler: () => void) => clicks.set(id, handler),
        }));
      },
    };
    // A root that answers every chrome lookup rather than only the ones this
    // test cares about: syncTabs and the loading indicator both walk it, and a
    // null there throws into renderCurrent's fire-and-forget void, which is
    // silent. Unknown selectors get an inert element instead of null.
    const chrome = () => ({
      classList: { toggle: () => undefined, add: () => undefined, remove: () => undefined },
      setAttribute: () => undefined,
      focus: () => undefined,
      dataset: {} as Record<string, string>,
    });
    const intentRoot = {
      style: { display: 'block' },
      classList: chrome().classList,
      querySelector: (selector: string) => (selector === '.dr-body' ? body : chrome()),
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const window = new DailyRewardsWindow({
      // Own root stub: the shared one has no querySelectorAll, and syncTabs needs
      // it. Without it renderCurrent rejects into the fire-and-forget void and
      // the store silently never paints, which is exactly how the first version
      // of this test failed.
      root: () => intentRoot,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: async () => ({ available: true, balance: 1000, items: [] }),
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'store' });

    // Open for real: renderCurrent is NOT stubbed, so renderStore and paintStore
    // both run and the click handlers get wired.
    window.openStore();
    await vi.waitFor(() => expect(clicks.size).toBeGreaterThan(0));

    // The store is painted and interactive, and no stage exists.
    expect(armorySpy.constructed).toBe(0);
    expect(armorySpy.opened).toBe(0);

    const [firstSkinId] = [...clicks.keys()];
    clicks.get(firstSkinId)?.();

    // Exactly one build, exactly one open, and only from the click.
    expect(armorySpy.constructed).toBe(1);
    expect(armorySpy.opened).toBe(1);

    // A second card reuses the one stage rather than minting another context.
    const secondSkinId = [...clicks.keys()][1];
    clicks.get(secondSkinId)?.();
    expect(armorySpy.constructed).toBe(1);
    expect(armorySpy.opened).toBe(2);
  });
});

describe('DailyRewardsWindow store refresh behavior', () => {
  it('does not render wallet connection controls in the Store', () => {
    let html = '';
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    (window as unknown as { paintStore(body: HTMLElement): void }).paintStore(
      body as unknown as HTMLElement,
    );

    expect(html).not.toContain('Connect wallet');
    expect(html).not.toContain('recovery phrase or private key');
    expect(html).not.toContain('data-store-wallet');
    expect(html).not.toContain('woc-store-wallet');
  });

  it('selects and opens the Store without toggling an open window closed', () => {
    const root = rootStub();
    root.style.display = 'none';
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'rewards' });
    const toggle = vi.spyOn(window, 'toggle').mockImplementation(() => undefined);

    window.openStore();

    expect(toggle).toHaveBeenCalledOnce();
    expect((window as unknown as { tab: string }).tab).toBe('store');

    root.style.display = 'block';
    toggle.mockClear();
    const renderCurrent = vi
      .spyOn(
        window as unknown as { renderCurrent(focus: 'open' | null): Promise<void> },
        'renderCurrent',
      )
      .mockResolvedValue();
    window.openStore();

    expect(toggle).not.toHaveBeenCalled();
    expect(renderCurrent).toHaveBeenCalledWith('open');
  });

  it('does not rebuild an unchanged store body during a background refresh', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(1);
  });

  it('rebuilds the store body when its visible state changes', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    Object.assign(window as unknown as Record<string, unknown>, { storeBalance: 1_250 });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(2);
    expect(html).toContain('1,250');
  });

  it('restores unchanged store markup after the rewards tab occupied the shared body', () => {
    let writes = 0;
    const body = {
      dataset: {},
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    Object.defineProperty(body, 'innerHTML', {
      get: () => '',
      set: () => {
        writes += 1;
      },
    });
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    const paintRewards = (
      window as unknown as { paint(view: { kind: 'error'; message: string }): void }
    ).paint.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintRewards({ kind: 'error', message: 'unavailable' });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(3);
  });

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
    const order: string[] = [];
    const openClaudium = vi.fn(() => order.push('claudium'));
    const spendStoreItem = vi.fn(async () => ({
      granted: false,
      balance: 100,
      costClaudium: 1_000,
      reason: 'insufficient_balance',
    }));
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      spendStoreItem,
      openClaudium,
      confirmDialog: (_title, body, _ok, _cancel, onOk) => {
        dialog.body = body;
        dialog.onOk = onOk;
      },
    });
    const row = {
      skin: WEAPON_SKINS.cinderbrand_sword,
      costClaudium: 200,
    } as ArmorySkinRow;
    Object.assign(window as unknown as Record<string, unknown>, {
      armoryInspect: { close: () => order.push('inspect') },
    });

    await (
      window as unknown as { purchaseArmorySkin(row: ArmorySkinRow): Promise<void> }
    ).purchaseArmorySkin(row);

    expect(spendStoreItem).toHaveBeenCalledWith('cinderbrand_sword', 'skin', 200);
    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(100);
    expect(dialog.body).toContain('900');
    expect(dialog.body).toContain('Cinderbrand');
    expect(dialog.onOk).toBeTypeOf('function');
    dialog.onOk?.();
    expect(openClaudium).toHaveBeenCalledOnce();
    expect(order).toEqual(['inspect', 'claudium']);
  });

  it('refreshes and requires a new confirmation when the service price changed', async () => {
    const confirmations: string[] = [];
    const spendStoreItem = vi.fn(async () => ({
      granted: false,
      balance: 2_000,
      costClaudium: 1_000,
      reason: 'price_changed',
    }));
    const window = new DailyRewardsWindow({
      root: () => rootStub(),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      spendStoreItem,
      confirmDialog: (_title, body) => confirmations.push(body),
    });
    const original = {
      skin: WEAPON_SKINS.cinderbrand_sword,
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    } as ArmorySkinRow;
    const current = { ...original, costClaudium: 1_000 } as ArmorySkinRow;
    Object.assign(window as unknown as Record<string, unknown>, {
      armorySections: [],
      renderStore: async () => {
        Object.assign(window as unknown as Record<string, unknown>, {
          armorySections: [{ rows: [current] }],
        });
      },
    });

    await (
      window as unknown as { purchaseArmorySkin(row: ArmorySkinRow): Promise<void> }
    ).purchaseArmorySkin(original);

    expect(spendStoreItem).toHaveBeenCalledWith('cinderbrand_sword', 'skin', 200);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain('1,000');
  });
});
