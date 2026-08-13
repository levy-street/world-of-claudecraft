// Unit tests for the Book of Deeds pure view-core (src/ui/deeds_view.ts):
// hidden masking (in and out of search), feat exclusion from completion and
// nearest, progress clamping, unknown-trigger tolerance, the watch cap, the
// tracker view, crest resolution, recent ordering, the filter arms, the
// unlock-drain plan, and Sim-shaped vs ClientWorld-shaped input parity.
import { describe, expect, it } from 'vitest';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { freshDeedStats } from '../src/sim/deeds';
import type { DeedDef, DeedStats, DeedTrigger } from '../src/sim/types';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import {
  buildDeedsView,
  buildDeedTrackerViewInto,
  buildDeedUnlockPlan,
  DEED_BESPOKE_CRESTS,
  DEED_DISPLAY_CATEGORIES,
  DEED_WATCH_CAP,
  type DeedsRefreshSigParts,
  type DeedsViewInput,
  deedCrestId,
  deedDisplayCategory,
  deedJumpCategory,
  deedProgress,
  deedRarityFraction,
  deedStatsDigest,
  deedsRefreshSig,
  makeDeedTrackerView,
  pruneWatched,
  toggleWatch,
} from '../src/ui/deeds_view';

// ---------------------------------------------------------------------------
// Synthetic catalog (the bank_view synthetic-table precedent): small, spans
// the trigger kinds and masking flags the core branches on.
// ---------------------------------------------------------------------------

const TEST_DEEDS: Record<string, DeedDef> = {
  prog_a: {
    id: 'prog_a',
    name: 'First Steps',
    desc: 'Reach level 2.',
    category: 'progression',
    renown: 5,
    trigger: { kind: 'level', level: 2 },
  },
  cmb_counter: {
    id: 'cmb_counter',
    name: 'Slayer',
    desc: 'Defeat 10 enemies.',
    category: 'combat',
    renown: 10,
    trigger: { kind: 'stat', stat: 'kills', count: 10 },
  },
  cmb_title: {
    id: 'cmb_title',
    name: 'Peakbreaker Task',
    desc: 'A mechanical triumph.',
    category: 'combat',
    renown: 25,
    trigger: { kind: 'manual' },
    reward: { kind: 'title', text: 'Peakbreaker' },
  },
  dgn_clears: {
    id: 'dgn_clears',
    name: 'Crypt Rounds',
    desc: 'Clear the crypt three times.',
    category: 'dungeon',
    renown: 10,
    trigger: { kind: 'dungeonClears', dungeonId: 'crypt', count: 3 },
  },
  col_items: {
    id: 'col_items',
    name: 'Curio Shelf',
    desc: 'Log three curios.',
    category: 'collection',
    renown: 5,
    trigger: { kind: 'collectItems', itemIds: ['curio_a', 'curio_b', 'curio_c'] },
  },
  exp_visits: {
    id: 'exp_visits',
    name: 'Two Landmarks',
    desc: 'Visit both landmarks.',
    category: 'exploration',
    renown: 5,
    trigger: { kind: 'visits', markIds: ['poi:a', 'poi:b'] },
  },
  feat_counter: {
    id: 'feat_counter',
    name: 'Legacy Grind',
    desc: 'A feat with a counter.',
    category: 'feat',
    renown: 0,
    trigger: { kind: 'stat', stat: 'kills', count: 10 },
    feat: true,
  },
  hid_x: {
    id: 'hid_x',
    name: 'Secret Tumble',
    desc: 'A hidden delight.',
    category: 'hidden',
    renown: 5,
    trigger: { kind: 'manual' },
    hidden: true,
  },
  hid_title: {
    id: 'hid_title',
    name: 'Secret Footnote',
    desc: 'A hidden title deed.',
    category: 'hidden',
    renown: 5,
    trigger: { kind: 'manual' },
    reward: { kind: 'title', text: 'the Footnote' },
    hidden: true,
  },
  cmb_future: {
    id: 'cmb_future',
    name: 'Future Shape',
    desc: 'Carries a trigger kind this build does not know.',
    category: 'combat',
    renown: 5,
    trigger: { kind: 'seasonal_gauntlet', tier: 3 } as unknown as DeedTrigger,
  },
};
const TEST_ORDER = Object.keys(TEST_DEEDS);

function stats(mutate?: (s: DeedStats) => void): DeedStats {
  const s = freshDeedStats();
  mutate?.(s);
  return s;
}

