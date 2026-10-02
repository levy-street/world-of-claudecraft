// The TYPE surface of the freehold persistence store, moved whole out of
// server/freehold_persist.ts (the monolith ratchet): the ports the store is
// built over, the store's public face, the login port's clock answer, and the
// per-owner entry record the store body walks. Type-only, so it adds no
// runtime edge; the store re-exports the three public names, so no importer
// re-points, and keeps the entry record to itself.

import type {
  FreeholdLoadResult,
  FreeholdWriteRefusalOptions,
  PersistedFreehold,
} from '../src/sim/freehold/persisted';
import type { FreeholdFencedUpsertResult, FreeholdRowLoad, FreeholdUpsert } from './freehold_db';
import type { FreeholdHearthLoad } from './freehold_hearth_db';
import type { FreeholdRecoveryHold, LoadedFreehold } from './freehold_load_outcome';
import type { FreeholdPreloadOptions } from './freehold_login_bounds';
import type { FreeholdPersistStats } from './freehold_persist_stats';

/** Every side effect the store has. Nothing here touches a pool, a Sim or a
 *  session directly, which is what lets one Vitest drive the whole lifecycle. */
/** What the combined login port answers for the CLOCK half: a durable load, or
 *  a thrown read carried across as a VALUE. Named rather than spelled inline so
 *  the composition root can hold one as it reads it: capturing only the row and
 *  rebuilding this from the outer error discarded a clock that had already been
 *  read successfully. */
export type FreeholdHearthAnswer =
  | FreeholdHearthLoad
  | { readonly kind: 'threw'; readonly error: unknown };

export interface FreeholdPersistPorts {
  readRow(accountId: number, maxOwnedBytes: number): Promise<FreeholdRowLoad>;
  readHearth(accountId: number): Promise<FreeholdHearthLoad>;
  /**
   * BOTH login reads on ONE checked-out client, when the host can offer it.
   *
   * The two above are the fallback and the shape a Vitest drives; this is the
   * shape a pool wants. Bounding each read on its own means a transaction each
   * (connect, BEGIN, SET LOCAL, the statement, COMMIT), so a handshake pays
   * eight round trips and holds two clients across four statements apiece for
   * two small reads. Sharing one transaction pays five and holds one. The cap on
   * the WHOLE preload lives above both port shapes, in this store: see
   * FREEHOLD_PERSIST_LOGIN_BUDGET_MS.
   *
   * A host that does not supply it gets the two ports in sequence, unbounded,
   * which is what every test does.
   */
  readDurables?(
    accountId: number,
    maxOwnedBytes: number,
  ): Promise<{
    row: FreeholdRowLoad;
    /** A THROWN clock read is a VALUE here, not a rejection, so the row beside
     *  it still lands. Sharing a transaction must not make a hearth fault hold
     *  the plot: the two are separate durable facts and the clock failing open
     *  while the plot fails closed is a deliberate asymmetry carried as a named
     *  gate, not something a round-trip saving may quietly change. */
    hearth: FreeholdHearthAnswer;
  }>;
  /** The fenced write (server/freehold_fenced_write.ts since 07a): every answer
   *  07's upsert gave, plus `fenced` when this realm no longer holds the plot's
   *  global claim. */
  writeRow(input: FreeholdUpsert): Promise<FreeholdFencedUpsertResult>;
  /** normalizeFreehold bound to the realm's live tier and visit-policy sets. */
  normalize(raw: unknown): FreeholdLoadResult;
  /** THE SAME two sets that `normalize` is bound to, exposed so the save path
   *  can refuse exactly what the load path would. Two sets that could drift
   *  apart would put the writable-implies-readable property back on trust. */
  identitySets(): FreeholdWriteRefusalOptions;
  /** serializeFreehold plus persistedFreeholdFromState. Null means the owner
   *  holds no live record, and the write is skipped entirely. */
  serialize(ownerKey: string): PersistedFreehold | null;
  hasLive(ownerKey: string): boolean;
  /** The live record's PLOT IDENTITY, or null when no record is live. Beside
   *  liveRev and for the same kind of reason: the absent arm mints an identity
   *  for a row that does not exist yet, and it mints PER ENTRY. An entry
   *  collected by the orphan sweep between a preload and its retain is
   *  recreated empty, and its repair reload would then mint a SECOND identity
   *  while the live record installed from the first one still answers to the
   *  first, permanently for that session. Reading the live identity here is
   *  what keeps the row and the record answering to one name. */
  livePlotId(ownerKey: string): string | null;
  /** Whether this realm serves housing at all. The store never reads the
   *  environment itself; the composition root binds this to the sim's own
   *  flag. A DARK realm must issue no durable read of any kind, which is why
   *  the only read this store starts on its own consults it. */
  enabled(): boolean;
  /** The live record's own revision, or null when the owner holds none. A
   *  CHEAP read: the periodic sweep asks every loaded owner this question on
   *  every pass, so it must not clone anything. serialize() is the expensive
   *  answer and belongs inside the write, where its result is actually used. */
  liveRev(ownerKey: string): number | null;
  mintPlotId(): string;
  /** 07a: whether this process still holds the global claim on a plot. A
   *  preload's REPLAY of a loaded entry that has a durable row asks it first: a
   *  claim the renewer released (a handshake slower than the login grace) or
   *  another realm took is read again rather than replayed, so a join never
   *  installs a house its writes would then answer `fenced` for. Unbound (a
   *  host with no claims), every replay proceeds. */
  claimHeld?(plotId: string): boolean;
  acquirePermit(signal: AbortSignal): Promise<{ release(): void } | null>;
  enqueue<T>(key: string, signal: AbortSignal, write: () => Promise<T>): Promise<T>;
  nowMs(): number;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
  /** BOTH deadlines the store owns: the shutdown drain's, and the per-leave
   *  flush bound inside flushAndRelease, which fires far more often (one per
   *  dirty logout). Injected so tests drive them without a wall clock; the
   *  module-edge default in server/freehold_persist.ts (realScheduleDeadline)
   *  is the store's only setTimeout. */
  scheduleDeadline?(callback: () => void, ms: number): () => void;
}

