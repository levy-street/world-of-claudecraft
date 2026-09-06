// src/game/gpu_adapter_probe.ts: the one-time WebGPU high-performance adapter
// probe the perf reporter reads. Its whole contract is what it does when things
// go WRONG, because on a large slice of the fleet they do: WebGPU is absent,
// the context is insecure, the adapter is refused, the driver throws, or the
// promise never settles. Every one of those arms must answer null, none may
// reject, and none may put a line in a player's console.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createGpuAdapterProbe,
  describeGpuAdapterInfo,
  GPU_ADAPTER_DESCRIPTION_MAX,
  GPU_ADAPTER_PROBE_TIMEOUT_MS,
  type GpuLike,
  probeGpuHighPerformanceAdapter,
} from '../src/game/gpu_adapter_probe';

/** A fake navigator.gpu whose adapter is whatever the caller hands back. */
function fakeGpu(requestAdapter: GpuLike['requestAdapter']): GpuLike {
  return { requestAdapter };
}

const ADAPTER_4070 = {
  info: {
    vendor: 'nvidia',
    architecture: 'ada-lovelace',
    device: '',
    description: 'NVIDIA GeForce RTX 4070 Laptop GPU',
  },
};

describe('probeGpuHighPerformanceAdapter failure arms', () => {
  it('answers null on every way WebGPU can be missing or refuse', async () => {
    // No navigator.gpu at all (Safari before 18, Firefox, any locked-down build).
    await expect(probeGpuHighPerformanceAdapter({ gpu: null })).resolves.toBe(null);
    // A navigator.gpu object without the method (a shim, or a partial polyfill).
    await expect(probeGpuHighPerformanceAdapter({ gpu: {} })).resolves.toBe(null);
    await expect(
      probeGpuHighPerformanceAdapter({ gpu: { requestAdapter: 'nope' } as unknown as GpuLike }),
    ).resolves.toBe(null);
    // The adapter was refused: no matching GPU, or a blocklisted driver.
    await expect(probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => null) })).resolves.toBe(
      null,
    );
    await expect(
      probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => undefined) }),
    ).resolves.toBe(null);
  });

  it('answers null for the CPU fallback adapter, on BOTH homes of the flag', async () => {
    // A fallback adapter is the browser's software implementation. Its
    // description names a rasterizer, which the server's parser keys
    // 'software', and stored beside the WebGL model that reads as "this
    // machine renders in software" when it means the opposite: WebGPU had no
    // hardware adapter to offer, and WebGL may be on a real GPU. No evidence
    // is the honest answer, so this joins the other null arms.

    // The SHIPPING shape, and the one that matters: the flag was removed from
    // GPUAdapter and moved onto GPUAdapterInfo, so a current Chrome carries
    // NOTHING on the adapter and answers this info for a fallback. An
    // adapter-level check alone is a no-op here, and 'google swiftshader'
    // sails through to the server as the 'software' key.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          info: {
            vendor: 'google',
            architecture: 'swiftshader',
            device: '',
            description: '',
            isFallbackAdapter: true,
          },
        })),
      }),
    ).resolves.toBe(null);
    // The same flag reached through the legacy requestAdapterInfo() call.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          requestAdapterInfo: async () => ({
            description: 'Google SwiftShader',
            isFallbackAdapter: true,
          }),
        })),
      }),
    ).resolves.toBe(null);
    // The flag's OLD home, on the adapter itself, for the browsers that still
    // carry it there and never populate the info copy.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          isFallbackAdapter: true,
          info: { vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader' },
        })),
      }),
    ).resolves.toBe(null);
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          isFallbackAdapter: true,
          requestAdapterInfo: async () => ({ description: 'Google SwiftShader' }),
        })),
      }),
    ).resolves.toBe(null);
    // A hardware adapter is unaffected, with the flag false in either home or
    // absent from both.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({ isFallbackAdapter: false, ...ADAPTER_4070 })),
      }),
    ).resolves.toBe('NVIDIA GeForce RTX 4070 Laptop GPU');
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          info: { ...ADAPTER_4070.info, isFallbackAdapter: false },
        })),
      }),
    ).resolves.toBe('NVIDIA GeForce RTX 4070 Laptop GPU');
    await expect(
      probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => ADAPTER_4070) }),
    ).resolves.toBe('NVIDIA GeForce RTX 4070 Laptop GPU');
  });

  it('answers null, never rejects, when the driver throws or rejects', async () => {
    // An insecure context rejects with a DOMException-shaped error.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => {
          throw new Error('WebGPU is not available in an insecure context');
        }),
      }),
    ).resolves.toBe(null);
    // A SYNCHRONOUS throw out of requestAdapter, which a plain await chain
    // would let escape as a rejection into the caller.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu((() => {
          throw new Error('driver exploded');
        }) as GpuLike['requestAdapter']),
      }),
    ).resolves.toBe(null);
    // A throwing info getter, reached only after the adapter resolved.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          get info() {
            throw new Error('info exploded');
          },
        })),
      }),
    ).resolves.toBe(null);
    // The legacy call shape, rejecting.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          requestAdapterInfo: async () => {
            throw new Error('no info for you');
          },
        })),
      }),
    ).resolves.toBe(null);
    // An adapter that resolved but carries no readable info at all.
    await expect(probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => ({})) })).resolves.toBe(
      null,
    );
    await expect(
      probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => ({ info: {} })) }),
    ).resolves.toBe(null);
  });

  it('answers null on a promise that never settles, and clears its own timer', async () => {
    let fire: (() => void) | null = null;
    let cleared = 0;
    const promise = probeGpuHighPerformanceAdapter({
      // The wedged-driver arm: requestAdapter simply never resolves.
      gpu: fakeGpu(() => new Promise(() => {})),
      setTimer: (fn) => {
        fire = fn;
        return 'handle';
      },
      clearTimer: (handle) => {
        expect(handle).toBe('handle');
        cleared++;
      },
    });
    expect(fire).not.toBe(null);
    (fire as unknown as () => void)();
    await expect(promise).resolves.toBe(null);
    // Cleared even though the TIMEOUT is the arm that won: an uncleared 2s
    // timer would hold its callback for nothing on every session.
    expect(cleared).toBe(1);
  });

  it('clears the timer on the happy arm too, and asks for the high-performance adapter', async () => {
    let cleared = 0;
    const requestAdapter = vi.fn(async () => ADAPTER_4070);
    await probeGpuHighPerformanceAdapter({
      gpu: fakeGpu(requestAdapter),
      setTimer: () => 'handle',
      clearTimer: () => {
        cleared++;
      },
    });
    expect(cleared).toBe(1);
    // The whole point of the field: the DEFAULT adapter on a hybrid laptop is
    // the integrated one, so asking for it would answer the wrong question.
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
  });

  it('never writes to the console on any arm', async () => {
    const spies = (['error', 'warn', 'log', 'info'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    try {
      await probeGpuHighPerformanceAdapter({ gpu: null });
      await probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => {
          throw new Error('driver exploded');
        }),
      });
      await probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => ADAPTER_4070) });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('probeGpuHighPerformanceAdapter happy arms', () => {
  it('reads adapter.info.description', async () => {
    await expect(
      probeGpuHighPerformanceAdapter({ gpu: fakeGpu(async () => ADAPTER_4070) }),
    ).resolves.toBe('NVIDIA GeForce RTX 4070 Laptop GPU');
  });

  it('falls back to requestAdapterInfo() when the adapter carries no info', async () => {
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          requestAdapterInfo: async () => ({ description: 'Apple M4 Pro' }),
        })),
      }),
    ).resolves.toBe('Apple M4 Pro');
    // The legacy shape is allowed to be synchronous too.
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({ requestAdapterInfo: () => ({ description: 'Apple M2' }) })),
      }),
    ).resolves.toBe('Apple M2');
  });

  it('prefers info over the legacy call when both are present', async () => {
    await expect(
      probeGpuHighPerformanceAdapter({
        gpu: fakeGpu(async () => ({
          info: { description: 'from info' },
          requestAdapterInfo: async () => ({ description: 'from the legacy call' }),
        })),
      }),
    ).resolves.toBe('from info');
  });
});

