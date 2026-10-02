// THE HOUSING MUTATION BOUNDARY (07a deliverable 2;
// docs/freeholds/mutation-touch-set-manifest.md P1 and P9): commitFreeholdMutation
// composes exact item and gold transfers with housing effects in ONE bounded
// character-save transaction, through the character save's housing hook
// (server/character_save_housing.ts). The character half is whatever the
// caller's save writes; the housing halves are the participants below, run in
// the manifest's global order after every legacy effect and before COMMIT:
//   G4 the plot claims (read fences, or write fences that stamp a fresh token),
//   G5b and G6 the operation intents closed into their receipts,
//   G7 the plot rows' compare-and-swap,
//   G8 the account Hearth advance.
// Any participant's refusal throws, so every half rolls back; the character
// lease-nonce fence runs before all of them, so a displaced session commits
// nothing.
//
// THE OUTCOME COMES FROM THE HOOK, never from the save's boolean (the save's
// `true` means "did not fence out", and it can answer true without writing).
// A lost COMMIT answer is AMBIGUOUS, and nothing re-applies until the verify
// (P9) answers: it runs as the continuation of the SAME character-FIFO job,
// first waiting on the character row the hung transaction locked, then reading
// each participant's own evidence as separate statements, so a row the hung
// transaction inserted is visible once it committed.
//
// No SQL of its own: the hook's bound and the verify's wait live in
// server/freehold_mutation_db.ts and every participant's statements in its own
// *_db.ts module; no GameServer import (the save is injected), so a Vitest
// drives every arm without a database.
import {
  CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS,
  DELETE_RESTORE_STATEMENT_TIMEOUT_MS,
} from './character_delete_db';
import type {
  CharacterSaveHousingHook,
  CharacterSaveHousingQueryable,
} from './character_save_housing';
import { CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS } from './character_save_transaction';
import type { DbTransactionDeadlineClient } from './db_transaction_deadline';
import {
  type FreeholdClaimFence,
  fenceFreeholdClaimOnClient,
  lockFreeholdClaimFenceOnClient,
  mintFreeholdWriteToken,
  readFreeholdClaimOnClient,
} from './freehold_claim_db';
import { type FreeholdUpsert, upsertFreehold } from './freehold_db';
import {
  advanceFreeholdHearthOnClient,
  type FreeholdHearthAdvance,
  freeholdHearthAdvanceLandedOnClient,
} from './freehold_hearth_db';
import {
  boundFreeholdHookStatementsOnClient,
  waitOutCharacterRowOnClient,
} from './freehold_mutation_db';
import {
  closeFreeholdOperationOnClient,
  type FreeholdOperationApplyRefusal,
  freeholdOperationClosedOnClient,
} from './freehold_operation_db';
import {
  type FreeholdTxPool,
  freeholdCommitMayHaveLanded,
  runFreeholdTransaction,
} from './freehold_tx';

/** The hook's explicit statement bound (CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS)
 *  for the HOOK'S STATEMENTS, whatever bound the save opened with. It does NOT
 *  bound COMMIT: PostgreSQL 16 stops the statement timer before the deferred
 *  triggers run at commit (the manifest's section 3, measured), so COMMIT is
 *  bounded by the save's lock_timeout (2 s, the growth budget's lock wait) and
 *  its 65 s wall with the backend cancel. */
export const FREEHOLD_HOOK_STATEMENT_TIMEOUT_MS = CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS;

/** The verify's bounds: CHARACTER_DELETE_VERIFY_SQL's (its statement and lock
 *  bounds, assigned from the character-delete verify's own constants, and an
 *  idle bound of 2 s) under a wall that covers both. */
export const FREEHOLD_VERIFY_BOUNDS = Object.freeze({
  operation: 'freehold mutation verify',
  statementMs: DELETE_RESTORE_STATEMENT_TIMEOUT_MS,
  lockMs: CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS,
  idleMs: 2_000,
  wallMs: 30_000,
});

