import { describe, expect, it } from 'vitest';
import { createKtx2RestoreUploadQueueCoordinator } from '../src/game/ktx2_restore_upload_queue';

describe('KTX2 restore upload queue coordinator', () => {
  it('returns the current queue immediately while not paused', () => {
    const coordinator = createKtx2RestoreUploadQueueCoordinator<{ id: string }>();
    expect(coordinator.current()).toBeUndefined();
    const queue = { id: 'live' };
    coordinator.publish(queue);
    expect(coordinator.current()).toBe(queue);
  });

  it('holds restore application while a rebuild is paused and no queue is live', async () => {
    const coordinator = createKtx2RestoreUploadQueueCoordinator<{ id: string }>();
    const oldQueue = { id: 'old' };
    const nextQueue = { id: 'candidate' };
    coordinator.publish(oldQueue);
    coordinator.setPaused(true);
    coordinator.publish(undefined);

    let resolved: { id: string } | undefined | null = null;
    void Promise.resolve(coordinator.current()).then((queue) => {
      resolved = queue;
    });
    await Promise.resolve();
    expect(resolved).toBeNull();

    coordinator.publish(nextQueue);
    await Promise.resolve();
    expect(resolved).toBe(nextQueue);
  });

  it('releases waiters with undefined when the rebuild pause ends without a queue', async () => {
    const coordinator = createKtx2RestoreUploadQueueCoordinator<{ id: string }>();
    coordinator.setPaused(true);
    let resolved: { id: string } | undefined | null = null;
    void Promise.resolve(coordinator.current()).then((queue) => {
      resolved = queue;
    });
    await Promise.resolve();
    expect(resolved).toBeNull();

    coordinator.setPaused(false);
    await Promise.resolve();
    expect(resolved).toBeUndefined();
  });
});
