// The worker half of the portrait transfer arm. It had no test at all, and it
// is the only place a portrait's bytes are produced on the fast path: a
// regression here is a wrong-sized, stale-edged or leaked portrait, none of
// which any other suite would notice.
//
// Driven against fakes for the three worker globals it uses (OffscreenCanvas,
// FileReader, the worker scope), so it runs in the plain Node env like the
// rest of the portrait suites.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeContext {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

const canvasesMade: number[] = [];
const contexts: FakeContext[] = [];
let contextAvailable = true;
let convertToBlobFails = false;
let readerFails = false;

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private context: FakeContext | null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    canvasesMade.push(width);
    this.context = contextAvailable ? { clearRect: vi.fn(), drawImage: vi.fn() } : null;
    if (this.context) contexts.push(this.context);
  }

  getContext(kind: string): FakeContext | null {
    expect(kind).toBe('2d');
    return this.context;
  }

  convertToBlob(options: { type: string }): Promise<{ type: string }> {
    expect(options.type).toBe('image/png');
    if (convertToBlobFails) return Promise.reject(new Error('convertToBlob failed'));
    return Promise.resolve({ type: 'image/png' });
  }
}

class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  private listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  readAsDataURL(_blob: unknown): void {
    queueMicrotask(() => {
      if (readerFails) {
        this.error = new Error('read failed');
        this.listeners.get('error')?.();
        return;
      }
      this.result = 'data:image/png;base64,portrait';
      this.listeners.get('load')?.();
    });
  }
}

function fakeBitmap(width = 96, height = 96) {
  return { width, height, close: vi.fn() };
}

type Request = { requestId: number; bitmap: ReturnType<typeof fakeBitmap>; size: number };
type Response = { requestId: number; url?: string; error?: string };

const posted: Response[] = [];
let deliver: ((event: { data: Request }) => void) | null = null;

async function loadWorker(): Promise<void> {
  const scope = globalThis as Record<string, unknown>;
  scope.OffscreenCanvas = FakeOffscreenCanvas;
  scope.FileReader = FakeFileReader;
  scope.addEventListener = (_type: string, listener: (event: { data: Request }) => void) => {
    deliver = listener;
  };
  scope.postMessage = (message: Response) => {
    posted.push(message);
  };
  vi.resetModules();
  await import('../src/render/characters/portrait_encode_worker');
}

/** Post one request and wait for its response. */
async function request(req: Request): Promise<Response> {
  deliver?.({ data: req });
  for (let i = 0; i < 20 && posted.length === 0; i++) await Promise.resolve();
  // The encode chain is several microtask hops (convertToBlob, the reader, the
  // post), so drain until something lands rather than guessing a count.
  while (posted.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  return posted[posted.length - 1];
}

beforeEach(async () => {
  canvasesMade.length = 0;
  contexts.length = 0;
  posted.length = 0;
  contextAvailable = true;
  convertToBlobFails = false;
  readerFails = false;
  deliver = null;
  await loadWorker();
});

describe('portrait encode worker', () => {
  it('answers one request with the encoded data URL under its own request id', async () => {
    const bitmap = fakeBitmap();
    const response = await request({ requestId: 7, bitmap, size: 96 });

    expect(response).toEqual({ requestId: 7, url: 'data:image/png;base64,portrait' });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('encodes at the size the adapter asked for, never the bitmap own size', async () => {
    // Every arm has to emit the same square. A rig whose drawing buffer ever
    // differs from the portrait size would otherwise make this arm alone
    // disagree, and the cache would hold two resolutions under one key.
    await request({ requestId: 1, bitmap: fakeBitmap(512, 512), size: 96 });

    expect(canvasesMade).toEqual([96]);
    expect(contexts[0].drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 96, 96);
  });

  it('falls back to the bitmap largest side when no size was asked for', async () => {
    await request({ requestId: 1, bitmap: fakeBitmap(64, 128), size: 0 });

    expect(canvasesMade).toEqual([128]);
  });

  it('clears the reused canvas before drawing, so no earlier portrait edge survives', async () => {
    // The rig draws a TRANSPARENT headshot and the canvas is reused across
    // captures: without the clear, a smaller silhouette keeps the previous
    // portrait's outline around it.
    await request({ requestId: 1, bitmap: fakeBitmap(), size: 96 });

    const context = contexts[0];
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 96, 96);
    expect(context.clearRect.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0],
    );
  });

  it('reuses one canvas per size across captures', async () => {
    await request({ requestId: 1, bitmap: fakeBitmap(), size: 96 });
    posted.length = 0;
    await request({ requestId: 2, bitmap: fakeBitmap(), size: 96 });
    posted.length = 0;
    await request({ requestId: 3, bitmap: fakeBitmap(), size: 64 });

    expect(canvasesMade).toEqual([96, 64]);
  });

  it('closes the bitmap and reports the error when there is no 2D context', async () => {
    // The leak is the point: a bitmap holds a decoded frame, and one leak per
    // capture is a portrait's worth of memory that never comes back.
    contextAvailable = false;
    const bitmap = fakeBitmap();
    const response = await request({ requestId: 4, bitmap, size: 96 });

    expect(response.requestId).toBe(4);
    expect(response.url).toBeUndefined();
    expect(response.error).toContain('2D context');
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes the bitmap when the encode itself fails', async () => {
    convertToBlobFails = true;
    const bitmap = fakeBitmap();
    const response = await request({ requestId: 5, bitmap, size: 96 });

    expect(response.error).toContain('convertToBlob failed');
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes the bitmap when the data-URL read fails', async () => {
    readerFails = true;
    const bitmap = fakeBitmap();
    const response = await request({ requestId: 6, bitmap, size: 96 });

    expect(response.error).toBeDefined();
    expect(response.url).toBeUndefined();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
