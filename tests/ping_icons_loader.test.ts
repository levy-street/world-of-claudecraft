// @vitest-environment happy-dom
// The party ping icons' art loader (src/ui/ping_icons.ts): one load per kind
// per session, the glyph until the art arrives, a repaint of every cached
// canvas of that kind plus the listeners when it does, the glyph for good when
// it fails, an <img> that falls back to the glyph instead of showing a broken
// image, and the settle promise the world icon's prewarm waits on. The painted
// files themselves are pinned by tests/ping_icons_art.test.ts.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IconsModule = typeof import('../src/ui/ping_icons');

/** A stand-in for the browser's Image: records each load the module starts
 *  and lets the test decide when (and whether) it arrives. */
class FakeImage {
  static made: FakeImage[] = [];
  decoding = '';
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeImage.made.push(this);
  }
}

let drawn = 0;
let icons: IconsModule;

function fakeContext(): CanvasRenderingContext2D {
  // Every drawing call is a no-op except drawImage, which only the painted art
  // makes (the glyph is paths alone), so its count says which one a canvas holds.
  return new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'drawImage'
          ? () => {
              drawn++;
            }
          : () => {},
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

function loadFor(kind: number): FakeImage {
  const file = icons.pingIconArtUrl(kind);
  const image = FakeImage.made.find((made) => made.src === file);
  if (!image) throw new Error(`no load started for ${file}`);
  return image;
}

// The first import transforms the module graph, which is slow on a loaded
// machine; pay it once here so each test's fresh re-import is only evaluation.
beforeAll(async () => {
  await import('../src/ui/ping_icons');
}, 60_000);

beforeEach(async () => {
  FakeImage.made = [];
  drawn = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,glyph');
  // The module keeps its loads and canvases for the session: a fresh copy per test.
  vi.resetModules();
  icons = await import('../src/ui/ping_icons');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ping icon art loader', () => {
  it('starts one load per kind and draws the glyph until the art arrives', () => {
    icons.pingIconCanvas(1, 64);
    icons.pingIconCanvas(1, 128);
    icons.pingIconUrl(1);
    expect(FakeImage.made).toHaveLength(1);
    expect(FakeImage.made[0]?.src).toBe('/ui/pings/attack.webp');
    expect(drawn).toBe(0);
  });

  it('repaints every cached canvas of the kind and tells listeners once the art loads', () => {
    icons.pingIconCanvas(1, 64);
    icons.pingIconCanvas(1, 128);
    icons.pingIconCanvas(2, 128);
    const heard: number[] = [];
    const stop = icons.onPingIconArt((kind) => heard.push(kind));
    loadFor(1).onload?.();
    // Two canvases of the kind, each drawn twice (the wide glow, then the tight one).
    expect(drawn).toBe(4);
    expect(heard).toEqual([1]);
    stop();
    loadFor(2).onload?.();
    expect(heard).toEqual([1]);
  });

  it('keeps the glyph for good when the art fails, and never retries it', () => {
    expect(icons.pingIconUrl(3)).toBe('/ui/pings/on_my_way.webp');
    loadFor(3).onerror?.();
    expect(icons.pingIconUrl(3)).toBe('data:image/png;base64,glyph');
    icons.pingIconCanvas(3, 128);
    expect(FakeImage.made).toHaveLength(1);
    expect(drawn).toBe(0);
  });

  it('swaps a failed <img> to the glyph instead of a broken image', () => {
    const img = document.createElement('img');
    icons.setPingIconImg(img, 4);
    expect(img.getAttribute('src')).toBe('/ui/pings/assist.webp');
    img.onerror?.(new Event('error'));
    expect(img.getAttribute('src')).toBe('data:image/png;base64,glyph');
    // One swap only: a glyph that somehow failed too is not retried in a loop.
    expect(img.onerror).toBeNull();
  });

  it('settles the art promise only once every started load has loaded or failed', async () => {
    icons.pingIconCanvas(0, 128);
    icons.pingIconCanvas(2, 128);
    let settled = false;
    const wait = icons.pingIconArtSettled().then(() => {
      settled = true;
    });
    loadFor(0).onload?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    loadFor(2).onerror?.();
    await wait;
    expect(settled).toBe(true);
  });
});
