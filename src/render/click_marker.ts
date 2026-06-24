// Pure, host-agnostic animation model for the OSRS-style click-feedback marker
// (an expanding ring + a crossed "X" that stamps where you click). No Three.js
// or DOM here so the curves are unit-testable in isolation; the renderer is the
// thin consumer that maps these scalars onto meshes (see renderer.ts).

// Total on-screen lifetime of one marker, in seconds. Short and snappy so it
// reads as immediate feedback, not a lingering decal.
export const CLICK_MARKER_LIFETIME = 0.5;

// Palette mirrors the selection ring (renderer.ts): warm gold for a neutral
// click, the same hostile red the reticle uses when you click an enemy.
export const CLICK_MARKER_COLOR_NEUTRAL = 0xd4af37;
export const CLICK_MARKER_COLOR_HOSTILE = 0xcc2222;

export function clickMarkerColor(hostile: boolean): number {
  return hostile ? CLICK_MARKER_COLOR_HOSTILE : CLICK_MARKER_COLOR_NEUTRAL;
}

export interface ClickMarkerAnim {
  // false once the marker has outlived CLICK_MARKER_LIFETIME, so the caller hides it.
  active: boolean;
  ringScale: number; // multiplier on the ring's base radius (expands outward)
  ringAlpha: number; // 0..1 ring opacity (fades the whole life)
  crossScale: number; // multiplier on the X's base size (pops in, then holds)
  crossAlpha: number; // 0..1 X opacity (holds, then fades late)
}

const HIDDEN: ClickMarkerAnim = {
  active: false,
  ringScale: 1,
  ringAlpha: 0,
  crossScale: 1,
  crossAlpha: 0,
};

// Classic ease-out (decelerating) for the X stamp + ring growth.
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Given how long a marker has been alive, return the scalars that drive it.
// Deterministic and allocation-free on the hot path (returns a shared HIDDEN
// object only once expired).
export function clickMarkerAnim(
  elapsed: number,
  lifetime: number = CLICK_MARKER_LIFETIME,
): ClickMarkerAnim {
  if (elapsed < 0 || elapsed >= lifetime) return HIDDEN;
  const t = clamp01(elapsed / lifetime);

  // Ring: expands from 0.55x (a touch inside its base radius) out to 1.5x while
  // fading linearly to nothing, a sonar-style pulse.
  const ringScale = 0.55 + 0.95 * easeOutCubic(t);
  const ringAlpha = (1 - t) * 0.85;

  // X: stamps in over the first quarter of its life (small → full, eased), holds
  // crisp, then fades out over the final ~35%.
  const STAMP = 0.25;
  const crossScale = t < STAMP ? 0.35 + 0.65 * easeOutCubic(t / STAMP) : 1;
  const FADE_START = 0.65;
  const crossAlpha = t < FADE_START ? 1 : 1 - (t - FADE_START) / (1 - FADE_START);

  return {
    active: true,
    ringScale,
    ringAlpha,
    crossScale,
    crossAlpha: clamp01(crossAlpha),
  };
}
