import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RuntimeWorkerLike, WorkerRuntimeHost } from '../server/runtime/worker_host';
import type { RuntimeWorkerOutbound } from '../server/runtime/worker_protocol';

class FakeWorker extends EventEmitter implements RuntimeWorkerLike {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn(async () => 0);
}

function posted(worker: FakeWorker, index = -1): any {
  const calls = worker.postMessage.mock.calls;
  return calls[index < 0 ? calls.length - 1 : index]?.[0];
}

function emit(worker: FakeWorker, message: RuntimeWorkerOutbound): void {
  worker.emit('message', message);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkerRuntimeHost', () => {
  it('awaits correlated lifecycle acknowledgements before advancing or terminating', async () => {
    const worker = new FakeWorker();
    const outbound = vi.fn();
    const host = new WorkerRuntimeHost('alpha/dungeon/7', worker, outbound, vi.fn());

    expect(() => host.handle('c', 1, { t: 'move' })).toThrow('not ready');
    const start = host.start();
    const startRequest = posted(worker);
    expect(startRequest).toMatchObject({
      type: 'start',
      runtimeKey: 'alpha/dungeon/7',
    });
    emit(worker, {
      type: 'ready',
      requestId: startRequest.requestId,
      runtimeKey: host.runtimeKey,
    });
    await start;

    const join = host.join({ characterId: 'c', routeEpoch: 1, input: { seed: 4 } });
    const joinRequest = posted(worker);
    emit(worker, {
      type: 'joined',
      requestId: joinRequest.requestId,
      runtimeKey: host.runtimeKey,
      characterId: 'c',
      routeEpoch: 1,
    });
    await join;

    const prepare = host.prepareTransfer({
      characterId: 'c',
      sourceEpoch: 1,
      targetEpoch: 2,
      transfer: { seed: 4 },
    });
    const prepareRequest = posted(worker);
    emit(worker, {
      type: 'transfer-prepared',
      requestId: prepareRequest.requestId,
      runtimeKey: host.runtimeKey,
      characterId: 'c',
      sourceEpoch: 1,
      targetEpoch: 2,
    });
    await prepare;

    const commit = host.commitTransfer('c', 2);
    const commitRequest = posted(worker);
    emit(worker, {
      type: 'transfer-committed',
      requestId: commitRequest.requestId,
      runtimeKey: host.runtimeKey,
      characterId: 'c',
      routeEpoch: 2,
    });
    await commit;

    const abort = host.abortTransfer('c', 2);
    const abortRequest = posted(worker);
    emit(worker, {
      type: 'transfer-aborted',
      requestId: abortRequest.requestId,
      runtimeKey: host.runtimeKey,
      characterId: 'c',
      routeEpoch: 2,
    });
    await abort;

    host.handle('c', 2, { t: 'move' });
    expect(posted(worker)).toEqual({
      type: 'message',
      characterId: 'c',
      routeEpoch: 2,
      message: { t: 'move' },
    });

    const leave = host.leave('c', 2);
    const leaveRequest = posted(worker);
    emit(worker, {
      type: 'left',
      requestId: leaveRequest.requestId,
      runtimeKey: host.runtimeKey,
      characterId: 'c',
      routeEpoch: 2,
    });
    await leave;

    const stop = host.stop();
    const stopRequest = posted(worker);
    expect(worker.terminate).not.toHaveBeenCalled();
    emit(worker, {
      type: 'stopped',
      requestId: stopRequest.requestId,
      runtimeKey: host.runtimeKey,
    });
    await stop;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(host.start()).rejects.toThrow(/cannot start/);
  });

  it('ignores a mismatched acknowledgement and binds outbound runtime identity locally', async () => {
    const worker = new FakeWorker();
    const outbound = vi.fn();
    const host = new WorkerRuntimeHost('alpha/delve/3', worker, outbound, vi.fn());
    let started = false;
    const start = host.start().then(() => {
      started = true;
    });
    const request = posted(worker);

    emit(worker, {
      type: 'ready',
      requestId: `${request.requestId}-wrong`,
      runtimeKey: host.runtimeKey,
    });
    await Promise.resolve();
    expect(started).toBe(false);
    emit(worker, {
      type: 'ready',
      requestId: request.requestId,
      runtimeKey: host.runtimeKey,
    });
    await start;

    emit(worker, {
      type: 'outbound',
      characterId: 'c',
      routeEpoch: 8,
      payload: 'snap',
    });
    expect(outbound).toHaveBeenCalledWith({
      characterId: 'c',
      runtimeKey: host.runtimeKey,
      routeEpoch: 8,
      payload: 'snap',
    });
  });

  it('terminates when outbound and error callbacks throw', async () => {
    const worker = new FakeWorker();
    const host = new WorkerRuntimeHost(
      'alpha/delve/4',
      worker,
      () => {
        throw new Error('delivery failed');
      },
      () => {
        throw new Error('reporting failed');
      },
    );
    const start = host.start();
    const request = posted(worker);
    emit(worker, {
      type: 'ready',
      requestId: request.requestId,
      runtimeKey: host.runtimeKey,
    });
    await start;

    emit(worker, {
      type: 'outbound',
      characterId: 'c',
      routeEpoch: 8,
      payload: 'snap',
    });
    await Promise.resolve();

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(() => host.handle('c', 8, { t: 'move' })).toThrow('not ready');
  });

  it('bounds an unacknowledged lifecycle operation and terminates the worker', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const error = vi.fn();
    const host = new WorkerRuntimeHost('alpha/arena/9', worker, vi.fn(), error, 50);

    const rejection = expect(host.start()).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(error).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
