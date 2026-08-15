import type { LivePlayer } from './types';

// Pure view model for the Online players page. The `/admin/api/online` endpoint
// returns the whole live roster in one shot (bounded by the realm player cap), so
// search, sort and paging all resolve client-side here instead of round-tripping.
// Class and zone sort/search on their RENDERED labels, which the caller injects so
// this module stays free of i18n and DOM.

export type OnlineSortColumn =
  | 'name'
  | 'class'
  | 'level'
  | 'zone'
  | 'hp'
  | 'session'
  | 'lastSave'
  | 'account';

export type OnlineSortDirection = 'asc' | 'desc';

export const ONLINE_PLAYERS_PAGE_SIZE = 25;

export interface OnlinePlayersLabels {
  class: (id: string) => string;
  zone: (id: string) => string;
}

export interface OnlinePlayersViewOptions {
  query?: string;
  sort?: OnlineSortColumn;
  dir?: OnlineSortDirection;
  page?: number;
  limit?: number;
  locale?: string;
  labels?: Partial<OnlinePlayersLabels>;
}

export interface OnlinePlayersView {
  /** The rows of the requested page, filtered and sorted. */
  rows: LivePlayer[];
  /** Rows matching the query, across every page. */
  total: number;
  /** The requested page clamped into range, so a shrinking roster never blanks out. */
  page: number;
  limit: number;
}

function normalize(value: string, locale?: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase(locale)
    .trim();
}

function labelsOf(options: OnlinePlayersViewOptions): OnlinePlayersLabels {
  return {
    class: options.labels?.class ?? ((id) => id),
    zone: options.labels?.zone ?? ((id) => id),
  };
}

function searchableFields(
  player: LivePlayer,
  labels: OnlinePlayersLabels,
): (string | number | null | undefined)[] {
  return [
    player.name,
    labels.class(player.class),
    labels.zone(player.zone),
    player.location?.instance,
    player.accountId,
    player.characterId,
    player.level,
  ];
}

export function matchesOnlineQuery(
  player: LivePlayer,
  query: string,
  options: OnlinePlayersViewOptions = {},
): boolean {
  const needle = normalize(query, options.locale);
  if (needle === '') return true;
  const labels = labelsOf(options);
  return searchableFields(player, labels).some(
    (field) =>
      field !== null &&
      field !== undefined &&
      normalize(String(field), options.locale).includes(needle),
  );
}

// A fraction, not raw HP: the column reads "hp/maxHp", so ordering by how hurt a
// player is beats ordering by an absolute value that means nothing across levels.
function healthFraction(player: LivePlayer): number {
  return player.maxHp > 0 ? player.hp / player.maxHp : 0;
}

function compareOn(
  column: OnlineSortColumn,
  a: LivePlayer,
  b: LivePlayer,
  labels: OnlinePlayersLabels,
  locale?: string,
): number {
  const text = (left: string, right: string) =>
    left.localeCompare(right, locale, { sensitivity: 'base', numeric: true });
  switch (column) {
    case 'name':
      return text(a.name, b.name);
    case 'class':
      return text(labels.class(a.class), labels.class(b.class));
    case 'zone':
      return text(labels.zone(a.zone), labels.zone(b.zone));
    case 'level':
      return a.level - b.level;
    case 'hp':
      return healthFraction(a) - healthFraction(b);
    case 'session':
      return a.sessionSeconds - b.sessionSeconds;
    case 'lastSave':
      return a.lastSaveSecondsAgo - b.lastSaveSecondsAgo;
    case 'account':
      return a.accountId - b.accountId;
  }
}

export function buildOnlinePlayersView(
  players: LivePlayer[],
  options: OnlinePlayersViewOptions = {},
): OnlinePlayersView {
  const labels = labelsOf(options);
  const sort = options.sort ?? 'name';
  const multiplier = (options.dir ?? 'asc') === 'asc' ? 1 : -1;
  const limit = Math.max(1, options.limit ?? ONLINE_PLAYERS_PAGE_SIZE);

  const filtered = players.filter((player) =>
    matchesOnlineQuery(player, options.query ?? '', options),
  );
  // pid tie-breaks so equal rows keep a stable order across refreshes.
  const sorted = [...filtered].sort(
    (a, b) => compareOn(sort, a, b, labels, options.locale) * multiplier || a.pid - b.pid,
  );

  const pages = Math.max(1, Math.ceil(sorted.length / limit));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pages);
  const start = (page - 1) * limit;
  return { rows: sorted.slice(start, start + limit), total: sorted.length, page, limit };
}
