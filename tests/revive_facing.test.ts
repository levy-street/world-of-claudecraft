import { describe, expect, it } from 'vitest';
import { REVIVE_IN_PLACE_EPSILON, reviveFacing } from '../src/sim/revive_facing';

describe('reviveFacing: a revive in place keeps the heading, a displaced one resets it', () => {
  const at = { x: 120, z: -40 };

  it('keeps the current facing when the body lands where the spirit stands', () => {
    const r = reviveFacing({ facing: Math.PI / 2, prevFacing: 1.2 }, at, { ...at });
    expect(r.facing).toBe(Math.PI / 2);
    // prevFacing pairs with facing so the render interpolation does not sweep.
    expect(r.prevFacing).toBe(Math.PI / 2);
  });

  it('treats a sub-epsilon ground jitter as in place', () => {
    const near = { x: at.x + REVIVE_IN_PLACE_EPSILON / 2, z: at.z };
    expect(reviveFacing({ facing: 2.5, prevFacing: 2.5 }, at, near).facing).toBe(2.5);
  });

  it('resets to 0 (north) when the body is moved somewhere else', () => {
    const far = { x: at.x + 30, z: at.z };
    expect(reviveFacing({ facing: 2.5, prevFacing: 2.5 }, at, far)).toEqual({
      facing: 0,
      prevFacing: 0,
    });
  });

  it('falls back to 0 when the current facing is not a finite number', () => {
    expect(reviveFacing({ facing: Number.NaN, prevFacing: 0 }, at, { ...at })).toEqual({
      facing: 0,
      prevFacing: 0,
    });
  });

  it('is a pure function of its inputs', () => {
    const a = reviveFacing({ facing: 1, prevFacing: 1 }, at, { ...at });
    const b = reviveFacing({ facing: 1, prevFacing: 1 }, at, { ...at });
    expect(a).toEqual(b);
  });
});
