export const MOBILE_ACTION_MODE_AUTO = 'auto' as const;
export const MOBILE_ACTION_MODE_COMBAT = 'combat' as const;

export type MobileActionModePreference =
  | typeof MOBILE_ACTION_MODE_AUTO
  | typeof MOBILE_ACTION_MODE_COMBAT;
export type MobileActionSurface = 'combat' | 'utility';

/** Active combat always wins; otherwise the explicit combat pin overrides the
 *  default utility surface. Target selection is intentionally not an input. */
export function resolveMobileActionSurface(
  inCombat: boolean,
  preference: MobileActionModePreference,
): MobileActionSurface {
  return inCombat || preference === MOBILE_ACTION_MODE_COMBAT ? 'combat' : 'utility';
}

/** Toggle between automatic mode and a combat UI pin. */
export function mobileActionModeAfterToggle(
  preference: MobileActionModePreference,
): MobileActionModePreference {
  return preference === MOBILE_ACTION_MODE_AUTO
    ? MOBILE_ACTION_MODE_COMBAT
    : MOBILE_ACTION_MODE_AUTO;
}
