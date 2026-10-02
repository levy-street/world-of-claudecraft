// THE COMPOSITION ROOT for the housing persistence store: the one place that
// binds server/freehold_persist.ts's declared ports to the real pool, the real
// sim and the real background gate. It lives beside the store rather than
// inside it so the store file imports no SQL at all and is defined purely by
// its port surface, which is what lets a Vitest drive the whole lifecycle with
// neither a database nor a GameServer. Moved here from the tail of
// server/freehold_persist.ts. An earlier version of this line claimed the move
// changed nothing in the factory; a reviewer showed it had silently dropped the
// statement bound off the two-port fallback, which is restored below.
import { FREEHOLD_TIER_IDS } from '../src/sim/content/freehold';
import { normalizeFreehold } from '../src/sim/freehold/persisted';
import { FREEHOLD_VISIT_POLICIES } from '../src/sim/freehold/types';
import type { SimContext } from '../src/sim/sim_context';
import { LEASE_TTL_SECONDS, PROCESS_LEASE_HOLDER } from './character_lease_db';
import { pool, runWithStatementTimeout } from './db';
import { registerFreeholdRecovery } from './freehold_authority_registry';
import { readClaimedLoginDurables } from './freehold_claim_login';
import {
  type FreeholdClaimRegistry,
  type FreeholdHeldClaim,
  renewFreeholdClaims,
} from './freehold_claim_registry';
import { freeholdForAccount, mintFreeholdPlotId } from './freehold_db';
import { createFreeholdFencedWriter } from './freehold_fenced_write';
import { loadFreeholdHearth } from './freehold_hearth_db';
import { freeholdLivenessPorts } from './freehold_liveness';
import { openFreeholdOperationsForAccount } from './freehold_operation_db';
import {
  createFreeholdOperationRecovery,
  FREEHOLD_OPERATION_RECONCILERS,
} from './freehold_operation_recovery';
import {
  createFreeholdPersistStore,
  FREEHOLD_PERSIST_LOGIN_BUDGET_MS,
  FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS,
  type FreeholdPersistStore,
} from './freehold_persist';
import { freeholdOwnerKeyForAccount } from './freehold_wire';
import { REALM } from './realm';
import { createKeyedSerialWriter } from './serial_writer';

/**
 * The realm's store, composed. This factory exists so the coordinator's
 * constructor stays two lines: every port below is a closure over the live sim,
 * the shared background gate and the pool, and none of it belongs in a file at
 * its line ceiling. The store itself never sees any of these.
 *
 * The gate is optional exactly as it is for the guild bank lazy loader: a host
 * without one runs unadmitted rather than reaching for a global, and the bound
 * on the permit wait lives in the store.
 */
/** The realm's live tier and visit-policy vocabulary. Both sides of the
 *  writable-implies-readable property read it from here. */
const REALM_IDENTITY_SETS = {
  validTierIds: FREEHOLD_TIER_IDS as ReadonlySet<string>,
  validVisitPolicies: FREEHOLD_VISIT_POLICIES,
};

