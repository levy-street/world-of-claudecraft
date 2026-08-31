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
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { tSim } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

// Real merged-table ids, derived rather than hardcoded (the guild-deposit
// suite's own convention). A junk id (poor quality, plain sale is instant) and
// a common+ weapon id (needs confirmation) beside each other.
const junkId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return d.quality === 'poor' && d.kind !== 'quest' && !d.noVendorSell && !d.soulbound;
}) as string;
const valuableId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return d.kind === 'weapon' && d.quality !== 'poor' && !d.noVendorSell && !d.soulbound;
}) as string;
// A non-junk item that actually STACKS (quality above poor, no instance
// payload possible on a plain fungible stack), for the "can't sell full
// stacks" regression: unlike valuableId (a weapon, always count 1) this id
// can carry a slot count above 1.
const stackableValuableId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return (
    d.quality !== 'poor' &&
    d.kind !== 'quest' &&
    !d.noVendorSell &&
    !d.soulbound &&
    stackSizeOf(d) > 1
  );
}) as string;

interface Harness {
  root: HTMLElement;
  calls: string[];
  errors: string[];
}

function harness(inventory: InvSlot[], opts?: { confirmVendorSell?: boolean }): Harness {
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
    confirmVendorSell: () => opts?.confirmVendorSell ?? true,
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

function quantityPrompt(): HTMLElement | null {
  return document.querySelector('.sell-quantity-prompt');
}

function clickPromptConfirmButton(): void {
  const btn = confirmPrompt()?.querySelector('button.btn');
  expect(btn, 'no confirm button in the open prompt').toBeTruthy();
  (btn as HTMLElement).click();
}

function clickQuantityPromptConfirmButton(): void {
  const btn = quantityPrompt()?.querySelector('button.btn');
  expect(btn, 'no confirm button in the open quantity prompt').toBeTruthy();
  (btn as HTMLElement).click();
}

describe('vendor plain click: true junk still sells in one step', () => {
  it('sells instantly, no prompt, exactly the clicked slot', () => {
    const h = harness([{ itemId: junkId, count: 1 }]);
    clickCellFor(h.root, junkId);
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${junkId},{"slotIndex":0}`]);
  });
});

describe('vendor plain click on a non-junk item opens a confirm prompt instead of selling', () => {
  it('does not sell on click; opens exactly one .sell-confirm-prompt', () => {
    const h = harness([{ itemId: valuableId, count: 1 }]);
    clickCellFor(h.root, valuableId);
    expect(h.calls).toEqual([]);
    const prompt = confirmPrompt();
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain(ITEMS[valuableId].name);
  });

  it('a second click while the prompt is open does not stack a second prompt', () => {
    const h = harness([{ itemId: valuableId, count: 1 }]);
    clickCellFor(h.root, valuableId);
    clickCellFor(h.root, valuableId);
    expect(document.querySelectorAll('.sell-confirm-prompt')).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });

  it('Confirm sells exactly the named slot and Cancel sends nothing', () => {
    const h = harness([{ itemId: valuableId, count: 1 }]);
    clickCellFor(h.root, valuableId);
    const buttons = Array.from(confirmPrompt()?.querySelectorAll('button.btn') ?? []);
    expect(buttons, 'expected [Confirm, Cancel]').toHaveLength(2);
    (buttons[1] as HTMLElement).click();
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).toBeNull();

    clickCellFor(h.root, valuableId);
    clickPromptConfirmButton();
    expect(h.calls).toEqual([`sellItem:${valuableId},1,{"slotIndex":0}`]);
    expect(confirmPrompt()).toBeNull();
  });

  it('focus lands on the close button after a confirmed sale, not a detached cell', () => {
    const h = harness([{ itemId: valuableId, count: 1 }]);
    clickCellFor(h.root, valuableId);
    clickPromptConfirmButton();
    expect(document.activeElement).toBe(h.root.querySelector('[data-close]'));
  });

  it('a stale copy at confirm time REFUSES rather than vendoring a different copy of the id', () => {
    // The dialog names inventory[0] (the plain copy). Between open and confirm the
    // bags repaint under it (a trade, a mail send, a wire snapshot online): here
    // that copy leaves and only an ENCHANTED copy of the same id remains. Falling
    // back to an itemId-only sellItem call would vendor the enchanted copy the
    // dialog never named; the fix must refuse instead.
    const inventory: InvSlot[] = [{ itemId: valuableId, count: 1 }];
    const h = harness(inventory);
    clickCellFor(h.root, valuableId);
    expect(confirmPrompt()).not.toBeNull();
    // Simulate the repaint: the named slot is gone, an instanced copy sits alone.
    inventory.length = 0;
    inventory.push({ itemId: valuableId, count: 1, instance: { enchant: 'enchant_weapon_might' } });
    clickPromptConfirmButton();
    expect(h.calls, 'no sale was dispatched').toEqual([]);
    expect(h.errors).toEqual([tSim('error.noItem')]);
  });
});

describe('vendor ctrl/meta click on a non-junk item still confirms', () => {
  it('a single-count copy opens the same per-slot confirm prompt as a plain click', () => {
    const h = harness([{ itemId: valuableId, count: 1 }]);
    clickCellFor(h.root, valuableId, { ctrl: true });
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).not.toBeNull();
  });

  it('true junk still bulk-sells instantly on ctrl-click (unchanged)', () => {
    const h = harness([{ itemId: junkId, count: 3 }]);
    clickCellFor(h.root, junkId, { ctrl: true });
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${junkId},3`]);
  });
});

