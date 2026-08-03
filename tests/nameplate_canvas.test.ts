// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNameplateCanvasState,
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

  it('keeps more than 384 distinct crowd labels resident between frames', () => {
    expect(NAMEPLATE_TEXT_SPRITE_LIMIT).toBe(1536);
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
