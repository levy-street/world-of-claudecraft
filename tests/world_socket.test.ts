import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorldSocket } from '../src/net/world_socket';

class StubSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  constructor(readonly url: string) {}
}

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal('WebSocket', StubSocket);
  let current: WebSocket | null = null;
  const handlers = {
    isCurrent: (socket: WebSocket) => socket === current,
    onMessage: vi.fn(),
    onClose: vi.fn(),
  };
  const socket = openWorldSocket('https://realm.invalid', 'synthetic-auth', handlers);
  current = socket;
  return {
    socket: socket as unknown as StubSocket,
    handlers,
    retire: () => {
      current = null;
    },
  };
}

describe('world socket transport ownership', () => {
  it.each([false, true])('releases its own handlers on close (retired: %s)', (retired) => {
    const { socket, handlers, retire } = fixture();
    if (retired) retire();
    socket.onclose?.();
    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(handlers.onClose).toHaveBeenCalledTimes(retired ? 0 : 1);
  });

  it('releases handlers before a current close callback can throw', () => {
    const { socket, handlers } = fixture();
    handlers.onClose.mockImplementation(() => {
      throw new Error('synthetic callback failure');
    });
    expect(() => socket.onclose?.()).toThrow('synthetic callback failure');
    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onclose).toBeNull();
  });

  it('does not dispatch captured callbacks again after its close has been delivered', () => {
    const { socket, handlers } = fixture();
    const opened = socket.onopen;
    const received = socket.onmessage;
    const closed = socket.onclose;
    closed?.();
    opened?.();
    received?.({ data: 'late' });
    closed?.();
    expect(socket.send).not.toHaveBeenCalled();
    expect(handlers.onMessage).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('sends authentication and dispatches events on its current transport', () => {
    const { socket, handlers } = fixture();
    expect(socket.url).toBe('wss://realm.invalid/ws');
    expect(socket.send).not.toHaveBeenCalled();
    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledExactlyOnceWith('synthetic-auth');
    socket.onmessage?.({ data: 'hello' });
    expect(handlers.onMessage).toHaveBeenCalledExactlyOnceWith('hello');
    socket.onclose?.();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it.each(['open', 'message', 'close'] as const)(
    'ignores a retired transport %s callback',
    (event) => {
      const { socket, handlers, retire } = fixture();
      retire();
      if (event === 'open') socket.onopen?.();
      if (event === 'message') socket.onmessage?.({ data: 'stale' });
      if (event === 'close') socket.onclose?.();
      expect(socket.send).not.toHaveBeenCalled();
      expect(handlers.onMessage).not.toHaveBeenCalled();
      expect(handlers.onClose).not.toHaveBeenCalled();
    },
  );

  it.each(['http:', 'https:'])('uses the page host when no realm was selected (%s)', (protocol) => {
    vi.stubGlobal('WebSocket', StubSocket);
    vi.stubGlobal('location', { protocol, host: 'localhost:5173' });
    const socket = openWorldSocket('', '', { isCurrent: () => true, onMessage() {}, onClose() {} });
    expect(socket.url).toBe(`${protocol === 'https:' ? 'wss:' : 'ws:'}//localhost:5173/ws`);
  });
});
