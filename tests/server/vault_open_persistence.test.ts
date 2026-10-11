import { describe, expect, it, vi } from 'vitest';
import {
  createVaultOpenPersistenceState,
  persistNewVaultOpens,
} from '../../server/vault_open_persistence';
import type { SimEvent } from '../../src/sim/types';

const opened = [{ type: 'treasureVaultOpened', rarity: 'rare', pid: 7 }] as SimEvent[];

describe('vault open persistence observer', () => {
  it('unseals only after the matching character save commits', async () => {
    let resolveSave!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const confirm = vi.fn(() => true);
    const state = createVaultOpenPersistenceState();
    const deps = { attemptIdFor: () => '42:3', save, confirm, onError: vi.fn() };
    const pending = persistNewVaultOpens(opened, state, deps);
    expect(save).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(persistNewVaultOpens(opened, state, deps)).toEqual([]);
    resolveSave(true);
    await Promise.all(pending);
    expect(confirm).toHaveBeenCalledWith(7, '42:3');
    expect(state.inFlight.size).toBe(0);
  });

  it('keeps the entrance sealed after a refused save', async () => {
    const confirm = vi.fn(() => true);
    const state = createVaultOpenPersistenceState();
    const deps = {
      attemptIdFor: () => '42:3',
      save: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      confirm,
      onError: vi.fn(),
    };
    const pending = persistNewVaultOpens(opened, state, deps, 1_000);
    await Promise.all(pending);
    expect(confirm).not.toHaveBeenCalled();
    expect(persistNewVaultOpens([], state, deps, 5_999)).toEqual([]);
    await Promise.all(persistNewVaultOpens([], state, deps, 6_000));
    expect(confirm).toHaveBeenCalledWith(7, '42:3');
    expect(deps.save).toHaveBeenCalledTimes(2);
  });

  it('retries a thrown save, but never confirms an obsolete attempt', async () => {
    const state = createVaultOpenPersistenceState();
    let attempt: string | null = '42:3';
    const deps = {
      attemptIdFor: () => attempt,
      save: vi.fn().mockRejectedValueOnce(new Error('database unavailable')),
      confirm: vi.fn(() => true),
      onError: vi.fn(),
    };
    await Promise.all(persistNewVaultOpens(opened, state, deps, 1_000));
    expect(deps.onError).toHaveBeenCalledOnce();
    attempt = '42:4';
    expect(persistNewVaultOpens([], state, deps, 6_000)).toEqual([]);
    expect(state.retryAt.size).toBe(0);
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('bounds concurrent opening saves and drains delayed attempts fairly', async () => {
    const state = createVaultOpenPersistenceState();
    const finish: Array<(saved: boolean) => void> = [];
    const deps = {
      attemptIdFor: (pid: number) => `${pid}:1`,
      save: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish.push(resolve);
          }),
      ),
      confirm: vi.fn(() => true),
      onError: vi.fn(),
    };
    const events = [1, 2, 3].map((pid) => ({ ...opened[0], pid })) as SimEvent[];
    const first = persistNewVaultOpens(events, state, deps, 1_000);
    expect(first).toHaveLength(2);
    expect(state.inFlight.size).toBe(2);
    expect(state.retryAt.size).toBe(3);
    expect(persistNewVaultOpens([], state, deps, 2_000)).toEqual([]);
    finish[0](true);
    await first[0];
    const next = persistNewVaultOpens([], state, deps, 6_000);
    expect(next).toHaveLength(1);
    expect(deps.save).toHaveBeenCalledTimes(3);
    finish[1](true);
    finish[2](true);
    await Promise.all([first[1], ...next]);
    expect(deps.confirm).toHaveBeenCalledTimes(3);
  });

  it('does not starve a later portal when earlier saves repeatedly fail', async () => {
    const state = createVaultOpenPersistenceState();
    const attempted: number[] = [];
    const deps = {
      attemptIdFor: (pid: number) => `${pid}:1`,
      save: async (pid: number) => {
        attempted.push(pid);
        return pid === 3;
      },
      confirm: vi.fn(() => true),
      onError: vi.fn(),
    };
    const events = [1, 2, 3].map((pid) => ({ ...opened[0], pid })) as SimEvent[];
    await Promise.all(persistNewVaultOpens(events, state, deps, 1_000));
    await Promise.all(persistNewVaultOpens([], state, deps, 6_000));
    expect(attempted).toContain(3);
    expect(deps.confirm).toHaveBeenCalledWith(3, '3:1');
  });
});
