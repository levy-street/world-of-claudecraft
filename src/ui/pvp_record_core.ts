// The one place a ranked PvP record is turned into text.
//
// Records used to render as wins-losses, which silently dropped drawn matches:
// a draw moved the ladder (Elo at score 0.5) but appeared in no figure, so a
// player with one win and one draw read "1-0" and their drawn match was simply
// gone. The record is now W-L-D, "1-0-1".
//
// A pure core rather than a fourth hyphen concatenation in the window: the same
// record is drawn in four places (the battleground summary and its ladder rows,
// the arena summary and its ladder rows), and the separator, the ordering, and
// the number formatting have to agree across all of them.
//
// Host-agnostic: no DOM, no IWorld, no clock. The i18n import is the number
// FORMATTER only, which the pure-core contract allows (see src/ui/CLAUDE.md).

import { formatNumber } from './i18n';

/** The three figures of a ranked record, in the order they are shown. */
export interface PvpRecord {
  wins: number;
  losses: number;
  /** Matches that ended level. Counted only since the W-L-D change, so a
   *  character who drew before it reads 0 rather than a wrong number. */
  draws: number;
}

/** The separator between figures. A hyphen, matching the classic-MMO record
 *  convention and the wins-losses form this replaces. */
const RECORD_SEPARATOR = '-';

const figure = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/**
 * Render a record as "W-L-D", every figure locale-formatted.
 *
 * The draws figure is ALWAYS shown, even at zero. Hiding it at zero would make
 * the same record read as two different shapes depending on its value, and a
 * bare "1-0" is exactly the ambiguity this replaces: a reader could not tell
 * whether it meant no draws or a client that predates them.
 */
export function formatPvpRecord(record: PvpRecord): string {
  return [record.wins, record.losses, record.draws].map(figure).join(RECORD_SEPARATOR);
}
