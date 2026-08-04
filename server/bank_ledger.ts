// Bank ledger: an OBSERVER of the sim's bank ops, never an authority. The sim bank
// methods (bankDeposit / bankWithdraw / bankBuySlots) return void and emit no
// success event by design (the ledger stays server-only, src/sim untouched), so the dispatch
// site detects success by diffing the public read Sim.bankInfoFor(pid) BEFORE and
// AFTER each call. A successful deposit/withdraw always changes the bank slot
// multiset; a successful buy_slots always increases purchasedSlots (its price is
// exactly the BEFORE snapshot's nextExpansionCost); a refused/no-op call changes
// nothing, so an empty diff writes no row. bankInfoFor returns null away from a
// banker, so a null on either side is also a no-op.
//
// diffBankOp is PURE (unit-tested directly). recordBankOp turns each diff element
// into a fire-and-forget insert chained onto a per-process FIFO promise tail: the
// game loop NEVER awaits it, a rejected insert logs and never blocks or reorders
// anything, and the observer can never throw into the caller. A character lives on
// one realm process, so the FIFO preserves that character's op order.

import type { BankInfo, GuildBankInfo, GuildBankLogOp } from '../src/world_api';
import { insertBankLedgerRow } from './db';
import { bustGuildBankLog, GUILD_BANK_LOG_VISIBLE_OPS } from './guild_bank_log';
import { gameMetricsCounters } from './http/game_signals';
import { REALM } from './realm';

export type BankLedgerOp = 'deposit' | 'withdraw' | 'buy_slots';

// One row's worth of diff. A deposit/withdraw op yields one element per changed
// item key; a buy_slots op yields one element with item fields null.
export interface BankOpDelta {
  itemId: string | null;
  count: number | null;
  instance: unknown;
  // The moved slot's craft provenance, carried so the guild revert path
  // (Sim.revertGuildBankDeltas, Guild Bank Phase 3 QA) can restore a reverted
  // withdraw byte-identically. Not persisted to bank_ledger (insertBankLedgerRow
  // picks its columns explicitly); absent on personal rows and copper-only rows.
  craftedRecipeId?: string | null;
  copperDelta: number;
  // The book's ladder position BEFORE the op. Not persisted (the ledger
  // columns are picked explicitly), and set only on the GUILD path: the guild
  // escrow log records slot ops ABSOLUTELY ("this op moved the ladder from
  // before to after"), which is what makes the forward replay idempotent and
  // the inverse a compare-and-swap. The personal bank's rows never feed a
  // replay, so they leave it absent.
  purchasedSlotsBefore?: number;
  purchasedSlotsAfter: number;
  // The COUNTERPARTY side (server/guild_bank_counterparty.ts): signed copper
  // and signed item count the ACTING CHARACTER'S purse and bags moved under
  // this op, from the same before/after snapshot pair the container side above
  // comes from. Set by the dispatch observer AFTER the diff (the differ sees
  // only the book), persisted to bank_ledger, and never part of the escrow
  // replay: the guild path always stamps a number, the personal path leaves
  // both absent, and absent means NOT RECORDED, never zero.
  counterpartyCopperDelta?: number | null;
  counterpartyCount?: number | null;
}

type BankSlot = BankInfo['slots'][number];

// A multiset key over an item slot: the itemId plus a stable serialization of the
// per-instance payload (null when absent). before/after slots come from the same
// bankInfoFor clone path microseconds apart, so JSON.stringify key order is stable
// across the pair and equal payloads serialize identically. Instanced items each
// keep their own key, so a signed/bound copy never merges with a plain stack.
function slotKey(slot: BankSlot): string {
  return JSON.stringify([slot.itemId, slot.instance ?? null]);
}

// Sum per-slot counts by key within one snapshot, keeping a representative slot for
// its itemId/instance. Fungible stacks never split, so a key is normally one slot;
// summing keeps the diff honest if the same key ever appears twice.
function countByKey(slots: BankSlot[]): Map<string, { slot: BankSlot; count: number }> {
  const m = new Map<string, { slot: BankSlot; count: number }>();
  for (const slot of slots) {
    const key = slotKey(slot);
    const existing = m.get(key);
    if (existing) existing.count += slot.count;
    else m.set(key, { slot, count: slot.count });
  }
  return m;
}