/** A plot write: the CAS input (an EXISTING row) and the claim it must hold. */
export interface FreeholdPlotWrite {
  readonly upsert: FreeholdUpsert & { readonly expectedDurableRev: string };
  readonly fence: FreeholdClaimFence;
}

export interface FreeholdOperationApply {
  readonly operationId: string;
  /** The intent's account: a declared account participant, so the receipt's
   *  foreign-key lock is one the save already holds at G1. */
  readonly accountId: number;
  readonly fingerprint: string;
  /** The plot the intent was prepared for (null for a plot-less one). A
   *  plot-scoped apply writes that plot in the SAME request under the same
   *  fence and revision, so the receipt's applied revision is that write's. */
  readonly plotId: string | null;
  readonly fenceGeneration: string | null;
  readonly expectedDurableRev: string | null;
}

export interface FreeholdMutationRequest {
  /** Every account a participant touches; joined into the save's G1 set. */
  readonly accountIds: readonly number[];
  /** Claims proved without a plot write (the Hearth trip's admission proof). */
  readonly claimProofs: readonly FreeholdClaimFence[];
  readonly plots: readonly FreeholdPlotWrite[];
  readonly operations: readonly FreeholdOperationApply[];
  readonly hearth: { readonly accountId: number; readonly cooldownMs: number } | null;
}

export type FreeholdMutationRefusal =
  | { readonly kind: 'claim'; readonly plotId: string }
  | { readonly kind: 'plot'; readonly plotId: string; readonly result: string }
  | {
      readonly kind: 'operation';
      readonly operationId: string;
      readonly reason: FreeholdOperationApplyRefusal;
    }
  | {
      readonly kind: 'hearth';
      readonly result: Exclude<FreeholdHearthAdvance, { kind: 'advanced' }>;
    };

/** Thrown by a participant to roll every half back. */
export class FreeholdMutationRefused extends Error {
  readonly code = 'FREEHOLD_MUTATION_REFUSED' as const;

  constructor(readonly refusal: FreeholdMutationRefusal) {
    super(`housing mutation refused (${refusal.kind})`);
    this.name = 'FreeholdMutationRefused';
  }
}

export type FreeholdMutationOutcome =
  | {
      readonly kind: 'committed';
      readonly plots: readonly { readonly plotId: string; readonly durableRev: string }[];
      readonly hearth: Extract<FreeholdHearthAdvance, { kind: 'advanced' }> | null;
      /** True when the commit answer was lost and the verify proved it landed. */
      readonly verified: boolean;
    }
  | { readonly kind: 'refused'; readonly refusal: FreeholdMutationRefusal }
  /** The save never reached the hook: a fence miss, a quarantine, the vault
   *  guard, the no-state arm, a guild-book refusal. Nothing housing happened. */
  | { readonly kind: 'not_run' }
  /** Proved not committed (a statement error, a ROLLBACK tag, a cancelled wait). */
  | { readonly kind: 'failed'; readonly error: unknown }
  /** The commit answer was lost and the verify proved it did NOT land. */
  | { readonly kind: 'not_landed'; readonly error: unknown }
  /** The commit answer was lost and the verify could not decide. */
  | { readonly kind: 'unresolved'; readonly error: unknown };

interface HookState {
  ran: boolean;
  commitSent: boolean;
  committed: boolean;
  plots: { plotId: string; durableRev: string }[];
  hearth: Extract<FreeholdHearthAdvance, { kind: 'advanced' }> | null;
  verify: 'landed' | 'not_landed' | 'unresolved' | null;
}

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function addOne(rev: string): string {
  return (BigInt(rev) + 1n).toString();
}

