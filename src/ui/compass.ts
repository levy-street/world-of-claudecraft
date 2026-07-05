// Pure derivation of the heading-compass HUD strip. Kept DOM-free (like
// xp_bar.ts) so the angle math can be snapshot-tested without a browser.
//
// World convention (see hud.ts minimap notes): Entity.facing is in radians with
// 0 = +Z = "north", and turning right (clockwise from above) DECREASES facing.
// A magnetic bearing is therefore -facing, normalised to [0, 360): N=0, E=90,
// S=180, W=270 — the standard clockwise compass rose.

// Language-agnostic rose-point id. This is NOT display text — the HUD render
// boundary maps it to localized text via t(`hudChrome.compass.${id}`). The ids
// double as stable DOM map keys, so they must never be localized here.
export type CardinalId = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CompassMark {
  label: CardinalId; // rose-point id (e.g. 'N', 'NE'); the HUD t()s it for display
  offsetFrac: number; // -1 (left edge) .. 0 (centre) .. 1 (right edge)
  major: boolean; // true for the four cardinals (N/E/S/W)
}

export interface CompassView {
  bearing: number; // 0..360, where the player is looking
  heading: CardinalId; // nearest rose point id to the bearing (HUD t()s it)
  marks: CompassMark[]; // rose points within the visible window, left→right
}

// 8-point rose at 45° spacing.
const ROSE: { label: CardinalId; deg: number; major: boolean }[] = [
  { label: 'N', deg: 0, major: true },
  { label: 'NE', deg: 45, major: false },
  { label: 'E', deg: 90, major: true },
  { label: 'SE', deg: 135, major: false },
  { label: 'S', deg: 180, major: true },
  { label: 'SW', deg: 225, major: false },
  { label: 'W', deg: 270, major: true },
  { label: 'NW', deg: 315, major: false },
];

// Facing radians → compass bearing degrees in [0, 360).
export function bearingDegrees(facing: number): number {
  if (!Number.isFinite(facing)) return 0;
  const deg = (-facing * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

// Signed shortest angular distance b-a, wrapped to (-180, 180].
function angleDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

// Nearest rose-point id to a bearing (used for the centred heading readout).
export function headingLabel(bearing: number): CardinalId {
  let best = ROSE[0];
  let bestAbs = 360;
  for (const p of ROSE) {
    const ad = Math.abs(angleDelta(bearing, p.deg));
    if (ad < bestAbs) {
      bestAbs = ad;
      best = p;
    }
  }
  return best.label;
}

// Build the visible strip. halfWindowDeg is how many degrees fit between the
// centre and either edge (default 90° → a 180° field of view).
export function compassView(facing: number, halfWindowDeg = 90): CompassView {
  const bearing = bearingDegrees(facing);
  const marks: CompassMark[] = [];
  for (const p of ROSE) {
    const delta = angleDelta(bearing, p.deg); // -180..180; >0 is to the right
    if (Math.abs(delta) <= halfWindowDeg) {
      marks.push({ label: p.label, offsetFrac: delta / halfWindowDeg, major: p.major });
    }
  }
  marks.sort((a, b) => a.offsetFrac - b.offsetFrac);
  return { bearing, heading: headingLabel(bearing), marks };
}
