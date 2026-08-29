// Bank Storage phase 11: the Claudium storage purchase flow
// (server/storage_purchases.ts) driven end to end against the REAL sim grant
// command (bankGrantStorageSlots through sim.ctx, the exact production call
// shape) with a hand-rolled host: scripted spend results, an in-memory
// pending-row table with the SQL guards mirrored and a controllable save.
//
// The matrix here is the phase's ordering contract: exactly-once under
// ambiguous retry, the settle-only-after-save rule, the apply-time re-check
// (never partial, never clawback, unresolved surfaces), the per-character
// mutex, the next-login auto-apply, and the refuse-before-money gates.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBankLedgerSessionJournal } from '../../server/bank_ledger_session';
import { type BankSim, dispatchBankCommand } from '../../server/bank_wire';
import type { ClaudiumSpendOutcome, ClaudiumSpendResult } from '../../server/claudium_proxy';
import { REALM } from '../../server/realm';
import {
  acknowledgeStorageAppliedEffects,
  snapshotStorageAppliedEffects,
  stageStorageAppliedEffect,
} from '../../server/storage_applied_effect_queue';
import { AMBIGUITY_HOLD_MAX_MS, WEDGED_HOLD_MAX_MS } from '../../server/storage_ladder_hold';
import type { StorageAppliedEffect, StoragePurchaseRow } from '../../server/storage_purchase_db';
import {
  configureStoragePurchaseRuntime,
  executeStoragePurchase,
  kickStoragePurchaseRecovery,
  resetStoragePurchasesForTests,
  resumeStoragePurchasesAtLogin,
  type StoragePurchaseHost,
  SWEEP_KICK_RETRY_MS,
  storageAppliedEffectsCommitted,
  storagePurchaseCharacterOffline,
  storagePurchaseInFlight,
  storagePurchaseRecoveryMetrics,
} from '../../server/storage_purchases';
import { STORAGE_RECOVERY_MAX_TRACKED } from '../../server/storage_recovery_coordinator';
import {
  BANK_EXPANSION_PRICES,
  BANK_EXPANSION_SLOTS,
  bankGrantStorageSlots,
} from '../../src/sim/bank';
import { BUILTIN_WORLD } from '../../src/sim/data';
import { Sim } from '../../src/sim/sim';
import type { WorldContent } from '../../src/sim/types';

const GRANT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const ACCOUNT = 7;
const CHARACTER = 42;

const granted = (over: Partial<ClaudiumSpendResult> = {}): ClaudiumSpendResult => ({
  granted: true,
  balance: 900,
  costClaudium: 100,
  reason: null,
  ...over,
});
const unavailable = (): ClaudiumSpendResult => ({
  granted: false,
  balance: null,
  costClaudium: null,
  reason: 'unavailable',
});
/** The outage shape: the spend PROVABLY never reached the service, so no debit
 *  is possible (a connect refusal, not a timeout). */
const neverReached = (): ClaudiumSpendOutcome => ({
  result: unavailable(),
  neverReached: true,
});

interface FakeRow extends StoragePurchaseRow {
  resolvedAt: number | null;
  spendClaimToken: string | null;
}

// The in-memory stand-in for storage_purchase_db, mirroring the SQL guards
// exactly: unique key on begin, settle only FROM pending, no-debit cleanup as
// a guarded DELETE, and pendingFor returning one oldest pending row.
function makeFakeDb() {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  return {
    rows,
    begin: vi.fn(
      async (row: {
        realm: string;
        accountId: number;
        characterId: number;
        itemId: string;
        expectedCostClaudium: number;
        idempotencyKey: string;
        claimToken?: string;
      }) => {
        const existing = rows.get(row.idempotencyKey);
        if (existing) return { inserted: false, existing: { ...existing } };
        const characterOpen = [...rows.values()].find(
          (candidate) =>
            candidate.characterId === row.characterId &&
            (candidate.status === 'pending' || candidate.status === 'unresolved'),
        );
        if (characterOpen) {
          return {
            inserted: false,
            existing: null,
            blockedByOpen: { ...characterOpen },
          };
        }
        const fresh: FakeRow = {
          id: nextId++,
          realm: row.realm,
          accountId: row.accountId,
          characterId: row.characterId,
          itemId: row.itemId,
          expectedCostClaudium: row.expectedCostClaudium,
          idempotencyKey: row.idempotencyKey,
          status: 'pending',
          resolvedAt: null,
          spendClaimToken: row.claimToken ?? null,
        };
        rows.set(row.idempotencyKey, fresh);
        return { inserted: true, existing: { ...fresh } };
      },
    ),
    byKey: vi.fn(async (key: string) => {
      const row = rows.get(key);
      return row ? { ...row } : null;
    }),
    claimSpend: vi.fn(async (key: string, claimToken: string) => {
      const row = rows.get(key);
      if (row?.status !== 'pending' || row.spendClaimToken) return false;
      row.spendClaimToken = claimToken;
      return true;
    }),
    renewSpendClaim: vi.fn(async (key: string, claimToken: string) => {
      const row = rows.get(key);
      return row?.status === 'pending' && row.spendClaimToken === claimToken;
    }),
    releaseSpendClaim: vi.fn(async (key: string, claimToken: string) => {
      const row = rows.get(key);
      if (row?.status !== 'pending' || row.spendClaimToken !== claimToken) return false;
      row.spendClaimToken = null;
      return true;
    }),
    settle: vi.fn(async (key: string, status: 'applied' | 'unresolved', claimToken: string) => {
      const row = rows.get(key);
      if (row?.status !== 'pending' || row.spendClaimToken !== claimToken) return false;
      row.status = status;
      row.resolvedAt = 1;
      row.spendClaimToken = null;
      return true;
    }),
    discardWithoutDebit: vi.fn(async (key: string, claimToken: string) => {
      const row = rows.get(key);
      if (row?.status !== 'pending' || row.spendClaimToken !== claimToken) return false;
      rows.delete(key);
      return true;
    }),
    pendingFor: vi.fn(async (characterId: number): Promise<FakeRow | null> => {
      const match = [...rows.values()]
        .filter((r) => r.characterId === characterId && r.status === 'pending')
        .sort((a, b) => a.id - b.id)
        .at(0);
      return match ? { ...match } : null;
    }),
    openFor: vi.fn(async (characterId: number): Promise<FakeRow | null> => {
      const match = [...rows.values()]
        .filter(
          (r) =>
            r.characterId === characterId && (r.status === 'pending' || r.status === 'unresolved'),
        )
        .sort((a, b) => a.id - b.id)
        .at(0);
      return match ? { ...match } : null;
    }),
  };
}

function makeHarness(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: GRANT_TEST_WORLD });
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  const db = makeFakeDb();
  type ScriptedSpend =
    | ClaudiumSpendResult
    | ClaudiumSpendOutcome
    | (() =>
        | ClaudiumSpendResult
        | ClaudiumSpendOutcome
        | Promise<ClaudiumSpendResult | ClaudiumSpendOutcome>);
  const spendResults: ScriptedSpend[] = [];
  // The parameter is DECLARED so mock.calls is typed: a fingerprint pin has to
  // read the request object, and an untyped vi.fn() gives it an empty tuple.
  // A bare result is normalized to the REACHED outcome, so only a case that
  // deliberately scripts neverReached() exercises the transport arm.
  const spend = vi.fn(
    async (
      _input: Parameters<StoragePurchaseHost['spend']>[0],
      _signal?: Parameters<StoragePurchaseHost['spend']>[1],
    ) => {
      const next = spendResults.shift();
      if (next === undefined) throw new Error('spend called with no scripted result');
      const value = typeof next === 'function' ? await next() : next;
      return 'result' in value ? value : { result: value, neverReached: false };
    },
  );
  const state = {
    live: true,
    saveResult: true as boolean | Promise<boolean>,
    recoveryAdmissionPending: false,
    offlineCharacters: new Set<number>(),
  };
  const stagedEffects: StorageAppliedEffect[] = [];
  const commitStaged = (captured: readonly StorageAppliedEffect[]): void => {
    for (const effect of captured) {
      const row = db.rows.get(effect.idempotencyKey);
      if (row && effect.spendClaimToken && row.spendClaimToken === effect.spendClaimToken) {
        row.status = 'applied';
        row.resolvedAt = 1;
      }
    }
    acknowledgeStorageAppliedEffects(stagedEffects, captured);
  };
  const saveCharacter = vi.fn(async () => {
    const captured = snapshotStorageAppliedEffects(stagedEffects);
    const saved = await state.saveResult;
    if (saved) commitStaged(captured);
    return saved;
  });
  const stageAppliedEffect = vi.fn(
    (effect: Parameters<StoragePurchaseHost['stageAppliedEffect']>[0]) => {
      stageStorageAppliedEffect(stagedEffects, effect, meta.bank.purchasedSlots);
      return true;
    },
  );
  const warn = vi.fn();
  const host: StoragePurchaseHost = {
    resolveLiveCharacter: (accountId) =>
      state.live && accountId === ACCOUNT ? { characterId: CHARACTER, pid: sim.playerId } : null,
    isCharacterLive: (characterId) => !state.offlineCharacters.has(characterId),
    setRecoveryAdmissionPending: (characterId, pending) => {
      if (characterId === CHARACTER) state.recoveryAdmissionPending = pending;
    },
    recoveryAdmissionPending: (characterId) =>
      characterId === CHARACTER && state.recoveryAdmissionPending,
    grant: (pid, skuId, key, dryRun) => bankGrantStorageSlots(sim.ctx, pid, skuId, key, { dryRun }),
    stageAppliedEffect,
    saveCharacter: (characterId) =>
      characterId === CHARACTER ? saveCharacter() : Promise.resolve(false),
    spend,
    db,
    realm: 'testrealm',
    warn,
  };
  return {
    sim,
    meta,
    db,
    spend,
    spendResults,
    stagedEffects,
    stageAppliedEffect,
    commitStaged,
    state,
    saveCharacter,
    warn,
    host,
  };
}

