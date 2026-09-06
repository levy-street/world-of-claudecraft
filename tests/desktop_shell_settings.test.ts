// The one-place fan-out of the desktop shell's persisted settings
// (src/game/desktop_shell_settings.ts): every reflection fires at boot, and
// the apply arm routes exactly the shell-mirrored keys to their push.

import { afterEach, describe, expect, it } from 'vitest';
import {
  desktopGpuBackendWriteFailed,
  resetDesktopGpuBackendActiveForTest,
} from '../src/game/desktop_gpu_backend_sync';
import {
  applyDesktopShellSetting,
  syncDesktopShellSettings,
} from '../src/game/desktop_shell_settings';
import type { DesktopBridge } from '../src/runtime';

afterEach(() => {
  resetDesktopGpuBackendActiveForTest();
});

function bridgeRecorder(gpuBackendWriteAnswer = true) {
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
      return Promise.resolve(gpuBackendWriteAnswer);
    },
    getDisplayMode: () => {
      calls.push('get:displayMode');
      return Promise.resolve('windowed');
    },
    getLaunchSettings: () => {
      calls.push('get:launchSettings');
      return Promise.resolve({ gpuForceOptOut: false, gpuBackend: 'auto' });
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
      'get:launchSettings',
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

  it('leaves the local backend value alone once the shell has kept the write', async () => {
    const { bridge, calls } = bridgeRecorder();
    const { settings, writes } = settingsRecorder();
    applyDesktopShellSetting('gpuBackend', 2, settings, bridge);
    await new Promise((r) => setTimeout(r, 0));
    // No second read: the shell holds what the player picked, so re-reading it
    // would only be a chance to overwrite a newer choice with an older answer.
    expect(calls).toEqual(['set:gpuBackend=opengl']);
    expect(writes).toEqual([['gpuBackend', 2]]);
    expect(desktopGpuBackendWriteFailed()).toBe(false);
  });

  it("puts the local backend value back on the shell's own when the write is refused", async () => {
    // The restart the options window offers reads the LOCAL value against the
    // shell's launch snapshot, so a refused write that left the pick standing
    // would offer a restart into a backend the shell never stored.
    const { bridge, calls } = bridgeRecorder(false);
    const { settings, writes } = settingsRecorder();
    expect(applyDesktopShellSetting('gpuBackend', 2, settings, bridge)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    // Local first (the row answers the click), then the push, then the shell's
    // own stored value read back and written straight into the local store.
    expect(calls).toEqual(['set:gpuBackend=opengl', 'get:gpuBackend']);
    expect(writes).toEqual([
      ['gpuBackend', 2],
      ['gpuBackend', 1],
    ]);
    // And only now does the row learn to say so, with the buttons already back
    // on the value the sentence names.
    expect(desktopGpuBackendWriteFailed()).toBe(true);
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
