import { describe, expect, it } from 'vitest';
import { interpolatedOnlineSelfFacing } from '../src/game/online_facing_mirror';

describe('interpolatedOnlineSelfFacing', () => {
  const entity = { prevFacing: 0.4, facing: 0.6 };

  it('uses the full-precision reconciliation facing', () => {
    const wire = {
      reconPreviousAuthoritativeFacing: 0.45,
      reconAuthoritativeFacing: 0.65,
    };

    expect(interpolatedOnlineSelfFacing(wire, entity, 0.5)).toBeCloseTo(0.55, 12);
  });

  it('falls back to the mirrored entity until full-precision samples exist', () => {
    const wire = {
      reconPreviousAuthoritativeFacing: null,
      reconAuthoritativeFacing: 0.65,
    };

    expect(interpolatedOnlineSelfFacing(wire, entity, 0.5)).toBeCloseTo(0.5, 12);
  });
});
