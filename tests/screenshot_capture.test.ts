import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureRendererScreenshot,
  type ScreenshotCaptureHost,
} from '../src/render/screenshot_capture';

// The renderer's canvas as the capture sees it: 2000x1000 device pixels, so a
// 1280 edge scales it to 1280x640.
function fakeHost(log: string[], options: { drawThrows?: boolean } = {}): ScreenshotCaptureHost {
  return {
    domElement: { width: 2000, height: 1000 } as HTMLCanvasElement,
    draw() {
      log.push('draw');
      if (options.drawThrows) throw new Error('context lost');
    },
    discardDraw() {
      log.push('discardDraw');
    },
  };
}

function stubDocument(log: string[], with2d: boolean): void {
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) =>
      with2d && kind === '2d'
        ? {
            drawImage: (_src: unknown, x: number, y: number, w: number, h: number) =>
              log.push(`drawImage ${x} ${y} ${w} ${h}`),
          }
        : null,
    toBlob: (cb: (blob: Blob | null) => void, type: string, quality: number) => {
      log.push(`toBlob ${type} ${quality} ${canvas.width}x${canvas.height}`);
      cb(new Blob(['jpeg-bytes']));
    },
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal(
    'FileReader',
    class {
      result: string | null = null;
      private listeners = new Map<string, () => void>();
      addEventListener(type: string, fn: () => void) {
        this.listeners.set(type, fn);
      }
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,amplZy1ieXRlcw==';
        this.listeners.get('load')?.();
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('captureRendererScreenshot', () => {
  it('draws one frame, downscales onto a 2D canvas, encodes async, and discards the draw', async () => {
    const log: string[] = [];
    stubDocument(log, true);
    const url = await captureRendererScreenshot(fakeHost(log), 1280, 0.7);
    expect(url).toBe('data:image/jpeg;base64,amplZy1ieXRlcw==');
    expect(log).toEqual([
      'draw',
      'drawImage 0 0 1280 640',
      'toBlob image/jpeg 0.7 1280x640',
      'discardDraw',
    ]);
  });

  it('returns null without a 2D context and still discards the draw', async () => {
    const log: string[] = [];
    stubDocument(log, false);
    expect(await captureRendererScreenshot(fakeHost(log), 1280, 0.7)).toBeNull();
    expect(log).toEqual(['draw', 'discardDraw']);
  });

  it('degrades to null when the draw throws, and the discard runs on that path too', async () => {
    const log: string[] = [];
    stubDocument(log, true);
    expect(
      await captureRendererScreenshot(fakeHost(log, { drawThrows: true }), 1280, 0.7),
    ).toBeNull();
    expect(log).toEqual(['draw', 'discardDraw']);
  });
});
