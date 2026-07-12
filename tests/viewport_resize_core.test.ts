import { describe, expect, it } from 'vitest';
import { resolveViewportResize } from '../src/render/viewport_resize_core';

describe('resolveViewportResize', () => {
  it('refreshes render resolution when DPR changes without a CSS-size change', () => {
    expect(
      resolveViewportResize(
        { width: 1280, height: 720, pixelRatio: 2 },
        { width: 1280, height: 720, pixelRatio: 3 },
      ),
    ).toEqual({ sizeChanged: false, resolutionChanged: true });
  });

  it('does nothing when neither CSS size nor effective pixel ratio changes', () => {
    expect(
      resolveViewportResize(
        { width: 1280, height: 720, pixelRatio: 2 },
        { width: 1280, height: 720, pixelRatio: 2 },
      ),
    ).toEqual({ sizeChanged: false, resolutionChanged: false });
  });

  it('refreshes camera and render resolution when CSS size changes', () => {
    expect(
      resolveViewportResize(
        { width: 1280, height: 720, pixelRatio: 2 },
        { width: 1194, height: 720, pixelRatio: 2 },
      ),
    ).toEqual({ sizeChanged: true, resolutionChanged: true });
  });
});
