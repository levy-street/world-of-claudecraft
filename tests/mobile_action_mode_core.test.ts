import { describe, expect, it } from 'vitest';
import {
  MOBILE_ACTION_MODE_AUTO,
  MOBILE_ACTION_MODE_COMBAT,
  MOBILE_ACTION_MODE_UTILITY,
  mobileActionModeAfterToggle,
  resolveMobileActionSurface,
} from '../src/ui/hud/action_bar/mobile_action_mode_core';

describe('mobile action mode precedence', () => {
  it('shows utility controls by default while out of combat', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_AUTO)).toBe('utility');
  });

  it('automatically shows combat controls in combat unless a layout is explicitly selected', () => {
    expect(resolveMobileActionSurface(true, MOBILE_ACTION_MODE_AUTO)).toBe('combat');
    expect(resolveMobileActionSurface(true, MOBILE_ACTION_MODE_COMBAT)).toBe('combat');
    expect(resolveMobileActionSurface(true, MOBILE_ACTION_MODE_UTILITY)).toBe('utility');
  });

  it('switches to the opposite visible layout', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_COMBAT)).toBe('combat');
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_AUTO, false)).toBe(
      MOBILE_ACTION_MODE_COMBAT,
    );
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_AUTO, true)).toBe(
      MOBILE_ACTION_MODE_UTILITY,
    );
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_COMBAT, false)).toBe(
      MOBILE_ACTION_MODE_UTILITY,
    );
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_UTILITY, true)).toBe(
      MOBILE_ACTION_MODE_COMBAT,
    );
  });

  it('uses combat state rather than a selected target in automatic mode', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_AUTO)).toBe('utility');
  });
});