function makeInput(over: Partial<DeedsViewInput> = {}): DeedsViewInput {
  return {
    deedsEarned: new Map<string, string>(),
    deedStats: freshDeedStats(),
    renown: 0,
    activeTitle: null,
    activeBorder: null,
    deeds: TEST_DEEDS,
    order: TEST_ORDER,
    category: 'combat',
    filter: 'all',
    search: '',
    watched: new Set<string>(),
    searchText: (id) => `${TEST_DEEDS[id]?.name ?? id} ${TEST_DEEDS[id]?.desc ?? ''}`.toLowerCase(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// deedProgress
// ---------------------------------------------------------------------------

describe('deedProgress', () => {
  it('reads stat counters and clamps at the target, never over', () => {
    const s = stats((x) => {
      x.counters.kills = 7;
    });
    expect(deedProgress({ kind: 'stat', stat: 'kills', count: 10 }, s)).toEqual({
      current: 7,
      target: 10,
    });
    s.counters.kills = 25;
    expect(deedProgress({ kind: 'stat', stat: 'kills', count: 10 }, s)).toEqual({
      current: 10,
      target: 10,
    });
  });

  it('sums dungeon clears across difficulties unless one is named', () => {
    const s = stats((x) => {
      x.dungeonClears.crypt = 2;
      x.dungeonClears['crypt:heroic'] = 1;
    });
    const base = { kind: 'dungeonClears', dungeonId: 'crypt', count: 5 } as const;
    expect(deedProgress(base, s)).toEqual({ current: 3, target: 5 });
    expect(deedProgress({ ...base, difficulty: 'normal' }, s)).toEqual({ current: 2, target: 5 });
    expect(deedProgress({ ...base, difficulty: 'heroic' }, s)).toEqual({ current: 1, target: 5 });
  });

  it('counts collected items and visited marks against their lists', () => {
    const s = stats((x) => {
      x.itemsDiscovered.add('curio_a');
      x.itemsDiscovered.add('curio_c');
      x.visited.add('poi:b');
    });
    expect(
      deedProgress({ kind: 'collectItems', itemIds: ['curio_a', 'curio_b', 'curio_c'] }, s),
    ).toEqual({ current: 2, target: 3 });
    expect(
      deedProgress({ kind: 'collectItems', itemIds: ['curio_a', 'curio_b'], count: 1 }, s),
    ).toEqual({ current: 1, target: 1 });
    expect(deedProgress({ kind: 'visits', markIds: ['poi:a', 'poi:b'] }, s)).toEqual({
      current: 1,
      target: 2,
    });
  });

  it('returns null (binary) for predicate, meta, manual, and UNKNOWN kinds', () => {
    const s = stats();
    expect(deedProgress({ kind: 'level', level: 5 }, s)).toBe(null);
    expect(deedProgress({ kind: 'meta', deedIds: ['prog_a'] }, s)).toBe(null);
    expect(deedProgress({ kind: 'manual' }, s)).toBe(null);
    expect(deedProgress({ kind: 'seasonal_gauntlet' } as unknown as DeedTrigger, s)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Crest and category resolution
// ---------------------------------------------------------------------------

describe('crest resolution', () => {
  it('resolves the image branch first, then the bespoke recipe, then the base crest', () => {
    // Tier 1 (art): any deed with committed art resolves to deed_<id>, including a
    // non-bespoke one (the image branch outranks the base crest). Derived from the
    // live set so the assertion never hardcodes which id happens to ship art.
    const artBacked = [...DEED_IMAGE_IDS].find((id) => !DEED_BESPOKE_CRESTS.has(id));
    expect(artBacked, 'expected at least one art-backed non-bespoke deed').toBeDefined();
    if (artBacked)
      expect(deedCrestId(artBacked, DEEDS[artBacked].category)).toBe(`deed_${artBacked}`);
    // Tier 2 (bespoke recipe): a bespoke id resolves to deed_<id> regardless of art, the
    // forward-compat fallback tier (an artless bespoke deed still lands on deed_<id>). NOTE:
    // all 21 bespoke ids currently also ship art, so this loop passes via the tier-1 art arm;
    // the bespoke `|| DEED_BESPOKE_CRESTS.has(id)` arm is behaviorally subsumed today and cannot
    // be pinned independently by a behavior test (deedCrestId reads the module-level set, so no
    // synthetic artless-bespoke id can be injected). It is kept for the future artless-bespoke case.
    for (const id of DEED_BESPOKE_CRESTS) {
      expect(deedCrestId(id, DEEDS[id].category)).toBe(`deed_${id}`);
    }
    // Tier 3 (neither): an id with no art and no bespoke recipe falls to the display
    // category base crest. cmb_counter is synthetic (never a real deed), so this arm
    // stays stable even if the maintainer later ships more art.
    expect(DEED_IMAGE_IDS.has('cmb_counter')).toBe(false);
    expect(DEED_BESPOKE_CRESTS.has('cmb_counter')).toBe(false);
    expect(deedCrestId('cmb_counter', 'combat')).toBe('deed_cat_combat');
    expect(deedCrestId('hid_x', 'hidden')).toBe('deed_cat_feat');
    expect(deedCrestId('totally_unknown', 'no_such_category')).toBe('deed_cat_feat');
  });

  it('maps hidden and unknown categories onto the Feats shelf', () => {
    expect(deedDisplayCategory('hidden')).toBe('feat');
    expect(deedDisplayCategory('no_such_category')).toBe('feat');
    expect(deedDisplayCategory('pvp')).toBe('pvp');
  });

  it('keeps every bespoke crest id pointing at a real catalog deed', () => {
    for (const id of DEED_BESPOKE_CRESTS) {
      expect(DEEDS[id], `bespoke crest for unknown deed id ${id}`).toBeDefined();
    }
    expect(DEED_BESPOKE_CRESTS.size).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// buildDeedsView: masking, totals, categories, entries, titles
// ---------------------------------------------------------------------------

describe('buildDeedsView', () => {
  it('excludes hidden unearned deeds and all feats from the completion totals', () => {
    const view = buildDeedsView(makeInput());
    // 10 test deeds: 1 feat excluded, 2 hidden unearned excluded => 7 visible.
    expect(view.summary.visibleTotal).toBe(7);
    expect(view.summary.earned).toBe(0);
    expect(view.summary.completion).toBe(0);
  });

  it('counts an earned hidden deed toward completion and the Feats bucket', () => {
    const view = buildDeedsView(
      makeInput({ deedsEarned: new Map([['hid_x', '2026-07-08']]), category: 'feat' }),
    );
    expect(view.summary.visibleTotal).toBe(8);
    expect(view.summary.earned).toBe(1);
    const featBucket = view.categories.find((c) => c.category === 'feat');
    expect(featBucket).toEqual({ category: 'feat', earned: 1, visible: 2 });
    const entry = view.entries.find((e) => e.id === 'hid_x');
    expect(entry).toBeDefined();
    expect(entry?.hiddenBadge).toBe(true);
    expect(entry?.feat).toBe(false);
    expect(entry?.renown).toBe(5);
  });

  it('masks hidden unearned deeds from entries, counts, and search hits', () => {
    const masked = buildDeedsView(makeInput({ category: 'feat', filter: 'all', search: 'secret' }));
    expect(masked.entries).toEqual([]);
    const featBucket = masked.categories.find((c) => c.category === 'feat');
    expect(featBucket).toEqual({ category: 'feat', earned: 0, visible: 1 });
    // Once earned, the same search finds it.
    const revealed = buildDeedsView(
      makeInput({
        deedsEarned: new Map([['hid_x', '2026-07-08']]),
        category: 'feat',
        search: 'secret',
      }),
    );
    expect(revealed.entries.map((e) => e.id)).toEqual(['hid_x']);
  });

  it('renders feats marked, ribboned out of completion, and never in nearest', () => {
    const s = stats((x) => {
      x.counters.kills = 9;
    });
    const view = buildDeedsView(makeInput({ deedStats: s, category: 'feat' }));
    const feat = view.entries.find((e) => e.id === 'feat_counter');
    expect(feat?.feat).toBe(true);
    // feat_counter is 9/10 kills, the highest fraction anywhere, yet excluded.
    expect(view.summary.nearest.map((n) => n.id)).toEqual(['cmb_counter']);
  });

  it('breaks nearest same-fraction ties by catalog order, earlier first', () => {
    const counter: Omit<DeedDef, 'id' | 'name'> = {
      desc: 'Defeat ten enemies.',
      category: 'combat',
      renown: 5,
      trigger: { kind: 'stat', stat: 'kills', count: 10 },
    };
    const tied: Record<string, DeedDef> = {
      cmb_tie_first: { ...counter, id: 'cmb_tie_first', name: 'Tie First' },
      cmb_tie_second: { ...counter, id: 'cmb_tie_second', name: 'Tie Second' },
    };
    const s = stats((x) => {
      x.counters.kills = 5; // the same 0.5 fraction for both
    });
    const view = buildDeedsView(
      makeInput({
        deeds: tied,
        order: ['cmb_tie_first', 'cmb_tie_second'],
        deedStats: s,
        searchText: (id) => id,
      }),
    );
    expect(view.summary.nearest.map((n) => n.id)).toEqual(['cmb_tie_first', 'cmb_tie_second']);
  });

  it('builds entries with progress, clamped, and binary for unknown kinds', () => {
    const s = stats((x) => {
      x.counters.kills = 25;
    });
    const view = buildDeedsView(makeInput({ deedStats: s }));
    const counter = view.entries.find((e) => e.id === 'cmb_counter');
    expect(counter?.progress).toEqual({ current: 10, target: 10 });
    const future = view.entries.find((e) => e.id === 'cmb_future');
    expect(future).toBeDefined();
    expect(future?.progress).toBe(null);
  });

  it('applies the four filter arms, with nearly meaning fraction >= 0.5', () => {
    const s = stats((x) => {
      x.counters.kills = 5; // exactly 0.5 of cmb_counter's 10
    });
    const earnedMap = new Map([['cmb_title', '2026-07-01']]);
    const base = { deedStats: s, deedsEarned: earnedMap } as const;
    const all = buildDeedsView(makeInput({ ...base, filter: 'all' }));
    expect(all.entries.map((e) => e.id)).toEqual(['cmb_counter', 'cmb_title', 'cmb_future']);
    const earned = buildDeedsView(makeInput({ ...base, filter: 'earned' }));
    expect(earned.entries.map((e) => e.id)).toEqual(['cmb_title']);
    const unearned = buildDeedsView(makeInput({ ...base, filter: 'unearned' }));
    expect(unearned.entries.map((e) => e.id)).toEqual(['cmb_counter', 'cmb_future']);
    const nearly = buildDeedsView(makeInput({ ...base, filter: 'nearly' }));
    expect(nearly.entries.map((e) => e.id)).toEqual(['cmb_counter']);
  });

  it('matches search against the injected pre-lowercased text', () => {
    const view = buildDeedsView(makeInput({ search: 'slayer' }));
    expect(view.entries.map((e) => e.id)).toEqual(['cmb_counter']);
    const descHit = buildDeedsView(makeInput({ search: 'trigger kind' }));
    expect(descHit.entries.map((e) => e.id)).toEqual(['cmb_future']);
  });

  it('carries the full entry display model, every field decisive', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([['cmb_title', '2026-07-08']]),
        watched: new Set(['cmb_counter']),
      }),
    );
    // Earned title deed: not watchable, title ribbon on, hidden badge off.
    expect(view.entries.find((e) => e.id === 'cmb_title')).toEqual({
      id: 'cmb_title',
      earned: true,
      earnedDay: '2026-07-08',
      renown: 25,
      progress: null,
      watchable: false,
      watched: false,
      feat: false,
      hiddenBadge: false,
      titleReward: true,
      borderReward: false,
      crestId: 'deed_cat_combat',
    });
    // Unearned watched counter deed: watchable AND watched, no ribbons.
    expect(view.entries.find((e) => e.id === 'cmb_counter')).toEqual({
      id: 'cmb_counter',
      earned: false,
      earnedDay: null,
      renown: 10,
      progress: { current: 0, target: 10 },
      watchable: true,
      watched: true,
      feat: false,
      hiddenBadge: false,
      titleReward: false,
      borderReward: false,
      crestId: 'deed_cat_combat',
    });
  });

  it('nulls the earned-day for hosts without a calendar and keeps real days', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['cmb_title', ''],
          ['cmb_counter', '2026-07-08'],
        ]),
      }),
    );
    expect(view.entries.find((e) => e.id === 'cmb_title')?.earnedDay).toBe(null);
    expect(view.entries.find((e) => e.id === 'cmb_counter')?.earnedDay).toBe('2026-07-08');
  });

  it('orders recent unlocks newest day first, catalog-later first on ties, capped at 5', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['prog_a', '2026-07-01'],
          ['cmb_counter', '2026-07-03'],
          ['cmb_title', '2026-07-03'],
          ['dgn_clears', '2026-07-02'],
          ['col_items', '2026-06-30'],
          ['exp_visits', '2026-06-29'],
        ]),
      }),
    );
    expect(view.summary.recent.map((r) => r.id)).toEqual([
      'cmb_title',
      'cmb_counter',
      'dgn_clears',
      'prog_a',
      'col_items',
    ]);
    expect(view.summary.recent[0].crestId).toBe('deed_cat_combat');
  });

  it('lets the fetched recentOrder outrank the day sort, skipping drifted and unearned ids', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['prog_a', '2026-07-01'],
          ['cmb_counter', '2026-07-03'],
          ['cmb_title', '2026-07-03'],
          ['dgn_clears', '2026-07-02'],
        ]),
        recentOrder: ['cmb_counter', 'removed_deed', 'exp_visits', 'cmb_title', 'prog_a'],
      }),
    );
    // The fetched order wins over the day sort (which would put cmb_title
    // first); the drifted id and the unearned id are skipped; the deed the
    // fetch missed (dgn_clears) still follows from the day fallback.
    expect(view.summary.recent.map((r) => r.id)).toEqual([
      'cmb_counter',
      'cmb_title',
      'prog_a',
      'dgn_clears',
    ]);
  });

  it('puts session unlocks first, newest first, deduped against the fetched order', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['prog_a', '2026-07-01'],
          ['cmb_counter', '2026-07-03'],
          ['cmb_title', '2026-07-03'],
        ]),
        // Drain order (oldest first): prog_a is the newest session unlock.
        sessionUnlocks: ['cmb_counter', 'prog_a'],
        recentOrder: ['cmb_title', 'cmb_counter'],
      }),
    );
    expect(view.summary.recent.map((r) => r.id)).toEqual(['prog_a', 'cmb_counter', 'cmb_title']);
    // The display day still resolves from the earned map for a merged source.
    expect(view.summary.recent[0].earnedDay).toBe('2026-07-01');
  });

  it('an earned id the catalog no longer knows cannot enter recent through the fetched order', () => {
    // Both drift ids sit in the EARNED map, so the earned check alone cannot
    // reject them: the catalog own-property check is the only thing between
    // the wire-sourced order and deedCrestId throwing on a missing def (and
    // 'constructor' is the prototype-key arm of the same guard).
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['removed_deed', '2026-07-01'],
          ['constructor', '2026-07-01'],
          ['cmb_counter', '2026-07-02'],
        ]),
        recentOrder: ['removed_deed', 'constructor', 'cmb_counter'],
      }),
    );
    expect(view.summary.recent.map((r) => r.id)).toEqual(['cmb_counter']);
  });

  it('echoes focusDeedId only when the deed rendered an entry this paint', () => {
    const earned = new Map([['cmb_counter', '2026-07-01']]);
    expect(
      buildDeedsView(makeInput({ deedsEarned: earned, focusDeedId: 'cmb_counter' })).focusDeedId,
    ).toBe('cmb_counter');
    // Another category selected: the card is not in the DOM, so null.
    expect(
      buildDeedsView(
        makeInput({ deedsEarned: earned, category: 'progression', focusDeedId: 'cmb_counter' }),
      ).focusDeedId,
    ).toBe(null);
    // Hidden and unearned: masked entirely, never echoed even on its shelf.
    expect(buildDeedsView(makeInput({ category: 'feat', focusDeedId: 'hid_x' })).focusDeedId).toBe(
      null,
    );
    // A filter that hides the card also clears the echo.
    expect(
      buildDeedsView(
        makeInput({ deedsEarned: earned, filter: 'unearned', focusDeedId: 'cmb_counter' }),
      ).focusDeedId,
    ).toBe(null);
    // A search that hides the card clears it too (the reason openWithDeed
    // resets the search before it paints).
    expect(
      buildDeedsView(
        makeInput({ deedsEarned: earned, search: 'zzz-no-match', focusDeedId: 'cmb_counter' }),
      ).focusDeedId,
    ).toBe(null);
    // Absent input: null.
    expect(buildDeedsView(makeInput()).focusDeedId).toBe(null);
  });

  it('deedJumpCategory: display bucket for a landable deed, null when the jump must not move', () => {
    const earnedHidden = new Map([['hid_x', '2026-07-01']]);
    expect(deedJumpCategory(TEST_DEEDS, new Map(), 'cmb_counter')).toBe('combat');
    // An EARNED hidden deed is revealed on the Feats shelf and jumpable.
    expect(deedJumpCategory(TEST_DEEDS, earnedHidden, 'hid_x')).toBe('feat');
    // Hidden and unearned: even the destination shelf would leak, so null.
    expect(deedJumpCategory(TEST_DEEDS, new Map(), 'hid_x')).toBe(null);
    // Drift and prototype ids: null, never a throw.
    expect(deedJumpCategory(TEST_DEEDS, earnedHidden, 'removed_deed')).toBe(null);
    expect(deedJumpCategory(TEST_DEEDS, earnedHidden, 'constructor')).toBe(null);
  });

  it('ranks nearest by progress fraction, excluding zero progress', () => {
    const s = stats((x) => {
      x.counters.kills = 3; // cmb_counter 0.3
      x.dungeonClears.crypt = 2; // dgn_clears 2/3
      x.itemsDiscovered.add('curio_a'); // col_items 1/3
    });
    const view = buildDeedsView(makeInput({ deedStats: s }));
    expect(view.summary.nearest.map((n) => n.id)).toEqual([
      'dgn_clears',
      'col_items',
      'cmb_counter',
    ]);
    expect(view.summary.nearest[0].progress).toEqual({ current: 2, target: 3 });
    // exp_visits sits at 0/2 and must not appear even with an open slot.
    expect(view.summary.nearest.some((n) => n.id === 'exp_visits')).toBe(false);
  });

  it('lists earned title deeds in the picker with the active one marked', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['cmb_title', '2026-07-08'],
          ['hid_title', '2026-07-08'],
        ]),
        activeTitle: 'cmb_title',
      }),
    );
    expect(view.titles).toEqual([
      { id: null, active: false },
      { id: 'cmb_title', active: true },
      { id: 'hid_title', active: false },
    ]);
    // Unearned title deeds never enter the picker.
    const fresh = buildDeedsView(makeInput());
    expect(fresh.titles).toEqual([{ id: null, active: true }]);
  });

  // -------------------------------------------------------------------------
  // The border picker (the titles picker's sibling). Its own catalog so the
  // counts, category and entry pins above stay pinned to what they were
  // written against; only the reward mix differs from TEST_DEEDS.
  // -------------------------------------------------------------------------
  const PICKER_DEEDS: Record<string, DeedDef> = {
    b_first: {
      id: 'b_first',
      name: 'Warded Deep',
      desc: 'A border-bearing triumph.',
      category: 'dungeon',
      renown: 25,
      trigger: { kind: 'manual' },
      reward: { kind: 'border', slug: 'test_deepward' },
    },
    t_only: {
      id: 't_only',
      name: 'Titled Task',
      desc: 'A title-bearing triumph.',
      category: 'combat',
      renown: 25,
      trigger: { kind: 'manual' },
      reward: { kind: 'title', text: 'the Titled' },
    },
    b_second: {
      id: 'b_second',
      name: 'Gilded Shelf',
      desc: 'A second border-bearing triumph.',
      category: 'collection',
      renown: 50,
      trigger: { kind: 'manual' },
      reward: { kind: 'border', slug: 'test_gilt' },
    },
    b_unearned: {
      id: 'b_unearned',
      name: 'Distant Frame',
      desc: 'A border nobody here has earned.',
      category: 'collection',
      renown: 50,
      trigger: { kind: 'manual' },
      reward: { kind: 'border', slug: 'test_far' },
    },
  };
  const PICKER_ORDER = Object.keys(PICKER_DEEDS);
  const pickerInput = (over: Partial<DeedsViewInput> = {}): DeedsViewInput =>
    makeInput({
      deeds: PICKER_DEEDS,
      order: PICKER_ORDER,
      deedsEarned: new Map([
        ['b_first', '2026-08-01'],
        ['t_only', '2026-08-01'],
        ['b_second', '2026-08-02'],
      ]),
      ...over,
    });

  it('lists earned border deeds in the picker with the active one marked', () => {
    const view = buildDeedsView(pickerInput({ activeBorder: 'b_second' }));
    // Catalog order behind the None head, and the ACTIVE flag tracks the input:
    // b_second is worn, so None is not.
    expect(view.borders).toEqual([
      { id: null, active: false },
      { id: 'b_first', active: false },
      { id: 'b_second', active: true },
    ]);
  });

  it('heads the border picker with None and marks it when nothing is worn', () => {
    const view = buildDeedsView(pickerInput());
    expect(view.borders[0]).toEqual({ id: null, active: true });
    // Unearned border deeds never enter the picker, so the one nobody earned
    // is absent even though the catalog holds it.
    expect(view.borders.some((o) => o.id === 'b_unearned')).toBe(false);
    // Nothing earned at all leaves only the None head.
    const fresh = buildDeedsView(
      makeInput({ deeds: PICKER_DEEDS, order: PICKER_ORDER, activeBorder: null }),
    );
    expect(fresh.borders).toEqual([{ id: null, active: true }]);
  });

  it('keeps the two reward pickers disjoint and leaves titles untouched', () => {
    const view = buildDeedsView(pickerInput({ activeTitle: 't_only' }));
    // A title deed never enters borders, and a border deed never enters titles.
    expect(view.borders.map((o) => o.id)).not.toContain('t_only');
    expect(view.titles).toEqual([
      { id: null, active: false },
      { id: 't_only', active: true },
    ]);
    // An active BORDER moves nothing on the titles list (and vice versa).
    const borderWorn = buildDeedsView(
      pickerInput({ activeTitle: 't_only', activeBorder: 'b_first' }),
    );
    expect(borderWorn.titles).toEqual(view.titles);
  });

  it('flags the reward chip on a border deed card and only there', () => {
    const view = buildDeedsView(pickerInput({ category: 'dungeon' }));
    const card = view.entries.find((e) => e.id === 'b_first');
    expect(card?.borderReward).toBe(true);
    expect(card?.titleReward).toBe(false);
    const titled = buildDeedsView(pickerInput({ category: 'combat' })).entries.find(
      (e) => e.id === 't_only',
    );
    expect(titled?.borderReward).toBe(false);
    expect(titled?.titleReward).toBe(true);
  });

  it('builds the same border picker from a Sim-shaped and a mirror-shaped input', () => {
    // The mirror decodes the self keys from wire-shaped plain JSON, so the
    // border id round-trips through that shape before it is read back.
    const wire = JSON.parse(JSON.stringify({ aborder: 'b_first' }));
    const sim = buildDeedsView(pickerInput({ activeBorder: 'b_first' }));
    const mirror = buildDeedsView(pickerInput({ activeBorder: wire.aborder }));
    expect(mirror.borders).toEqual(sim.borders);
    expect(sim.borders).toEqual([
      { id: null, active: false },
      { id: 'b_first', active: true },
      { id: 'b_second', active: false },
    ]);
  });

  it('marks a drifted active border inactive rather than inventing an option', () => {
    // An id the catalog no longer knows: the sim will never echo it, so no
    // option is active and None must not be marked either (nothing is worn
    // that this client can name).
    const view = buildDeedsView(pickerInput({ activeBorder: 'removed_deed' }));
    expect(view.borders.every((o) => !o.active)).toBe(true);
  });

  it('skips earned ids the catalog no longer knows (content drift), everywhere', () => {
    const view = buildDeedsView(
      makeInput({
        deedsEarned: new Map([
          ['removed_deed', '2026-07-01'],
          ['cmb_counter', '2026-07-02'],
        ]),
        activeTitle: 'removed_deed',
      }),
    );
    expect(view.summary.earned).toBe(1);
    expect(view.summary.recent.map((r) => r.id)).toEqual(['cmb_counter']);
    // A drifted active title marks nothing active (the sim will not echo it).
    expect(view.titles).toEqual([{ id: null, active: false }]);
  });

  it('handles the everything-earned state with a full completion fraction', () => {
    const all = new Map(TEST_ORDER.map((id) => [id, '2026-07-08'] as const));
    const view = buildDeedsView(makeInput({ deedsEarned: new Map(all) }));
    // 9 non-feat deeds earned over 9 visible (hidden now revealed).
    expect(view.summary.earned).toBe(9);
    expect(view.summary.visibleTotal).toBe(9);
    expect(view.summary.completion).toBe(1);
    expect(view.summary.nearest).toEqual([]);
  });

  it('yields identical models from a Sim-shaped and a mirror-shaped input', () => {
    const simStats = stats((x) => {
      x.counters.kills = 4;
      x.itemsDiscovered.add('curio_a');
      x.visited.add('poi:a');
      x.dungeonClears.crypt = 1;
    });
    const simEarned = new Map([
      ['cmb_title', '2026-07-05'],
      ['hid_x', ''],
    ]);
    // The ClientWorld mirror rebuilds the Map and Sets from wire-shaped plain
    // JSON (the online.ts decode), so round-trip through that shape.
    const wire = JSON.parse(
      JSON.stringify({
        deeds: Object.fromEntries(simEarned),
        dstats: {
          counters: simStats.counters,
          itemsDiscovered: [...simStats.itemsDiscovered],
          visited: [...simStats.visited],
          dungeonClears: simStats.dungeonClears,
        },
        renown: 30,
        atitle: 'cmb_title',
      }),
    );
    const mirrorStats: DeedStats = {
      counters: { ...freshDeedStats().counters, ...wire.dstats.counters },
      itemsDiscovered: new Set(wire.dstats.itemsDiscovered),
      visited: new Set(wire.dstats.visited),
      dungeonClears: wire.dstats.dungeonClears,
    };
    const simView = buildDeedsView(
      makeInput({
        deedsEarned: simEarned,
        deedStats: simStats,
        renown: 30,
        activeTitle: 'cmb_title',
        category: 'feat',
      }),
    );
    const mirrorView = buildDeedsView(
      makeInput({
        deedsEarned: new Map(Object.entries(wire.deeds)),
        deedStats: mirrorStats,
        renown: wire.renown,
        activeTitle: wire.atitle,
        category: 'feat',
      }),
    );
    expect(mirrorView).toEqual(simView);
  });
});

