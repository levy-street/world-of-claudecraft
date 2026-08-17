// Economy Watch, phase 1: the LedgerWriter. Consumes the sim's `EconomyEvent`
// batch off each tick and lands it in `gold_ledger` without the world loop ever
// waiting on Postgres.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: the game loop must never block on the
// ledger, and the ledger must never lie about having blocked. Those pull in
// opposite directions, so the queue is BOUNDED and an overflow is COUNTED
// rather than absorbed. A silently-growing queue would trade a visible drop for
// an invisible OOM, and a drop nobody counted would let the reconciler report a
// conservation violation for gold that moved perfectly well and simply was not
// written down. `droppedWrites` is therefore load-bearing, not a nicety: the
// reconciler reads it and downgrades its own findings while it is non-zero.
//
// No SQL here (server/CLAUDE.md): every statement lives in `gold_ledger_db.ts`
// behind the injected deps bag below, so the queue, the batching, the corpse
// aggregation, and the chain arithmetic all unit-test with no `pg` at all.

import type { EconomyEventKind } from '../src/sim/economy_event_kinds';
import type { SimEvent } from '../src/sim/types';
import { flattenCounterparty, type GoldLedgerInsert } from './gold_ledger_types';
import { economyMetricsCounters } from './http/economy_signals';

/**
 * How many pending rows the queue holds before it starts dropping. Sized for a
 * long database stall rather than a burst: at a realistic busy-realm rate of a
 * few hundred coin movements a second, this is minutes of headroom, which is
 * far longer than any healthy write takes to recover. Past that, the honest
 * outcome is a counted drop, not unbounded memory.
 */
export const LEDGER_QUEUE_MAX = 50_000;

/** Rows per INSERT. One statement per batch, sized so a flush stays well under
 *  the statement timeout even on a slow disk. */
export const LEDGER_BATCH_SIZE = 500;

/**
 * How long a mob's coin drops are held open for aggregation, in sim ticks.
 * Corpse coin arrives as one `mob_loot` event per party member on a fair split,
 * and a fast farmer generates a steady stream of them; folding the drops for
 * one corpse into one row per looter keeps the table proportional to KILLS
 * rather than to party size. Two ticks (100 ms) is long enough to catch the
 * split, short enough that nothing observable waits on it.
 */
export const CORPSE_AGGREGATION_TICKS = 2;

/** The SQL surface the writer needs, injected so tests use a fake. */
export interface GoldLedgerDeps {
  insertBatch(rows: readonly GoldLedgerInsert[]): Promise<number[]>;
  loadChainHeads(
    characterIds: readonly number[],
  ): Promise<Map<number, { id: number; balanceAfter: number }>>;
}

/** What the host knows about a movement that the sim cannot: the durable
 *  character id behind an entity id, the account, and the session. */
export type LedgerActorResolver = (
  pid: number,
) => { characterId: number; accountId: number | null; sessionId: string | null } | null;

export interface LedgerWriterOptions {
  realm: string;
  deps: GoldLedgerDeps;
  resolveActor: LedgerActorResolver;
  queueMax?: number;
  batchSize?: number;
}

/** Counters the /metrics exporter publishes and the reconciler reads. */
export interface LedgerWriterStats {
  queueDepth: number;
  droppedWrites: number;
  rowsWritten: number;
  failedFlushes: number;
  aggregatedCorpseRows: number;
}

// A queued row plus the chain bookkeeping the flush needs. `prevLedgerId` is
// filled at FLUSH time, not enqueue time, because a batch can contain several
// rows for one character and each must chain onto the one before it.
interface PendingRow {
  insert: GoldLedgerInsert;
}

