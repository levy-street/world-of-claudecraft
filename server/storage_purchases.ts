// The Claudium storage purchase flow (Bank Storage phase 11): sell Strongbox
// charters and single rungs from the game server, applying slots exactly
// once against an idempotent spend receipt, never partially, and never past
// the ceiling gold reaches.
//
// THE ORDER IS THE DESIGN, and it is locked; changing any step changes what
// a crash can strand:
//   1. initiation requires the LIVE character session (never a client-named
//      character, never an offline spend);
//   2. the per-character purchase mutex is taken before the first await and
//      held from initiation until slot application (a gold rung buy at the
//      banker is refused while it is held: server/bank_wire.ts consults
//      storagePurchaseInFlight);
//   3. the FULL grant is validated against the ladder ceiling before any
//      money moves (bankGrantStorageSlots dryRun: fit, next-rung, and the
//      applied-key replay gate share ONE body with the real apply);
//   4. the pending-purchase row is persisted and durable BEFORE the service
//      call (server/storage_purchase_db.ts: what makes the purchase
//      recoverable across a dropped session or a process restart);
//   5. the spend declares kind 'storage' under the client-minted idempotency
//      key; an AMBIGUOUS outcome ('unavailable': never-reached and
//      debited-but-reply-lost are indistinguishable) is resolved only by
//      retrying the SAME key until the service answers definitively, through
//      the bounded keyed recovery coordinator;
//   6. a granted receipt applies exactly once. The dedupe key lands INSIDE
//      the character's bank blob next to the counter it guards
//      (BankState.appliedStorageKeys). The grant stages an immutable effect
//      before saving; the character blob, applied receipt, Claudium audit row,
//      and removal of the operational pending row commit in one transaction.
//      A crash in any window therefore replays to exactly one durable apply.
//      The apply-time re-check
//      (the same dryRun rules, re-run inside the real apply) is DEFENSE IN
//      DEPTH behind the mutex; it stays even though the mutex makes it
//      unreachable, and if it ever fires the row settles 'unresolved' for
//      operator attention: never a clawback, never a partial grant.
//   7. a session dropped between spend and apply auto-applies at the next
//      fresh login (the production coordinator is kicked from ws_auth's
//      fresh-join arm; resumeStoragePurchasesAtLogin is its awaitable test
//      seam). A linkdead resume needs no kick because this module's in-process
//      flow survives the socket drop. The fresh-join kick arms a
//      PROVISIONAL hold synchronously, so after a process restart the gold
//      rail is closed before the client's first command can race the
//      pending-row scan. The coordinator re-scans after each completed row,
//      so no sibling is left without a driver while its character stays
//      online. False/throw saves retain their staged prefix for the next
//      character save; only a committed transaction acknowledges it.
//
// NEVER confirm a storage purchase by re-reading the store's `owned`: a
// storage spend writes no grant row, so owned is false by construction and
// forever. The receipt (granted, with already_granted as the replay marker
// and `granted` as the one discriminator) is the only confirmation.
//
// Host seam: everything stateful arrives through StoragePurchaseHost, so a
// Vitest drives the whole flow with a hand-rolled host and no GameServer or pg
// (tests/server/storage_purchases.test.ts). The scheduler itself has a pure,
// injected-timer suite in tests/server/storage_recovery_coordinator.test.ts.

import { randomUUID } from 'node:crypto';
import { BANK_STORAGE_KEY_MAX_LENGTH, type StorageGrantResult } from '../src/sim/bank';
import type {
  ClaudiumSpendInput,
  ClaudiumSpendOutcome,
  ClaudiumSpendResult,
} from './claudium_proxy';
import type { StorageAppliedEffectDraft } from './storage_applied_effect_queue';
import {
  type LadderHold,
  type LadderHoldReason,
  ladderHoldBlocksGold,
  WEDGED_HOLD_MAX_MS,
} from './storage_ladder_hold';
import type {
  StorageAppliedEffect,
  StoragePurchaseBeginResult,
  StoragePurchaseRow,
} from './storage_purchase_db';
import {
  STORAGE_RECOVERY_DRIVE_CONCURRENCY,
  StorageRecoveryCoordinator,
  type StorageRecoveryDriveResult,
  type StorageRecoveryMetrics,
} from './storage_recovery_coordinator';

/** Compatibility export for focused flow tests; the coordinator owns the value. */
export const RECOVERY_DRIVE_CONCURRENCY = STORAGE_RECOVERY_DRIVE_CONCURRENCY;

/** The wire-boundary key rule the spend gate enforces BEFORE the flow runs:
 *  a bounded safe-charset token (UUIDs and ULIDs fit; whitespace and control
 *  characters do not, so a key can never forge log lines or blow the btree
 *  index tuple limit). The length ties to the ONE shared constant the sim's
 *  apply and load paths enforce, so "acceptable", "applicable", and
 *  "persistable" are the same set. Phase 12's client must mint keys inside
 *  this format (crypto.randomUUID does). */
export const STORAGE_KEY_PATTERN = new RegExp(
  `^[A-Za-z0-9_.:-]{1,${BANK_STORAGE_KEY_MAX_LENGTH}}$`,
);

/** Upper bound on the client-declared cost, far above any real catalog price
 *  (2000 today) and far below the INT column and the service's own bounds:
 *  a silly declared cost refuses as invalid_request instead of reaching the
 *  int4 insert (the declared cost is fingerprint-bound and persisted
 *  verbatim, so it must be storable). */
export const STORAGE_MAX_EXPECTED_COST_CLAUDIUM = 1_000_000;

export interface StoragePurchaseInput {
  accountId: number;
  itemId: string;
  expectedCostClaudium: number;
  idempotencyKey: string;
}

/** The narrow host the flow runs against (wired to the live game in
 *  server/main.ts; hand-rolled in tests). */
export interface StoragePurchaseHost {
  /** The account's ONE live character session, or null (no session, or an
   *  ambiguous multi-session account, which only GM supervision can create). */
  resolveLiveCharacter(accountId: number): { characterId: number; pid: number } | null;
  /** O(1) local-session predicate. Omission means no coordinator entry is
   *  known-safe for capacity eviction. */
  isCharacterLive?(characterId: number): boolean;
  /** Session-owned overflow bit used when the bounded recovery coordinator is
   * full. It keeps both purchase rails closed without growing coordinator
   * memory, and the game loop retries flagged live sessions incrementally. */
  setRecoveryAdmissionPending?(characterId: number, pending: boolean): void;
  recoveryAdmissionPending?(characterId: number): boolean;
  /** Realm-wide cap shared by autosave, market custody, and recovery. Recovery
   * holds one permit around each direct DB call only, never an economy RPC or
   * character FIFO wait. */
  acquireBackgroundPermit?(signal: AbortSignal): Promise<{ release(): void } | null>;
  /** bankGrantStorageSlots against the live sim (the one rules body). */
  grant(pid: number, skuId: string, purchaseKey: string, dryRun: boolean): StorageGrantResult;
  /** Stage the receipt and audit payload on the live session before saving. */
  stageAppliedEffect(effect: StorageAppliedEffectDraft): boolean;
  /** Durably persist the character's live state (GameServer.saveCharacter:
   * per-character queued, so writes are ordered). The production host acquires
   * its background permit only inside that FIFO thunk. false = not saved. */
  saveCharacter(
    characterId: number,
    shouldStart?: () => boolean,
    signal?: AbortSignal,
  ): Promise<boolean>;
  /** claudiumSpendDetailed. Fails closed with reason 'unavailable', never
   *  throws, and reports whether the request PROVABLY never reached the
   *  service (server/service_reachability.ts): the one failure shape under
   *  which no debit is possible. */
  spend(
    input: ClaudiumSpendInput & { kind: 'storage' },
    signal?: AbortSignal,
  ): Promise<ClaudiumSpendOutcome>;
  db: {
    begin(
      row: {
        realm: string;
        accountId: number;
        characterId: number;
        itemId: string;
        expectedCostClaudium: number;
        idempotencyKey: string;
        claimToken: string;
      },
      signal?: AbortSignal,
    ): Promise<StoragePurchaseBeginResult>;
    byKey(idempotencyKey: string, signal?: AbortSignal): Promise<StoragePurchaseRow | null>;
    claimSpend(idempotencyKey: string, claimToken: string, signal?: AbortSignal): Promise<boolean>;
    renewSpendClaim(
      idempotencyKey: string,
      claimToken: string,
      signal?: AbortSignal,
    ): Promise<boolean>;
    releaseSpendClaim(
      idempotencyKey: string,
      claimToken: string,
      signal?: AbortSignal,
    ): Promise<boolean>;
    settle(
      idempotencyKey: string,
      status: 'applied' | 'unresolved',
      claimToken: string,
      signal?: AbortSignal,
    ): Promise<boolean>;
    discardWithoutDebit(
      idempotencyKey: string,
      claimToken: string,
      signal?: AbortSignal,
    ): Promise<boolean>;
    pendingFor(characterId: number, signal?: AbortSignal): Promise<StoragePurchaseRow | null>;
    /** The authoritative pending-or-unresolved rail used at login. Keep this
     * required: a pending-only fallback would forget an unresolved debit on
     * final-session teardown and reopen the synchronous gold rail at relog. */
    openFor(characterId: number, signal?: AbortSignal): Promise<StoragePurchaseRow | null>;
  };
  realm: string;
  /** Dev-channel only; never player-visible text. */
  warn(message: string): void;
}

