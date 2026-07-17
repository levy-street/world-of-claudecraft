import type { DeedsLeaderboardPage } from '../sim/leaderboard_page';
import type { DeedStats, PlayerClass } from '../sim/types';

// ---------------------------------------------------------------------------
// The Book of Deeds (the deeds system): the SELF player's earned deeds,
// persisted lifetime stat block, Renown total, and displayed title, plus the
// global rarity read. The four data reads mirror sim state the evaluator
// (src/sim/deeds.ts) maintains; the one command requests a title change,
// which the sim validates (the deed must be earned and carry a title reward;
// null clears; invalid input is a silent no-op). Offline the Sim exposes its
// live per-player state (the questLog precedent); online the ClientWorld
// mirrors the snapshot self keys (`deeds`/`dstats` heavy-gated,
// `renown`/`atitle` per-tick diffed) and the `deedUnlocked` event stays
// presentation-only. Other players' titles are not here: they ride the entity
// wire (`title`, a deed id) for nameplates/inspect.
// ---------------------------------------------------------------------------

/**
 * The global rarity aggregate, exactly the GET /api/deeds/rarity payload:
 * how many eligible characters exist and how many have earned each deed
 * (zero-earn deeds absent from the map). Percentages are computed by the
 * consumer. Cross-realm by design.
 */
export interface DeedsRarity {
  totalEligible: number;
  earned: Record<string, number>;
}

// One ranked row of the RENOWN board (the account-level deeds leaderboard).
// Account-scored but character-faced: the row shows the account's
// highest-Renown character, and no account identifier ever crosses this seam.
// Always computed server-side; the offline Sim ranks none (a sandbox has no
// account population). realm is always present: the board is GLOBAL-ONLY,
// because Renown counts each deed once per account and accounts span realms.
export interface DeedsLeaderboardEntry {
  rank: number;
  name: string;
  realm: string;
  cls: PlayerClass;
  level: number;
  renown: number;
  /** @deprecated Wire-compat only, removed next release (issue #2044): the
   *  board displays no deed count anymore (Renown is the one ranked number;
   *  the completion count lives in the Book of Deeds header). The server
   *  keeps populating it so a stale client's column renders real data; new
   *  clients never read it. */
  deedCount: number;
  // The display character's selected title: a deed id the client localizes
  // through deed_i18n.ts (never display text), or null when untitled.
  title: string | null;
}

// The viewer's own standing on the Renown board, present only for an
// authenticated caller who is on the board. topPercent is the ceil'd
// percentile against the FULL ranked total (not the exposed page depth).
export interface DeedsLeaderboardSelf {
  rank: number;
  topPercent: number;
  // The account's lifetime Renown as the board scored it, so the self line is
  // self-verifiable against the Book of Deeds. OPTIONAL: an older server
  // (rolling deploy, self-hosted) omits it and the client renders the
  // rank-only line.
  renown?: number;
}

export interface IWorldDeeds {
  // Deed id -> the utcDay it was earned ('YYYY-MM-DD', '' when the host set
  // no calendar), for the SELF player. Readonly across the seam: consumers
  // never mutate deed state.
  deedsEarned: ReadonlyMap<string, string>;
  // The persisted lifetime counter block (counters, discovery + visit sets,
  // per-dungeon clears) backing progress readouts.
  deedStats: Readonly<DeedStats>;
  // The self player's current Renown total, exactly the denormalized sum the
  // evaluator maintains.
  renown: number;
  // The selected display title: a deed id (never display text), null when
  // untitled.
  activeTitle: string | null;
  // Request a title change (null clears). No optimistic local write online:
  // the mirror updates from the snapshot echo once the sim accepts.
  setActiveTitle(deedId: string | null): void;
  // The global rarity aggregate, or null where the host has none: the offline
  // Sim always resolves null (a sandbox has no population), the online
  // ClientWorld fetches GET /api/deeds/rarity and resolves null on any fetch
  // failure. The payload is the endpoint body verbatim (DeedsRarity above);
  // consumers cache per window-open, so this may re-fetch on each call.
  deedsRarity(): Promise<DeedsRarity | null>;
  // The Renown board (the account-level deeds leaderboard), paged server-side
  // like the other high-score boards; page is 0-based. GLOBAL-ONLY (see
  // DeedsLeaderboardEntry). The offline Sim resolves an empty page; the online
  // ClientWorld fetches GET /api/leaderboard?board=deeds with its bearer so
  // the self row rides the page for a ranked caller, and resolves the empty
  // page on any fetch failure.
  deedsLeaderboard(page?: number, pageSize?: number): Promise<DeedsLeaderboardPage>;
}
