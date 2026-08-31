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
import { itemCopyPin } from '../src/sim/item_copy_ref';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { tSim } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';
import { adoptedTrophyIds } from './helpers/adopted_trophy_ids';

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

interface Harness {
  root: HTMLElement;
  calls: string[];
  errors: string[];
  window: BagsWindow;
  /** The live array the fake world reads, so a case can shift the bags under an
   *  open prompt or a drag the way a snapshot does. */
  inventory: InvSlot[];
  /** Item ids the window asked to open the action menu for. */
  menuOpens: string[];
}

function harness(inventory: InvSlot[], opts?: { touch?: boolean; vendor?: boolean }): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: string[] = [];
  const errors: string[] = [];
  const menuOpens: string[] = [];
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
    vendorOpen: () => opts?.vendor !== false,
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
    isTouchHud: () => opts?.touch === true,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: (_def, itemId) => {
      menuOpens.push(itemId);
    },
  };
  const window_ = new BagsWindow(deps);
  window_.render();
  return { root, calls, errors, window: window_, inventory, menuOpens };
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

describe('vendor plain click: true junk still sells in one step', () => {
  it('sells instantly, no prompt, exactly the clicked slot', () => {
    const h = harness([{ itemId: junkId, count: 1 }]);
    clickCellFor(h.root, junkId);
    expect(confirmPrompt()).toBeNull();
    expect(h.calls).toEqual([
      `sellItem:${junkId},{"slotIndex":0,"anchor":{"ordinal":0,"count":1}}`,
    ]);
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
  it('the sale confirm names the COPY being sold, escaped, never only the def', () => {
    // The cell authority on the sell confirm (the round-3 frontend finding):
    // a promoted copy always lands here, and the prompt must carry its chosen
    // name, esc()'d at the innerHTML sink like every player-authored name.
    const h = harness([
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: '<b>Oath</b> of "Vel\'tara"' },
      },
    ]);
    // The cell's accessible name now carries the chosen name, not the def's,
    // so the one cell is clicked directly rather than found by def name.
    const cell = h.root.querySelector<HTMLElement>('button.bag-item');
    expect(cell?.getAttribute('aria-label')).toContain('<b>Oath</b> of "Vel\'tara"');
    cell?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true, cancelable: true }),
    );
    const text = confirmPrompt()?.querySelector('.prompt-text');
    expect(text?.textContent).toContain('<b>Oath</b> of "Vel\'tara"');
    expect(text?.innerHTML).toContain('&lt;b&gt;');
    expect(text?.querySelector('b')).toBeNull();
  });

  it('the world-drop destroy prompt names the DRAGGED copy, never whatever sits at its old index', () => {
    // The prompt resolves the dragged copy by its PIN against the live bags,
    // so a mid-drag shift moves the prompt with the copy instead of pointing it
    // at the cell the copy used to occupy.
    const named = { rolled: { quality: 'legendary' as const }, name: 'Dawn Oath' };
    const h = harness([
      { itemId: valuableId, count: 1, instance: named },
      { itemId: junkId, count: 1 },
    ]);
    const ref = { index: 0, copyPin: itemCopyPin(h.inventory[0]) };
    h.window.promptDestroy(valuableId, 1, ref);
    const first = document.querySelector('.discard-item-prompt .prompt-text');
    expect(first?.textContent).toContain('Dawn Oath');
    // Confirming destroys the copy the prompt NAMED, by target (the round-4
    // blocker: the untargeted walk prefers fungible copies and could spare
    // the named one while consuming an id-mate).
    (document.querySelector('.discard-item-prompt button.btn') as HTMLElement).click();
    expect(h.calls).toEqual([`discardItem:${valuableId},1,{"slotIndex":0}`]);
    h.calls.length = 0;
    document.querySelectorAll('.discard-item-prompt').forEach((el) => {
      el.remove();
    });
    // The dragged cell now holds a different id: the def name, not the copy's.
    h.window.promptDestroy(junkId, 1, { index: 0, copyPin: itemCopyPin(h.inventory[1]) });
    const shifted = document.querySelector('.discard-item-prompt .prompt-text');
    expect(shifted?.textContent).not.toContain('Dawn Oath');
    expect(shifted?.textContent).toContain(ITEMS[junkId].name);
  });

  it('a mid-drag shift cannot redirect the destroy to a DIFFERENT copy of the same id', () => {
    // THE regression the drag pin closes. Index 0 holds the named copy at
    // pick-up; a snapshot then swaps the two copies of that same id. An
    // index-plus-id check is satisfied by the cell (still that id), so the
    // prompt would title and destroy the WRONG copy. The pin follows the one
    // the player dragged to index 1.
    const inventory: InvSlot[] = [
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: 'Dawn Oath' },
      },
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: 'Veltara' },
      },
    ];
    const h = harness(inventory);
    const ref = { index: 0, copyPin: itemCopyPin(inventory[0]) };
    inventory.reverse();
    expect(inventory[ref.index].itemId).toBe(valuableId); // an id check would pass
    h.window.promptDestroy(valuableId, 1, ref);
    const text = document.querySelector('.discard-item-prompt .prompt-text');
    expect(text?.textContent).toContain('Dawn Oath');
    expect(text?.textContent).not.toContain('Veltara');
    (document.querySelector('.discard-item-prompt button.btn') as HTMLElement).click();
    expect(h.calls).toEqual([`discardItem:${valuableId},1,{"slotIndex":1}`]);
  });

  it('a dragged copy that left the bags falls back to the def, never an id-mate', () => {
    const inventory: InvSlot[] = [
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: 'Dawn Oath' },
      },
      { itemId: valuableId, count: 1 },
    ];
    const h = harness(inventory);
    const ref = { index: 0, copyPin: itemCopyPin(inventory[0]) };
    inventory.splice(0, 1); // the dragged copy is spent mid-drag
    h.window.promptDestroy(valuableId, 1, ref);
    const text = document.querySelector('.discard-item-prompt .prompt-text');
    // The plain id-mate is still held, so a fallback COULD have named it. The
    // prompt names the def instead and leaves the untargeted walk to answer.
    expect(text?.textContent).not.toContain('Dawn Oath');
    expect(text?.textContent).toContain(ITEMS[valuableId].name);
  });

  it('the destroy confirm follows its named copy to its live index and refuses when it is gone', () => {
    // Reference identity at submit (the sell-confirm precedent): a same-id
    // swap under the open prompt destroys the copy the prompt NAMED at its
    // new index; a vanished copy refuses, destroying nothing.
    const inventory: InvSlot[] = [
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: 'Dawn Oath' },
      },
      {
        itemId: valuableId,
        count: 1,
        instance: { rolled: { quality: 'legendary' }, name: 'Veltara' },
      },
    ];
    const h = harness(inventory);
    h.window.promptDestroy(valuableId, 1, { index: 0, copyPin: itemCopyPin(inventory[0]) });
    expect(document.querySelector('.discard-item-prompt .prompt-text')?.textContent).toContain(
      'Dawn Oath',
    );
    inventory.reverse();
    (document.querySelector('.discard-item-prompt button.btn') as HTMLElement).click();
    expect(h.calls).toEqual([`discardItem:${valuableId},1,{"slotIndex":1}`]);
    expect(h.errors).toEqual([]);
    h.calls.length = 0;
    h.window.promptDestroy(valuableId, 1, { index: 1, copyPin: itemCopyPin(inventory[1]) });
    expect(document.querySelector('.discard-item-prompt .prompt-text')?.textContent).toContain(
      'Dawn Oath',
    );
    inventory.length = 0;
    (document.querySelector('.discard-item-prompt button.btn') as HTMLElement).click();
    expect(h.calls).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

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

