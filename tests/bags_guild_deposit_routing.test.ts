// @vitest-environment jsdom
// Behavioral pin for the GUILD-tab bag-click routing: drives the REAL
// BagsWindow (the bags_window_use_routing.test.ts fixture idiom) with
// isGuildBankTab true and asserts WHICH facet command a click actually
// invokes (guildBankDeposit with the reference-resolved index, never the
// personal bankDeposit) and which localized sim line each pipe deny shows.
// The source pins in bags_window.test.ts anchor the text; this proves the
// dispatch.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { guildBankPipeRefusal } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import { tSim } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

// Real merged-table ids per deny dimension (derived, never hardcoded).
const plainId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return !d.soulbound && !d.noMarketList && d.kind !== 'quest' && d.kind !== 'bag';
}) as string;
const questId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'quest') as string;
const soulboundId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;
const noMarketId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].noMarketList && !ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;

interface Harness {
  root: HTMLElement;
  calls: string[];
  errors: string[];
}

/** `guildTab` arms the guild deposit; `personalTab` arms the personal one.
 *  BOTH false is the guild pane's LOG view: a reading surface where neither
 *  grid is on screen, so a bag click must deposit nowhere. */
function harness(inventory: InvSlot[], guildTab: boolean, personalTab = !guildTab): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: string[] = [];
  const errors: string[] = [];
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankDeposit: (...a: unknown[]) => calls.push(`bankDeposit:${a.join(',')}`),
    guildBankDeposit: (...a: unknown[]) =>
      calls.push(`guildBankDeposit:${a.filter((x) => x !== undefined).join(',')}`),
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
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => true, // the bank window is open in every scenario
    isPersonalBankTab: () => personalTab,
    isGuildBankTab: () => guildTab,
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
  new BagsWindow(deps).render();
  return { root, calls, errors };
}

function clickCellFor(root: HTMLElement, itemId: string, shift = false): void {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('button.bag-item'));
  const cell = cells.find((c) => c.getAttribute('aria-label')?.includes(ITEMS[itemId].name));
  expect(cell, `no bag cell for ${itemId}`).toBeTruthy();
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: shift }));
}

describe('guild-tab bag click routing (behavioral, real BagsWindow)', () => {
  it('routes an allowed click to guildBankDeposit with the reference-resolved index, never bankDeposit', () => {
    const h = harness(
      [
        { itemId: questId, count: 1 },
        { itemId: plainId, count: 1 },
      ],
      true,
    );
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual(['guildBankDeposit:1']);
  });

  it('keeps routing to the PERSONAL bankDeposit while the Personal tab is active', () => {
    const h = harness([{ itemId: plainId, count: 1 }], false);
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual(['bankDeposit:0']);
  });

  it('routes to NEITHER bank while the guild pane shows its log', () => {
    // REGRESSION: the guild side was disarmed for the log view, but the
    // fallback (`isBankOpen() && !isGuildBankTab()`) then armed the PERSONAL
    // deposit, whose grid is off screen behind the guild pane too. A bag click
    // while reading the history silently banked the item either way.
    const h = harness([{ itemId: plainId, count: 1 }], false, false);
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([]); // and it is a no-op, not a refusal line
  });

  it('the shift split prompt submit sends guildBankDeposit(index, count)', () => {
    const h = harness([{ itemId: plainId, count: 5 }], true);
    clickCellFor(h.root, plainId, true);
    const prompt = document.querySelector('.bank-deposit-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    const input = prompt.querySelector('.prompt-number') as HTMLInputElement;
    input.value = '3';
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toEqual(['guildBankDeposit:0,3']);
  });

  it('each pipe deny voices its exact sim line and dispatches nothing', () => {
    const denies: Array<[string, string]> = [
      [questId, tSim('error.guildBankQuestItem')],
      [soulboundId, tSim('error.guildBankSoulbound')],
      [noMarketId, tSim('error.guildBankNoTransfer')],
    ];
    for (const [itemId, line] of denies) {
      const h = harness([{ itemId, count: 1 }], true);
      clickCellFor(h.root, itemId);
      expect(h.calls, itemId).toEqual([]);
      expect(h.errors, itemId).toEqual([line]);
    }
  });

  it('a transfer-locked copy denies with the no-transfer line and dispatches nothing', () => {
    const h = harness([{ itemId: plainId, count: 1, instance: { boundTo: 7 } }], true);
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([tSim('error.guildBankNoTransfer')]);
  });

  it('each pre-empt line IS the sim refusal wording (guildBankPipeRefusal cross-pin)', () => {
    // Key identity alone would pass with a reworded catalog row; the whole
    // point of pre-empting is voicing the EXACT line the sim would refuse
    // with, so pin each key's resolved text to the sim gate's own return.
    expect(tSim('error.guildBankQuestItem')).toBe(
      guildBankPipeRefusal({ itemId: questId, count: 1 }),
    );
    // and NOT the personal bank's line, the divergence this pin exists to catch.
    expect(tSim('error.bankQuestItem')).not.toBe(
      guildBankPipeRefusal({ itemId: questId, count: 1 }),
    );
    expect(tSim('error.guildBankSoulbound')).toBe(
      guildBankPipeRefusal({ itemId: soulboundId, count: 1 }),
    );
    expect(tSim('error.guildBankNoTransfer')).toBe(
      guildBankPipeRefusal({ itemId: noMarketId, count: 1 }),
    );
    expect(tSim('error.guildBankNoTransfer')).toBe(
      guildBankPipeRefusal({ itemId: plainId, count: 1, instance: { boundTo: 7 } }),
    );
  });
});
