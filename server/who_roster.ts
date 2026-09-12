// The /who roster's pure core: the per-viewer visibility rule, the filter, the
// caps, and both projections (the chat-log lines the legacy `/who` command
// prints and the structured `who` frame the Social window's Who tab renders).
// It is host-free (no sim, no sessions, no sockets): game.ts gathers the live
// rows from its session map and hands them here, so the roster behaviour is
// unit-testable without standing up a GameServer, and the coordinator stays a
// thin consumer rather than growing another formatting block.
//
// Two caps, deliberately: the chat projection keeps its classic 50-line list
// (a longer chat dump is unreadable, and the row format below is re-localized
// client-side by a regex that must stay byte-identical), while the Who tab
// carries WHO_TAB_LIMIT rows because a scrollable, sortable, searchable table
// stays useful at realm scale where a chat dump does not. Both projections
// report the TRUE total so the player knows when a filter would help.

import type { PresenceStatus } from '../src/world_api/social_graph';

/** One visible player on the realm, as the Who tab and the chat list see it. */
export interface WhoRosterRow {
  name: string;
  cls: string;
  level: number;
  zone: string;
  status: PresenceStatus;
  /** The guild name, or '' when unguilded (the entity's nameplate guild). */
  guild: string;
}

/** The chat `/who` projection's row cap (classic-era chat dump). */
export const WHO_CHAT_LIMIT = 50;
/** The Social window Who tab's row cap: a whole small realm, or a filtered slice of a large one. */
export const WHO_TAB_LIMIT = 200;
/** Longest filter the server honours (echoed back verbatim, so it stays a clean single line). */
export const WHO_FILTER_MAX = 32;

/** The wire frame the Who tab mirrors (`ClientWorld.whoInfo`). `rows` is capped at
 *  `limit`; `total` is the uncapped match count so the tab can say "showing N of M". */
export interface WhoFrame {
  t: 'who';
  filter: string;
  rows: WhoRosterRow[];
  total: number;
  limit: number;
}

/** The minimal session view the visibility rule needs. */
export interface WhoVisibilitySession {
  characterId: number;
  blockListLoaded: boolean;
  blockedIds: ReadonlySet<number>;
}

/** May `viewer` see `candidate` in /who? Fail closed while the candidate's block
 *  list is still loading (showing them before we know their blocks could leak
 *  presence to someone they've blocked); otherwise a block hides in BOTH
 *  directions, the same rule the social snapshot applies to presence. */
export function canShowInWho(
  viewer: WhoVisibilitySession,
  candidate: WhoVisibilitySession,
): boolean {
  if (!candidate.blockListLoaded) return false;
  if (viewer.blockedIds.has(candidate.characterId)) return false;
  if (candidate.characterId !== viewer.characterId && candidate.blockedIds.has(viewer.characterId))
    return false;
  return true;
}

/** Sanitize a player-typed filter: strip control chars and double quotes (the
 *  chat header quotes the echo), collapse whitespace (zone names carry spaces,
 *  so keep single spaces), and cap the length. '' means "no filter". */
export function normalizeWhoFilter(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Bound the work before the regex passes: a 16 KiB frame must not buy two
  // full-length scans for a filter that keeps 32 characters.
  return raw
    .slice(0, WHO_FILTER_MAX * 4)
    .replace(/[\p{Cc}"]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, WHO_FILTER_MAX);
}

/** Case-insensitive substring match on name, zone, or guild (the input itself
 *  when there is no filter: every caller only reads). */
export function filterWhoRows(
  rows: readonly WhoRosterRow[],
  filter: string,
): readonly WhoRosterRow[] {
  if (!filter) return rows;
  const q = filter.toLowerCase();
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      row.zone.toLowerCase().includes(q) ||
      row.guild.toLowerCase().includes(q),
  );
}

/** One entry of the realm-wide roster memo: the row plus a LIVE handle to the
 *  candidate's session, so the per-viewer visibility rule reads the current
 *  block list (initSocial REPLACES `blockedIds`, so a copied Set would serve
 *  pre-block visibility). Built once per sim tick for every viewer
 *  (server/realm_readout_memo.ts), then filtered per viewer in O(N). */
export interface WhoRosterEntry<S extends WhoVisibilitySession = WhoVisibilitySession> {
  session: S;
  row: WhoRosterRow;
}

/** Build the memo's entries: one per session the host can describe (a session
 *  with no live entity yet yields null and is skipped), in name order. The host
 *  runs this at most once per sim tick (server/realm_readout_memo.ts). */
export function buildWhoRosterEntries<S extends WhoVisibilitySession>(
  sessions: Iterable<S>,
  describe: (session: S) => WhoRosterRow | null,
): WhoRosterEntry<S>[] {
  const entries: WhoRosterEntry<S>[] = [];
  for (const session of sessions) {
    const row = describe(session);
    if (row) entries.push({ session, row });
  }
  entries.sort((a, b) => a.row.name.localeCompare(b.row.name));
  return entries;
}

/** The rows `viewer` may see, in the memo's name order. */
export function visibleWhoRows<S extends WhoVisibilitySession>(
  entries: readonly WhoRosterEntry<S>[],
  viewer: WhoVisibilitySession,
): WhoRosterRow[] {
  const rows: WhoRosterRow[] = [];
  for (const e of entries) if (canShowInWho(viewer, e.session)) rows.push(e.row);
  return rows;
}

/** The Who tab's frame: filtered, capped at WHO_TAB_LIMIT, with the true total. */
export function whoFrame(rows: readonly WhoRosterRow[], filter: string): WhoFrame {
  const matched = filterWhoRows(rows, filter);
  return {
    t: 'who',
    filter,
    rows: matched.slice(0, WHO_TAB_LIMIT),
    total: matched.length,
    limit: WHO_TAB_LIMIT,
  };
}

/** One chat log line as the `events` frame carries it. */
export interface WhoChatLine {
  type: 'log';
  text: string;
  color: string;
}

// The chat palette these lines have always used. Kept as named constants here
// (not in game.ts) so the projection is a pure table.
const WHO_HEADER_COLOR = '#7fd4ff';
const WHO_ROW_COLOR = '#c9b27a';
const WHO_MORE_COLOR = '#998d6a';

/** The legacy chat `/who` projection. Every string here is matched by the client's
 *  server_i18n rules (`Who: N players ...`, `NAME - level L CLS - ZONE (status)`,
 *  `...and N more.`): keep them byte-identical when touching this. */
export function whoChatLines(
  rows: readonly WhoRosterRow[],
  filter: string,
  realm: string,
): WhoChatLine[] {
  const matched = filterWhoRows(rows, filter);
  const total = matched.length;
  const header = filter
    ? `Who: ${total} ${total === 1 ? 'player' : 'players'} matching "${filter}" on ${realm}.`
    : `Who: ${total} ${total === 1 ? 'player' : 'players'} online on ${realm}.`;
  const list: WhoChatLine[] = [{ type: 'log', text: header, color: WHO_HEADER_COLOR }];
  for (const row of matched.slice(0, WHO_CHAT_LIMIT)) {
    const status = row.status === 'online' ? '' : ` (${row.status})`;
    list.push({
      type: 'log',
      text: `${row.name} - level ${row.level} ${row.cls} - ${row.zone}${status}`,
      color: WHO_ROW_COLOR,
    });
  }
  if (total > WHO_CHAT_LIMIT) {
    list.push({
      type: 'log',
      text: `...and ${total - WHO_CHAT_LIMIT} more.`,
      color: WHO_MORE_COLOR,
    });
  }
  return list;
}
