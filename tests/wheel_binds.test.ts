import { describe, expect, it } from 'vitest';
import { GAMEPAD_ZOOM_STEP } from '../src/game/gamepad_map';
import {
  isWheelCode,
  WHEEL_DOWN_CODE,
  WHEEL_UP_CODE,
  WHEEL_ZOOM_STEP,
  wheelCodeAllowedFor,
  wheelCodeForDelta,
  wheelCodeLabel,
  zoomStepForAction,
} from '../src/game/wheel_binds';

describe('wheel pseudo-codes', () => {
  it('maps the wheel direction to the stored pseudo-code literals', () => {
    // Pinned to literals: stored bindings are these exact strings.
    expect(WHEEL_UP_CODE).toBe('WheelUp');
    expect(WHEEL_DOWN_CODE).toBe('WheelDown');
    expect(wheelCodeForDelta(-100)).toBe('WheelUp');
    expect(wheelCodeForDelta(100)).toBe('WheelDown');
    // Any magnitude is one notch: a high-resolution wheel reports small deltas.
    expect(wheelCodeForDelta(-1)).toBe('WheelUp');
    expect(wheelCodeForDelta(0.5)).toBe('WheelDown');
  });

  it('fires nothing for a notch with no vertical travel', () => {
    expect(wheelCodeForDelta(0)).toBeNull();
    expect(wheelCodeForDelta(Number.NaN)).toBeNull();
    expect(wheelCodeForDelta(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('recognizes only the two wheel codes, never a chord or a lookalike key', () => {
    expect(isWheelCode('WheelUp')).toBe(true);
    expect(isWheelCode('WheelDown')).toBe(true);
    expect(isWheelCode('Ctrl+WheelUp')).toBe(false); // a combo, not a bare code
    expect(isWheelCode('Wheel')).toBe(false);
    expect(isWheelCode('KeyW')).toBe(false);
    expect(isWheelCode('Mouse3')).toBe(false); // the wheel CLICK is a button
  });
});

describe('wheel binding rules', () => {
  it('lets a notch drive only edge actions (it has no release to end a held one)', () => {
    expect(wheelCodeAllowedFor('edge')).toBe(true);
    expect(wheelCodeAllowedFor('held')).toBe(false);
    expect(wheelCodeAllowedFor(null)).toBe(false);
  });

  it('steps the camera the same distance as the gamepad zoom buttons', () => {
    expect(zoomStepForAction('zoomOut')).toBe(WHEEL_ZOOM_STEP);
    expect(zoomStepForAction('zoomIn')).toBe(-WHEEL_ZOOM_STEP);
    expect(WHEEL_ZOOM_STEP).toBe(GAMEPAD_ZOOM_STEP);
  });

  it('returns no step for any other action', () => {
    expect(zoomStepForAction('slot3')).toBeNull();
    expect(zoomStepForAction('map')).toBeNull();
    expect(zoomStepForAction('')).toBeNull();
  });
});

describe('wheel keycap labels', () => {
  it('labels a wheel code with a compact glyph and nothing else', () => {
    expect(wheelCodeLabel('WheelUp')).toBe('Wh↑');
    expect(wheelCodeLabel('WheelDown')).toBe('Wh↓');
    expect(wheelCodeLabel('Mouse4')).toBeNull();
    expect(wheelCodeLabel('KeyW')).toBeNull();
  });
});