// Await full quiescence of the fire-and-forget save and bounded-recovery
// chains: condition-polled, never a fixed sleep.
async function waitFor(cond: () => boolean): Promise<void> {
  await vi.waitFor(
    () => {
      if (!cond()) throw new Error('not yet');
    },
    { timeout: 10_000 },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetStoragePurchasesForTests();
});
afterEach(() => {
  resetStoragePurchasesForTests();
});

describe('executeStoragePurchase: the happy path and the ordering contract', () => {
  it('applies a granted rung once, records the ledger, and settles only after the save', async () => {
    const h = makeHarness();
    let saveResolve!: (v: boolean) => void;
    h.state.saveResult = new Promise<boolean>((r) => {
      saveResolve = r;
    });
    h.spendResults.push(granted());
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-1',
    });
    expect(res).toEqual({ granted: true, balance: 900, costClaudium: 100, reason: null });
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.meta.bank.appliedStorageKeys).toEqual(['key-1']);
    // Neither the applied settle NOR the claudium ledger row may land until
    // the character save resolves (the durability rule: a fenced-out apply
    // must leave no audit row and no applied mark). The GOLD rail stays shut
    // across that window: a gold rung landing here would insert its ledger
    // row ahead of the claudium one and read as purchased_regression.
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    expect(h.db.rows.get('key-1')?.status).toBe('pending');
    expect(h.stagedEffects).toHaveLength(1);
    const overlapping = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-1-overlap',
    });
    expect(overlapping.reason).toBe('purchase_in_progress');
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.db.rows.has('key-1-overlap')).toBe(false);
    expect(h.stagedEffects).toHaveLength(1);
    saveResolve(true);
    await waitFor(() => h.db.rows.get('key-1')?.status === 'applied');
    // ... and reopens once the audit row is durable.
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
    expect(h.stageAppliedEffect).toHaveBeenCalledWith({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-1',
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
      spendClaimToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(h.stagedEffects).toEqual([]);
    expect(h.db.releaseSpendClaim).not.toHaveBeenCalled();
    // The pending row was durable BEFORE the money moved.
    expect(h.db.begin.mock.invocationCallOrder[0]).toBeLessThan(
      h.spend.mock.invocationCallOrder[0],
    );
  });

  it('a failed save leaves the row pending, and a fresh login replays to exactly one durable apply', async () => {
    const h = makeHarness();
    h.state.saveResult = false;
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-2',
    });
    await waitFor(() => h.saveCharacter.mock.calls.length === 1);
    expect(h.db.rows.get('key-2')?.status).toBe('pending');
    // An apply that never proved durable writes NO audit row: the durable
    // replay below writes exactly one (the verify round's over-count fix).
    expect(h.stagedEffects).toHaveLength(1);
    resetStoragePurchasesForTests();
    // The process dies before any save: the reloaded state has neither the
    // slots nor the key (a FRESH sim from the same seed), and the login
    // recovery retries the SAME key; the service replays already_granted
    // with no second debit, and the grant applies exactly once against the
    // durable state.
    const h2 = makeHarness();
    for (const [k, v] of h.db.rows) h2.db.rows.set(k, { ...v });
    h2.spendResults.push(granted({ reason: 'already_granted' }));
    await resumeStoragePurchasesAtLogin(h2.host, CHARACTER);
    expect(h2.meta.bank.purchasedSlots).toBe(6);
    expect(h2.meta.bank.appliedStorageKeys).toEqual(['key-2']);
    await waitFor(() => h2.db.rows.get('key-2')?.status === 'applied');
    expect(h2.spend).toHaveBeenCalledTimes(1);
    // Exactly ONE audit row across both attempts: the durable apply's.
    expect(h2.stageAppliedEffect).toHaveBeenCalledTimes(1);
  });

  it('a save-refused apply stays staged until a later save commits its audit row', async () => {
    // saveCharacter returning false is ORDINARY concurrency, not a failure:
    // server/game.ts returns false when the guild-book half of the transaction
    // is escrow-refused, and the periodic autosave persists the same blob a
    // moment later. The slots and the key are then durable while the row is
    // still pending. The staged effect survives and the next save commits the
    // blob, receipt, and Claudium bank_ledger row together.
    const h = makeHarness();
    h.state.saveResult = false;
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-audit-gap',
    });
    await waitFor(() => h.saveCharacter.mock.calls.length === 1);
    expect(h.db.rows.get('key-audit-gap')?.status).toBe('pending');
    expect(h.stagedEffects).toHaveLength(1);
    const firstClaim = h.stagedEffects[0]?.spendClaimToken;
    await waitFor(() => h.db.rows.get('key-audit-gap')?.spendClaimToken === null);
    // The slots and the key ARE in the live blob; the ordinary save that lands
    // next makes them durable. Unlike the fresh-sim case above, this harness
    // KEEPS that state, which is exactly what distinguishes the two.
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.meta.bank.appliedStorageKeys).toEqual(['key-audit-gap']);
    h.state.saveResult = true;

    await resumeStoragePurchasesAtLogin(h.host, CHARACTER);
    await waitFor(() => h.db.rows.get('key-audit-gap')?.status === 'applied');
    // Exactly-once still holds and no money moved twice: the replay never
    // reached the service, because the key was already in the blob.
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.stageAppliedEffect).toHaveBeenCalledTimes(2);
    const recoveryClaim = h.stageAppliedEffect.mock.calls[1]?.[0].spendClaimToken;
    expect(recoveryClaim).not.toBe(firstClaim);
    expect(h.stagedEffects).toEqual([]);
  });

  it('settleDefinitive already_applied stages the missing receipt behind a save', async () => {
    // The defense-in-depth arm behind the mutex: the service answers granted
    // for a key whose slots are already in the blob. No production caller
    // chain reaches it today (the pre-spend dry run and the login recovery
    // both catch an applied key earlier, and the per-character mutex keeps a
    // second flow off the same key), so it is driven straight through the
    // injected host. A mutation audit found it completely uncovered, which
    // matters because the durable receipt must still be written for a key
    // already present in the blob.
    const h = makeHarness();
    h.spendResults.push(granted());
    const realGrant = h.host.grant;
    let calls = 0;
    h.host.grant = ((pid, sku, key, dryRun) => {
      calls += 1;
      // Call 1 is the pre-spend dry run (let it pass); call 2 is the real
      // apply, which reports the slots already landed under this key.
      if (calls === 2) {
        h.meta.bank.purchasedSlots = 6;
        h.meta.bank.appliedStorageKeys.push(key);
        return { status: 'already_applied' } as ReturnType<typeof realGrant>;
      }
      return realGrant(pid, sku, key, dryRun);
    }) as typeof h.host.grant;

    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-already-applied-arm',
    });
    // Granted stays true (the money moved) and the replay marker is surfaced.
    expect(res.granted).toBe(true);
    expect(res.reason).toBe('already_granted');
    // The operational row closes only behind a confirmed save.
    await waitFor(() => h.db.rows.get('key-already-applied-arm')?.status === 'applied');
    expect(h.saveCharacter).toHaveBeenCalled();
    expect(h.stageAppliedEffect).toHaveBeenCalledTimes(1);
    // Nothing was clamped or double-applied: the arm preserves the six slots
    // already present and only stages their missing durable receipt.
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.stageAppliedEffect).toHaveBeenCalledWith({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-already-applied-arm',
      spendClaimToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
  });

  it('an OPEN row whose ladder position moved answers ambiguously, never an innocent refusal', async () => {
    // A pending prior means this key may already have taken the money, so the
    // dry run's verdict about the CURRENT ladder must not be reported as if
    // the purchase were fresh. Before this guard the caller heard
    // not_next_rung, which reads as "nothing happened".
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-open-moved',
    });
    // The ladder moved under the open row: rung_02 is no longer next.
    // (Nothing applied yet, so position 0 is next and rung_02 wants 1.)
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-open-moved',
    });
    expect(res.reason).toBe('unavailable');
    expect(res.granted).toBe(false);
    // Nothing spent from the request path, and the row is left open for
    // recovery to settle against what actually happened to the money.
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.db.rows.get('key-open-moved')?.status).toBe('pending');
    expect(h.meta.bank.purchasedSlots).toBe(0);
  });

  it('an OPEN row that no longer FITS answers ambiguously too, not an innocent does_not_fit', async () => {
    // The ceiling gate's half of the same diversion, and the one the CLIENT
    // leans on hardest: does_not_fit is in the client's definitive-refusal set
    // (src/ui/store_purchase_intent.ts), so the client CLOSES its intent on it
    // and the next click mints a fresh key. That is only safe because this arm
    // guarantees a does_not_fit can never be answered over a pending row. Delete
    // the diversion here and the client silently starts minting second keys over
    // live debits, with every other test still green.
    const h = makeHarness();
    // The ladder is already full, so any grant overshoots the ceiling.
    h.meta.bank.purchasedSlots = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-open-nofit',
    });
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-open-nofit',
    });
    expect(res.reason).toBe('unavailable');
    expect(res.reason).not.toBe('does_not_fit');
    expect(res.granted).toBe(false);
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.db.rows.get('key-open-nofit')?.status).toBe('pending');
  });

  it('a FRESH purchase that does not fit still gets the innocent does_not_fit', async () => {
    // The negative arm, and what makes the client's definitive classification
    // correct: with NO prior row under this key nothing can be behind it, so the
    // honest specific token is owed. A guard that answered every overshoot with
    // unavailable would pass the case above and fail here.
    const h = makeHarness();
    h.meta.bank.purchasedSlots = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-fresh-nofit',
    });
    expect(res.reason).toBe('does_not_fit');
    expect(res.granted).toBe(false);
    expect(h.spend).not.toHaveBeenCalled();
  });

  it('a FRESH purchase at a wrong ladder position still gets the innocent token', async () => {
    // The negative arm: without a prior row nothing is owed, so the honest
    // answer is the specific refusal. A guard that answered every wrong-rung
    // request with unavailable would pass the case above and fail here.
    const h = makeHarness();
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-fresh-wrongrung',
    });
    expect(res.reason).toBe('not_next_rung');
    expect(h.db.rows.has('key-fresh-wrongrung')).toBe(false);
    expect(h.spend).not.toHaveBeenCalled();
  });

  it('the recovery replay re-sends the EXACT fingerprint, not just the key', async () => {
    // The service binds item + kind + cost to the idempotency key, so a replay
    // that drifted on any of them would hit the conflict arm and be read as
    // already_granted with granted false: a paid purchase reported as refused.
    // Pinned as a literal request shape rather than "was called".
    const h = makeHarness();
    h.state.saveResult = false;
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-fingerprint',
    });
    await waitFor(() => h.saveCharacter.mock.calls.length === 1);
    expect(h.spend.mock.calls[0][0]).toEqual({
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      kind: 'storage',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-fingerprint',
    });

    resetStoragePurchasesForTests();
    const h2 = makeHarness();
    for (const [k, v] of h.db.rows) h2.db.rows.set(k, { ...v });
    h2.spendResults.push(granted({ reason: 'already_granted' }));
    await resumeStoragePurchasesAtLogin(h2.host, CHARACTER);
    await waitFor(() => h2.db.rows.get('key-fingerprint')?.status === 'applied');
    // The replay's request is byte-for-byte the original, rebuilt from the
    // persisted row (which is why expected_cost_claudium is stored at all).
    expect(h2.spend.mock.calls[0][0]).toEqual({
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      kind: 'storage',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-fingerprint',
    });
    expect(h2.meta.bank.purchasedSlots).toBe(12);
  });

  it('the definitive refusal set is EXACTLY the service spend vocabulary', async () => {
    // Six tokens, matching service/src/claudium/spend.ts's declared result
    // type. Pinned as literals rather than through the production constant, so
    // widening the set has to be a deliberate edit here too. 'invalid_request'
    // is deliberately ABSENT: the service emits it only from its admin
    // recovery surface, and treating a token the spend surface cannot return
    // as definitive would delete a live debit's recovery row if it ever did.
    for (const [reason, definitive] of [
      ['insufficient_balance', true],
      ['unknown_item', true],
      ['already_granted', true],
      ['not_cosmetic', true],
      ['kind_mismatch', true],
      ['price_changed', true],
      ['invalid_request', false],
      ['unavailable', false],
      ['some_future_token', false],
    ] as [string, boolean][]) {
      const h = makeHarness();
      h.spendResults.push({ granted: false, balance: null, costClaudium: null, reason });
      const res = await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: `key-vocab-${reason}`,
      });
      if (definitive) {
        // Deleted with zero refusal history, and the caller sees the service's token.
        expect(h.db.rows.has(`key-vocab-${reason}`)).toBe(false);
        expect(res.reason).toBe(reason);
      } else {
        // Ambiguous: the row stays pending over a possible debit and the
        // background task inherits the mutex to retry the SAME key.
        expect(res.reason).toBe('unavailable');
        expect(h.db.rows.get(`key-vocab-${reason}`)?.status).toBe('pending');
      }
      resetStoragePurchasesForTests();
    }
  }, 20_000);

  it('a begin-conflict row belonging to ANOTHER purchase is refused, never settled', async () => {
    // byKey saw no row, so a colliding key was inserted between the two reads.
    // writes are keyed by idempotency_key alone, so without the identity
    // recheck on the conflict arm this flow would spend
    // against someone else's pending purchase.
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT + 1,
      characterId: CHARACTER + 1,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-collide',
    });
    // Hide it from the pre-read so the flow reaches the begin conflict.
    h.db.byKey.mockResolvedValueOnce(null);
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-collide',
    });
    expect(res.granted).toBe(false);
    expect(res.reason).toBe('already_granted');
    // Nothing spent, and the other purchase's row is untouched.
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.db.rows.get('key-collide')?.status).toBe('pending');
    expect(h.db.rows.get('key-collide')?.accountId).toBe(ACCOUNT + 1);
    expect(h.meta.bank.purchasedSlots).toBe(0);
  });

  it('a fail-closed throw re-kicks recovery, so a possibly-debited row keeps a driver', async () => {
    // The catch arm is the one settle exit that used to release the mutex with
    // nothing left to revisit the row. Make the settle throw AFTER a granted
    // spend: the money may be gone, the row is pending, and the character is
    // still online, so recovery must be re-armed rather than deferred to the
    // next login.
    const h = makeHarness();
    // The original spend, then the recovery's same-key replay (the service
    // answers already_granted with no second debit).
    h.spendResults.push(granted(), granted({ reason: 'already_granted' }));
    // Make the real apply throw, so the failure lands inside the try AFTER the
    // spend: exactly the window where the money may already be gone.
    const realGrant = h.host.grant;
    let calls = 0;
    h.host.grant = ((pid, sku, key, dryRun) => {
      calls += 1;
      if (calls === 2) throw new Error('grant blew up after the spend');
      return realGrant(pid, sku, key, dryRun);
    }) as typeof h.host.grant;
    configureStoragePurchaseRuntime(() => {
      h.host.grant = realGrant;
      return h.host;
    });

    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-failclosed',
    });
    expect(res.reason).toBe('unavailable');
    // The re-kicked scan finds the pending row and converges it against the
    // same key, so the debit ends as applied slots instead of sitting idle.
    await waitFor(() => h.db.rows.get('key-failclosed')?.status === 'applied');
    expect(h.meta.bank.purchasedSlots).toBe(6);
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
  }, 20_000);

  it('a granted:false reply with an unknown or null reason is AMBIGUOUS, never a refusal settle', async () => {
    const h = makeHarness();
    // A malformed 2xx (an interposed proxy, service version skew) coerces to
    // granted:false reason:null; treating it as no-debit could erase a
    // debited purchase. It must retry the same key like 'unavailable'.
    h.spendResults.push(
      { granted: false, balance: null, costClaudium: null, reason: null },
      { granted: false, balance: null, costClaudium: null, reason: 'mystery_token' },
      granted(),
    );
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-mal',
    });
    expect(res.reason).toBe('unavailable');
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
    expect(h.meta.bank.purchasedSlots).toBe(6);
    await waitFor(() => h.db.rows.get('key-mal')?.status === 'applied');
    expect(h.spend).toHaveBeenCalledTimes(3);
    // The request inserted with its claim; only the two recovery turns need a
    // claim acquisition. Every reply is revalidated once, and the request also
    // renews after its multi-statement begin immediately before service IO.
    expect(h.db.claimSpend).toHaveBeenCalledTimes(2);
    expect(h.db.renewSpendClaim).toHaveBeenCalledTimes(4);
    // Only the two ambiguous attempts leave the row open. The successful save
    // deletes it transactionally and performs no guaranteed-zero-row release.
    expect(h.db.releaseSpendClaim).toHaveBeenCalledTimes(2);
  });

  it('an unconfirmed definitive-refusal delete reports unavailable and keeps recovery armed', async () => {
    const h = makeHarness();
    h.spendResults.push({
      granted: false,
      balance: 0,
      costClaudium: 100,
      reason: 'insufficient_balance',
    });
    h.db.discardWithoutDebit.mockResolvedValueOnce(false);
    configureStoragePurchaseRuntime(() => h.host);
    const result = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-cleanup-miss',
    });
    expect(result.reason).toBe('unavailable');
    expect(h.db.rows.get('key-cleanup-miss')?.status).toBe('pending');
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
  });

  it('resolves an ambiguous outcome by retrying the SAME key in the background, applying once', async () => {
    const h = makeHarness();
    h.spendResults.push(unavailable(), granted());
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-3',
    });
    // The client sees unavailable; the mutex stays held by the background
    // settle task until the service answers definitively.
    expect(res.reason).toBe('unavailable');
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.meta.bank.appliedStorageKeys).toEqual(['key-3']);
    await waitFor(() => h.db.rows.get('key-3')?.status === 'applied');
    // Both calls carried the identical fingerprint: same key, same item,
    // same declared cost. Never a second minted key.
    expect(h.spend).toHaveBeenCalledTimes(2);
    expect(h.spend.mock.calls[0]?.[0]).toEqual(h.spend.mock.calls[1]?.[0]);
    expect(h.spend.mock.calls[0]?.[1]).toBeUndefined();
    expect(h.spend.mock.calls[1]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('a same-key retry after a completed purchase answers already_granted without spending again', async () => {
    const h = makeHarness();
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-4',
    });
    await waitFor(() => h.db.rows.get('key-4')?.status === 'applied');
    const retry = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-4',
    });
    expect(retry.granted).toBe(true);
    expect(retry.reason).toBe('already_granted');
    // EXACTLY once: the counter did not move again and the service was not
    // called a second time (the in-blob key answers the replay).
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(h.spend).toHaveBeenCalledTimes(1);
  });

  it('never confirms through the store: no owned read exists anywhere in the flow', async () => {
    const h = makeHarness();
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-5',
    });
    // The host surface IS the capability boundary: it exposes no store
    // read at all, so the receipt is the only confirmation the flow can
    // even reach. The spend was called exactly once with kind storage.
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.spend.mock.calls[0]).toEqual([
      {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        kind: 'storage',
        expectedCostClaudium: 100,
        idempotencyKey: 'key-5',
      },
    ]);
  });
});