// Observe success by diffing the before/after bankInfo snapshots. Returns the
// ledger elements a successful op produced (deposit/withdraw: one per changed item
// key; buy_slots: one purchase row); an empty array means refused / no-op / away
// from a banker, so no row is written.
export function diffBankOp(
  op: BankLedgerOp,
  before: BankInfo | null,
  after: BankInfo | null,
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'buy_slots') {
    if (after.purchasedSlots <= before.purchasedSlots) return [];
    // The price is exactly the BEFORE snapshot's nextExpansionCost (non-null by
    // construction on a real purchase); guard a null defensively as 0.
    const price = before.nextExpansionCost ?? 0;
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -price,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  const beforeCounts = countByKey(before.slots);
  const afterCounts = countByKey(after.slots);
  const keys = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  const out: BankOpDelta[] = [];
  for (const key of keys) {
    const b = beforeCounts.get(key)?.count ?? 0;
    const a = afterCounts.get(key)?.count ?? 0;
    const delta = a - b;
    // A deposit takes keys the bank GAINED (after > before); a withdraw takes keys
    // it LOST (before > after). A single-slot op changes exactly one key in
    // practice (pinned by test); the array keeps the writer honest if that breaks.
    if (op === 'deposit' && delta > 0) {
      const slot = afterCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: delta,
        instance: slot.instance ?? null,
        copperDelta: 0,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    } else if (op === 'withdraw' && delta < 0) {
      const slot = beforeCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: -delta,
        instance: slot.instance ?? null,
        copperDelta: 0,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    }
  }
  return out;
}

// Per-process FIFO tail. Each insert chains onto it so a character's op rows land
// in order; a rejected insert is caught (logged) and the chain continues.
let tail: Promise<void> = Promise.resolve();

// Log budget for the unstamped-delta detector below. The metric counts every
// occurrence; the log prints the first few and then stops, so a write site that
// forgot to stamp cannot flood a process's stderr for its whole uptime.
const UNSTAMPED_LOG_LIMIT = 5;
let unstampedLogged = 0;

