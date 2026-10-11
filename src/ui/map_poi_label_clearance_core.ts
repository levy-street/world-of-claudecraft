// Pure rule that keeps a zone POI label legible when a navigation badge (a
// delve door, a world passage, a live Rift entrance) is authored on the same
// spot. The badge allocator (map_window_view placeLandmarkBadge) may move a
// badge at most MAP_LANDMARK_MAX_NUDGE_YD from the thing it marks, which is far
// less than a label is wide, so the LABEL yields: its baseline is lifted clear
// of the badge's top edge, or dropped under its bottom edge when the lift would
// leave the canvas. A label that is not touching a badge is never moved.
//
// Host-agnostic and DOM-free: canvas pixels in, canvas pixels out. Report:
// the Reliquary Hill label in Eastbrook Vale sat under the Collapsed Reliquary
// door badge because both are authored at the same world point.

import type { MapMarkerProfile } from './map_marker_profile_core';

/** Em size of the POI label font per marker profile, in canvas pixels (a
 *  conservative stand-in for the ascent band). Mirrors map_window_painter's
 *  per-profile labelFont sizes ('bold 13px' / 'bold 20px'), pinned by
 *  tests/map_poi_label_clearance.test.ts; the label band is [my - height, my]
 *  because the sprite cache draws with an alphabetic baseline at my. Scope:
 *  POI labels only (portal names and ally names are not routed through here). */
export const MAP_POI_LABEL_HEIGHT_BY_PROFILE = Object.freeze({
  standard: 13,
  compact: 20,
} as const satisfies Readonly<Record<MapMarkerProfile, number>>);

/** Room between a lifted label's BASELINE and the badge edge: descenders
 *  (about 0.21 em, 4.2 px at the compact 20 px) plus half the label outline
 *  (up to 2.25 px compact) still paint below the baseline, so the gap is sized
 *  to keep a name like "Reliquary" (q, y) clear of the badge on both profiles. */
export const MAP_POI_LABEL_BADGE_GAP = 8;

export interface PoiLabelAnchor {
  mx: number;
  my: number;
}

export interface BadgeFootprint {
  mx: number;
  my: number;
}

/** True when the label band [my - labelHeight, my] around (mx, my) touches the
 *  square badge footprint of `badgeSize` centered on the badge. Horizontally
 *  the label's real width is locale-dependent and unknown here, so the badge
 *  box is only widened by one label height: this catches a badge authored on
 *  (or beside) the named place without claiming a label it merely neighbours. */
export function poiLabelTouchesBadge(
  label: PoiLabelAnchor,
  badge: BadgeFootprint,
  badgeSize: number,
  labelHeight: number,
): boolean {
  const half = badgeSize / 2;
  const dx = Math.abs(label.mx - badge.mx);
  if (dx > half + labelHeight) return false;
  const badgeTop = badge.my - half;
  const badgeBottom = badge.my + half;
  const labelTop = label.my - labelHeight;
  const labelBottom = label.my;
  return labelBottom > badgeTop && labelTop < badgeBottom;
}

/** Return every label with a painter-only `labelMy`: the baseline the text is
 *  drawn at. It equals `my` (the authored projection, which the screen-reader
 *  map summary keeps announcing) unless the label band touches a badge, in
 *  which case it is moved clear of the first badge it touches: above the badge
 *  by default, below it when the lifted band would leave the canvas top. */
export function clearPoiLabelsOffBadges<T extends PoiLabelAnchor>(
  labels: readonly T[],
  badges: readonly BadgeFootprint[],
  badgeSize: number,
  labelHeight: number,
): (T & { labelMy: number })[] {
  const half = badgeSize / 2;
  return labels.map((label) => {
    // First touching badge only: no shipped zone stacks two navigation badges
    // on one named place, and a lifted label that lands on a second badge is
    // an accepted bound rather than a search.
    const badge = badges.find((b) => poiLabelTouchesBadge(label, b, badgeSize, labelHeight));
    if (!badge) return { ...label, labelMy: label.my };
    const above = badge.my - half - MAP_POI_LABEL_BADGE_GAP;
    const labelMy =
      above - labelHeight >= 0 ? above : badge.my + half + MAP_POI_LABEL_BADGE_GAP + labelHeight;
    return { ...label, labelMy };
  });
}
