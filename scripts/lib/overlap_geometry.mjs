// Shared rect-vs-rect and circle-vs-rect gap math for the mobile HUD overlap
// gates (mobile_cluster_layout_check.mjs and mobile_hud_overlap_audit.mjs).
//
// Every function is pure and DOM-free: callers collect getBoundingClientRect
// geometry in-page, serialize it to plain {left, top, right, bottom, w, h}
// records, then measure separation here. Positive gap = separated, negative =
// overlap depth.
//
// The ring thumb controls are true circles (border-radius: 50% also clips the
// pointer hit-test), so the mis-tap distance between two of them is centre
// distance minus both radii, NOT bounding-box separation: adjacent arc boxes
// overlap at the corners by design while the circles keep a real gap. The
// circle-id set is a PARAMETER (was a module-global in the cluster check) so
// each caller passes its own set of ids to treat as circles.

// The canonical device profiles both gates sweep. Shared so a new profile lands
// in one place. Fields: name, w/h CSS viewport, dsf deviceScaleFactor, tier the
// expected responsive body class.
export const PROFILES = [
  { name: 'iphone-13-landscape', w: 844, h: 390, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'iphone-pro-max-landscape', w: 932, h: 430, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'pixel-7-landscape', w: 915, h: 412, dsf: 2.625, tier: 'hud-mobile-compact' },
  { name: 'galaxy-s8-landscape', w: 740, h: 360, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'small-laptop-720p', w: 1280, h: 720, dsf: 1, tier: 'hud-mobile-standard' },
  { name: 'tablet-4-3', w: 1024, h: 768, dsf: 2, tier: 'hud-mobile-tablet' },
  { name: 'fhd-1080p', w: 1920, h: 1080, dsf: 1, tier: 'hud-mobile-tablet' },
];

// Edge distance between two rects: positive = separated, negative = overlap depth.
export function edgeGap(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
  return Math.max(dx, dy);
}

// The largest inscribed circle of a rect (centre + radius = half the shorter side).
export function circleOf(r) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, r: Math.min(r.w, r.h) / 2 };
}

// Distance from a circle's edge to a rect's edge (negative = overlap depth).
export function circleRectGap(c, rect) {
  const px = Math.min(Math.max(c.x, rect.left), rect.right);
  const py = Math.min(Math.max(c.y, rect.top), rect.bottom);
  const inside = px === c.x && py === c.y;
  const d = Math.hypot(c.x - px, c.y - py);
  return inside ? -c.r : d - c.r;
}

// Gap between control idA/a and idB/b, treating any id in circleIds as a true
// circle. Circle vs circle uses centre distance minus both radii; circle vs
// rect uses circleRectGap; rect vs rect uses edgeGap.
export function controlGap(idA, a, idB, b, circleIds) {
  const aCircle = circleIds.has(idA);
  const bCircle = circleIds.has(idB);
  if (aCircle && bCircle) {
    const ca = circleOf(a);
    const cb = circleOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y) - ca.r - cb.r;
  }
  if (aCircle) return circleRectGap(circleOf(a), b);
  if (bCircle) return circleRectGap(circleOf(b), a);
  return edgeGap(a, b);
}
