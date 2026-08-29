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
//
// RETENTION: bank_ledger is APPEND-ONLY and is never deleted from. Nothing
// prunes it, by ruling and not by omission: it is the anti-dupe audit trail,
// and every replay in scripts/bank_audit.mjs reads a container's WHOLE history,
// so pruning any prefix would turn later legitimate withdraws into false
// findings and erase the evidence a real dupe investigation needs. The growth
// bound is therefore economic activity (one row per successful op, EXCEPT the
// vault sweep: vault_deposit_all diffs to one row per distinct carried slot,
// including separate crafted/signer identities, at most the 112-slot inventory),
// not time.
// This is deliberately not open-ended: the named REVISIT threshold is
// 10,000,000 rows. At that size the audit's single ordered full scan is the
// thing that breaks first (the recorded deferral there is a keyset cursor), and
// whoever crosses it should re-decide the posture rather than discover it. That
// threshold is ADVERSARIALLY REACHABLE, not only organic. The personal-bank
// and Materials Vault commands therefore sit behind the dual budget in
// bank_vault_ledger_guard.ts: 10 commands of burst, 2 commands/s sustained,
// 121 rows of burst, and 4 rows/s sustained. The row bucket prices the actual
// worst cases (two rows for a socket swap and 112 for vault_deposit_all), so a
// hostile account is bounded to 172,800 receipts and 345,600 retained rows
// per day after its one-time burst. Craft-from-vault (Phase 04) adds op
// 'craft_consume', one row per material id drawn per COMPLETED CAST, and shares
// those same account command/row buckets rather than stacking another source.
// Account state survives reconnect in-process. A separate process/realm bucket
// admits 242 rows of burst and 8 rows/s sustained, at most 691,200 of these
// rows per process-day after burst. The cross-process database trigger in
// bank_ledger_growth_budget.ts is the final authority over every insert path:
// it seeds an exact durable count, refuses the write that would cross
// 10,000,000 committed rows, and never consumes capacity on rollback or an
// idempotent receipt retry. Any future personal/vault bulk verb must still
// join the fixed command-to-row map before it can mutate gameplay.
// The Materials Vault rows (container 'vault', below)
// join the SAME posture: same table, same never-delete rule, same 10,000,000-row
// revisit threshold, and they are served by the per-character index rather than
// the guild-only partial one. server/main.ts states the same story at the
// retention sweep's table list, which is where an operator looks first.

import type { BankInfo, GuildBankInfo, VaultInfo } from '../src/world_api';
import { BankLedgerGrowthLimitExceeded } from './bank_ledger_growth_budget';
import { type BankLedgerRow, insertBankLedgerRow, insertBankLedgerRows } from './db';
import { gameMetricsCounters } from './http/game_signals';
import { REALM } from './realm';

// The socket trio (Bank Storage phase 07) joins the personal vocabulary:
// unlock_socket is the copper sink for a socket rung (the ladder's largest
// unauditable sink before this row existed: up to 1150g per character with no
// record), and socket_bag / unsocket_bag track the bank's socket store, a
// container the slot replay cannot see (a socketed bag exists only as its
// socketBags id, never as a bank slot). scripts/bank_audit.mjs replays the
// socket store from exactly these rows.
export type BankLedgerOp =
  | 'deposit'
  | 'withdraw'
  | 'buy_slots'
  | 'unlock_socket'
  | 'socket_bag'
  | 'unsocket_bag';

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

/** The slice of BankInfo the personal differ actually reads, so an observer
 *  without a full proximity-gated readout (the Claudium grant apply, which
 *  can land anywhere in the world) can hand recordBankOp a minimal
 *  snapshot pair. BankInfo satisfies it structurally, so the wire call
 *  sites are unchanged. */
export type BankOpSnapshot = Pick<BankInfo, 'slots' | 'purchasedSlots' | 'nextExpansionCost'>;

/** The payment rail a buy_slots row records in its instance JSONB, read by
 *  any rail-split report (instance->>'paidWith'), which is the only way to
 *  tell a gold rung from a Claudium one after the fact.
 *  Server-derived at the dispatch site, NEVER from
 *  the request. Personal rows only: the guild and vault buy_slots arms are
 *  single-rail (gold) and diffVaultOp pins instance null, so they stay
 *  unstamped (NULL means "not recorded", the pre-phase-11 reading). */
export type BankBuyRail = 'gold' | 'claudium';

