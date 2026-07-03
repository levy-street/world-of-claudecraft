// Pure derivation of the low-health screen vignette — a pulsing red full-screen
// glow that fades in as the player nears death (the classic full-screen low-health glow).
// Kept DOM-free so the intensity curve can be unit-tested directly; the HUD just
// applies the returned values to a fixed overlay element each frame.

// Below this HP fraction the vignette begins to show; at full HP it is hidden.
export const LOW_HEALTH_THRESHOLD = 0.35;
// Peak opacity reached as HP approaches 0 (kept < 1 so the world stays readable).
const MAX_OPACITY = 0.92;
// Pulse cadence, in Hz, at the threshold (slow "breathing") and near death (fast).
const PULSE_HZ_MIN = 0.6;
const PULSE_HZ_MAX = 2.0;

export interface LowHealthVignette {
  active: boolean; // false → overlay hidden (above threshold or dead)
  opacity: number; // 0..MAX_OPACITY base opacity for the overlay
  pulseSeconds: number; // one full breathe cycle; shorter = more frantic
}

// Maps live HP to the vignette state. `dead` players show nothing (the death
// overlay owns the screen then). The opacity is eased (pow < 1) so the warning
// is felt early in the danger band rather than only at the very bottom.
export function lowHealthVignette(hp: number, maxHp: number): LowHealthVignette {
  const off: LowHealthVignette = { active: false, opacity: 0, pulseSeconds: 0 };
  if (maxHp <= 0 || hp <= 0) return off; // dead or invalid → no vignette
  const frac = hp / maxHp;
  if (frac >= LOW_HEALTH_THRESHOLD) return off;

  // t: 0 at the threshold, 1 at 0 HP.
  const t = clamp01((LOW_HEALTH_THRESHOLD - frac) / LOW_HEALTH_THRESHOLD);
  const opacity = t ** 0.8 * MAX_OPACITY;
  const pulseHz = PULSE_HZ_MIN + (PULSE_HZ_MAX - PULSE_HZ_MIN) * t;
  return { active: true, opacity, pulseSeconds: 1 / pulseHz };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