describe('refusals before any money moves', () => {
  it.each([
    { itemId: 'no_such_sku', reason: 'unknown_item' },
    { itemId: 'strongbox_rung_03', reason: 'not_next_rung' },
  ])(
    '$itemId refuses with $reason, writing no row and spending nothing',
    async ({ itemId, reason }) => {
      const h = makeHarness();
      const res = await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId,
        expectedCostClaudium: 100,
        idempotencyKey: 'key-6',
      });
      expect(res).toEqual({ granted: false, balance: null, costClaudium: null, reason });
      expect(h.db.begin).not.toHaveBeenCalled();
      expect(h.spend).not.toHaveBeenCalled();
      expect(h.meta.bank.purchasedSlots).toBe(0);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    },
  );

  it('refuses a charter that no longer fits, whole, with no partial clamp', async () => {
    const h = makeHarness();
    h.meta.bank.purchasedSlots = 66;
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-7',
    });
    expect(res.reason).toBe('does_not_fit');
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.meta.bank.purchasedSlots).toBe(66);
  });

  it('a database failure fails CLOSED as unavailable instead of throwing', async () => {
    const h = makeHarness();
    h.db.begin.mockRejectedValueOnce(new Error('pool exhausted'));
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-db-down',
    });
    // The typed refusal shape, never a rejected promise into the HTTP
    // handler; nothing spent, mutex released, retry-same-key semantics.
    expect(res).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.meta.bank.purchasedSlots).toBe(0);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    expect(h.warn).toHaveBeenCalled();
  });

  it('refuses with no_live_character when the account has no session', async () => {
    const h = makeHarness();
    h.state.live = false;
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-8',
    });
    expect(res.reason).toBe('no_live_character');
    expect(h.db.begin).not.toHaveBeenCalled();
    expect(h.spend).not.toHaveBeenCalled();
  });

  it('a definitive service refusal deletes its row and passes the reason through', async () => {
    const h = makeHarness();
    h.spendResults.push({
      granted: false,
      balance: 40,
      costClaudium: 100,
      reason: 'insufficient_balance',
    });
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-9',
    });
    expect(res.reason).toBe('insufficient_balance');
    expect(res.balance).toBe(40);
    expect(h.db.rows.has('key-9')).toBe(false);
    expect(h.meta.bank.purchasedSlots).toBe(0);
    expect(h.db.releaseSpendClaim).not.toHaveBeenCalled();
    // A later same-key retry is a legitimate fresh attempt: neither the game
    // nor the service retained no-debit history under that key.
    h.spendResults.push(granted());
    const retry = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-9',
    });
    expect(retry.granted).toBe(true);
    expect(h.meta.bank.purchasedSlots).toBe(6);
  });

  it('cross-purchase key reuse refuses as the already_granted conflict without spending', async () => {
    const h = makeHarness();
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-10',
    });
    await waitFor(() => h.db.rows.get('key-10')?.status === 'applied');
    // Same key, different item: the fingerprint no longer matches.
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-10',
    });
    expect(res).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'already_granted',
    });
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.meta.bank.purchasedSlots).toBe(6);
  });
});

