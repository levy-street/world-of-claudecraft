// The freehold persistence store, driven end to end through a fully faked port
// bag: no database, no GameServer, no wall clock. It sits behind the same seam
// the production composition root uses (createFreeholdPersistStore plus the
// register/idle pair), so every acceptance criterion below is checked against
// the real store body rather than a stand-in.
//
// TWO THINGS THIS SUITE EXISTS TO KEEP HONEST:
//  - a held or unread account must produce NO write at all, proved as the
//    ABSENCE of a writeRow call, because a write there would put an empty
//    default over the owner's real furnishings;
//  - the coalescer must cost one running plus one pending write per owner key
//    no matter how many marks arrive, and must clear ONLY the generation the
//    write actually committed.

import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createBackgroundDbGate } from '../../server/background_db_gate';
import {
  FREEHOLD_CLAIM_LOGIN_BOUNDS,
  readClaimedLoginDurables,
} from '../../server/freehold_claim_login';
import { createFreeholdClaimRegistry } from '../../server/freehold_claim_registry';
import type {
  FreeholdFencedUpsertResult,
  FreeholdRow,
  FreeholdRowLoad,
  FreeholdUpsert,
  FreeholdUpsertResult,
} from '../../server/freehold_db';
import type { FreeholdHearthLoad } from '../../server/freehold_hearth_db';
import { installLoadedFreehold } from '../../server/freehold_install';
import { freeholdLivenessPorts } from '../../server/freehold_liveness';
import { FREEHOLD_LOAD_FAILURE_KINDS } from '../../server/freehold_load_outcome';
import { freeholdReaskBudgetMs } from '../../server/freehold_login_bounds';
import {
  createFreeholdPersistStore,
  FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_FLUSH_MAX_PASSES,
  FREEHOLD_PERSIST_LEAVE_FLUSH_MS,
  FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE,
  FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS,
  FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
  FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS,
  FREEHOLD_PERSIST_MAX_ACTIVE_LOADS,
  FREEHOLD_PERSIST_MAX_ACTIVE_WRITES,
  FREEHOLD_PERSIST_MAX_WRITE_ERRORS,
  FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES,
  FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS,
  FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS,
  FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS,
  FREEHOLD_RETRYABLE_HOLD_KINDS,
  type FreeholdPersistPorts,
  type FreeholdPersistStore,
  type LoadedFreehold,
} from '../../server/freehold_persist';
import {
  freeholdPersistIdle,
  freeholdPreloadUnavailable,
  registerFreeholdPersistStore,
} from '../../server/freehold_persist_registry';
import { bindFreeholdOnJoin, flushFreeholdBinding } from '../../server/freehold_session_binding';
import { freeholdTxBeginSql } from '../../server/freehold_tx';
import { FREEHOLD_PERSIST_RETRY_WRITE_CAP } from '../../server/freehold_write_retry';
import { seedWouldLandOnRealRow } from '../../server/freehold_write_seal';
import { createKeyedSerialWriter } from '../../server/serial_writer';
import {
  FREEHOLD_MAX_LAYOUT_ROWS,
  FREEHOLD_MAX_OWNED_BYTES,
  FREEHOLD_MAX_STORED_BYTES,
  FREEHOLD_MAX_TROPHY_ROWS,
  type FreeholdLoadResult,
  normalizeFreehold,
  type PersistedFreehold,
  persistedFreeholdBytes,
  persistedFreeholdFromState,
} from '../../src/sim/freehold/persisted';
import {
  defaultFreeholdState,
  ensureFreeholdRecord,
  evictFreehold,
  PENDING_FREEHOLD_PLOT_ID,
  seedFreeholdOnJoin,
} from '../../src/sim/freehold/state';
import type { FreeholdState } from '../../src/sim/freehold/types';
import type { SimContext } from '../../src/sim/sim_context';
import { methodBody } from '../helpers/method_body';
import { stripComments } from '../helpers/strip_comments';

const SOURCE_PATH = 'server/freehold_persist.ts';

// Deliberately distinctive so the "no identifiers in stats" assertion cannot
// pass by accident against a small counter value.
const ACCOUNT_ID = 918_273;
const OWNER_KEY = `account:${ACCOUNT_ID}`;
const ROW_PLOT_ID = 'plot:rowfixture91';
// The identity a fresh account's own insert mints, distinct from the row
// fixture's, for the cases that model an entry re-reading the row it wrote.
const MINTED_PLOT_ID = 'plot:minted1';
const OTHER_ACCOUNT_ID = 604_513;
/** The shipped pool size the realm runs with (DB_POOL_MAX_CLIENTS_DEFAULT in
 *  server/db.ts), spelled here rather than imported, because that module opens a
 *  real Pool at module scope and this suite's whole point is that it drives the
 *  store with no database. Read as a source literal below, so the two cannot
 *  drift apart silently. */
const DEFAULT_DB_POOL_MAX_CLIENTS = 10;
const OTHER_OWNER_KEY = `account:${OTHER_ACCOUNT_ID}`;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The milliseconds an `AbortSignal.timeout(ms)` was built with, recovered by
 * racing it against real timers. Vitest's fake timers do not reach into the
 * signal, and the constant is the thing under test, so the deadline has to be
 * read from the signal rather than assumed from the source.
 */
function timeoutMsOf(signal: AbortSignal): number {
  const recorded = signalDeadlines.get(signal);
  if (recorded === undefined) throw new Error('signal was not created through the patched timeout');
  return recorded;
}

/** Every AbortSignal.timeout this file's subject creates, with its deadline.
 *  Patched once for the file and restored in afterAll, so the store keeps using
 *  the real API and the test only observes it. */
const signalDeadlines = new WeakMap<AbortSignal, number>();
const originalAbortTimeout = AbortSignal.timeout;
const realAbortTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = ((ms: number) => {
  const signal = realAbortTimeout(ms);
  signalDeadlines.set(signal, ms);
  return signal;
}) as typeof AbortSignal.timeout;
afterAll(() => {
  AbortSignal.timeout = originalAbortTimeout;
});

/** Let the microtask queue settle. The keyed FIFO defers each start by a
 *  microtask, and a write hop is queue, permit, serialize, write. */
async function tick(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function persistedFixture(overrides: Partial<PersistedFreehold> = {}): PersistedFreehold {
  return {
    version: 1,
    plotId: ROW_PLOT_ID,
    tier: 'inn_room',
    layout: [{ placementId: 1, itemId: 'oak_chair', x: 1.5, y: 0, z: -2.25, yaw: 0 }],
    trophies: [{ plinth: 0, trophyId: 'skull_of_something' }],
    condition: 87,
    visitPolicy: 'friends',
    rev: 5,
    ...overrides,
  };
}

function rowFixture(overrides: Partial<FreeholdRow> = {}): FreeholdRow {
  return {
    accountId: ACCOUNT_ID,
    plotIndex: 0,
    plotId: ROW_PLOT_ID,
    schemaVersion: 1,
    durableRev: '7',
    wireRev: '5',
    tier: 'inn_room',
    layout: [{ placementId: 1, itemId: 'oak_chair', x: 1.5, y: 0, z: -2.25, yaw: 0 }],
    trophies: [{ plinth: 0, trophyId: 'skull_of_something' }],
    condition: 87,
    visitPolicy: 'friends',
    upkeepBinding: 'unbound_no_history',
    ownedBytes: 256,
    ...overrides,
  };
}

interface HarnessOptions {
  readRow?: (accountId: number, maxOwnedBytes: number) => Promise<FreeholdRowLoad>;
  rowLoad?: FreeholdRowLoad;
  readHearth?: (accountId: number) => Promise<FreeholdHearthLoad>;
  hearthLoad?: FreeholdHearthLoad;
  /** What the normalizer answers, for the answers no row can be built to give
   *  (a refusal kind, a repair list, one object's identity). Left out, the REAL
   *  normalizer reads the row's own document, so a document can never disagree
   *  with the row it came from. */
  normalized?: FreeholdLoadResult;
  /** The fenced writer's whole vocabulary (07a), so a case can answer
   *  `fenced` exactly as server/freehold_fenced_write.ts does. */
  writeRow?: (input: FreeholdUpsert) => Promise<FreeholdFencedUpsertResult>;
  /** A DARK realm. One flag on the one context, exactly as the composition root
   *  binds it: the store's `enabled` port reads it and the sim's record
   *  inserters honour it, so a dark harness can hold no live record either. */
  dark?: boolean;
  acquirePermit?: (signal: AbortSignal) => Promise<{ release(): void } | null>;
  enqueue?: <T>(key: string, signal: AbortSignal, write: () => Promise<T>) => Promise<T>;
  /** The COMBINED login port, which the real server binds and the two-port pair
   *  above only stands in for. Off by default so every existing case keeps
   *  driving the fallback; the cases that pass it are the only coverage the
   *  production arm has. */
  readDurables?: FreeholdPersistPorts['readDurables'];
  /** Override the deadline scheduler, for the one case that models a host whose
   *  timers refuse to arm. */
  scheduleDeadline?: FreeholdPersistPorts['scheduleDeadline'];
  /** Called before each serialize the STORE makes, for the one case that
   *  advances the clock inside the codec bracket. It must only move the clock:
   *  the answer comes from the live map like every other liveness read. */
  onSerialize?: () => void;
  /** 07a: whether this process still holds a plot's global claim (the realm
   *  binds the claim registry). Left out, the port is unbound, as on a host
   *  with no claims, and every replay proceeds. */
  claimHeld?: (plotId: string) => boolean;
}

interface DeadlineJob {
  readonly ms: number;
  readonly fire: () => void;
  cancelled: boolean;
  fired: boolean;
}

/** A sanctioned edit of a live record: content only, never its identity. */
type RecordEdit = Partial<
  Pick<PersistedFreehold, 'tier' | 'layout' | 'trophies' | 'condition' | 'visitPolicy' | 'rev'>
>;

/** Every harness built by the running case, so `afterEach` can hold each one to
 *  the liveness audit. */
const liveHarnesses: Array<{ readonly livenessViolations: readonly string[] }> = [];

/** Every disagreement any harness of the running case recorded: what `afterEach`
 *  fails on, and a case can read it to prove the gate sees a planted one. */
function auditViolations(): string[] {
  return liveHarnesses.flatMap((h) => h.livenessViolations);
}

/** A CASE BUG a harness double refused, recorded as it throws. The double runs
 *  inside the store, whose own catches would turn the throw into store
 *  behaviour (a `read_threw` hold, a counted thrown write), so the case could
 *  pass on the wrong reason; `afterEach` fails it instead. */
const caseBugs: string[] = [];

function harness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const writes: FreeholdUpsert[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const deadlines: DeadlineJob[] = [];
  const permitSignals: AbortSignal[] = [];
  const ownedBytesSeen: number[] = [];
  // THE ONE LIVE MAP, which is the whole model. Production derives all four
  // liveness reads (`hasLive`, `serialize`, `liveRev`, `livePlotId`) from
  // `ctx.freeholds` through `freeholdLivenessPorts`, and so does this harness,
  // through the SAME function over a real SimContext map. A record is therefore
  // live for all four reads or for none of them, which the old port bag could
  // not promise: it defaulted `hasLive` to false while `serialize` still handed
  // the writer a document, so cases modelled a liveness state no realm can
  // produce (ROUND SEVENTEEN, Q3).
  //
  // THE TWO MOMENTS A LOGIN HAS, and nothing between them. At PRELOAD no record
  // exists for a fresh login, because the handshake reads before the join. At
  // the JOIN the durable answer is installed and addPlayer seeds, in production
  // order, through the production functions (`bindFreeholdOnJoin`, then
  // `seedFreeholdOnJoin`). A record leaves the map only through `removePlayer`,
  // at the last session out, as `releaseFreeholdOnLeave` evicts it, and only
  // after that session's leave flush, as GameServer.leave orders them; its
  // content moves only through `edit`, which models a sanctioned mutator: it
  // needs a live record, never touches the identity, and never moves the
  // revision backwards. Cases do not reach the map any other way: it is not
  // handed out, `record()` answers a copy, and `onSerialize` moves only the
  // clock. The audit below checks what the map answers, not how a case built
  // it, so that discipline is what keeps a record one the sim could hold.
  const ctx = fakeCtx(!options.dark);
  const live = freeholdLivenessPorts(() => ctx);
  // Sessions per owner key, which is the fact `releaseFreeholdOnLeave` walks the
  // roster for: the record is evicted only when the LAST session sharing the key
  // leaves.
  const sessions = new Map<string, number>();
  let nextEntityId = 1;
  const livenessViolations: string[] = [];
  let auditing = false;
  const fifo = createKeyedSerialWriter<string>();
  let nowMs = 10_000;
  let minted = 0;
  // Permits the next acquires are refused, ahead of any case option: the one
  // order that still seats a stand-in beside an entry that knows the row is a
  // re-ask refused on capacity (`rejoinOverEviction`).
  let refusePermits = 0;

  // Leave flushes not yet followed by their removePlayer, per owner key.
  const flushesOwed = new Map<string, number>();
  const identitySets = {
    validTierIds: new Set(['inn_room', 'cottage', 'manor']) as ReadonlySet<string>,
    validVisitPolicies: new Set(['closed', 'friends', 'open']) as ReadonlySet<string>,
  };
  // ONE ROW PER ACCOUNT. A fixed row answered for every account would give
  // several accounts one plot id, which the unique plot_id index forbids, so a
  // second account reads its own row under its own name.
  const readRow =
    options.readRow ??
    (async (accountId: number): Promise<FreeholdRowLoad> => {
      const load = options.rowLoad ?? { kind: 'absent' };
      if (load.kind !== 'row' || accountId === load.row.accountId) return load;
      return { kind: 'row', row: { ...load.row, accountId, plotId: `plot:row${accountId}` } };
    });
  const readHearth =
    options.readHearth ??
    (async (): Promise<FreeholdHearthLoad> => options.hearthLoad ?? { kind: 'absent' });
  const writeRow =
    options.writeRow ??
    (async (): Promise<FreeholdFencedUpsertResult> => ({ kind: 'inserted', durableRev: '1' }));

  /** THE AUDIT, run at every liveness read the store makes. It asks all four
   *  PORTS (not the map behind them), so a port that stopped reading the map is
   *  caught at the first read that disagrees, wherever in the suite that is. A
   *  throw here would be swallowed by the store's own guards, so a disagreement
   *  is RECORDED and `afterEach` fails the case that reached it. */
  const audit = (ownerKey: string): void => {
    if (auditing) return;
    auditing = true;
    try {
      const has = ports.hasLive(ownerKey);
      const doc = ports.serialize(ownerKey);
      const rev = ports.liveRev(ownerKey);
      const name = ports.livePlotId(ownerKey);
      const agree = has
        ? doc !== null && rev === doc.rev && name === doc.plotId
        : doc === null && rev === null && name === null;
      if (!agree) {
        livenessViolations.push(
          `${ownerKey}: hasLive ${has}, serialize ${doc === null ? 'null' : `rev ${doc.rev} ${doc.plotId}`}, liveRev ${rev}, livePlotId ${name}`,
        );
      }
    } finally {
      auditing = false;
    }
  };

  const ports: FreeholdPersistPorts = {
    async readRow(accountId: number, maxOwnedBytes: number): Promise<FreeholdRowLoad> {
      calls.push('readRow');
      ownedBytesSeen.push(maxOwnedBytes);
      return await readRow(accountId, maxOwnedBytes);
    },
    async readHearth(accountId: number): Promise<FreeholdHearthLoad> {
      calls.push('readHearth');
      return await readHearth(accountId);
    },
    ...(options.readDurables
      ? {
          readDurables: async (accountId: number, maxOwnedBytes: number) => {
            calls.push('readDurables');
            ownedBytesSeen.push(maxOwnedBytes);
            // biome-ignore lint/style/noNonNullAssertion: guarded by the spread.
            return await options.readDurables!(accountId, maxOwnedBytes);
          },
        }
      : {}),
    async writeRow(input: FreeholdUpsert): Promise<FreeholdFencedUpsertResult> {
      calls.push('writeRow');
      writes.push(input);
      return await writeRow(input);
    },
    identitySets() {
      // The fixture vocabulary, so the harness's own documents are admissible
      // on BOTH sides exactly as a realm's are.
      return identitySets;
    },
    normalize(raw: unknown): FreeholdLoadResult {
      calls.push('normalize');
      // The REAL normalizer over the row's own document unless the case needs
      // an answer no row can give.
      return options.normalized ?? normalizeFreehold(raw, identitySets);
    },
    serialize(ownerKey: string): PersistedFreehold | null {
      if (!auditing) {
        calls.push('serialize');
        options.onSerialize?.();
      }
      const doc = live.serialize(ownerKey);
      audit(ownerKey);
      return doc;
    },
    livePlotId(ownerKey: string): string | null {
      const name = live.livePlotId(ownerKey);
      audit(ownerKey);
      return name;
    },
    liveRev(ownerKey: string): number | null {
      if (!auditing) calls.push('liveRev');
      const rev = live.liveRev(ownerKey);
      audit(ownerKey);
      return rev;
    },
    hasLive(ownerKey: string): boolean {
      const has = live.hasLive(ownerKey);
      audit(ownerKey);
      return has;
    },
    enabled(): boolean {
      return ctx.freeholdsEnabled;
    },
    mintPlotId(): string {
      minted += 1;
      return `plot:minted${minted}`;
    },
    ...(options.claimHeld
      ? {
          claimHeld: (plotId: string) => {
            calls.push('claimHeld');
            // biome-ignore lint/style/noNonNullAssertion: guarded by the spread.
            return options.claimHeld!(plotId);
          },
        }
      : {}),
    async acquirePermit(signal: AbortSignal): Promise<{ release(): void } | null> {
      calls.push('permit');
      permitSignals.push(signal);
      if (refusePermits > 0) {
        refusePermits -= 1;
        return null;
      }
      if (options.acquirePermit) return await options.acquirePermit(signal);
      return {
        release(): void {
          calls.push('release');
        },
      };
    },
    enqueue<T>(key: string, signal: AbortSignal, write: () => Promise<T>): Promise<T> {
      calls.push('enqueue');
      if (options.enqueue) return options.enqueue(key, signal, write);
      return fifo.enqueueCancellable(key, signal, write);
    },
    nowMs(): number {
      return nowMs;
    },
    warn(message: string): void {
      warnings.push(message);
    },
    error(message: string, err?: unknown): void {
      // The DETAIL too, because the bounded-error rule is about what rides the
      // second argument: a harness that dropped it could not tell a classified
      // error object from a raw one carrying row content.
      errors.push(err === undefined ? message : `${message} ${JSON.stringify(err)}`);
    },
    scheduleDeadline(callback: () => void, ms: number): () => void {
      if (options.scheduleDeadline) return options.scheduleDeadline(callback, ms);
      const job: DeadlineJob = {
        ms,
        // Recorded, so "the deadline never fired" is a fact a case can assert
        // rather than a field nothing ever writes.
        fire: () => {
          job.fired = true;
          callback();
        },
        cancelled: false,
        fired: false,
      };
      deadlines.push(job);
      // A ZERO budget (a re-ask after a first ask that spent the whole budget)
      // expires on its own in production, a setTimeout(0) the replay of a loaded
      // entry beats because it settles in microtasks; the harness fires it the
      // same way rather than waiting for a case to.
      if (ms === 0) {
        setTimeout(() => {
          if (!job.cancelled && !job.fired) job.fire();
        }, 0);
      }
      return () => {
        job.cancelled = true;
      };
    },
  };

  const store = createFreeholdPersistStore(ports);
  // THE JOIN IS THE ONLY RETAIN. Production takes a session reference in exactly
  // one place, `bindFreeholdOnJoin`, between the install and addPlayer's seed, so
  // on a lit realm a retained entry always has a live record beside it. A case
  // that retained directly would model a session in the world with no record at
  // all, which is the second moment missing, so the store handed to cases refuses
  // it and `join` is the way in.
  // "Always", with the one teardown exception production has: a join that
  // fails after its seed releases fire-and-forget, so for an entry that owes a
  // write the reference drops after the synchronous removePlayer.
  const caseStore: FreeholdPersistStore = {
    ...store,
    retain(): void {
      throw new Error('a session reference is taken by h.join, never by a bare retain');
    },
    // Counted, so removePlayer can require the flush GameServer.leave runs first.
    flushAndRelease(ownerKey: string): Promise<void> {
      flushesOwed.set(ownerKey, (flushesOwed.get(ownerKey) ?? 0) + 1);
      return store.flushAndRelease(ownerKey);
    },
  };

  /** THE SECOND MOMENT: GameServer.join's order, through its own functions.
   *  The store decides the answer at install time, it is installed and the
   *  session retained, then addPlayer seeds the default if nothing is live yet.
   *
   *  The answer a production join is handed is the handshake's RE-ASK, made
   *  after the lease and the character read with nothing awaited between it and
   *  the join (`joinAfterReask`, and `login` for a whole handshake). A case that
   *  awaits something between its re-ask and this call is modelling the store's
   *  defensive arm for that one await, on purpose, and says so.
   *
   *  TWO SESSIONS OF ONE ACCOUNT are in the world together only briefly in
   *  production, because MAX_ACTIVE_SESSIONS_PER_ACCOUNT is one: the linkdead
   *  swap, where a new character's login ends the old one's grace and fires its
   *  leave, or a GM. A case that joins twice models that overlap. */
  const join = (loaded: LoadedFreehold | undefined, accountId = ACCOUNT_ID): string => {
    const ownerKey = bindFreeholdOnJoin(store, ctx, accountId, loaded);
    seedFreeholdOnJoin(ctx, { entityId: nextEntityId++ }, ownerKey);
    sessions.set(ownerKey, (sessions.get(ownerKey) ?? 0) + 1);
    return ownerKey;
  };

  /** removePlayer's half of a leave: `releaseFreeholdOnLeave` evicts the record
   *  only when the LAST session sharing the owner key is gone. */
  const removePlayer = (ownerKey = OWNER_KEY): void => {
    const owed = flushesOwed.get(ownerKey) ?? 0;
    if (owed <= 0) throw new Error(`removePlayer for ${ownerKey} runs after its leave flush`);
    flushesOwed.set(ownerKey, owed - 1);
    const remaining = (sessions.get(ownerKey) ?? 0) - 1;
    if (remaining < 0) throw new Error(`no session of ${ownerKey} is in the world`);
    if (remaining > 0) {
      sessions.set(ownerKey, remaining);
      return;
    }
    sessions.delete(ownerKey);
    evictFreehold(ctx, ownerKey);
  };

  const h = {
    store: caseStore,
    /** The store WITHOUT the join guard, for the one case that drives retain's
     *  own argument check, on a dark harness where a retain reads nothing. */
    rawStore: store,
    ports,
    calls,
    writes,
    warnings,
    errors,
    deadlines,
    permitSignals,
    ownedBytesSeen,
    livenessViolations,
    join,
    removePlayer,
    /** A whole login: the handshake's first ask (before the lease), its
     *  re-ask (after the character read), then the join. Answers the re-ask.
     *  The re-ask runs on what the first ask left of the one housing budget,
     *  measured on this harness's clock, exactly as server/ws_auth.ts does. */
    async login(accountId = ACCOUNT_ID): Promise<LoadedFreehold> {
      const firstAskStartMs = nowMs;
      const first = await store.preload(accountId);
      // A first ask refused on the budget spent all of it, whatever this
      // harness's clock says (a case fires a budget without moving the clock).
      const firstAskMs =
        first.hold?.kind === 'no_budget'
          ? FREEHOLD_PERSIST_LOGIN_BUDGET_MS
          : nowMs - firstAskStartMs;
      return await h.joinAfterReask(accountId, firstAskMs);
    },
    /** The fresh arm's tail, for a case whose first ask came earlier: the
     *  re-ask, marked and on the budget the first ask left (`firstAskMs`,
     *  zero when the case does not model it), then the join with nothing
     *  awaited between. Answers the re-ask. */
    async joinAfterReask(accountId = ACCOUNT_ID, firstAskMs = 0): Promise<LoadedFreehold> {
      const atJoin = await store.preload(accountId, {
        budgetMs: freeholdReaskBudgetMs(firstAskMs),
        reask: true,
      });
      join(atJoin, accountId);
      return atJoin;
    },
    /** GameServer.leave's order: flush while the record is still live, then
     *  removePlayer. */
    async leave(ownerKey = OWNER_KEY): Promise<void> {
      await flushFreeholdBinding(caseStore, ownerKey);
      removePlayer(ownerKey);
    },
    /**
     * A REJOIN THAT LANDS AFTER THE EVICTION ON A RE-ASK REFUSED A PERMIT, the
     * order that still seats a STAND-IN beside an entry that knows the row
     * (`rejoinBeforeRemoval` is another way an entry faces a record it did not
     * install). The returning session's handshake first asks while the previous
     * session's record is still live; the previous session leaves CLEAN, so its
     * flush collects the entry, and removePlayer evicts; the re-ask is then a
     * durable read, refused a permit, so the join installs nothing and addPlayer
     * seeds the stand-in; retain's repair reload re-reads the row, and the tick
     * lets that read land. Before ruling (b) the join installed nothing here with
     * no refusal at all, because it trusted the first answer; that order is gone.
     */
    async rejoinOverEviction(accountId = ACCOUNT_ID): Promise<LoadedFreehold> {
      const ownerKey = `account:${accountId}`;
      await store.preload(accountId);
      await flushFreeholdBinding(caseStore, ownerKey);
      removePlayer(ownerKey);
      refusePermits = 1;
      const atJoin = await store.preload(accountId, {
        budgetMs: freeholdReaskBudgetMs(0),
        reask: true,
      });
      if (refusePermits !== 0) {
        refusePermits = 0;
        throw new Error('rejoinOverEviction needs a clean leave that collects the entry');
      }
      join(atJoin, accountId);
      await tick(30);
      return atJoin;
    },
    /**
     * A SECOND SESSION THAT JOINS BEFORE THE FIRST ONE'S REMOVAL, which is how
     * one realm's entry comes to know MORE than the record beside it. The first
     * session leaves: its flush finds the entry clean and collects it, and its
     * removePlayer has not run yet. The next handshake lands in that window,
     * finds the record live, and re-reads the row through preload's already-live
     * arm, so the new entry learns whatever the row holds NOW (another realm
     * sharing this database may have written it forward). It joins before the
     * first session's removePlayer, which is then not the last one out, so the
     * record the first session left behind stays.
     */
    async rejoinBeforeRemoval(accountId = ACCOUNT_ID): Promise<LoadedFreehold> {
      const ownerKey = `account:${accountId}`;
      await flushFreeholdBinding(caseStore, ownerKey);
      await store.preload(accountId);
      const answer = await h.joinAfterReask(accountId);
      removePlayer(ownerKey);
      return answer;
    },
    /** A COPY of the live record, for a case that reads it; the map itself is
     *  reachable only through the production functions and `edit`. */
    record(ownerKey = OWNER_KEY): FreeholdState | undefined {
      const state = ctx.freeholds.get(ownerKey);
      return state === undefined ? undefined : structuredClone(state);
    },
    /**
     * A SANCTIONED EDIT: what a mutator does to a live record. It needs one (no
     * mutator reaches an owner with no record), it never touches the identity
     * (nothing in the sim writes an identity), and it moves the revision
     * FORWARDS, by one unless the case names how far, because every mutator
     * increments. A record below a revision the entry committed is still
     * reachable, but only the way production reaches it: through a join.
     */
    edit(ownerKey: string, patch: RecordEdit = {}): void {
      const state = ctx.freeholds.get(ownerKey);
      if (!state) throw new Error(`no live record for ${ownerKey} to edit`);
      const rev = patch.rev ?? state.rev + 1;
      if (rev <= state.rev) {
        throw new Error(`an edit moves the revision forwards, not ${state.rev} to ${rev}`);
      }
      if (patch.tier !== undefined) state.tier = patch.tier as FreeholdState['tier'];
      if (patch.layout !== undefined) state.layout = patch.layout.map((row) => ({ ...row }));
      if (patch.trophies !== undefined) state.trophies = patch.trophies.map((row) => ({ ...row }));
      if (patch.condition !== undefined) state.condition = patch.condition;
      if (patch.visitPolicy !== undefined) {
        state.visitPolicy = patch.visitPolicy as FreeholdState['visitPolicy'];
      }
      state.rev = rev;
    },
    setNow(ms: number): void {
      nowMs = ms;
    },
    /** Refuse the next `count` permit acquires, ahead of any case option: a
     *  saturated background gate for exactly the reads or writes a case names. */
    refuseNextPermits(count: number): void {
      refusePermits = count;
    },
    writeCount(): number {
      return calls.filter((call) => call === 'writeRow').length;
    },
    fireDeadline(): boolean {
      const job = deadlines.find((candidate) => !candidate.cancelled && !candidate.fired);
      if (!job) return false;
      job.fired = true;
      job.fire();
      return true;
    },
  };
  liveHarnesses.push(h);
  return h;
}

type Harness = ReturnType<typeof harness>;

/** A whole login, leaving the store with one loaded, retained entry and the
 *  record the join put in the sim. */
async function loadedStore(options: HarnessOptions = {}): Promise<Harness> {
  const h = harness(options);
  await h.login();
  h.calls.length = 0;
  return h;
}

/** A second furnishing, so a house one session placed differs from any older
 *  house another session's stale answer holds. */
const TABLE = { placementId: 2, itemId: 'oak_table', x: 0, y: 0, z: 0, yaw: 0 };

/** The furnished house `persistedFixture` describes, as a sanctioned edit. */
function furnishedEdit(rev: number): RecordEdit {
  const house = persistedFixture({ rev });
  return {
    tier: house.tier,
    layout: house.layout,
    trophies: house.trophies,
    condition: house.condition,
    visitPolicy: house.visitPolicy,
    rev,
  };
}

/** What another realm's write may move on a row: the content, never the name,
 *  the fence or the account, which no write sets directly. */
type RowAdvance = Partial<Omit<FreeholdRow, 'plotId' | 'durableRev' | 'accountId'>>;

/**
 * A ROW THAT LIVES IN A DATABASE: it exists once it is inserted, every write is
 * kept as the row it would leave, the durable revision counts up exactly as the
 * column does, and the compare-and-swap refuses what upsertFreehold refuses. A
 * fixed `rowLoad` cannot change, so a re-read after an insert would find nothing
 * and mint a second identity for an account that has a row, which no database
 * can answer. `advance` is another realm sharing the database writing the row
 * forward: a new wire revision and a new durable revision together.
 */
function rowRemembered(initial: FreeholdRow | null = null): {
  readRow: (accountId: number) => Promise<FreeholdRowLoad>;
  writeRow: (input: FreeholdUpsert) => Promise<FreeholdUpsertResult>;
  advance: (patch: RowAdvance) => void;
} {
  let row: FreeholdRow | null = initial;
  // ONE ACCOUNT'S database: a read or a write for another account is a case
  // bug, not a row it may share.
  let owner = initial?.accountId ?? null;
  const mine = (accountId: number): void => {
    if (owner === null) owner = accountId;
    if (accountId === owner) return;
    const bug = `rowRemembered holds account ${owner} only, not ${accountId}`;
    caseBugs.push(bug);
    throw new Error(bug);
  };
  return {
    readRow: async (accountId: number): Promise<FreeholdRowLoad> => {
      mine(accountId);
      return row ? { kind: 'row', row } : { kind: 'absent' };
    },
    // Another realm's write: the CONTENT moves and the durable revision with it.
    // Never the name or the fence directly, which no write sets.
    advance: (patch: RowAdvance): void => {
      if (row === null) throw new Error('no row to write forward');
      row = { ...row, ...patch, durableRev: String(Number(row.durableRev) + 1) };
    },
    // The compare-and-swap fence upsertFreehold enforces, so a writer this
    // database would refuse is refused here too: an insert over an existing row
    // and an update against a moved or missing one. An UPDATE sets only the
    // columns FREEHOLD_CAS_UPDATE_SQL sets, so the row keeps its name.
    writeRow: async (input: FreeholdUpsert): Promise<FreeholdUpsertResult> => {
      mine(input.accountId);
      if (input.expectedDurableRev === null && row !== null) {
        return { kind: 'stale', durableRev: row.durableRev };
      }
      if (input.expectedDurableRev !== null && row === null) return { kind: 'missing' };
      if (
        input.expectedDurableRev !== null &&
        row !== null &&
        input.expectedDurableRev !== row.durableRev
      ) {
        return { kind: 'stale', durableRev: row.durableRev };
      }
      const durableRev = String(Number(row?.durableRev ?? '0') + 1);
      const content = {
        tier: input.tier,
        layout: JSON.parse(input.layoutJson),
        trophies: JSON.parse(input.trophiesJson),
        condition: input.condition,
        visitPolicy: input.visitPolicy,
        wireRev: String(input.wireRev),
        schemaVersion: input.schemaVersion,
        durableRev,
      };
      row =
        row === null
          ? rowFixture({
              ...content,
              accountId: input.accountId,
              plotIndex: input.plotIndex,
              plotId: input.plotId,
            })
          : { ...row, ...content };
      return { kind: input.expectedDurableRev === null ? 'inserted' : 'updated', durableRev };
    },
  };
}

function fakeCtx(freeholdsEnabled = true): SimContext {
  return {
    freeholdsEnabled,
    freeholds: new Map(),
    freeholdKeyReadyAtMs: new Map<string, number>(),
  } as unknown as SimContext;
}

afterEach(async () => {
  registerFreeholdPersistStore(null);
  // EVERY liveness read any case made agreed with the other three at that
  // instant (see `audit` in the harness), and no double refused a case bug the
  // store would have swallowed. Drained first, so a read the case left in
  // flight (a repair reload, an ungated write) is audited too.
  await tick(30);
  const violations = auditViolations();
  liveHarnesses.length = 0;
  const bugs = caseBugs.splice(0);
  expect(violations, 'a liveness read disagreed with the live map').toEqual([]);
  expect(bugs, 'a harness double refused what the case asked of it').toEqual([]);
});

describe('the harness models only a liveness state the server can produce', () => {
  // ROUND SEVENTEEN, Q3, and the reason 07's QA verdict failed: the old port
  // bag answered `hasLive` false by default while `serialize` still handed the
  // writer a document, so cases modelled a state no realm can produce. These
  // cases pin the rebuilt harness, not the store: a harness that can report no
  // record to one liveness read and a record to another reds here, and the
  // per-read audit in `afterEach` reds whichever case reached it.
  const read = (h: Harness) => ({
    has: h.ports.hasLive(OWNER_KEY),
    doc: h.ports.serialize(OWNER_KEY),
    rev: h.ports.liveRev(OWNER_KEY),
    name: h.ports.livePlotId(OWNER_KEY),
  });

  it('answers all four liveness reads from ONE live map, at both moments of a login', async () => {
    const h = harness({ ...rowRemembered(rowFixture()) });
    // THE FIRST MOMENT: the handshake has read and nothing is live.
    const answer = await h.store.preload(ACCOUNT_ID);
    expect(read(h)).toEqual({ has: false, doc: null, rev: null, name: null });
    // THE SECOND: the join installed the row's house, and all four agree on it.
    h.join(answer);
    const joined = read(h);
    expect(joined.has).toBe(true);
    expect(joined.doc?.plotId).toBe(ROW_PLOT_ID);
    expect(joined.doc?.rev).toBe(5);
    expect(joined.rev).toBe(5);
    expect(joined.name).toBe(ROW_PLOT_ID);
    // A sanctioned edit moves the document and the revision together.
    h.edit(OWNER_KEY, { rev: 6 });
    expect(read(h).rev).toBe(6);
    expect(read(h).doc?.rev).toBe(6);
    // The whole leave: the flush writes the edit, and the last session out
    // takes the record with it, from all four at once.
    await h.leave();
    expect(h.writes.map((write) => write.wireRev)).toEqual([6]);
    expect(read(h)).toEqual({ has: false, doc: null, rev: null, name: null });
    // A rejoin reads the row the leave wrote (a READ, not a replay: the clean
    // entry was collected), and all four agree on THAT.
    h.calls.length = 0;
    await h.joinAfterReask();
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    const rejoined = read(h);
    expect(rejoined.has).toBe(true);
    expect(rejoined.name).toBe(ROW_PLOT_ID);
    expect(rejoined.doc?.plotId).toBe(ROW_PLOT_ID);
    expect(rejoined.rev).toBe(6);
    expect(rejoined.doc?.rev).toBe(6);
    expect(h.livenessViolations).toEqual([]);
  });

  it('keeps each owner its own record, so one owner is never live through another', async () => {
    const h = harness({ rowLoad: { kind: 'absent' } });
    await h.login(ACCOUNT_ID);
    const other = h.ports;
    expect(other.hasLive(OTHER_OWNER_KEY)).toBe(false);
    expect(other.serialize(OTHER_OWNER_KEY)).toBeNull();
    expect(other.liveRev(OTHER_OWNER_KEY)).toBeNull();
    expect(other.livePlotId(OTHER_OWNER_KEY)).toBeNull();
    await h.login(OTHER_ACCOUNT_ID);
    // Each installed under its OWN minted name, in login order.
    expect(h.ports.livePlotId(OWNER_KEY)).toBe('plot:minted1');
    expect(h.ports.livePlotId(OTHER_OWNER_KEY)).toBe('plot:minted2');
  });

  // The audit is what makes every OTHER case a probe of this property, so it is
  // proved non-vacuous here: each liveness port in turn is made to disagree with
  // the map in exactly the way the old bag could, and the store's own reads
  // must record it. The violations are then cleared, because they were planted.
  const sabotaged: ReadonlyArray<{
    readonly port: 'hasLive' | 'serialize' | 'liveRev' | 'livePlotId';
    readonly withRecord: boolean;
    readonly plant: (h: Harness) => void;
    /** What the audit must record at the store's first read after the plant. */
    readonly first: string;
  }> = [
    // The old bag's default, beside a record that IS live.
    {
      port: 'hasLive',
      withRecord: true,
      plant: (h) => (h.ports.hasLive = () => false),
      first: `${OWNER_KEY}: hasLive false, serialize rev 5 ${ROW_PLOT_ID}, liveRev 5, livePlotId ${ROW_PLOT_ID}`,
    },
    // The old bag's default document, with no record at all.
    {
      port: 'serialize',
      withRecord: false,
      plant: (h) => (h.ports.serialize = () => persistedFixture()),
      first: `${OWNER_KEY}: hasLive false, serialize rev 5 ${ROW_PLOT_ID}, liveRev null, livePlotId null`,
    },
    {
      port: 'liveRev',
      withRecord: false,
      plant: (h) => (h.ports.liveRev = () => 5),
      first: `${OWNER_KEY}: hasLive false, serialize null, liveRev 5, livePlotId null`,
    },
    {
      port: 'livePlotId',
      withRecord: false,
      plant: (h) => (h.ports.livePlotId = () => ROW_PLOT_ID),
      first: `${OWNER_KEY}: hasLive false, serialize null, liveRev null, livePlotId ${ROW_PLOT_ID}`,
    },
  ];
  for (const { port, withRecord, plant, first } of sabotaged) {
    it(`records the store's first read that finds ${port} disagreeing with the map`, async () => {
      const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
      if (withRecord) await h.login();
      else await h.store.preload(ACCOUNT_ID);
      expect(h.livenessViolations).toEqual([]);
      plant(h);
      // Nothing is audited until the STORE reads.
      expect(h.livenessViolations).toEqual([]);
      h.store.markDirty(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
      expect(h.livenessViolations[0], port).toBe(first);
      h.livenessViolations.length = 0;
    });
  }

  it('fails the case through afterEach whenever ANY harness recorded a violation', () => {
    // The step from a recorded disagreement to a red case, which every
    // sabotage case above clears before it could be seen: the harness has to be
    // on the list the gate reads, and the gate's reader has to return what was
    // recorded.
    // ANY harness: the violation is planted in the MIDDLE of three, so a
    // reader that looked at the first alone, or at the last, would miss it.
    const first = harness();
    const h = harness();
    const last = harness();
    for (const each of [first, h, last]) expect(liveHarnesses).toContain(each);
    h.ports.liveRev = () => 5;
    h.ports.hasLive(OWNER_KEY);
    expect(first.livenessViolations).toEqual([]);
    expect(last.livenessViolations).toEqual([]);
    expect(auditViolations()).toEqual([
      `${OWNER_KEY}: hasLive false, serialize null, liveRev 5, livePlotId null`,
    ]);
    h.livenessViolations.length = 0;
    expect(auditViolations()).toEqual([]);
  });

  it('binds its four liveness ports through the production function, and offers no override', () => {
    // No option can answer a liveness read, which `tsc` enforces: the check
    // below is a type assertion, inert at run time.
    expectTypeOf<
      Extract<keyof HarnessOptions, 'hasLive' | 'serialize' | 'liveRev' | 'livePlotId'>
    >().toBeNever();
    // And every port the store sees answers from the one production binding,
    // audited: read off this file, scoped to the harness body.
    const self = stripComments(readFileSync('tests/server/freehold_persist.test.ts', 'utf8'));
    const body = self.slice(self.indexOf('function harness('), self.indexOf('type Harness ='));
    expect(body).toContain('const live = freeholdLivenessPorts(() => ctx);');
    for (const port of ['hasLive', 'serialize', 'liveRev', 'livePlotId']) {
      const at = body.indexOf(`    ${port}(ownerKey: string)`);
      expect(at, port).toBeGreaterThan(-1);
      const wrapper = body.slice(at, body.indexOf('\n    },', at));
      expect(wrapper, port).toContain(`live.${port}(ownerKey)`);
      expect(wrapper, port).toContain('audit(ownerKey)');
    }
    // And the gate, WHOLE and in order: drain, read, clear, fail, and nothing
    // else. A step missing or moved (clearing before reading, a softened
    // matcher), an early return, or a guard around a matcher lets a recorded
    // violation or case bug pass, and each changes this text.
    const opens = self.indexOf('afterEach(async () => {');
    const gate = self.slice(opens, self.indexOf('\n});', opens) + 4);
    expect(gate.replace(/\s+/g, ' ')).toBe(
      [
        'afterEach(async () => {',
        'registerFreeholdPersistStore(null);',
        'await tick(30);',
        'const violations = auditViolations();',
        'liveHarnesses.length = 0;',
        'const bugs = caseBugs.splice(0);',
        "expect(violations, 'a liveness read disagreed with the live map').toEqual([]);",
        "expect(bugs, 'a harness double refused what the case asked of it').toEqual([]);",
        '});',
      ].join(' '),
    );
    // And it is the file's ONLY afterEach: vitest runs after-hooks in stack
    // order, so a second one could clear either list before this one reads it.
    expect(self.match(/^\s*afterEach\(/gm)).toHaveLength(1);
  });

  it('removes a player only after its leave flush, as GameServer.leave orders them', async () => {
    const h = await loadedStore();
    expect(() => h.removePlayer()).toThrow(/after its leave flush/);
    expect(h.record()).toBeDefined();
    await h.leave();
    expect(h.record()).toBeUndefined();
  });

  it('keeps a row database to what upsertFreehold does: one account, and an update keeps the name', async () => {
    const db = rowRemembered();
    const insert = {
      accountId: ACCOUNT_ID,
      plotIndex: 0,
      plotId: MINTED_PLOT_ID,
      tier: 'inn_room',
      layoutJson: '[]',
      trophiesJson: '[]',
      condition: 100,
      visitPolicy: 'closed',
      wireRev: 0,
      schemaVersion: 1,
      expectedDurableRev: null,
    };
    expect(await db.writeRow(insert)).toEqual({ kind: 'inserted', durableRev: '1' });
    // An insert over the row it made is the stale answer, not a second row.
    expect(await db.writeRow(insert)).toEqual({ kind: 'stale', durableRev: '1' });
    // The compare-and-swap UPDATE never sets plot_id, so the row keeps its name.
    expect(
      await db.writeRow({ ...insert, plotId: 'plot:another', wireRev: 1, expectedDurableRev: '1' }),
    ).toEqual({ kind: 'updated', durableRev: '2' });
    const read = await db.readRow(ACCOUNT_ID);
    expect(read.kind === 'row' ? read.row.plotId : null).toBe(MINTED_PLOT_ID);
    // And it is one account's row: another account is a case bug, on either
    // side, and recorded where afterEach fails it, since inside the store a
    // throw would read as a hold or a thrown write.
    await expect(db.readRow(OTHER_ACCOUNT_ID)).rejects.toThrow(/holds account/);
    await expect(db.writeRow({ ...insert, accountId: OTHER_ACCOUNT_ID })).rejects.toThrow(
      /holds account/,
    );
    const bug = `rowRemembered holds account ${ACCOUNT_ID} only, not ${OTHER_ACCOUNT_ID}`;
    expect(caseBugs).toEqual([bug, bug]);
    caseBugs.length = 0;
    // Another realm's write moves the content, never the name, the fence or the
    // account: `tsc` enforces it, and the check below is inert at run time.
    expectTypeOf<
      Extract<keyof Parameters<typeof db.advance>[0], 'plotId' | 'durableRev' | 'accountId'>
    >().toBeNever();
  });

  it('hands a case a COPY of the record, so the map moves only through edits', async () => {
    const h = await loadedStore();
    const copy = h.record();
    if (!copy) throw new Error('no record');
    copy.rev = 99;
    copy.layout.push({ placementId: 9, itemId: 'oak_chair', x: 0, y: 0, z: 0, yaw: 0 });
    expect(h.record()?.rev).toBe(0);
    expect(h.record()?.layout).toEqual([]);
  });

  it('takes a session reference only through the join, never a bare retain', async () => {
    const h = harness();
    await h.store.preload(ACCOUNT_ID);
    expect(() => h.store.retain(OWNER_KEY, ACCOUNT_ID)).toThrow(/h\.join/);
    expect(() => h.store.retain(OWNER_KEY)).toThrow(/h\.join/);
    expect(h.record()).toBeUndefined();
  });

  it('edits only a live record, never its identity, and never backwards', async () => {
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    expect(() => h.edit(OWNER_KEY, { rev: 1 })).toThrow(/no live record/);
    await h.login();
    expect(() => h.edit(OWNER_KEY, { rev: 5 })).toThrow(/forwards/);
    expect(() => h.edit(OWNER_KEY, { rev: 4 })).toThrow(/forwards/);
    h.edit(OWNER_KEY, { tier: 'cottage' });
    expect(h.record()?.rev).toBe(6);
    expect(h.record()?.tier).toBe('cottage');
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
  });
});

describe('freehold persist constants', () => {
  it('pins every bound this store enforces, to a literal', () => {
    // TO A LITERAL, because every other use of these in this file compares a
    // measurement against the constant itself. A self-comparison cannot notice
    // that the value moved: raising the write cap to Infinity or the leave
    // deadline to ten minutes leaves every such assertion green, and the second
    // one is a ten-minute logout block nothing would catch.
    expect(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS).toBe(10_000);
    expect(FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS).toBe(15_000);
    expect(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS).toBe(5_000);
    expect(FREEHOLD_PERSIST_MAX_ACTIVE_LOADS).toBe(4);
    expect(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES).toBe(4);
    expect(FREEHOLD_PERSIST_FLUSH_MAX_PASSES).toBe(4);
    expect(FREEHOLD_PERSIST_LEAVE_FLUSH_MS).toBe(2_000);
    expect(FREEHOLD_PERSIST_MAX_WRITE_ERRORS).toBe(3);
    expect(FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS).toBe(300_000);
    expect(FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES).toBe(2);
    // THE TWO THIS BLOCK USED TO OMIT, under a title that claims every bound.
    // The drain cap was referenced by no test at all, so dropping the drain arm
    // of writeCap entirely was invisible; the leave reserve appeared only as
    // `MAX_ACTIVE_WRITES + LEAVE_WRITE_RESERVE`, which is the self-comparison
    // this block's own comment forbids.
    expect(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES).toBe(8);
    expect(FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE).toBe(2);
    expect(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS).toBe(2_000);
    expect(FREEHOLD_MAX_STORED_BYTES).toBe(106_496);
    // The drain runs ABOVE the steady-state cap, which is the whole reason it
    // has a constant of its own: at the steady cap the ten-second deadline
    // covers about a quarter of a realm.
    expect(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES).toBeGreaterThan(
      FREEHOLD_PERSIST_MAX_ACTIVE_WRITES,
    );
    // And the login statement bound stays under the login PERMIT bound, so the
    // statement can never be the dominant term on a handshake.
    expect(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS).toBeLessThan(
      FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS,
    );
    // The login path's budget must stay SHORTER than the background write's.
    // They were one constant once, and merging them again would put a
    // background write's fifteen seconds on a player's handshake.
    expect(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS).toBeLessThan(
      FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS,
    );
  });

  it('spends the LOAD budget on the login path and the WRITE budget on a save', async () => {
    // Not the message, the SIGNAL. The refusal detail names a number, so an
    // implementation that pointed the login read at the write budget would
    // still print 5000 and pass a message assertion. This reads the abort
    // deadline of the signal the store actually handed the gate.
    const signals: AbortSignal[] = [];
    const gate = deferred<{ release(): void } | null>();
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async (signal) => {
        signals.push(signal);
        return await gate.promise;
      },
    });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(5);
    expect(signals).toHaveLength(1);
    const loadDeadline = timeoutMsOf(signals[0]);

    gate.resolve({ release: () => {} });
    h.join(await loading);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(20);
    expect(signals.length).toBeGreaterThan(1);
    const writeDeadline = timeoutMsOf(signals[signals.length - 1]);

    expect(loadDeadline).toBe(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS);
    expect(writeDeadline).toBe(FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS);
    expect(loadDeadline).toBeLessThan(writeDeadline);
  });

  it('keeps every clock and timer behind a port, in EVERY file the store split into', () => {
    // ACROSS THE WHOLE STORE, not one file. Several modules have come off this
    // file and each is driveable from a Vitest for exactly this reason; a scan
    // pinned to SOURCE_PATH would have let a fresh clock or timer land in any of
    // them. Count-free on purpose: two separate rounds left a number here that
    // the next extraction falsified.
    //
    // DERIVED FROM THE DIRECTORY, never re-typed and never from the store's own
    // imports. A hand-written list goes stale the next time a module comes off,
    // and it goes stale SILENTLY, because every entry still exists and the
    // anti-staleness floor below reads clean; that is exactly what happened when
    // the revision probe was extracted. An IMPORT-derived list is the same trap
    // one level down: it drops any sibling the store does not import itself
    // (server/freehold_install.ts, which performs the hearth-clock merge and is
    // precisely where a Date.now is a behaviour bug, and
    // server/freehold_persist_registry.ts), and it cannot see a module extracted
    // from a sibling rather than from the store. The directory can see all of
    // them.
    //
    // ONE EXCLUSION, and it is a decision rather than an omission: the
    // composition root binds Date.now to the store's nowMs port, which is its
    // whole job.
    const COMPOSITION_ROOT = 'server/freehold_persist_wiring.ts';
    const files = readdirSync('server')
      .filter((name) => /^freehold_[a-z_]+\.ts$/.test(name))
      .map((name) => `server/${name}`)
      .filter((path) => path !== COMPOSITION_ROOT)
      .sort();
    // The derivation is pinned, so a filter that stopped matching would scan an
    // empty list and still pass. Both files an import-derived list LOST are
    // named, so narrowing it that way again reds here.
    for (const required of [
      SOURCE_PATH,
      'server/freehold_install.ts',
      'server/freehold_persist_registry.ts',
      'server/freehold_write_seal.ts',
      'server/freehold_load_outcome.ts',
      'server/freehold_revision_probe.ts',
      'server/freehold_hearth_load.ts',
    ])
      expect(files, required).toContain(required);
    expect(files).not.toContain(COMPOSITION_ROOT);
    let timers = 0;
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      expect(source, file).not.toMatch(/Date\.now\(/);
      expect(source, file).not.toMatch(/Math\.random\(/);
      expect(source, file).not.toMatch(/performance\.now\(/);
      timers += (source.match(/setTimeout\(/g) ?? []).length;
    }
    // The one sanctioned timer across all of them is the module-edge default
    // deadline scheduler, and it lives in the store itself.
    expect(timers).toBe(1);
    expect(stripComments(readFileSync(SOURCE_PATH, 'utf8'))).toContain(
      'const realScheduleDeadline',
    );
    // AND THE WALKER WALKED: a file list that went stale by a rename would read
    // as a clean bill of health, so every entry must exist and be non-trivial.
    for (const file of files) {
      expect(readFileSync(file, 'utf8').length, file).toBeGreaterThan(400);
    }
  });
});

describe('preload admission', () => {
  it('is a live recorder: one load is one permit, one row read and one hearth read', async () => {
    const h = harness();
    expect(h.calls).toEqual([]);
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(h.calls).toEqual(['permit', 'readRow', 'readHearth', 'release']);
    // The STORED ceiling reaches SQL, never the canonical one. The two are
    // pinned as DIFFERENT numbers here, so a future edit that collapses them
    // back into one fails this line rather than silently making every maximal
    // record unreadable.
    expect(h.ownedBytesSeen).toEqual([FREEHOLD_MAX_STORED_BYTES]);
    expect(FREEHOLD_MAX_STORED_BYTES).toBeGreaterThan(FREEHOLD_MAX_OWNED_BYTES);
    expect(loaded.accountId).toBe(ACCOUNT_ID);
    expect(h.store.stats().loads).toBe(1);
  });

  it('collapses concurrent preloads onto one load and clears the slot afterwards', async () => {
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const first = h.store.preload(ACCOUNT_ID);
    const second = h.store.preload(ACCOUNT_ID);
    gate.resolve({ kind: 'absent' });
    const [a, b] = await Promise.all([first, second]);
    // THE PROPERTY, not the promise identity. preload is async, so each call
    // returns its own wrapper around the one in-flight load; what single-flight
    // means is that the two callers get the SAME ANSWER off ONE read, which is
    // what these three assertions say. An identity check on the returned
    // promises would go red on a wrapper that changed nothing.
    expect(a).toBe(b);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(h.store.stats().loads).toBe(1);

    // Drop the entry, then load again: a leaked in-flight slot would replay the
    // settled promise instead of reading. Counted on the READ, not on the plot
    // id: the id used to be the proxy here and it no longer distinguishes the
    // two, because a recreated entry now ADOPTS the live record's identity
    // rather than minting a second one (see below). Dropped the way a handshake
    // that never joins is dropped, by two sweeps, because a retain is a join and
    // a join would leave a record live.
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(0);
    const third = await h.store.preload(ACCOUNT_ID);
    expect(h.store.stats().loads).toBe(2);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(2);
    // With no record live, the second load mints a fresh identity, which is the
    // ordinary shape: adoption is pinned on its own below, where a record IS
    // live, because that is the only state it exists for.
    expect(a.plotId).toBe('plot:minted1');
    expect(third.plotId).toBe('plot:minted2');
  });

  it('ADOPTS the live record identity rather than minting a second one for the row', async () => {
    // ONE IDENTITY PER OWNER, not per entry. The mint is per ENTRY, and an
    // entry that re-reads an ABSENT row while a record already answers to a
    // minted name would give the ROW a second identity; the insert refusal would
    // then read the record and the row as two names and quiesce the account.
    //
    // A LIVE RECORD UNDER A MINTED NAME, NO ROW AND NO ENTRY is the precondition,
    // and under ruling (b) one order still reaches it: a join installs from any
    // loaded entry, so the entry has to be COLLECTED while its record stays live.
    // The first session's first insert is refused for good (a conflict answer
    // quiesces), so the row stays absent and the blocked entry owes nothing; its
    // leave collects the entry, and before its removePlayer the second
    // character's handshake reads beside the record through preload's
    // already-live arm (`rejoinBeforeRemoval`). That read finds the record live
    // and the row still absent, which is exactly where a second mint would happen.
    let conflict = true;
    const db = rowRemembered();
    const h = harness({
      readRow: db.readRow,
      writeRow: async (input) => {
        if (!conflict) return await db.writeRow(input);
        conflict = false;
        return { kind: 'conflict', detail: 'the row is owned by another account' };
      },
    });
    await h.login();
    expect(h.record()?.plotId).toBe('plot:minted1');
    h.edit(OWNER_KEY, furnishedEdit(3));
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().quiesced).toBe(1);
    await h.rejoinBeforeRemoval();
    expect(h.store.stats().loads).toBe(2);
    expect(h.record()?.plotId).toBe('plot:minted1');
    // AND NOTHING WAS MINTED TWICE: the row is created under the record's own
    // name. A second mint would name the entry `plot:minted2`, and the insert
    // refusal would then refuse the write outright, so the write below is only
    // reachable through the adoption.
    h.edit(OWNER_KEY, { rev: 4 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1]?.plotId).toBe('plot:minted1');
    expect(h.writes[1]?.expectedDurableRev).toBeNull();
    expect(h.store.stats().quiesced).toBe(0);
    const row = await db.readRow(ACCOUNT_ID);
    expect(row.kind === 'row' ? row.row.plotId : row.kind).toBe('plot:minted1');
  });

  it('REFUSES to name a row for a record it did not install', async () => {
    // THE OTHER HALF, and a defect this round's own fixes created. A live record
    // carrying the STAND-IN was seeded WITHOUT an install, because
    // installLoadedFreehold returns early on any hold, and loadFreehold is
    // load-once, so nothing can ever teach that record the name a row would be
    // created under. Minting one anyway inserts a row whose own record never
    // learns its name; applyWriteResult then caches the record's stand-in and
    // the seal's name comparison is inert BY VALUE EQUALITY for the life of that
    // entry, which is the eighth path arrived at from the other side.
    //
    // Both new arms produce this state: an admission hold whose entry ruling 2
    // now leaves re-readable, and the whole-preload cap's in-flight read landing
    // behind its refusal. It is refused once, here, rather than in each. The
    // first arm is the one built here, through the join: the handshake's read is
    // refused a permit, the join installs nothing on the hold, its retain re-reads
    // the unloaded entry, and addPlayer seeds the stand-in before that read lands.
    let permits = 0;
    const h = harness({
      rowLoad: { kind: 'absent' },
      acquirePermit: async () => (++permits === 1 ? null : { release: () => {} }),
    });
    const refused = await h.store.preload(ACCOUNT_ID);
    expect(refused.hold?.kind).toBe('no_permit');
    h.join(refused);
    await tick(30);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.store.stats().loadFailuresByKind).toEqual({ no_permit: 1, unnamed_record: 1 });
    // What the entry now answers, read through a sibling character's handshake.
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('unnamed_record');
    expect(loaded.state).toBeNull();
    expect(loaded.durableRev).toBeNull();
    // TERMINAL, because nothing in this session can rename a load-once record.
    // The NEXT login builds a fresh entry whose install runs before the seed.
    expect(h.store.stats().loaded).toBe(1);
    expect(h.store.stats().held).toBe(1);
    // AND NOTHING IS WRITTEN, so the account that has no row still has none.
    h.store.markDirty(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
  });

  it('installs nothing when the record is already live, but still learns the row', async () => {
    // A second character of the same account is joining, so the LIVE record is
    // the truth and the answer carries no state either way. The read still has
    // to happen: without it the entry never learns its plot id or its durable
    // revision, and an entry that never loaded is write-blocked for the whole
    // session, so the owner would play, furnish, and have every edit silently
    // discarded at logout.
    //
    // The state is the leave window: the first session's flush has collected
    // its clean entry and its removePlayer has not run yet, so the record is
    // live and the entry is gone when the next handshake reads.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.login();
    await h.store.flushAndRelease(OWNER_KEY);
    expect(h.store.stats().entries).toBe(0);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    h.calls.length = 0;
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(h.calls).toContain('readRow');
    expect(loaded.state).toBeNull();
    expect(loaded.hold).toBeNull();
    // Learned, so the session can write: identity and fence both present.
    expect(loaded.plotId).toBe(ROW_PLOT_ID);
    expect(loaded.durableRev).toBe('7');
    // And marked, so a join that lands after the record is evicted installs
    // nothing from it.
    expect(loaded.recordWithheld).toBe(true);
  });

  it('short circuits with zero database work once the entry has already loaded', async () => {
    // The other half: the read happens ONCE. A third character joining the same
    // account must not re-read the row. The first character is in the world, so
    // its record is live and its entry loaded.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.login();
    h.calls.length = 0;
    const again = await h.store.preload(ACCOUNT_ID);
    expect(h.calls).toEqual([]);
    expect(again.state).toBeNull();
    expect(again.durableRev).toBe('7');
    expect(again.recordWithheld).toBe(true);
  });

  it('replays what the entry knows on a rejoin, without a second read or a second mint', async () => {
    // The first handshake reads and dies before its join (so no record and no
    // reference), and the retry lands inside the orphan grace.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    const first = await h.store.preload(ACCOUNT_ID);
    const again = await h.store.preload(ACCOUNT_ID);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(again.state).toEqual(first.state);
    expect(again.durableRev).toBe('7');
  });

  it('re-reads instead of replaying a plot whose claim this process no longer holds', async () => {
    // A handshake slower than the login grace, a renew pass between its ask and
    // its join: the renewer released the claim, so a replay would install a
    // house every write then answers `fenced` for. The claimed read decides
    // again (and re-claims, or answers claim_busy if another realm took it).
    let held = true;
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() }, claimHeld: () => held });
    await h.store.preload(ACCOUNT_ID);
    // Control: the claim still held, the retry replays with no second read.
    await h.store.preload(ACCOUNT_ID);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'claimHeld')).toHaveLength(1);
    held = false;
    const again = await h.store.preload(ACCOUNT_ID);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(2);
    expect(again.durableRev).toBe('7');
  });

  it('replays a plot with NO durable row without asking the claim, which only a row has', async () => {
    const h = harness({ rowLoad: { kind: 'absent' }, claimHeld: () => false });
    const first = await h.store.preload(ACCOUNT_ID);
    const again = await h.store.preload(ACCOUNT_ID);
    expect(again.plotId).toBe(first.plotId);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(h.calls).not.toContain('claimHeld');
  });

  it('replays the newest durable Hearth clock a trip proved, forward only by revision', async () => {
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      hearthLoad: { kind: 'state', state: { readyAtMs: '1700000000000', revision: '4' } },
    });
    await h.store.preload(ACCOUNT_ID);
    // A trip committed an advance at revision 5 after the login read.
    h.store.adoptHearthReading(OWNER_KEY, 1_700_003_600_000, '5');
    const rejoin = await h.store.preload(ACCOUNT_ID);
    expect(rejoin.hearthReadyAtMs).toBe(1_700_003_600_000);
    expect(rejoin.hearthRevision).toBe('5');
    // An older or equal revision never replaces it, and a malformed reading
    // changes nothing.
    h.store.adoptHearthReading(OWNER_KEY, 1_800_000_000_000, '5');
    h.store.adoptHearthReading(OWNER_KEY, 1_800_000_000_000, '4');
    h.store.adoptHearthReading(OWNER_KEY, 1_800_000_000_000, 'x');
    h.store.adoptHearthReading(OWNER_KEY, Number.NaN, '9');
    h.store.adoptHearthReading(OWNER_KEY, 0, '9');
    const still = await h.store.preload(ACCOUNT_ID);
    expect(still.hearthReadyAtMs).toBe(1_700_003_600_000);
    expect(still.hearthRevision).toBe('5');
    // No entry: a no-op, never a fresh entry.
    h.store.adoptHearthReading('account:1', 5, '9');
    expect(h.store.authority('account:1')).toBeNull();
    // Still exactly one read of the clock: adoption issues none.
    expect(h.calls.filter((call) => call === 'readHearth')).toHaveLength(1);
  });

  it('replays a fresh account without minting it a second identity', async () => {
    // The mint half of the title above, which a row fixture cannot reach: an
    // absent row mints once, and the retry replays that name.
    const h = harness({ rowLoad: { kind: 'absent' } });
    const first = await h.store.preload(ACCOUNT_ID);
    const again = await h.store.preload(ACCOUNT_ID);
    expect(first.plotId).toBe(MINTED_PLOT_ID);
    expect(again.plotId).toBe(MINTED_PLOT_ID);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
  });

  it('replays the HEARTH CLOCK it learned, never a cold one', async () => {
    // The replay arms issue no read of their own, so a hard-coded zero here
    // would tell a second character of the same account that the shared travel
    // cooldown is ready when the read that took it said otherwise. The clock is
    // account-wide precisely so a second character cannot double the budget.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      hearthLoad: { kind: 'state', state: { readyAtMs: '1700000000000', revision: '4' } },
    });
    // A handshake that died before its join, then a retry: the replay arm.
    const first = await h.store.preload(ACCOUNT_ID);
    expect(first.hearthReadyAtMs).toBe(1_700_000_000_000);

    const rejoin = await h.store.preload(ACCOUNT_ID);
    expect(h.calls.filter((call) => call === 'readHearth')).toHaveLength(1);
    expect(rejoin.hearthReadyAtMs).toBe(1_700_000_000_000);
    expect(rejoin.hearthRevision).toBe('4');
  });

  it('replays the hearth clock on the already-live arm too', async () => {
    // A second character's handshake while the first is in the world.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      hearthLoad: { kind: 'state', state: { readyAtMs: '1700000000000', revision: '4' } },
    });
    await h.login();
    h.calls.length = 0;
    const second = await h.store.preload(ACCOUNT_ID);
    // The ALREADY-LIVE arm, and no read: the replay arm would answer a state.
    expect(h.calls).toEqual([]);
    // No state, because the live record is the truth; but the clock is a
    // separate durable fact and this arm must not report it cold.
    expect(second.state).toBeNull();
    expect(second.recordWithheld).toBe(true);
    expect(second.hearthReadyAtMs).toBe(1_700_000_000_000);
    expect(second.hearthRevision).toBe('4');
  });

  it('refuses rather than falls through when the permit is refused', async () => {
    const h = harness({ acquirePermit: async () => null });
    const loaded = await h.store.preload(ACCOUNT_ID);
    // The absence of a row read is the whole point: a refused permit must
    // never become an unadmitted query.
    expect(h.calls).toEqual(['permit']);
    // ITS OWN KIND, not the row-level one. A missing permit is pool or gate
    // saturation and an operator's response to it is nothing like the response
    // to a row this build cannot read; they shared one label until this round.
    expect(loaded.hold?.kind).toBe('no_permit');
    expect(loaded.hold?.detail).toContain(String(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS));
    expect(h.store.stats().loadFailures).toBe(1);
    expect(h.store.stats().loadFailuresByKind).toEqual({ no_permit: 1 });
  });

  it('bounds every permit wait with its own live signal', async () => {
    const h = harness();
    await h.store.preload(ACCOUNT_ID);
    await h.store.preload(OTHER_ACCOUNT_ID);
    expect(h.permitSignals).toHaveLength(2);
    for (const signal of h.permitSignals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    }
    expect(h.permitSignals[0]).not.toBe(h.permitSignals[1]);
  });

  it('refuses past the local concurrency cap, before the shared permit', async () => {
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const running: Promise<LoadedFreehold>[] = [];
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_LOADS; i++) {
      running.push(h.store.preload(ACCOUNT_ID + i));
    }
    await tick();
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(
      FREEHOLD_PERSIST_MAX_ACTIVE_LOADS,
    );
    const permitsBefore = h.calls.filter((call) => call === 'permit').length;
    const refused = await h.store.preload(ACCOUNT_ID + FREEHOLD_PERSIST_MAX_ACTIVE_LOADS);
    // A login storm filling the local cap is a CAPACITY signal, and it must not
    // read as the row-level stranded-slot cause.
    expect(refused.hold?.kind).toBe('cap_full');
    expect(refused.hold?.detail).toContain('cap');
    expect(h.store.stats().loadFailuresByKind).toEqual({ cap_full: 1 });
    // The cap sits BEFORE the shared permit, so the refused load never asked
    // the gate for one.
    expect(h.calls.filter((call) => call === 'permit')).toHaveLength(permitsBefore);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(
      FREEHOLD_PERSIST_MAX_ACTIVE_LOADS,
    );

    gate.resolve({ kind: 'absent' });
    const settled = await Promise.all(running);
    for (const load of settled) expect(load.hold).toBeNull();
  });
});

describe('preload classification', () => {
  it('gives an absent row a minted plot id, a null state and a null durable revision', async () => {
    const h = harness({ rowLoad: { kind: 'absent' } });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.state).toBeNull();
    expect(loaded.hold).toBeNull();
    expect(loaded.durableRev).toBeNull();
    expect(loaded.plotId).toBe('plot:minted1');
    expect(loaded.plotIndex).toBe(0);
  });

  it('gives a normalized row its state, plot identity and durable revision', async () => {
    const state = persistedFixture({ condition: 42 });
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      normalized: { kind: 'loaded', state, repaired: [] },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.state).toBe(state);
    expect(loaded.durableRev).toBe('7');
    expect(loaded.plotId).toBe(ROW_PLOT_ID);
    expect(loaded.hold).toBeNull();
    expect(h.calls).toContain('normalize');
  });

  it('warns about repaired scalars without holding the account', async () => {
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      normalized: { kind: 'loaded', state: persistedFixture(), repaired: ['condition', 'rev'] },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold).toBeNull();
    // The line comes from the sim's own reporter, in its vocabulary, so the
    // bound on what may reach a log lives in one place.
    expect(h.warnings.join(' ')).toContain('repaired:condition,rev');
  });

  const holdCases: ReadonlyArray<{
    readonly name: string;
    readonly options: HarnessOptions;
    readonly kind: string;
    readonly detail: string;
  }> = [
    {
      name: 'an unsupported document',
      options: {
        rowLoad: { kind: 'row', row: rowFixture() },
        // The detail the real normalizer produces for an unadmitted tier. A
        // raw tier id here would be a fixture the sim never emits, and the
        // reporter's positive shape bound would replace it, which is the point:
        // row content does not reach a log.
        normalized: { kind: 'unsupported', reason: 'tier', detail: 'not_admitted' },
      },
      kind: 'unsupported',
      detail: 'tier:not_admitted',
    },
    {
      name: 'a malformed document',
      options: {
        rowLoad: { kind: 'row', row: rowFixture() },
        normalized: { kind: 'malformed', detail: 'layout_not_an_array' },
      },
      kind: 'malformed',
      detail: 'layout_not_an_array',
    },
    {
      name: 'a document over the owned-bytes ceiling',
      options: {
        rowLoad: { kind: 'row', row: rowFixture() },
        normalized: { kind: 'oversize', bytes: 200_000, limit: FREEHOLD_MAX_OWNED_BYTES },
      },
      kind: 'oversize',
      detail: 'bytes:200000:limit:',
    },
    {
      name: 'a document that normalizes to absent',
      options: {
        rowLoad: { kind: 'row', row: rowFixture() },
        normalized: { kind: 'absent' },
      },
      kind: 'malformed',
      detail: 'normalized to absent',
    },
    {
      name: 'a row the reader called oversize',
      options: {
        rowLoad: {
          kind: 'oversize',
          plotIndex: 0,
          plotId: ROW_PLOT_ID,
          durableRev: '9',
          bytes: 300_000,
          limit: FREEHOLD_MAX_OWNED_BYTES,
          detoastRefused: false,
          diskBytes: 200_000,
        },
      },
      kind: 'oversize',
      detail: '300000 owned bytes',
    },
    {
      // THE OTHER ARM of the same refusal, which had no store-level case at
      // all. Past the on-disk pre-gate the stored text was never rendered, so
      // there is no measured length and reporting one would be a number nobody
      // took: the detail has to name the DISK bytes and the limit that was
      // never measured, and the refusal counts separately because the two mean
      // different things to an operator.
      name: 'a row refused on its on-disk size before anything was rendered',
      options: {
        rowLoad: {
          kind: 'oversize',
          plotIndex: 0,
          plotId: ROW_PLOT_ID,
          durableRev: '9',
          bytes: 0,
          limit: FREEHOLD_MAX_STORED_BYTES,
          detoastRefused: true,
          diskBytes: 4_000_000,
        },
      },
      kind: 'oversize',
      detail: '4000000 on-disk bytes past the pre-gate',
    },
    {
      name: 'a row the reader would not admit',
      options: {
        rowLoad: {
          kind: 'unadmitted',
          plotIndex: 1,
          plotId: ROW_PLOT_ID,
          durableRev: '9',
          detail: 'plot_index 1 is outside the admitted slot 0',
        },
      },
      kind: 'unadmitted',
      // THE REAL PRODUCER'S TEXT, not a hand-written stand-in.
      // server/freehold_db.ts builds this string, and it reaches a log through
      // the store's warn port, so the shape bound in
      // src/sim/freehold/load_report.ts has to admit it. A fixture that invented
      // its own prose proved the bound admitted the fixture, not the producer.
      detail: 'plot_index 1 is outside the admitted slot 0',
    },
    {
      name: 'a row read that threw',
      options: {
        readRow: async () => {
          throw new Error('connection reset');
        },
      },
      kind: 'read_threw',
      detail: 'threw',
    },
  ];

  for (const holdCase of holdCases) {
    it(`holds ${holdCase.name} and writes nothing for it`, async () => {
      const h = harness(holdCase.options);
      const loaded = await h.store.preload(ACCOUNT_ID);
      expect(loaded.hold?.kind).toBe(holdCase.kind);
      expect(loaded.hold?.detail).toContain(holdCase.detail);
      expect(loaded.state).toBeNull();
      expect(h.store.stats().held).toBe(1);
      expect(h.store.stats().loadFailuresByKind).toEqual({ [holdCase.kind]: 1 });
      // The pre-gate refusal is counted SEPARATELY from the measured one, in
      // both directions, because the two mean different things to an operator:
      // one says the row was too large to look at, the other says it was
      // measured and refused.
      const preGate = holdCase.options.rowLoad;
      const refusedOnDisk = preGate?.kind === 'oversize' && preGate.detoastRefused;
      expect(h.store.stats().preGateRefusals).toBe(refusedOnDisk ? 1 : 0);

      // The join goes ahead on the hold: nothing is installed, addPlayer seeds
      // the stand-in, and the session holds a reference. Every write door is
      // then tried in turn, the leave included. The absence of a writeRow call
      // is the assertion: the durable row keeps the owner's possessions.
      h.join(loaded);
      expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
      h.calls.length = 0;
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      h.store.saveAllDirty();
      await h.leave();
      await tick();
      expect(h.writeCount()).toBe(0);
      expect(h.writes).toEqual([]);
      // Stopped by the HOLD, before any write was even queued. The seeded
      // stand-in would also be refused further down (the insert refusal), so
      // a write-count alone could not say which rule held the row.
      expect(h.calls).not.toContain('enqueue');
      expect(h.store.stats().writeFailures).toBe(0);
      expect(h.store.stats().quiesced).toBe(0);
    });
  }

  it('replaces an unadmitted detail the log vocabulary does not name', async () => {
    // The bound is a POSITIVE shape test and it is applied where the producer
    // lives outside this module. A row reader that started interpolating a plot
    // id, an item id or a row's own text into its detail would have printed it
    // verbatim on the store's warn port; it now reads `unclassified`, which
    // costs an operator one detail and leaks nothing.
    const h = harness({
      rowLoad: {
        kind: 'unadmitted',
        plotIndex: 1,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        detail: 'plot plot:secret-name-9f3a for account 918273 is stranded',
      },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('unadmitted');
    expect(loaded.hold?.detail).toBe('unclassified');
    expect(h.warnings.join(' ')).not.toContain('secret-name-9f3a');
    expect(h.warnings.join(' ')).not.toContain(String(ACCOUNT_ID));
  });

  it('blocks writes for an entry whose load has not landed yet', async () => {
    // A joined session whose entry is NOT loaded. Under ruling (b) a join
    // installs from any loaded entry, so this is reached only after a join that
    // installed nothing: the next character's handshake asks beside the owner's
    // live record, the owner leaves clean (the entry is collected, the record
    // evicted), and the handshake's re-ask, now a durable read, is refused a
    // permit. The join installs nothing on that hold, the stand-in is seeded,
    // and the retain re-reads the unloaded entry. That read is held open, so the
    // three write doors a session has open (a mark, a save, a sweep) are tried
    // against an entry with a live record, a reference and no durable knowledge.
    let gate: Deferred<FreeholdRowLoad> | null = null;
    const h = harness({
      readRow: async () => (gate ? await gate.promise : { kind: 'row', row: rowFixture() }),
    });
    await h.login();
    await h.store.preload(ACCOUNT_ID);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    gate = deferred<FreeholdRowLoad>();
    h.refuseNextPermits(1);
    const atJoin = await h.joinAfterReask();
    expect(atJoin.hold?.kind).toBe('no_permit');
    await tick();
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().loaded).toBe(0);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    h.calls.length = 0;
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    h.store.saveAllDirty();
    await tick();
    // Refused at the door: nothing was even queued.
    expect(h.calls).not.toContain('enqueue');
    expect(h.writeCount()).toBe(0);
    // The contrast, so the block is the unloaded entry and not a stopped writer:
    // once the read lands the door opens, the write is queued, and what refuses
    // the stand-in then is the seal, loudly, with the row kept.
    gate.resolve({ kind: 'row', row: rowFixture() });
    await tick(30);
    expect(h.store.stats().loaded).toBe(1);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.calls).toContain('enqueue');
    expect(h.writeCount()).toBe(0);
    expect(h.errors.filter((line) => line.includes('write refused (identity)'))).toHaveLength(1);
  });
});

describe('the hearth clock', () => {
  it('carries a durable clock through', async () => {
    const h = harness({
      hearthLoad: { kind: 'state', state: { readyAtMs: '5000', revision: '3' } },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hearthReadyAtMs).toBe(5000);
    expect(loaded.hearthRevision).toBe('3');
  });

  it('starts cold when the clock is absent', async () => {
    const h = harness({ hearthLoad: { kind: 'absent' } });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hearthReadyAtMs).toBe(0);
    expect(loaded.hearthRevision).toBe('0');
  });

  it('starts cold and warns when the clock is unsupported', async () => {
    const h = harness({ hearthLoad: { kind: 'unsupported', detail: 'no table' } });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hearthReadyAtMs).toBe(0);
    expect(h.warnings.join(' ')).toContain('no table');
    // A cold hearth is not a reason to hold the freehold row.
    expect(loaded.hold).toBeNull();
  });

  it('starts cold and never faults the load when the clock read throws', async () => {
    const h = harness({
      readHearth: async () => {
        throw new Error('hearth read exploded');
      },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hearthReadyAtMs).toBe(0);
    expect(loaded.hold).toBeNull();
    expect(h.errors.join(' ')).toContain('hearth');
  });
});

describe('write coalescing', () => {
  it('costs one running plus one pending write across a burst of a thousand marks', async () => {
    const gate = deferred<FreeholdUpsertResult>();
    let served = 0;
    const h = await loadedStore({
      writeRow: async () => {
        served += 1;
        if (served === 1) return await gate.promise;
        return { kind: 'updated', durableRev: String(served) };
      },
    });
    // Five hundred marks BEFORE the running write samples its document. All of
    // them are covered by that one write, so none of them earns a second.
    for (let i = 0; i < 500; i++) {
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
    }
    await tick();
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().running).toBe(1);
    expect(h.store.stats().pending).toBe(0);

    // Five hundred more AFTER it sampled. Those are real later edits, and they
    // cost exactly ONE pending write between them, never five hundred.
    for (let i = 0; i < 500; i++) {
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
    }
    const midFlight = h.store.stats();
    expect(midFlight.running).toBe(1);
    // A pending write only ever exists behind a running one, which is why the
    // removal guard can never see pending true with running false.
    expect(midFlight.pending).toBe(1);

    gate.resolve({ kind: 'updated', durableRev: '1' });
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.calls.filter((call) => call === 'enqueue')).toHaveLength(2);
    expect(h.store.stats().dirty).toBe(0);
  });

  it('lets an edit during a running write survive, and re-arms exactly once', async () => {
    const gates = [deferred<FreeholdUpsertResult>(), deferred<FreeholdUpsertResult>()];
    let served = 0;
    const h = await loadedStore({
      writeRow: async () => {
        const gate = gates[served];
        served += 1;
        return gate ? await gate.promise : { kind: 'updated', durableRev: 'extra' };
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick();
    expect(h.writeCount()).toBe(1);

    // The edit lands after the running write took its snapshot.
    h.store.markDirty(OWNER_KEY);
    expect(h.store.stats().dirty).toBe(1);

    gates[0]?.resolve({ kind: 'updated', durableRev: '11' });
    await tick(30);
    // Only the committed generation cleared, so the later edit is still dirty
    // and armed exactly one more write.
    expect(h.writeCount()).toBe(2);
    gates[1]?.resolve({ kind: 'updated', durableRev: '12' });
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.store.stats().dirty).toBe(0);
  });

  it('writes when the record IS live (the other arm of the null-serialize skip)', async () => {
    // The same entry after its join, with the session's furnishing on the record.
    const h = await loadedStore();
    h.edit(OWNER_KEY, furnishedEdit(5));
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0]?.plotId).toBe('plot:minted1');
    expect(h.writes[0]?.tier).toBe('inn_room');
    expect(h.writes[0]?.wireRev).toBe(5);
    expect(h.writes[0]?.layoutJson).toContain('oak_chair');
    expect(h.writes[0]?.trophiesJson).toContain('skull_of_something');
  });

  it('fences the first write insert-only and every later one on the durable revision', async () => {
    let served = 0;
    const h = await loadedStore({
      writeRow: async () => {
        served += 1;
        return { kind: served === 1 ? 'inserted' : 'updated', durableRev: `rev${served}` };
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writes.map((write) => write.expectedDurableRev)).toEqual([null, 'rev1']);
  });
});

describe('the periodic sweep detects a moved record without a markDirty call', () => {
  // The record's own revision is the movement signal. setFreeholdTier is the
  // one sanctioned tier writer today and it bumps that revision, and the
  // development grant reaches the record THROUGH it, so a tier change made
  // with no server-side hook must still reach the row on the next sweep.
  it('arms a write when the live revision has left the last written one behind', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => ({ kind: 'updated', durableRev: '2' }),
    });
    // Nothing moved: the sweep writes nothing at all.
    h.store.saveAllDirty();
    await tick(5);
    expect(h.writeCount()).toBe(0);

    // The one sanctioned writer bumped the revision. No markDirty was called.
    h.edit(OWNER_KEY, { rev: 8 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(8);

    // And it settles: a second sweep after the write does not rewrite.
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
  });

  it('reads ONE integer per loaded owner and clones nothing when nothing moved', async () => {
    // This probe runs synchronously inside the 20 Hz loop body, so its cost is
    // tick cost. Cloning every loaded record here to read one revision put
    // O(owners x layout rows) of copying and garbage on one tick every thirty
    // seconds: measured in tens of milliseconds at five thousand owners against
    // a fifty millisecond budget. The clean sweep must touch serialize ZERO
    // times; only a write may clone.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
    });
    expect(h.record()?.rev).toBe(7);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.calls.filter((call) => call === 'liveRev')).toHaveLength(1);
    expect(h.calls.filter((call) => call === 'serialize')).toHaveLength(0);
    expect(h.writeCount()).toBe(0);
  });

  it('ARMS a write when the live revision moved BACKWARDS, and the seal then refuses it', async () => {
    // DETECTION IS NOT ADMISSION, and this case is where the two answers part.
    // The probe treats a backwards revision as movement, because a live record
    // that is not the one this entry committed is exactly the state worth
    // looking at; the seal then refuses to write it. The rule this used to pin
    // (a record carrying a real plot name goes backwards onto the row,
    // deliberately) is RETIRED: a live revision below the entry's last
    // committed one means the live record is not the record that commit came
    // from, and writing it walks the client-facing wire counter backwards
    // permanently, which is what the loader's own wire_rev_shape hold refuses
    // on the read side.
    //
    // THE STATE, a RELATION rather than an event: the record sits at revision
    // six, another realm sharing this database writes the row forward (a new
    // wire revision and a new durable revision together), and this realm's
    // entry re-reads it through preload's already-live arm while the record
    // stays (`rejoinBeforeRemoval`). The live revision is then BELOW the one the
    // entry holds, although nothing on this realm moved it.
    const db = rowRemembered(rowFixture({ wireRev: '6' }));
    const h = await loadedStore({ readRow: db.readRow, writeRow: db.writeRow });
    db.advance({ wireRev: '7' });
    const reread = await h.rejoinBeforeRemoval();
    expect(reread.durableRev).toBe('8');
    expect(h.record()?.rev).toBe(6);
    h.store.saveAllDirty();
    await tick(30);
    // ARMED: without the backwards arm of the probe nothing would have been
    // armed at all and the refusal below could never have been reached.
    expect(h.store.stats().writeFailures).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors[0]).toContain('identity');
    // AND NOT WRITTEN: the row keeps the revision the entry committed.
    expect(h.writeCount()).toBe(0);
  });

  it('never probes a write-blocked entry, so a held row stays untouched', async () => {
    const h = await loadedStore({
      rowLoad: {
        kind: 'oversize',
        plotIndex: 0,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        bytes: 1,
        limit: 0,
        detoastRefused: false,
        diskBytes: 200_000,
      },
    });
    // The join seeded the stand-in on the hold, and the session then moved it a
    // long way: a probe that ran would see that.
    h.edit(OWNER_KEY, { rev: 999 });
    h.calls.length = 0;
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    // The probe itself is skipped, not just the write: a blocked entry may not
    // write, so knowing it moved buys nothing and costs a serialize per sweep.
    expect(h.calls.filter((call) => call === 'serialize')).toHaveLength(0);
    expect(h.calls.filter((call) => call === 'liveRev')).toHaveLength(0);
    expect(h.store.stats().held).toBe(1);
  });

  it('persists the seeded default on the first sweep when no durable row existed', async () => {
    // An ABSENT row is the one arm where the sim's own free Inn Room record IS
    // the truth: 05 seeds it, and this store writes it out under a freshly
    // generated identity without ever creating a second default. The join
    // installed that default carrying the minted identity, at revision zero.
    const h = await loadedStore({ rowLoad: { kind: 'absent' } });
    expect(h.record()?.rev).toBe(0);
    expect(h.record()?.layout).toEqual([]);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    // Insert-only: there is no durable revision to compare against yet.
    expect(h.writes[0].expectedDurableRev).toBeNull();
    expect(h.writes[0].plotId).toBe('plot:minted1');
    expect(h.writes[0].wireRev).toBe(0);
  });

  it('treats a record that vanished from the live map as nothing to write', async () => {
    // Including the null-revision guard in the sweep's own probe: without it
    // every pass over a loaded entry whose record is gone marks it dirty and
    // arms a write that can only ever land in `writes_without_record`.
    // serializeFreehold answers null when the owner holds no live record, and
    // the contract is to SKIP: a default written over a real row destroys the
    // owner's furnishings, and nothing in this realm holds a second copy.
    //
    //
    // THE VANISHED STATE, as production reaches it: the owner leaves while a
    // write is out, the leave stops waiting at its deadline and removePlayer
    // evicts, and the entry outlives its record because it still owes that
    // write. Two sweeps then pass over it.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => await gate.promise,
    });
    h.edit(OWNER_KEY, { rev: 6 });
    h.store.saveAllDirty();
    await tick(10);
    expect(h.writeCount()).toBe(1);
    const leaving = h.leave();
    await tick(5);
    h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS)?.fire();
    await leaving;
    expect(h.record()).toBeUndefined();
    expect(h.store.stats().entries).toBe(1);
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    await tick(10);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(30);
    // The sweeps did not even ARM one: without the null-revision guard each
    // pass marks the entry dirty again, the running write leaves a pending one
    // behind it, and that write re-sends the leave's document a second time.
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().writesWithoutRecord).toBe(0);
    expect(h.store.stats().dirty).toBe(0);
  });
});

describe('the FIFO and the permit', () => {
  it('takes the key FIFO first and the permit inside the queued closure', async () => {
    const h = await loadedStore();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.calls).toEqual(['enqueue', 'permit', 'serialize', 'writeRow', 'release']);
    expect(h.calls.indexOf('enqueue')).toBeLessThan(h.calls.indexOf('permit'));
  });

  it('does not deadlock two owners against a permit gate of one', async () => {
    let held = false;
    const waiting: Array<() => void> = [];
    const h = harness({
      acquirePermit: async () => {
        if (held) await new Promise<void>((resolve) => waiting.push(resolve));
        held = true;
        return {
          release(): void {
            held = false;
            waiting.shift()?.();
          },
        };
      },
    });
    await h.login(ACCOUNT_ID);
    await h.login(OTHER_ACCOUNT_ID);
    h.store.markDirty(OWNER_KEY);
    h.store.markDirty(OTHER_OWNER_KEY);
    h.store.saveAllDirty();
    await tick(60);
    expect(h.writeCount()).toBe(2);
    expect(h.store.stats().running).toBe(0);
  });

  it('counts a write that never got a permit as a failure and writes nothing', async () => {
    let loadPermit = true;
    const h = harness({
      acquirePermit: async () => {
        if (loadPermit) {
          loadPermit = false;
          return { release: () => undefined };
        }
        return null;
      },
    });
    await h.login();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().writeFailures).toBe(1);
    expect(h.warnings.join(' ')).toContain(String(FREEHOLD_PERSIST_WRITE_PERMIT_WAIT_MS));
  });
});

describe('the stale compare-and-swap quiesce', () => {
  it('stops writing for the owner, counts it, and warns exactly once', async () => {
    const h = await loadedStore({
      writeRow: async () => ({ kind: 'stale', durableRev: '99' }),
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().staleWrites).toBe(1);
    // Quiesced, NOT held. The two are separate measures because a rising
    // quiesce count means a writer this realm does not know about is touching
    // these rows, which is exactly what the fence exists to surface, and a
    // recovery hold means something else entirely.
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.store.stats().held).toBe(0);

    for (let i = 0; i < 5; i++) {
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      h.store.saveAllDirty();
    }
    await h.store.flushAndRelease(OWNER_KEY);
    await tick(30);
    // Never a blind retry with the re-read revision, and never a second warn.
    expect(h.writeCount()).toBe(1);
    expect(h.warnings.filter((line) => line.includes('quiesced'))).toHaveLength(1);
  });

  it('quiesces on a FENCED write (07a): counted on its own, warned once, nothing more goes out', async () => {
    // Another realm took the plot's claim, so the fenced writer refused before
    // the compare-and-swap. Nothing this realm could send would land.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'fenced' }),
    });
    expect(h.store.authority(OWNER_KEY)).toMatchObject({ blocked: false });
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    // The fence names the writer, so it is NOT a stale CAS and NOT a refusal.
    expect(h.store.stats()).toMatchObject({
      fencedWrites: 1,
      staleWrites: 0,
      writeFailures: 0,
      writes: 0,
      quiesced: 1,
      held: 0,
    });
    // The owner is now blocked: no trip may ride an entry that lost its claim.
    expect(h.store.authority(OWNER_KEY)).toMatchObject({ loaded: true, blocked: true });
    for (let i = 0; i < 5; i++) {
      h.edit(OWNER_KEY);
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      h.store.saveAllDirty();
    }
    await h.store.flushAndRelease(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().fencedWrites).toBe(1);
    const fencedLines = h.warnings.filter((line) =>
      line.includes("no longer holds the plot's claim"),
    );
    expect(fencedLines).toEqual([
      "freehold plot index 0 quiesced: this realm no longer holds the plot's claim, so no further writes go out for this owner",
    ]);
    expect(h.errors).toEqual([]);
  });

  it('counts a committed write as a write, never as fenced (the control)', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.store.stats()).toMatchObject({ fencedWrites: 0, writes: 1, quiesced: 0 });
    expect(h.store.authority(OWNER_KEY)).toMatchObject({ blocked: false, durableRev: '8' });
  });

  const refusals: ReadonlyArray<{ readonly result: FreeholdUpsertResult; readonly name: string }> =
    [
      { name: 'a row that vanished', result: { kind: 'missing' } },
      { name: 'a durable conflict', result: { kind: 'conflict', detail: 'plot id already taken' } },
    ];
  for (const refusal of refusals) {
    it(`quiesces on ${refusal.name} and counts a write failure`, async () => {
      const h = await loadedStore({ writeRow: async () => refusal.result });
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      await tick(30);
      expect(h.store.stats().writeFailures).toBe(1);
      expect(h.store.stats().staleWrites).toBe(0);
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      await tick(30);
      expect(h.writeCount()).toBe(1);
    });
  }

  it('does not re-arm itself when the write rejects', async () => {
    const h = await loadedStore({
      writeRow: async () => {
        throw new Error('write blew up');
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().writeFailures).toBe(1);
    expect(h.store.stats().running).toBe(0);
  });
});

describe('one edit is one durable write, however many arms land on it', () => {
  // A durable write is not free: it rewrites both content columns, burns a
  // compare-and-swap revision and touches updated_at. Re-sending the SAME
  // document because a second arm arrived while the first write was in flight
  // doubles all of that, and shutdown makes it routine rather than rare
  // (saveFreeholds arms every dirty owner, then freeholdPersistIdle arms every
  // one of them again while those writes are still queued on the gate). Each
  // case here drives one real edit through a DIFFERENT arming sequence and
  // asserts one writeRow, and the last case proves the coalescer still lets a
  // genuinely later edit through.

  /** A loaded store whose single write is held open, so every case can arm
   *  again while the first write is genuinely still running. */
  async function heldWriteStore() {
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => await gate.promise,
    });
    return {
      h,
      gate,
      edit(next: number): void {
        h.edit(OWNER_KEY, { rev: next });
      },
    };
  }

  it('writes once across the shutdown sequence: a sweep, then the idle drain', async () => {
    const { h, gate, edit } = await heldWriteStore();
    edit(8);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);

    // The write is still out on the gate. This is exactly what server/main.ts
    // does next, and it must not queue a second copy of the same document.
    const drained = h.store.idle(5_000);
    await tick(10);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(40);
    expect(await drained).toBe(true);
    expect(h.writeCount()).toBe(1);
    expect(h.writes.map((w) => w.wireRev)).toEqual([8]);
  });

  it('writes once across two overlapping sweeps', async () => {
    const { h, gate, edit } = await heldWriteStore();
    edit(8);
    h.store.saveAllDirty();
    await tick(30);
    h.store.saveAllDirty();
    await tick(10);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(40);
    expect(h.writeCount()).toBe(1);
  });

  it('writes once across a sweep and the leaving flush', async () => {
    const { h, gate, edit } = await heldWriteStore();
    edit(8);
    h.store.saveAllDirty();
    await tick(30);
    const left = h.store.flushAndRelease(OWNER_KEY);
    await tick(10);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await left;
    await tick(20);
    expect(h.writeCount()).toBe(1);
  });

  it('still writes a SECOND time for an edit that arrives after the snapshot', async () => {
    // The anti-vacuity arm. Without it every case above would pass on a store
    // that had simply stopped coalescing a second write into existence at all,
    // which would silently drop the last edit of every session.
    const { h, gate, edit } = await heldWriteStore();
    edit(8);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);

    // A real, later edit while the first write is out.
    edit(9);
    h.store.saveAllDirty();
    await tick(10);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(40);
    expect(h.writes.map((w) => w.wireRev)).toEqual([8, 9]);
  });
});

describe('the save path refuses what the load path would refuse', () => {
  // WRITABLE IMPLIES READABLE. Without this, a realm can mint a row past its
  // own load ceilings and then hold that account read-only forever, from a row
  // it produced itself. Every case here asserts the ABSENCE of a writeRow call:
  // the refusal has to happen before the statement, not after it.

  /** A 64-CHARACTER id that is 192 BYTES. Legal by the id-length rule, which
   *  counts characters, and the reason the byte ceiling exists at all. */
  const wideId = String.fromCharCode(0x65e5).repeat(64);

  function oversizePersisted(): PersistedFreehold {
    return persistedFixture({
      layout: Array.from({ length: FREEHOLD_MAX_LAYOUT_ROWS }, (_unused, i) => ({
        placementId: i,
        itemId: wideId,
        x: -0.0000012345678901234567,
        y: -0.0000012345678901234567,
        z: -0.0000012345678901234567,
        yaw: -0.0000012345678901234567,
      })),
      rev: 8,
    });
  }

  /** A loaded owner whose session then edits its record into `persisted`. */
  async function refusingStore(persisted: PersistedFreehold) {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, {
      tier: persisted.tier,
      layout: persisted.layout,
      trophies: persisted.trophies,
      condition: persisted.condition,
      visitPolicy: persisted.visitPolicy,
      rev: persisted.rev,
    });
    return h;
  }

  it('is not vacuous: the oversize fixture really is over the byte ceiling with legal row counts', () => {
    const doc = oversizePersisted();
    expect(doc.layout).toHaveLength(FREEHOLD_MAX_LAYOUT_ROWS);
    expect(doc.trophies.length).toBeLessThanOrEqual(FREEHOLD_MAX_TROPHY_ROWS);
    expect(persistedFreeholdBytes(doc)).toBeGreaterThan(FREEHOLD_MAX_OWNED_BYTES);
  });

  it('writes nothing for a document past the byte ceiling and quiesces the owner', async () => {
    const h = await refusingStore(oversizePersisted());
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.calls).not.toContain('writeRow');
    expect(h.store.stats().writeFailures).toBe(1);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain('oversize');
    expect(h.errors[0]).toContain(String(FREEHOLD_MAX_OWNED_BYTES));
    // The identity of the owner never reaches the message.
    expect(h.errors[0]).not.toContain(String(ACCOUNT_ID));
  });

  it('does not retry the refused document on the next sweep', async () => {
    const h = await refusingStore(oversizePersisted());
    h.store.saveAllDirty();
    await tick(30);
    h.store.saveAllDirty();
    await tick(30);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    // One warning, not one per sweep: a quiesced owner is reported once.
    expect(h.errors).toHaveLength(1);
  });

  it('writes nothing for a document past the layout row ceiling', async () => {
    const overLong = persistedFixture({
      layout: Array.from({ length: FREEHOLD_MAX_LAYOUT_ROWS + 1 }, (_unused, i) => ({
        placementId: i,
        itemId: 'oak_chair',
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
      })),
      rev: 8,
    });
    const h = await refusingStore(overLong);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.errors[0]).toContain('layout_over_ceiling');
    expect(h.errors[0]).toContain(String(FREEHOLD_MAX_LAYOUT_ROWS + 1));
  });

  it('writes nothing for a document past the trophy row ceiling', async () => {
    const overLong = persistedFixture({
      trophies: Array.from({ length: FREEHOLD_MAX_TROPHY_ROWS + 1 }, (_unused, i) => ({
        plinth: i,
        trophyId: 'skull_of_something',
      })),
      rev: 8,
    });
    const h = await refusingStore(overLong);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.errors[0]).toContain('trophies_over_ceiling');
  });

  it('reports the row ceiling first for a document that breaks both', async () => {
    const both = persistedFixture({
      layout: Array.from({ length: FREEHOLD_MAX_LAYOUT_ROWS + 1 }, (_unused, i) => ({
        placementId: i,
        itemId: wideId,
        x: -0.0000012345678901234567,
        y: -0.0000012345678901234567,
        z: -0.0000012345678901234567,
        yaw: -0.0000012345678901234567,
      })),
      rev: 8,
    });
    // Genuinely both, so the ordering claim is not vacuous.
    expect(persistedFreeholdBytes(both)).toBeGreaterThan(FREEHOLD_MAX_OWNED_BYTES);
    const h = await refusingStore(both);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.errors[0]).toContain('layout_over_ceiling');
    expect(h.errors[0]).not.toContain('oversize');
  });

  it('still writes a document inside every ceiling', async () => {
    // The anti-vacuity arm: the same harness, one legal document, one write.
    const h = await refusingStore(persistedFixture({ rev: 8 }));
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().writeFailures).toBe(0);
  });
});

describe('reference counting and eviction', () => {
  it('drops the entry when references, running and pending are all clear', async () => {
    const h = await loadedStore();
    expect(h.store.stats().entries).toBe(1);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
  });

  it('keeps the entry while a reference survives (references alone)', async () => {
    // A second character of the same account joins, so one leave leaves one
    // reference, and the shared record stays with it.
    const h = await loadedStore();
    await h.joinAfterReask();
    await h.leave();
    expect(h.record()).toBeDefined();
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().running).toBe(0);
    expect(h.store.stats().pending).toBe(0);
  });

  it('keeps the entry while a write is still running', async () => {
    // NOT "running alone", which is what this used to claim. The entry is also
    // dirty throughout, and a mutation pass shows the dirty clause is what
    // carries the assertion: dropping `entry.running` from `owesWork` leaves
    // this green. Three of that predicate's five clauses are redundant under
    // today's arming rules, and the predicate says so where it is declared.
    let served = 0;
    const h = await loadedStore({
      writeRow: async () => {
        served += 1;
        // Keep the entry perpetually dirty for a bounded number of writes, so
        // the flush exhausts its pass budget with a write still in flight.
        if (served <= 12) h.store.markDirty(OWNER_KEY);
        return { kind: 'updated', durableRev: `rev${served}` };
      },
    });
    h.store.markDirty(OWNER_KEY);
    await h.store.flushAndRelease(OWNER_KEY);
    const midFlight = h.store.stats();
    expect(midFlight.entries).toBe(1);
    expect(midFlight.running + midFlight.pending).toBeGreaterThan(0);
    expect(served).toBeLessThanOrEqual(FREEHOLD_PERSIST_FLUSH_MAX_PASSES + 1);

    await tick(400);
    // Once the last write settles, all three are clear and the entry goes.
    expect(h.store.stats().entries).toBe(0);
  });

  it('survives the same-account swap when the new retain precedes the old release', async () => {
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await gate.promise });
    h.store.markDirty(OWNER_KEY);
    // A LEAVE ALREADY IN FLIGHT: the old session logs out and its flush starts
    // and parks on the held write (leave() drops the session from the roster at
    // once, so a new character may join), and the new character's join lands
    // under the SAME owner key before the old reference is released. The
    // linkdead swap, where the join lands before the old flush even starts, is
    // the next case. The new character's first ask came while the old session
    // was in the world; its re-ask and join come after the leave began.
    await h.store.preload(ACCOUNT_ID);
    const leaving = h.leave();
    await h.joinAfterReask();
    gate.resolve({ kind: 'updated', durableRev: '2' });
    await leaving;
    await tick(30);
    expect(h.store.stats().entries).toBe(1);

    // The surviving entry is still a working writer for the new session.
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(2);
  });

  it('survives the linkdead swap, where the new retain lands before the old flush starts', async () => {
    // GameServer.join fires the linkdead session's leave and then binds on the
    // same tick, and leave() awaits its settlement before the housing flush, so
    // the new reference is taken FIRST and the old flush, with a write owed,
    // runs after it.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await gate.promise });
    h.store.markDirty(OWNER_KEY);
    const answer = await h.store.preload(ACCOUNT_ID);
    h.join(answer);
    const leaving = h.leave();
    await tick(10);
    expect(h.store.stats().running).toBe(1);
    gate.resolve({ kind: 'updated', durableRev: '2' });
    await leaving;
    await tick(30);
    expect(h.store.stats().entries).toBe(1);
    expect(h.record()).toBeDefined();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(2);
  });

  it('drops the entry when no retain preceded the release (the other arm of the swap)', async () => {
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await gate.promise });
    h.store.markDirty(OWNER_KEY);
    const leaving = h.leave();
    gate.resolve({ kind: 'updated', durableRev: '2' });
    await leaving;
    expect(h.store.stats().entries).toBe(0);
  });

  it('leaves a clean entry alone on the leave path', async () => {
    // Clean means what the SWEEP means by clean: the live record's revision
    // matches the last written one. Rewriting an unchanged document on every
    // logout would burn a durable revision per leave.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
    });
    expect(h.record()?.rev).toBe(5);
    await h.leave();
    await tick();
    expect(h.writeCount()).toBe(0);
  });

  it('flushes a record that moved since the last sweep, with no markDirty call', async () => {
    // THE LAST WINDOW. A tier change made between the final sweep and the
    // logout bumps only the record's revision; a leave path testing markDirty
    // alone would drop it, and there is no next sweep to catch it.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, { rev: 6 });
    await h.leave();
    await tick(20);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
  });
});

describe('a durable answer no repeat can fix stops the writes', () => {
  it('moves a run of thrown writes onto the retry clock, and not before', async () => {
    // A stale or refused answer quiesces on the FIRST reply, because no repeat
    // can change it. A thrown write is not an answer, so it gets a few chances
    // on the sweep and then the retry clock (R1), never a quiesce; without any
    // bound a row this realm genuinely cannot write would be retried on every
    // sweep for the life of the process.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    for (let attempt = 1; attempt < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; attempt++) {
      h.edit(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(attempt);
      // Still on the ordinary cadence.
      expect(h.store.stats()).toMatchObject({ quiesced: 0, retrying: 0 });
    }
    h.edit(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS);
    expect(h.store.stats()).toMatchObject({ quiesced: 0, retrying: 1 });

    // And it really slows: every later sweep inside the window costs nothing.
    for (let i = 0; i < 5; i++) {
      h.edit(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS);
  });

  it('resets the error run on a commit, so a blip never accumulates across a session', async () => {
    // Without the reset, three unrelated blips spread over hours would quiesce
    // a perfectly healthy owner.
    let fail = true;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async (input) => {
        if (fail) throw new Error('connection terminated unexpectedly');
        return { kind: 'updated', durableRev: String(input.wireRev) };
      },
    });
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_WRITE_ERRORS - 1; i++) {
      h.edit(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
    }
    fail = false;
    h.edit(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.store.stats().writes).toBe(1);

    // The run is back to zero: two more throws still do not quiesce.
    fail = true;
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_WRITE_ERRORS - 1; i++) {
      h.edit(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.store.stats().quiesced).toBe(0);
  });

  it("never hands a QUIESCED entry's house to a joining character (the replay guard is a source pin)", async () => {
    // A quiesced entry has NO hold, and it is exactly the entry whose knowledge
    // is known to be stale: the durable revision moved under this realm, which
    // is what the fence exists to detect. Replaying it on a rejoin would
    // install a house another writer has already replaced.
    //
    // WHERE THIS CAN BE REACHED, stated because it is narrower than the title.
    // A quiesced entry is BLOCKED, so it owes no work and is collected the
    // moment its last session releases it; one realm therefore never holds a
    // quiesced entry with no record beside it, and preload's REPLAY arm cannot
    // be handed one. The reachable rejoin is a second character joining while
    // the owner is still in the world, which takes the ALREADY-LIVE arm. That is
    // what this drives. It is NOT what decides the replay claim: that arm answers
    // no state for every entry, quiesced or not (the contrast below), so the
    // replay arm's own guard, defence in depth for the same fact, is carried by
    // the source pin at the end.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'stale', durableRev: '99' }),
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.store.stats().quiesced).toBe(1);

    const again = await h.store.preload(ACCOUNT_ID);
    expect(again.state).toBeNull();
    // And no second read went out: the entry is still loaded, just untrusted.
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(0);
    // The contrast: the same arm answers no state for an entry that is NOT
    // quiesced, so the two lines above are not the replay claim.
    const healthy = await loadedStore({ rowLoad: { kind: 'row', row: rowFixture() } });
    expect((await healthy.store.preload(ACCOUNT_ID)).state).toBeNull();
    // The guard lives in ONE expression, and both readers of a loaded entry take
    // it: preload's replay arm and, since ruling (b), the join's validation at
    // install time, which is what every production join installs.
    const source = stripComments(readFileSync(SOURCE_PATH, 'utf8'));
    expect(methodBody(source, '  async function preloadWithin(')).toContain(
      'return replayAnswer(entry);',
    );
    expect(methodBody(source, '  function replayAnswer(')).toContain(
      'return snapshotOf(entry, blocked(entry) ? null : offerCapture(entry), false);',
    );
    expect(methodBody(source, '    answerForInstall(')).toContain(
      'const current = entry?.loaded ? replayAnswer(entry) : null;',
    );
  });
});

describe('the coalescer, the drain and the age report at their stated edges', () => {
  it('reports the OLDEST dirty age, not the newest or the last one seen', () => {
    return (async () => {
      const h = await loadedStore();
      await h.login(OTHER_ACCOUNT_ID);

      h.setNow(20_000);
      h.store.markDirty(OWNER_KEY);
      h.setNow(26_000);
      h.store.markDirty(OTHER_OWNER_KEY);
      h.setNow(30_000);
      // Two dirty entries, six seconds apart: the report must be the older
      // one's age. A single-entry test cannot tell "oldest" from "any".
      expect(h.store.stats().dirty).toBe(2);
      expect(h.store.stats().oldestDirtyAgeMs).toBe(10_000);
    })();
  });

  it('answers two concurrent drains, not just the one that asked first', () => {
    // drainWaiters is a SET rather than a single promise for exactly this: the
    // shutdown path and a test harness can both be waiting, and a second
    // waiter overwriting the first would leave it pending forever.
    return (async () => {
      const gate = deferred<FreeholdUpsertResult>();
      const h = await loadedStore({ writeRow: async () => await gate.promise });
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      await tick(10);

      const first = h.store.idle(60_000);
      const second = h.store.idle(60_000);
      gate.resolve({ kind: 'updated', durableRev: '2' });
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    })();
  });

  it('survives a synchronously throwing enqueue without leaving the entry running', () => {
    // The catch around the enqueue call itself, not around the write it
    // schedules. An entry left `running` after a throw can never be removed,
    // never re-armed, and stalls every drain until its deadline.
    return (async () => {
      const h = await loadedStore({
        enqueue: () => {
          throw new Error('the keyed writer refused the enqueue');
        },
      });
      h.store.markDirty(OWNER_KEY);
      h.store.save(OWNER_KEY);
      await tick(20);
      expect(h.writeCount()).toBe(0);
      expect(h.store.stats().writeFailures).toBe(1);
      expect(h.store.stats().running).toBe(0);
      expect(h.errors.join(' ')).toContain('could not be queued');
      // And the drain still answers IMMEDIATELY rather than at its deadline,
      // but it answers FALSE: nothing is running, pending or deferred, so there
      // is nothing left to wait for, and the entry is still dirty and unblocked
      // with nobody to re-arm it. Answering true here would report a clean drain
      // over an owner's unwritten edits.
      expect(await h.store.idle(60_000)).toBe(false);
      expect(h.deadlines.some((job) => job.fired)).toBe(false);
      expect(h.store.stats().dirty).toBe(1);
    })();
  });
});

describe('a write may only carry the record this entry actually loaded', () => {
  // THE WORST OUTCOME THIS STORE CAN PRODUCE, and the one the whole design
  // exists to prevent: an empty seeded default written over a real house. The
  // compare-and-swap deliberately never touches plot_id, so such a write leaves
  // the identity intact and the loss is invisible in the key.
  //
  // The window is real. A rejoin's handshake reads while the old session's
  // record is still live (before its leave flush, or after it and before its
  // removePlayer), so its answer carries no state; the old session's
  // removePlayer then evicts, and the join is handed a freshly seeded default
  // over an entry that knows the row. `rejoinOverEviction` builds the first of
  // those two orders.

  it('refuses to write a freshly seeded default over a row with a durable revision', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '9' }) },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    // The window above, in production order: the live record becomes a FRESH
    // SEED rather than the house the entry knows.
    await h.rejoinOverEviction();
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.record()?.rev).toBe(0);
    expect(h.record()?.layout).toEqual([]);
    h.store.saveAllDirty();
    await tick(30);
    // The absence of the write IS the assertion.
    expect(h.writeCount()).toBe(0);
    expect(h.calls).not.toContain('writeRow');
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors[0]).toContain('identity');
  });

  it('refuses a live record whose plot identity is not the one it loaded', async () => {
    // THE ONE OTHER IDENTITY a record under this owner key can carry on ONE
    // realm is the stand-in a reseed gives it: nothing in the sim writes an
    // identity, and an install names a record after this account's own row (the
    // name arm's refusal of any other name is pinned with literals in
    // tests/server/freehold_write_seal.test.ts). So the foreign name
    // here is the stand-in, and the returning session then furnishes it back to
    // the entry's own content at a revision ahead of the entry's, so the NAME is
    // the only thing that differs and the name arm is the only one that can
    // refuse.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    await h.rejoinOverEviction();
    h.edit(OWNER_KEY, furnishedEdit(9));
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors[0]).toContain('identity');
  });

  it('builds the document AS SENT once, and refuses THAT (source pin)', () => {
    // The row receives `entry.plotId`, never the live record's, so the refusal
    // has to run on the document that lands rather than on the one the sim
    // happens to hold. There is no behaviour test for this today: the identity
    // seal above already refuses every live record whose identity differs, so
    // the two objects can only diverge in ways that seal catches first. What
    // remains is the byte measure and any future field, and a structural pin is
    // the honest tool for a difference nothing can yet observe.
    const body = methodBody(
      stripComments(readFileSync(SOURCE_PATH, 'utf8')),
      '  async function runWrite(',
    );
    expect(body).toContain(
      'const document: PersistedFreehold = { ...persisted, plotId: entry.plotId };',
    );
    expect(body).toContain('freeholdWriteRefusal(document,');
    // Every field the row receives reads the built document, so a later field
    // cannot quietly take the live record's value instead.
    for (const field of [
      'JSON.stringify(document.layout)',
      'JSON.stringify(document.trophies)',
      'tier: document.tier',
      'condition: document.condition',
      'visitPolicy: document.visitPolicy',
      'wireRev: document.rev',
      'schemaVersion: document.version',
    ]) {
      expect(body, field).toContain(field);
    }
    // ...and the SEAL still reads the LIVE record, which is the whole point of
    // keeping two names: comparing the document against entry.state would be
    // comparing a value with itself, because `document` carries entry.plotId by
    // construction. The seal moved to server/freehold_write_seal.ts, so what is
    // pinned here is WHICH VALUE runWrite hands it; every arm of the comparison
    // itself is driven directly in tests/server/freehold_write_seal.test.ts.
    expect(body).toContain('seedWouldLandOnRealRow(persisted, entry)');
    expect(body).not.toContain('seedWouldLandOnRealRow(document');
    const seal = stripComments(readFileSync('server/freehold_write_seal.ts', 'utf8'));
    expect(seal).toContain('persisted.plotId !== entry.state.plotId');
  });

  it('still writes the record it DID load, so the seal is not just a stopped writer', async () => {
    // The anti-vacuity arm. Without it every case above would pass on a store
    // that had simply stopped writing.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, { rev: 6 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('keeps writing after the FIRST insert for an account that had no row', async () => {
    // The regression this seal could most easily cause. After the insert the
    // entry has a durable revision, and the live record is still the empty
    // default the join installed, so a seal that treated an empty default as a
    // seed would quiesce every account on its SECOND save, forever.
    const h = await loadedStore({
      rowLoad: { kind: 'absent' },
      writeRow: async (input) => ({
        kind: input.expectedDurableRev === null ? 'inserted' : 'updated',
        durableRev: '1',
      }),
    });
    h.edit(OWNER_KEY, { rev: 1 });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].expectedDurableRev).toBeNull();

    h.edit(OWNER_KEY, { rev: 2 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].expectedDurableRev).toBe('1');
    expect(h.record()?.layout).toEqual([]);
  });

  it('still writes the default the join installed when there is NO durable row to lose', async () => {
    // The first write for an account that has never written is the default
    // the join installed, under a freshly minted identity, and it is
    // insert-only. The seal must not block the one case where writing a default
    // is the whole point.
    const h = await loadedStore({
      rowLoad: { kind: 'absent' },
      writeRow: async () => ({ kind: 'inserted', durableRev: '1' }),
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].expectedDurableRev).toBeNull();
    expect(h.writes[0].plotId).toBe('plot:minted1');
    expect(h.writes[0].layoutJson).toBe('[]');
    expect(h.writes[0].trophiesJson).toBe('[]');
  });
});

describe('a join installs the store answer at install time, never one that went stale in its handshake', () => {
  // RULING (B) FOR THE TWELFTH PATH (Fernando, 2026-09-25), and the eleventh
  // path's cost with it. The answer a handshake reads before its lease and its
  // character read can go STALE inside those awaits: another session of the
  // account joins, edits, leaves and is evicted there. Installed as asked, it
  // wrote an empty or older house over the real one (silently in most orders)
  // or lost the leaving session's unwritten edits (loudly in the rest), and
  // every one of those orders was pinned below as a KNOWN DEFECT or KNOWN COST.
  // The fix has two halves and both are driven here through production code:
  // the handshake RE-ASKS after the character read (`joinAfterReask`), and the
  // join decides what to install from the store's entry AT INSTALL TIME, capture
  // included (`answerForInstall`, server/freehold_join_answer.ts). Every pin
  // that was a KNOWN DEFECT or KNOWN COST now asserts the fixed behaviour: the
  // leaver's edits land, the joiner installs the current house and can write,
  // and nothing stale reaches the row.

  /** The furnished house a session places over what the stale answer holds. */
  const HOUSE_LAYOUT = [...persistedFixture().layout, TABLE];
  const SHELF = { ...TABLE, placementId: 3, x: 1 };
  /** The stale answer's own layout, per account shape. */
  const staleLayout = (shape: 'ABSENT' | 'ROW'): string =>
    shape === 'ROW' ? JSON.stringify(rowFixture().layout) : '[]';

  /** Every leave-write deadline still armed, fired: the leave stops WAITING. */
  const expireLeaves = (h: Harness): void => {
    for (const job of h.deadlines) {
      if (job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS && !job.fired && !job.cancelled) job.fire();
    }
  };
  /** Every login budget still armed, fired: that ask answers `no_budget`. */
  const expireBudgets = (h: Harness): void => {
    for (const job of h.deadlines) {
      if (job.ms === FREEHOLD_PERSIST_LOGIN_BUDGET_MS && !job.fired && !job.cancelled) job.fire();
    }
  };
  /** A whole leave that may stop at its deadline, as GameServer.leave does. */
  async function leaveWithinDeadline(h: Harness): Promise<void> {
    const leaving = h.leave();
    await tick(10);
    expireLeaves(h);
    await leaving;
  }
  const mine = (h: Harness) => h.writes.filter((write) => write.accountId === ACCOUNT_ID);
  const rowOf = async (db: ReturnType<typeof rowRemembered>) => {
    const row = await db.readRow(ACCOUNT_ID);
    return row.kind === 'row' ? [JSON.stringify(row.row.layout), row.row.wireRev] : row.kind;
  };
  const refusals = (h: Harness) => h.errors.filter((line) => line.includes('write refused'));

  type UnwrittenForm = 'WAITING' | 'REFUSED A PERMIT' | 'THREW ONCE' | 'DEFERRED';
  type KnownCommit = 'NONE' | 'MID-SESSION' | 'EARLIER-SESSION';
  type FirstAsk = 'ANSWERED' | 'no_permit' | 'read_threw' | 'cap_full' | 'no_budget';

  /**
   * THE UNWRITTEN ORDER, in production order and every form the ledger lists.
   * Y's handshake asks first (`firstAsk`: answered, or held on each kind); X,
   * another session of the same account, logs in, edits (above a commit the
   * store already knows when `known` says so) and leaves with its write still
   * owed (`form`), and is evicted; then Y re-asks and joins. `drive` runs the
   * write X owes.
   */
  async function unwrittenOrder(
    shape: 'ABSENT' | 'ROW',
    form: UnwrittenForm,
    known: KnownCommit,
    firstAsk: FirstAsk = 'ANSWERED',
  ) {
    const db = rowRemembered(shape === 'ROW' ? rowFixture() : null);
    let holdPermits = false;
    const permit = deferred<{ release(): void } | null>();
    let refuseNextPermit = false;
    let throwNextWrite = false;
    let throwNextRead = false;
    let gateMyRead: Deferred<void> | null = null;
    const otherReads: Array<() => void> = [];
    const otherWrites: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      readRow: async (accountId) => {
        if (accountId !== ACCOUNT_ID) {
          await new Promise<void>((resolve) => otherReads.push(resolve));
          return { kind: 'row', row: rowFixture({ accountId, plotId: `plot:row${accountId}` }) };
        }
        if (throwNextRead) {
          throwNextRead = false;
          throw new Error('connection reset');
        }
        if (gateMyRead) {
          const gate = gateMyRead;
          gateMyRead = null;
          await gate.promise;
        }
        return await db.readRow(accountId);
      },
      acquirePermit: async () => {
        if (refuseNextPermit) {
          refuseNextPermit = false;
          return null;
        }
        return holdPermits ? await permit.promise : { release: () => {} };
      },
      writeRow: async (input) => {
        if (input.accountId !== ACCOUNT_ID) {
          const gate = deferred<FreeholdUpsertResult>();
          otherWrites.push(gate);
          return await gate.promise;
        }
        if (throwNextWrite) {
          throwNextWrite = false;
          throw new Error('connection reset');
        }
        return await db.writeRow(input);
      },
    });
    const releaseOtherReads = async (): Promise<void> => {
      while (otherReads.length > 0) {
        otherReads.shift()?.();
        await tick(10);
      }
    };

    // Y's FIRST ASK, before its lease, with nothing live.
    let yFirst: LoadedFreehold;
    if (firstAsk === 'cap_full') {
      for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_LOADS; i++) {
        void h.store.preload(OTHER_ACCOUNT_ID + 1000 + i);
      }
      await tick(10);
      yFirst = await h.store.preload(ACCOUNT_ID);
      await releaseOtherReads();
    } else if (firstAsk === 'no_budget') {
      gateMyRead = deferred<void>();
      const gate = gateMyRead;
      const asking = h.store.preload(ACCOUNT_ID);
      await tick(10);
      expireBudgets(h);
      yFirst = await asking;
      // The read outlives the refusal, and lands before X's login needs it.
      gate.resolve();
      await tick(30);
    } else {
      refuseNextPermit = firstAsk === 'no_permit';
      throwNextRead = firstAsk === 'read_threw';
      yFirst = await h.store.preload(ACCOUNT_ID);
    }
    expect(yFirst.hold?.kind ?? 'ANSWERED').toBe(firstAsk);

    // X's session, with a commit the store knows when `known` says so.
    const mid = shape === 'ROW' ? 6 : 1;
    await h.login();
    if (known !== 'NONE') {
      h.edit(OWNER_KEY, { ...furnishedEdit(mid), layout: HOUSE_LAYOUT });
      if (known === 'MID-SESSION') {
        h.store.saveAllDirty();
        await tick(30);
      } else {
        await h.leave();
        await h.login();
        expect(h.record()?.rev).toBe(mid);
      }
      expect(mine(h)).toHaveLength(1);
    }
    const final =
      known === 'NONE'
        ? { layout: HOUSE_LAYOUT, rev: shape === 'ROW' ? 8 : 3 }
        : { layout: [...HOUSE_LAYOUT, SHELF], rev: mid + 2 };
    h.edit(OWNER_KEY, { ...furnishedEdit(final.rev), layout: final.layout });
    const rowBefore = await rowOf(db);

    // X LEAVES WITH ITS WRITE OWED, in the form named, and is evicted.
    if (form === 'DEFERRED') {
      // Other owners' writes hold every slot, the leave reserve included.
      for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES; i++) {
        const accountId = OTHER_ACCOUNT_ID + i;
        const loading = h.login(accountId);
        await tick(10);
        await releaseOtherReads();
        await loading;
        h.store.markDirty(`account:${accountId}`);
        h.store.save(`account:${accountId}`);
      }
      for (let i = 0; i < FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE; i++) {
        const accountId = OTHER_ACCOUNT_ID + 500 + i;
        const loading = h.login(accountId);
        await tick(10);
        await releaseOtherReads();
        await loading;
        h.store.markDirty(`account:${accountId}`);
        void h.store.flushAndRelease(`account:${accountId}`);
        await tick(20);
      }
      expect(h.store.stats().activeWrites).toBe(
        FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE,
      );
    }
    // Counted from here: the reserve leavers above hold captures of their own.
    const capturesBefore = h.store.stats().leaveCaptures;
    if (form === 'DEFERRED') {
      await leaveWithinDeadline(h);
      expect(h.store.stats().deferredWrites).toBeGreaterThan(0);
    } else if (form === 'WAITING') {
      holdPermits = true;
      await leaveWithinDeadline(h);
    } else {
      refuseNextPermit = form === 'REFUSED A PERMIT';
      throwNextWrite = form === 'THREW ONCE';
      await h.leave();
      expect(refuseNextPermit || throwNextWrite).toBe(false);
      expect(h.store.stats().writeFailures).toBe(1);
      expect(h.store.stats().quiesced).toBe(0);
    }
    expect(h.record()).toBeUndefined();
    // Owed, not written: the row is as it was (a thrown attempt was sent and
    // never landed).
    expect(await rowOf(db)).toEqual(rowBefore);
    expect(h.store.stats().leaveCaptures).toBe(capturesBefore + 1);
    const writesBefore = mine(h).length;

    // Y RE-ASKS AND JOINS: the capture is what goes in, and retain releases it
    // because the record now carries it. A first ask refused on the budget spent
    // all of it, so that re-ask gets none: the loaded entry's replay still wins.
    await h.joinAfterReask(
      ACCOUNT_ID,
      yFirst.hold?.kind === 'no_budget' ? FREEHOLD_PERSIST_LOGIN_BUDGET_MS : 0,
    );
    expect(h.record()?.plotId).toBe(shape === 'ROW' ? ROW_PLOT_ID : MINTED_PLOT_ID);
    expect(h.record()?.rev).toBe(final.rev);
    expect(h.record()?.layout).toEqual(final.layout);
    expect(h.store.stats().leaveCaptures).toBe(capturesBefore);

    /** Run the write X owes: its permit arrives, the next sweep re-arms it, or
     *  the slots it is deferred behind free up. */
    const drive = async (): Promise<void> => {
      if (form === 'WAITING') permit.resolve({ release: () => {} });
      else if (form === 'DEFERRED') {
        for (let i = 0; i < otherWrites.length && mine(h).length === writesBefore; i++) {
          otherWrites[i].resolve({ kind: 'updated', durableRev: '9' });
          await tick(30);
        }
      } else h.store.saveAllDirty();
      await tick(40);
    };
    return { h, db, final, drive, writesBefore, capturesBefore };
  }

  /** The row X's final house must reach, at the revision the last write carried. */
  async function expectLanded(
    run: Awaited<ReturnType<typeof unwrittenOrder>>,
    wireRev: number,
  ): Promise<void> {
    const { h, db, final, writesBefore } = run;
    const written = mine(h).slice(writesBefore);
    expect(written.length).toBeGreaterThan(0);
    expect(written.at(-1)?.layoutJson).toBe(JSON.stringify(final.layout));
    expect(written.at(-1)?.wireRev).toBe(wireRev);
    expect(await rowOf(db)).toEqual([JSON.stringify(final.layout), String(wireRev)]);
    expect(refusals(h)).toEqual([]);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(run.capturesBefore);
  }

  /** And the joiner can write on top of it, for the rest of its session. */
  async function expectJoinerWrites(run: Awaited<ReturnType<typeof unwrittenOrder>>) {
    const { h, db, final } = run;
    const next = (h.record()?.rev ?? Number.NaN) + 1;
    h.edit(OWNER_KEY, { rev: next });
    h.store.saveAllDirty();
    await tick(40);
    expect(mine(h).at(-1)?.wireRev).toBe(next);
    expect(await rowOf(db)).toEqual([JSON.stringify(final.layout), String(next)]);
    expect(h.store.stats().quiesced).toBe(0);
  }

  // THE UNWRITTEN ORDER: every form, both account shapes, with and without a
  // commit the store already knows. Before ruling (b) these wrote the stale
  // record with no edit and no window (KNOWN DEFECT) or, below a known commit,
  // lost the leaver's later edits loudly (KNOWN COST).
  for (const known of ['NONE', 'MID-SESSION', 'EARLIER-SESSION'] as const) {
    for (const form of ['WAITING', 'REFUSED A PERMIT', 'THREW ONCE', 'DEFERRED'] as const) {
      for (const shape of ['ABSENT', 'ROW'] as const) {
        const commit = known === 'NONE' ? 'no known commit' : `a known ${known} commit`;
        it(`the unwritten order (${form}, ${shape}, ${commit}): the leaver's edits land and the joiner writes on top`, async () => {
          const run = await unwrittenOrder(shape, form, known);
          await run.drive();
          await expectLanded(run, run.final.rev);
          await expectJoinerWrites(run);
        });
      }
    }
  }

  // The old SILENT arms: the joiner edits before the owed write samples. The
  // write then carries the leaver's house with the joiner's edit on it, never
  // the stale house brought up to a committed revision.
  for (const form of ['WAITING', 'REFUSED A PERMIT', 'THREW ONCE', 'DEFERRED'] as const) {
    for (const known of ['NONE', 'MID-SESSION', 'EARLIER-SESSION'] as const) {
      for (const shape of ['ABSENT', 'ROW'] as const) {
        it(`a joiner that edits before the owed write samples (${form}, ${shape}, ${known} commit) writes on top of the leaver's house`, async () => {
          const run = await unwrittenOrder(shape, form, known);
          run.h.edit(OWNER_KEY, { rev: run.final.rev + 1 });
          await run.drive();
          await expectLanded(run, run.final.rev + 1);
        });
      }
    }
  }

  // THE JOINER LEAVES FIRST, before the owed write samples: its own leave
  // captures the record that now carries the leaver's house. The one arm a
  // write that simply preferred the capture would have left standing.
  for (const form of ['WAITING', 'REFUSED A PERMIT', 'THREW ONCE', 'DEFERRED'] as const) {
    for (const shape of ['ABSENT', 'ROW'] as const) {
      it(`a joiner that leaves before the owed write (${form}, ${shape}) still hands the leaver's house to the row`, async () => {
        const run = await unwrittenOrder(shape, form, 'NONE');
        await leaveWithinDeadline(run.h);
        expect(run.h.record()).toBeUndefined();
        await run.drive();
        await expectLanded(run, run.final.rev);
      });
    }
  }

  // THE HELD LOGINS: Y's first ask was refused (on capacity, a thrown read, or
  // the whole-preload budget) while nothing was live. X's own login loaded the
  // entry, so Y's re-ask replays it. Before ruling (b) the hold installed
  // nothing, the stand-in was seeded, and X's capture was refused on it and
  // released (KNOWN COST).
  for (const firstAsk of ['no_permit', 'read_threw', 'cap_full', 'no_budget'] as const) {
    for (const form of ['WAITING', 'REFUSED A PERMIT', 'THREW ONCE', 'DEFERRED'] as const) {
      for (const shape of ['ABSENT', 'ROW'] as const) {
        it(`a ${firstAsk} hold at the first ask (${form}, ${shape}) no longer costs the leaver's capture`, async () => {
          const run = await unwrittenOrder(shape, form, 'NONE', firstAsk);
          await run.drive();
          await expectLanded(run, run.final.rev);
          await expectJoinerWrites(run);
        });
      }
    }
  }

  /**
   * THE COMMITTED ORDER: X's write COMMITTED and its clean entry was collected,
   * so Y's re-ask is a durable read of the house X committed. Before ruling (b)
   * Y installed its stale answer, and a joiner who reached the committed
   * revision before a write sampled it overwrote the house (KNOWN DEFECT: the
   * edit past it, the exact revision, a write armed below, a refused permit).
   */
  async function committedOrder(shape: 'ABSENT' | 'ROW', options: HarnessOptions = {}) {
    const db = rowRemembered(shape === 'ROW' ? rowFixture() : null);
    const h = harness({ ...db, ...options });
    await h.store.preload(ACCOUNT_ID);
    await h.login();
    const committed = shape === 'ROW' ? 8 : 3;
    h.edit(OWNER_KEY, { ...furnishedEdit(committed), layout: HOUSE_LAYOUT });
    await h.leave();
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().entries).toBe(0);
    const readsBefore = h.calls.filter((call) => call === 'readRow').length;
    await h.joinAfterReask();
    // THE RE-ASK READ IT, and the join installed exactly what X committed,
    // never a record below it.
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(readsBefore + 1);
    expect(h.record()?.rev).toBe(committed);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    expect(h.record()?.plotId).toBe(shape === 'ROW' ? ROW_PLOT_ID : MINTED_PLOT_ID);
    return { h, db, committed, house: JSON.stringify(HOUSE_LAYOUT) };
  }

  for (const shape of ['ABSENT', 'ROW'] as const) {
    it(`the committed order (${shape}): installs the committed house, and a joiner edit writes on top of it`, async () => {
      const { h, db, committed, house } = await committedOrder(shape);
      // At exactly the committed revision nothing is owed.
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(1);
      h.edit(OWNER_KEY, { rev: committed + 1 });
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(2);
      expect(h.writes[1].layoutJson).toBe(house);
      expect(h.writes[1].wireRev).toBe(committed + 1);
      expect(h.writes[1].expectedDurableRev).toBe(shape === 'ROW' ? '8' : '1');
      expect(await rowOf(db)).toEqual([house, String(committed + 1)]);
      expect(h.store.stats().quiesced).toBe(0);
      expect(h.errors).toEqual([]);
    });

    it(`the committed order (${shape}): a write refused a permit re-arms and still carries the committed house`, async () => {
      let refuseNext = false;
      const { h, db, committed, house } = await committedOrder(shape, {
        acquirePermit: async () => {
          if (!refuseNext) return { release: () => {} };
          refuseNext = false;
          return null;
        },
      });
      h.edit(OWNER_KEY, { rev: committed + 1 });
      refuseNext = true;
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(1);
      expect(h.store.stats().writeFailures).toBe(1);
      h.edit(OWNER_KEY, { rev: committed + 2 });
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(2);
      expect(h.writes[1].layoutJson).toBe(house);
      expect(await rowOf(db)).toEqual([house, String(committed + 2)]);
      expect(h.store.stats().quiesced).toBe(0);
    });

    it(`the committed order (${shape}): a write armed on the committed house samples the joiner's later edit with it`, async () => {
      let hold = false;
      const permit = deferred<{ release(): void } | null>();
      const { h, db, committed, house } = await committedOrder(shape, {
        acquirePermit: async () => (hold ? await permit.promise : { release: () => {} }),
      });
      hold = true;
      h.edit(OWNER_KEY, { rev: committed + 1 });
      h.store.saveAllDirty();
      await tick(10);
      h.edit(OWNER_KEY, { rev: committed + 2 });
      permit.resolve({ release: () => {} });
      await tick(40);
      expect(h.writes.at(-1)?.layoutJson).toBe(house);
      expect(h.writes.at(-1)?.wireRev).toBe(committed + 2);
      expect(await rowOf(db)).toEqual([house, String(committed + 2)]);
      expect(h.store.stats().quiesced).toBe(0);
    });

    it(`the committed order (${shape}): a write DEFERRED behind the write cap carries the committed house`, async () => {
      // The widening the ledger left unpinned in this order.
      const gates: Array<Deferred<FreeholdUpsertResult>> = [];
      const db = rowRemembered(shape === 'ROW' ? rowFixture() : null);
      const { h, committed, house } = await committedOrder(shape, {
        readRow: async (accountId) =>
          accountId === ACCOUNT_ID
            ? db.readRow(accountId)
            : { kind: 'row', row: rowFixture({ accountId, plotId: `plot:row${accountId}` }) },
        writeRow: async (input) => {
          if (input.accountId === ACCOUNT_ID) return await db.writeRow(input);
          const gate = deferred<FreeholdUpsertResult>();
          gates.push(gate);
          return await gate.promise;
        },
      });
      for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES; i++) {
        await h.login(OTHER_ACCOUNT_ID + i);
        h.store.markDirty(`account:${OTHER_ACCOUNT_ID + i}`);
        h.store.save(`account:${OTHER_ACCOUNT_ID + i}`);
      }
      h.edit(OWNER_KEY, { rev: committed + 1 });
      h.store.saveAllDirty();
      await tick(20);
      expect(h.store.stats().deferredWrites).toBe(1);
      h.edit(OWNER_KEY, { rev: committed + 2 });
      gates[0].resolve({ kind: 'updated', durableRev: '9' });
      await tick(40);
      const ours = h.writes.filter((write) => write.accountId === ACCOUNT_ID);
      expect(ours).toHaveLength(2);
      expect(ours[1].layoutJson).toBe(house);
      expect(ours[1].wireRev).toBe(committed + 2);
      expect(await rowOf(db)).toEqual([house, String(committed + 2)]);
      expect(h.store.stats().quiesced).toBe(0);
      for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
      await tick(60);
    });
  }

  // THE ELEVENTH PATH, both forms, recovered. Y's first ask is read BESIDE X's
  // live record (preload's already-live arm, marked to put nothing in), and X
  // leaves and is evicted before Y joins. The eleventh path's fix put nothing in
  // and cost Y a write-blocked session and X's waiting capture; the re-ask and
  // the install-time answer recover both.
  it('the eleventh path, committed: installs the house the leaver committed, and the joiner writes on top', async () => {
    const db = rowRemembered();
    const h = harness({ ...db });
    await h.login();
    h.edit(OWNER_KEY, furnishedEdit(3));
    const beside = await h.store.preload(ACCOUNT_ID);
    expect(beside.recordWithheld).toBe(true);
    await h.leave();
    expect(h.writeCount()).toBe(1);
    expect(h.record()).toBeUndefined();
    await h.joinAfterReask();
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    expect(h.record()?.layout).toEqual(persistedFixture().layout);
    h.edit(OWNER_KEY, { rev: 4 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].layoutJson).toBe(JSON.stringify(persistedFixture().layout));
    expect(h.writes[1].wireRev).toBe(4);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it("the eleventh path, waiting: installs the leaver's capture, which then reaches the row", async () => {
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const db = rowRemembered();
    const h = harness({
      ...db,
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
    });
    await h.login();
    h.edit(OWNER_KEY, furnishedEdit(3));
    await h.store.preload(ACCOUNT_ID);
    await leaveWithinDeadline(h);
    expect(h.record()).toBeUndefined();
    expect(h.store.stats().leaveCaptures).toBe(1);
    await h.joinAfterReask();
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    expect(h.record()?.rev).toBe(3);
    expect(h.store.stats().leaveCaptures).toBe(0);
    permit.resolve({ release: () => {} });
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);
    expect(h.writes[0].expectedDurableRev).toBeNull();
    expect(h.writes[0].layoutJson).toBe(JSON.stringify(persistedFixture().layout));
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
    h.edit(OWNER_KEY, { rev: 4 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].expectedDurableRev).toBe('1');
  });

  // THE NEW CALL'S OWN FAILURE MODES.

  /** A committed house on the row, its entry collected and its record evicted,
   *  with the next character's first ask made beside it: the state every
   *  durable re-ask below starts from. */
  async function afterCommittedLeave(
    db: ReturnType<typeof rowRemembered>,
    options: HarnessOptions = {},
  ) {
    const h = harness({ ...db, ...options });
    await h.login();
    h.edit(OWNER_KEY, { ...furnishedEdit(8), layout: HOUSE_LAYOUT });
    await h.store.preload(ACCOUNT_ID);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(0);
    return { h, house: JSON.stringify(HOUSE_LAYOUT) };
  }

  for (const kind of ['no_permit', 'read_threw', 'cap_full', 'no_budget'] as const) {
    it(`a durable re-ask refused on capacity (${kind}) leaves a write-blocked session, never a loss`, async () => {
      // No loaded entry means no capture anywhere: a capture lives only on a
      // loaded entry, and an entry is collected only when it owes nothing. So
      // the refused re-ask installs nothing, the stand-in is seeded, retain's
      // repair reload loads the row, and the joiner's first write is refused on
      // it, loudly. The committed house stays on the row.
      let throwNext = false;
      let gate: Deferred<void> | null = null;
      const others: Array<() => void> = [];
      const db = rowRemembered(rowFixture());
      const { h, house } = await afterCommittedLeave(db, {
        readRow: async (accountId) => {
          if (accountId !== ACCOUNT_ID) {
            await new Promise<void>((resolve) => others.push(resolve));
            return { kind: 'row', row: rowFixture({ accountId, plotId: `plot:row${accountId}` }) };
          }
          if (throwNext) {
            throwNext = false;
            throw new Error('connection reset');
          }
          if (gate) {
            const open = gate;
            gate = null;
            await open.promise;
          }
          return await db.readRow(accountId);
        },
        writeRow: db.writeRow,
      });
      let atJoin: LoadedFreehold;
      if (kind === 'no_permit') {
        h.refuseNextPermits(1);
        atJoin = await h.joinAfterReask();
      } else if (kind === 'read_threw') {
        throwNext = true;
        atJoin = await h.joinAfterReask();
      } else if (kind === 'cap_full') {
        for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_LOADS; i++) {
          void h.store.preload(OTHER_ACCOUNT_ID + i);
        }
        await tick(10);
        atJoin = await h.joinAfterReask();
        while (others.length > 0) others.shift()?.();
      } else {
        gate = deferred<void>();
        const open = gate;
        // The first ask answered at once, so the re-ask runs on the whole budget
        // and it is the RE-ASK's own budget that runs out.
        const reasking = h.store.preload(ACCOUNT_ID, {
          budgetMs: freeholdReaskBudgetMs(0),
          reask: true,
        });
        await tick(10);
        expireBudgets(h);
        atJoin = await reasking;
        h.join(atJoin);
        open.resolve();
      }
      expect(atJoin.hold?.kind).toBe(kind);
      // A HELD verdict, never the withheld one: only a join nothing can vouch
      // for warns that line.
      expect(h.warnings.filter((line) => line.includes('join answer withheld'))).toEqual([]);
      expect(h.store.stats().joinVerdicts.held).toBe(1);
      await tick(40);
      expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
      h.edit(OWNER_KEY, { rev: 9 });
      h.store.saveAllDirty();
      await tick(40);
      expect(h.writeCount()).toBe(1);
      expect(await rowOf(db)).toEqual([house, '8']);
      if (kind === 'cap_full') {
        // The cap was still full when the join's retain re-read, so that read
        // was refused too: the entry stays unloaded and write-blocked, counted
        // by kind rather than refused at the seal.
        expect(h.store.stats().held).toBe(1);
        expect(h.store.stats().loadFailuresByKind.cap_full).toBe(2);
        expect(refusals(h)).toEqual([]);
      } else {
        expect(h.store.stats().quiesced).toBe(1);
        expect(refusals(h)).toEqual([expect.stringContaining('write refused (identity)')]);
      }
    });
  }

  it('a durable re-ask refused on capacity for an account with NO row yet is held as unnamed_record: loud, and no row', async () => {
    // The rowless shape of the case above: the repair re-read meets the
    // stand-in on the absent arm and takes the terminal `unnamed_record` hold
    // (a data line and the held gauge), never a seal line and never a row.
    const db = rowRemembered();
    const h = harness({ ...db });
    await h.store.preload(ACCOUNT_ID);
    for (let pass = 0; pass < FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES; pass++) {
      h.store.saveAllDirty();
    }
    await tick(10);
    expect(h.store.stats().entries).toBe(0);
    h.refuseNextPermits(1);
    const atJoin = await h.joinAfterReask();
    expect(atJoin.hold?.kind).toBe('no_permit');
    await tick(40);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.store.stats().loadFailuresByKind.unnamed_record).toBe(1);
    expect(h.warnings.filter((line) => line.includes('held (unnamed_record)'))).toHaveLength(1);
    h.edit(OWNER_KEY, { rev: 1 });
    h.store.saveAllDirty();
    await tick(40);
    expect(h.writeCount()).toBe(0);
    expect(refusals(h)).toEqual([]);
    expect((await db.readRow(ACCOUNT_ID)).kind).toBe('absent');
  });

  it('the sibling that outruns the durable re-ask: a record evicted during the read leaves the entry, and the join installs it', async () => {
    // The re-ask starts BESIDE a live record whose entry is not loaded (a
    // sibling seated on the stand-in by a refused login), so preload's
    // already-live arm reads and answers MARKED. The sibling finishes leaving
    // while that read is out. A liveness re-check at the join cannot tell that
    // mark is stale; the install-time answer can, because the read loaded the
    // entry.
    let gate: Deferred<void> | null = null;
    const db = rowRemembered(rowFixture());
    const h = harness({
      readRow: async (accountId) => {
        if (gate) {
          const open = gate;
          gate = null;
          await open.promise;
        }
        return await db.readRow(accountId);
      },
      writeRow: db.writeRow,
    });
    // The sibling: both its asks and its retain's reload are refused, so it
    // plays on the stand-in with an unloaded entry. Y's first ask, beside it, is
    // refused too, so the entry stays unloaded.
    h.refuseNextPermits(4);
    await h.store.preload(ACCOUNT_ID);
    await h.joinAfterReask();
    await tick(30);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.store.stats().loaded).toBe(0);
    expect((await h.store.preload(ACCOUNT_ID)).hold?.kind).toBe('no_permit');
    // The sibling's leave: blocked, its flush writes nothing and collects the
    // entry, and its removePlayer has not run.
    await flushFreeholdBinding(h.store, OWNER_KEY);
    expect(h.store.stats().entries).toBe(0);
    // Y's re-ask reads beside the still-live stand-in; the read is held open
    // while the sibling is evicted.
    gate = deferred<void>();
    const open = gate;
    const reasking = h.store.preload(ACCOUNT_ID);
    await tick(10);
    h.removePlayer();
    expect(h.record()).toBeUndefined();
    open.resolve();
    const atJoin = await reasking;
    expect(atJoin.recordWithheld).toBe(true);
    h.join(atJoin);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    expect(h.record()?.rev).toBe(5);
    h.edit(OWNER_KEY, { rev: 6 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].layoutJson).toBe(JSON.stringify(rowFixture().layout));
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('a sibling that asks during the durable re-ask shares its one read', async () => {
    let gate: Deferred<void> | null = null;
    const db = rowRemembered(rowFixture());
    const { h, house } = await afterCommittedLeave(db, {
      readRow: async (accountId) => {
        if (gate) {
          const open = gate;
          gate = null;
          await open.promise;
        }
        return await db.readRow(accountId);
      },
      writeRow: db.writeRow,
    });
    gate = deferred<void>();
    const open = gate;
    const readsBefore = h.calls.filter((call) => call === 'readRow').length;
    const yReask = h.store.preload(ACCOUNT_ID);
    const siblingFirstAsk = h.store.preload(ACCOUNT_ID);
    await tick(10);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(readsBefore + 1);
    open.resolve();
    h.join(await yReask);
    await siblingFirstAsk;
    await h.joinAfterReask();
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(readsBefore + 1);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    expect(h.record()?.rev).toBe(8);
    expect(h.writeCount()).toBe(1);
    expect(await rowOf(db)).toEqual([house, '8']);
  });

  it('a leaver evicted between the re-ask and the install, still owing its write, has its capture installed', async () => {
    // The one await the re-ask itself is. In production it is a single
    // microtask hop to the join, which the store does not rely on: the join
    // decides from the entry at install time. Here the other session's whole
    // leave lands inside it.
    let hold = false;
    const permit = deferred<{ release(): void } | null>();
    const db = rowRemembered(rowFixture());
    const h = harness({
      ...db,
      acquirePermit: async () => (hold ? await permit.promise : { release: () => {} }),
    });
    await h.login();
    h.edit(OWNER_KEY, { ...furnishedEdit(8), layout: HOUSE_LAYOUT });
    await h.store.preload(ACCOUNT_ID);
    const atJoin = await h.store.preload(ACCOUNT_ID);
    expect(atJoin.recordWithheld).toBe(true);
    hold = true;
    await leaveWithinDeadline(h);
    expect(h.record()).toBeUndefined();
    h.join(atJoin);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    expect(h.record()?.rev).toBe(8);
    // The entry answered in place of the marked ask: SUPERSEDED, no withheld line.
    expect(h.warnings.filter((line) => line.includes('join answer withheld'))).toEqual([]);
    expect(h.store.stats().joinVerdicts.superseded).toBe(1);
    permit.resolve({ release: () => {} });
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].layoutJson).toBe(JSON.stringify(HOUSE_LAYOUT));
    expect(await rowOf(db)).toEqual([JSON.stringify(HOUSE_LAYOUT), '8']);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('a leaver evicted between the re-ask and the install, its write committed and its entry collected, is WITHHELD: write-blocked, never a loss', async () => {
    const db = rowRemembered(rowFixture());
    const h = harness({ ...db });
    await h.login();
    h.edit(OWNER_KEY, { ...furnishedEdit(8), layout: HOUSE_LAYOUT });
    await h.store.preload(ACCOUNT_ID);
    const atJoin = await h.store.preload(ACCOUNT_ID);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    h.join(atJoin);
    // Nothing vouches for the answer, so nothing went in: the stand-in.
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    const withheld = h.warnings.filter((line) => line.includes('join answer withheld'));
    expect(withheld).toHaveLength(1);
    // The line carries the plot index only, never the account.
    expect(withheld[0]).not.toContain(String(ACCOUNT_ID));
    await tick(30);
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
    expect(refusals(h)).toEqual([expect.stringContaining('write refused (identity)')]);
    expect(await rowOf(db)).toEqual([JSON.stringify(HOUSE_LAYOUT), '8']);
  });

  it('WITHHOLDS without the write-blocked line when a live record it shares still stands', async () => {
    // The entry is collected between a leaver's flush and its removePlayer, and
    // the join lands in that window on a marked answer: nothing vouches for the
    // answer, but the live record stands (the install is load-once) and the
    // join shares it, so retain's reload makes the session writable. Warning
    // "write-blocked" there would be false (the fresh read of ruling (b), N7).
    const db = rowRemembered(rowFixture());
    const h = harness({ ...db });
    await h.login();
    h.edit(OWNER_KEY, { ...furnishedEdit(8), layout: HOUSE_LAYOUT });
    const atJoin = await h.store.preload(ACCOUNT_ID, { reask: true });
    expect(atJoin.recordWithheld).toBe(true);
    await flushFreeholdBinding(h.store, OWNER_KEY);
    expect(h.store.stats().entries).toBe(0);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    h.join(atJoin);
    expect(h.store.stats().joinVerdicts.withheld).toBe(1);
    expect(h.warnings.filter((line) => line.includes('join answer withheld'))).toEqual([]);
    h.removePlayer();
    await tick(30);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writes.at(-1)?.wireRev).toBe(9);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it("WITHHOLDS the twelfth path's own shape: an UNMARKED stale ABSENT answer whose entry went away", async () => {
    // The case above hands the join a MARKED answer, which the install refuses
    // whatever answerForInstall says. This one is the path itself: Y reads a
    // fresh account's absent answer with nothing live, and X's whole session
    // (join, furnish, leave, insert, eviction) lands in the one await before
    // Y's join. Installed as asked, that answer puts an EMPTY default in under
    // the minted name; withheld, nothing goes in and the stand-in is refused.
    const db = rowRemembered();
    const h = harness({ ...db });
    await h.store.preload(ACCOUNT_ID);
    const atJoin = await h.store.preload(ACCOUNT_ID, { reask: true });
    expect(atJoin.recordWithheld).toBe(false);
    expect(atJoin.durableRev).toBeNull();
    expect(atJoin.hold).toBeNull();
    // X: a whole session of the same account, committed and collected.
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { ...furnishedEdit(4), layout: HOUSE_LAYOUT });
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    expect(h.record()).toBeUndefined();
    expect(await rowOf(db)).toEqual([JSON.stringify(HOUSE_LAYOUT), '4']);
    h.join(atJoin);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.record()?.plotId).not.toBe(MINTED_PLOT_ID);
    expect(h.warnings.filter((line) => line.includes('join answer withheld'))).toHaveLength(1);
    expect(h.store.stats().joinVerdicts.withheld).toBe(1);
    await tick(30);
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(refusals(h)).toEqual([expect.stringContaining('write refused (identity)')]);
    expect(await rowOf(db)).toEqual([JSON.stringify(HOUSE_LAYOUT), '4']);
  });

  it('installs the loaded entry, its waiting capture included, for a join that carries NO answer', async () => {
    // Both handshake asks threw (a programming fault: preload never rejects),
    // so the join carries undefined. The loaded entry still answers, so the
    // capture a leaving session owes is installed rather than dropped at the
    // seal (the QA read of ruling (b), N3).
    let hold = false;
    const permit = deferred<{ release(): void } | null>();
    const db = rowRemembered(rowFixture());
    const h = harness({
      ...db,
      acquirePermit: async () => (hold ? await permit.promise : { release: () => {} }),
    });
    await h.login();
    h.edit(OWNER_KEY, { ...furnishedEdit(8), layout: HOUSE_LAYOUT });
    hold = true;
    await leaveWithinDeadline(h);
    expect(h.record()).toBeUndefined();
    expect(h.store.stats().leaveCaptures).toBe(1);
    h.join(undefined);
    expect(h.record()?.layout).toEqual(HOUSE_LAYOUT);
    expect(h.store.stats().joinVerdicts.superseded).toBe(1);
    expect(h.store.stats().joinVerdicts.none).toBe(0);
    permit.resolve({ release: () => {} });
    await tick(40);
    expect(await rowOf(db)).toEqual([JSON.stringify(HOUSE_LAYOUT), '8']);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('still lets the next character write when the old record is still live at its join', async () => {
    // The contrast, so the fix is not a stopped writer: the ordinary two-character
    // overlap, where the record the answer was read beside is still the one in
    // the world when the join lands.
    const h = harness({ ...rowRemembered() });
    await h.login();
    h.edit(OWNER_KEY, furnishedEdit(3));
    await h.joinAfterReask();
    await h.leave();
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    h.edit(OWNER_KEY, { rev: 4 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].wireRev).toBe(4);
    expect(h.store.stats().quiesced).toBe(0);
  });
});

describe('ONE housing budget per handshake, and what the re-ask costs', () => {
  // The hot-path and database reviews of ruling (b) found each ask arming the
  // whole FREEHOLD_PERSIST_LOGIN_BUDGET_MS: up to twice it per login, the second
  // half inside the lease-held window. The handshake now hands the re-ask what
  // the first ask left (tests/server/ws_auth.test.ts pins that arithmetic at
  // the caller); these pin what the store does with it, and the counters and
  // lines an operator reads the re-ask by.
  const realDeadline = (callback: () => void, ms: number): (() => void) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  };

  it('arms the budget a preload is given, never more than the whole budget', async () => {
    const h = harness({ ...rowRemembered(rowFixture()) });
    await h.store.preload(ACCOUNT_ID, { budgetMs: 3_000 });
    await h.store.preload(ACCOUNT_ID, { budgetMs: 50_000 });
    await h.store.preload(ACCOUNT_ID);
    await h.store.preload(ACCOUNT_ID, { budgetMs: -5 });
    expect(h.deadlines.map((job) => job.ms)).toEqual([
      3_000,
      FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
      FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
      0,
    ]);
  });

  it('a zero-budget re-ask still replays a loaded entry: the replay beats the timer', async () => {
    const h = harness({ ...rowRemembered(rowFixture()), scheduleDeadline: realDeadline });
    await h.login();
    const reask = await h.store.preload(ACCOUNT_ID, { budgetMs: 0, reask: true });
    expect(reask.hold).toBeNull();
    expect(reask.plotId).toBe(ROW_PLOT_ID);
  });

  it('a zero-budget re-ask that would wait on a read answers no_budget at once, naming its budget', async () => {
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise, scheduleDeadline: realDeadline });
    const reask = await h.store.preload(ACCOUNT_ID, { budgetMs: 0, reask: true });
    expect(reask.hold?.kind).toBe('no_budget');
    expect(reask.hold?.detail).toContain('within 0 ms');
    // The read it gave up waiting for still fills the entry.
    gate.resolve({ kind: 'row', row: rowFixture() });
    await tick(20);
    expect(h.store.stats().loaded).toBe(1);
  });

  it('counts re-asks, the ones that waited on a read, their time, and each join verdict', async () => {
    let onRead: () => void = () => {};
    const db = rowRemembered(rowFixture());
    const h = harness({
      readRow: async (accountId) => {
        onRead();
        return await db.readRow(accountId);
      },
      writeRow: db.writeRow,
    });
    // A healthy login: the re-ask replays, no read, the entry verdict.
    await h.login();
    expect(h.store.stats()).toMatchObject({ reasks: 1, reaskReads: 0, reaskMsTotal: 0 });
    expect(h.store.stats().joinVerdicts).toEqual({
      none: 0,
      refused: 0,
      entry: 1,
      superseded: 0,
      held: 0,
      withheld: 0,
    });
    // The committed order: the entry is collected, so the re-ask reads, and
    // the read takes 40 ms on this harness's clock.
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    let now = 50_000;
    h.setNow(now);
    onRead = () => {
      now += 40;
      h.setNow(now);
    };
    await h.joinAfterReask();
    expect(h.store.stats()).toMatchObject({ reasks: 2, reaskReads: 1, reaskMsTotal: 40 });
    // A first ask is never counted as a re-ask.
    await h.store.preload(ACCOUNT_ID);
    expect(h.store.stats().reasks).toBe(2);
  });

  it('books ENTRY for a join that changes nothing: a second character, and a DATA-held login', async () => {
    // `join_superseded` is the fix changing an install, so neither healthy shape
    // may book it. A second character of the account joins beside the live
    // record: its re-ask is the already-live arm's MARKED answer, and the
    // install shares the record (load-once).
    const h = harness({ ...rowRemembered(rowFixture()) });
    await h.login();
    const second = await h.joinAfterReask();
    expect(second.recordWithheld).toBe(true);
    expect(h.store.stats().joinVerdicts).toMatchObject({ entry: 2, superseded: 0 });
    // A row held on a DATA kind: both asks replay the one terminal hold.
    const held = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      normalized: { kind: 'malformed', detail: 'layout_not_an_array' },
    });
    await held.login();
    expect(held.store.stats().joinVerdicts).toMatchObject({ entry: 1, superseded: 0, held: 0 });
  });

  it('never counts a cap-refused re-ask beside a live record as a re-ask read', async () => {
    // The already-live arm's own exclusion: a record stands (the stand-in a
    // cap-refused login seated) over an entry that never loaded, so the re-ask
    // goes to the durable path and meets the full cap, waiting on nothing.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_LOADS; i++) {
      void h.store.preload(OTHER_ACCOUNT_ID + i);
    }
    await tick(10);
    const atJoin = await h.login();
    expect(atJoin.hold?.kind).toBe('cap_full');
    expect(h.record()).toBeDefined();
    const reask = await h.store.preload(ACCOUNT_ID, { reask: true });
    expect(reask.hold?.kind).toBe('cap_full');
    expect(reask.recordWithheld).toBe(true);
    expect(h.store.stats()).toMatchObject({ reasks: 2, reaskReads: 0 });
    gate.resolve({ kind: 'absent' });
    await tick(20);
  });

  it('never rate-limits a DATA hold line, which is a per-row incident', async () => {
    // The call site's `capacity` argument, not the limiter: two malformed rows
    // inside one window print two lines.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      normalized: { kind: 'malformed', detail: 'layout_not_an_array' },
    });
    h.setNow(100_000);
    expect((await h.store.preload(ACCOUNT_ID)).hold?.kind).toBe('malformed');
    expect((await h.store.preload(OTHER_ACCOUNT_ID)).hold?.kind).toBe('malformed');
    expect(h.warnings.filter((line) => line.includes('held (malformed)'))).toHaveLength(2);
  });

  it('prints one capacity line per kind per window, and still counts every refusal', async () => {
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_LOADS; i++) {
      void h.store.preload(OTHER_ACCOUNT_ID + i);
    }
    await tick(10);
    h.setNow(100_000);
    expect((await h.store.preload(ACCOUNT_ID)).hold?.kind).toBe('cap_full');
    expect((await h.store.preload(ACCOUNT_ID, { reask: true })).hold?.kind).toBe('cap_full');
    const lines = () => h.warnings.filter((line) => line.includes('held (cap_full)'));
    expect(lines()).toHaveLength(1);
    expect(h.store.stats().loadFailuresByKind.cap_full).toBe(2);
    // The re-ask was refused on the cap and waited on nothing: not a re-ask read.
    expect(h.store.stats()).toMatchObject({ reasks: 1, reaskReads: 0 });
    // A window later the next line prints, and says what it held back.
    h.setNow(100_000 + 10_000);
    expect((await h.store.preload(ACCOUNT_ID)).hold?.kind).toBe('cap_full');
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toContain('(1 more cap_full held back since the last line)');
    expect(h.store.stats().loadFailuresByKind.cap_full).toBe(3);
    gate.resolve({ kind: 'absent' });
    await tick(20);
  });
});

describe('a leaving session may borrow the write reserve', () => {
  it('starts a leaver immediately at the ordinary cap, rather than queueing it', async () => {
    // The leave write is the LAST chance for those edits; every background
    // write it would otherwise queue behind has a next sweep to catch it.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES; i++) {
      const key = `account:${OTHER_ACCOUNT_ID + i}`;
      await h.login(OTHER_ACCOUNT_ID + i);
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(20);
    expect(h.store.stats().running).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);

    await h.login();
    h.store.markDirty(OWNER_KEY);
    void h.store.flushAndRelease(OWNER_KEY);
    await tick(20);
    // Running, not deferred, even though the ordinary cap is full.
    expect(h.store.stats().running).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 1);
    expect(h.store.stats().deferredWrites).toBe(0);
    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
  });

  it('actually waits for its write while the queue beside it is DEFERRED', async () => {
    // A deferred entry has no chain, and treating a null chain as "nothing to
    // wait for" returned a mass disconnect's every logout in milliseconds:
    // none of the deadline's budget was spent and every entry stayed resident.
    //
    // RETITLED from "when its write is DEFERRED", which it never was: the
    // background writes fill the ordinary cap and defer two, and this leaver
    // then LAUNCHES on the reserve and waits on its running write. The leaver
    // that is genuinely deferred is "a DEFERRED leaver waits, and the pump then
    // prefers it over the queue", further down.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    const saturated = FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE;
    for (let i = 0; i < saturated; i++) {
      const key = `account:${OTHER_ACCOUNT_ID + i}`;
      await h.login(OTHER_ACCOUNT_ID + i);
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(20);
    await h.login();
    h.store.markDirty(OWNER_KEY);

    let released = false;
    const leaving = h.store.flushAndRelease(OWNER_KEY).then(() => {
      released = true;
    });
    await tick(30);
    // Deferred, and still waiting: it has not written and has not given up.
    expect(h.store.stats().deferredWrites).toBeGreaterThan(0);
    expect(released).toBe(false);

    // A slot frees; the leaver's own write then runs and the wait ends.
    gates[0].resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
    await leaving;
    expect(released).toBe(true);
    expect(h.writes.some((w) => w.accountId === ACCOUNT_ID)).toBe(true);
  });

  it('counts an outstanding capture, so the retained memory is a series', async () => {
    // Each capture is a second full record on top of the entry's own, held
    // until the write lands. At the approved row ceiling a thousand dirty
    // logouts retain tens of megabytes, which should not need a heap dump.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => await gate.promise,
    });
    h.edit(OWNER_KEY, { rev: 6 });
    expect(h.store.stats().leaveCaptures).toBe(0);
    void h.leave();
    await tick(10);
    expect(h.store.stats().leaveCaptures).toBe(1);
    gate.resolve({ kind: 'updated', durableRev: '6' });
    await tick(40);
    // Released with the write, never held for the life of the entry.
    expect(h.store.stats().leaveCaptures).toBe(0);
  });

  it('counts ONE capture when a second leave lands over a surviving one', async () => {
    // The gauge is the only stated bound on this retention, and a bound that
    // cannot read zero is not one. A second leave over a surviving capture
    // holds ONE document and used to count TWO, so the series ratcheted upward
    // and never came back down. Two leaves, one write held open across both.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => await gate.promise,
    });
    // Two characters of the one account are in the world, sharing one record.
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { rev: 6 });
    void h.leave();
    await tick(10);
    expect(h.store.stats().leaveCaptures).toBe(1);

    // The same owner edits and leaves again while the first write is still on
    // the gate.
    h.edit(OWNER_KEY, { rev: 7 });
    void h.leave();
    await tick(10);
    // ONE document is retained, so the gauge reads one. Counting the two
    // captures rather than the one retained document is what made it ratchet.
    expect(h.store.stats().leaveCaptures).toBe(1);

    gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    // And it returns to zero, which is the property the ratchet destroyed.
    expect(h.store.stats().leaveCaptures).toBe(0);
  });

  it("re-captures on a second leave, so the LAST session's edits are the ones written", async () => {
    // The sibling of the gauge case above, and the half it cannot see. The
    // gauge reads one either way; what separates them is WHICH document is
    // retained. A second leave that kept the stale capture instead of taking a
    // fresh one discards the second session's edits silently, and only shows up
    // when the record is already evicted by the time the write runs, which is
    // exactly what the capture exists for.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => await gate.promise,
    });
    // Two characters of the one account are in the world, sharing one record.
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { rev: 6 });
    const first = h.leave();
    await tick(10);
    expect(h.store.stats().leaveCaptures).toBe(1);

    // The same owner edits again and leaves again, still behind the held write.
    h.edit(OWNER_KEY, { rev: 7 });
    const second = h.leave();
    await tick(10);
    // Both leaves stop WAITING at their deadlines, so both removePlayers run and
    // the last one evicts: the record is gone by the time the write carrying the
    // second session's edits runs, and the capture is the only document there is.
    for (const job of h.deadlines) {
      if (job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS && !job.cancelled && !job.fired) job.fire();
    }
    await first;
    await second;
    expect(h.record()).toBeUndefined();
    gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    h.store.saveAllDirty();
    await tick(60);

    // THE SECOND session's revision, not the first's: that is the assertion the
    // gauge case cannot make.
    expect(h.writes.at(-1)?.wireRev).toBe(7);
  });

  it('takes no capture at all for a HELD entry, so a hold retains nothing', async () => {
    // A held entry flushes nothing, and "nothing" has to include the eager
    // clone: taking a capture it can never write would retain a second full
    // record per held logout, on exactly the accounts already in recovery.
    const h = await loadedStore({
      rowLoad: {
        kind: 'oversize',
        plotIndex: 0,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        bytes: 200_000,
        limit: FREEHOLD_MAX_STORED_BYTES,
        detoastRefused: false,
        diskBytes: 8_000,
      },
    });
    expect(h.store.stats().held).toBe(1);
    // DIRTY as well as held, which is the state that separates the two arms:
    // markDirty has no hold test of its own, so a held entry can carry a dirty
    // generation, and it is only there that dropping the `!blocked` guard
    // changes anything.
    h.store.markDirty(OWNER_KEY);
    expect(h.store.stats().dirty).toBe(1);
    h.calls.length = 0;
    await h.store.flushAndRelease(OWNER_KEY);
    expect(h.store.stats().leaveCaptures).toBe(0);
    // The absence of the clone IS the assertion: no serialize, and no write.
    expect(h.calls).not.toContain('serialize');
    expect(h.calls).not.toContain('writeRow');
  });

  it('never even enqueues a write for a held entry', async () => {
    // The FIRST of the three layers of the same gate, pinned on its own. arm()
    // refuses before the keyed FIFO, so a held owner costs no queue slot and no
    // background permit. Without this the write would be enqueued and refused a
    // layer later, which is the same row outcome and a different cost.
    const h = await loadedStore({
      rowLoad: {
        kind: 'unadmitted',
        plotIndex: 3,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        detail: 'plot_index 3 is outside the admitted slot 0',
      },
    });
    expect(h.store.stats().held).toBe(1);
    h.calls.length = 0;
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.calls).not.toContain('enqueue');
    expect(h.calls).not.toContain('permit');
    expect(h.writeCount()).toBe(0);
  });
});

describe('a leaving session never loses its last edits to a queue', () => {
  // The write's precondition is that the sim record still exists: past
  // removePlayer, serialize answers null and the write is a no-op. The leave
  // path is the ONLY window where that holds, so a write that is deferred by
  // the local cap, or whose flush deadline expires, would run after eviction
  // and write nothing at all. The document is captured before the wait.

  it('writes the captured document when the deadline expires before the write runs', async () => {
    // THE WRITE WAITS ON ITS PERMIT past the leave's deadline, so it samples
    // only after removePlayer has evicted and the capture is the only document
    // it can carry. The earlier form held the STATEMENT instead, by which point
    // the write had already sampled the live record, and a store that took no
    // capture at all passed it.
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, { rev: 6 });
    const leaving = h.store.flushAndRelease(OWNER_KEY);
    await tick(2);
    const deadline = h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
    deadline?.fire();
    await leaving;
    // The server evicts the record the instant leave returns.
    h.removePlayer();
    expect(h.record()).toBeUndefined();
    expect(h.writeCount()).toBe(0);
    permit.resolve({ release: () => {} });
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().writesWithoutRecord).toBe(0);
  });

  it('drops the capture once the write it was taken for has settled', async () => {
    // A capture that outlived its write is a document held for the life of the
    // entry, and one that could be re-sent for a LATER session whose record
    // happens to be gone at the moment its write runs. The live record always
    // wins, so nothing stale can shadow an edit, but the capture must still not
    // survive its own write.
    //
    // A SECOND CHARACTER OF THE ACCOUNT STAYS IN THE WORLD, which is what makes
    // this decisive: the entry keeps a reference, so it is never deleted and
    // the delete sites' own release cannot stand in for settle's. Only settle
    // can bring the gauge back to zero here. (The earlier form evicted the
    // record while that second reference was still held, which no realm can do:
    // a session in the world keeps its record live.)
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '6' }),
    });
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { rev: 6 });
    await h.leave();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().entries).toBe(1);
    expect(h.record()).toBeDefined();
    // Released by SETTLE, with the entry still resident.
    expect(h.store.stats().leaveCaptures).toBe(0);
  });

  it('hands an outstanding capture to a REJOIN, rather than replaying a staler state', async () => {
    // The leaver's unwritten edits live only in the capture. `entry.state`
    // advances at COMMIT, so replaying it would show the returning player a
    // house missing everything they did before logging out, and the next sweep
    // would then write that older record over the capture.
    //
    // A revision comparison in the write path was tried for this and was wrong:
    // `rev` restarts from the last committed value on a replay, so the two
    // counters are on different timelines and preferring the capture there lost
    // the REJOINING session's edits instead. Handing it over at the join is
    // what makes both survive.
    let granted = 0;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      // The load takes its permit; the leave write is refused one, which is
      // what leaves the capture outstanding.
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : null;
      },
    });
    h.edit(OWNER_KEY, { rev: 6, condition: 42 });
    await h.leave();
    await tick(20);
    // The write was refused a permit, so the capture is still outstanding, and
    // the record is gone with the last session.
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(1);
    expect(h.record()).toBeUndefined();

    const rejoin = await h.store.preload(ACCOUNT_ID);
    expect(rejoin.state?.rev).toBe(6);
    expect(rejoin.state?.condition).toBe(42);
    // OFFERED, not yet released. The handshake that read it can still die
    // before it ever creates a live record, and five exits sit between this
    // call and the join, so the capture stays until something confirms.
    expect(h.store.stats().leaveCaptures).toBe(1);
  });

  it("serves a fresh account's write from its capture once the record is gone", async () => {
    // RETITLED to what it proves. It was named for the entry-identity arm and
    // never reached it: neither of the two mutants it cited (the entry
    // remembering the row's name, either way round) failed it. The reason was
    // an impossible harness state, now fixed above, and with the state made
    // reachable the second half of the case runs straight into the carried
    // fresh-account quiesce instead, which has its own case below.
    //
    // What is left is worth keeping on its own: a brand-new account's write
    // lands from the CAPTURE after removePlayer has evicted the record, which
    // is the whole reason the capture is taken before the wait. The record is
    // the one the join installed, carrying the MINTED name, and the session
    // furnished it before leaving.
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const h = await loadedStore({
      ...rowRemembered(),
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
    });
    h.edit(OWNER_KEY, furnishedEdit(6));
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    // The leave's flush captures and arms, then stops WAITING at its deadline,
    // and removePlayer evicts before the permit ever lands.
    const leaving = h.leave();
    await tick(10);
    const deadline = h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
    deadline?.fire();
    await leaving;
    expect(h.record()).toBeUndefined();
    permit.resolve({ release: () => {} });
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);

    // The write carried the CAPTURE, not a null serialize: the record was gone
    // before the permit landed, so without it this write would have reached the
    // statement with nothing to send.
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().writesWithoutRecord).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('still refuses a record seeded after the captured write has landed', async () => {
    // The mirror, and the hazard the seal exists for: the record that exists at
    // the next write is a FRESH SEED of a row that already holds a house, so
    // writing it would put an empty Inn Room over real furnishings.
    //
    // IN PRODUCTION ORDER, and under ruling (b) there is ONE: the returning
    // session's handshake asks while the leaver is still in the world; the leave
    // captures, stops waiting at its deadline, and removePlayer evicts; the
    // captured write lands and the clean entry is collected; and the returning
    // session's re-ask, now a durable read, is REFUSED A PERMIT, so the join
    // installs nothing and the stand-in is seeded. (A re-ask that reads installs
    // the house the capture wrote: the committed-order pins in the ruling (b)
    // block.)
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const db = rowRemembered(rowFixture());
    const h = await loadedStore({
      ...db,
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
    });
    h.edit(OWNER_KEY, { rev: 6 });
    await h.store.preload(ACCOUNT_ID);
    const leaving = h.leave();
    await tick(10);
    h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS)?.fire();
    await leaving;
    expect(h.record()).toBeUndefined();
    permit.resolve({ release: () => {} });
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().entries).toBe(0);

    h.refuseNextPermits(1);
    expect((await h.joinAfterReask()).hold?.kind).toBe('no_permit');
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    // retain re-reads the unloaded entry; the sweep must run after that read.
    await tick(30);
    h.store.saveAllDirty();
    await tick(30);
    // The absence of a second write IS the assertion: the row keeps the house.
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().dirty).toBe(1);
    const row = await db.readRow(ACCOUNT_ID);
    expect(row.kind === 'row' ? row.row.wireRev : row.kind).toBe('6');
  });

  it('installs the capture for a rejoin that lands WHILE the captured write waits, so the write carries it', async () => {
    // The order the old title named: the returning session joins BEFORE the
    // captured write gets its permit, so when the write samples, a live record
    // exists again and it outranks the capture. Before ruling (b) that record
    // was the stand-in, the seal refused it, and settle released the capture
    // with the leaver's revision-six edits unwritten, the cost this case pinned.
    // Now the re-ask replays the entry that still owes the write, the join
    // installs the capture, retain releases it because the record carries it,
    // and the write samples the record, which is the capture.
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const db = rowRemembered(rowFixture());
    const h = await loadedStore({
      ...db,
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
    });
    h.edit(OWNER_KEY, { rev: 6 });
    await h.store.preload(ACCOUNT_ID);
    const leaving = h.leave();
    await tick(10);
    h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS)?.fire();
    await leaving;
    expect(h.store.stats().leaveCaptures).toBe(1);
    await h.joinAfterReask();
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    expect(h.record()?.rev).toBe(6);
    expect(h.store.stats().leaveCaptures).toBe(0);
    permit.resolve({ release: () => {} });
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
    const row = await db.readRow(ACCOUNT_ID);
    expect(row.kind === 'row' ? row.row.wireRev : row.kind).toBe('6');
  });

  it('refuses a reseeded default over a FRESH account that has since furnished', async () => {
    // WHICH ARM REFUSES HERE HAS CHANGED, and the case is renamed rather than
    // left claiming the old one. It used to model the blind window where a fresh
    // account's record and a freshly seeded default shared the stand-in name, so
    // only the pristine arm could separate them. `installLoadedFreehold` names
    // the minted record now, so the entry's cached identity is the minted id and
    // the reseeded default's is the stand-in: the NAME comparison refuses first
    // and short-circuits the rest. What this case still proves at the store
    // level is the outcome, that a reseed over a furnished account is refused
    // and the owner quiesces. The pristine arm itself is driven with literals in
    // tests/server/freehold_write_seal.test.ts, which needs no store.
    const h = await loadedStore({ ...rowRemembered() });
    h.edit(OWNER_KEY, furnishedEdit(4));
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].layoutJson).toBe(JSON.stringify(persistedFixture().layout));

    // Evicted, then a rejoin seeds an empty default under the stand-in name.
    // The row already holds this account's furnishings.
    await h.rejoinOverEviction();
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    h.store.saveAllDirty();
    await tick(30);
    // The absence of a second write IS the assertion.
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
  });

  it('refuses a reseeded default over an account that differs ONLY by revision', async () => {
    // The revision half of "knows more" used to be what this isolated. It is not
    // any more, for the reason the case above gives: the name comparison refuses
    // first for every entry class. Kept for the OUTCOME, that an account which
    // moved its record without placing anything (a tier grant bumps the revision
    // and touches no row) is still protected from a reseed. The dimension itself
    // is driven in tests/server/freehold_write_seal.test.ts.
    const h = await loadedStore({ ...rowRemembered() });
    h.edit(OWNER_KEY, { rev: 3 });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(3);
    expect(h.writes[0].layoutJson).toBe('[]');

    await h.rejoinOverEviction();
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
  });

  it('still writes an ESTABLISHED account that emptied its own house', async () => {
    // The other side of the pristine test, and the reason it requires the
    // stand-in name. A player who removes every furnishing leaves a record that
    // looks exactly like a seed except for its identity, and refusing that
    // would make "remove everything" the one edit that can never be saved.
    //
    // AT A HIGHER REVISION, which is the only shape a real emptying has. The
    // fixture used to sit at revision ZERO to look as much like a seed as
    // possible, which modelled a state no sanctioned writer can produce: every
    // mutator increments, so removing twelve furnishings from a record at five
    // leaves it at six, not at zero. A revision BELOW the entry's last committed
    // one is now refused for every entry class, so the old fixture proved the
    // claim through a state the sim cannot reach.
    //
    // WHAT THIS KILLS, then, is a seal that treats ANY empty record as a seed,
    // dropping both the stand-in and the revision-zero conjuncts. Dropping the
    // stand-in conjunct ALONE stays green here, because this record's revision
    // already fails revision zero; that conjunct is pinned with literals in
    // tests/server/freehold_write_seal.test.ts.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, { layout: [], trophies: [], rev: 6 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].layoutJson).toBe('[]');
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('still writes a fresh account whose OWN record is legitimately still empty', async () => {
    // THE ANTI-VACUITY ARM, and what it controls has changed with the fixture.
    // It used to model a record identical to a pristine seed, which needed the
    // stand-in name; the record carries its INSTALLED name now, so `standInSeed`
    // is false and the pristine arm is never reached at all. What it still
    // controls, and the reason it is not deleted, is that neither the identity
    // arm nor the insert refusal fires on an account whose own empty record is
    // exactly what it committed: writing it loses nothing, and refusing would
    // quiesce a healthy owner for no gain. The record is the empty default the
    // join installed, at revision zero, under its minted name.
    const h = await loadedStore({
      rowLoad: { kind: 'absent' },
      writeRow: async (input) => ({
        kind: input.expectedDurableRev === null ? 'inserted' : 'updated',
        durableRev: '1',
      }),
    });
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    expect(h.record()?.rev).toBe(0);
    expect(h.record()?.layout).toEqual([]);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);

    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('does NOT refuse a rejoin replay at the revision the entry committed', async () => {
    // THE COMPANION PROOF the identity fix owes, and the direction that made a
    // revision comparison wrong once before. W1 established that a rejoin replay
    // RESTARTS the record's revision from the last COMMITTED value, so the
    // discriminator has to be strictly-below rather than not-above: an entry
    // that committed seven and is handed a record back at seven is looking at
    // its own document, not at a different record.
    //
    // THE REPLAY ITSELF, in production order: the owner leaves with the house
    // at seven committed, the clean entry is collected and removePlayer evicts,
    // and the rejoin's handshake reads the row back into a NEW entry, so the
    // join installs a record AT seven and the entry facing it knows seven
    // because the row does (it committed nothing itself). That is the restart W1
    // describes, reached through the read a rejoin after a clean leave makes.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => ({ kind: 'updated', durableRev: '9' }),
    });
    await h.leave();
    expect(h.record()).toBeUndefined();
    expect(h.store.stats().entries).toBe(0);
    const replay = await h.store.preload(ACCOUNT_ID);
    h.join(replay);
    expect(h.record()?.rev).toBe(7);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    // Same revision, so the probe sees no movement and only an explicit mark
    // arms it. It must be WRITTEN, not refused.
    h.store.markDirty(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(7);
    expect(h.store.stats().quiesced).toBe(0);

    // And the ordinary case after it: the returning player edits, the revision
    // climbs, and the write lands.
    h.edit(OWNER_KEY, { rev: 8 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].wireRev).toBe(8);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('refuses a REGRESSED revision for a ROW-LOADED entry, which the stand-in gate used to hide', async () => {
    // THE UN-GATING, proved on the entry class it was dead for. The
    // discriminator used to be checked only under the stand-in identity, on the
    // reasoning that any other name is already refused by the comparison above.
    // After the install fix no online record carries the stand-in, so that gate
    // would have made this arm dead code on the one host it exists for. Its live
    // case is the same-account character swap: the record the store sees belongs
    // to the previous session, carries the SAME real plot name, and sits below
    // the revision this entry committed.
    //
    // BUILT the way one realm reaches it here: this realm commits the record at
    // six, another realm sharing the database writes the row forward to seven,
    // and this realm's entry re-reads it through preload's already-live arm
    // while the record stays (`rejoinBeforeRemoval`). The SAME real name
    // throughout, so the name comparison cannot be what refuses this and only
    // the revision can.
    const db = rowRemembered(rowFixture({ wireRev: '6' }));
    const h = await loadedStore({ readRow: db.readRow, writeRow: db.writeRow });
    h.store.markDirty(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].expectedDurableRev).toBe('7');

    db.advance({ wireRev: '7' });
    const reread = await h.rejoinBeforeRemoval();
    expect(reread.durableRev).toBe('9');
    expect(h.record()?.rev).toBe(6);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.store.stats().writeFailures).toBe(1);
  });

  // THE SEVENTH AND EIGHTH PATHS, and the boundary between them, merged into one
  // table 2026-09-27 (the three cases shared their whole body). A minted account
  // commits its house at revision seven; a rejoin whose re-ask is refused on
  // capacity after a CLEAN leave collected the minting entry
  // (`rejoinOverEviction`) reseeds the default with no install in front of it, so
  // the entry facing it is a RE-READ of the row the account minted (three loads)
  // and its cached name is that minted name. The reseed carries the stand-in, the
  // two names differ, and the seal's name comparison refuses it whatever the
  // reseed's revision: BELOW the committed one after a single touch (the seventh
  // path: before the install fix only the regressed revision separated it), CAUGHT
  // UP past it (the eighth path, once compare-and-swapped over the house), or
  // EQUAL (the old escape threshold was `>=`, not `>`; at equal revisions the probe
  // sees no movement, so the write is asked for explicitly). The regression
  // discriminator is pinned on its own in tests/server/freehold_write_seal.test.ts.
  it.each<{ name: string; edit: RecordEdit; rev: number; mark: boolean }>([
    {
      name: 'TOUCHED',
      edit: { tier: 'cottage' },
      rev: 1,
      mark: false,
    },
    {
      name: 'CAUGHT-UP',
      edit: { rev: 9 },
      rev: 9,
      mark: false,
    },
    {
      name: 'EQUAL-revision',
      edit: { rev: 7 },
      rev: 7,
      mark: true,
    },
  ])(
    'REFUSES a $name reseed over a MINTED account, through the name arm',
    async ({ edit, rev, mark }) => {
      const h = await loadedStore({ ...rowRemembered() });
      // The installed record carries the MINTED name, and the session builds a
      // house on it.
      expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
      h.edit(OWNER_KEY, { ...furnishedEdit(7), tier: 'cottage', condition: 91 });
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount()).toBe(1);
      expect(h.writes[0].wireRev).toBe(7);
      expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);
      expect(h.writes[0].layoutJson).toBe(JSON.stringify(persistedFixture().layout));
      await h.rejoinOverEviction();
      expect(h.store.stats().loads).toBe(3);
      h.edit(OWNER_KEY, edit);
      expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
      expect(h.record()?.rev).toBe(rev);
      expect(h.record()?.layout).toEqual([]);
      if (mark) h.store.markDirty(OWNER_KEY);
      h.store.saveAllDirty();
      await tick(30);
      // NO SECOND WRITE. The row keeps the house, and the owner is write-blocked
      // for the session with an error line rather than losing it silently.
      expect(h.writeCount()).toBe(1);
      expect(h.store.stats().quiesced).toBe(1);
      expect(h.errors[0]).toContain('identity');
    },
  );

  it('KEEPS WRITING a fresh account whose entry re-reads the row it wrote', async () => {
    // THE MIRROR OF THE EIGHTH PATH, and the other half this fix closes. It was
    // pinned AS IT BEHAVED, asserting a quiesce; this is the flip.
    //
    // Nothing used to teach a live record its minted name, so a first-session
    // record carried the stand-in for as long as it lived. If that account's
    // store entry was dropped and RE-READ from the row it had just inserted
    // (retain's lost-entry reload, or a second character joining), entry.state
    // came back carrying the ROW's name while the same live record still carried
    // the stand-in, the names differed, and the account was write-blocked for
    // the rest of its session with a misleading message.
    //
    // Round nine tried to close it by exempting the stand-in from the name
    // comparison, which REOPENED a data-loss path (a seeded default whose
    // revision climbs past the entry's own is then admitted over a real row) and
    // was reverted. The fix is at the source instead: the record is installed
    // carrying the minted identity, so the re-read entry and the live record
    // agree and there is nothing for the seal to refuse.
    const h = harness({ ...rowRemembered() });
    await h.login();
    h.edit(OWNER_KEY, furnishedEdit(4));
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);

    // The entry is dropped and RE-READ from the row it just inserted while the
    // record it installed stays live: a second character's handshake lands in
    // the first one's leave window and joins before its removal.
    await h.rejoinBeforeRemoval();
    expect(h.store.stats().loads).toBe(2);
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);

    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    // A SECOND WRITE LANDS, carrying the session's later edit, and nothing is
    // quiesced or logged. The row keeps the same identity throughout.
    expect(h.writeCount()).toBe(2);
    expect(h.writes[1].plotId).toBe(MINTED_PLOT_ID);
    expect(h.writes[1].wireRev).toBe(9);
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('refuses a seed over a ROW that carries content at revision zero', async () => {
    // WHAT THIS PINS, stated exactly, because the case it was first written for
    // is not the case it reaches. A durable row is UNTRUSTED EXTERNAL INPUT, so
    // a real tier at wire revision zero is a shape an older build or a second
    // writer can leave behind, and the seal must refuse a seed standing over it
    // even though the revision has not regressed and the seed is pristine.
    //
    // It is refused by the NAME comparison, not by the pristine arm: a
    // row-loaded entry caches the row's identity and the seed carries the
    // stand-in. Mutating the pristine arm away leaves this case green. That is
    // recorded rather than dressed up, and the arm's own comment says why it is
    // still kept.
    const h = await loadedStore({
      // A real tier, no layout, and revision zero: the revision dimension alone
      // sees nothing here, so the tier dimension has to carry it.
      rowLoad: {
        kind: 'row',
        row: rowFixture({ wireRev: '0', tier: 'manor', layout: [], trophies: [] }),
      },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    await h.rejoinOverEviction();
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.record()?.tier).toBe('inn_room');
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    // The absence of the write IS the assertion: the manor row survives.
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().quiesced).toBe(1);
  });

  it('refuses a seed whose revision has CLIMBED PAST the entry it stands over', async () => {
    // The shape a round-nine exemption admitted, and the reason that exemption
    // was reverted. A returning player who touches the seed enough times inside
    // one sweep interval carries its revision ABOVE the entry's last committed
    // one, at which point a continuity test alone sees nothing wrong: the
    // revision has not regressed, the record is not pristine, and the empty
    // tier-0 default lands on the house. `entry.state.rev + 1` edits is all it
    // takes, so this is two or three furnishings once that writer exists.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '2' }) },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    // The live record becomes a FRESH SEED that is then edited three times, so
    // its revision is above the entry's and its content is still empty.
    await h.rejoinOverEviction();
    h.edit(OWNER_KEY);
    h.edit(OWNER_KEY);
    h.edit(OWNER_KEY);
    expect(h.record()?.rev).toBe(3);
    expect(h.record()?.layout).toEqual([]);
    h.store.saveAllDirty();
    await tick(30);
    // The absence of the write IS the assertion: the row keeps the house.
    expect(h.writeCount()).toBe(0);
    expect(h.writes).toEqual([]);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors[0]).toContain('identity');
  });

  it('still writes a NAMED record whose revision only CLIMBS', async () => {
    // THE ANTI-VACUITY ARM for the regression test: the reason it compares
    // against the entry's own committed revision rather than refusing every
    // climb. A brand-new account edits its house all session under the name its
    // install gave the record, and every one of those writes must land. The
    // fixture carried the STAND-IN when it was written, which is the state the
    // install fix removed; it carries the installed name now, and the title says
    // so rather than describing a record no online host produces.
    const h = await loadedStore({
      rowLoad: { kind: 'absent' },
      writeRow: async (input) => ({
        kind: input.expectedDurableRev === null ? 'inserted' : 'updated',
        durableRev: String(input.wireRev),
      }),
    });
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    h.edit(OWNER_KEY, furnishedEdit(3));
    for (const next of [4, 5, 6]) {
      h.store.saveAllDirty();
      await tick(30);
      h.edit(OWNER_KEY, { rev: next });
    }
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(4);
    expect(h.writes.map((write) => write.wireRev)).toEqual([3, 4, 5, 6]);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('keeps the capture when the handshake that read it never joins', async () => {
    // preload runs BEFORE the character lease, and a lease already held, no
    // such character, a forced rename, a throwing character read and a refused
    // join all return without ever creating a record. `alreadyInWorld` is the
    // sharpest: a reconnect after a dropped socket is the very event that
    // produced the capture. Releasing at the read lost the edits outright.
    let granted = 0;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      // The load takes a permit, the LEAVE write is refused one (which is what
      // leaves the capture outstanding), and the sweep after it gets one.
      acquirePermit: async () => {
        granted += 1;
        return granted === 2 ? null : { release: () => {} };
      },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    h.edit(OWNER_KEY, { rev: 6 });
    // The whole leave: the capture is taken while the record is live, and
    // removePlayer evicts it the instant the flush returns.
    await h.leave();
    await tick(20);
    expect(h.record()).toBeUndefined();
    expect(h.writeCount()).toBe(0);
    // The null-permit arm counts a failure WITHOUT quiescing: the entry is still
    // dirty and unblocked, and so it keeps its document (absorbed 2026-09-27 from
    // "keeps the capture when a write FAILED without quiescing").
    expect(h.store.stats().writeFailures).toBe(1);
    expect(h.store.stats().dirty).toBe(1);
    expect(h.store.stats().leaveCaptures).toBe(1);

    // The handshake reads, then dies before the join.
    await h.store.preload(ACCOUNT_ID);
    expect(h.store.stats().leaveCaptures).toBe(1);

    // The next sweep still has the document, so the edits reach the row.
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
    expect(h.store.stats().writesWithoutRecord).toBe(0);
  });

  it('releases the capture only when the live record CARRIES it', async () => {
    // A bare "is anything live" test was not enough. installLoadedFreehold has
    // four early returns and loadFreehold is load-once on top of them, while
    // retain runs on every join and knows none of that. The reachable case is
    // the same-account character swap, where the record retain sees belongs to
    // the PREVIOUS session and removePlayer is explicitly allowed to evict it
    // afterwards. Comparing revisions fails closed instead.
    //
    // TWO JOINS, each in its own world, because each is a different moment and
    // no one sequence reaches both. In each the owner edits to revision six and
    // leaves, the leave write is refused a permit, and the capture is left
    // outstanding.
    //
    // A THIRD MOMENT IS GONE WITH RULING (B): a retain that meets NO record, or
    // the stand-in, while a capture is outstanding. A capture lives only on a
    // loaded, unblocked entry and the join now installs from any loaded entry,
    // so the join that follows a capture installs it. The world that built it
    // joined on an answer read before the eviction, with no re-ask. What it
    // killed (a retain that releases whatever is live, or always) the first
    // world below still kills.
    const capturedLeaver = async (): Promise<Harness> => {
      let granted = 0;
      const h = await loadedStore({
        rowLoad: { kind: 'row', row: rowFixture() },
        acquirePermit: async () => {
          granted += 1;
          return granted === 1 ? { release: () => {} } : null;
        },
      });
      h.edit(OWNER_KEY, { rev: 6 });
      return h;
    };

    // A RECORD THAT IS NOT THE OFFERED DOCUMENT: two characters are in the
    // world, one leaves, and the one that stayed edits on before a third joins.
    // The record the third retains against is the other sessions' own, at a
    // revision the capture does not carry.
    const sibling = await capturedLeaver();
    await sibling.joinAfterReask();
    await sibling.leave();
    expect(sibling.store.stats().leaveCaptures).toBe(1);
    sibling.edit(OWNER_KEY, { rev: 7 });
    await sibling.joinAfterReask();
    expect(sibling.store.stats().leaveCaptures).toBe(1);

    // ...and a record that genuinely carries those edits: the rejoin replays the
    // capture and the join installs it.
    const carried = await capturedLeaver();
    await carried.leave();
    await carried.store.preload(ACCOUNT_ID);
    const rejoin = await carried.store.preload(ACCOUNT_ID);
    expect(rejoin.state?.rev).toBe(6);
    expect(carried.store.stats().leaveCaptures).toBe(1);
    carried.join(rejoin);
    expect(carried.record()?.rev).toBe(6);
    expect(carried.store.stats().leaveCaptures).toBe(0);
  });

  it('writes the LIVE record, never a capture, whenever a record exists', async () => {
    // The mirror of the case above. While a record exists the live record is
    // the only authority; writing a capture over it would put the row out of
    // step with the house the player is standing in, and the next sweep would
    // undo it.
    //
    // RETITLED from "once a record exists again". A record that comes back after
    // an eviction arrives through a join, and that join installs the capture
    // (ruling (b): the join installs from the entry that holds it), so retain
    // releases it and nothing competes. The state in
    // which a live record and a capture meet at a write is a record that never
    // left: the linkdead swap, where the new character is in the world while
    // the old one leaves.
    let granted = 0;
    const permit = deferred<{ release(): void } | null>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : await permit.promise;
      },
      writeRow: async () => ({ kind: 'updated', durableRev: '9' }),
    });
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { rev: 6 });
    const leaving = h.leave();
    await tick(10);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(1);

    // The character that stayed edits on, so the live record is ahead of the
    // capture when the write finally samples.
    h.edit(OWNER_KEY, { rev: 15 });
    permit.resolve({ release: () => {} });
    await leaving;
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(15);
  });

  // A case titled "the gauge returns to zero, so the retention it bounds is
  // falsifiable" stood here and was DELETED at the persistence QA: its body
  // asserted one, then one again, and never zero. It was a strictly weaker copy
  // of "counts ONE capture when a second leave lands over a surviving one"
  // above, which drives the same two leaves over one held write and DOES assert
  // the return to zero, and of "releases a retained capture on the ordinary
  // flush, so the gauge reads zero" below. A case whose title names an
  // assertion it does not make is worse than no case.

  it('never lets a captured document shadow a later live edit', async () => {
    // A live record always wins. If the capture could outrank it, a remaining
    // session's edits would be silently replaced by the leaving session's.
    //
    // THE CAPTURE IS STILL OUTSTANDING when the later write samples, which the
    // earlier form of this case never arranged: its leave write landed and
    // settle released the capture before the second write existed, so a
    // capture-first read could not have been seen. Here the leave write is
    // REFUSED a permit, so the capture survives, dirty, beside a record that a
    // second character keeps in the world and then edits past it.
    let granted = 0;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => {
        granted += 1;
        return granted === 2 ? null : { release: () => {} };
      },
      writeRow: async () => ({ kind: 'updated', durableRev: '9' }),
    });
    await h.joinAfterReask();
    h.edit(OWNER_KEY, { rev: 6 });
    await h.leave();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(1);

    h.edit(OWNER_KEY, { rev: 7 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes.at(-1)?.wireRev).toBe(7);
    // And the capture goes with the write that superseded it.
    expect(h.store.stats().leaveCaptures).toBe(0);
  });
});

describe('the store refuses what it cannot represent, rather than repairing it', () => {
  it('holds a row whose wire revision has outgrown a JS number', async () => {
    // normalizeFreehold REPAIRS an out-of-range revision to zero and still
    // answers loaded, so without this the row would come back WRITABLE at
    // revision zero and the next save would write that zero over the larger
    // stored value: the client-facing counter would go backwards, permanently,
    // on a row nothing was wrong with.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '9007199254740993' }) },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('malformed');
    expect(loaded.hold?.detail).toBe('wire_rev_shape');
    expect(loaded.state).toBeNull();
    // Held, so no write can go out and the row keeps its revision, however the
    // join goes on to seed the record.
    h.join(loaded);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
  });

  it('loads the largest revision it CAN represent, so the refusal is a boundary', async () => {
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: String(Number.MAX_SAFE_INTEGER) }) },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold).toBeNull();
    // The EXACT revision, not merely a state: a boundary that loaded and then
    // repaired the revision to zero would pass a presence check, and the next
    // save would write that zero over the stored value.
    expect(loaded.state?.rev).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('never writes for an entry that was quiesced while its write sat in the queue', async () => {
    // WHAT THIS PINS, stated exactly, because it used to claim more. The arm it
    // actually reaches is `settle`'s re-arm gate: the pending write is never
    // launched once the running one quiesces the entry. It does NOT reach
    // `runWrite`'s post-queue `blocked()` re-check, which a mutation pass
    // proved: removing that re-check leaves this case green, because the write
    // it guards is never enqueued in the first place.
    //
    // That re-check is kept as the third layer of the same gate (arm refuses,
    // runWrite re-checks, flushAndRelease refuses), and removing ALL THREE does
    // fail this suite. No behaviour test can isolate the middle one, because
    // nothing outside a write result can block an entry and every re-arm path
    // is already gated. Said here rather than left for the next reader to
    // rediscover as a passing test that proves nothing.
    const gate = deferred<FreeholdUpsertResult>();
    let served = 0;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        served += 1;
        if (served === 1) return await gate.promise;
        return { kind: 'updated', durableRev: String(served) };
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(10);
    expect(h.writeCount()).toBe(1);

    // A second write is queued behind the first, and the entry is quiesced
    // while it waits.
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    gate.resolve({ kind: 'stale', durableRev: '99' });
    await tick(40);
    expect(h.store.stats().quiesced).toBe(1);
    // The absence of the second writeRow IS the assertion.
    expect(h.writeCount()).toBe(1);
  });
});

describe('a run of thrown writes is a RUN, bounded in time', () => {
  it('does not quiesce on blips spread further apart than the window', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    // Three throws, each one window apart plus a millisecond. Without the
    // window this is three strikes and a permanently quiesced owner; with it
    // each is a fresh event.
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_WRITE_ERRORS + 2; i++) {
      h.edit(OWNER_KEY);
      h.setNow(10_000 + i * (FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS + 1));
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.store.stats()).toMatchObject({ quiesced: 0, retrying: 0 });
    expect(h.store.stats().writeFailures).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS + 2);
  });

  it('still puts a run INSIDE the window on the retry clock, so the window is not an escape', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; i++) {
      h.edit(OWNER_KEY);
      h.setNow(10_000 + i * 1_000);
      h.store.saveAllDirty();
      await tick(30);
    }
    // R1: a run is a retry posture, never a quiesce (a throw is not an answer).
    expect(h.store.stats()).toMatchObject({ retrying: 1, quiesced: 0 });
  });

  it('reports a database error by its CLASSIFICATION, never its row content', async () => {
    // A PostgreSQL error is not a bounded value: a 23514 puts "Failing row
    // contains (...)" in `detail` and a 23505 puts the conflicting key there.
    // That is the one channel that would otherwise carry row content and an
    // account id straight into a console.
    const h = await loadedStore({
      writeRow: async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'account_freeholds_plot_id',
          detail: `Key (plot_id)=(${ROW_PLOT_ID}) already exists.`,
          table: 'account_freeholds',
        });
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    const logged = JSON.stringify(h.errors);
    expect(logged).toContain('23505');
    expect(logged).toContain('account_freeholds_plot_id');
    expect(logged).not.toContain(ROW_PLOT_ID);
    expect(logged).not.toContain('Failing row');
  });
});

describe('nothing removes an entry that still owes a durable write', () => {
  // BOTH removal paths, one predicate. They used to differ, and either
  // difference drops a save: maybeRemove checked the deferred set but not
  // dirtiness, and the orphan sweep checked dirtiness but not the deferred set.
  //
  // A DEFERRED, zero-reference entry is unreachable now that a leaving write
  // borrows the reserve and therefore always starts, so the deferred clause in
  // the shared predicate has no behaviour test and is kept for what it says
  // rather than for what today's arming rules imply. What IS reachable, and
  // what these cases drive, is an entry left dirty by a refused permit.

  it('keeps a DIRTY, unreferenced, NOT running entry across every sweep', async () => {
    // The dirty arm on its own. The older case had a dirty entry that was also
    // running, so `running` carried every assertion and dropping the dirty
    // clause changed nothing.
    // The LOAD gets its permit; every write after it is refused one, so the
    // entry is loaded and unblocked but its write never runs.
    let granted = 0;
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => {
        granted += 1;
        return granted === 1 ? { release: () => {} } : null;
      },
    });
    await h.login();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    // The permit was refused, so nothing is running and nothing was written,
    // but the entry still owes the write.
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().running).toBe(0);
    expect(h.store.stats().dirty).toBe(1);
    // The whole leave, so the six sweeps below run with the reference gone AND
    // the record gone, which is what six sweeps after a logout look like.
    await h.leave();
    expect(h.record()).toBeUndefined();
    for (let i = 0; i < 6; i++) h.store.saveAllDirty();
    await tick(20);
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().dirty).toBe(1);
  });

  it('keeps an entry whose durable READ is still in flight', async () => {
    // A load in flight will call ensureEntry again when it lands, so removing
    // the entry now only resurrects it at zero references, which is the same
    // "entry went missing under a live session" class that retain's reload
    // exists to repair. Both removal paths have to know that, which is why the
    // guard lives in the shared predicate rather than in one of them.
    //
    // A session holds that read open the way production does under ruling (b):
    // its handshake's re-ask was refused a permit after the owner's clean leave
    // collected the entry, so the join installed nothing and its retain
    // recreated the entry and re-read it, and the session leaves before that
    // read lands.
    let gate: Deferred<FreeholdRowLoad> | null = null;
    const h = harness({
      readRow: async () => (gate ? await gate.promise : { kind: 'row', row: rowFixture() }),
    });
    await h.login();
    await h.store.preload(ACCOUNT_ID);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
    gate = deferred<FreeholdRowLoad>();
    h.refuseNextPermits(1);
    await h.joinAfterReask();
    await tick(10);
    expect(h.store.stats().loaded).toBe(0);
    // The session goes away while the read is still out.
    await h.leave();
    expect(h.store.stats().entries).toBe(1);
    // ...and the sweep leaves it alone too, for the same reason.
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(1);

    gate.resolve({ kind: 'row', row: rowFixture() });
    await tick(20);
    expect(h.store.stats().loaded).toBe(1);
  });

  it('DOES collect a blocked entry, dirty or not, since it can never write', async () => {
    // The contrast arm: keeping a dirty entry forever would be a leak, not a
    // rescue, once it is held or quiesced and may not write at all.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'stale', durableRev: '99' }),
    });
    await h.login();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.store.stats().quiesced).toBe(1);
    await h.leave();
    expect(h.store.stats().entries).toBe(0);
  });
});

describe('a re-armed write inherits the leaving capture', () => {
  it('writes the last edit even when the re-arm is the write that runs after eviction', async () => {
    // The subtlest arm of the lost-save family. A background write is running
    // and has already sampled; a later edit sets pending; the player leaves and
    // the document is captured; the running write commits and settle RE-ARMS.
    // If the capture were cleared at the top of settle, that re-armed write
    // would run past eviction with nothing to send and the session's last edit
    // would be gone, silently.
    //
    // THE ORDER THE TITLE NAMES, which the earlier form did not reach: it let
    // the running write commit before the eviction, so the re-armed write
    // sampled the LIVE record and the capture was never what it carried. Here
    // the leave stops waiting at its deadline and removePlayer evicts FIRST,
    // and only then does the running write commit, so the re-arm genuinely
    // runs after eviction and the capture is the only document it can carry.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    h.edit(OWNER_KEY, { rev: 6 });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(20);
    expect(h.writeCount()).toBe(1);

    // A later edit while that write is out, then the leave.
    h.edit(OWNER_KEY, { rev: 7 });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    const leaving = h.leave();
    await tick(5);
    const deadline = h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
    deadline?.fire();
    await leaving;
    expect(h.record()).toBeUndefined();
    gates[0].resolve({ kind: 'updated', durableRev: '6' });
    await tick(20);
    for (let round = 0; round < 20 && gates.length > 1; round++) {
      for (const gate of gates.splice(1)) gate.resolve({ kind: 'updated', durableRev: '7' });
      await tick(30);
    }
    expect(h.writes.map((w) => w.wireRev)).toEqual([6, 7]);
  });
});

describe('an entry that went missing before the join is re-read, never left silently blocked', () => {
  it("re-reads at the handshake's re-ask when the entry was lost to the sweep, so the join installs the row", async () => {
    // A handshake wider than two sweeps loses its never-retained entry, exactly
    // as designed. Ruling (b) re-asks after the character read, so the store
    // reads the row again there and the join installs it: the session is loaded
    // and writes. (Before the re-ask the join's own retain did this read, after
    // the install had already been decided.)
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.store.preload(ACCOUNT_ID);
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(0);
    h.calls.length = 0;
    await h.joinAfterReask();
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].expectedDurableRev).toBe('7');
  });

  it('re-reads when retain finds no loaded entry, so the block on the stand-in is loud, not silent', async () => {
    // Under ruling (b) retain finds no loaded entry only after a join that
    // installed NOTHING (a hold, or a withheld answer), because the join
    // installs from any loaded entry. The session is on the stand-in either way
    // and must never write over the row. What retain's re-read buys is that the
    // block is DIAGNOSED: the entry learns the row, the seal refuses the
    // stand-in with a counted, logged refusal. Without it the unloaded entry
    // blocks every write with no hold of its own, no refusal and no line, and
    // the loss of the session's edits is invisible. Reached here by a re-ask
    // refused a permit after a clean leave (`rejoinOverEviction`).
    const h = await loadedStore({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.rejoinOverEviction();
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().loaded).toBe(1);
    h.edit(OWNER_KEY, { rev: 6 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors.filter((line) => line.includes('write refused (identity)'))).toHaveLength(1);
  });

  it('issues NO read at all on a dark realm, however the entry got lost', async () => {
    // The join path's preload is gated on the housing flag in server/main.ts,
    // so this reload would otherwise be the one durable read a realm with
    // housing disabled still issues, once per join, for a feature it does not
    // serve. A dark realm must touch the database not at all.
    //
    // The join on a dark realm carries the answer server/main.ts gives it
    // without touching the store, and the sim's inserters honour the same flag,
    // so no record is seeded either.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() }, dark: true });
    h.join(freeholdPreloadUnavailable(ACCOUNT_ID, 'housing is disabled on this realm'));
    await tick(20);
    expect(h.calls).toEqual([]);
    expect(h.store.stats().loads).toBe(0);
    expect(h.record()).toBeUndefined();
    // The entry still exists and is still write-blocked, which is what a dark
    // realm's store costs: one map entry per online account, removed on leave.
    // It is NOT loaded, and the two are separate measures precisely so an
    // operator scraping a dark realm cannot read a climbing entry count as
    // records this realm is persisting.
    expect(h.store.stats().entries).toBe(1);
    expect(h.store.stats().loaded).toBe(0);
  });

  it('costs no extra read on an ordinary join, where the entry IS loaded', async () => {
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    const answer = await h.store.preload(ACCOUNT_ID);
    h.calls.length = 0;
    h.join(answer);
    await tick(20);
    expect(h.calls).toEqual([]);
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
  });
});

describe('the leaving flush is bounded', () => {
  it('stops waiting at its own deadline without cancelling the write', async () => {
    // Under gate saturation a logout used to inherit the background write's
    // whole budget: the permit wait plus a statement timeout, times up to four
    // re-arm passes. Every leaving session would block for tens of seconds,
    // GameServer.leave would back up and character leases would be released
    // late, so reconnects wait out the lease. Giving up the WAIT is not giving
    // up the WRITE.
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await gate.promise });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(10);
    expect(h.writeCount()).toBe(1);

    let released = false;
    const leaving = h.store.flushAndRelease(OWNER_KEY).then(() => {
      released = true;
    });
    await tick(20);
    // Still blocked: nothing has fired the deadline yet.
    expect(released).toBe(false);

    const deadline = h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
    expect(deadline).toBeDefined();
    deadline?.fire();
    await leaving;
    expect(released).toBe(true);

    // The write was NOT cancelled and the entry was NOT dropped: it is still
    // running, so the row still gets the owner's last edits.
    expect(h.store.stats().running).toBe(1);
    expect(h.store.stats().entries).toBe(1);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(30);
    expect(h.writeCount()).toBe(1);
    // And only once it settled did the entry go.
    expect(h.store.stats().entries).toBe(0);
  });

  it('cancels its deadline when the write lands first, leaving no timer behind', async () => {
    const h = await loadedStore();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await h.store.flushAndRelease(OWNER_KEY);
    const leaveDeadlines = h.deadlines.filter((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS);
    expect(leaveDeadlines).toHaveLength(1);
    expect(leaveDeadlines[0].cancelled).toBe(true);
    expect(leaveDeadlines[0].fired).toBe(false);
  });
});

describe('the local write admission cap', () => {
  // The keyed serial writer serializes per OWNER KEY, so a thousand owners are
  // a thousand independent FIFOs racing for one shared background permit, and
  // that gate's waiter list is UNCAPPED. Bounding each WAIT does not bound the
  // waiter COUNT: the first sweep after a mass login would queue one waiter per
  // owner, each with its own abort timer, and every other named producer would
  // sit behind them. The surplus waits here instead.

  /** `count` owners in the world in ONE store, each with its own key and its
   *  own record. */
  async function manyOwners(count: number, writeRow: () => Promise<FreeholdUpsertResult>) {
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() }, writeRow });
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const account = ACCOUNT_ID + i;
      keys.push(`account:${account}`);
      await h.login(account);
    }
    return { h, keys };
  }

  it('never runs more than the cap at once, and drains everything anyway', async () => {
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    let peak = 0;
    let inFlight = 0;
    const { h, keys } = await manyOwners(40, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const gate = deferred<FreeholdUpsertResult>();
      gates.push(gate);
      const result = await gate.promise;
      inFlight--;
      return result;
    });
    for (const key of keys) {
      h.edit(key, { rev: 6 });
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(30);
    expect(peak).toBeLessThanOrEqual(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);

    // Release everything, pumping as slots free, and prove no owner was lost.
    for (let round = 0; round < 60 && gates.length > 0; round++) {
      for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
      await tick(30);
    }
    expect(peak).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);
    expect(h.writeCount()).toBe(40);
    expect(h.store.stats().dirty).toBe(0);
    // Forty accounts, forty rows under forty names: the unique plot_id index
    // would refuse any two sharing one.
    expect(new Set(h.writes.map((write) => write.plotId)).size).toBe(40);
  });

  it('leaves a deferred owner DIRTY, so the next sweep still owes it a write', async () => {
    // The safety half. A deferred write that quietly cleared its dirty flag
    // would lose the edit forever; the whole reason deferring is safe is that
    // the entry keeps owing the write.
    const gate = deferred<FreeholdUpsertResult>();
    const { h, keys } = await manyOwners(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 3, async () => {
      return await gate.promise;
    });
    for (const key of keys) {
      h.edit(key, { rev: 6 });
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(30);
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);
    expect(h.store.stats().dirty).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 3);
    // Nothing lost and nothing double-queued: the deferred owners are still
    // dirty and still uncounted as running.
    expect(h.store.stats().running).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);
  });

  it('does not answer the shutdown drain until every capped write has run', async () => {
    // A drain that answered while writes were still owed would report success
    // with edits unwritten, which is the exact lie a drain exists to prevent.
    // Note what this does and does not prove: a non-empty deferred set always
    // implies the cap is full, so the running-entry loop would catch this case
    // too. The explicit deferred check in drainCheck is defence in depth behind
    // a same-state filter and no behaviour test can isolate it; it is kept
    // because the two conditions are only equal by today's arithmetic.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const { h, keys } = await manyOwners(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 2, async () => {
      const gate = deferred<FreeholdUpsertResult>();
      gates.push(gate);
      return await gate.promise;
    });
    for (const key of keys) {
      h.edit(key, { rev: 6 });
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(30);
    let drained: boolean | null = null;
    void h.store.idle(60_000).then((value) => {
      drained = value;
    });
    await tick(20);
    expect(drained).toBeNull();

    for (let round = 0; round < 20 && gates.length > 0; round++) {
      for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
      await tick(30);
    }
    expect(drained).toBe(true);
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 2);
  });
});

describe('an abandoned preload does not leak an entry', () => {
  // The handshake reads the durable row BEFORE it acquires the character lease,
  // and several refusals sit between the two. Every one of them returns without
  // reaching retain(), so a preload that is never retained had no removal path
  // at all: the entry stayed for the life of the process holding a parsed
  // record, and preload REPLAYS a loaded entry rather than re-reading, so on a
  // multi-realm deployment it would serve a stale house at every later login.

  function sweep(h: Harness, passes: number): void {
    for (let i = 0; i < passes; i++) h.store.saveAllDirty();
  }

  it('does not collect on the first pass, so a join between preload and retain is safe', async () => {
    // The mark pass is the whole reason this is two passes: preload resolves
    // before game.join calls retain, and an entry removed in that window costs
    // the handshake's re-ask a second durable read (and, were that refused, the
    // session its house). One pass leaves it, so the re-ask replays it.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.store.preload(ACCOUNT_ID);
    sweep(h, 1);
    expect(h.store.stats().entries).toBe(1);
    h.calls.length = 0;
    await h.joinAfterReask();
    expect(h.calls).not.toContain('readRow');
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    sweep(h, FREEHOLD_PERSIST_ORPHAN_SWEEP_PASSES + 2);
    expect(h.store.stats().entries).toBe(1);
  });

  it('never collects a retained, a dirty or a writing entry', async () => {
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => await gate.promise,
    });
    // Retained: survives any number of passes.
    sweep(h, 6);
    expect(h.store.stats().entries).toBe(1);

    // Dirty and then writing: still survives, even with the reference dropped
    // (the owner leaves, the leave stops waiting at its deadline, and
    // removePlayer takes the record with it).
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(10);
    expect(h.store.stats().running).toBe(1);
    const leaving = h.leave();
    await tick(5);
    h.deadlines.find((job) => job.ms === FREEHOLD_PERSIST_LEAVE_FLUSH_MS)?.fire();
    await leaving;
    expect(h.record()).toBeUndefined();
    sweep(h, 6);
    expect(h.store.stats().entries).toBe(1);
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(30);
    expect(h.writeCount()).toBe(1);
  });
});

describe('the two admission caps sum past the shared gate, and that is the accepted answer', () => {
  it('never holds more PERMITS than the gate grants, however far its own caps sum past it', async () => {
    // RULING 4, pinned against the answer that was taken. The load cap (4) and
    // the write cap (4) are independent counters against a gate whose capacity
    // is smaller, so the store's own demand can exceed the gate's supply: 8 in
    // steady state and 12 during a drain, against 7. Sharing ONE budget between
    // them was considered and rejected, because it couples a player's login read
    // to a sweep's writes, which is the coupling the two constants were split to
    // avoid. What bounds real concurrency is the GATE, not the caps, and this
    // case is the executed proof of that rather than an argument for it.
    //
    // Driven through the REAL createBackgroundDbGate, not a fake, because the
    // claim is about how this store composes with the one gate the realm shares.
    // Cross-pinned against server/db.ts, because a pool size copied by hand is a
    // number that goes stale the moment the real one moves.
    expect(stripComments(readFileSync('server/db.ts', 'utf8'))).toContain(
      `const DB_POOL_MAX_CLIENTS_DEFAULT = ${DEFAULT_DB_POOL_MAX_CLIENTS};`,
    );
    const gate = createBackgroundDbGate(DEFAULT_DB_POOL_MAX_CLIENTS);
    const capacity = gate.stats().max;
    // The overcommit is the premise, so it is asserted rather than assumed: both
    // the steady-state demand and the drain demand exceed the supply.
    expect(FREEHOLD_PERSIST_MAX_ACTIVE_LOADS + FREEHOLD_PERSIST_MAX_ACTIVE_WRITES).toBeGreaterThan(
      capacity,
    );
    expect(
      FREEHOLD_PERSIST_MAX_ACTIVE_LOADS + FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
    ).toBeGreaterThan(capacity);

    // BOTH KINDS OF WORK PARK while holding their permits, which is the only
    // state in which the two caps can be demanding at once.
    const releaseReads: Array<() => void> = [];
    const releaseWrites: Array<() => void> = [];
    let peakPermits = 0;
    const h = harness({
      readRow: (accountId) =>
        new Promise<FreeholdRowLoad>((resolve) => {
          releaseReads.push(() =>
            resolve({
              kind: 'row',
              row: rowFixture({ accountId, plotId: `plot:row${accountId}` }),
            }),
          );
        }),
      acquirePermit: async (signal) => {
        const permit = await gate.acquire(signal);
        if (permit === null) return null;
        peakPermits = Math.max(peakPermits, gate.stats().inFlight);
        return permit;
      },
      writeRow: () =>
        new Promise<FreeholdUpsertResult>((resolve) => {
          releaseWrites.push(() => resolve({ kind: 'updated', durableRev: '9' }));
        }),
    });

    // A set of owners already loaded and dirty, so their writes can fill the
    // write cap; then a burst of fresh logins, whose reads fill the load cap.
    const writers: string[] = [];
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 2; i++) {
      const accountId = OTHER_ACCOUNT_ID + i;
      const key = `account:${accountId}`;
      writers.push(key);
      const loading = h.store.preload(accountId);
      await tick(10);
      releaseReads.shift()?.();
      h.join(await loading, accountId);
      h.store.markDirty(key);
    }
    h.store.saveAllDirty();
    await tick(40);
    expect(h.store.stats().activeWrites).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);

    const logins = Array.from({ length: FREEHOLD_PERSIST_MAX_ACTIVE_LOADS + 3 }, (_, i) =>
      h.store.preload(OTHER_ACCOUNT_ID + 900 + i),
    );
    await tick(60);

    // THE BOUND THAT HOLDS: the gate never grants more than its capacity, so no
    // number of housing producers can put more clients on the pool than the
    // realm budgeted for every named producer together.
    expect(peakPermits).toBeLessThanOrEqual(capacity);
    expect(gate.stats().inFlight).toBeLessThanOrEqual(capacity);
    // AND HOUSING REALLY DID SATURATE IT, which is what makes the sentence above
    // load bearing instead of vacuous: the surplus waited for a permit rather
    // than running anyway, and it is housing holding every one of them.
    expect(gate.stats().inFlight).toBe(capacity);
    expect(gate.stats().waiting).toBeGreaterThan(0);

    // Let everything finish: releasing the parked work frees permits, which
    // admits the queued work, which parks in turn, so this drains in passes
    // rather than in one sweep.
    for (let pass = 0; pass < 20; pass++) {
      while (releaseReads.length > 0) releaseReads.shift()?.();
      while (releaseWrites.length > 0) releaseWrites.shift()?.();
      await tick(40);
    }
    await Promise.all(logins.map((login) => login.catch(() => undefined)));
  });
});

describe('the WHOLE preload is capped against the login budget', () => {
  /** Fire EVERY armed budget deadline, not the first: retain's repair reload is
   *  a preload of its own and arms one beside the case's explicit call, so
   *  firing only the first leaves the other caller parked on the same gated
   *  read. */
  const fireBudget = (h: Harness): void => {
    const armed = h.deadlines.filter(
      (deadline) => deadline.ms === FREEHOLD_PERSIST_LOGIN_BUDGET_MS && !deadline.cancelled,
    );
    expect(armed.length, 'a login budget deadline must be armed').toBeGreaterThan(0);
    for (const job of armed) job.fire();
  };

  it('arms ONE deadline for the whole load, at the budget, and cancels it on the answer', async () => {
    // Every STEP of a login-path load has a bound of its own and the SUM of
    // them had none: the pool checkout, BEGIN, SET LOCAL and a COMMIT that
    // neither server-side timeout covers answer to the pool, for a measured
    // floor of 104,000 ms. This is the cap on the whole thing.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.store.preload(ACCOUNT_ID);
    const budget = h.deadlines.filter((job) => job.ms === FREEHOLD_PERSIST_LOGIN_BUDGET_MS);
    expect(budget).toHaveLength(1);
    expect(budget[0]?.cancelled).toBe(true);
    expect(budget[0]?.fired).toBe(false);
    expect(FREEHOLD_PERSIST_LOGIN_BUDGET_MS).toBe(10_000);
  });

  it('refuses the LOAD, not the login, when the budget runs out', async () => {
    // The player joins, on the sim's default record, and no write goes out for
    // that account. Refusing the LOGIN over a durable housing read reverses a
    // decision this packet has already taken and pinned.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    const answer = await loading;
    expect(answer.hold?.kind).toBe('no_budget');
    expect(answer.state).toBeNull();
    // The DURABLE ROW IS LEFT UNTOUCHED, which is what a hold means here:
    // installLoadedFreehold installs nothing for it. The account is NOT then
    // write-blocked for the session, and that difference is the defect this
    // round's own fresh read found: the in-flight read fills the entry, so the
    // store's absent arm has to refuse to name a row for a record no install
    // ever reached ('REFUSES to name a row for a record it did not install').
    expect(answer.durableRev).toBeNull();
    expect(h.store.stats().loadFailuresByKind).toEqual({ no_budget: 1 });
    expect(h.warnings.some((line) => line.includes('no_budget'))).toBe(true);
    // The detail rides the same bound every other housing log line does.
    expect(h.warnings.some((line) => line.includes('unclassified'))).toBe(false);
    gate.resolve({ kind: 'absent' });
    await tick(20);
  });

  it('leaves the ENTRY alone, so the read it gave up on still fills it', async () => {
    // THE ONE HOLD IN THIS STORE THAT DOES NOT TOUCH THE ENTRY. The read is
    // still in flight behind a single-flight slot; marking the entry held would
    // overwrite whatever that read then learns, and the honest answer is that
    // this LOGIN got nothing, not that the account is unreadable.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({
      readRow: async () => await gate.promise,
    });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    const refused = await loading;
    expect(refused.hold?.kind).toBe('no_budget');
    // The handshake's RE-ASK rides the same single-flight read and runs out of
    // budget too, and the login goes ahead on that refusal: the join installs
    // nothing and its retain CREATES the entry, with a reference. Its repair
    // read rides the SAME slot, so no second read goes out, and it arms a
    // budget of its own, which runs out as well: the refusal now meets an entry
    // that EXISTS, which is the state this claim is about.
    // The first ask spent the whole budget, so the re-ask gets none and runs out
    // by itself (production's setTimeout(0), modelled by the harness).
    const reasking = h.store.preload(ACCOUNT_ID, {
      budgetMs: freeholdReaskBudgetMs(FREEHOLD_PERSIST_LOGIN_BUDGET_MS),
      reask: true,
    });
    await tick(10);
    const atJoin = await reasking;
    expect(atJoin.hold?.kind).toBe('no_budget');
    h.join(atJoin);
    await tick(10);
    expect(h.calls.filter((call) => call === 'readRow')).toHaveLength(1);
    expect(h.store.stats().entries).toBe(1);
    fireBudget(h);
    await tick(10);
    expect(h.store.stats().loadFailuresByKind).toEqual({ no_budget: 3 });
    // NOTHING WRITTEN ON THE ENTRY AT ALL, which is three separate facts: no
    // hold, no `loaded`, and no failure booked against the entry. Asserting the
    // hold alone left a refusal that stamped `loaded` green, and a stamped
    // `loaded` is what stops the repair arm ever reaching this entry again.
    expect(h.store.stats().held).toBe(0);
    expect(h.store.stats().loaded).toBe(0);
    expect(h.store.stats().entries).toBe(1);

    // The read lands afterwards and the entry becomes loaded and unheld,
    // exactly as it would have if the login had waited, and it knows the ROW:
    // its durable revision and its name, read back through a second character's
    // handshake (the already-live arm, so no state rides it).
    gate.resolve({ kind: 'row', row: rowFixture() });
    await tick(30);
    expect(h.store.stats().loaded).toBe(1);
    expect(h.store.stats().held).toBe(0);
    const replay = await h.store.preload(ACCOUNT_ID);
    expect(replay.hold).toBeNull();
    expect(replay.durableRev).toBe('7');
    expect(replay.plotId).toBe(ROW_PLOT_ID);
    // AND ITS STATE, which that arm cannot show: the join seeded the stand-in
    // over this account, and the seal refuses it, which it can do only against
    // a state the read filled in: every arm of it compares against that state,
    // and an entry left with none would compare nothing and let the empty
    // default through.
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().quiesced).toBe(1);
    expect(h.errors.some((line) => line.includes('write refused (identity)'))).toBe(true);
  });

  it('names the record for a refused login whose read lands before its re-ask, and writes under that name', async () => {
    // THE NINTH PATH, reproduced against the store before it was closed, and now
    // closed a level higher. The whole-preload cap refuses the login and leaves
    // its read in flight, and the handshake still has a lease acquire and a
    // character reload to run: the read lands in THAT window, before anything is
    // seeded, so the absent arm mints. Before ruling (b) the join then installed
    // nothing on the refusal and addPlayer seeded the STAND-IN beside an entry
    // holding the minted name, which the order-independent insert refusal
    // (server/freehold_write_seal.ts) refused, write-blocking the session.
    //
    // THE RE-ASK now replays the entry the late read filled, and the join
    // installs from it: the record carries the minted name from the first
    // session, and its first write inserts the row under that name. The insert
    // refusal stays, as defense in depth for an order no join now produces (its
    // literals are pinned in tests/server/freehold_write_seal.test.ts).
    const gate = deferred<FreeholdRowLoad>();
    let gated = true;
    const h = harness({
      readRow: async () => (gated ? await gate.promise : { kind: 'absent' }),
      writeRow: async () => ({ kind: 'inserted', durableRev: '1' }),
    });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    const refused = await loading;
    expect(refused.hold?.kind).toBe('no_budget');
    gated = false;
    gate.resolve({ kind: 'absent' });
    await tick(30);
    expect(h.record()).toBeUndefined();
    // The first ask spent the whole budget, so the re-ask gets none, as in
    // production; the replay of the entry the late read filled still wins.
    const atJoin = await h.joinAfterReask(ACCOUNT_ID, FREEHOLD_PERSIST_LOGIN_BUDGET_MS);
    expect(atJoin.hold).toBeNull();
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    h.store.saveAllDirty();
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);
    expect(h.writes[0].expectedDurableRev).toBeNull();
    expect(h.store.stats().quiesced).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('refuses to name a row, loudly and once, when BOTH asks overrun and the read lands after the seed', async () => {
    // The order that still seats the stand-in: the re-ask runs out of budget
    // too, the join installs nothing, and the read lands after addPlayer seeded.
    // The absent arm then sees the stand-in and takes the terminal
    // `unnamed_record` hold, so no row is created under a name the record can
    // never learn. Two sweeps, because a guard that refuses once is satisfied
    // by a constant.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    expect((await loading).hold?.kind).toBe('no_budget');
    // The first ask spent the whole budget, so the re-ask gets none and runs out
    // by itself (production's setTimeout(0), modelled by the harness).
    const reasking = h.store.preload(ACCOUNT_ID, {
      budgetMs: freeholdReaskBudgetMs(FREEHOLD_PERSIST_LOGIN_BUDGET_MS),
      reask: true,
    });
    await tick(10);
    const atJoin = await reasking;
    expect(atJoin.hold?.kind).toBe('no_budget');
    h.join(atJoin);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    gate.resolve({ kind: 'absent' });
    await tick(30);
    h.store.saveAllDirty();
    await tick(40);
    h.store.saveAllDirty();
    await tick(40);
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().loadFailuresByKind.unnamed_record).toBe(1);
    expect(h.warnings.filter((line) => line.includes('unnamed_record'))).toHaveLength(1);
  });

  it('costs one LOGOUT, not an account: the refused entry is collected and re-reads clean', async () => {
    // THE PROPERTY THAT MAKES THE REFUSAL SAFE, and the one a reader should
    // check before accepting it. Quiescing is terminal FOR THAT ENTRY, so if the
    // entry outlived the account the owner would be write-blocked forever, which
    // is a worse outcome than the path being closed.
    //
    // WHAT IT IS BOUNDED BY IS THE LOGOUT, not the session, and the weaker claim
    // is the true one. The poisoned RECORD is evicted by `removePlayer` only
    // when the last session sharing the owner key leaves, so while another
    // character of the same account is still online the record survives the
    // entry, and each new login's classify sees the stand-in and takes the
    // TERMINAL `unnamed_record` hold again. Bounded, never unbounded, because the
    // account fully logging out clears it; an earlier version of this case said
    // "one session", which is stronger than the code supports.
    // Reached, under ruling (b), by the case above's order: both asks overrun
    // and the read lands after the seed, so the entry takes the terminal
    // `unnamed_record` hold.
    let gate: Deferred<FreeholdRowLoad> | null = deferred<FreeholdRowLoad>();
    const h = harness({
      readRow: async () => (gate ? await gate.promise : { kind: 'absent' }),
    });
    const open = gate;
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    expect((await loading).hold?.kind).toBe('no_budget');
    // The first ask spent the whole budget, so the re-ask gets none and runs out
    // by itself (production's setTimeout(0), modelled by the harness).
    const reasking = h.store.preload(ACCOUNT_ID, {
      budgetMs: freeholdReaskBudgetMs(FREEHOLD_PERSIST_LOGIN_BUDGET_MS),
      reask: true,
    });
    await tick(10);
    h.join(await reasking);
    gate = null;
    open.resolve({ kind: 'absent' });
    await tick(30);
    h.store.saveAllDirty();
    await tick(40);
    expect(h.store.stats().held).toBe(1);
    expect(h.store.stats().loadFailuresByKind.unnamed_record).toBe(1);
    expect(h.writeCount()).toBe(0);

    // The LAST session of the account leaves, in production order: the leave
    // flush runs while the record is still live and `removePlayer` evicts it
    // afterwards. A held entry is BLOCKED, so its dirty clause stops counting
    // and it owes nothing: both removal paths may collect it.
    await h.leave();
    expect(h.record()).toBeUndefined();
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().entries).toBe(0);

    // The next login builds a fresh entry and reads clean. NO ROW was ever
    // created, so the row arm is not involved: the absent arm mints again, and
    // this time the answer carries no hold, so installLoadedFreehold names the
    // record before addPlayer can seed one.
    const second = await h.store.preload(ACCOUNT_ID);
    expect(second.hold).toBeNull();
    expect(second.state).toBeNull();
    expect(second.durableRev).toBeNull();
    expect(second.plotId).not.toBe('');
    expect(h.store.stats().held).toBe(0);
    expect(h.store.stats().quiesced).toBe(0);
  });

  it('still names a row when a SIBLING login is still waiting on the same read', async () => {
    // `beginLoad` is single-flight, so two characters of one account ride ONE
    // read. The refusal above is a property of the CALLER, not of the read, and
    // a first version recorded it against the ACCOUNT: an account whose two
    // characters joined together and whose first login overran was then
    // write-blocked for its whole session, with the second login's install
    // standing right there ready to name the record. Zero waiters is the test,
    // and it is exact rather than conservative because classify runs inside the
    // load promise, before any surviving waiter's own race has resolved.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const first = h.store.preload(ACCOUNT_ID);
    const second = h.store.preload(ACCOUNT_ID);
    await tick(20);
    // ONLY the first login's budget fires; the second is still waiting.
    const armed = h.deadlines.filter(
      (deadline) => deadline.ms === FREEHOLD_PERSIST_LOGIN_BUDGET_MS && !deadline.cancelled,
    );
    expect(armed.length).toBe(2);
    armed[0]?.fire();
    const refused = await first;
    expect(refused.hold?.kind).toBe('no_budget');

    gate.resolve({ kind: 'absent' });
    const answer = await second;
    expect(answer.hold).toBeNull();
    expect(answer.plotId).toBe(MINTED_PLOT_ID);

    // AND THE MINT IS NOT WHERE THIS CASE STOPS, which is the defect its first
    // version had. Asserting the mint and going home is what let the TENTH path
    // through: the REFUSED login reached addPlayer first, because it stopped
    // waiting earlier and is always ahead in the pipeline, and seeded the
    // stand-in; the sibling's own install was then discarded by load-once, and
    // the entry was left writable holding a name its record could never learn
    // (closed then by the order-independent insert refusal, which write-blocked
    // both sessions).
    //
    // BOTH JOINS, the refused one first, now each after its re-ask: the refused
    // login's re-ask replays the entry the shared read filled, so its join names
    // the record, and the sibling's install is the no-op load-once makes it.
    // One name, one row. The refused login spent the whole budget on its first
    // ask, so its re-ask runs on none, as in production.
    await h.joinAfterReask(ACCOUNT_ID, FREEHOLD_PERSIST_LOGIN_BUDGET_MS);
    await h.joinAfterReask();
    expect(h.record()?.plotId).toBe(MINTED_PLOT_ID);
    h.store.saveAllDirty();
    await tick(40);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].plotId).toBe(MINTED_PLOT_ID);
    expect(h.store.stats().writeFailures).toBe(0);
    expect(h.store.stats().quiesced).toBe(0);
    expect(refused.hold?.kind).toBe('no_budget');
  });

  it('clears the abandonment with the read, so the NEXT login is not refused', async () => {
    // An abandonment that outlived its own read would refuse a perfectly
    // ordinary later load for the same account, which is a housing outage
    // manufactured by the guard against one.
    const gate = deferred<FreeholdRowLoad>();
    const h = harness({ readRow: async () => await gate.promise });
    const loading = h.store.preload(ACCOUNT_ID);
    await tick(20);
    fireBudget(h);
    expect((await loading).hold?.kind).toBe('no_budget');
    gate.resolve({ kind: 'absent' });
    await tick(30);

    // A FRESH entry, as the next login builds once the first one's is gone:
    // the refused handshake never joined, so two sweeps collect what its read
    // left behind.
    h.store.saveAllDirty();
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().entries).toBe(0);
    const second = await h.store.preload(ACCOUNT_ID);
    expect(second.hold).toBeNull();
    expect(second.plotId).not.toBe('');
  });

  it('runs the load UNCAPPED rather than refusing it when the timer cannot be armed', async () => {
    // A scheduler that will not schedule must not refuse a login: the behaviour
    // that predates the cap is the safe fallback, and it says so on the error
    // port rather than failing silently.
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      scheduleDeadline: () => {
        throw new Error('no timers');
      },
    });
    const answer = await h.store.preload(ACCOUNT_ID);
    expect(answer.hold).toBeNull();
    expect(answer.state).not.toBeNull();
    expect(h.errors.some((line) => line.includes('uncapped'))).toBe(true);
  });
});

describe('the bounded drain', () => {
  it('drains a write in flight and cancels its deadline', async () => {
    const gate = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await gate.promise });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick();
    let drained: boolean | null = null;
    const idle = h.store.idle(5_000).then((value) => {
      drained = value;
    });
    await tick();
    expect(drained).toBeNull();
    gate.resolve({ kind: 'updated', durableRev: '3' });
    await idle;
    expect(drained).toBe(true);
    // THE DRAIN'S OWN deadline, selected by its duration rather than by being
    // the only one: the login-path load in loadedStore schedules the whole
    // preload cap beside it, and both are cancelled.
    const drainDeadlines = h.deadlines.filter((job) => job.ms === 5_000);
    expect(drainDeadlines).toHaveLength(1);
    expect(drainDeadlines[0]?.cancelled).toBe(true);
    // AND NOTHING WAS LEFT ARMED. A deadline that fires after its own work has
    // settled is how a cancelled timer becomes a false not-drained answer.
    expect(h.deadlines.every((job) => job.cancelled || job.fired)).toBe(true);
    // The preload's cap is the other kind, one per ask (the handshake asks
    // before the lease and again before the join), each cancelled the moment
    // its answer landed.
    const budgetDeadlines = h.deadlines.filter(
      (job) => job.ms === FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
    );
    expect(budgetDeadlines).toHaveLength(2);
    expect(budgetDeadlines.every((job) => job.cancelled && !job.fired)).toBe(true);
  });

  it('flushes what is dirty before it waits', async () => {
    // A ROW-LOADED entry whose record sits at the committed revision, so the
    // revision probe sees NO movement and only the explicit mark can arm the
    // drain's write. A fresh account's entry has no committed state, which the
    // probe calls movement, so it could not tell a drain that reads the dirty
    // generation from one that ignores it.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    expect(h.record()?.rev).toBe(5);
    h.store.markDirty(OWNER_KEY);
    expect(h.store.stats().dirty).toBe(1);
    expect(await h.store.idle(5_000)).toBe(true);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(5);
    expect(h.store.stats().dirty).toBe(0);
  });

  it('answers false at its deadline without throwing', async () => {
    const never = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await never.promise });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick();
    const idle = h.store.idle(10);
    await tick();
    expect(h.fireDeadline()).toBe(true);
    await expect(idle).resolves.toBe(false);
    never.resolve({ kind: 'updated', durableRev: '4' });
    await tick(30);
  });

  it('never throws when the write it is draining rejects', async () => {
    const h = await loadedStore({
      writeRow: async () => {
        throw new Error('drain time failure');
      },
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick();
    expect(h.store.stats().writeFailures).toBe(1);
    // The entry never committed, so it is still dirty and the drain flushes it
    // once more. The rejection is absorbed both times: idle still ANSWERS, and
    // it answers FALSE, because the second rejection leaves the same edits
    // unwritten and unblocked. It answers at once rather than at its deadline:
    // nothing is running, pending or deferred, so there is nothing to wait for.
    await expect(h.store.idle(5_000)).resolves.toBe(false);
    expect(h.deadlines.some((job) => job.fired)).toBe(false);
    expect(h.writeCount()).toBe(2);
    expect(h.store.stats().writeFailures).toBe(2);
  });

  it('drains an owner whose RECORD MOVED with no markDirty call', async () => {
    // The drain uses the SAME detector as the periodic sweep and the leave
    // flush, because the revision probe is the only dirty detector with a
    // production caller in this release: an isDirty-only drain could not see an
    // edit at all. It was correct before this only by the shutdown ORDERING in
    // server/main.ts, which is a property of another file.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => ({ kind: 'updated', durableRev: '8' }),
    });
    // The record moved. Nothing called markDirty, which is exactly the
    // production shape: markDirty has no production caller.
    h.edit(OWNER_KEY, { rev: 6 });
    expect(h.store.stats().dirty).toBe(0);
    await expect(h.store.idle(5_000)).resolves.toBe(true);
    expect(h.writeCount()).toBe(1);
    expect(h.writes[0].wireRev).toBe(6);
  });

  it('closes intake, and still lets a leaving session flush', async () => {
    const h = await loadedStore();
    expect(await h.store.idle(5_000)).toBe(true);
    // The drain itself writes whatever it found moved, so the arms below are
    // measured against that baseline rather than against zero.
    const drained = h.writeCount();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    // Intake is closed: neither door adds a write.
    expect(h.writeCount()).toBe(drained);

    await h.store.flushAndRelease(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(drained + 1);
  });

  it('stop() cancels the deadline without closing intake', async () => {
    const h = await loadedStore();
    h.store.stop();
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writeCount()).toBe(1);
  });

  it('stop() settles an outstanding drain rather than leaving it hanging', async () => {
    const never = deferred<FreeholdUpsertResult>();
    const h = await loadedStore({ writeRow: async () => await never.promise });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick();
    const idle = h.store.idle(60_000);
    await tick();
    h.store.stop();
    await expect(idle).resolves.toBe(false);
    // THE DRAIN'S OWN deadline, by its duration: `deadlines[0]` is the login's
    // budget, which the preload already cancelled.
    const drainDeadlines = h.deadlines.filter((job) => job.ms === 60_000);
    expect(drainDeadlines).toHaveLength(1);
    expect(drainDeadlines[0]?.cancelled).toBe(true);
    never.resolve({ kind: 'updated', durableRev: '5' });
    await tick(30);
  });
});

describe('the registered store handle', () => {
  it('answers true when no store is registered', async () => {
    registerFreeholdPersistStore(null);
    await expect(freeholdPersistIdle(1_000)).resolves.toBe(true);
  });

  it('delegates to the registered store with the deadline it was given', async () => {
    const idle = vi.fn(async () => true);
    registerFreeholdPersistStore({ idle } as unknown as FreeholdPersistStore);
    await expect(freeholdPersistIdle(1_234)).resolves.toBe(true);
    expect(idle).toHaveBeenCalledWith(1_234);
  });

  it('defaults to the shutdown drain bound', async () => {
    const idle = vi.fn(async () => false);
    registerFreeholdPersistStore({ idle } as unknown as FreeholdPersistStore);
    await expect(freeholdPersistIdle()).resolves.toBe(false);
    expect(idle).toHaveBeenCalledWith(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS);
  });

  it('answers false rather than throwing when the store rejects', async () => {
    registerFreeholdPersistStore({
      idle: async () => {
        throw new Error('drain exploded');
      },
    } as unknown as FreeholdPersistStore);
    await expect(freeholdPersistIdle(50)).resolves.toBe(false);
  });
});

describe('stats', () => {
  it('carries counts only, never an owner key, an account id or a plot id', async () => {
    // The login and the write get permits; a second account's read is refused
    // one, so the one non-scalar measure below has a key to check.
    let granted = 0;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => (++granted <= 2 ? { release: () => {} } : null),
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect((await h.store.preload(OTHER_ACCOUNT_ID)).hold?.kind).toBe('no_permit');
    const json = JSON.stringify(h.store.stats());
    expect(json).not.toContain(String(ACCOUNT_ID));
    expect(json).not.toContain(String(OTHER_ACCOUNT_ID));
    expect(json).not.toContain(OWNER_KEY);
    expect(json).not.toContain(ROW_PLOT_ID);
    expect(json).not.toContain('plot:');
    expect(json).not.toContain('account:');
    const stats = h.store.stats();
    for (const [measure, value] of Object.entries(stats)) {
      if (measure === 'loadFailuresByKind' || measure === 'joinVerdicts') continue;
      expect(typeof value).toBe('number');
    }
    // 07a's counter rides the same scrape as a COUNT, read by name so the loop
    // above cannot pass over its absence: a write the claim fence refused names
    // no owner, only that one happened.
    expect(Object.keys(stats)).toContain('fencedWrites');
    expect(stats.fencedWrites).toBe(0);
    // The second record measure: its keys are the fixed verdict vocabulary and
    // its values are counts.
    expect(Object.keys(stats.joinVerdicts).sort()).toEqual(
      ['entry', 'held', 'none', 'refused', 'superseded', 'withheld'].sort(),
    );
    for (const count of Object.values(stats.joinVerdicts)) expect(typeof count).toBe('number');
    // The one non-scalar measure, checked on both halves: its KEYS are hold
    // kinds from a closed vocabulary and its values are counts, so no identity
    // can ride in on either side.
    expect(stats.loadFailuresByKind).toEqual({ no_permit: 1 });
    // A LITERAL list, held EQUAL to the vocabulary, so a kind that grew would
    // have to be read here before it could ride out on this scrape.
    const kinds = [
      'unsupported',
      'malformed',
      'oversize',
      'unadmitted',
      'read_threw',
      'cap_full',
      'no_permit',
      'no_budget',
      'claim_busy',
      'unnamed_record',
    ];
    expect([...FREEHOLD_LOAD_FAILURE_KINDS].sort()).toEqual([...kinds].sort());
    for (const [kind, count] of Object.entries(stats.loadFailuresByKind)) {
      expect(kinds).toContain(kind);
      expect(typeof count).toBe('number');
    }
  });

  it('reports the dirty age from the store clock and the write byte totals', async () => {
    // Each bracket moves the store clock by its own step, so every total is an
    // exact sum: 7 per permit (one load, one write), 11 in the read, 19 in the
    // queue, 13 in the statement.
    let h!: Harness;
    const advance = (ms: number): void => h.setNow(h.ports.nowMs() + ms);
    h = harness({
      acquirePermit: async () => {
        advance(7);
        return { release: () => {} };
      },
      readRow: async () => {
        advance(11);
        return { kind: 'absent' };
      },
      enqueue: async <T>(_key: string, _signal: AbortSignal, write: () => Promise<T>) => {
        advance(19);
        return await write();
      },
      writeRow: async () => {
        advance(13);
        return { kind: 'inserted', durableRev: '1' };
      },
    });
    await h.login();
    h.setNow(20_000);
    h.store.markDirty(OWNER_KEY);
    h.setNow(23_500);
    expect(h.store.stats().oldestDirtyAgeMs).toBe(3_500);
    h.store.save(OWNER_KEY);
    await tick(30);
    const after = h.store.stats();
    expect(after.oldestDirtyAgeMs).toBe(0);
    expect(after.writes).toBe(1);
    // A total and a high-water mark, never a last sample: one arbitrary write's
    // size at a thousand owners tells an operator nothing about the
    // distribution or about growth toward the byte ceiling.
    expect(after.writeBytesTotal).toBeGreaterThan(0);
    expect(after.maxWriteBytes).toBe(after.writeBytesTotal);
    // One load permit plus one write permit.
    expect(after.permitWaitMsTotal).toBe(14);
    expect(after.queueWaitMsTotal).toBe(19);
    expect(after.writeMsTotal).toBe(13);
    expect(after.loadMsTotal).toBe(11);
  });
});

describe('installLoadedFreehold', () => {
  const loadedFixture = (overrides: Partial<LoadedFreehold> = {}): LoadedFreehold => ({
    accountId: ACCOUNT_ID,
    plotIndex: 0,
    plotId: ROW_PLOT_ID,
    durableRev: '7',
    state: persistedFixture(),
    hearthReadyAtMs: 0,
    hearthRevision: '0',
    hold: null,
    recordWithheld: false,
    ...overrides,
  });

  it('installs a loaded record synchronously under the account owner key', () => {
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, loadedFixture());
    const record = ctx.freeholds.get(OWNER_KEY);
    expect(record?.plotId).toBe(ROW_PLOT_ID);
    expect(record?.tier).toBe('inn_room');
    expect(record?.condition).toBe(87);
    expect(record?.layout).toHaveLength(1);
    expect(record?.rev).toBe(5);
    // Ephemeral build presence never comes back from a row.
    expect(record?.isDecorating).toBe(false);
  });

  it('installs nothing for a load that has NO state but still names a row', () => {
    // durableRev non-null means a row exists and this answer simply carries no
    // state for it, which is preload's already-live arm. Installing a default
    // there would put an empty record over a live one; loadFreehold is
    // load-once so it would be a no-op anyway, and this says so.
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, loadedFixture({ state: null }));
    expect(ctx.freeholds.size).toBe(0);
  });

  it('installs a DEFAULT carrying the minted identity when there is no durable row', () => {
    // THE ABSENT ARM, and the fix for the eighth path. This case used to assert
    // that nothing at all is installed, and that is exactly what left an online
    // record answering to the stand-in for its whole first session: the store
    // minted the identity the row would be inserted under, the record never
    // learned it, and the write seal's name comparison was then inert BY VALUE
    // EQUALITY for that entry class, because a freshly reseeded default carries
    // the same literal.
    const ctx = fakeCtx();
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({ state: null, durableRev: null, plotId: MINTED_PLOT_ID }),
    );
    const record = ctx.freeholds.get(OWNER_KEY);
    expect(record?.plotId).toBe(MINTED_PLOT_ID);
    // A DEFAULT, and nothing else: the free tier-0 Inn Room at revision zero.
    expect(record?.tier).toBe('inn_room');
    expect(record?.layout).toEqual([]);
    expect(record?.trophies).toEqual([]);
    expect(record?.condition).toBe(100);
    expect(record?.visitPolicy).toBe('closed');
    expect(record?.rev).toBe(0);
    expect(record?.ownerKey).toBe(OWNER_KEY);
  });

  it('installs nothing from an answer read BESIDE a live record, even one shaped like an absent row', () => {
    // The eleventh path's install half. The already-live arm's answer for a
    // fresh account is revision-null, state-null and hold-null, and once the
    // record it was read beside is evicted the absent arm would install an empty
    // default under the account's real name. The mark alone decides it.
    const ctx = fakeCtx();
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({
        state: null,
        durableRev: null,
        plotId: MINTED_PLOT_ID,
        hearthReadyAtMs: 90_000,
        recordWithheld: true,
      }),
    );
    expect(ctx.freeholds.size).toBe(0);
    // The clock is a separate durable fact and still lands.
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
    // The same answer marked FALSE is a genuine absent row and installs.
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({ state: null, durableRev: null, plotId: MINTED_PLOT_ID }),
    );
    expect(ctx.freeholds.get(OWNER_KEY)?.plotId).toBe(MINTED_PLOT_ID);
  });

  it('puts no record in from a bag that LOST the mark, so the mark fails closed', () => {
    // The install acts on a positive `false` only. A projection or a new
    // constructor that dropped the field must not reopen the eleventh path by
    // reading as an absent row.
    const ctx = fakeCtx();
    const { recordWithheld: _dropped, ...unmarked } = loadedFixture({
      state: null,
      durableRev: null,
      plotId: MINTED_PLOT_ID,
      hearthReadyAtMs: 90_000,
    });
    installLoadedFreehold(ctx, ACCOUNT_ID, unmarked as unknown as LoadedFreehold);
    expect(ctx.freeholds.size).toBe(0);
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('installs NOTHING over a record that is already live, whatever it carries', () => {
    // THE SAFE FORM'S DEFINING PROPERTY. The unsafe form stamps the minted
    // identity onto whatever record exists, which rewrites a freshly SEEDED
    // default's identity to the minted name and kills the seal's name
    // comparison and, through the stand-in test, both continuity arms with it.
    // Going through loadFreehold is what makes that impossible: it is load-once.
    const ctx = fakeCtx();
    ctx.freeholds.set(OWNER_KEY, defaultFreeholdState(OWNER_KEY, PENDING_FREEHOLD_PLOT_ID));
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({ state: null, durableRev: null, plotId: MINTED_PLOT_ID }),
    );
    expect(ctx.freeholds.get(OWNER_KEY)?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(ctx.freeholds.size).toBe(1);
  });

  it('installs nothing for an absent load whose identity the WIRE would refuse', () => {
    // The identity crosses the same spread bag every other field here does, and
    // one the wire refuses would make every later build-presence frame fail at
    // the type boundary with no diagnostic at all. An unchecked identity is not
    // installed and the account falls back to the stand-in, which is what it
    // had before this arm existed.
    for (const bad of ['', 'plot/slash', 'plot:' + 'x'.repeat(64)]) {
      const ctx = fakeCtx();
      installLoadedFreehold(
        ctx,
        ACCOUNT_ID,
        loadedFixture({ state: null, durableRev: null, plotId: bad }),
      );
      expect(ctx.freeholds.size, bad).toBe(0);
    }
  });

  it('COUPLES the install to the seal: a reseed over an INSTALLED identity is refused', () => {
    // THE COUPLING AT UNIT SCALE. The three flipped seal cases used to set the
    // live identity by fixture, so reverting the install arm left all three
    // green and this was the eighth path's whole regression protection. Since
    // the harness was rebuilt on one live map they reach their records through
    // the real install and the real seed too; this stays as the statement of
    // the coupling with nothing but the sim in it: BOTH identities come from the
    // real sim, the record the install created and the record
    // ensureFreeholdRecord seeds after an eviction. Revert the install and it
    // reds on the first line.
    const ctx = fakeCtx();
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({ state: null, durableRev: null, plotId: MINTED_PLOT_ID }),
    );
    const installed = ctx.freeholds.get(OWNER_KEY);
    expect(installed, 'the absent arm must install a record').toBeDefined();
    if (!installed) return;
    // What applyWriteResult would cache after a commit: the LIVE record's
    // identity, with the content the session went on to build.
    const committed = persistedFreeholdFromState({ ...installed, tier: 'cottage', rev: 7 });
    expect(committed.plotId).toBe(MINTED_PLOT_ID);

    // The record is evicted at the last session out and reseeded on the next
    // join with no install in front of it, which is the window the seal exists
    // for. Its revision then catches up, which is what defeats both continuity
    // arms and leaves the name comparison as the only thing standing.
    evictFreehold(ctx, OWNER_KEY);
    const reseeded = ensureFreeholdRecord(ctx, OWNER_KEY);
    expect(reseeded?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    if (!reseeded) return;
    const seedDoc = persistedFreeholdFromState({ ...reseeded, rev: 9 });
    expect(seedWouldLandOnRealRow(seedDoc, { state: committed, durableRev: '2' })).toBe(true);
  });

  it('installs nothing on the absent arm of a DARK host', () => {
    // loadFreehold honors the flag, so the arm cannot seed a dark realm. Without
    // this the new install would be the one record inserter that ignores it.
    const ctx = fakeCtx(false);
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({ state: null, durableRev: null, plotId: MINTED_PLOT_ID }),
    );
    expect(ctx.freeholds.size).toBe(0);
  });

  it('installs no PLOT for a held load, but keeps the durable hearth clock', () => {
    // The clock is a separate durable fact. An account whose plot row cannot be
    // read still has a Hearth cooldown, and dropping it because the plot was
    // held would hand that account a free travel on every login, on exactly the
    // accounts already in a recovery state.
    const ctx = fakeCtx();
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({
        hold: { kind: 'malformed', detail: 'bad layout', plotIndex: 0, durableRev: '7' },
        hearthReadyAtMs: 90_000,
      }),
    );
    expect(ctx.freeholds.size).toBe(0);
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('keeps the durable hearth clock when the account has no plot row at all', () => {
    // The clock is installed on the absent arm too, above the plot entirely, so
    // an account with no row still carries its Hearth cooldown. The plot half of
    // this answer now seeds the default that carries the minted identity, which
    // is a separate claim pinned above; what this case owns is the clock.
    const ctx = fakeCtx();
    installLoadedFreehold(
      ctx,
      ACCOUNT_ID,
      loadedFixture({
        state: null,
        durableRev: null,
        plotId: MINTED_PLOT_ID,
        hearthReadyAtMs: 90_000,
      }),
    );
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('installs the CLOCK even from a bag whose plot state lost its shape', () => {
    // The two are independent durable facts. Coupling them means one malformed
    // field costs the owner both, including a travel cooldown they already
    // spent.
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, {
      ...loadedFixture({ hearthReadyAtMs: 90_000 }),
      state: 'not an object',
    } as unknown as LoadedFreehold);
    expect(ctx.freeholds.size).toBe(0);
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('installs the PLOT even from a bag whose clock lost its shape', () => {
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, {
      ...loadedFixture(),
      hearthReadyAtMs: 'soon',
    } as unknown as LoadedFreehold);
    expect(ctx.freeholds.size).toBe(1);
    expect(ctx.freeholdKeyReadyAtMs.size).toBe(0);
  });

  it('installs nothing when there is no load at all', () => {
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, undefined);
    expect(ctx.freeholds.size).toBe(0);
  });

  it('moves the hearth clock forward when the durable clock is ahead', () => {
    const ctx = fakeCtx();
    ctx.freeholdKeyReadyAtMs.set(OWNER_KEY, 1_000);
    installLoadedFreehold(ctx, ACCOUNT_ID, loadedFixture({ hearthReadyAtMs: 90_000 }));
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('leaves the hearth clock alone when the durable clock is behind', () => {
    const ctx = fakeCtx();
    ctx.freeholdKeyReadyAtMs.set(OWNER_KEY, 90_000);
    installLoadedFreehold(ctx, ACCOUNT_ID, loadedFixture({ hearthReadyAtMs: 1_000 }));
    expect(ctx.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(90_000);
  });

  it('is discarded by the load-once rule when it runs after the default seed', () => {
    const ctx = fakeCtx();
    // What the join seed would have put there first.
    ctx.freeholds.set(OWNER_KEY, {
      ownerKey: OWNER_KEY,
      plotId: 'plot:unassigned',
      tier: 'inn_room',
      layout: [],
      trophies: [],
      condition: 100,
      conditionStampDay: 0,
      ledgerPaidThroughDay: 0,
      ledgerPrepaidWeeks: 0,
      visitPolicy: 'closed',
      isDecorating: false,
      rev: 0,
    } as never);
    installLoadedFreehold(ctx, ACCOUNT_ID, loadedFixture());
    expect(ctx.freeholds.get(OWNER_KEY)?.plotId).toBe('plot:unassigned');
  });

  it('installs no hearth clock on a dark host either', () => {
    // The record inserters honor the flag MECHANICALLY, and the durable clock is
    // the third writer of sim-owned housing state fed from a durable read. Its
    // dark-host guarantee used to be a property of two facts in other files: the
    // composition root gates the preload, and the unavailable answer carries a
    // zero clock the forward-only merge already refuses. Neither is this
    // module's, so the guard is here and this is what proves it.
    const ctx = fakeCtx(false);
    installLoadedFreehold(ctx, ACCOUNT_ID, {
      accountId: ACCOUNT_ID,
      plotIndex: 0,
      plotId: ROW_PLOT_ID,
      durableRev: '7',
      state: persistedFixture(),
      hearthReadyAtMs: 9_000,
      hearthRevision: '3',
      hold: null,
      recordWithheld: false,
    });
    expect(ctx.freeholds.size).toBe(0);
    expect(ctx.freeholdKeyReadyAtMs.size).toBe(0);
    // The LIT contrast, so this is not a stopped installer.
    const lit = fakeCtx(true);
    installLoadedFreehold(lit, ACCOUNT_ID, {
      accountId: ACCOUNT_ID,
      plotIndex: 0,
      plotId: ROW_PLOT_ID,
      durableRev: '7',
      state: persistedFixture(),
      hearthReadyAtMs: 9_000,
      hearthRevision: '3',
      hold: null,
      recordWithheld: false,
    });
    expect(lit.freeholdKeyReadyAtMs.get(OWNER_KEY)).toBe(9_000);
  });
});

describe('the coordinator side of the wiring (source pins)', () => {
  // server/game.ts and server/main.ts are not unit-drivable (one boots a world
  // loop, the other a server and a pool), so the ORDER guarantees this store
  // depends on are pinned structurally, on comment-stripped source, in the
  // tests/server/main_retention_wiring.test.ts idiom. Every needle is a CALL
  // form so an import line can never satisfy one, and prose describing the
  // order can never keep a broken order green.
  const GAME = stripComments(
    readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8'),
  );
  const MAIN = stripComments(
    readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8'),
  );

  it('scans the real coordinators (the presence control for the order pins)', () => {
    expect(GAME).toContain('this.sim.addPlayer(');
    expect(GAME).toContain('this.sim.removePlayer(');
    expect(MAIN).toContain('createWsAuth(');
  });

  it('installs the durable record BEFORE the sim seeds its default', () => {
    // loadFreehold and ensureFreeholdRecord are both LOAD-ONCE. A call placed
    // after addPlayer is a silent no-op that discards the owner's real plot and
    // leaves them standing in an empty Inn Room, which the next sweep would
    // then write over their furnishings. This ordering is the whole guard.
    // BOTH HALVES, in the two files they now live in. The coordinator binds
    // before the seed; the binding module does validate-install-retain inside
    // that one call. Splitting the assertion is what keeps it decisive after the
    // extraction: an ordering pin on the coordinator alone would pass however
    // the binding module ordered its two statements.
    const body = methodBody(GAME, '  join(');
    const bind = body.indexOf('bindFreeholdOnJoin(');
    const addPlayer = body.indexOf('this.sim.addPlayer(');
    expect(bind).toBeGreaterThan(-1);
    expect(addPlayer).toBeGreaterThan(-1);
    expect(bind).toBeLessThan(addPlayer);
    // The retain is SYNCHRONOUS on the join path and ahead of the seed, so a
    // same-account character swap (whose fire-and-forget leave releases the old
    // session) can never drop the entry under the arriving one. It carries the
    // account id, which is what lets the store re-read a row whose entry went
    // away between the handshake's preload and here.
    // What goes in is the store's answer AT INSTALL TIME (ruling (b)), decided
    // in the same synchronous run, never the handshake's answer as it arrived.
    const binding = stripComments(readFileSync('server/freehold_session_binding.ts', 'utf8'));
    const install = binding.indexOf(
      'installLoadedFreehold(ctx, accountId, store.answerForInstall(ownerKey, accountId, loaded))',
    );
    const retain = binding.indexOf('store.retain(ownerKey, accountId)');
    expect(install).toBeGreaterThan(-1);
    expect(retain).toBeGreaterThan(install);
    expect(binding.split('installLoadedFreehold(').length - 1, 'one install').toBe(1);
    // And it is SYNCHRONOUS: an async binding would let the seed land first.
    expect(binding).not.toContain('export async function bindFreeholdOnJoin');
  });

  it('releases the store reference if the seed throws, so no reference leaks', () => {
    // The retain is paired with the leave a COMPLETED join guarantees. A throw
    // out of addPlayer means there is no session to leave, so without this the
    // reference is held for the life of the process and the entry can never be
    // collected. Pinned structurally because a throwing addPlayer is not
    // reachable from a unit test of this store.
    const body = methodBody(GAME, '  join(');
    const addPlayer = body.indexOf('this.sim.addPlayer(');
    const release = body.indexOf('releaseFreeholdBinding(this.freeholdPersist, freeholdOwnerKey)');
    expect(release).toBeGreaterThan(addPlayer);
    // INSIDE THE CATCH BLOCK, not merely after it. A slice-contains-catch test
    // is satisfied by a release moved out to just past the closing brace, and
    // that release runs on every SUCCESSFUL join: refs drops to zero while the
    // player is online, the orphan sweep collects the entry, and the session's
    // edits are discarded at logout with no hold and no counter. This reads the
    // block itself: from `catch (err) {` to the release there is no closing
    // brace, so the release is still inside it.
    const catchAt = body.indexOf('catch (err) {', addPlayer);
    expect(catchAt).toBeGreaterThan(addPlayer);
    expect(catchAt).toBeLessThan(release);
    expect(body.slice(catchAt + 'catch (err) {'.length, release)).not.toContain('}');
    // Exactly two releases in the whole join: the catch, and the guard below.
    expect(body.split('releaseFreeholdBinding(').length - 1).toBe(2);
    // AND THE WHOLE WINDOW, not addPlayer alone. A dozen throwable calls sit
    // between the seed and the `clients.set` that makes this session leavable,
    // and a throw in any of them leaks the same reference and leaves a seeded
    // record with no removePlayer to evict it, both for the process lifetime.
    const guarded = body.indexOf('let joined = false;');
    const closed = body.indexOf('joined = true;');
    const finallyRelease = body.indexOf(
      'releaseFreeholdBinding(this.freeholdPersist, freeholdOwnerKey)',
      release + 1,
    );
    expect(guarded).toBeGreaterThan(addPlayer);
    expect(closed).toBeGreaterThan(guarded);
    expect(finallyRelease).toBeGreaterThan(closed);
    // INSIDE THE FINALLY BLOCK, read the same way as the catch above. A
    // contains-'finally' test is satisfied by a release moved out past the
    // block's closing brace, which is the identical hole this case already
    // closes one line up for the catch: from `finally {` to the release there
    // is no closing brace, so the release is still inside it.
    const finallyAt = body.indexOf('finally {', closed);
    expect(finallyAt).toBeGreaterThan(closed);
    expect(finallyAt).toBeLessThan(finallyRelease);
    expect(body.slice(finallyAt + 'finally {'.length, finallyRelease)).not.toContain('}');
    // The record the seed inserted is taken back out with it, or nothing evicts it.
    expect(body.slice(finallyRelease)).toContain('this.sim.removePlayer(pid)');
    expect(body.indexOf('this.clients.set(pid, session)')).toBeLessThan(closed);
  });

  it('gives the reference back even when the flush rejects', () => {
    // THE SWALLOW MOVED, AND NOTHING PINNED IT. It used to sit at the call site
    // in server/game.ts and is now in the binding module that owns the pairing,
    // which is the right home and a place no reader of the leave path will look.
    // If a later edit drops it, flushAndRelease's rejection escapes the leave's
    // `finally` ABOVE the lease release and removePlayer, stranding the entry and
    // the seeded record for the life of the process: invariant 1 territory, and
    // unreachable from a unit test of this store because every caller is the
    // coordinator. The old call-site catch was unpinned too, so coverage did not
    // regress; it was never there.
    const binding = stripComments(readFileSync('server/freehold_session_binding.ts', 'utf8'));
    // Sliced by hand: methodBody closes on a two-space brace, and this is a
    // top-level function whose body closes at column zero.
    const opens = binding.indexOf('export async function flushFreeholdBinding(');
    expect(opens).toBeGreaterThan(-1);
    const body = binding.slice(opens, binding.indexOf('\n}', opens));
    expect(body).toContain('.flushAndRelease(ownerKey)');
    expect(body).toContain('.catch(');
    // And it is the FLUSH that is caught, not something after it: the release is
    // the half that must happen, so the catch has to sit on that same promise.
    const flushAt = body.indexOf('.flushAndRelease(ownerKey)');
    expect(body.slice(flushAt)).toContain('.catch(');
    expect(body.slice(0, flushAt)).not.toContain('.catch(');
  });

  it('flushes the plot after the character save and before the record is evicted', () => {
    // removePlayer reaches releaseFreeholdOnLeave, which evicts once the last
    // session sharing the owner key leaves; serializeFreehold then answers null
    // and a flush placed after it writes nothing, silently.
    // ACROSS BOTH HALVES, because the leave path is now a settlement inside a
    // try and three release lines inside its finally. The character save is in
    // the settlement; the plot flush, the lease release and removePlayer are in
    // the finally, in that order.
    const body = methodBody(GAME, '  async leave(session: ClientSession, _reason: string)');
    const settle = body.indexOf('await this.settleLeavingSession(session)');
    const guard = body.indexOf('} finally {');
    const plotFlush = body.indexOf('flushFreeholdBinding(this.freeholdPersist,');
    const removePlayer = body.indexOf('this.sim.removePlayer(');
    const leaseRelease = body.indexOf('releaseCharacterLease(');
    const settlement = methodBody(GAME, '  private async settleLeavingSession(');
    const characterSave = settlement.indexOf('await this.saveCharacterOnLeave(session)');
    expect(characterSave).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(settle);
    expect(plotFlush).toBeGreaterThan(guard);
    expect(removePlayer).toBeGreaterThan(plotFlush);
    // AND ALL THREE RUN ON EVERY EXIT. All three callers invoke leave() as
    // `void this.leave(...)` with no catch, so a rejection in the settlement
    // used to skip the store release, the lease release and removePlayer
    // permanently: a pinned entry, a record nothing evicts, and a character
    // lease held to its TTL.
    // NOTHING between the settlement and the guard: the try holds that one call,
    // so every statement that can reject is inside it.
    expect(body.slice(settle, guard).replace(/\s+/g, ' ').trim()).toBe(
      'await this.settleLeavingSession(session);',
    );
    // The key is READ off the session, never re-derived: deriving it here would
    // put freeholdOwnerKeyForAccount's throw above all three lines.
    expect(body).toContain('const freeholdOwnerKey = session.freeholdOwnerKey;');
    expect(body).not.toContain('freeholdOwnerKeyForAccount(');
    // And inside this process's lease window: once the lease drops, a
    // replacement process can load the same account's plot and write it.
    expect(leaseRelease).toBeGreaterThan(plotFlush);
  });

  it('gives the four session REGISTRATIONS back on every exit, not at the end of the settlement', () => {
    // THE HOLE THE THREE RELEASES ABOVE DID NOT COVER. The settlement's own tail
    // still held four registrations, so a rejection anywhere above them (a final
    // save that exhausts its five attempts, then a guild-book revert that
    // faults) skipped all four while the finally released the freehold
    // reference, the lease and the sim entity. The character was then gone from
    // `clients` and from the sim while `sessionsByCharacterId` still mapped it:
    // planJoin answered 'character already in world' for every later login for
    // the life of the process, takeOverCharacter reported success and changed
    // nothing, and every whisper, mail and party lookup kept resolving to the
    // dead session and sending into a closed socket.
    const body = methodBody(GAME, '  async leave(session: ClientSession, _reason: string)');
    const settlement = methodBody(GAME, '  private async settleLeavingSession(');
    const guard = body.indexOf('} finally {');
    expect(guard).toBeGreaterThan(-1);
    for (const registration of [
      'this.sessionsByCharacterId.delete(session.characterId)',
      'this.guildBookHolders.dropSession(session)',
      'session.bankLedgerJournal.outbox.discard()',
      'storageRecovery.offline(session.characterId)',
    ]) {
      const at = body.indexOf(registration);
      expect(at, registration).toBeGreaterThan(guard);
      // AND NOWHERE ELSE. Left in the settlement as well, the throw path is
      // fixed and the healthy path runs each of them twice.
      expect(settlement, registration).not.toContain(registration);
    }
    // BEFORE the flush, the lease release and removePlayer, all of which await:
    // the registrations are what makes the character re-enterable, and holding
    // them behind a durable write is how a slow database becomes a locked-out
    // player.
    expect(body.indexOf('this.sessionsByCharacterId.delete(session.characterId)')).toBeLessThan(
      body.indexOf('flushFreeholdBinding(this.freeholdPersist,'),
    );
    // IDENTITY-GUARDED, AND THE GUARD COVERS BOTH CHARACTER-KEYED CALLS. A
    // same-account character swap sets the new session before the old one's
    // fire-and-forget leave arrives here, so an unguarded delete evicts the live
    // session's own registration, and an unguarded storageRecovery.offline marks
    // a LIVE character offline: it drops that character's gold-rail ordering
    // hold and its recovery-drive hold and makes it a capacity-eviction
    // candidate. The other two are keyed by session identity and cannot reach a
    // sibling, which is why only these two are guarded.
    expect(body).toContain(
      'const stillMine = this.sessionsByCharacterId.get(session.characterId) === session;',
    );
    expect(body).toContain(
      'if (stillMine) this.sessionsByCharacterId.delete(session.characterId);',
    );
    expect(body).toContain('if (stillMine) storageRecovery.offline(session.characterId);');
    // THE REVERT RUNS FIRST, above both index drops. Dropping a session from
    // them without reverting its unflushed ops strands uncommitted money deltas
    // on the live book: no mark for the disband guard, no session for the settle
    // gate, and the next officer's op serializes that book and commits them.
    // BOTH drops, which is what the sentence above claims: asserting only the
    // holder index left the OTHER one, the character map, free to move above the
    // revert, and that is the index whose ordering the money argument is about.
    const revert = body.indexOf('this.reconcileOwnGuildBooks(session)');
    expect(revert).toBeGreaterThan(guard);
    expect(revert).toBeLessThan(body.indexOf('this.guildBookHolders.dropSession(session)'));
    expect(revert).toBeLessThan(
      body.indexOf('if (stillMine) this.sessionsByCharacterId.delete(session.characterId);'),
    );
    // AND NOWHERE ELSE ON THE LEAVE PATH: left in the settlement as well, the
    // throw path is fixed and the healthy path reverts twice.
    expect(settlement).not.toContain('this.reconcileOwnGuildBooks(session)');
  });

  it('registers the store once and tears its timers down with the coordinator', () => {
    expect(GAME.split('registerFreeholdPersistStore(').length - 1).toBe(1);
    expect(GAME.split('createGameFreeholdPersistStore(').length - 1).toBe(1);
    expect(GAME).toContain('this.freeholdPersist.stop();');
    // The guild-bank loader keeps its pinned position as stop()'s FIRST
    // statement, so the housing teardown lands after it, never before.
    const stopBody = methodBody(GAME, '  stop(): void {');
    const guildStop = stopBody.indexOf('this.guildBankLazyLoader.stop();');
    const freeholdStop = stopBody.indexOf('this.freeholdPersist.stop();');
    expect(guildStop).toBeGreaterThan(-1);
    expect(freeholdStop).toBeGreaterThan(guildStop);
  });

  it('sweeps the plots on the periodic flush, exactly once', () => {
    const body = methodBody(GAME, '  private flushPeriodicSaves(');
    expect(body.split('this.saveFreeholds(').length - 1).toBe(1);
    expect(body).toContain('AUTOSAVE_SECONDS');
  });

  it('pays no durable housing query on a dark realm, and answers a hold rather than absence', () => {
    // The realm flag is read LIVE per fresh join. Dark must answer a HOLD: an
    // absence would invite the store to generate an identity and persist an
    // empty default over a row this realm never read.
    expect(MAIN).toContain('game.sim.ctx.freeholdsEnabled');
    expect(MAIN).toContain('freeholdPreloadForAccount(id, opts)');
    expect(MAIN).toContain('freeholdPreloadUnavailable(id,');
    // THE CONTIGUOUS CLAUSE, not three index comparisons. Both call forms sit
    // after the gate text whichever arm each one occupies, so an ordering pin
    // passes with the two arms SWAPPED: a lit realm answering every join with a
    // hold, and a dark realm issuing a durable read per join, both green.
    // Verified by applying that exact swap to this file's own text and re-running
    // the old arithmetic. This reads the ternary itself, the way the DDL CHECK
    // pins in tests/server/freehold_db.test.ts read theirs.
    const clause = MAIN.replace(/\s+/g, ' ');
    expect(clause).toContain(
      'freeholdForAccount: (id, opts) => game.sim.ctx.freeholdsEnabled ' +
        '? freeholdPreloadForAccount(id, opts) ' +
        ': Promise.resolve(freeholdPreloadUnavailable(id,',
    );
    // ONE SOURCE for the join path's decision. The store's own port reads
    // ctx.freeholdsEnabled, and so do both record inserters and retain's repair
    // reload; a live process.env read here disagreed with all of them across an
    // in-process flag flip. The live read belongs to the wire and the route.
    expect(clause).not.toContain('freeholdsEnabled(process.env)');
  });
});

describe('the combined login port, which is what the server actually binds', () => {
  // EVERY OTHER CASE IN THIS FILE DRIVES THE FALLBACK. The two-port readRow and
  // readHearth pair is what the harness binds by default and what the store calls
  // on a host with no transaction seam; the real server binds readDurables, one
  // bounded transaction over both statements. A suite that never drives the
  // production arm cannot notice the two disagreeing, which is exactly what they
  // did before this block existed.
  it('is preferred over the two-port pair, and reads the same byte ceiling', async () => {
    const h = harness({
      readDurables: async (_accountId, _maxOwnedBytes) => ({
        row: { kind: 'absent' as const },
        hearth: { kind: 'absent' as const },
      }),
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    // ONE read, not three: the pair must not run beside the combined port.
    expect(h.calls).toEqual(['permit', 'readDurables', 'release']);
    expect(h.ownedBytesSeen).toEqual([FREEHOLD_MAX_STORED_BYTES]);
    // And a genuinely absent row still resolves to absence, which is the ONE
    // case allowed to become the free tier-0 default.
    expect(loaded.hold).toBeNull();
    expect(loaded.state).toBeNull();
    expect(loaded.durableRev).toBeNull();
  });

  it('carries a THROWN clock as a value: the clock goes cold, the plot does not hold', async () => {
    // The whole reason the port's hearth field is a union rather than a rejection.
    // On one shared transaction a rejecting clock read would roll the row back
    // with it, turning a clock fault into a write-blocking hold on the house.
    const h = harness({
      readDurables: async () => ({
        row: { kind: 'row' as const, row: rowFixture({ durableRev: '4' }) },
        hearth: { kind: 'threw' as const, error: new Error('clock read exploded') },
      }),
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    // THE PLOT LANDED. Not a hold, not an absence: the row's own state.
    expect(loaded.hold).toBeNull();
    expect(loaded.state).not.toBeNull();
    expect(loaded.durableRev).toBe('4');
    // THE CLOCK IS COLD, and the failure is reported rather than swallowed silently.
    expect(loaded.hearthReadyAtMs).toBe(0);
    expect(loaded.hearthRevision).toBe('0');
    // DO NOT TRIM THE NEXT LINE. It is the only assertion here that kills a
    // mutant deleting coldHearth: normalizeHearthLoad falls through to the same
    // zero and the same '0', so the two values above cannot tell them apart, and
    // the log is the only evidence that the failure was noticed at all.
    expect(h.errors.join(' ')).toContain('freehold hearth clock read failed');
  });

  it('answers a HOLD when the ROW half rejects, exactly as the two-port pair does', async () => {
    // The asymmetry stated in one place: the plot fails CLOSED, the clock fails
    // open. A rejecting port takes the row with it, and loadOnce turns that into
    // a hold, so nothing is written over a row this host could not read.
    const h = harness({
      readDurables: async () => {
        throw new Error('row read exploded');
      },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('read_threw');
    expect(loaded.state).toBeNull();
    // WRITE-BLOCKED for the session, which is invariant 1. The join's retain
    // re-reads the unloaded entry and the port throws again.
    h.join(loaded);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(20);
    expect(h.writes).toEqual([]);
  });

  it('answers claim_busy with a REPAIRABLE hold that installs nothing and writes nothing (07a)', async () => {
    // Another realm holds the plot's live claim, so the login read never read
    // the row. Capacity, not data: the entry must stay UNLOADED (so the re-ask
    // reads again), held, and write-blocked, and the join must install nothing.
    let busy = true;
    const h = harness({
      readDurables: async () => ({
        row: busy
          ? { kind: 'claim_busy' as const, plotIndex: 0, plotId: ROW_PLOT_ID }
          : { kind: 'row' as const, row: rowFixture({ durableRev: '7' }) },
        hearth: { kind: 'absent' as const },
      }),
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('claim_busy');
    expect(loaded.state).toBeNull();
    expect(loaded.durableRev).toBeNull();
    expect(h.store.stats()).toMatchObject({
      loaded: 0,
      held: 1,
      loadFailuresByKind: { claim_busy: 1 },
    });
    // The store remembers nothing it may serve.
    expect(h.store.authority(OWNER_KEY)).toEqual({
      loaded: false,
      blocked: true,
      plotId: '',
      durableRev: null,
    });
    // INSTALLS NOTHING: the join seats the sim's own default, never the row.
    h.join(loaded);
    expect(h.record()?.plotId).toBe(PENDING_FREEHOLD_PLOT_ID);
    expect(h.record()?.layout).toEqual([]);
    // WRITES NOTHING, however the save is asked for, while the claim is busy.
    h.calls.length = 0;
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writes).toEqual([]);
    expect(h.writeCount()).toBe(0);
    // REPAIRABLE: once the claim frees, a later login reads again and the row
    // lands, rather than the refusal replaying for the life of the entry.
    await h.leave();
    busy = false;
    h.calls.length = 0;
    const again = await h.store.preload(ACCOUNT_ID);
    expect(h.calls).toContain('readDurables');
    expect(again.hold).toBeNull();
    expect(again.durableRev).toBe('7');
  });

  it('resolves a malformed clock payload the SAME WAY on both port shapes', async () => {
    // THE DIVERGENCE THIS CASE EXISTS FOR. readLoginPair used to normalize the
    // combined arm's clock outside the `try` the fallback arm had, so a payload
    // that threw inside normalizeHearth answered a cold clock on one host and
    // held the whole login on the other. Which port a host binds must not decide
    // whether an account can write this session. ONE payload through BOTH arms,
    // and each arm asserted against fixed literals rather than against the other:
    // comparing the two would pass if both regressed the same way.
    const malformed = { kind: 'state', state: null } as unknown as FreeholdHearthLoad;
    const viaPair = await harness({
      rowLoad: { kind: 'row', row: rowFixture({ durableRev: '2' }) },
      readHearth: async () => malformed,
    }).store.preload(ACCOUNT_ID);
    const viaCombined = await harness({
      readDurables: async () => ({
        row: { kind: 'row' as const, row: rowFixture({ durableRev: '2' }) },
        hearth: malformed,
      }),
    }).store.preload(ACCOUNT_ID);
    // Neither holds, both land the plot, both start the clock cold.
    for (const loaded of [viaPair, viaCombined]) {
      expect(loaded.hold).toBeNull();
      expect(loaded.durableRev).toBe('2');
      expect(loaded.hearthReadyAtMs).toBe(0);
      expect(loaded.hearthRevision).toBe('0');
    }
  });
});

describe('the composition root that binds the combined port (source pins)', () => {
  // A SURVIVING MUTANT PUT THIS BLOCK HERE. Removing the clock swallow left all
  // 180 cases green, and `tsc` stays silent because dropping the `threw` arm only
  // NARROWS the value against the port's declared union. Nothing in this suite
  // imports the wiring module (it binds the real pool at module scope), so the
  // properties that make a shared transaction safe had no coverage of any kind.
  // These are structural pins, which is the honest tool for a binding whose real
  // behaviour needs a live pool; the transaction semantics they rest on were
  // measured against PostgreSQL and are recorded in section 8a of the rollout
  // contract.
  const WIRING = stripComments(readFileSync('server/freehold_persist_wiring.ts', 'utf8'));
  /** One port binding's own text, from its key to the next sibling key. Scoping
   *  matters more than usual here: an earlier version of the swallow pin ran its
   *  window to the next `}),` and so covered the WHOLE factory tail, which an
   *  identical catch attached to any other port would have satisfied. */
  const binding = (key: string, nextKey: string): string => {
    const at = WIRING.indexOf(`${key}:`);
    expect(at).toBeGreaterThan(-1);
    const stop = WIRING.indexOf(`${nextKey}:`, at);
    expect(stop).toBeGreaterThan(at);
    return WIRING.slice(at, stop);
  };

  it('binds BOTH login statements to ONE bounded transaction, through the policy', () => {
    const durables = binding('readDurables', 'writeRow').replace(/\s+/g, ' ');
    // THROUGH THE CLAIMED POLICY MODULE (07a): the realm binds the login read
    // that takes the plot's global claim, server/freehold_claim_login.ts, and
    // nothing else. The closures in this file bind the real pool at module
    // scope, so nothing imports them; this pin is that the binding uses the
    // policy, and the cases below pin and drive the policy itself.
    expect(durables.split('readClaimedLoginDurables(').length - 1).toBe(1);
    expect(durables).toContain('registry: deps.claims,');
    expect(durables).toContain('holder: PROCESS_LEASE_HOLDER,');
    expect(durables).toContain('ttlSeconds: LEASE_TTL_SECONDS,');
    // The unclaimed 07 policy is gone from the binding, and so is the outer
    // statement wrapper: the ONE bounded transaction is the policy's own, and
    // a second wrapper here would be the two-transaction defect again.
    expect(durables).not.toContain('readLoginDurables');
    expect(durables).not.toContain('runWithStatementTimeout(');
    // BOTH reads on the transaction's own client, never on the pool: a
    // statement sent to `pool` runs on a different client and escapes the
    // bound and the claim entirely.
    expect(durables).toContain(
      'readRow: (db) => freeholdForAccount(db, accountId, maxOwnedBytes),',
    );
    expect(durables).toContain('readHearth: (db) => loadFreeholdHearth(db, accountId),');
    expect(durables).not.toContain('freeholdForAccount(pool');
    expect(durables).not.toContain('loadFreeholdHearth(pool');
  });

  it('runs the claimed login as ONE bounded transaction: the clock first, the claim before the row', () => {
    const policy = stripComments(readFileSync('server/freehold_claim_login.ts', 'utf8')).replace(
      /\s+/g,
      ' ',
    );
    // TWO transactions in the source and no more: the one that carries both
    // reads, and the clock-fault retry that carries the plot half ALONE.
    expect(policy.split('runFreeholdTransaction(').length - 1).toBe(2);
    const main = policy.indexOf(
      'runFreeholdTransaction( deps.pool, FREEHOLD_CLAIM_LOGIN_BOUNDS, async (tx) => {',
    );
    expect(main).toBeGreaterThan(-1);
    const retry = policy.indexOf(
      'runFreeholdTransaction( deps.pool, FREEHOLD_CLAIM_LOGIN_BOUNDS, plotHalf, budget, )',
    );
    expect(retry).toBeGreaterThan(main);
    // ONE budget for the whole read: minted once, and both transactions carry
    // it, so the clock-fault retry and both checkouts spend the same clock.
    expect(policy.split('AbortSignal.timeout(').length - 1).toBe(1);
    expect(policy.indexOf('return plotHalf(tx); }, budget, );', main)).toBeGreaterThan(main);
    // CLOCK FIRST, inside the one transaction, then the plot half on the SAME
    // `tx`: a clock fault then aborts before any claim statement, so it can
    // never roll a claim back unseen.
    const clock = policy.indexOf('hearth = await deps.readHearth(tx);', main);
    const plot = policy.indexOf('return plotHalf(tx);', main);
    expect(clock).toBeGreaterThan(main);
    expect(plot).toBeGreaterThan(clock);
    expect(plot).toBeLessThan(retry);
    // CLAIM BEFORE THE ROW, inside the plot half: the unlocked plot id read
    // (server/freehold_db.ts owns its SQL; this module carries none), then the
    // acquire (busy pre-check and upsert), then 07's row read.
    expect(policy).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b|\.query\(/);
    const half = policy.indexOf('const plotHalf = async (db: FreeholdQueryable)');
    const plotId = policy.indexOf('await freeholdPrimaryPlotIdOnClient(db, accountId);', half);
    const acquire = policy.indexOf('acquireFreeholdClaim(db, {', half);
    const row = policy.indexOf('return deps.readRow(db);', half);
    expect(half).toBeGreaterThan(-1);
    expect(plotId).toBeGreaterThan(half);
    expect(acquire).toBeGreaterThan(plotId);
    expect(row).toBeGreaterThan(acquire);
    expect(policy.split('deps.readRow(').length - 1).toBe(1);
    expect(policy.split('deps.readHearth(').length - 1).toBe(1);
    // The claim is RECORDED only after the transaction answered, never inside it.
    expect(policy.indexOf('record();', main)).toBeGreaterThan(plot);
    // THE BOUNDS, literally: 07's login statement bound, a lock bound under it,
    // an idle bound and the wall, sent as the one opening round trip.
    expect(FREEHOLD_CLAIM_LOGIN_BOUNDS).toEqual({
      operation: 'freehold login read',
      statementMs: 2_000,
      lockMs: 1_000,
      idleMs: 2_000,
      wallMs: 10_000,
    });
    expect(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS).toBe(2_000);
    expect(freeholdTxBeginSql(FREEHOLD_CLAIM_LOGIN_BOUNDS)).toBe(
      'BEGIN; SET LOCAL statement_timeout = 2000; SET LOCAL lock_timeout = 1000; SET LOCAL idle_in_transaction_session_timeout = 2000',
    );
  });

  it('binds all four LIVE-RECORD reads through the function this suite drives', () => {
    // A SURVIVING MUTANT closed this once: replacing the identity probe's
    // binding with `() => null` left every case green, because every case
    // supplied its own port and the BINDING was never executed. The four reads
    // are now ONE function, `freeholdLivenessPorts`, which the harness above
    // binds over its own live map, so every case in this file executes the
    // composition root's liveness answers; its own suite,
    // tests/server/freehold_liveness.test.ts, drives each read against a real
    // map. What is left to pin here is that the root really spreads it, over
    // the live sim context, and binds no liveness port of its own beside it.
    //
    // SCOPED TO THE STORE'S ARGUMENT, and every spelling of an override: a
    // colon key, a method, a shorthand, a quoted or computed key, or a second
    // bag spread in after it would each replace a read silently, and nothing
    // here executes the root to notice.
    const opens = WIRING.indexOf('createFreeholdPersistStore({');
    expect(opens).toBeGreaterThan(-1);
    const start = WIRING.indexOf('{', opens);
    let depth = 0;
    let end = start;
    for (; end < WIRING.length; end++) {
      if (WIRING[end] === '{') depth++;
      if (WIRING[end] === '}' && --depth === 0) break;
    }
    const argument = WIRING.slice(start, end + 1);
    const flat = argument.replace(/\s+/g, ' ');
    expect(flat).toContain('...freeholdLivenessPorts(() => deps.sim.ctx),');
    const livenessKey = /\b(hasLive|serialize|liveRev|livePlotId)\b/;
    expect(argument).not.toMatch(livenessKey);
    // The only spreads: the one binding, and the error port's argument list.
    expect(argument.match(/\.\.\.(?:\w+\(?|\()/g)).toEqual(['...freeholdLivenessPorts(', '...(']);
    expect(', ...bag,'.match(/\.\.\.(?:\w+\(?|\()/g)).toEqual(['...bag']);
    expect(WIRING.split('freeholdLivenessPorts(').length - 1).toBe(1);
    // The matcher sees every spelling, so the absence above is evidence.
    for (const spelling of [
      'hasLive: () => false,',
      'livePlotId(_ownerKey) { return null; },',
      '{ liveRev }',
      "'serialize': () => null,",
      "['hasLive']: () => false,",
    ]) {
      expect(spelling, spelling).toMatch(livenessKey);
    }
  });

  it('keeps the two-port fallback BOUNDED beside it, on the same constant', () => {
    // The pair every behaviour case in this file drives, and the store's declared
    // surface for a host with no transaction seam. Extracting the composition
    // root DROPPED both wrappers and left the pair on the pool's 15,000 ms
    // session default, while the file header claimed the move changed nothing. Dead on this host, because readDurables
    // is bound and the store prefers it, and pinned anyway: a fallback whose
    // bound silently differs from the real path is worse than no fallback.
    for (const [key, next] of [
      ['readRow', 'readHearth'],
      ['readHearth', 'readDurables'],
    ] as const) {
      const body = binding(key, next).replace(/\s+/g, ' ');
      expect(body).toContain('runWithStatementTimeout(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS');
      expect(body).toContain('({ query }');
      expect(body).not.toContain('(pool,');
    }
  });
});

describe('the claimed login read the realm binds, executed on a recording client (07a)', () => {
  // The source pins above say WHAT the realm binds; these drive it. A fake pool
  // whose clients record every statement in issue order, so ONE transaction is
  // a fact (one checkout, one opening round trip, one COMMIT) rather than a
  // reading of the source, and the clock-first and claim-before-row orders are
  // the order the statements actually went out in.
  const BEGIN_LINE =
    'BEGIN; SET LOCAL statement_timeout = 2000; SET LOCAL lock_timeout = 1000; SET LOCAL idle_in_transaction_session_timeout = 2000';

  /** Every statement as a short label, per checkout. Unrecognized text is kept
   *  verbatim so a statement this map does not know still shows up. */
  const label = (text: string): string => {
    if (text === BEGIN_LINE) return 'begin';
    if (text === 'COMMIT' || text === 'ROLLBACK') return text.toLowerCase();
    if (text.includes('FROM account_freeholds WHERE account_id = $1 AND plot_index = 0')) {
      return 'plot_id';
    }
    if (text.includes('holder <> $2 AND expires_at > clock_timestamp()')) return 'busy_check';
    if (text.includes('INSERT INTO freehold_plot_claims AS c')) return 'acquire';
    return text;
  };

  function recordingPool(script: {
    readonly busy?: boolean;
    readonly acquireError?: { readonly code: string };
    readonly commitTag?: string;
  }) {
    const checkouts: string[][] = [];
    const pool = {
      async connect() {
        const statements: string[] = [];
        checkouts.push(statements);
        return {
          async query(text: string) {
            statements.push(label(text));
            if (text === BEGIN_LINE) return { command: 'SET', rows: [], rowCount: null };
            if (text === 'COMMIT') {
              return { command: script.commitTag ?? 'COMMIT', rows: [], rowCount: null };
            }
            if (text === 'ROLLBACK') return { command: 'ROLLBACK', rows: [], rowCount: null };
            const which = label(text);
            if (which === 'plot_id') {
              return { command: 'SELECT', rows: [{ plot_id: ROW_PLOT_ID }], rowCount: 1 };
            }
            if (which === 'busy_check') {
              return script.busy
                ? { command: 'SELECT', rows: [{ one: 1 }], rowCount: 1 }
                : { command: 'SELECT', rows: [], rowCount: 0 };
            }
            if (which === 'acquire') {
              if (script.acquireError) {
                throw Object.assign(new Error('claim row contended'), script.acquireError);
              }
              return {
                command: 'INSERT',
                rows: [{ generation: '3', inserted: false, fresh: false }],
                rowCount: 1,
              };
            }
            return { command: 'SELECT', rows: [], rowCount: 0 };
          },
          release(): void {},
          on(): void {},
          removeListener(): void {},
        };
      },
    };
    return { pool: pool as never, checkouts };
  }

  function claimedLogin(
    script: Parameters<typeof recordingPool>[0],
    hearth: (db: { query(text: string): Promise<unknown> }) => Promise<FreeholdHearthLoad> = async (
      db,
    ) => {
      await db.query('SELECT hearth probe');
      return { kind: 'state', state: { readyAtMs: '90000', revision: '4' } };
    },
  ) {
    const { pool, checkouts } = recordingPool(script);
    const registry = createFreeholdClaimRegistry();
    const claimed: number[] = [];
    const run = () =>
      readClaimedLoginDurables(
        {
          pool,
          registry,
          holder: 'realm-a#holder-1',
          realm: 'realm-a',
          ttlSeconds: 30,
          readRow: async (db) => {
            await db.query('SELECT row probe');
            return { kind: 'row', row: rowFixture() };
          },
          readHearth: hearth,
          nowMs: () => 55_000,
          onClaimed: (accountId) => claimed.push(accountId),
        },
        ACCOUNT_ID,
      );
    return { run, checkouts, registry, claimed };
  }

  it('reads the clock, then the plot id, then the claim, then the row, on ONE checkout', async () => {
    const login = claimedLogin({});
    const got = await login.run();
    expect(got.row.kind).toBe('row');
    expect(got.hearth).toEqual({ kind: 'state', state: { readyAtMs: '90000', revision: '4' } });
    // ONE checkout, ONE opening round trip, BOTH reads on it, ONE COMMIT.
    expect(login.checkouts).toEqual([
      [
        'begin',
        'SELECT hearth probe',
        'plot_id',
        'busy_check',
        'acquire',
        'SELECT row probe',
        'commit',
      ],
    ]);
    // Recorded only after the tag-checked COMMIT, and the recovery hook told.
    expect(login.registry.forAccount(ACCOUNT_ID)).toEqual({
      plotId: ROW_PLOT_ID,
      accountId: ACCOUNT_ID,
      generation: '3',
      acquiredAtMs: 55_000,
    });
    expect(login.registry.counters.acquired).toBe(1);
    expect(login.claimed).toEqual([ACCOUNT_ID]);
  });

  it('records NO claim when COMMIT answers a ROLLBACK tag, and fails the plot closed', async () => {
    // The negative control for the line above: the same statements, but the
    // transaction proved nothing, so believing the claim would serve a plot
    // whose claim rolled back.
    const login = claimedLogin({ commitTag: 'ROLLBACK' });
    await expect(login.run()).rejects.toThrow('COMMIT answered ROLLBACK');
    expect(login.checkouts[0]).toContain('acquire');
    expect(login.registry.forAccount(ACCOUNT_ID)).toBeUndefined();
    expect(login.registry.counters.acquired).toBe(0);
    expect(login.claimed).toEqual([]);
  });

  it('a CLOCK fault aborts before any claim statement, and the plot half runs alone', async () => {
    const boom = new Error('hearth read exploded');
    let clockReads = 0;
    const login = claimedLogin({}, async () => {
      clockReads += 1;
      throw boom;
    });
    const got = await login.run();
    // The clock fails OPEN, carried as a value; the plot still lands.
    expect(got.hearth).toEqual({ kind: 'threw', error: boom });
    expect(got.row.kind).toBe('row');
    expect(clockReads).toBe(1);
    // The first transaction issued no claim statement before it rolled back,
    // and the second is the plot half alone, with no second clock read.
    expect(login.checkouts).toEqual([
      ['begin', 'rollback'],
      ['begin', 'plot_id', 'busy_check', 'acquire', 'SELECT row probe', 'commit'],
    ]);
    expect(login.registry.forAccount(ACCOUNT_ID)?.generation).toBe('3');
  });

  it("another realm's LIVE claim answers claim_busy and the row is never read", async () => {
    const login = claimedLogin({ busy: true });
    const got = await login.run();
    expect(got.row).toEqual({ kind: 'claim_busy', plotIndex: 0, plotId: ROW_PLOT_ID });
    // The clock it already read still rides out.
    expect(got.hearth).toEqual({ kind: 'state', state: { readyAtMs: '90000', revision: '4' } });
    expect(login.checkouts).toHaveLength(1);
    expect(login.checkouts[0].slice(0, 4)).toEqual([
      'begin',
      'SELECT hearth probe',
      'plot_id',
      'busy_check',
    ]);
    expect(login.checkouts[0]).not.toContain('acquire');
    expect(login.checkouts[0]).not.toContain('SELECT row probe');
    expect(login.registry.forAccount(ACCOUNT_ID)).toBeUndefined();
    expect(login.registry.counters.busy).toBe(1);
    expect(login.claimed).toEqual([]);
  });

  it('a 55P03 on the acquire is lock contention: claim_busy, counted apart, never the read hold', async () => {
    const login = claimedLogin({ acquireError: { code: '55P03' } });
    const got = await login.run();
    expect(got.row).toEqual({ kind: 'claim_busy', plotIndex: 0, plotId: ROW_PLOT_ID });
    expect(login.checkouts[0]).not.toContain('SELECT row probe');
    expect(login.registry.forAccount(ACCOUNT_ID)).toBeUndefined();
    // Busy, and the contention subset of busy: an operator can tell a held
    // claim row from another realm's live claim.
    expect(login.registry.counters.busy).toBe(1);
    expect(login.registry.counters.busyContention).toBe(1);
  });

  it('a 57014 on the acquire is a slow database, not a held row: the throw arm, never busy', async () => {
    const login = claimedLogin({ acquireError: { code: '57014' } });
    await expect(login.run()).rejects.toThrow('claim row contended');
    expect(login.registry.forAccount(ACCOUNT_ID)).toBeUndefined();
    expect(login.registry.counters.busy).toBe(0);
    expect(login.registry.counters.busyContention).toBe(0);
  });

  it("another realm's live claim is busy without the contention count", async () => {
    const login = claimedLogin({ busy: true });
    await login.run();
    expect(login.registry.counters.busy).toBe(1);
    expect(login.registry.counters.busyContention).toBe(0);
  });

  it('any OTHER acquire fault fails the plot closed (the contention control)', async () => {
    const login = claimedLogin({ acquireError: { code: '23505' } });
    await expect(login.run()).rejects.toThrow('claim row contended');
    expect(login.registry.forAccount(ACCOUNT_ID)).toBeUndefined();
    expect(login.registry.counters.busy).toBe(0);
  });
});

describe('the gaps a mutation pass over the store found', () => {
  it('an ADMISSION hold is repairable: not loaded, still write-blocked, and re-read', async () => {
    // RULING 2. `entry.loaded` is what preload's replay arms and retain's
    // lost-entry repair consult, and holdResult used to set it for every kind,
    // so an account refused by a CAPACITY blip replayed that refusal for the
    // life of the entry: measured with the shared gate saturated, eight of eight
    // logins at one join per second were refused and a lone re-join for a
    // refused account still replayed the hold. The four fixture classes sanction
    // a terminal hold for a DATA cause, where a repeat read cannot change the
    // answer, and none of them sanctions one for a capacity cause.
    // EVERY KIND IN THE SET, not one of them: the set is what holdResult reads,
    // so a case that drives only no_permit leaves deleting cap_full and
    // read_threw from it green. Each is produced by a different port fault.
    expect([...FREEHOLD_RETRYABLE_HOLD_KINDS].sort()).toEqual([
      'cap_full',
      'claim_busy',
      'no_budget',
      'no_permit',
      'read_threw',
    ]);
    // claim_busy (07a) is produced by the READ answering it: another realm
    // holds the plot's live claim, which is capacity, never data.
    for (const kind of ['cap_full', 'no_permit', 'read_threw', 'claim_busy'] as const) {
      const faulted = harness({
        rowLoad:
          kind === 'claim_busy'
            ? { kind: 'claim_busy', plotIndex: 0, plotId: ROW_PLOT_ID }
            : { kind: 'row', row: rowFixture() },
        acquirePermit:
          kind === 'no_permit'
            ? async () => null
            : kind === 'read_threw'
              ? async () => ({ release: () => {} })
              : undefined,
        readRow:
          kind === 'read_threw'
            ? async () => {
                throw new Error('the read threw');
              }
            : undefined,
      });
      if (kind === 'cap_full') {
        // The local admission cap is filled by holding four loads open.
        const held = deferred<FreeholdRowLoad>();
        const capped = harness({ readRow: async () => await held.promise });
        const parked = Array.from({ length: FREEHOLD_PERSIST_MAX_ACTIVE_LOADS }, (_, i) =>
          capped.store.preload(OTHER_ACCOUNT_ID + i),
        );
        await tick(20);
        const refused = await capped.store.preload(ACCOUNT_ID);
        expect(refused.hold?.kind, kind).toBe('cap_full');
        expect(capped.store.stats().loaded, kind).toBe(0);
        held.resolve({ kind: 'absent' });
        await Promise.all(parked);
        continue;
      }
      const answer = await faulted.store.preload(ACCOUNT_ID);
      expect(answer.hold?.kind, kind).toBe(kind);
      // NOT loaded, which is the whole of ruling 2: the repair arm consults it.
      expect(faulted.store.stats().loaded, kind).toBe(0);
      expect(faulted.store.stats().held, kind).toBe(1);
    }

    let refuse = true;
    const h = harness({
      acquirePermit: async () => (refuse ? null : { release: () => {} }),
      rowLoad: { kind: 'row', row: rowFixture() },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('no_permit');
    // NOT loaded, and held. The gauge tells an operator how many entries can
    // actually write, so counting a refused one there was a second thing wrong.
    expect(h.store.stats().loaded).toBe(0);
    expect(h.store.stats().held).toBe(1);

    // STILL WRITE-BLOCKED while it is unrepaired, which is the caveat that makes
    // the change safe: `blocked()` is `!loaded || isHeld`, so both halves refuse
    // and no write goes out for this owner in the meantime.
    h.store.markDirty(OWNER_KEY);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(0);

    // AND RE-READ at the handshake's re-ask, rather than replaying the refusal:
    // the entry is unloaded, so the re-ask reads, and the join installs the row.
    refuse = false;
    h.calls.length = 0;
    await h.joinAfterReask();
    expect(h.record()?.plotId).toBe(ROW_PLOT_ID);
    await tick(30);
    expect(h.calls).toContain('readRow');
    expect(h.store.stats().loaded).toBe(1);
    expect(h.store.stats().held).toBe(0);
  });

  it('a DATA hold stays TERMINAL, because a repeat read cannot change the answer', async () => {
    // The contrast arm, and the reason ruling 2 is about admission causes alone.
    // An unreadable row reads the same way every time: re-reading it spends a
    // permit and a statement on the login path for an answer that cannot move.
    const h = harness({
      rowLoad: {
        kind: 'oversize',
        plotIndex: 0,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        bytes: 200_000,
        limit: 100_000,
        detoastRefused: false,
        diskBytes: 200_000,
      },
    });
    const loaded = await h.store.preload(ACCOUNT_ID);
    expect(loaded.hold?.kind).toBe('oversize');
    expect(h.store.stats().loaded).toBe(1);
    h.calls.length = 0;
    h.join(loaded);
    await tick(20);
    expect(h.calls).toEqual([]);
  });

  it('a rejoin that takes back a capture takes the entry out of the LEAVER subset too', async () => {
    // THE SUBSET OUTLIVING ITS SUPERSET. `retain` used to clear the capture with
    // two inline lines, doing the gauge and the null and leaving the entry in
    // `deferredLeavers`, which exists only so `pumpLoop` can find a deferred
    // LEAVER. A rejoin inside the deferral window then parked a CAPTURELESS
    // entry at the head of that set: `nextDeferred` returned it on every
    // admission and `pumpLoop` priced it at the NON-leaving cap, so the two
    // reserved slots never reached the genuine leavers queued behind it. That is
    // the starvation the reserve was rebuilt to end.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    const dirtyLeaver = async (key: string, accountId: number): Promise<void> => {
      await h.login(accountId);
      h.store.markDirty(key);
      void h.store.flushAndRelease(key);
      await tick(20);
    };
    // Fill the ordinary cap, queue four behind it, then let two leavers take the
    // whole reserve, so every later leaver has to come through the pump.
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 4; i++) {
      const key = `account:${OTHER_ACCOUNT_ID + i}`;
      await h.login(OTHER_ACCOUNT_ID + i);
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(20);
    for (let i = 0; i < FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE; i++) {
      await dirtyLeaver(`account:${OTHER_ACCOUNT_ID + 500 + i}`, OTHER_ACCOUNT_ID + 500 + i);
    }
    const leavingCap = FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE;
    expect(h.store.stats().activeWrites).toBe(leavingCap);

    // THE REJOINER. It leaves dirty, is deferred with a capture, and comes
    // straight back inside its own leave window, before its removePlayer: the
    // record is still the one it left, which carries the captured revision, so
    // retain hands the capture back.
    // Counted as a DELTA: the two reserve leavers above are still holding their
    // own captures, because a capture is released when its write settles and
    // theirs are gated open.
    const heldBefore = h.store.stats().leaveCaptures;
    await dirtyLeaver(OWNER_KEY, ACCOUNT_ID);
    expect(h.store.stats().leaveCaptures).toBe(heldBefore + 1);
    await h.joinAfterReask();
    expect(h.store.stats().leaveCaptures).toBe(heldBefore);

    // A GENUINE leaver behind it, also deferred and still holding its capture.
    const laterKey = `account:${OTHER_ACCOUNT_ID + 900}`;
    await dirtyLeaver(laterKey, OTHER_ACCOUNT_ID + 900);
    expect(h.store.stats().leaveCaptures).toBe(heldBefore + 1);

    // One slot frees. The pump must reach the entry that still holds a capture,
    // at the LEAVING cap; with the rejoiner still in the subset it answered
    // first, was priced at the non-leaving cap, and nothing launched at all.
    const before = h.writes.length;
    gates[0].resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
    const launched = h.writes.slice(before).map((write) => write.accountId);
    expect(launched).toContain(OTHER_ACCOUNT_ID + 900);
    expect(launched).not.toContain(ACCOUNT_ID);
    for (const gate of gates) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
  });

  it('a DEFERRED leaver waits, and the pump then prefers it over the queue', async () => {
    // MUTATION GAP, and the case that named it did not reach it. Dropping the
    // deferred-set clause from the flush wait left the suite green, because the
    // case titled "actually waits when its write is DEFERRED" saturates with
    // MAX + RESERVE background writes, which `save()` arms at the NON-leaving
    // cap: four launch, two defer, and the leaver then arms at the leaving cap
    // against four actives and LAUNCHES. Its write was never deferred.
    //
    // This one defers a leaver for real, by filling the LEAVING cap with two
    // earlier leavers, and proves both halves: the flush does not return while
    // its write sits in the deferred set, and the pump prefers it over the
    // background writes queued ahead of it. Before the pump honored the reserve,
    // a leaver that missed the arm-time window was re-admitted at the NON-leaving
    // cap in insertion order, behind every background write already queued, and
    // spent its whole deadline with the write unlanded.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    const leaver = async (offset: number): Promise<void> => {
      const key = `account:${OTHER_ACCOUNT_ID + offset}`;
      await h.login(OTHER_ACCOUNT_ID + offset);
      h.store.markDirty(key);
      void h.store.flushAndRelease(key);
      await tick(20);
    };
    // Four background writes fill the ordinary cap and four more queue behind it.
    for (let i = 0; i < FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + 4; i++) {
      const key = `account:${OTHER_ACCOUNT_ID + i}`;
      await h.login(OTHER_ACCOUNT_ID + i);
      h.store.markDirty(key);
      h.store.save(key);
    }
    await tick(20);
    expect(h.store.stats().activeWrites).toBe(FREEHOLD_PERSIST_MAX_ACTIVE_WRITES);
    expect(h.store.stats().deferredWrites).toBe(4);

    // Two leavers borrow the whole reserve at arm time.
    for (let i = 0; i < FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE; i++) await leaver(500 + i);
    const leavingCap = FREEHOLD_PERSIST_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE;
    expect(h.store.stats().activeWrites).toBe(leavingCap);

    // The third leaver has no reserve left and is DEFERRED.
    await h.login();
    h.store.markDirty(OWNER_KEY);
    let released = false;
    const leaving = h.store.flushAndRelease(OWNER_KEY).then(() => {
      released = true;
    });
    await tick(30);
    expect(h.store.stats().leaveCaptures).toBeGreaterThan(0);
    // It has not written and it has not given up: this is the assertion the
    // deferred-set clause in the flush wait exists for.
    expect(h.writes.some((write) => write.accountId === ACCOUNT_ID)).toBe(false);
    expect(released).toBe(false);

    // One slot frees. The LEAVER goes next, not the oldest background entry.
    const writesBefore = h.writes.length;
    gates[0].resolve({ kind: 'updated', durableRev: '9' });
    await tick(40);
    const started = h.writes.slice(writesBefore);
    expect(started.length).toBeGreaterThan(0);
    expect(started[0].accountId).toBe(ACCOUNT_ID);

    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    await leaving;
    expect(released).toBe(true);
  });

  it('the drain runs ABOVE the steady-state cap, which is the constant it has for it', async () => {
    // FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES was observable by nothing:
    // dropping the `draining ?` arm of writeCap entirely left every case green,
    // including the drain's own, which asserts only that idle() stays unresolved
    // and that all the writes eventually land. Both are true at any cap.
    const gates: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        const gate = deferred<FreeholdUpsertResult>();
        gates.push(gate);
        return await gate.promise;
      },
    });
    const owners = FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES + 3;
    for (let i = 0; i < owners; i++) {
      const key = `account:${OTHER_ACCOUNT_ID + i}`;
      await h.login(OTHER_ACCOUNT_ID + i);
      h.store.markDirty(key);
    }
    // NOT armed before the drain: the drain arms them itself, so the cap in
    // force is the drain's own.
    const drained = h.store.idle(60_000);
    await tick(40);
    expect(h.store.stats().activeWrites).toBe(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES);
    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    for (const gate of gates.splice(0)) gate.resolve({ kind: 'updated', durableRev: '9' });
    await tick(60);
    await expect(drained).resolves.toBe(true);
    expect(h.writeCount()).toBe(owners);
  });

  it('measures the codec and the two wait totals as EXACT advances of the store clock', async () => {
    // The four millisecond totals were asserted only with toBeGreaterThanOrEqual(0),
    // which every accumulation already guarantees through its own Math.max(0, ...),
    // so deleting all four accumulations left the suite green. maxWriteBytes was
    // compared against writeBytesTotal after exactly ONE write, which is the one
    // sample count where a total, a high-water mark and a last-sample gauge are
    // the same number.
    // The clock is advanced INSIDE each bracket, so every total is an exact
    // advance rather than whatever a real clock happened to do. The login: 40 ms
    // for its permit, 50 ms for its read. The write: 15 ms in the queue, 25 ms
    // for its permit, 40 ms inside the codec (the serialize call sits in it)
    // and 700 ms inside the statement. The three document sizes are the
    // session's own edits to its record: the installed house first, then
    // emptied, then furnished with twelve chairs.
    let h!: Harness;
    h = harness({
      readRow: async () => {
        h.setNow(10_090);
        return { kind: 'row', row: rowFixture() };
      },
      acquirePermit: async () => {
        h.setNow(10_040);
        return { release: () => {} };
      },
      enqueue: async <T>(_key: string, _signal: AbortSignal, write: () => Promise<T>) => {
        h.setNow(10_015);
        return await write();
      },
      onSerialize: () => h.setNow(10_080),
      writeRow: async () => {
        h.setNow(10_780);
        return { kind: 'updated', durableRev: '9' };
      },
    });
    await h.login();
    const afterLoad = h.store.stats();
    expect(afterLoad.permitWaitMsTotal).toBe(40);
    expect(afterLoad.loadMsTotal).toBe(50);
    h.setNow(10_000);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    const after = h.store.stats();
    // The statement bracket and the codec bracket are DIFFERENT spans and both
    // move: write_ms is the statement, codec_ms is the serialize, clone and
    // refusal walk that sit between the permit and it. EXACT, because a
    // greater-than-or-equal-to-zero assertion is true of a deleted accumulation.
    expect(after.codecMsTotal - afterLoad.codecMsTotal).toBe(40);
    expect(after.writeMsTotal - afterLoad.writeMsTotal).toBe(700);
    // And the two WAIT totals, which a zero-advance harness could not tell from
    // a deleted accumulation.
    expect(after.queueWaitMsTotal - afterLoad.queueWaitMsTotal).toBe(15);
    expect(after.permitWaitMsTotal - afterLoad.permitWaitMsTotal).toBe(25);
    // The high-water mark is a MARK, not the total and not the LAST SAMPLE. The
    // second write here used to be the same size as the first, so `mark ===
    // first` was equally true of a gauge holding the last sample; the two are
    // only separable by a write that is SMALLER. A third, larger one then
    // proves the mark still climbs, so it is not simply the first sample.
    expect(after.maxWriteBytes).toBe(after.writeBytesTotal);
    const first = after.maxWriteBytes;
    expect(first).toBeGreaterThan(0);

    h.edit(OWNER_KEY, { layout: [], trophies: [] });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    const twice = h.store.stats();
    const smaller = twice.writeBytesTotal - first;
    expect(smaller).toBeGreaterThan(0);
    expect(smaller).toBeLessThan(first);
    // A last-sample gauge would read `smaller` here.
    expect(twice.maxWriteBytes).toBe(first);

    h.edit(OWNER_KEY, {
      layout: Array.from({ length: 12 }, (_, i) => ({
        placementId: i + 1,
        itemId: 'oak_chair',
        x: 1.5,
        y: 0,
        z: -2.25,
        yaw: 0,
      })),
      trophies: persistedFixture().trophies,
    });
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    const thrice = h.store.stats();
    const larger = thrice.writeBytesTotal - twice.writeBytesTotal;
    expect(larger).toBeGreaterThan(first);
    // And a first-sample gauge would still read `first` here.
    expect(thrice.maxWriteBytes).toBe(larger);
  });

  it('stops owing a write that has no record and no capture, instead of re-arming forever', async () => {
    // MUTATION GAP that no behaviour case could reach through the store's own
    // arming rules, which is the honest reason it had none: markDirty has no
    // production caller, the revision probe cannot dirty an entry with no live
    // record, and GameServer.leave always flushes while the record is still
    // live. So it is driven through the store's explicit dirty seam, which is
    // what the furnishing writer will make ordinary.
    //
    // THE STATE: a loaded entry with no record and no capture, which is a
    // handshake that read and never joined. A joined session always has its
    // record beside it on a lit realm.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.store.preload(ACCOUNT_ID);
    expect(h.record()).toBeUndefined();
    h.calls.length = 0;
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    // The write reached its permit and SAMPLED the record (the skip is the null
    // serialize, not a door that never opened), found nothing to send, and
    // issued no statement (absorbed 2026-09-27 from "skips the write entirely
    // when the owner holds no live record").
    expect(h.calls).toContain('serialize');
    expect(h.writeCount()).toBe(0);
    expect(h.store.stats().running).toBe(0);
    expect(h.store.stats().writesWithoutRecord).toBe(1);
    // AND IT STOPPED OWING IT. Without the generation advance the entry stays
    // dirty, every later sweep re-arms the same empty write and spends a permit
    // on it, and owesWork keeps the entry resident for the life of the process.
    expect(h.store.stats().dirty).toBe(0);
    // Nothing is owed and nothing is referenced, so the settle that found
    // nothing to send collects the entry on the spot, rather than keeping it
    // resident to re-arm the same empty write on every sweep. The collection IS
    // the proof: an entry still owing the write would still be here.
    expect(h.store.stats().entries).toBe(0);
  });

  it('refuses an owner key and an account id that name different accounts', async () => {
    // The RAW store, because this is retain's own argument check, and a DARK
    // harness, where a retain issues no repair read and so reads no liveness.
    const h = harness({ dark: true });
    expect(() => h.rawStore.retain('account:1', ACCOUNT_ID)).toThrow(/different accounts/);
    // The matching pair is admitted, so the guard is not a stopped door: the
    // join a dark realm makes, through the same retain.
    expect(() =>
      h.join(freeholdPreloadUnavailable(ACCOUNT_ID, 'housing is disabled on this realm')),
    ).not.toThrow();
    expect(h.store.stats().entries).toBe(1);
    expect(h.calls).toEqual([]);
  });

  it('installs nothing from an answer that names a different account', () => {
    const ctx = fakeCtx();
    installLoadedFreehold(ctx, ACCOUNT_ID, {
      accountId: OTHER_ACCOUNT_ID,
      plotIndex: 0,
      plotId: ROW_PLOT_ID,
      durableRev: '7',
      state: persistedFixture(),
      hearthReadyAtMs: 5_000,
      hearthRevision: '3',
      hold: null,
      recordWithheld: false,
    });
    expect(ctx.freeholds.size).toBe(0);
    expect(ctx.freeholdKeyReadyAtMs.size).toBe(0);
    // The same answer under its OWN account installs, so the guard is decisive.
    installLoadedFreehold(ctx, OTHER_ACCOUNT_ID, {
      accountId: OTHER_ACCOUNT_ID,
      plotIndex: 0,
      plotId: ROW_PLOT_ID,
      durableRev: '7',
      state: persistedFixture(),
      hearthReadyAtMs: 5_000,
      hearthRevision: '3',
      hold: null,
      recordWithheld: false,
    });
    expect(ctx.freeholds.size).toBe(1);
  });

  it('resets the orphan grace on every preload arm that touches an existing entry', async () => {
    // The grace exists because preload resolves before the join calls retain, so
    // an entry sits at zero references for the width of a handshake. It counted
    // from the last RETAIN, not the last touch, so a handshake wider than one
    // sweep interval lost its entry anyway and the session was write-blocked.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.store.preload(ACCOUNT_ID);
    expect(h.store.stats().entries).toBe(1);
    // One sweep marks it.
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(1);
    // A second preload, which is what a slow or retried handshake does, touches
    // the entry again and the mark restarts.
    await h.store.preload(ACCOUNT_ID);
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(1);
    // Without a touch, two consecutive sweeps collect it.
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(0);
  });

  it('resets the orphan grace on the ALREADY-LIVE arm too, which a record in the world takes', async () => {
    // The same grace, on the arm a handshake takes when the account's record is
    // still live: the leave window, where the first session's flush has
    // collected its entry and its removePlayer has not run. The next handshake
    // re-reads into a fresh entry, a sweep marks it, and a retried handshake
    // must restart the mark rather than let the second sweep collect it.
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    await h.login();
    await h.store.flushAndRelease(OWNER_KEY);
    expect(h.store.stats().entries).toBe(0);
    expect(h.record()).toBeDefined();
    await h.store.preload(ACCOUNT_ID);
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(1);
    await h.store.preload(ACCOUNT_ID);
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(1);
    h.store.saveAllDirty();
    expect(h.store.stats().entries).toBe(0);
    h.removePlayer();
  });
});

describe('the one runtime order the 07 re-judgement still names: the cross-realm fence (R2)', () => {
  // Pinned as it behaves: R2 (2026-09-26) carries it to 07a as a named
  // activation gate. A leaver's capture is still owed when the entry QUIESCES
  // on another realm's commit, a quiesced entry owes no work, and settle
  // releases the capture, so the leaver's last edits reach no row. Loud, and the
  // row keeps the other realm's house (nothing is overwritten).
  //
  // THE OTHER QUIESCES RELEASE A CAPTURE THE SAME WAY, and are deliberate or out
  // of reach: the seal's identity and unnamed refusals (a session already
  // write-blocked, whose capture is a stand-in's), the write refusal's ceilings
  // (a legal record fits them; the maximal one is measured), a `missing` row
  // (the account's row deleted) and a `conflict` (a minted plot id colliding).
  // A run of THROWN writes is no longer one of them (R1, the retry posture
  // below), and the shutdown drain's deadline is R3's accepted bound, pinned in
  // the posture's shutdown case.
  const rowOfOwner = async (db: ReturnType<typeof rowRemembered>) => {
    const row = await db.readRow(ACCOUNT_ID);
    return row.kind === 'row' ? row.row.wireRev : row.kind;
  };

  it("KNOWN COST: another realm's commit fences the capture stale and releases it unwritten", async () => {
    // THE CONTRACT'S ACTIVATION GATE (persistence-rollout-contract.md, "ONE
    // ACCOUNT ONLINE ON TWO REALMS HAS ONE OF THEM WRITE-BLOCKED, SILENTLY") in
    // its leaving form: the row is account-scoped and shared by every realm on
    // one database, another realm commits first, and this realm's leave write
    // meets the fence. The fence keeps the other realm's house, which is its
    // job; the leaver's capture is released with one warn line and the
    // `stale_writes` counter only (the entry is collected at once, so the
    // `quiesced` gauge reads zero).
    const db = rowRemembered(rowFixture({ wireRev: '7' }));
    const gate = deferred<void>();
    const h = await loadedStore({
      readRow: db.readRow,
      writeRow: async (input) => {
        await gate.promise;
        return await db.writeRow(input);
      },
    });
    h.edit(OWNER_KEY, { rev: 8 });
    const leaving = h.leave();
    await tick(10);
    expect(h.store.stats().leaveCaptures).toBe(1);
    // The other realm's write lands while this one waits.
    db.advance({ wireRev: '9' });
    gate.resolve();
    await leaving;
    await tick(30);
    expect(h.store.stats().staleWrites).toBe(1);
    expect(h.warnings.filter((line) => line.includes('durable revision moved'))).toHaveLength(1);
    // Quiesced and collected together, the capture with it.
    expect(h.store.stats().entries).toBe(0);
    expect(h.store.stats().leaveCaptures).toBe(0);
    // The other realm's house stands; this realm's revision-8 edits are gone.
    expect(await rowOfOwner(db)).toBe('9');
  });
});

describe('a run of thrown writes keeps its edits and retries them once per window (R1)', () => {
  // R1 (Fernando, 2026-09-26; the ledger, R1, THE THROWN-RUN RETRY POSTURE): a
  // throw is not an answer, so a run of them no longer quiesces the entry. It
  // puts the entry on a per-owner retry clock instead: nothing arms a write
  // until the clock is due, the capture and every later edit ride the next
  // retry, and only a commit (or an answer no repeat can change) ends it.
  const WINDOW = FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS;
  const START_MS = 10_000;

  /** A row in a database that throws until `recover()`, then answers as one. */
  function faultyDatabase(wireRev = '7') {
    const db = rowRemembered(rowFixture({ wireRev }));
    let failing = true;
    return {
      readRow: db.readRow,
      writeRow: async (input: FreeholdUpsert): Promise<FreeholdUpsertResult> => {
        if (failing) throw new Error('connection terminated unexpectedly');
        return await db.writeRow(input);
      },
      recover(): void {
        failing = false;
      },
      /** The fault returns. */
      fail(): void {
        failing = true;
      },
      /** Another realm sharing the database writes the row forward. */
      advance: db.advance,
      async wireRev(): Promise<string> {
        const row = await db.readRow(ACCOUNT_ID);
        return row.kind === 'row' ? row.row.wireRev : row.kind;
      },
    };
  }

  /** A leaver whose leave write throws, then the two sweeps that complete the
   *  run, all at START_MS: the entry enters the posture there, due at
   *  START_MS + WINDOW. */
  async function leaverInPosture(database = faultyDatabase()) {
    const h = await loadedStore({ readRow: database.readRow, writeRow: database.writeRow });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    await h.leave();
    expect(h.record()).toBeUndefined();
    for (let sweep = 1; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS);
    return { h, database };
  }

  const postureLines = (h: Harness) => h.errors.filter((line) => line.includes('retried once per'));

  it('keeps the capture past the run and writes it when the database answers again', async () => {
    const { h, database } = await leaverInPosture();
    // THE FLIP of the 2026-09-26 KNOWN COST pin: the run no longer quiesces the
    // entry or releases the leaver's revision-8 house.
    expect(h.store.stats()).toMatchObject({
      quiesced: 0,
      retrying: 1,
      leaveCaptures: 1,
      entries: 1,
      dirty: 1,
    });
    expect(postureLines(h)).toHaveLength(1);
    expect(h.errors.filter((line) => line.includes('quiesced'))).toEqual([]);
    // The database answers again, and the retry is due one window after the
    // last throw.
    database.recover();
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(await database.wireRev()).toBe('8');
    expect(h.warnings.filter((line) => line.includes('committed after a thrown run'))).toHaveLength(
      1,
    );
    // Released on the commit, the clock and the run cleared, and the entry
    // collected (no session refers to it and nothing is owed).
    expect(h.store.stats()).toMatchObject({ retrying: 0, leaveCaptures: 0, entries: 0, dirty: 0 });
    await h.login();
    expect(h.record()?.rev).toBe(8);
  });

  it('costs one statement per owner per window while the database keeps throwing, and keeps everything', async () => {
    const { h } = await leaverInPosture();
    const retriesBefore = h.store.stats().writeRetries;
    for (let window = 1; window <= 3; window++) {
      const writesAtStart = h.writeCount();
      // Every sweep of the window before the clock is due writes nothing.
      for (const at of [30_000, WINDOW / 2, WINDOW - 30_000, WINDOW - 1]) {
        h.setNow(START_MS + (window - 1) * WINDOW + at);
        h.store.saveAllDirty();
        await tick(10);
      }
      expect(h.writeCount(), `window ${window} before due`).toBe(writesAtStart);
      // Due: exactly one statement, which throws and re-arms the clock one
      // window on from its own failure.
      h.setNow(START_MS + window * WINDOW);
      h.store.saveAllDirty();
      await tick(30);
      h.store.saveAllDirty();
      await tick(30);
      expect(h.writeCount(), `window ${window} due`).toBe(writesAtStart + 1);
      // Kept: never quiesced, never collected, the capture still counted.
      expect(h.store.stats()).toMatchObject({
        quiesced: 0,
        retrying: 1,
        leaveCaptures: 1,
        entries: 1,
      });
    }
    expect(h.store.stats().writeRetries - retriesBefore).toBe(3);
    // One entry line for the posture; the run's throws each log their own line,
    // and a throw ON the clock is reported by the next sweep's one summary line
    // (the hot-path review: a long outage must not print a line per owner).
    expect(postureLines(h)).toHaveLength(1);
    expect(h.errors.filter((line) => line.includes('write failed:'))).toHaveLength(
      FREEHOLD_PERSIST_MAX_WRITE_ERRORS,
    );
    const summaries = h.errors.filter((line) =>
      line.includes('retry writes threw since the last sweep'),
    );
    expect(summaries).toHaveLength(3);
    for (const line of summaries)
      expect(line).toContain('freehold retry clock: 1 retry writes threw');
  });

  it('installs the kept capture on a rejoin, and the rejoined session edits ride the retry', async () => {
    const { h, database } = await leaverInPosture();
    // The rejoin installs the leaver's unwritten house, as a slow leave write's
    // rejoin always has.
    await h.login();
    expect(h.record()?.rev).toBe(8);
    expect(h.store.stats()).toMatchObject({ retrying: 1, retryingOffline: 0 });
    // retain released the capture: the live record carries it now, and the
    // retry writes the live record whenever one stands.
    expect(h.store.stats().leaveCaptures).toBe(0);
    // The rejoined session edits freely; nothing arms off the clock.
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS);
    // Its own leave refreshes the capture from its record, writes nothing, and
    // does not wait on the leave deadline: it settles inside a few microtasks.
    let settled = false;
    const leaving = h.leave().then(() => {
      settled = true;
    });
    await tick(30);
    expect(settled).toBe(true);
    await leaving;
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS);
    expect(h.store.stats().leaveCaptures).toBe(1);
    database.recover();
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    // The row gets the REJOINED session's house, which carries the leaver's.
    expect(await database.wireRev()).toBe('9');
    expect(h.store.stats()).toMatchObject({ retrying: 0, leaveCaptures: 0, entries: 0 });
  });

  it("keeps an ONLINE session's edits past a run and past its own leave", async () => {
    // The order R1's text did not name: the run lands while the session is
    // still in the world. It used to quiesce the entry, so the leave captured
    // nothing and the session's edits were gone at logout.
    const database = faultyDatabase();
    const h = await loadedStore({ readRow: database.readRow, writeRow: database.writeRow });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    for (let sweep = 0; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.store.stats()).toMatchObject({ quiesced: 0, retrying: 1, leaveCaptures: 0 });
    await h.leave();
    expect(h.store.stats().leaveCaptures).toBe(1);
    database.recover();
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(await database.wireRev()).toBe('8');
  });

  it('treats a wall clock that stepped back past a window as due, and a smaller step as not', async () => {
    const { h } = await leaverInPosture();
    const writes = h.writeCount();
    // Back less than one window from the failure: still waiting.
    h.setNow(START_MS - WINDOW / 2);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(writes);
    // Back past one window: the clock would otherwise stall the retries for the
    // size of the step, so it counts as due.
    h.setNow(START_MS - WINDOW - 1);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(writes + 1);
  });

  it('gives a kept capture one last attempt at shutdown, and ends it with the process at R3', async () => {
    const { h } = await leaverInPosture();
    const writes = h.writeCount();
    // The drain ignores the clock (not due for a whole window yet) and attempts
    // it once; the database still throws, so the drain answers NOT drained as
    // soon as nothing is moving, never at its deadline.
    const scheduledBefore = h.deadlines.length;
    let answer: boolean | undefined;
    const draining = h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS).then((drained) => {
      answer = drained;
    });
    await tick(30);
    // Settled inside a few microtasks: its OWN deadline was scheduled, never
    // fired, and cancelled by the early answer.
    expect(answer).toBe(false);
    await draining;
    expect(h.writeCount()).toBe(writes + 1);
    expect(h.deadlines.slice(scheduledBefore)).toMatchObject([
      { ms: FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS, fired: false, cancelled: true },
    ]);
    // The capture is still held: it ends with the process, R3's accepted bound.
    expect(h.store.stats().leaveCaptures).toBe(1);
  });

  it('holds an edit that lands while a retry is out for the next window, never re-arming at once', async () => {
    // The retry is the only statement a window buys. An edit made while it is
    // out sets `pending`, and on a thrown settle that edit rides the NEXT due
    // retry rather than a second statement straight away.
    const database = faultyDatabase();
    const gates: Array<Deferred<void>> = [];
    const h = await loadedStore({
      readRow: database.readRow,
      writeRow: async (input) => {
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
        return await database.writeRow(input);
      },
    });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    for (let sweep = 0; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
      gates.shift()?.resolve();
      await tick(30);
    }
    expect(h.store.stats().retrying).toBe(1);
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS + 1);
    // The edit lands while the retry is out, then the retry throws.
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    gates.shift()?.resolve();
    await tick(30);
    expect(h.store.stats()).toMatchObject({ running: 0, retrying: 1, pending: 0 });
    expect(h.writeCount()).toBe(FREEHOLD_PERSIST_MAX_WRITE_ERRORS + 1);
    // It rides the next due retry instead.
    database.recover();
    h.setNow(START_MS + 2 * WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    gates.shift()?.resolve();
    await tick(30);
    expect(await database.wireRev()).toBe('9');
  });

  it('ends the posture on an answer no repeat can change: a stale retry quiesces and releases (R2)', async () => {
    // "Released only on a commit or on an answer no repeat can change": the
    // fence is such an answer, so a retry that meets another realm's commit ends
    // the posture exactly as a first write would, and the gauge stops counting it.
    const database = faultyDatabase();
    const { h } = await leaverInPosture(database);
    // The row moved under this realm while its database was unreachable, so the
    // retry is fenced.
    database.recover();
    database.advance({ wireRev: '11' });
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats()).toMatchObject({
      staleWrites: 1,
      retrying: 0,
      leaveCaptures: 0,
      entries: 0,
    });
  });

  /** A session still in the world whose writes threw a whole run: on the clock
   *  with its entry retained, so the entry outlives whatever ends the posture. */
  async function onlineInPosture(database = faultyDatabase()) {
    const h = await loadedStore({ readRow: database.readRow, writeRow: database.writeRow });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    for (let sweep = 0; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.store.stats()).toMatchObject({ retrying: 1, entries: 1 });
    return { h, database };
  }

  it('leaves the clock on a commit, so the next single throw is a blip on the ordinary cadence', async () => {
    const { h, database } = await onlineInPosture();
    database.recover();
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(await database.wireRev()).toBe('8');
    // Off the clock with the entry still retained, not merely collected.
    expect(h.store.stats()).toMatchObject({ retrying: 0, entries: 1, quiesced: 0 });
    // One blip after the recovery: the next sweep retries it at once, as any
    // owner's blip is, rather than a window later.
    const writes = h.writeCount();
    database.fail();
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().retrying).toBe(0);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.writeCount()).toBe(writes + 2);
  });

  it('stops counting an entry on the clock once an answer quiesces it', async () => {
    const database = faultyDatabase();
    const { h } = await onlineInPosture(database);
    database.recover();
    database.advance({ wireRev: '11' });
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    // Retained (the session is in the world), quiesced by the fence, and no
    // longer on the clock's gauge.
    expect(h.store.stats()).toMatchObject({
      entries: 1,
      staleWrites: 1,
      quiesced: 1,
      retrying: 0,
    });
  });

  it('publishes the offline share of the clock, the owners holding two records each', async () => {
    const { h: leaver } = await leaverInPosture();
    expect(leaver.store.stats()).toMatchObject({ retrying: 1, retryingOffline: 1 });
    const { h: online } = await onlineInPosture();
    expect(online.store.stats()).toMatchObject({ retrying: 1, retryingOffline: 0 });
  });

  it('says a payload answer that lands ON the clock quiesced it there, not after a run', async () => {
    let answer = false;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => {
        if (answer) {
          throw Object.assign(new Error('new row violates check constraint'), { code: '23514' });
        }
        throw new Error('connection terminated unexpectedly');
      },
    });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    for (let sweep = 0; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    answer = true;
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats()).toMatchObject({ quiesced: 1, retrying: 0 });
    expect(h.errors.filter((line) => line.includes('quiesced on the retry clock'))).toHaveLength(1);
  });

  /** Owners on the clock whose next writes HANG, for the sub-cap and drain cases. */
  async function hangingPosture(accounts: readonly number[]) {
    let mode: 'throw' | 'hang' = 'throw';
    const hung: Array<Deferred<FreeholdUpsertResult>> = [];
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => {
        if (mode === 'throw') throw new Error('connection terminated unexpectedly');
        const gate = deferred<FreeholdUpsertResult>();
        hung.push(gate);
        return await gate.promise;
      },
    });
    h.setNow(START_MS);
    for (const account of accounts) {
      await h.login(account);
      h.edit(`account:${account}`, { rev: 8 });
    }
    for (let sweep = 0; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(h.store.stats().retrying).toBe(accounts.length);
    mode = 'hang';
    return { h, hung };
  }
  const FOUR_ACCOUNTS = [ACCOUNT_ID, OTHER_ACCOUNT_ID, 700_001, 700_002];
  const TEN_ACCOUNTS = [...FOUR_ACCOUNTS, 700_004, 700_005, 700_006, 700_007, 700_008, 700_009];

  it('holds retries to their own sub-cap, and an ordinary write still gets a slot', async () => {
    // A fault that makes every statement run to its timeout would otherwise let
    // retries hold the whole write cap while healthy owners queue behind them.
    const { h, hung } = await hangingPosture(FOUR_ACCOUNTS);
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_RETRY_WRITE_CAP);
    expect(h.store.stats()).toMatchObject({
      deferredWrites: 0,
      deferredRetries: FOUR_ACCOUNTS.length - FREEHOLD_PERSIST_RETRY_WRITE_CAP,
    });
    // A healthy owner off the clock: its write launches beside the two retries.
    await h.login(700_003);
    h.edit('account:700003', { rev: 8 });
    h.store.saveAllDirty();
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_RETRY_WRITE_CAP + 1);
    expect(h.store.stats().activeWrites).toBe(FREEHOLD_PERSIST_RETRY_WRITE_CAP + 1);
    // A retry settles (it throws again): the pump re-admits exactly ONE deferred
    // retry into the freed sub-cap slot, never both.
    hung[0].reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_RETRY_WRITE_CAP + 2);
    expect(h.store.stats().deferredRetries).toBe(
      FOUR_ACCOUNTS.length - FREEHOLD_PERSIST_RETRY_WRITE_CAP - 1,
    );
    // Close every gate the case opened, so its settles run inside the case.
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it('pumps a waiting ORDINARY write ahead of a waiting retry when a slot frees', async () => {
    const { h, hung } = await hangingPosture(FOUR_ACCOUNTS);
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    // Two retries hold the sub-cap; two healthy owners fill the rest of the
    // write cap, and a third waits.
    for (const account of [700_010, 700_011, 700_012]) {
      await h.login(account);
      h.edit(`account:${account}`, { rev: 8 });
      h.store.markDirty(`account:${account}`);
      h.store.save(`account:${account}`);
      await tick(10);
    }
    expect(h.store.stats()).toMatchObject({
      activeWrites: 4,
      deferredWrites: 1,
      deferredRetries: 2,
    });
    // A retry settles: the freed slot goes to the waiting ORDINARY write, and the
    // two waiting retries stay deferred.
    hung[0].reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    expect(h.writes.at(-1)?.accountId).toBe(700_012);
    expect(h.store.stats()).toMatchObject({
      activeWrites: 4,
      deferredWrites: 0,
      deferredRetries: 2,
    });
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it('reports every throw on the clock since the last sweep in ONE line, not one per owner', async () => {
    const { h, hung } = await hangingPosture(FOUR_ACCOUNTS);
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    const before = h.errors.length;
    // The two retries in flight throw, and the pump re-admits the other two,
    // which hang in their turn.
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    h.store.saveAllDirty();
    await tick(30);
    const lines = h.errors.slice(before);
    expect(lines.filter((line) => line.includes('write failed:'))).toEqual([]);
    const summaries = lines.filter((line) =>
      line.includes('retry writes threw since the last sweep'),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('freehold retry clock: 2 retry writes threw');
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it('offers a retry slot freed by a committing retry to a waiting retry at once', async () => {
    // A retry that commits with an edit pending re-arms as an ORDINARY write
    // (the clock cleared on the commit), freeing its retry slot: a waiting retry
    // takes it on that settle, not on some later one.
    const { h, hung } = await hangingPosture(FOUR_ACCOUNTS);
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_RETRY_WRITE_CAP);
    // An edit lands for the first owner while its retry is out.
    h.edit(OWNER_KEY, { rev: 9 });
    h.store.saveAllDirty();
    await tick(30);
    expect(h.store.stats().pending).toBe(1);
    hung[0].resolve({ kind: 'updated', durableRev: '8' });
    await tick(60);
    // The ordinary re-arm AND a waiting retry both launched on that settle.
    expect(hung).toHaveLength(FREEHOLD_PERSIST_RETRY_WRITE_CAP + 2);
    expect(h.store.stats().deferredRetries).toBe(
      FOUR_ACCOUNTS.length - FREEHOLD_PERSIST_RETRY_WRITE_CAP - 1,
    );
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it('re-arms a retry from its own settle through the sub-cap, never past a full cap', async () => {
    // The one state where it shows: a drain whose cap two ORDINARY leavers have
    // borrowed past (a leaver may take the reserve; a retry never does), and a
    // retry with an edit pending that throws again while the drain keeps every
    // clock due. Launched straight from its settle it would run past the cap.
    const { h, hung } = await hangingPosture(TEN_ACCOUNTS);
    for (const account of [700_020, 700_021]) await h.login(account);
    const scheduledBefore = h.deadlines.length;
    const drained = h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS);
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES);
    // An edit the first owner's running retry cannot carry, then its leave: the
    // flush marks it pending on the running write.
    h.edit(OWNER_KEY, { rev: 9 });
    const leaves = [h.leave(OWNER_KEY)];
    await tick(10);
    expect(h.store.stats().pending).toBe(1);
    // Two ordinary leavers borrow the leave reserve past the drain's cap.
    for (const account of [700_020, 700_021]) {
      h.edit(`account:${account}`, { rev: 8 });
      leaves.push(h.leave(`account:${account}`));
      await tick(10);
    }
    expect(h.store.stats().activeWrites).toBe(
      FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE,
    );
    // The first owner's retry throws: its re-arm waits for a slot rather than
    // taking one past the cap.
    hung[0].reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    expect(h.store.stats()).toMatchObject({
      activeWrites:
        FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES + FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE - 1,
      deferredRetries: TEN_ACCOUNTS.length - FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES + 1,
    });
    // Unwind: every leave stops waiting at its deadline, and the drain at its own
    // (only the jobs this case scheduled, never the logins' budgets).
    for (const job of h.deadlines.slice(scheduledBefore)) {
      if (!job.fired && !job.cancelled) job.fire();
    }
    await Promise.all(leaves);
    await drained;
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it("re-queues a retry's settle re-arm BEHIND a waiting ordinary write", async () => {
    // A drain whose cap retries fill, with a healthy owner's write waiting: a
    // retry that throws again with an edit pending must not take back the slot
    // it freed ahead of that write.
    const { h, hung } = await hangingPosture(TEN_ACCOUNTS);
    const HEALTHY = 700_030;
    await h.login(HEALTHY);
    h.edit(`account:${HEALTHY}`, { rev: 8 });
    const scheduledBefore = h.deadlines.length;
    const drained = h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS);
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES);
    expect(h.store.stats().deferredWrites).toBe(1);
    // The first owner's running retry gets an edit it cannot carry, then throws.
    h.edit(OWNER_KEY, { rev: 9 });
    const leaving = h.leave(OWNER_KEY);
    await tick(10);
    expect(h.store.stats().pending).toBe(1);
    hung[0].reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    // The freed slot went to the healthy owner; the retry waits its turn.
    expect(h.writes.at(-1)?.accountId).toBe(HEALTHY);
    expect(h.store.stats().deferredWrites).toBe(0);
    for (const job of h.deadlines.slice(scheduledBefore)) {
      if (!job.fired && !job.cancelled) job.fire();
    }
    await leaving;
    await drained;
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
  });

  it('closes the clock exception again when a drain cannot arm its writes', async () => {
    // A throwing port inside idle() must neither throw out of a drain that never
    // throws nor leave every clock due for the life of the store.
    const { h } = await onlineInPosture();
    // A retry throws on the clock, counted for the next sweep's summary line.
    h.setNow(START_MS + WINDOW);
    h.store.saveAllDirty();
    await tick(30);
    const liveRev = h.ports.liveRev;
    h.ports.liveRev = () => {
      throw new Error('liveness port fault');
    };
    expect(await h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS)).toBe(false);
    h.ports.liveRev = liveRev;
    expect(h.errors.filter((line) => line.includes('drain could not arm its writes'))).toHaveLength(
      1,
    );
    // The pending throw is reported there, since no sweep may follow.
    expect(
      h.errors.filter((line) => line.includes('freehold retry clock: 1 retry writes threw')),
    ).toHaveLength(1);
    // Not due, and the drain is closed: the leave arms nothing.
    const writes = h.writeCount();
    await h.leave();
    await tick(30);
    expect(h.writeCount()).toBe(writes);
  });

  it("ends the drain's clock exception WITH the drain: no retry launches past its deadline", async () => {
    // R3 accepted a 10 s drain, not a tail after it: a retry still waiting when
    // the deadline fires must not launch when a slot frees afterwards.
    // More owners on the clock than the drain's cap, so some still wait when the
    // deadline fires; the drain lifts the retry sub-cap to its own whole cap.
    const { h, hung } = await hangingPosture(TEN_ACCOUNTS);
    const scheduledBefore = h.deadlines.length;
    let answer: boolean | undefined;
    const drained = h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS).then((result) => {
      answer = result;
      return result;
    });
    await tick(30);
    expect(hung).toHaveLength(FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES);
    expect(h.store.stats().deferredRetries).toBe(
      TEN_ACCOUNTS.length - FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
    );
    // Still waiting on the hung retries: only the deadline can answer it.
    expect(answer).toBeUndefined();
    const writes = h.writeCount();
    const [deadline] = h.deadlines.slice(scheduledBefore);
    expect(deadline).toMatchObject({ ms: FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS, fired: false });
    deadline.fire();
    expect(await drained).toBe(false);
    // The hung retries now fail; their slots free, and nothing launches. With no
    // sweep left to report them, each throw logs its own line.
    const before = h.errors.length;
    for (const gate of hung.splice(0)) gate.reject(new Error('connection terminated unexpectedly'));
    await tick(60);
    expect(h.writeCount()).toBe(writes);
    expect(h.store.stats()).toMatchObject({
      activeWrites: 0,
      deferredWrites: 0,
      deferredRetries: 0,
    });
    expect(h.store.stats().retrying).toBe(TEN_ACCOUNTS.length);
    expect(h.errors.slice(before).filter((line) => line.includes('write failed:'))).toHaveLength(
      FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES,
    );
  });

  it('still quiesces a run of throws that ANSWER about the payload, and releases the capture', async () => {
    // A throw is a fault unless it is about the document itself: the writer's
    // own structural refusal (a TypeError out of requireUpsertInput) or a
    // payload SQLSTATE. Those answer the same way every time, so the run ends in
    // a quiesce as it always has, and the clock never holds them.
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ wireRev: '7' }) },
      writeRow: async () => {
        throw Object.assign(new Error('new row violates check constraint'), { code: '23514' });
      },
    });
    h.setNow(START_MS);
    h.edit(OWNER_KEY, { rev: 8 });
    await h.leave();
    for (let sweep = 1; sweep < FREEHOLD_PERSIST_MAX_WRITE_ERRORS; sweep++) {
      h.store.saveAllDirty();
      await tick(30);
    }
    expect(
      h.errors.filter((line) => line.includes('thrown writes refusing this document')),
    ).toHaveLength(1);
    expect(h.store.stats()).toMatchObject({ retrying: 0, leaveCaptures: 0, entries: 0 });
  });

  it('writes a kept capture in the shutdown drain when the database answers', async () => {
    const { h, database } = await leaverInPosture();
    database.recover();
    expect(await h.store.idle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS)).toBe(true);
    expect(await database.wireRev()).toBe('8');
  });
});

describe("the store's claim seam the 07a renewer, trip and mutation read", () => {
  it('wantsClaim: true with a session reference or owed work, false otherwise', async () => {
    const gate = deferred<FreeholdFencedUpsertResult>();
    let gated = false;
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async () => (gated ? await gate.promise : { kind: 'updated', durableRev: '8' }),
    });
    // No entry at all.
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(false);
    // An entry with no session and nothing owed: a handshake that never joined.
    await h.store.preload(ACCOUNT_ID);
    expect(h.store.authority(OWNER_KEY)).not.toBeNull();
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(false);
    // A SESSION REFERENCE.
    await h.joinAfterReask();
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(true);
    // Per owner: another account's key is not wanted on this one's reference.
    expect(
      h.store.wantsClaim(OWNER_KEY.replace(String(ACCOUNT_ID), String(OTHER_ACCOUNT_ID))),
    ).toBe(false);
    // OWED WORK with no reference: a dirty leaver whose write is still running
    // after its leave flush stopped waiting (the leave deadline fired), so the
    // reference is gone and only the running write keeps the entry.
    gated = true;
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    const leaving = h.leave();
    await tick(30);
    expect(h.calls).toContain('writeRow');
    expect(h.fireDeadline()).toBe(true);
    await leaving;
    expect(h.record()).toBeUndefined();
    expect(h.store.stats()).toMatchObject({ running: 1, entries: 1 });
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(true);
    // The write lands, the entry owes nothing and holds no reference: let go.
    gate.resolve({ kind: 'updated', durableRev: '8' });
    await tick(30);
    expect(h.store.stats().running).toBe(0);
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(false);
  });

  it('wantsClaim: a held entry with no session owes nothing, so its claim is not wanted', async () => {
    const h = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => null,
    });
    expect((await h.store.preload(ACCOUNT_ID)).hold?.kind).toBe('no_permit');
    expect(h.store.wantsClaim(OWNER_KEY)).toBe(false);
  });

  it('authority: null without an entry, else loaded, blocked, plot id and revision', async () => {
    const h = harness({ rowLoad: { kind: 'row', row: rowFixture() } });
    expect(h.store.authority(OWNER_KEY)).toBeNull();
    await h.store.preload(ACCOUNT_ID);
    expect(h.store.authority(OWNER_KEY)).toEqual({
      loaded: true,
      blocked: false,
      plotId: ROW_PLOT_ID,
      durableRev: '7',
    });
    // Another owner still has no entry: the answer is per owner.
    expect(h.store.authority(OTHER_OWNER_KEY)).toBeNull();

    // A fresh account: loaded and unblocked, its minted name, no durable row.
    const fresh = harness();
    await fresh.store.preload(ACCOUNT_ID);
    expect(fresh.store.authority(OWNER_KEY)).toEqual({
      loaded: true,
      blocked: false,
      plotId: MINTED_PLOT_ID,
      durableRev: null,
    });

    // A repairable hold: not loaded, so blocked.
    const refused = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => null,
    });
    await refused.store.preload(ACCOUNT_ID);
    expect(refused.store.authority(OWNER_KEY)).toEqual({
      loaded: false,
      blocked: true,
      plotId: '',
      durableRev: null,
    });

    // A TERMINAL data hold: loaded (a re-read cannot change it) yet blocked,
    // which is the pair the trip's authority rule exists to tell apart.
    const terminal = harness({
      rowLoad: {
        kind: 'oversize',
        plotIndex: 0,
        plotId: ROW_PLOT_ID,
        durableRev: '4',
        bytes: 200_000,
        limit: 100_000,
        detoastRefused: false,
        diskBytes: 200_000,
      },
    });
    await terminal.store.preload(ACCOUNT_ID);
    expect(terminal.store.authority(OWNER_KEY)).toMatchObject({ loaded: true, blocked: true });
  });

  it('runExclusive: a job waits for the running write of its owner, and a write for the job', async () => {
    const log: string[] = [];
    const writeGate = deferred<void>();
    let gateWrites = true;
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture() },
      writeRow: async (input) => {
        log.push(`write:start:${input.accountId}`);
        if (gateWrites && input.accountId === ACCOUNT_ID) await writeGate.promise;
        log.push(`write:end:${input.accountId}`);
        return { kind: 'updated', durableRev: String(Number(input.expectedDurableRev) + 1) };
      },
    });
    // A write is RUNNING for the owner.
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(log).toEqual([`write:start:${ACCOUNT_ID}`]);
    h.calls.length = 0;
    const job = h.store.runExclusive(OWNER_KEY, new AbortController().signal, async () => {
      log.push('job:run');
      return 'job answer';
    });
    await tick(30);
    // The job rides the store's own FIFO port, and it has NOT run.
    expect(h.calls).toEqual(['enqueue']);
    expect(log).toEqual([`write:start:${ACCOUNT_ID}`]);
    writeGate.resolve();
    expect(await job).toBe('job answer');
    expect(log).toEqual([`write:start:${ACCOUNT_ID}`, `write:end:${ACCOUNT_ID}`, 'job:run']);

    // AND THE OTHER WAY: a write armed while a job runs waits for the job.
    gateWrites = false;
    log.length = 0;
    const jobGate = deferred<void>();
    const running = h.store.runExclusive(OWNER_KEY, new AbortController().signal, async () => {
      log.push('job:start');
      await jobGate.promise;
      log.push('job:end');
    });
    await tick(30);
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(log).toEqual(['job:start']);
    jobGate.resolve();
    await running;
    await tick(30);
    expect(log).toEqual([
      'job:start',
      'job:end',
      `write:start:${ACCOUNT_ID}`,
      `write:end:${ACCOUNT_ID}`,
    ]);
  });

  it('runExclusive: per OWNER, not global, and cancellable until the job starts', async () => {
    const log: string[] = [];
    const h = harness({
      writeRow: async (input) => {
        log.push(`write:${input.accountId}`);
        return { kind: 'inserted', durableRev: '1' };
      },
    });
    await h.login(ACCOUNT_ID);
    await h.login(OTHER_ACCOUNT_ID);
    const jobGate = deferred<void>();
    const held = h.store.runExclusive(OWNER_KEY, new AbortController().signal, async () => {
      await jobGate.promise;
    });
    await tick(30);
    // ANOTHER owner's write is not held behind this owner's job.
    h.edit(OTHER_OWNER_KEY);
    h.store.markDirty(OTHER_OWNER_KEY);
    h.store.save(OTHER_OWNER_KEY);
    await tick(30);
    expect(log).toEqual([`write:${OTHER_ACCOUNT_ID}`]);
    // A second job queued behind the first is cancelled before it starts,
    // while this owner holds an edit nothing has written yet.
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    const controller = new AbortController();
    let cancelledRan = false;
    const cancelled = h.store.runExclusive(OWNER_KEY, controller.signal, async () => {
      cancelledRan = true;
    });
    controller.abort();
    await expect(cancelled).rejects.toThrow('keyed serial write aborted before starting');
    jobGate.resolve();
    await held;
    await tick(30);
    expect(cancelledRan).toBe(false);
    // THE CANCELLATION CLEARED NO DIRTY WORK: the owner's edit is still owed
    // and its next save writes it.
    expect(h.store.stats().dirty).toBeGreaterThanOrEqual(1);
    log.length = 0;
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(log).toEqual([`write:${ACCOUNT_ID}`]);
  });

  it('adoptCommittedRevision: the next write CASes on the adopted revision', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ durableRev: '7' }) },
      writeRow: async (input) => ({
        kind: 'updated',
        durableRev: String(Number(input.expectedDurableRev) + 1),
      }),
    });
    h.store.adoptCommittedRevision(OWNER_KEY, '9');
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('9');
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writes.map((write) => write.expectedDurableRev)).toEqual(['9']);
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('10');
  });

  it('adoptCommittedRevision: forward only, and a malformed revision is ignored', async () => {
    const h = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ durableRev: '7' }) },
      writeRow: async (input) => ({
        kind: 'updated',
        durableRev: String(Number(input.expectedDurableRev) + 1),
      }),
    });
    for (const backwards of ['6', '7', '1', '0', '07', '-8', '8.5', '', 'eight']) {
      h.store.adoptCommittedRevision(OWNER_KEY, backwards);
      expect(h.store.authority(OWNER_KEY)?.durableRev, backwards).toBe('7');
    }
    h.edit(OWNER_KEY);
    h.store.markDirty(OWNER_KEY);
    h.store.save(OWNER_KEY);
    await tick(30);
    expect(h.writes.map((write) => write.expectedDurableRev)).toEqual(['7']);
    // Past 2^53 the comparison is exact. The two values below are ONE double,
    // so a Number comparison would refuse the second, forward, adoption.
    expect(Number('9007199254740993')).toBe(Number('9007199254740992'));
    h.store.adoptCommittedRevision(OWNER_KEY, '9007199254740992');
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('9007199254740992');
    h.store.adoptCommittedRevision(OWNER_KEY, '9007199254740993');
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('9007199254740993');
    h.store.adoptCommittedRevision(OWNER_KEY, '9007199254740992');
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('9007199254740993');
  });

  it('adoptCommittedRevision: a fresh account adopts forward from no row at all', async () => {
    const h = await loadedStore();
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBeNull();
    h.store.adoptCommittedRevision(OWNER_KEY, '1');
    expect(h.store.authority(OWNER_KEY)?.durableRev).toBe('1');
  });

  it('adoptCommittedRevision: ignored for a blocked owner and for an unknown one', async () => {
    // QUIESCED: a stale answer blocked the owner, and nothing may move it.
    const stale = await loadedStore({
      rowLoad: { kind: 'row', row: rowFixture({ durableRev: '7' }) },
      writeRow: async () => ({ kind: 'stale', durableRev: '12' }),
    });
    stale.edit(OWNER_KEY);
    stale.store.markDirty(OWNER_KEY);
    stale.store.save(OWNER_KEY);
    await tick(30);
    expect(stale.store.authority(OWNER_KEY)).toMatchObject({ blocked: true, durableRev: '7' });
    stale.store.adoptCommittedRevision(OWNER_KEY, '13');
    expect(stale.store.authority(OWNER_KEY)?.durableRev).toBe('7');

    // HELD before it ever loaded.
    const held = harness({
      rowLoad: { kind: 'row', row: rowFixture() },
      acquirePermit: async () => null,
    });
    await held.store.preload(ACCOUNT_ID);
    held.store.adoptCommittedRevision(OWNER_KEY, '13');
    expect(held.store.authority(OWNER_KEY)).toMatchObject({ blocked: true, durableRev: null });

    // UNKNOWN: no entry is created to hold the revision.
    const empty = harness();
    const entriesBefore = empty.store.stats().entries;
    empty.store.adoptCommittedRevision(OWNER_KEY, '13');
    expect(empty.store.authority(OWNER_KEY)).toBeNull();
    expect(empty.store.stats().entries).toBe(entriesBefore);
    expect(entriesBefore).toBe(0);
  });
});
