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
// bar slot falls on, so the touch-only painter can label it ("Page 1" through
// "Page 3").
// The page math is NOT duplicated here: sourceSlotsForMobilePage is imported
// from mobile_action_page_view.ts and this module only looks up which page's
// slot set contains the row's barSlot.

import { ABILITIES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { PlayerClass } from '../sim/types';
import type { HotbarAction } from './hotbar';
import { sourceSlotsForMobilePage } from './mobile_action_page_view';

export type MobileSpellbookAssignment =
  | { kind: 'unassigned' }
  | { kind: 'mobile'; sourceSlot: number; page: number; position: number }
  | { kind: 'desktop'; sourceSlot: 21 | 22 };

export interface MobileSpellbookPickerTab {
  page: number;
  selected: boolean;
  tabIndex: 0 | -1;
}

export interface MobileSpellbookPickerDestination {
  sourceSlot: number;
  page: number;
  position: number;
  occupant: HotbarAction;
  current: boolean;
}

export interface MobileSpellbookPickerView {
  abilityId: string;
  barToken: string;
  selectedPage: number;
  assignment: MobileSpellbookAssignment;
  tabs: MobileSpellbookPickerTab[];
  destinations: MobileSpellbookPickerDestination[];
  focusDestinationIndex: number;
}

export interface MobileSpellbookPickerInput {
  actions: readonly HotbarAction[];
  abilityId: string;
  selectedPage: number;
  barToken: string;
}

export function mobileSpellbookAssignment(
  actions: readonly HotbarAction[],
  abilityId: string,
): MobileSpellbookAssignment {
  const index = actions.findIndex(
    (action) => action?.type === 'ability' && action.id === abilityId,
  );
  if (index < 0) return { kind: 'unassigned' };
  const sourceSlot = index + 1;
  if (sourceSlot <= 20) {
    return {
      kind: 'mobile',
      sourceSlot,
      page: Math.floor(index / 5),
      position: (index % 5) + 1,
    };
  }
  if (sourceSlot === 21 || sourceSlot === 22) return { kind: 'desktop', sourceSlot };
  return { kind: 'unassigned' };
}

export function buildMobileSpellbookPicker(
  input: MobileSpellbookPickerInput,
): MobileSpellbookPickerView {
  const selectedPage = Math.min(3, Math.max(0, Math.trunc(input.selectedPage)));
  const assignment = mobileSpellbookAssignment(input.actions, input.abilityId);
  const tabs = Array.from(
    { length: 4 },
    (_, page): MobileSpellbookPickerTab => ({
      page,
      selected: page === selectedPage,
      tabIndex: page === selectedPage ? 0 : -1,
    }),
  );
  const destinations = sourceSlotsForMobilePage(selectedPage).map(
    (sourceSlot, index): MobileSpellbookPickerDestination => ({
      sourceSlot,
      page: selectedPage,
      position: index + 1,
      occupant: input.actions[sourceSlot - 1] ?? null,
      current: assignment.kind === 'mobile' && assignment.sourceSlot === sourceSlot,
    }),
  );
  const currentIndex = destinations.findIndex((destination) => destination.current);
  const emptyIndex = destinations.findIndex((destination) => destination.occupant === null);
  return {
    abilityId: input.abilityId,
    barToken: input.barToken,
    selectedPage,
    assignment,
    tabs,
    destinations,
    focusDestinationIndex: currentIndex >= 0 ? currentIndex : emptyIndex >= 0 ? emptyIndex : 0,
  };
}

export function nextMobileSpellbookPickerPage(currentPage: number, key: string): number {
  if (key === 'Home') return 0;
  if (key === 'End') return 3;
  if (key === 'ArrowLeft') return (currentPage + 3) % 4;
  if (key === 'ArrowRight') return (currentPage + 1) % 4;
  return currentPage;
}

export function isSpellbookBarTokenCurrent(openingToken: string, currentToken: string): boolean {
  return openingToken === currentToken;
}

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
  /** Exact assignment used by touch chips and the inline picker. */
  assignment: MobileSpellbookAssignment;
  /** The mobile action-ring page (0-indexed) this row's bar slot falls on, or
   *  null when the row is off-bar or its slot is outside the ring's reachable
   *  span (slot 0 / the attack toggle or source slots 16-22). Touch-only
   *  presentation; desktop rendering ignores this field. */
  mobilePage: number | null;
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
  /** Optional: the hotbar's ability id per bar slot (index 0 = barSlot 1, matching
   *  Hud.hotbarActions' own index = barSlot-1 convention), used to derive each
   *  row's mobilePage. Omitted (or an ability id not found here) yields
   *  mobilePage: null, so callers that don't care about mobile paging (or run
   *  before this data is wired) see no behavior change. */
  abilityIdByBarSlot?: readonly (string | null)[];
  /** Touch uses an exact destination picker, so Add remains available on a full bar. */
  touchPresentation?: boolean;
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
    const assignment = assignmentFromAbilitySlots(abilityId, input.abilityIdByBarSlot);
    return {
      abilityId,
      known,
      learnLevel: ABILITIES[abilityId]?.learnLevel ?? 0,
      rank: known?.rank ?? 0,
      onBar,
      toggleDisabled:
        known !== null && !onBar && !input.hasFreeSlot && input.touchPresentation !== true,
      assignment: onBar ? assignment : { kind: 'unassigned' },
      mobilePage: onBar && assignment.kind === 'mobile' ? assignment.page : null,
    };
  });
  return {
    classId: input.classId,
    hasFormBars: input.hasFormBars,
    rows,
    empty: rows.length === 0,
  };
}

function assignmentFromAbilitySlots(
  abilityId: string,
  abilityIdByBarSlot: readonly (string | null)[] | undefined,
): MobileSpellbookAssignment {
  if (!abilityIdByBarSlot) return { kind: 'unassigned' };
  const index = abilityIdByBarSlot.indexOf(abilityId);
  if (index < 0) return { kind: 'unassigned' };
  const sourceSlot = index + 1;
  if (sourceSlot <= 20) {
    return {
      kind: 'mobile',
      sourceSlot,
      page: Math.floor(index / 5),
      position: (index % 5) + 1,
    };
  }
  if (sourceSlot === 21 || sourceSlot === 22) return { kind: 'desktop', sourceSlot };
  return { kind: 'unassigned' };
}
