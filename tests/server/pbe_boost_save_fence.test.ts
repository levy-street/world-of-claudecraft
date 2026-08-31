// The PBE boost's REAL db deps (server/pbe_boost.ts defaultBoostDeps): the
// registration-time level-plus-blob save is an OFFLINE writer, so it rides the
// lease-fenced saveOfflineCharacterState (the Phase 18 unfenced-offline-writers
// item), never the unconditional live save, and a fence refusal follows the
// boost's swallow-and-log contract (logged, the roster loop moves on) rather
// than surfacing as a throw. Over a mocked server/db so no pool is touched;
// the real-Postgres arm (lands with no lease, refused under a live one) rides
// tests/character_save_statement_pg_integration.test.ts.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL
// is unset; the mock below spreads the real module, so set a dummy URL first.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  saveOfflineCharacterState: vi.fn(),
  saveCharacterState: vi.fn(),
}));
vi.mock('../../server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/db')>()),
  saveOfflineCharacterState: db.saveOfflineCharacterState,
  saveCharacterState: db.saveCharacterState,
}));

import { logger } from '../../server/http/logger';
import { BOOST_LEVEL, defaultBoostDeps } from '../../server/pbe_boost';
import type { CharacterState } from '../../src/sim/sim';

const STATE = { level: BOOST_LEVEL, inventory: [], questLog: [] } as unknown as CharacterState;

afterEach(() => {
  vi.restoreAllMocks();
  db.saveOfflineCharacterState.mockReset();
  db.saveCharacterState.mockReset();
});

describe('defaultBoostDeps.saveState (the boost roster save)', () => {
  it('rides the lease-fenced OFFLINE save with the level column, never the live save', async () => {
    db.saveOfflineCharacterState.mockResolvedValue(true);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(defaultBoostDeps.saveState(7, BOOST_LEVEL, STATE)).resolves.toBeUndefined();

    expect(db.saveOfflineCharacterState).toHaveBeenCalledTimes(1);
    expect(db.saveOfflineCharacterState).toHaveBeenCalledWith(7, BOOST_LEVEL, STATE);
    expect(db.saveCharacterState).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a fence refusal (a live lease on the fresh row) logs and resolves, never throws', async () => {
    // The 0-row answer is the fence saying a live lease stands; the character
    // row already exists (the create landed), so the roster loop keeps
    // counting it and the operator reads the refusal in the log.
    db.saveOfflineCharacterState.mockResolvedValue(false);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(defaultBoostDeps.saveState(7, BOOST_LEVEL, STATE)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    const [fields, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ characterId: 7, level: BOOST_LEVEL });
    expect(message).toContain('lease');
  });

  it('a thrown save still propagates (the per-class catch in boostAccountCharacters owns it)', async () => {
    db.saveOfflineCharacterState.mockRejectedValue(new Error('boom'));
    await expect(defaultBoostDeps.saveState(7, BOOST_LEVEL, STATE)).rejects.toThrow('boom');
  });
});