function assertRequest(request: FreeholdMutationRequest): void {
  // The verify needs per-attempt evidence: a Hearth advance token or a plot
  // write token. A proof-only request has none (it could only ever verify as
  // unresolved), and an operation's receipt is not per-attempt evidence (any
  // attempt that closed the intent leaves the same `applied` row), so an
  // operation rides a token-bearing participant or is refused here.
  if (request.hearth === null && request.plots.length === 0) {
    throw new Error('a housing mutation carries a Hearth advance or a plot write');
  }
  const accounts = new Set(request.accountIds);
  if (request.hearth && !accounts.has(request.hearth.accountId)) {
    throw new Error('the Hearth account must be a declared account participant');
  }
  for (const plot of request.plots) {
    if (!accounts.has(plot.upsert.accountId)) {
      throw new Error('a plot write account must be a declared account participant');
    }
    if (plot.fence.plotId !== plot.upsert.plotId) {
      throw new Error('a plot write fence must name its own plot');
    }
  }
  for (const op of request.operations) {
    if (!accounts.has(op.accountId)) {
      throw new Error('an operation account must be a declared account participant');
    }
  }
  const writes = new Map(request.plots.map((plot) => [plot.upsert.plotId, plot]));
  if (writes.size !== request.plots.length) throw new Error('one write per plot');
  const opIds = new Set(request.operations.map((op) => op.operationId));
  if (opIds.size !== request.operations.length) throw new Error('one apply per operation');
  for (const op of request.operations) {
    if (op.plotId === null) {
      if (op.fenceGeneration !== null || op.expectedDurableRev !== null) {
        throw new Error('a plot-less operation apply carries no fence and no revision');
      }
      continue;
    }
    const write = writes.get(op.plotId);
    if (
      !write ||
      write.fence.generation !== op.fenceGeneration ||
      write.upsert.expectedDurableRev !== op.expectedDurableRev
    ) {
      throw new Error(
        'a plot-scoped operation apply writes its own plot under the same fence and revision',
      );
    }
  }
  for (const proof of request.claimProofs) {
    const write = writes.get(proof.plotId);
    if (
      write &&
      (write.fence.holder !== proof.holder || write.fence.generation !== proof.generation)
    ) {
      throw new Error('a claim proof and a write fence for one plot must agree');
    }
  }
}

/**
 * Build the housing hook for one attempt. The tokens are minted HERE, once per
 * attempt, so a verify reads exactly this attempt's evidence.
 */
