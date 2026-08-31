// Pure view-core for the desktop Bank window (#bank), the per-character deposit
// box read off the IWorld bank mirror. DOM/Three/i18n-free: it maps the
// proximity-gated BankInfo snapshot (null away from a banker) to a flat render
// model the thin painter (bank_window.ts) draws, and decides the slot click
// action (a whole withdraw vs the shift split-stack prompt). Registered in
// UI_PURE_CORES; unit-tested against both Sim- and ClientWorld-shaped inputs in
// tests/bank_view.test.ts. Mirrors the bags_view / mailbox_view pure-core split.

// The deposit precheck consumes the WIRE-FED two-pool split (bankPoolsOf below,
// off BankInfo.generalCapacity/materialsCapacity), never a flat scalar and
// never a client-side re-derivation: the server computes the pools from the
// socket state, so the offline plan and the sim's own deposit gate read the
// same budget (phase 07 closed the generalOnlyPools flat-pool site here).
import type { PoolCapacity } from '../sim/bag_pools';
import { BANK_EXPANSION_SLOTS, moveBetweenContainers } from '../sim/bank';
import { storageRungSkuForLadderIndex } from '../sim/content/storage_charters';
import { isMaterialItem } from '../sim/material_taxonomy';
import { cloneInvSlot, type InvSlot, type ItemInstancePayload } from '../sim/types';
import type { BankInfo } from '../world_api';
import type { ItemLookup } from './bag_filter';
import { bagQualityKey, bagSlotsLineKey } from './bags_view';

/** The item facts the bank window needs from the item table: the quality tint
 *  for grid cells, plus the bag facts the socket row shows (slot count and
 *  which pool those slots feed). A miss (unknown id) is tolerated everywhere:
 *  'common' tint, zero slots, general pool. */
export type BankItemLookup = (itemId: string) =>
  | {
      quality?: string;
      kind?: string;
      bagSlots?: number;
      materialsOnly?: boolean;
    }
  | undefined;

/** One occupied bank cell. `slotIndex` is the index into BankInfo.slots and is
 *  the exact wire argument for bankDeposit/bankWithdraw (order is preserved, no
 *  sort/filter here; the window layer's search/sort, bank_filter.ts, keeps slotIndex intact). */
export interface BankSlotModel {
  slotIndex: number;
  itemId: string;
  count: number;
  showCount: boolean; // count > 1 (a lone item hides its "1")
  qualityKey: string; // item quality ?? 'common' (bagQualityKey semantics)
  /** Per-copy payload passthrough for the tooltip's instance lines (seal,
   *  enchanted marker, bonus stats, maker's mark). */
  instance?: ItemInstancePayload;
}

/** The header counter: occupied slots over the total budget, plus the two budget
 *  contributions the buy panel and tooltips surface. */
export interface BankCapacityModel {
  used: number;
  total: number;
  purchasedSlots: number;
  bonusSlots: number;
}

/** Near-full keys on the GENERAL pool fraction because every item can use the
 *  general pool, materials spill into it when the satchels fill, and purchased
 *  expansions grow it; with no satchels socketed it equals the naive overall
 *  fraction. */
export const BANK_NEAR_FULL_FRACTION = 0.85;

/** One pool of the capacity meter (Bank Storage phase 08). `fraction` is
 *  used / capacity UNCLAMPED (0 when capacity is 0): the tolerated
 *  over-capacity state is honest, so it may exceed 1; the painter clamps only
 *  the drawn width. */
export interface BankPoolMeter {
  used: number;
  capacity: number;
  fraction: number;
  over: boolean; // used > capacity
}

/** The footer capacity meter: the summed display pair the label shows, the two
 *  wire-fed pools (BankInfo's generalCapacity/materialsCapacity/generalUsed/
 *  materialsUsed, never a client-side re-derivation), whether the materials
 *  segment has anything to say, and the two state flags the painter maps to
 *  footer classes. */
export interface BankMeterModel {
  used: number;
  total: number;
  general: BankPoolMeter;
  materials: BankPoolMeter;
  showMaterials: boolean;
  nearFull: boolean;
  over: boolean; // used > total
}

