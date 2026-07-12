// The Renown board's pure scoring core (server/deeds_board.ts): counted-set
// scoring over character_deeds rows, the entry floor, the three ordering keys
// (score desc, completionTime asc, accountId asc), display-character
// selection, the self rank + topPercent read, and unknown-deed tolerance.
// Plain fixtures, no db import: the module is host-agnostic by design.

import { describe, expect, it } from 'vitest';
import {
  buildDeedsBoardEntries,
  computeDeedsBoard,
  DEEDS_BOARD_ENTRY_FLOOR,
  type DeedsBoardDisplayCharacter,
  type DeedsBoardSourceRow,
  deedsBoardSelf,
  type RankedDeedsAccount,
} from '../../server/deeds_board';
import type { DeedDef } from '../../src/sim/types';

// Minimal DeedDef factory: only id + renown matter to the board; the rest is
// the smallest shape the type accepts.
function deed(id: string, renown: DeedDef['renown']): DeedDef {
  return {
    id,
    name: id,
    desc: id,
    category: 'progression',
    renown,
    trigger: { kind: 'level', level: 2 },
  };
}

// A catalog fixture: two 25s, two 10s, a 5, a 50, and a zero-renown feat.
const CATALOG: Record<string, DeedDef> = {
  d25a: deed('d25a', 25),
  d25b: deed('d25b', 25),
  d10a: deed('d10a', 10),
  d10b: deed('d10b', 10),
  d5: deed('d5', 5),
  d50: deed('d50', 50),
  feat0: { ...deed('feat0', 0), feat: true },
};

function row(
  accountId: number,
  characterId: number,
  deedId: string,
  earnedAt: Date | string,
): DeedsBoardSourceRow {
  return { accountId, characterId, deedId, earnedAt };
}

const T1 = '2026-07-01T00:00:00.000Z';
const T2 = '2026-07-02T00:00:00.000Z';
const T3 = '2026-07-03T00:00:00.000Z';
const T4 = '2026-07-04T00:00:00.000Z';

function ranked(rows: DeedsBoardSourceRow[]): RankedDeedsAccount[] {
  return computeDeedsBoard(rows, CATALOG).ranked;
}

describe('computeDeedsBoard scoring', () => {
  it('sums renown over the distinct counted set and reports deedCount', () => {
    const board = ranked([row(1, 11, 'd25a', T1), row(1, 11, 'd10a', T2), row(1, 12, 'd25b', T3)]);
    expect(board).toHaveLength(1);
    expect(board[0].accountId).toBe(1);
    expect(board[0].renown).toBe(60);
    expect(board[0].deedCount).toBe(3);
  });

  it('counts a deed once per account even when two characters both earned it', () => {
    const board = ranked([row(1, 11, 'd50', T1), row(1, 12, 'd50', T3), row(1, 11, 'd25a', T2)]);
    expect(board).toHaveLength(1);
    // 50 + 25, never 50 + 50 + 25: the roll-up dedupes per account by deed id.
    expect(board[0].renown).toBe(75);
    expect(board[0].deedCount).toBe(2);
    // The duplicate's later earn does not move completionTime either: the deed
    // first contributed renown at its EARLIEST earn (T1), so the score was
    // reached at max(T1, T2) = T2.
    expect(board[0].completionTime).toBe(Date.parse(T2));
  });

  it('accepts Date objects and ISO strings for earnedAt interchangeably', () => {
    const board = ranked([row(1, 11, 'd50', new Date(T1)), row(1, 11, 'd25a', T2)]);
    expect(board).toHaveLength(1);
    expect(board[0].completionTime).toBe(Date.parse(T2));
  });
});