export function createFreeholdSaveHook(
  request: FreeholdMutationRequest,
  opts: {
    readonly waitSignal?: AbortSignal;
    readonly wrap?: <T>(job: () => Promise<T>) => Promise<T>;
    readonly wrapPersist?: <T>(persist: () => Promise<T>) => Promise<T>;
  } = {},
): {
  readonly hook: CharacterSaveHousingHook;
  readonly state: Readonly<HookState>;
  readonly writeTokens: ReadonlyMap<string, string>;
  readonly advanceToken: string | null;
} {
  assertRequest(request);
  const writeTokens = new Map(
    request.plots.map((plot) => [plot.upsert.plotId, mintFreeholdWriteToken()]),
  );
  const advanceToken = request.hearth ? mintFreeholdWriteToken() : null;
  const state: HookState = {
    ran: false,
    commitSent: false,
    committed: false,
    plots: [],
    hearth: null,
    verify: null,
  };
  const writeFences = new Map(request.plots.map((plot) => [plot.upsert.plotId, plot.fence]));
  const proofs = request.claimProofs.filter((proof) => !writeFences.has(proof.plotId));
  const run = async (tx: CharacterSaveHousingQueryable): Promise<void> => {
    state.ran = true;
    await boundFreeholdHookStatementsOnClient(tx, FREEHOLD_HOOK_STATEMENT_TIMEOUT_MS);
    // G4, ascending plot id across BOTH kinds of fence.
    const fences = byKey(
      [
        ...proofs.map((fence) => ({ fence, token: null as string | null })),
        ...request.plots.map((plot) => ({
          fence: plot.fence,
          token: writeTokens.get(plot.upsert.plotId) ?? null,
        })),
      ],
      (entry) => entry.fence.plotId,
    );
    for (const { fence, token } of fences) {
      const held =
        token === null
          ? await lockFreeholdClaimFenceOnClient(tx, fence)
          : await fenceFreeholdClaimOnClient(tx, fence, token);
      if (!held) throw new FreeholdMutationRefused({ kind: 'claim', plotId: fence.plotId });
    }
    // G5b and G6, ascending operation id.
    for (const op of byKey(request.operations, (entry) => entry.operationId)) {
      const refused = await closeFreeholdOperationOnClient(tx, {
        operationId: op.operationId,
        accountId: op.accountId,
        fingerprint: op.fingerprint,
        outcome: 'applied',
        plotId: op.plotId,
        fenceGeneration: op.fenceGeneration,
        expectedDurableRev: op.expectedDurableRev,
        appliedDurableRev: op.expectedDurableRev === null ? null : addOne(op.expectedDurableRev),
      });
      if (refused !== null) {
        throw new FreeholdMutationRefused({
          kind: 'operation',
          operationId: op.operationId,
          reason: refused,
        });
      }
    }
    // G7, ascending plot id.
    const plots: { plotId: string; durableRev: string }[] = [];
    for (const plot of byKey(request.plots, (entry) => entry.upsert.plotId)) {
      const result = await upsertFreehold(tx, plot.upsert);
      if (result.kind !== 'updated') {
        throw new FreeholdMutationRefused({
          kind: 'plot',
          plotId: plot.upsert.plotId,
          result: result.kind,
        });
      }
      plots.push({ plotId: plot.upsert.plotId, durableRev: result.durableRev });
    }
    // The receipts above recorded expected + 1 for each plot-scoped apply; the
    // CAS just answered the real revision. They cannot differ while the CAS
    // bumps by one, and if that ever changed this throws (every half rolls
    // back) rather than commit a receipt naming a revision nobody wrote.
    for (const op of request.operations) {
      if (op.plotId === null || op.expectedDurableRev === null) continue;
      const written = plots.find((plot) => plot.plotId === op.plotId);
      if (written?.durableRev !== addOne(op.expectedDurableRev)) {
        throw new Error('a housing receipt revision disagrees with its plot write');
      }
    }
    // G8.
    let hearth: HookState['hearth'] = null;
    if (request.hearth) {
      const result = await advanceFreeholdHearthOnClient(
        tx,
        request.hearth.accountId,
        request.hearth.cooldownMs,
        advanceToken,
      );
      if (result.kind !== 'advanced') throw new FreeholdMutationRefused({ kind: 'hearth', result });
      hearth = result;
    }
    state.plots = plots;
    state.hearth = hearth;
  };
  const hook: CharacterSaveHousingHook = {
    accountIds: [...new Set(request.accountIds)].sort((a, b) => a - b),
    run,
    commitSent() {
      state.commitSent = true;
    },
    committed() {
      state.committed = true;
    },
    waitSignal: opts.waitSignal,
    wrap: opts.wrap,
    wrapPersist: opts.wrapPersist,
  };
  return { hook, state, writeTokens, advanceToken };
}

/** The verify's ONE checkout (P9) as a pool for runFreeholdTransaction: both
 *  of its transactions run on the same client, so the reads never re-queue for
 *  a second checkout in the brownout that made the commit ambiguous. A release
 *  WITHOUT an error between them is a no-op, and `finish` returns the healthy
 *  client. A release WITH an error goes to the real client AT ONCE: the wall
 *  deadline's forceRelease relies on that destroying the socket so the pending
 *  query rejects, which a recorded-only release would leave hanging until the
 *  driver's query_timeout. The client then goes back exactly once, the next
 *  checkout is refused, and `finish` is a no-op. */