function poolMeter(used: number, capacity: number): BankPoolMeter {
  return {
    used,
    capacity,
    fraction: capacity > 0 ? used / capacity : 0,
    over: used > capacity,
  };
}

/** The Claudium side of the SAME next rung the gold price buys (Bank Storage
 *  phase 13). Present ONLY when the tag must render; absence is the whole
 *  gating vocabulary, because there is no disabled Claudium tag anywhere. */
export interface BankBuyClaudiumModel {
  /** The price the SERVER sent on the owner-only bank wire
   *  (BankInfo.nextRungClaudiumPrice). Never derived from the gold price,
   *  never rounded, and never converted: no rate exists in this client. */
  cost: number;
  /** The service SKU id of this character's next unpurchased rung, resolved
   *  from the registry by ladder index (storageRungSkuForLadderIndex), never
   *  a `strongbox_rung_NN` literal. The server re-checks the ladder position
   *  and answers not_next_rung, so a client that ever named the wrong one is
   *  refused rather than charged. */
  skuId: string;
}
// NO affordability field, deliberately, and this is the second time the question
// has been asked. There is no "you cannot afford this" treatment on the Claudium
// tag by design: the server is the authority and answers insufficient_balance,
// which is the arm that hands off to the top-up window, and a client-side guess
// off a throttled launcher balance could only ever hide a purchase the player can
// actually make. Phase 13 shipped `affordable` and `shortfall` anyway; nothing in
// src/ ever read either, while an affordability term in the window's repaint
// signature forced whole-window rebuilds that changed zero pixels whenever a
// balance crossed the price. Both fields and that term were dropped in phase 13
// QA. If a treatment is ever wanted, guild_bank_window.ts's `gbank-buy-short` is
// the family precedent, and the field comes back WITH its painter.

/** The expand-slots panel: the next block's copper price (null once maxed), the
 *  block size, the maxed flag the painter disables the button on, and (phase 13)
 *  the optional Claudium side of the same rung. */
export interface BankBuySlotsModel {
  nextCost: number | null;
  blockSlots: number;
  maxed: boolean;
  /** ABSENT, never disabled, whenever any gate says no: see buildBankView. */
  claudium?: BankBuyClaudiumModel;
}

/** What the host knows that the wire does not, for the Claudium tag's gating
 *  (Bank Storage phase 13). Both platform facts arrive as INPUTS so this core
 *  imports neither src/client_origin.ts nor any net module: the same pure
 *  function has to answer for the offline Sim, the online client, and a test.
 *
 *  Omitting the argument entirely is the offline shape and suppresses the tag
 *  outright, which is why the offline browser world needs no second mechanism. */
export interface BankClaudiumInput {
  /** The Claudium economy hooks are attached: online, non-native, service
   *  reachable at attach time. False offline. */
  storeEnabled: boolean;
  /** This is a native (iOS/Android) build, where no Claudium surface ships
   *  until native billing exists. A native build suppresses the tag even when
   *  hooks somehow attached, so the platform rule is stated here rather than
   *  resting on the attach site alone. */
  nativeBuild: boolean;
}
// NO balance field either, and for the same reason as the dropped affordability
// above: the only thing the core could do with a balance is guess at
// affordability, and it deliberately does not. Keeping it would leave the
// throttled launcher balance wired into a pure core that never reads it.

/** The Claudium sub-model, or undefined when ANY gate says no. Four gates, each
 *  independently sufficient to suppress the tag:
 *   1. the host has no Claudium hooks (offline, or the service never attached);
 *   2. the build is native;
 *   3. the wire carried no price for the next rung (the NORMAL service-outage
 *      fallback, not an error: the button is simply gold-only);
 *   4. the ladder is maxed, so there is no next rung to sell.
 *  A fifth, structural one: the registry has no rung SKU at that ladder index. */
