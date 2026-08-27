// The renderer half of the desktop shell's graphics backend choice
// (src/game/desktop_gpu_backend_sync.ts): the capability probe, the
// platform gate the shell answers, the boot reflection in and the push out.

import { describe, expect, it } from 'vitest';
import {
  desktopGpuBackendSupported,
  GPU_BACKEND_SETTING_VALUES,
  gpuBackendSettingFromValue,
  gpuBackendValueFromSetting,
  pushDesktopGpuBackend,
  syncDesktopGpuBackendSetting,
} from '../src/game/desktop_gpu_backend_sync';
import type { DesktopBridge, DesktopGpuBackendState } from '../src/runtime';

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