describe('the per-character mutex', () => {
  it('refuses a second purchase while the first is in flight, and releases after', async () => {
    const h = makeHarness();
    let resolveSpend!: (v: ClaudiumSpendResult) => void;
    h.spendResults.push(
      () =>
        new Promise<ClaudiumSpendResult>((r) => {
          resolveSpend = r;
        }),
    );
    const first = executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-11',
    });
    await waitFor(() => h.spend.mock.calls.length === 1);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    const second = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_charter_1',
      expectedCostClaudium: 500,
      idempotencyKey: 'key-12',
    });
    expect(second).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'purchase_in_progress',
    });
    // The refused conflicting purchase persisted nothing.
    expect(h.db.rows.has('key-12')).toBe(false);
    resolveSpend(granted());
    const res = await first;
    expect(res.granted).toBe(true);
    expect(h.meta.bank.purchasedSlots).toBe(6);
    // The purchase mutex is released at slot application, so a fresh claudium
    // purchase is admitted immediately; the GOLD rail alone stays shut for the
    // durability chain's ledger-ordering window and reopens after it.
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
  });

  it('a same-key duplicate racing the in-flight original also refuses in progress', async () => {
    const h = makeHarness();
    let resolveSpend!: (v: ClaudiumSpendResult) => void;
    h.spendResults.push(
      () =>
        new Promise<ClaudiumSpendResult>((r) => {
          resolveSpend = r;
        }),
    );
    const first = executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-13',
    });
    await waitFor(() => h.spend.mock.calls.length === 1);
    const dup = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-13',
    });
    expect(dup.reason).toBe('purchase_in_progress');
    resolveSpend(granted());
    await first;
    // One spend, one apply: the duplicate neither double-spent nor
    // double-applied.
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.meta.bank.purchasedSlots).toBe(6);
  });

  it('an overlapping host that finds the same pending key performs zero service I/O', async () => {
    const h = makeHarness();
    const service = deferred<ClaudiumSpendOutcome>();
    h.spendResults.push(() => service.promise);
    const first = executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'cross-host-key',
    });
    await waitFor(() => h.spend.mock.calls.length === 1);

    // Model a second process: its in-memory mutex is empty, but it shares the
    // authoritative database row and claim owned by the first process.
    resetStoragePurchasesForTests();
    const second = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'cross-host-key',
    });
    expect(second.reason).toBe('purchase_in_progress');
    expect(h.spend).toHaveBeenCalledTimes(1);

    service.resolve({ result: granted(), neverReached: false });
    expect((await first).granted).toBe(true);
    await waitFor(() => h.db.rows.get('cross-host-key')?.status === 'applied');
    expect(h.meta.bank.purchasedSlots).toBe(6);
  });
});

