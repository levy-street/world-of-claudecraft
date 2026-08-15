import { describe, expect, it, vi } from 'vitest';
import { createSeekerRpcExecutor } from '../server/seeker_rpc_executor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Seeker RPC executor', () => {
  it('coalesces work with the same key into one RPC flight', async () => {
    const pending = deferred<string>();
    const task = vi.fn(async () => pending.promise);
    const executor = createSeekerRpcExecutor({
      maxActive: 2,
      maxQueued: 2,
      timeoutMs: 1_000,
    });

    const first = executor.run('account:42', task);
    const second = executor.run('account:42', task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    pending.resolve('verified');

    await expect(Promise.all([first, second])).resolves.toEqual(['verified', 'verified']);
    expect(executor.stats()).toMatchObject({
      active: 0,
      queued: 0,
      coalescedTotal: 1,
      completedTotal: 1,
      failedTotal: 0,
    });
  });

  it('bounds active and queued work and starts queued RPCs in order', async () => {
    const firstPending = deferred<string>();
    const secondPending = deferred<string>();
    const thirdPending = deferred<string>();
    const executor = createSeekerRpcExecutor({
      maxActive: 2,
      maxQueued: 1,
      timeoutMs: 1_000,
    });
    const firstTask = vi.fn(async () => firstPending.promise);
    const secondTask = vi.fn(async () => secondPending.promise);
    const thirdTask = vi.fn(async () => thirdPending.promise);

    const first = executor.run('first', firstTask);
    const second = executor.run('second', secondTask);
    const third = executor.run('third', thirdTask);
    await expect(executor.run('fourth', vi.fn())).rejects.toThrow('queue is full');
    expect(executor.stats()).toMatchObject({
      active: 2,
      queued: 1,
      queueFullTotal: 1,
    });
    expect(firstTask).toHaveBeenCalledTimes(1);
    expect(secondTask).toHaveBeenCalledTimes(1);
    expect(thirdTask).not.toHaveBeenCalled();

    firstPending.resolve('first');
    await vi.waitFor(() => expect(thirdTask).toHaveBeenCalledTimes(1));
    secondPending.resolve('second');
    thirdPending.resolve('third');

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('aborts a stalled RPC at the shared deadline and releases its slot', async () => {
    const executor = createSeekerRpcExecutor({
      maxActive: 1,
      maxQueued: 1,
      timeoutMs: 20,
    });
    const stalled = executor.run(
      'stalled',
      (_signal) =>
        new Promise((_resolve, reject) => {
          _signal.addEventListener('abort', () => reject(_signal.reason), { once: true });
        }),
    );

    await expect(stalled).rejects.toBeDefined();
    await expect(executor.run('next', async () => 'verified')).resolves.toBe('verified');
    expect(executor.stats()).toMatchObject({
      active: 0,
      queued: 0,
      timedOutTotal: 1,
      completedTotal: 1,
      failedTotal: 1,
    });
  });

  it('keeps a timed-out active slot occupied until non-abortable work settles', async () => {
    const executor = createSeekerRpcExecutor({
      maxActive: 1,
      maxQueued: 1,
      timeoutMs: 20,
    });
    const activePending = deferred<string>();
    const queuedTask = vi.fn(async () => 'should-not-run');
    const active = executor.run('active', async () => activePending.promise);
    const queued = executor.run('queued', queuedTask);

    await expect(queued).rejects.toBeDefined();
    await expect(active).rejects.toBeDefined();
    expect(executor.stats()).toMatchObject({ active: 1, queued: 0 });
    expect(queuedTask).not.toHaveBeenCalled();

    const replacementTask = vi.fn(async () => 'verified');
    const replacement = executor.run('active', replacementTask);
    expect(replacementTask).not.toHaveBeenCalled();
    activePending.resolve('finished');
    await vi.waitFor(() => expect(replacementTask).toHaveBeenCalledTimes(1));
    await expect(replacement).resolves.toBe('verified');
  });
});
