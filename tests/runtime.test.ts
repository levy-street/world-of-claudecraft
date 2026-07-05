import { describe, expect, it } from 'vitest';
import {
  desktopBridge,
  isElectronRuntime,
  normalizeOrigin,
  runtimeWebSocketUrl,
} from '../src/runtime';

describe('desktop runtime helpers', () => {
  it('detects Electron user agents', () => {
    expect(isElectronRuntime('Mozilla/5.0 Electron/42.4.1 Chrome/145')).toBe(true);
    expect(isElectronRuntime('Mozilla/5.0 Chrome/145')).toBe(false);
  });

  it('normalizes HTTP origins and rejects non-web origins', () => {
    expect(normalizeOrigin('https://worldofclaudecraft.com/')).toBe(
      'https://worldofclaudecraft.com',
    );
    expect(() => normalizeOrigin('app://worldofclaudecraft')).toThrow(
      'unsupported origin protocol',
    );
  });

  it('builds websocket URLs from desktop API origins', () => {
    expect(
      runtimeWebSocketUrl('app:', 'worldofclaudecraft', 'https://worldofclaudecraft.com'),
    ).toBe('wss://worldofclaudecraft.com/ws');
    expect(runtimeWebSocketUrl('http:', '127.0.0.1:5173', '')).toBe('ws://127.0.0.1:5173/ws');
  });

  it('detects the desktop preload bridge shape', () => {
    const globalWithBridge = globalThis as unknown as { wocDesktop?: unknown };
    const previous = globalWithBridge.wocDesktop;
    try {
      expect(desktopBridge()).toBeNull();
      globalWithBridge.wocDesktop = {
        openBrowserLogin: async () => {},
        takeLoginCode: async () => null,
        onLoginCode: () => () => {},
      };
      expect(desktopBridge()).not.toBeNull();
    } finally {
      globalWithBridge.wocDesktop = previous;
    }
  });
});
