export const MOBILE_ACTION_MODE_AUTO = 'auto' as const;
export const MOBILE_ACTION_MODE_COMBAT = 'combat' as const;
export const MOBILE_ACTION_MODE_UTILITY = 'utility' as const;

export type MobileActionModePreference =
  | typeof MOBILE_ACTION_MODE_AUTO
  | typeof MOBILE_ACTION_MODE_COMBAT
  | typeof MOBILE_ACTION_MODE_UTILITY;
export type MobileActionSurface = 'combat' | 'utility';

/** Explicit layout choices override automatic combat detection. */
export function resolveMobileActionSurface(
  inCombat: boolean,
  preference: MobileActionModePreference,
): MobileActionSurface {
  if (preference === MOBILE_ACTION_MODE_COMBAT) return 'combat';
  if (preference === MOBILE_ACTION_MODE_UTILITY) return 'utility';
  return inCombat ? 'combat' : 'utility';
}

/** Switch to the opposite of the currently displayed action layout. */
export function mobileActionModeAfterToggle(
  preference: MobileActionModePreference,
  inCombat: boolean,
): MobileActionModePreference {
  return resolveMobileActionSurface(inCombat, preference) === 'combat'
    ? MOBILE_ACTION_MODE_UTILITY
    : MOBILE_ACTION_MODE_COMBAT;
}