// The per-character storage-purchase mutex: characterId -> the LADDER HOLD of
// the purchase that holds it (its key, why it was taken, and when). In-process
// on purpose: a process restart clears it, and the pending TABLE plus the login
// recovery re-arm what matters. Keyed by characterId (never ws or pid) so it
// survives a linkdead resume.
//
// TWO READERS, TWO RULES (Bank Storage phase 14). The CLAUDIUM flow reads this
// table directly and serializes on mere PRESENCE, unchanged: at most one open
// purchase per character, ever. The GOLD rail reads it only through
// storagePurchaseInFlight, which applies the per-reason lifetime in
// server/storage_ladder_hold.ts, so a hold that has outlived its argued bound
// stops shutting the gold rail while still refusing a new Claudium purchase.
const inFlightByCharacter = new Map<number, LadderHold>();

/** Take the ladder for `key`. The caller has already established that no other
 *  holder exists (synchronously, before its first await). */
function takeLadderHold(characterId: number, key: string, reason: LadderHoldReason): void {
  inFlightByCharacter.set(characterId, { key, reason, sinceMs: Date.now() });
}

/** Re-label OUR hold as the flow moves between phases, restarting its clock:
 *  a purchase handed to the background retry becomes 'settling', whose bound is
 *  measured from the handoff rather than from the request that preceded it.
 *  A no-op if we no longer hold, so a lapsed or replaced hold is never revived. */
function retagLadderHold(characterId: number, key: string, reason: LadderHoldReason): void {
  const held = inFlightByCharacter.get(characterId);
  if (held?.key !== key) return;
  // NEVER DOWNGRADE A PROVEN-PENDING HOLD. The provisional scan hold and the
  // post-scan drive hold share one key (RECOVERY_HOLD_KEY), so a key-only guard
  // let a SECOND kick's admission re-stamp flip a 'recovery-drive' hold back to
  // 'recovery-scan', trading its 10-minute bound for the 60s backstop. A relog
  // or any settle fires such a kick, so the gold rail would then open a minute
  // later over a row an earlier scan had already PROVED was pending: exactly
  // the failure 'recovery-drive' exists to prevent, reintroduced by the fix for
  // it. A scan answering YES is new information; a later kick arriving is not.
  if (held.reason === 'recovery-drive' && reason === 'recovery-scan') return;
  inFlightByCharacter.set(characterId, { key, reason, sinceMs: Date.now() });
}

/** Drop a PROVISIONAL hold that has outlived its bound.
 *
 *  The recovery hold is the one entry in this table with no owning promise
 *  guaranteed to remove it: a scan that FAILS keeps it deliberately (nothing is
 *  known), and nothing else is scheduled to revisit it. Without an eviction it
 *  would sit in a module-global map for the life of the process, one per
 *  character whose scan failed, which during the pool saturation that causes
 *  those failures means many at once. A lapsed provisional hold blocks nothing
 *  (both rails read it through its bound), so dropping it is safe by the
 *  module's own policy and is what keeps this table proportional to live work.
 *  Real purchase keys are never evicted here: their release lives in a
 *  `finally`, and their presence is what serializes the Claudium rail. */
function evictLapsedRecoveryHold(characterId: number, nowMs: number): void {
  const held = inFlightByCharacter.get(characterId);
  if (!held || held.key !== RECOVERY_HOLD_KEY) return;
  if (ladderHoldBlocksGold(held, nowMs)) return;
  inFlightByCharacter.delete(characterId);
  clearHoldWarnings(characterId);
}

/** The key currently holding this character's ladder, or undefined. */
function ladderHoldKey(characterId: number): string | undefined {
  return inFlightByCharacter.get(characterId)?.key;
}

/** Release, but only if `key` is still the holder. */
function releaseLadderHold(characterId: number, key: string): void {
  if (ladderHoldKey(characterId) === key) inFlightByCharacter.delete(characterId);
}

// Characters whose applied grant is between the sim mutation and its durable
// claudium bank_ledger row. Both purchase rails consult this: a gold
// rung landing in that window inserts its ledger row FIRST, so the claudium
// row lands behind it carrying a LOWER purchased_slots_after, and
// scripts/bank_audit.mjs reads that pair as purchased_regression, a
// keep-forever false positive on the rail whose whole job is to make a real
// regression visible. It is also the save-transaction admission bound: no
// second Claudium effect may stage for this character until the first atomic
// save commits, so writeStorageAppliedEffectsOnClient receives at most one new
// effect from the live request path.
// characterId -> the wall clock at which the window opened, used only for a
// rate-limited operator warning. This hold CANNOT yield on age: a legitimate
// save may wait in the character FIFO and then consume its full transaction
// deadline, and opening gold before the exact paid effect commits can place a
// newer gold ledger row ahead of the older paid rung. Final-session teardown
// clears the process-local entry; the next login's synchronous recovery scan
// re-arms safety from the authoritative open row.
interface LedgerOrderingHold {
  /** The purchase key that opened this window, so a CONCURRENT applied settle
   *  for the same character cannot close a window it does not own. */
  readonly key: string;
  readonly sinceMs: number;
}
const ledgerOrderingHold = new Map<number, LedgerOrderingHold>();

// Live characters whose database-authoritative open row is unresolved. Unlike
// ordinary holds this never ages out: the debit is confirmed and only support
// may reconcile it. Final-session teardown removes the in-memory bit; the next
// login's openFor scan re-arms it before the provisional scan hold releases.
const unresolvedByCharacter = new Map<number, string>();

function markUnresolvedPurchase(characterId: number, key: string): void {
  unresolvedByCharacter.set(characterId, key);
}

/** The gold-path guard (server/bank_wire.ts): while a character's storage
 *  purchase is between initiation and slot application, a conflicting
 *  ladder purchase must refuse rather than race the fit check. Slot
 *  application is not finished until the audit row is durable, so the guard
 *  spans the settle chain too (ledgerOrderingHold). */
