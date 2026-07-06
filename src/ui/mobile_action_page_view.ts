// Pure page model for the mobile action ring (Phase 1 of the mobile combat HUD
// rework). The ring shows 5 action buttons at a time; this module derives which
// hotbar SOURCE SLOT (1-indexed, matching Hud.castSlot's barSlot numbering) each
// visible ring button maps to for a given page, plus the page-count/clamp/cycle
// arithmetic. No DOM, no i18n, no Hud state: the ring painter and Hud both import
// this instead of hand-rolling the slot math twice.
//
// SCOPE: pages cover hotbar source slots 1-10 only (2 pages of 5). Slot 11 and the
// entire secondary bar (slots 12-22) are unreachable from the ring this pass; a
// future extension would grow MOBILE_ACTION_PAGE_COUNT and mobilePageCount's input,
// not fork this module.

/** Ring buttons per page (the 5 visible action slots; attack is separate, fixed,
 *  and outside the paging system entirely). */
export const MOBILE_ACTIONS_PER_PAGE = 5;
/** The first hotbar source slot the ring can reach (barSlot numbering; slot 0 is
 *  the fixed Attack toggle and is never produced by this module). */
export const MOBILE_ACTION_SOURCE_SLOT_START = 1;
/** Total hotbar source slots the ring can reach (1..10): 2 pages x 5 buttons. */
export const MOBILE_ACTION_SOURCE_SLOT_COUNT = 10;
/** Default page count for the default 10-slot span. */
export const MOBILE_ACTION_PAGE_COUNT = 2;

/** Number of pages needed to cover `totalSlots` source slots at
 *  MOBILE_ACTIONS_PER_PAGE per page, rounded up. Parameterized (not hardcoded to
 *  2) so a future extension can grow the reachable slot span without forking the
 *  arithmetic. */
export function mobilePageCount(totalSlots: number = MOBILE_ACTION_SOURCE_SLOT_COUNT): number {
  return Math.max(1, Math.ceil(totalSlots / MOBILE_ACTIONS_PER_PAGE));
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

/** The hotbar source slot (barSlot numbering, 1-indexed) a ring button maps to on
 *  a given page. `buttonIndex` is 0..MOBILE_ACTIONS_PER_PAGE-1 (the visible ring
 *  button position, left to right). Never returns slot 0 (the attack slot lives
 *  outside this model). */
export function sourceSlotForMobileButton(page: number, buttonIndex: number): number {
  return MOBILE_ACTION_SOURCE_SLOT_START + page * MOBILE_ACTIONS_PER_PAGE + buttonIndex;
}

/** All 5 source slots (barSlot numbering) a given page covers, in ring button
 *  order. */
export function sourceSlotsForMobilePage(page: number): number[] {
  const slots: number[] = [];
  for (let i = 0; i < MOBILE_ACTIONS_PER_PAGE; i++) {
    slots.push(sourceSlotForMobileButton(page, i));
  }
  return slots;
}

/** Advance to the next page, wrapping back to 0 past the last page. */
export function nextMobilePage(page: number, pageCount: number = MOBILE_ACTION_PAGE_COUNT): number {
  return (clampMobilePage(page, pageCount) + 1) % pageCount;
}
