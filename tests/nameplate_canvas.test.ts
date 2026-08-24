// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNameplateCanvasState,
  NAMEPLATE_IMAGE_CACHE_LIMIT,
  NAMEPLATE_IMAGE_RETRY_BASE_FRAMES,
  NAMEPLATE_MARKER_ROW_HEIGHT,
  NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES,
  NAMEPLATE_TEXT_SPRITE_LIMIT,
  NameplateCanvasSurface,
} from '../src/render/nameplate_canvas';
import {
  NAMEPLATE_HERALDRY_EXTRA_LIFT,
  NAMEPLATE_HERALDRY_PLAQUE_PAD_X,
  NAMEPLATE_HERALDRY_WELL_ALPHA,
  NAMEPLATE_HERALDRY_WELL_FILL,
} from '../src/render/nameplate_heraldry_core';
import {
  BORDER_ACCENT_SLUGS,
  type BorderMotifKind,
  borderAccent,
  borderMotifPrimitives,
} from '../src/ui/deed_border_view';
import { DEED_HERALDRY_PLAQUE_TIP_PX } from '../src/ui/deed_heraldry_plaque_core';
import { scanReachableHotPath } from './helpers/hot_path_allocations';

// jsdom rewrites a literal `new URL('...', import.meta.url)` to an http URL.
// Keep the relative path in a variable so readFileSync still sees a file URL.
const readSource = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

interface PathOp {
  op: string;
  args: unknown[];
}

interface ContextTrace {
  canvas: HTMLCanvasElement;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  quadraticCurveTo: ReturnType<typeof vi.fn>;
  fillStyles: string[];
  strokeStyles: string[];
  globalAlphas: number[];
  pathOps: PathOp[];
}

