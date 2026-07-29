// Host-agnostic half of the weapon-skin emissive derivation (weapon_vfx.ts).
//
// The skin generator paints a weapon's "magic" (core, runes, cracks) straight
// into the albedo. The rig turns those painted texels into a graded emissive
// map and de-bakes the same texels out of the albedo, so exactly the painted
// parts light up and bloom instead of the lighting and the emission doubling
// up into a flat white patch.
//
// That transform is a PURE function of (source RGBA, resolved emissive spec):
// no canvas, no Three, no wall clock. It lives here so a Vitest can drive the
// per-texel math on small synthetic buffers, and so weapon_vfx.ts keeps only
// the canvas plumbing around it. The identity of that pure function is also
// the memo key the caller caches derived textures under: one derivation per
// (source map, resolved spec) per session, shared across every wearer, payload
// and rebuild, instead of a 262144-texel loop inside the frame a skinned
// player comes into view.

/** The window that decides which texels glow. Shaped structurally so
 *  `WeaponVfxEmissiveSpec` satisfies it without this core importing it. */
export interface WeaponEmissiveWindow {
  /** Inclusive hue window in degrees, [low, high]. */
  hue: readonly [number, number];
  /** Minimum HSL saturation inside the hue window. */
  minS: number;
  /** Minimum HSL lightness inside the hue window. */
  minL: number;
  /** Lightness at which a near-white texel picks up a residual glow. */
  whiteL: number;
  /** How much of the score a near-white texel keeps. */
  whiteScale: number;
}

/** Working-color-space tint the derived emissive is graded toward (0..1 per
 *  channel). The caller converts the spec's sRGB hex; color management is
 *  Three's job, never this core's. */
export interface WeaponEmissiveTint {
  r: number;
  g: number;
  b: number;
}

/** Every field of the resolved emissive spec, for the memo signature. */
export interface WeaponEmissiveSignatureSpec extends WeaponEmissiveWindow {
  tint: number;
  intensity: number;
  pulse: number;
  pulseHz: number;
}

/**
 * Grade `emissive` into the emissive map and de-bake `albedo` in place. Both
 * buffers arrive holding the SAME source pixels (the caller draws the albedo
 * twice); `emissive.length` drives the walk, and alpha is left untouched in
 * both. Values are byte-identical to the loop this was lifted from.
 */
export function deriveEmissiveTexels(
  emissive: Uint8ClampedArray,
  albedo: Uint8ClampedArray,
  emissiveWindow: WeaponEmissiveWindow,
  tint: WeaponEmissiveTint,
): void {
  const d = emissive;
  const ad = albedo;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let hue = 0;
    let s = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      s = dd / (1 - Math.abs(2 * l - 1));
      if (mx === r) hue = 60 * (((g - b) / dd + 6) % 6);
      else if (mx === g) hue = 60 * ((b - r) / dd + 2);
      else hue = 60 * ((r - g) / dd + 4);
    }
    let score = 0;
    if (
      hue >= emissiveWindow.hue[0] &&
      hue <= emissiveWindow.hue[1] &&
      s >= emissiveWindow.minS &&
      l >= emissiveWindow.minL
    ) {
      score =
        Math.min(1, 0.45 + (s - emissiveWindow.minS) * 1.4) *
        Math.min(1, 0.5 + (l - emissiveWindow.minL) * 1.3);
    } else if (
      l >= emissiveWindow.whiteL &&
      (s < 0.14 || (hue >= emissiveWindow.hue[0] && hue <= emissiveWindow.hue[1]))
    ) {
      score = emissiveWindow.whiteScale * Math.min(1, 0.4 + (l - emissiveWindow.whiteL) * 4);
    }
    if (score <= 0.01) {
      d[i] = d[i + 1] = d[i + 2] = 0;
    } else {
      // Graded: source color pushed toward the tier tint, scaled by score.
      d[i] = Math.round(255 * Math.min(1, (r + (tint.r - r) * 0.62) * score));
      d[i + 1] = Math.round(255 * Math.min(1, (g + (tint.g - g) * 0.62) * score));
      d[i + 2] = Math.round(255 * Math.min(1, (b + (tint.b - b) * 0.62) * score));
      // De-bake: pull the albedo down where the glow now lives.
      const keep = 1 - 0.72 * score;
      ad[i] = Math.round(ad[i] * keep);
      ad[i + 1] = Math.round(ad[i + 1] * keep);
      ad[i + 2] = Math.round(ad[i + 2] * keep);
    }
  }
}

/**
 * Stable signature of a resolved emissive spec. Deliberately covers EVERY
 * field, not only the five the walk above reads: a spec whose glow pulse or
 * intensity differs is a different authored look, and keying on the whole
 * record means a future field that does shape texels can never serve a stale
 * cached texture. The cost of the extra strictness is at most one more
 * derivation per weapon.
 */
export function weaponEmissiveSignature(spec: WeaponEmissiveSignatureSpec): string {
  return [
    spec.hue[0],
    spec.hue[1],
    spec.minS,
    spec.minL,
    spec.whiteL,
    spec.whiteScale,
    spec.tint,
    spec.intensity,
    spec.pulse,
    spec.pulseHz,
  ].join(':');
}

/**
 * Memo key for one derived (emissive, de-baked albedo) texture pair.
 * `sourceId` identifies the source albedo map (its texture uuid): two players
 * wearing the same skin, and the two hands of a mirrored offhand, share one
 * source texture instance and therefore one derivation.
 */
export function weaponEmissiveCacheKey(
  sourceId: string,
  spec: WeaponEmissiveSignatureSpec,
): string {
  return `${sourceId}|${weaponEmissiveSignature(spec)}`;
}
