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
      pressDurationMs: 80,
    })).toEqual({ x: 120, y: 160, button: 0 });
  });

  it('ignores noisy movement deltas for short normal clicks', () => {
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
      pressDurationMs: 80,
    })).toEqual({ x: 120, y: 160, button: 0 });
  });

  it('allows large pointer drift for short click presses', () => {
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
      pressDurationMs: 90,
    })).toEqual({ x: 120, y: 160, button: 0 });
  });

  it('rejects long normal presses regardless of start/end distance', () => {
    expect(clickPickFromMouseGesture({
      button: 0,
      downButton: 0,
      downX: 120,
      downY: 160,
      upX: 120,
      upY: 160,
      movementDrag: 0,
      releaseOnCanvas: true,
      pointerLocked: false,
      pressDurationMs: 420,
    })).toBeNull();
  });

  it('rejects long normal presses even when the pointer drifts', () => {
    expect(clickPickFromMouseGesture({
      button: 0,
      downButton: 0,
      downX: 120,
      downY: 160,
      upX: 128,
      upY: 166,
      movementDrag: 0,
      releaseOnCanvas: true,
      pointerLocked: false,
      pressDurationMs: 420,
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
      pressDurationMs: 80,
    })).toEqual({ x: 210, y: 96, button: 2 });
  });

  it('rejects pointer-locked right-button drags', () => {
    expect(clickPickFromMouseGesture({
      button: 2,
      downButton: 2,
      downX: 210,
      downY: 96,
      upX: 0,
      upY: 0,
      movementDrag: 28,
      releaseOnCanvas: false,
      pointerLocked: true,
      pressDurationMs: 80,
    })).toBeNull();
  });

  it('allows small right-button movement noise for short clicks', () => {
    expect(clickPickFromMouseGesture({
      button: 2,
      downButton: 2,
      downX: 210,
      downY: 96,
      upX: 0,
      upY: 0,
      movementDrag: 8,
      releaseOnCanvas: false,
      pointerLocked: true,
      pressDurationMs: 80,
    })).toEqual({ x: 210, y: 96, button: 2 });
  });

  it('rejects long pointer-locked presses by duration', () => {
    expect(clickPickFromMouseGesture({
      button: 2,
      downButton: 2,
      downX: 210,
      downY: 96,
      upX: 0,
      upY: 0,
      movementDrag: 8,
      releaseOnCanvas: false,
      pointerLocked: true,
      pressDurationMs: 420,
    })).toBeNull();
  });
});