function context(trace: ContextTrace): CanvasRenderingContext2D {
  const noop = vi.fn();
  const ctx = {
    setTransform: trace.setTransform,
    clearRect: trace.clearRect,
    save: noop,
    restore: noop,
    beginPath: trace.beginPath,
    closePath: trace.closePath,
    moveTo: trace.moveTo,
    lineTo: trace.lineTo,
    quadraticCurveTo: trace.quadraticCurveTo,
    arc: trace.arc,
    rect: trace.rect,
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

// The surface's private sprite cache, for the no-new-raster pin below: the border
// accent is SHAPES, so flipping it must mint no cache entry and no cache key.
interface SpriteCacheAccess {
  text: { size: number };
}

const spriteCount = (surface: NameplateCanvasSurface): number =>
  (surface as unknown as SpriteCacheAccess).text.size;

interface HeraldrySurfaceAccess {
  heraldry: {
    active: boolean;
    plaque: { x: number; y: number; w: number; h: number };
    plaqueShoulderX: number;
    plaqueNotchX: number;
    seal: { x: number; y: number; size: number };
    joint: { x: number; y: number; w: number; h: number };
    rivets: [{ x: number; y: number }, { x: number; y: number }];
    extraLift: number;
    motifKind: string;
    motifCenterX: number;
    motifCenterY: number;
    motifScale: number;
    nameRowTop: number;
    nameRowLeft: number;
    nameBaseline: number;
    titleBaseline: number;
    titleCenterX: number;
  };
  text: {
    draw: (
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      style: unknown,
    ) => void;
    measureAdvance: (text: string, style: unknown) => number;
  };
}

interface NameplateCanvasInternals {
  drawCast: (state: unknown, centerX: number, y: number) => void;
  drawHealth: (state: unknown, centerX: number, y: number) => void;
  drawCombo: (count: number, centerX: number, y: number) => void;
  drawImage: (url: string, x: number, y: number, size: number, circular: boolean) => void;
}

const heraldryOf = (surface: NameplateCanvasSurface): HeraldrySurfaceAccess['heraldry'] =>
  (surface as unknown as HeraldrySurfaceAccess).heraldry;

const textOf = (surface: NameplateCanvasSurface): HeraldrySurfaceAccess['text'] =>
  (surface as unknown as HeraldrySurfaceAccess).text;

const internalsOf = (surface: NameplateCanvasSurface): NameplateCanvasInternals =>
  surface as unknown as NameplateCanvasInternals;

let traces: ContextTrace[];

beforeEach(() => {
  traces = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const pathOps: PathOp[] = [];
    const record = (op: string) =>
      vi.fn((...args: unknown[]) => {
        pathOps.push({ op, args });
      });
    const trace: ContextTrace = {
      canvas: this,
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      setTransform: vi.fn(),
      beginPath: record('beginPath'),
      closePath: record('closePath'),
      rect: record('rect'),
      fill: record('fill'),
      stroke: record('stroke'),
      arc: record('arc'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      quadraticCurveTo: record('quadraticCurveTo'),
      fillStyles: [],
      strokeStyles: [],
      globalAlphas: [],
      pathOps,
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

  it('draws the byte-identical prebuilt guild wrapper, redrawn only on change', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    state.initialized = true;
    state.name = 'Guilded Hero';
    // resolveContent prebuilds the label alongside guild (its only writer);
    // drawBase consumes it without allocating.
    state.guild = 'The Testers';
    state.guildLabel = '<The Testers>';

    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);

    const drawnText = (): string[] =>
      traces.flatMap((trace) => trace.fillText.mock.calls.map(([value]) => value as string));
    // Same content as the old per-frame template build: the exact `<...>` form
    // rasterized ONCE, then re-blitted from the sprite cache on later frames.
    expect(drawnText().filter((text) => text === '<The Testers>')).toHaveLength(1);

    state.guild = 'New Banner';
    state.guildLabel = '<New Banner>';
    surface.beginFrame(320, 180, 1);
    surface.drawBase(state, 160, 90);
    expect(drawnText()).toContain('<New Banner>');
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
      guildLabel: '<The Testers>',
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

  it('routes the loot marker through the authored satchel-and-glint canvas art', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Lootable Target',
      marker: 'loot',
      markerTone: 'loot',
    });

    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);

    expect(traces[0].quadraticCurveTo).toHaveBeenCalledTimes(6);
    expect(traces[0].arc).toHaveBeenCalledTimes(1);
    expect(traces[0].fill).toHaveBeenCalledTimes(1);
    expect(traces[0].stroke).toHaveBeenCalledTimes(4);
    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).not.toContain('$');
    expect(rasterizedText).not.toContain('loot');
  });

  it('E46: draws Deed Heraldry as shapes and mints no sprite or per-slug raster', () => {
    const parent = document.createElement('div');
    const surface = new NameplateCanvasSurface(parent);
    const state = createNameplateCanvasState();
    Object.assign(state, { initialized: true, name: 'Gilded One', level: '20' });
    const accent = borderAccent('reliquary_gilt');
    expect(accent).not.toBeNull();

    // Borderless: the name row is text only, so the world reward draws no shape.
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].stroke).toHaveBeenCalledTimes(0);
    const spritesWithoutAccent = spriteCount(surface);
    expect(spritesWithoutAccent).toBeGreaterThan(0);

    state.border = 'reliquary_gilt';
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);

    const heraldry = heraldryOf(surface);
    expect(heraldry.seal.size).toBe(18);
    expect(heraldry.motifKind).toBe('vault');
    // One outer seal, one recessed face, and two quiet joint rivets. The plaque
    // itself is path geometry, never a raster or a second text pass.
    expect(traces[0].arc).toHaveBeenCalledTimes(4);
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    expect(traces[0].strokeStyles).toEqual(
      expect.arrayContaining([accent?.frame, accent?.edge, accent?.glow]),
    );
    expect(new Set([accent?.frame, accent?.edge, accent?.glow]).size).toBe(3);
    // Shapes, not a second text pass: no raster is keyed on the slug, so a player
    // flipping borders can never grow the sprite budget.
    expect(spriteCount(surface)).toBe(spritesWithoutAccent);

    // Flip through EVERY border slug and assert the sprite count stays flat the
    // whole way. The single flip above sees one border; a scheme that minted a
    // per-slug border sprite while evicting another under a byte budget could net
    // zero on one flip and slip past. Cycling all four (twice) makes any per-slug
    // mint show as growth.
    for (const slug of [...BORDER_ACCENT_SLUGS, ...BORDER_ACCENT_SLUGS]) {
      state.border = slug;
      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);
      expect(spriteCount(surface), `${slug} must mint no border sprite`).toBe(spritesWithoutAccent);
    }

    const source = readSource('../src/render/nameplate_canvas.ts');
    const drawAt = source.indexOf('private drawDeedHeraldry');
    const nextAt = source.indexOf('private drawHealth', drawAt);
    const hotWriter = source.slice(drawAt, nextAt);
    expect(drawAt).toBeGreaterThan(-1);
    expect(nextAt).toBeGreaterThan(drawAt);
    for (const forbidden of [
      'drawImage',
      'createLinearGradient',
      'createRadialGradient',
      'shadowBlur',
      '.filter',
      'new ',
      '=>',
      'gfxTier',
      'fxTier',
      'governor',
      'effectsProfile',
    ]) {
      expect(hotWriter, `heraldry hot writer must not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    const deedViewSource = readSource('../src/ui/deed_border_view.ts');
    const scan = scanReachableHotPath(
      [
        { fileName: 'src/render/nameplate_canvas.ts', source },
        { fileName: 'src/ui/deed_border_view.ts', source: deedViewSource },
      ],
      ['drawDeedHeraldry'],
    );
    expect(scan.visited).toEqual([
      'borderAccent',
      'borderMotifPrimitives',
      'drawDeedHeraldry',
      'forcedColorsActive',
    ]);
    expect(scan.allocations).toEqual([]);
    expect(scan.unresolvedCalls).toEqual([]);

    // One canonical motif owner feeds the painter directly; a duplicated local
    // per-slug table cannot satisfy this source pin even if its current shapes match.
    expect(hotWriter.match(/borderMotifPrimitives\(kind\)/g)).toHaveLength(1);
    expect(hotWriter).toContain('const motif = borderMotifPrimitives(kind);');
    expect(hotWriter).toContain('for (let i = 0; i < motif.length; i++)');
    expect(hotWriter).toContain('const line = motif[i];');
  });

  it('E44: drawEmote and drawBase share the 8px lift so the bubble clears the token', () => {
    // drawEmote re-walks drawBase's y-steps to find its anchor. Both consume
    // the same named extraLift, so the bubble stays above the seal and plaque.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Gilded One',
      level: '20',
      guild: 'The Testers',
      title: 'Gate Keeper',
      emoteIconUrl: 'data:image/svg+xml,emote',
      emoteLabel: 'Cheers',
    });
    const emoteBlits = (): unknown[][] =>
      traces[0].drawImage.mock.calls.filter(([source]) => source instanceof HTMLImageElement);
    const drawSpy = vi.spyOn(textOf(surface), 'draw');

    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    surface.drawEmote(state, 320, 220);
    const withoutAccent = emoteBlits().at(-1);
    const nameWithout = drawSpy.mock.calls.find((call) => call[1] === 'Gilded One')?.[3];
    expect(withoutAccent).toBeDefined();
    expect(nameWithout).toBeTypeOf('number');

    drawSpy.mockClear();
    state.border = 'deepward';
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    surface.drawEmote(state, 320, 220);
    const withAccent = emoteBlits().at(-1);
    const nameWith = drawSpy.mock.calls.find((call) => call[1] === 'Gilded One')?.[3];
    const heraldry = heraldryOf(surface);
    expect(withAccent).toBeDefined();
    expect(withAccent?.[1]).toBe(withoutAccent?.[1]);
    expect(withAccent?.[2]).toBe((withoutAccent?.[2] as number) - NAMEPLATE_HERALDRY_EXTRA_LIFT);
    expect(nameWith).toBe((nameWithout as number) - NAMEPLATE_HERALDRY_EXTRA_LIFT);
    expect(heraldry.plaque.y).toBeLessThan(nameWith as number);
    expect(withAccent?.[2]).toBeLessThan(heraldry.seal.y);
    expect(NAMEPLATE_HERALDRY_EXTRA_LIFT).toBe(8);
  });

  it('E46: forced colors keep the seal and plaque on the Canvas system pair', () => {
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
        guildLabel: '<Readers>',
        title: 'Visible',
        marker: '!',
        hpVisible: true,
        hpFill: 0.5,
        castVisible: true,
        castFill: 0.5,
        castLabel: 'Interrupt Me',
        comboPips: 2,
        border: 'deepward',
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
      // Deed Heraldry collapses onto the same system pair: no palette color
      // survives, and the identity it carries is cosmetic, so nothing is lost.
      const accent = borderAccent('deepward');
      expect(strokeStyles).not.toContain(accent?.frame);
      expect(strokeStyles).not.toContain(accent?.edge);
      expect(strokeStyles).not.toContain(accent?.glow);
      expect(fillStyles).not.toContain(accent?.frame);
      expect(fillStyles).not.toContain(accent?.edge);
      expect(fillStyles).not.toContain(accent?.glow);
      expect(fillStyles).not.toContain(NAMEPLATE_HERALDRY_WELL_FILL);
      expect(fillStyles).toContain('Canvas');
      expect(heraldryOf(surface).seal.size).toBe(18);
      expect(heraldryOf(surface).motifKind).toBe('ward');
    } finally {
      if (previousMatchMedia) {
        Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    }
  });

  it('E40/E46: forced colors retain four distinct seal geometry fingerprints', () => {
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    try {
      const surface = new NameplateCanvasSurface(document.createElement('div'));
      const state = createNameplateCanvasState();
      Object.assign(state, { initialized: true, name: 'Silhouette' });
      const trace = traces[0];
      const fingerprints: string[] = [];
      for (const slug of BORDER_ACCENT_SLUGS) {
        trace.moveTo.mockClear();
        trace.lineTo.mockClear();
        trace.arc.mockClear();
        trace.fillStyles.length = 0;
        trace.strokeStyles.length = 0;
        state.border = slug;
        surface.beginFrame(640, 360, 1);
        surface.drawBase(state, 320, 220);
        fingerprints.push(
          JSON.stringify({
            moveTo: trace.moveTo.mock.calls,
            lineTo: trace.lineTo.mock.calls,
            arc: trace.arc.mock.calls,
          }),
        );
        expect(new Set(trace.fillStyles), `${slug} fills`).toEqual(
          new Set(['Canvas', 'CanvasText']),
        );
        expect(new Set(trace.strokeStyles), `${slug} strokes`).toEqual(
          new Set(['Canvas', 'CanvasText']),
        );
      }
      expect(new Set(fingerprints).size).toBe(4);
    } finally {
      if (previousMatchMedia) {
        Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    }
  });

  it('draws the forced-color loot marker as a system-color satchel with no text fallback', () => {
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    try {
      const surface = new NameplateCanvasSurface(document.createElement('div'));
      const state = createNameplateCanvasState();
      Object.assign(state, {
        initialized: true,
        marker: 'loot',
        markerTone: 'loot',
      });

      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);

      expect(traces[0].fillStyles).toContain('CanvasText');
      expect(traces[0].strokeStyles).toContain('Canvas');
      expect(traces[0].quadraticCurveTo).toHaveBeenCalledTimes(6);
      expect(traces[0].arc).toHaveBeenCalledTimes(1);
      expect(traces[0].fill).toHaveBeenCalledTimes(1);
      expect(traces[0].stroke).toHaveBeenCalledTimes(4);
      const rasterizedText = traces.flatMap((trace) =>
        trace.fillText.mock.calls.map(([value]) => value),
      );
      expect(rasterizedText).not.toContain('$');
      expect(rasterizedText).not.toContain('loot');
    } finally {
      if (previousMatchMedia) {
        Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    }
  });

  it('E38: the plaque owns the name row and the equipped title stays outside', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Gilded One',
      title: 'Gate Keeper',
      border: 'deepward',
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).toContain('Gate Keeper');
    expect(rasterizedText).toContain('Gilded One');
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    const heraldry = heraldryOf(surface);
    const plaqueWidth = heraldry.plaque.w;
    const title = drawSpy.mock.calls.find((call) => call[1] === 'Gate Keeper');
    expect(title?.[2]).toBe(heraldry.titleCenterX);
    expect(title?.[3]).toBe(heraldry.titleBaseline);
    expect(heraldry.titleCenterX).toBe(320);
    expect(heraldry.titleBaseline).toBeGreaterThan(heraldry.plaque.y + heraldry.plaque.h);
    expect(heraldry.titleBaseline - (heraldry.plaque.y + heraldry.plaque.h)).toBe(8);

    // Title width is deliberately absent from the heraldry input: even a title
    // much wider than the name cannot widen the name-owned plaque.
    state.title = 'Keeper of the Impossibly Wide Secondary Line';
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(heraldryOf(surface).plaque.w).toBe(plaqueWidth);
  });

  it('E39: Unicode, chips, and 15/24px badges stay centered and clear the seal', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'AFK [GM] Ångström界',
      border: 'deepward',
      aiLabel: '[AI]',
      cheaterLabel: '< Cheater >',
      badges: [
        { url: 'holder', size: 15 },
        { url: 'avatar', size: 24, circular: true },
      ],
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    const imageSpy = vi.spyOn(internalsOf(surface), 'drawImage');
    vi.spyOn(textOf(surface), 'measureAdvance').mockImplementation((text) => {
      if (text === 'AFK [GM] Ångström界') return 147;
      if (text === '[AI]') return 28;
      if (text === '< Cheater >') return 70;
      return text.length * 7;
    });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const heraldry = heraldryOf(surface);
    const contentWidth =
      heraldry.plaqueShoulderX - heraldry.plaque.x - NAMEPLATE_HERALDRY_PLAQUE_PAD_X * 2;
    expect(contentWidth).toBe(296);
    expect(heraldry.nameRowLeft).toBe(172);
    expect(heraldry.nameRowLeft + contentWidth / 2).toBe(320);
    expect(heraldry.plaque.x).toBe(165);
    expect(heraldry.plaque.w).toBe(318);
    expect(heraldry.plaque.h).toBe(26);
    expect(heraldry.nameRowTop - heraldry.plaque.y).toBe(1);
    expect(heraldry.plaque.y + heraldry.plaque.h - (heraldry.nameRowTop + 24)).toBe(1);
    expect(heraldry.seal.x + heraldry.seal.size).toBeLessThan(heraldry.nameRowLeft);
    expect(heraldry.nameRowLeft - (heraldry.seal.x + heraldry.seal.size)).toBe(9);
    expect(heraldry.joint.x + heraldry.joint.w).toBeLessThanOrEqual(heraldry.nameRowLeft);
    const ai = drawSpy.mock.calls.find((call) => call[1] === '[AI]');
    const cheater = drawSpy.mock.calls.find((call) => call[1] === '< Cheater >');
    const name = drawSpy.mock.calls.find((call) => call[1] === 'AFK [GM] Ångström界');
    const holder = imageSpy.mock.calls.find((call) => call[0] === 'holder');
    const avatar = imageSpy.mock.calls.find((call) => call[0] === 'avatar');
    const ranges = {
      holder: [holder?.[1], (holder?.[1] as number) + 15],
      avatar: [avatar?.[1], (avatar?.[1] as number) + 24],
      cheater: [(cheater?.[2] as number) - 35, (cheater?.[2] as number) + 35],
      ai: [(ai?.[2] as number) - 14, (ai?.[2] as number) + 14],
      name: [(name?.[2] as number) - 73.5, (name?.[2] as number) + 73.5],
    };
    expect(ranges).toEqual({
      holder: [172, 187],
      avatar: [190, 214],
      cheater: [217, 287],
      ai: [290, 318],
      name: [321, 468],
    });
    const ordered = [ranges.holder, ranges.avatar, ranges.cheater, ranges.ai, ranges.name];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1][1], `row item ${i - 1} must clear item ${i}`).toBeLessThan(
        ordered[i][0] as number,
      );
    }
    expect(ordered[0][0]).toBe(heraldry.nameRowLeft);
    expect(ordered.at(-1)?.[1]).toBe(heraldry.nameRowLeft + contentWidth);
    expect(ai?.[3]).toBe(heraldry.nameBaseline);
    expect(cheater?.[3]).toBe(heraldry.nameBaseline);
    expect(name?.[3]).toBe(heraldry.nameBaseline);
    expect(heraldry.nameBaseline).toBeGreaterThan(heraldry.plaque.y);
    expect(heraldry.nameBaseline).toBeLessThan(heraldry.plaque.y + heraldry.plaque.h);
  });

  it('E43: pairs ordinary 12px/16px/18px sizing against target 14px/18px/20px', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, { initialized: true, name: 'Ordinary', border: 'deepward' });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');

    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const ordinary = drawSpy.mock.calls.find((call) => call[1] === 'Ordinary');
    expect((ordinary?.[4] as { font?: string } | undefined)?.font).toBe(
      '700 12px Cinzel, Georgia, serif',
    );
    expect(heraldryOf(surface).plaque.h - 2).toBe(16);
    expect(heraldryOf(surface).plaque.h).toBe(18);

    Object.assign(state, { name: 'Target', currentTarget: true });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const target = drawSpy.mock.calls.find((call) => call[1] === 'Target');
    expect((target?.[4] as { font?: string } | undefined)?.font).toBe(
      '700 14px Cinzel, Georgia, serif',
    );
    expect(heraldryOf(surface).plaque.h - 2).toBe(18);
    expect(heraldryOf(surface).plaque.h).toBe(20);
  });

  it.each(
    BORDER_ACCENT_SLUGS.flatMap((border) => [
      { border, name: 'I', width: 7 },
      { border, name: 'AFK [GM] Ångström界', width: 147 },
    ]),
  )(
    'E37/E40: pins the exact plaque and $border seal path grammar for $name',
    ({ border, name, width }) => {
      const surface = new NameplateCanvasSurface(document.createElement('div'));
      const state = createNameplateCanvasState();
      Object.assign(state, { initialized: true, name, border });
      vi.spyOn(textOf(surface), 'measureAdvance').mockReturnValue(width);

      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);

      const trace = traces[0];
      const heraldry = heraldryOf(surface);
      const { plaque, plaqueShoulderX, plaqueNotchX, joint, seal } = heraldry;
      const plaqueMiddleY = plaque.y + plaque.h / 2;
      const sealCenterX = seal.x + seal.size / 2;
      const sealCenterY = seal.y + seal.size / 2;
      const expected: PathOp[] = [
        { op: 'beginPath', args: [] },
        { op: 'moveTo', args: [plaque.x, plaque.y] },
        { op: 'lineTo', args: [plaqueShoulderX, plaque.y] },
        { op: 'lineTo', args: [plaque.x + plaque.w, plaqueMiddleY] },
        { op: 'lineTo', args: [plaqueShoulderX, plaque.y + plaque.h] },
        { op: 'lineTo', args: [plaque.x, plaque.y + plaque.h] },
        { op: 'lineTo', args: [plaqueNotchX, plaqueMiddleY] },
        { op: 'closePath', args: [] },
        { op: 'fill', args: [] },
        { op: 'stroke', args: [] },
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
        { op: 'moveTo', args: [plaque.x + 5, plaque.y + 2] },
        { op: 'lineTo', args: [plaqueShoulderX - 2, plaque.y + 2] },
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
        { op: 'rect', args: [joint.x, joint.y, joint.w, joint.h] },
        { op: 'fill', args: [] },
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
        { op: 'arc', args: [sealCenterX, sealCenterY, seal.size / 2, 0, Math.PI * 2] },
        { op: 'fill', args: [] },
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
        { op: 'arc', args: [sealCenterX, sealCenterY, seal.size / 2 - 3, 0, Math.PI * 2] },
        { op: 'fill', args: [] },
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
      ];
      for (const line of borderMotifPrimitives(heraldry.motifKind as BorderMotifKind)) {
        expected.push(
          {
            op: 'moveTo',
            args: [
              heraldry.motifCenterX + line.x1 * heraldry.motifScale,
              heraldry.motifCenterY + line.y1 * heraldry.motifScale,
            ],
          },
          {
            op: 'lineTo',
            args: [
              heraldry.motifCenterX + line.x2 * heraldry.motifScale,
              heraldry.motifCenterY + line.y2 * heraldry.motifScale,
            ],
          },
        );
      }
      expected.push(
        { op: 'stroke', args: [] },
        { op: 'beginPath', args: [] },
        {
          op: 'arc',
          args: [heraldry.rivets[0].x, heraldry.rivets[0].y, 1, 0, Math.PI * 2],
        },
        { op: 'fill', args: [] },
        { op: 'beginPath', args: [] },
        {
          op: 'arc',
          args: [heraldry.rivets[1].x, heraldry.rivets[1].y, 1, 0, Math.PI * 2],
        },
        { op: 'fill', args: [] },
      );

      expect(heraldry.plaque.w).toBe(
        width + NAMEPLATE_HERALDRY_PLAQUE_PAD_X * 2 + DEED_HERALDRY_PLAQUE_TIP_PX,
      );
      expect(trace.pathOps).toEqual(expected);
      expect(trace.stroke).toHaveBeenCalledTimes(7);
    },
  );

  it('E37: replaces the old perimeter hardware with one forged seal and plaque path', () => {
    expect(existsSync(new URL('../src/render/nameplate_cartouche_core.ts', import.meta.url))).toBe(
      false,
    );
    const source = readSource('../src/render/nameplate_canvas.ts');
    expect(source).toContain("from './nameplate_heraldry_core'");
    expect(source).not.toContain("from './nameplate_cartouche_core'");
    const drawAt = source.indexOf('private drawDeedHeraldry');
    const nextAt = source.indexOf('private drawHealth', drawAt);
    const drawBody = source.slice(drawAt, nextAt);
    expect(drawAt).toBeGreaterThan(-1);
    expect(nextAt).toBeGreaterThan(drawAt);
    expect(drawBody).toContain('heraldry.plaque');
    expect(drawBody).toContain('heraldry.seal');
    for (const retired of ['.outer', '.inner', '.brackets', '.clasp']) {
      expect(drawBody).not.toContain(retired);
    }
  });

  it('retains E9: draws the dev-tier name outline after the plaque, never under it', () => {
    const source = readSource('../src/render/nameplate_canvas.ts');
    const accentAt = source.indexOf('if (heraldry.active) this.drawDeedHeraldry');
    const outlineAt = source.indexOf(
      'this.text.draw(this.ctx, state.name, nameX, nameBaseline, devStyle)',
    );
    expect(accentAt).toBeGreaterThan(-1);
    expect(outlineAt).toBeGreaterThan(accentAt);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Outlined',
      border: 'deepward',
      devOutline: '#6ee7b7',
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    const plaqueFillOrder = traces[0].fill.mock.invocationCallOrder[0];
    const outlineOrder = drawSpy.mock.invocationCallOrder[0];
    expect(plaqueFillOrder).toBeLessThan(outlineOrder);
  });

  it('E41: keeps guild below the health bar and outside the name plaque', () => {
    const source = readSource('../src/render/nameplate_canvas.ts');
    const guildAt = source.indexOf('if (state.guild)');
    const liftAt = source.indexOf('y -= this.heraldryLift(state)');
    expect(guildAt).toBeGreaterThan(-1);
    expect(liftAt).toBeGreaterThan(guildAt);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Guilded',
      guild: 'The Testers',
      guildLabel: '<The Testers>',
      border: 'deepward',
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).toContain('<The Testers>');
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    const guild = drawSpy.mock.calls.find((call) => call[1] === '<The Testers>');
    const heraldry = heraldryOf(surface);
    expect(guild?.[3]).toBeGreaterThan(heraldry.plaque.y + heraldry.plaque.h);
  });

  it('E41: pins every pair in the cast, HP, guild, quest, combo, raid, and emote y-walk', () => {
    const source = readSource('../src/render/nameplate_canvas.ts');
    expect(source).toContain('if (state.castVisible) {\n      y -= 10;');
    expect(source).toContain('if (state.hpVisible) {\n      y -= 7;');
    expect(NAMEPLATE_MARKER_ROW_HEIGHT).toBe(26);
    expect(source).toContain('if (state.comboPips > 0) {\n      y -= 9;');
    expect(source).toContain('if (state.raidMarkerUrl) {\n      y -= 31;');
    expect(source).toContain('y -= 47;');
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(30);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Marked',
      border: 'deepward',
      guild: 'The Testers',
      guildLabel: '<The Testers>',
      title: 'Secondary',
      castVisible: true,
      castFill: 0.5,
      castLabel: 'Cast',
      hpVisible: true,
      hpFill: 0.5,
      marker: '!',
      markerTone: 'quest',
      comboPips: 2,
      raidMarkerUrl: 'raid-mark',
      emoteIconUrl: 'emote',
      emoteLabel: 'Wave',
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    const internals = internalsOf(surface);
    const castSpy = vi.spyOn(internals, 'drawCast');
    const healthSpy = vi.spyOn(internals, 'drawHealth');
    const comboSpy = vi.spyOn(internals, 'drawCombo');
    const imageSpy = vi.spyOn(internals, 'drawImage');
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    surface.drawEmote(state, 320, 220);
    const heraldry = heraldryOf(surface);
    const plaqueTop = heraldry.plaque.y;
    const plaqueBottom = heraldry.plaque.y + heraldry.plaque.h;
    const cast = drawSpy.mock.calls.find((call) => call[1] === 'Cast');
    const guild = drawSpy.mock.calls.find((call) => call[1] === '<The Testers>');
    const quest = drawSpy.mock.calls.find((call) => call[1] === '!');
    const raid = imageSpy.mock.calls.find((call) => call[0] === 'raid-mark');
    const emote = imageSpy.mock.calls.find((call) => call[0] === 'emote');
    const exactY = {
      guild: guild?.[3],
      hp: healthSpy.mock.calls[0]?.[2],
      cast: castSpy.mock.calls[0]?.[2],
      quest: quest?.[3],
      combo: comboSpy.mock.calls[0]?.[2],
      raid: raid?.[2],
      emote: emote?.[2],
    };
    expect(exactY).toEqual({
      guild: 201,
      hp: 203,
      cast: 210,
      quest: 151,
      combo: 121,
      raid: 90,
      emote: 47,
    });
    const topToBottom = [
      exactY.emote,
      exactY.raid,
      exactY.combo,
      exactY.quest,
      exactY.guild,
      exactY.hp,
      exactY.cast,
    ] as number[];
    expect(new Set(topToBottom).size).toBe(7);
    for (let higher = 0; higher < topToBottom.length; higher++) {
      for (let lower = higher + 1; lower < topToBottom.length; lower++) {
        expect(topToBottom[higher], `slot ${higher} must stay above slot ${lower}`).toBeLessThan(
          topToBottom[lower],
        );
      }
    }
    expect(cast?.[3]).toBe(217);
    expect(cast?.[3]).toBeGreaterThan(plaqueBottom);
    expect(quest?.[3]).toBeLessThan(plaqueTop);
  });

  it('E43: death hides HP but keeps the equipped Deed Heraldry token', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Fallen',
      hpVisible: false,
      deadEnemy: true,
      border: 'prestige_laurels',
    });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    expect(heraldryOf(surface).active).toBe(true);
    expect(heraldryOf(surface).motifKind).toBe('laurel');
  });

  it('E43: stealth opacity applies to both the token and its midnight plaque', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Sneak',
      opacity: 0.55,
      border: 'deepward',
    });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].globalAlphas).toContain(0.55);
    expect(NAMEPLATE_HERALDRY_WELL_ALPHA).toBe(0.62);
    expect(traces[0].globalAlphas).toContain(0.55 * 0.62);
    expect(traces[0].fillStyles).toContain(NAMEPLATE_HERALDRY_WELL_FILL);
  });

  it('E43: friendly and hostile names keep reaction color under the same slug metal', () => {
    const accent = borderAccent('curators_gilt');
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Rival',
      hostile: true,
      border: 'curators_gilt',
    });
    const drawSpy = vi.spyOn(textOf(surface), 'draw');
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].strokeStyles).toEqual(
      expect.arrayContaining([accent?.frame, accent?.edge, accent?.glow]),
    );
    expect(traces[0].strokeStyles).not.toContain('#ff5555');
    const rival = drawSpy.mock.calls.find((call) => call[1] === 'Rival');
    expect((rival?.[4] as { fill?: string } | undefined)?.fill).toBe('#ff5555');

    Object.assign(state, { name: 'Ally', hostile: false, nameColor: '#76b653' });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const ally = drawSpy.mock.calls.filter((call) => call[1] === 'Ally').at(-1);
    expect((ally?.[4] as { fill?: string } | undefined)?.fill).toBe('#76b653');

    Object.assign(state, { name: 'Target', currentTarget: true });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const target = drawSpy.mock.calls.filter((call) => call[1] === 'Target').at(-1);
    expect((target?.[4] as { font?: string } | undefined)?.font).toContain('14px');
    expect(heraldryOf(surface).plaque.h).toBe(20);
  });

  it('E42: a borderless plate paints no token and retains the secondary title line', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, {
      initialized: true,
      name: 'Plain',
      title: 'Veteran',
    });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    expect(traces[0].fillStyles).not.toContain(NAMEPLATE_HERALDRY_WELL_FILL);
    expect(traces[0].stroke).toHaveBeenCalledTimes(0);
    expect(heraldryOf(surface).active).toBe(false);
    expect(heraldryOf(surface).seal.size).toBe(0);
    expect(heraldryOf(surface).plaque.w).toBe(0);
    const rasterizedText = traces.flatMap((trace) =>
      trace.fillText.mock.calls.map(([value]) => value),
    );
    expect(rasterizedText).toContain('Veteran');
    expect(rasterizedText).toContain('Plain');
  });

  it('E42: empty and unknown slugs zero geometry and paint no heraldry', () => {
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    state.initialized = true;
    state.name = 'No Accent';
    for (const slug of ['', 'slug_with_no_palette']) {
      traces[0].fillStyles.length = 0;
      traces[0].stroke.mockClear();
      state.border = slug;
      surface.beginFrame(640, 360, 1);
      surface.drawBase(state, 320, 220);
      expect(traces[0].fillStyles, slug || '(empty)').not.toContain(NAMEPLATE_HERALDRY_WELL_FILL);
      expect(traces[0].stroke, slug || '(empty)').toHaveBeenCalledTimes(0);
      expect(heraldryOf(surface).active, slug || '(empty)').toBe(false);
      expect(heraldryOf(surface).seal.size, slug || '(empty)').toBe(0);
      expect(heraldryOf(surface).plaque.w, slug || '(empty)').toBe(0);
    }
  });

  it('E44: heraldry geometry stays in CSS pixels at DPR 1 and 2', () => {
    const source = readSource('../src/render/nameplate_canvas.ts');
    expect(source).toContain('y -= this.heraldryLift(state)');
    expect(source).not.toContain('heraldryLift(state) *');
    expect(source).not.toContain('EXTRA_LIFT *');
    expect(source).not.toContain('--fx-shadow');
    expect(NAMEPLATE_HERALDRY_EXTRA_LIFT).toBe(8);
    const surface = new NameplateCanvasSurface(document.createElement('div'));
    const state = createNameplateCanvasState();
    Object.assign(state, { initialized: true, name: 'Scale', border: 'deepward' });
    surface.beginFrame(640, 360, 1);
    surface.drawBase(state, 320, 220);
    const cssGeometry = JSON.parse(JSON.stringify(heraldryOf(surface))) as unknown;
    surface.beginFrame(640, 360, 2);
    surface.drawBase(state, 320, 220);
    expect(JSON.parse(JSON.stringify(heraldryOf(surface)))).toEqual(cssGeometry);
    expect(heraldryOf(surface).extraLift).toBe(8);
  });

  it('retains E18/E20: self-hide and non-player paths never assign a worn slug after reset', () => {
    const painter = readSource('../src/render/nameplate_painter.ts');
    const resetAt = painter.indexOf("state.border = '';");
    const playerBorderAt = painter.indexOf('state.border = deedBorderSlug(entity.border);');
    const suppressAt = painter.indexOf('if (suppressSelf)');
    const objectReturnAt = painter.indexOf("if (entity.kind === 'object')");
    const playerAt = painter.indexOf("if (entity.kind === 'player')");
    expect(resetAt).toBeGreaterThan(-1);
    expect(playerBorderAt).toBeGreaterThan(playerAt);
    expect(suppressAt).toBeGreaterThan(playerAt);
    expect(suppressAt).toBeLessThan(playerBorderAt);
    expect(objectReturnAt).toBeGreaterThan(-1);
    expect(objectReturnAt).toBeLessThan(playerAt);
    expect(painter.split('state.border = deedBorderSlug').length - 1).toBe(1);
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
