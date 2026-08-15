import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createNameplateCanvasState,
  NameplateCanvasSurface,
} from '../../src/render/nameplate_canvas';

interface InkBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

const WIDTH = 480;
const HEIGHT = 180;
const NAME_X = WIDTH / 2;
const NAME_BOTTOM_Y = 120;
const NAME_BASELINE_Y = NAME_BOTTOM_Y - 3;
const NAME_FONT = '700 12px Cinzel, Georgia, serif';
const SAMPLE = 'MAX 黒石 Герой';
const SHIPPING_CINZEL_URL = '/fonts/cinzel-400-700-latin.woff2';
let shippingCinzel: FontFace;

beforeAll(async () => {
  const response = await fetch(SHIPPING_CINZEL_URL);
  if (!response.ok) throw new Error(`failed to load ${SHIPPING_CINZEL_URL}: ${response.status}`);
  shippingCinzel = new FontFace('Cinzel', await response.arrayBuffer(), {
    style: 'normal',
    weight: '400 700',
  });
  await shippingCinzel.load();
  document.fonts.add(shippingCinzel);
  await document.fonts?.ready;
});

afterEach(() => {
  document.body.replaceChildren();
});

function inkBounds(canvas: HTMLCanvasElement): InkBounds {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('browser runner has no 2D context');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY, count };
}

function logicalBounds(bounds: InkBounds, dpr: number): InkBounds {
  return {
    minX: bounds.minX / dpr,
    maxX: bounds.maxX / dpr,
    minY: bounds.minY / dpr,
    maxY: bounds.maxY / dpr,
    count: bounds.count,
  };
}

function directName(dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('browser runner has no direct-name context');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.miterLimit = 8;
  ctx.strokeText(SAMPLE, NAME_X, NAME_BASELINE_Y);
  ctx.fillStyle = '#fff';
  ctx.fillText(SAMPLE, NAME_X, NAME_BASELINE_Y);
  return canvas;
}

function renderedName(dpr: number): { surface: NameplateCanvasSurface; canvas: HTMLCanvasElement } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const surface = new NameplateCanvasSurface(parent);
  const state = createNameplateCanvasState();
  state.name = SAMPLE;
  surface.beginFrame(WIDTH, HEIGHT, dpr);
  surface.drawBase(state, NAME_X, NAME_BOTTOM_Y);
  return { surface, canvas: surface.canvas };
}

function pixelColor(canvas: HTMLCanvasElement, x: number, y: number): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('browser runner has no color context');
  return Array.from(ctx.getImageData(x, y, 1, 1).data).join(',');
}

function systemColor(color: string, background?: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('browser runner has no system-color context');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 8, 8);
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 8, 8);
  return pixelColor(canvas, 4, 4);
}

function pixelColors(canvas: HTMLCanvasElement): Set<string> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('browser runner has no palette context');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  }
  return colors;
}

describe('nameplate canvas in a real browser', () => {
  it('loads the shipping local Cinzel face used by nameplates', () => {
    expect(new URL(SHIPPING_CINZEL_URL, location.href).origin).toBe(location.origin);
    expect(shippingCinzel.status).toBe('loaded');
    expect(document.fonts.has(shippingCinzel)).toBe(true);
    expect(document.fonts.check(NAME_FONT, 'MAX')).toBe(true);
  });

  for (const dpr of [1, 2]) {
    it(`matches direct browser text metrics without clipping at DPR ${dpr}`, () => {
      const rendered = renderedName(dpr);
      try {
        expect(rendered.canvas.width).toBe(WIDTH * dpr);
        expect(rendered.canvas.height).toBe(HEIGHT * dpr);
        const got = logicalBounds(inkBounds(rendered.canvas), dpr);
        const want = logicalBounds(inkBounds(directName(dpr)), dpr);

        expect(got.count).toBeGreaterThan(0);
        expect(got.minX).toBeGreaterThan(0);
        expect(got.maxX).toBeLessThan(WIDTH - 1);
        expect(Math.abs(got.minX - want.minX)).toBeLessThanOrEqual(1);
        expect(Math.abs(got.maxX - want.maxX)).toBeLessThanOrEqual(1);
        expect(Math.abs(got.minY - want.minY)).toBeLessThanOrEqual(1);
        expect(Math.abs(got.maxY - want.maxY)).toBeLessThanOrEqual(1);
      } finally {
        rendered.surface.dispose();
      }
    });
  }

  it('renders actionable forced-colors shapes through real Canvas2D system colors', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          matches: query === '(forced-colors: active)',
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }) satisfies MediaQueryList,
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const surface = new NameplateCanvasSurface(parent);
    try {
      const state = createNameplateCanvasState();
      Object.assign(state, {
        name: 'Contrast Hero',
        hpVisible: true,
        hpFill: 0.55,
        castVisible: true,
        castFill: 0.65,
        castLabel: 'Interrupt',
        marker: '!',
        comboPips: 2,
      });
      surface.beginFrame(WIDTH, HEIGHT, 1);
      surface.drawBase(state, NAME_X, NAME_BOTTOM_Y);

      expect(inkBounds(surface.canvas).count).toBeGreaterThan(100);
      expect(pixelColor(surface.canvas, NAME_X, 105)).toBe(systemColor('Highlight', 'Canvas'));
      expect(pixelColors(surface.canvas).has(systemColor('CanvasText', 'Canvas'))).toBe(true);
    } finally {
      surface.dispose();
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
