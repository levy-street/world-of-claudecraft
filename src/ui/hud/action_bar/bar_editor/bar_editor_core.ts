// Pure, DOM-free core for the touch bar editor: the exploded grid model for one
// ring page, and the tap state machine that turns taps into bar mutations. No
// DOM, no timers, no Hud state, so a Vitest drives every decision directly;
// registered in tests/architecture.test.ts UI_PURE_CORES.
//
// WHY THIS EXISTS. The radial ring reaches 4 buttons x 5 directions x 2 pages,
// but binding rode the mobile long-press drag, which could only reach the 4
// visible centre buttons: the 16 directional slots per page had no touch
// binding path at all. That drag also armed underneath the radial gestures, so
// a hold long enough to open the petals could pick a slot up and swap it on
// release (an accidental slot 1/2 swap mid-combat was reported). Setup leaves
// the live combat surface entirely: the editor explodes ONE page into a real
// grid of focusable buttons and mutates it with taps, so no gesture is involved
// and it works under the touchTapMenus setting by construction.

import type { InterpolationValues, TranslationKey } from '../../../i18n';
import {
  clampMobilePage,
  MOBILE_ACTION_BUTTONS,
  mobileButtonHasSourceSlot,
  mobilePageCount,
  sourceSlotForMobileButton,
} from '../mobile_action_page_view';
import { RADIAL_DIRECTIONS, type RadialDirection } from '../radial_action_core';

/** Cells one page shows: every ring button's centre plus its four flicks. */
export const BAR_EDITOR_CELLS_PER_PAGE = MOBILE_ACTION_BUTTONS * RADIAL_DIRECTIONS.length;

/** The direction each grid ROW stands for, top to bottom. Direction-major, the
 *  same order radialSourceSlot lays the page out in, so the top row is the
 *  resting row a player taps without flicking. */
export const BAR_EDITOR_ROW_DIRECTIONS: readonly RadialDirection[] = RADIAL_DIRECTIONS;

/** The accessible direction word per row. Shared with the live ring's petals so
 *  a screen reader hears the same name in both surfaces. */
export const BAR_EDITOR_DIRECTION_KEYS: Record<RadialDirection, TranslationKey> = {
  center: 'hudChrome.mobile.radialCenter',
  up: 'hudChrome.mobile.radialUp',
  right: 'hudChrome.mobile.radialRight',
  down: 'hudChrome.mobile.radialDown',
  left: 'hudChrome.mobile.radialLeft',
};

/** One grid position: which ring control it belongs to, and which hotbar source
 *  slot (barSlot numbering, 1-indexed) it edits. */
export interface BarEditorCell {
  readonly buttonIndex: number;
  readonly direction: RadialDirection;
  readonly slot: number;
  /** False for a tail position past the configurable span (the last page's
   *  overhang). Such a cell renders, but is inert: it edits nothing. */
  readonly inRange: boolean;
}

/**
 * The whole page as one flat, ROW-MAJOR cell list (direction-major rows, four
 * buttons per row), so a consumer seats it into a 4-column grid by index and
 * never re-derives the slot arithmetic.
 */
export function buildBarEditorGrid(page: number, totalSlots: number): BarEditorCell[] {
  const cells: BarEditorCell[] = [];
  for (const direction of BAR_EDITOR_ROW_DIRECTIONS) {
    for (let buttonIndex = 0; buttonIndex < MOBILE_ACTION_BUTTONS; buttonIndex++) {
      cells.push({
        buttonIndex,
        direction,
        slot: sourceSlotForMobileButton(page, buttonIndex, direction),
        inRange: mobileButtonHasSourceSlot(page, buttonIndex, totalSlots, direction),
      });
    }
  }
  return cells;
}

/** Pages the editor offers, which is exactly the live ring's page span. */
export function barEditorPageCount(totalSlots: number): number {
  return mobilePageCount(totalSlots);
}

/** Clamp a page index into the editor's live span (shared with the ring). */
export function clampBarEditorPage(page: number, totalSlots: number): number {
  return clampMobilePage(page, barEditorPageCount(totalSlots));
}

/**
 * What the next tap will do.
 *  - `none`: nothing is armed, so a tap on a bound cell picks it up.
 *  - `ability`: a spell arrived armed from the spellbook; the next tap places it.
 *  - `slot`: a cell is picked up; the next tap swaps with it, or cancels when it
 *    lands back on the same cell.
 *  - `clear`: the Clear control is armed; the next tap on a bound cell empties it.
 */
export type BarEditorSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'ability'; readonly abilityId: string }
  | { readonly kind: 'slot'; readonly slot: number }
  | { readonly kind: 'clear' };

export const BAR_EDITOR_IDLE: BarEditorSelection = { kind: 'none' };
export const BAR_EDITOR_CLEAR_ARMED: BarEditorSelection = { kind: 'clear' };

