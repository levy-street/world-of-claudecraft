// Pure view core for the top-three podium each leaderboard tab stands on its
// first page.
//
// It splits one resolved page into the podium (ranks 1 to 3, first page only)
// and the rows listed under it, and fixes the podium's own rules in one place:
// the slots come in place order 1, 2, 3 (the stylesheet stands them silver
// left, gold centre, bronze right, so a screen reader still reads first place
// first), the disc is ALWAYS the medal of the place and never anything a row
// earned (the stylesheet maps .lbp-slot-1/2/3 to the gold, silver and bronze
// art), and an unheld place still stands as an empty plinth. It also decides
// the viewer's standing bar for the boards whose page can answer it without a
// server round trip. DOM-free; leaderboard_podium_html.ts paints the slots.
import { formatNumber } from './i18n';

export type PodiumPlace = 1 | 2 | 3;
export type PodiumMedal = 'gold' | 'silver' | 'bronze';

/** Reading and DOM order: first place first. */
export const PODIUM_PLACE_ORDER: readonly PodiumPlace[] = [1, 2, 3];

/** The medal each place's disc shows (the stylesheet carries the art path). */
export const PODIUM_PLACE_MEDAL: Readonly<Record<PodiumPlace, PodiumMedal>> = {
  1: 'gold',
  2: 'silver',
  3: 'bronze',
};

export interface PodiumSlot<T> {
  place: PodiumPlace;
  rankText: string;
  /** The row holding the place, or null for an unclaimed plinth. */
  entry: T | null;
}

export interface PodiumSplit<T> {
  /** Place order 1, 2, 3; empty off the first page or on an empty page. */
  podium: PodiumSlot<T>[];
  /** The rows under the podium: rank 4 on the first page, every row after. */
  listed: T[];
}

/**
 * Split one page into its podium and the rows listed beneath it. Every board
 * ranks its page server-side by position (row_number or index plus one), so a
 * place matches at most one row; a duplicate rank would be dropped here, never
 * listed twice.
 */
export function podiumSplit<T>(
  pageIndex: number,
  entries: readonly T[],
  rankOf: (entry: T) => number,
): PodiumSplit<T> {
  if (pageIndex !== 0 || entries.length === 0) return { podium: [], listed: [...entries] };
  const podium = PODIUM_PLACE_ORDER.map((place) => ({
    place,
    rankText: formatNumber(place, { maximumFractionDigits: 0 }),
    entry: entries.find((entry) => rankOf(entry) === place) ?? null,
  }));
  return { podium, listed: entries.filter((entry) => rankOf(entry) > 3) };
}

/** The viewer's own row on the loaded page (a `me`-flagged board), or null. */
export function viewerRowOnPage<T extends { me: boolean }>(rows: readonly T[]): T | null {
  return rows.find((row) => row.me) ?? null;
}

/** The players board's standing bar: the viewer's ranked row when it is on
 *  the page, else the off-page standing the core already derived (no rank),
 *  else nothing. */
export function playersStandingBar<S extends object>(
  rows: readonly (S & { me: boolean; rank: number })[],
  offPage: S | null,
): (S & { rank: number | null }) | null {
  const mine = viewerRowOnPage(rows);
  if (mine) return mine;
  return offPage ? { ...offPage, rank: null } : null;
}

/** The guilds board's standing bar: the viewer's own guild when it is ranked
 *  on this page; guilds carry no server-side self line, so otherwise none. */
export function guildStandingRow<G extends { name: string }>(
  rows: readonly G[],
  viewerGuild: string | null | undefined,
): G | null {
  if (!viewerGuild) return null;
  return rows.find((row) => row.name === viewerGuild) ?? null;
}

/** Whether a ranked guild is the viewer's own (the same exact-name match the
 *  standing bar uses), so its podium card carries the viewer highlight too. */
export function isViewerGuild(name: string, viewerGuild: string | null | undefined): boolean {
  return !!viewerGuild && name === viewerGuild;
}
