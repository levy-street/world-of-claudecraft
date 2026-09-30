// The pale cracked mark a heavy slam leaves on the ground (the Fire and Fly
// Shockwave, around the tower's foot), the pure half: its texels, the second
// cell of the cannon's one scorch texture beside the char, its tint on the
// scorch's subtractive blend (a light, dusty stain where a scorch chars) and its
// fade. The painter is cannon_shell_visuals.ts, on its draped scorch mesh.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and deterministic (every crack is a
// hash of its index).

import { cannonHash01, cannonNoiseInto } from './cannon_puff_core';

export const CANNON_GROUND_MARK = {
  /**
   * What the mark takes from the ground under it at full strength, per channel:
   * about half the char's darkening, more of the blue than the red, so it reads
   * as a pale, dusty stain rather than a burn (and still shows on the dirt ring).
   */
  tint: [0.42, 0.47, 0.6],
  /** Seconds it holds before it starts to fade, and its whole life. */
  hold: 1,
  life: 6,
  /** Cracks running out from the foot. */
  cracks: 11,
} as const;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** The mark's strength, 0 to 1, `age` seconds after the slam. */
export function cannonGroundMarkFade(age: number): number {
  const { hold, life } = CANNON_GROUND_MARK;
  if (!(age >= 0) || age >= life) return 0;
  const rise = Math.min(1, age / 0.08);
  return rise * (1 - smoothstep((age - hold) / (life - hold)));
}

/**
 * The mark's texture, `size` square RGBA texels of how much each darkens the
 * ground: a faint trampled wash over the whole disc, a broken ring fracture
 * around the foot, and jagged cracks running out from the middle, forking once,
 * fading to nothing at the rim. The inner half lies under the tower, so the
 * cracks are widest where the camera sees them. Grey: the tint gives it its
 * colour.
 */
export function cannonCrackTexels(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const grain = cannonNoiseInto(new Float64Array(size * size), size, 9, 23, 1, 1);
  const count = CANNON_GROUND_MARK.cracks;
  const bearings = new Float64Array(count);
  const reaches = new Float64Array(count);
  const spreads = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    bearings[k] = ((k + 0.7 * cannonHash01(k, 3)) / count) * Math.PI * 2;
    reaches[k] = 0.7 + 0.24 * cannonHash01(k, 5);
    spreads[k] = 0.4 + 0.4 * cannonHash01(k, 7);
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const at = (j * size + i) * 4;
      data[at + 3] = 255;
      if (r >= 0.98) continue;
      const angle = Math.atan2(v, u);
      const wash = 0.22 * (1 - smoothstep((r - 0.6) / 0.35)) * (0.7 + 0.6 * grain[j * size + i]);
      let crack = 0;
      for (let k = 0; k < count; k++) {
        if (r > reaches[k]) continue;
        const wander = 0.06 * Math.sin(r * 13 + k * 1.7) + 0.025 * Math.sin(r * 29 + k * 4.1);
        const fork = r > 0.55 ? (r - 0.55) * spreads[k] : 0;
        const width = 0.05 * (1 - (0.55 * r) / reaches[k]);
        for (const side of fork > 0 ? [-1, 1] : [0]) {
          let gap = angle - bearings[k] - wander - side * fork;
          gap -= Math.round(gap / (Math.PI * 2)) * Math.PI * 2;
          const line = 1 - smoothstep((Math.abs(gap) * r - 0.4 * width) / (0.6 * width));
          if (line > crack) crack = line;
        }
      }
      const bend = 0.02 * Math.sin(angle * 7 + 0.4) + 0.015 * Math.sin(angle * 13 + 2.1);
      const ringGap = Math.abs(r - 0.52 - bend);
      const broken = Math.sin(angle * 5 + 1.3) + 0.6 * Math.sin(angle * 11) > -0.35 ? 1 : 0;
      const ring = broken * (1 - smoothstep((ringGap - 0.018) / 0.02));
      if (ring > crack) crack = ring;
      const amount = clamp01(wash + 0.9 * crack * (1 - smoothstep((r - 0.84) / 0.14)));
      const lum = Math.round(255 * amount);
      data[at] = lum;
      data[at + 1] = lum;
      data[at + 2] = lum;
    }
  }
  return data;
}
