import { describe, expect, it } from 'vitest';
import {
  POINTER_LOCK_EDGE_MARGIN_PX,
  pointerNearViewportEdge,
} from '../src/game/pointer_lock_edge';

const VIEW = { viewportWidth: 1920, viewportHeight: 1080 };

describe('pointerNearViewportEdge', () => {
  it('is false in the middle of the window, so an ordinary look never takes the lock (no browser capture notice)', () => {
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 540, ...VIEW })).toBe(false);
  });

  it('is false just inside the margin band on every edge', () => {
    const m = POINTER_LOCK_EDGE_MARGIN_PX;
    expect(pointerNearViewportEdge({ clientX: m + 1, clientY: 540, ...VIEW })).toBe(false);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: m + 1, ...VIEW })).toBe(false);
    expect(pointerNearViewportEdge({ clientX: 1920 - m - 1, clientY: 540, ...VIEW })).toBe(false);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 1080 - m - 1, ...VIEW })).toBe(false);
  });

  it('is true within the margin of each edge, so the camera cannot freeze there', () => {
    expect(pointerNearViewportEdge({ clientX: 4, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 4, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 1916, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 1076, ...VIEW })).toBe(true);
  });

  it('is true exactly on the margin boundary (inclusive), on both the low and high side', () => {
    const m = POINTER_LOCK_EDGE_MARGIN_PX;
    expect(pointerNearViewportEdge({ clientX: m, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 1920 - m, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: m, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 1080 - m, ...VIEW })).toBe(true);
  });

  it('is true in every corner', () => {
    expect(pointerNearViewportEdge({ clientX: 0, clientY: 0, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 1920, clientY: 0, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 0, clientY: 1080, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 1920, clientY: 1080, ...VIEW })).toBe(true);
  });

  it('is true past the viewport bounds (a pointer already leaving the window)', () => {
    expect(pointerNearViewportEdge({ clientX: -20, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 2000, ...VIEW })).toBe(true);
  });

  it('respects a custom margin on both axes', () => {
    expect(pointerNearViewportEdge({ clientX: 200, clientY: 540, ...VIEW, marginPx: 300 })).toBe(
      true,
    );
    expect(pointerNearViewportEdge({ clientX: 200, clientY: 540, ...VIEW, marginPx: 100 })).toBe(
      false,
    );
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 200, ...VIEW, marginPx: 300 })).toBe(
      true,
    );
    expect(pointerNearViewportEdge({ clientX: 960, clientY: 200, ...VIEW, marginPx: 100 })).toBe(
      false,
    );
  });

  it('with a zero margin only the exact edge pixels count', () => {
    expect(pointerNearViewportEdge({ clientX: 1, clientY: 540, ...VIEW, marginPx: 0 })).toBe(false);
    expect(pointerNearViewportEdge({ clientX: 0, clientY: 540, ...VIEW, marginPx: 0 })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 1920, clientY: 540, ...VIEW, marginPx: 0 })).toBe(
      true,
    );
  });

  it('treats a window smaller than two margins as all edge band', () => {
    expect(
      pointerNearViewportEdge({
        clientX: 50,
        clientY: 50,
        viewportWidth: 100,
        viewportHeight: 100,
      }),
    ).toBe(true);
  });

  it('falls back to locking when the viewport is unusable (no window / detached host)', () => {
    expect(
      pointerNearViewportEdge({ clientX: 960, clientY: 540, viewportWidth: 0, viewportHeight: 0 }),
    ).toBe(true);
    expect(
      pointerNearViewportEdge({
        clientX: 960,
        clientY: 540,
        viewportWidth: Number.NaN,
        viewportHeight: 1080,
      }),
    ).toBe(true);
    expect(
      pointerNearViewportEdge({
        clientX: 960,
        clientY: 540,
        viewportWidth: 1920,
        viewportHeight: Number.NaN,
      }),
    ).toBe(true);
  });

  it('falls back to locking when the pointer position itself is unusable', () => {
    expect(pointerNearViewportEdge({ clientX: Number.NaN, clientY: 540, ...VIEW })).toBe(true);
    expect(pointerNearViewportEdge({ clientX: 960, clientY: Number.NaN, ...VIEW })).toBe(true);
  });
});
