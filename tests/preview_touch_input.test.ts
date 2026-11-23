// The touch stage's finger tracking (src/render/characters/preview_touch_input.ts): touch
// pointers on the turntable canvas in, gesture steps and a double tap out. Mouse and pen
// pointers, and every touch while the stage is not a touch stage, are left alone (the
// mouse turntable keeps its own handlers).
import { describe, expect, it, vi } from 'vitest';
import type { TouchStep } from '../src/render/characters/preview_touch_core';
import { attachPreviewTouchInput } from '../src/render/characters/preview_touch_input';

type Handler = (e: PointerEvent) => void;

function rig(active = true) {
  const handlers = new Map<string, Handler>();
  const canvas = {
    addEventListener: vi.fn((type: string, h: Handler) => handlers.set(type, h)),
    removeEventListener: vi.fn((type: string) => handlers.delete(type)),
    setPointerCapture: vi.fn(),
  };
  const steps: TouchStep[] = [];
  const doubleTap = vi.fn();
  const state = { active };
  const input = attachPreviewTouchInput({
    canvas: canvas as unknown as HTMLCanvasElement,
    active: () => state.active,
    step: (s) => steps.push(s),
    doubleTap,
  });
  let t = 1000;
  const fire = (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    id: number,
    x: number,
    y: number,
    opts: { pointerType?: string; dt?: number } = {},
  ) => {
    t += opts.dt ?? 16;
    handlers.get(type)?.({
      type,
      pointerId: id,
      pointerType: opts.pointerType ?? 'touch',
      clientX: x,
      clientY: y,
      timeStamp: t,
    } as unknown as PointerEvent);
  };
  return { canvas, handlers, steps, doubleTap, input, fire, state };
}

describe('attachPreviewTouchInput', () => {
  it('turns a one-finger drag into drag steps, and captures the pointer', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 100);
    expect(r.canvas.setPointerCapture).toHaveBeenCalledWith(1);
    r.fire('pointermove', 1, 130, 90);
    expect(r.steps).toEqual([{ dragX: 30, dragY: -10, pinch: 1, slideX: 0, slideY: 0 }]);
  });

  it('turns two fingers into pinch and slide steps', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 200);
    r.fire('pointerdown', 2, 200, 200);
    r.fire('pointermove', 2, 300, 200);
    const last = r.steps[r.steps.length - 1];
    expect(last.pinch).toBeCloseTo(2, 6);
    expect(last.slideX).toBeCloseTo(50, 6);
    expect(last.dragX).toBe(0);
  });

  it('leaves mouse and pen pointers, and an inactive stage, alone', () => {
    const r = rig();
    r.fire('pointerdown', 1, 0, 0, { pointerType: 'mouse' });
    r.fire('pointermove', 1, 50, 0, { pointerType: 'mouse' });
    r.fire('pointerdown', 2, 0, 0, { pointerType: 'pen' });
    r.fire('pointermove', 2, 50, 0, { pointerType: 'pen' });
    expect(r.steps).toEqual([]);
    const off = rig(false);
    off.fire('pointerdown', 1, 0, 0);
    off.fire('pointermove', 1, 50, 0);
    expect(off.steps).toEqual([]);
    expect(off.canvas.setPointerCapture).not.toHaveBeenCalled();
  });

  it('two quick taps on one spot ask for the camera back; a drag or a slow press never does', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 100);
    r.fire('pointerup', 1, 100, 100, { dt: 60 });
    r.fire('pointerdown', 1, 104, 98, { dt: 120 });
    r.fire('pointerup', 1, 104, 98, { dt: 60 });
    expect(r.doubleTap).toHaveBeenCalledTimes(1);

    const drag = rig();
    drag.fire('pointerdown', 1, 100, 100);
    drag.fire('pointermove', 1, 140, 100);
    drag.fire('pointerup', 1, 140, 100, { dt: 60 });
    drag.fire('pointerdown', 1, 140, 100, { dt: 120 });
    drag.fire('pointerup', 1, 140, 100, { dt: 60 });
    expect(drag.doubleTap).not.toHaveBeenCalled();

    const slow = rig();
    slow.fire('pointerdown', 1, 100, 100);
    slow.fire('pointerup', 1, 100, 100, { dt: 900 });
    slow.fire('pointerdown', 1, 100, 100, { dt: 100 });
    slow.fire('pointerup', 1, 100, 100, { dt: 60 });
    expect(slow.doubleTap).not.toHaveBeenCalled();
  });

  it('stops steering the moment the stage stops being a touch stage', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 100);
    r.fire('pointermove', 1, 120, 100);
    expect(r.steps).toHaveLength(1);
    r.state.active = false;
    r.fire('pointermove', 1, 140, 100);
    r.state.active = true;
    // the finger was let go: its later moves are not steps either
    r.fire('pointermove', 1, 160, 100);
    expect(r.steps).toHaveLength(1);
  });

  it('a cancelled touch is never a tap', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 100);
    r.fire('pointercancel', 1, 100, 100, { dt: 60 });
    r.fire('pointerdown', 1, 100, 100, { dt: 100 });
    r.fire('pointerup', 1, 100, 100, { dt: 60 });
    expect(r.doubleTap).not.toHaveBeenCalled();
  });

  it('reset forgets the fingers and the last tap; dispose takes every listener off', () => {
    const r = rig();
    r.fire('pointerdown', 1, 100, 100);
    r.fire('pointerup', 1, 100, 100, { dt: 60 });
    r.input.reset();
    r.fire('pointerdown', 1, 100, 100, { dt: 100 });
    r.fire('pointerup', 1, 100, 100, { dt: 60 });
    expect(r.doubleTap).not.toHaveBeenCalled();
    r.fire('pointerdown', 1, 0, 0);
    r.input.reset();
    // a move from a finger the stage forgot is not a step
    r.fire('pointermove', 1, 50, 0);
    expect(r.steps).toEqual([]);
    r.input.dispose();
    expect(r.handlers.size).toBe(0);
  });
});