// ---------------------------------------------------------------------------
// The real catalog (drift pins)
// ---------------------------------------------------------------------------

describe('real catalog integration', () => {
  it('pins the fresh-character completion denominator of the live catalog', () => {
    const view = buildDeedsView(
      makeInput({ deeds: DEEDS, order: DEED_ORDER, category: 'progression' }),
    );
    // 271 deeds - 4 feats - 9 hidden = 258 visible to a fresh character (the
    // Drakelands brood pair, the four battleground deeds, the Rift coverage
    // pair, the seven per-craft rare-tier profession deeds, the twelve
    // remaining starter-zone chronicle pairs, the four Reliquary Curator rank
    // bridges, the three WARFARE honor ranks, and four of the five Phase 18
    // Reliquary completion-ladder deeds; col_reliquary_complete is the
    // catalog's one off-prefix feat, so it sits outside the completion
    // denominator like the three feat_ deeds).
    expect(view.summary.visibleTotal).toBe(258);
    // The bucket sum adds the feat-flagged rows back on top (3 on the Feats
    // shelf plus the off-prefix capstone on Collection).
    expect(view.categories.reduce((n, c) => n + c.visible, 0)).toBe(262);
  });

  it('offers exactly the live catalog border deeds once they are earned', () => {
    // The four shipped border rewards, pinned as literals in DEED_ORDER order:
    // a fifth border deed (or one re-homed in the order) has to move this pin,
    // which is the moment to check it has an accent palette and picker copy.
    const borderIds = [
      'prog_prestige_10',
      'dgn_deepward',
      'col_discovery_250',
      'col_reliquary_rank_5',
    ];
    const view = buildDeedsView(
      makeInput({
        deeds: DEEDS,
        order: DEED_ORDER,
        deedsEarned: new Map(borderIds.map((id) => [id, '2026-08-01'] as const)),
        activeBorder: 'dgn_deepward',
      }),
    );
    expect(view.borders).toEqual([
      { id: null, active: false },
      { id: 'prog_prestige_10', active: false },
      { id: 'dgn_deepward', active: true },
      { id: 'col_discovery_250', active: false },
      { id: 'col_reliquary_rank_5', active: false },
    ]);
    // Every id the picker offers really carries a border reward (never a title
    // deed leaking across).
    for (const option of view.borders) {
      if (option.id !== null) expect(DEEDS[option.id].reward?.kind).toBe('border');
    }
  });

  it('maps every live catalog category onto a display bucket', () => {
    for (const def of Object.values(DEEDS)) {
      expect(DEED_DISPLAY_CATEGORIES).toContain(deedDisplayCategory(def.category));
    }
  });
});

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

