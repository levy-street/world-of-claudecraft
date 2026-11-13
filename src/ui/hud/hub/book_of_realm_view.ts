// The Book of the Realm (menu consolidation step 2, 2026-11-04): one tabbed
// window over the permanent record. Deeds and the Reliquary keep their own
// systems, trackers and deep links (docs/design/reliquary.md: the two sim
// systems pair and do not merge; this is a shared presentation shell only).
// Titles is the Book of Deeds' wardrobe shelf lifted into its own tab,
// Reputation moves in from the Character sheet, the Loot Explorer answers the
// Reliquary's silhouettes, and Rankings is the old Leaderboard window.

import type { WindowHubSpec } from './window_hub_view';

export type BookOfRealmTab =
  | 'deeds'
  | 'titles'
  | 'reliquary'
  | 'reputation'
  | 'lootExplorer'
  | 'rankings';

export const BOOK_OF_REALM: WindowHubSpec<BookOfRealmTab> = {
  tabs: [
    { id: 'deeds', labelKey: 'hudChrome.bookOfRealm.tabDeeds' },
    { id: 'titles', labelKey: 'hudChrome.bookOfRealm.tabTitles' },
    { id: 'reliquary', labelKey: 'hudChrome.reliquary.title' },
    { id: 'reputation', labelKey: 'hudChrome.bookOfRealm.tabReputation' },
    { id: 'lootExplorer', labelKey: 'hudChrome.lootExplorer.title' },
    { id: 'rankings', labelKey: 'hudChrome.bookOfRealm.tabRankings' },
  ],
  defaultTab: 'deeds',
  storageKey: 'woc.bookOfRealm.tab',
  ariaLabelKey: 'hudChrome.bookOfRealm.title',
  closeKey: 'hudChrome.bookOfRealm.close',
  stripClass: 'realm-hub-tabs',
  tabClass: 'realm-hub-tab',
  focusPrefix: 'realmHub',
};
