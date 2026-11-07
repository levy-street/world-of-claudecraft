import { describe, expect, it } from 'vitest';
import {
  MOBILE_ACTION_MODE_AUTO,
  MOBILE_ACTION_MODE_COMBAT,
  mobileActionModeAfterToggle,
  resolveMobileActionSurface,
} from '../src/ui/hud/action_bar/mobile_action_mode_core';

describe('mobile action mode precedence', () => {
  it('shows utility controls by default while out of combat', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_AUTO)).toBe('utility');
  });

  it('shows combat controls whenever combat is active', () => {
    expect(resolveMobileActionSurface(true, MOBILE_ACTION_MODE_AUTO)).toBe('combat');
    expect(resolveMobileActionSurface(true, MOBILE_ACTION_MODE_COMBAT)).toBe('combat');
  });

  it('keeps combat controls pinned until automatic mode is restored', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_COMBAT)).toBe('combat');
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_AUTO)).toBe(MOBILE_ACTION_MODE_COMBAT);
    expect(mobileActionModeAfterToggle(MOBILE_ACTION_MODE_COMBAT)).toBe(MOBILE_ACTION_MODE_AUTO);
  });

  it('uses combat state rather than a selected target to choose the surface', () => {
    expect(resolveMobileActionSurface(false, MOBILE_ACTION_MODE_AUTO)).toBe('utility');
  });
});