describe('vendor plain click on an adopted 11l trophy confirms like any common item', () => {
  it('opens the prompt with no sale, then Confirm sells exactly the named slot', () => {
    // The trophy economy promoted junk mob drops to common reagents, and the
    // plain-click gate reads quality, so the whole class now routes through
    // the confirm prompt instead of the one-step junk arm. Driven through the
    // REAL window for every id of the shared derivation, so a de-adopted
    // trophy (poor again) drops out of the loop rather than passing it.
    const adopted = adoptedTrophyIds(ITEMS);
    expect(adopted).toHaveLength(7);
    for (const trophyId of adopted) {
      const h = harness([{ itemId: trophyId, count: 1 }]);
      clickCellFor(h.root, trophyId);
      expect(h.calls, trophyId).toEqual([]);
      expect(confirmPrompt()?.textContent, trophyId).toContain(ITEMS[trophyId].name);
      clickPromptConfirmButton();
      expect(h.calls, trophyId).toEqual([`sellItem:${trophyId},1,{"slotIndex":0}`]);
      expect(confirmPrompt(), trophyId).toBeNull();
    }
  });

  it('the MOBILE sell route raises exactly ONE dialog, never a back-to-back pair', () => {
    // The de-duplication this pins is structural rather than a new branch: a
    // touch tap normally opens the item-action menu first (touch has no
    // right-click), which on top of the sell confirm would be two dialogs for
    // one sale. itemMenuAvailable's transactional-mode gate refuses the menu at
    // a vendor, so the tap runs the classic action directly and the ONE dialog
    // the player sees is the sell confirm, which names the copy.
    //
    // The pin is here rather than as a source read because the two halves sit
    // in different modules (the gate and the sell route) and only the flow
    // shows whether they compose: this counts what a tap actually raises.
    const trophyId = adoptedTrophyIds(ITEMS)[0];
    const h = harness([{ itemId: trophyId, count: 1 }], { touch: true });
    clickCellFor(h.root, trophyId);
    // No menu hop...
    expect(h.menuOpens).toEqual([]);
    // ...and exactly one modal, carrying the copy's own name.
    expect(document.querySelectorAll('.prompt.panel')).toHaveLength(1);
    expect(confirmPrompt()?.textContent).toContain(ITEMS[trophyId].name);
    expect(h.calls).toEqual([]);
    clickPromptConfirmButton();
    expect(h.calls).toEqual([`sellItem:${trophyId},1,{"slotIndex":0}`]);
    expect(document.querySelectorAll('.prompt.panel')).toHaveLength(0);
  });

  it('the same tap OUTSIDE a vendor DOES open the menu (the gate is what de-duplicates)', () => {
    // The control arm: without it the case above would pass on a window that
    // never opens the action menu on touch at all, which would be a different
    // bug and would make the de-duplication claim vacuous.
    const trophyId = adoptedTrophyIds(ITEMS)[0];
    const h = harness([{ itemId: trophyId, count: 1 }], { touch: true, vendor: false });
    clickCellFor(h.root, trophyId);
    expect(h.menuOpens).toEqual([trophyId]);
    expect(document.querySelectorAll('.prompt.panel')).toHaveLength(0);
  });
});