export interface FreeholdPersistStore {
  /** Bounded, single-flight per account. Never rejects: an admission refusal
   *  or a throwing port answers with a hold. `opts` narrows its budget. */
  preload(accountId: number, opts?: FreeholdPreloadOptions): Promise<LoadedFreehold>;
  markDirty(ownerKey: string): void;
  /** Fire and forget, coalesced to one running plus one pending write. */
  save(ownerKey: string): void;
  /** Enqueue every dirty owner; never awaits a write. */
  saveAllDirty(): void;
  /** The leave path: flush, then drop one reference. */
  flushAndRelease(ownerKey: string): Promise<void>;
  /** The account id lets the store re-read a row whose entry went away between
   *  the handshake's preload and this call. */
  retain(ownerKey: string, accountId?: number): void;
  /** SYNCHRONOUS, at the join's install and before its retain: the answer to put
   *  in, decided against this account's entry NOW rather than when the handshake
   *  asked (ruling (b) for the twelfth path; server/freehold_join_answer.ts). */
  answerForInstall(
    ownerKey: string,
    accountId: number,
    asked: LoadedFreehold | undefined,
  ): LoadedFreehold | undefined;
  /** Close intake, flush what is already dirty, and drain to a finite
   *  deadline. True when drained, false at the deadline. Never throws. */
  idle(deadlineMs: number): Promise<boolean>;
  stats(): FreeholdPersistStats;
  /** Settle any outstanding drain as NOT drained, which cancels that drain's
   *  deadline. Does NOT close intake, and does not cancel a leave-flush deadline
   *  already armed: those are bounded at two seconds and cancel themselves. */
  stop(): void;
  /** 07a: whether this store still needs the owner's global plot claim, which
   *  is what the claim renewer asks: an entry with a session reference or with
   *  work it still owes. SYNCHRONOUS and allocation-free. */
  wantsClaim(ownerKey: string): boolean;
  /** 07a: the owner's entry as the Hearth trip's authority rule reads it, or
   *  null when the store holds no entry. `blocked` is the write block (not yet
   *  loaded, held, or quiesced): a blocked entry never authorizes a trip. */
  authority(ownerKey: string): {
    readonly loaded: boolean;
    readonly blocked: boolean;
    readonly plotId: string;
    readonly durableRev: string | null;
  } | null;
  /** 07a: run `job` inside THIS owner's write FIFO (the manifest's Q3), so a
   *  mutation that writes the plot row is serialized with the store's own
   *  writes. Cancellable until the job starts. */
  runExclusive<T>(ownerKey: string, signal: AbortSignal, job: () => Promise<T>): Promise<T>;
  /** 07a: adopt a durable Hearth clock a remote trip proved (its committed
   *  advance, or the clock its cooldown refusal read), forward only by
   *  revision, so a replay of this entry never answers an older clock than the
   *  process knows (adoptFreeholdHearthReading). A no-op for an unknown owner. */
  adoptHearthReading(ownerKey: string, readyAtMs: number, revision: string): void;
  /** 07a: adopt a revision a mutation committed for this owner's row, from
   *  inside runExclusive right after the COMMIT, so the store's next CAS expects
   *  it instead of answering stale. Forward only; a no-op for an unknown or
   *  blocked owner. */
  adoptCommittedRevision(ownerKey: string, durableRev: string): void;
}