describe('toggleWatch', () => {
  it('adds below the cap and removes an existing watch', () => {
    const added = toggleWatch(new Set(), 'cmb_counter');
    expect(added.changed).toBe(true);
    expect(added.full).toBe(false);
    expect([...added.watched]).toEqual(['cmb_counter']);
    const removed = toggleWatch(added.watched, 'cmb_counter');
    expect(removed.changed).toBe(true);
    expect(removed.full).toBe(false);
    expect(removed.watched.size).toBe(0);
  });

  it('accepts the add that lands exactly at the cap (the fifth watch)', () => {
    const four = new Set(['a', 'b', 'c', 'd']);
    expect(four.size).toBe(DEED_WATCH_CAP - 1);
    const fifth = toggleWatch(four, 'cmb_counter');
    expect(fifth.changed).toBe(true);
    expect(fifth.full).toBe(false);
    expect(fifth.watched.size).toBe(5);
    expect(fifth.watched.has('cmb_counter')).toBe(true);
  });

  it('refuses an add at the cap with the full flag and an unchanged set', () => {
    const atCap = new Set(['a', 'b', 'c', 'd', 'e']);
    expect(atCap.size).toBe(DEED_WATCH_CAP);
    const result = toggleWatch(atCap, 'cmb_counter');
    expect(result.full).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.watched).toBe(atCap);
    // Removal still works at the cap (the other arm of the boundary).
    const removal = toggleWatch(atCap, 'c');
    expect(removal.changed).toBe(true);
    expect(removal.watched.size).toBe(4);
  });
});

