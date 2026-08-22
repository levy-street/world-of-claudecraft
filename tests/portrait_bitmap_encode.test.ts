import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposePortraitEncodeWorker,
  encodeCanvasBitmapPng,
  PORTRAIT_ENCODE_LIVENESS_BACKSTOP_MS,
  portraitBitmapEncodeSupport,
} from '../src/render/characters/portrait_bitmap_encode';
import {
  bitmapPortraitTransferUsable,
  type PortraitBitmapTransferSupport,
} from '../src/render/characters/portrait_bitmap_transfer_core';

// The worker client half of the portrait transfer arm. What matters here is
// the LIFECYCLE (one worker, lazily built, reused, terminated on dispose) and
// that every way it can fail resolves rather than hangs: the capture promise is
// what the serialised preview lane advances on.

type Listener = (event: unknown) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnConstruct = false;
  readonly posted: { message: { requestId: number; bitmap: unknown }; transfer: unknown[] }[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: URL,
    readonly options: unknown,
  ) {
    if (FakeWorker.throwOnConstruct) throw new Error('no worker here');
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message: { requestId: number; bitmap: unknown }, transfer: unknown[]): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  reply(requestId: number, url: string): void {
    this.emit('message', { data: { requestId, url } });
  }

  replyError(requestId: number): void {
    this.emit('message', { data: { requestId, error: 'encode failed' } });
  }

  crash(): void {
    this.emit('error', {});
  }
}

interface Bitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

function bitmap(): Bitmap {
  const made: Bitmap = {
    width: 4,
    height: 4,
    closed: false,
    close() {
      made.closed = true;
    },
  };
  return made;
}

const scope = globalThis as Record<string, unknown>;
const CANVAS = { id: 'portrait-canvas' } as unknown as HTMLCanvasElement;
const SIZE = 4;

const bitmapCalls: { source: unknown; options: ImageBitmapOptions | undefined }[] = [];

function stubHost(
  opts: { createImageBitmap?: unknown; worker?: unknown; offscreen?: unknown } = {},
): () => void {
  const previous = {
    createImageBitmap: scope.createImageBitmap,
    Worker: scope.Worker,
    OffscreenCanvas: scope.OffscreenCanvas,
  };
  scope.createImageBitmap =
    'createImageBitmap' in opts
      ? opts.createImageBitmap
      : (source: unknown, options?: ImageBitmapOptions) => {
          bitmapCalls.push({ source, options });
          return Promise.resolve(bitmap());
        };
  scope.Worker = 'worker' in opts ? opts.worker : FakeWorker;
  scope.OffscreenCanvas = 'offscreen' in opts ? opts.offscreen : class {};
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  };
}

describe('portraitBitmapEncodeSupport', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    disposePortraitEncodeWorker();
  });

  it('reports what the host actually has, read at call time', () => {
    restore = stubHost();
    expect(portraitBitmapEncodeSupport()).toEqual({
      hasCreateImageBitmap: true,
      hasWorker: true,
      hasOffscreenCanvas: true,
    });
    restore();
    restore = stubHost({ worker: undefined, offscreen: undefined, createImageBitmap: undefined });
    expect(portraitBitmapEncodeSupport()).toEqual({
      hasCreateImageBitmap: false,
      hasWorker: false,
      hasOffscreenCanvas: false,
    });
  });

  // A crash BETWEEN the snapshot call and the bitmap it resolves: the request
  // must not be posted to the dead worker and left for the backstop to settle.
  it('stops reporting a worker once one has failed, without waiting out a backstop', async () => {
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    expect(pending).not.toBeNull();
    const worker = FakeWorker.instances[0];
    worker.crash();
    await expect(pending).resolves.toBeNull();
    expect(worker.posted).toHaveLength(0);
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);
    // ...and the dead worker is not left running.
    expect(worker.terminated).toBe(true);
  });
});

