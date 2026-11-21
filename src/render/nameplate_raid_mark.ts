// Drawing the raid target icon above a nameplate, and the art it draws: a
// 128 px sprite (icons.ts raidMarkerSprite) so the large on-screen icon stays
// crisp at high device pixel ratios, where the 64 px menu art would blur.
// The size and lift rules are nameplate_raid_mark_core.ts.
//
// A soft dark halo keeps the symbol readable on bright ground (sunlit sand,
// snow, spell light); forced colors drops the halo like every other plate
// shadow. Only marked plates reach this, at most eight per group, so the one
// shadowed blit per icon is not a per-frame budget concern.

import { raidMarkerSprite } from '../ui/icons';
import { raidMarkPlateSize } from './nameplate_raid_mark_core';

export { raidMarkPlateLift } from './nameplate_raid_mark_core';

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

/** Draw the icon centred on `screenX` with its top edge at `top`. A not yet
 *  decoded image (null) draws nothing this frame. */
export function drawRaidMarkPlate(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  screenX: number,
  top: number,
  viewportHeight: number,
  forcedColors: boolean,
): void {
  if (!image) return;
  const size = raidMarkPlateSize(viewportHeight);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (!forcedColors) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.round(size * 0.12);
  }
  ctx.drawImage(image, Math.round(screenX - size / 2), Math.round(top), size, size);
  ctx.restore();
}