describe('pruneWatched', () => {
  it('drops earned and catalog-unknown ids and reports the change', () => {
    const watched = new Set(['prog_a', 'cmb_counter', 'dgn_clears', 'cmb_title', 'removed_deed']);
    expect(watched.size).toBe(DEED_WATCH_CAP);
    const result = pruneWatched(watched, new Map([['cmb_title', '2026-07-08']]), TEST_DEEDS);
    expect(result.changed).toBe(true);
    expect([...result.watched]).toEqual(['prog_a', 'cmb_counter', 'dgn_clears']);
  });

  it('returns the SAME set instance unchanged when every id is eligible', () => {
    const watched = new Set(['prog_a', 'cmb_counter']);
    const result = pruneWatched(watched, new Map(), TEST_DEEDS);
    expect(result.changed).toBe(false);
    expect(result.watched).toBe(watched);
  });

  it('frees the wedged slot: a full set with an earned member accepts a new watch once pruned', () => {
    // The defect chain: five watches, one of them then earned. The earned card
    // loses its unwatch button, so the raw set holds five ids forever and
    // toggleWatch refuses every further add; the prune is what frees the slot.
    const atCap = new Set(['prog_a', 'cmb_counter', 'dgn_clears', 'col_items', 'cmb_title']);
    expect(atCap.size).toBe(DEED_WATCH_CAP);
    const pruned = pruneWatched(atCap, new Map([['cmb_title', '2026-07-08']]), TEST_DEEDS);
    const added = toggleWatch(pruned.watched, 'exp_visits');
    expect(added.changed).toBe(true);
    expect(added.full).toBe(false);
    expect(added.watched.size).toBe(DEED_WATCH_CAP);
    expect(added.watched.has('exp_visits')).toBe(true);
  });
});

