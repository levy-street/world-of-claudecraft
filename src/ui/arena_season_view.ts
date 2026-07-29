// Pure, host-agnostic view model for the Arena season banner in the Ashen
// Coliseum window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; sibling of arena_window_view.ts, which models the bracket panel
// below this banner). It answers the three things the banner decides: which
// season is live, how long is left in it, and who won the seasons that have
// already been settled.
//
// The countdown needs no server round trip: the season calendar is shared,
// deterministic code (src/sim/arena_season.ts), so the client derives the season
// number and its boundaries from its OWN clock and only fetches what it cannot
// know, the settled champions. `nowMs` is a parameter rather than a clock read
// here for the usual reason a pure core takes its inputs: it makes every
// boundary case a one-line test instead of a fake timer.
//
// DOM-free and i18n-free: the model carries deed IDS and raw numbers, never
// resolved title text and never a formatted duration; the painter localizes both
// (deed_i18n.ts for the title, the countdown unit picks its own plural key).

import {
  ARENA_SEASON_BRACKETS,
  type ArenaSeasonBracket,
  arenaSeasonWindowAt,
} from '../sim/arena_season';
import { arenaSeasonDef } from '../sim/content/arena_seasons';
import type { PlayerClass } from '../sim/types';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** One champion as GET /api/arena/seasons ships it (the fetched payload shape,
 *  mirrored here the way arena_window_view mirrors the all-time ladder rows). */
export interface ArenaSeasonChampionPayload {
  bracket: string;
  name: string;
  cls: string;
  rating: number;
}

/** One settled season as the endpoint ships it. */
export interface ArenaSeasonHistoryPayload {
  season: number;
  deedId: string;
  champions: ArenaSeasonChampionPayload[];
}

/** The GET /api/arena/seasons body. */
export interface ArenaSeasonReadoutPayload {
  season: number;
  authored: number;
  settled: ArenaSeasonHistoryPayload[];
}

/** The countdown, pre-quantized so the painter picks one plural key and prints
 *  one number. Coarse on purpose: a season is six months long, so a live
 *  seconds ticker would be noise, and it also keeps the render signature stable
 *  (the banner rebuilds when the DAY changes, not every frame). */
export interface ArenaSeasonCountdown {
  unit: 'days' | 'hours' | 'minutes';
  value: number;
}

/** One bracket's champions on a settled season (the pair travels as one row). */
export interface ArenaSeasonChampionRow {
  bracket: ArenaSeasonBracket;
  /** One name for 1v1, both members for 2v2, in the order the server ranked. */
  names: string[];
  /** The class of each name, positionally aligned; '' where unknown. */
  classes: string[];
  /** Whether each class id resolves in CLASSES (the painter localizes if so). */
  knownClasses: boolean[];
  /** The best rating on the row (the pair reports its stronger member). */
  rating: number;
}

/** One settled season on the hall-of-fame tail. */
export interface ArenaSeasonHistoryRow {
  season: number;
  /** The awarded title, as a deed id the painter localizes. */
  deedId: string;
  champions: ArenaSeasonChampionRow[];
}

export type ArenaSeasonView =
  | {
      kind: 'preseason';
      /** The title Season 1 will award, or null if the roster is empty. */
      deedId: string | null;
      countdown: ArenaSeasonCountdown;
      history: ArenaSeasonHistoryRow[];
      sig: string;
    }
  | {
      kind: 'live';
      season: number;
      /** The title on offer, or null once the calendar outruns the roster. */
      deedId: string | null;
      countdown: ArenaSeasonCountdown;
      /** 0..1 through the season; drives the progress meter width. */
      elapsedFrac: number;
      history: ArenaSeasonHistoryRow[];
      sig: string;
    };

export interface ArenaSeasonViewInput {
  /** The client clock. Presentation only: nothing here decides an award. */
  nowMs: number;
  /** The fetched readout, or null before the first response (and offline). */
  readout: ArenaSeasonReadoutPayload | null;
  /** Class ids that resolve to a localized name (CLASSES keys). */
  knownClassIds: ReadonlySet<string>;
}

/** Quantize a remaining span to the coarsest unit that still reads as nonzero. */
export function arenaSeasonCountdown(remainingMs: number): ArenaSeasonCountdown {
  const left = Math.max(0, remainingMs);
  if (left >= MS_PER_DAY) return { unit: 'days', value: Math.floor(left / MS_PER_DAY) };
  if (left >= MS_PER_HOUR) return { unit: 'hours', value: Math.floor(left / MS_PER_HOUR) };
  return { unit: 'minutes', value: Math.floor(left / MS_PER_MINUTE) };
}

/**
 * Build the season banner model. Safe against a null or malformed readout (the
 * offline world, a cold fetch, an older server): the countdown and the season
 * number come from the shared calendar, so the banner always renders something
 * true, and only the champions tail disappears.
 */
export function buildArenaSeasonView(input: ArenaSeasonViewInput): ArenaSeasonView {
  const live = arenaSeasonWindowAt(input.nowMs);
  const countdown = arenaSeasonCountdown(live.remainingMs);
  const history = buildHistoryRows(input.readout, input.knownClassIds);
  if (live.preseason) {
    const first = arenaSeasonDef(1);
    return {
      kind: 'preseason',
      deedId: first?.deedId ?? null,
      countdown,
      history,
      sig: signature(['pre', countdown.unit, countdown.value, history]),
    };
  }
  const def = arenaSeasonDef(live.index);
  return {
    kind: 'live',
    season: live.index,
    deedId: def?.deedId ?? null,
    countdown,
    // Quantized to the meter's own resolution so a per-frame clock tick cannot
    // move the render signature (the banner is rebuilt, not written per frame).
    elapsedFrac: Math.round(live.elapsedFrac * 100) / 100,
    history,
    sig: signature([
      'live',
      live.index,
      countdown.unit,
      countdown.value,
      Math.round(live.elapsedFrac * 100),
      history,
    ]),
  };
}

function signature(parts: unknown[]): string {
  return JSON.stringify(parts);
}

/** Fold the fetched payload into rows, dropping anything that does not resolve. */
function buildHistoryRows(
  readout: ArenaSeasonReadoutPayload | null,
  knownClassIds: ReadonlySet<string>,
): ArenaSeasonHistoryRow[] {
  if (!readout || !Array.isArray(readout.settled)) return [];
  const rows: ArenaSeasonHistoryRow[] = [];
  for (const entry of readout.settled) {
    const def = arenaSeasonDef(entry?.season);
    if (!def || !Array.isArray(entry.champions)) continue;
    const champions: ArenaSeasonChampionRow[] = [];
    for (const bracket of ARENA_SEASON_BRACKETS) {
      const won = entry.champions.filter((c) => c?.bracket === bracket && !!c.name);
      if (won.length === 0) continue;
      champions.push({
        bracket,
        names: won.map((c) => c.name),
        classes: won.map((c) => (typeof c.cls === 'string' ? c.cls : '')),
        knownClasses: won.map((c) => knownClassIds.has(c.cls as PlayerClass)),
        rating: won.reduce((best, c) => Math.max(best, Number(c.rating) || 0), 0),
      });
    }
    if (champions.length > 0) rows.push({ season: entry.season, deedId: def.deedId, champions });
  }
  return rows.sort((a, b) => b.season - a.season);
}
