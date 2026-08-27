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
    // The heavy allowance the live save family runs on.
    const setLocal = client.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('SET LOCAL statement_timeout'),
    );
    expect(setLocal?.[0]).toContain(String(DB_HEAVY_STATEMENT_TIMEOUT_MS));
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