export interface BankBuyOpts {
  paidWith?: BankBuyRail;
  /** The storage SKU id on a Claudium purchase row (audit attribution for a
   *  multi-rung charter jump); gold rows keep itemId null as always. */
  itemId?: string;
}

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
  before: BankOpSnapshot | null,
  after: BankOpSnapshot | null,
  opts: BankBuyOpts = {},
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'buy_slots') {
    if (after.purchasedSlots <= before.purchasedSlots) return [];
    // The price is exactly the BEFORE snapshot's nextExpansionCost (non-null by
    // construction on a real purchase); guard a null defensively as 0. A
    // Claudium purchase moves NO copper (the debit lives in the service's
    // claudium_ledger; this row is the character-side slot audit), so its
    // copperDelta is exactly 0, the shape scripts/bank_audit.mjs verifies
    // per rail.
    const price = before.nextExpansionCost ?? 0;
    return [
      {
        itemId: opts.itemId ?? null,
        count: null,
        instance: opts.paidWith ? { paidWith: opts.paidWith } : null,
        copperDelta: opts.paidWith === 'claudium' ? 0 : -price,
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

// The tail's bound, in TWO units. Inflow scales with connected-account count
// (the per-account bucket admits 4 rows/s EACH) while the drain is one
// serialized insert chain, so a busy realm could otherwise grow the tail
// without bound until the 10s shutdown drain (BANK_LEDGER_SHUTDOWN_DRAIN_MS)
// cannot settle and silently abandons the whole backlog. A depth cap alone is
// not an honest bound: depth counts queued insert OPERATIONS, and a batched
// op (vault_deposit_all) carries up to 112 rows, so 2,000 queued ops could
// retain ~224,000 row objects and a drain of maximal batches is slower than
// single-row arithmetic assumes. Hence two caps, and an op is dropped
// (COUNTED and VISIBLE, never the silent wholesale drop at shutdown) when
// EITHER would be exceeded:
//   - depth: 2,000 queued ops drains inside the 10s window at a conservative
//     200 single-row inserts/s;
//   - rows: 4,000 queued rows holds even a full-depth tail to an average
//     batch of 2 rows, which keeps that 200 inserts/s figure conservative
//     for batched statements and bounds retained row objects. Its backlog
//     coverage scales INVERSELY with banking concurrency: the only bucket
//     that refuses is the per-account one (4 rows/s each; the realm bucket
//     in bank_vault_ledger_guard.ts observes and never refuses, so its 8
//     rows/s is the breach counter's measurement basis, not an admission
//     bound), so sustained admissible inflow is banking-accounts x 4 rows/s
//     and 4,000 rows is 1,000s of backlog for one account but ~10s at 100
//     concurrently banking accounts. The DELIBERATE trade is that rows
//     binds the one bulk op far tighter than depth: a realm queueing
//     112-row vault_deposit_all sweeps starts dropping at ~35 queued
//     sweeps (4,000 / 112), not 2,000 queued ops, the price of bounding
//     drain time and retained memory in the audit's own unit.
// The two caps are asymmetric at admission: depth admits one op of ANY size
// onto a not-yet-full queue, while rows refuses an op larger than
// BANK_LEDGER_TAIL_MAX_ROWS outright even on an EMPTY queue. The rows
// constant therefore carries the precondition that no single legitimate op
// exceeds it (112, the vault_deposit_all sweep, is today's maximum batch);
// a future bulk verb bigger than the cap could never be admitted at all.
// The drop counter sizes holes in ROWS, the audit's own unit.
export const BANK_LEDGER_TAIL_MAX_DEPTH = 2_000;
export const BANK_LEDGER_TAIL_MAX_ROWS = 4_000;
let tailDepth = 0;
let tailRows = 0;
let tailDroppedRows = 0;
const TAIL_DROP_LOG_LIMIT = 5;
let tailDropLogged = 0;

/** Live queued ops (depth) and their queued rows in the insert FIFO, plus
 *  lifetime rows dropped at either cap (ops + metrics). */
export function bankLedgerTailStats(): { depth: number; rows: number; droppedRows: number } {
  return { depth: tailDepth, rows: tailRows, droppedRows: tailDroppedRows };
}

/** Restore the cap-drop log budget (test-only). The latch is process-lifetime
 *  by design, so without this a drop-log assertion depends on how many drops
 *  SIBLING tests produced first; the drop COUNTER is never reset. */
export function resetBankLedgerTailDropLogForTests(): void {
  tailDropLogged = 0;
}

/** Chain one insert onto the FIFO when BOTH caps admit it. Returns false
 *  on a cap drop (counted here in rows, logged under the shared latch idiom);
 *  the call site then does its own audit-hole accounting, exactly as it would
 *  for a rejected insert, which is deliberately PER SITE: the vault and guild
 *  arms count incidents on a drop because their REJECTED inserts count
 *  incidents, while the personal-bank and socket arms have no incident family
 *  for rejected inserts either, so their drops land in the shared
 *  woc_bank_ledger_tail_dropped_rows_total counter alone, the same visibility
 *  their failures have. onError must never throw; it is guarded anyway. */
function enqueueOnTail(
  rowCount: number,
  run: () => Promise<void>,
  onError: (err: unknown) => void,
): boolean {
  if (tailDepth >= BANK_LEDGER_TAIL_MAX_DEPTH || tailRows + rowCount > BANK_LEDGER_TAIL_MAX_ROWS) {
    tailDroppedRows += rowCount;
    if (tailDropLogged < TAIL_DROP_LOG_LIMIT) {
      tailDropLogged += 1;
      console.error(
        `bank_ledger insert FIFO is at a cap (${tailDepth} of ${BANK_LEDGER_TAIL_MAX_DEPTH} ops, ${tailRows} of ${BANK_LEDGER_TAIL_MAX_ROWS} rows queued): dropped ${rowCount} audit row(s)${
          tailDropLogged === TAIL_DROP_LOG_LIMIT
            ? ' (further drops are counted only, see woc_bank_ledger_tail_dropped_rows_total)'
            : ''
        }`,
      );
    }
    return false;
  }
  tailDepth += 1;
  tailRows += rowCount;
  tail = tail
    .then(run)
    .catch((err) => {
      try {
        onError(err);
      } catch {
        // A throwing error handler must never break the FIFO chain.
      }
    })
    .finally(() => {
      tailDepth -= 1;
      tailRows -= rowCount;
    });
  return true;
}

// Log budget for the unstamped-delta detector below. The metric counts every
// occurrence; the log prints the first few and then stops, so a write site that
// forgot to stamp cannot flood a process's stderr for its whole uptime.
const UNSTAMPED_LOG_LIMIT = 5;
let unstampedLogged = 0;

function countBankLedgerGrowthRefusal(error: unknown): void {
  if (error instanceof BankLedgerGrowthLimitExceeded) {
    gameMetricsCounters().bankLedgerGrowthLimitRefused();
  }
}

// Log budget for growth-ceiling refusals, ONE latch shared across the five
// insert arms below: once the database-wide ceiling refuses, every later
// insert on paths that fire per bank op and per craft tick fails the same
// way, so an unbounded console.error would flood stderr for the rest of the
// process's uptime. Same idiom as UNSTAMPED_LOG_LIMIT above: the first few
// lines identify the condition, then the counters carry the rest
// (woc_bank_ledger_growth_limit_refusals_total plus the per-domain incident
// series). Non-refusal errors keep unbounded logging: each one is
// individually meaningful, not a standing condition.
const GROWTH_REFUSAL_LOG_LIMIT = 5;
let growthRefusalLogged = 0;

/** True when the arm should still print its console.error for this failure.
 *  Consumes one unit of the shared budget for a growth-ceiling refusal and
 *  appends the counted-only notice on the last budgeted line. */
function shouldLogBankLedgerWriteFailure(error: unknown): boolean {
  if (!(error instanceof BankLedgerGrowthLimitExceeded)) return true;
  if (growthRefusalLogged >= GROWTH_REFUSAL_LOG_LIMIT) return false;
  growthRefusalLogged += 1;
  if (growthRefusalLogged === GROWTH_REFUSAL_LOG_LIMIT) {
    console.error(
      'bank_ledger growth-limit refusals reached the log budget: further refusals are counted only (woc_bank_ledger_growth_limit_refusals_total)',
    );
  }
  return true;
}

// Record a successful bank op fire-and-forget. Computes the diff and enqueues one
// insert per element onto the FIFO tail. Returns void immediately (never a promise,
// never awaited by the game loop); the whole body is guarded so it can never throw
// into the caller and gameplay never depends on the write landing.
export function recordBankOp(
  op: BankLedgerOp,
  who: { characterId: number; accountId: number },
  before: BankOpSnapshot | null,
  after: BankOpSnapshot | null,
  opts: BankBuyOpts = {},
): void {
  try {
    for (const row of buildPersonalBankLedgerRows(op, who, before, after, opts)) {
      enqueueOnTail(
        1,
        () => insertBankLedgerRow(row),
        (err) => {
          countBankLedgerGrowthRefusal(err);
          if (shouldLogBankLedgerWriteFailure(err)) {
            console.error('bank_ledger write failed:', err);
          }
        },
      );
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('bank_ledger recordBankOp failed:', err);
  }
}

/** Build the complete durable rows for one personal-bank command. The wire
 *  admission path and the legacy fire-and-forget observer share this pure
 *  projection so moving persistence into the character save cannot drift the
 *  audit shape. Array order is the differ's command order. */
export function buildPersonalBankLedgerRows(
  op: BankLedgerOp,
  who: { characterId: number; accountId: number },
  before: BankOpSnapshot | null,
  after: BankOpSnapshot | null,
  opts: BankBuyOpts = {},
): BankLedgerRow[] {
  return diffBankOp(op, before, after, opts).map((delta) => ({
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
  }));
}

/** One socket-op diff element: the row's own op beside its delta, because a
 *  single socket command can legitimately write rows of TWO ops (a swap is one
 *  unsocket_bag for the displaced bag plus one socket_bag for the incoming
 *  one), which recordBankOp's single-op shape cannot express. */
export interface BankSocketDelta {
  op: BankLedgerOp;
  delta: BankOpDelta;
}

/**
 * Observe a socket command's success by diffing the before/after BankInfo
 * snapshots, the recordBankOp discipline. PURE (unit-tested directly). One
 * differ serves all three commands because each mutates only what it
 * legitimately moves: an unlock grows socketsUnlocked alone, a socket fills
 * one index (a swap also empties it of the old id), an unsocket empties one.
 * A refused/no-op call diffs empty and writes no row; re-socketing the same
 * bag id over itself leaves the store unchanged and also diffs empty (the
 * carried side nets zero too, so there is nothing to record).
 *
 * The unlock row's price is exactly the BEFORE snapshot's nextSocketCost
 * (non-null by construction on a real unlock; guarded as 0 defensively), the
 * buy_slots precedent. Every row stamps purchasedSlotsAfter with the live SLOT
 * ladder position as a BYSTANDER: the audit's monotonicity scan reads that
 * column on every personal row, so stamping anything else (a socket count)
 * would read as a ladder regression.
 */
export function diffBankSocketOp(
  before: BankInfo | null,
  after: BankInfo | null,
): BankSocketDelta[] {
  if (!before || !after) return [];
  const out: BankSocketDelta[] = [];
  if (after.socketsUnlocked > before.socketsUnlocked) {
    out.push({
      op: 'unlock_socket',
      delta: {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -(before.nextSocketCost ?? 0),
        purchasedSlotsAfter: after.purchasedSlots,
      },
    });
  }
  const sockets = Math.max(before.socketBags.length, after.socketBags.length);
  for (let i = 0; i < sockets; i++) {
    const wasId = before.socketBags[i] ?? null;
    const nowId = after.socketBags[i] ?? null;
    if (wasId === nowId) continue;
    // Unsocket before socket within one index (the swap case): the running
    // socket-store net in the audit replay then never dips below zero on a
    // legitimate history.
    if (wasId !== null) {
      out.push({
        op: 'unsocket_bag',
        delta: {
          itemId: wasId,
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: after.purchasedSlots,
        },
      });
    }
    if (nowId !== null) {
      out.push({
        op: 'socket_bag',
        delta: {
          itemId: nowId,
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: after.purchasedSlots,
        },
      });
    }
  }
  return out;
}

/**
 * Record a successful socket op fire-and-forget, mirroring recordBankOp's
 * FIFO and never-throws discipline, with ONE divergence: the whole command's
 * diff lands as a single BATCHED insert (insertBankLedgerRows, the
 * vault_deposit_all rule), because a swap is the first PERSONAL single
 * logical op that writes two rows. One statement means one round trip and
 * all-rows-or-none: a half-landed swap (its socket_bag without its
 * unsocket_bag) would replay as a permanent audit finding on a keep-forever
 * table with no compensating write path. unnest preserves array order, which
 * the differ relies on (unsocket before socket). Bounded at two rows for a
 * swap, one otherwise, zero for a refusal: strictly per-player-command,
 * never per-delta or per-tick, the keep-forever table's write-volume rule.
 */
export function recordBankSocketOp(
  who: { characterId: number; accountId: number },
  before: BankInfo | null,
  after: BankInfo | null,
): void {
  try {
    const rows = buildBankSocketLedgerRows(who, before, after);
    if (rows.length === 0) return;
    enqueueOnTail(
      rows.length,
      () => insertBankLedgerRows(rows),
      (err) => {
        countBankLedgerGrowthRefusal(err);
        if (shouldLogBankLedgerWriteFailure(err)) {
          console.error('bank_ledger write failed:', err);
        }
      },
    );
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('bank_ledger recordBankSocketOp failed:', err);
  }
}

/** Build the complete rows for one socket command. A swap deliberately keeps
 *  the differ's unsocket-then-socket order inside one logical batch. */
export function buildBankSocketLedgerRows(
  who: { characterId: number; accountId: number },
  before: BankInfo | null,
  after: BankInfo | null,
): BankLedgerRow[] {
  return diffBankSocketOp(before, after).map(({ op, delta }) => ({
    realm: REALM,
    characterId: who.characterId,
    accountId: who.accountId,
    op,
    itemId: delta.itemId,
    count: delta.count,
    instance: delta.instance,
    copperDelta: delta.copperDelta,
    purchasedSlotsAfter: delta.purchasedSlotsAfter,
    container: 'personal' as const,
    containerId: null,
  }));
}

/**
 * Await the FIFO tail as it stands at the call, for tests to drain the queue
 * deterministically and for the shutdown path to flush queued rows.
 *
 * With no argument the wait is UNBOUNDED and the result is always true, which is
 * what every test wants. Pass a finite deadlineMs (the shutdown path passes
 * BANK_LEDGER_SHUTDOWN_DRAIN_MS below) to bound it: true means the tail settled,
 * false means the deadline expired first and the rows still queued behind it are
 * abandoned. The deadline lives HERE rather than at the call site, matching
 * stopUnstuckRecords: the queue owns its own drain policy, so a second caller
 * cannot invent a different one. The timer is unref'd (it must never hold the
 * loop open) and cleared on the fast path (it must not outlive a clean drain).
 */
export function bankLedgerIdle(deadlineMs?: number): Promise<boolean> {
  const tailAtCall = tail;
  if (deadlineMs === undefined) return tailAtCall.then(() => true);
  const boundedDeadline = Math.max(1, Math.floor(deadlineMs));
  return new Promise<boolean>((resolve) => {
    // resolve() is idempotent, so whichever side lands first wins and the other
    // is a no-op; no settled flag needed.
    const timer = setTimeout(() => resolve(false), boundedDeadline);
    timer.unref();
    void tailAtCall.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * How long the shutdown path waits for the FIFO tail above to settle before
 * giving up on it. Generous next to its neighbours (UNSTUCK_RECORD_SHUTDOWN_
 * DRAIN_MS and the storefront mirrors both use 5s) because these rows are the
 * keep-forever audit trail and are worth waiting on, but finite for the same
 * reason they are: a database that accepts the connection and never answers
 * must not hold the process past the supervisor's kill grace, which would lose
 * the character saves already flushed ahead of this drain to SIGKILL. Rows the
 * deadline abandons are the same transient hole a crash leaves, which the
 * audit already tolerates.
 */
export const BANK_LEDGER_SHUTDOWN_DRAIN_MS = 10_000;

// ---------------------------------------------------------------------------
// Materials Vault rows (Bank Storage Phase 2). The SIBLING of the personal
// bank observer above, with the same discipline: the sim ops (vaultDeposit /
// vaultWithdraw / vaultBuyUpgrade) return void and emit no success event, so
// the dispatch site diffs Sim.vaultInfoFor(pid) BEFORE and AFTER each call and
// an empty diff means refused / no-op / away from a banker. Success is NEVER
// inferred from the absence of an exception.
//
// Rows write container='vault' with container_id = null into the SAME
// bank_ledger table, reusing the personal op vocabulary ('deposit' |
// 'withdraw' | 'buy_slots') so scripts/bank_audit.mjs's per-row shape checks
// (pass A) and its per-group monotonicity and conservation replay (pass B) work
// on vault rows UNMODIFIED. The audit's pass-B group key is
// `${container}::${character_id}` for anything that is not a guild, so vault
// rows group per character on their own, never mixing with the personal bank.
//
// Two shape differences from the bank, both structural rather than stylistic:
//   - ordinary pooled stock keys on [itemId, null], while identity-preserving
//     material keys on [itemId, {vaultSpecial:1,instance,craftedRecipeId}];
//   - `purchased_slots_after` carries the vault's UPGRADE RUNG (VaultInfo
//     .upgrades), the monotonic ladder analogue of the bank's purchasedSlots.
//     The column is NOT NULL and pass B scans it for regressions, so the rung
//     is the one honest value to put there: it only ever climbs, by exactly the
//     same rule, and it lets an audit reconcile the final row against
//     state.vault.upgrades the way it reconciles the bank's ladder.
// ---------------------------------------------------------------------------

// Exported as the public name of the vault op vocabulary, the same API
// symmetry as the personal BankLedgerOp and guild GuildBankLedgerOp siblings,
// even while its only readers live in this module.
export type VaultLedgerOp = 'deposit' | 'withdraw' | 'buy_slots';

/** Versioned ledger identity for a full-payload Materials Vault row. The
 *  wrapper distinguishes even a sanitizer-demoted special row (both markers
 *  null) from ordinary pooled stock. */
export function vaultSpecialLedgerIdentity(slot: VaultInfo['special'][number]): {
  vaultSpecial: 1;
  instance: VaultInfo['special'][number]['instance'] | null;
  craftedRecipeId: string | null;
} {
  return {
    vaultSpecial: 1,
    instance: slot.instance ?? null,
    craftedRecipeId: slot.craftedRecipeId ?? null,
  };
}

interface VaultMultisetRow {
  itemId: string;
  instance: unknown;
  count: number;
}

function vaultMultiset(info: VaultInfo): Map<string, VaultMultisetRow> {
  const rows = new Map<string, VaultMultisetRow>();
  for (const itemId of Object.keys(info.stock)) {
    const held = Number(info.stock[itemId]);
    const count = Number.isFinite(held) ? held : 0;
    const key = JSON.stringify([itemId, null]);
    rows.set(key, { itemId, instance: null, count });
  }
  for (const slot of info.special) {
    const instance = vaultSpecialLedgerIdentity(slot);
    const key = JSON.stringify([slot.itemId, instance]);
    const prior = rows.get(key);
    if (prior) prior.count += slot.count;
    else rows.set(key, { itemId: slot.itemId, instance, count: slot.count });
  }
  return rows;
}

// Observe a vault op's outcome by diffing the before/after vaultInfoFor
// snapshots. Returns the ledger elements a successful op produced (deposit /
// withdraw: one per changed material id; buy_slots: one purchase row); an empty
// array means refused / no-op / away from a banker, so no row is written.
//
// The key union is walked SORTED. Vault stock round-trips through JSONB, whose
// key order Postgres does not preserve from the insert, so an insertion-ordered
// walk would make a multi-key op's row order depend on which host produced the
// snapshot. Sorting makes the emitted row order a function of the ids alone.
export function diffVaultOp(
  op: VaultLedgerOp,
  before: VaultInfo | null,
  after: VaultInfo | null,
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'buy_slots') {
    if (after.upgrades <= before.upgrades) return [];
    // The price is exactly the BEFORE snapshot's nextUpgradeCost (non-null by
    // construction on a real purchase: a vault at the cap cannot buy); guard a
    // null defensively as 0, the personal bank's arm. The branch is
    // UNREACHABLE today (vaultBuyUpgrade refuses a capped vault, so a null
    // cost never reaches a successful diff), and the -0 it would produce is
    // flagged loudly by the audit's nonnegative_buy_cost check ON PURPOSE:
    // a row that got here is evidence of a broken invariant, so do not
    // silence it by clamping or by skipping the row.
    const price = before.nextUpgradeCost ?? 0;
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -price,
        purchasedSlotsAfter: after.upgrades,
      },
    ];
  }

  const beforeRows = vaultMultiset(before);
  const afterRows = vaultMultiset(after);
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  const out: BankOpDelta[] = [];
  for (const key of keys) {
    const beforeRow = beforeRows.get(key);
    const afterRow = afterRows.get(key);
    const row = afterRow ?? beforeRow;
    if (!row) continue;
    const delta = (afterRow?.count ?? 0) - (beforeRow?.count ?? 0);
    // A deposit takes ids the vault GAINED, a withdraw ids it LOST. A key that
    // fell to zero is deleted from the record by vaultWithdraw, which the
    // key-union walk sees as a full withdraw of its whole before-count.
    if (op === 'deposit' && delta > 0) {
      out.push({
        itemId: row.itemId,
        count: delta,
        instance: row.instance,
        copperDelta: 0,
        purchasedSlotsAfter: after.upgrades,
      });
    } else if (op === 'withdraw' && delta < 0) {
      out.push({
        itemId: row.itemId,
        count: -delta,
        instance: row.instance,
        copperDelta: 0,
        purchasedSlotsAfter: after.upgrades,
      });
    }
  }
  return out;
}

// Record a successful vault op fire-and-forget, mirroring recordBankOp's
// observer discipline: computes the diff, enqueues the WHOLE diff as one
// batched multi-row insert on the SHARED module FIFO tail (so bankLedgerIdle()
// drains vault rows too and a character's cross-container op order is
// preserved), returns void immediately, and guards the whole body so the
// observer can never throw into the dispatch path.
//
// One STEP per op, not one per row (the recordBankOp divergence, ruled in the
// packet's state.md Phase 03 constraints): a single vault_deposit diffs to at
// most one row, but the batched vault_deposit_all sweep diffs to one row PER
// MATERIAL MOVED, and enqueuing those individually would multiply FIFO steps
// and round trips against the append-only table. The batch lands atomically
// (all rows or none), which is what the audit's replay wants from one logical
// op. A rejected batch counts the incident ONCE PER LOST ROW, preserving the
// phase-02 counter semantics (the series sizes the audit-trail hole, and an
// operator alert calibrated on the per-row baseline must not under-read a
// swept batch); the single log line names the character the hole belongs to.
export function recordVaultOp(
  op: VaultLedgerOp,
  who: { characterId: number; accountId: number },
  before: VaultInfo | null,
  after: VaultInfo | null,
): void {
  try {
    const rows = buildVaultLedgerRows(op, who, before, after);
    if (rows.length === 0) return;
    const admitted = enqueueOnTail(
      rows.length,
      () => insertBankLedgerRows(rows),
      (err) => {
        countBankLedgerGrowthRefusal(err);
        // A rejected insert is a HOLE in the keep-forever audit trail: the
        // op happened in the live vault but scripts/bank_audit.mjs can never
        // replay it, so that character reconciles as a permanent
        // ledger_state_mismatch and a real dupe investigation comes up
        // clean. Counted beside the log so the hole is visible in
        // production, exactly like the guild arm below; once per LOST ROW
        // (see the header), so a rejected sweep batch sizes its whole hole.
        for (let i = 0; i < rows.length; i++) {
          gameMetricsCounters().vaultLedgerIncident('ledger_write_failed');
        }
        // Name the character here because the metric never does (character id
        // is unbounded, so it is banned as a label): this line IS the
        // identifying detail the counter's docblock promises an operator.
        if (shouldLogBankLedgerWriteFailure(err)) {
          console.error(`bank_ledger vault write failed for character ${who.characterId}:`, err);
        }
      },
    );
    // A cap drop is the same audit hole a rejected insert is; size it the
    // same way so the incident series never under-reads sustained overload.
    if (!admitted) {
      for (let i = 0; i < rows.length; i++) {
        gameMetricsCounters().vaultLedgerIncident('ledger_write_failed');
      }
    }
  } catch (err) {
    // The observer must never fault the dispatch path. This arm counts ONE
    // incident, not per-row: a synchronous throw here means the diff itself
    // failed, so no rows were computed and none were lost; the per-row rule
    // above applies only to a batch that existed and was rejected.
    gameMetricsCounters().vaultLedgerIncident('ledger_write_failed');
    console.error(`bank_ledger recordVaultOp failed for character ${who.characterId}:`, err);
  }
}

/** Build the complete durable rows for one vault command. Multi-material
 *  sweeps retain the differ's stable sorted order inside one command batch. */
export function buildVaultLedgerRows(
  op: VaultLedgerOp,
  who: { characterId: number; accountId: number },
  before: VaultInfo | null,
  after: VaultInfo | null,
): BankLedgerRow[] {
  return diffVaultOp(op, before, after).map((delta) => ({
    realm: REALM,
    characterId: who.characterId,
    accountId: who.accountId,
    op,
    itemId: delta.itemId,
    count: delta.count,
    instance: delta.instance,
    copperDelta: delta.copperDelta,
    purchasedSlotsAfter: delta.purchasedSlotsAfter,
    container: 'vault',
    containerId: null,
  }));
}

// ---------------------------------------------------------------------------
// Vault craft-consumption rows (Bank Storage Phase 04). Craft-from-vault
// consumes stock inside the sim at CAST COMPLETION, several ticks after the
// craft_item dispatch, so there is no dispatch bracket to diff across and the
// recordVaultOp shape above cannot apply.
//
// The LIVE path is the reservation journal, not a fire-and-forget recorder:
// SimConfig.vaultConsumptionAdmission (wired in server/game.ts over
// bank_ledger_session.ts's createBankLedgerSessionJournal) reserves the exact
// planned takes BEFORE the sim mutates vault stock, and the sim commits the
// reservation once the draw lands, so the rows ride the character-save
// transaction through the session outbox instead of this module's FIFO tail.
// This module keeps only the PURE row builder the journal serializes with.
//
// Rows write op 'craft_consume', container 'vault', container_id null,
// instance null, copper_delta 0; purchased_slots_after carries the rung the
// reservation sampled at consumption time; one row per material id drawn, in
// the canonical sorted take order (src/sim/sim_context.ts
// reservePlannedVaultConsumption). scripts/bank_audit.mjs replays
// 'craft_consume' as a REMOVAL beside deposit/withdraw/admin_purge; without
// that row every crafting character would reconcile as a permanent
// ledger_state_mismatch, which is why the row family exists at all.
// ---------------------------------------------------------------------------

/** One completed cast's vault consumption: the owning session's identity, the
 *  canonically sorted takes, and the rung it sampled. */
export interface VaultCraftConsumption {
  who: { characterId: number; accountId: number };
  takes: readonly { itemId: string; count: number }[];
  upgrades: number;
}

/** Build the complete rows for one or more completed craft casts. Input order
 *  and each event's sorted take order become durable row order. */
export function buildVaultCraftConsumeLedgerRows(
  consumptions: readonly VaultCraftConsumption[],
): BankLedgerRow[] {
  return consumptions.flatMap((c) =>
    c.takes.map((take) => ({
      realm: REALM,
      characterId: c.who.characterId,
      accountId: c.who.accountId,
      op: 'craft_consume',
      itemId: take.itemId,
      count: take.count,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: c.upgrades,
      container: 'vault',
      containerId: null,
    })),
  );
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

export type GuildBankRecordedOp =
  | GuildBankLedgerOp
  | 'create_fee'
  | typeof GUILD_BANK_ESCROW_DEFICIT_OP
  | typeof GUILD_BANK_COUNTERPARTY_ORPHAN_OP;

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
// null on either side is a refusal by construction. Since the v0.35 member
// read-only view the CONVERSE no longer holds: a plain member's dispatched op
// arrives here with two non-null, IDENTICAL snapshots (the read is
// membership-gated, the op refused rank-side and mutated nothing), so the
// refusal signal for that class is "no movement", not a null snapshot; the
// identical-snapshot arms below and the rank sweep in tests/guild_bank.test.ts
// pin it. A refused (projected)
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

// Legacy asynchronous writer retained only for terminal anomaly evidence,
// whose quarantined session can never save again. Normal guild commands use
// buildGuildBankLedgerRows and the bounded character outbox so their rows
// commit atomically with character + book. An empty array writes nothing.
export function recordGuildBankDeltas(
  op: GuildBankRecordedOp,
  who: { characterId: number; accountId: number },
  guildId: number,
  deltas: readonly BankOpDelta[],
): void {
  try {
    const rows = buildGuildBankLedgerRows(op, who, guildId, deltas);
    for (let index = 0; index < deltas.length; index++) {
      const delta = deltas[index];
      const row = rows[index];
      if (!delta || !row) throw new Error('guild bank ledger row projection lost alignment');
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
      const admitted = enqueueOnTail(
        1,
        () => insertBankLedgerRow(row),
        (err) => {
          countBankLedgerGrowthRefusal(err);
          // A rejected insert is a HOLE in the keep-forever audit trail: the
          // op happened in the live book but scripts/bank_audit.mjs can never
          // replay it, so a real dupe investigation would come up clean.
          // Counted beside the log so the hole is visible in production.
          gameMetricsCounters().guildBankIncident('ledger_write_failed');
          if (shouldLogBankLedgerWriteFailure(err)) {
            console.error('bank_ledger guild write failed:', err);
          }
        },
      );
      // A cap drop is the same audit hole a rejected insert is.
      if (!admitted) gameMetricsCounters().guildBankIncident('ledger_write_failed');
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    gameMetricsCounters().guildBankIncident('ledger_write_failed');
    console.error('bank_ledger recordGuildBankDeltas failed:', err);
  }
}

/** Build complete guild rows from the already-computed command deltas. The
 *  pure batch projection is shared by fenced saves and the legacy observer. */
export function buildGuildBankLedgerRows(
  op: GuildBankRecordedOp,
  who: { characterId: number; accountId: number },
  guildId: number,
  deltas: readonly BankOpDelta[],
): BankLedgerRow[] {
  return deltas.map((delta) => ({
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
    counterpartyCopperDelta: delta.counterpartyCopperDelta ?? null,
    counterpartyCount: delta.counterpartyCount ?? null,
  }));
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

// The guild_create fee row is written atomically with the exact post-charge
// character state, new guild, leader membership, and empty bank.
// purchased_slots_after is 0: a newborn guild has no expansions. copper_delta
// is the negated copper the founder's PURSE paid (never treasury copper), so
// the audit script excludes create_fee from the treasury replay.
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
