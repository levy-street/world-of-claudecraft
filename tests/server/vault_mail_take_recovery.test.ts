import { describe, expect, it, vi } from 'vitest';
import { VaultMailTakeGuard } from '../../server/vault_mail_take_guard';
import { VaultMailTakeRecovery } from '../../server/vault_mail_take_recovery';
import type { Sim } from '../../src/sim/sim';

describe('vault mail take recovery', () => {
  it('restores only the pending durable parcel before releasing the command fence', async () => {
    const guard = new VaultMailTakeGuard();
    const ref = 'vault:test:7:1:7';
    guard.begin(7, 70, ref);
    const restoreVaultLetter = vi.fn(() => true);
    const sim = { postOffice: { restoreVaultLetter } } as unknown as Sim;
    const source = {
      recipientName: 'Owner',
      copper: 12,
      items: [{ itemId: 'thorium_ore', count: 1 }],
      read: false,
    };
    const load = vi.fn(async () => source);
    const recovery = new VaultMailTakeRecovery(
      guard,
      () => sim,
      (run) => run(),
      load,
    );
    expect(recovery.joinError(7)).toMatch(/recovering/);
    expect(recovery.joinError(7)).toMatch(/recovering/);
    await vi.waitFor(() => expect(guard.isLocked(7)).toBe(false));
    expect(load).toHaveBeenCalledWith(7, ref);
    expect(load).toHaveBeenCalledTimes(1);
    expect(restoreVaultLetter).toHaveBeenCalledWith('7', ref, source);
    expect(recovery.joinError(7)).toBeNull();
  });

  it('releases the fence without replay when the take already committed', async () => {
    const guard = new VaultMailTakeGuard();
    guard.begin(7, 70, 'vault:test:7:1:7');
    const restoreVaultLetter = vi.fn(() => true);
    const sim = { postOffice: { restoreVaultLetter } } as unknown as Sim;
    const recovery = new VaultMailTakeRecovery(
      guard,
      () => sim,
      (run) => run(),
      async () => null,
    );
    recovery.recover(7);
    await vi.waitFor(() => expect(guard.isLocked(7)).toBe(false));
    expect(restoreVaultLetter).not.toHaveBeenCalled();
  });

  it('bounds permit waiters and drains queued characters in FIFO order', async () => {
    const guard = new VaultMailTakeGuard();
    for (let id = 1; id <= 70; id++) guard.begin(id, id, `vault:test:${id}`);
    const admitted: Array<() => void> = [];
    const loads: number[] = [];
    const recovery = new VaultMailTakeRecovery(
      guard,
      () => ({ postOffice: { restoreVaultLetter: () => true } }) as unknown as Sim,
      (run) => new Promise<void>((resolve) => admitted.push(resolve)).then(run),
      async (id) => {
        loads.push(id);
        return null;
      },
    );
    for (let id = 1; id <= 70; id++) recovery.recover(id);
    expect(admitted).toHaveLength(2);
    expect(recovery.stats()).toEqual({ active: 2, queued: 64, overflow: 4, refused: 4 });
    admitted[0]();
    await vi.waitFor(() => expect(loads).toEqual([1]));
    await vi.waitFor(() => expect(admitted).toHaveLength(3));
    admitted[1]();
    await vi.waitFor(() => expect(loads).toEqual([1, 2]));
    admitted[2]();
    await vi.waitFor(() => expect(loads).toEqual([1, 2, 3]));
    for (let i = 3; i < 70; i++) {
      await vi.waitFor(() => expect(admitted.length).toBeGreaterThan(i));
      admitted[i]();
    }
    await vi.waitFor(() => expect(loads).toHaveLength(70));
    expect(guard.isLocked(70)).toBe(false);
    expect(recovery.stats()).toMatchObject({ active: 0, queued: 0, overflow: 0 });
  });
});