export function storagePurchaseInFlight(characterId: number): boolean {
  if (unresolvedByCharacter.has(characterId)) return true;
  // A coordinator-cap refusal is stored on the already-live session rather
  // than in another unbounded global collection. Treat a host read failure as
  // blocked: without a successful scan there is no proof an older debit is
  // absent, so opening the gold rail would be the unsafe answer.
  if (runtimeHostFactory) {
    try {
      if (runtimeHostFactory().recoveryAdmissionPending?.(characterId)) return true;
    } catch {
      return true;
    }
  }
  const now = Date.now();
  const hold = inFlightByCharacter.get(characterId);
  if (ladderHoldBlocksGold(hold, now)) return true;
  if (hold) {
    noteLadderYield(characterId, hold, now);
    // A lapsed PROVISIONAL hold is dropped rather than kept: see
    // evictLapsedRecoveryHold. This is the reader that reliably runs again.
    evictLapsedRecoveryHold(characterId, now);
  }
  const ledgerHold = ledgerOrderingHold.get(characterId);
  if (!ledgerHold) {
    // Nothing holds this character at all: forget any yield token so the map
    // stays proportional to live yields and a later incident logs again.
    if (!hold) clearHoldWarnings(characterId);
    return false;
  }
  const age = now - ledgerHold.sinceMs;
  if (Number.isFinite(age) && age >= WEDGED_HOLD_MAX_MS) {
    noteLedgerOrderingStall(characterId, ledgerHold, age);
  }
  // Queue age cannot prove the staged paid row durable. Always fail closed
  // until exact commit acknowledgement or final-session teardown.
  return true;
}

// A yield is the one place this module lets a gold rung past a claim that is
// still standing, so it must not be silent: without a line here the only
// surface for the residual the ladder-hold header accepts (an ambiguous spend
// that DID debit, plus a gold buy taken during the yield, settling
// 'unresolved') is the offline audit script, hours later. Dev channel only,
// never player-visible text.
//
// Once per (character, hold KEY AND REASON) so a player mashing the button
// cannot flood the log: the gold rail reads this predicate on every attempt.
//
// The reason belongs in the token because one purchase
// key legitimately yields TWICE with different meanings: a 'purchase' wedge
// yield, then the 'settling' ambiguity yield after the retag; keyed on the key
// alone the wedge message suppressed the money-relevant one that followed.
//
// BOUNDED, and be exact about by what. An entry is written only when a
// character actually yields, and it is dropped when a later read of either rail
// finds that character holding nothing at all, or when a lapsed provisional
// hold is evicted. So it tracks characters with a LIVE yield plus a tail that
// clears on their next bank interaction, rather than accumulating one row per
// character that ever yielded. It is not a TTL: a character who yields once and
// never touches a bank again keeps one small entry until the process restarts.
// That is acceptable at the scale of a realm's yields, which are outage-shaped
// events, and it is written down rather than implied so nobody reads a stronger
// promise into it.
const warnedYields = new Map<number, string>();

// Ledger-ordering stalls keep their OWN warning set rather than sharing the
// ladder-yield map. A character can have both states in one guard read, and a
// shared token made each overwrite the other and log on every gold press.
const warnedLedgerStalls = new Set<number>();

/** Clear a character's hold-warning tokens once its owning state is gone, so
 *  these sets track live incidents instead of all historical characters. */
function clearHoldWarnings(characterId: number): void {
  warnedYields.delete(characterId);
  warnedLedgerStalls.delete(characterId);
}

function noteLadderYield(characterId: number, hold: LadderHold, nowMs: number): void {
  const token = `${hold.reason}:${hold.key}`;
  if (warnedYields.get(characterId) === token) return;
  warnedYields.set(characterId, token);
  const ageSec = Math.round((nowMs - hold.sinceMs) / 1000);
  if (hold.reason === 'settling') {
    console.warn(
      `[storage-purchase] character ${characterId}: ambiguous purchase ${hold.key} has held the gold rail ${ageSec}s; yielding it. If that spend did debit, a gold rung taken now settles the purchase unresolved (scripts/bank_audit.mjs reports it).`,
    );
    return;
  }
  // The wedge arm is a bound on a BUG, so it is the louder one: reaching it
  // means a promise that should have settled in seconds never did, and that
  // character's CLAUDIUM rail stays shut until this process restarts.
  console.warn(
    `[storage-purchase] character ${characterId}: WEDGED ${hold.reason} hold ${hold.key} stuck ${ageSec}s; yielding the gold rail. This should not happen: something in the purchase flow never settled.`,
  );
}

function noteLedgerOrderingStall(
  characterId: number,
  hold: LedgerOrderingHold,
  ageMs: number,
): void {
  // Once per live character hold: storagePurchaseInFlight runs on EVERY
  // client-driven bank_buy_slots command, on the same thread as the 20 Hz
  // world loop. A slow save plus a held button must not log once per press.
  if (warnedLedgerStalls.has(characterId)) return;
  warnedLedgerStalls.add(characterId);
  console.warn(
    `[storage-purchase] character ${characterId}: paid storage effect ${hold.key} has waited ${Math.round(ageMs / 1000)}s for durable ledger ordering; gold remains closed until that exact effect commits. Inspect the character save queue and database pool.`,
  );
}

/** Test-only: clear the mutex table, recovery coordinator, and any
 *  configured runtime between cases. */
export function resetStoragePurchasesForTests(): void {
  inFlightByCharacter.clear();
  ledgerOrderingHold.clear();
  recoveryCoordinator.reset();
  recoveryHosts.clear();
  warnedYields.clear();
  warnedLedgerStalls.clear();
  unresolvedByCharacter.clear();
  sweepKickEarliestNextMs.clear();
  runtimeHostFactory = null;
}

/** An OPEN row whose grant no longer fits: the money may already be gone, so
 *  the caller must never hear an innocent ladder refusal. Answer 'unavailable'
 *  (retry-me) and let recovery drive the row to whatever the service says
 *  actually happened. */
function ambiguousOpenRow(
  host: StoragePurchaseHost,
  key: string,
  refused: string,
): ClaudiumSpendResult {
  host.warn(
    `storage purchase ${key}: open row no longer applies (${refused}); deferring to recovery`,
  );
  return refusal('unavailable');
}

const refusal = (reason: string): ClaudiumSpendResult => ({
  granted: false,
  balance: null,
  costClaudium: null,
  reason,
});

// The service's DEFINITIVE refusal vocabulary (state.md, phase 10). Only a
// granted:false carrying one of THESE authorizes deletion of the pending row.
// An unknown or null reason on a 2xx (an interposed proxy rewriting the body,
// service version skew renaming fields) could be hiding a debit behind a
// malformed reply, so it is treated exactly like 'unavailable': ambiguous,
// resolved only by retrying the SAME key. The failure direction is safe on
// purpose: a
// NEW legitimate service refusal token added without updating this set
// retries forever instead of mis-settling a possibly-debited purchase.
// EXACTLY the six the service's spend surface declares (its own result type in
// service/src/claudium/spend.ts). 'invalid_request' used to sit here and does
// NOT belong: the service emits it only from the admin recovery surface, never
// from spend, and listing a token the spend surface cannot return inverts this
// set's whole safety direction for it. If some future version DID answer
// invalid_request after taking the money, the game would delete the only open
// recovery row over a live debit, which is the one outcome the classifier
// exists to prevent. The game's own invalid_request refusals never pass through
// here: they are returned to the caller directly and are never a spend RESULT.
const DEFINITIVE_REFUSAL_REASONS = new Set([
  'insufficient_balance',
  'unknown_item',
  'already_granted',
  'not_cosmetic',
  'kind_mismatch',
  'price_changed',
]);

function isAmbiguousSpendResult(result: ClaudiumSpendResult): boolean {
  return !result.granted && !DEFINITIVE_REFUSAL_REASONS.has(result.reason ?? '');
}

