// @vitest-environment happy-dom
// Drives the real bags painter through the trade-mode click paths: a plain
// click on a splittable stack opens the offer-quantity prompt (the bank
// withdraw prompt's trade twin, built by the shared bank_quantity_prompt.ts,
// with the vault's whole-stack step pair around the unit pair) whose confirm
// stages the typed count through the same addItemToTrade dep; a single unit
// or an instanced copy stages directly, and shift-click keeps its chat link.
// The prompt re-resolves the LIVE headroom at submit and refuses (stages
// nothing) when the trade closed or the stack left the bags underneath it.
import { afterEach, describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

interface Harness {
  root: HTMLElement;
  staged: Array<{ itemId: string; count: number | undefined }>;
  links: string[];
  headroom: { value: number };
  tooltips: Array<() => string>;
}

function harness(inventory: InvSlot[], headroom: number): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const staged: Harness['staged'] = [];
  const links: string[] = [];
  const tooltips: Array<() => string> = [];
  const room = { value: headroom };
  const root = document.createElement('div');
  root.id = 'bags';
  root.innerHTML = '<button type="button" data-close>x</button>';
  document.body.appendChild(root);
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    questLog: new Map(),
    partyTradeMsRemaining: () => 0,
  } as unknown as IWorld;
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '<div class="tt-name">item</div>',
    attachTooltip: (_el, html) => {
      tooltips.push(html);
    },
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
    tradeOpen: () => true,
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
    addItemToTrade: (itemId, count) => staged.push({ itemId, count }),
    tradeOfferHeadroom: () => room.value,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: (itemId) => links.push(itemId),
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    sellConfirmPolicy: () => ({ enabled: true, minQualityRank: 1 }),
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  new BagsWindow(deps).render();
  return { root, staged, links, headroom: room, tooltips };
}

function clickFirstCell(root: HTMLElement, shiftKey: boolean): void {
  const cell = root.querySelector('button.bag-item');
  expect(cell).not.toBeNull();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
}

function prompt(): HTMLElement | null {
  return document.querySelector('#prompt-stack .trade-offer-prompt');
}

function submit(count: string): void {
  const p = prompt();
  expect(p).not.toBeNull();
  const input = p?.querySelector<HTMLInputElement>('input.prompt-number');
  expect(input).not.toBeNull();
  if (input) input.value = count;
  // The shared dialog recipe restyles EVERY button in the prompt (the step
  // buttons included), so the confirm is the prompt's own first direct-child
  // button, not the first red one.
  const confirm = p?.querySelector<HTMLButtonElement>(':scope > button.ui-btn--red');
  expect(confirm).not.toBeNull();
  confirm?.click();
}

