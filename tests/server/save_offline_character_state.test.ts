// The lease-fenced OFFLINE save (server/db.ts saveOfflineCharacterState), the
// phase 13 QA closure of the clear-item-name reconnect window: exercised
// through the REAL db function over a mocked pg pool (the
// tests/character_blob_size.test.ts idiom), so the fence predicate, the
// rowCount mapping, and the shared chokepoints (the zone-1 sanitize, the heavy
// statement allowance) are all the production path's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { DB_HEAVY_STATEMENT_TIMEOUT_MS, saveOfflineCharacterState } from '../../server/db';
import {
  applyOfflineCharacterSaveBounds,
  OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS,
  OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS,
  OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS,
} from '../../server/offline_character_save_db';
import { type CharacterState, Sim } from '../../src/sim/sim';

function realCharacterState(): CharacterState {
  const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: true });
  const state = sim.serializeCharacter(sim.playerId);
  if (!state) throw new Error('serializeCharacter returned null for the primary player');
  return state;
}

// The one answer stands in for every statement, so it carries the material
// source PRE-IMAGE columns this writer's own FOR UPDATE lock reads: a character
// holding neither container. A row that answered NOTHING is refused by the
// journal rather than read as an empty bank.
function transactionClient(rowCount: number) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockResolvedValue({
    rows: [{ before_bank: null, before_vault: null }],
    rowCount,
  } as never);
  return client;
}

function characterUpdateCall(client: ReturnType<typeof transactionClient>) {
  return client.query.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes('UPDATE characters'),
  );
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  dbMock.connect.mockReset();
  dbMock.query.mockReset();
});