describe('deedsRefreshSig', () => {
  const base = (): DeedsRefreshSigParts => ({
    renown: 15,
    earnedCount: 3,
    activeTitle: 'cmb_title',
    activeBorder: 'dgn_border',
    filter: 'all',
    search: '',
    category: 'combat',
    watchRev: 2,
    statsDigest: 41,
  });

  it('is identical for structurally equal parts (the elision arm)', () => {
    expect(deedsRefreshSig(base())).toBe(deedsRefreshSig(base()));
  });

  it('moves when any single repaint dimension moves', () => {
    const movers: Array<(p: DeedsRefreshSigParts) => void> = [
      (p) => {
        p.renown = 20;
      },
      (p) => {
        p.earnedCount = 4;
      },
      (p) => {
        p.activeTitle = null;
      },
      (p) => {
        p.activeBorder = null;
      },
      (p) => {
        p.filter = 'earned';
      },
      (p) => {
        p.search = 'wyrm';
      },
      (p) => {
        p.category = 'titles';
      },
      (p) => {
        p.watchRev = 3;
      },
      (p) => {
        p.statsDigest = 42;
      },
    ];
    // Every dimension of the parts record has a mover (dropping one from the
    // signature, or adding one here without a mover, fails this pin).
    expect(movers.length).toBe(Object.keys(base()).length);
    const sig = deedsRefreshSig(base());
    for (const move of movers) {
      const parts = base();
      move(parts);
      expect(deedsRefreshSig(parts)).not.toBe(sig);
    }
  });
});

