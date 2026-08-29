// The renderer half of the desktop shell's graphics backend choice
// (src/game/desktop_gpu_backend_sync.ts): the capability probe, the
// platform gate the shell answers, the boot reflection in and the push out.

import { afterEach, describe, expect, it } from 'vitest';
import {
  desktopGpuBackendActive,
  desktopGpuBackendSupported,
  GPU_BACKEND_SETTING_VALUES,
  gpuBackendSettingFromValue,
  gpuBackendValueFromSetting,
  initDesktopGpuBackendActive,
  onDesktopGpuBackendActiveChange,
  pushDesktopGpuBackend,
  resetDesktopGpuBackendActiveForTest,
  syncDesktopGpuBackendSetting,
} from '../src/game/desktop_gpu_backend_sync';
import type { DesktopBridge, DesktopGpuBackendState } from '../src/runtime';

afterEach(() => {
  resetDesktopGpuBackendActiveForTest();
});

function fakeSettingsFactory() {
  const writes: { key: string; value: number }[] = [];
  return {
    writes,
    create: () => ({
      set(key: 'gpuBackend', value: number): number {
        writes.push({ key, value });
        return value;
      },
    }),
  };
}

function bridgeAnswering(
  state: DesktopGpuBackendState | (() => Promise<unknown>),
  hasGpuBackendChoice = true,
) {
  const written: unknown[] = [];
  const bridge = {
    hasGpuBackendChoice,
    getGpuBackend: typeof state === 'function' ? state : () => Promise.resolve(state),
    setGpuBackend: (value: unknown) => {
      written.push(value);
      return Promise.resolve(true);
    },
  } as unknown as DesktopBridge;
  return { bridge, written };
}

describe('the value mapping', () => {
  it('round-trips the three settings and treats anything else as auto', () => {
    for (const setting of ['auto', 'vulkan', 'opengl'] as const) {
      expect(gpuBackendSettingFromValue(gpuBackendValueFromSetting(setting))).toBe(setting);
    }
    expect(gpuBackendSettingFromValue(1.4)).toBe('vulkan');
    expect(gpuBackendSettingFromValue(9)).toBe('auto');
    expect(gpuBackendValueFromSetting('bogus')).toBe(GPU_BACKEND_SETTING_VALUES.auto);
  });
});

describe('desktopGpuBackendSupported', () => {
  it('needs both bridge methods, and never the shell flag alone', () => {
    expect(desktopGpuBackendSupported(null)).toBe(false);
    expect(desktopGpuBackendSupported({} as DesktopBridge)).toBe(false);
    expect(
      desktopGpuBackendSupported({
        getGpuBackend: () => Promise.resolve(),
      } as unknown as DesktopBridge),
    ).toBe(false);
    expect(desktopGpuBackendSupported(bridgeAnswering({ setting: 'auto' }).bridge)).toBe(true);
  });
});

describe('syncDesktopGpuBackendSetting', () => {
  it('reflects the stored setting into the local store', async () => {
    const { bridge } = bridgeAnswering({ setting: 'opengl' });
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(bridge, factory.create);
    expect(factory.writes).toEqual([
      { key: 'gpuBackend', value: GPU_BACKEND_SETTING_VALUES.opengl },
    ]);
  });

  it('reads the extra fields the shell answers (the trial verdict) as nothing', async () => {
    const { bridge } = bridgeAnswering(() => Promise.resolve({ setting: 'vulkan', verdict: 'ok' }));
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(bridge, factory.create);
    expect(factory.writes).toEqual([
      { key: 'gpuBackend', value: GPU_BACKEND_SETTING_VALUES.vulkan },
    ]);
  });

  it('writes nothing on a missing method, a rejected read, or a malformed answer', async () => {
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(null, factory.create);
    await syncDesktopGpuBackendSetting({} as DesktopBridge, factory.create);
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.reject(new Error('gone'))).bridge,
      factory.create,
    );
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.resolve('vulkan')).bridge,
      factory.create,
    );
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.resolve({ setting: 'bogus' })).bridge,
      factory.create,
    );
    expect(factory.writes).toEqual([]);
  });
});

