// THE PLOT STORE'S WRITE PORT, behind the global claim (07a; the touch-set
// manifest's P2 and P3). server/freehold_persist.ts calls `writeRow` exactly as
// it called 07's upsertFreehold, and this module decides which fenced shape the
// write takes:
//
// - An EXISTING row is written by ONE autocommit statement
//   (upsertFencedFreehold), so a dirty plot pays exactly what 07's write paid:
//   the claim fence and its fresh token, then the CAS, in that lock order.
// - The FIRST row of a new plot is a short transaction that inserts the claim
//   at generation 1 beside the plot row, so a lost insert race rolls both back
//   and a claim never names a row that does not exist.
// - A write whose previous attempt for the same plot ended AMBIGUOUS (an answer
//   lost after the statement was sent, which nothing proves rolled back) first
//   locks the claim row and reads the token the last write left. The lock waits
//   out a transaction still holding the row, so the reading is never the
//   pre-commit version. Equal to the pending token proves the earlier write
//   LANDED: the expected revision adopts the row's current one and the new
//   document goes out on top. That is how this realm tells its own ambiguous
//   commit from another realm's (the rollout contract's R2 self-fence), and it
//   is sound only because every account_freeholds writer stamps a fresh token.
//
// A plot the registry holds no claim for answers `fenced` without a statement:
// this process is not that plot's authority, so it writes nothing and the store
// quiesces the owner.
import {
  insertFreeholdClaimOnClient,
  lockFreeholdClaimTokenOnClient,
  mintFreeholdWriteToken,
} from './freehold_claim_db';
import type { FreeholdClaimRegistry } from './freehold_claim_registry';
import {
  type FreeholdFencedUpsertResult,
  type FreeholdQueryable,
  type FreeholdUpsert,
  freeholdDurableRevOnClient,
  upsertFencedFreehold,
  upsertFreehold,
} from './freehold_db';
import {
  FreeholdCommitAmbiguous,
  type FreeholdTxPool,
  freeholdCommitMayHaveLanded,
  freeholdLockTimeout,
  runFreeholdTransaction,
} from './freehold_tx';

/** The first-insert and ambiguous-retry transactions: 07's statement default,
 *  a lock bound so a claim row held by a long transaction answers 55P03 (a
 *  thrown blip the store retries) instead of eating the statement bound. */
export const FREEHOLD_FENCED_WRITE_BOUNDS = Object.freeze({
  operation: 'freehold fenced plot write',
  statementMs: 15_000,
  lockMs: 2_000,
  idleMs: 2_000,
  wallMs: 30_000,
});

/** Carries a non-insert answer out of the insert transaction so the claim
 *  insert beside it rolls back. Never escapes this module. */
class InsertNotLanded extends Error {
  constructor(readonly result: FreeholdFencedUpsertResult) {
    super('freehold first insert did not land');
  }
}

export interface FreeholdFencedWriterDeps {
  readonly pool: FreeholdTxPool & FreeholdQueryable;
  readonly registry: FreeholdClaimRegistry;
  readonly holder: string;
  readonly realm: string;
  readonly ttlSeconds: number;
  nowMs(): number;
}

