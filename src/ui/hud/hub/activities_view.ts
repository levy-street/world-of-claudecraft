// Activities (menu consolidation step 4, 2026-11-04): one tabbed window over
// the group content windows. Dungeons and Raids is the Dungeon Finder, PvP is
// the arena window G still opens, and Card Duel finally has a launcher. The
// Groups bell is the hub's rail launcher and keeps its alert badge.

import type { WindowHubSpec } from './window_hub_view';

export type ActivitiesTab = 'dungeons' | 'pvp' | 'cardDuel';

export const ACTIVITIES: WindowHubSpec<ActivitiesTab> = {
  tabs: [
    { id: 'dungeons', labelKey: 'hudChrome.activities.tabDungeons' },
    { id: 'pvp', labelKey: 'hudChrome.activities.tabPvp' },
    { id: 'cardDuel', labelKey: 'cardDuel.title' },
  ],
  defaultTab: 'dungeons',
  storageKey: 'woc.activities.tab',
  ariaLabelKey: 'hudChrome.activities.title',
  closeKey: 'hudChrome.activities.close',
  stripClass: 'activities-hub-tabs',
  tabClass: 'activities-hub-tab',
  focusPrefix: 'activitiesHub',
};
