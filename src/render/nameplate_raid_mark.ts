// Drawing the raid target icon on a nameplate (docked beside it, or floating
// above the head when a toggle hid the plate), and the art it draws: a
// 128 px sprite (icons.ts raidMarkerSprite) so the large on-screen icon stays
// crisp at high device pixel ratios, where the 64 px menu art would blur.
// The size and lift rules are nameplate_raid_mark_core.ts.
//
// A soft dark halo keeps the symbol readable on bright ground (sunlit sand,
// snow, spell light); forced colors drops the halo like every other plate
// shadow. Only marked plates reach this, at most eight per group, so the one
// shadowed blit per icon is not a per-frame budget concern.

import { raidMarkerSprite } from '../ui/icons';
import {
  newRaidMarkPlateBox,
  type RaidMarkNameRow,
  type RaidMarkPlateBox,
  type RaidMarkPlateState,
  raidMarkPlateBoxInto,
} from './nameplate_raid_mark_core';

export { raidMarkPlateLift } from './nameplate_raid_mark_core';

// One scratch box: the canvas draws plates one at a time, so placing into it
// allocates nothing per frame.
const scratch = newRaidMarkPlateBox();

/** Place this plate's icon (raidMarkPlateBoxInto over the shared scratch box). */
export function placeRaidMark(
  state: RaidMarkPlateState,
  row: RaidMarkNameRow,
  screenX: number,
  screenY: number,
  stackTop: number,
  viewportHeight: number,
): RaidMarkPlateBox {
  return raidMarkPlateBoxInto(scratch, state, row, screenX, screenY, stackTop, viewportHeight);
}

const plateUrls = new Map<number, string>();

/** The nameplate's raid target art for symbol `idx` (0..7), cached per session. */
export function raidMarkPlateUrl(idx: number): string {
  let url = plateUrls.get(idx);
  if (!url) {
    url = raidMarkerSprite(idx).toDataURL();
    plateUrls.set(idx, url);
  }
  return url;
}

/** Draw the icon into its placed box (nameplate_raid_mark_core.ts) and return
 *  how far it lifts the stack (the box's lift, drawn or not). A not yet
 *  decoded image (null) or an empty box draws nothing this frame. */
export function drawRaidMarkPlate(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  box: RaidMarkPlateBox,
  forcedColors: boolean,
): number {
  if (!image || box.size <= 0) return box.lift;
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (!forcedColors) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.max(2, Math.round(box.size * 0.12));
  }
  ctx.drawImage(image, Math.round(box.x), Math.round(box.y), box.size, box.size);
  ctx.restore();
  return box.lift;
}