describe('encodeCanvasBitmapPng', () => {
  let restore = () => {};
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.throwOnConstruct = false;
    bitmapCalls.length = 0;
  });
  afterEach(() => {
    restore();
    disposePortraitEncodeWorker();
  });

  it('transfers the bitmap to one lazily built worker and resolves its data URL', async () => {
    restore = stubHost();
    expect(FakeWorker.instances).toHaveLength(0);
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(String(worker.url)).toContain('portrait_encode_worker');
    expect(worker.options).toEqual({ type: 'module' });
    await Promise.resolve();
    expect(worker.posted).toHaveLength(1);
    const { message, transfer } = worker.posted[0];
    // Transferred, not copied: that is the whole point of the arm.
    expect(transfer).toEqual([message.bitmap]);

    worker.reply(message.requestId, 'data:image/png;base64,worker');
    await expect(pending).resolves.toBe('data:image/png;base64,worker');
  });

  it('reuses the one worker across captures', async () => {
    restore = stubHost();
    const first = encodeCanvasBitmapPng(CANVAS, SIZE);
    const second = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[0].message.requestId).not.toBe(worker.posted[1].message.requestId);

    worker.reply(worker.posted[1].message.requestId, 'data:image/png;base64,second');
    worker.reply(worker.posted[0].message.requestId, 'data:image/png;base64,first');
    await expect(first).resolves.toBe('data:image/png;base64,first');
    await expect(second).resolves.toBe('data:image/png;base64,second');
  });

  it('answers null SYNCHRONOUSLY when the path cannot start at all', () => {
    restore = stubHost({ worker: undefined });
    // Null rather than a promise: the caller is still inside its draw window
    // and can encode the drawn frame itself.
    expect(encodeCanvasBitmapPng(CANVAS, SIZE)).toBeNull();

    restore();
    restore = stubHost({ createImageBitmap: undefined });
    expect(encodeCanvasBitmapPng(CANVAS, SIZE)).toBeNull();

    restore();
    restore = stubHost({ offscreen: undefined });
    expect(encodeCanvasBitmapPng(CANVAS, SIZE)).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('answers null synchronously when the worker cannot be constructed', () => {
    FakeWorker.throwOnConstruct = true;
    restore = stubHost();
    expect(encodeCanvasBitmapPng(CANVAS, SIZE)).toBeNull();
    // Latched, so the next capture does not pay another construction attempt.
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);
    expect(encodeCanvasBitmapPng(CANVAS, SIZE)).toBeNull();
  });

  it('resolves null when the snapshot itself fails', async () => {
    restore = stubHost({ createImageBitmap: () => Promise.reject(new Error('no bitmap')) });
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    expect(pending).not.toBeNull();
    await expect(pending).resolves.toBeNull();
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);
  });

  it('resolves null on a per-request encode error, keeping the worker up', async () => {
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    worker.replyError(worker.posted[0].message.requestId);
    await expect(pending).resolves.toBeNull();
    expect(worker.terminated).toBe(false);
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
  });

  it('settles every waiter when the worker crashes', async () => {
    restore = stubHost();
    const first = encodeCanvasBitmapPng(CANVAS, SIZE);
    const second = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    FakeWorker.instances[0].crash();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });

  it('terminates the worker on dispose, settles what was in flight, and rearms', async () => {
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    const first = FakeWorker.instances[0];
    disposePortraitEncodeWorker();
    expect(first.terminated).toBe(true);
    await expect(pending).resolves.toBeNull();

    // A rebuilt rig gets a fresh worker, not the latched refusal.
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
    const next = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(2);
    const worker = FakeWorker.instances[1];
    worker.reply(worker.posted[0].message.requestId, 'data:image/png;base64,rebuilt');
    await expect(next).resolves.toBe('data:image/png;base64,rebuilt');
  });

  it('clears a dispose latch even after a failure', async () => {
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    FakeWorker.instances[0].crash();
    await expect(pending).resolves.toBeNull();
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);

    disposePortraitEncodeWorker();
    expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
  });

  // The epoch guard: a failure that STARTED before a graphics rebuild must not
  // latch the transfer arm off for the rig that replaced it. dispose
  // deliberately clears the latch to give the new rig a fresh chance, and
  // without the guard a stale rejection, backstop or worker error landing
  // afterwards silently takes it away again, costing every later portrait the
  // slow synchronous path. Three call sites route through markUnavailableAt and
  // each gets its own arm here.
  it('does not latch the rebuilt rig when a stale worker error lands after dispose', async () => {
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    const stale = FakeWorker.instances[0];

    disposePortraitEncodeWorker();
    await expect(pending).resolves.toBeNull();
    // The terminated worker still fires its error listener.
    stale.crash();

    expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
  });

  it('does not latch the rebuilt rig when a stale snapshot rejection lands after dispose', async () => {
    const rejectSnapshot: { fire?: (reason: unknown) => void } = {};
    restore = stubHost({
      createImageBitmap: () =>
        new Promise((_resolve, reject) => {
          rejectSnapshot.fire = reject;
        }),
    });
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    expect(pending).not.toBeNull();

    disposePortraitEncodeWorker();
    rejectSnapshot.fire?.(new Error('stale snapshot'));
    await expect(pending).resolves.toBeNull();

    expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
  });

  it('disarms an in-flight backstop on dispose, leaving no timer to fire late', async () => {
    // Why the transfer backstop needs no epoch arm of its own: terminate()
    // drains every waiter, and each waiter clears its own backstop, so the
    // timer is gone before a rebuilt rig exists. Pinned rather than assumed,
    // because if that drain ever stopped clearing the timer the stale timeout
    // WOULD reach markUnavailableAt and the epoch guard would become the only
    // thing standing between it and the new rig.
    vi.useFakeTimers();
    try {
      restore = stubHost();
      const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);

      disposePortraitEncodeWorker();
      await expect(pending).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(PORTRAIT_ENCODE_LIVENESS_BACKSTOP_MS + 1);
      expect(portraitBitmapEncodeSupport().hasWorker).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still latches a CURRENT failure, so the guard is not a blanket exemption', async () => {
    // The positive control: without it, a guard that never latches anything
    // would pass all three cases above.
    restore = stubHost();
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
    await Promise.resolve();
    FakeWorker.instances[0].crash();
    await expect(pending).resolves.toBeNull();

    expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);
  });

  // The drawing buffer holds premultiplied colour and toBlob reads it with no
  // colour conversion. Left to the host defaults, a browser that unpremultiplies
  // or converts into a display space would ship different portrait edges to its
  // users alone, and only on this arm.
  it('pins the snapshot semantics instead of taking the host defaults', async () => {
    restore = stubHost();
    void encodeCanvasBitmapPng(CANVAS, SIZE);
    expect(bitmapCalls).toHaveLength(1);
    expect(bitmapCalls[0].source).toBe(CANVAS);
    expect(bitmapCalls[0].options).toEqual({
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'none',
    });
  });

  it('sends the size the caller drew, not one read off the bitmap', async () => {
    restore = stubHost();
    void encodeCanvasBitmapPng(CANVAS, 256);
    await Promise.resolve();
    expect(FakeWorker.instances[0].posted[0].message).toMatchObject({ size: 256 });
  });

  it('reports the snapshot exactly once, on success and on failure alike', async () => {
    restore = stubHost();
    let landed = 0;
    const pending = encodeCanvasBitmapPng(CANVAS, SIZE, () => {
      landed += 1;
    });
    expect(landed).toBe(0);
    await Promise.resolve();
    // Reported as soon as the frame is copied out, long before the encode.
    expect(landed).toBe(1);
    const worker = FakeWorker.instances[0];
    worker.reply(worker.posted[0].message.requestId, 'data:image/png;base64,ok');
    await expect(pending).resolves.toBe('data:image/png;base64,ok');
    expect(landed).toBe(1);

    restore();
    restore = stubHost({ createImageBitmap: () => Promise.reject(new Error('no bitmap')) });
    let failed = 0;
    await expect(
      encodeCanvasBitmapPng(CANVAS, SIZE, () => {
        failed += 1;
      }),
    ).resolves.toBeNull();
    expect(failed).toBe(1);
  });

  describe('a worker that never answers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('settles with null once the liveness backstop expires, and latches', async () => {
      restore = stubHost();
      const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
      let settled: string | null | 'pending' = 'pending';
      void pending?.then((url) => {
        settled = url;
      });
      await vi.advanceTimersByTimeAsync(PORTRAIT_ENCODE_LIVENESS_BACKSTOP_MS - 1);
      expect(settled).toBe('pending');

      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBeNull();
      expect(FakeWorker.instances[0].terminated).toBe(true);
      expect(portraitBitmapEncodeSupport().hasWorker).toBe(false);
    });

    it('leaves no armed backstop behind once an encode lands', async () => {
      restore = stubHost();
      const pending = encodeCanvasBitmapPng(CANVAS, SIZE);
      await vi.advanceTimersByTimeAsync(0);
      const worker = FakeWorker.instances[0];
      worker.reply(worker.posted[0].message.requestId, 'data:image/png;base64,landed');
      await expect(pending).resolves.toBe('data:image/png;base64,landed');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('bitmapPortraitTransferUsable', () => {
  const supported: PortraitBitmapTransferSupport = {
    hasCreateImageBitmap: true,
    hasWorker: true,
    hasOffscreenCanvas: true,
    failedBefore: false,
    contextLost: false,
    snapshotInFlight: false,
  };

  it('takes the arm only when the whole host is there and nothing has failed', () => {
    expect(bitmapPortraitTransferUsable(supported)).toBe(true);
  });

  // Every input on its own, so a predicate that dropped one of them still fails
  // this file rather than silently sending a broken host down the arm.
  it.each([
    ['no createImageBitmap', { hasCreateImageBitmap: false }],
    ['no Worker', { hasWorker: false }],
    ['no OffscreenCanvas', { hasOffscreenCanvas: false }],
    ['a failure already latched', { failedBefore: true }],
    ['a lost context', { contextLost: true }],
    ['another capture still snapshotting the drawing buffer', { snapshotInFlight: true }],
  ] as const)('refuses the arm on %s', (_label, override) => {
    expect(bitmapPortraitTransferUsable({ ...supported, ...override })).toBe(false);
  });
});
