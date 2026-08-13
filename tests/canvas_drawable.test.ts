// The behavioral pin for the splat-pack crash fix: a CompressedTexture's
// image is a plain {width,height} descriptor whose truthy width let it walk
// into CanvasRenderingContext2D.drawImage and take the renderer down at world
// build. The predicate must reject exactly that shape while accepting every
// real CanvasImageSource, and the pack must consult it BEFORE drawImage.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isCanvasDrawableImage } from '../src/render/canvas_drawable';

// Plain Node has none of the DOM image classes; stub minimal constructors so
// the instanceof arms are exercised, and clean them up per test.
const DOM_CLASSES = [
  'HTMLImageElement',
  'HTMLCanvasElement',
  'ImageBitmap',
  'OffscreenCanvas',
] as const;

afterEach(() => {
  for (const name of DOM_CLASSES) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

describe('isCanvasDrawableImage', () => {
  it('rejects the CompressedTexture image descriptor that crashed the renderer', () => {
    // The exact regression shape: width is truthy, nothing is drawable.
    expect(isCanvasDrawableImage({ width: 1024, height: 1024 })).toBe(false);
  });

  it('rejects null, undefined, and primitives', () => {
    expect(isCanvasDrawableImage(null)).toBe(false);
    expect(isCanvasDrawableImage(undefined)).toBe(false);
    expect(isCanvasDrawableImage(1024)).toBe(false);
    expect(isCanvasDrawableImage('canvas')).toBe(false);
  });

  it('accepts every real CanvasImageSource class, each arm exercised', () => {
    for (const name of DOM_CLASSES) {
      const Ctor = class {};
      (globalThis as Record<string, unknown>)[name] = Ctor;
      expect(isCanvasDrawableImage(new Ctor()), name).toBe(true);
      // A descriptor still fails even while the class exists.
      expect(isCanvasDrawableImage({ width: 1024, height: 1024 }), `${name} descriptor`).toBe(
        false,
      );
      delete (globalThis as Record<string, unknown>)[name];
    }
  });

  it('guards the splat pack: the predicate runs before drawImage in terrain.ts', () => {
    const terrain = readFileSync(new URL('../src/render/terrain.ts', import.meta.url), 'utf8');
    const gate = terrain.indexOf('isCanvasDrawableImage(raw) ? raw : undefined');
    const draw = terrain.indexOf('ctx.drawImage(img');
    expect(gate).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(draw);
  });
});
