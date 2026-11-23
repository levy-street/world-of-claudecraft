// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourierDispatchRequest, CourierInfo } from '../src/sim/courier/types';
import type { InvSlot } from '../src/sim/types';
import { CourierWindow } from '../src/ui/hud/courier';

afterEach(() => {
  document.body.innerHTML = '';
});
function rig() {
  const root = document.createElement('div');
  document.body.append(root);
  let bags: InvSlot[] = [{ itemId: 'linen_cloth', count: 4 }];
  const info: CourierInfo = {
    phase: 'ready',
    active: true,
    x: 0,
    z: 0,
    bankerId: 1,
    travelDistance: 0,
    remainingDistance: 0,
    inventoryRevision: 1,
    bankRevision: 1,
    cargo: [],
    withdrawals: [],
    revision: 1,
    bankSlots: [{ itemId: 'healing_potion', count: 2 }],
    bankCapacity: 24,
    vault: null,
  };
  const deps = {
    info: () => info,
    inventory: vi.fn(() => bags),
    inventoryCapacity: vi.fn(() => 16),
    hideTooltip: vi.fn(),
    itemIcon: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    dispatch: vi.fn<(request: CourierDispatchRequest) => void>(),
    closeOthers: vi.fn(),
    captureFocus: vi.fn(() => null),
    restoreFocus: vi.fn(),
    onClosed: vi.fn(),
  };
  const window = new CourierWindow(root, deps);
  window.open();
  return {
    root,
    info,
    deps,
    window,
    replaceBags: (next: InvSlot[]) => {
      bags = next;
    },
  };
}
describe('courier window', () => {
  it('places bank and inventory sockets around the courier and retains empty bank space', () => {
    const { root } = rig();
    const columns = root.querySelector('.courier-columns')!;
    expect(columns.children[0].getAttribute('data-courier-storage')).toBe('withdrawals');
    expect(columns.children[1].classList.contains('courier-companion')).toBe(true);
    expect(columns.children[2].getAttribute('data-courier-storage')).toBe('deposits');
    expect(
      columns.querySelectorAll('[data-courier-storage="withdrawals"] .bank-item'),
    ).toHaveLength(24);
    expect(root.querySelector('.courier-portrait img')?.getAttribute('src')).toContain(
      '/ui/courier/donkey.webp',
    );
  });
  it('refreshes empty sockets when bank or bag capacity changes without moving items', () => {
    const { root, info, deps, window } = rig();
    deps.inventoryCapacity.mockReturnValue(20);
    info.bankCapacity = 30;
    window.refreshIfChanged();
    expect(root.querySelectorAll('[data-courier-storage="withdrawals"] .bank-item')).toHaveLength(
      30,
    );
    expect(root.querySelectorAll('[data-courier-storage="deposits"] .bank-item')).toHaveLength(20);
  });
  it('retains full overflow inventory and owned-item marks in the socket grid', () => {
    const { root, window, replaceBags } = rig();
    replaceBags(
      Array.from({ length: 40 }, () => ({
        itemId: 'membership_helmet',
        count: 1,
        instance: { boundTo: 1, locked: true },
      })),
    );
    window.render(true);
    expect(root.querySelectorAll('[data-courier-side="deposits"]')).toHaveLength(40);
    expect(root.querySelector('[data-courier-side="deposits"] .bi-glyph-bound')).not.toBeNull();
    expect(root.querySelector('[data-courier-side="deposits"] .bi-lock-seal')).not.toBeNull();
  });

  it('disables quest items and dispatches only the ordinary stack from mixed bags', () => {
    const { root, info, deps, window, replaceBags } = rig();
    replaceBags([
      { itemId: 'clue_scroll', count: 1 },
      { itemId: 'linen_cloth', count: 4 },
    ]);
    info.bankSlots = [{ itemId: 'clue_scroll', count: 1 }];
    window.render(true);
    const quest = root.querySelector<HTMLButtonElement>(
      '[data-courier-side="deposits"][data-courier-index="0"]',
    )!;
    expect(quest.disabled).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('[data-courier-side="withdrawals"]')!.disabled,
    ).toBe(true);
    // Even a synthetic event bypassing the native disabled click cannot stage it.
    quest.dispatchEvent(new MouseEvent('click'));
    expect(root.querySelector<HTMLButtonElement>('.courier-send')!.disabled).toBe(true);
    root
      .querySelector<HTMLButtonElement>('[data-courier-side="deposits"][data-courier-index="1"]')!
      .click();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch.mock.calls[0][0].deposits.map((selection) => selection.index)).toEqual([
      1,
    ]);
    expect(deps.dispatch.mock.calls[0][0].withdrawals).toEqual([]);
  });
  it('selects both directions, retains focus and sends one custody request', () => {
    const { root, deps, window } = rig();
    expect(document.activeElement).toBe(root.querySelector('.x-btn'));
    const deposit = root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!;
    deposit.focus();
    deposit.click();
    expect(document.activeElement?.getAttribute('data-courier-side')).toBe('deposits');
    root.querySelector<HTMLButtonElement>('[data-courier-side="withdrawals"]')!.click();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch.mock.calls[0][0].deposits).toHaveLength(1);
    expect(deps.dispatch.mock.calls[0][0].withdrawals).toHaveLength(1);
    // A successful send closes the window and hands focus back to the opener.
    expect(window.isOpen()).toBe(false);
    expect(root.style.display).toBe('none');
    expect(deps.restoreFocus).toHaveBeenCalledOnce();
    expect(deps.onClosed).toHaveBeenCalledOnce();
  });
  it('keeps both storage scroll positions when selecting a stack', () => {
    const { root } = rig();
    const bankGrid = root.querySelector<HTMLElement>(
      '[data-courier-storage="withdrawals"] .courier-grid',
    )!;
    const bagGrid = root.querySelector<HTMLElement>(
      '[data-courier-storage="deposits"] .courier-grid',
    )!;
    bankGrid.scrollTop = 100;
    bagGrid.scrollTop = 60;
    root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    expect(
      root.querySelector('[data-courier-storage="withdrawals"] .courier-grid')!.scrollTop,
    ).toBe(100);
    expect(root.querySelector('[data-courier-storage="deposits"] .courier-grid')!.scrollTop).toBe(
      60,
    );
  });
  it('checks expiry at click time and keeps saved cargo visible afterward', () => {
    const { root, info, deps, window } = rig();
    root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    info.active = false;
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch).not.toHaveBeenCalled();
    // A refused send keeps the window open so the player sees why.
    expect(window.isOpen()).toBe(true);
    info.phase = 'waiting';
    info.cargo = [{ itemId: 'linen_cloth', count: 4 }];
    window.refreshIfChanged();
    expect(root.querySelectorAll('.courier-cargo li')).toHaveLength(1);
    expect(root.querySelector('.courier-send')).toBeNull();
  });
  it('never retargets a stale click to replacement inventory', () => {
    const { root, deps, replaceBags } = rig();
    const old = root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!;
    replaceBags([{ itemId: 'healing_potion', count: 1 }]);
    old.click();
    expect(root.querySelector<HTMLButtonElement>('.courier-send')!.disabled).toBe(true);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
  it('does not rebuild for pose changes and restores focus on close', () => {
    const { root, info, deps, window } = rig();
    const before = root.firstChild;
    deps.inventory.mockClear();
    info.x = 10;
    window.refreshIfChanged();
    expect(root.firstChild).toBe(before);
    expect(deps.inventory).not.toHaveBeenCalled();
    window.close();
    expect(window.isOpen()).toBe(false);
    expect(deps.restoreFocus).toHaveBeenCalledOnce();
    expect(deps.onClosed).toHaveBeenCalledOnce();
  });
  it('closing a waiting courier unsent dismisses it with one empty request', () => {
    const { root, deps, window } = rig();
    root.querySelector<HTMLButtonElement>('.x-btn')!.click();
    expect(window.isOpen()).toBe(false);
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch.mock.calls[0][0]).toEqual({ deposits: [], withdrawals: [] });
    // A second close is a no-op, never a second dismissal.
    window.close();
    expect(deps.dispatch).toHaveBeenCalledOnce();
  });
  it('never dismisses after Send or while the courier is busy or carrying cargo', () => {
    const sent = rig();
    sent.root.querySelector<HTMLButtonElement>('[data-courier-side="deposits"]')!.click();
    sent.root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(sent.deps.dispatch).toHaveBeenCalledOnce();
    expect(sent.deps.dispatch.mock.calls[0][0].deposits).toHaveLength(1);
    for (const phase of ['outbound', 'returning', 'waiting'] as const) {
      const busy = rig();
      busy.info.phase = phase;
      busy.window.close();
      expect(busy.deps.dispatch, phase).not.toHaveBeenCalled();
    }
    const loaded = rig();
    loaded.info.cargo = [{ itemId: 'linen_cloth', count: 1 }];
    loaded.window.close();
    expect(loaded.deps.dispatch).not.toHaveBeenCalled();
  });
  it('drops the travel-time line from the courier portrait', () => {
    const { root } = rig();
    const portrait = root.querySelector('.courier-companion')!;
    expect(portrait.querySelector('p')).toBeNull();
    expect(portrait.textContent).not.toMatch(/seconds/i);
  });

  it('opens the Materials Vault tab, sending carried materials and vault rows', () => {
    const { root, info, deps, window, replaceBags } = rig();
    info.vault = {
      stock: { copper_ore: 6 },
      special: [],
      upgrades: 1,
      perMaterialCap: 100,
      nextUpgradeCost: 50000,
    };
    replaceBags([
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'healing_potion', count: 1 },
    ]);
    window.render(true);
    root.querySelector<HTMLButtonElement>('.courier-store-tab[data-tab="vault"]')!.click();
    expect(root.querySelector('[data-courier-storage="vault"]')).not.toBeNull();
    // Only materials can be picked for the vault.
    expect(
      root.querySelector<HTMLButtonElement>(
        '[data-courier-side="vaultDeposits"][data-courier-index="1"]',
      )!.disabled,
    ).toBe(true);
    root
      .querySelector<HTMLButtonElement>(
        '[data-courier-side="vaultDeposits"][data-courier-index="0"]',
      )!
      .click();
    root.querySelector<HTMLButtonElement>('[data-courier-vault-row="0"]')!.click();
    // The pick stays marked for the vault when the bank tab is showing.
    root.querySelector<HTMLButtonElement>('.courier-store-tab[data-tab="bank"]')!.click();
    expect(root.querySelector('.courier-selected--vault')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch.mock.calls[0][0]).toMatchObject({
      deposits: [],
      withdrawals: [],
      vaultDeposits: [{ index: 0 }],
      vaultWithdrawals: [{ itemId: 'copper_ore', count: 6 }],
    });
  });
  it('shows no store tabs for a courier without a vault and explains a locked vault', () => {
    const { root, info, window } = rig();
    expect(root.querySelector('.courier-store-tab')).toBeNull();
    info.vault = { stock: {}, special: [], upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 };
    window.render(true);
    root.querySelector<HTMLButtonElement>('.courier-store-tab[data-tab="vault"]')!.click();
    expect(root.textContent).toContain('Unlock the Materials Vault');
  });

  it('plans a delivery to another character from the Other characters tab', () => {
    const { root, deps, window, replaceBags } = rig();
    let accounts: import('../src/world_api/bank').AccountBankInfo | null = null;
    const requestAccountBanks = vi.fn();
    const selectAccountBank = vi.fn();
    Object.assign(deps, {
      accounts: () => ({
        get accountBankInfo() {
          return accounts;
        },
        requestAccountBanks,
        selectAccountBank,
      }),
    });
    replaceBags([
      { itemId: 'healing_potion', count: 3 },
      { itemId: 'membership_helmet', count: 1 },
    ]);
    window.render(true);
    root.querySelector<HTMLButtonElement>('.courier-store-tab[data-tab="account"]')!.click();
    expect(requestAccountBanks).toHaveBeenCalledWith(true);
    expect(root.textContent).toContain('Loading your characters');
    accounts = {
      characters: [{ characterId: 12, name: 'Alt' }],
      selectedCharacterId: 12,
      bank: {
        slots: [{ itemId: 'wolf_fang', count: 5 }],
        capacity: 24,
        purchasedSlots: 0,
        bonusSlots: 0,
        nextExpansionCost: null,
        bonusSources: [],
        socketsUnlocked: 0,
        socketBags: [null, null, null, null],
        nextSocketCost: null,
        generalCapacity: 24,
        materialsCapacity: 0,
        generalUsed: 1,
        materialsUsed: 0,
      },
    };
    window.refreshIfChanged();
    expect(root.querySelector('[data-courier-storage="account"] h3')?.textContent).toBe(
      "Alt's bank",
    );
    // Soulbound gear cannot go to another character.
    expect(
      root.querySelector<HTMLButtonElement>(
        '[data-courier-side="accountDeposits"][data-courier-index="1"]',
      )!.disabled,
    ).toBe(true);
    root
      .querySelector<HTMLButtonElement>(
        '[data-courier-side="accountDeposits"][data-courier-index="0"]',
      )!
      .click();
    root.querySelector<HTMLButtonElement>('[data-courier-side="accountWithdrawals"]')!.click();
    root.querySelector<HTMLButtonElement>('.courier-send')!.click();
    expect(deps.dispatch.mock.calls[0][0]).toMatchObject({
      deposits: [],
      withdrawals: [],
      account: { characterId: 12, deposits: [{ index: 0 }], withdrawals: [{ index: 0 }] },
    });
  });
});