// The provisional recovery hold: the leading SPACE is outside the key
// charset (STORAGE_KEY_PATTERN), so it can never collide with a real key.
// Armed SYNCHRONOUSLY by kickStoragePurchaseRecovery so the gold rail is
// closed from the instant a fresh join exists, BEFORE the pending-row scan's
// database round-trip answers whether a debited-but-unapplied purchase is
// waiting (the post-restart re-arm window the verify round found).
//
// ITS LIFETIME IS (QUEUE WAIT + SCAN), and Bank Storage phase 14 cut what that
// costs. The arm still happens before the FIFO gate, because the window it
// closes is exactly "a gold command arrives before we know whether a debited
// but unapplied purchase is waiting". What changed is what the gate holds: only
// the SCAN rides a slot now, and the per-row drive (spend, apply, settle) runs
// outside it, so a restart storm drains at the rate of an indexed read rather
// than the rate of whole recoveries. The hold is also released the moment a
// scan comes back EMPTY, which is the case that used to refuse a GOLD
// bank_buy_slots to a character with no purchase at all.
//
// Do NOT "fix" the remainder by moving the arm inside run(): that reopens the
// exact race. The residual (a scan that never answers) is covered by the
// stuck-promise backstop in server/storage_ladder_hold.ts, which is a bound on
// a bug rather than a policy.
const RECOVERY_HOLD_KEY = ' recovery-scan';

interface PurchaseRef {
  accountId: number;
  characterId: number;
  itemId: string;
  expectedCostClaudium: number;
  key: string;
  claimToken: string;
}

function recoveryCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Hold the shared producer permit around one direct recovery DB operation.
 * Never call this around economy RPCs or a character FIFO wait: every
 * character-scoped writer establishes FIFO -> permit ordering. */
async function withRecoveryBackgroundPermit<T>(
  host: StoragePurchaseHost,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new DOMException('storage recovery cancelled', 'AbortError');
  const permit = host.acquireBackgroundPermit
    ? await host.acquireBackgroundPermit(signal)
    : { release() {} };
  if (!permit) throw new DOMException('storage recovery cancelled', 'AbortError');
  try {
    return await run();
  } finally {
    permit.release();
  }
}

/** Live request work has no recovery signal and keeps its existing direct DB
 * path. A coordinator-owned signal marks the background path and gates exactly
 * this one query. */
function withRecoveryDbPermit<T>(
  host: StoragePurchaseHost,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return signal ? withRecoveryBackgroundPermit(host, signal, run) : run();
}

async function safeSettle(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  status: 'applied' | 'unresolved',
  signal?: AbortSignal,
): Promise<'settled' | 'lost' | 'failed'> {
  try {
    // A false result is deliberately not treated as terminal. Token ownership
    // may have rotated while this UPDATE waited, in which case this caller is
    // stale and must not infer anything about the row from its local reply.
    const settled = await withRecoveryDbPermit(host, signal, () =>
      host.db.settle(p.key, status, p.claimToken, signal),
    );
    if (settled && status === 'unresolved') markUnresolvedPurchase(p.characterId, p.key);
    return settled ? 'settled' : 'lost';
  } catch (err) {
    // The row stays pending; the next login recovery converges it.
    if (!recoveryCancelled(signal)) {
      host.warn(`storage purchase ${p.key}: settle(${status}) failed, deferred: ${String(err)}`);
    }
    return 'failed';
  }
}

/**
 * Delete a definitively no-debit pending row. Only `deleted` authorizes the
 * caller to surface the service's refusal. A miss or write failure remains
 * ambiguous and must stay on the recovery coordinator.
 */
async function safeDiscardWithoutDebit(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  signal?: AbortSignal,
): Promise<'deleted' | 'unconfirmed'> {
  try {
    return (await withRecoveryDbPermit(host, signal, () =>
      host.db.discardWithoutDebit(p.key, p.claimToken, signal),
    ))
      ? 'deleted'
      : 'unconfirmed';
  } catch (err) {
    if (!recoveryCancelled(signal)) {
      host.warn(`storage purchase ${p.key}: no-debit cleanup failed, deferred: ${String(err)}`);
    }
    return 'unconfirmed';
  }
}

async function safeClaimSpend(
  host: StoragePurchaseHost,
  key: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return await withRecoveryDbPermit(host, signal, () =>
      host.db.claimSpend(key, claimToken, signal),
    );
  } catch (err) {
    if (!recoveryCancelled(signal)) {
      host.warn(`storage purchase ${key}: spend claim failed: ${String(err)}`);
    }
    return false;
  }
}

async function safeRenewSpendClaim(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return await withRecoveryDbPermit(host, signal, () =>
      host.db.renewSpendClaim(p.key, p.claimToken, signal),
    );
  } catch (err) {
    if (!recoveryCancelled(signal)) {
      host.warn(`storage purchase ${p.key}: spend claim renewal failed: ${String(err)}`);
    }
    return false;
  }
}

async function safeReleaseSpendClaim(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await withRecoveryDbPermit(host, signal, () =>
      host.db.releaseSpendClaim(p.key, p.claimToken, signal),
    );
  } catch (err) {
    // Expiry permits takeover, so a failed release is an availability delay,
    // never permission for this stale owner to mutate or delete.
    if (!recoveryCancelled(signal)) {
      host.warn(`storage purchase ${p.key}: spend claim release deferred: ${String(err)}`);
    }
  }
}

// Stage before requesting the save. Every character-save path snapshots the
// staged prefix into its transaction, then acknowledges only after COMMIT.
// A false/throw keeps the prefix queued. A replay whose key is already in the
// blob stages the same receipt too: an exact queued duplicate keeps its original
// bounds, while a fresh-process replay reconstructs the one catalog-sized rung
// ending at the live total. The receipt insert is the ledger idempotency gate.
function scheduleAppliedSave(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  bounds?: Pick<StorageAppliedEffect, 'purchasedSlotsBefore' | 'purchasedSlotsAfter'>,
  shouldStart?: () => boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  if (shouldStart && !shouldStart()) return Promise.resolve(false);
  const staged = host.stageAppliedEffect({
    realm: host.realm,
    accountId: p.accountId,
    characterId: p.characterId,
    itemId: p.itemId,
    expectedCostClaudium: p.expectedCostClaudium,
    idempotencyKey: p.key,
    spendClaimToken: p.claimToken,
    ...(bounds
      ? {
          purchasedSlotsBefore: bounds.purchasedSlotsBefore,
          purchasedSlotsAfter: bounds.purchasedSlotsAfter,
        }
      : {}),
  });
  if (!staged) {
    host.warn(`storage purchase ${p.key}: applied effect could not be staged on the live session`);
    return Promise.resolve(false);
  }
  ledgerOrderingHold.set(p.characterId, { key: p.key, sinceMs: Date.now() });
  return host
    .saveCharacter(p.characterId, shouldStart, signal)
    .then((saved) => {
      if (saved) storageAppliedEffectsCommitted(p.characterId, [{ idempotencyKey: p.key }]);
      return saved;
    })
    .catch((err) => {
      if (!recoveryCancelled(signal)) {
        host.warn(`storage purchase ${p.key}: atomic apply save deferred: ${String(err)}`);
      }
      return false;
    });
}

/** Release the gold-ordering hold only after a save transaction committed the
 * staged receipt and audit row. GameServer also calls this for marketplace
 * saves that win the per-character FIFO ahead of the requested save. */
export function storageAppliedEffectsCommitted(
  characterId: number,
  effects: readonly Pick<StorageAppliedEffect, 'idempotencyKey'>[],
): void {
  const held = ledgerOrderingHold.get(characterId);
  if (!held || !effects.some((effect) => effect.idempotencyKey === held.key)) return;
  ledgerOrderingHold.delete(characterId);
  warnedLedgerStalls.delete(characterId);
}

// Interpret a DEFINITIVE service answer (the caller has already routed
// 'unavailable' elsewhere). Does not touch the mutex; every caller owns its
// own release.
interface DefinitiveSettlement {
  response: ClaudiumSpendResult;
  retry: boolean;
  claim: 'open' | 'closed' | 'retained';
}

