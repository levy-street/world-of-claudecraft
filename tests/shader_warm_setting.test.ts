// @vitest-environment happy-dom
// The player's shader warm-up option (src/game/shader_warm_setting.ts): the
// stored number to the client's setting, the registration the client reads at
// its first policy call, and the settings broadcast that keeps the row LIVE
// (the option is not a graphics rebuild key, so nothing else re-reads it).

import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_CHANGE_EVENT } from '../src/game/settings';
import {
  registerShaderWarmSetting,
  SHADER_WARM_SETTING_VALUES,
  shaderWarmSettingFromValue,
} from '../src/game/shader_warm_setting';
import {
  armShaderWarm,
  noteShaderWarmHold,
  resetShaderWarmForTest,
  setShaderWarmStoredSettingSource,
  shaderWarmAvailable,
  shaderWarmDecide,
  shaderWarmSnapshot,
} from '../src/render/shader_warm_client';
import { SHADER_WARM_TIMEOUT_BREAKER } from '../src/render/shader_warm_client_core';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

afterEach(() => {
  setShaderWarmStoredSettingSource(() => null);
  resetShaderWarmForTest();
});

describe('shaderWarmSettingFromValue', () => {
  it('maps the three stored numbers, nearest wins, anything else is auto', () => {
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.auto)).toBe('auto');
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.off)).toBe('off');
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.on)).toBe('all');
    expect(shaderWarmSettingFromValue(1.4)).toBe('off');
    expect(shaderWarmSettingFromValue(7)).toBe('auto');
    expect(shaderWarmSettingFromValue(Number.NaN)).toBe('auto');
  });

  it('never yields the probe-only reveal arm', () => {
    for (let value = -2; value <= 6; value += 0.5) {
      expect(shaderWarmSettingFromValue(value)).not.toBe('reveal');
    }
  });
});

describe('registerShaderWarmSetting', () => {
  it('hands the client the stored option, read at configure time', () => {
    let stored: number = SHADER_WARM_SETTING_VALUES.off;
    registerShaderWarmSetting(() => stored);
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('off');
    stored = SHADER_WARM_SETTING_VALUES.on;
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('all');
  });

  it('lets a probe query pin an arm over the stored option', () => {
    registerShaderWarmSetting(() => SHADER_WARM_SETTING_VALUES.off);
    resetShaderWarmForTest({ search: '?shaderwarm=reveal' });
    expect(shaderWarmSnapshot().setting).toBe('reveal');
  });

  it('reads the store once per configure, not per policy call', () => {
    let reads = 0;
    registerShaderWarmSetting(() => {
      reads++;
      return SHADER_WARM_SETTING_VALUES.off;
    });
    resetShaderWarmForTest({ search: '' });
    const context = { getContextAttributes: () => null, getExtension: () => null };
    for (let i = 0; i < 5; i++) shaderWarmDecide(context, 0, false);
    expect(reads).toBe(1);
    expect(shaderWarmSnapshot().mode).toBe('off');
  });

  it('answers OFF when the store throws, like an entry that never registered one', () => {
    registerShaderWarmSetting(() => {
      throw new Error('no store yet');
    });
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('off');
  });
});

/** A worker the client can spawn, ready and terminate, with no real Worker. */
function fakeWorker() {
  const worker = {
    terminations: 0,
    onmessage: null as ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: () => {},
    terminate() {
      worker.terminations++;
    },
    ready() {
      worker.onmessage?.({
        data: {
          kind: 'ready',
          ok: true,
          reason: null,
          extensions: [],
          adapter: 'Test Adapter',
        },
      } as unknown as MessageEvent<ShaderWarmWorkerMessage>);
    },
  };
  return worker;
}

const CONTEXT = { getContextAttributes: () => null, getExtension: () => null };

/** A context whose renderer string names the one backend `auto` warms on
 *  (gpu_backend_class_core.ts, WORKER_WORTH_BACKENDS). */
const D3D11_CONTEXT = {
  getContextAttributes: () => null,
  getExtension: (name: string) =>
    name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
  getParameter: () => 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
};

