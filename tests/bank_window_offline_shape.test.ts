// @vitest-environment jsdom
// Drives the REAL BankWindow's deposit-all against a world double whose
// bankDeposit MUTATES the shared inventory array synchronously, the way the
// offline sim does.
//
// Why this lives in its own file: tests/bank_window.test.ts is a source-scrape
// suite with no DOM environment (it pins the painter's text, not its behavior),
// and tests/bank_view.test.ts owns the PURE planDepositAllMaterials arms, which
// call the core directly and so can never observe how the window sequences the
// plan against the send loop. This is the missing third altitude: the real
// window, a live-array world, one click.
//
// The contract under test is an ORDERING plus a NO-RE-READ rule, and it is only
// observable offline. src/ui/bank_window.ts onDepositAll builds the whole plan
// from ONE click-time snapshot and then replays every send without re-reading
// state. Offline, IWorld.inventory is the LIVE sim array and each bankDeposit
// splices the deposited stack out of it before the loop's next iteration; online
// the ClientWorld mirror is a snapshot that cannot move under the loop at all.
// So rebuilding the plan mid-loop, or re-reading world.inventory per send, is
// invisible in an online-shaped non-mutating spy and silently wrong in exactly
// one host: the recorded slot indices would then address stacks that had already
// shifted down, depositing the wrong items (and the summary would count the
// wrong number of stacks).
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import type { InvSlot } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld } from '../src/world_api';

// Distinct real honest materials, the tests/bank_view.test.ts fixture set (the
// old amber_hide / stag_antler pair is quality-poor grey trash the phase 19
// narrowing ruled out of the taxonomy), so each lands in its own bank slot.
const MATS = ['wolf_fang', 'rough_hide', 'spider_leg'] as const;
// A quest item: never bankable, so it is the stack that must survive the sweep
// and prove every splice hit the slot the plan actually named.
const QUEST = 'boar_hide';

function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
    ...over,
  };
}

// Exactly how many times ONE deposit-all click that sends something legitimately
// reads world.inventory. Derived from the real path (src/ui/bank_window.ts
// onDepositAll), not from what the rig happened to observe. There are two read
// SITES on the path and only one of them fires:
//   1. planDepositAllMaterials(world.inventory, ...): the ONE click-time snapshot
//      the whole plan is built from (bank_view.ts clones the array it is handed
//      and never reaches back out to the world). This is the counted read.
//   2. the render() the handler ends with, whose tools bar computes
//      `disabled = this.depositAllPending || !hasDepositableMaterials(world()
//      .inventory, ...)`. Any click that sent a stack has just armed the pending
//      guard, so the `||` short-circuits and the bags are never read. (open()'s
//      earlier render, with the guard down, DOES read them: hence the reset
//      below rather than an absolute count.)
// The send loop in between reads ZERO times: it replays the slot indices the plan
// recorded. A read here that is not the plan's IS the regression this arm exists
// for. If this ever fails at 2 with the sends unchanged, check whether one of the
// two sites moved before assuming a re-reading loop.
const CLICK_INVENTORY_READS = 1;

interface Harness {
  window: BankWindow;
  root: HTMLElement;
  world: {
    bankInfo: BankInfo | null;
    inventory: InvSlot[];
    /** Reassignable so this suite can install a MUTATING double. */
    bankDeposit: (slot: number, count: number) => void;
  };
  calls: string[];
  /**
   * The backing inventory array, reachable WITHOUT bumping the read counter: the
   * rig's own splices and post-state assertions must not pollute the count of
   * what production code read.
   */
  raw: () => InvSlot[];
  /** How many times PRODUCTION code has read `world.inventory`. */
  reads: { inventory: number };
}

function harness(): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const world = {
    bankInfo: bankInfo(),
    guildBankInfo: null,
    vaultInfo: null,
    inventory: [] as InvSlot[],
    bags: [null, null, null, null] as (string | null)[],
    copper: 100_000,
    player: { dead: false },
    bankDeposit: (slot: number, count: number) => calls.push(`bankDeposit:${slot},${count}`),
    bankWithdraw: (...a: unknown[]) => calls.push(`bankWithdraw:${a.join(',')}`),
    bankBuySlots: () => calls.push('bankBuySlots'),
  };
  // world.inventory is a COUNTING accessor, because the no-re-read half of the
  // contract is INVISIBLE to the call list alone: the plan sweeps DESCENDING, so
  // every splice the double performs sits ABOVE the indices still to be sent and
  // a per-send re-read of the shrinking array would emit byte-identical calls.
  // Counting the reads is the only thing that tells the two apart. Writes are
  // deliberately uncounted (the tests assign a fixture array), and the rig reads
  // the backing array through `raw()` so only production reads land here.
  let backing: InvSlot[] = world.inventory;
  const reads = { inventory: 0 };
  Object.defineProperty(world, 'inventory', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads.inventory++;
      return backing;
    },
    set: (next: InvSlot[]) => {
      backing = next;
    },
  });
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return {
    window: new BankWindow(deps),
    root,
    world,
    calls,
    raw: () => backing,
    reads,
  };
}