describe('describeGpuAdapterInfo', () => {
  it('joins vendor, architecture and device when there is no description', () => {
    expect(describeGpuAdapterInfo({ vendor: 'nvidia', architecture: 'ampere', device: '' })).toBe(
      'nvidia ampere',
    );
    expect(describeGpuAdapterInfo({ vendor: 'intel', architecture: 'gen-12lp' })).toBe(
      'intel gen-12lp',
    );
  });

  it('clamps to the wire bound the server also enforces', () => {
    const long = describeGpuAdapterInfo({ description: 'x'.repeat(500) });
    expect(long?.length).toBe(GPU_ADAPTER_DESCRIPTION_MAX);
  });

  it('answers null for anything that carries no readable text', () => {
    expect(describeGpuAdapterInfo(null)).toBe(null);
    expect(describeGpuAdapterInfo(undefined)).toBe(null);
    expect(describeGpuAdapterInfo('a string')).toBe(null);
    expect(describeGpuAdapterInfo({})).toBe(null);
    expect(describeGpuAdapterInfo({ description: '   ' })).toBe(null);
    expect(describeGpuAdapterInfo({ vendor: 42, device: {} })).toBe(null);
  });
});

describe('createGpuAdapterProbe', () => {
  it('start() returns synchronously and is never awaited, even against a hung driver', async () => {
    let started = false;
    const probe = createGpuAdapterProbe({
      gpu: fakeGpu(() => {
        started = true;
        return new Promise(() => {});
      }),
      setTimer: () => 'handle',
      clearTimer: () => {},
    });
    // The boot-path contract: start() hands back undefined on the same tick,
    // the probe is already in flight, and value() is immediately readable. A
    // caller that awaited this would be blocked for the driver's whole stall.
    expect(probe.start()).toBeUndefined();
    expect(started).toBe(true);
    expect(probe.value()).toBe(null);
    // Still null after the microtask queue drains: nothing ever settles here.
    await Promise.resolve();
    expect(probe.value()).toBe(null);
  });

  it('caches the description once the probe settles, and probes only once', async () => {
    const requestAdapter = vi.fn(async () => ADAPTER_4070);
    const probe = createGpuAdapterProbe({ gpu: fakeGpu(requestAdapter) });
    expect(probe.value()).toBe(null);
    probe.start();
    probe.start();
    probe.start();
    // Settled by the time the reporter's first beacon (75s out) is built.
    await vi.waitFor(() => expect(probe.value()).toBe('NVIDIA GeForce RTX 4070 Laptop GPU'));
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('stays null forever when the probe fails, without ever throwing at the caller', async () => {
    const probe = createGpuAdapterProbe({
      gpu: fakeGpu(async () => {
        throw new Error('driver exploded');
      }),
    });
    expect(() => probe.start()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(probe.value()).toBe(null);
  });

  it('keeps a timeout short next to the reporter cadence', () => {
    // A probe that could outlive the first beacon would silently ship a null
    // dimension on the one report that matters most.
    expect(GPU_ADAPTER_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    expect(GPU_ADAPTER_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('boot-path wiring', () => {
  // Source pins, not behavior: the defect this guards against is a future edit
  // that makes the entry chain WAIT on a GPU driver, which no unit test of this
  // module could observe. The probe is started from startPerfReporter, which
  // main.ts already calls after the loading curtain has faded, so the probe can
  // never sit between the player and the first frame.
  const REPORTER = readFileSync('src/game/perf_reporter.ts', 'utf8');
  const MAIN = readFileSync('src/main.ts', 'utf8');

  it('starts the probe from the reporter, fire-and-forget, and never awaits it', () => {
    expect(REPORTER).toContain('const gpuAdapterProbe = createGpuAdapterProbe();');
    expect(REPORTER).toContain('gpuAdapterProbe.start();');
    // No await, no then, no promise handed to the caller: any of those would
    // put a driver round-trip on whatever path started the reporter.
    expect(REPORTER).not.toContain('await gpuAdapterProbe');
    expect(REPORTER).not.toContain('gpuAdapterProbe.start().');
    // The payload reads the CACHED value; it never re-probes per beacon.
    expect(REPORTER).toContain('gpuAdapterProbe.value()');
  });

  it('keeps main.ts out of the probe entirely, so the entry chain cannot wait on it', () => {
    // main.ts is a firewall: the probe has exactly one owner, and the entry
    // chain reaches it only through startPerfReporter's post-curtain call.
    expect(MAIN).not.toContain('gpu_adapter_probe');
    expect(MAIN).not.toContain('createGpuAdapterProbe');
    expect(MAIN).toContain('startPerfReporter({');
  });
});
