// The game's side of the next-launch settings
// (src/game/desktop_next_launch_settings.ts): the registry, the comparison
// against the shell's launch snapshot, the boot latch and the restart request.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopRestartSupported,
  NEXT_LAUNCH_SETTINGS,
  type NextLaunchSettingsReader,
  pendingRestartKeys,
  pendingRestartKeysFor,
  requestDesktopRestart,
  resetDesktopLaunchSettingsForTest,
  syncDesktopLaunchSettings,
} from '../src/game/desktop_next_launch_settings';
import type { DesktopBridge, DesktopLaunchSettings } from '../src/runtime';

afterEach(() => {
  resetDesktopLaunchSettingsForTest();
});

/** A Linux desktop shell exposing both rows. */
function linuxBridge(extra: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getGpuForceOptOut: () => Promise.resolve(false),
    setGpuForceOptOut: () => Promise.resolve(true),
    getGpuBackend: () => Promise.resolve({ setting: 'auto' }),
    setGpuBackend: () => Promise.resolve(true),
    hasGpuBackendChoice: true,
    ...extra,
  } as unknown as DesktopBridge;
}

/** A Windows shell: the GPU preference row, no backend choice. */
function windowsBridge(): DesktopBridge {
  return linuxBridge({ hasGpuBackendChoice: false });
}

function settingsOf(values: {
  forceHighPerfGpu: boolean;
  gpuBackend: number;
}): NextLaunchSettingsReader {
  return { get: ((key: keyof typeof values) => values[key]) as NextLaunchSettingsReader['get'] };
}

const LAUNCHED: DesktopLaunchSettings = { gpuForceOptOut: false, gpuBackend: 'auto' };

describe('the registry', () => {
  it('names the two next-launch settings behind their row capabilities', () => {
    expect(NEXT_LAUNCH_SETTINGS.map((s) => s.key)).toEqual(['forceHighPerfGpu', 'gpuBackend']);
    const [force, backend] = NEXT_LAUNCH_SETTINGS;
    expect(force.supported(linuxBridge())).toBe(true);
    expect(backend.supported(linuxBridge())).toBe(true);
    expect(backend.supported(windowsBridge())).toBe(false);
    expect(force.supported(null)).toBe(false);
  });

  it('reads each launch value off the snapshot, with the opt-out inverted once', () => {
    const [force, backend] = NEXT_LAUNCH_SETTINGS;
    expect(force.launchValue({ gpuForceOptOut: true, gpuBackend: 'auto' })).toBe(false);
    expect(force.launchValue({ gpuForceOptOut: false, gpuBackend: 'auto' })).toBe(true);
    expect(backend.launchValue({ gpuForceOptOut: false, gpuBackend: 'auto' })).toBe(0);
    expect(backend.launchValue({ gpuForceOptOut: false, gpuBackend: 'vulkan' })).toBe(1);
    expect(backend.launchValue({ gpuForceOptOut: false, gpuBackend: 'opengl' })).toBe(2);
  });
});

describe('pendingRestartKeysFor', () => {
  it('is empty when every local value is what this launch runs on', () => {
    const settings = settingsOf({ forceHighPerfGpu: true, gpuBackend: 0 });
    expect(pendingRestartKeysFor(LAUNCHED, linuxBridge(), settings)).toEqual([]);
  });

  it('names a changed backend, a changed GPU force, or both', () => {
    const bridge = linuxBridge();
    expect(
      pendingRestartKeysFor(
        LAUNCHED,
        bridge,
        settingsOf({ forceHighPerfGpu: true, gpuBackend: 2 }),
      ),
    ).toEqual(['gpuBackend']);
    expect(
      pendingRestartKeysFor(
        LAUNCHED,
        bridge,
        settingsOf({ forceHighPerfGpu: false, gpuBackend: 0 }),
      ),
    ).toEqual(['forceHighPerfGpu']);
    expect(
      pendingRestartKeysFor(
        LAUNCHED,
        bridge,
        settingsOf({ forceHighPerfGpu: false, gpuBackend: 1 }),
      ),
    ).toEqual(['forceHighPerfGpu', 'gpuBackend']);
  });

  it('compares against what launched, not against the defaults', () => {
    // Launched with the force off and OpenGL: those local values are quiet, and
    // the defaults would be the change.
    const launched: DesktopLaunchSettings = { gpuForceOptOut: true, gpuBackend: 'opengl' };
    const bridge = linuxBridge();
    expect(
      pendingRestartKeysFor(
        launched,
        bridge,
        settingsOf({ forceHighPerfGpu: false, gpuBackend: 2 }),
      ),
    ).toEqual([]);
    expect(
      pendingRestartKeysFor(
        launched,
        bridge,
        settingsOf({ forceHighPerfGpu: true, gpuBackend: 0 }),
      ),
    ).toEqual(['forceHighPerfGpu', 'gpuBackend']);
  });

  it('ignores a setting whose row this shell does not show', () => {
    // A transferred settings blob can carry a Linux backend choice onto Windows:
    // no row, no restart to offer for it.
    const settings = settingsOf({ forceHighPerfGpu: true, gpuBackend: 2 });
    expect(pendingRestartKeysFor(LAUNCHED, windowsBridge(), settings)).toEqual([]);
    expect(pendingRestartKeysFor(LAUNCHED, null, settings)).toEqual([]);
  });

  it('skips a setting the snapshot does not carry (an older shell)', () => {
    const notCarried = [
      { key: 'gpuBackend' as const, supported: () => true, launchValue: () => undefined },
    ];
    const settings = settingsOf({ forceHighPerfGpu: false, gpuBackend: 2 });
    expect(pendingRestartKeysFor(LAUNCHED, linuxBridge(), settings, notCarried)).toEqual([]);
  });

  it('is empty without a snapshot: no evidence, no offer', () => {
    const settings = settingsOf({ forceHighPerfGpu: false, gpuBackend: 2 });
    expect(pendingRestartKeysFor(null, linuxBridge(), settings)).toEqual([]);
    expect(pendingRestartKeysFor(undefined, linuxBridge(), settings)).toEqual([]);
  });
});