const HIDE: InvSlot = { itemId: 'linen_scrap', count: 20 };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bags trade-mode offer quantity', () => {
  it('a plain click on a splittable stack opens the prompt instead of staging', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    expect(prompt()).not.toBeNull();
    expect(h.staged).toEqual([]);
    expect(h.links).toEqual([]);
    // The shared builder seeds the input at 1 and caps it at the headroom.
    const input = prompt()?.querySelector<HTMLInputElement>('input.prompt-number');
    expect(input?.value).toBe('1');
    expect(input?.max).toBe('20');
    // The bags root is inert behind the modal prompt (the shared recipe).
    expect(h.root.hasAttribute('inert')).toBe(true);
  });

  it('carries the vault-style step buttons: a unit pair inside a whole-stack pair', () => {
    const h = harness([HIDE], 45);
    clickFirstCell(h.root, false);
    const p = prompt();
    const steps = [...(p?.querySelectorAll<HTMLButtonElement>('.prompt-steps button') ?? [])];
    // Reading order: -stack, -1, (input), +1, +stack; the big pair carries the
    // item's OWN stack size (stackSizeOf, the sim's rule), which for linen
    // scrap is the 20 the arithmetic below steps by.
    const size = stackSizeOf(ITEMS.linen_scrap);
    expect(size).toBe(20);
    expect(steps.map((b) => b.textContent)).toEqual([`-${size}`, '−', '+', `+${size}`]);
    expect(steps.map((b) => b.classList.contains('prompt-step-big'))).toEqual([
      true,
      false,
      false,
      true,
    ]);
    const input = p?.querySelector<HTMLInputElement>('input.prompt-number');
    // Seeded at the floor: both down buttons start disabled.
    expect(steps[0].disabled).toBe(true);
    expect(steps[1].disabled).toBe(true);
    steps[3].click();
    expect(input?.value).toBe('21');
    steps[2].click();
    expect(input?.value).toBe('22');
    steps[3].click();
    expect(input?.value).toBe('42');
    // The last big press clamps onto the bound and the up pair disables there.
    steps[3].click();
    expect(input?.value).toBe('45');
    expect(steps[2].disabled).toBe(true);
    expect(steps[3].disabled).toBe(true);
    steps[1].click();
    expect(input?.value).toBe('44');
    steps[0].click();
    expect(input?.value).toBe('24');
  });

  it('confirming stages the typed count through addItemToTrade and closes', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    submit('12');
    expect(h.staged).toEqual([{ itemId: 'linen_scrap', count: 12 }]);
    expect(prompt()).toBeNull();
    expect(h.root.hasAttribute('inert')).toBe(false);
  });

  it('Offer all stages the whole ceiling in one press', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    const all = [...(prompt()?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])];
    expect(all.map((b) => b.textContent)).toEqual(['Offer', 'Offer all', 'Cancel']);
    all[1].click();
    expect(h.staged).toEqual([{ itemId: 'linen_scrap', count: 20 }]);
    expect(prompt()).toBeNull();
  });

  it('Offer all still clamps to the LIVE headroom at submit', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    h.headroom.value = 9;
    const all = prompt()?.querySelectorAll<HTMLButtonElement>(':scope > button')[1];
    all?.click();
    expect(h.staged).toEqual([{ itemId: 'linen_scrap', count: 9 }]);
  });

  it('clamps a typed count above the LIVE headroom at submit', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    // The offer grew under the prompt (a plain click on another copy): only
    // 7 more fit now, whatever the input's max said when it opened.
    h.headroom.value = 7;
    submit('50');
    expect(h.staged).toEqual([{ itemId: 'linen_scrap', count: 7 }]);
  });

  it('refuses a stale prompt (no room left at submit) without staging', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    h.headroom.value = 0;
    submit('5');
    expect(h.staged).toEqual([]);
    expect(prompt()).toBeNull();
    expect(h.root.hasAttribute('inert')).toBe(false);
  });

  it('a click with room for only one unit just stages it (no prompt)', () => {
    const h = harness([HIDE], 1);
    clickFirstCell(h.root, false);
    expect(prompt()).toBeNull();
    expect(h.staged).toEqual([{ itemId: 'linen_scrap', count: undefined }]);
  });

  it('a click on an instanced copy stages it as itself (no prompt)', () => {
    const h = harness([{ itemId: 'worn_sword', count: 1, instance: { enchant: 'x' } as never }], 3);
    clickFirstCell(h.root, false);
    expect(prompt()).toBeNull();
    expect(h.staged).toEqual([{ itemId: 'worn_sword', count: undefined }]);
  });

  it('shift-click keeps the chat link and opens no prompt', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, true);
    expect(prompt()).toBeNull();
    expect(h.staged).toEqual([]);
    expect(h.links).toEqual(['linen_scrap']);
  });

  it('the tooltip says the click will ask for a quantity, only where the prompt opens', () => {
    const hint = 'You will be asked how many to offer';
    // The bag slots register tooltips too; the item row's is the one that
    // wraps the (faked) item tooltip body.
    const rowTooltip = (h: Harness): string => {
      const html = h.tooltips.map((f) => f()).find((t) => t.includes('class="tt-name"'));
      expect(html).toBeDefined();
      return html ?? '';
    };
    expect(rowTooltip(harness([HIDE], 20))).toContain(hint);
    // One unit of room: the click stages directly, so no hint line.
    expect(rowTooltip(harness([HIDE], 1))).not.toContain(hint);
    // An instanced copy stages as itself whatever the room.
    expect(
      rowTooltip(
        harness([{ itemId: 'worn_sword', count: 1, instance: { enchant: 'x' } as never }], 3),
      ),
    ).not.toContain(hint);
  });

  it('cancel closes the prompt and stages nothing', () => {
    const h = harness([HIDE], 20);
    clickFirstCell(h.root, false);
    // Cancel is the last of the prompt's own action buttons (Offer, Offer all, Cancel).
    const cancel = [...(prompt()?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])].at(
      -1,
    );
    expect(cancel?.textContent).toBe('Cancel');
    cancel?.click();
    expect(prompt()).toBeNull();
    expect(h.staged).toEqual([]);
    expect(h.root.hasAttribute('inert')).toBe(false);
  });
});
