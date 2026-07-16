// The Renown board's pure scoring core: aggregates character_deeds rows into
// the account-level lifetime Renown ranking.
//
// Host-agnostic by design (no db import, no I/O): computeDeedsBoard is the
// EXECUTABLE SPEC for the scoring, mirrored 1:1 by the SQL roll-up
// deedsBoardRanked (db.ts) that production runs at scale; src/sim/content/deeds.ts
// supplies the Renown values, and the main.ts cache calls deedsBoardSelf over the
// ranked list. Points are NEVER stored in SQL; the content table is the single
// source of truth for Renown, so a rebalance needs no migration and the score can
// only move when content or earns move.
//
// The aggregation trusts character_deeds.account_id as the owner of every row.
// Character transfer between accounts does not exist today; a future transfer
// feature must update or re-derive that column (see the character_deeds DDL
// note in db.ts) or this roll-up double-credits the old account.

import type { DeedDef, PlayerClass } from '../src/sim/types';
import type { DeedsLeaderboardEntry, DeedsLeaderboardSelf } from '../src/world_api';

// Accounts scoring below this never board: one notable deed (or a handful of
// routine ones) is the cheapest legitimate entry, and the floor keeps
// throwaway-account noise off the board entirely.
export const DEEDS_BOARD_ENTRY_FLOOR = 50;

/** One character_deeds row, the computeDeedsBoard scoring input. */
export interface DeedsBoardSourceRow {
  accountId: number;
  characterId: number;
  deedId: string;
  // pg hands TIMESTAMPTZ back as a Date; string tolerated for fixtures and
  // driver config drift (the deeds_records observer already met both).
  earnedAt: Date | string;
}

/** One ranked account. accountId is INTERNAL (the self-rank key); the public
 *  response entry is built from the display character and never carries it. */
export interface RankedDeedsAccount {
  accountId: number;
  /** Sum of renown over the counted set (distinct renown-bearing deed ids). */
  renown: number;
  /** Size of the counted set. Zero-renown deeds (feats, luck, dynamic metas)
   *  are outside the counted set, so they appear in neither score nor count. */
  deedCount: number;
  /** When the account's current score was reached: max over the counted set of
   *  each deed's EARLIEST earn (a re-earn on a second character adds no score,
   *  so it cannot move this either). Epoch ms. */
  completionTime: number;
  /** The account's face on the board: its highest-Renown character (the same
   *  counted-set rule over that character's own rows), ties to the lowest id. */
  displayCharacterId: number;
}

export interface DeedsBoardResult {
  /** Ordered ranking, floor applied. Rank of ranked[i] is i + 1. */
  ranked: RankedDeedsAccount[];
  /** ranked.length, the PRE-CAP total the percentile read uses. */
  totalRanked: number;
  /** Distinct deed ids seen in rows but absent from the content table (removed
   *  or renamed content). Skipped, never a throw; sorted for stable logging. */
  unknownDeedIds: string[];
}

// The self row the route serves an authenticated caller who is on the board:
// the wire shape (src/world_api DeedsLeaderboardSelf), re-exported so the
// server side has one import site. topPercent is ceil(rank / totalRanked *
// 100) against the FULL ranked list (never the LEADERBOARD_MAX page cap):
// rank 1 of 200 reads "top 1 percent".
export type DeedsBoardSelf = DeedsLeaderboardSelf;

function earnedMs(earnedAt: Date | string): number {
  const ms = typeof earnedAt === 'string' ? Date.parse(earnedAt) : earnedAt.getTime();
  // An unparseable stamp sorts as the epoch rather than poisoning the max().
  return Number.isFinite(ms) ? ms : 0;
}

interface AccountAgg {
  /** Counted set: deed id -> the account's earliest earn of it (epoch ms). */
  deedFirstEarn: Map<string, number>;
  /** Per character: its OWN counted set, for the display-character pick. */
  charDeeds: Map<number, Set<string>>;
}

/**
 * Aggregate character_deeds rows into the ordered account ranking.
 *
 * Per account, the COUNTED SET is the distinct deed ids with renown > 0: a
 * deed earned by two characters of one account counts once (never SUM raw
 * rows), and zero-renown deeds can neither score nor perturb the tie-break.
 * Ordering keys, in sequence: score descending; completionTime ascending
 * (score-then-earliest); accountId ascending as the final deterministic key.
 */
