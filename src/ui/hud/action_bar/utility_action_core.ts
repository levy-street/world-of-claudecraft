export const MOBILE_UTILITY_ACTION_IDS = [
  'mount',
  'chat',
  'map',
  'bags',
  'social',
  'quest',
  'char',
  'spellbook',
  'settings',
  'more',
] as const;

export type MobileUtilityActionId = (typeof MOBILE_UTILITY_ACTION_IDS)[number];

export const MOBILE_UTILITY_ACTION_SLOT_COUNT = 4;
export const DEFAULT_MOBILE_UTILITY_ACTIONS = ['mount', 'map', 'chat', 'bags'] as const;
