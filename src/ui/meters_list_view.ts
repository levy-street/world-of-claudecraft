// Pure core for what a meter panel actually paints, line by line: the member
// bars from meters_rows_view, each optionally followed by its own contribution
// rows from meters_breakdown_view.
//
// Why this exists: a controlled pet is not a bar of its own (its output folds
// into its owner, the way a real damage meter reports a hunter), so with the
// split living ONLY in the hover tooltip a solo warlock/hunter/mage saw a single
// bar with their own name on it and no sign of the pet at all. Folding the
// breakdown into the panel itself puts the pet back where it can be read
// without hovering, as the spell rows it actually is ("Emberkin: Firebolt").
//
// DOM-free and i18n-free like its two inputs: it decides WHICH lines exist and
// in what order, and the painter localizes the labels and formats the numbers.

import {
  type BreakdownEntry,
  type BreakdownRow,
  buildMeterBreakdown,
} from './meters_breakdown_view';
import type { MeterRow } from './meters_rows_view';

/** One member's bar, plus the raw contributions behind it. */
export interface MeterListMember {
  row: MeterRow;
  /** abilities on the damage/healing tabs, contributors on the threat tab */
  entries: readonly BreakdownEntry[];
  /** whether the player has this member's split open */
  expanded: boolean;
}

export interface MeterMemberLine {
  kind: 'member';
  row: MeterRow;
  /** true when the split says something the bar does not (more than one row) */
  expandable: boolean;
  /** true only when it is both expandable and open */
  expanded: boolean;
}

export interface MeterAbilityLine {
  kind: 'ability';
  /** the member whose bar this line belongs under */
  ownerPid: number;
  row: BreakdownRow;
}

export type MeterListLine = MeterMemberLine | MeterAbilityLine;

/**
 * Flatten ranked member rows into the panel's paint list. A member's split is
 * emitted directly under their bar, and only when the player has it open AND it
 * carries more than one row: a single-row split is the bar restated, so opening
 * it would add a line and no information.
 */
export function buildMeterList(
  members: readonly MeterListMember[],
  durationSeconds: number,
  rowCap?: number,
): MeterListLine[] {
  const lines: MeterListLine[] = [];
  for (const member of members) {
    const split = buildMeterBreakdown(member.entries, durationSeconds, rowCap).rows;
    const expandable = split.length > 1;
    const expanded = expandable && member.expanded;
    lines.push({ kind: 'member', row: member.row, expandable, expanded });
    if (!expanded) continue;
    for (const row of split) {
      lines.push({ kind: 'ability', ownerPid: member.row.tally.pid, row });
    }
  }
  return lines;
}
