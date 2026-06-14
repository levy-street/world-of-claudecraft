import { describe, expect, it } from 'vitest';
import { clickPickFromMouseGesture } from '../src/game/pointer_pick';

describe('mouse click-pick gesture resolution', () => {
  it('uses the mouse-down point for click picks', () => {
    expect(clickPickFromMouseGesture({
      button: 0,
      downButton: 0,
      downX: 120,
      downY: 160,
      upX: 123,
      upY: 161,
      movementDrag: 2,
      releaseOnCanvas: true,
      pointerLocked: false,
    })).toEqual({ x: 120, y: 160, button: 0 });
  });

  it('rejects camera drags even when release lands on the canvas', () => {
    expect(clickPickFromMouseGesture({
      button: 0,
      downButton: 0,
      downX: 120,
      downY: 160,
      upX: 120,
      upY: 160,
      movementDrag: 8,
      releaseOnCanvas: true,
      pointerLocked: false,
    })).toBeNull();
  });

  it('rejects pointer-position drift when movement deltas are unavailable', () => {
    expect(clickPickFromMouseGesture({
      button: 0,
      downButton: 0,
      downX: 120,
      downY: 160,
      upX: 150,
      upY: 181,
      movementDrag: 0,
      releaseOnCanvas: true,
      pointerLocked: false,
    })).toBeNull();
  });

  it('allows a pointer-locked tap released off the canvas target', () => {
    expect(clickPickFromMouseGesture({
      button: 2,
      downButton: 2,
      downX: 210,
      downY: 96,
      upX: 0,
      upY: 0,
      movementDrag: 0,
      releaseOnCanvas: false,
      pointerLocked: true,
    })).toEqual({ x: 210, y: 96, button: 2 });
  });
});