describe('vendor plain click on a non-junk STACK opens the bulk quantity prompt, not a 1-unit confirm', () => {
  // Regression: showSellConfirmPrompt never took a quantity, so a plain click
  // on anything short of true junk sold exactly one unit per confirmation,
  // and clearing an N-unit stack demanded N separate prompts. Mirrors what
  // ctrl-click already did for the same case.
  it('opens .sell-quantity-prompt, not .sell-confirm-prompt, and defaults to the FULL held count', () => {
    const h = harness([{ itemId: stackableValuableId, count: 5 }]);
    clickCellFor(h.root, stackableValuableId);
    expect(h.calls).toEqual([]);
    expect(confirmPrompt()).toBeNull();
    const prompt = quantityPrompt();
    expect(prompt).not.toBeNull();
    const input = prompt?.querySelector('input.prompt-number') as HTMLInputElement;
    expect(input.value).toBe('5');
    expect(input.max).toBe('5');
  });

  it('a single confirm click sells the whole stack in one action', () => {
    const h = harness([{ itemId: stackableValuableId, count: 5 }]);
    clickCellFor(h.root, stackableValuableId);
    clickQuantityPromptConfirmButton();
    expect(h.calls).toEqual([`sellItem:${stackableValuableId},5`]);
    expect(quantityPrompt()).toBeNull();
  });

  it('the quantity is still editable down to sell fewer', () => {
    const h = harness([{ itemId: stackableValuableId, count: 5 }]);
    clickCellFor(h.root, stackableValuableId);
    const input = quantityPrompt()?.querySelector('input.prompt-number') as HTMLInputElement;
    input.value = '2';
    clickQuantityPromptConfirmButton();
    expect(h.calls).toEqual([`sellItem:${stackableValuableId},2`]);
  });

  it('a single-count copy of the same item still opens the per-slot confirm prompt (unchanged)', () => {
    const h = harness([{ itemId: stackableValuableId, count: 1 }]);
    clickCellFor(h.root, stackableValuableId);
    expect(quantityPrompt()).toBeNull();
    expect(confirmPrompt()).not.toBeNull();
  });
});

describe('confirmVendorSell setting off: every vendor sale skips confirmation', () => {
  it('a plain click on a non-junk single item sells instantly, no prompt (matches junk)', () => {
    const h = harness([{ itemId: valuableId, count: 1 }], { confirmVendorSell: false });
    clickCellFor(h.root, valuableId);
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${valuableId},{"slotIndex":0}`]);
  });

  it('a plain click on a non-junk stack sells one unit instantly, no prompt (classic one-click sale)', () => {
    const h = harness([{ itemId: stackableValuableId, count: 5 }], { confirmVendorSell: false });
    clickCellFor(h.root, stackableValuableId);
    expect(quantityPrompt()).toBeNull();
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${stackableValuableId},{"slotIndex":0}`]);
  });

  it('a ctrl-click on a non-junk stack still bulk-sells the whole stack instantly', () => {
    const h = harness([{ itemId: stackableValuableId, count: 5 }], { confirmVendorSell: false });
    clickCellFor(h.root, stackableValuableId, { ctrl: true });
    expect(quantityPrompt()).toBeNull();
    expect(h.calls).toEqual([`sellItem:${stackableValuableId},5`]);
  });

  it('true junk is unaffected either way', () => {
    const h = harness([{ itemId: junkId, count: 1 }], { confirmVendorSell: false });
    clickCellFor(h.root, junkId);
    expect(h.calls).toEqual([`sellItem:${junkId},{"slotIndex":0}`]);
  });
});
