import { describe, expect, it } from 'vitest';
import { resolveViewportSize } from '../src/render/viewport_measure_core';

describe('viewport measurement', () => {
  it('prefers the visual viewport on a desktop host', () => {
    expect(
      resolveViewportSize({
        canvasWidth: 1600.4,
        canvasHeight: 900.6,
        stableMobileGameViewport: false,
        visualViewport: { width: 1580.2, height: 880.7 },
        innerWidth: 1600,
        innerHeight: 900,
      }),
    ).toEqual({ width: 1580, height: 881 });
  });

  it('falls back to the canvas box, then the window, without a visual viewport', () => {
    expect(
      resolveViewportSize({
        canvasWidth: 1280,
        canvasHeight: 720,
        stableMobileGameViewport: false,
        visualViewport: null,
        innerWidth: 1600,
        innerHeight: 900,
      }),
    ).toEqual({ width: 1280, height: 720 });
    expect(
      resolveViewportSize({
        canvasWidth: 0,
        canvasHeight: 0,
        stableMobileGameViewport: false,
        visualViewport: null,
        innerWidth: 1600,
        innerHeight: 900,
      }),
    ).toEqual({ width: 1600, height: 900 });
  });

  it('ignores the visual viewport in-game on a touch host (keyboard and chrome resizes)', () => {
    expect(
      resolveViewportSize({
        canvasWidth: 915,
        canvasHeight: 412,
        stableMobileGameViewport: true,
        visualViewport: { width: 915, height: 220 },
        innerWidth: 915,
        innerHeight: 412,
      }),
    ).toEqual({ width: 915, height: 412 });
  });

  it('never returns a zero dimension', () => {
    expect(
      resolveViewportSize({
        canvasWidth: 0,
        canvasHeight: 0,
        stableMobileGameViewport: true,
        visualViewport: null,
        innerWidth: 0,
        innerHeight: 0,
      }),
    ).toEqual({ width: 1, height: 1 });
  });
});