function buyClaudiumModel(
  info: BankInfo,
  input: BankClaudiumInput | undefined,
): BankBuyClaudiumModel | undefined {
  if (!input || !input.storeEnabled || input.nativeBuild) return undefined;
  const cost = info.nextRungClaudiumPrice;
  if (cost === undefined) return undefined;
  // The gold ladder's own maxed answer, reused verbatim: one ceiling, one
  // source. The server already omits the price at the ceiling, so this is the
  // belt to that suspenders and the arm a wire that ever disagreed lands on.
  if (info.nextExpansionCost === null) return undefined;
  // The SAME index expression the server joins its catalog on.
  const sku = storageRungSkuForLadderIndex(Math.floor(info.purchasedSlots / BANK_EXPANSION_SLOTS));
  if (!sku) return undefined;
  return { cost, skuId: sku.id };
}

/** One projected bonus-source row (from BankBonusSource): the stable id, the slots
 *  granted now vs when fully earned, the DERIVED earned flag (slots > 0), and the
 *  optional progress numbers (referral: qualified referees / cap). The painter maps
 *  a KNOWN id to a localized label + advert and SKIPS an unknown one, so a future
 *  source (X, Twitch) rides through this shape untouched. */
export interface BankBonusRowModel {
  id: string;
  slots: number;
  maxSlots: number;
  earned: boolean; // slots > 0
  count?: number;
  cap?: number;
}

/** The bonus-slots footer sub-model (the buy sub-model's sibling): whether any
 *  source rows are present (false offline, where bonusSources is always []), the
 *  total bonus slots the header advertises, and the per-source rows. */
export interface BankBonusModel {
  show: boolean; // rows present (online only)
  total: number; // info.bonusSlots
  rows: BankBonusRowModel[];
}

/** One cell of the bank's bag-socket row (Bank Storage phase 07). Sockets
 *  unlock IN ORDER, so only the first locked cell carries the wire's
 *  nextSocketCost; later locked cells advertise no price at all (prices come
 *  from the wire alone, never a client table: phase 09 makes them tunable). */
export type BankSocketCellModel =
  | { kind: 'locked'; socket: number; unlockCost: number | null }
  | { kind: 'empty'; socket: number }
  | {
      kind: 'filled';
      socket: number;
      itemId: string;
      /** The socketed bag's slot count (0 for an id this bundle predates). */
      slots: number;
      /** The slots-line key for the cell's aria and tooltip: the shared
       *  bagSlotsLineKey decision (a materials-only satchel names the
       *  materials pool, since that is what its slots actually buy), with the
       *  plain-bag line as the documented fallback for an id this bundle
       *  predates (bags_window's own ?? arm). ONE rule, never a re-derived
       *  materials boolean the painter would have to map back to a key. */
      slotsLineKey: 'itemUi.tooltip.bagSlots' | 'itemUi.tooltip.bagSlotsMaterials';
      qualityKey: string; // bagQualityKey semantics, like the grid cells
    };

/** The whole window model: 'away' when no banker is in reach (bankInfo null),
 *  else the populated grid + capacity + buy panel. */
export type BankViewModel =
  | { kind: 'away' }
  | {
      kind: 'bank';
      capacity: BankCapacityModel;
      meter: BankMeterModel;
      slots: BankSlotModel[];
      // Free cells to paint after the items. Over-capacity states (a legacy/tampered
      // save with used > total) clamp to 0, never a negative pad.
      emptyCells: number;
      empty: boolean; // no occupied slots
      buy: BankBuySlotsModel;
      bonus: BankBonusModel;
      // The bag-socket row, always exactly socketBags.length cells (4 at the
      // shipped BANK_BAG_SOCKETS; the length rides the wire, never a client
      // constant).
      sockets: BankSocketCellModel[];
    };

/** The wire-fed two-pool split the offline deposit precheck consumes. Reads the
 *  server-computed generalCapacity/materialsCapacity off BankInfo verbatim, so
 *  the client never re-derives pool math from socket contents and cannot drift
 *  from the sim's own deposit gate. */
