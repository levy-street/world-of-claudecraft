// THE LOGIN READ, WITH THE GLOBAL CLAIM (07a; the touch-set manifest's P4). The
// store's combined login port (readDurables) binds here on a realm that
// claims: one bounded transaction that proves this realm may serve the plot
// BEFORE it reads the row it will serve.
//
// THE ORDER IS THE CONTRACT:
// 1. The Hearth clock FIRST. A clock fault aborts the transaction, and had the
//    claim come first that abort would have rolled the claim back silently
//    while this realm believed it held it. On a fault the transaction is
//    rolled back and a SECOND one (a fresh checkout, since the fault may have
//    killed the connection) runs the plot half with the clock answered cold:
//    07's asymmetry kept, the plot fails closed and the clock fails open.
// 2. The plot id, read without a lock. No row at the primary slot means there
//    is nothing to claim yet (the first insert claims it, P3), and the ordinary
//    read answers `absent` or `unadmitted` as before.
// 3. A LOCK-FREE busy pre-check: another holder's LIVE claim answers
//    `claim_busy` at once, before the upsert (which would lock that holder's
//    row even when it refused) and before the row read (a busy realm reads
//    nothing it may not serve).
// 4. The acquire upsert, then 07's row read, unchanged. The plot is IN FLIGHT
//    in the registry from just before step 3 until the claim is recorded or
//    the read fails, so a renew pass about to release an older claim of this
//    holder's on the plot leaves it out (server/freehold_claim_registry.ts).
// 5. COMMIT with its tag checked. Only a proved COMMIT records the claim; a
//    lost answer leaves it unrecorded (it then expires after the TTL), and the
//    read is answered as THROWN so the store holds the plot rather than serving
//    a row whose claim it cannot prove.
//
// A LOCK timeout on the acquire (55P03) is contention on the claim row, not a
// fault in the plot: it answers `claim_busy`, the repairable hold, counted
// apart as busy contention. A statement timeout (57014) is a slow database and
// takes the throw arm, the store's `read_threw` hold, as a full pool does.
//
// ONE BUDGET FOR THE WHOLE READ: a single deadline signal, armed before the
// first checkout, bounds both transactions, their checkout waits included, so
// a full pool or the clock-fault retry can never stretch a login past it. On
// expiry the transaction in flight is cut (its socket destroyed; the detached
// backend still has its own statement and idle bounds): before COMMIT that is
// a plain failure, at COMMIT it is FreeholdCommitAmbiguous, and either way the
// read THROWS, the store's repairable `read_threw` hold, so no claim whose
// COMMIT may have landed is ever recorded or answered as held. A claim that
// did land unrecorded is this realm's own and expires after the TTL.
import { acquireFreeholdClaim } from './freehold_claim_db';
import type { FreeholdClaimRegistry } from './freehold_claim_registry';
import {
  type FreeholdQueryable,
  type FreeholdRowLoad,
  freeholdPrimaryPlotIdOnClient,
} from './freehold_db';
import type { FreeholdHearthLoad } from './freehold_hearth_db';
import type { FreeholdHearthAnswer } from './freehold_persist_types';
import { type FreeholdTxPool, runFreeholdTransaction } from './freehold_tx';

/** The login transaction's bounds: 07's 2 s statement bound, a lock bound under
 *  it so a held claim row answers 55P03 (busy) before the statement bound, an
 *  idle bound, and the store's whole-login budget as the wall. */
export const FREEHOLD_CLAIM_LOGIN_BOUNDS = Object.freeze({
  operation: 'freehold login read',
  statementMs: 2_000,
  lockMs: 1_000,
  idleMs: 2_000,
  wallMs: 10_000,
});

/** Carries the claim-busy answer out of the transaction (so it commits nothing
 *  further and the row is never read). */
class ClaimBusy extends Error {
  constructor(
    readonly plotId: string,
    /** The acquire's lock bound ran out (55P03), rather than a live claim. */
    readonly contention = false,
  ) {
    super('freehold claim busy');
  }
}

/** The acquire's LOCK bound ran out: another transaction holds the claim row
 *  right now (a renewal, a trip, a write), which is contention to be held as
 *  busy and counted apart. A statement timeout (57014) is a slow database, not
 *  a held row, so it takes the throw arm (the store's read_threw hold). */
const contentionCode = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === '55P03';

export interface FreeholdClaimLoginDeps {
  readonly pool: FreeholdTxPool;
  readonly registry: FreeholdClaimRegistry;
  readonly holder: string;
  readonly realm: string;
  readonly ttlSeconds: number;
  readRow(db: FreeholdQueryable): Promise<FreeholdRowLoad>;
  readHearth(db: FreeholdQueryable): Promise<FreeholdHearthLoad>;
  nowMs(): number;
  /** This realm just became the plot's proved authority: the operation
   *  recovery pass for the account is scheduled here (fire and forget). */
  onClaimed?(accountId: number): void;
  /** The whole read's budget; FREEHOLD_CLAIM_LOGIN_BOUNDS.wallMs (the store's
   *  login budget) unless a suite narrows it. */
  readonly budgetMs?: number;
  /** Mints that budget's signal, once per read: AbortSignal.timeout(budgetMs)
   *  unless a suite hands one it aborts by hand. */
  readonly budgetSignal?: () => AbortSignal;
}

