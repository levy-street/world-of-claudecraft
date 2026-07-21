import { describe, expect, it } from 'vitest';
import { restView } from '../src/ui/rest_indicator';

describe('rest indicator view', () => {
  it('hides when standing and doing nothing', () => {
    const v = restView({ sitting: false, eating: false, drinking: false });
    expect(v.resting).toBe(false);
    expect(v.labelKey).toBe('');
  });

  it('shows the resting key for a bare sit', () => {
    expect(restView({ sitting: true, eating: false, drinking: false }))
      .toMatchObject({ resting: true, labelKey: 'hudChrome.rest.resting' });
  });

  it('eating and drinking take precedence over a sit', () => {
    expect(restView({ sitting: true, eating: true, drinking: false }).labelKey).toBe('hud.core.eating');
    expect(restView({ sitting: true, eating: false, drinking: true }).labelKey).toBe('hud.core.drinking');
  });

  it('surfaces the combined state when eating and drinking at once', () => {
    expect(restView({ sitting: true, eating: true, drinking: true }).labelKey).toBe('hud.core.eatingDrinking');
  });

  it('eating/drinking imply resting even without the sitting flag set', () => {
    // online snapshots can carry eat/drk independently of the union sit flag
    expect(restView({ sitting: false, eating: true, drinking: false }).resting).toBe(true);
    expect(restView({ sitting: false, eating: false, drinking: true }).resting).toBe(true);
  });
});
