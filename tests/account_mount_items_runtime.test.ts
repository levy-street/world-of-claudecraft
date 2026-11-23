import { expect, it, vi } from 'vitest';

vi.mock('../server/account_mount_items_service', () => ({
  AccountMountItemsService: class {
    constructor(public host: Record<string, (...args: any[]) => any>) {}
  },
}));

import { createRealmMountItemsService } from '../server/account_mount_items_runtime';
import { createBackgroundDbGate } from '../server/background_db_gate';

it('wires provisional ownership and non-queuing refresh admission to the realm gate', () => {
  const setCollectibleMountSkins = vi.fn();
  const meta = vi.fn();
  const gate = createBackgroundDbGate(4);
  const service = createRealmMountItemsService(
    () => ({ meta }),
    { setCollectibleMountSkins },
    () => gate,
    vi.fn(),
  );
  const host = (
    service as unknown as {
      host: {
        meta(pid: number): unknown;
        setCollectible(
          accountId: number,
          ids: string[],
          sessions: Iterable<unknown>,
          authoritative: boolean,
        ): void;
        tryAcquireRefreshPermit(): ReturnType<typeof gate.tryAcquire>;
      };
    }
  ).host;
  host.meta(7);
  expect(meta).toHaveBeenCalledWith(7);
  const sessions: unknown[] = [];
  host.setCollectible(9, [], sessions, false);
  expect(setCollectibleMountSkins).toHaveBeenCalledWith(9, [], sessions, false);
  const permit = host.tryAcquireRefreshPermit();
  expect(permit).not.toBeNull();
  expect(host.tryAcquireRefreshPermit()).toBeNull();
  expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 0 });
  permit?.release();
});
