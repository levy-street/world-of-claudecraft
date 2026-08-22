import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS,
  type PortraitSnapshotRenderer,
  PortraitSnapshotTarget,
} from '../src/render/characters/portrait_snapshot';

// The PNG encode is the one DOM-touching step (jsdom has no 2D canvas backend),
// so it is stubbed; what this file pins is the PATH the adapter picks and the
// order it does GL work in, which is what the fix turns on.
vi.mock('../src/render/characters/portrait_png_encode', () => ({
  encodeCanvasPng: vi.fn(() => Promise.resolve('data:image/png;base64,sync')),
  encodeRgbaPngDataUrl: vi.fn(() => Promise.resolve('data:image/png;base64,async')),
}));

import { disposePortraitEncodeWorker } from '../src/render/characters/portrait_bitmap_encode';
import {
  encodeCanvasPng,
  encodeRgbaPngDataUrl,
} from '../src/render/characters/portrait_png_encode';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';

const SIZE = 4;

interface Harness {
  renderer: PortraitSnapshotRenderer;
  calls: string[];
  /** Fill the readback buffer the way readPixels would (bottom-up). */
  readback: {
    resolve(): void;
    /** Fulfil the way three does when the target has no framebuffer yet: no
     *  throw, no write, and `undefined` as the value. */
    resolveEmpty(): void;
    reject(): void;
    buffer: Uint8Array | null;
  };
}

function harness(
  opts: {
    withAsync?: boolean;
    contextLost?: boolean;
    throwOnRead?: boolean;
    outputColorSpace?: string;
  } = {},
): Harness {
  const calls: string[] = [];
  const readback: Harness['readback'] = {
    resolve: () => {},
    resolveEmpty: () => {},
    reject: () => {},
    buffer: null,
  };
  let current: THREE.WebGLRenderTarget | null = null;
  const renderer: PortraitSnapshotRenderer = {
    domElement: { id: 'portrait-canvas' } as unknown as HTMLCanvasElement,
    outputColorSpace: opts.outputColorSpace ?? THREE.SRGBColorSpace,
    getContext: () => ({ isContextLost: () => opts.contextLost === true }),
    getRenderTarget: () => current,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (target) => {
      calls.push(target ? 'bind-target' : 'unbind-target');
      current = target;
    },
  };
  if (opts.withAsync !== false) {
    renderer.readRenderTargetPixelsAsync = (_t, _x, _y, _w, _h, buffer) => {
      calls.push('read-async');
      if (opts.throwOnRead) throw new Error('no fence');
      readback.buffer = buffer;
      return new Promise<unknown>((resolve, reject) => {
        readback.resolve = () => resolve(buffer);
        readback.resolveEmpty = () => resolve(undefined);
        readback.reject = () => reject(new Error('readback failed'));
      });
    };
  }
  return { renderer, calls, readback };
}

