// The bounded lifecycle between an account's LIVE freehold record and its
// DURABLE row: single-flight loading, one-running-plus-one-pending write
// coalescing, reference-counted eviction, a bounded shutdown drain, and the
// counters a scrape reads. It owns no SQL and mutates no sim state of its own:
// every side effect is an injected port (the row reader and writer in
// server/freehold_db.ts, the hearth clock in server/freehold_hearth_db.ts, the
// sim's serialize hook, the shared background gate, the per-key FIFO), so a
// Vitest drives the whole store with no database and no GameServer. The
// composition root reaches the live store through registerFreeholdPersistStore
// and freeholdPersistIdle (the server/unstuck_records.ts shape), never by
// reaching into the coordinator. The bindings themselves, and therefore every
// SQL import, live in server/freehold_persist_wiring.ts: this file names its
// ports and nothing else supplies them.
//
// TWO INVARIANTS A FUTURE READER MUST NOT BREAK.
//
// 1. A LOAD THAT DID NOT PRODUCE A TRUSTED ROW LEAVES THE ROW ALONE, FOR THE
//    LIFE OF THE ENTRY. An unsupported, malformed, oversize or unadmitted row,
//    a load the permit or the local cap refused, and an entry whose durable
//    read has not finished yet are all WRITE-BLOCKED: save() refuses,
//    saveAllDirty() skips, flushAndRelease() writes nothing, and the row on
//    disk stays byte for byte as it was. The owner's furnishings and trophies
//    are in that row and the sim seeds a free default record for anyone who
//    holds none, so a write from a blocked entry would overwrite real
//    possessions with an empty Inn Room, and nothing else in this realm holds
//    a second copy to recover them from. Fail closed, always.
//
// 2. THE KEY'S FIFO FIRST, THEN THE PERMIT, NEVER THE REVERSE (the two
//    deadlock rules in server/serial_writer.ts). A closure that holds a
//    background permit while it waits for its key's FIFO deadlocks at a gate
//    capacity of one: the write running ahead of it cannot finish without the
//    permit the waiter is sitting on. Both waits are bounded (the permit wait
//    by AbortSignal.timeout), and a refused permit is a REFUSAL, never a
//    fall-through to doing the work unadmitted.

import { boundedFreeholdDetail, freeholdLoadDiagnostic } from '../src/sim/freehold/load_report';
import {
  freeholdPlotIdAdmitted,
  freeholdWriteRefusal,
  type PersistedFreehold,
} from '../src/sim/freehold/persisted';
// BY PATH, like the persistence leaf above, and for the same reason
// src/sim/freehold/index.ts gives: this module is the server-side durable
// consumer, so it reaches the leaf it needs rather than pulling the directory's
// whole public surface into a server graph. Named here because this name IS on
// the barrel, so without a reason a later reader cannot tell the deliberate
// exception from drift.
import { PENDING_FREEHOLD_PLOT_ID } from '../src/sim/freehold/state';
import { boundedDatabaseError } from './freehold_bounded_error';
import { createFreeholdCapacityWarn } from './freehold_capacity_warn';
import { FREEHOLD_GENERATION_TEXT_RE } from './freehold_claim_db';
import { FREEHOLD_PRIMARY_PLOT_INDEX, type FreeholdFencedUpsertResult } from './freehold_db';
import {
  ABSENT_HEARTH_REVISION,
  adoptFreeholdHearthReading,
  COLD_HEARTH,
  readFreeholdLoginPair,
  settleFreeholdHearthReading,
} from './freehold_hearth_load';
import { freeholdJoinAnswer } from './freehold_join_answer';
import {
  FREEHOLD_ABSENT_DURABLE_REV,
  type FreeholdRecoveryHold,
  freeholdBudgetRefusal,
  freeholdHoldAnswer,
  freeholdHoldIsTerminal,
  freeholdLoadedAnswer,
  freeholdRereadsLostClaim,
  type LoadedFreehold,
  freeholdSnapshotOf as snapshotOf,
} from './freehold_load_outcome';
import {
  FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS,
  type FreeholdPreloadOptions,
  freeholdPreloadBudgetMs,
} from './freehold_login_bounds';
import {
  FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_FLUSH_MAX_PASSES,
  FREEHOLD_PERSIST_LEAVE_FLUSH_MS,
  FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE,
  FREEHOLD_PERSIST_MAX_ACTIVE_LOADS,
  FREEHOLD_PERSIST_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES,
  FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS,
} from './freehold_persist_bounds';
import {
  censusFreeholdEntries,
  createFreeholdPersistCounters,
  type FreeholdPersistStats,
  freeholdPersistStatsOf,
} from './freehold_persist_stats';
import type {
  FreeholdPersistEntry,
  FreeholdPersistPorts,
  FreeholdPersistStore,
} from './freehold_persist_types';
import { freeholdRevisionMoved } from './freehold_revision_probe';
import { representableRev, rowDocument } from './freehold_row_document';
import { freeholdOwnerKeyForAccount } from './freehold_wire';
import {
  FREEHOLD_PERSIST_MAX_WRITE_ERRORS,
  FREEHOLD_PERSIST_RETRY_WRITE_CAP,
  FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS,
  freeholdRetryDue,
  freeholdThrownWriteIsAnswer,
  noteThrownWrite,
} from './freehold_write_retry';
import { insertWouldMintAnUnnamedRow, seedWouldLandOnRealRow } from './freehold_write_seal';

// THE LOAD-OUTCOME VOCABULARY (the failure kinds, which of them are repairable,
// FreeholdRecoveryHold and LoadedFreehold) moved WHOLE to
// server/freehold_load_outcome.ts. None of it needs this file: it is the shape
// the join path consumes and the metric series walks. RE-EXPORTED rather than
// repointed at a dozen call sites, because the store IS where a reader looks for
// them and a type-only hop costs nothing at runtime.
export {
  FREEHOLD_ABSENT_DURABLE_REV,
  FREEHOLD_LOAD_FAILURE_KINDS,
  FREEHOLD_RETRYABLE_HOLD_KINDS,
  type FreeholdRecoveryHold,
  type LoadedFreehold,
} from './freehold_load_outcome';

// The three LOGIN-path bounds (the permit wait, the statement bound and the
// whole-preload budget, one per handshake) live in server/freehold_login_bounds.ts.
export {
  FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS,
  FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
  FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS,
} from './freehold_login_bounds';
// The write-side and lifecycle bounds, with their reasoning, live in
// server/freehold_persist_bounds.ts, re-exported so every importer stands.
export {
  FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_FLUSH_MAX_PASSES,
  FREEHOLD_PERSIST_LEAVE_FLUSH_MS,
  FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE,
  FREEHOLD_PERSIST_MAX_ACTIVE_LOADS,
  FREEHOLD_PERSIST_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES,
  FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS,
  FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS,
} from './freehold_persist_bounds';
// The counters a scrape reads: server/freehold_persist_stats.ts.
export type { FreeholdPersistStats } from './freehold_persist_stats';

// The store's ports, its public face and the login port's clock answer live
// in server/freehold_persist_types.ts, re-exported so every importer stands.
export type {
  FreeholdHearthAnswer,
  FreeholdPersistPorts,
  FreeholdPersistStore,
} from './freehold_persist_types';
// The thrown-write run's two constants and its retry clock (R1) live in
// server/freehold_write_retry.ts, re-exported so every importer stands.
export {
  FREEHOLD_PERSIST_MAX_WRITE_ERRORS,
  FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS,
} from './freehold_write_retry';

// Bound at the module edge, the server/unstuck_records.ts REAL_DEPS shape, so
// the store body itself never names a wall clock or a timer.
const realScheduleDeadline = (callback: () => void, ms: number): (() => void) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

