// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNameplateCanvasState,
  NAMEPLATE_IMAGE_CACHE_LIMIT,
  NAMEPLATE_IMAGE_RETRY_BASE_FRAMES,
  NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES,
  NAMEPLATE_TEXT_SPRITE_LIMIT,
  NameplateCanvasSurface,
} from '../src/render/nameplate_canvas';

interface ContextTrace {
  canvas: HTMLCanvasElement;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fillStyles: string[];
  strokeStyles: string[];
  globalAlphas: number[];
}

function context(trace: ContextTrace): CanvasRenderingContext2D {
  const noop = vi.fn();
  const ctx = {
    setTransform: trace.setTransform,
    clearRect: trace.clearRect,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: trace.arc,
    rect: noop,
    clip: noop,
    fill: trace.fill,
    stroke: trace.stroke,
    drawImage: trace.drawImage,
    fillText: trace.fillText,
    strokeText: trace.strokeText,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      trace.fillStyles.push(String(value));
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      trace.strokeStyles.push(String(value));
    },
    set globalAlpha(value: number) {
      trace.globalAlphas.push(value);
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

let traces: ContextTrace[];

beforeEach(() => {
  traces = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const trace: ContextTrace = {
      canvas: this,
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      setTransform: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillStyles: [],
      strokeStyles: [],
      globalAlphas: [],
    };
    traces.push(trace);
    return context(trace);
  });
});

