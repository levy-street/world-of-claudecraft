// The post-COMMIT acknowledgement of a caller-owned character save
// (server/character_save_acknowledge.ts), extracted from GameServer for the
// market custody path and the guild roster purchase to share: exact-match
// the character and lease identity, consume nothing on a mismatch, answer
// false rather than throw.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  visit: vi.fn(),
  bustLog: vi.fn(),
  storageCommitted: vi.fn(),
}));

vi.mock('../server/bank_ledger_session', () => ({
  acknowledgeCharacterSaveEffects: mocks.acknowledge,
}));
vi.mock('../server/bank_ledger_guild_prefix', () => ({ visitGuildLedgerIdsForOps: mocks.visit }));
vi.mock('../server/guild_bank_log', () => ({
  bustGuildBankLog: mocks.bustLog,
  GUILD_BANK_LOG_VISIBLE_OPS: ['deposit'],
}));
vi.mock('../server/storage_purchases', () => ({
  storageAppliedEffectsCommitted: mocks.storageCommitted,
}));
vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { acknowledgeSessionSaveEffects } from '../server/character_save_acknowledge';

const owner = { realm: 'test-realm', characterId: 7, accountId: 5 };
const snapshot = { owner, rowCount: 1, batches: [{ batchKey: 'b1' }] };
const outbox = { acknowledge: vi.fn() };
const session = () => ({
  characterId: 7,
  accountId: 5,
  leaseNonce: 'lease-1',
  pendingStorageAppliedEffects: [],
  bankLedgerJournal: { outbox } as never,
});
const save = () => ({
  characterId: 7,
  level: 3,
  state: {} as never,
  leaseNonce: 'lease-1',
  storageEffects: [],
  bankLedgerSnapshot: snapshot as never,
});

beforeEach(() => {
  mocks.acknowledge.mockReset().mockReturnValue(true);
  mocks.visit.mockReset();
});

describe('acknowledgeSessionSaveEffects', () => {
  it('consumes the exact prefix for a matching session and busts the visible guild logs', () => {
    expect(acknowledgeSessionSaveEffects(session(), save())).toBe(true);
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    const call = mocks.acknowledge.mock.calls[0][0];
    expect(call.ledgerOutbox).toBe(outbox);
    expect(call.ledgerSnapshot).toBe(snapshot);
    expect(call.onStorageCommitted).toBe(mocks.storageCommitted);
    expect(mocks.visit).toHaveBeenCalledWith(snapshot.batches, ['deposit'], mocks.bustLog);
  });

  it.each([
    ['no session', null, save()],
    ['lease rotated', { ...session(), leaseNonce: 'lease-2' }, save()],
    ['another character', { ...session(), characterId: 8 }, save()],
    ['another account', { ...session(), accountId: 6 }, save()],
    [
      'another realm',
      session(),
      {
        ...save(),
        bankLedgerSnapshot: { ...snapshot, owner: { ...owner, realm: 'other' } } as never,
      },
    ],
    ['no snapshot', session(), { ...save(), bankLedgerSnapshot: undefined }],
  ])('answers false and consumes nothing on a mismatch: %s', (_name, s, sv) => {
    expect(acknowledgeSessionSaveEffects(s, sv)).toBe(false);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(mocks.visit).not.toHaveBeenCalled();
  });

  it('does not bust guild logs when the outbox refuses the prefix', () => {
    mocks.acknowledge.mockReturnValue(false);
    expect(acknowledgeSessionSaveEffects(session(), save())).toBe(false);
    expect(mocks.visit).not.toHaveBeenCalled();
  });
});
