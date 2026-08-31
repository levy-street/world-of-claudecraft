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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  saveOfflineCharacterState: vi.fn(),
  saveCharacterState: vi.fn(),
  createCharacterCapped: vi.fn(),
}));
vi.mock('../../server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/db')>()),
  saveOfflineCharacterState: db.saveOfflineCharacterState,
  saveCharacterState: db.saveCharacterState,
  createCharacterCapped: db.createCharacterCapped,
}));

import { logger } from '../../server/http/logger';
import {
  offlineFenceRefusals,
  resetOfflineFenceRefusalsForTests,
} from '../../server/offline_fence_refusals';
import { BOOST_LEVEL, defaultBoostDeps } from '../../server/pbe_boost';
import type { CharacterState } from '../../src/sim/sim';

const STATE = { level: BOOST_LEVEL, inventory: [], questLog: [] } as unknown as CharacterState;

beforeEach(() => {
  resetOfflineFenceRefusalsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  db.saveOfflineCharacterState.mockReset();
  db.saveCharacterState.mockReset();
  db.createCharacterCapped.mockReset();
});

describe('defaultBoostDeps.createCharacter (the roster create)', () => {
  it('carries BOOST_LEVEL into the create and reports the level the row came back at', async () => {
    // The Phase 18 database review's B3: the create takes the level now, so
    // the roster save has nothing left to move. `levelStored` is read off the
    // RETURNING row, never assumed from what was asked for, which is what
    // makes dropping the second write safe.
    db.createCharacterCapped.mockResolvedValue({ id: 31, level: BOOST_LEVEL } as never);

    const result = await defaultBoostDeps.createCharacter(9, 'Bootsy', 'mage', STATE);

    expect(result).toEqual({ id: 31, levelStored: true });
    const call = db.createCharacterCapped.mock.calls[0];
    expect(call[0]).toBe(9);
    expect(call[1]).toBe('Bootsy');
    expect(call[2]).toBe('mage');
    expect(call[4]).toBe(STATE);
    // The level rides the 7th argument, past the appearance slot.
    expect(call[6]).toBe(BOOST_LEVEL);
  });

  it('reports levelStored false when the row came back at some other level', async () => {
    db.createCharacterCapped.mockResolvedValue({ id: 32, level: 1 } as never);
    expect(await defaultBoostDeps.createCharacter(9, 'Bootsy', 'mage', STATE)).toEqual({
      id: 32,
      levelStored: false,
    });
  });

  it('maps the cap refusal to null and a duplicate name to name_taken', async () => {
    db.createCharacterCapped.mockResolvedValue(null as never);
    expect(await defaultBoostDeps.createCharacter(9, 'Bootsy', 'mage', STATE)).toBeNull();

    db.createCharacterCapped.mockRejectedValue({ code: '23505' });
    expect(await defaultBoostDeps.createCharacter(9, 'Bootsy', 'mage', STATE)).toBe('name_taken');

    db.createCharacterCapped.mockRejectedValue(new Error('pool is gone'));
    await expect(defaultBoostDeps.createCharacter(9, 'Bootsy', 'mage', STATE)).rejects.toThrow(
      'pool is gone',
    );
  });
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
    // A landed save counts nothing.
    expect(offlineFenceRefusals().pbe_roster).toBe(0);
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
    // Both causes of the 0-row answer, named (the database review's B2): on a
    // freshly created row the vanished-row arm is the likelier of the two.
    expect(message).toContain('a live lease stands, or the row is gone');
    // Counted on the roster family alone (the security review's A1).
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 0,
      pbe_roster: 1,
    });
  });

  it('a thrown save still propagates (the per-class catch in boostAccountCharacters owns it)', async () => {
    db.saveOfflineCharacterState.mockRejectedValue(new Error('boom'));
    await expect(defaultBoostDeps.saveState(7, BOOST_LEVEL, STATE)).rejects.toThrow('boom');
    // A throw is not a fence refusal: the counter stays put.
    expect(offlineFenceRefusals().pbe_roster).toBe(0);
  });
});