function verifyCheckout(client: DbTransactionDeadlineClient): {
  readonly pool: FreeholdTxPool;
  finish(): void;
} {
  let released = false;
  const releaseOnce = (error?: Error | boolean) => {
    if (released) return;
    released = true;
    if (error) client.release(error);
    else client.release();
  };
  const pool: FreeholdTxPool = {
    async connect() {
      if (released) throw new Error('freehold mutation verify client was left broken');
      return {
        query: client.query.bind(client),
        release(error?: Error | boolean) {
          if (error) releaseOnce(error);
        },
        on: (event, listener) => client.on(event, listener),
        removeListener: (event, listener) => client.removeListener(event, listener),
        get processID() {
          return client.processID;
        },
      };
    },
  };
  return { pool, finish: () => releaseOnce() };
}

/**
 * The verify (P9): wait out the hung transaction on the character row, then
 * read each participant's own evidence. Every reading must agree, because the
 * hung transaction committed all of them or none. ONE checkout for both
 * transactions, so the permit (and the character FIFO behind it) is held for at
 * most one checkout wait (the pool's 5 s connect timeout) plus two
 * FREEHOLD_VERIFY_BOUNDS walls (2 x 30 s), 65 s in all, where a second checkout
 * would have made it 2 x (5 + 30) s.
 */
export async function verifyFreeholdMutation(
  pool: FreeholdTxPool,
  characterId: number,
  evidence: {
    readonly request: FreeholdMutationRequest;
    readonly writeTokens: ReadonlyMap<string, string>;
    readonly advanceToken: string | null;
  },
): Promise<'landed' | 'not_landed' | 'unresolved'> {
  let checkout: ReturnType<typeof verifyCheckout> | null = null;
  try {
    checkout = verifyCheckout(await pool.connect());
    const one = checkout.pool;
    await runFreeholdTransaction(one, FREEHOLD_VERIFY_BOUNDS, (tx) =>
      waitOutCharacterRowOnClient(tx, characterId),
    );
    const readings = await runFreeholdTransaction(one, FREEHOLD_VERIFY_BOUNDS, async (tx) => {
      const seen: boolean[] = [];
      if (evidence.request.hearth && evidence.advanceToken !== null) {
        seen.push(
          await freeholdHearthAdvanceLandedOnClient(
            tx,
            evidence.request.hearth.accountId,
            evidence.advanceToken,
          ),
        );
      }
      for (const plot of evidence.request.plots) {
        const claim = await readFreeholdClaimOnClient(tx, plot.upsert.plotId);
        seen.push(
          claim !== null && claim.writeToken === evidence.writeTokens.get(plot.upsert.plotId),
        );
      }
      for (const op of evidence.request.operations) {
        const closed = await freeholdOperationClosedOnClient(tx, op.operationId);
        seen.push(!closed.open && closed.outcome === 'applied');
      }
      return seen;
    });
    if (readings.length === 0) return 'unresolved';
    if (readings.every(Boolean)) return 'landed';
    if (readings.every((landed) => !landed)) return 'not_landed';
    return 'unresolved';
  } catch {
    return 'unresolved';
  } finally {
    checkout?.finish();
  }
}

export interface FreeholdMutationDeps {
  /** Runs ONE character save carrying the hook (GameServer.saveCharacter with
   *  `housing`), on the character FIFO. */
  save(hook: CharacterSaveHousingHook): Promise<boolean>;
  /** A fresh client for the verify, outside any permit the save held. */
  readonly pool: FreeholdTxPool;
  readonly characterId: number;
}