async function settleDefinitive(
  host: StoragePurchaseHost,
  p: PurchaseRef,
  result: ClaudiumSpendResult,
  mode: 'request' | 'recovery',
  shouldStart?: () => boolean,
  signal?: AbortSignal,
): Promise<DefinitiveSettlement> {
  if (!result.granted) {
    // A definitive refusal debits nothing (already_granted with granted
    // false included: that is the same-key different-fingerprint conflict).
    // Refusal history has no durable value, so report the specific refusal
    // only after the guarded pending-row DELETE confirms exactly one row.
    if ((await safeDiscardWithoutDebit(host, p, signal)) === 'deleted') {
      return { response: result, retry: false, claim: 'closed' };
    }
    return { response: refusal('unavailable'), retry: true, claim: 'open' };
  }
  if (shouldStart && !shouldStart()) {
    return { response: refusal('unavailable'), retry: true, claim: 'open' };
  }
  const live = host.resolveLiveCharacter(p.accountId);
  if (!live || live.characterId !== p.characterId) {
    // Dropped between spend and apply: the pending row auto-applies at the
    // character's next fresh login. Granted stays true (the money moved);
    // the reason names the deferral for the phase 12 UI.
    return {
      response: { ...result, reason: 'apply_deferred' },
      retry: false,
      claim: 'open',
    };
  }
  const applied = host.grant(live.pid, p.itemId, p.key, false);
  switch (applied.status) {
    case 'applied': {
      const save = scheduleAppliedSave(host, p, applied, shouldStart, signal);
      if (mode === 'request') {
        void save.then((saved) => {
          if (!saved) {
            void safeReleaseSpendClaim(host, p, signal);
            kickStoragePurchaseRecovery(p.characterId);
          }
        });
        return { response: result, retry: false, claim: 'retained' };
      }
      const saved = await save;
      return { response: result, retry: !saved, claim: saved ? 'closed' : 'open' };
    }
    case 'already_applied': // The crash-window replay: the slots landed under this key before.
      // Exactly-once holds because the grant refused; re-settle behind a
      // fresh save-confirm (the earlier settle may not have landed).
      {
        const response = { ...result, reason: result.reason ?? 'already_granted' };
        const save = scheduleAppliedSave(host, p, undefined, shouldStart, signal);
        if (mode === 'request') {
          void save.then((saved) => {
            if (!saved) {
              void safeReleaseSpendClaim(host, p, signal);
              kickStoragePurchaseRecovery(p.characterId);
            }
          });
          return { response, retry: false, claim: 'retained' };
        }
        const saved = await save;
        return { response, retry: !saved, claim: saved ? 'closed' : 'open' };
      }
    default:
      // Impossible-state territory (the mutex makes an interleaved ladder
      // move unreachable; a bug or a restore from backup could still get
      // here). NEVER partial, NEVER clawback: the record survives as
      // unresolved and is surfaced for operator attention.
      host.warn(
        `storage purchase ${p.key} (${p.itemId}) granted but could not apply: ${applied.status}`,
      );
      {
        const settled = await safeSettle(host, p, 'unresolved', signal);
        return settled === 'settled'
          ? {
              response: { ...result, reason: 'grant_unresolved' },
              retry: false,
              claim: 'closed',
            }
          : { response: refusal('unavailable'), retry: true, claim: 'open' };
      }
  }
}

/** The /api/claudium/spend kind 'storage' branch (wired through the
 *  ClaudiumGameHooks.storagePurchase runtime hook). Returns the spend wire
 *  shape verbatim; every game-side refusal is a stable reason token the
 *  phase 12/13 UI localizes. */