export function createFreeholdPersistStore(ports: FreeholdPersistPorts): FreeholdPersistStore {
  const entries = new Map<string, FreeholdPersistEntry>();
  const inFlightLoads = new Map<number, Promise<LoadedFreehold>>();
  /** Owners that wanted a write while the local write cap was full. They stay
   *  DIRTY, so nothing is lost: they are launched as slots free, and by the
   *  next sweep if the process is still up. Insertion-ordered, so the owner
   *  that waited longest goes first. */
  const deferredWrites = new Set<FreeholdPersistEntry>();
  /** The SUBSET of deferredWrites holding a leave capture, kept so the pump can
   *  prefer a leaver in O(1) rather than scanning the whole deferred set on
   *  every admission. Scanning made the shutdown drain quadratic in the deferred
   *  count: `pumpLoop` asks twice per settle, once to admit and once to discover
   *  the cap is full, and at five thousand deferred owners that is millions of
   *  iterations to answer a question the insertion order used to answer at once.
   *  Every deferredWrites mutation below keeps this in step. */
  const deferredLeavers = new Set<FreeholdPersistEntry>();
  /** Retry-clock writes waiting on their sub-cap or the write cap: their own set,
   *  pumped AFTER the ordinary one, so a slow fault never holds every slot. */
  const deferredRetries = new Set<FreeholdPersistEntry>();
  let activeWrites = 0;
  let activeRetries = 0;
  /** idle() calls not yet finished: the clock's drain exception lasts this long. */
  let openDrains = 0;
  /** Throws on the clock since the last sweep, reported as ONE line per sweep. */
  let retryThrows = 0;
  let lastRetryError: Record<string, unknown> | undefined;
  /** Documents captured at leave and not yet written. Each is a SECOND full
   *  record on top of entry.state, so at the approved 420-row ceiling a
   *  thousand simultaneous dirty logouts retain 66.2 MiB until their writes
   *  land. Bounded by the number of dirty leavers, and published, because a
   *  retention that only shows up in a heap dump is not a bound. */
  let leaveCaptures = 0;
  const scheduleDeadline = ports.scheduleDeadline ?? realScheduleDeadline;
  let activeLoads = 0;
  let intake = true;
  // Every outstanding idle() call. A set rather than one slot so a second
  // drain (a supervised restart racing a test teardown) can never orphan the
  // first one's deadline timer.
  const drainWaiters = new Set<{ finish(drained: boolean): void }>();
  // The cumulative counters, each with its reason, in freehold_persist_stats.ts.
  const counters = createFreeholdPersistCounters();

  // Capacity-kind hold lines, one per kind per window (freehold_capacity_warn.ts).
  const capacityWarn = createFreeholdCapacityWarn(
    (line) => ports.warn(line),
    () => ports.nowMs(),
  );

  const isDirty = (entry: FreeholdPersistEntry): boolean =>
    entry.dirtyGeneration > entry.committedGeneration;

  /**
   * The periodic sweep's dirty detector, so a record that moved without a
   * markDirty call still reaches the row. The live record carries its own
   * revision and every sanctioned writer bumps it (setFreeholdTier is the one
   * that exists today, and the development grant reaches the record through
   * it). Callers that want promptness still call markDirty; this closes the gap
   * for a writer that has no server-side hook.
   *
   * The DECISION and every arm of it are in server/freehold_revision_probe.ts.
   * What stays here belongs to the store: the blocked check in front (a blocked
   * entry must not write, so knowing it moved buys nothing) and the generation
   * and age stamp behind.
   *
   * It reads ONE INTEGER per loaded owner, never a clone. Not a
   * micro-optimization: this runs synchronously inside the 20 Hz loop body
   * (runPeriodicSaveFlush is documented as having to return synchronously), so
   * cloning every loaded record here would put O(owners x layout rows) of
   * copying and garbage on one tick every thirty seconds. Measured at the
   * approved 420-row ceiling, the clone shape cost tens of milliseconds per
   * sweep at five thousand owners against a fifty millisecond tick budget.
   * serialize() stays inside runWrite, where the result is the thing written.
   */
  const noteRevisionMoved = (entry: FreeholdPersistEntry): boolean => {
    if (blocked(entry)) return false;
    if (!freeholdRevisionMoved(ports.liveRev(entry.ownerKey), entry)) return false;
    entry.dirtyGeneration++;
    if (entry.dirtySinceMs === 0) entry.dirtySinceMs = ports.nowMs();
    return true;
  };

  const isHeld = (entry: FreeholdPersistEntry): boolean => entry.hold !== null || entry.quiesced;

  // Invariant 1 in one predicate: an entry that is held, quiesced, or has not
  // finished a durable read may not write.
  const blocked = (entry: FreeholdPersistEntry): boolean => !entry.loaded || isHeld(entry);

  // R1: may a write be ARMED for this entry now (always, off the retry clock).
  const retryDue = (entry: FreeholdPersistEntry): boolean =>
    entry.retryAtMs === 0 || freeholdRetryDue(entry.retryAtMs, ports.nowMs(), openDrains > 0);

  const live = (entry: FreeholdPersistEntry): boolean => entries.get(entry.ownerKey) === entry;

  function ensureEntry(ownerKey: string, accountId: number): FreeholdPersistEntry {
    // ONE ACCOUNT, not two. The row is selected by `entry.accountId` while the
    // document comes from `ports.serialize(entry.ownerKey)`, so a mismatched
    // pair would compare-and-swap one account's house onto another's row, and
    // because the swap never touches plot_id the loss would be invisible in the
    // key. Every caller today derives both from one authenticated account id, so
    // this is the check that keeps that a property rather than a convention.
    if (accountId > 0 && ownerKey !== freeholdOwnerKeyForAccount(accountId)) {
      throw new Error('freehold owner key and account id name different accounts');
    }
    const existing = entries.get(ownerKey);
    if (existing) {
      if (accountId > 0) existing.accountId = accountId;
      return existing;
    }
    const created: FreeholdPersistEntry = {
      ownerKey,
      accountId,
      plotIndex: FREEHOLD_PRIMARY_PLOT_INDEX,
      plotId: '',
      durableRev: null,
      state: null,
      loaded: false,
      hold: null,
      quiesced: false,
      quiesceWarned: false,
      hearthReadyAtMs: 0,
      hearthRevision: ABSENT_HEARTH_REVISION,
      leaveDocument: null,
      writeErrors: 0,
      lastWriteErrorMs: 0,
      retryAtMs: 0,
      retryInFlight: false,
      refs: 0,
      dirtyGeneration: 0,
      committedGeneration: 0,
      snapshotGeneration: Number.POSITIVE_INFINITY,
      snapshotRev: null,
      dirtySinceMs: 0,
      orphanPasses: 0,
      running: false,
      pending: false,
      chain: null,
      settleWaiters: [],
    };
    entries.set(ownerKey, created);
    return created;
  }

  const readInFlight = (accountId: number): boolean =>
    accountId > 0 && inFlightLoads.has(accountId);
  /**
   * ONE predicate for "this entry still owes durable work", shared by BOTH
   * removal paths. They used to differ: maybeRemove checked the deferred set
   * but not dirtiness, and the orphan sweep checked dirtiness but not the
   * deferred set. Either omission drops a save. The concrete sequence for the
   * first one: a write is launched and waiting on a saturated gate, the player
   * logs out, the flush arms nothing new and times out, then the permit wait
   * expires and settle runs without re-arming, at which point maybeRemove would
   * delete a still-dirty entry and the edits are gone with only a warn.
   *
   * A BLOCKED entry owes nothing: it is held or quiesced and may not write, so
   * keeping it dirty forever would be a leak rather than a rescue.
   *
   * THREE OF THE FIVE CLAUSES ARE REDUNDANT TODAY, not one, and a mutation pass
   * establishes which: dropping `running`, `pending` or the deferred set alone
   * leaves the suite green, while dropping the in-flight-load clause or the
   * dirty clause fails it. All three are redundant for the same reason, that
   * today's arming rules make an entry that is running, pending or deferred
   * also dirty and unblocked, so the last clause already covers them. They are
   * kept, and named here rather than one of them, because each says what its
   * own state MEANS rather than what the current arithmetic happens to imply,
   * and because the equality is a property of arm() that arm() does not
   * declare.
   */
  const owesWork = (entry: FreeholdPersistEntry): boolean =>
    entry.running ||
    // A durable read in flight will call ensureEntry again when it lands, so
    // removing the entry now only resurrects it at zero references, which is
    // the same "entry went missing under a live session" class that retain's
    // reload exists to repair. It belongs in the SHARED predicate, or the
    // unification is only half true.
    readInFlight(entry.accountId) ||
    entry.pending ||
    deferredWrites.has(entry) ||
    deferredRetries.has(entry) ||
    (isDirty(entry) && !blocked(entry));
  const rereadsLostClaim = (entry: FreeholdPersistEntry, accountId: number): boolean =>
    freeholdRereadsLostClaim(
      {
        durableRev: entry.durableRev,
        held: isHeld(entry),
        writeOwed: entry.running || entry.pending || deferredWrites.has(entry),
        retrying: deferredRetries.has(entry),
        dirty: isDirty(entry),
        leaveCaptured: entry.leaveDocument !== null,
        readInFlight: readInFlight(accountId),
      },
      () => ports.claimHeld?.(entry.plotId) ?? true,
    );
  // NOT a clause of its own for the retained leave document, deliberately:
  // `settle` clears the capture only when the entry NO LONGER owes work, so a
  // `leaveDocument !== null` clause here would make the capture its own reason
  // to be kept and it could never be released. The accounting gap it was
  // reaching for is closed at the two DELETE sites, through releaseCapture.

  /** Drop a retained leave document and its accounting together. `leave_captures`
   *  is the ONLY published bound on that retention, and a bound that can only
   *  climb is not one: an entry deleted while it still held a capture would take
   *  the document with it and leave the gauge one higher forever.
   *
   *  AT BOTH DELETE SITES, AND DEFENSIVELY THERE. No sequence has been built
   *  that reaches either delete holding a capture, and the argument is short:
   *  `flushAndRelease` captures only for an unblocked entry, every route from
   *  there to `!owesWork(entry)` runs through `settle`, which releases first,
   *  and a deferred entry cannot become blocked while deferred because `blocked`
   *  only flips inside a running write and `arm` never defers a running one. The
   *  calls stay because the coincidence is a property of three separate rules
   *  and this makes it a guarantee, but they are not repairs and no test can
   *  reach them. */
  function releaseCapture(entry: FreeholdPersistEntry): void {
    if (entry.leaveDocument === null) return;
    leaveCaptures--;
    entry.leaveDocument = null;
    // It is no longer a leaver, whatever set it is still sitting in.
    deferredLeavers.delete(entry);
  }

  function maybeRemove(entry: FreeholdPersistEntry): void {
    if (entry.refs > 0 || owesWork(entry)) return;
    if (live(entry)) {
      releaseCapture(entry);
      entries.delete(entry.ownerKey);
    }
  }

  /**
   * Collect entries no session refers to any more. MARK AND SWEEP rather than
   * immediate removal: preload resolves before the join calls retain(), so an
   * entry legitimately sits at zero references for the width of a handshake,
   * and removing it there would hand the joining session a fresh unloaded entry
   * that can never write. One pass marks, the next collects.
   *
   * Nothing dirty, running, pending or mid-load is ever collected: those are
   * the states in which the entry still owes a durable write or is about to be
   * filled in. A collected entry loses only cached knowledge, and the next
   * login reads the row again.
   */
  function sweepOrphans(): void {
    // Iterated DIRECTLY, not over a copy: deleting the current key during a Map
    // iteration is well defined, and the copy allocated an N-pointer array
    // inside the tick body (measured 42.6 KiB per sweep at five thousand
    // owners) for nothing.
    for (const entry of entries.values()) {
      if (entry.refs > 0 || owesWork(entry)) {
        // UNFALSIFIABLE, and kept: no behaviour test isolates this reset,
        // because every path out of "owes work" at zero references removes the
        // entry through maybeRemove on the spot, and retain resets the count
        // itself for the referenced case. It states that the grace period
        // counts CONSECUTIVE passes rather than passes in total, which is what
        // the constant beside it means; dropping it would leave the count a
        // lifetime tally that collects an entry a whole grace period early the
        // first time one becomes collectable by some future path.
        entry.orphanPasses = 0;
        continue;
      }
      entry.orphanPasses++;
      // DRIVEN BY THE CONSTANT, so the documented grace period and the code
      // cannot drift: a constant the implementation never reads is a comment
      // wearing an export's clothes.
      if (entry.orphanPasses < FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES) continue;
      if (live(entry)) {
        releaseCapture(entry);
        entries.delete(entry.ownerKey);
      }
    }
  }

  function holdResult(
    entry: FreeholdPersistEntry,
    hold: FreeholdRecoveryHold,
    hearth: { readyAtMs: number; revision: string },
  ): LoadedFreehold {
    // WHICH KINDS LEAVE THE ENTRY LOADED, and why a hold is terminal for some
    // causes and repairable for others, is in server/freehold_load_outcome.ts
    // beside the sets it decides from. What stays here is the entry the store
    // owns, its counters and the operator line.
    entry.loaded = freeholdHoldIsTerminal(hold.kind);
    entry.hold = hold;
    entry.plotIndex = hold.plotIndex;
    counters.loadFailures++;
    // Per KIND, because the causes demand different operator responses; the
    // vocabulary module carries the full split.
    counters.loadFailuresByKind[hold.kind] = (counters.loadFailuresByKind[hold.kind] ?? 0) + 1;
    capacityWarn(
      hold.kind,
      !freeholdHoldIsTerminal(hold.kind),
      `freehold plot index ${hold.plotIndex} held (${hold.kind}): ${hold.detail}; the durable row is left untouched`,
    );
    return freeholdHoldAnswer(entry, hold, hearth);
  }

  // The two login reads (one client when the host offers one; a clock that
  // cannot be read starts cold): server/freehold_hearth_load.ts.
  async function classify(accountId: number, ownerKey: string): Promise<LoadedFreehold> {
    // One permit covers both reads, so they run in sequence: two concurrent
    // queries would be two pool checkouts against one admission.
    // The STORED ceiling, not the canonical one: the SQL bound measures the
    // text PostgreSQL renders back out of jsonb, which is wider than the JSON
    // that went in. Handing it FREEHOLD_MAX_OWNED_BYTES would refuse the
    // maximal record this realm is allowed to write.
    const { rowLoad, hearth: read } = await readFreeholdLoginPair(ports, accountId);
    const entry = ensureEntry(ownerKey, accountId);
    // Remembered on the entry for every replay; a re-read moves it forward only.
    const hearth = settleFreeholdHearthReading(entry, read);

    if (rowLoad.kind === 'absent') {
      // No durable row: the sim's default record IS the truth, and this store
      // persists it under one freshly minted plot id. Never a second default,
      // never a second tier.
      entry.loaded = true;
      entry.hold = null;
      entry.plotIndex = FREEHOLD_PRIMARY_PLOT_INDEX;
      // MINT ONCE PER ENTRY, an unreachable defence rather than a live guard:
      // this arm runs at most once per entry (beginLoad is single-flight per
      // account, a later preload replays a loaded entry, and the lost-claim
      // re-read reaches only an entry whose row exists, which leaves only with
      // its account). A mutation pass confirms it: minting unconditionally
      // leaves the suite green. It stays because the alternative failure is a
      // second identity on a row that already has one, named here so a later
      // reader neither deletes it nor tests a state the store cannot produce.
      //
      // PER ENTRY IS NOT PER OWNER, which is why the live record is consulted
      // first. An entry collected while its record is still live (a blocked
      // entry released by its session's leave, before that session's
      // removePlayer) is recreated by the next handshake's read beside that
      // record with a row that is still absent; minting there gives the ROW a
      // second identity while the record keeps answering to the first. The
      // record's identity is the one every consumer already sees and the one the
      // wire echoes back, so the row adopts it.
      //
      // A STAND-IN IS NOT AN IDENTITY TO ADOPT, AND IT IS NOT ONE TO MINT OVER
      // EITHER. A live record carrying the stand-in was seeded WITHOUT an
      // install (installLoadedFreehold returns early on any hold), and
      // loadFreehold is load-once, so nothing can ever teach that record the
      // name a row would be created under. Minting one anyway is the state
      // ruling 1 exists to remove, arrived at from the other side: the row would
      // carry a name its own record never learns, applyWriteResult would cache
      // the record's stand-in, and the seal's name comparison would be inert by
      // value equality for the life of that entry, which is the eighth path.
      // Both new arms produce this state (an admission hold whose entry is now
      // re-read, and the whole-preload cap's in-flight read landing behind its
      // refusal), so it is refused HERE, once, rather than guarded in each.
      //
      // TERMINAL for this entry, because nothing in the session can change it.
      // NO DURABLE ROW IS LOST, which is not the same as costing nothing and was
      // stated as if it were: there is no row to preserve, so the invariant is
      // safe, but this session's edits are discarded at logout exactly as any
      // other hold's are, with a counter as the only observer. That is the trade
      // ruling 2's repairability is spent on for an account with no row, and it
      // is the population C23's player-facing surface exists for. The NEXT login
      // builds a fresh entry whose install runs before the seed, and it is named
      // from the start.
      //
      // AND IT IS NOT TOTAL: this test reads the LIVE RECORD, so it fires only
      // once something has been SEEDED. Two orderings used to put the mint
      // before the seed (a budget-refused login's read landing before its
      // `addPlayer`, and a sibling riding the same read), and ruling (b) closes
      // both at the install: the join installs from the entry that read filled,
      // so the record carries the minted name. What makes the invariant total
      // whatever the order is still `insertWouldMintAnUnnamedRow`, which compares
      // the identity at the moment the row would be created; this arm stays
      // because refusing at LOAD time is cheaper and diagnoses better.
      const liveName = ports.livePlotId(ownerKey);
      if (liveName === PENDING_FREEHOLD_PLOT_ID) {
        return holdResult(
          entry,
          {
            kind: 'unnamed_record',
            detail: 'the live record was seeded before this load landed',
            plotIndex: FREEHOLD_PRIMARY_PLOT_INDEX,
            durableRev: FREEHOLD_ABSENT_DURABLE_REV,
          },
          hearth,
        );
      }
      if (entry.plotId === '') {
        entry.plotId =
          liveName !== null && freeholdPlotIdAdmitted(liveName) ? liveName : ports.mintPlotId();
      }
      entry.durableRev = null;
      entry.state = null;
      return freeholdLoadedAnswer(accountId, entry, hearth);
    }

    if (rowLoad.kind === 'oversize') {
      if (rowLoad.detoastRefused) counters.preGateRefusals++;
      return holdResult(
        entry,
        {
          kind: 'oversize',
          // Two different measures, named as such: past the on-disk pre-gate
          // the stored text was never rendered, so reporting a text length
          // there would be a number nothing took.
          // THROUGH THE BOUND, like its unadmitted sibling ten lines below and
          // for the same reason: this detail is built HERE from row-derived
          // columns, never by the sim's reporter, so nothing else stands
          // between it and an operator log. Both shapes are named in
          // KNOWN_DETAILS, so a real measurement still prints.
          detail: boundedFreeholdDetail(
            rowLoad.detoastRefused
              ? `${rowLoad.diskBytes} on-disk bytes past the pre-gate, so the ${rowLoad.limit} byte stored limit was never measured`
              : `${rowLoad.bytes} owned bytes over the ${rowLoad.limit} byte limit`,
          ),
          plotIndex: rowLoad.plotIndex,
          durableRev: rowLoad.durableRev,
        },
        hearth,
      );
    }

    if (rowLoad.kind === 'claim_busy') {
      // 07a: another realm holds this plot's live claim, so the row was never
      // read and nothing installs or writes. REPAIRABLE: the next login asks
      // again, and the claim frees when that realm lets go or expires.
      return holdResult(
        entry,
        {
          kind: 'claim_busy',
          detail: 'another realm holds this plot',
          plotIndex: rowLoad.plotIndex,
          durableRev: FREEHOLD_ABSENT_DURABLE_REV,
        },
        hearth,
      );
    }

    if (rowLoad.kind === 'unadmitted') {
      return holdResult(
        entry,
        {
          kind: 'unadmitted',
          // THROUGH THE BOUND, because this detail is built in another module
          // from a row's own plot_index. The reporter is not the only route to a
          // log, so the bound is applied where the producer is outside this file.
          detail: boundedFreeholdDetail(rowLoad.detail),
          plotIndex: rowLoad.plotIndex,
          durableRev: rowLoad.durableRev,
        },
        hearth,
      );
    }

    const row = rowLoad.row;
    if (!representableRev(row.wireRev)) {
      // Held, never repaired. See representableRev.
      return holdResult(
        entry,
        {
          kind: 'malformed',
          detail: 'wire_rev_shape',
          plotIndex: row.plotIndex,
          durableRev: row.durableRev,
        },
        hearth,
      );
    }
    const normalized = ports.normalize(rowDocument(row));
    if (normalized.kind === 'loaded') {
      if (normalized.repaired.length > 0) {
        // Through the sim's own reporter, so the bound that decides what may
        // reach a log lives in ONE place. Hand-building the line here would
        // route around it.
        const repaired = freeholdLoadDiagnostic(normalized);
        ports.warn(
          `freehold plot index ${row.plotIndex} loaded with ${repaired?.detail ?? 'repairs'}`,
        );
      }
      entry.loaded = true;
      entry.hold = null;
      entry.plotIndex = row.plotIndex;
      entry.plotId = row.plotId;
      entry.durableRev = row.durableRev;
      entry.state = normalized.state;
      return freeholdLoadedAnswer(accountId, entry, hearth);
    }

    // The DETAIL comes from the sim's reporter, never from this module. Its
    // whole job is a POSITIVE shape bound on what may reach a log, and a
    // hand-built string here would pass a corrupt row's own text straight
    // through it, which is the unbounded-bytes problem wearing a log costume.
    const diagnostic = freeholdLoadDiagnostic(normalized);
    const detail = diagnostic?.detail ?? 'a durable row normalized to absent';
    const kind: FreeholdRecoveryHold['kind'] =
      normalized.kind === 'unsupported'
        ? 'unsupported'
        : normalized.kind === 'oversize'
          ? 'oversize'
          : 'malformed';
    return holdResult(
      entry,
      { kind, detail, plotIndex: row.plotIndex, durableRev: row.durableRev },
      hearth,
    );
  }

  function refuse(
    accountId: number,
    ownerKey: string,
    // The CAUSE, not the class. Every one of these is an admission refusal, and
    // an operator's response to each is different, so they must not share the
    // row-level label.
    kind: 'cap_full' | 'no_permit' | 'read_threw',
    detail: string,
  ): LoadedFreehold {
    const entry = ensureEntry(ownerKey, accountId);
    return holdResult(
      entry,
      {
        kind,
        detail,
        plotIndex: FREEHOLD_PRIMARY_PLOT_INDEX,
        durableRev: FREEHOLD_ABSENT_DURABLE_REV,
      },
      COLD_HEARTH,
    );
  }

  async function loadOnce(accountId: number, ownerKey: string): Promise<LoadedFreehold> {
    counters.loads++;
    if (activeLoads >= FREEHOLD_PERSIST_MAX_ACTIVE_LOADS) {
      return refuse(accountId, ownerKey, 'cap_full', 'the local load admission cap is full');
    }
    activeLoads++;
    try {
      const permitStartMs = ports.nowMs();
      const permit = await ports.acquirePermit(
        AbortSignal.timeout(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS),
      );
      counters.permitWaitMsTotal += Math.max(0, ports.nowMs() - permitStartMs);
      // A null permit is a refusal. Running the read anyway is exactly the
      // fall-through the shared gate exists to prevent.
      if (!permit) {
        return refuse(
          accountId,
          ownerKey,
          'no_permit',
          `no background permit within ${FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS} ms`,
        );
      }
      const loadStartMs = ports.nowMs();
      try {
        return await classify(accountId, ownerKey);
      } finally {
        counters.loadMsTotal += Math.max(0, ports.nowMs() - loadStartMs);
        permit.release();
      }
    } catch (err) {
      ports.error('freehold durable load failed; the account is held:', boundedDatabaseError(err));
      return refuse(accountId, ownerKey, 'read_threw', 'the durable load threw');
    } finally {
      activeLoads--;
    }
  }

  // ASYNC on purpose, even though every return below is already a promise.
  // `freeholdOwnerKeyForAccount` THROWS on a non-positive or non-safe account
  // id, and `retain`'s repair reload calls this fire-and-forget behind a
  // `.catch`. A synchronous throw walks straight past that catch, out of
  // GameServer.join, after retain has already taken a reference that no path
  // then releases. Making the function async turns it into a rejection the catch
  // can see. Unreachable today (accounts.id is INT4 and the handshake refuses a
  // malformed id first), which is why it is a shape fix rather than a defect.
  async function preloadWithin(accountId: number, reask = false): Promise<LoadedFreehold> {
    const ownerKey = freeholdOwnerKeyForAccount(accountId);
    const entry = entries.get(ownerKey);
    // A second character of the same account is joining: the live record is the
    // truth, so both answers are MARKED to put nothing in. The join no longer
    // installs this answer as asked (answerForInstall decides at install time),
    // so the mark is defense in depth for a raw consumer of it.
    if (ports.hasLive(ownerKey)) {
      if (entry?.loaded) {
        entry.accountId = accountId;
        // THE GRACE COUNTS FROM THE LAST TOUCH, not from the last retain. The
        // mark-and-sweep exists because preload resolves before the join calls
        // retain, so an entry legitimately sits at zero references for the width
        // of a handshake; without this reset a handshake wider than one sweep
        // interval loses its entry anyway and the session is write-blocked.
        entry.orphanPasses = 0;
        return snapshotOf(entry, null, true);
      }
      // The live record is still the truth, so the answer carries no state and
      // is MARKED. WITHOUT the read this entry never learns its plot id or
      // durable revision, and an entry that never loaded is write-blocked for the
      // whole session, every edit discarded at logout. So read, then answer with
      // no state.
      const loaded = await beginLoad(accountId, ownerKey);
      if (reask && loaded.hold?.kind !== 'cap_full') counters.reaskReads++;
      const touched = entries.get(ownerKey);
      if (touched) touched.orphanPasses = 0;
      return { ...loaded, state: null, recordWithheld: true };
    }
    // Load-once: a re-preload replays what the entry knows (a rejoin re-installs
    // the real house) and never mints a second plot id; the one re-read is a
    // clean entry's lost claim (freeholdRereadsLostClaim), joining a read in
    // flight for THIS account (a loaded entry already carries it: defensive).
    if (entry?.loaded && !rereadsLostClaim(entry, accountId)) {
      entry.accountId = accountId;
      entry.orphanPasses = 0;
      // blocked(), not `hold === null`. A QUIESCED entry has no hold and yet is
      // exactly the entry whose knowledge is known to be stale: the durable
      // revision moved under this realm, which is what the fence exists to
      // detect. Replaying its state would install a house another writer has
      // already replaced, as if it were current.
      //
      // An outstanding LEAVE CAPTURE outranks `entry.state`, which only ever
      // advances at commit. The capture is the previous session's last edits,
      // still unwritten; replaying the committed state instead would show the
      // returning player a house missing everything they did before logging
      // out, and would then overwrite the capture on the next sweep.
      // Handing it over does NOT release it. `retain` is the confirmation and
      // releases it there, and only when the live record actually carries it;
      // see offerCapture for the five handshake exits that make releasing here
      // a lost-save path of its own.
      return replayAnswer(entry);
    }
    const loaded = await beginLoad(accountId, ownerKey);
    // A re-ask that waited on the durable path; a cap refusal waited on nothing.
    if (reask && loaded.hold?.kind !== 'cap_full') counters.reaskReads++;
    const touched = entries.get(ownerKey);
    if (touched) touched.orphanPasses = 0;
    return loaded;
  }

  /** Book the whole-preload cap's refusal and answer it. The SHAPE is in
   *  server/freehold_load_outcome.ts with the reasoning for every field; the
   *  counters and the operator line are the store's own. */
  function budgetRefusal(accountId: number, budgetMs: number): LoadedFreehold {
    counters.loadFailures++;
    counters.loadFailuresByKind.no_budget = (counters.loadFailuresByKind.no_budget ?? 0) + 1;
    const answer = freeholdBudgetRefusal(accountId, budgetMs, {
      readyAtMs: 0,
      revision: ABSENT_HEARTH_REVISION,
    });
    capacityWarn(
      'no_budget',
      true,
      `freehold plot index ${answer.plotIndex} held (no_budget): ${answer.hold?.detail}; the durable row is left untouched`,
    );
    return answer;
  }

  /**
   * The join path's read, CAPPED. See FREEHOLD_PERSIST_LOGIN_BUDGET_MS for what
   * this bounds and why the bound is a constant rather than a share of a
   * handshake deadline that does not exist.
   *
   * ASYNC, and it must stay so: freeholdOwnerKeyForAccount throws on a
   * non-positive or non-safe account id and retain's repair reload calls this
   * fire-and-forget behind a `.catch`, so a synchronous throw would walk past
   * that catch after retain had already taken a reference nothing then releases.
   */
  async function preload(
    accountId: number,
    opts: FreeholdPreloadOptions = {},
  ): Promise<LoadedFreehold> {
    const budgetMs = freeholdPreloadBudgetMs(opts.budgetMs);
    const startMs = ports.nowMs();
    try {
      return await cappedPreload(accountId, budgetMs, opts.reask === true);
    } finally {
      if (opts.reask === true) {
        counters.reasks++;
        counters.reaskMsTotal += Math.max(0, ports.nowMs() - startMs);
      }
    }
  }

  async function cappedPreload(
    accountId: number,
    budgetMs: number,
    reask: boolean,
  ): Promise<LoadedFreehold> {
    let expired!: () => void;
    const overrun = new Promise<'no-budget'>((resolve) => {
      expired = () => resolve('no-budget');
    });
    let cancel: (() => void) | null = null;
    try {
      cancel = scheduleDeadline(expired, budgetMs);
    } catch (err) {
      // A scheduler that will not schedule must not refuse the login: run
      // uncapped and say so, which is the behaviour that predates this cap.
      ports.error('freehold login budget could not be scheduled; the load runs uncapped:', err);
      return await preloadWithin(accountId, reask);
    }
    try {
      // THE LOSING PROMISE KEEPS A HANDLER. `preloadWithin` is designed not to
      // reject (loadOnce catches every fault and answers a hold), but a
      // rejection that arrives AFTER the deadline has already answered would be
      // unhandled, and the cost of being wrong about that is the realm process.
      // The catch is a no-op because the answer has already been decided.
      const load = preloadWithin(accountId, reask);
      const answer = await Promise.race([load, overrun]);
      if (answer === 'no-budget') {
        void load.catch(() => undefined);
        // THE READ OUTLIVES THIS CALLER and is left running on purpose, to fill
        // the entry. What that costs is recorded on classify's absent arm and
        // bounded by the insert refusal in server/freehold_write_seal.ts.
        return budgetRefusal(accountId, budgetMs);
      }
      return answer;
    } finally {
      try {
        cancel();
      } catch {
        /* a timer that will not cancel must never fault a login */
      }
    }
  }

  /** The single-flight durable read. Two joins of one account collapse onto one
   *  load, and the slot is identity-guarded so a load started after ours is
   *  never unregistered by ours. */
  function beginLoad(accountId: number, ownerKey: string): Promise<LoadedFreehold> {
    const existing = inFlightLoads.get(accountId);
    if (existing) return existing;
    let tracked!: Promise<LoadedFreehold>;
    tracked = loadOnce(accountId, ownerKey).finally(() => {
      if (inFlightLoads.get(accountId) === tracked) inFlightLoads.delete(accountId);
    });
    inFlightLoads.set(accountId, tracked);
    return tracked;
  }

  function applyWriteResult(
    entry: FreeholdPersistEntry,
    result: FreeholdFencedUpsertResult,
    generation: number,
    snapshotAtMs: number,
    written: PersistedFreehold,
    /** The identity the LIVE RECORD carried when this write sampled it. */
    persistedPlotId: string,
  ): boolean {
    if (result.kind === 'inserted' || result.kind === 'updated') {
      counters.writes++;
      entry.durableRev = result.durableRev;
      // THE ENTRY REMEMBERS THE RECORD'S IDENTITY, NOT THE ROW'S. Two different
      // identities are in play and each belongs where it is: the ROW receives
      // `entry.plotId`, because that is its durable public name, while the
      // entry's cached state keeps the identity the LIVE RECORD carried,
      // because the only thing that state is compared against is a live record.
      //
      // That is what lets the seal below tell "this is the record I have been
      // writing" from "this is a default somebody seeded", without the store
      // ever having to write an identity into the sim. A fresh account's record
      // legitimately carries the pending stand-in for its whole first session,
      // and a stand-in is indistinguishable from a fresh seed by identity
      // alone, so an entry that remembered the ROW's name instead would refuse
      // its own record on the second write of every new account.
      //
      // A ROUND NINE EDIT REMOVED THIS and was reverted. With the seal's
      // stand-in exemption in place the two looked equivalent, and they are
      // not: `entry.state` is also what `offerCapture` hands a rejoin, and
      // `installLoadedFreehold` sets the live record's identity from that
      // document, so caching the row's name here TEACHES the sim a different
      // name on every replay. That is a cross-host behaviour change wearing a
      // simplification's clothes.
      entry.state = { ...written, plotId: persistedPlotId };
      entry.writeErrors = 0;
      if (entry.retryAtMs > 0) {
        entry.retryAtMs = 0;
        ports.warn(
          `freehold plot index ${entry.plotIndex} write committed after a thrown run; the kept edits are on the row and ordinary writes resume`,
        );
      }
      if (entry.committedGeneration < generation) entry.committedGeneration = generation;
      // Every edit that survived this write arrived at or after the snapshot,
      // so the snapshot instant is the exact lower bound on their age.
      entry.dirtySinceMs = isDirty(entry) ? snapshotAtMs : 0;
      return true;
    }
    if (result.kind === 'fenced') {
      // 07a: another realm holds this plot's claim now, so this realm is no
      // longer its authority. Quiesced like a stale CAS (nothing it could send
      // would land), with its own counter because the fence NAMED the writer.
      counters.fencedWrites++;
      entry.quiesced = true;
      if (!entry.quiesceWarned) {
        entry.quiesceWarned = true;
        ports.warn(
          `freehold plot index ${entry.plotIndex} quiesced: this realm no longer holds the plot's claim, so no further writes go out for this owner`,
        );
      }
      return false;
    }
    if (result.kind === 'stale') {
      counters.staleWrites++;
      entry.quiesced = true;
      if (!entry.quiesceWarned) {
        entry.quiesceWarned = true;
        ports.warn(
          `freehold plot index ${entry.plotIndex} quiesced: the durable revision moved under this realm, so no further writes go out for this owner`,
        );
      }
      return false;
    }
    counters.writeFailures++;
    entry.quiesced = true;
    // THE SAME BOUND the load path applies. This detail comes out of
    // server/freehold_db.ts, which is outside this file, so the channel rule
    // holds here too: both conflict literals and the missing-row literal are
    // named in KNOWN_DETAILS.
    const detail = boundedFreeholdDetail(
      result.kind === 'missing' ? 'the row vanished' : result.detail,
    );
    ports.error(
      `freehold plot index ${entry.plotIndex} write refused (${result.kind}): ${detail}; no further writes go out for this owner`,
    );
    return false;
  }

  async function runWrite(entry: FreeholdPersistEntry, enqueuedAtMs: number): Promise<boolean> {
    counters.queueWaitMsTotal += Math.max(0, ports.nowMs() - enqueuedAtMs);
    // Re-checked AFTER the queue wait: the entry may have been held or
    // evicted while this write sat in the FIFO.
    if (!live(entry) || blocked(entry)) return false;
    const permitStartMs = ports.nowMs();
    const permit = await ports.acquirePermit(
      AbortSignal.timeout(FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS),
    );
    counters.permitWaitMsTotal += Math.max(0, ports.nowMs() - permitStartMs);
    if (!permit) {
      counters.writeFailures++;
      ports.warn(
        `freehold plot index ${entry.plotIndex} write got no background permit within ${FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS} ms`,
      );
      return false;
    }
    try {
      // The generation and the snapshot are sampled together, inside the
      // closure and adjacent, so the committed generation describes exactly
      // the document that goes to the row.
      const snapshotAtMs = ports.nowMs();
      // The codec measure OPENS here, at the first clone, and closes after the
      // second serialization: everything between the permit and the statement.
      const codecStartMs = snapshotAtMs;
      const generation = entry.dirtyGeneration;
      entry.snapshotGeneration = generation;
      const liveRecord = ports.serialize(entry.ownerKey);
      // THE LIVE RECORD WINS WHENEVER ONE EXISTS. The capture stands in only
      // for the window where there is none, which is what it was taken for: a
      // leave, then eviction, then this write.
      //
      // A revision comparison was tried here and was WRONG. `rev` restarts from
      // the last committed value when a rejoin replays the entry's state, so
      // the capture's revision and the live record's are counters on two
      // different timelines and "newer" is not decidable from them: preferring
      // the capture lost the REJOINING session's edits, which is the mirror of
      // the bug it was meant to fix. The leaver's edits are preserved a level
      // up instead, by handing the capture to the rejoin (see preload), so by
      // the time a live record exists again it already carries them.
      const persisted = liveRecord ?? entry.leaveDocument;
      if (persisted !== null) entry.snapshotRev = persisted.rev;
      // No live record and nothing captured. Writing here would put a default
      // over a real row, which is invariant 1.
      if (persisted === null) {
        counters.writesWithoutRecord++;
        // AND STOP OWING THE WRITE. Nothing here can ever be written: there is
        // no record and no capture, so every later sweep would re-arm the same
        // empty write, spend a permit on it and count it again, forever, and
        // `owesWork` would keep the entry resident for the life of the process.
        // Advancing the committed generation is safe because it discards no
        // edit: the edits are already gone with the record, and a rejoin
        // re-dirties the entry through the revision probe the moment a live
        // record exists again. NO PRODUCTION SEQUENCE reaches this arm in this
        // release (markDirty has no production caller, the revision probe cannot
        // dirty an entry with no record, and GameServer.leave always flushes
        // while the record is still live), so this is a bound on a state the
        // furnishing writer will make reachable rather than a live repair.
        if (entry.committedGeneration < generation) entry.committedGeneration = generation;
        entry.dirtySinceMs = isDirty(entry) ? snapshotAtMs : 0;
        return false;
      }
      // THE SEAL, in server/freehold_write_seal.ts. It is a pure predicate over
      // the LIVE document and the entry's committed state, so it lives in a
      // named module a Vitest can drive with three literals rather than as a
      // hundred and sixty lines inside this method. Four rounds each tried to
      // close the last path to a seeded default by adding a clause to it.
      //
      // `persisted`, NOT the `document` built below. The seal's whole subject is
      // the identity the LIVE RECORD carries, because that is what tells a
      // reseeded default from the record the entry loaded; `document` carries
      // `entry.plotId` by construction, so handing it here would compare the
      // entry's own identity with itself and the comparison would be dead. The
      // writable-implies-readable refusal below is the one that reads
      // `document`, because its subject is what lands on disk.
      const seededOverReal = seedWouldLandOnRealRow(persisted, entry);
      if (seededOverReal) {
        counters.writeFailures++;
        entry.quiesced = true;
        if (!entry.quiesceWarned) {
          entry.quiesceWarned = true;
          ports.error(
            `freehold plot index ${entry.plotIndex} write refused (identity): the live record is not the record this entry loaded, so no further writes go out for this owner`,
          );
        }
        return false;
      }
      // WRITABLE IMPLIES NAMEABLE, the order-independent half of the
      // unnamed-record refusal; the two ordering paths that defeat the load-side
      // form, and why this one cannot be defeated the same way, are in the
      // predicate's own header.
      if (insertWouldMintAnUnnamedRow(persisted, entry)) {
        counters.writeFailures++;
        entry.quiesced = true;
        if (!entry.quiesceWarned) {
          entry.quiesceWarned = true;
          ports.error(
            `freehold plot index ${entry.plotIndex} write refused (unnamed): the live record does not carry the identity this row would be created under, so no row is created and no further writes go out for this owner`,
          );
        }
        return false;
      }
      // WRITABLE IMPLIES READABLE. A document past any load ceiling would mint
      // a row this realm can never read back, so it quiesces the owner instead:
      // the row on disk stays the last one that WAS readable, and a record this
      // size only grows, so retrying it every sweep would be a loop against the
      // pool rather than a recovery.
      // The SAME identity sets the loader is bound to, so the two sides refuse
      // the same documents rather than nearly the same ones.
      // The document AS SENT, so the refusal validates the identity that lands
      // on disk rather than the one the live record happens to carry.
      const document: PersistedFreehold = { ...persisted, plotId: entry.plotId };
      const refusal = freeholdWriteRefusal(document, ports.identitySets());
      if (refusal !== null) {
        counters.writeFailures++;
        entry.quiesced = true;
        if (!entry.quiesceWarned) {
          entry.quiesceWarned = true;
          const measure =
            refusal.kind === 'oversize'
              ? `${refusal.bytes} bytes past the limit of ${refusal.limit}`
              : refusal.kind === 'layout_over_ceiling' || refusal.kind === 'trophies_over_ceiling'
                ? `${refusal.rows} rows past the limit of ${refusal.limit}`
                : boundedFreeholdDetail(refusal.detail);
          ports.error(
            `freehold plot index ${entry.plotIndex} write refused (${refusal.kind}): ${measure}; no further writes go out for this owner`,
          );
        }
        return false;
      }
      const layoutJson = JSON.stringify(document.layout);
      const trophiesJson = JSON.stringify(document.trophies);
      const writeBytes = Buffer.byteLength(layoutJson) + Buffer.byteLength(trophiesJson);
      counters.codecMsTotal += Math.max(0, ports.nowMs() - codecStartMs);
      counters.writeBytesTotal += writeBytes;
      if (writeBytes > counters.maxWriteBytes) counters.maxWriteBytes = writeBytes;
      const writeStartMs = ports.nowMs();
      if (entry.retryAtMs > 0) counters.writeRetries++;
      const result = await ports.writeRow({
        accountId: entry.accountId,
        plotIndex: entry.plotIndex,
        plotId: entry.plotId,
        tier: document.tier,
        layoutJson,
        trophiesJson,
        condition: document.condition,
        visitPolicy: document.visitPolicy,
        wireRev: document.rev,
        // The shape THIS document was serialized in, from the document itself:
        // the writer is the only party that knows it, and a later or earlier
        // build reads the column to decide whether it may interpret the row.
        schemaVersion: document.version,
        expectedDurableRev: entry.durableRev,
      });
      counters.writeMsTotal += Math.max(0, ports.nowMs() - writeStartMs);
      return applyWriteResult(entry, result, generation, snapshotAtMs, document, persisted.plotId);
    } finally {
      permit.release();
    }
  }

  /**
   * Offer a rejoining session the capture if one is outstanding, WITHOUT
   * releasing it. Two-phase on purpose.
   *
   * Releasing here was a lost-save path of its own. `preload` runs on the
   * handshake BEFORE the character lease, and five exits sit between the two:
   * a lease already held, no such character, a forced rename, a throwing
   * character read, and a refused join. None of them ever creates a live
   * record, so a capture released here vanished with nothing holding the edits,
   * and `alreadyInWorld` is the sharpest of them because a reconnect after a
   * dropped socket is the very event that produced the capture.
   *
   * `retain` is the confirmation, and it is synchronous on the same tick as the
   * install. Until it comes, the capture stays and a sweep can still write it,
   * which is the outcome that keeps the edits.
   */
  function offerCapture(entry: FreeholdPersistEntry): PersistedFreehold | null {
    return entry.leaveDocument ?? entry.state;
  }

  /** A loaded entry's answer at this instant: preload's replay arm, and the
   *  join's validation at install time, one expression so the two cannot drift. */
  function replayAnswer(entry: FreeholdPersistEntry): LoadedFreehold {
    return snapshotOf(entry, blocked(entry) ? null : offerCapture(entry), false);
  }

  /** Wake anything waiting for this entry to stop owing a write. */
  function releaseSettleWaiters(entry: FreeholdPersistEntry): void {
    if (entry.settleWaiters.length === 0) return;
    for (const wake of entry.settleWaiters.splice(0)) wake();
  }

  function settle(entry: FreeholdPersistEntry, committed: boolean): void {
    entry.running = false;
    entry.chain = null;
    const freedRetrySlot = entry.retryInFlight;
    freeSlot(entry);
    // Clear ONLY what the write actually committed: an edit that landed while
    // the write was out is still dirty here, and re-arms exactly one more
    // write. A write that did NOT commit never re-arms itself, so a failing
    // row cannot become a retry loop against the pool.
    const rearm = entry.pending || (committed && isDirty(entry));
    entry.pending = false;
    if (rearm && live(entry) && !blocked(entry) && retryDue(entry)) {
      if (entry.retryAtMs === 0) {
        // Straight back into the slot it freed (never behind the deferred set it
        // was ahead of); a freed RETRY slot goes to a waiting retry at once.
        launch(entry);
        if (freedRetrySlot) pumpDeferredWrites();
        return;
      }
      // Re-queued for the pump below: ordinary writes first, retries oldest first.
      deferredRetries.add(entry);
    }
    releaseSettleWaiters(entry);
    // Cleared HERE and not above, so a RE-ARMED write inherits the capture: a
    // write launched out of settle samples its document after its own permit
    // wait, past the point where the leaving session's record still exists.
    //
    // And only when the entry no longer OWES the write. The null-permit arm of
    // runWrite returns false WITHOUT quiescing, so an entry can settle
    // uncommitted, unblocked and still dirty; dropping its capture there left
    // the next sweep to re-arm a write whose record removePlayer had already
    // evicted, and the leaving session's edits were gone for good. Gate
    // saturation produces both that timeout and the deferral the capture exists
    // for, so the two arms are adjacent rather than exotic.
    if (!owesWork(entry)) releaseCapture(entry);
    pumpDeferredWrites();
    maybeRemove(entry);
    drainCheck();
  }

  function launch(entry: FreeholdPersistEntry): void {
    undefer(entry);
    // A leaving flush parked on this entry has something to await again.
    releaseSettleWaiters(entry);
    activeWrites++;
    entry.retryInFlight = entry.retryAtMs > 0;
    if (entry.retryInFlight) activeRetries++;
    entry.running = true;
    entry.pending = false;
    // Nothing sampled yet, and the sample happens AFTER the permit wait, so
    // every edit that exists between here and there is already covered.
    entry.snapshotGeneration = Number.POSITIVE_INFINITY;
    entry.snapshotRev = null;
    const enqueuedAtMs = ports.nowMs();
    // Never aborted: coalescing is the generation, not a cancelled queue
    // entry, and there is at most one queued write per key at a time.
    const controller = new AbortController();
    try {
      entry.chain = ports
        .enqueue(entry.ownerKey, controller.signal, () => runWrite(entry, enqueuedAtMs))
        .catch((err: unknown) => {
          counters.writeFailures++;
          // A FAULT is not an answer, so a run of them never quiesces (R1): it
          // puts the owner on the retry clock, and the edits it owes are kept.
          // A throw about the payload IS one, and quiesces as it always has.
          const onClock = entry.retryAtMs > 0;
          const outcome = noteThrownWrite(entry, ports.nowMs(), freeholdThrownWriteIsAnswer(err));
          if (outcome === 'retrying' && (intake || openDrains > 0)) {
            // One line per sweep (or drain), not per owner; with intake closed and no
            // drain open a sweep may never come, so it logs its own.
            retryThrows++;
            lastRetryError = boundedDatabaseError(err);
          } else {
            ports.error(
              `freehold plot index ${entry.plotIndex} write failed:`,
              boundedDatabaseError(err),
            );
          }
          if (outcome === 'answered' && !entry.quiesced) {
            entry.quiesced = true;
            entry.quiesceWarned = true;
            ports.error(
              `freehold plot index ${entry.plotIndex} quiesced ${onClock ? 'on the retry clock: a thrown write refused this document' : `after ${entry.writeErrors} thrown writes refusing this document`}; no further writes go out for this owner`,
            );
          } else if (outcome === 'entered') {
            ports.error(
              `freehold plot index ${entry.plotIndex} write failed ${FREEHOLD_PERSIST_MAX_WRITE_ERRORS} times in a row; its unwritten edits are kept and retried once per ${FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS} ms until one commits`,
            );
          }
          return false;
        })
        .then((committed) => {
          // settle must never reject: an unsettled chain would leave the entry
          // running forever, and a drain waiting on it would only ever answer
          // at its deadline.
          try {
            settle(entry, committed);
          } catch (err) {
            // RAW: a throw out of settle is a programming bug, not a database
            // answer, and reducing it to three pg fields drops the stack that
            // would name the line.
            ports.error('freehold write settle failed:', err);
            // The slot was already released inside settle, so the deferred set
            // and any waiting drain must still be served: otherwise a drain
            // waits out its whole deadline for work that is finished.
            pumpDeferredWrites();
            drainCheck();
          }
        });
    } catch (err) {
      counters.writeFailures++;
      // RAW, for the same reason: a throwing enqueue is this process failing,
      // not PostgreSQL answering.
      ports.error(`freehold plot index ${entry.plotIndex} write could not be queued:`, err);
      entry.running = false;
      entry.chain = null;
      freeSlot(entry);
      // A leaving flush parked on this entry has nothing left to await: every
      // other exit from an armed write wakes them, and this one did not, so a
      // parked leaver spent its whole deadline on a write that had already
      // finished failing.
      releaseSettleWaiters(entry);
      maybeRemove(entry);
      drainCheck();
      // This catch can run INSIDE the pump's own loop, and pumpDeferredWrites
      // latches on `pumping`, so the call below is a no-op there and the loop's
      // next iteration does the work instead. It matters on the other path,
      // where launch was reached from arm and no pump is running.
      pumpDeferredWrites();
    }
  }

  /** Start as many deferred writes as the local cap now allows. Called every
   *  time a slot frees, so the set drains without a timer. */
  let draining = false;
  /** The concurrent-write cap in force right now. */
  const writeCap = (leaving: boolean): number =>
    (draining ? FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES : FREEHOLD_PERSIST_MAX_ACTIVE_WRITES) +
    (leaving ? FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE : 0);

  /** The retry sub-cap in force: FREEHOLD_PERSIST_RETRY_WRITE_CAP in steady state,
   *  the whole cap while a drain is open (nothing else then competes, ordinary
   *  writes are still pumped first, and each held owner's last attempt must fit
   *  the drain's deadline). */
  const retryCap = (): number =>
    openDrains > 0 ? writeCap(false) : FREEHOLD_PERSIST_RETRY_WRITE_CAP;

  let pumping = false;
  function pumpDeferredWrites(): void {
    if (pumping) return;
    pumping = true;
    try {
      pumpLoop();
    } finally {
      pumping = false;
    }
  }

  /** The first deferred entry holding a LEAVE CAPTURE, or the first entry at
   *  all. A leaver's write is the last chance for those edits, and every
   *  background write it would otherwise queue behind has a next sweep to catch
   *  it, so insertion order is the wrong order for it. Without this the reserve
   *  bought nothing past the first two leavers: `arm` admits a leaver at
   *  writeCap(true), but a leaver that missed that window lands in the deferred
   *  set and the pump then re-admits it at writeCap(false), behind every
   *  background write already queued. */
  function nextDeferred(): FreeholdPersistEntry | undefined {
    const leaver = deferredLeavers.values().next().value;
    if (leaver !== undefined) return leaver;
    return deferredWrites.values().next().value;
  }

  /** Both sets, together, so the subset can never outlive its superset. */
  function undefer(entry: FreeholdPersistEntry): void {
    deferredWrites.delete(entry);
    deferredLeavers.delete(entry);
    deferredRetries.delete(entry);
  }

  /** Give back the slot (and a retry's sub-cap slot) a launched write held. */
  function freeSlot(entry: FreeholdPersistEntry): void {
    activeWrites--;
    if (entry.retryInFlight) activeRetries--;
    entry.retryInFlight = false;
  }

  /** The sweep's one line for every throw on the clock since the last one. */
  function reportRetryThrows(): void {
    if (retryThrows === 0) return;
    ports.error(
      `freehold retry clock: ${retryThrows} retry writes threw since the last sweep; their owners keep their unwritten edits for the next window:`,
      lastRetryError,
    );
    retryThrows = 0;
    lastRetryError = undefined;
  }

  function pumpLoop(): void {
    while (deferredWrites.size > 0) {
      const next = nextDeferred();
      if (next === undefined) return;
      // The leaver may borrow the reserve here exactly as `arm` lets it.
      if (activeWrites >= writeCap(next.leaveDocument !== null)) return;
      undefer(next);
      // The wait may have outlived the reason for the write: the entry could
      // have been evicted, held or quiesced since it was deferred.
      if (!stillWants(next)) continue;
      launch(next);
    }
    // THEN the retry clock's writes, inside their own sub-cap (R1's review).
    while (
      deferredRetries.size > 0 &&
      activeWrites < writeCap(false) &&
      activeRetries < retryCap()
    ) {
      const next = deferredRetries.values().next().value as FreeholdPersistEntry;
      undefer(next);
      if (stillWants(next)) launch(next);
    }
  }

  /** Does a deferred entry still want the write it waited for? The wait may have
   *  outlived the reason: the entry could have been evicted, held or quiesced,
   *  or (the drain's exception having ended) be off due on the retry clock. One
   *  that no longer wants it left the deferred set without a write, so it may
   *  now be removable: without this it waits for the orphan sweep instead. */
  function stillWants(entry: FreeholdPersistEntry): boolean {
    if (live(entry) && !blocked(entry) && !entry.running && isDirty(entry) && retryDue(entry)) {
      return true;
    }
    releaseSettleWaiters(entry);
    maybeRemove(entry);
    return false;
  }

  // Exactly one running plus one pending per owner key: a burst of a thousand
  // marks costs one write in flight and one behind it, never a thousand.
  function arm(entry: FreeholdPersistEntry, leaving = false): void {
    if (blocked(entry)) return;
    // R1: on the retry clock nothing arms until it is due; the edit rides it.
    if (!entry.running && !retryDue(entry)) return;
    // Its own sub-cap and deferred set, so retries never hold every slot.
    if (!entry.running && entry.retryAtMs > 0) {
      if (activeWrites < writeCap(false) && activeRetries < retryCap()) {
        launch(entry);
      } else {
        deferredRetries.add(entry);
      }
      return;
    }
    if (!entry.running && activeWrites >= writeCap(leaving)) {
      // The local cap, applied BEFORE the shared gate. The entry stays dirty,
      // so nothing is lost and nothing is retried against the pool: it waits
      // in a set this store can measure instead of on an uncapped queue every
      // other named background producer has to sit behind.
      deferredWrites.add(entry);
      // A leaver's write is the last chance for those edits, so the pump must be
      // able to find it without walking the backlog it is queued behind.
      if (entry.leaveDocument !== null) deferredLeavers.add(entry);
      return;
    }
    if (entry.running) {
      // ONLY for an edit the running write cannot be carrying. The running
      // write samples its document after the permit wait, so it already covers
      // everything that existed when it was armed; a bare `pending = true`
      // here re-sent that identical document, bumped a second durable
      // revision and touched updated_at for nothing. Shutdown made it routine:
      // saveFreeholds arms every dirty owner, then freeholdPersistIdle arms
      // every one of them again while the first writes are still on the gate,
      // doubling the durable work inside the drain deadline.
      if (entry.dirtyGeneration > entry.snapshotGeneration) entry.pending = true;
      return;
    }
    launch(entry);
  }

  function drainCheck(): void {
    if (drainWaiters.size === 0) return;
    // A deferred write is owed work exactly like a pending one.
    if (deferredWrites.size > 0 || deferredRetries.size > 0) return;
    for (const entry of entries.values()) {
      if (entry.running || entry.pending) return;
    }
    // TWO DIFFERENT QUESTIONS, and answering them with one predicate is what
    // made this a false success. "Is anything still moving" decides when to stop
    // WAITING, and the three states above are all of it. "Did everything land"
    // decides what to ANSWER, and it is not the same set: runWrite's null-permit
    // arm returns false WITHOUT quiescing, and settle re-arms only on `pending
    // || (committed && dirty)`, so an entry can sit unblocked, still dirty, not
    // running, not pending and not deferred, with nobody left to re-arm it.
    // Waiting longer buys nothing there, which is why this resolves at once
    // rather than burning the deadline; but answering TRUE would report a clean
    // drain over an owner's unwritten edits, on the one signal an operator has
    // that a restart was safe.
    const unwritten = [...entries.values()].some((entry) => isDirty(entry) && !blocked(entry));
    for (const waiter of [...drainWaiters]) waiter.finish(!unwritten);
  }

  return {
    preload,

    // markDirty and save are the store's EXPLICIT dirty seam and have no
    // production caller in this release. The revision sweep below is the only
    // detector that runs, which is safe exactly because every sanctioned
    // mutator of a FreeholdState bumps its revision, and that coupling is
    // pinned by a source scan in tests/freehold_module.test.ts rather than left
    // to a future author to remember. The furnishing placement writer is the
    // caller these are here for; until it lands they are driven only by tests.
    markDirty(ownerKey: string): void {
      const entry = entries.get(ownerKey);
      // Nothing is loaded for this owner, so there is nothing to persist and
      // nothing this store is entitled to blind-write.
      if (!entry) return;
      entry.dirtyGeneration++;
      if (entry.dirtySinceMs === 0) entry.dirtySinceMs = ports.nowMs();
    },

    save(ownerKey: string): void {
      if (!intake) return;
      const entry = entries.get(ownerKey);
      if (!entry) return;
      arm(entry);
    },

    saveAllDirty(): void {
      // THE SWEEP RUNS EVEN WITH INTAKE CLOSED, and above the guard rather than
      // below it. This is the store's only periodic hook, so an entry whose
      // session went away without a leave has no other removal path, and
      // `idle()` closes intake one way and `stop()` deliberately does not reopen
      // it: leaving the sweep behind the guard retired the entries map's only
      // time bound for any store that outlives a drain.
      sweepOrphans();
      reportRetryThrows();
      if (!intake) return;
      for (const entry of entries.values()) {
        if (noteRevisionMoved(entry) || isDirty(entry)) arm(entry);
      }
    },

    async flushAndRelease(ownerKey: string): Promise<void> {
      const entry = entries.get(ownerKey);
      if (!entry) return;
      try {
        // A held entry flushes NOTHING. The leave path still drops its
        // reference, so the entry can be evicted and re-read on a later join.
        // The SAME dirty test the periodic sweep uses, not a weaker one: a tier
        // change made since the last sweep bumps only the record's revision, so
        // an isDirty-only check here would drop the whole last window of edits at
        // logout, which is precisely when there is no next sweep to catch them.
        const moved = noteRevisionMoved(entry);
        if (!blocked(entry) && (moved || isDirty(entry) || entry.running || entry.pending)) {
          // arm() directly rather than save(), so a closed intake (a shutdown
          // already under way) still lets a leaving session write out its last
          // edits. A clean entry is left alone: rewriting an unchanged document
          // on every logout would burn a durable revision per leave.
          // CAPTURED BEFORE THE WAIT, because the write's precondition is that the
          // sim record still exists and this is the only window where that holds.
          // A deferred write, or one whose deadline expires below, runs AFTER
          // removePlayer has evicted the record, and would then serialize to null
          // and write nothing at all: the leaving session's last edits would be
          // silently gone. One clone per dirty logout buys that back.
          // Released BEFORE reassigning: a second leave over a surviving capture
          // holds one document and used to count two, and the gauge that is this
          // retention's only stated bound then ratcheted upward and never read
          // zero again.
          // ONLY WHEN THERE IS SOMETHING TO REPLACE IT WITH. A null answer means
          // the record is already gone, which is the exact window the capture
          // exists for, so overwriting with it would discard the very edits it
          // holds. Released before reassigning, because a second leave over a
          // surviving capture holds one document and used to count two.
          const captured = ports.serialize(ownerKey);
          if (captured !== null) {
            if (entry.leaveDocument !== null) leaveCaptures--;
            entry.leaveDocument = captured;
            leaveCaptures++;
          }
          // LEAVING, so it may borrow the reserve: this write is the last chance
          // for these edits, and every background write it would otherwise queue
          // behind has a next sweep to catch it.
          arm(entry, true);
          // The capture may have been taken after an earlier arm already deferred
          // this entry, so the leaver subset is reconciled here as well as at the
          // deferral itself.
          if (entry.leaveDocument !== null && deferredWrites.has(entry)) {
            deferredLeavers.add(entry);
          }
          // BOUNDED. Past the deadline this stops WAITING, never the write: the
          // write is queued and keeps running, the entry stays until it settles,
          // and the shutdown drain still waits for it. A logout that inherited
          // the background write's full budget would back up GameServer.leave
          // under gate saturation and release character leases late.
          let expired = false;
          let onExpiry!: () => void;
          const expiry = new Promise<void>((resolve) => {
            onExpiry = resolve;
          });
          const cancelDeadline = scheduleDeadline(() => {
            expired = true;
            onExpiry();
          }, FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
          try {
            for (let pass = 0; pass < FREEHOLD_PERSIST_FLUSH_MAX_PASSES && !expired; pass++) {
              const chain = entry.chain;
              // A DEFERRED entry has no chain and is still owed a write, so a
              // null chain alone does not mean there is nothing to wait for.
              // Treating it that way returned a mass disconnect's every logout in
              // milliseconds, spending none of the budget the deadline exists to
              // bound and leaving every entry resident.
              // A retry waiting in the clock's own set is not waited on (owesWork keeps
              // its capture); a RUNNING one is, to the flush's deadline, like any.
              if (chain === null && !deferredWrites.has(entry)) break;
              const settled =
                chain?.catch(() => undefined) ??
                new Promise<void>((resolve) => {
                  entry.settleWaiters.push(resolve);
                });
              await Promise.race([settled, expiry]);
            }
          } finally {
            cancelDeadline();
          }
        }
      } finally {
        // THE RELEASE IS THE HALF THAT MUST NOT BE SKIPPED, so it sits in a
        // finally rather than after the flush above. Everything in that flush can
        // throw: the injected scheduleDeadline (idle() already guards the
        // identical call explicitly), the serialize port, the enqueue port. A
        // throw there left the reference held for the life of the process, so
        // maybeRemove returned early forever, the orphan sweep reset its count on
        // every pass and the account's parsed record was never collected. Its one
        // production caller swallows the rejection, which is what made that leak
        // silent.
        entry.refs = Math.max(0, entry.refs - 1);
        maybeRemove(entry);
      }
    },

    // Synchronous by contract: the server fires a leave for the old character
    // and then adds the new one under the SAME owner key, so the new
    // session's retain must be able to land before the old session's
    // release completes.
    retain(ownerKey: string, accountId = 0): void {
      const entry = ensureEntry(ownerKey, accountId);
      entry.refs++;
      entry.orphanPasses = 0;
      // THE CONFIRMATION HALF of the capture handover, and it confirms THIS
      // DOCUMENT rather than the existence of some record.
      //
      // A bare presence test was not enough: installLoadedFreehold puts nothing
      // in for several answer shapes and loadFreehold is load-once on top, while
      // retain runs on every join and knows none of it. The reachable case is a
      // second character joining while another session of the account is still
      // in the world: the install is a load-once no-op, and the record retain
      // sees belongs to that session, which may have edited past the capture.
      //
      // Comparing the live revision to the captured one fails CLOSED: a skipped
      // install leaves the revision where it was, so the capture survives to
      // the next sweep, which is the outcome that keeps the edits.
      //
      // AND A REVISION IS ALL IT CAN COMPARE. Adding the plot identity beside it
      // was considered and REJECTED as ineffective, not as too costly: the two
      // records that can be confused here are the previous session's and the
      // newly installed one, both belong to the SAME owner, and two records of
      // one account always carry the same identity (the stand-in for a fresh
      // account, the row's minted id for a loaded one). An identity compare
      // separates nothing this one does not.
      //
      // THROUGH releaseCapture, never inline. The two lines this used to spell
      // out did the gauge and the null and left the entry in `deferredLeavers`,
      // whose whole purpose is to let `pumpLoop` find a deferred LEAVER: a
      // rejoin inside the deferral window then left a CAPTURELESS entry at the
      // head of that set, `nextDeferred` returned it on every admission, and
      // `pumpLoop` priced it at the NON-leaving cap, so the two reserved slots
      // never reached the real leavers queued behind it. That is the exact
      // starvation 23d2e6741a was written to end, and it also falsified
      // `undefer`'s "the subset can never outlive its superset".
      if (entry.leaveDocument !== null && ports.liveRev(ownerKey) === entry.leaveDocument.rev) {
        releaseCapture(entry);
      }
      // AN UNLOADED ENTRY HERE FOLLOWS A JOIN THAT INSTALLED NOTHING: the join
      // installs from any loaded entry (answerForInstall), so only a join that
      // installed nothing reaches this, and the session is on the stand-in. Left
      // unloaded, the entry would block every write with no hold of its own, no
      // refusal and no line, so the session's discarded edits would be
      // invisible. So re-read: the entry learns the row and the seal refuses the
      // stand-in, counted and logged (or classify holds it, `unnamed_record`).
      // Single-flight and load-once, so a normal join costs nothing. Never on a
      // DARK realm: the handshake's reads are gated on the housing flag in
      // server/main.ts, and a realm with housing off must issue none. The
      // RESULT is discarded: the install was decided already, and this read
      // rides the same single-flight slot and admission cap as any other load.
      if (!entry.loaded && accountId > 0 && ports.enabled()) {
        void preload(accountId).catch(() => undefined);
      }
    },

    // THE JOIN'S VALIDATION, and SYNCHRONOUS on purpose: preload is async even on
    // its replay arms, and a sibling session's removePlayer can land in any await
    // gap, so the answer is decided in the same run as the install it feeds.
    answerForInstall(ownerKey, accountId, asked) {
      const entry = entries.get(ownerKey);
      const current = entry?.loaded ? replayAnswer(entry) : null;
      const live = ports.hasLive(ownerKey);
      const decided = freeholdJoinAnswer(accountId, asked, current, live);
      counters.joinVerdicts[decided.verdict]++;
      // A join beside a live record shares it (load-once), so only one with none warns.
      if (decided.verdict === 'withheld' && !live) {
        ports.warn(
          `freehold plot index ${decided.answer?.plotIndex} join answer withheld: the entry it was read from went away before the install, so no record is put in and the session is write-blocked`,
        );
      }
      return decided.answer;
    },

    idle(deadlineMs: number): Promise<boolean> {
      // Intake closes HERE rather than in stop(), so a GameServer.stop()
      // earlier in the shutdown sequence cannot refuse this drain's own
      // enqueues.
      intake = false;
      // The retry clock's exception (one last attempt) lasts while this drain is
      // open, and ENDS with it: past the deadline no retry launches (R3).
      openDrains++;
      // The drain runs at its own cap: nothing else contends for the shared
      // gate once intake is closed, and the deadline has to cover the realm
      // rather than a quarter of it.
      draining = true;
      // THE SAME DETECTOR THE OTHER TWO ENTRY POINTS USE, not a weaker one.
      // saveAllDirty and flushAndRelease both probe the live revision first,
      // and the revision sweep is the ONLY dirty detector with a production
      // caller in this release, so an isDirty-only drain could not see an edit
      // at all. It was correct only by the shutdown ORDERING in server/main.ts
      // (game.stop, then saveFreeholds, then this), which is a property of
      // another file and not of the drain.
      try {
        for (const entry of entries.values()) {
          if (noteRevisionMoved(entry) || isDirty(entry)) arm(entry);
        }
        pumpDeferredWrites();
      } catch (err) {
        // A throwing port must not leave the clock's drain exception open for
        // the life of the store, nor make a drain that "never throws" throw.
        openDrains--;
        reportRetryThrows();
        ports.error('freehold drain could not arm its writes:', err);
        return Promise.resolve(false);
      }
      const bounded = Math.max(1, Math.floor(deadlineMs));
      return new Promise<boolean>((resolve) => {
        let settled = false;
        let cancel: (() => void) | null = null;
        const waiter = {
          finish(drained: boolean): void {
            if (settled) return;
            settled = true;
            openDrains--;
            reportRetryThrows();
            drainWaiters.delete(waiter);
            try {
              cancel?.();
            } catch {
              /* a timer that will not cancel must never fault a shutdown */
            }
            cancel = null;
            resolve(drained);
          },
        };
        drainWaiters.add(waiter);
        try {
          cancel = scheduleDeadline(() => waiter.finish(false), bounded);
        } catch (err) {
          ports.error('freehold drain deadline could not be scheduled:', err);
          waiter.finish(false);
          return;
        }
        drainCheck();
      });
    },

    wantsClaim(ownerKey: string): boolean {
      const entry = entries.get(ownerKey);
      return entry !== undefined && (entry.refs > 0 || owesWork(entry));
    },

    authority(ownerKey: string) {
      const entry = entries.get(ownerKey);
      if (!entry) return null;
      return {
        loaded: entry.loaded,
        blocked: blocked(entry),
        plotId: entry.plotId,
        durableRev: entry.durableRev,
      };
    },

    // The owner's OWN write FIFO, the one runWrite rides, so a mutation that
    // writes the plot row can never interleave with this store's write of it
    // (the touch-set manifest's Q3). The mutation applies its plan to the live
    // record and adopts its committed revision before its job resolves, so the
    // next write here serializes a document that already carries the effect.
    runExclusive<T>(ownerKey: string, signal: AbortSignal, job: () => Promise<T>): Promise<T> {
      return ports.enqueue(ownerKey, signal, job);
    },

    adoptHearthReading(ownerKey: string, readyAtMs: number, revision: string): void {
      const entry = entries.get(ownerKey);
      if (entry) adoptFreeholdHearthReading(entry, readyAtMs, revision);
    },

    adoptCommittedRevision(ownerKey: string, durableRev: string): void {
      const entry = entries.get(ownerKey);
      if (!entry || blocked(entry) || !FREEHOLD_GENERATION_TEXT_RE.test(durableRev)) return;
      if (entry.durableRev !== null && BigInt(durableRev) <= BigInt(entry.durableRev)) return;
      entry.durableRev = durableRev;
    },

    stats(): FreeholdPersistStats {
      return freeholdPersistStatsOf(
        {
          entries: entries.size,
          ...censusFreeholdEntries(entries.values(), isDirty, isHeld, () => ports.nowMs()),
          deferredWrites: deferredWrites.size,
          deferredRetries: deferredRetries.size,
          activeWrites,
          leaveCaptures,
        },
        counters,
      );
    },

    // Timers only. Intake is NOT flipped here: an outstanding drain is
    // settled as not-drained rather than left hanging on a cancelled timer.
    stop(): void {
      for (const waiter of [...drainWaiters]) waiter.finish(false);
    },
  };
}
// TWO THINGS THAT USED TO SIT HERE AND DO NOT NEED THIS FILE'S PRIVATE STATE.
// The process-wide registry (registerFreeholdPersistStore and the three
// functions that answer safely with no store registered) moved WHOLE to
// server/freehold_persist_registry.ts, and installLoadedFreehold moved to
// server/freehold_install.ts. It never
// needed anything in this file: it is a pure function over a SimContext and one
// load answer, and its ABSENT arm is the front half of the write seal's
// argument rather than a detail of the store's lifecycle.
