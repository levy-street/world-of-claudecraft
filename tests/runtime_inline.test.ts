import { describe, expect, it, vi } from 'vitest';
import { InlineRuntimeHost } from '../server/runtime/inline_host';

describe('InlineRuntimeHost', () => {
  it('passes lifecycle and session calls through without changing payloads', async () => {
    const adapter = {
      start: vi.fn(),
      stop: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      handle: vi.fn(),
    };
    const host = new InlineRuntimeHost('alpha/overworld/world', adapter);
    const request = { characterId: 'char-1', routeEpoch: 3, input: { token: 'same-bytes' } };
    const message = new Uint8Array([1, 2, 3]);

    await host.start();
    await host.join(request);
    await host.handle('char-1', 3, message);
    await host.leave('char-1', 3);
    await host.stop();

    expect(adapter.start).toHaveBeenCalledOnce();
    expect(adapter.join).toHaveBeenCalledWith(request);
    expect(adapter.handle).toHaveBeenCalledWith('char-1', 3, message);
    expect(adapter.leave).toHaveBeenCalledWith('char-1', 3);
    expect(adapter.stop).toHaveBeenCalledOnce();
  });
});