describe('deedStatsDigest', () => {
  it('is stable on equal stats and moves on any climb, clear, discovery, or visit', () => {
    const base = deedStatsDigest(stats());
    expect(deedStatsDigest(stats())).toBe(base);
    expect(
      deedStatsDigest(
        stats((x) => {
          x.counters.kills = 1;
        }),
      ),
    ).not.toBe(base);
    expect(
      deedStatsDigest(
        stats((x) => {
          x.dungeonClears.crypt = 1;
        }),
      ),
    ).not.toBe(base);
    expect(
      deedStatsDigest(
        stats((x) => {
          x.itemsDiscovered.add('curio_a');
        }),
      ),
    ).not.toBe(base);
    expect(
      deedStatsDigest(
        stats((x) => {
          x.visited.add('poi:a');
        }),
      ),
    ).not.toBe(base);
  });
});

describe('buildDeedTrackerViewInto', () => {
  it('reuses the same container and line objects across calls', () => {
    const out = makeDeedTrackerView();
    const lines = out.lines;
    const first = buildDeedTrackerViewInto(
      out,
      new Set(['cmb_counter']),
      new Map(),
      stats(),
      TEST_DEEDS,
      false,
    );
    const second = buildDeedTrackerViewInto(
      out,
      new Set(['cmb_counter']),
      new Map(),
      stats(),
      TEST_DEEDS,
      true,
    );
    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(out.lines).toBe(lines);
    expect(out.lines[0]).toBe(lines[0]);
    expect(out.collapsed).toBe(true);
  });

  it('drops earned and catalog-unknown ids automatically', () => {
    const out = makeDeedTrackerView();
    buildDeedTrackerViewInto(
      out,
      new Set(['cmb_counter', 'cmb_title', 'removed_deed']),
      new Map([['cmb_title', '2026-07-08']]),
      stats((x) => {
        x.counters.kills = 4;
      }),
      TEST_DEEDS,
      false,
    );
    expect(out.count).toBe(1);
    expect(out.visible).toBe(true);
    expect(out.lines[0].id).toBe('cmb_counter');
    expect(out.lines[0].hasProgress).toBe(true);
    expect(out.lines[0].current).toBe(4);
    expect(out.lines[0].target).toBe(10);
  });

  it('marks binary deeds progress-less and hides an emptied tracker', () => {
    const out = makeDeedTrackerView();
    buildDeedTrackerViewInto(out, new Set(['cmb_title']), new Map(), stats(), TEST_DEEDS, false);
    expect(out.count).toBe(1);
    expect(out.lines[0].hasProgress).toBe(false);
    buildDeedTrackerViewInto(
      out,
      new Set(['cmb_title']),
      new Map([['cmb_title', '2026-07-08']]),
      stats(),
      TEST_DEEDS,
      false,
    );
    expect(out.count).toBe(0);
    expect(out.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The unlock-drain plan (the handleEvents batching rules)
// ---------------------------------------------------------------------------

describe('buildDeedUnlockPlan', () => {
  it('coalesces two same-drain unlocks into one banner, two log lines, one sound', () => {
    const plan = buildDeedUnlockPlan(
      [{ deedId: 'cmb_counter' }, { deedId: 'cmb_title' }],
      TEST_DEEDS,
    );
    expect(plan.logIds).toEqual(['cmb_counter', 'cmb_title']);
    expect(plan.bannerId).toBe('cmb_title');
    expect(plan.titleHintIds).toEqual(['cmb_title']);
    expect(plan.playSound).toBe(true);
    expect(plan.retroCount).toBe(0);
  });

  it('a lone retro event yields exactly one summary count and ZERO banners or sound', () => {
    const plan = buildDeedUnlockPlan([{ deedId: 'cmb_counter', retro: true }], TEST_DEEDS);
    expect(plan.retroCount).toBe(1);
    expect(plan.bannerId).toBe(null);
    expect(plan.logIds).toEqual([]);
    expect(plan.titleHintIds).toEqual([]);
    expect(plan.playSound).toBe(false);
  });

  it('batches a retro burst into one count while fresh unlocks still banner', () => {
    const plan = buildDeedUnlockPlan(
      [
        { deedId: 'prog_a', retro: true },
        { deedId: 'dgn_clears', retro: true },
        { deedId: 'cmb_counter' },
      ],
      TEST_DEEDS,
    );
    expect(plan.retroCount).toBe(2);
    expect(plan.logIds).toEqual(['cmb_counter']);
    expect(plan.bannerId).toBe('cmb_counter');
    expect(plan.playSound).toBe(true);
  });

  it('skips catalog-unknown ids entirely, fresh and retro alike', () => {
    const plan = buildDeedUnlockPlan(
      [{ deedId: 'removed_deed' }, { deedId: 'removed_retro', retro: true }],
      TEST_DEEDS,
    );
    expect(plan).toEqual({
      logIds: [],
      bannerId: null,
      titleHintIds: [],
      borderHintIds: [],
      playSound: false,
      retroCount: 0,
    });
  });

  // The border hint is the title hint's sibling: three of the four live border
  // deeds unlock with nothing pointing at the picker that wears them, so the
  // plan has to carry them the same way. Extended locally rather than in the
  // shared fixture, so the category/count arms elsewhere in this file are
  // untouched.
  const BORDER_DEEDS: Record<string, DeedDef> = {
    ...TEST_DEEDS,
    cmb_border: {
      id: 'cmb_border',
      name: 'Laurelled',
      desc: 'A border deed.',
      category: 'combat',
      renown: 25,
      trigger: { kind: 'manual' },
      reward: { kind: 'border', slug: 'prestige_laurels' },
    },
  };

  it('hints a border unlock, and never confuses it with a title unlock', () => {
    const plan = buildDeedUnlockPlan([{ deedId: 'cmb_border' }], BORDER_DEEDS);
    expect(plan.borderHintIds).toEqual(['cmb_border']);
    // The two rewards share one field, so a kind-blind check would hint both.
    expect(plan.titleHintIds).toEqual([]);
    expect(plan.logIds).toEqual(['cmb_border']);
  });

  it('leaves the border hints empty for a title unlock', () => {
    const plan = buildDeedUnlockPlan([{ deedId: 'cmb_title' }], BORDER_DEEDS);
    expect(plan.titleHintIds).toEqual(['cmb_title']);
    expect(plan.borderHintIds).toEqual([]);
  });

  it('carries both hint lists when one drain unlocks a title and a border', () => {
    const plan = buildDeedUnlockPlan(
      [{ deedId: 'cmb_title' }, { deedId: 'cmb_counter' }, { deedId: 'cmb_border' }],
      BORDER_DEEDS,
    );
    expect(plan.titleHintIds).toEqual(['cmb_title']);
    expect(plan.borderHintIds).toEqual(['cmb_border']);
    expect(plan.logIds).toEqual(['cmb_title', 'cmb_counter', 'cmb_border']);
    expect(plan.bannerId).toBe('cmb_border'); // still one banner, the last unlock
  });

  it('skips a prototype-key id instead of resolving it through the catalog', () => {
    // The catalog is a plain object, so a bare index answers Object.prototype
    // for '__proto__' and the id would be logged as a real unlock with no
    // reward. Same hasOwn guard as the rest of the deed resolver family.
    const plan = buildDeedUnlockPlan(
      [{ deedId: '__proto__' }, { deedId: 'constructor' }, { deedId: 'cmb_counter' }],
      TEST_DEEDS,
    );
    expect(plan.logIds).toEqual(['cmb_counter']);
    expect(plan.bannerId).toBe('cmb_counter');
  });

  it('never hints a RETRO border (the on-join catch-up stays silent)', () => {
    const plan = buildDeedUnlockPlan([{ deedId: 'cmb_border', retro: true }], BORDER_DEEDS);
    expect(plan.borderHintIds).toEqual([]);
    expect(plan.retroCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deedRarityFraction: the pure render gate for the per-card rarity line.
// ---------------------------------------------------------------------------

describe('deedRarityFraction', () => {
  const rarity = { totalEligible: 120, earned: { prog_veteran: 30, cmb_thunzharr: 1 } };

  it('returns the exact fraction for an earned deed', () => {
    expect(deedRarityFraction(rarity, 'prog_veteran')).toBe(0.25);
    expect(deedRarityFraction(rarity, 'cmb_thunzharr')).toBe(1 / 120);
  });

  it('returns null with no aggregate (offline or fetch failure)', () => {
    expect(deedRarityFraction(null, 'prog_veteran')).toBeNull();
  });

  it('returns null for a deed nobody has earned (absent from the map)', () => {
    expect(deedRarityFraction(rarity, 'prog_first_steps')).toBeNull();
  });

  it('returns null over an empty eligible population (never divides by zero)', () => {
    expect(
      deedRarityFraction({ totalEligible: 0, earned: { prog_veteran: 3 } }, 'prog_veteran'),
    ).toBeNull();
  });

  it('clamps to 1 when a count outruns the denominator (aggregate snapshot skew)', () => {
    expect(
      deedRarityFraction({ totalEligible: 10, earned: { prog_veteran: 12 } }, 'prog_veteran'),
    ).toBe(1);
  });
});
