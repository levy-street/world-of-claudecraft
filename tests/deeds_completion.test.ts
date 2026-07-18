// The shared completion predicate (src/sim/deeds_completion.ts): the ONE
// definition of "deeds completed" every counting surface consumes. Pins:
//  - the predicate table (feat never; hidden only once earned; plain always),
//  - removed-content exclusion by construction (catalog-order iteration),
//  - the real-catalog nesting invariant: every renown-bearing deed is in the
//    completion set once earned (every feat carries renown 0, pinned by
//    tests/deeds_content.test.ts, so the scoring set nests inside completion),
//  - the explicit id list of the zero-renown NON-feat deeds (the class behind
//    the 142-vs-129 player report): authoring renown 0 places a deed outside
//    the board's SCORING set while it still counts toward completion, so the
//    list makes that a conscious, reviewed act instead of a silent default,
//  - cross-surface parity: the Book of Deeds header (buildDeedsView), the
//    predicate, and the character sheet (characterSheet) agree on one earned
//    state, while the board's deprecated deedCount agrees ONLY on an
//    all-renown-bearing set (the scoring set is a different concept by
//    design; issue #2044 removes that wire field),
//  - the two-character account fixture: the board unions each deed once per
//    account, the ONE sanctioned scope difference from the per-character Book.

import { describe, expect, it } from 'vitest';
import { characterSheet } from '../server/character_sheet';
import type { CharacterRow } from '../server/db';
import { computeDeedsBoard, type DeedsBoardSourceRow } from '../server/deeds_board';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { freshDeedStats } from '../src/sim/deeds';
import { completionCounts, countsTowardCompletion } from '../src/sim/deeds_completion';
import type { DeedDef } from '../src/sim/types';
import { buildDeedsView, type DeedsViewInput } from '../src/ui/deeds_view';

function deed(id: string, renown: DeedDef['renown'], over: Partial<DeedDef> = {}): DeedDef {
  return {
    id,
    name: id,
    desc: id,
    category: 'progression',
    renown,
    trigger: { kind: 'level', level: 2 },
    ...over,
  };
}

describe('countsTowardCompletion', () => {
  it('a plain deed counts, earned or not, zero-renown included', () => {
    expect(countsTowardCompletion(deed('a', 10), false)).toBe(true);
    expect(countsTowardCompletion(deed('a', 10), true)).toBe(true);
    expect(countsTowardCompletion(deed('z', 0), false)).toBe(true);
    expect(countsTowardCompletion(deed('z', 0), true)).toBe(true);
  });

  it('a feat never counts, earned or not', () => {
    expect(countsTowardCompletion(deed('f', 0, { feat: true }), false)).toBe(false);
    expect(countsTowardCompletion(deed('f', 0, { feat: true }), true)).toBe(false);
  });

  it('a hidden deed counts only once earned (masked before)', () => {
    expect(countsTowardCompletion(deed('h', 25, { hidden: true }), false)).toBe(false);
    expect(countsTowardCompletion(deed('h', 25, { hidden: true }), true)).toBe(true);
    expect(countsTowardCompletion(deed('h0', 0, { hidden: true }), false)).toBe(false);
    expect(countsTowardCompletion(deed('h0', 0, { hidden: true }), true)).toBe(true);
  });
});

describe('completionCounts', () => {
  const CATALOG: Record<string, DeedDef> = {
    plain: deed('plain', 10),
    zero: deed('zero', 0),
    feat: deed('feat', 0, { feat: true }),
    hid: deed('hid', 25, { hidden: true }),
  };
  const ORDER = ['plain', 'zero', 'feat', 'hid'];

  it('tallies the earned/total pair over the catalog order', () => {
    // Unearned hidden masked from the total; the feat in neither side.
    expect(completionCounts(new Set(), CATALOG, ORDER)).toEqual({ earned: 0, total: 2 });
    // Earning the hidden deed grows BOTH sides (badge-reveal semantics).
    expect(completionCounts(new Set(['plain', 'zero', 'hid']), CATALOG, ORDER)).toEqual({
      earned: 3,
      total: 3,
    });
    // The earned feat still counts nowhere.
    expect(completionCounts(new Set(['feat']), CATALOG, ORDER)).toEqual({ earned: 0, total: 2 });
  });

  it('an earned id with no live definition never counts (removed content)', () => {
    expect(completionCounts(new Set(['gone_deed', 'plain']), CATALOG, ORDER)).toEqual({
      earned: 1,
      total: 2,
    });
  });

  it('accepts the facet ReadonlyMap as the earned lookup (the deeds_view shape)', () => {
    const earned = new Map([['plain', '2026-07-01']]);
    expect(completionCounts(earned, CATALOG, ORDER).earned).toBe(1);
  });
});

describe('the real catalog', () => {
  it('every renown-bearing deed is in the completion set once earned (nesting)', () => {
    // The scoring set (renown > 0, server/deeds_board.ts) nests inside the
    // completion set: no deed can ever score without counting. Feats carrying
    // renown 0 is the other half, pinned by tests/deeds_content.test.ts.
    for (const id of DEED_ORDER) {
      const def = DEEDS[id];
      if (def.renown > 0) expect(countsTowardCompletion(def, true)).toBe(true);
    }
  });

  it('pins the exact zero-renown NON-feat set (counts in the Book, never scores)', () => {
    // Authoring renown: 0 on a non-feat deed puts it in the Book's completion
    // pair but outside the Renown board's scoring set, the exact class behind
    // the 142-vs-129 count report. Growing this list is a deliberate design
    // act (docs/design/deeds.md rule 2): update it consciously.
    const zeroNonFeat = DEED_ORDER.filter(
      (id) => DEEDS[id].renown === 0 && DEEDS[id].feat !== true,
    ).sort();
    expect(zeroNonFeat).toEqual([
      'col_first_epic',
      'col_first_legendary',
      'col_first_rare',
      'col_glimmerfin',
      'col_set_boundstone_vanguard',
      'col_set_crownforged',
      'col_set_deathlord',
      'col_set_greyjaw_stalker',
      'col_set_necromancers',
      'col_set_nighttalon',
      'col_set_soulflame',
      'col_set_stormcallers',
      'col_set_vale_arcanist',
      'col_set_wyrmshadow',
      'col_seven_regalia',
      'col_true_colors',
      'hid_bountiful_coffer',
      'hid_roll_hundred',
    ]);
  });
});