export async function executeStoragePurchase(
  host: StoragePurchaseHost,
  input: StoragePurchaseInput,
): Promise<ClaudiumSpendResult> {
  const key = input.idempotencyKey;
  const live = host.resolveLiveCharacter(input.accountId);
  if (!live) return refusal('no_live_character');
  const { characterId, pid } = live;
  const unresolvedKey = unresolvedByCharacter.get(characterId);
  if (unresolvedKey !== undefined && unresolvedKey !== key) {
    return refusal('purchase_in_progress');
  }
  try {
    if (host.recoveryAdmissionPending?.(characterId)) {
      return refusal('purchase_in_progress');
    }
  } catch {
    // Unknown recovery admission is an unknown older spend. Fail closed before
    // beginning a new row or making any economy-service call.
    return refusal('purchase_in_progress');
  }
  if (ledgerOrderingHold.has(characterId)) return refusal('purchase_in_progress');
  evictLapsedRecoveryHold(characterId, Date.now());
  const held = inFlightByCharacter.get(characterId);
  if (held && (held.key !== RECOVERY_HOLD_KEY || ladderHoldBlocksGold(held, Date.now()))) {
    // A real purchase key serializes on mere PRESENCE, unchanged and on
    // purpose: that is what stops a yielded hold from becoming a way to mint a
    // second pending row for one character during an outage.
    //
    // The PROVISIONAL hold is different and must carry its bound here too. It
    // is not a purchase: no row is known to exist behind it, and when a scan
    // FAILS it is retained precisely because nothing is known. Serializing the
    // paid rail on its presence alone made one transient pool error during a
    // restart storm disable that character's real-money purchases for the rest
    // of the session, with no way back: the blocked request returns before it
    // can arrange a re-kick, and only a fresh join clears the hold. Reading it
    // through the same lifetime the gold rail applies keeps the anti-minting
    // property (a lapsed provisional hold is indistinguishable from no hold,
    // which is the ordinary case) and gives the paid rail a bound.
    //
    // The lifetime clause is REDUNDANT with the eviction on the line above and
    // is kept as defence in depth: a QA mutation collapsing this to a bare
    // presence test survives, because evictLapsedRecoveryHold has already
    // removed exactly the holds the clause would have let through. That makes
    // it an equivalent mutant rather than a coverage gap. Keep both: the
    // eviction is an optimisation of the table, this clause is the rule, and a
    // future caller reaching the check without the eviction would need it.
    return refusal('purchase_in_progress');
  }
  // Synchronous take, before the first await: two racing requests cannot
  // both pass the check above within one microtask. Reason 'purchase': money
  // may move at any instant inside this window, so it never yields the gold
  // rail (server/storage_ladder_hold.ts).
  takeLadderHold(characterId, key, 'purchase');
  let handedOff = false;
  let spendClaim: PurchaseRef | null = null;
  let retainSpendClaim = false;
  // Set by any exit that leaves an OPEN row behind without a driver. The kick
  // fires in the finally, AFTER the mutex is released: kicking while we still
  // hold it only arms a hold the scan immediately yields to.
  let needsRecoveryKick = false;
  try {
    // A key with recorded history answers from that record FIRST, before
    // any fresh-purchase judgment: a retry of a settled purchase must
    // surface what actually happened to the money, never be re-refused as
    // if it were new (an unresolved purchase at a full ladder would
    // otherwise read as an innocent does_not_fit).
    const prior = await host.db.byKey(key);
    if (prior) {
      if (
        prior.accountId !== input.accountId ||
        prior.characterId !== characterId ||
        prior.itemId !== input.itemId ||
        prior.expectedCostClaudium !== input.expectedCostClaudium
      ) {
        // Cross-purchase key reuse: the same conflict shape the service
        // maps to already_granted with granted false.
        return refusal('already_granted');
      }
      if (prior.status === 'applied') {
        return { granted: true, balance: null, costClaudium: null, reason: 'already_granted' };
      }
      if (prior.status === 'unresolved') {
        markUnresolvedPurchase(characterId, prior.idempotencyKey);
        return { granted: true, balance: null, costClaudium: null, reason: 'grant_unresolved' };
      }
    }
    // A PENDING prior means this key may already have taken the money. The
    // dry run below judges the CURRENT ladder, so if it now refuses on ladder
    // state (the position moved under an open purchase) answering with its
    // innocent token would tell the client "nothing happened" over a possible
    // debit. Answer ambiguously instead and hand the row to recovery, which
    // spends the same key and archives an applied receipt, deletes a confirmed
    // no-debit refusal, or records unresolved: whatever actually happened to
    // the money. A pending prior that still
    // FITS falls through unchanged, which is the ordinary same-key retry.
    const priorPending = prior?.status === 'pending';
    // Pre-spend validation at the one sim entry point (fit, next-rung,
    // replay). Refuse BEFORE any money moves.
    const pre = host.grant(pid, input.itemId, key, true);
    let preAlreadyApplied = false;
    switch (pre.status) {
      case 'unknown_sku':
        return refusal('unknown_item');
      case 'invalid_key':
        return refusal('invalid_request');
      case 'no_player':
        return refusal('no_live_character');
      case 'not_next_rung':
        if (priorPending) {
          needsRecoveryKick = true;
          return ambiguousOpenRow(host, key, 'not_next_rung');
        }
        return refusal('not_next_rung');
      case 'does_not_fit':
        if (priorPending) {
          needsRecoveryKick = true;
          return ambiguousOpenRow(host, key, 'does_not_fit');
        }
        return refusal('does_not_fit');
      case 'already_applied':
        // Still establish/own the DB row below. That lets a crash-window blob
        // replay archive its durable receipt without an unclaimed save effect.
        preAlreadyApplied = true;
        break;
      case 'applied':
        // dryRun never applies; this arm only keeps the switch exhaustive.
        // Refuse closed rather than throw: handleClaudiumApi never throws.
        host.warn(`storage purchase ${key}: dry run unexpectedly returned applied`);
        return refusal('unavailable');
      case 'fits':
        break;
    }
    // Persist the pending record BEFORE the service call: written and
    // durable before any money moves, so the purchase is recoverable. The
    // upsert re-reads under the unique key, so a same-key race that slipped
    // past the byKey read above still converges on one row.
    const claimToken = randomUUID();
    const begun = await host.db.begin({
      realm: host.realm,
      accountId: input.accountId,
      characterId,
      itemId: input.itemId,
      expectedCostClaudium: input.expectedCostClaudium,
      idempotencyKey: key,
      claimToken,
    });
    // Whether NO OTHER ATTEMPT under this key can have debited, which is the
    // precondition for reading a transport fact as a definitive answer below.
    //
    // A fresh insert is the only state in which THIS request can prove no
    // earlier attempt under the key might have debited. Existing pending rows
    // always remain ambiguous and are resolved by the same-key coordinator.
    if (!begun.inserted) {
      if (begun.blockedByOpen) {
        // A different key owns this character's database-enforced open rail.
        // Pending work is kicked; unresolved is operator-held and must never
        // be sent through spend recovery.
        if (begun.blockedByOpen.status === 'unresolved') {
          markUnresolvedPurchase(characterId, begun.blockedByOpen.idempotencyKey);
        } else {
          needsRecoveryKick = true;
        }
        return refusal('purchase_in_progress');
      }
      const row = begun.existing;
      if (!row) return refusal('unavailable');
      // Same four-field identity check the byKey read above performs, repeated
      // because this arm answers a DIFFERENT row: byKey saw no row, so this one
      // was inserted by someone else between the two reads. Without the recheck
      // a colliding key would let this flow spend against and settle another
      // account's pending purchase. Writes are keyed by idempotency_key alone,
      // so the identity guard has to live here.
      if (
        row.accountId !== input.accountId ||
        row.characterId !== characterId ||
        row.itemId !== input.itemId ||
        row.expectedCostClaudium !== input.expectedCostClaudium ||
        row.idempotencyKey !== key
      ) {
        return refusal('already_granted');
      }
      if (row.status === 'applied') {
        return { granted: true, balance: null, costClaudium: null, reason: 'already_granted' };
      }
      if (row.status === 'unresolved') {
        markUnresolvedPurchase(characterId, row.idempotencyKey);
        return { granted: true, balance: null, costClaudium: null, reason: 'grant_unresolved' };
      }
      // A pending row is owned (or was abandoned) by another process claim.
      // The request path never becomes a second spender; recovery performs a
      // lease CAS and retries after the current owner finishes or expires.
      needsRecoveryKick = true;
      return refusal('purchase_in_progress');
    }
    const p: PurchaseRef = {
      accountId: input.accountId,
      characterId,
      itemId: input.itemId,
      expectedCostClaudium: input.expectedCostClaudium,
      key,
      claimToken,
    };
    spendClaim = p;
    if (preAlreadyApplied) {
      retainSpendClaim = true;
      void scheduleAppliedSave(host, p).then((saved) => {
        if (!saved) {
          void safeReleaseSpendClaim(host, p);
          kickStoragePurchaseRecovery(characterId);
        }
      });
      return { granted: true, balance: null, costClaudium: null, reason: 'already_granted' };
    }
    // RE-TAKEN AT THE LAST INSTANT BEFORE MONEY CAN MOVE, and this is not
    // hygiene. The stuck-promise backstop is a duration measured from when the
    // hold was taken, and the work above it includes multiple database waits
    // (the history read and begin transaction), each
    // able to cost the pool's connect timeout plus its statement timeout. On a
    // degraded-but-alive database that sum can exceed the backstop, so a hold
    // taken before them could lapse WHILE the spend was still to come: the gold
    // rail would open, take the rung, and leave this spend debiting for a rung
    // it can no longer apply. Restarting the clock here makes the backstop what
    // it claims to be, a bound on a stuck promise rather than on the database.
    retagLadderHold(characterId, key, 'purchase');
    if (!(await safeRenewSpendClaim(host, p))) {
      needsRecoveryKick = true;
      return refusal('unavailable');
    }
    const { result, neverReached } = await host.spend({
      accountId: input.accountId,
      itemId: input.itemId,
      kind: 'storage',
      expectedCostClaudium: input.expectedCostClaudium,
      idempotencyKey: key,
    });
    // Expiry is availability only. If another process took over while the
    // service call awaited, this stale reply cannot delete, settle, or grant.
    if (!(await safeRenewSpendClaim(host, p))) {
      needsRecoveryKick = true;
      return refusal('unavailable');
    }
    if (isAmbiguousSpendResult(result)) {
      // The request provably never reached the service, so no debit is possible
      // when this request inserted the row. Delete that operational row rather
      // than retaining refusal history. The gold rail is released only when the
      // delete confirms; an unconfirmed cleanup is re-driven.
      //
      // Gated on `noPriorDebitPossible`, and that gate is load-bearing: the
      // transport fact covers THIS request only. A row this request did not
      // establish as debit-free means an earlier attempt under this key may
      // have reached the service and debited, and answering that with a
      // definitive refusal is exactly the misclassification the classifier exists to
      // prevent. In particular a row left PENDING by somebody else never
      // qualifies.
      if (neverReached) {
        host.warn(
          `storage purchase ${key}: spend never reached the service, deleting no-debit pending row`,
        );
        if ((await safeDiscardWithoutDebit(host, p)) !== 'deleted') {
          needsRecoveryKick = true;
        } else {
          spendClaim = null;
        }
        return refusal('unavailable');
      }
      // Ambiguous outcome ('unavailable', or a granted:false whose reason is
      // outside the definitive vocabulary): the background task inherits the
      // mutex and retries the SAME key until the service answers
      // definitively. The client sees unavailable and may itself retry. The
      // hold becomes 'settling', the one reason with an argued yield, because
      // the service may stay unreachable for hours.
      await safeReleaseSpendClaim(host, p);
      spendClaim = null;
      handedOff = deferStoragePurchaseRecovery(host, p);
      if (!handedOff) needsRecoveryKick = true;
      return refusal('unavailable');
    }
    const settled = await settleDefinitive(host, p, result, 'request');
    retainSpendClaim = settled.claim === 'retained';
    if (settled.claim === 'closed') spendClaim = null;
    if (settled.retry) needsRecoveryKick = true;
    return settled.response;
  } catch (err) {
    // A database or host failure must degrade to the typed refusal shape,
    // never a thrown promise into handleClaudiumApi (which promises to
    // never throw). Nothing is lost: if the throw pre-dates the spend no
    // money moved, and if the pending row exists the next same-key retry or
    // login recovery converges it. 'unavailable' tells the client exactly
    // that: retry the same key.
    host.warn(`storage purchase ${key} failed closed: ${String(err)}`);
    // The one settle exit that used to release the mutex with NO driver left
    // behind. If the throw came after the spend, the row is pending over a
    // possible debit, and nothing would revisit it until the character's next
    // login. Every other exit either settles the row or hands it to the
    // background task (whose own finally re-kicks); this one now matches them,
    // so the module's "no pending row is left holding a debit without a driver
    // while its character stays online" claim holds on every path. The kick is
    // fire-and-forget, concurrency-bounded, and a no-op with no runtime wired.
    needsRecoveryKick = true;
    return refusal('unavailable');
  } finally {
    if (spendClaim && !retainSpendClaim) await safeReleaseSpendClaim(host, spendClaim);
    if (!handedOff) releaseLadderHold(characterId, key);
    // After the mutex is released, so the scan can take the row rather than
    // yield to our own dying flow.
    if (needsRecoveryKick) kickStoragePurchaseRecovery(characterId);
  }
}