export function bankPoolsOf(
  info: Pick<BankInfo, 'generalCapacity' | 'materialsCapacity'>,
): PoolCapacity {
  return { general: info.generalCapacity, materials: info.materialsCapacity };
}

/** True when a carried bag has somewhere to go RIGHT NOW: at least one
 *  unlocked socket is empty. The bags-side click ladder arms its socket action
 *  on this (a click with no open socket falls back to the plain deposit, so
 *  every click keeps a meaningful outcome). Tolerant of thin world fakes and
 *  pre-socket mirrors: a missing or malformed socket shape reads as false. */
export function hasOpenBankSocket(
  info: Pick<BankInfo, 'socketsUnlocked' | 'socketBags'> | null | undefined,
): boolean {
  if (!info || !Array.isArray(info.socketBags)) return false;
  const unlocked = typeof info.socketsUnlocked === 'number' ? info.socketsUnlocked : 0;
  for (let i = 0; i < unlocked && i < info.socketBags.length; i++) {
    if (info.socketBags[i] === null) return true;
  }
  return false;
}

/** Map the proximity-gated bank snapshot to the render model. `info` is null away
 *  from a banker (both worlds), which yields the 'away' state. Slot order and
 *  indices are preserved verbatim (search/sort lives in the window layer, bank_filter.ts). */
export function buildBankView(
  info: BankInfo | null,
  lookup: BankItemLookup,
  // Phase 13: what the host knows that the wire does not (hooks attached,
  // native build, last known balance). OMITTED is the offline shape and
  // suppresses the Claudium tag outright.
  claudium?: BankClaudiumInput,
): BankViewModel {
  if (!info) return { kind: 'away' };
  const used = info.slots.length;
  const total = info.capacity;
  const slots: BankSlotModel[] = info.slots.map((slot, slotIndex) => ({
    slotIndex,
    itemId: slot.itemId,
    count: slot.count,
    showCount: slot.count > 1,
    qualityKey: bagQualityKey(lookup(slot.itemId) ?? {}),
    instance: slot.instance,
  }));
  // The footer meter reads the WIRE pool four verbatim (the bankPoolsOf rule):
  // the server computes the split from the socket state, so the meter can
  // never disagree with the sim's own deposit gate. Fractions stay unclamped
  // (the tolerated over-capacity state is honest); near-full keys on the
  // GENERAL pool (see BANK_NEAR_FULL_FRACTION) so a bank whose satchels hide
  // a nearly-full general pool still warns before non-material deposits refuse.
  const general = poolMeter(info.generalUsed, info.generalCapacity);
  const materials = poolMeter(info.materialsUsed, info.materialsCapacity);
  const claudiumModel = buyClaudiumModel(info, claudium);
  return {
    kind: 'bank',
    capacity: {
      used,
      total,
      purchasedSlots: info.purchasedSlots,
      bonusSlots: info.bonusSlots,
    },
    meter: {
      used,
      total,
      general,
      materials,
      // The occupancy disjunct is DEFENSIVE, not a live scenario: today's
      // bankInfoFor clamps materialsUsed to the capacity (an unsocket
      // re-accounts stranded stacks to general), but the pool four are
      // server-computed, so a future reclassification stays renderable.
      showMaterials: info.materialsCapacity > 0 || info.materialsUsed > 0,
      nearFull: general.fraction >= BANK_NEAR_FULL_FRACTION,
      over: used > total,
    },
    slots,
    emptyCells: Math.max(0, total - used),
    empty: slots.length === 0,
    buy: {
      nextCost: info.nextExpansionCost,
      blockSlots: BANK_EXPANSION_SLOTS,
      maxed: info.nextExpansionCost === null,
      // Spread so the key is ABSENT rather than present-and-undefined when no
      // Claudium tag is offered: the painter's gate reads as one truthiness
      // check, and a model snapshot in a test says plainly that nothing was
      // offered instead of showing a hole where a price would go.
      ...(claudiumModel !== undefined ? { claudium: claudiumModel } : {}),
    },
    bonus: {
      // [] offline (bonusSources is always empty away from the online realm stamp),
      // so `show` hides the whole footer there. Earned is derived per row (slots > 0);
      // count/cap ride through verbatim for the referral progress readout.
      show: info.bonusSources.length > 0,
      total: info.bonusSlots,
      rows: info.bonusSources.map((s) => ({
        id: s.id,
        slots: s.slots,
        maxSlots: s.maxSlots,
        earned: s.slots > 0,
        count: s.count,
        cap: s.cap,
      })),
    },
    // The bag-socket row. Sockets unlock in order, so index < socketsUnlocked
    // is the unlocked prefix; only the FIRST locked cell offers the wire's
    // nextSocketCost (the price of exactly that unlock). A filled cell reads
    // its bag facts through the lookup: an id this bundle predates paints as
    // a zero-slot general bag rather than vanishing (the grid's R34 rule).
    sockets: info.socketBags.map((itemId, socket): BankSocketCellModel => {
      if (socket >= info.socketsUnlocked) {
        return {
          kind: 'locked',
          socket,
          unlockCost: socket === info.socketsUnlocked ? info.nextSocketCost : null,
        };
      }
      if (itemId === null) return { kind: 'empty', socket };
      const item = lookup(itemId);
      return {
        kind: 'filled',
        socket,
        itemId,
        slots: item?.kind === 'bag' ? (item.bagSlots ?? 0) : 0,
        slotsLineKey:
          (item?.kind !== undefined
            ? bagSlotsLineKey({
                kind: item.kind,
                bagSlots: item.bagSlots,
                materialsOnly: item.materialsOnly,
              })
            : null) ?? 'itemUi.tooltip.bagSlots',
        qualityKey: bagQualityKey(item ?? {}),
      };
    }),
  };
}

