// Pure view-core for the Social window's Who tab: the local sort + class
// filter over the server-delivered roster (IWorldSocialGraph.whoInfo), the
// count line's numbers, and the `/who [filter]` chat-command parse. DOM-free
// and host-agnostic (registered in UI_PURE_CORES); social_window.ts is the
// thin painter.
//
// Division of labour with the server: the substring FILTER (name / zone /
// guild) is server-side, because it decides which rows fit under the frame
// cap; everything that only re-arranges the delivered rows (sort column and
// direction, the class chip) is local, so it costs no round-trip and never
// waits on the chat lane.

import type { WhoRosterEntry, WhoRosterInfo } from '../world_api';
import { socialDot } from './social_view';

export type WhoSortKey = 'name' | 'level' | 'cls' | 'zone' | 'guild';

export const WHO_SORT_KEYS: readonly WhoSortKey[] = ['name', 'level', 'cls', 'zone', 'guild'];

export interface WhoTabState {
  /** The last server-side filter the tab asked for ('' = everyone). */
  search: string;
  /** Local class chip: a class id, or '' for every class. */
  cls: string;
  sort: WhoSortKey;
  desc: boolean;
}

export const DEFAULT_WHO_TAB_STATE: Readonly<WhoTabState> = Object.freeze({
  search: '',
  cls: '',
  sort: 'name',
  desc: false,
});

/** Column click: the same column flips direction, a new column starts ascending
 *  (level starts DESCENDING, the classic "who is the highest level" read). */
export function toggleWhoSort(state: WhoTabState, key: WhoSortKey): WhoTabState {
  if (state.sort === key) return { ...state, desc: !state.desc };
  return { ...state, sort: key, desc: key === 'level' };
}

export interface WhoTabRow extends WhoRosterEntry {
  /** Status dot kind: 'online' | 'combat' | 'dungeon' | 'dead' | 'afk' (never 'off': everyone here is online). */
  dot: string;
  /** The viewer's own row (no whisper button). */
  self: boolean;
}

/** Display labels the sort compares by, so a sort matches what the player reads
 *  (a localized zone or class name, not the raw id). Identity by default. */
export interface WhoLabels {
  cls(cls: string): string;
  zone(zone: string): string;
}

const IDENTITY_LABELS: WhoLabels = { cls: (c) => c, zone: (z) => z };

function compareRows(a: WhoTabRow, b: WhoTabRow, key: WhoSortKey, labels: WhoLabels): number {
  switch (key) {
    case 'level':
      return a.level - b.level;
    case 'cls':
      return labels.cls(a.cls).localeCompare(labels.cls(b.cls));
    case 'zone':
      return labels.zone(a.zone).localeCompare(labels.zone(b.zone));
    case 'guild':
      // Unguilded rows sink to the end of an ascending guild sort.
      if (a.guild === '' || b.guild === '')
        return (a.guild === '' ? 1 : 0) - (b.guild === '' ? 1 : 0);
      return a.guild.localeCompare(b.guild);
    default:
      return a.name.localeCompare(b.name);
  }
}

/** The rows to paint: the delivered roster narrowed by the class chip and
 *  ordered by the sort column (name as the stable tie-break). */
export function whoTabRows(
  info: WhoRosterInfo | null,
  state: WhoTabState,
  selfName: string,
  labels: WhoLabels = IDENTITY_LABELS,
): WhoTabRow[] {
  if (!info) return [];
  const rows: WhoTabRow[] = [];
  for (const r of info.rows) {
    if (state.cls && r.cls !== state.cls) continue;
    rows.push({ ...r, dot: socialDot(true, r.status), self: r.name === selfName });
  }
  const dir = state.desc ? -1 : 1;
  rows.sort((a, b) => {
    const c = compareRows(a, b, state.sort, labels);
    return c !== 0 ? c * dir : a.name.localeCompare(b.name);
  });
  return rows;
}

/** The class chip's options: every class present in the delivered roster, in
 *  label order, so the chip never offers a class with zero rows. */
export function whoClassOptions(
  info: WhoRosterInfo | null,
  labels: WhoLabels = IDENTITY_LABELS,
): string[] {
  if (!info) return [];
  const seen = new Set<string>();
  for (const r of info.rows) seen.add(r.cls);
  return [...seen].sort((a, b) => labels.cls(a).localeCompare(labels.cls(b)));
}

export interface WhoCountView {
  /** Rows on screen after the local class chip. */
  shown: number;
  /** Rows the server delivered (the frame slice). */
  delivered: number;
  /** Uncapped server-side matches. */
  total: number;
  /** The server cut the answer at its cap: a narrower search would reveal more. */
  capped: boolean;
}

export function whoCountView(info: WhoRosterInfo | null, shown: number): WhoCountView {
  if (!info) return { shown: 0, delivered: 0, total: 0, capped: false };
  return {
    shown,
    delivered: info.rows.length,
    total: info.total,
    capped: info.total > info.rows.length,
  };
}

/** Parse a typed chat line as the classic `/who [filter]` command. Returns the
 *  (trimmed) filter, '' for a bare `/who`, or null when the line is anything
 *  else, so the caller can route it to the Who tab instead of the chat dump. */
export function parseWhoCommand(raw: string): string | null {
  const m = /^\/who(?:\s+(.*))?$/i.exec(raw.trim());
  if (!m) return null;
  return (m[1] ?? '').trim();
}

/** The part of the tab's local state that changes what is painted. */
export function whoTabSig(state: WhoTabState): string {
  return `${state.search}|${state.cls}|${state.sort}|${state.desc ? 'd' : 'a'}`;
}