/** The mutation a tap resolves to, plus the selection that survives it. */
export type BarEditorTap =
  | { readonly kind: 'idle'; readonly selection: BarEditorSelection }
  | {
      readonly kind: 'place';
      readonly abilityId: string;
      readonly slot: number;
      readonly selection: BarEditorSelection;
    }
  | { readonly kind: 'pick'; readonly slot: number; readonly selection: BarEditorSelection }
  | { readonly kind: 'clear'; readonly slot: number; readonly selection: BarEditorSelection }
  | {
      readonly kind: 'swap';
      readonly from: number;
      readonly to: number;
      readonly selection: BarEditorSelection;
    }
  | { readonly kind: 'cancel'; readonly selection: BarEditorSelection };

/**
 * The whole editor gesture language, as one pure transition.
 *
 * A tap on an out-of-range cell is inert whatever is armed: the tail positions
 * exist so the grid keeps the ring's stable geometry, and letting one swallow an
 * armed spell would drop the binding on the floor.
 *
 * `cellIsBound` is asked of the caller rather than derived here so the core
 * never has to know the HotbarAction shape: an empty cell with nothing armed is
 * the one tap that does nothing at all, because there is nothing to pick up.
 */
export function resolveBarEditorTap(
  selection: BarEditorSelection,
  cell: BarEditorCell,
  cellIsBound: boolean,
): BarEditorTap {
  if (!cell.inRange) return { kind: 'idle', selection };
  if (selection.kind === 'clear') {
    // An empty cell keeps clear ARMED rather than disarming: a mis-tap on a gap
    // in the grid must not silently take the mode away mid-cleanup. The Clear
    // control itself is the way out.
    if (!cellIsBound) return { kind: 'idle', selection };
    return { kind: 'clear', slot: cell.slot, selection: BAR_EDITOR_IDLE };
  }
  if (selection.kind === 'ability') {
    return {
      kind: 'place',
      abilityId: selection.abilityId,
      slot: cell.slot,
      selection: BAR_EDITOR_IDLE,
    };
  }
  if (selection.kind === 'slot') {
    if (selection.slot === cell.slot) return { kind: 'cancel', selection: BAR_EDITOR_IDLE };
    return { kind: 'swap', from: selection.slot, to: cell.slot, selection: BAR_EDITOR_IDLE };
  }
  if (!cellIsBound) return { kind: 'idle', selection };
  return { kind: 'pick', slot: cell.slot, selection: { kind: 'slot', slot: cell.slot } };
}

/** Arm a spell handed over by the spellbook's assign control. */
export function armBarEditorAbility(abilityId: string): BarEditorSelection {
  return { kind: 'ability', abilityId };
}

/**
 * Toggle the Clear control. Arming it is what gives touch a way to EMPTY a slot
 * at all: the desktop clear is shift + right-click, which no phone can produce,
 * so before this a bound slot could only ever be swapped or overwritten. Pressing
 * it again disarms, and so does any tap it consumes.
 */
export function toggleBarEditorClear(selection: BarEditorSelection): BarEditorSelection {
  return selection.kind === 'clear' ? BAR_EDITOR_IDLE : BAR_EDITOR_CLEAR_ARMED;
}

/** Whether the Clear control is armed, for its pressed state. */
export function barEditorClearArmed(selection: BarEditorSelection): boolean {
  return selection.kind === 'clear';
}

/** The cell a pending swap picked up, or -1 when nothing is picked up. Lets a
 *  painter mark the pressed cell without re-reading the union shape per cell. */
export function barEditorPickedSlot(selection: BarEditorSelection): number {
  return selection.kind === 'slot' ? selection.slot : -1;
}

export interface BarEditorLabelDeps {
  t(key: TranslationKey, values?: InterpolationValues): string;
  /** Locale-aware button number, so the header never concatenates a raw digit. */
  formatIndex(value: number): string;
}

/**
 * A cell's accessible name: the control it belongs to, the direction, and what
 * it holds ("Button 2, Up: Fireball"). Named by direction rather than by slot
 * index because the direction is what the player will actually flick, and the
 * slot number is invisible on touch.
 */
export function barEditorCellAria(
  cell: BarEditorCell,
  actionName: string | null,
  deps: BarEditorLabelDeps,
): string {
  const values = {
    button: deps.formatIndex(cell.buttonIndex + 1),
    direction: deps.t(BAR_EDITOR_DIRECTION_KEYS[cell.direction]),
  };
  if (actionName === null) return deps.t('hudChrome.barEditor.emptyCellAria', values);
  return deps.t('hudChrome.barEditor.cellAria', { ...values, action: actionName });
}

/** The standing caption under the grid: what a tap will do right now. */
export function barEditorCaption(
  selection: BarEditorSelection,
  nameForSelection: string | null,
  deps: Pick<BarEditorLabelDeps, 't'>,
): string {
  if (selection.kind === 'ability') {
    return deps.t('hudChrome.barEditor.armed', { name: nameForSelection ?? '' });
  }
  if (selection.kind === 'slot') {
    return deps.t('hudChrome.barEditor.picked', { name: nameForSelection ?? '' });
  }
  if (selection.kind === 'clear') return deps.t('hudChrome.barEditor.clearArmed');
  return deps.t('hudChrome.barEditor.hint');
}