/** What a click on a bank slot does: a whole-stack withdraw, the split-stack
 *  prompt (shift on a multi-count fungible), or nothing (empty cell). The core
 *  never touches copper affordability: that is server-authoritative and the sim
 *  refuses with its own line. */
export type BankSlotAction =
  | { kind: 'withdraw'; slotIndex: number }
  | { kind: 'withdrawPartial'; slotIndex: number; max: number }
  | { kind: 'none' };

/** Decide the slot click. A shift-click on a multi-count stack opens the partial
 *  prompt, EXCEPT on an instanced slot: a per-instance payload (#1165) moves whole
 *  regardless of count (the sim never splits it), so shift falls through to a plain
 *  withdraw there. An undefined slot (empty cell) is a no-op. */
export function bankSlotAction(
  slot: InvSlot | undefined,
  slotIndex: number,
  shift: boolean,
): BankSlotAction {
  if (!slot) return { kind: 'none' };
  if (shift && slot.count > 1 && !slot.instance) {
    return { kind: 'withdrawPartial', slotIndex, max: slot.count };
  }
  return { kind: 'withdraw', slotIndex };
}

/** One planned deposit: the ORIGINAL inventory slot index plus the whole-stack count
 *  to send. `count` equals the source stack size (a whole-stack deposit); bankDeposit
 *  (slotIndex, count) with count === the live stack splices it out, exactly like an
 *  undefined count would. */
export interface DepositAllSend {
  slot: number;
  count: number;
}

/** The deposit-all-materials plan: the ordered whole-stack sends, how many stacks
 *  they move (=== sends.length), and whether the bank ran out of room for a material
 *  that did not fit (drives the "bank filled" summary variant). */
export interface DepositAllPlan {
  sends: DepositAllSend[];
  stacks: number;
  full: boolean;
}

