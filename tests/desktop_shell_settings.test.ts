// The one-place fan-out of the desktop shell's persisted settings
// (src/game/desktop_shell_settings.ts): every reflection fires at boot, and
// the apply arm routes exactly the shell-mirrored keys to their push.

import { describe, expect, it } from 'vitest';
import {
  applyDesktopShellSetting,
  syncDesktopShellSettings,
} from '../src/game/desktop_shell_settings';
import type { DesktopBridge } from '../src/runtime';

function bridgeRecorder() {
  const calls: string[] = [];
  const bridge = {
    hasGpuBackendChoice: true,
    getGpuForceOptOut: () => {
      calls.push('get:gpuForceOptOut');
      return Promise.resolve(false);
    },
    setGpuForceOptOut: (optOut: boolean) => {
      calls.push(`set:gpuForceOptOut=${optOut}`);
      return Promise.resolve(true);
    },
    getGpuBackend: () => {
      calls.push('get:gpuBackend');
      return Promise.resolve({ setting: 'vulkan', supported: true });
    },
    setGpuBackend: (value: string) => {
      calls.push(`set:gpuBackend=${value}`);
      return Promise.resolve(true);
    },
    getDisplayMode: () => {
      calls.push('get:displayMode');
      return Promise.resolve('windowed');
    },
    setDisplayMode: () => Promise.resolve(true),
    setDiscordPresenceEnabled: (enabled: boolean) => {
      calls.push(`set:discordPresence=${enabled}`);
      return Promise.resolve(true);
    },
    reportGpuRenderer: (renderer: string) => {
      calls.push(`report:${renderer.slice(0, 5)}`);
    },
  } as unknown as DesktopBridge;
  return { bridge, calls };
}

function settingsRecorder() {
  const writes: Array<[string, unknown]> = [];
  const settings = {
    set: (key: string, value: unknown) => {
      writes.push([key, value]);
      return value;
    },
  };
  return { settings: settings as never, writes };
}

describe('syncDesktopShellSettings', () => {
  it('starts every reflection at once, none waiting on another', async () => {
    const { bridge, calls } = bridgeRecorder();
    const constructed: number[] = [];
    syncDesktopShellSettings(bridge, () => {
      constructed.push(1);
      return { set: () => 0 } as never;
    });
    // The renderer report first (when the boot probe has a string; none in
    // this Node run), then every getter, all synchronously in the same tick.
    expect(calls.filter((call) => !call.startsWith('report:'))).toEqual([
      'get:gpuForceOptOut',
      'get:gpuBackend',
      'get:displayMode',
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(constructed.length).toBeGreaterThan(0);
  });

  it('tolerates a bridge with none of the methods', () => {
    expect(() =>
      syncDesktopShellSettings({} as DesktopBridge, () => ({ set: () => 0 }) as never),
    ).not.toThrow();
    expect(() => syncDesktopShellSettings(null, () => ({ set: () => 0 }) as never)).not.toThrow();
  });
});

describe('applyDesktopShellSetting', () => {
  it('routes the GPU preference through its push, which owns the inversion', async () => {
    const { bridge, calls } = bridgeRecorder();
    const { settings, writes } = settingsRecorder();
    expect(applyDesktopShellSetting('forceHighPerfGpu', false, settings, bridge)).toBe(true);
    await Promise.resolve();
    expect(writes).toEqual([['forceHighPerfGpu', false]]);
    expect(calls).toEqual(['set:gpuForceOptOut=true']);
  });

  it('routes the graphics backend as the setting name its number means', async () => {
    const { bridge, calls } = bridgeRecorder();
    const { settings, writes } = settingsRecorder();
    expect(applyDesktopShellSetting('gpuBackend', 2, settings, bridge)).toBe(true);
    await Promise.resolve();
    expect(writes).toEqual([['gpuBackend', 2]]);
    expect(calls).toEqual(['set:gpuBackend=opengl']);
  });

  it('routes the presence toggle with the same polarity on both sides', async () => {
    const { bridge, calls } = bridgeRecorder();
    const { settings, writes } = settingsRecorder();
    expect(applyDesktopShellSetting('discordPresence', true, settings, bridge)).toBe(true);
    await Promise.resolve();
    expect(writes).toEqual([['discordPresence', true]]);
    expect(calls).toEqual(['set:discordPresence=true']);
  });

  it('answers false for every other key and touches nothing', () => {
    const { bridge, calls } = bridgeRecorder();
    const { settings, writes } = settingsRecorder();
    for (const key of ['shaderWarm', 'terrainDetail', 'showDevBadges', '']) {
      expect(applyDesktopShellSetting(key, 1, settings, bridge)).toBe(false);
    }
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });
});