describe('the apply-time re-check (defense in depth) and the unresolved surface', () => {
  it('a ladder move landing mid-spend yields no partial grant and an unresolved record', async () => {
    const h = makeHarness();
    h.meta.bank.purchasedSlots = 66;
    // Fits at request time (66 + 6 = 72). The scripted spend simulates the
    // impossible-state interleave (a bug or a restore from backup: the
    // mutex refuses the reachable version of this race) by moving the
    // ladder underneath the purchase before answering granted.
    h.spendResults.push(() => {
      h.meta.bank.purchasedSlots = 72;
      return granted();
    });
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_12',
      expectedCostClaudium: 1200,
      idempotencyKey: 'key-14',
    });
    // Granted stays true (the money moved); the grant did NOT apply, did
    // NOT clamp, and the record survives as unresolved for the operator.
    expect(res.granted).toBe(true);
    expect(res.reason).toBe('grant_unresolved');
    expect(h.meta.bank.purchasedSlots).toBe(72);
    expect(h.meta.bank.appliedStorageKeys).toEqual([]);
    expect(h.db.rows.get('key-14')?.status).toBe('unresolved');
    expect(h.warn).toHaveBeenCalled();
    // A later same-key retry keeps surfacing the unresolved state, never
    // re-spends, and never applies.
    const retry = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_12',
      expectedCostClaudium: 1200,
      idempotencyKey: 'key-14',
    });
    expect(retry.reason).toBe('grant_unresolved');
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
  });

  it('an unresolved sibling blocks a different key before any service call', async () => {
    const h = makeHarness();
    h.db.rows.set('operator-case', {
      id: 99,
      realm: h.host.realm,
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'operator-case',
      status: 'unresolved',
      resolvedAt: 1,
      spendClaimToken: null,
    });

    const result = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'must-not-spend',
    });

    expect(result.reason).toBe('purchase_in_progress');
    expect(h.db.begin).toHaveBeenCalledOnce();
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.db.rows.has('must-not-spend')).toBe(false);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
  });

  it('login discovery keeps unresolved closed and a later support clear plus relog reopens it', async () => {
    const h = makeHarness();
    h.db.rows.set('login-operator-case', {
      id: 100,
      realm: h.host.realm,
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'login-operator-case',
      status: 'unresolved',
      resolvedAt: 1,
      spendClaimToken: null,
    });
    configureStoragePurchaseRuntime(() => h.host);

    expect(kickStoragePurchaseRecovery(CHARACTER)).toBe(true);
    await waitFor(
      () => h.db.openFor.mock.calls.length === 1 && storagePurchaseRecoveryMetrics().tracked === 0,
    );
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    expect(h.spend).not.toHaveBeenCalled();

    storagePurchaseCharacterOffline(CHARACTER);
    h.db.rows.delete('login-operator-case');
    expect(kickStoragePurchaseRecovery(CHARACTER)).toBe(true);
    await waitFor(
      () => h.db.openFor.mock.calls.length === 2 && storagePurchaseRecoveryMetrics().tracked === 0,
    );
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
  });

  it('a session dropping between spend and apply defers to the next login, then applies once', async () => {
    const h = makeHarness();
    // The character logs out while the spend is in flight.
    h.spendResults.push(() => {
      h.state.live = false;
      return granted();
    });
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-15',
    });
    expect(res.granted).toBe(true);
    expect(res.reason).toBe('apply_deferred');
    expect(h.meta.bank.purchasedSlots).toBe(0);
    expect(h.db.rows.get('key-15')?.status).toBe('pending');
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    // Next login: the recovery replays the same key and applies exactly once.
    h.state.live = true;
    h.spendResults.push(granted({ reason: 'already_granted' }));
    await resumeStoragePurchasesAtLogin(h.host, CHARACTER);
    expect(h.meta.bank.purchasedSlots).toBe(6);
    await waitFor(() => h.db.rows.get('key-15')?.status === 'applied');
  });
});

describe('login recovery', () => {
  it('a pending row whose key is already in the loaded blob settles without a service call', async () => {
    const h = makeHarness();
    // The apply landed and saved, but the settle was lost (crash after
    // save, before the row update): state carries the key, row pending.
    bankGrantStorageSlots(h.sim.ctx, h.sim.playerId, 'strongbox_rung_01', 'key-16');
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-16',
    });
    await resumeStoragePurchasesAtLogin(h.host, CHARACTER);
    await waitFor(() => h.db.rows.get('key-16')?.status === 'applied');
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
  });

  it('an ambiguous recovery keeps the mutex with the background task until definitive', async () => {
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-17',
    });
    h.spendResults.push(unavailable(), unavailable(), granted());
    await resumeStoragePurchasesAtLogin(h.host, CHARACTER);
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
    expect(h.meta.bank.purchasedSlots).toBe(6);
    await waitFor(() => h.db.rows.get('key-17')?.status === 'applied');
    expect(h.spend).toHaveBeenCalledTimes(3);
    expect(h.db.claimSpend).toHaveBeenCalledTimes(3);
    // Claim acquisition is the pre-service lease; there is exactly one
    // post-service revalidation, not a redundant UPDATE immediately before IO.
    expect(h.db.renewSpendClaim).toHaveBeenCalledTimes(3);
    expect(h.db.releaseSpendClaim).toHaveBeenCalledTimes(2);
  });

  it('the kick closes the gold rail SYNCHRONOUSLY, before the scan answers', async () => {
    const h = makeHarness();
    let resolvePending!: (row: FakeRow | null) => void;
    h.db.openFor.mockImplementationOnce(
      () =>
        new Promise<FakeRow | null>((r) => {
          resolvePending = r;
        }),
    );
    configureStoragePurchaseRuntime(() => h.host);
    kickStoragePurchaseRecovery(CHARACTER);
    // The post-restart re-arm window: the provisional hold is up before the
    // pending-row scan's round-trip resolves, so a gold bank_buy_slots
    // racing the login kick is refused instead of interleaving a debited,
    // unapplied purchase.
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    resolvePending(null);
    await waitFor(() => storagePurchaseInFlight(CHARACTER) === false);
  });

  it('a kick with a pending row converges it, then releases the hold', async () => {
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-kick',
    });
    h.spendResults.push(granted({ reason: 'already_granted' }));
    configureStoragePurchaseRuntime(() => h.host);
    kickStoragePurchaseRecovery(CHARACTER);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    await waitFor(() => h.db.rows.get('key-kick')?.status === 'applied');
    expect(h.meta.bank.purchasedSlots).toBe(6);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
  });

  it('never spends a second key while a same-SKU pending row owns the character', async () => {
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'older-pending',
    });

    const result = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'new-key-same-sku',
    });
    expect(result.reason).toBe('purchase_in_progress');
    expect(h.spend).not.toHaveBeenCalled();
    expect([...h.db.rows.keys()]).toEqual(['older-pending']);
  });

  it('a stale never-reached reply cannot delete after another process takes the claim', async () => {
    const h = makeHarness();
    const response = deferred<ClaudiumSpendOutcome>();
    h.spendResults.push(() => response.promise);
    const purchase = executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'stale-never-reached',
    });
    await waitFor(() => h.spend.mock.calls.length === 1);
    const pending = h.db.rows.get('stale-never-reached');
    if (!pending) throw new Error('pending row was not inserted before spend');
    pending.spendClaimToken = '00000000-0000-4000-8000-000000000099';
    response.resolve(neverReached());

    expect((await purchase).reason).toBe('unavailable');
    expect(h.db.discardWithoutDebit).not.toHaveBeenCalled();
    expect(h.db.rows.get('stale-never-reached')?.status).toBe('pending');
  });

  it('a stale granted reply cannot mutate or stage after another process takes the claim', async () => {
    const h = makeHarness();
    const response = deferred<ClaudiumSpendOutcome>();
    h.spendResults.push(() => response.promise);
    const purchase = executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'stale-granted',
    });
    await waitFor(() => h.spend.mock.calls.length === 1);
    const pending = h.db.rows.get('stale-granted');
    if (!pending) throw new Error('pending row was not inserted before spend');
    pending.spendClaimToken = '00000000-0000-4000-8000-000000000098';
    response.resolve({ result: granted(), neverReached: false });

    expect((await purchase).reason).toBe('unavailable');
    expect(h.meta.bank.purchasedSlots).toBe(0);
    expect(h.stageAppliedEffect).not.toHaveBeenCalled();
    expect(h.db.rows.get('stale-granted')?.status).toBe('pending');
  });

  it('a QUEUED kick holds the gold rail for its whole wait, not just its scan', async () => {
    // The RESIDUAL exposure after phase 14, kept observable. The gate now
    // holds only the SCAN (the sibling storm suite pins that row work no
    // longer queues anyone), so this arm is deliberately built out of scans
    // that never answer: a character whose kick is still queued behind two
    // WEDGED scans is refused a GOLD bank_buy_slots although it has no
    // purchase at all. That remainder is covered by the stuck-promise
    // backstop in server/storage_ladder_hold.ts, which is a bound on a bug
    // rather than a policy, and the arm below runs well inside it.
    const h = makeHarness();
    // Two slow scans occupy every slot in the bounded coordinator.
    const release: (() => void)[] = [];
    h.db.openFor.mockImplementation(
      () =>
        new Promise<FakeRow | null>((r) => {
          release.push(() => r(null));
        }),
    );
    configureStoragePurchaseRuntime(() => h.host);
    const BLOCKERS = [901, 902];
    for (const id of BLOCKERS) kickStoragePurchaseRecovery(id);
    await waitFor(() => release.length === 2);

    // The third character joins. Its kick can only QUEUE, so its scan has not
    // started, yet its rail is already closed.
    kickStoragePurchaseRecovery(903);
    expect(release.length).toBe(2);
    expect(storagePurchaseInFlight(903)).toBe(true);

    // Draining one slot is not enough to reach it either: strictly FIFO.
    release[0]();
    await waitFor(() => release.length === 3);
    // Now its scan runs; once it answers, the rail reopens.
    release[2]();
    await waitFor(() => storagePurchaseInFlight(903) === false);

    for (const r of release.slice(1, 2)) r();
    await waitFor(() => BLOCKERS.every((id) => storagePurchaseInFlight(id) === false));
  }, 20_000);

  it('keeps both purchase rails blocked and retries in-session at the recovery cap', async () => {
    const h = makeHarness();
    h.db.openFor.mockImplementation(() => new Promise<FakeRow | null>(() => {}));
    configureStoragePurchaseRuntime(() => h.host);
    for (let offset = 0; offset < STORAGE_RECOVERY_MAX_TRACKED; offset++) {
      kickStoragePurchaseRecovery(10_000 + offset);
    }

    // The 5,001st live character is not retained by the coordinator. Its
    // session-owned bit is the bounded-overflow lane and independently guards
    // gold until the game loop can re-admit its scan.
    expect(kickStoragePurchaseRecovery(CHARACTER)).toBe(false);
    expect(h.state.recoveryAdmissionPending).toBe(true);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
    const paid = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'overflow-paid',
    });
    expect(paid.reason).toBe('purchase_in_progress');
    expect(h.db.begin).not.toHaveBeenCalled();
    expect(h.spend).not.toHaveBeenCalled();

    // A final-session teardown creates one exact O(1) eviction candidate. The
    // next bounded sweep attempt admits this live key and transfers protection
    // back to the ordinary recovery-scan hold.
    const victim = 10_002;
    h.state.offlineCharacters.add(victim);
    storagePurchaseCharacterOffline(victim);
    expect(kickStoragePurchaseRecovery(CHARACTER)).toBe(true);
    expect(h.state.recoveryAdmissionPending).toBe(false);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
  });

  it('recovery for an offline character leaves the row pending and takes nothing', async () => {
    const h = makeHarness();
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'key-18',
    });
    h.state.live = false;
    await resumeStoragePurchasesAtLogin(h.host, CHARACTER);
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.db.rows.get('key-18')?.status).toBe('pending');
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
  });
});

