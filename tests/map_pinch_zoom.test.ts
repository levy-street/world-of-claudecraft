import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bindMapPinchZoom,
  finishMapTap,
  type MapPinchZoomBinding,
  mapTapReleaseFromPointer,
} from '../src/ui/map_pinch_zoom';
import { MAP_TAP_MOVE_TOLERANCE_PX, nextMapZoom } from '../src/ui/map_pinch_zoom_core';

const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const pinchSource = readFileSync(new URL('../src/ui/map_pinch_zoom.ts', import.meta.url), 'utf8');

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`missing source section: ${start}`);
  return source.slice(startIndex, endIndex);
}

const mapGestureSource = sourceSection(
  hudSource,
  'const mapPinch = bindMapPinchZoom(mapCanvas',
  "$('#mm-bag').addEventListener",
);
const zoomMapSource = sourceSection(
  hudSource,
  'private zoomMap(factor: number): void {',
  '// The map window shows the zone band',
);

function pointerHarness() {
  const listeners = new Map<string, ((event: PointerEvent) => void)[]>();
  const captured: number[] = [];
  const canvas = {
    addEventListener(type: string, listener: (event: PointerEvent) => void) {
      const group = listeners.get(type) ?? [];
      group.push(listener);
      listeners.set(type, group);
    },
    setPointerCapture(pointerId: number) {
      captured.push(pointerId);
    },
  } as unknown as HTMLCanvasElement;
  const dispatch = (
    type: string,
    pointerId: number,
    x: number,
    y: number,
    pointerType = 'touch',
  ): boolean => {
    let prevented = false;
    const event = {
      pointerId,
      pointerType,
      clientX: x,
      clientY: y,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as PointerEvent;
    for (const listener of listeners.get(type) ?? []) listener(event);
    return prevented;
  };
  return { canvas, captured, dispatch };
}

describe('map pinch zoom', () => {
  it('routes two-pointer gestures through map-only zoom state', () => {
    expect(mapGestureSource).toContain('onZoom: (factor) => this.zoomMap(factor)');
    expect(mapGestureSource).toMatch(
      /onPinchStart: \(\) => \{\s*this\.mapDrag = null;\s*mapCanvas\.style\.cursor = '';\s*\}/,
    );
    expect(mapGestureSource).toContain(
      'if (mapPinch.isPinching() || !this.mapView || this.mapZoom <= 1) return;',
    );
    expect(mapGestureSource).toContain(
      'if (mapPinch.isPinching() || !this.mapDrag || !this.mapView) return;',
    );
    expect(mapGestureSource).toContain(
      'mapTapReleaseFromPointer(ev, mapTapStart, MAP_TAP_MOVE_TOLERANCE_PX)',
    );
    expect(mapGestureSource).toContain('showMapTipAt,');
    expect(zoomMapSource).toContain('this.mapZoom = nextMapZoom(this.mapZoom, factor)');
    expect(zoomMapSource).not.toMatch(/\b(?:camera|renderer|input|zoomBy)\b/i);
    expect(pinchSource).toContain("canvas.addEventListener('pointercancel', endPinchPointer)");
    expect(pinchSource).not.toMatch(/from '\.\.\/(?:game|render)\//);
    expect(pinchSource).not.toMatch(/\bcamera\b/i);
  });

  it('emits cumulative map zoom with two touches and suppresses both marker taps', () => {
    const harness = pointerHarness();
    const zooms: number[] = [];
    let mapZoom = 1;
    let starts = 0;
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {
        starts += 1;
      },
      onZoom: (factor) => {
        zooms.push(factor);
        mapZoom = nextMapZoom(mapZoom, factor);
      },
    });

    expect(harness.dispatch('pointerdown', 1, 0, 0)).toBe(false);
    expect(pinch.isPinching()).toBe(false);
    expect(harness.dispatch('pointerdown', 2, 100, 0)).toBe(true);
    expect(pinch.isPinching()).toBe(true);
    expect(starts).toBe(1);
    expect(harness.captured).toEqual([1, 2]);

    harness.dispatch('pointermove', 2, 107, 0);
    expect(zooms).toEqual([]);
    harness.dispatch('pointermove', 2, 109, 0);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toBeCloseTo(1.09);
    expect(mapZoom).toBeCloseTo(1.09);

    harness.dispatch('pointerup', 2, 109, 0);
    expect(pinch.isPinching()).toBe(false);
    harness.dispatch('pointerup', 1, 0, 0);
    expect(
      pinch.resolveTap({
        pointerId: 1,
        pointerType: 'touch',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        tolerance: 10,
      }),
    ).toBe('suppressed');
    expect(
      pinch.resolveTap({
        pointerId: 2,
        pointerType: 'touch',
        start: { x: 100, y: 0 },
        end: { x: 109, y: 0 },
        tolerance: 10,
      }),
    ).toBe('suppressed');
  });

  it('allows an ordinary stationary touch to reach map marker tap handling', () => {
    const harness = pointerHarness();
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {},
      onZoom: () => {},
    });
    harness.dispatch('pointerdown', 1, 10, 10);
    harness.dispatch('pointerup', 1, 14, 13);

    expect(
      pinch.resolveTap({
        pointerId: 1,
        pointerType: 'touch',
        start: { x: 10, y: 10 },
        end: { x: 14, y: 13 },
        tolerance: 10,
      }),
    ).toBe('show');
  });

  it('shows a marker only when the binding resolves the release as a tap', () => {
    const decisions = ['show', 'suppressed', 'ignore'] as const;
    let decisionIndex = 0;
    const binding: MapPinchZoomBinding = {
      isPinching: () => false,
      resolveTap: () => decisions[decisionIndex++],
    };
    const shown: Array<{ x: number; y: number }> = [];
    const release = {
      pointerId: 1,
      pointerType: 'touch',
      start: { x: 10, y: 10 },
      end: { x: 14, y: 13 },
      tolerance: 10,
    };

    finishMapTap(binding, release, (x, y) => shown.push({ x, y }));
    finishMapTap(binding, release, (x, y) => shown.push({ x, y }));
    finishMapTap(binding, release, (x, y) => shown.push({ x, y }));

    expect(shown).toEqual([{ x: 14, y: 13 }]);
  });

  it('maps the complete pointer release payload into the tap core input', () => {
    const start = { x: 10, y: 20 };
    expect(
      mapTapReleaseFromPointer(
        {
          pointerId: 7,
          pointerType: 'touch',
          clientX: 30,
          clientY: 40,
        } as PointerEvent,
        start,
        MAP_TAP_MOVE_TOLERANCE_PX,
      ),
    ).toEqual({
      pointerId: 7,
      pointerType: 'touch',
      start,
      end: { x: 30, y: 40 },
      tolerance: MAP_TAP_MOVE_TOLERANCE_PX,
    });
  });

  it('cleans up a cancelled pointer without losing tap suppression', () => {
    const harness = pointerHarness();
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {},
      onZoom: () => {},
    });
    harness.dispatch('pointerdown', 1, 0, 0);
    harness.dispatch('pointerdown', 2, 100, 0);

    harness.dispatch('pointercancel', 2, 100, 0);

    expect(pinch.isPinching()).toBe(false);
    expect(
      pinch.resolveTap({
        pointerId: 2,
        pointerType: 'touch',
        start: { x: 100, y: 0 },
        end: { x: 100, y: 0 },
        tolerance: 10,
      }),
    ).toBe('suppressed');
  });

  it('cleans silent capture loss and starts a fresh pinch from a new baseline', () => {
    const harness = pointerHarness();
    const zooms: number[] = [];
    let starts = 0;
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {
        starts += 1;
      },
      onZoom: (factor) => zooms.push(factor),
    });
    harness.dispatch('pointerdown', 1, 0, 0);
    harness.dispatch('pointerdown', 2, 100, 0);

    harness.dispatch('lostpointercapture', 2, 100, 0);
    harness.dispatch('lostpointercapture', 1, 0, 0);

    expect(pinch.isPinching()).toBe(false);
    expect(
      pinch.resolveTap({
        pointerId: 1,
        pointerType: 'touch',
        start: null,
        end: { x: 0, y: 0 },
        tolerance: 10,
      }),
    ).toBe('ignore');
    expect(
      pinch.resolveTap({
        pointerId: 2,
        pointerType: 'touch',
        start: null,
        end: { x: 100, y: 0 },
        tolerance: 10,
      }),
    ).toBe('ignore');
    expect(harness.dispatch('pointerdown', 3, 0, 0)).toBe(false);
    expect(pinch.isPinching()).toBe(false);
    expect(harness.dispatch('pointerdown', 4, 100, 0)).toBe(true);
    expect(starts).toBe(2);
    harness.dispatch('pointermove', 4, 107, 0);
    expect(zooms).toEqual([]);
    harness.dispatch('pointermove', 4, 109, 0);
    expect(zooms[0]).toBeCloseTo(1.09);
  });

  it('pauses for a third touch and re-baselines when two touches remain', () => {
    const harness = pointerHarness();
    const zooms: number[] = [];
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {},
      onZoom: (factor) => zooms.push(factor),
    });
    harness.dispatch('pointerdown', 1, 0, 0);
    harness.dispatch('pointerdown', 2, 100, 0);
    harness.dispatch('pointerdown', 3, 200, 0);

    harness.dispatch('pointermove', 2, 120, 0);
    expect(zooms).toEqual([]);
    harness.dispatch('pointerup', 3, 200, 0);
    expect(pinch.isPinching()).toBe(true);
    harness.dispatch('pointermove', 2, 127, 0);
    expect(zooms).toEqual([]);
    harness.dispatch('pointermove', 2, 129, 0);
    expect(zooms[0]).toBeCloseTo(129 / 120);
  });

  it('ignores mouse and pen pointers', () => {
    const harness = pointerHarness();
    let starts = 0;
    const pinch = bindMapPinchZoom(harness.canvas, {
      onPinchStart: () => {
        starts += 1;
      },
      onZoom: () => {},
    });

    harness.dispatch('pointerdown', 1, 0, 0, 'mouse');
    harness.dispatch('pointerdown', 2, 100, 0, 'pen');
    expect(harness.captured).toEqual([]);
    expect(pinch.isPinching()).toBe(false);
    expect(starts).toBe(0);
  });
});
