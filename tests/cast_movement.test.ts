import { describe, expect, it } from 'vitest';
import { castSurvivesMovement, LONG_STATIONARY_CHANNEL_SEC } from '../src/sim/combat/cast_movement';

describe('GW2-style cast movement policy', () => {
  it('keeps ordinary hard casts and short channels active while moving', () => {
    expect(castSurvivesMovement({ def: {} }, false)).toBe(true);
    expect(
      castSurvivesMovement(
        { def: { channel: { duration: LONG_STATIONARY_CHANNEL_SEC - 0.1 } } },
        false,
      ),
    ).toBe(true);
  });

  it('cancels selected long channels and non-combat activities on movement', () => {
    expect(
      castSurvivesMovement({ def: { channel: { duration: LONG_STATIONARY_CHANNEL_SEC } } }, false),
    ).toBe(false);
    expect(castSurvivesMovement(null, false)).toBe(false);
  });

  it('honors authored, talent, and temporary mobility overrides for long channels', () => {
    const longChannel = { duration: LONG_STATIONARY_CHANNEL_SEC + 3 };
    expect(
      castSurvivesMovement({ def: { channel: longChannel, castWhileMoving: true } }, false),
    ).toBe(true);
    expect(
      castSurvivesMovement({ def: { channel: longChannel }, castWhileMoving: true }, false),
    ).toBe(true);
    expect(castSurvivesMovement({ def: { channel: longChannel } }, true)).toBe(true);
  });
});