/**
 * Commit one housing mutation. Every exit is an outcome; only a malformed
 * request (a programming error) rejects.
 *
 * `serialize` is the plot store's owner FIFO, REQUIRED for a mutation that
 * writes a plot row (taken inside the character FIFO, before the market writer:
 * the manifest's Q3): the verify reads the plot's write token, which is sound
 * only while no store write can re-stamp it. `onCommitted` runs synchronously
 * inside it right after a proved COMMIT, so a live plan applied there is
 * visible to the store's next write; it must not throw, and a throw is
 * swallowed so it can never rewrite a proved commit into a failure. A save
 * that throws AFTER a proved COMMIT (a legacy tail, a host hook) is still
 * `committed`: the durable halves stand. The verify runs inside the same
 * character-FIFO job.
 */
export async function commitFreeholdMutation(
  deps: FreeholdMutationDeps,
  request: FreeholdMutationRequest,
  opts: {
    readonly waitSignal?: AbortSignal;
    readonly serialize?: <T>(job: () => Promise<T>) => Promise<T>;
    readonly onCommitted?: (
      outcome: Extract<FreeholdMutationOutcome, { kind: 'committed' }>,
    ) => void;
  } = {},
): Promise<FreeholdMutationOutcome> {
  if (request.plots.length > 0 && !opts.serialize) {
    throw new Error('a housing mutation that writes a plot runs inside the plot store FIFO');
  }
  let built!: ReturnType<typeof createFreeholdSaveHook>;
  const committedOutcome = (verified: boolean) =>
    ({
      kind: 'committed',
      plots: built.state.plots,
      hearth: built.state.hearth,
      verified,
    }) as const;
  // INSIDE the permit, after the failed save released its client: the verify.
  const verifyOnAmbiguity = async <T>(persist: () => Promise<T>): Promise<T> => {
    try {
      return await persist();
    } catch (error) {
      if (built.state.commitSent && !built.state.committed && freeholdCommitMayHaveLanded(error)) {
        (built.state as HookState).verify = await verifyFreeholdMutation(
          deps.pool,
          deps.characterId,
          { request, writeTokens: built.writeTokens, advanceToken: built.advanceToken },
        );
      }
      throw error;
    }
  };
  const runOnCommitted = (verified: boolean) => {
    try {
      opts.onCommitted?.(committedOutcome(verified));
    } catch {
      // Contract: onCommitted does not throw. The durable halves committed, so
      // a live apply that throws is the caller's to repair on its next
      // authoritative reload; it never turns the outcome into a failure.
    }
  };
  // Around the whole FIFO job: the live apply right after a proved commit,
  // inside the plot store's owner FIFO when the caller serializes. A job that
  // throws AFTER its commit still applies: the commit stands.
  const applyAfterCommit = async <T>(job: () => Promise<T>): Promise<T> => {
    try {
      const result = await job();
      if (built.state.committed) runOnCommitted(false);
      return result;
    } catch (error) {
      if (built.state.committed) runOnCommitted(false);
      else if (built.state.verify === 'landed') runOnCommitted(true);
      throw error;
    }
  };
  built = createFreeholdSaveHook(request, {
    waitSignal: opts.waitSignal,
    wrap: opts.serialize
      ? (job) => (opts.serialize as NonNullable<typeof opts.serialize>)(() => applyAfterCommit(job))
      : applyAfterCommit,
    wrapPersist: verifyOnAmbiguity,
  });
  try {
    await deps.save(built.hook);
  } catch (error) {
    // A proved COMMIT stands whatever threw after it (a legacy tail in the
    // save, a host hook), so it is never reported as proved-not-committed.
    if (built.state.committed) return committedOutcome(false);
    if (error instanceof FreeholdMutationRefused)
      return { kind: 'refused', refusal: error.refusal };
    const verdict = built.state.verify;
    if (verdict === 'landed') return committedOutcome(true);
    if (verdict === 'not_landed') return { kind: 'not_landed', error };
    if (verdict === 'unresolved') return { kind: 'unresolved', error };
    return { kind: 'failed', error };
  }
  if (built.state.committed) return committedOutcome(false);
  return built.state.ran ? { kind: 'failed', error: null } : { kind: 'not_run' };
}
