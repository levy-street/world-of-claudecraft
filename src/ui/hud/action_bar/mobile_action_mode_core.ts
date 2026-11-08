export const MOBILE_ACTION_MODE_COMBAT = 'combat' as const;
export const MOBILE_ACTION_MODE_UTILITY = 'utility' as const;

export type MobileActionModePreference =
  | typeof MOBILE_ACTION_MODE_COMBAT
  | typeof MOBILE_ACTION_MODE_UTILITY;
export type MobileActionSurface = 'combat' | 'utility';

/**
 * The combat layout is the home layout: it carries the attacks and the
 * consumable seat a player reaches for the moment a fight ends. The utility
 * layout is an explicit choice, so nothing returns to it on its own.
 */
export function resolveMobileActionSurface(
  preference: MobileActionModePreference,
): MobileActionSurface {
  return preference === MOBILE_ACTION_MODE_UTILITY ? 'utility' : 'combat';
}

/** Switch to the opposite of the currently displayed action layout. */
export function mobileActionModeAfterToggle(
  preference: MobileActionModePreference,
): MobileActionModePreference {
  return resolveMobileActionSurface(preference) === 'combat'
    ? MOBILE_ACTION_MODE_UTILITY
    : MOBILE_ACTION_MODE_COMBAT;
}