/**
 * Split rows into ordered ROUNDS, each holding at most one CHAINED row per
 * character and preserving each character's original relative order.
 *
 * Exported pure so the property that matters is testable without a database:
 * round N holds every character's Nth purse row, so writing rounds in order
 * writes each character's rows in order, and every chained row can point at a
 * predecessor whose id is already known.
 *
 * Only PURSE rows consume a round slot. A pool row is never chained, so several
 * of them can share one statement: a market buy (one purse row, then two pool
 * rows) costs two rounds rather than three. They still land AFTER the purse row
 * they follow, because id order is read as movement order on the admin page and
 * collapsing them into round 0 would print the escrow filling before the debit
 * that filled it.
 */
export function splitIntoChainRounds(rows: readonly GoldLedgerInsert[]): GoldLedgerInsert[][] {
  const rounds: GoldLedgerInsert[][] = [];
  const seen = new Map<number, number>();
  for (const row of rows) {
    const n = seen.get(row.characterId) ?? 0;
    if (row.holder === 'purse') seen.set(row.characterId, n + 1);
    if (rounds[n] === undefined) rounds[n] = [];
    rounds[n].push(row);
  }
  return rounds;
}

// An open corpse-coin aggregation window for one looter.
interface CorpseWindow {
  row: GoldLedgerInsert;
  openedAtTick: number;
}

/**
 * The writer. One per realm process, constructed at boot and handed each tick's
 * drained event batch.
 */
export class LedgerWriter {
  private readonly realm: string;
  private readonly deps: GoldLedgerDeps;
  private readonly resolveActor: LedgerActorResolver;
  private readonly queueMax: number;
  private readonly batchSize: number;

  private queue: PendingRow[] = [];
  private inFlight: Promise<void> | null = null;
  // The chain head per character: the id of the last row written for them and
  // the balance it left. Seeded from the database on first sight of a character
  // after boot, so a restart continues the chain instead of restarting it at
  // NULL and blinding the chain check to the first movement after every deploy.
  private chain = new Map<number, { id: number; balanceAfter: number }>();
  private seeded = new Set<number>();
  // Open corpse-coin windows, keyed by character id.
  private corpse = new Map<number, CorpseWindow>();

  private droppedWrites = 0;
  private rowsWritten = 0;
  private failedFlushes = 0;
  private aggregatedCorpseRows = 0;

  constructor(opts: LedgerWriterOptions) {
    this.realm = opts.realm;
    this.deps = opts.deps;
    this.resolveActor = opts.resolveActor;
    this.queueMax = opts.queueMax ?? LEDGER_QUEUE_MAX;
    this.batchSize = opts.batchSize ?? LEDGER_BATCH_SIZE;
  }

  /**
   * Observe one tick's drained SimEvent batch. Synchronous and allocation-light
   * on the common path (a tick with no economy event does one type comparison
   * per event and allocates nothing), and it NEVER awaits: the flush is kicked
   * off fire-and-forget and the loop returns immediately.
   */
  observe(events: readonly SimEvent[], tick: number): void {
    try {
      for (const ev of events) {
        if (ev.type !== 'economy') continue;
        this.enqueueEconomyEvent(ev, tick);
      }
      this.expireCorpseWindows(tick);
    } catch (err) {
      // An observer must never fault the world loop. A throw here would take
      // the tick down over an audit-trail concern.
      this.failedFlushes += 1;
      console.error('gold_ledger observe failed:', err);
    }
    void this.flush();
  }

  private enqueueEconomyEvent(ev: Extract<SimEvent, { type: 'economy' }>, tick: number): void {
    const actor = this.resolveActor(ev.pid);
    // No durable character behind this pid: an offline or headless host, or a
    // sim-only test double. Nothing to write a row against, and inventing one
    // would put a fabricated character_id into a keep-forever table.
    if (!actor) return;
    const cp = flattenCounterparty(ev.counterparty);
    const insert: GoldLedgerInsert = {
      realm: this.realm,
      accountId: actor.accountId,
      characterId: actor.characterId,
      kind: ev.kind,
      holder: ev.holder,
      amount: ev.amount,
      balanceAfter: ev.balanceAfter,
      counterpartyKind: cp.kind,
      counterpartyId: cp.id,
      // Filled at flush time, where a character's rows are chained in order.
      prevLedgerId: null,
      simTick: ev.tick,
      zone: ev.zone,
      posX: ev.x,
      posZ: ev.z,
      sessionId: actor.sessionId,
    };
    if (this.tryAggregateCorpseCoin(insert, ev.kind, tick)) return;
    this.push(insert);
  }

