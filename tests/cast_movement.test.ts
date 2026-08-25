import { describe, expect, it } from 'vitest';
import { castSurvivesMovement, LONG_STATIONARY_CHANNEL_SEC } from '../src/sim/combat/cast_movement';
import { ABILITIES } from '../src/sim/data';

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

  it('audits the full ability catalog and pins the stationary channel exceptions', () => {
    const timedAbilities = Object.values(ABILITIES).filter(
      (ability) => ability.castTime > 0 || ability.channel,
    );
    const stationary = timedAbilities
      .filter((ability) => !castSurvivesMovement({ def: ability }, false))
      .map((ability) => ability.id)
      .sort();

    expect(stationary).toEqual([
      'aegis_first_dawn',
      'arcane_missiles',
      'choir_of_deliverance',
      'drain_life',
      'evocation',
      'hurricane',
      'mind_flay',
      'mind_sear',
      'tranquility',
      'volley',
    ]);
    expect(
      timedAbilities
        .filter((ability) => ability.castTime > 0 && !ability.channel)
        .every((ability) => castSurvivesMovement({ def: ability }, false)),
    ).toBe(true);
  });
});