describe('phase 14: the gold rail survives the Claudium machinery', () => {
  // The gold rail reads the hold through storagePurchaseInFlight; these arms
  // drive the REAL flow and read that predicate, so they fail if the reservation
  // is taken for too long OR released too early. Every yield has its blocking
  // twin beside it.

  it('an outage press that never reached the service deletes its row and reserves nothing', async () => {
    // RULING 27, the reproduction. The economy service is down, the price cache
    // is still quoting, so the Claudium rail is on the button; pressing it must
    // not cost the player their GOLD rung.
    const h = makeHarness();
    h.spendResults.push(neverReached());
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'outage-1',
    });
    expect(res).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });
    // No debit was possible, so the operational row leaves no history...
    expect(h.db.rows.has('outage-1')).toBe(false);
    // ... nothing is holding the ladder ...
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    // ... and no slots were granted on the way through.
    expect(h.meta.bank.purchasedSlots).toBe(0);
    expect(h.meta.bank.appliedStorageKeys).toEqual([]);
  });

  it('a stalled ledger-ordering hold and a lapsed ladder hold do not flood together', async () => {
    // The two warnings used to share ONE map with mutually exclusive
    // token shapes, and storagePurchaseInFlight can reach both arms in a single
    // call, so each overwrote the other's token and every later dedupe check
    // missed. A character in both states then emitted TWO synchronous warns per
    // gold press, on the thread that runs the world loop.
    const h = makeHarness();
    h.state.saveResult = new Promise<boolean>(() => {});
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'flood-ledger',
    });
    // A second purchase leaves an ambiguous LADDER hold beside the wedged
    // ledger-ordering window opened by the first.
    h.spendResults.push(unavailable());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_02',
      expectedCostClaudium: 100,
      idempotencyKey: 'flood-ladder',
    });

    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      clock.mockReturnValue(now + AMBIGUITY_HOLD_MAX_MS + 5_000);
      for (let i = 0; i < 20; i++) storagePurchaseInFlight(CHARACTER);
      const ladder = warns.mock.calls.filter((c) => String(c[0]).includes('ambiguous purchase'));
      const ordering = warns.mock.calls.filter((c) =>
        String(c[0]).includes('paid storage effect flood-ledger'),
      );
      expect(ladder.length).toBeLessThanOrEqual(1);
      expect(ordering.length).toBeLessThanOrEqual(1);
    } finally {
      warns.mockRestore();
      clock.mockRestore();
    }
  });

  it('a stalled ledger-ordering window warns ONCE and remains closed', async () => {
    // storagePurchaseInFlight runs on every gold bank_buy_slots command, which
    // a player drives by holding the buy button, on the thread that also runs
    // the 20 Hz world loop. A wedged save leaves the window permanently past
    // its bound, so an undeduped warn here is a player-triggerable log flood.
    const h = makeHarness();
    h.state.saveResult = new Promise<boolean>(() => {});
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'wedged-save',
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      clock.mockReturnValue(now + WEDGED_HOLD_MAX_MS + 1_000);
      for (let i = 0; i < 25; i++) expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      const ordering = warns.mock.calls.filter((c) =>
        String(c[0]).includes('paid storage effect wedged-save'),
      );
      expect(ordering).toHaveLength(1);
    } finally {
      warns.mockRestore();
      clock.mockRestore();
    }
  });

  it('final-session teardown clears a paid-save stall and warning before relogged gold', async () => {
    const h = makeHarness();
    h.state.saveResult = new Promise<boolean>(() => {});
    const start = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      h.spendResults.push(granted());
      await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'offline-stall-1',
      });
      clock.mockReturnValue(start + WEDGED_HOLD_MAX_MS + 1);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      expect(
        warns.mock.calls.filter((call) =>
          String(call[0]).includes('paid storage effect offline-stall-1'),
        ),
      ).toHaveLength(1);

      // A different save made the paid row durable, but the request-owned
      // promise never delivered its process-local acknowledgement.
      h.commitStaged(snapshotStorageAppliedEffects(h.stagedEffects));
      expect(h.db.rows.get('offline-stall-1')?.status).toBe('applied');
      h.state.live = false;
      h.state.offlineCharacters.add(CHARACTER);
      storagePurchaseCharacterOffline(CHARACTER);

      // Do not read the gold guard yet: the next incident must prove teardown
      // itself forgot the old warning token, rather than that a later empty
      // guard read cleaned it up.
      h.state.live = true;
      h.state.offlineCharacters.delete(CHARACTER);
      const relogStart = Date.now();
      h.spendResults.push(granted());
      const relogPurchase = await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_02',
        expectedCostClaudium: 100,
        idempotencyKey: 'offline-stall-2',
      });
      expect(relogPurchase.granted).toBe(true);
      clock.mockReturnValue(relogStart + WEDGED_HOLD_MAX_MS + 1);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      const orderingWarnings = warns.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('paid storage effect offline-stall-'));
      expect(orderingWarnings).toHaveLength(2);
      expect(orderingWarnings[0]).toContain('offline-stall-1');
      expect(orderingWarnings[1]).toContain('offline-stall-2');

      // The exact predicate bank_wire checks before every gold slot purchase
      // must reopen on the next final-session teardown too.
      h.commitStaged(snapshotStorageAppliedEffects(h.stagedEffects));
      h.state.live = false;
      storagePurchaseCharacterOffline(CHARACTER);
      h.state.live = true;
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    } finally {
      warns.mockRestore();
      clock.mockRestore();
    }
  });

  it('a wedge yield does not silence the settling yield that follows it under the same key', async () => {
    // ONE purchase key legitimately yields twice with different meanings: the
    // request itself can wedge (a bound on a bug), and after the ambiguity
    // handoff the SAME key yields again as 'settling' (a bound on money that
    // may have moved). Keyed on the key alone the first message suppressed the
    // second, which is the one that says a gold rung may now land on a live
    // debit. The dedupe token therefore carries the reason as well.
    const h = makeHarness();
    let releaseSpend: ((v: ClaudiumSpendOutcome) => void) | undefined;
    h.spendResults.push(
      () =>
        new Promise<ClaudiumSpendOutcome>((resolve) => {
          releaseSpend = resolve;
        }),
    );
    const armed = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'two-yields',
      });
      await waitFor(() => releaseSpend !== undefined);

      // The request is still in flight and has outlived the backstop: a WEDGE
      // yield, logged against key 'two-yields'.
      clock.mockReturnValue(armed + WEDGED_HOLD_MAX_MS + 1_000);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
      expect(
        warns.mock.calls.filter((c) => String(c[0]).includes('WEDGED purchase hold')),
      ).toHaveLength(1);

      // The spend now answers ambiguously, so the SAME key is retagged
      // 'settling' with a fresh clock and a different claim.
      releaseSpend?.({ result: unavailable(), neverReached: false });
      await pending;
      const handoff = armed + WEDGED_HOLD_MAX_MS + 1_000;
      clock.mockReturnValue(handoff + AMBIGUITY_HOLD_MAX_MS + 1_000);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
      // The message that matters must NOT have been swallowed by the wedge one.
      expect(
        warns.mock.calls.filter((c) => String(c[0]).includes('ambiguous purchase')),
      ).toHaveLength(1);
    } finally {
      warns.mockRestore();
      clock.mockRestore();
    }
  });

  it('a SECOND press during the same outage still leaves no row and holds nothing', async () => {
    // The phase's goal is that a character's GOLD rung keeps working through a
    // service outage. Pressing an unresponsive button twice is the most
    // ordinary input there is, and the client is documented to retry the SAME
    // key on 'unavailable'. Each press creates its recoverability row before
    // spend and deletes it only after proving this attempt never reached the
    // service.
    const h = makeHarness();
    h.spendResults.push(neverReached(), neverReached());
    const press = {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'outage-twice',
    };
    await executeStoragePurchase(h.host, press);
    expect(h.db.rows.has('outage-twice')).toBe(false);
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);

    const second = await executeStoragePurchase(h.host, press);
    expect(second.reason).toBe('unavailable');
    // Reinserted, spent, provably never reached, deleted again ...
    expect(h.db.rows.has('outage-twice')).toBe(false);
    // ... and the gold rail is STILL free, with no ten-minute settling hold.
    expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    expect(h.meta.bank.purchasedSlots).toBe(0);
  });

  it('a never-reached press whose settle write FAILS leaves a driver behind', async () => {
    // The one exit that used to release the mutex over an open row with nothing
    // arranged to revisit it. The delete fails on exactly the infrastructure
    // trouble that accompanies an economy outage, and the row then sits pending
    // with the gold rail open until the character's next login.
    const h = makeHarness();
    h.spendResults.push(neverReached());
    const kicked: number[] = [];
    configureStoragePurchaseRuntime(() => {
      kicked.push(CHARACTER);
      throw new Error('runtime unavailable in this arm');
    });
    h.db.discardWithoutDebit.mockRejectedValue(new Error('pool exhausted'));
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'outage-settle-fails',
    });
    expect(res.reason).toBe('unavailable');
    // The recovery kick is what proves a driver was arranged: it reads the
    // runtime host factory, which this arm counts.
    expect(kicked.length).toBeGreaterThan(0);
  });

  it('a never-reached press whose delete cannot be confirmed arranges a driver', async () => {
    // A false DELETE result cannot prove why the row was absent or changed.
    // Fail closed exactly like a thrown write and let recovery re-read truth.
    const h = makeHarness();
    h.spendResults.push(neverReached());
    const kicked: number[] = [];
    configureStoragePurchaseRuntime(() => {
      kicked.push(CHARACTER);
      throw new Error('runtime unavailable in this arm');
    });
    h.db.discardWithoutDebit.mockResolvedValue(false);
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'outage-already-settled',
    });
    expect(res.reason).toBe('unavailable');
    expect(kicked.length).toBeGreaterThan(0);
  });

  it('a REACHED ambiguous outcome still reserves the ladder: the arm that must not yield', async () => {
    // The negative twin of the case above, and the one that keeps the money
    // guarantee: a timeout or a 5xx may be sitting on top of a live debit, so
    // the reservation stands and the row stays open for the retry.
    const h = makeHarness();
    h.spendResults.push(unavailable());
    const res = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'ambiguous-1',
    });
    expect(res.reason).toBe('unavailable');
    expect(h.db.rows.get('ambiguous-1')?.status).toBe('pending');
    expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
  });

  it('one ambiguous attempt poisons the key: a later never-reached retry cannot settle it', async () => {
    // The transport fact covers the request that carried it and nothing else.
    // A row that already exists may have been created by an attempt that
    // reached the service, so answering its retry with a definitive refusal is
    // exactly the mis-settle over a live debit the classifier exists to stop.
    const h = makeHarness();
    h.spendResults.push(unavailable());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'poisoned',
    });
    expect(h.db.rows.get('poisoned')?.status).toBe('pending');
    // The client retries the SAME key while the first attempt still holds. The
    // mutex answers first, so no second row and no second spend.
    const retry = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'poisoned',
    });
    expect(retry.reason).toBe('purchase_in_progress');
    expect(h.db.rows.get('poisoned')?.status).toBe('pending');
    expect(h.spend).toHaveBeenCalledTimes(1);

    // Once the holder has gone (a process that dropped the in-memory hold), a
    // request still cannot become a second cross-process spender. It re-kicks
    // recovery, whose DB claim serializes the same-key service retry.
    resetStoragePurchasesForTests();
    h.spendResults.push(neverReached());
    const later = await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'poisoned',
    });
    expect(later.reason).toBe('purchase_in_progress');
    expect(h.db.rows.get('poisoned')?.status).toBe('pending');
    expect(h.spend).toHaveBeenCalledTimes(1);
  });

  it('an ambiguous hold yields the GOLD rail at its bound, and still refuses a new Claudium buy', async () => {
    const h = makeHarness();
    const clock = vi.spyOn(Date, 'now');
    const start = 1_700_000_000_000;
    clock.mockReturnValue(start);
    try {
      h.spendResults.push(unavailable());
      await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'yield-1',
      });
      // Held while the service might still answer.
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      clock.mockReturnValue(start + AMBIGUITY_HOLD_MAX_MS - 1);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      // At the bound the Claudium price has aged off the button, so holding the
      // GOLD rail to protect a rail that is offline stops making sense.
      clock.mockReturnValue(start + AMBIGUITY_HOLD_MAX_MS);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);

      // THE YIELD OPENS THE GOLD RAIL, NOT THE CLAUDIUM RAIL. A new purchase is
      // still refused, so the per-character pending-row count cannot grow
      // through an outage.
      const second = await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'yield-2',
      });
      expect(second.reason).toBe('purchase_in_progress');
      expect(h.db.rows.has('yield-2')).toBe(false);
      expect(h.spend).toHaveBeenCalledTimes(1);
      // The open row is untouched: only the reservation lapsed, not the record.
      expect(h.db.rows.get('yield-1')?.status).toBe('pending');
    } finally {
      clock.mockRestore();
    }
  });

  it('the hold clock restarts at the spend, so slow database work cannot lapse it early', async () => {
    // The review round's arithmetic: the pre-spend path is two to four database
    // round trips, each able to cost the pool's connect timeout plus its
    // statement timeout, so on a degraded database that sum can exceed the
    // stuck-promise backstop. A hold taken only at the start would lapse WHILE
    // the spend was still to come, opening the gold rail on top of money about
    // to move. This drives that shape: the database work eats the whole
    // backstop, and the rail must still be shut when the spend runs.
    const h = makeHarness();
    const clock = vi.spyOn(Date, 'now');
    const start = 1_700_000_000_000;
    clock.mockReturnValue(start);
    let railAtSpend: boolean | null = null;
    try {
      // Every database read advances the clock past the backstop.
      h.db.byKey.mockImplementationOnce(async () => {
        clock.mockReturnValue(start + WEDGED_HOLD_MAX_MS * 2);
        return null;
      });
      h.spendResults.push(() => {
        railAtSpend = storagePurchaseInFlight(CHARACTER);
        return granted();
      });
      await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'slow-db',
      });
      expect(railAtSpend).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps the ledger-ordering rail closed past a full save deadline until exact commit', async () => {
    const h = makeHarness();
    h.state.saveResult = new Promise<boolean>(() => {});
    const clock = vi.spyOn(Date, 'now');
    const start = 1_700_000_000_000;
    clock.mockReturnValue(start);
    try {
      h.spendResults.push(granted());
      await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'wedged-save',
      });
      // The apply landed; the audit row is waiting on a save that never comes.
      expect(h.meta.bank.purchasedSlots).toBe(6);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      clock.mockReturnValue(start + WEDGED_HOLD_MAX_MS - 1);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      clock.mockReturnValue(start + WEDGED_HOLD_MAX_MS);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);
      clock.mockReturnValue(start + WEDGED_HOLD_MAX_MS * 10);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);

      // A different queued save may commit the staged prefix before the
      // request-owned promise settles. Only that exact acknowledgement reopens
      // gold; age alone never does.
      storageAppliedEffectsCommitted(CHARACTER, [{ idempotencyKey: 'wedged-save' }]);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('blocks the real gold dispatch without state or ledger mutation until the paid row commits', async () => {
    const h = makeHarness();
    h.state.saveResult = new Promise<boolean>(() => {});
    h.spendResults.push(granted());
    await executeStoragePurchase(h.host, {
      accountId: ACCOUNT,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'dispatch-ordering',
    });
    expect(h.meta.bank.purchasedSlots).toBe(6);

    let purchasedSlots = 6;
    let copper = 5_000;
    let goldMutations = 0;
    const errors: string[] = [];
    const bankInfo = () => ({
      slots: [],
      capacity: 24 + purchasedSlots,
      purchasedSlots,
      bonusSlots: 0,
      nextExpansionCost: purchasedSlots === 6 ? 1_000 : 2_000,
      bonusSources: [],
      socketsUnlocked: 0,
      socketBags: [null, null, null],
      nextSocketCost: 1_000_000,
      generalCapacity: 24 + purchasedSlots,
      materialsCapacity: 0,
      generalUsed: 0,
      materialsUsed: 0,
    });
    const bank: BankSim = {
      ctx: {
        resolve: () => ({ meta: { entityId: 99, bank: { purchasedSlots } } }),
        error: (_entityId, text) => errors.push(text),
      },
      bankInfoFor: bankInfo,
      bankBuySlots: () => {
        goldMutations++;
        copper -= 1_000;
        purchasedSlots += 6;
      },
      bankDeposit: vi.fn(),
      bankWithdraw: vi.fn(),
      bankUnlockSocket: vi.fn(),
      bankSocketBag: vi.fn(),
      bankUnsocketBag: vi.fn(),
    };
    const journal = createBankLedgerSessionJournal(
      { realm: REALM, characterId: CHARACTER, accountId: ACCOUNT },
      { onProjectionFailure: vi.fn() },
    );
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_700_000_000_000 + WEDGED_HOLD_MAX_MS * 10);
    try {
      dispatchBankCommand(
        bank,
        { characterId: CHARACTER, accountId: ACCOUNT },
        'bank_buy_slots',
        {},
        1,
        journal.admission,
      );
      expect(errors).toEqual(['Your bank has a purchase in progress.']);
      expect({ goldMutations, copper, purchasedSlots }).toEqual({
        goldMutations: 0,
        copper: 5_000,
        purchasedSlots: 6,
      });
      expect(journal.outbox.snapshot().rowCount).toBe(0);

      storageAppliedEffectsCommitted(CHARACTER, [{ idempotencyKey: 'dispatch-ordering' }]);
      dispatchBankCommand(
        bank,
        { characterId: CHARACTER, accountId: ACCOUNT },
        'bank_buy_slots',
        {},
        1,
        journal.admission,
      );
      expect({ goldMutations, copper, purchasedSlots }).toEqual({
        goldMutations: 1,
        copper: 4_000,
        purchasedSlots: 12,
      });
      expect(journal.outbox.snapshot().rowCount).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
});

