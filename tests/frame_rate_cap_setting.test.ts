import { describe, expect, it } from 'vitest';
import {
  explicitCeilingIntent,
  FRAME_RATE_CAP_VALUES,
  frameRateCapChoiceFromValue,
  frameRateCapReading,
} from '../src/game/frame_rate_cap_setting';
import { SETTING_RANGES } from '../src/game/settings';

it('pins the stored values the options row labels point at', () => {
  expect(FRAME_RATE_CAP_VALUES).toEqual({ auto: 0, display: 1, sixty: 2, thirty: 3 });
  expect(explicitCeilingIntent(frameRateCapChoiceFromValue(2))).toBe(60);
  expect(explicitCeilingIntent(frameRateCapChoiceFromValue(3))).toBe(30);
});

describe('frame rate cap setting', () => {
  it('maps each stored value to its choice, and anything else to Display', () => {
    expect(frameRateCapChoiceFromValue(FRAME_RATE_CAP_VALUES.auto)).toBe('auto');
    expect(frameRateCapChoiceFromValue(FRAME_RATE_CAP_VALUES.display)).toBe('display');
    expect(frameRateCapChoiceFromValue(FRAME_RATE_CAP_VALUES.sixty)).toBe('sixty');
    expect(frameRateCapChoiceFromValue(FRAME_RATE_CAP_VALUES.thirty)).toBe('thirty');
    expect(frameRateCapChoiceFromValue(2.4)).toBe('sixty');
    expect(frameRateCapChoiceFromValue(99)).toBe('display');
    expect(frameRateCapChoiceFromValue(Number.NaN)).toBe('display');
  });

  it('defaults a player who never chose to Auto', () => {
    expect(SETTING_RANGES.frameRateCap).toEqual({ min: 0, max: 3, def: 0 });
    expect(frameRateCapChoiceFromValue(SETTING_RANGES.frameRateCap.def)).toBe('auto');
    expect(
      explicitCeilingIntent(frameRateCapChoiceFromValue(SETTING_RANGES.frameRateCap.def)),
    ).toBe(null);
  });

  it('covers exactly the stored range', () => {
    expect(SETTING_RANGES.frameRateCap.min).toBe(0);
    expect(SETTING_RANGES.frameRateCap.max).toBe(3);
    expect(Object.values(FRAME_RATE_CAP_VALUES).sort()).toEqual([0, 1, 2, 3]);
  });

  it('stores an intent in frames per second, never a display rate', () => {
    expect(explicitCeilingIntent('display')).toBe(0);
    expect(explicitCeilingIntent('sixty')).toBe(60);
    expect(explicitCeilingIntent('thirty')).toBe(30);
    expect(explicitCeilingIntent('auto')).toBeNull();
  });

  it('reads the rate actually obtained on the display as measured', () => {
    expect(frameRateCapReading(30, 'paced', 60)).toEqual({ kind: 'paced', fps: 30, refreshHz: 60 });
    expect(frameRateCapReading(30, 'paced', 143.9)).toEqual({
      kind: 'paced',
      fps: 36,
      refreshHz: 144,
    });
    expect(frameRateCapReading(60, 'paced', 144)).toEqual({
      kind: 'paced',
      fps: 72,
      refreshHz: 144,
    });
  });

  it('says so when the limit changes nothing on this display', () => {
    expect(frameRateCapReading(60, 'paced', 60)).toEqual({ kind: 'inert' });
    expect(frameRateCapReading(30, 'paced', 30)).toEqual({ kind: 'inert' });
  });

  it('reads the plain limit when the display cannot be read, and nothing with no limit', () => {
    expect(frameRateCapReading(30, 'unpaced', 0)).toEqual({ kind: 'unpaced', fps: 30 });
    expect(frameRateCapReading(30, 'unknown', 0)).toEqual({ kind: 'unpaced', fps: 30 });
    expect(frameRateCapReading(0, 'paced', 60)).toEqual({ kind: 'none' });
  });

  it('states nothing while the display has not been read yet, rather than the vsync-off wording', () => {
    // The first seconds in the world: `unknown` means "not read yet".
    expect(frameRateCapReading(30, 'unknown', 0, false)).toEqual({ kind: 'none' });
    // Once the estimator had its say, `unknown` is the vsync-off steady state.
    expect(frameRateCapReading(30, 'unknown', 0, true)).toEqual({ kind: 'unpaced', fps: 30 });
    // A verdict is a verdict, however early it came.
    expect(frameRateCapReading(30, 'paced', 60, false)).toEqual({
      kind: 'paced',
      fps: 30,
      refreshHz: 60,
    });
    expect(frameRateCapReading(30, 'unpaced', 0, false)).toEqual({ kind: 'unpaced', fps: 30 });
  });
});
