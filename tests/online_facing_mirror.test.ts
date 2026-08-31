import { describe, expect, it } from 'vitest';
import { interpolatedOnlineSelfFacing } from '../src/game/online_facing_mirror';

describe('interpolatedOnlineSelfFacing', () => {
  const entity = { prevFacing: 0.4, facing: 0.6 };

  it('uses full-precision reconciliation facing under movement wire v2', () => {
    const wire = {
      movementWireVersion: 2 as const,
      reconPreviousAuthoritativeFacing: 0.45,
      reconAuthoritativeFacing: 0.65,
    };

    expect(interpolatedOnlineSelfFacing(wire, entity, 0.5)).toBeCloseTo(0.55, 12);
  });

  it('leaves the movement wire v1 display source unchanged', () => {
    const wire = {
      movementWireVersion: 1 as const,
      reconPreviousAuthoritativeFacing: 0.45,
      reconAuthoritativeFacing: 0.65,
    };

    expect(interpolatedOnlineSelfFacing(wire, entity, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('falls back to the mirrored entity until full-precision v2 samples exist', () => {
    const wire = {
      movementWireVersion: 2 as const,
      reconPreviousAuthoritativeFacing: null,
      reconAuthoritativeFacing: 0.65,
    };

    expect(interpolatedOnlineSelfFacing(wire, entity, 0.5)).toBeCloseTo(0.5, 12);
  });
});