describe('saveOfflineCharacterState: fenced on the absence of a live lease', () => {
  it('lands when no live lease exists and reports true', async () => {
    const client = transactionClient(1);
    dbMock.connect.mockResolvedValue(client as never);
    const state = realCharacterState();

    expect(await saveOfflineCharacterState(41, 12, state)).toBe(true);

    const call = characterUpdateCall(client);
    if (!call) throw new Error('no UPDATE characters statement was issued');
    const text = call[0] as string;
    // The unleased fence, not the nonce fence and not the bare write.
    expect(text).toContain('AND NOT EXISTS (');
    expect(text).toContain('SELECT 1 FROM character_leases');
    expect(text).toContain('WHERE character_id = $1 AND expires_at > now()');
    expect(text).not.toContain('holder');
    const values = call[1] as unknown[];
    expect(values[0]).toBe(41);
    expect(values[1]).toBe(12);
    // The persisted blob is the sanitized state, whole (the shared save chokepoint).
    expect((JSON.parse(values[2] as string) as CharacterState).level).toBe(state.level);
  });

  it('bounds the lock wait and the idle hold, not just the statement (the B1 arm)', async () => {
    // The Phase 18 database review's BLOCK finding. This write replaced one
    // that ran through beginCharacterSaveTx, which sets statement_timeout AND
    // lock_timeout 2s AND idle_in_transaction_session_timeout 10s; the
    // replacement kept only the statement bound, so a CONTENDED fence UPDATE
    // (a live save holding the row) waited the whole statement allowance
    // instead of failing fast at two seconds, with a pooled client pinned for
    // the duration and an operator watching a spinner. All three bounds are
    // pinned here by their exact SET LOCAL text, and by literal below, so
    // dropping one reds. The real-Postgres proof that the lock bound actually
    // FIRES at ~2s rides
    // tests/character_save_statement_pg_integration.test.ts.
    const client = transactionClient(1);
    dbMock.connect.mockResolvedValue(client as never);

    await saveOfflineCharacterState(41, 12, realCharacterState());

    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    // A single-row UPDATE's own allowance, NOT the 60s heavy-read tier the
    // aggregates and the multi-statement live saves need.
    expect(statements[1]).toBe('SET LOCAL statement_timeout = 5000');
    expect(statements[2]).toBe('SET LOCAL lock_timeout = 2000');
    expect(statements[3]).toBe('SET LOCAL idle_in_transaction_session_timeout = 10000');
    // The row lock comes BEFORE the fenced write, and in the stronger mode
    // (the Phase 18 QA fix round; see below). Its projection is the material
    // source pre-image: this writer REPLACES the blob, so the state it
    // overwrites is the before-state its journal replays from, read under the
    // lock it already takes rather than as a second statement.
    expect(statements[4]).toBe(
      "SELECT state->'bank' AS before_bank, state->'vault' AS before_vault FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE",
    );
    // Every bound is set BEFORE the write it bounds.
    const update = statements.findIndex((text) => text.includes('UPDATE characters'));
    expect(update).toBe(5);
    expect(statements).toContain('COMMIT');
    // The constants, and their relations: the statement bound must exceed the
    // lock bound (or a contended wait could never report itself as a lock
    // timeout), and must sit well under the heavy tier it no longer uses.
    expect(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS).toBe(5_000);
    expect(OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS).toBe(2_000);
    expect(OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS).toBe(10_000);
    expect(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS).toBeGreaterThan(
      OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS,
    );
    expect(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS).toBeLessThan(DB_HEAVY_STATEMENT_TIMEOUT_MS);
  });

  it('takes the characters row lock BEFORE the fence, in FOR UPDATE (the write-loss fix)', async () => {
    // The Phase 18 QA database review's reproduced WRITE LOSS. The unleased
    // fence's NOT EXISTS is uncorrelated with the row it gates, so PostgreSQL
    // hoists it into an InitPlan and gates the UPDATE on a One-Time Filter
    // decided BEFORE the row lock is taken; EvalPlanQual re-checks only the
    // target row's own columns after a lock wait and never re-runs an
    // InitPlan, so a lease committed during that wait was unseen and the write
    // landed over a now-live session whose next autosave then clobbered it.
    // The real-Postgres proof of the loss and of its closure rides
    // tests/character_save_statement_pg_integration.test.ts; what is pinned
    // HERE is the shipped statement itself, because the mode is the half no
    // behavioural test can pin from the outside: the loss repro passes under
    // FOR NO KEY UPDATE too (measured), and only FOR UPDATE conflicts with the
    // FOR KEY SHARE a character_leases INSERT takes on its FK parent, which is
    // what additionally shuts a fresh lease out for the write's lifetime.
    const client = transactionClient(1);
    dbMock.connect.mockResolvedValue(client as never);

    await saveOfflineCharacterState(41, 12, realCharacterState());

    const statements = client.query.mock.calls.map((call) => String(call[0]));
    const lock = statements.findIndex((text) => text.includes('FOR UPDATE'));
    const update = statements.findIndex((text) => text.includes('UPDATE characters'));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(update);
    // The weaker mode the UPDATE alone would take is NOT what is asked for.
    expect(statements[lock]).not.toContain('FOR NO KEY UPDATE');
    // Realm-pinned like the write it precedes, so a cross-realm id locks nothing.
    expect(statements[lock]).toBe(
      "SELECT state->'bank' AS before_bank, state->'vault' AS before_vault FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE",
    );
    const lockValues = client.query.mock.calls[lock][1] as unknown[];
    expect(lockValues[0]).toBe(41);
    const updateValues = client.query.mock.calls[update][1] as unknown[];
    // The lock and the fence address the SAME row on the SAME realm; a lock on
    // a different predicate would order the statements and protect nothing.
    expect(lockValues[1]).toBe(updateValues[3]);
  });

  it('refuses to interpolate a bound that is not a non-negative safe integer', async () => {
    // The Phase 18 QA nit. SET LOCAL takes no bind parameter, so both bounds
    // are interpolated into statement TEXT; db.ts runWithStatementTimeout
    // validates its own interpolated allowance for precisely that reason and
    // calls the check the injection guard, and this writer's two SET LOCALs
    // had no equivalent. Today's values are module constants no caller can
    // reach, which is exactly why the guard needs its own exercise: without
    // one it is a comment, and the day a bound becomes configurable nothing
    // says so. Every rejected shape is driven, since Number.isInteger alone
    // would admit 1e21 (the sibling lesson from the bag-index ceiling).
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as never);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      await expect(applyOfflineCharacterSaveBounds(query, bad)).rejects.toThrow(
        /lock_timeout must be a non-negative safe integer/,
      );
      await expect(
        applyOfflineCharacterSaveBounds(query, OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS, bad),
      ).rejects.toThrow(/idle_in_transaction_session_timeout must be a non-negative safe integer/);
    }
    // It refuses BEFORE issuing anything: a rejected bound must never leave a
    // half-bounded transaction behind.
    expect(query).not.toHaveBeenCalled();

    // And the shipped defaults pass the same guard, so the production path is
    // the one being validated rather than a test-only shape.
    await applyOfflineCharacterSaveBounds(query);
    expect(query.mock.calls.map((call) => String(call[0]))).toEqual([
      'SET LOCAL lock_timeout = 2000',
      'SET LOCAL idle_in_transaction_session_timeout = 10000',
    ]);
  });

  it('touches nothing and reports false while a live lease exists (rowCount 0)', async () => {
    // The 0-row result IS the refusal: the caller (server/clear_item_name.ts)
    // turns it into the operator's retry line rather than reporting success.
    const client = transactionClient(0);
    dbMock.connect.mockResolvedValue(client as never);

    expect(await saveOfflineCharacterState(42, 12, realCharacterState())).toBe(false);
    expect(characterUpdateCall(client)).toBeDefined();
  });
});