describe('cross-surface parity', () => {
  // One earned state exercising every delta class at once: a plain
  // renown-bearing deed, a zero-renown collection deed, an earned zero-renown
  // hidden deed, an earned renown-bearing hidden deed, a feat, and a removed
  // id. The completion count everywhere is 4 (the feat and the removed id
  // never count; both hidden deeds count because they are earned).
  const EARNED: Record<string, string> = {
    prog_first_steps: '2026-07-01',
    col_first_rare: '2026-07-02',
    hid_roll_hundred: '2026-07-03',
    hid_saul_footnote: '2026-07-04',
    feat_era_cap: '2026-07-05',
    gone_deed: '2026-07-06',
  };

  it('fixture guards: the exemplars carry the flags each delta class needs', () => {
    expect(DEEDS.prog_first_steps.renown).toBeGreaterThan(0);
    expect(DEEDS.col_first_rare.renown).toBe(0);
    expect(DEEDS.col_first_rare.feat).not.toBe(true);
    expect(DEEDS.hid_roll_hundred.hidden).toBe(true);
    expect(DEEDS.hid_roll_hundred.renown).toBe(0);
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);
    expect(DEEDS.hid_saul_footnote.renown).toBeGreaterThan(0);
    expect(DEEDS.feat_era_cap.feat).toBe(true);
    expect(DEEDS.gone_deed).toBeUndefined();
  });

  it('the Book header, the predicate, and the character sheet agree', () => {
    const pair = completionCounts(new Set(Object.keys(EARNED)), DEEDS, DEED_ORDER);
    expect(pair.earned).toBe(4);

    const input: DeedsViewInput = {
      deedsEarned: new Map(Object.entries(EARNED)),
      deedStats: freshDeedStats(),
      renown: 15,
      activeTitle: null,
      deeds: DEEDS,
      order: DEED_ORDER,
      category: 'progression',
      filter: 'all',
      search: '',
      watched: new Set(),
      searchText: (id) => id,
    };
    const view = buildDeedsView(input);
    expect(view.summary.earned).toBe(pair.earned);
    expect(view.summary.visibleTotal).toBe(pair.total);

    const row: CharacterRow = {
      id: 42,
      account_id: 7,
      name: 'Hilda',
      class: 'warrior',
      level: 12,
      state: { level: 12, deeds: EARNED, renown: 15 } as CharacterRow['state'],
      is_gm: false,
      force_rename: false,
    };
    const sheet = characterSheet({
      row,
      visibility: 'public',
      realm: 'Claudemoon',
      origin: 'https://worldofclaudecraft.com',
      guild: null,
      rank: null,
    });
    expect(sheet.deeds.earnedCount).toBe(pair.earned);
  });

  it('the board deedCount equals the completion count ONLY for an all-renown-bearing set', () => {
    // The scoring set and the completion set are different concepts that
    // coincide exactly when every earned deed bears renown; the deprecated
    // deedCount (issue #2044) is the scoring-set size.
    const CATALOG: Record<string, DeedDef> = { a: deed('a', 25), b: deed('b', 50) };
    const rows: DeedsBoardSourceRow[] = [
      { accountId: 1, characterId: 11, deedId: 'a', earnedAt: '2026-07-01T00:00:00.000Z' },
      { accountId: 1, characterId: 11, deedId: 'b', earnedAt: '2026-07-02T00:00:00.000Z' },
    ];
    const board = computeDeedsBoard(rows, CATALOG).ranked;
    const pair = completionCounts(new Set(['a', 'b']), CATALOG, ['a', 'b']);
    expect(board).toHaveLength(1);
    expect(board[0].deedCount).toBe(pair.earned);
  });

  it('two characters, one account: the board unions once, each Book counts its own', () => {
    // The one sanctioned scope difference: the board is account-scoped (each
    // deed once across characters), the Book header is per character. The
    // visible caption (hudChrome.deeds.lbScopeNote) teaches exactly this.
    const CATALOG: Record<string, DeedDef> = { a: deed('a', 25), b: deed('b', 50) };
    const T = '2026-07-01T00:00:00.000Z';
    const rows: DeedsBoardSourceRow[] = [
      { accountId: 1, characterId: 11, deedId: 'a', earnedAt: T },
      { accountId: 1, characterId: 12, deedId: 'a', earnedAt: T },
      { accountId: 1, characterId: 12, deedId: 'b', earnedAt: T },
    ];
    const board = computeDeedsBoard(rows, CATALOG).ranked;
    expect(board).toHaveLength(1);
    // Union renown 75: 'a' scores once for the account despite two earners.
    expect(board[0].renown).toBe(75);
    expect(board[0].deedCount).toBe(2);
    // Per-character Books: char 11 completed 1 of 2, char 12 completed 2 of 2.
    expect(completionCounts(new Set(['a']), CATALOG, ['a', 'b']).earned).toBe(1);
    expect(completionCounts(new Set(['a', 'b']), CATALOG, ['a', 'b']).earned).toBe(2);
  });
});