describe('zero-renown deeds', () => {
  it('neither score nor count', () => {
    const board = ranked([row(1, 11, 'd50', T1), row(1, 11, 'feat0', T2), row(1, 11, 'd25a', T2)]);
    expect(board).toHaveLength(1);
    expect(board[0].renown).toBe(75);
    expect(board[0].deedCount).toBe(2);
  });

  it('do not shift the tie-break', () => {
    // Account 1 reaches 50 at T1 but earns a zero-renown feat at T4; account 2
    // reaches 50 at T2. If the feat leaked into the counted set, account 1's
    // completionTime would be T4 and it would wrongly rank below account 2.
    const board = ranked([row(1, 11, 'd50', T1), row(1, 11, 'feat0', T4), row(2, 21, 'd50', T2)]);
    expect(board.map((a) => a.accountId)).toEqual([1, 2]);
  });

  it('an account with only zero-renown deeds never boards', () => {
    const board = ranked([row(1, 11, 'feat0', T1)]);
    expect(board).toHaveLength(0);
  });
});

describe('the entry floor', () => {
  it('is 50', () => {
    // Pinned as a literal: the floor is one notable deed (or a handful of
    // routine ones), per the score-floor design rule.
    expect(DEEDS_BOARD_ENTRY_FLOOR).toBe(50);
  });

  it('drops an account below the floor and keeps one exactly at it', () => {
    const board = ranked([
      // Account 1: 25 + 10 + 10 = 45, below the floor (renown is quantized
      // 5/10/25/50, so 45 is the nearest reachable score under 50).
      row(1, 11, 'd25a', T1),
      row(1, 11, 'd10a', T1),
      row(1, 11, 'd10b', T1),
      // Account 2: 25 + 25 = 50, exactly at the floor.
      row(2, 21, 'd25a', T1),
      row(2, 21, 'd25b', T1),
    ]);
    expect(board.map((a) => a.accountId)).toEqual([2]);
    expect(board[0].renown).toBe(50);
  });
});

describe('ordering', () => {
  it('ranks by score descending first', () => {
    const board = ranked([row(1, 11, 'd50', T2), row(2, 21, 'd50', T1), row(2, 21, 'd25a', T1)]);
    expect(board.map((a) => a.accountId)).toEqual([2, 1]);
  });

  it('breaks a score tie by earlier completionTime', () => {
    const board = ranked([
      // Both score 75; account 2 finished its set at T2, account 1 at T3.
      row(1, 11, 'd50', T1),
      row(1, 11, 'd25a', T3),
      row(2, 21, 'd50', T2),
      row(2, 21, 'd25a', T1),
    ]);
    expect(board.map((a) => a.accountId)).toEqual([2, 1]);
    expect(board[0].completionTime).toBe(Date.parse(T2));
    expect(board[1].completionTime).toBe(Date.parse(T3));
  });

  it('breaks a full tie by ascending accountId', () => {
    const board = ranked([row(9, 91, 'd50', T1), row(3, 31, 'd50', T1)]);
    expect(board.map((a) => a.accountId)).toEqual([3, 9]);
  });
});

describe('display character', () => {
  it('is the account character with the highest per-character Renown', () => {
    const board = ranked([row(1, 11, 'd25a', T1), row(1, 11, 'd10a', T1), row(1, 12, 'd50', T2)]);
    expect(board).toHaveLength(1);
    expect(board[0].displayCharacterId).toBe(12);
  });

  it('breaks a per-character tie by the lowest characterId', () => {
    const board = ranked([row(1, 12, 'd25a', T1), row(1, 12, 'd25b', T1), row(1, 11, 'd50', T2)]);
    expect(board[0].displayCharacterId).toBe(11);
  });

  it('a shared deed counts for BOTH characters when picking the face', () => {
    // Account-level dedupe applies to the score, not to the per-character
    // comparison: each character's own earned set decides who fronts the board.
    const board = ranked([row(1, 11, 'd50', T1), row(1, 12, 'd50', T2), row(1, 12, 'd10a', T2)]);
    expect(board[0].renown).toBe(60);
    expect(board[0].displayCharacterId).toBe(12);
  });
});