describe('pushDesktopGpuBackend', () => {
  it('sends the setting name the stored number means', async () => {
    const { bridge, written } = bridgeAnswering({ setting: 'auto' });
    pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.vulkan);
    pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.opengl);
    pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.auto);
    await Promise.resolve();
    expect(written).toEqual(['vulkan', 'opengl', 'auto']);
  });

  it('swallows a missing setter, a throwing channel and a rejected write', async () => {
    expect(() => pushDesktopGpuBackend(null, 1)).not.toThrow();
    expect(() => pushDesktopGpuBackend({} as DesktopBridge, 1)).not.toThrow();
    expect(() =>
      pushDesktopGpuBackend(
        {
          getGpuBackend: () => Promise.resolve(),
          setGpuBackend: () => {
            throw new Error('channel closed');
          },
        } as unknown as DesktopBridge,
        1,
      ),
    ).not.toThrow();
    expect(() =>
      pushDesktopGpuBackend(
        {
          getGpuBackend: () => Promise.resolve(),
          setGpuBackend: () => Promise.reject(new Error('no')),
        } as unknown as DesktopBridge,
        1,
      ),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('the latched reading and its subscribers', () => {
  // The shell judges the launch seconds after boot, so a surface built before
  // the verdict (the options graphics panel) has to learn it from here.
  function pushingBridge() {
    let push: ((state: unknown) => void) | null = null;
    let subscriptions = 0;
    const bridge = {
      onGpuBackendState: (callback: (state: unknown) => void) => {
        subscriptions += 1;
        push = callback;
        return () => {
          subscriptions -= 1;
          push = null;
        };
      },
    } as unknown as DesktopBridge;
    return {
      bridge,
      send: (state: unknown) => push?.(state),
      liveSubscriptions: () => subscriptions,
    };
  }

  it('wakes subscribers when the reading changes, and stays quiet on an identical re-push', () => {
    const shell = pushingBridge();
    const off = initDesktopGpuBackendActive(shell.bridge);
    let wakes = 0;
    const unsubscribe = onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });

    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(wakes).toBe(1);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });

    // The shell resends its state on its own schedule; a rebuild per resend
    // would throw away the control the player is standing on.
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(wakes).toBe(1);

    // Either field moving is a different reading, and the row says something else.
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: true,
    });
    expect(wakes).toBe(2);
    shell.send({ setting: 'vulkan', active: 'opengl', requestedUnavailable: true });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({ active: 'opengl', requestedUnavailable: true });

    // A payload with nothing to say keeps the reading AND stays silent: an
    // unjudged rung is absent, never a guess.
    shell.send({ setting: 'vulkan' });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({ active: 'opengl', requestedUnavailable: true });

    unsubscribe();
    shell.send({ setting: 'auto', active: 'vulkan-plain', requestedUnavailable: false });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-plain',
      requestedUnavailable: false,
    });
    off();
    expect(shell.liveSubscriptions()).toBe(0);
  });

  it('wakes them for the boot read too, which carries the same payload', async () => {
    let wakes = 0;
    onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });
    const { bridge } = bridgeAnswering({
      setting: 'vulkan',
      active: 'vulkan-plain',
      requestedUnavailable: true,
    });
    await syncDesktopGpuBackendSetting(bridge, fakeSettingsFactory().create);
    expect(wakes).toBe(1);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-plain',
      requestedUnavailable: true,
    });
  });

  it('subscribes to nothing on a shell without the push channel', () => {
    expect(initDesktopGpuBackendActive(null)).toBeTypeOf('function');
    expect(() => initDesktopGpuBackendActive({} as DesktopBridge)()).not.toThrow();
    expect(desktopGpuBackendActive()).toBeNull();
  });
});