export function createFreeholdFencedWriter(
  deps: FreeholdFencedWriterDeps,
): (input: FreeholdUpsert) => Promise<FreeholdFencedUpsertResult> {
  const { registry } = deps;
  // The owner rides beside the token so the renewer can retire a token whose
  // plot has no claim (see the registry's unclaimedPending).
  const notePending = (input: FreeholdUpsert, writeToken: string): void =>
    registry.notePending({
      plotId: input.plotId,
      accountId: input.accountId,
      writeToken,
      notedAtMs: deps.nowMs(),
    });
  // A lock or statement bound that ran out is contention or a slow database,
  // counted apart so it never reads as a refusal (the write rethrows as before).
  const countTimeout = (error: unknown): void => {
    if (freeholdLockTimeout(error)) registry.counters.lockTimeouts++;
  };

  async function insertFirst(input: FreeholdUpsert): Promise<FreeholdFencedUpsertResult> {
    const token = mintFreeholdWriteToken();
    const pending = registry.pendingToken(input.plotId);
    // Counted once the COMMIT is proved, never from inside the transaction.
    let adopted = false;
    try {
      const result = await runFreeholdTransaction(
        deps.pool,
        FREEHOLD_FENCED_WRITE_BOUNDS,
        async (tx): Promise<FreeholdFencedUpsertResult> => {
          const claimed = await insertFreeholdClaimOnClient(tx, {
            plotId: input.plotId,
            accountId: input.accountId,
            realm: deps.realm,
            holder: deps.holder,
            writeToken: token,
            ttlSeconds: deps.ttlSeconds,
          });
          if (!claimed) {
            // The minted id already has a claim: only this realm's own earlier
            // ambiguous insert can produce that. The token proves it or not.
            const fence = { plotId: input.plotId, holder: deps.holder, generation: '1' };
            const locked =
              pending === null ? null : await lockFreeholdClaimTokenOnClient(tx, fence);
            if (!locked || locked.writeToken !== pending) {
              throw new InsertNotLanded({
                kind: 'conflict',
                detail: 'the minted plot identity is already claimed',
              });
            }
            const current = await freeholdDurableRevOnClient(tx, input.accountId, input.plotIndex);
            if (current === null) throw new InsertNotLanded({ kind: 'missing' });
            adopted = true;
            const updated = await upsertFencedFreehold(
              tx,
              { ...input, expectedDurableRev: current },
              { ...fence, writeToken: token },
            );
            if (updated.kind !== 'updated') throw new InsertNotLanded(updated);
            return { kind: 'inserted', durableRev: updated.durableRev };
          }
          const inserted = await upsertFreehold(tx, input);
          if (inserted.kind !== 'inserted') throw new InsertNotLanded(inserted);
          return inserted;
        },
      );
      if (adopted) registry.counters.selfAdopted++;
      registry.clearPending(input.plotId);
      registry.record({
        plotId: input.plotId,
        accountId: input.accountId,
        generation: '1',
        acquiredAtMs: deps.nowMs(),
      });
      return result;
    } catch (error) {
      if (error instanceof InsertNotLanded) return error.result;
      countTimeout(error);
      // No claim is recorded on this arm: the renewer retires the token once
      // nothing wants the owner, and a proved login read of the plot supersedes it.
      if (error instanceof FreeholdCommitAmbiguous) notePending(input, token);
      throw error;
    }
  }

  async function updateExisting(input: FreeholdUpsert): Promise<FreeholdFencedUpsertResult> {
    const claim = registry.forPlot(input.plotId);
    if (!claim) {
      registry.counters.fencedWrites++;
      return { kind: 'fenced' };
    }
    const token = mintFreeholdWriteToken();
    const fence = {
      plotId: input.plotId,
      holder: deps.holder,
      generation: claim.generation,
      writeToken: token,
    };
    const pending = registry.pendingToken(input.plotId);
    let result: FreeholdFencedUpsertResult;
    if (pending === null) {
      try {
        result = await upsertFencedFreehold(deps.pool, input, fence);
      } catch (error) {
        countTimeout(error);
        // One autocommit statement: once it was sent, only a proved rollback
        // says it did not land.
        if (freeholdCommitMayHaveLanded(error)) notePending(input, token);
        throw error;
      }
    } else {
      let adopted = false;
      try {
        result = await runFreeholdTransaction(
          deps.pool,
          FREEHOLD_FENCED_WRITE_BOUNDS,
          async (tx): Promise<FreeholdFencedUpsertResult> => {
            const locked = await lockFreeholdClaimTokenOnClient(tx, fence);
            if (!locked) return { kind: 'fenced' };
            let expected = input.expectedDurableRev;
            if (locked.writeToken === pending) {
              const current = await freeholdDurableRevOnClient(
                tx,
                input.accountId,
                input.plotIndex,
              );
              if (current === null) return { kind: 'missing' };
              expected = current;
              adopted = true;
            }
            return upsertFencedFreehold(tx, { ...input, expectedDurableRev: expected }, fence);
          },
        );
      } catch (error) {
        countTimeout(error);
        // A NEW ambiguity replaces the old question; any other failure leaves
        // the old one open for the next attempt to ask again.
        if (error instanceof FreeholdCommitAmbiguous) notePending(input, token);
        throw error;
      }
      if (adopted) registry.counters.selfAdopted++;
      registry.clearPending(input.plotId);
    }
    if (result.kind === 'fenced') {
      registry.counters.fencedWrites++;
      // Only the claim this write was fenced UNDER: a newer one recorded while
      // it was in flight (a re-login at a later generation) is not this
      // write's to drop, the renewer's dropHeld identity rule.
      if (registry.forPlot(input.plotId)?.generation === claim.generation) {
        registry.drop(input.plotId);
      }
    }
    return result;
  }

  return (input) =>
    input.expectedDurableRev === null ? insertFirst(input) : updateExisting(input);
}