describe('nameplate canvas surface', () => {
  it('owns one DPR-aware viewport canvas and clears it once per frame', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);

    surface.beginFrame(320, 180, 4);
    expect(parent.querySelectorAll('canvas.nameplate-canvas')).toHaveLength(1);
    expect(surface.canvas.width).toBe(640);
    expect(surface.canvas.height).toBe(360);
    expect(surface.canvas.style.width).toBe('320px');
    expect(surface.canvas.style.height).toBe('180px');
    expect(traces[0].setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(traces[0].clearRect).toHaveBeenCalledTimes(1);

    surface.beginFrame(320, 180, 4);
    expect(traces[0].clearRect).toHaveBeenCalledTimes(2);
    expect(parent.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('does not resize the backing store again on an unchanged frame', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    let width = surface.canvas.width;
    let height = surface.canvas.height;
    let widthWrites = 0;
    let heightWrites = 0;
    Object.defineProperty(surface.canvas, 'width', {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        width = value;
        widthWrites++;
      },
    });
    Object.defineProperty(surface.canvas, 'height', {
      configurable: true,
      get: () => height,
      set: (value: number) => {
        height = value;
        heightWrites++;
      },
    });

    surface.beginFrame(320, 180, 2);
    surface.beginFrame(320, 180, 2);

    expect(widthWrites).toBe(1);
    expect(heightWrites).toBe(1);
  });

  it('rasterizes unchanged text once and blits the cached sprite on later frames', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    state.initialized = true;
    state.name = 'Canvas Hero';
    state.hpVisible = true;

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160.25, 90.75);
    const firstRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );
    expect(firstRasterCount).toBe(1);
    expect(traces[0].drawImage).toHaveBeenCalledTimes(1);

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 161.25, 90.75);
    const secondRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );
    expect(secondRasterCount).toBe(firstRasterCount);
    expect(traces[0].drawImage).toHaveBeenCalledTimes(2);
  });

  it('rasterizes text at capped high DPR and blits it at logical dimensions', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    state.initialized = true;
    state.name = 'Retina Hero';

    surface.beginFrame(320, 180, 3);
    surface.drawBase(state, 160.25, 90.75);

    expect(surface.canvas.width).toBe(640);
    expect(traces[1].setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(traces[0].drawImage.mock.calls[0]).toHaveLength(5);
  });

  it('invalidates cached sprites when the same surface changes pixel ratio', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    state.initialized = true;
    state.name = 'Moving Monitor';

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    const lowDprSprite = traces[1].canvas;
    const lowDprRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );

    surface.beginFrame(320, 180, 2);
    surface.drawBase(state, 160, 90);
    const highDprSprite = traces[2].canvas;
    const highDprRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );

    expect(lowDprRasterCount).toBe(1);
    expect(highDprRasterCount).toBe(2);
    expect(highDprSprite.width).toBe(lowDprSprite.width * 2);
    expect(highDprSprite.height).toBe(lowDprSprite.height * 2);
    expect(traces[0].drawImage.mock.calls[1]).toHaveLength(5);

    surface.beginFrame(320, 180, 2);
    surface.drawBase(state, 160, 90);
    expect(traces.reduce((sum, trace) => sum + trace.fillText.mock.calls.length, 0)).toBe(2);
  });

  it('keeps the high-DPR text working set inside a hard backing-store byte budget', () => {
    expect(NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES).toBe(16 * 1024 * 1024);
    expect(NAMEPLATE_TEXT_SPRITE_LIMIT).toBe(512);
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const states = Array.from({ length: NAMEPLATE_TEXT_SPRITE_LIMIT + 40 }, (_, index) => {
      const state = createNameplateCanvasState();
      state.initialized = true;
      state.name = `Retina Crowd Hero ${String(index).padStart(4, '0')}`;
      return state;
    });

    surface.beginFrame(1280, 720, 2);
    for (let index = 0; index < states.length; index++) {
      surface.drawBase(states[index], index, 360);
    }

    const cachedBytes = (surface as unknown as { text: { bytes: number } }).text.bytes;
    const cachedCount = (surface as unknown as { text: { size: number } }).text.size;
    expect(cachedBytes).toBeLessThanOrEqual(NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES);
    expect(cachedCount).toBeLessThan(states.length);
  });

  it('keeps more than 384 distinct crowd labels resident between frames', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const states = Array.from({ length: 500 }, (_, index) => {
      const state = createNameplateCanvasState();
      state.initialized = true;
      state.name = `Crowd Hero ${index}`;
      return state;
    });

    surface.beginFrame(1280, 720, 1);
    for (let index = 0; index < states.length; index++) {
      surface.drawBase(states[index], index, 360);
    }
    const firstRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );

    surface.beginFrame(1280, 720, 1);
    for (let index = 0; index < states.length; index++) {
      surface.drawBase(states[index], index, 360);
    }
    const secondRasterCount = traces.reduce(
      (sum, trace) => sum + trace.fillText.mock.calls.length,
      0,
    );

    expect(firstRasterCount).toBe(500);
    expect(secondRasterCount).toBe(firstRasterCount);
  });

  it('retries a transient image failure, then draws the loaded replacement', () => {
    expect(NAMEPLATE_IMAGE_RETRY_BASE_FRAMES).toBe(30);
    const createElement = vi.spyOn(document, 'createElement');
    const images = (): HTMLImageElement[] =>
      createElement.mock.results
        .map((result) => result.value)
        .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    state.badges = [{ url: '/transient-avatar.webp', size: 24 }];

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    expect(images()).toHaveLength(1);
    images()[0].dispatchEvent(new Event('error'));

    for (let frame = 1; frame < NAMEPLATE_IMAGE_RETRY_BASE_FRAMES; frame++) {
      surface.beginFrame(320, 180, 1);
      surface.drawBase(state, 160, 90);
    }
    expect(images()).toHaveLength(1);

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    expect(images()).toHaveLength(2);
    images()[1].dispatchEvent(new Event('load'));
    surface.drawBase(state, 160, 90);

    const imageBlits = traces[0].drawImage.mock.calls.filter(
      ([source]) => source instanceof HTMLImageElement,
    );
    expect(imageBlits).toHaveLength(1);
    expect(imageBlits[0][0]).toBe(images()[1]);
  });

  it('backs image retries off exponentially through the hard 600-frame cap', () => {
    expect(NAMEPLATE_IMAGE_RETRY_BASE_FRAMES).toBe(30);
    const createElement = vi.spyOn(document, 'createElement');
    const images = (): HTMLImageElement[] =>
      createElement.mock.results
        .map((result) => result.value)
        .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    state.badges = [{ url: '/repeatedly-failing-avatar.webp', size: 24 }];

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    for (const delay of [30, 60, 120, 240, 480, 600, 600]) {
      const before = images().length;
      images().at(-1)?.dispatchEvent(new Event('error'));
      for (let frame = 1; frame < delay; frame++) {
        surface.beginFrame(320, 180, 1);
        surface.drawBase(state, 160, 90);
      }
      expect(images()).toHaveLength(before);
      surface.beginFrame(320, 180, 1);
      surface.drawBase(state, 160, 90);
      expect(images()).toHaveLength(before + 1);
    }
  });

  it('ignores load and error events from a replaced image request', () => {
    const createElement = vi.spyOn(document, 'createElement');
    const images = (): HTMLImageElement[] =>
      createElement.mock.results
        .map((result) => result.value)
        .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
    const initialImageCount = images().length;
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    state.badges = [{ url: '/stale-avatar.webp', size: 24 }];

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    const stale = images()[initialImageCount];
    stale.dispatchEvent(new Event('error'));
    for (let frame = 0; frame < 30; frame++) {
      surface.beginFrame(320, 180, 1);
      surface.drawBase(state, 160, 90);
    }
    const replacement = images()[initialImageCount + 1];
    expect(replacement).toBeInstanceOf(HTMLImageElement);

    stale.dispatchEvent(new Event('load'));
    surface.drawBase(state, 160, 90);
    expect(
      traces[0].drawImage.mock.calls.some(([source]) => source instanceof HTMLImageElement),
    ).toBe(false);

    replacement.dispatchEvent(new Event('load'));
    surface.drawBase(state, 160, 90);
    stale.dispatchEvent(new Event('error'));
    for (let frame = 0; frame < 30; frame++) {
      surface.beginFrame(320, 180, 1);
      surface.drawBase(state, 160, 90);
    }
    expect(images()).toHaveLength(initialImageCount + 2);
    const imageBlits = traces[0].drawImage.mock.calls.filter(
      ([source]) => source instanceof HTMLImageElement,
    );
    expect(imageBlits.at(-1)?.[0]).toBe(replacement);
  });

  it('hard-bounds the live image working set with least-recently-used eviction', () => {
    expect(NAMEPLATE_IMAGE_CACHE_LIMIT).toBe(160);
    const createElement = vi.spyOn(document, 'createElement');
    const imageCount = (): number =>
      createElement.mock.results.filter((result) => result.value instanceof HTMLImageElement)
        .length;
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    const initialImageCount = imageCount();

    surface.beginFrame(320, 180, 1);
    for (let index = 0; index <= NAMEPLATE_IMAGE_CACHE_LIMIT; index++) {
      state.badges = [{ url: `/active-badge-${index}.webp`, size: 20 }];
      surface.drawBase(state, 160, 90);
    }
    expect(imageCount() - initialImageCount).toBe(NAMEPLATE_IMAGE_CACHE_LIMIT + 1);

    state.badges = [{ url: `/active-badge-${NAMEPLATE_IMAGE_CACHE_LIMIT}.webp`, size: 20 }];
    surface.drawBase(state, 160, 90);
    expect(imageCount() - initialImageCount).toBe(NAMEPLATE_IMAGE_CACHE_LIMIT + 1);

    state.badges = [{ url: '/active-badge-0.webp', size: 20 }];
    surface.drawBase(state, 160, 90);
    expect(imageCount() - initialImageCount).toBe(NAMEPLATE_IMAGE_CACHE_LIMIT + 2);
  });

  it('draws the actionable and identity presentation branches on the shared surface', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32);
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Canvas Boss',
      level: '63+',
      guild: 'The Testers',
      title: 'Gate Keeper',
      marker: '!',
      markerTone: 'active',
      hpVisible: true,
      hpFill: 0.5,
      castVisible: true,
      castFill: 0.6,
      castChannel: true,
      castLabel: 'Water Jet',
      currentTarget: true,
      hostile: true,
      threat: true,
      opacity: 0.55,
      frame: 'boss',
      comboPips: 3,
      aiLabel: '[AI]',
      badges: [
        { url: 'data:image/svg+xml,holder', size: 15 },
        { url: 'data:image/svg+xml,avatar', size: 24, circular: true, border: '#5865f2' },
      ],
      raidMarkerUrl: 'data:image/svg+xml,raid',
      emoteIconUrl: 'data:image/svg+xml,emote',
      emoteLabel: 'Cheers',
    });

    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    surface.drawEmote(state, 320, 220);

    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).toEqual(
      expect.arrayContaining([
        'Canvas Boss',
        '63+',
        '<The Testers>',
        'Gate Keeper',
        '!',
        'Water Jet',
        '[AI]',
        'Cheers',
      ]),
    );
    expect(traces[0].fillStyles).toEqual(expect.arrayContaining(['#d93632', '#48a4e8', '#20160d']));
    expect(traces[0].strokeStyles).toContain('#ff5555');
    expect(traces[0].globalAlphas).toContain(0.55);
    expect(traces[0].arc).toHaveBeenCalledTimes(7);
    const imageBlits = traces[0].drawImage.mock.calls.filter(
      ([source]) => source instanceof HTMLImageElement,
    );
    expect(imageBlits).toHaveLength(4);
  });

  it('uses system colors for actionable shapes and text in forced-colors mode', () => {
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    try {
      const parent = document.createElement('div');
      const surface = new NameplateCanvasSurface(parent);
      const state = createNameplateCanvasState();
      Object.assign(state, {
        initialized: true,
        name: 'High Contrast Hero',
        guild: 'Readers',
        title: 'Visible',
        marker: '!',
        hpVisible: true,
        hpFill: 0.5,
        castVisible: true,
        castFill: 0.5,
        castLabel: 'Interrupt Me',
        comboPips: 2,
        emoteIconUrl: 'missing-emote',
        emoteLabel: 'Hello',
      });

      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);
      surface.drawEmote(state, 320, 220);

      const fillStyles = traces.flatMap((trace) => trace.fillStyles);
      const strokeStyles = traces.flatMap((trace) => trace.strokeStyles);
      expect(fillStyles).toEqual(expect.arrayContaining(['Canvas', 'CanvasText', 'Highlight']));
      expect(strokeStyles).toEqual(expect.arrayContaining(['Canvas', 'CanvasText']));
    } finally {
      if (previousMatchMedia) {
        Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    }
  });

  it('removes its font listener and canvas when the renderer host disposes it', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve(), addEventListener, removeEventListener },
    });
    try {
      const parent = document.createElement('div');
      const surface = new NameplateCanvasSurface(parent);
      const listener = addEventListener.mock.calls[0]?.[1];

      surface.dispose();
      await Promise.resolve();

      expect(addEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));
      expect(removeEventListener).toHaveBeenCalledWith('loadingdone', listener);
      expect(parent.querySelectorAll('canvas')).toHaveLength(0);
    } finally {
      if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
});