// The production host is injected from server/main.ts. Tests may hand a host
// directly to the awaitable seam or the ambiguous-spend defer path. The map is
// bounded by the coordinator's own 200-key admission cap and cleared at the
// same lifecycle edge as each entry.
let runtimeHostFactory: (() => StoragePurchaseHost) | null = null;
const recoveryHosts = new Map<number, StoragePurchaseHost>();

function recoveryHost(characterId: number): StoragePurchaseHost {
  const pinned = recoveryHosts.get(characterId);
  if (pinned) return pinned;
  const host = runtimeHostFactory?.();
  if (!host) throw new Error('storage purchase recovery runtime is not configured');
  recoveryHosts.set(characterId, host);
  return host;
}

function reserveRecoveryRow(characterId: number, row: StoragePurchaseRow): boolean {
  const holder = ladderHoldKey(characterId);
  if (holder !== undefined && holder !== RECOVERY_HOLD_KEY && holder !== row.idempotencyKey) {
    return false;
  }
  takeLadderHold(characterId, row.idempotencyKey, 'recovery-drive');
  return true;
}

function prepareRecoveryScan(characterId: number, row: StoragePurchaseRow | null): void {
  const holder = ladderHoldKey(characterId);
  if (row && holder === row.idempotencyKey) {
    takeLadderHold(characterId, RECOVERY_HOLD_KEY, 'recovery-scan');
    return;
  }
  if (holder === undefined) takeLadderHold(characterId, RECOVERY_HOLD_KEY, 'recovery-scan');
}

function releaseRecovery(characterId: number, row: StoragePurchaseRow | null): void {
  if (row) releaseLadderHold(characterId, row.idempotencyKey);
  releaseLadderHold(characterId, RECOVERY_HOLD_KEY);
  recoveryHosts.delete(characterId);
}

const recoveryCoordinator = new StorageRecoveryCoordinator<StoragePurchaseRow>({
  scan: (characterId, signal) => {
    const host = recoveryHost(characterId);
    return withRecoveryBackgroundPermit(host, signal, () =>
      scanStoragePurchaseRecovery(host, characterId, signal),
    );
  },
  reserve: reserveRecoveryRow,
  drive: (characterId, row, isCurrent, signal) => {
    const host = recoveryHost(characterId);
    return drivePendingPurchase(host, characterId, row, isCurrent, signal);
  },
  prepareScan: prepareRecoveryScan,
  release: releaseRecovery,
  canEvict: (characterId) => {
    const host = recoveryHosts.get(characterId);
    return host?.isCharacterLive ? !host.isCharacterLive(characterId) : false;
  },
  warn: (message) => console.warn(`[storage-purchase] ${message}`),
});

export function configureStoragePurchaseRuntime(factory: () => StoragePurchaseHost): void {
  runtimeHostFactory = factory;
}

export function storagePurchaseRecoveryMetrics(): StorageRecoveryMetrics {
  return recoveryCoordinator.metrics();
}

export async function stopStoragePurchaseRecovery(): Promise<void> {
  await recoveryCoordinator.stop();
  recoveryHosts.clear();
}

/** Final-session teardown hook. Only a character proven offline may become a
 * capacity-eviction candidate; login/request kicks mark it live again. */
export function storagePurchaseCharacterOffline(characterId: number): void {
  unresolvedByCharacter.delete(characterId);
  // This hook runs only after the final local session's awaited leave save.
  // With no live character there is no gold command to guard; retaining the
  // process-local ordering hold would leak a failed save forever. A later join
  // arms its recovery-scan hold synchronously before accepting commands.
  ledgerOrderingHold.delete(characterId);
  // The LADDER hold goes too, WHATEVER its reason. A 'recovery-drive' hold is
  // POSITIVE_INFINITY-bounded and keyed by the row's idempotency key, so
  // evictLapsedRecoveryHold can never reach it: any coordinator path that
  // drops the entry without a finish would otherwise shut this character's
  // gold rail forever and leak the Map entry. Releasing here is safe by the
  // login covenant: with no live session there are no gold commands to guard,
  // and the ws_auth fresh-join kick re-arms a provisional hold SYNCHRONOUSLY
  // before the next session's first command can race the pending-row scan
  // (tests/server/ws_auth_login_covenant.test.ts pins it).
  inFlightByCharacter.delete(characterId);
  // Both warning latches (warnedYields + warnedLedgerStalls): documented as
  // tracking live incidents, and with the holds gone the incident is over; a
  // recurrence after the next join should log again.
  clearHoldWarnings(characterId);
  sweepKickEarliestNextMs.delete(characterId);
  recoveryCoordinator.characterOffline(characterId);
}

/** Minimum spacing between SWEEP-driven kick attempts per character. During a
 *  restart storm the coordinator sits saturated while the session sweep
 *  re-enters flagged sessions at up to 40 calls/s realm-wide; without spacing,
 *  every one of those re-entries built a fresh host object just to fail
 *  admission again. One attempt per second per character loses nothing (the
 *  session-owned pending bit keeps both rails guarded between attempts). */
export const SWEEP_KICK_RETRY_MS = 1_000;

// characterId -> earliest wall clock at which the SESSION SWEEP may attempt
// another kick. Consulted ONLY by the sweep-driven path (login/settle kicks
// stay immediate); stamped at each sweep attempt, deleted on a successful
// admission and on final-session teardown, so it stays proportional to live
// saturated sessions.
const sweepKickEarliestNextMs = new Map<number, number>();

/** The fresh-join hook (server/ws_auth.ts): fire-and-forget recovery of this
 *  character's pending purchases against the configured runtime host. Never
 *  throws into the join path; concurrency-bounded for login storms. Arms the
 *  PROVISIONAL hold synchronously (before the join's ws message handler can
 *  deliver a first gold buy), so the gold rail is closed until this kick's
 *  scan answers. A player's own first purchase in that window sees
 *  purchase_in_progress and retries. The window is the queue wait plus the
 *  scan, not the scan alone (see RECOVERY_HOLD_KEY).
 *
 *  `viaSweep` marks the bounded session sweep's retry lane
 *  (storage_recovery_session_sweep.ts) and is the ONLY caller the dueness
 *  stamp above throttles. */
