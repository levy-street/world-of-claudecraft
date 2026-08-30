// @vitest-environment jsdom
// Behavioral pin for the vendor-sell confirm gate (the enchanted-offhand-vanishes
// report): drives the REAL BagsWindow (the bags_guild_deposit_routing.test.ts
// fixture idiom) with vendorOpen true and asserts WHICH facet command a click
// actually invokes. The source pins in bags_window.test.ts anchor the wiring
// text; this proves the dispatch, including the two review-round fixes:
//   - a stale copy at submit time REFUSES (does not fall back to an itemId-only
//     guess that could vendor a DIFFERENT copy of the same id).
//   - focus after a confirmed sale lands on the close button, not a detached cell.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { tSim } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

// Real merged-table ids, derived rather than hardcoded (the guild-deposit
// suite's own convention). A junk id (poor quality) and a plain common weapon
// id (both instant-sellable), and a rare+ weapon id (needs confirmation).
const junkId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return d.quality === 'poor' && d.kind !== 'quest' && !d.noVendorSell && !d.soulbound;
}) as string;
const commonId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return (
    d.kind === 'weapon' && (d.quality ?? 'common') === 'common' && !d.noVendorSell && !d.soulbound
  );
}) as string;
const rareId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return (
    d.kind === 'weapon' &&
    (d.quality === 'rare' || d.quality === 'epic' || d.quality === 'legendary') &&
    !d.noVendorSell &&
    !d.soulbound
  );
}) as string;

interface Harness {
  root: HTMLElement;
  calls: string[];
  errors: string[];
}

function harness(inventory: InvSlot[]): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: string[] = [];
  const errors: string[] = [];
  const sink =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(
        `${name}:${a
          .filter((x) => x !== undefined)
          .map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)))
          .join(',')}`,
      );
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankDeposit: sink('bankDeposit'),
    guildBankDeposit: sink('guildBankDeposit'),
    useItem: sink('useItem'),
    equipBag: sink('equipBag'),
    unequipBag: sink('unequipBag'),
    discardItem: sink('discardItem'),
    feedPet: sink('feedPet'),
    sellItem: sink('sellItem'),
    moveInventoryItem: sink('moveInventoryItem'),
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => true,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: (text: string) => errors.push(text),
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const window_ = new BagsWindow(deps);
  window_.render();
  return { root, calls, errors };
}

function clickCellFor(root: HTMLElement, itemId: string, opts?: { ctrl?: boolean }): void {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('button.bag-item'));
  const cell = cells.find((c) => c.getAttribute('aria-label')?.includes(ITEMS[itemId].name));
  expect(cell, `no bag cell for ${itemId}`).toBeTruthy();
  cell?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, ctrlKey: opts?.ctrl === true, cancelable: true }),
  );
}

function confirmPrompt(): HTMLElement | null {
  return document.querySelector('.sell-confirm-prompt');
}

function clickPromptConfirmButton(): void {
  const btn = confirmPrompt()?.querySelector('button.btn');
  expect(btn, 'no confirm button in the open prompt').toBeTruthy();
  (btn as HTMLElement).click();
}

describe('vendor plain click: plain sub-rare items sell in one step', () => {
  it('true junk sells instantly, no prompt, exactly the clicked slot', () => {
    const h = harness([{ itemId: junkId, count: 1 }]);
    clickCellFor(h.root, junkId);
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${junkId},{"slotIndex":0}`]);
  });

  it('a PLAIN common item sells instantly again (the per-item-approval report)', () => {
    // The follow-up player report on the confirm gate: with only poor quality
    // instant, every white and green on an ordinary vendor-trash run popped an
    // approval dialog. A plain sub-rare copy is interchangeable and buyback
    // restores it exactly, so the one-step classic sale is back for these.
    const h = harness([{ itemId: commonId, count: 1 }]);
    clickCellFor(h.root, commonId);
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${commonId},{"slotIndex":0}`]);
  });

  it('an ENCHANTED copy of that same common item still confirms', () => {
    // The instance-payload arm is quality-independent: the enchanted-offhand
    // loss was an instanced copy, and those keep the safety net at every tier.
    const h = harness([
      { itemId: commonId, count: 1, instance: { enchant: 'enchant_weapon_might' } },
    ]);
    clickCellFor(h.root, commonId);
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).not.toBeNull();
  });
});