describe('PortraitSnapshotTarget', () => {
  beforeEach(() => {
    vi.mocked(encodeCanvasPng).mockClear();
    vi.mocked(encodeRgbaPngDataUrl).mockClear();
  });

  it('renders into a target, unbinds, and reads back behind the fence', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const draw = vi.fn(() => {
      h.calls.push('draw');
    });
    const pending = snapshot.capture(h.renderer, draw);
    // The draw MUST already have happened: runPortraitPrewarm disposes the
    // subject as soon as it holds this promise.
    expect(draw).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(['bind-target', 'draw', 'unbind-target', 'read-async']);
    expect(h.renderer.getRenderTarget()).toBeNull();
    expect(h.readback.buffer?.length).toBe(SIZE * SIZE * 4);

    h.readback.resolve();
    await expect(pending).resolves.toBe('data:image/png;base64,async');
    expect(encodeRgbaPngDataUrl).toHaveBeenCalledTimes(1);
    expect(encodeCanvasPng).not.toHaveBeenCalled();
    const [bytes, width, height] = vi.mocked(encodeRgbaPngDataUrl).mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8ClampedArray);
    expect(width).toBe(SIZE);
    expect(height).toBe(SIZE);
  });

  // The colorSpace assignment is what selects the sRGB internal format
  // (SRGB8_ALPHA8), which is what makes the GPU encode linear to sRGB as the
  // framebuffer is written. Drop it and every portrait comes back dark.
  it('gives the target the renderer output colour space, so the GPU encodes on write', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    let bound: THREE.WebGLRenderTarget | null = null;
    const spy = h.renderer.setRenderTarget.bind(h.renderer);
    h.renderer.setRenderTarget = (target, face, mip) => {
      if (target) bound = target;
      spy(target, face, mip);
    };
    void snapshot.capture(h.renderer, () => {});
    const target = bound as THREE.WebGLRenderTarget | null;
    expect(target).not.toBeNull();
    expect(target?.samples).toBeGreaterThan(0);
    expect(target?.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(target?.texture.generateMipmaps).toBe(false);
    expect(target?.width).toBe(SIZE);
  });

  it('reads that colour space off the renderer rather than hardcoding it', async () => {
    const h = harness({ outputColorSpace: THREE.LinearSRGBColorSpace });
    const snapshot = new PortraitSnapshotTarget(SIZE);
    let bound: THREE.WebGLRenderTarget | null = null;
    const spy = h.renderer.setRenderTarget.bind(h.renderer);
    h.renderer.setRenderTarget = (target, face, mip) => {
      if (target) bound = target;
      spy(target, face, mip);
    };
    void snapshot.capture(h.renderer, () => {});
    expect((bound as THREE.WebGLRenderTarget | null)?.texture.colorSpace).toBe(
      THREE.LinearSRGBColorSpace,
    );
  });

  it('reuses one target and one readback buffer across captures', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    void snapshot.capture(h.renderer, () => {});
    const first = h.readback.buffer;
    h.readback.resolve();
    void snapshot.capture(h.renderer, () => {});
    expect(h.readback.buffer).toBe(first);
  });

  it('falls back to the synchronous canvas path when there is no async readback', async () => {
    const h = harness({ withAsync: false });
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const draw = vi.fn();
    await expect(snapshot.capture(h.renderer, draw)).resolves.toBe('data:image/png;base64,sync');
    expect(draw).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([]);
    expect(encodeCanvasPng).toHaveBeenCalledWith(h.renderer.domElement);
  });

  it('falls back on a lost context rather than dropping the portrait', async () => {
    const h = harness({ contextLost: true });
    const snapshot = new PortraitSnapshotTarget(SIZE);
    await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
      'data:image/png;base64,sync',
    );
    expect(encodeCanvasPng).toHaveBeenCalledTimes(1);
  });

  it('re-draws through the fallback when issuing the readback throws', async () => {
    const h = harness({ throwOnRead: true });
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const draw = vi.fn();
    await expect(snapshot.capture(h.renderer, draw)).resolves.toBe('data:image/png;base64,sync');
    // Drawn twice: once into the target, once into the restored framebuffer.
    expect(draw).toHaveBeenCalledTimes(2);
    expect(h.renderer.getRenderTarget()).toBeNull();
  });

  it('latches after a rejected readback so the next capture goes synchronous', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {});
    h.readback.reject();
    await expect(first).resolves.toBeNull();

    h.calls.length = 0;
    await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
      'data:image/png;base64,sync',
    );
    expect(h.calls).toEqual([]);
  });

  it('latches when the encode cannot produce a data URL', async () => {
    vi.mocked(encodeRgbaPngDataUrl).mockResolvedValueOnce(null);
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {});
    h.readback.resolve();
    await expect(first).resolves.toBeNull();

    await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
      'data:image/png;base64,sync',
    );
  });

  // three's probeAsync re-polls TIMEOUT_EXPIRED forever with no cancellation,
  // so a fence that never signals leaves a promise that never settles. The
  // serialised preview lane advances on this promise and a released tail holds
  // a queue slot until it settles, so a wedge here is not a lost portrait, it
  // is a stopped lane and a halved tail budget.
  describe('a readback that never settles', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('settles anyway once the liveness backstop expires, with null', async () => {
      const h = harness();
      const snapshot = new PortraitSnapshotTarget(SIZE);
      const wedged = snapshot.capture(h.renderer, () => {});
      let settled: string | null | 'pending' = 'pending';
      void wedged.then((url) => {
        settled = url;
      });
      await vi.advanceTimersByTimeAsync(PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS - 1);
      expect(settled).toBe('pending');

      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBeNull();
      await expect(wedged).resolves.toBeNull();
      expect(encodeRgbaPngDataUrl).not.toHaveBeenCalled();
    });

    it('latches, so the next capture takes the synchronous path', async () => {
      const h = harness();
      const snapshot = new PortraitSnapshotTarget(SIZE);
      const wedged = snapshot.capture(h.renderer, () => {});
      await vi.advanceTimersByTimeAsync(PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS + 1);
      await expect(wedged).resolves.toBeNull();

      h.calls.length = 0;
      await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
        'data:image/png;base64,sync',
      );
      expect(h.calls).toEqual([]);
      expect(encodeCanvasPng).toHaveBeenCalledTimes(1);
    });

    it('does not latch the rebuilt rig when a stale backstop expires after dispose', async () => {
      // A graphics rebuild during an in-flight capture: dispose CLEARS the
      // latch so the new rig gets a fresh chance at the fence-backed arm, and
      // the stale backstop must not take it away again. Without the guard the
      // rebuilt rig silently spends the rest of the session on the synchronous
      // toBlob path, which is the slow arm this whole change exists to avoid.
      const h = harness();
      const snapshot = new PortraitSnapshotTarget(SIZE);
      const wedged = snapshot.capture(h.renderer, () => {});
      snapshot.dispose();
      await vi.advanceTimersByTimeAsync(PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS + 1);
      await expect(wedged).resolves.toBeNull();

      // The next capture still takes the async arm.
      h.calls.length = 0;
      vi.mocked(encodeCanvasPng).mockClear();
      const next = snapshot.capture(h.renderer, () => {});
      h.readback.resolve();
      await expect(next).resolves.toBe('data:image/png;base64,async');
      expect(encodeCanvasPng).not.toHaveBeenCalled();
    });

    it('does not latch the rebuilt rig when a stale readback REJECTS after dispose', async () => {
      // latchIfCurrent guards two arms: the backstop above and this rejection
      // path. Only the backstop was exercised, so a guard applied to one and
      // not the other would have passed.
      const h = harness();
      const snapshot = new PortraitSnapshotTarget(SIZE);
      const pending = snapshot.capture(h.renderer, () => {});
      snapshot.dispose();
      h.readback.reject();
      await expect(pending).resolves.toBeNull();

      h.calls.length = 0;
      vi.mocked(encodeCanvasPng).mockClear();
      const next = snapshot.capture(h.renderer, () => {});
      h.readback.resolve();
      await expect(next).resolves.toBe('data:image/png;base64,async');
      expect(encodeCanvasPng).not.toHaveBeenCalled();
    });

    it('leaves no armed backstop behind once a readback lands', async () => {
      const h = harness();
      const snapshot = new PortraitSnapshotTarget(SIZE);
      const pending = snapshot.capture(h.renderer, () => {});
      h.readback.resolve();
      await expect(pending).resolves.toBe('data:image/png;base64,async');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('does not commit or write buffers when a readback lands after dispose', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const pending = snapshot.capture(h.renderer, () => {});
    const stale = h.readback.resolve;
    snapshot.dispose();

    // The rebuilt rig's own capture owns the fresh buffers; the pre-rebuild
    // frame must not be flipped into them, and must not encode a URL to commit.
    const rebuilt = snapshot.capture(h.renderer, () => {});
    expect(() => stale()).not.toThrow();
    await expect(pending).resolves.toBeNull();
    expect(encodeRgbaPngDataUrl).not.toHaveBeenCalled();

    h.readback.resolve();
    await expect(rebuilt).resolves.toBe('data:image/png;base64,async');
    expect(encodeRgbaPngDataUrl).toHaveBeenCalledTimes(1);
  });

  it('treats a readback that fulfils without writing the buffer as a failure', async () => {
    // three's readRenderTargetPixelsAsync returns undefined, without throwing
    // and without writing a byte, when the target has no __webglFramebuffer
    // yet. `pixels` is reused across captures, so encoding on that fulfilment
    // would cache the PREVIOUS portrait's face under this key.
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const empty = snapshot.capture(h.renderer, () => {});
    h.readback.resolveEmpty();
    await expect(empty).resolves.toBeNull();
    expect(encodeRgbaPngDataUrl).not.toHaveBeenCalled();

    // ...and it latches, like every other async failure.
    h.calls.length = 0;
    await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
      'data:image/png;base64,sync',
    );
    expect(h.calls).toEqual([]);
  });

  it('sends a second concurrent capture down the synchronous path', async () => {
    // The lane above dedupes per cache KEY only, so a live composed capture can
    // overlap a paced class prewarm; the two would otherwise share `pixels` and
    // the flipped buffer.
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);

    h.calls.length = 0;
    await expect(snapshot.capture(h.renderer, () => {})).resolves.toBe(
      'data:image/png;base64,sync',
    );
    expect(h.calls).toEqual([]);
    expect(encodeCanvasPng).toHaveBeenCalledTimes(1);

    h.readback.resolve();
    await expect(first).resolves.toBe('data:image/png;base64,async');
    expect(encodeRgbaPngDataUrl).toHaveBeenCalledTimes(1);

    // The claim is released with the flip, so the next capture is async again.
    h.calls.length = 0;
    void snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);
  });

  it('hands the readback bytes to the encode with no software colour transfer', async () => {
    // The render target is SRGB8_ALPHA8 (see the colour-space pin above), so the
    // GPU already encoded these bytes as it wrote them. Re-encoding in software
    // would turn an opaque 128 into 188 and wash every portrait out.
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const pending = snapshot.capture(h.renderer, () => {});
    h.readback.buffer?.fill(128);
    for (let at = 3; at < (h.readback.buffer?.length ?? 0); at += 4) {
      if (h.readback.buffer) h.readback.buffer[at] = 255;
    }
    h.readback.resolve();
    await expect(pending).resolves.toBe('data:image/png;base64,async');

    const encoded = vi.mocked(encodeRgbaPngDataUrl).mock.calls[0][0];
    expect(encoded[0]).toBe(128);
    expect(encoded[3]).toBe(255);
  });

  it('gives a rebuilt context a fresh chance at the async path', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {});
    h.readback.reject();
    await expect(first).resolves.toBeNull();

    snapshot.dispose();
    h.calls.length = 0;
    void snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);
  });
});