export function computeDeedsBoard(
  rows: readonly DeedsBoardSourceRow[],
  deeds: Record<string, DeedDef>,
): DeedsBoardResult {
  const unknown = new Set<string>();
  const accounts = new Map<number, AccountAgg>();

  for (const row of rows) {
    const def = deeds[row.deedId];
    if (!def) {
      unknown.add(row.deedId);
      continue;
    }
    if (def.renown <= 0) continue;
    let agg = accounts.get(row.accountId);
    if (!agg) {
      agg = { deedFirstEarn: new Map(), charDeeds: new Map() };
      accounts.set(row.accountId, agg);
    }
    const ms = earnedMs(row.earnedAt);
    const first = agg.deedFirstEarn.get(row.deedId);
    if (first === undefined || ms < first) agg.deedFirstEarn.set(row.deedId, ms);
    let charSet = agg.charDeeds.get(row.characterId);
    if (!charSet) {
      charSet = new Set();
      agg.charDeeds.set(row.characterId, charSet);
    }
    charSet.add(row.deedId);
  }

  const ranked: RankedDeedsAccount[] = [];
  for (const [accountId, agg] of accounts) {
    let renown = 0;
    let completionTime = 0;
    for (const [deedId, firstMs] of agg.deedFirstEarn) {
      renown += deeds[deedId]?.renown ?? 0;
      if (firstMs > completionTime) completionTime = firstMs;
    }
    if (renown < DEEDS_BOARD_ENTRY_FLOOR) continue;
    let displayCharacterId = 0;
    let displayRenown = -1;
    for (const [characterId, deedIds] of agg.charDeeds) {
      let charRenown = 0;
      for (const deedId of deedIds) charRenown += deeds[deedId]?.renown ?? 0;
      if (
        charRenown > displayRenown ||
        (charRenown === displayRenown && characterId < displayCharacterId)
      ) {
        displayRenown = charRenown;
        displayCharacterId = characterId;
      }
    }
    ranked.push({
      accountId,
      renown,
      deedCount: agg.deedFirstEarn.size,
      completionTime,
      displayCharacterId,
    });
  }

  ranked.sort(
    (a, b) =>
      b.renown - a.renown || a.completionTime - b.completionTime || a.accountId - b.accountId,
  );
  return { ranked, totalRanked: ranked.length, unknownDeedIds: [...unknown].sort() };
}

/** The display-character fields the entry fill needs (db.ts's
 *  DeedsBoardCharacterRow satisfies this structurally; declared here so the
 *  module keeps its no-db-import contract). */
export interface DeedsBoardDisplayCharacter {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  realm: string;
  activeTitle: string | null;
}

/**
 * Face the ranking with its display characters: the PUBLIC entry list (never
 * an account id). A ranked account whose display character is missing from
 * `characters` (deleted between the row read and the fill; its rows cascade
 * away by the next refresh) is SKIPPED rather than minted as a blank entry;
 * the account keeps its rank, so ranks can transiently show a gap and the
 * self read stays truthful.
 */
export function buildDeedsBoardEntries(
  ranked: readonly RankedDeedsAccount[],
  characters: readonly DeedsBoardDisplayCharacter[],
): DeedsLeaderboardEntry[] {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const entries: DeedsLeaderboardEntry[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const account = ranked[i];
    const display = byId.get(account.displayCharacterId);
    if (!display) continue;
    entries.push({
      rank: i + 1,
      name: display.name,
      realm: display.realm,
      cls: display.class,
      level: display.level,
      renown: account.renown,
      deedCount: account.deedCount,
      title: display.activeTitle,
    });
  }
  return entries;
}

/**
 * The self row for an authenticated caller: their rank in the FULL ranked list
 * (pre-cap, so a rank past the exposed page depth still resolves) and the
 * ceil'd percentile. Null when the account is not on the board (below the
 * floor, delisted, or unranked).
 */
export function deedsBoardSelf(
  ranked: readonly RankedDeedsAccount[],
  accountId: number,
): DeedsBoardSelf | null {
  const index = ranked.findIndex((a) => a.accountId === accountId);
  if (index === -1) return null;
  const rank = index + 1;
  return { rank, topPercent: Math.ceil((rank / ranked.length) * 100) };
}