  /**
   * Fold consecutive `mob_loot` credits for one looter into a single open row.
   *
   * Only `mob_loot`, and only additively: the window carries the RUNNING total
   * and the LATEST balance_after, so the folded row still states a true purse
   * balance and the chain stays intact. Any other kind for that character
   * closes the window first (below), so a loot credit and a vendor sale can
   * never merge into one unattributable row.
   */
  private tryAggregateCorpseCoin(
    insert: GoldLedgerInsert,
    kind: EconomyEventKind,
    tick: number,
  ): boolean {
    const open = this.corpse.get(insert.characterId);
    if (kind !== 'mob_loot') {
      // A different movement for this character: the window's ordering
      // guarantee is gone, so land it before the new row goes in.
      if (open) {
        this.corpse.delete(insert.characterId);
        this.push(open.row);
      }
      return false;
    }
    if (!open) {
      this.corpse.set(insert.characterId, { row: insert, openedAtTick: tick });
      return true;
    }
    open.row.amount += insert.amount;
    // The LATEST balance, not the first: the folded row must describe the purse
    // as it stands after every drop it represents, or the chain check fails on
    // the very next row.
    open.row.balanceAfter = insert.balanceAfter;
    open.row.simTick = insert.simTick;
    open.row.posX = insert.posX;
    open.row.posZ = insert.posZ;
    open.row.zone = insert.zone;
    this.aggregatedCorpseRows += 1;
    return true;
  }

  // Land every corpse window older than the aggregation budget.
  private expireCorpseWindows(tick: number): void {
    if (this.corpse.size === 0) return;
    for (const [characterId, w] of this.corpse) {
      if (tick - w.openedAtTick < CORPSE_AGGREGATION_TICKS) continue;
      this.corpse.delete(characterId);
      this.push(w.row);
    }
  }

  // The bounded enqueue. An overflow drops the NEW row and counts it: dropping
  // the oldest instead would silently corrupt the chain of whichever character
  // it belonged to, and a chain hole reads as a dupe to the reconciler.
  private push(insert: GoldLedgerInsert): void {
    if (this.queue.length >= this.queueMax) {
      this.droppedWrites += 1;
      economyMetricsCounters().ledgerWritesDropped(1);
      return;
    }
    this.queue.push({ insert });
  }