export interface FreeholdPersistEntry {
  readonly ownerKey: string;
  /** 0 until a load fills it in. An entry created by retain() carries the
   *  placeholder, and is write-blocked (`loaded` false) until its load lands,
   *  so the placeholder can never reach a row. */
  accountId: number;
  plotIndex: number;
  plotId: string;
  durableRev: string | null;
  /** The last state known to match the durable row, so a rejoin after the sim
   *  evicted the live record re-installs the real house instead of letting the
   *  join seed a default over it. */
  state: PersistedFreehold | null;
  loaded: boolean;
  hold: FreeholdRecoveryHold | null;
  /** A durable answer no repeat of the same payload can fix (stale, missing,
   *  conflict). The declared FreeholdRecoveryHold union has no member for it,
   *  so it is its own flag with the same write-blocking force. */
  quiesced: boolean;
  quiesceWarned: boolean;
  /** The durable Hearth clock this entry read, remembered so the REPLAY arms of
   *  preload report the clock they learned rather than a cold one. A second
   *  character of the same account, or a rejoin after the sim evicted the live
   *  record, takes those arms and issues no read of its own. */
  hearthReadyAtMs: number;
  hearthRevision: string;
  /**
   * The document captured at LEAVE, used only when the live record is already
   * gone by the time the write runs. See flushAndRelease for why it has to be
   * taken before the wait.
   *
   * ITS COST IS A CHOSEN NUMBER, not a discovered one: this is a SECOND full
   * record on top of `state`, held until the write lands, so the worst case is
   * the number of simultaneous dirty leavers times the record ceiling.
   * Measured, a thousand simultaneous dirty logouts at the approved 420-row
   * ceiling retain 66.2 MiB, and 0.29 MiB with empty layouts. That is the
   * price of not losing a leaving session's last edits, and `leave_captures`
   * publishes the count so it never has to be found in a heap dump.
   */
  leaveDocument: PersistedFreehold | null;
  /** Thrown writes since the last commit. A single throw is usually a blip
   *  worth one more sweep; a run of them is a row this realm cannot write, and
   *  retrying it every sweep forever is a loop against the pool. */
  writeErrors: number;
  /** When the last thrown write landed, so a run is a RUN and not a tally of
   *  unrelated blips hours apart. */
  lastWriteErrorMs: number;
  /** THE RETRY CLOCK (R1): 0 off it; else when the next write may be armed. A
   *  run of thrown writes sets it and every throw on it re-arms it, and only a
   *  commit clears it. The entry stays unblocked, so its capture is kept and
   *  offered to a rejoin; see server/freehold_write_retry.ts. */
  retryAtMs: number;
  /** The running write was launched from the retry clock, so it holds one of
   *  FREEHOLD_PERSIST_RETRY_WRITE_CAP's slots until it settles. */
  retryInFlight: boolean;
  refs: number;
  dirtyGeneration: number;
  committedGeneration: number;
  /** The generation the RUNNING write sampled its document at, so a second
   *  write is armed only for edits that write cannot already be carrying.
   *  Infinity while a write is queued but has not sampled yet: the sample
   *  happens after the permit wait, so everything before it is covered. */
  snapshotGeneration: number;
  /** The live revision the RUNNING write is carrying, or null before it has
   *  sampled. The sweep's dirty detector compares the live record against the
   *  last COMMITTED state, which stays behind for as long as a write is in
   *  flight, so without this a second sweep re-detects the very edit the
   *  running write is already carrying. */
  snapshotRev: number | null;
  dirtySinceMs: number;
  /** Consecutive sweep passes that have seen this entry with no session
   *  references and no work owed. It is collected on the
   *  FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES-th; anything that gives it work or a
   *  reference resets the count. */
  orphanPasses: number;
  running: boolean;
  pending: boolean;
  chain: Promise<void> | null;
  /** Resolvers waiting for this entry's next settle. A DEFERRED entry has no
   *  chain to await, and treating that as "nothing to wait for" made the leave
   *  flush return instantly under a mass disconnect, spending none of its
   *  budget and leaving the entry resident. */
  settleWaiters: Array<() => void>;
}
