import { describe, expect, it, vi } from 'vitest';
import { type RuntimeWorkerLike, WorkerRuntimeHost } from '../server/runtime/worker_host';

function fakeWorker(): RuntimeWorkerLike {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(0),
    on: vi.fn().mockReturnThis(),
  };
}

describe('WorkerRuntimeHost', () => {
  it('bounds a worker lifecycle behind the runtime contract', async () => {
    const worker = fakeWorker();
    const host = new WorkerRuntimeHost('alpha/dungeon/7', worker, vi.fn(), vi.fn());
    expect(() => host.join({ characterId: 'c', routeEpoch: 1, input: {} })).toThrow('not started');
    host.start();
    host.join({ characterId: 'c', routeEpoch: 1, input: { seed: 4 } });
    host.handle('c', 1, { t: 'move' });
    host.leave('c', 1);
    await host.stop();
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'start',
      runtimeKey: 'alpha/dungeon/7',
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'join',
      request: { characterId: 'c', routeEpoch: 1, input: { seed: 4 } },
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