/** The plot's in-flight mark, once the read takes it; let go by the caller. */
interface InFlightHold {
  letGo: (() => void) | null;
}

export async function readClaimedLoginDurables(
  deps: FreeholdClaimLoginDeps,
  accountId: number,
): Promise<{ row: FreeholdRowLoad; hearth: FreeholdHearthAnswer }> {
  const { registry } = deps;
  const startMs = deps.nowMs();
  // The ONE in-flight mark the read can take: the plot half reaches a plot
  // at most once, since the clock-fault retry runs only after a first
  // transaction whose clock threw before its plot half began.
  const hold: InFlightHold = { letGo: null };
  try {
    return await claimedLoginRead(deps, accountId, hold);
  } finally {
    // After record() or the failure.
    hold.letGo?.();
    registry.counters.loginReads++;
    registry.counters.loginReadMsTotal += Math.max(0, deps.nowMs() - startMs);
  }
}

async function claimedLoginRead(
  deps: FreeholdClaimLoginDeps,
  accountId: number,
  hold: InFlightHold,
): Promise<{ row: FreeholdRowLoad; hearth: FreeholdHearthAnswer }> {
  const { registry } = deps;
  const budget = {
    signal:
      deps.budgetSignal?.() ??
      AbortSignal.timeout(deps.budgetMs ?? FREEHOLD_CLAIM_LOGIN_BOUNDS.wallMs),
  };
  let acquired: { plotId: string; generation: string; takeover: boolean } | null = null;
  const plotHalf = async (db: FreeholdQueryable): Promise<FreeholdRowLoad> => {
    const plotId = await freeholdPrimaryPlotIdOnClient(db, accountId);
    if (plotId !== null) {
      // IN FLIGHT from here until after record() or the failure (the caller
      // lets go): a renew pass re-checks this mark right before it sends a
      // release, so it never renames the row this acquire re-stamps at the
      // SAME generation (a same-holder re-acquire keeps it). Any earlier mark
      // is let go first: the plot half runs once per read today, so this is a
      // guard, but a second run must never leak the first run's mark.
      hold.letGo?.();
      hold.letGo = registry.holdInFlight(plotId);
      let claim: Awaited<ReturnType<typeof acquireFreeholdClaim>>;
      try {
        claim = await acquireFreeholdClaim(db, {
          plotId,
          accountId,
          realm: deps.realm,
          holder: deps.holder,
          ttlSeconds: deps.ttlSeconds,
        });
      } catch (error) {
        if (contentionCode(error)) throw new ClaimBusy(plotId, true);
        throw error;
      }
      if (claim.kind === 'busy') throw new ClaimBusy(plotId);
      acquired = { plotId, generation: claim.generation, takeover: claim.takeover };
    }
    return deps.readRow(db);
  };
  // Both counts at the ONE place a busy answer is made, so the contention
  // count stays a subset of busy even when a failed rollback replaces the
  // ClaimBusy with another error (that login then holds, never answers busy).
  const busy = (refusal: ClaimBusy): FreeholdRowLoad => {
    registry.counters.busy++;
    if (refusal.contention) registry.counters.busyContention++;
    return { kind: 'claim_busy', plotIndex: 0, plotId: refusal.plotId };
  };
  const record = () => {
    if (acquired === null) return;
    // A pending token on this plot asked whether an earlier write of ours
    // landed. The acquire above locked the claim row, which waited out any
    // transaction still holding it, and the row read after it saw that
    // outcome, so the store installs from the answer and the question is
    // superseded. (A write needs a loaded entry and this read runs only for an
    // entry that is not, so no write still in flight can be asking it.)
    registry.clearPending(acquired.plotId);
    registry.record({
      plotId: acquired.plotId,
      accountId,
      generation: acquired.generation,
      acquiredAtMs: deps.nowMs(),
    });
    registry.counters.acquired++;
    if (acquired.takeover) registry.counters.takeovers++;
    deps.onClaimed?.(accountId);
  };

  let hearth: FreeholdHearthAnswer | undefined;
  try {
    const row = await runFreeholdTransaction(
      deps.pool,
      FREEHOLD_CLAIM_LOGIN_BOUNDS,
      async (tx) => {
        try {
          hearth = await deps.readHearth(tx);
        } catch (error) {
          hearth = { kind: 'threw', error };
          throw error;
        }
        return plotHalf(tx);
      },
      budget,
    );
    record();
    return { row, hearth: hearth as FreeholdHearthAnswer };
  } catch (error) {
    if (error instanceof ClaimBusy) {
      return { row: busy(error), hearth: hearth ?? { kind: 'threw', error } };
    }
    // A clock fault: the plot half again, alone, with the clock answered cold.
    if (hearth !== undefined && hearth.kind === 'threw' && acquired === null) {
      const clock = hearth;
      try {
        // The SAME budget: an exhausted one refuses before any checkout.
        const row = await runFreeholdTransaction(
          deps.pool,
          FREEHOLD_CLAIM_LOGIN_BOUNDS,
          plotHalf,
          budget,
        );
        record();
        return { row, hearth: clock };
      } catch (retryError) {
        if (retryError instanceof ClaimBusy) return { row: busy(retryError), hearth: clock };
        throw retryError;
      }
    }
    // The plot half failed, or COMMIT could not be proved: the row is held.
    throw error;
  }
}