describe('bank deposit-all against a synchronously-mutating (offline-shaped) world', () => {
  it('confirms the fixtures still classify as the rig assumes', () => {
    // The whole rig rests on these: a fixture that quietly left the taxonomy (or
    // a quest item that stopped being one) would turn every assertion below into
    // a different, weaker test that still passed.
    for (const id of MATS) {
      expect(ITEMS[id], id).toBeDefined();
      expect(MATERIAL_ITEM_IDS.has(id), `${id} left the material taxonomy`).toBe(true);
    }
    expect(ITEMS[QUEST]?.kind, `${QUEST} is no longer a quest item`).toBe('quest');
    expect(MATERIAL_ITEM_IDS.has(QUEST)).toBe(false);
  });

  it('OFFLINE SHAPE: one click deposits the CLICK-TIME stacks at their click-time slots', () => {
    const h = harness();
    // Slot 1 is the quest item, so the plan's descending sweep yields sends
    // [3, 2, 0]: the interleaved skip is what makes a mid-loop re-read visible,
    // since a contiguous run would splice down to the same answer by luck.
    h.world.inventory = [
      { itemId: MATS[0], count: 3 },
      { itemId: QUEST, count: 1 },
      { itemId: MATS[1], count: 2 },
      { itemId: MATS[2], count: 5 },
    ];
    const spy = h.world.bankDeposit;
    h.world.bankDeposit = (slot, count) => {
      spy(slot, count);
      // The sim's own outcome: a whole-stack move splices the source slot out of
      // the LIVE array in place (a reassignment would not be the offline shape),
      // so every later index in the plan shifts unless the sends descend.
      // Through raw(), so the rig's own splice is not counted as a read.
      //
      // The double deliberately does NOT grow bankInfo.slots to match. That is
      // safe because the plan books capacity against its OWN click-time clone of
      // the bank (planDepositAllMaterials clones both containers), so the live
      // bank is never consulted again once the loop starts: leaving it empty
      // cannot flatter a sweep that this 24-slot rig could not fill anyway. Nor
      // does it leave the capacity accounting untested, since the capacity-2 rig
      // in the next arm is the counterfactual, and it reds both ways: under-book
      // the occupancy and it sends two stacks, re-derive the Full arm from
      // post-send state and the summary line changes.
      h.raw().splice(slot, 1);
    };
    h.window.open();
    // Count the CLICK alone: open()'s own render legitimately reads the bags
    // once, for the deposit-all button's enabled state.
    h.reads.inventory = 0;
    (h.root.querySelector('.bank-deposit-all') as HTMLElement).click();

    // Descending order, and each count is the whole stack (the sim's
    // all-or-nothing rule). A plan rebuilt or re-read mid-loop cannot produce
    // this sequence off a shrinking array.
    expect(h.calls).toEqual(['bankDeposit:3,5', 'bankDeposit:2,2', 'bankDeposit:0,3']);
    // ...and the half of the contract that sequence CANNOT see. Because the
    // sweep descends, a send loop that re-read world.inventory (or rebuilt the
    // plan) between sends would still emit exactly the calls above: each splice
    // lands above every index left to send, so nothing shifts under it. The read
    // COUNT is what separates the one-snapshot rule from a re-reading loop that
    // is right here by luck and wrong the moment the sweep is not descending.
    expect(h.reads.inventory).toBe(CLICK_INVENTORY_READS);
    // A consistency check, not the payoff: given the double splices exactly what
    // the call list says, this state is entailed by the assertion above. It earns
    // its place by stating the outcome in the player's terms (the quest item is
    // the one stack that survives a materials sweep).
    expect(h.raw().map((s) => s.itemId)).toEqual([QUEST]);
    // The payoff: the summary counts the click-time plan, not the drained array.
    // Nothing else here would notice a summary re-derived from post-send state,
    // which by then reads an inventory holding no materials at all.
    expect(h.root.querySelector('.bank-status')?.textContent).toBe('Materials deposited: 3.');
  });

  it('OFFLINE SHAPE: a bank that fills mid-sweep still summarizes the click-time plan', () => {
    // Capacity 2 with one slot already taken: exactly one material stack fits,
    // so the plan is partial and the summary must take the Full arm off the
    // PLAN. Re-deriving the arm from post-send state (an emptied-by-mutation
    // inventory) is the regression this arm closes.
    const h = harness();
    // generalCapacity moves WITH capacity: the planner consumes the wire's
    // two-pool split since phase 07 (bankPoolsOf), so a fixture that shrank
    // only the display total would leave the plan a 24-slot general budget.
    h.world.bankInfo = bankInfo({
      slots: [{ itemId: 'copper_ore', count: 1 }],
      capacity: 2,
      generalCapacity: 2,
    });
    h.world.inventory = [
      { itemId: MATS[0], count: 3 },
      { itemId: MATS[1], count: 2 },
    ];
    const spy = h.world.bankDeposit;
    h.world.bankDeposit = (slot, count) => {
      spy(slot, count);
      h.raw().splice(slot, 1);
    };
    h.window.open();
    (h.root.querySelector('.bank-deposit-all') as HTMLElement).click();

    // One send only, and it is the descending sweep's FIRST candidate.
    expect(h.calls).toEqual(['bankDeposit:1,2']);
    expect(h.raw().map((s) => s.itemId)).toEqual([MATS[0]]);
    expect(h.root.querySelector('.bank-status')?.textContent).toBe(
      'Materials deposited: 1. Bank now full.',
    );
  });
});