describe('the shader warm row is live', () => {
  /** Arm a ready worker on the stored value the reader answers with, then hand
   *  back the workers spawned so far. */
  function armWorker(
    readValue: () => number,
    context: typeof CONTEXT | typeof D3D11_CONTEXT = CONTEXT,
  ) {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    registerShaderWarmSetting(readValue);
    resetShaderWarmForTest({
      search: '',
      platform: 'other',
      spawn: () => {
        const worker = fakeWorker();
        workers.push(worker);
        return worker;
      },
      schedule: () => () => {},
    });
    armShaderWarm();
    shaderWarmDecide(context, 0, false);
    workers[workers.length - 1]?.ready();
    return workers;
  }

  it('retires the worker when the player switches the row to Off', () => {
    // Without this the worker, its second WebGL2 context and every gate's hold
    // outlive the switch for the whole session: the option is not a graphics
    // rebuild key, so nothing rebuilds the renderer under it.
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const workers = armWorker(() => stored);
    expect(shaderWarmAvailable()).toBe(true);
    expect(workers[0].terminations).toBe(0);

    stored = SHADER_WARM_SETTING_VALUES.off;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(workers[0].terminations).toBe(1);
    expect(shaderWarmAvailable()).toBe(false);
    const snapshot = shaderWarmSnapshot();
    expect(snapshot.setting).toBe('off');
    expect(snapshot.mode).toBe('off');
    expect(snapshot.worker).toBe('idle');
    expect(shaderWarmDecide(CONTEXT, 0, false)).toEqual({ hold: false, bypass: 'mode-off' });
    // The policy call above must not have spawned a replacement.
    expect(workers).toHaveLength(1);
  });

  it('starts a fresh worker when the player switches the row back on', () => {
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const workers = armWorker(() => stored);
    stored = SHADER_WARM_SETTING_VALUES.off;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    stored = SHADER_WARM_SETTING_VALUES.on;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(shaderWarmSnapshot().mode).toBe('all');
    shaderWarmDecide(CONTEXT, 0, false);
    workers[workers.length - 1]?.ready();
    expect(workers).toHaveLength(2);
    expect(shaderWarmAvailable()).toBe(true);
  });

  it('keeps a worker retired for cause retired across Off and back on', () => {
    // The breaker retires a worker for the renderer's life. Off then On is a
    // setting round trip, not a new renderer: respawning here would hand the
    // gates back the worker the breaker just ruled out, and the drift case
    // (an extension the game context enabled and the worker's has not) would
    // never heal at all.
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const workers = armWorker(() => stored);
    for (let expiry = 0; expiry < SHADER_WARM_TIMEOUT_BREAKER; expiry++) {
      noteShaderWarmHold(false, true, 5_000);
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'dead', refusal: 'hold-timeouts:wedged' });

    stored = SHADER_WARM_SETTING_VALUES.off;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'dead', refusal: 'hold-timeouts:wedged' });

    stored = SHADER_WARM_SETTING_VALUES.on;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    shaderWarmDecide(CONTEXT, 0, false);

    expect(workers).toHaveLength(1);
    expect(shaderWarmAvailable()).toBe(false);
    expect(shaderWarmSnapshot()).toMatchObject({
      mode: 'all',
      worker: 'dead',
      refusal: 'hold-timeouts:wedged',
    });
  });

  it('retires the worker when Auto lands on a backend it is not worth on', () => {
    // Auto follows the backend: the stub context names none, so the row moving
    // from On to Auto resolves to off and the worker goes with it.
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const workers = armWorker(() => stored);
    expect(shaderWarmAvailable()).toBe(true);

    stored = SHADER_WARM_SETTING_VALUES.auto;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(shaderWarmSnapshot()).toMatchObject({ setting: 'auto', mode: 'off', worker: 'idle' });
    expect(workers[0].terminations).toBe(1);
    expect(shaderWarmDecide(CONTEXT, 0, false)).toEqual({ hold: false, bypass: 'mode-off' });
    expect(workers).toHaveLength(1);
  });

  it('keeps the worker when Auto lands on a backend it is worth on', () => {
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const workers = armWorker(() => stored, D3D11_CONTEXT);

    stored = SHADER_WARM_SETTING_VALUES.auto;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(shaderWarmSnapshot()).toMatchObject({
      setting: 'auto',
      mode: 'all',
      backend: 'd3d11',
      worker: 'ready',
    });
    expect(workers[0].terminations).toBe(0);
    expect(shaderWarmAvailable()).toBe(true);
  });

  it('re-latches the iOS refusal when the row moves off Off there', () => {
    // iOS is off whatever the setting (a second context is a per-process
    // ceiling risk), and the readout has to keep saying why: the round trip
    // through retireAndForgetWorker clears the refusal, so it is re-asserted.
    let stored: number = SHADER_WARM_SETTING_VALUES.off;
    registerShaderWarmSetting(() => stored);
    resetShaderWarmForTest({ search: '', platform: 'ios' });
    expect(shaderWarmSnapshot()).toMatchObject({ setting: 'off', refusal: null });

    stored = SHADER_WARM_SETTING_VALUES.on;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(shaderWarmSnapshot()).toMatchObject({
      setting: 'all',
      mode: 'off',
      refusal: 'ios-webkit',
    });
    expect(shaderWarmDecide(CONTEXT, 0, false)).toEqual({ hold: false, bypass: 'mode-off' });
  });

  it('subscribes to the settings broadcast once, however often the row registers', () => {
    // The subscription is a module-scope latch: a second listener would make
    // every persisted write handle the change twice for the rest of the page.
    let reads = 0;
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    const readValue = () => {
      reads++;
      return stored;
    };
    registerShaderWarmSetting(readValue);
    registerShaderWarmSetting(readValue);
    resetShaderWarmForTest({ search: '', platform: 'other' });

    reads = 0;
    stored = SHADER_WARM_SETTING_VALUES.off;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));

    expect(reads).toBe(1);
    expect(shaderWarmSnapshot().setting).toBe('off');
  });

  it('leaves a query-pinned probe arm alone whatever the store says', () => {
    let stored: number = SHADER_WARM_SETTING_VALUES.on;
    registerShaderWarmSetting(() => stored);
    resetShaderWarmForTest({ search: '?shaderwarm=all', platform: 'other' });
    stored = SHADER_WARM_SETTING_VALUES.off;
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(shaderWarmSnapshot().setting).toBe('all');
  });
});
