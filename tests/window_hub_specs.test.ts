// The Book of the Realm and Activities hub specs (menu consolidation steps 2
// and 4): tab order, labels, storage keys and the shared strip classes. The
// tab-group rules themselves are pinned through the Professions hub suites
// (they are the same window_hub_view functions).
import { describe, expect, it } from 'vitest';
import { ACTIVITIES } from '../src/ui/hud/hub/activities_view';
import { BOOK_OF_REALM } from '../src/ui/hud/hub/book_of_realm_view';
import {
  parseWindowHubTab,
  resolveWindowHubTab,
  windowHubStripModel,
  windowHubTabFocusKey,
  windowHubToggle,
} from '../src/ui/hud/hub/window_hub_view';
import { setLanguage } from '../src/ui/i18n';

describe('the Book of the Realm', () => {
  it('tabs Deeds, Titles, Reliquary, Reputation, Loot Explorer, Rankings in that order', () => {
    expect(BOOK_OF_REALM.tabs.map((tab) => tab.id)).toEqual([
      'deeds',
      'titles',
      'reliquary',
      'reputation',
      'lootExplorer',
      'rankings',
    ]);
    expect(BOOK_OF_REALM.defaultTab).toBe('deeds');
    expect(BOOK_OF_REALM.storageKey).toBe('woc.bookOfRealm.tab');
  });

  it('labels its strip with the hub title and short tab names', () => {
    setLanguage('en');
    const model = windowHubStripModel(BOOK_OF_REALM, 'reputation');
    expect(model.ariaLabel).toBe('Book of the Realm');
    expect(model.stripClass).toBe('realm-hub-tabs window-hub-tabs ui-tabs');
    expect(model.tabs.map((tab) => [tab.label, tab.selected])).toEqual([
      ['Deeds', false],
      ['Titles', false],
      ['The Reliquary', false],
      ['Reputation', true],
      ['Loot Explorer', false],
      ['Rankings', false],
    ]);
    expect(windowHubTabFocusKey(BOOK_OF_REALM, 'titles')).toBe('realmHub:titles');
  });

  it('a plain Shift+Z press opens the remembered tab; a tab press switches to it', () => {
    expect(windowHubToggle(BOOK_OF_REALM, null, undefined, 'rankings')).toEqual({
      kind: 'open',
      tab: 'rankings',
    });
    expect(windowHubToggle(BOOK_OF_REALM, 'deeds', 'titles', null)).toEqual({
      kind: 'open',
      tab: 'titles',
    });
    expect(windowHubToggle(BOOK_OF_REALM, 'deeds', undefined, null)).toEqual({ kind: 'close' });
    expect(parseWindowHubTab(BOOK_OF_REALM, 'harvest')).toBeNull();
  });
});

describe('Activities', () => {
  it('tabs Dungeons and Raids, PvP, Card Duel behind the Groups bell', () => {
    setLanguage('en');
    expect(ACTIVITIES.tabs.map((tab) => tab.id)).toEqual(['dungeons', 'pvp', 'cardDuel']);
    expect(ACTIVITIES.storageKey).toBe('woc.activities.tab');
    const model = windowHubStripModel(ACTIVITIES, 'pvp');
    expect(model.ariaLabel).toBe('Activities');
    expect(model.tabs.map((tab) => tab.label)).toEqual(['Dungeons and Raids', 'PvP', 'Card Duel']);
  });

  it('G (the PvP tab press) lands on PvP over an open Dungeons tab instead of closing', () => {
    expect(windowHubToggle(ACTIVITIES, 'dungeons', 'pvp', null)).toEqual({
      kind: 'open',
      tab: 'pvp',
    });
    expect(windowHubToggle(ACTIVITIES, 'pvp', 'pvp', null)).toEqual({ kind: 'close' });
    expect(resolveWindowHubTab(ACTIVITIES, undefined, null)).toBe('dungeons');
  });
});
