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
import { type BagMode, bagItemAction } from '../src/ui/bags_view';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { t } from '../src/ui/i18n';
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

/** The exact BagMode the guild pane's Log view produces: the bank window OPEN
 *  with neither deposit target armed. Kept beside the harness so the pure-core
 *  cross-check below reads the same state the painter builds. */
const LOG_VIEW_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankOpen: true,
  bankDeposit: false,
  guildBankDeposit: false,
  petFeed: false,
};

/** `guildTab` arms the guild deposit; `personalTab` arms the personal one.
 *  Both false WITH `bankOpen` is the guild pane's LOG view: a reading surface
 *  where neither grid is on screen, so a bag click must deposit nowhere and
 *  must not fall through to using the item either. `bankOpen` false is the
 *  bank-closed control, where the plain use ladder is correct. */
function harness(
  inventory: InvSlot[],
  guildTab: boolean,
  personalTab = !guildTab,
  bankOpen = true,
): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const calls: string[] = [];
  const errors: string[] = [];
  // EVERY IWorld command the bags window can reach is stubbed, and every stub
  // RECORDS into the same `calls` log. That is deliberate on both counts.
  //
  // A partial fake plus `as unknown as IWorld` is how this suite shipped a red
  // test that read green: the ladder fell through to the un-stubbed useItem,
  // the click threw inside a jsdom listener, jsdom did not rethrow into the
  // test body, and `expect(calls).toEqual([])` passed because the handler died
  // before anything could be logged. Only vitest's unhandled-error exit code
  // caught it. Stubbing alone would have swapped that for a SILENT pass, which
  // is worse; recording every sink is what makes a fall-through show up as a
  // positive `useItem:...` entry instead of as absence. The list is the one
  // `grep -o "deps\.world()\.\w*" src/ui/bags_window.ts` produces.
  const sink =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(`${name}:${a.filter((x) => x !== undefined).join(',')}`);
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
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => bankOpen, // open in every scenario but the closed control
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

  it('routes to NEITHER bank while the guild pane shows its log, and does not use the item', () => {
    // REGRESSION 1: the guild side was disarmed for the log view, but the
    // fallback (`isBankOpen() && !isGuildBankTab()`) then armed the PERSONAL
    // deposit, whose grid is off screen behind the guild pane too. A bag click
    // while reading the history silently banked the item either way.
    //
    // REGRESSION 2 (PR #2812 review): disarming BOTH modes then let the click
    // fall out the bottom of the ladder into the plain use/equip default, so
    // the officer reading the log DRANK or EQUIPPED what they clicked. The
    // ladder now names that state (`bankDepositBlockedNoTarget`) above the use
    // rungs, and the click voices the refusal rather than going quiet.
    //
    // Decisive on both counts: the empty `calls` is load-bearing only because
    // every sink is stubbed and recording (see harness), so a fall-through
    // would read as `['useItem:...']` here rather than as a swallowed throw.
    // The `errors` assertion pins WHICH arm ran: neither a silent no-op nor a
    // fall-through can produce this line.
    const h = harness([{ itemId: plainId, count: 1 }], false, false);
    clickCellFor(h.root, plainId);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([t('hudChrome.bank.cannotDepositNow')]);
    // The pure core's own verdict, so the behavioral pin and the ladder cannot
    // drift: this is the arm the painter dispatched.
    expect(bagItemAction(ITEMS[plainId], LOG_VIEW_MODE)).toBe('bankDepositBlockedNoTarget');
  });

  it('a bag-kind and a mount-kind stack are equally refused on the log view', () => {
    // The three sinks below the bank rungs are DIFFERENT commands, so covering
    // only the plain 'use' item would leave equipBag reachable. A bag item is
    // the equipBag arm; a quest item is the destroy-prompt arm.
    const bagId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'bag') as string;
    expect(bagId, 'no bag-kind item in the merged table').toBeTruthy();
    for (const itemId of [bagId, questId]) {
      const h = harness([{ itemId, count: 1 }], false, false);
      clickCellFor(h.root, itemId);
      expect(h.calls, itemId).toEqual([]);
      expect(h.errors, itemId).toEqual([t('hudChrome.bank.cannotDepositNow')]);
      expect(document.querySelector('.prompt-panel'), itemId).toBeNull();
    }
  });

  it('the log-view refusal is the BANK rung, not a blanket refusal (positive controls)', () => {
    // Guards the mutation the other direction: an arm that refused everything
    // everywhere would satisfy the pins above. With the bank closed the same
    // click must still reach the use ladder, and each armed pane must deposit.
    const closed = harness([{ itemId: plainId, count: 1 }], false, false, false);
    clickCellFor(closed.root, plainId);
    expect(closed.calls).toEqual([`useItem:${plainId}`]);
    expect(closed.errors).toEqual([]);
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
