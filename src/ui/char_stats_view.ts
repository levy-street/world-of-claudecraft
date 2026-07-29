// Pure, host-agnostic view model for the character sheet's STAT block.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions). Scope is narrow and declarative: the partition of the 16
// character-sheet stats into the showcase layout's three groups (five primary
// TILES, an Offense panel, a Defense panel) plus each panel's heading key. The
// painter (char_window.ts) lays the groups out and resolves the per-stat cell
// HTML through the separate stat_tooltip_view core; this module only decides
// which stat goes in which group and in what order.
//
// DOM-free, Three-free, and i18n-free: panel headings are emitted as stable
// catalog KEY strings (the painter casts them to TranslationKey and resolves via
// t()), never localized text, so tests/char_stats_view.test.ts can pin the
// partition without binding the i18n runtime. No RNG or wall-clock call.

import type { StatId } from './stat_tooltip';

// The canonical set of character-sheet stats, in the classic grid order. This is
// the source of truth the partition below must cover exactly (guarded by
// tests/char_stats_view.test.ts): every id here lands in exactly one group.
export const STAT_GRID: readonly StatId[] = [
  'str',
  'armor',
  'agi',
  'attackPower',
  'sta',
  'dps',
  'int',
  'critChance',
  'spi',
  'dodge',
  'parry',
  'spellPower',
  'critRating',
  'hasteRating',
  'hitRating',
  'warfare',
];

// The five primary attributes, rendered as large-numeral tiles across one row.
export const STAT_TILES: readonly StatId[] = ['str', 'agi', 'sta', 'int', 'spi'];

// Offense: attack/spell power, the dps estimate, and the offensive ratings.
export const STAT_OFFENSE: readonly StatId[] = [
  'attackPower',
  'dps',
  'critChance',
  'spellPower',
  'critRating',
  'hasteRating',
  'hitRating',
];

// Defense: mitigation and avoidance, plus the Warfare (PvP) summary line.
export const STAT_DEFENSE: readonly StatId[] = ['armor', 'dodge', 'parry', 'warfare'];

/** One rendered stat group. `tiles` is the untitled primaries row (its heading
 *  is suppressed in CSS, so it carries no key); `stats` is a titled panel whose
 *  heading resolves from `titleKey`. */
export interface StatPanelModel {
  kind: 'tiles' | 'stats';
  /** Catalog KEY for the panel heading, or null for the untitled tiles group. */
  titleKey: string | null;
  stats: readonly StatId[];
}

/** The three stat groups in display order: the primary tiles, then Offense, then
 *  Defense. The painter iterates this to build the sheet's stat block. */
export const STAT_PANELS: readonly StatPanelModel[] = [
  { kind: 'tiles', titleKey: null, stats: STAT_TILES },
  { kind: 'stats', titleKey: 'hudChrome.charSheet.offense', stats: STAT_OFFENSE },
  { kind: 'stats', titleKey: 'hudChrome.charSheet.defense', stats: STAT_DEFENSE },
];
