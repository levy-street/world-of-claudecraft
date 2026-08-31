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

function transactionClient(rowCount: number) {
  const client = { query: vi.fn(), release: vi.fn() };
  client.query.mockResolvedValue({ rows: [], rowCount } as never);
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
    // Every bound is set BEFORE the write it bounds.
    const update = statements.findIndex((text) => text.includes('UPDATE characters'));
    expect(update).toBe(4);
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

  it('touches nothing and reports false while a live lease exists (rowCount 0)', async () => {
    // The 0-row result IS the refusal: the caller (server/clear_item_name.ts)
    // turns it into the operator's retry line rather than reporting success.
    const client = transactionClient(0);
    dbMock.connect.mockResolvedValue(client as never);

    expect(await saveOfflineCharacterState(42, 12, realCharacterState())).toBe(false);
    expect(characterUpdateCall(client)).toBeDefined();
  });
});
