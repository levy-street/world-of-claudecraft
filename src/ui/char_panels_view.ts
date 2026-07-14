// Pure, host-agnostic view models for the character window's stat panels (the
// Equipment tab right column: Attributes, Combat, Defense, Progression,
// Specialization, Gathering; Gathering itself already lives in
// gathering_view.ts). Scope is the deterministic data ONLY: which StatId cells
// each panel shows, the progression bar numbers, and which specialization (if
// any) is chosen. The painter resolves stat cell HTML, i18n text, and the
// talent-summary/Choose-Change button.
//
// DOM-free, Three-free, i18n-free, and free of any RNG or wall-clock call, so
// tests/char_panels_view.test.ts can drive it directly with both a Sim-shaped
// and a ClientWorld-mirror-shaped input.
//
// The three stat-id lists below are LOCKED (docs/char-equipment/state.md,
// decision 5): no ranged power, hit, block, parry, or resistance rows. Those
// stats do not exist in this sim; do not add display-only zeros for them.

import { MAX_LEVEL, virtualLevel, xpForLevel } from '../sim/types';
import type { StatId } from './stat_tooltip';

/** ATTRIBUTES panel cells, in display order. */
export const ATTRIBUTE_PANEL_STATS: readonly StatId[] = [
  'str',
  'agi',
  'sta',
  'int',
  'spi',
  'armor',
  'attackPower',
  'dps',
  'critChance',
  'dodge',
];

/** COMBAT panel cells, in display order. */
export const COMBAT_PANEL_STATS: readonly StatId[] = [
  'attackPower',
  'dps',
  'critChance',
  'critRating',
  'hasteRating',
  'spellPower',
];

/** DEFENSE panel cells, in display order (armor + dodge only; no hit/block/
 *  parry/resistance: those stats do not exist in this sim). */
export const DEFENSE_PANEL_STATS: readonly StatId[] = ['armor', 'dodge'];

export interface ProgressionPanelModel {
  totalXp: number; // lifetimeXp, monotonic
  virtualLevel: number; // virtualLevel(lifetimeXp)
  prestigeRank: number; // hidden by the painter when 0
  levelXp: number; // current progress into the level (same source xp_bar uses)
  levelXpMax: number; // xp needed for the next level (same math xp_bar uses)
  atMaxLevel: boolean; // painter renders a full, label-less bar when true
}

/**
 * Build the progression panel model. The level-XP bar reuses xp_bar.ts's exact
 * pre-cap math verbatim (`need = xpForLevel(level)`, the XP required to
 * advance from the current level to the next) so the character sheet and the
 * HUD XP bar can never disagree. At/after MAX_LEVEL there is no next-level
 * target on the classic bar, so levelXp/levelXpMax both go to 0 (no division
 * by zero) and the painter reads `atMaxLevel` to render a full, label-less bar.
 */
export function buildProgressionPanel(input: {
  lifetimeXp: number;
  xp: number;
  level: number;
  prestigeRank: number;
}): ProgressionPanelModel {
  const { lifetimeXp, xp, level, prestigeRank } = input;
  const atMaxLevel = level >= MAX_LEVEL;
  return {
    totalXp: lifetimeXp,
    virtualLevel: virtualLevel(lifetimeXp),
    prestigeRank,
    levelXp: atMaxLevel ? 0 : xp,
    levelXpMax: atMaxLevel ? 0 : xpForLevel(level),
    atMaxLevel,
  };
}

export interface SpecPanelModel {
  specId: string | null; // null = no specialization chosen
}

/** Build the specialization panel model. A thin passthrough today (the
 *  painter resolves the display name via the talents i18n surface and decides
 *  the Choose/Change button label); kept as its own function so the contract
 *  can grow (e.g. mastery summary) without the painter reaching past this seam. */
export function buildSpecPanel(talentSpec: string | null): SpecPanelModel {
  return { specId: talentSpec };
}
