import { describe, it, expect } from 'vitest';
import {
  applyRadialDeadzone,
  stickToMoveFlags,
  stickToLook,
  risingEdges,
  DEFAULT_GAMEPAD_BINDINGS,
  BINDABLE_BUTTONS,
  GP,
} from '../src/game/gamepad_map';

describe('applyRadialDeadzone', () => {
  it('zeroes a vector inside the deadzone', () => {
    expect(applyRadialDeadzone(0.1, 0.05, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadzone(0, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('rescales so the deadzone edge maps to ~0 and the unit circle to 1', () => {
    // straight up, just past the deadzone -> small magnitude
    const justOut = applyRadialDeadzone(0, -0.2001, 0.2);
    expect(Math.hypot(justOut.x, justOut.y)).toBeLessThan(0.01);
    // full deflection stays at magnitude 1
    const full = applyRadialDeadzone(0, -1, 0.2);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 6);
  });

  it('clamps over-deflection past the unit circle (square corners) to magnitude 1', () => {
    // A raw (1,1) corner has magnitude ~1.41; the Math.min(1, ...) clamp must cap
    // it at 1 so a diagonal push never out-runs a cardinal one. (The (0,-1) case
    // above is already magnitude 1, so it cannot catch a deleted clamp.)
    const corner = applyRadialDeadzone(1, 1, 0.2);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1, 6);
  });
});

describe('stickToMoveFlags', () => {
  it('produces nothing inside the deadzone', () => {
    expect(stickToMoveFlags(0.1, 0.1, 0.25)).toEqual({
      forward: false, back: false, strafeLeft: false, strafeRight: false,
    });
  });

  it('maps up to forward and down to back (y inverted)', () => {
    expect(stickToMoveFlags(0, -1, 0.2).forward).toBe(true);
    expect(stickToMoveFlags(0, 1, 0.2).back).toBe(true);
  });

  it('fires both axes on a diagonal', () => {
    const f = stickToMoveFlags(-0.9, -0.9, 0.2);
    expect(f.forward).toBe(true);
    expect(f.strafeLeft).toBe(true);
  });

  it('maps right to strafeRight and left to strafeLeft (x-axis sign)', () => {
    const right = stickToMoveFlags(1, 0, 0.2);
    expect(right.strafeRight).toBe(true);
    expect(right.strafeLeft).toBe(false);
    const left = stickToMoveFlags(-1, 0, 0.2);
    expect(left.strafeLeft).toBe(true);
    expect(left.strafeRight).toBe(false);
  });

  it('fires back + strafeRight on a down-right diagonal', () => {
    const f = stickToMoveFlags(0.9, 0.9, 0.2);
    expect(f.back).toBe(true);
    expect(f.strafeRight).toBe(true);
    expect(f.forward).toBe(false);
    expect(f.strafeLeft).toBe(false);
  });
});

describe('stickToLook', () => {
  it('returns zero inside the deadzone', () => {
    expect(stickToLook(0.1, 0.1, 0.2, 2, false, 0.016)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('turns right (negative yaw delta) when pushed right and scales with dt', () => {
    const a = stickToLook(1, 0, 0.2, 2, false, 0.016);
    const b = stickToLook(1, 0, 0.2, 2, false, 0.032);
    expect(a.yaw).toBeLessThan(0);
    expect(b.yaw).toBeCloseTo(a.yaw * 2, 6);
  });

  it('inverts pitch when invertY is set', () => {
    const normal = stickToLook(0, -1, 0.2, 2, false, 0.016);
    const inverted = stickToLook(0, -1, 0.2, 2, true, 0.016);
    expect(Math.sign(normal.pitch)).toBe(-Math.sign(inverted.pitch));
  });
});

describe('risingEdges', () => {
  it('reports only up->down transitions', () => {
    const prev = [false, true, false];
    const cur = [true, true, true];
    expect(risingEdges(prev, cur)).toEqual([0, 2]);
  });

  it('reports nothing when held', () => {
    expect(risingEdges([true, true], [true, true])).toEqual([]);
  });
});

describe('default layout', () => {
  it('binds every console-MMO button to a known action and stays within the bindable set', () => {
    expect(DEFAULT_GAMEPAD_BINDINGS[GP.A]).toBe('jump');
    expect(DEFAULT_GAMEPAD_BINDINGS[GP.START]).toBe('escape');
    for (const idx of Object.keys(DEFAULT_GAMEPAD_BINDINGS).map(Number)) {
      expect(BINDABLE_BUTTONS).toContain(idx);
    }
  });

  it('assigns a default to every bindable button (catches a dropped binding)', () => {
    const bound = Object.keys(DEFAULT_GAMEPAD_BINDINGS).map(Number).sort((a, b) => a - b);
    expect(bound).toEqual(BINDABLE_BUTTONS);
  });

  it('covers action-bar slots 0..8 exactly once (catches a dropped or duplicated slotN)', () => {
    const values = Object.values(DEFAULT_GAMEPAD_BINDINGS);
    for (let slot = 0; slot <= 8; slot++) {
      // Exactly once: count 0 = a dropped slot, count >= 2 = a duplicated slot
      // (additive or displacing). The default layout binds each slot to one button.
      expect(values.filter((v) => v === `slot${slot}`).length, `slot${slot}`).toBe(1);
    }
  });
});
