// Where the raid target icon (star to skull) goes on a nameplate, and how big
// it is. Pure (RENDER_PURE_CORES): no DOM/Three/i18n, no Math.random/Date.now.
//
// Two placements:
//  - DOCKED (the plate shows a name or a health bar): the icon sits BESIDE the
//    plate, to the left of its widest part (health bar or name row, the level
//    and badges included), vertically centred on the name-plus-bar block and a
//    few pixels off it, so in a tight pack the icon and its own plate read as
//    one unit (the modern classic-client placement). It lifts nothing.
//  - FLOATING (a nameplate toggle hid the plate, NameplatePlan.raidMarkOnly):
//    the icon alone, larger, above the head, lifting the stack above it.
// Sizes follow the viewport height, clamped, so the icon reads the same on a
// small laptop and a 4K screen; the art is the 128 px sprite, so the largest
// size stays crisp at 2x DPR.

import {
  NAMEPLATE_HEALTH_HEIGHT,
  nameplateHealthBarTop,
  nameplateHealthBarWidth,
} from './nameplate_pick_core';

/** Docked icon edge as a share of the viewport height (28 px at 900 px). */
export const RAID_MARK_DOCK_VIEWPORT_SHARE = 0.031;
/** Docked icon floor / ceiling (CSS px): bigger than the name-plus-bar block it
 *  sits beside, never so big it reaches far into the plates above or below. */
export const RAID_MARK_DOCK_MIN = 22;
export const RAID_MARK_DOCK_MAX = 34;
/** Air between the docked icon and the plate's left edge. */
export const RAID_MARK_DOCK_GAP = 3;

/** Floating icon edge as a share of the viewport height (56 px at 900 px). */
export const RAID_MARK_PLATE_VIEWPORT_SHARE = 0.062;
export const RAID_MARK_PLATE_MIN = 44;
export const RAID_MARK_PLATE_MAX = 64;
/** Air between the top of the stack and the floating icon. */
export const RAID_MARK_PLATE_GAP = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The docked icon's edge in CSS px. */
export function raidMarkDockSize(viewportHeight: number): number {
  return clamp(
    Math.round(viewportHeight * RAID_MARK_DOCK_VIEWPORT_SHARE),
    RAID_MARK_DOCK_MIN,
    RAID_MARK_DOCK_MAX,
  );
}

/** The floating icon's edge in CSS px. */
export function raidMarkPlateSize(viewportHeight: number): number {
  return clamp(
    Math.round(viewportHeight * RAID_MARK_PLATE_VIEWPORT_SHARE),
    RAID_MARK_PLATE_MIN,
    RAID_MARK_PLATE_MAX,
  );
}

/** The plate fields the placement reads. */
export interface RaidMarkPlateState {
  raidMarkerUrl: string;
  name: string;
  hpVisible: boolean;
  castVisible: boolean;
  frame: string;
}

/** The name row as drawBase just laid it out (nameplate_canvas.ts heraldryInput). */
export interface RaidMarkNameRow {
  nameRowBottomY: number;
  nameRowHeight: number;
  nameRowWidth: number;
}

/** Where to draw (top-left corner and edge; size 0 = nothing) and how far the
 *  icon lifts the stack above it (non-zero only when floating). */
export interface RaidMarkPlateBox {
  x: number;
  y: number;
  size: number;
  lift: number;
}

export function newRaidMarkPlateBox(): RaidMarkPlateBox {
  return { x: 0, y: 0, size: 0, lift: 0 };
}

/** The plate shows a name or a health bar, so the icon docks beside it. */
export function raidMarkDocked(state: RaidMarkPlateState): boolean {
  return state.hpVisible || state.name !== '';
}

/** How far the icon lifts the stack above it: only a floating icon does.
 *  drawBase and drawEmote both step by this. */
export function raidMarkPlateLift(state: RaidMarkPlateState, viewportHeight: number): number {
  if (!state.raidMarkerUrl || raidMarkDocked(state)) return 0;
  return raidMarkPlateSize(viewportHeight) + RAID_MARK_PLATE_GAP;
}

/** Place the icon into `out` (reused: no per-frame allocation) and return it.
 *  `screenY` is the plate anchor, `stackTop` the y the stack has climbed to. */
export function raidMarkPlateBoxInto(
  out: RaidMarkPlateBox,
  state: RaidMarkPlateState,
  row: RaidMarkNameRow,
  screenX: number,
  screenY: number,
  stackTop: number,
  viewportHeight: number,
): RaidMarkPlateBox {
  out.lift = raidMarkPlateLift(state, viewportHeight);
  if (!state.raidMarkerUrl) {
    out.size = 0;
    return out;
  }
  if (!raidMarkDocked(state)) {
    out.size = raidMarkPlateSize(viewportHeight);
    out.x = screenX - out.size / 2;
    out.y = stackTop - out.lift;
    return out;
  }
  const size = raidMarkDockSize(viewportHeight);
  const barTop = nameplateHealthBarTop(screenY, state.castVisible);
  const hasName = state.name !== '';
  const top = hasName ? row.nameRowBottomY - row.nameRowHeight : barTop;
  const bottom = state.hpVisible ? barTop + NAMEPLATE_HEALTH_HEIGHT : row.nameRowBottomY;
  const barWidth = state.hpVisible ? nameplateHealthBarWidth(state.frame === 'boss') : 0;
  const halfWidth = Math.max(barWidth, hasName ? row.nameRowWidth : 0) / 2;
  out.size = size;
  out.x = screenX - halfWidth - RAID_MARK_DOCK_GAP - size;
  out.y = (top + bottom) / 2 - size / 2;
  return out;
}
