// Personal-bank wire glue: the six bank command-case bodies, extracted from
// server/game.ts behind a narrow host interface (the vault_wire.ts seam:
// none of this needs GameServer's private state, and game.ts stays a thin
// consumer whose dispatch case group keeps a one-line call into this module).
//
// The three slot-bank bodies (deposit / withdraw / buy_slots) moved here
// VERBATIM in Bank Storage phase 07, paying for the three socket case labels
// the same phase adds: server/game.ts sits at a deliberate zero-margin
// monolith ceiling (tests/monolith_budget.test.ts), so new dispatch surface
// lands in a sibling and the ceiling is lowered, never raised.
//
// Shape-only checks here (the bank_* idiom): the Sim owns every gameplay rule
// (banker proximity, capacity, quest-bind, alive-state, exact copper, unlock
// order, the payload-free socket rule, the carried-side unsocket fit). NOTE
// the two senses of `slot` in this one family: on bank_deposit/bank_withdraw
// it is a BANK container index (with `count` optional), while on
// bank_socket_bag it is a CARRIED inventory index naming the exact copy (the
// equip_bag wire shape verbatim: `item` + optional integer `socket` +
// optional integer `slot`), so one client idiom covers both socket families.
//
// The live bank_ledger path reserves bounded outbox capacity before mutation,
// then derives the exact command batch by DIFFING bankInfoFor before and after.
// A refused/no-op call diffs empty and cancels its reservation. Undefined
// admission preserves the fire-and-forget recorder for isolated callers until
// every host supplies a character-owned outbox.
import { bankPurchasedSlotsFor } from '../src/sim/bank';
import type { BankInfo } from '../src/world_api';
import {
  buildBankSocketLedgerRows,
  buildPersonalBankLedgerRows,
  recordBankOp,
  recordBankSocketOp,
} from './bank_ledger';
import type { BankLedgerAdmission, BankLedgerAdmissionHandle } from './bank_ledger_admission';
import { bankVaultLedgerMaxRows } from './bank_vault_ledger_guard';
import { storagePurchaseInFlight } from './storage_purchases';
import { nextRungClaudiumPriceFor } from './storage_store_cache';

/** The slice of Sim the bank dispatch bodies call; a narrow host interface so
 *  a Vitest drives the bodies without a GameServer. bankSocketBag's third
 *  parameter is the pid arm of the Sim delegate's pid-or-target fold. `ctx`
 *  is the structural sliver of the public Sim.ctx the purchase-lock refusal
 *  line needs (the real SimContext satisfies it; a test hand-rolls it). */
export interface BankSim {
  ctx: {
    // `bank` is the ladder counter emitBankSelfKeys reads through the shared
    // sim helper; `entityId` is what the purchase-lock refusal line addresses.
    resolve(pid?: number): { meta: { entityId: number; bank: { purchasedSlots: number } } } | null;
    error(id: number, text: string): void;
  };
  bankInfoFor(pid: number): BankInfo | null;
  bankDeposit(slot: number, count?: number, pid?: number): void;
  bankWithdraw(slot: number, count?: number, pid?: number): void;
  bankBuySlots(pid?: number): void;
  bankUnlockSocket(pid?: number): void;
  bankSocketBag(itemId: string, socket?: number, pid?: number, slotIndex?: number): void;
  bankUnsocketBag(socket: number, pid?: number): void;
}

export type BankCommandName =
  | 'bank_deposit'
  | 'bank_withdraw'
  | 'bank_buy_slots'
  | 'bank_unlock_socket'
  | 'bank_socket_bag'
  | 'bank_unsocket_bag';

function refuseLedgerAdmission(sim: BankSim, pid: number): void {
  const entityId = sim.ctx.resolve(pid)?.meta.entityId;
  if (entityId !== undefined) sim.ctx.error(entityId, 'You are busy.');
}

/** Undefined preserves the temporary legacy observer path. Null means the
 *  live session has no admission owner and must refuse before mutation. */
function reserveLedgerRows(
  admission: BankLedgerAdmission | null | undefined,
  sim: BankSim,
  pid: number,
  command: BankCommandName,
): BankLedgerAdmissionHandle | null | undefined {
  if (admission === undefined) return undefined;
  const reservation = admission?.tryReserve(bankVaultLedgerMaxRows(command), 0, 'personal') ?? null;
  if (!reservation) refuseLedgerAdmission(sim, pid);
  return reservation;
}

