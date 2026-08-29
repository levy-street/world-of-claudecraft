import { describe, expect, it, vi } from 'vitest';

const { kickStoragePurchaseRecovery } = vi.hoisted(() => ({
  kickStoragePurchaseRecovery: vi.fn(),
}));

vi.mock('../../server/storage_purchases', () => ({ kickStoragePurchaseRecovery }));

import { StorageRecoverySessionSweep } from '../../server/storage_recovery_session_sweep';

describe('StorageRecoverySessionSweep', () => {
  it('retries overflow sessions in bounded turns and skips left or unmarked sessions', () => {
    const sessions = new Map([
      [1, { characterId: 101, left: false, storageRecoveryAdmissionPending: true }],
      [2, { characterId: 102, left: false, storageRecoveryAdmissionPending: false }],
      [3, { characterId: 103, left: true, storageRecoveryAdmissionPending: true }],
      [4, { characterId: 104, left: false, storageRecoveryAdmissionPending: true }],
    ]);
    const sweep = new StorageRecoverySessionSweep(sessions, 2);

    sweep.run();
    expect(kickStoragePurchaseRecovery).toHaveBeenCalledTimes(1);
    expect(kickStoragePurchaseRecovery).toHaveBeenLastCalledWith(101, { viaSweep: true });

    sweep.run();
    expect(kickStoragePurchaseRecovery).toHaveBeenCalledTimes(2);
    expect(kickStoragePurchaseRecovery).toHaveBeenLastCalledWith(104, { viaSweep: true });

    // The exhausted iterator resets without inspecting a new session in the
    // same turn. The next call starts another bounded pass.
    sweep.run();
    expect(kickStoragePurchaseRecovery).toHaveBeenCalledTimes(2);
    sweep.run();
    expect(kickStoragePurchaseRecovery).toHaveBeenCalledTimes(3);
    expect(kickStoragePurchaseRecovery).toHaveBeenLastCalledWith(101, { viaSweep: true });
  });
});