// The transfer arm needs a host with createImageBitmap, Worker and
// OffscreenCanvas; the vitest env is plain Node and has none, which is exactly
// why every test above exercises the readback arm without stubbing anything.
type TransferListener = (event: unknown) => void;

class FakeEncodeWorker {
  static instances: FakeEncodeWorker[] = [];
  static throwOnConstruct = false;
  readonly posted: { requestId: number; bitmap: unknown }[] = [];
  terminated = false;
  private readonly listeners = new Map<string, TransferListener[]>();

  constructor() {
    if (FakeEncodeWorker.throwOnConstruct) throw new Error('no worker here');
    FakeEncodeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: TransferListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message: { requestId: number; bitmap: unknown }): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer the request at `index` (default: the most recent one). A null url
   *  is the worker reporting an encode error. */
  reply(url: string | null, index = this.posted.length - 1): void {
    const { requestId } = this.posted[index];
    const data = url === null ? { requestId, error: 'encode failed' } : { requestId, url };
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }
}

function stubTransferHost(): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = {
    createImageBitmap: scope.createImageBitmap,
    Worker: scope.Worker,
    OffscreenCanvas: scope.OffscreenCanvas,
  };
  scope.createImageBitmap = () => Promise.resolve({ close: () => {} });
  scope.Worker = FakeEncodeWorker;
  scope.OffscreenCanvas = class {};
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  };
}