function runReservedSimCall<T>(
  reservation: BankLedgerAdmissionHandle | undefined,
  readBefore: () => T,
  mutate: () => void,
): T {
  let before: T;
  try {
    before = readBefore();
  } catch (err) {
    reservation?.cancel();
    throw err;
  }
  try {
    mutate();
    return before;
  } catch (err) {
    // A throwing Sim command may have mutated before it failed. Its state is
    // therefore unprovable: keep capacity charged and synchronously tell the
    // host to quarantine rather than canceling evidence it may now require.
    reservation?.failAfterMutation(err);
    throw err;
  }
}

function finishReservedSimCall<T>(
  reservation: BankLedgerAdmissionHandle | undefined,
  finish: () => T,
): T {
  try {
    return finish();
  } catch (err) {
    // The Sim call returned, so after-snapshot, row projection, and outbox
    // serialization failures all happen after a possible mutation.
    reservation?.failAfterMutation(err);
    throw err;
  }
}

export function dispatchBankCommand(
  sim: BankSim,
  who: { characterId: number; accountId: number },
  cmd: BankCommandName,
  msg: Record<string, unknown>,
  pid: number,
  admission?: BankLedgerAdmission | null,
): void {
  switch (cmd) {
    case 'bank_deposit':
      if (typeof msg.slot === 'number') {
        const slot = msg.slot;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        const reservation = reserveLedgerRows(admission, sim, pid, 'bank_deposit');
        if (reservation === null) break;
        const before = runReservedSimCall(
          reservation,
          () => sim.bankInfoFor(pid),
          () => sim.bankDeposit(slot, count, pid),
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.bankInfoFor(pid);
          if (reservation)
            reservation.commit(buildPersonalBankLedgerRows('deposit', who, before, after));
          else recordBankOp('deposit', who, before, after);
        });
      }
      break;
    case 'bank_withdraw':
      if (typeof msg.slot === 'number') {
        const slot = msg.slot;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        const reservation = reserveLedgerRows(admission, sim, pid, 'bank_withdraw');
        if (reservation === null) break;
        const before = runReservedSimCall(
          reservation,
          () => sim.bankInfoFor(pid),
          () => sim.bankWithdraw(slot, count, pid),
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.bankInfoFor(pid);
          if (reservation)
            reservation.commit(buildPersonalBankLedgerRows('withdraw', who, before, after));
          else recordBankOp('withdraw', who, before, after);
        });
      }
      break;
    case 'bank_buy_slots': {
      // A Claudium storage purchase holds this character's purchase mutex
      // from initiation until slot application (server/storage_purchases.ts);
      // a gold rung landing inside that window is exactly the interleaved
      // ladder move the mutex exists to refuse, so the fit check the spend
      // already passed stays true at apply time.
      if (storagePurchaseInFlight(who.characterId)) {
        const entityId = sim.ctx.resolve(pid)?.meta.entityId;
        if (entityId !== undefined) {
          sim.ctx.error(entityId, 'Your bank has a purchase in progress.');
        }
        break;
      }
      const reservation = reserveLedgerRows(admission, sim, pid, 'bank_buy_slots');
      if (reservation === null) break;
      const before = runReservedSimCall(
        reservation,
        () => sim.bankInfoFor(pid),
        () => sim.bankBuySlots(pid),
      );
      finishReservedSimCall(reservation, () => {
        const after = sim.bankInfoFor(pid);
        // The gold rail stamps its paid-with dimension from the server-derived
        // path (never the request); the Claudium rail's twin row is written by
        // the purchase flow's apply site.
        if (reservation) {
          reservation.commit(
            buildPersonalBankLedgerRows('buy_slots', who, before, after, { paidWith: 'gold' }),
          );
        } else {
          recordBankOp('buy_slots', who, before, after, { paidWith: 'gold' });
        }
      });
      break;
    }
    // The socket trio (Bank Storage phase 07). One socket differ observes all
    // three: the sim mutates only what the command legitimately moves, so the
    // before/after socket diff IS the op record (a swap yields its two rows).
    case 'bank_unlock_socket': {
      // Argument-free like bank_buy_slots: the Sim charges the table price for
      // the next socket in order, or refuses without mutating anything.
      const reservation = reserveLedgerRows(admission, sim, pid, 'bank_unlock_socket');
      if (reservation === null) break;
      const before = runReservedSimCall(
        reservation,
        () => sim.bankInfoFor(pid),
        () => sim.bankUnlockSocket(pid),
      );
      finishReservedSimCall(reservation, () => {
        const after = sim.bankInfoFor(pid);
        if (reservation) reservation.commit(buildBankSocketLedgerRows(who, before, after));
        else recordBankSocketOp(who, before, after);
      });
      break;
    }
    case 'bank_socket_bag':
      if (typeof msg.item === 'string') {
        const itemId = msg.item;
        // The equip_bag gate shapes, verbatim: a present-but-malformed socket
        // or slot reads as undefined (first-empty scan / legacy newest-first
        // walk), never as index 0; the sim re-validates range and ownership.
        const socket =
          typeof msg.socket === 'number' && Number.isInteger(msg.socket) ? msg.socket : undefined;
        const slot = Number.isInteger(msg.slot) ? Number(msg.slot) : undefined;
        const reservation = reserveLedgerRows(admission, sim, pid, 'bank_socket_bag');
        if (reservation === null) break;
        const before = runReservedSimCall(
          reservation,
          () => sim.bankInfoFor(pid),
          () => sim.bankSocketBag(itemId, socket, pid, slot),
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.bankInfoFor(pid);
          if (reservation) reservation.commit(buildBankSocketLedgerRows(who, before, after));
          else recordBankSocketOp(who, before, after);
        });
      }
      break;
    case 'bank_unsocket_bag':
      if (typeof msg.socket === 'number' && Number.isInteger(msg.socket)) {
        const socket = msg.socket;
        const reservation = reserveLedgerRows(admission, sim, pid, 'bank_unsocket_bag');
        if (reservation === null) break;
        const before = runReservedSimCall(
          reservation,
          () => sim.bankInfoFor(pid),
          () => sim.bankUnsocketBag(socket, pid),
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.bankInfoFor(pid);
          if (reservation) reservation.commit(buildBankSocketLedgerRows(who, before, after));
          else recordBankSocketOp(who, before, after);
        });
      }
      break;
    default: {
      // Closes the union from this end too: a seventh BankCommandName member
      // whose case is missing here is a compile error, never a silent drop.
      const unhandled: never = cmd;
      throw new Error(`unhandled bank command: ${unhandled as string}`);
    }
  }
}