describe('syncDesktopLaunchSettings and pendingRestartKeys', () => {
  const changed = settingsOf({ forceHighPerfGpu: true, gpuBackend: 2 });

  it("latches the shell's answer at boot, which the pending check then reads", async () => {
    const bridge = linuxBridge({ getLaunchSettings: () => Promise.resolve(LAUNCHED) });
    expect(pendingRestartKeys(bridge, changed)).toEqual([]);
    await syncDesktopLaunchSettings(bridge);
    expect(pendingRestartKeys(bridge, changed)).toEqual(['gpuBackend']);
  });

  it('latches nothing on a missing getter, a rejected read, or a malformed answer', async () => {
    await syncDesktopLaunchSettings(linuxBridge());
    await syncDesktopLaunchSettings(null);
    await syncDesktopLaunchSettings(
      linuxBridge({ getLaunchSettings: () => Promise.reject(new Error('gone')) }),
    );
    await syncDesktopLaunchSettings(
      linuxBridge({ getLaunchSettings: () => Promise.resolve({ gpuBackend: 'auto' } as never) }),
    );
    await syncDesktopLaunchSettings(
      linuxBridge({
        getLaunchSettings: () =>
          Promise.resolve({ gpuForceOptOut: false, gpuBackend: 'metal' } as never),
      }),
    );
    await syncDesktopLaunchSettings(linuxBridge({ getLaunchSettings: () => null as never }));
    expect(pendingRestartKeys(linuxBridge(), changed)).toEqual([]);
  });
});

describe('the restart request', () => {
  it('needs the bridge method', () => {
    expect(desktopRestartSupported(linuxBridge())).toBe(false);
    expect(desktopRestartSupported(linuxBridge({ restartApp: () => Promise.resolve(true) }))).toBe(
      true,
    );
    expect(desktopRestartSupported(null)).toBe(false);
  });

  it("answers the shell's verdict, and false for anything but a true", async () => {
    const restartApp = vi.fn(() => Promise.resolve(true));
    await expect(requestDesktopRestart(linuxBridge({ restartApp }))).resolves.toBe(true);
    expect(restartApp).toHaveBeenCalledTimes(1);
    await expect(
      requestDesktopRestart(linuxBridge({ restartApp: () => Promise.resolve(false) })),
    ).resolves.toBe(false);
    await expect(
      requestDesktopRestart(linuxBridge({ restartApp: () => Promise.resolve('yes' as never) })),
    ).resolves.toBe(false);
  });

  it('is total: a missing method, a throwing channel and a rejection all answer false', async () => {
    await expect(requestDesktopRestart(linuxBridge())).resolves.toBe(false);
    await expect(requestDesktopRestart(null)).resolves.toBe(false);
    await expect(
      requestDesktopRestart(
        linuxBridge({
          restartApp: () => {
            throw new Error('channel gone');
          },
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      requestDesktopRestart(linuxBridge({ restartApp: () => Promise.reject(new Error('no')) })),
    ).resolves.toBe(false);
  });
});