/** Plan a "deposit all materials" run WITHOUT mutating the live world: it simulates
 *  each candidate deposit on deep clones using the sim's OWN moveBetweenContainers, so
 *  capacity + stacking + instanced-slot behavior is byte-identical to what the server
 *  resolves, then returns the ordered sends the caller replays via bankDeposit.
 *
 *  Selection: every fungible OR instanced honest-material stack (isMaterialItem, the
 *  derived taxonomy in src/sim/material_taxonomy.ts: node yields, grades, harvest
 *  components, specimens, salvage returns, junk-kind reagents), NEVER a quest item
 *  (kind-tool implements, grey trash, and trophies are excluded by the taxonomy; the
 *  quest guard here is the belt to that suspenders).
 *  Each send is a WHOLE-stack deposit (the sim's all-or-nothing rule): a stack that
 *  does not FULLY fit is skipped, not partially deposited, and sets `full`. Partial
 *  deposits would have to re-derive the sim's countFit stacking math, which this must
 *  never do; the sim's bankDeposit already refuses a whole-stack move that does not
 *  fully fit (moveBetweenContainers' countFit gate), so whole-stack-or-skip matches it
 *  exactly. Iteration is DESCENDING by index so each successful move's source splice
 *  only shifts indices ABOVE the one just removed (already processed): every recorded
 *  slot index stays valid when the caller replays the sends IN THIS ORDER against the
 *  live world.
 *
 *  ONLINE latency: the whole plan is computed against ONE snapshot (the inventory +
 *  bank at click time); the caller sends every command without re-reading state
 *  mid-run, because the ClientWorld mirror lags the authoritative world by ~1 tick. */
export function planDepositAllMaterials(
  inventory: readonly InvSlot[],
  bankSlots: readonly InvSlot[],
  // The socket-derived two-pool split, from the wire via bankPoolsOf (never a
  // flat scalar: with a materials satchel socketed, a flat budget would plan
  // deposits the sim's pool-aware gate refuses, or skip ones it would accept).
  pools: PoolCapacity,
  lookup: ItemLookup,
): DepositAllPlan {
  const invClone = inventory.map(cloneInvSlot);
  const bankClone = bankSlots.map(cloneInvSlot);
  const sends: DepositAllSend[] = [];
  let full = false;
  for (let i = invClone.length - 1; i >= 0; i--) {
    const slot = invClone[i];
    const item = lookup(slot.itemId);
    if (!item) continue; // unknown id: not a known material, leave it in the bags
    if (item.kind === 'quest') continue; // never bank quest items (the taxonomy also excludes them)
    if (!isMaterialItem(item)) continue;
    const count = slot.count;
    const result = moveBetweenContainers(invClone, i, count, bankClone, pools);
    if (result.refusal === 'no_fit') {
      full = true;
      continue; // the bank could not take this whole stack; a smaller one may still fit
    }
    if (result.refusal) continue; // 'invalid': malformed slot (should not happen); skip
    sends.push({ slot: i, count });
  }
  return { sends, stacks: sends.length, full };
}

/** The three deposit-all summary lines, as t() keys so the painter stays a thin
 *  consumer and the arm CHOICE is unit-pinned here rather than buried in DOM code. */
export type DepositAllSummaryKey =
  | 'hudChrome.bank.depositAllNone'
  | 'hudChrome.bank.depositAllFull'
  | 'hudChrome.bank.depositAllDone';

/** Which transient summary a finished deposit-all plan earns. Exactly one of three
 *  arms: no stack moved (materials existed, the button gates on
 *  hasDepositableMaterials, but none fit) -> depositAllNone; some moved but at least
 *  one did not fit -> depositAllFull; everything fit -> depositAllDone. */
export function depositAllSummaryKey(
  plan: Pick<DepositAllPlan, 'stacks' | 'full'>,
): DepositAllSummaryKey {
  if (plan.stacks === 0) return 'hudChrome.bank.depositAllNone';
  if (plan.full) return 'hudChrome.bank.depositAllFull';
  return 'hudChrome.bank.depositAllDone';
}

/** True when the carried inventory holds at least one depositable material stack (an
 *  honest material per isMaterialItem; tools, grey trash, trophies, and quest items
 *  are all outside the taxonomy): the deposit-all button's enabled state. */
export function hasDepositableMaterials(
  inventory: readonly InvSlot[],
  lookup: ItemLookup,
): boolean {
  return inventory.some((s) => {
    const item = lookup(s.itemId);
    return !!item && isMaterialItem(item);
  });
}
