// Pure page model for the mobile action ring. The ring shows 4 action buttons at
// a time and each button carries 5 actions (a centre tap plus the 4 flick
// directions), so this module derives which hotbar SOURCE SLOT (1-indexed,
// matching Hud.castSlot's barSlot numbering) a given button plus direction maps
// to on a given page, plus the page-count/clamp/cycle arithmetic. No DOM, no
// i18n, no Hud state: the ring painter, the gesture layer, the spellbook and Hud
// all import this instead of hand-rolling the slot math four times.
//
// The slot arithmetic itself lives in radial_action_core.ts; this module is the
// ring's binding of it (how many buttons, which span, which order) so there is
// exactly one place that knows the ring is 4 buttons wide.
//
// SCOPE: pages cover every configurable hotbar source slot across all three
// desktop rows. Two pages of twenty expose slots 1 to 33; the last page's tail
// positions carry no slot because the ring keeps a stable geometry.

import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import type { ActionBarVisibility } from './action_bar_visibility_core';
import {
  RADIAL_DIRECTIONS,
  RADIAL_SLOTS_PER_BUTTON,
  type RadialDirection,
  type RadialSlotOrder,
  radialHasSourceSlot,
  radialPageCount,
  radialSourceSlot,
} from './radial_action_core';

/** Action buttons the ring shows per page. The ring's fifth arc seat is
 *  reserved for the consumables control, so it is not an action button. */
export const MOBILE_ACTION_BUTTONS = 4;
/** Actions one page reaches: every button's centre plus its 4 directions. */
export const MOBILE_ACTIONS_PER_PAGE = MOBILE_ACTION_BUTTONS * RADIAL_SLOTS_PER_BUTTON;
/** The first hotbar source slot the ring can reach (barSlot numbering; slot 0 is
 *  the fixed Attack toggle and is never produced by this module). */
export const MOBILE_ACTION_SOURCE_SLOT_START = 1;
/** Total hotbar source slots the ring can reach across all desktop rows. */
export const MOBILE_ACTION_SOURCE_SLOT_COUNT = ACTION_BAR_ABILITY_SLOTS;
/** Direction-major keeps the resting row (every button's centre tap) equal to
 *  the desktop 1 to 4 keys, where a player already puts their core rotation. */
export const MOBILE_ACTION_SLOT_ORDER: RadialSlotOrder = 'direction-major';
/** Page count for the complete configurable action-bar span. */
export const MOBILE_ACTION_PAGE_COUNT = radialPageCount(
  MOBILE_ACTION_SOURCE_SLOT_COUNT,
  MOBILE_ACTION_BUTTONS,
);

/** The hotbar source slots the touch ring and bar editor can reach. The radial
 *  owns its own capacity, so the optional DESKTOP rows never narrow it: tying it
 *  to them orphaned 22 slots (down, left, and all of page 2) for a default
 *  character. The visibility is accepted, and ignored, so a caller holding one
 *  needs no special case. */
export function mobileActionSourceSlotCount(_visibility?: ActionBarVisibility): number {
  return MOBILE_ACTION_SOURCE_SLOT_COUNT;
}

/** Number of pages needed to cover `totalSlots` source slots at
 *  MOBILE_ACTIONS_PER_PAGE per page, rounded up. Parameterized so callers can
 *  reason about other spans without forking the shared arithmetic. */
export function mobilePageCount(totalSlots: number = MOBILE_ACTION_SOURCE_SLOT_COUNT): number {
  return radialPageCount(totalSlots, MOBILE_ACTION_BUTTONS);
}

/** Clamp a page index into [0, pageCount). Handles negative, overflow, and NaN
 *  input by falling back to page 0 (NaN comparisons are always false, so both
 *  branches below fall through to the final clamp, which returns 0 for NaN). */
export function clampMobilePage(
  page: number,
  pageCount: number = MOBILE_ACTION_PAGE_COUNT,
): number {
  if (!Number.isFinite(page)) return 0;
  if (page < 0) return 0;
  if (page > pageCount - 1) return pageCount - 1;
  return Math.trunc(page);
}

/** The hotbar source slot (barSlot numbering, 1-indexed) a ring button plus
 *  direction maps to on a given page. `buttonIndex` is
 *  0..MOBILE_ACTION_BUTTONS-1 (the visible ring button position along the arc).
 *  Never returns slot 0 (the attack slot lives outside this model). */
export function sourceSlotForMobileButton(
  page: number,
  buttonIndex: number,
  direction: RadialDirection = 'center',
): number {
  return radialSourceSlot({
    page,
    buttonIndex,
    direction,
    buttonsPerPage: MOBILE_ACTION_BUTTONS,
    order: MOBILE_ACTION_SLOT_ORDER,
    startSlot: MOBILE_ACTION_SOURCE_SLOT_START,
  });
}

/** Whether a ring position maps to a real configurable hotbar slot. Positions
 *  past the reachable span must stay hidden and non-interactive, both on the
 *  last page and for a direction whose slot falls outside the enabled rows. */
export function mobileButtonHasSourceSlot(
  page: number,
  buttonIndex: number,
  totalSlots: number = MOBILE_ACTION_SOURCE_SLOT_COUNT,
  direction: RadialDirection = 'center',
): boolean {
  return radialHasSourceSlot(
    {
      page,
      buttonIndex,
      direction,
      buttonsPerPage: MOBILE_ACTION_BUTTONS,
      order: MOBILE_ACTION_SLOT_ORDER,
      startSlot: MOBILE_ACTION_SOURCE_SLOT_START,
    },
    totalSlots,
  );
}

/** Whether the current page maps any direction on a physical ring button to
 *  the given source slot. */
export function mobileButtonOwnsSourceSlot(
  page: number,
  buttonIndex: number,
  sourceSlot: number | null,
  totalSlots: number = MOBILE_ACTION_SOURCE_SLOT_COUNT,
): boolean {
  if (sourceSlot === null) return false;
  return RADIAL_DIRECTIONS.some(
    (direction) =>
      mobileButtonHasSourceSlot(page, buttonIndex, totalSlots, direction) &&
      sourceSlotForMobileButton(page, buttonIndex, direction) === sourceSlot,
  );
}

/** All MOBILE_ACTIONS_PER_PAGE source slots (barSlot numbering) a given page
 *  covers, ascending. Direction-major keeps a page's span contiguous, which is
 *  what lets the spellbook answer "which page is this slot on" by lookup. */
export function sourceSlotsForMobilePage(page: number): number[] {
  const slots: number[] = [];
  const first = MOBILE_ACTION_SOURCE_SLOT_START + page * MOBILE_ACTIONS_PER_PAGE;
  for (let i = 0; i < MOBILE_ACTIONS_PER_PAGE; i++) slots.push(first + i);
  return slots;
}

/** Advance to the next page, wrapping back to 0 past the last page. */
export function nextMobilePage(page: number, pageCount: number = MOBILE_ACTION_PAGE_COUNT): number {
  return (clampMobilePage(page, pageCount) + 1) % pageCount;
}
