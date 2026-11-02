import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompileArmHost } from '../src/render/compile_arms';
import type { IdleBudget } from '../src/render/idle_queue';
import {
  runZoneBackgroundPrewarm,
  runZonePrewarmTask,
  type ZoneBackgroundPrewarmHost,
} from '../src/render/zone_prewarm';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('blocking arrival joins background zone prewarm', () => {
  function idleCallbacks() {
    vi.useFakeTimers();
    const callbacks: Array<(budget: IdleBudget) => void> = [];
    const request = vi.fn((callback: (budget: IdleBudget) => void) => callbacks.push(callback));
    vi.stubGlobal('requestIdleCallback', request);
    return { callbacks, request };
  }

  it('wakes an already waiting zone without rebuilding and yields each remaining unit', async () => {
    const { callbacks, request } = idleCallbacks();
    const tasks: Array<() => void> = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback) => {
      tasks.push(callback as () => void);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const pending = new Map<string, Promise<void>>();
    const events: string[] = [];
    const build = vi.fn(async (pacing: { wait(): Promise<unknown> }) => {
      await pacing.wait();
      events.push('compile');
      await pacing.wait();
      events.push('upload');
    });
    const original = runZonePrewarmTask(pending, 'vale', true, build);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 250 });
    const joined = runZonePrewarmTask(pending, 'vale', false, build);
    expect(joined).toBe(original);
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(tasks).toHaveLength(1);
    tasks.shift()?.();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    expect(events).toEqual(['compile']);
    expect(tasks).toHaveLength(1);
    tasks.shift()?.();
    await joined;
    expect(events).toEqual(['compile', 'upload']);
    expect(build).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    // The original browser idle callback may still arrive after promotion.
    callbacks[0]({ didTimeout: true, timeRemaining: () => 0 });
    await Promise.resolve();
    expect(events).toEqual(['compile', 'upload']);
  });

  it('keeps unrelated zones and background joins at their original idle pace', async () => {
    const { callbacks } = idleCallbacks();
    const pending = new Map<string, Promise<void>>();
    const events: string[] = [];
    const first = runZonePrewarmTask(pending, 'vale', true, async (pacing) => {
      await pacing.wait();
      events.push('vale');
    });
    const otherWork = vi.fn(async (pacing: { wait(): Promise<unknown> }) => {
      await pacing.wait();
      events.push('marsh');
    });
    const other = runZonePrewarmTask(pending, 'marsh', true, otherWork);
    expect(runZonePrewarmTask(pending, 'marsh', true, otherWork)).toBe(other);
    await Promise.resolve();
    runZonePrewarmTask(pending, 'vale', false, async () => {});
    await vi.runAllTimersAsync();
    await first;
    expect(events).toEqual(['vale']);
    expect(pending.has('marsh')).toBe(true);
    callbacks[1]({ didTimeout: false, timeRemaining: () => 5 });
    await other;
    expect(events).toEqual(['vale', 'marsh']);
    expect(otherWork).toHaveBeenCalledOnce();
  });

  it('retains the three-timeout background fallback and permits retry after failure', async () => {
    const { callbacks } = idleCallbacks();
    const pending = new Map<string, Promise<void>>();
    const first = runZonePrewarmTask(pending, 'vale', true, async (pacing) => {
      await pacing.wait();
      throw new Error('link failed');
    });
    const failure = expect(first).rejects.toThrow('link failed');
    await Promise.resolve();
    for (let index = 0; index < 2; index++) {
      callbacks[index]({ didTimeout: true, timeRemaining: () => 0 });
      await Promise.resolve();
      expect(pending.has('vale')).toBe(true);
    }
    callbacks[2]({ didTimeout: true, timeRemaining: () => 0 });
    await failure;
    expect(pending.size).toBe(0);
    const retry = vi.fn(async () => {});
    await runZonePrewarmTask(pending, 'vale', false, retry);
    expect(retry).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
  });
});

describe('zone prewarm GPU units', () => {
  function fixture() {
    const group = new THREE.Group();
    const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    group.add(
      new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
          map: textures[0],
          normalMap: textures[1],
          roughnessMap: textures[2],
        }),
      ),
    );
    const events: string[] = [];
    const batches: number[] = [];
    const priorities: number[] = [];
    const host: ZoneBackgroundPrewarmHost = {
      supportsAsyncCompile: true,
      arms: {} as CompileArmHost,
      queue: {
        async run(work, priority) {
          priorities.push(priority ?? Number.NaN);
          const before = events.filter((event) => event === 'texture').length;
          const result = await work();
          const count = events.filter((event) => event === 'texture').length - before;
          if (count) batches.push(count);
          return result;
        },
      },
      compileColor: async () => {
        events.push('color');
      },
      compileShadow: async () => {
        events.push('shadow');
      },
      prepareAssets: () => {
        events.push('assets');
      },
      uploadTexture: () => {
        events.push('texture');
      },
      renderRoot: () => {
        expect(group.visible).toBe(false);
        events.push('render');
      },
      renderWarmPass: () => {
        events.push('whole scene');
      },
    };
    const wait = vi.fn(async () => ({
      forcedProgress: false,
      source: 'idle' as const,
      timeRemainingMs: 5,
    }));
    return { group, host, events, batches, priorities, wait };
  }

  it('preserves color/shadow ordering, two-texture batches and the visible queue priority', async () => {
    const f = fixture();
    await runZoneBackgroundPrewarm([f.group], f.host, { wait: f.wait });
    expect(f.events).toEqual(['color', 'shadow', 'texture', 'texture', 'texture', 'render']);
    expect(f.batches).toEqual([2, 1]);
    expect(f.priorities).toEqual([20, 20, 20, 20, 20]);
    expect(f.wait).toHaveBeenCalledTimes(4);
    expect(f.group.visible).toBe(false);
  });

  it('does not render or upload a child whose shader compile rejected', async () => {
    const f = fixture();
    f.host.compileShadow = async () => {
      throw new Error('shadow failed');
    };
    await expect(runZoneBackgroundPrewarm([f.group], f.host, { wait: f.wait })).rejects.toThrow(
      'shadow failed',
    );
    expect(f.events).toEqual(['color']);
    expect(f.group.visible).toBe(false);
  });

  it('keeps the synchronous-driver asset-only path', async () => {
    const f = fixture();
    f.host.supportsAsyncCompile = false;
    await runZoneBackgroundPrewarm([f.group], f.host, { wait: f.wait });
    expect(f.events).toEqual(['assets']);
    expect(f.priorities).toEqual([20]);
    expect(f.group.visible).toBe(false);
  });
});
