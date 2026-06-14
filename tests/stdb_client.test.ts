import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  builders: [] as any[],
  callbacks: {} as {
    onConnect?: (conn: any, identity: { toHexString(): string }, token: string) => void;
    onConnectError?: (ctx: unknown, error: Error) => void;
    onDisconnect?: (ctx: unknown, error?: Error) => void;
  },
  conn: { isActive: true, disconnect: vi.fn() },
}));

vi.mock('../src/net/module_bindings', () => ({
  DbConnection: {
    builder: vi.fn(() => {
      mockState.callbacks = {};
      const builder: any = {
        withUri: vi.fn(() => builder),
        withDatabaseName: vi.fn(() => builder),
        withToken: vi.fn(() => builder),
        onConnect: vi.fn((cb) => {
          mockState.callbacks.onConnect = cb;
          return builder;
        }),
        onConnectError: vi.fn((cb) => {
          mockState.callbacks.onConnectError = cb;
          return builder;
        }),
        onDisconnect: vi.fn((cb) => {
          mockState.callbacks.onDisconnect = cb;
          return builder;
        }),
        build: vi.fn(() => mockState.conn),
      };
      mockState.builders.push(builder);
      return builder;
    }),
  },
}));

import { StdbClient } from '../src/net/spacetime_client';

const config = { uri: 'http://127.0.0.1:3000', moduleName: 'worldofclaudecraft' };
const identity = { toHexString: () => 'identity-hex' };
const originalLocalStorage = globalThis.localStorage;

function setLocalStorage(storage: Partial<Storage>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

describe('StdbClient', () => {
  beforeEach(() => {
    mockState.builders.length = 0;
    mockState.callbacks = {};
    mockState.conn = { isActive: true, disconnect: vi.fn() };
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('connects when localStorage getItem and setItem throw', async () => {
    setLocalStorage({
      getItem: vi.fn(() => {
        throw new Error('storage disabled');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
    });
    const client = new StdbClient(config);

    const connected = client.connect();
    expect(mockState.builders[0].withToken).toHaveBeenCalledWith(undefined);
    mockState.callbacks.onConnect?.(mockState.conn, identity, 'fresh-token');

    await expect(connected).resolves.toBe(mockState.conn);
    expect(client.authToken).toBe('fresh-token');
  });

  it('resets connecting after a connect error so callers can retry', async () => {
    const client = new StdbClient(config);

    const first = client.connect();
    mockState.callbacks.onConnectError?.(null, new Error('dial failed'));
    await expect(first).rejects.toThrow('dial failed');

    const second = client.connect();
    expect(mockState.builders).toHaveLength(2);
    mockState.callbacks.onConnect?.(mockState.conn, identity, 'retry-token');
    await expect(second).resolves.toBe(mockState.conn);
  });

  it('rejects and notifies when disconnected during the initial connect', async () => {
    const client = new StdbClient(config);
    const onDisconnect = vi.fn();
    client.onDisconnect(onDisconnect);

    const pending = client.connect();
    mockState.callbacks.onDisconnect?.(null, new Error('socket closed'));

    await expect(pending).rejects.toThrow('socket closed');
    expect(onDisconnect).toHaveBeenCalledWith('socket closed');

    const retry = client.connect();
    expect(mockState.builders).toHaveLength(2);
    mockState.callbacks.onConnect?.(mockState.conn, identity, 'after-disconnect');
    await expect(retry).resolves.toBe(mockState.conn);
  });
});
