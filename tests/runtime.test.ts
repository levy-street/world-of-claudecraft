import { describe, expect, it } from 'vitest';
import {
  desktopBridge,
  isElectronRuntime,
  isGlitchPlatformOrigin,
  isWebServedRuntime,
  normalizeGameApiOrigin,
  normalizeOrigin,
  runtimeApiOrigin,
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

  it('does not treat Glitch platform hosts as WOC game API origins', () => {
    expect(isGlitchPlatformOrigin('https://www.glitch.fun/api/project-stats')).toBe(true);
    expect(isGlitchPlatformOrigin('https://api.glitch.fun/api')).toBe(true);
    expect(normalizeGameApiOrigin('https://www.glitch.fun')).toBe('');
    expect(normalizeGameApiOrigin('https://api.glitch.fun/api')).toBe('');
    expect(normalizeGameApiOrigin('app://worldofclaudecraft')).toBe('');
    expect(normalizeGameApiOrigin('https://woc-api.example.com/path')).toBe(
      'https://woc-api.example.com',
    );
  });

  it('keeps HTTPS-loaded Desktop App launches same-origin', () => {
    const electronUa = 'Mozilla/5.0 Electron/43.0.0 Chrome/145';
    const glitchLaunchLocation = {
      protocol: 'https:',
      hostname: 'world-of-claudecraft-node.graywater-acc59434.eastus.azurecontainerapps.io',
    } as Location;

    expect(isWebServedRuntime(glitchLaunchLocation)).toBe(true);
    expect(runtimeApiOrigin(electronUa, glitchLaunchLocation)).toBe('');
  });

  it('keeps standalone desktop app protocol launches on the stamped API origin', () => {
    expect(
      runtimeApiOrigin('Mozilla/5.0 Electron/43.0.0 Chrome/145', {
        protocol: 'app:',
      } as Location),
    ).toBe('https://worldofclaudecraft.com');
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
