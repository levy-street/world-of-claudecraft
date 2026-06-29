// Pure, host-agnostic view model for the spellbook window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference arena_window_view.ts / char_view.ts). It models the one
// thing the spellbook decides that is worth testing without a DOM: the class kit
// in display order, which abilities are known vs trainable, each known ability's
// rank, whether it currently sits on the action bar, and whether its add control
// is disabled (known, off the bar, but no free slot). The DOM/i18n + icon side
// lives in spellbook_window.ts; rendering is driven entirely off the structure
// here.
//
// DOM-free and i18n-free: rows carry the raw ability id + the resolved ability
// (read from IWorld.known) and raw numbers; the painter localizes the name /
// summary / rank label and resolves the icon. The known-vs-bar shape is the same
// for the offline Sim and the online ClientWorld mirror (both expose `known` +
// the bar), so the two produce identical rows.

import { ABILITIES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { PlayerClass } from '../sim/types';

/** One spell row: the class kit entry plus its learned / bar state. */
export interface SpellbookRow {
  abilityId: string;
  /** The resolved ability when learned, else null (a locked / trainable row). */
  known: ResolvedAbility | null;
  /** The level the ability is trainable at (def.learnLevel). */
  learnLevel: number;
  /** known.rank when learned, else 0. */
  rank: number;
  /** Learned AND currently placed on the action bar. */
  onBar: boolean;
  /** Learned, off the bar, but the bar is full, so the add control is disabled. */
  toggleDisabled: boolean;
}

/** The full spellbook view-model. */
export interface SpellbookView {
  classId: PlayerClass;
  /** Drives the per-form "reset bar" button (only classes with form bars). */
  hasFormBars: boolean;
  rows: SpellbookRow[];
  /** No rows rendered at all (the class kit was empty). */
  empty: boolean;
}

/** Inputs the painter feeds the builder each render, all IWorld-mirrored. */
export interface SpellbookInput {
  classId: PlayerClass;
  /** The class kit ability ids, in display order (cls.abilities). */
  abilities: readonly string[];
  /** The player's learned abilities (sim.known). */
  known: readonly ResolvedAbility[];
  /** Ability ids currently on the action bar (drives the onBar / toggle state). */
  barAbilityIds: readonly string[];
  /** The action bar has at least one empty slot. */
  hasFreeSlot: boolean;
  /** The class has per-form bars (druid), so the reset-bar button is shown. */
  hasFormBars: boolean;
}

/**
 * Build the spellbook view-model: map the class kit (display order) to rows,
 * resolving each ability's learned state from `known`, its rank, whether it is on
 * the bar, and whether its add control is disabled. Reads only IWorld-mirrored
 * data, so the offline Sim and the online ClientWorld mirror produce identical
 * rows.
 */
export function buildSpellbookView(input: SpellbookInput): SpellbookView {
  const barIds = new Set(input.barAbilityIds);
  const rows: SpellbookRow[] = input.abilities.map((abilityId) => {
    const known = input.known.find((k) => k.def.id === abilityId) ?? null;
    const onBar = known !== null && barIds.has(abilityId);
    return {
      abilityId,
      known,
      learnLevel: ABILITIES[abilityId]?.learnLevel ?? 0,
      rank: known?.rank ?? 0,
      onBar,
      toggleDisabled: known !== null && !onBar && !input.hasFreeSlot,
    };
  });
  return {
    classId: input.classId,
    hasFormBars: input.hasFormBars,
    rows,
    empty: rows.length === 0,
  };
}
