import { describe, expect, it } from 'vitest';
import { resolveActionBarVisibility } from '../src/ui/hud/action_bar/action_bar_visibility_core';

describe('action bar visibility', () => {
  it('allows the third row only while the secondary row is visible', () => {
    expect(
      resolveActionBarVisibility({ secondary: false, third: false }, 'showThirdActionBar', true),
    ).toEqual({ secondary: false, third: false });
    expect(
      resolveActionBarVisibility({ secondary: true, third: false }, 'showThirdActionBar', true),
    ).toEqual({ secondary: true, third: true });
  });

  it('lets the third row be disabled while the secondary row stays visible', () => {
    expect(
      resolveActionBarVisibility({ secondary: true, third: true }, 'showThirdActionBar', false),
    ).toEqual({ secondary: true, third: false });
  });

  it('hides the third row when the secondary row is disabled', () => {
    expect(
      resolveActionBarVisibility({ secondary: true, third: true }, 'showSecondaryActionBar', false),
    ).toEqual({ secondary: false, third: false });
  });

  it('does not reveal the third row when the secondary row is enabled', () => {
    expect(
      resolveActionBarVisibility(
        { secondary: false, third: false },
        'showSecondaryActionBar',
        true,
      ),
    ).toEqual({ secondary: true, third: false });
  });
});
