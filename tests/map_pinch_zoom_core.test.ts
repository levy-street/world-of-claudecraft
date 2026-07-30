import { describe, expect, it } from 'vitest';
import {
  MAP_MIN_ZOOM,
  MAP_PINCH_DEADZONE_PX,
  MAP_TAP_MOVE_TOLERANCE_PX,
  MapPinchZoomCore,
  mapPinchZoomFactor,
  nextMapZoom,
} from '../src/ui/map_pinch_zoom_core';
import { MAP_MAX_ZOOM } from '../src/ui/map_window_view';

const pointer = (pointerId: number, x: number, y: number) => ({ pointerId, x, y });

describe('map pinch zoom core', () => {
  it('maps finger spread and pinch to multiplicative map zoom factors', () => {
    expect(mapPinchZoomFactor(100, 150)).toBeCloseTo(1.5);
    expect(mapPinchZoomFactor(150, 100)).toBeCloseTo(2 / 3);
  });

  it('pins the 8 px deadzone and accumulates smaller movement until its boundary', () => {
    expect(MAP_PINCH_DEADZONE_PX).toBe(8);
    expect(MAP_TAP_MOVE_TOLERANCE_PX).toBe(10);
    expect(mapPinchZoomFactor(100, 107)).toBe(1);
    expect(mapPinchZoomFactor(100, 108)).toBeCloseTo(1.08);
  });

  it('ignores invalid pinch distances', () => {
    expect(mapPinchZoomFactor(0, 100)).toBe(1);
    expect(mapPinchZoomFactor(Number.POSITIVE_INFINITY, 100)).toBe(1);
    expect(mapPinchZoomFactor(100, 0)).toBe(1);
    expect(mapPinchZoomFactor(100, Number.NaN)).toBe(1);
  });

  it('clamps map pinch zoom to the map-specific minimum and maximum', () => {
    expect(MAP_MIN_ZOOM).toBe(1);
    expect(MAP_MAX_ZOOM).toBe(6);
    expect(nextMapZoom(1, 100)).toBe(6);
    expect(nextMapZoom(6, 0.01)).toBe(1);
  });

  it('drives the pinch state machine through plain pointer inputs', () => {
    const core = new MapPinchZoomCore();

    expect(core.pointerDown(pointer(1, 0, 0))).toEqual({
      pinchStarted: false,
      preventDefault: false,
      zoomFactor: null,
    });
    expect(core.pointerDown(pointer(2, 100, 0))).toEqual({
      pinchStarted: true,
      preventDefault: true,
      zoomFactor: null,
    });
    expect(core.isPinching()).toBe(true);
    expect(core.pointerMove(pointer(2, 107, 0)).zoomFactor).toBeNull();
    expect(core.pointerMove(pointer(2, 109, 0)).zoomFactor).toBeCloseTo(1.09);
  });

  it('recovers from a zero-distance initial pair by taking a fresh positive baseline', () => {
    const core = new MapPinchZoomCore();
    core.pointerDown(pointer(1, 0, 0));
    core.pointerDown(pointer(2, 0, 0));

    expect(core.pointerMove(pointer(2, 100, 0)).zoomFactor).toBeNull();
    expect(core.pointerMove(pointer(2, 107, 0)).zoomFactor).toBeNull();
    expect(core.pointerMove(pointer(2, 108, 0)).zoomFactor).toBeCloseTo(1.08);
  });

  it('re-baselines when an original pinch pointer leaves and the third pointer remains', () => {
    const core = new MapPinchZoomCore();
    core.pointerDown(pointer(1, 0, 0));
    expect(core.pointerDown(pointer(2, 100, 0)).pinchStarted).toBe(true);
    core.pointerDown(pointer(3, 200, 0));
    core.pointerMove(pointer(2, 120, 0));

    expect(core.pointerEnd(1).pinchStarted).toBe(false);
    expect(core.isPinching()).toBe(true);
    expect(core.pointerMove(pointer(3, 207, 0)).zoomFactor).toBeNull();
    expect(core.pointerMove(pointer(3, 209, 0)).zoomFactor).toBeCloseTo(89 / 80);
  });

  it('ignores unrelated pointer endings without discarding accumulated deadzone movement', () => {
    const core = new MapPinchZoomCore();
    core.pointerDown(pointer(1, 0, 0));
    core.pointerDown(pointer(2, 100, 0));

    expect(core.pointerMove(pointer(2, 107, 0)).zoomFactor).toBeNull();
    core.pointerEnd(99);
    expect(core.pointerMove(pointer(2, 108, 0)).zoomFactor).toBeCloseTo(1.08);
  });

  it('distinguishes ordinary touch taps from pinch-suppressed releases', () => {
    const core = new MapPinchZoomCore();
    core.pointerDown(pointer(1, 10, 10));
    core.pointerEnd(1);

    expect(
      core.resolveTap({
        pointerId: 1,
        pointerType: 'touch',
        start: { x: 10, y: 10 },
        end: { x: 14, y: 13 },
        tolerance: 10,
      }),
    ).toBe('show');
    expect(
      core.resolveTap({
        pointerId: 4,
        pointerType: 'touch',
        start: { x: 0, y: 0 },
        end: { x: 6, y: 8 },
        tolerance: 10,
      }),
    ).toBe('show');

    core.pointerDown(pointer(2, 0, 0));
    core.pointerDown(pointer(3, 100, 0));
    core.pointerEnd(2);
    const pointer2Release = {
      pointerId: 2,
      pointerType: 'touch',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      tolerance: MAP_TAP_MOVE_TOLERANCE_PX,
    };
    expect(core.resolveTap(pointer2Release)).toBe('suppressed');
    expect(core.resolveTap(pointer2Release)).toBe('show');
    core.pointerEnd(3);
    expect(
      core.resolveTap({
        pointerId: 3,
        pointerType: 'touch',
        start: { x: 100, y: 0 },
        end: { x: 100, y: 0 },
        tolerance: 10,
      }),
    ).toBe('suppressed');

    core.pointerDown(pointer(2, 10, 10));
    core.pointerEnd(2);
    expect(
      core.resolveTap({
        pointerId: 2,
        pointerType: 'touch',
        start: { x: 10, y: 10 },
        end: { x: 10, y: 10 },
        tolerance: 10,
      }),
    ).toBe('show');
  });

  it('ignores mouse releases, missing starts, and touch movement beyond tolerance', () => {
    const core = new MapPinchZoomCore();
    expect(
      core.resolveTap({
        pointerId: 1,
        pointerType: 'mouse',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        tolerance: 10,
      }),
    ).toBe('ignore');
    expect(
      core.resolveTap({
        pointerId: 2,
        pointerType: 'touch',
        start: null,
        end: { x: 0, y: 0 },
        tolerance: 10,
      }),
    ).toBe('ignore');
    expect(
      core.resolveTap({
        pointerId: 3,
        pointerType: 'touch',
        start: { x: 0, y: 0 },
        end: { x: 11, y: 0 },
        tolerance: 10,
      }),
    ).toBe('ignore');
  });
});
