// Pure, host-agnostic animation model for the ground-targeted AoE impact ring:
// a school-colored circle flashed on the terrain at a blast's landing spot, so
// the impact area reads clearly for the instant it matters, then gets out of
// the way (no lingering decal). No Three.js or DOM here; the renderer maps
// these scalars onto a pooled ring mesh (see renderer.ts), mirroring the
// click_marker.ts split.

// Total on-screen lifetime, in seconds. Slightly longer than the click marker
// so the ring survives the burst particles that draw over it.
export const AOE_RING_LIFETIME = 0.7;

export interface AoeRingAnim {
  // false once the ring has outlived AOE_RING_LIFETIME, so the caller hides it.
  active: boolean;
  ringScale: number; // multiplier on the blast radius (always 1)
  ringAlpha: number; // 0..1 ring opacity (bright pop, then fade)
}

const HIDDEN: AoeRingAnim = { active: false, ringScale: 1, ringAlpha: 0 };

export function aoeRingAnim(elapsed: number): AoeRingAnim {
  if (elapsed < 0 || elapsed >= AOE_RING_LIFETIME) return HIDDEN;
  const t = elapsed / AOE_RING_LIFETIME;
  // The gameplay boundary is the real radius from the first frame. Animate
  // brightness, never apparent reach: players must be able to judge the edge.
  const ringScale = 1;
  const fade = Math.max(0, (t - 0.25) / 0.75);
  const ringAlpha = 0.85 * (1 - fade * fade * fade) + 0.15 * (1 - fade);
  return { active: true, ringScale, ringAlpha };
}
