import { describe, expect, it } from 'vitest';
import {
  MOBILE_ACTION_MODE_COMBAT,
  MOBILE_ACTION_MODE_UTILITY,
  mobileActionModeAfterToggle,
  resolveMobileActionSurface,
} from '../src/ui/hud/action_bar/mobile_action_mode_core';

describe('mobile action mode precedence', () => {
  it('shows the combat layout by default, where the consumable seat lives', () => {
    expect(resolveMobileActionSurface(MOBILE_ACTION_MODE_COMBAT)).toBe('combat');
  });

  it('shows the utility layout only while it is explicitly selected', () => {
    expect(resolveMobileActionSurface(MOBILE_ACTION_MODE_UTILITY)).toBe('utility');
  });

  it('switches to the opposite visible layout', () => {
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_COMBAT)).toBe(MOBILE_ACTION_MODE_UTILITY);
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_UTILITY)).toBe(MOBILE_ACTION_MODE_COMBAT);
  });
});
