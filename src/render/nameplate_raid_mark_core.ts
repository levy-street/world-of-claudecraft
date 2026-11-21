// The raid target icon above a nameplate (star to skull): how big it is on
// screen and how far it lifts the rest of the stack. Pure (RENDER_PURE_CORES):
// no DOM/Three/i18n, no Math.random/Date.now.
//
// It is the one thing a pack is read by, so it is drawn LARGE, as the classic
// client does: about twice the old 30 px chip, scaled with the viewport height
// (so a 4K screen and a small laptop both read it at the same share of the
// screen) and clamped to a floor that stays legible and a ceiling that never
// swallows the plate. It always sits ABOVE the whole plate with a small gap,
// so it can never cover the name, the bars or the quest marker.

/** The icon's edge as a share of the viewport height (56 px at 900 px). */
export const RAID_MARK_PLATE_VIEWPORT_SHARE = 0.062;
/** Never smaller than this (CSS px): still clearly the icon on a small screen. */
export const RAID_MARK_PLATE_MIN = 44;
/** Never larger than this (CSS px): crisp from the 128 px sprite at 2x DPR. */
export const RAID_MARK_PLATE_MAX = 64;
/** Clear air between the top of the plate stack and the icon. */
export const RAID_MARK_PLATE_GAP = 6;

/** The icon's on-screen edge in CSS px for a viewport `viewportHeight` tall. */
export function raidMarkPlateSize(viewportHeight: number): number {
  const ideal = Math.round(viewportHeight * RAID_MARK_PLATE_VIEWPORT_SHARE);
  return Math.max(RAID_MARK_PLATE_MIN, Math.min(RAID_MARK_PLATE_MAX, ideal));
}

/** How far the icon lifts the stack above it: nothing for an unmarked plate,
 *  else the icon plus its gap. drawBase and drawEmote both step by this, so
 *  the emote bubble stays above the icon. */
export function raidMarkPlateLift(url: string, viewportHeight: number): number {
  return url ? raidMarkPlateSize(viewportHeight) + RAID_MARK_PLATE_GAP : 0;
}