// Record a successful bank op fire-and-forget. Computes the diff and enqueues one
// insert per element onto the FIFO tail. Returns void immediately (never a promise,
// never awaited by the game loop); the whole body is guarded so it can never throw
// into the caller and gameplay never depends on the write landing.
export function recordBankOp(
  op: BankLedgerOp,
  who: { characterId: number; accountId: number },
  before: BankInfo | null,
  after: BankInfo | null,
): void {
  try {
    for (const delta of diffBankOp(op, before, after)) {
      tail = tail
        .then(() =>
          insertBankLedgerRow({
            realm: REALM,
            characterId: who.characterId,
            accountId: who.accountId,
            op,
            itemId: delta.itemId,
            count: delta.count,
            instance: delta.instance,
            copperDelta: delta.copperDelta,
            purchasedSlotsAfter: delta.purchasedSlotsAfter,
            container: 'personal',
            containerId: null,
          }),
        )
        .catch((err) => {
          console.error('bank_ledger write failed:', err);
        });
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('bank_ledger recordBankOp failed:', err);
  }
}

// The current FIFO tail, for tests to await the queue draining deterministically.
export function bankLedgerIdle(): Promise<void> {
  return tail;
}

// ---------------------------------------------------------------------------
// Guild bank rows (Guild Bank Phase 3). Same observer discipline as the
// personal bank above: the sim ops return void and emit no success event, so
// the dispatch site diffs Sim.guildBankInfoFor(pid) BEFORE and AFTER each op.
// Rows write container='guild' with container_id = guild id into the SAME
// bank_ledger table; the two gold ops record the TREASURY's copper delta
// (positive on deposit_gold, negative on withdraw_gold), buy_slots the
// negated table price the treasury paid, and item ops carry no copper, so a
// guild's treasury-moving copper deltas replay to its live treasury (the
// audit script's conservation check). Two ops moved PURSE copper and are
// excluded from that replay: create_fee (the founder's fee, the one row with
// no diff, written by the guild_create success arm) and open_bank (ladder
// rung 0, the officer's purse opening the item store).
// The dispatch site needs the diff itself (a non-empty diff marks the book
// dirty for the escrow save), so the differ is exported pure and the recorder
// takes the computed deltas; both share the personal FIFO tail, preserving a
// character's cross-container op order.
// ---------------------------------------------------------------------------

export type GuildBankLedgerOp =
  | 'deposit_gold'
  | 'withdraw_gold'
  | 'deposit'
  | 'withdraw'
  | 'buy_slots'
  | 'open_bank'
  // The operator escape hatch (src/sim/guild_bank.ts purgeDormantGuildBankSlot):
  // one DORMANT slot removed from a guild's book. Its own op name so the audit
  // replay accounts for the removal instead of reading it as an unexplained
  // shortfall, and so an operator can find every purge with one WHERE clause.
  | 'admin_purge';

// The guild multiset key: itemId + instance payload + craft provenance. The
// third dimension exists because guild deltas feed the revert path
// (Sim.revertGuildBankDeltas), which must restore the exact copy; the
// personal slotKey deliberately keeps its two dimensions (its rows never
// feed a revert).
function guildSlotKey(slot: BankSlot): string {
  return JSON.stringify([slot.itemId, slot.instance ?? null, slot.craftedRecipeId ?? null]);
}

function countByGuildKey(slots: BankSlot[]): Map<string, { slot: BankSlot; count: number }> {
  const m = new Map<string, { slot: BankSlot; count: number }>();
  for (const slot of slots) {
    const key = guildSlotKey(slot);
    const existing = m.get(key);
    if (existing) existing.count += slot.count;
    else m.set(key, { slot, count: slot.count });
  }
  return m;
}

// Observe a guild bank op's outcome by diffing the before/after
// guildBankInfoFor snapshots. Empty means refused / no-op (nothing to record,
// nothing dirty). A successful op always has non-null snapshots on both sides
// (the op itself requires the banker, rank, and book the read gates on), so a
// null on either side is a refusal by construction. A refused (projected)
// slot's key is stable across the pair: the pipe policy refuses it in both
// directions, so it can never move, and equal payloads project identically.
export function diffGuildBankOp(
  op: GuildBankLedgerOp,
  before: GuildBankInfo | null,
  after: GuildBankInfo | null,
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'deposit_gold' || op === 'withdraw_gold') {
    const delta = after.treasury - before.treasury;
    if (op === 'deposit_gold' && delta <= 0) return [];
    if (op === 'withdraw_gold' && delta >= 0) return [];
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: delta,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  if (op === 'buy_slots' || op === 'open_bank') {
    if (after.purchasedSlots <= before.purchasedSlots) return [];
    // The payer covered exactly the BEFORE snapshot's next table price
    // (non-null by construction on a real purchase); guard null as 0.
    // buy_slots moved TREASURY copper; open_bank (rung 0) moved the acting
    // officer's PURSE, so the audit's treasury replay excludes it like
    // create_fee.
    const price = before.nextExpansionPrice ?? 0;
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -price,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  // Item ops: the personal-bank multiset diff over the book's slots, keyed
  // with craftedRecipeId as a THIRD dimension (the personal slotKey has two):
  // the guild deltas carry craftedRecipeId so the revert path can restore a
  // reverted withdraw byte-identically, and a two-dimension key would collapse
  // a crafted and a plain copy of the same item into one key and record
  // whichever slot's provenance came first, minting or destroying
  // disenchant-gate provenance on revert (the Phase 3 QA architecture
  // finding).
  const beforeCounts = countByGuildKey(before.slots);
  const afterCounts = countByGuildKey(after.slots);
  const keys = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  const out: BankOpDelta[] = [];
  for (const key of keys) {
    const b = beforeCounts.get(key)?.count ?? 0;
    const a = afterCounts.get(key)?.count ?? 0;
    const delta = a - b;
    if (op === 'deposit' && delta > 0) {
      const slot = afterCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: delta,
        instance: slot.instance ?? null,
        craftedRecipeId: slot.craftedRecipeId ?? null,
        copperDelta: 0,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    } else if ((op === 'withdraw' || op === 'admin_purge') && delta < 0) {
      // admin_purge removes a dormant copy exactly the way a withdraw removes
      // a live one, so it shares this arm: same negative-count delta, same
      // three-dimension key, and therefore the same revert on a fence-out.
      const slot = beforeCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: -delta,
        instance: slot.instance ?? null,
        craftedRecipeId: slot.craftedRecipeId ?? null,
        copperDelta: 0,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    }
  }
  return out;
}

// Record a successful guild bank op's deltas fire-and-forget onto the shared
// FIFO tail (never awaited by the game loop; a rejected insert logs and never
// blocks or reorders anything). The caller computed the deltas via
// diffGuildBankOp (it needs the success signal to mark the book dirty), so
// this only enqueues; an empty array writes nothing.
export function recordGuildBankDeltas(
  op:
    | GuildBankLedgerOp
    | 'create_fee'
    | typeof GUILD_BANK_ESCROW_DEFICIT_OP
    | typeof GUILD_BANK_COUNTERPARTY_ORPHAN_OP,
  who: { characterId: number; accountId: number },
  guildId: number,
  deltas: readonly BankOpDelta[],
): void {
  try {
    // The inserts THIS call enqueues, so the post-write bust below can wait on
    // exactly them. The module FIFO `tail` is process-global (every character's
    // personal and guild rows share it), so chaining on the tail would make one
    // op's bust fire behind every other insert queued since, potentially
    // minutes later on a slow database, invalidating an entry that is fresh by
    // then. That is an extra query at the worst possible moment.
    const enqueued: Promise<void>[] = [];
    for (const delta of deltas) {
      // The nullable counterparty columns rest entirely on "NULL can only ever
      // mean a row written before they existed". Nothing in the schema enforces
      // that: the fields are optional on BankOpDelta and the insert coerces
      // undefined to NULL, so a future guild write site that forgets to stamp
      // would put an indistinguishable NULL into a KEEP-FOREVER table, and the
      // audit would skip that op forever without anybody knowing. Make the
      // convention self-detecting rather than merely documented: an unstamped
      // guild delta is counted and logged at the moment it is written.
      if (delta.counterpartyCopperDelta == null && delta.counterpartyCount == null) {
        // The COUNTER is the signal and is always emitted; the LOG is bounded.
        // This fires per delta on a path the op guard rate-limits but does not
        // stop, so an unstamped write site would otherwise print forever. The
        // first few lines carry the identifying detail an operator needs; the
        // series carries the rest.
        gameMetricsCounters().guildBankIncident('counterparty_unstamped');
        if (unstampedLogged < UNSTAMPED_LOG_LIMIT) {
          unstampedLogged += 1;
          console.error(
            `bank_ledger guild ${op} row for guild ${guildId} (character ${who.characterId}) carries NO counterparty side: the audit can never balance this op, and its NULL is indistinguishable from a pre-feature row${
              unstampedLogged === UNSTAMPED_LOG_LIMIT
                ? ' (further occurrences are counted only, see woc_guild_bank_incidents_total{kind="counterparty_unstamped"})'
                : ''
            }`,
          );
        }
      }
      tail = tail
        .then(() =>
          insertBankLedgerRow({
            realm: REALM,
            characterId: who.characterId,
            accountId: who.accountId,
            op,
            itemId: delta.itemId,
            count: delta.count,
            instance: delta.instance,
            copperDelta: delta.copperDelta,
            purchasedSlotsAfter: delta.purchasedSlotsAfter,
            container: 'guild',
            containerId: guildId,
            // The payer/payee half. A guild delta always carries it (the
            // observer stamps every one), so a NULL in this column can only
            // ever mean a pre-feature row.
            counterpartyCopperDelta: delta.counterpartyCopperDelta ?? null,
            counterpartyCount: delta.counterpartyCount ?? null,
          }),
        )
        .catch((err) => {
          // A rejected insert is a HOLE in the keep-forever audit trail: the
          // op happened in the live book but scripts/bank_audit.mjs can never
          // replay it, so a real dupe investigation would come up clean.
          // Counted beside the log so the hole is visible in production.
          gameMetricsCounters().guildBankIncident('ledger_write_failed');
          console.error('bank_ledger guild write failed:', err);
        });
      enqueued.push(tail);
    }
    // The in-game activity log (server/guild_bank_log.ts) is a CACHE over the
    // very rows this function writes, so its bust belongs HERE, at the one
    // writer, rather than at each of the call sites: a future write site cannot
    // forget it, and every op that produces a row invalidates the guild's
    // window by construction.
    //
    // Only for an op a player can actually SEE. The two anomaly ops
    // (escrow_deficit, counterparty_orphan) are filtered out in the read's SQL,
    // so busting for them would force a refresh whose result is byte-identical,
    // and it would do that during an escrow rollback, i.e. exactly when the
    // process is already in trouble.
    //
    // TWICE, on purpose. The immediate bust retires any snapshot taken before
    // this op. The second fires once THIS call's inserts have actually SETTLED,
    // because a reader racing the write would otherwise refresh from a table
    // that does not contain the new row yet and then serve that pre-op snapshot
    // for a whole TTL: the op would be invisible to the guild precisely when
    // somebody is watching for it. Failures are ignored on purpose (a rejected
    // insert already logged and counted); the bust is correct either way. Note
    // that a "bust" is now a coalescing MARK, not a drop, so a burst of writes
    // cannot turn this into a refresh per op.
    if (deltas.length > 0 && GUILD_BANK_LOG_VISIBLE_OPS.includes(op as GuildBankLogOp)) {
      bustGuildBankLog(guildId);
      void Promise.allSettled(enqueued).then(() => bustGuildBankLog(guildId));
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    gameMetricsCounters().guildBankIncident('ledger_write_failed');
    console.error('bank_ledger recordGuildBankDeltas failed:', err);
  }
}

// The ANOMALY op. Not an op a player performed: an escrow save whose own book
// half could not be replayed onto durable truth, so the WHOLE transaction rolled
// back (character row included) and the session was quarantined and
// disconnected. Nothing was minted and nothing was lost that was ever durable,
// but the incident is worth an operator's attention, because reaching it needs
// one officer to consume value another officer never made durable and then for
// that officer to vanish. scripts/bank_audit.mjs reports every one of these and
// excludes them from the item, treasury, and ladder replays.
export const GUILD_BANK_ESCROW_DEFICIT_OP = 'escrow_deficit';

// The COUNTERPARTY ORPHAN op. Also not an op a player performed: a guild bank
// op that moved the acting character's purse or bags while the guild book did
// not move AT ALL. The book diff is empty there, so without this row the
// observer writes nothing and scripts/bank_audit.mjs replays a book that
// reconciles perfectly against a ledger that never mentioned the value that
// left it. That is precisely the failure mode the counterparty columns exist
// to detect, in its purest form, so it gets a row of its own rather than being
// inferred from an absence. No legitimate op can reach it (every op moves both
// sides or refuses and moves neither), so any row with this op is a defect
// report; scripts/bank_audit.mjs reports every one and excludes them from the
// item, treasury, and ladder replays (the value moved OUTSIDE the book).
export const GUILD_BANK_COUNTERPARTY_ORPHAN_OP = 'counterparty_orphan';

// The counterparty copper the DISCARDED work of an escrow rollback would have
// moved in the acting character's purse, DERIVED from the discarded op log
// rather than snapshotted (the ops are long gone by the time the rollback is
// recorded, and their live snapshots with them).
//
// It is a report, not a movement: nothing happened under an escrow_deficit
// row, so it takes no part in the audit's per-op balance identity, exactly as
// it takes no part in the item, treasury, and ladder replays. It is here
// because direction is the first thing an operator needs, and "which way was
// the purse going" is the question the container-side aggregate cannot answer:
// a session whose purse was FILLING from the book is the shape that would have
// minted, and one whose purse was emptying into it is the shape that would
// have lost the player value.
function discardedPurseCopper(op: string, copperDelta: number): number {
  switch (op) {
    // The treasury gained/lost this copper, so the purse did the opposite.
    case 'deposit_gold':
    case 'withdraw_gold':
      return -copperDelta;
    // Ladder rung 0 was paid by the acting officer's own purse, and the
    // recorded delta IS that payment (never treasury copper).
    case 'open_bank':
      return copperDelta;
    // Rungs 1+ came out of the treasury; item ops and purges move no copper.
    default:
      return 0;
  }
}

// ONE row per rollback event, never one per delta: the log can hold up to
// GUILD_BANK_UNFLUSHED_OP_CAP entries and bank_ledger is keep-forever, so a
// per-delta row is an unbounded write amplifier on a table nothing prunes.
//
// The row carries SIGNED numbers, because direction is the first thing an
// operator needs and the anomaly kind cannot supply it:
//   copper_delta = the net copper the discarded deltas would have moved INTO
//     the book (negative means the session was taking copper OUT of it, which
//     is the shape that would have minted had it been allowed to commit);
//   count        = the net item movement for the stalled identity, signed the
//     same way (positive: deposits the book never received; negative: copies
//     the session took that the book never held).
export function recordGuildBankEscrowRollback(
  who: { characterId: number; accountId: number },
  guildId: number,
  discarded: readonly {
    op: string;
    itemId: string | null;
    count: number | null;
    copperDelta: number;
  }[],
  deficit: { itemId: string | null } | null,
): void {
  let copper = 0;
  let items = 0;
  // The same aggregate seen from the acting character's side: what the
  // discarded work would have moved in that character's own purse and bags.
  let purseCopper = 0;
  let purseItems = 0;
  for (const d of discarded) {
    // open_bank's copper is the acting officer's PURSE paying for rung 0, which
    // the book never held; counting it would over-report book movement by the
    // rung price on every log containing an opening.
    if (d.op !== 'open_bank') copper += Number(d.copperDelta) || 0;
    purseCopper += discardedPurseCopper(d.op, Number(d.copperDelta) || 0);
    if (d.itemId !== null && d.itemId === deficit?.itemId) {
      const n = Math.max(0, Math.floor(Number(d.count)) || 0);
      if (d.op === 'deposit') {
        items += n;
        // The book would have gained the copies, so the bags gave them up.
        purseItems -= n;
      } else if (d.op === 'withdraw') {
        items -= n;
        purseItems += n;
      }
      // admin_purge is deliberately absent from both sums: it destroys a copy
      // rather than moving it, so neither the operator nor the carrier's bags
      // were ever a counterparty to it.
    }
  }
  recordGuildBankDeltas(GUILD_BANK_ESCROW_DEFICIT_OP, who, guildId, [
    {
      itemId: deficit?.itemId ?? null,
      count: deficit?.itemId ? items : null,
      instance: null,
      copperDelta: copper,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
      counterpartyCopperDelta: purseCopper,
      counterpartyCount: deficit?.itemId ? purseItems : null,
    },
  ]);
}

/** ONE row for a guild bank op whose book half did not move while the acting
 *  character's purse or bags did. See GUILD_BANK_COUNTERPARTY_ORPHAN_OP for
 *  why it exists at all; this is the writer, kept beside the deficit writer so
 *  both anomaly shapes share the same FIFO tail and the same fire-and-forget
 *  discipline as an ordinary op row.
 *
 *  `copperDelta` (the container side) is 0 by definition here: the book moved
 *  nothing. The counterparty columns carry the movement, and the row therefore
 *  fails the audit's balance identity BY CONSTRUCTION, which is the point. */
export function recordGuildBankCounterpartyOrphan(
  who: { characterId: number; accountId: number },
  guildId: number,
  purchasedSlotsAfter: number,
  orphan: { itemId: string | null; count: number | null; copperDelta: number },
  evidence: unknown,
): void {
  recordGuildBankDeltas(GUILD_BANK_COUNTERPARTY_ORPHAN_OP, who, guildId, [
    {
      itemId: orphan.itemId,
      count: orphan.count,
      instance: evidence,
      copperDelta: 0,
      purchasedSlotsBefore: purchasedSlotsAfter,
      purchasedSlotsAfter,
      counterpartyCopperDelta: orphan.copperDelta,
      counterpartyCount: orphan.count ?? 0,
    },
  ]);
}

// The guild_create fee row (reserve-at-gate: the purse was charged at the
// dispatch gate; the row is written only in the create's committed success
// arm, which consumes that reservation). purchased_slots_after is 0: a
// newborn guild has no expansions. copper_delta is the negated copper the
// founder's PURSE paid (never treasury copper), so the audit script excludes
// create_fee from the treasury replay.
export function guildCreateFeeDelta(chargedCopper: number, pursePaid: number): BankOpDelta {
  return {
    itemId: null,
    count: null,
    instance: null,
    copperDelta: -chargedCopper,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
    // `pursePaid` is an INDEPENDENT MEASUREMENT, not a restatement of
    // chargedCopper: the gate snapshots the founder's purse either side of the
    // charge and passes what it actually observed leaving. Deriving it from
    // chargedCopper instead would make the balance identity algebraically zero
    // for every input, i.e. a check that cannot fail, which is worse than no
    // check because it reads as coverage. As two measurements, a charge the
    // sim reported taking but the purse never gave up is a finding.
    counterpartyCopperDelta: pursePaid,
    counterpartyCount: 0,
  };
}
