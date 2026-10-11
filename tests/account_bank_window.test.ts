// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { accountBankTransferAllowed } from '../src/ui/account_bank_view';
import { renderAccountBank } from '../src/ui/account_bank_window';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { IWorld } from '../src/world_api';
import type { BankInfo } from '../src/world_api/bank';

function bank(slots: InvSlot[]): BankInfo {
  return {
    slots,
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 100,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 100,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: slots.length,
    materialsUsed: 0,
  };
}

function setup(selected = false) {
  const world = {
    player: { membershipActive: true },
    inventory: [{ itemId: 'copper_ore', count: 3 }],
    accountBankInfo: {
      characters: [{ characterId: 2, name: '<Alice>' }],
      selectedCharacterId: selected ? 2 : null,
      bank: selected ? bank([{ itemId: 'copper_ore', count: 4 }]) : null,
    },
    accountBankTransfer: vi.fn(),
    requestAccountBanks: vi.fn(),
    selectAccountBank: vi.fn(),
    claimMembershipArmour: vi.fn(),
  };
  const root = document.createElement('div');
  const repaint = vi.fn();
  const deps = {
    world: () => world as unknown as IWorld,
    itemIcon: () => '<i></i>',
    itemTooltip: () => '',
    attachTooltip: vi.fn(),
    consumePeek: () => false,
    hideTooltip: vi.fn(),
    onInventoryChanged: vi.fn(),
  };
  return { world, root, repaint, deps };
}

describe('other character banks', () => {
  it('hides stale member bank data after expiry while retaining the friendship claim', () => {
    const { world, root, repaint, deps } = setup(true);
    Object.assign(world.player, { membershipActive: false, referralInviterName: 'Aldric' });
    renderAccountBank(root, deps, repaint);
    expect(root.querySelector('[data-focus-key="account-armour"]')).not.toBeNull();
    expect(root.querySelector('.account-bank-tab')).toBeNull();
    expect(root.querySelector('.bank-grid')).toBeNull();
  });
  it('loads contents only after selecting a character and escapes account names', () => {
    const { world, root, repaint, deps } = setup();
    renderAccountBank(root, deps, repaint);
    expect(world.selectAccountBank).not.toHaveBeenCalled();
    expect(root.querySelector('alice')).toBeNull();
    expect(root.querySelector('.account-bank-tab')?.textContent).toBe('<Alice>');
    root.querySelector<HTMLButtonElement>('.account-bank-tab')!.click();
    expect(world.selectAccountBank).toHaveBeenCalledWith(2);
    expect(repaint).toHaveBeenCalledOnce();
  });

  it('sends the displayed full-stack fingerprint with either transfer direction', () => {
    const { world, root, repaint, deps } = setup(true);
    renderAccountBank(root, deps, repaint);
    root.querySelector<HTMLButtonElement>('[data-focus-key="account-withdraw:0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-focus-key="account-deposit:0"]')!.click();
    expect(world.accountBankTransfer.mock.calls).toEqual([
      [2, 'withdraw', 0, 4, { itemId: 'copper_ore', count: 4 }],
      [2, 'deposit', 0, 3, { itemId: 'copper_ore', count: 3 }],
    ]);
  });

  it('blocks bound copies and offers armour claiming for members without another character', () => {
    const { world, root, repaint, deps } = setup(true);
    world.inventory[0] = { itemId: 'copper_ore', count: 1, instance: { boundTo: 1 } } as InvSlot;
    renderAccountBank(root, deps, repaint);
    expect(
      root.querySelector<HTMLButtonElement>('[data-focus-key="account-deposit:0"]')!.disabled,
    ).toBe(true);
    expect(
      accountBankTransferAllowed(
        { itemId: 'copper_ore', count: 1 },
        { ...ITEMS.copper_ore, soulbound: true },
      ),
    ).toBe(false);
    world.accountBankInfo.characters = [];
    root.innerHTML = '';
    renderAccountBank(root, deps, repaint);
    root.querySelector<HTMLButtonElement>('[data-focus-key="account-armour"]')!.click();
    expect(world.claimMembershipArmour).toHaveBeenCalledOnce();
  });
  it('lets an entitled nonmember retry the friendship grant without requesting member bank data', () => {
    const { world, root, deps } = setup();
    Object.assign(world, {
      accountBankInfo: null,
      bankInfo: bank([]),
      vaultInfo: null,
      guildBankInfo: null,
      bags: [null, null, null, null],
      copper: 0,
    });
    Object.assign(world.player, { membershipActive: false, referralInviterName: 'Aldric' });
    const win = new BankWindow({
      ...deps,
      root: () => root,
      closeOthers: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      onClosed: vi.fn(),
      moneyHtml: () => '',
    } as BankWindowDeps);
    win.open();
    root.querySelector<HTMLButtonElement>('[data-tab="account"]')!.click();
    const claim = root.querySelector<HTMLButtonElement>('[data-focus-key="account-armour"]')!;
    expect(claim.textContent).toBe('Claim friendship armour');
    claim.click();
    expect(world.claimMembershipArmour).toHaveBeenCalledOnce();
    expect(world.requestAccountBanks).not.toHaveBeenCalled();
    win.close();
  });

  it('requests member banks once per opening and returns to Personal immediately on expiry', () => {
    const { world, root, deps } = setup(true);
    Object.assign(world, {
      bankInfo: bank([]),
      vaultInfo: null,
      guildBankInfo: null,
      bags: [null, null, null, null],
      copper: 0,
    });
    const win = new BankWindow({
      ...deps,
      root: () => root,
      closeOthers: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      onClosed: vi.fn(),
      moneyHtml: () => '',
    } as BankWindowDeps);
    win.open();
    expect(world.requestAccountBanks).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>('[data-tab="account"]')!.click();
    expect(root.querySelector('#account-bank-panel')).not.toBeNull();
    win.refreshIfChanged();
    win.refreshIfChanged();
    expect(world.requestAccountBanks).toHaveBeenCalledOnce();
    world.player.membershipActive = false;
    win.refreshIfChanged();
    expect(root.querySelector('[data-tab="account"]')).toBeNull();
    expect(root.querySelector('#account-bank-panel')).toBeNull();
    expect(win.personalTabActive).toBe(true);
    win.close();
  });
});