  /**
   * Drain the queue until it is empty.
   *
   * Returns the IN-FLIGHT drain when one is already running rather than
   * returning immediately. An early return would be a correctness trap for
   * every caller that awaits a flush before reading stats or asserting on
   * rows: the work would still be in progress, so the caller would observe a
   * half-written queue and conclude the writer had lost data. The world loop
   * does not await this at all (it calls it fire-and-forget through observe),
   * so sharing one promise costs the loop nothing.
   */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.queue.length === 0) return Promise.resolve();
    // Cleared inside the runner's own finally so a rejection can never leave a
    // permanently-latched promise that blocks every later flush.
    this.inFlight = this.runFlush();
    return this.inFlight;
  }

  private async runFlush(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        await this.seedChainFor(batch);
        // Split the batch into ROUNDS, each holding at most one row per
        // character. This is what makes prev_ledger_id honest: ids come back
        // from RETURNING, so a second row for the same character in the SAME
        // statement cannot know the id of the first, and guessing it (first id
        // plus offset) is wrong the moment another realm's insert interleaves
        // sequence values. Rounds cost one extra statement per repeat depth,
        // which is 2 or 3 in practice (a trade is two rows, a market buy is
        // three) and 1 for the overwhelmingly common single-movement batch.
        for (const round of splitIntoChainRounds(batch.map((b) => b.insert))) {
          await this.writeRound(round);
        }
      }
    } finally {
      this.inFlight = null;
    }
  }

  // One statement's worth of rows, at most one CHAINED row per character.
  private async writeRound(rows: GoldLedgerInsert[]): Promise<void> {
    for (const row of rows) {
      // A pool row is booked against the actor but describes a holding area, so
      // it joins no chain: giving it a predecessor would make the actor's next
      // purse row chain through a balance that is not a purse.
      if (row.holder !== 'purse') {
        row.prevLedgerId = null;
        continue;
      }
      const head = this.chain.get(row.characterId);
      row.prevLedgerId = head ? head.id : null;
    }
    let ids: number[] = [];
    try {
      ids = await this.deps.insertBatch(rows);
    } catch (err) {
      // A rejected batch is a HOLE in a keep-forever audit trail. Counted as a
      // drop (the reconciler must know its evidence is incomplete) rather than
      // retried: a retry against a database that just refused the write would
      // most likely fail the same way while the queue behind it keeps growing.
      this.failedFlushes += 1;
      this.droppedWrites += rows.length;
      const metrics = economyMetricsCounters();
      metrics.ledgerFlushFailed();
      metrics.ledgerWritesDropped(rows.length);
      console.error('gold_ledger batch insert failed:', err);
      // The chain heads for these characters may now be wrong, so forget them:
      // the next write re-seeds from the database and lands a NULL prev at
      // worst, which reads as "chain start", never as a false break.
      for (const row of rows) {
        this.chain.delete(row.characterId);
        this.seeded.delete(row.characterId);
      }
      return;
    }
    this.rowsWritten += ids.length;
    const metrics = economyMetricsCounters();
    metrics.ledgerRowsWritten(ids.length);
    for (let i = 0; i < rows.length; i++) {
      const id = ids[i];
      const row = rows[i];
      if (id === undefined) continue;
      // Booked from the WRITTEN row, not the observed event: a movement the
      // writer dropped must not appear in the flow totals, or the metrics would
      // claim coin the ledger has no record of.
      metrics.goldMovement(row.kind as EconomyEventKind, row.amount);
      // Pool rows never advance the head: the chain is a purse's history, and a
      // pool balance parked there would be the predecessor of the character's
      // next real movement.
      if (row.holder !== 'purse' || row.balanceAfter === null) continue;
      this.chain.set(row.characterId, { id, balanceAfter: row.balanceAfter });
    }
  }

  // Seed chain heads for characters this process has not written for yet.
  private async seedChainFor(batch: readonly PendingRow[]): Promise<void> {
    const need: number[] = [];
    for (const p of batch) {
      const id = p.insert.characterId;
      if (this.seeded.has(id)) continue;
      this.seeded.add(id);
      need.push(id);
    }
    if (need.length === 0) return;
    try {
      const heads = await this.deps.loadChainHeads(need);
      for (const [characterId, head] of heads) this.chain.set(characterId, head);
    } catch (err) {
      // A failed seed means those characters start at a NULL prev, which reads
      // as "chain start" and is a false negative for one row, never a false
      // positive. Un-mark them so a later batch tries again.
      for (const id of need) this.seeded.delete(id);
      console.error('gold_ledger chain seed failed:', err);
    }
  }

  /** Land every open corpse window immediately, for shutdown and for tests. */
  closeAllCorpseWindows(): void {
    for (const [characterId, w] of this.corpse) {
      this.corpse.delete(characterId);
      this.push(w.row);
    }
  }

  /** Flush everything and settle, for graceful shutdown and deterministic tests. */
  async drain(): Promise<void> {
    this.closeAllCorpseWindows();
    await this.flush();
  }

  stats(): LedgerWriterStats {
    return {
      queueDepth: this.queue.length,
      droppedWrites: this.droppedWrites,
      rowsWritten: this.rowsWritten,
      failedFlushes: this.failedFlushes,
      aggregatedCorpseRows: this.aggregatedCorpseRows,
    };
  }
}