describe('vendor plain click on a rare+ item opens a confirm prompt instead of selling', () => {
  it('does not sell on click; opens exactly one .sell-confirm-prompt', () => {
    const h = harness([{ itemId: rareId, count: 1 }]);
    clickCellFor(h.root, rareId);
    expect(h.calls).toEqual([]);
    const prompt = confirmPrompt();
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain(ITEMS[rareId].name);
  });

  it('a second click while the prompt is open does not stack a second prompt', () => {
    const h = harness([{ itemId: rareId, count: 1 }]);
    clickCellFor(h.root, rareId);
    clickCellFor(h.root, rareId);
    expect(document.querySelectorAll('.sell-confirm-prompt')).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });

  it('Confirm sells exactly the named slot and Cancel sends nothing', () => {
    const h = harness([{ itemId: rareId, count: 1 }]);
    clickCellFor(h.root, rareId);
    const buttons = Array.from(confirmPrompt()?.querySelectorAll('button.btn') ?? []);
    expect(buttons, 'expected [Confirm, Cancel]').toHaveLength(2);
    (buttons[1] as HTMLElement).click();
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).toBeNull();

    clickCellFor(h.root, rareId);
    clickPromptConfirmButton();
    expect(h.calls).toEqual([`sellItem:${rareId},1,{"slotIndex":0}`]);
    expect(confirmPrompt()).toBeNull();
  });

  it('focus lands on the close button after a confirmed sale, not a detached cell', () => {
    const h = harness([{ itemId: rareId, count: 1 }]);
    clickCellFor(h.root, rareId);
    clickPromptConfirmButton();
    expect(document.activeElement).toBe(h.root.querySelector('[data-close]'));
  });

  it('a stale copy at confirm time REFUSES rather than vendoring a different copy of the id', () => {
    // The dialog names inventory[0] (the plain copy). Between open and confirm the
    // bags repaint under it (a trade, a mail send, a wire snapshot online): here
    // that copy leaves and only an ENCHANTED copy of the same id remains. Falling
    // back to an itemId-only sellItem call would vendor the enchanted copy the
    // dialog never named; the fix must refuse instead.
    const inventory: InvSlot[] = [{ itemId: rareId, count: 1 }];
    const h = harness(inventory);
    clickCellFor(h.root, rareId);
    expect(confirmPrompt()).not.toBeNull();
    // Simulate the repaint: the named slot is gone, an instanced copy sits alone.
    inventory.length = 0;
    inventory.push({ itemId: rareId, count: 1, instance: { enchant: 'enchant_weapon_might' } });
    clickPromptConfirmButton();
    expect(h.calls, 'no sale was dispatched').toEqual([]);
    expect(h.errors).toEqual([tSim('error.noItem')]);
  });
});

describe('vendor ctrl/meta click respects the same gate', () => {
  it('a single-count rare+ copy opens the same per-slot confirm prompt as a plain click', () => {
    const h = harness([{ itemId: rareId, count: 1 }]);
    clickCellFor(h.root, rareId, { ctrl: true });
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).not.toBeNull();
  });

  it('true junk still bulk-sells instantly on ctrl-click (unchanged)', () => {
    const h = harness([{ itemId: junkId, count: 3 }]);
    clickCellFor(h.root, junkId, { ctrl: true });
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${junkId},3`]);
  });

  it('a plain common stack bulk-sells instantly on ctrl-click again', () => {
    const h = harness([{ itemId: commonId, count: 2 }]);
    clickCellFor(h.root, commonId, { ctrl: true });
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${commonId},2`]);
  });
});