/** The owner-only bank snapshot the encoder sends (Bank Storage phase 11):
 *  the sim's proximity-gated readout, augmented server-side with the next
 *  rung's Claudium price from the cached service store, joined against THIS
 *  character's ladder position. Never on a broadcast snapshot: the caller is
 *  the per-session self block. The field is simply absent when the cache
 *  has no answer (service unreachable, ladder full, offline catalog), which
 *  is the graceful-degradation contract the client renders as gold alone. */
export function bankInfoForWire(
  sim: BankSim,
  session: { pid: number; accountId: number },
): BankInfo | null {
  const info = sim.bankInfoFor(session.pid);
  if (!info) return null;
  const price = nextRungClaudiumPriceFor(info.purchasedSlots, session.accountId);
  return price === undefined ? info : { ...info, nextRungClaudiumPrice: price };
}

/** Narrow snapshot host for the gated `bank` key: the cheap revision probe
 *  stays separate from the large projection it guards (the VaultSelfWireSim
 *  pattern). */
export interface BankSelfWireSim extends BankSim {
  bankInfoWireRevFor(pid: number): number | null;
}

/** The per-session trackers behind the `bank` gate (the VaultSelfWireSession
 *  twin). `lastBankWirePrice` keeps the last-emitted composed next-rung
 *  Claudium price: bankInfoForWire joins a SERVER-side store-cache price into
 *  the payload, so a price retune must re-emit even though no sim revision
 *  moved. */
export interface BankSelfWireSession {
  lastSent: Readonly<Record<string, string>>;
  lastBankWirePid: number | null;
  lastBankWireRev: number | null;
  lastBankWirePrice: number | null;
}

