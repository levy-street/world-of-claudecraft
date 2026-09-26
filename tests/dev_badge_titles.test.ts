// The developer-badge rungs as wearable titles (src/sim/dev_badge_titles.ts).
// They are deliberately NOT Book of Deeds rewards: deeds record in-game
// accomplishments, and a badge rung is earned outside the game. These pins keep
// the two apart (no deed id, no Book entry) while every title surface still
// resolves the rung text, the picker offers exactly the reachable rungs, and the
// one title validator gates them on the live resolved tier.
import { describe, expect, it } from 'vitest';
import { sheetTitleText } from '../server/character_sheet';
import { DEEDS } from '../src/sim/content/deeds';
import { freshDeedStats, setActiveTitle } from '../src/sim/deeds';
import {
  canWearDevBadgeTitle,
  DEV_BADGE_TITLE_ENGLISH,
  DEV_BADGE_TITLE_PREFIX,
  devBadgeTitleId,
  devBadgeTitleTier,
  reconcileDevBadgeTitle,
  wearableDevBadgeTitles,
} from '../src/sim/dev_badge_titles';
import { DEV_TIER_DEFS } from '../src/sim/dev_tier';
import { Sim } from '../src/sim/sim';
import { deedTitleText, titledDisplayName } from '../src/ui/deed_i18n';
import { buildDeedsView, type DeedsViewInput, deedsRefreshSig } from '../src/ui/deeds_view';
import { DEV_TIERS } from '../src/ui/dev_tier';

function viewInput(over: Partial<DeedsViewInput> = {}): DeedsViewInput {
  return {
    deedsEarned: new Map<string, string>(),
    deedStats: freshDeedStats(),
    renown: 0,
    activeTitle: null,
    activeBorder: null,
    deeds: {},
    order: [],
    category: 'combat',
    filter: 'all',
    search: '',
    watched: new Set<string>(),
    searchText: () => '',
    ...over,
  };
}

describe('developer-badge title ids', () => {
  it('live in their own namespace, never a deed id', () => {
    expect(DEV_TIER_DEFS.map((t) => devBadgeTitleId(t.key))).toEqual([
      'dev:tinkerer',
      'dev:artificer',
      'dev:runesmith',
      'dev:architect',
      'dev:worldwright',
    ]);
    for (const id of Object.keys(DEEDS)) {
      expect(id.startsWith(DEV_BADGE_TITLE_PREFIX), id).toBe(false);
      expect(devBadgeTitleTier(id), id).toBeUndefined();
    }
  });

  it('parse back to their rung, and nothing else parses', () => {
    expect(devBadgeTitleTier('dev:runesmith')?.index).toBe(3);
    for (const bad of ['dev:', 'dev:nope', 'dev:toString', 'runesmith', 'prog_veteran', null]) {
      expect(devBadgeTitleTier(bad), String(bad)).toBeUndefined();
    }
  });

  it('are wearable exactly while the resolved tier reaches the rung', () => {
    expect(canWearDevBadgeTitle('dev:runesmith', 3)).toBe(true);
    expect(canWearDevBadgeTitle('dev:tinkerer', 3)).toBe(true);
    expect(canWearDevBadgeTitle('dev:architect', 3)).toBe(false);
    expect(canWearDevBadgeTitle('dev:tinkerer', 0)).toBe(false);
    expect(canWearDevBadgeTitle('dev:tinkerer', undefined)).toBe(false);
    expect(canWearDevBadgeTitle('prog_veteran', 5)).toBe(false);
    expect(wearableDevBadgeTitles(0)).toEqual([]);
    expect(wearableDevBadgeTitles(undefined)).toEqual([]);
    expect(wearableDevBadgeTitles(2)).toEqual(['dev:tinkerer', 'dev:artificer']);
    expect(wearableDevBadgeTitles(5)).toHaveLength(5);
  });

  it('reconcile clears only a worn rung the tier no longer reaches', () => {
    const meta = { activeTitle: 'dev:architect' as string | null };
    const e = { title: 'dev:architect' as string | null, devTier: 3 };
    expect(reconcileDevBadgeTitle(meta, e)).toBe(true);
    expect(meta.activeTitle).toBe(null);
    expect(e.title).toBe(null);

    const kept = { activeTitle: 'dev:artificer' as string | null };
    const keptE = { title: 'dev:artificer' as string | null, devTier: 3 };
    expect(reconcileDevBadgeTitle(kept, keptE)).toBe(false);
    expect(keptE.title).toBe('dev:artificer');

    const deed = { activeTitle: 'prog_veteran' as string | null };
    const deedE = { title: 'prog_veteran' as string | null, devTier: 0 };
    expect(reconcileDevBadgeTitle(deed, deedE)).toBe(false);
    expect(deedE.title).toBe('prog_veteran');
  });
});