export function createGameFreeholdPersistStore(deps: {
  readonly sim: { readonly ctx: SimContext };
  readonly backgroundDbGate?: {
    acquire(signal?: AbortSignal): Promise<{ release(): void } | null>;
    tryAcquire?(): { release(): void } | null;
  };
  /** 07a: this process's held plot claims. REQUIRED: the realm store reads and
   *  writes only behind the global claim, so there is no unfenced shape. */
  readonly claims: FreeholdClaimRegistry;
}): FreeholdPersistStore {
  const writer = createKeyedSerialWriter<string>();
  const gate = deps.backgroundDbGate;
  // 07a: the operation recovery pass, scheduled when this realm claims a plot.
  // Its reconciler map is EMPTY in this release, so a pass issues nothing.
  const recovery = createFreeholdOperationRecovery({
    reconcilers: FREEHOLD_OPERATION_RECONCILERS,
    discover: (accountId) => openFreeholdOperationsForAccount(pool, accountId),
    tryAcquirePermit: freeholdRecoveryPermitPort(gate),
    holdInFlight: (plotId) => deps.claims.holdInFlight(plotId),
    warn: (message) => console.warn(message),
  });
  registerFreeholdRecovery(recovery.counters);
  const fencedWrite = createFreeholdFencedWriter({
    pool,
    registry: deps.claims,
    holder: PROCESS_LEASE_HOLDER,
    realm: REALM,
    ttlSeconds: LEASE_TTL_SECONDS,
    nowMs: Date.now,
  });
  return createFreeholdPersistStore({
    // The two-port fallback: unused on THIS host, because readDurables below is
    // bound and the store prefers it, but still BOUNDED. Extracting this file
    // dropped these two wrappers and left the pair on the pool's 15,000 ms
    // session default; that was a regression, not a decision, and a reviewer
    // caught the header claiming otherwise. Kept because the ports are the
    // store's declared surface and a host without a transaction seam still
    // needs them. The WHOLE preload's own cap sits above both shapes, in the
    // store (FREEHOLD_PERSIST_LOGIN_BUDGET_MS).
    readRow: (accountId, maxOwnedBytes) =>
      runWithStatementTimeout(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS, (query) =>
        freeholdForAccount({ query }, accountId, maxOwnedBytes),
      ),
    readHearth: (accountId) =>
      runWithStatementTimeout(FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS, (query) =>
        loadFreeholdHearth({ query }, accountId),
      ),
    // BOTH LOGIN READS, BOUNDED, ON ONE CHECKED-OUT CLIENT. The bound needs the
    // one seam that can lower the pool's own statement timeout, and that seam is
    // a transaction; wrapping each read separately bought the right bound at
    // four times the network cost, on the one path where a player is waiting.
    // Eight round trips and two clients held across four statements apiece
    // became five and one. The store's permit bound is deliberately short and
    // would otherwise sit in front of a statement three times longer than
    // itself; see FREEHOLD_PERSIST_LOGIN_STATEMENT_TIMEOUT_MS for the residual
    // this still does not close.
    //
    // The ROW read may throw: loadOnce turns that into a hold. If it does, this
    // transaction rolls back and the clock is never read, which is the same cold
    // clock the caller would have taken anyway.
    //
    // THE GUARD IS AROUND THE WHOLE TRANSACTION, not around the clock read, and
    // that distinction is the fix for a real hole. An inner `.catch` sees only
    // loadFreeholdHearth's own promise; it cannot see the COMMIT that
    // runWithStatementTimeout issues afterwards. A clock fault that leaves the
    // connection USABLE (a relation error, a statement timeout) lets COMMIT
    // answer a ROLLBACK tag and the row lands. A clock fault that KILLS the
    // connection (backend crash, restart, dropped socket) makes COMMIT reject,
    // the helper rethrow, and the port reject, which loadOnce turns into a
    // write-blocking hold on the house for a fault in the clock. The two-port
    // pair answers that same fault with a cold clock and a normal login, and
    // which port a host binds must not decide it. So the row is captured as it
    // is read, and any later rejection with a row in hand is answered as a
    // thrown CLOCK rather than a failed row.
    //
    // 07a: the transaction also takes the plot's GLOBAL CLAIM before it reads
    // the row (server/freehold_claim_login.ts, the touch-set manifest's P4), so
    // a realm proves it may serve the plot before it reads what it will serve,
    // and another realm's live claim answers the repairable `claim_busy` hold
    // instead of a silently write-blocked plot. The clock is read FIRST so a
    // clock fault can never roll the claim back unseen; the asymmetry above is
    // kept (the clock fails open, the plot fails closed).
    readDurables: (accountId, maxOwnedBytes) =>
      readClaimedLoginDurables(
        {
          pool,
          registry: deps.claims,
          holder: PROCESS_LEASE_HOLDER,
          realm: REALM,
          ttlSeconds: LEASE_TTL_SECONDS,
          readRow: (db) => freeholdForAccount(db, accountId, maxOwnedBytes),
          readHearth: (db) => loadFreeholdHearth(db, accountId),
          nowMs: Date.now,
          onClaimed: (claimed) => recovery.schedule(claimed),
        },
        accountId,
      ),
    // 07a: every write behind the plot's claim (server/freehold_fenced_write.ts).
    writeRow: fencedWrite,
    // ONE declaration of the realm's identity sets, consumed by BOTH sides.
    // Declaring them twice is how a load that refuses a tier and a save that
    // accepts it come to disagree.
    normalize: (raw) => normalizeFreehold(raw, REALM_IDENTITY_SETS),
    identitySets: () => REALM_IDENTITY_SETS,
    // All four liveness reads over the ONE live map, through the function the
    // store's suite binds too, so the two cannot model different sims.
    ...freeholdLivenessPorts(() => deps.sim.ctx),
    enabled: () => deps.sim.ctx.freeholdsEnabled,
    mintPlotId: () => mintFreeholdPlotId(),
    claimHeld: (plotId) => deps.claims.forPlot(plotId) !== undefined,
    // No gate means no admission control on this host, not an unbounded wait.
    acquirePermit: gate
      ? (signal) => gate.acquire(signal)
      : () => Promise.resolve({ release: () => {} }),
    enqueue: (key, signal, write) => writer.enqueueCancellable(key, signal, write),
    nowMs: Date.now,
    warn: (message) => console.warn(message),
    error: (message, err) => console.error(message, ...(err === undefined ? [] : [err])),
  });
}

/**
 * The recovery pass's admission: an IMMEDIATE background permit (a busy gate,
 * or one without tryAcquire, skips the pass rather than queueing behind player
 * work; the account's next claim tries again). No gate at all means no
 * admission control on this host (the store's own rule above), so the pass is
 * admitted, never skipped forever.
 */