export function kickStoragePurchaseRecovery(
  characterId: number,
  opts: { viaSweep?: boolean } = {},
): boolean {
  if (!runtimeHostFactory) return false;
  if (opts.viaSweep) {
    const now = Date.now();
    const earliest = sweepKickEarliestNextMs.get(characterId);
    if (earliest !== undefined && now < earliest) return false;
    sweepKickEarliestNextMs.set(characterId, now + SWEEP_KICK_RETRY_MS);
  }
  if (!inFlightByCharacter.has(characterId)) {
    takeLadderHold(characterId, RECOVERY_HOLD_KEY, 'recovery-scan');
  }
  // A duplicate login/settle kick needs no second host object. The coordinator
  // already owns the pinned host for this key and records the coalesced kick.
  if (recoveryCoordinator.tracks(characterId)) {
    const admitted = recoveryCoordinator.kick(characterId);
    if (admitted) {
      sweepKickEarliestNextMs.delete(characterId);
      recoveryHosts.get(characterId)?.setRecoveryAdmissionPending?.(characterId, false);
    }
    return admitted;
  }
  let host: StoragePurchaseHost;
  try {
    host = runtimeHostFactory();
    recoveryHosts.set(characterId, host);
  } catch (err) {
    // Unknown scan outcome: retain the time-bounded provisional hold. The next
    // live sweep/login can retry once the host is constructible again.
    recoveryCoordinator.reportHostFailure(err);
    return false;
  }
  if (!recoveryCoordinator.kick(characterId)) {
    // Move the unknown-pending guard onto the live session BEFORE releasing
    // the coordinator-owned structures, so neither paid nor gold has a gap.
    host.setRecoveryAdmissionPending?.(characterId, true);
    releaseRecovery(characterId, null);
    return false;
  }
  sweepKickEarliestNextMs.delete(characterId);
  host.setRecoveryAdmissionPending?.(characterId, false);
  return true;
}

export const storageRecovery = {
  kick: kickStoragePurchaseRecovery,
  offline: storagePurchaseCharacterOffline,
} as const;

/** The AWAITED scan-plus-drive composition, and it is a TEST-FACING seam, not
 *  the production login hook. Nothing in server/ calls it: production enters
 *  through `kickStoragePurchaseRecovery` (below), which composes these same two
 *  halves and adds everything that makes the login covenant work, namely the
 *  synchronous provisional ladder hold, the login-storm gate, the clock retag
 *  at admission and the release when the scan comes back empty.
 *
 *  Kept rather than deleted because the recovery CONTRACT reads far better in
 *  an awaitable form than through a fire-and-forget kick, and nine cases in
 *  tests/server/storage_purchases.test.ts drive it that way. A reader auditing
 *  the login rail wants the kick; a test wanting to observe a settled row wants
 *  this. Do not re-word this header to claim ws_auth calls it: it said exactly
 *  that for nineteen phases and sent every reader to the wrong function. */
export async function resumeStoragePurchasesAtLogin(
  host: StoragePurchaseHost,
  characterId: number,
): Promise<void> {
  for (;;) {
    let row: StoragePurchaseRow | null;
    try {
      row = await scanStoragePurchaseRecovery(host, characterId);
    } catch (err) {
      host.warn(`storage purchase recovery for character ${characterId} skipped: ${String(err)}`);
      releaseRecovery(characterId, null);
      return;
    }
    if (!row) {
      releaseRecovery(characterId, null);
      return;
    }
    if (!reserveRecoveryRow(characterId, row)) {
      releaseRecovery(characterId, null);
      return;
    }
    const result = await drivePendingPurchase(host, characterId, row, () => true);
    if (result !== 'done') {
      releaseRecovery(characterId, row);
      if (result === 'retry') deferStoragePurchaseRecovery(host, purchaseRef(row));
      return;
    }
    prepareRecoveryScan(characterId, row);
    // The production coordinator enforces this boundary too. Keep the awaited
    // seam honest: a pathological character never drains all rows in one turn.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Resolve the login scan without ever handing an unresolved row to the spend
 * coordinator. A successful authoritative openFor read also clears a stale
 * in-memory bit after support removed the row. */
async function scanStoragePurchaseRecovery(
  host: StoragePurchaseHost,
  characterId: number,
  signal?: AbortSignal,
): Promise<StoragePurchaseRow | null> {
  const row = await host.db.openFor(characterId, signal);
  if (row?.status === 'unresolved') {
    markUnresolvedPurchase(characterId, row.idempotencyKey);
    return null;
  }
  unresolvedByCharacter.delete(characterId);
  return row;
}

function purchaseRef(row: StoragePurchaseRow, claimToken = randomUUID()): PurchaseRef {
  return {
    accountId: row.accountId,
    characterId: row.characterId,
    itemId: row.itemId,
    expectedCostClaudium: row.expectedCostClaudium,
    key: row.idempotencyKey,
    claimToken,
  };
}

function pendingRow(host: StoragePurchaseHost, p: PurchaseRef): StoragePurchaseRow {
  return {
    id: 0,
    realm: host.realm,
    accountId: p.accountId,
    characterId: p.characterId,
    itemId: p.itemId,
    expectedCostClaudium: p.expectedCostClaudium,
    idempotencyKey: p.key,
    status: 'pending',
  };
}

function deferStoragePurchaseRecovery(host: StoragePurchaseHost, p: PurchaseRef): boolean {
  recoveryHosts.set(p.characterId, host);
  const admitted = recoveryCoordinator.defer(p.characterId, pendingRow(host, p));
  if (admitted) {
    // This row is known to have received an ambiguous service answer, rather
    // than merely waiting behind a scan. Preserve that distinction in the
    // gold-rail warning and restart its ambiguity clock at the handoff.
    retagLadderHold(p.characterId, p.key, 'settling');
  }
  if (!admitted && !recoveryCoordinator.tracks(p.characterId)) {
    recoveryHosts.delete(p.characterId);
  }
  return admitted;
}

/** Drive exactly one reserved row. Every retry returns to the coordinator. */
async function drivePendingPurchase(
  host: StoragePurchaseHost,
  characterId: number,
  row: StoragePurchaseRow,
  isCurrent: () => boolean,
  signal?: AbortSignal,
): Promise<StorageRecoveryDriveResult> {
  const shouldContinue = () => !signal?.aborted && isCurrent();
  if (!shouldContinue() || ladderHoldKey(characterId) !== row.idempotencyKey) return 'stop';
  const live = host.resolveLiveCharacter(row.accountId);
  if (!live || live.characterId !== characterId) return 'stop';
  const p = purchaseRef(row);
  if (!(await safeClaimSpend(host, p.key, p.claimToken, signal))) return 'retry';
  let claimOpen = true;
  try {
    if (!shouldContinue()) return 'stop';
    const pre = host.grant(live.pid, row.itemId, row.idempotencyKey, true);
    if (pre.status === 'already_applied') {
      const saved = await scheduleAppliedSave(host, p, undefined, shouldContinue, signal);
      if (saved) claimOpen = false;
      return saved ? 'done' : 'retry';
    }
    if (!shouldContinue()) return 'stop';
    // The exact key is reserved before this call. A recovered row's history is
    // unknowable, so even a never-reached retry cannot disprove an earlier
    // debit under the same key.
    retagLadderHold(characterId, row.idempotencyKey, 'purchase');
    const { result } = await host.spend(
      {
        accountId: row.accountId,
        itemId: row.itemId,
        kind: 'storage',
        expectedCostClaudium: row.expectedCostClaudium,
        idempotencyKey: row.idempotencyKey,
      },
      signal,
    );
    if (!shouldContinue()) return 'stop';
    if (!(await safeRenewSpendClaim(host, p, signal))) return 'retry';
    if (isAmbiguousSpendResult(result)) {
      retagLadderHold(characterId, row.idempotencyKey, 'settling');
      return 'retry';
    }
    const settled = await settleDefinitive(host, p, result, 'recovery', shouldContinue, signal);
    claimOpen = settled.claim === 'open';
    return settled.retry ? 'retry' : 'done';
  } catch (err) {
    if (recoveryCancelled(signal)) return 'stop';
    host.warn(`storage purchase recovery ${row.idempotencyKey} failed: ${String(err)}`);
    retagLadderHold(characterId, row.idempotencyKey, 'settling');
    return 'retry';
  } finally {
    if (claimOpen) await safeReleaseSpendClaim(host, p, signal);
  }
}