describe('PortraitSnapshotTarget, the transfer arm', () => {
  let restore = () => {};
  beforeEach(() => {
    FakeEncodeWorker.instances = [];
    FakeEncodeWorker.throwOnConstruct = false;
    vi.mocked(encodeCanvasPng).mockClear();
    vi.mocked(encodeRgbaPngDataUrl).mockClear();
    resetGpuPrepEventsForTest();
    restore = stubTransferHost();
  });
  afterEach(() => {
    restore();
    disposePortraitEncodeWorker();
  });

  it('is preferred over the readback: one draw, no render target, bitmap transferred', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const draw = vi.fn(() => {
      h.calls.push('draw');
    });
    const pending = snapshot.capture(h.renderer, draw);
    // The draw still happens inside the caller's synchronous window: the
    // subject is released the moment this promise exists.
    expect(draw).toHaveBeenCalledTimes(1);
    // Into the DEFAULT framebuffer: no target bound, nothing read back.
    expect(h.calls).toEqual(['draw']);
    await Promise.resolve();
    const worker = FakeEncodeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);

    worker.reply('data:image/png;base64,transfer');
    await expect(pending).resolves.toBe('data:image/png;base64,transfer');
    expect(encodeRgbaPngDataUrl).not.toHaveBeenCalled();
    expect(encodeCanvasPng).not.toHaveBeenCalled();
  });

  it('falls to the READBACK arm when the worker cannot be built, not to toBlob', async () => {
    // The failure is known inside the caller's synchronous window, so the draw
    // closure is still valid and this capture can still have the better of the
    // two remaining arms rather than paying the synchronous readback.
    FakeEncodeWorker.throwOnConstruct = true;
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const draw = vi.fn();
    const pending = snapshot.capture(h.renderer, draw);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);
    expect(encodeCanvasPng).not.toHaveBeenCalled();

    h.readback.resolve();
    await expect(pending).resolves.toBe('data:image/png;base64,async');
  });

  it('latches after a failed transfer, so the next capture takes the readback arm', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {});
    await Promise.resolve();
    FakeEncodeWorker.instances[0].reply(null);
    await expect(first).resolves.toBeNull();

    h.calls.length = 0;
    const second = snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);
    h.readback.resolve();
    await expect(second).resolves.toBe('data:image/png;base64,async');
  });

  it('falls back to the readback arm on a host with no worker', async () => {
    restore();
    restore = () => {};
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const pending = snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual(['bind-target', 'unbind-target', 'read-async']);
    h.readback.resolve();
    await expect(pending).resolves.toBe('data:image/png;base64,async');
  });

  it('commits nothing when an encode lands after dispose, and rearms the arm', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const pending = snapshot.capture(h.renderer, () => {});
    await Promise.resolve();
    const first = FakeEncodeWorker.instances[0];
    snapshot.dispose();
    // The rig's worker goes with the rig.
    expect(first.terminated).toBe(true);
    await expect(pending).resolves.toBeNull();

    // A rebuilt rig gets the arm back: no render target is bound.
    h.calls.length = 0;
    const rebuilt = snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual([]);
    await Promise.resolve();
    const second = FakeEncodeWorker.instances[1];
    second.reply('data:image/png;base64,rebuilt');
    await expect(rebuilt).resolves.toBe('data:image/png;base64,rebuilt');
  });

  it('sends a capture that would draw over an unsnapshotted frame to the readback arm', async () => {
    // The rig has ONE default framebuffer. The second capture's draw would
    // land in it while the first is still copying it out, and the first would
    // then encode the second's character under its own key.
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const first = snapshot.capture(h.renderer, () => {
      h.calls.push('draw-first');
    });
    expect(h.calls).toEqual(['draw-first']);

    h.calls.length = 0;
    const second = snapshot.capture(h.renderer, () => {
      h.calls.push('draw-second');
    });
    expect(h.calls).toEqual(['bind-target', 'draw-second', 'unbind-target', 'read-async']);
    h.readback.resolve();
    await expect(second).resolves.toBe('data:image/png;base64,async');

    const worker = FakeEncodeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);
    worker.reply('data:image/png;base64,first');
    await expect(first).resolves.toBe('data:image/png;base64,first');

    // The claim is released with the snapshot, so the next capture is back on
    // the transfer arm.
    h.calls.length = 0;
    void snapshot.capture(h.renderer, () => {});
    expect(h.calls).toEqual([]);
  });

  // A host that quietly loses the transfer arm (a stale worker chunk after a
  // deploy, a CSP that blocks it) just gets slower, on every portrait, for the
  // rest of the session. These counters are the only place that shows up.
  it('counts which arm ran, and every latch', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const landed = snapshot.capture(h.renderer, () => {});
    await Promise.resolve();
    const worker = FakeEncodeWorker.instances[0];
    worker.reply('data:image/png;base64,transfer');
    await expect(landed).resolves.toBe('data:image/png;base64,transfer');
    expect(gpuPrepEventsSnapshot().portraits).toMatchObject({
      transferCaptures: 1,
      transferLatches: 0,
      readbackCaptures: 0,
      canvasCaptures: 0,
    });

    const failed = snapshot.capture(h.renderer, () => {});
    await Promise.resolve();
    FakeEncodeWorker.instances[0].reply(null);
    await expect(failed).resolves.toBeNull();
    expect(gpuPrepEventsSnapshot().portraits).toMatchObject({
      transferCaptures: 1,
      transferLatches: 1,
    });

    // Latched: the next capture is on the readback arm, and counted there.
    const readback = snapshot.capture(h.renderer, () => {});
    h.readback.resolve();
    await expect(readback).resolves.toBe('data:image/png;base64,async');
    expect(gpuPrepEventsSnapshot().portraits).toMatchObject({
      readbackCaptures: 1,
      readbackLatches: 0,
    });
  });

  it('counts a latch once, not once per later capture', async () => {
    const h = harness();
    const snapshot = new PortraitSnapshotTarget(SIZE);
    const failed = snapshot.capture(h.renderer, () => {});
    await Promise.resolve();
    FakeEncodeWorker.instances[0].reply(null);
    await expect(failed).resolves.toBeNull();

    const readback = snapshot.capture(h.renderer, () => {});
    h.readback.reject();
    await expect(readback).resolves.toBeNull();
    const canvas = snapshot.capture(h.renderer, () => {});
    await expect(canvas).resolves.toBe('data:image/png;base64,sync');
    expect(gpuPrepEventsSnapshot().portraits).toMatchObject({
      transferLatches: 1,
      readbackLatches: 1,
      canvasCaptures: 1,
    });
  });
});

// The encode worker is MODULE state (portrait_bitmap_encode.ts), and this
// class's dispose() terminates it for the whole page. That is correct only
// while the portrait rig is the sole owner: a second target would terminate the
// first's worker on its own rebuild and latch that rig onto the slower arm for
// good. Pinned as a grep so adding a second owner reds here, where the fix
// (an owner handle or a refcount) is described, rather than in production.
describe('the encode worker has exactly one owner', () => {
  it('is constructed in one place in src/', () => {
    const hits = execFileSync(
      'grep',
      ['-rn', '--include=*.ts', 'new PortraitSnapshotTarget(', 'src/'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('src/render/characters/portrait.ts');
  });
});