export function freeholdRecoveryPermitPort(gate?: {
  tryAcquire?(): { release(): void } | null;
}): () => { release(): void } | null {
  if (!gate) return () => ({ release: () => {} });
  return () => gate.tryAcquire?.() ?? null;
}

/**
 * Whether the realm still wants one held claim: the store still needs the
 * owner (a session reference or owed work), the sim still holds the owner's
 * live record, a mutation or recovery pass is in flight for the plot, or the
 * claim is younger than the login budget (a handshake between its first ask
 * and its join bind). Pure over its three live sources, so each arm is
 * testable without a database.
 */
export function gameFreeholdClaimWanted(
  sim: { readonly ctx: Pick<SimContext, 'freeholds'> },
  store: Pick<FreeholdPersistStore, 'wantsClaim'>,
  claims: Pick<FreeholdClaimRegistry, 'inFlight'>,
): (claim: FreeholdHeldClaim, nowMs: number) => boolean {
  return (claim, nowMs) => {
    const ownerKey = freeholdOwnerKeyForAccount(claim.accountId);
    return (
      store.wantsClaim(ownerKey) ||
      sim.ctx.freeholds.has(ownerKey) ||
      claims.inFlight(claim.plotId) ||
      nowMs - claim.acquiredAtMs < FREEHOLD_PERSIST_LOGIN_BUDGET_MS
    );
  };
}

/**
 * One pass of the claim renewer for the realm's store (the periodic flush's
 * `renewFreeholdClaims`): every claim gameFreeholdClaimWanted keeps is renewed,
 * every other one released. Never rejects. Its SYNCHRONOUS launch (the copy,
 * sort and wanted tests before the first await) is reported to `onSyncMs`, the
 * GameServer's save observer, so it bills the Tick Profiler's `saves` phase
 * beside saveFreeholds instead of hiding in `lateness`.
 *
 * ON THE RAW POOL, OUTSIDE backgroundDbGate, by decision: the autosave wave
 * holds that gate at exactly the moment this pass starts (same 30 s flush), so
 * a tryAcquire would skip renewals through every busy wave and let held claims
 * lapse to another realm, and a queued acquire would park the heartbeat behind
 * the saves it exists to protect. The sanctioned bound instead: the pass is
 * single-flight and runs its chunks in sequence, so the renewer holds at most
 * ONE pool client per realm, and its whole pass is capped by
 * FREEHOLD_CLAIM_RENEW_PASS_DEADLINE_MS (pinned by the renewer's peak-1 case in
 * tests/server/freehold_mutation.test.ts).
 *
 * THE POOL ARITHMETIC AT THE FLUSH, stated rather than assumed: the background
 * gate admits the pool maximum less BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM, and
 * the clients outside it are this renewer's one, the lease heartbeat's one
 * statement and the bank-ledger FIFO tail's one, so at the flush instant those
 * three can take every client the headroom leaves (it is composition headroom,
 * not a reserve: server/background_db_gate.ts). The renewer's share is one
 * chunk at a time (about 7 ms measured, docs/freeholds/qa/mutation-2026-09-30/
 * workload-evidence.md), and tests/server/tunables.test.ts pins the headroom
 * at least the renewer plus the heartbeat plus one request-path client.
 */
export function renewGameFreeholdClaims(
  sim: { readonly ctx: SimContext },
  store: Pick<FreeholdPersistStore, 'wantsClaim'>,
  claims: FreeholdClaimRegistry,
  onSyncMs?: (ms: number) => void,
): Promise<void> {
  const launchedAt = performance.now();
  const pass = renewFreeholdClaims({
    registry: claims,
    pool,
    holder: PROCESS_LEASE_HOLDER,
    ttlSeconds: LEASE_TTL_SECONDS,
    wanted: gameFreeholdClaimWanted(sim, store, claims),
    // NO onLost, by decision. A claim the pass drops (another holder took it,
    // or our landed release raced a same-generation re-login) has already left
    // the registry, and every write, trip and mutation reads its claim from
    // there, so nothing more goes out for the plot: the owner's next write
    // answers `fenced` with no statement, and the store quiesces the entry
    // then, through the one quiesce path it owns (its counter and warn line).
    // A hook would be a second way into the store's private state for no
    // safety gain; until that write, the pass's own warn lines say it happened.
    nowMs: Date.now,
    warn: (message) => console.warn(message),
  });
  // The observer only times the launch: one that throws must never cost the
  // flush its handle on the pass (whose own rejection the flush reports), and
  // it says so in fixed text ONCE per registry, not once per 30 s flush.
  try {
    onSyncMs?.(performance.now() - launchedAt);
  } catch {
    if (!launchObserverWarned.has(claims)) {
      launchObserverWarned.add(claims);
      console.warn(
        'freehold claim renewer launch observer threw; the pass runs on, and later throws are not logged',
      );
    }
  }
  return pass;
}

/** The registries whose launch observer has already thrown once. */
const launchObserverWarned = new WeakSet<FreeholdClaimRegistry>();
