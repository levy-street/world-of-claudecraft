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

export type MobileUtilityActionId =
  | (typeof MOBILE_UTILITY_ACTION_IDS)[number]
  | 'dfinder'
  | 'crafting';

export const MOBILE_UTILITY_ACTION_SLOT_COUNT = 5;
export const MOBILE_UTILITY_ACTION_PAGES = [
  ['mount', 'map', 'bags', 'char', 'quest'],
  ['chat', 'social', 'dfinder', 'spellbook', 'crafting'],
] as const satisfies readonly (readonly MobileUtilityActionId[])[];
export const DEFAULT_MOBILE_UTILITY_ACTIONS = MOBILE_UTILITY_ACTION_PAGES[0];