// PR #3670: final-session teardown must release the LADDER hold whatever its
// reason (a recovery-drive hold is POSITIVE_INFINITY-bounded and unreachable
// by evictLapsedRecoveryHold, so a coordinator path dropping it without a
// finish shut the character's gold rail forever), and the saturated-coordinator
// sweep lane must not rebuild a host object 40 times a second.
describe('offline hold release and sweep-kick throttling', () => {
  it('final-session teardown releases a recovery-drive hold that nothing else can reach', async () => {
    const h = makeHarness();
    // A durable pending row whose recovery drive parks BEFORE the service
    // call: db.claimSpend hangs, so the hold keeps its non-yielding
    // 'recovery-drive' reason (POSITIVE_INFINITY bound, keyed by the row's
    // idempotency key, out of evictLapsedRecoveryHold's reach). The 'purchase'
    // retag happens only at the spend, which is never reached.
    await h.db.begin({
      realm: 'testrealm',
      accountId: ACCOUNT,
      characterId: CHARACTER,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'drive-hold-leak',
    });
    h.db.claimSpend.mockImplementation(() => new Promise<boolean>(() => {}));
    configureStoragePurchaseRuntime(() => h.host);
    kickStoragePurchaseRecovery(CHARACTER);
    await waitFor(() => h.db.claimSpend.mock.calls.length === 1);

    const base = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      // Only the drive hold still refuses gold arbitrarily far past every
      // other bound.
      clock.mockReturnValue(base + WEDGED_HOLD_MAX_MS * 100);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(true);

      h.state.live = false;
      h.state.offlineCharacters.add(CHARACTER);
      storagePurchaseCharacterOffline(CHARACTER);
      // With no live session there is no gold command to guard, and the next
      // join's ws_auth covenant re-arms a hold synchronously before the first
      // command (tests/server/ws_auth_login_covenant.test.ts): the hold and
      // its Map entry must not outlive the character.
      clock.mockReturnValue(base + WEDGED_HOLD_MAX_MS * 100);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('final-session teardown forgets the yield latch so the next incident logs again', async () => {
    const h = makeHarness();
    h.spendResults.push({ result: unavailable(), neverReached: false });
    const armed = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      clock.mockReturnValue(armed);
      await executeStoragePurchase(h.host, {
        accountId: ACCOUNT,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'latch-1',
      });
      // The ambiguity handoff holds 'settling'; past its bound it yields once.
      clock.mockReturnValue(armed + AMBIGUITY_HOLD_MAX_MS + 1_000);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
      const yields = () =>
        warns.mock.calls.filter((c) => String(c[0]).includes('ambiguous purchase latch-1'));
      expect(yields()).toHaveLength(1);

      // Teardown, then the next login's recovery drives the SAME row to the
      // SAME ambiguous handoff: an identical (reason, key) incident. Without
      // the offline clear the process-lifetime token swallows its warning.
      h.state.live = false;
      h.state.offlineCharacters.add(CHARACTER);
      storagePurchaseCharacterOffline(CHARACTER);
      h.state.live = true;
      h.state.offlineCharacters.delete(CHARACTER);

      h.spendResults.push({ result: unavailable(), neverReached: false });
      configureStoragePurchaseRuntime(() => h.host);
      const relog = Date.now();
      clock.mockReturnValue(relog);
      kickStoragePurchaseRecovery(CHARACTER);
      await waitFor(() => h.spend.mock.calls.length === 2);
      await waitFor(() => storagePurchaseInFlight(CHARACTER) === true);
      clock.mockReturnValue(relog + AMBIGUITY_HOLD_MAX_MS + WEDGED_HOLD_MAX_MS + 2_000);
      expect(storagePurchaseInFlight(CHARACTER)).toBe(false);
      expect(yields()).toHaveLength(2);
    } finally {
      warns.mockRestore();
      clock.mockRestore();
    }
  });

  it('sweep-driven kicks build at most one host per second per character while saturated', () => {
    const h = makeHarness();
    // Scans that never answer keep every coordinator slot occupied.
    h.db.openFor.mockImplementation(() => new Promise<FakeRow | null>(() => {}));
    let constructions = 0;
    configureStoragePurchaseRuntime(() => {
      constructions++;
      return h.host;
    });
    for (let offset = 0; offset < STORAGE_RECOVERY_MAX_TRACKED; offset++) {
      kickStoragePurchaseRecovery(30_000 + offset);
    }
    const base = constructions;

    const start = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      // First sweep attempt: one host construction, admission fails, pending set.
      expect(kickStoragePurchaseRecovery(CHARACTER, { viaSweep: true })).toBe(false);
      expect(constructions).toBe(base + 1);
      // A restart-storm second of sweep re-entries: ZERO further constructions.
      for (let i = 0; i < 39; i++) {
        expect(kickStoragePurchaseRecovery(CHARACTER, { viaSweep: true })).toBe(false);
      }
      expect(constructions).toBe(base + 1);
      // The stamp lapses after SWEEP_KICK_RETRY_MS: exactly one more attempt.
      clock.mockReturnValue(start + SWEEP_KICK_RETRY_MS);
      expect(kickStoragePurchaseRecovery(CHARACTER, { viaSweep: true })).toBe(false);
      expect(constructions).toBe(base + 2);
      // A login/settle kick bypasses the stamp entirely.
      expect(kickStoragePurchaseRecovery(CHARACTER)).toBe(false);
      expect(constructions).toBe(base + 3);
    } finally {
      clock.mockRestore();
    }
  });
});
