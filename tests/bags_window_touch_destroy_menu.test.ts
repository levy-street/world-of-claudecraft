// @vitest-environment happy-dom
// The touch HUD's Destroy row (the "I still can't drop an item out of my bag on
// mobile" report): on a phone the bags sheet covers the screen, so the
// drag-out-to-world gesture has no world to land on. A tap already opens the
// bag action menu there; this pins that the menu carries a Destroy row on the
// touch HUD only, gated by the same bagDestroyAction the drag reads, and that
// the row opens the bags' own destroy prompt (confirm + quantity), never
// destroying anything by itself. Drives the REAL BagsWindow against a happy-dom
// container (the bags_window_destroy_default_qty.test.ts fixture idiom).
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

interface MenuOpen {
  itemId: string;
  runDestroy: (() => void) | undefined;
}

function harness(
  inventory: InvSlot[],
  opts: { touch: boolean },
): { root: HTMLElement; opens: MenuOpen[]; discards: unknown[][]; errors: string[] } {
  document.body.innerHTML = '';
  const discards: unknown[][] = [];
  const errors: string[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    discardItem: (...args: unknown[]) => discards.push(args),
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const promptStack = document.createElement('div');
  promptStack.id = 'prompt-stack';
  document.body.appendChild(promptStack);
  const opens: MenuOpen[] = [];
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
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    sellConfirmPolicy: () => ({ enabled: true, minQualityRank: 1 }),
    isVaultBankTab: () => false,
    addItemToTrade: noop,
    tradeOfferHeadroom: () => 0,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: (msg: string) => errors.push(msg),
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => opts.touch,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: (
      _def,
      itemId,
      _target,
      _x,
      _y,
      _runDefault,
      _instance,
      _sellCount,
      _runSellAll,
      _materialSources,
      runDestroy,
    ) => {
      opens.push({ itemId, runDestroy });
    },
  };
  new BagsWindow(deps).render();
  return { root, opens, discards, errors };
}

function tapCell(root: HTMLElement, nth = 0): void {
  const cell = root.querySelectorAll('button.bag-item')[nth];
  expect(cell).toBeDefined();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
}
const tapFirstCell = (root: HTMLElement): void => tapCell(root);

function rightClickFirstCell(root: HTMLElement): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

describe('bags_window touch Destroy row', () => {
  it('a touch tap on a destroyable stack offers Destroy, which opens the destroy prompt', () => {
    const { root, opens, discards } = harness([{ itemId: 'linen_scrap', count: 7 }], {
      touch: true,
    });
    tapFirstCell(root);
    expect(opens).toHaveLength(1);
    const runDestroy = opens[0]?.runDestroy;
    expect(runDestroy).toBeTypeOf('function');
    runDestroy?.();
    const prompt = document.querySelector('#prompt-stack .discard-item-prompt');
    expect(prompt, 'Destroy must open the bags destroy prompt').not.toBeNull();
    // The prompt pre-fills the whole stack, the same default the drag opens with.
    expect(prompt?.querySelector<HTMLInputElement>('input.prompt-number')?.value).toBe('7');
    // Opening the prompt destroys nothing; only its confirm does.
    expect(discards).toHaveLength(0);
  });

  it('destroys exactly the tapped special copy, not its plain duplicate', () => {
    const inventory: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } },
    ];
    const { root, opens, discards } = harness(inventory, { touch: true });
    // The default Recent grid keeps bag order, so cell 1 is the signed copy.
    tapCell(root, 1);
    opens[0]?.runDestroy?.();
    const prompt = document.querySelector('#prompt-stack .discard-item-prompt');
    expect(prompt?.querySelector('input.prompt-number')).toBeNull();
    prompt?.querySelector<HTMLButtonElement>('button')?.click();
    expect(discards).toEqual([['worn_sword', 1, { slotIndex: 1 }]]);
  });

  it('refuses when the tapped copy left the bags while the menu was open', () => {
    const inventory: InvSlot[] = [{ itemId: 'linen_scrap', count: 7 }];
    const { root, opens, errors } = harness(inventory, { touch: true });
    tapFirstCell(root);
    inventory.splice(0, 1);
    opens[0]?.runDestroy?.();
    expect(document.querySelector('#prompt-stack .discard-item-prompt')).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('never offers Destroy on a noDiscard item (the drag refuses it too)', () => {
    const { root, opens } = harness([{ itemId: 'reins_valorsteed', count: 1 }], { touch: true });
    tapFirstCell(root);
    expect(opens).toHaveLength(1);
    expect(opens[0]?.runDestroy).toBeUndefined();
  });

  it('keeps the desktop right-click menu unchanged (the drag to the world stays its route)', () => {
    const { root, opens } = harness([{ itemId: 'linen_scrap', count: 7 }], { touch: false });
    rightClickFirstCell(root);
    expect(opens).toHaveLength(1);
    expect(opens[0]?.runDestroy).toBeUndefined();
  });
});
