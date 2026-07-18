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
//
// Phase 4 of the mobile combat HUD rework adds an optional `mobilePage` per row:
// which mobile action-ring page (Phase 1, mobile_action_page_view.ts) the row's
// bar slot falls on, so the touch-only painter can label it ("Page 1" to "Page 4").
// The page math is NOT duplicated here: sourceSlotsForMobilePage is imported
// from mobile_action_page_view.ts and this module only looks up which page's
// slot set contains the row's barSlot.

import { ABILITIES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { PlayerClass } from '../sim/types';
import {
  MOBILE_ACTION_PAGE_COUNT,
  sourceSlotsForMobilePage,
} from './hud/action_bar/mobile_action_page_view';

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
  /** The mobile action-ring page (0-indexed) this row's bar slot falls on, or
   *  null when the row is off-bar or its slot is outside the ring's reachable
   *  span (slot 0 / the attack toggle or desktop-only slots 21-22). Touch-only
   *  presentation; desktop rendering ignores this field. */
  mobilePage: number | null;
}

/** The full spellbook view-model. */
export interface SpellbookView {
  classId: PlayerClass;
  /** Drives the per-form "reset bar" button (only classes with form bars). */
  hasFormBars: boolean;
  /** The pinned basic Attack row's toggle state: whether the Attack toggle
   *  currently occupies action-bar slot 0 (the Interface showAttackButton
   *  option). Attack is not an ability, so it rides the view beside `rows`
   *  instead of forging a fake ResolvedAbility row. */
  attackOnBar: boolean;
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
  /** The Attack toggle currently occupies bar slot 0 (showAttackButton on). */
  attackOnBar: boolean;
  /** The class has per-form bars (druid), so the reset-bar button is shown. */
  hasFormBars: boolean;
  /** The player's committed spec, or null/undefined. Abilities another spec would
   *  gate away (a wrong `specs`, or this spec in `excludeSpecs`) are dropped so the
   *  book never dangles a "Trainable at level X" the committed spec can never
   *  learn. No committed spec keeps the whole kit, since any spec is still open. */
  spec?: string | null;
  /** The player's level, gating `excludeSpecsAtLevel` hand-offs. Omitted = the
   *  exclusion always applies, the pre-hand-off behavior. */
  level?: number;
  /** Optional: the hotbar's ability id per bar slot (index 0 = barSlot 1, matching
   *  Hud.hotbarActions' own index = barSlot-1 convention), used to derive each
   *  row's mobilePage. Omitted (or an ability id not found here) yields
   *  mobilePage: null, so callers that don't care about mobile paging (or run
   *  before this data is wired) see no behavior change. */
  abilityIdByBarSlot?: readonly (string | null)[];
}

/**
 * Build the spellbook view-model: map the class kit (display order) to rows,
 * resolving each ability's learned state from `known`, its rank, whether it is on
 * the bar, and whether its add control is disabled. Reads only IWorld-mirrored
 * data, so the offline Sim and the online ClientWorld mirror produce identical
 * rows.
 */
/** Can the committed spec ever learn this ability? Mirrors the sim's
 *  specs / excludeSpecs gate (classes.ts abilitiesKnownAt). A null spec keeps
 *  everything (nothing is committed yet). */
function specCanLearn(abilityId: string, spec: string | null | undefined, level?: number): boolean {
  if (!spec) return true;
  const def = ABILITIES[abilityId];
  if (!def) return true;
  if (def.specs && !def.specs.includes(spec)) return false;
  if (
    def.excludeSpecs?.includes(spec) &&
    (level === undefined || level >= (def.excludeSpecsAtLevel ?? 0))
  )
    return false;
  return true;
}

export function buildSpellbookView(input: SpellbookInput): SpellbookView {
  const barIds = new Set(input.barAbilityIds);
  const knownIds = new Set(input.known.map((k) => k.def.id));
  // An already-learned ability always keeps its row (it exists regardless of the
  // gate); only never-learnable trainable rows are dropped.
  const learnable = input.abilities.filter(
    (id) => knownIds.has(id) || specCanLearn(id, input.spec, input.level),
  );
  const rows: SpellbookRow[] = learnable.map((abilityId) => {
    const known = input.known.find((k) => k.def.id === abilityId) ?? null;
    const onBar = known !== null && barIds.has(abilityId);
    return {
      abilityId,
      known,
      learnLevel: ABILITIES[abilityId]?.learnLevel ?? 0,
      rank: known?.rank ?? 0,
      onBar,
      toggleDisabled: known !== null && !onBar && !input.hasFreeSlot,
      mobilePage: onBar ? mobilePageForAbility(abilityId, input.abilityIdByBarSlot) : null,
    };
  });
  return {
    classId: input.classId,
    hasFormBars: input.hasFormBars,
    attackOnBar: input.attackOnBar,
    rows,
    empty: rows.length === 0,
  };
}

/**
 * The mobile action-ring page (0-indexed) whose source slots
 * (sourceSlotsForMobilePage) contain this ability's bar slot, or null when the
 * slot lookup is missing, the ability isn't on the bar, or its slot sits outside
 * every page's span (slot 0's attack toggle or desktop-only slots 21-22).
 */
function mobilePageForAbility(
  abilityId: string,
  abilityIdByBarSlot: readonly (string | null)[] | undefined,
): number | null {
  if (!abilityIdByBarSlot) return null;
  const slotIndex = abilityIdByBarSlot.indexOf(abilityId);
  if (slotIndex === -1) return null;
  const barSlot = slotIndex + 1; // index 0 = barSlot 1
  for (let page = 0; page < MOBILE_ACTION_PAGE_COUNT; page++) {
    if (sourceSlotsForMobilePage(page).includes(barSlot)) return page;
  }
  return null;
}