/** The bank family's two owner-only self-block keys, emitted through the
 *  caller's delta-eliding `maybe`. game.ts keeps a one-line call; the posture of
 *  each key is documented HERE, beside the emission, so a reader who changes one
 *  sees why the two are keyed differently.
 *
 *  - `bank` is null unless the player stands at a banker, so it only rides the
 *    wire for players browsing their deposit box (the mail pattern).
 *    REVISION-GATED (the `vault` twin): bankInfoFor walks the banker scan,
 *    pools, occupancy, and a full inventory clone, so the projection is built
 *    only when lastSent has no value, the anchor changed, the sim revision
 *    (bankInfoWireRevFor: null away from a banker, PlayerMeta.bankWireRev
 *    beside one) moved, or the composed next-rung Claudium price changed.
 *    Proximity and price are still probed every snapshot, so open/close stays
 *    immediate and the store cache keeps its refresh liveness.
 *    bankInfoForWire joins the cached next-rung Claudium price. Keyed on the
 *    ANCHOR session, so a spectating moderator sees the SPECTATED character's
 *    box, the posture every proximity-gated owner-only key shares.
 *  - `bpsl` is the ALWAYS-AVAILABLE ladder counter (Bank Storage phase 15,
 *    ruling 17). The Strongbox store opens anywhere and gates its charter list
 *    on it, so it cannot ride the proximity gate. Keyed on the VIEWING session
 *    rather than the anchor, and that is deliberate in both directions: this
 *    number decides what the VIEWER may buy with the VIEWER's own Claudium, and
 *    keying it on the anchor would let it move DOWN on a spectate enter, voiding
 *    the monotonicity the client's fit gate rests on (src/world_api/bank.ts).
 *    Still owner-only and self-block-only: it never enters the interest-scoped
 *    entity broadcast, and a viewer only ever receives their own.
 *
 *  Both ride the caller's delta elision: an unchanged value omits its key
 *  entirely, which the client reads as unchanged and never as absent.
 *
 *  WHY `bpsl` NEEDS NO GATE, and the condition under which it would. It is a
 *  SCALAR. `maybe` stringifies unconditionally, before its diff, so the
 *  build is two Map lookups and the stringify is free; the elision then keeps it
 *  off the wire entirely until the count moves. That is the opposite of `cvault`,
 *  whose BUILD is expensive in the common case, which is why cvault carries a
 *  (revision, gate-probe) signature (emitVaultSelfKeys, server/vault_wire.ts)
 *  that elides the projection while the pair holds. Widen this key to a
 *  record (a bonus-slot breakdown, a per-rung state, a price join like `bank`
 *  does) and the unconditional stringify stops being free: give it a
 *  signature of its own then, and not before. Any gate that DELAYS rather
 *  than elides would also delay the charter list after a purchase, which is
 *  the blindness ruling 17 exists to close.
 *
 *  PARAMETER ORDER IS LOAD-BEARING and only structurally typed: passing
 *  `anchorSession` in the `session` slot type-checks and would leak the
 *  SPECTATED character's count to a moderator's own store. There is exactly ONE
 *  server call site by design (game.ts), which also keeps the `emit` call site
 *  monomorphic on a 20 Hz path. The behaviour is pinned end to end by the
 *  "follows the VIEWER, not the spectate anchor" arm in tests/bank_wire.test.ts. */
export function emitBankSelfKeys(
  emit: (key: string, value: unknown) => void,
  sim: BankSelfWireSim,
  session: BankSelfWireSession & { pid: number },
  anchorSession: { pid: number; accountId: number },
): void {
  const rev = sim.bankInfoWireRevFor(anchorSession.pid);
  // The price probe is two Map reads plus the cache-refresh kick the 20 Hz
  // path always performed; bankInfoForWire recomputes it on the (rare) emit
  // pass, which keeps its signature and the graceful-degradation contract
  // unchanged.
  const price =
    rev === null
      ? null
      : (nextRungClaudiumPriceFor(
          bankPurchasedSlotsFor(sim.ctx, anchorSession.pid) ?? 0,
          anchorSession.accountId,
        ) ?? null);
  if (
    session.lastSent.bank === undefined ||
    anchorSession.pid !== session.lastBankWirePid ||
    rev !== session.lastBankWireRev ||
    price !== session.lastBankWirePrice
  ) {
    emit('bank', rev === null ? null : bankInfoForWire(sim, anchorSession));
    session.lastBankWirePid = anchorSession.pid;
    session.lastBankWireRev = rev;
    session.lastBankWirePrice = price;
  }
  // `bpsl` deliberately stays OUTSIDE the gate: it is a cheap scalar with its
  // own no-cadence rationale above, and it is keyed on the VIEWER while the
  // gate's trackers follow the ANCHOR, so folding it in would couple the
  // viewer's charter-fit counter to the spectated character's revisions.
  emit('bpsl', bankPurchasedSlotsFor(sim.ctx, session.pid));
}
