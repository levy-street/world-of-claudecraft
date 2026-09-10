// Guild board categories: the opt-in tags a guild can wear on the signpost
// guild board (docs/prd/guild-pledge-board.md, "New player friendly"), and the
// one filter rule every host applies to the ranked entries. Host-agnostic on
// purpose: the server filters its cached board through filterGuildBoardEntries
// before paging, the online client names the same category on the wire, and
// the offline Sim (which ranks no guilds) reads the same vocabulary, so the
// three hosts can never disagree on what a category means.
//
// The vocabulary is a CLOSED, append-only table. Adding a category (PvP,
// endgame raiding, ...) is a new row here plus its guild-side opt-in and its
// wire field; the filter and the query parameter need no change.

/** Every category a guild can opt into, in display order. */
export const GUILD_BOARD_CATEGORIES = ['newPlayerFriendly'] as const;

export type GuildBoardCategory = (typeof GUILD_BOARD_CATEGORIES)[number];

/** The ?category= query key on GET /api/leaderboard?board=guilds (server and
 *  client share the literal, so the two can never drift). */
export const GUILD_BOARD_CATEGORY_PARAM = 'category';

/** The per-guild opt-in flags a board entry carries; absent means opted out
 *  (a pre-category server never sends them). */
export interface GuildBoardCategoryFlags {
  newPlayerFriendly?: boolean;
}

/** Which entry flag each category reads. Typed against the vocabulary, so a
 *  category added to GUILD_BOARD_CATEGORIES without a row here fails tsc
 *  rather than silently matching nothing (or the wrong flag). */
const CATEGORY_FLAG: Record<GuildBoardCategory, keyof GuildBoardCategoryFlags> = {
  newPlayerFriendly: 'newPlayerFriendly',
};

/** Narrow an untrusted query value to a known category; anything else (absent,
 *  empty, unknown, an array) is null, the unfiltered board. */
export function parseGuildBoardCategory(raw: unknown): GuildBoardCategory | null {
  if (typeof raw !== 'string') return null;
  return (GUILD_BOARD_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as GuildBoardCategory)
    : null;
}

/** Whether one board entry wears the category; a null category matches all. */
export function guildMatchesCategory(
  entry: GuildBoardCategoryFlags,
  category: GuildBoardCategory | null,
): boolean {
  if (category === null) return true;
  const flag = CATEGORY_FLAG[category];
  return flag !== undefined && entry[flag] === true;
}

/**
 * The category filter over an already-ranked entry list. Entries keep their
 * REALM rank on purpose: a filtered board still says where each guild stands
 * among every guild, which is the honest reading of a board titled by XP.
 * Returns the input list itself when no category applies, so the unfiltered
 * path allocates nothing.
 */
export function filterGuildBoardEntries<T extends GuildBoardCategoryFlags>(
  entries: readonly T[],
  category: GuildBoardCategory | null,
): readonly T[] {
  if (category === null) return entries;
  return entries.filter((entry) => guildMatchesCategory(entry, category));
}