describe('the one title validator (offline Sim, same function the server dispatches)', () => {
  function fixture() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.addPlayer('warrior', 'Devvy');
    return { meta: sim.players.get(pid)!, e: sim.entities.get(pid)! };
  }

  it('accepts a reachable rung and refuses one above the tier or with no tier', () => {
    const { meta, e } = fixture();
    setActiveTitle(meta, e, 'dev:artificer'); // no resolved tier offline
    expect(e.title ?? null).toBe(null);
    e.devTier = 2;
    setActiveTitle(meta, e, 'dev:artificer');
    expect(e.title).toBe('dev:artificer');
    expect(meta.activeTitle).toBe('dev:artificer');
    setActiveTitle(meta, e, 'dev:runesmith');
    expect(e.title).toBe('dev:artificer');
    setActiveTitle(meta, e, null);
    expect(e.title).toBe(null);
    // Wearing a rung title earns nothing in the Book.
    expect(meta.deedsEarned.size).toBe(0);
    expect(meta.renown).toBe(0);
  });

  it('the restore path takes a saved rung as-is but still refuses an unknown rung', () => {
    const { meta, e } = fixture();
    setActiveTitle(meta, e, 'dev:worldwright', { restore: true });
    expect(e.title).toBe('dev:worldwright');
    setActiveTitle(meta, e, 'dev:bogus', { restore: true });
    expect(e.title).toBe('dev:worldwright');
  });
});

describe('title surfaces', () => {
  it('resolve the rung title to the badge rung name everywhere', () => {
    for (const tier of DEV_TIERS) {
      const id = devBadgeTitleId(tier.key);
      expect(deedTitleText(id)).toBe(tier.name);
      expect(titledDisplayName('Devvy', id)).toContain(tier.name);
    }
    expect(deedTitleText('dev:bogus')).toBe('');
  });

  it('the English server table matches the badge names (the /c/ page)', () => {
    for (const tier of DEV_TIERS) {
      expect(DEV_BADGE_TITLE_ENGLISH[tier.key]).toBe(tier.name);
      expect(sheetTitleText(devBadgeTitleId(tier.key))).toBe(tier.name);
    }
    expect(sheetTitleText('dev:bogus')).toBe(null);
  });

  it('the picker lists the reachable rungs after the deed titles, and marks the worn one', () => {
    const none = buildDeedsView(viewInput());
    expect(none.titles).toEqual([{ id: null, active: true }]);
    const view = buildDeedsView(viewInput({ devTier: 2, activeTitle: 'dev:artificer' }));
    expect(view.titles).toEqual([
      { id: null, active: false },
      { id: 'dev:tinkerer', active: false },
      { id: 'dev:artificer', active: true },
    ]);
    // Rung titles are not deeds: no entries, no counts.
    expect(view.entries).toEqual([]);
    expect(view.categories.every((c) => c.earned === 0 && c.visible === 0)).toBe(true);
  });

  it('a tier change repaints an open Book (the refresh signature moves)', () => {
    const parts = {
      renown: 0,
      earnedCount: 0,
      activeTitle: null,
      activeBorder: null,
      filter: 'all' as const,
      search: '',
      category: 'combat' as const,
      watchRev: 0,
      statsDigest: 0,
    };
    expect(deedsRefreshSig({ ...parts, devTier: 3 })).not.toBe(
      deedsRefreshSig({ ...parts, devTier: 0 }),
    );
    expect(deedsRefreshSig(parts)).toBe(deedsRefreshSig({ ...parts, devTier: 0 }));
  });
});