describe('unknown-deed tolerance', () => {
  it('skips rows for removed content and reports them, never throws', () => {
    const result = computeDeedsBoard(
      [
        row(1, 11, 'd50', T1),
        row(1, 11, 'gone_deed', T2),
        row(2, 21, 'gone_deed', T1),
        row(2, 21, 'also_gone', T1),
      ],
      CATALOG,
    );
    expect(result.unknownDeedIds).toEqual(['also_gone', 'gone_deed']);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].renown).toBe(50);
    // Account 2 held only unknown rows, so it never boards.
    expect(result.ranked[0].accountId).toBe(1);
  });

  it('returns the empty board for no rows', () => {
    const result = computeDeedsBoard([], CATALOG);
    expect(result.ranked).toEqual([]);
    expect(result.totalRanked).toBe(0);
    expect(result.unknownDeedIds).toEqual([]);
  });
});

describe('buildDeedsBoardEntries', () => {
  function displayChar(id: number, name: string): DeedsBoardDisplayCharacter {
    return { id, name, class: 'warrior', level: 20, realm: 'Claudemoon', activeTitle: null };
  }

  it('faces each ranked account with its display character, account id never on the entry', () => {
    const board = ranked([row(1, 11, 'd50', T1), row(1, 11, 'd25a', T1), row(2, 21, 'd50', T2)]);
    const entries = buildDeedsBoardEntries(board, [
      { ...displayChar(11, 'Aldwin'), activeTitle: 'd50' },
      displayChar(21, 'Berrin'),
    ]);
    expect(entries).toEqual([
      {
        rank: 1,
        name: 'Aldwin',
        realm: 'Claudemoon',
        cls: 'warrior',
        level: 20,
        renown: 75,
        deedCount: 2,
        title: 'd50',
      },
      {
        rank: 2,
        name: 'Berrin',
        realm: 'Claudemoon',
        cls: 'warrior',
        level: 20,
        renown: 50,
        deedCount: 1,
        title: null,
      },
    ]);
    // The public entry never carries the internal account id, under any key.
    for (const entry of entries) expect('accountId' in entry).toBe(false);
  });

  it('skips a ranked account whose display character is missing, keeping ranks truthful', () => {
    const board = ranked([row(1, 11, 'd50', T1), row(1, 11, 'd25a', T1), row(2, 21, 'd50', T2)]);
    // Account 1's display character was deleted between the row read and the
    // fill: no blank entry, no throw; account 2 keeps its TRUE rank (2).
    const entries = buildDeedsBoardEntries(board, [displayChar(21, 'Berrin')]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Berrin');
    expect(entries[0].rank).toBe(2);
  });
});

describe('deedsBoardSelf', () => {
  it('returns rank and topPercent for a ranked account', () => {
    const board = ranked([
      row(1, 11, 'd50', T1),
      row(2, 21, 'd50', T2),
      row(3, 31, 'd50', T3),
      row(3, 31, 'd25a', T3),
    ]);
    // Account 3 scores 75 (rank 1); 1 and 2 tie at 50, broken by time.
    expect(deedsBoardSelf(board, 3)).toEqual({ rank: 1, topPercent: 34 });
    expect(deedsBoardSelf(board, 1)).toEqual({ rank: 2, topPercent: 67 });
    expect(deedsBoardSelf(board, 2)).toEqual({ rank: 3, topPercent: 100 });
  });

  it('returns null for an account not on the board', () => {
    const board = ranked([row(1, 11, 'd50', T1)]);
    expect(deedsBoardSelf(board, 42)).toBeNull();
  });

  it('computes topPercent against the pre-cap total', () => {
    // 1200 ranked accounts, deeper than the 1000-row page cap. The self read
    // runs over the FULL ranked list, so rank 1100 still resolves and its
    // percentile uses 1200, not the capped 1000.
    const rows: DeedsBoardSourceRow[] = [];
    for (let account = 1; account <= 1200; account++) {
      // Earlier accountIds finish earlier, so rank == accountId.
      const at = new Date(Date.parse(T1) + account * 1000);
      rows.push(row(account, account * 10, 'd50', at));
    }
    const board = ranked(rows);
    expect(board).toHaveLength(1200);
    expect(deedsBoardSelf(board, 1100)).toEqual({ rank: 1100, topPercent: 92 });
    expect(deedsBoardSelf(board, 1)).toEqual({ rank: 1, topPercent: 1 });
  });
});
