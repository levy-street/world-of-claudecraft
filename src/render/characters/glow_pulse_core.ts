// A body's own emissive glow map flared by presentation gestures
// (VisualDef.glowPulses), the pure half of glow_pulse.ts.
//
// The Gorgebloom is the reference: its GLB ships an emissive map that lights
// only the gullet and the four pollen sacs. The gullet should swell to a
// furnace through the Seed Rain bar and the Gorge's gape, the sacs blaze as
// Pollinate bursts them, and the whole glow die as the flower wilts. A gesture
// (the renderer's triggerAttack seam) starts a pulse; the pulse multiplies the
// material's authored emissive intensity by an envelope (rise, hold, fall up
// to `peak`); pulses that overlap add their excess. A dead body fades the
// glow out over `deathFade` seconds and keeps it dark.
//
// Cosmetic only. Data, not a Gorgebloom branch: any body with an emissive map
// can name pulses. Node-only (RENDER_PURE_CORES): no three.js, no DOM.

export interface GlowPulseDef {
  /** The gesture id that starts the pulse. */
  gesture: string;
  /** Seconds after the gesture before the rise starts. */
  delay?: number;
  rise: number;
  hold: number;
  fall: number;
  /** The emissive multiplier at the top of the envelope (1 = authored). */
  peak: number;
}

export interface GlowPulseSet {
  pulses: readonly GlowPulseDef[];
  /** Material names (as shipped in the GLB) that glow WITHOUT an emissive map:
   *  a body whose light is its own untextured emissive material (lightning
   *  conduits, an eye, coil arcs). */
  materials?: readonly string[];
  /** Seconds a dead body takes to go dark (absent: the glow stays on). */
  deathFade?: number;
}

/** Does the set flare a material of this name and shape (an emissive map, or
 *  one of its named untextured glow materials)? */
export function glowPulseTakes(set: GlowPulseSet, name: string, hasEmissiveMap: boolean): boolean {
  return hasEmissiveMap || (set.materials?.includes(name) ?? false);
}

/** The share of a pulse's excess `age` seconds after its gesture (0..1). */
export function glowPulseEnvelope(p: GlowPulseDef, age: number): number {
  const t = age - (p.delay ?? 0);
  if (t < 0) return 0;
  if (t < p.rise) return p.rise > 0 ? t / p.rise : 1;
  const afterRise = t - p.rise;
  if (afterRise <= p.hold) return 1;
  const intoFall = afterRise - p.hold;
  if (intoFall >= p.fall) return 0;
  const k = 1 - intoFall / Math.max(1e-6, p.fall);
  // Ease out of the flare: fast first, a long ember after.
  return k * k;
}

/** Seconds from a pulse's gesture until it is spent. */
export function glowPulseSpan(p: GlowPulseDef): number {
  return (p.delay ?? 0) + p.rise + p.hold + p.fall;
}

/** Every pulse a gesture starts (indices into `set.pulses`). */
export function glowPulsesFor(set: GlowPulseSet, gesture: string, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < set.pulses.length; i++) if (set.pulses[i].gesture === gesture) out.push(i);
  return out;
}

/**
 * The emissive multiplier: 1 plus every live pulse's excess, times the death
 * fade. `ages[i]` is seconds since pulse i started, or a negative number when
 * it is not running; `deadFor` is seconds since death, or a negative number
 * while alive.
 */
export function glowPulseLevel(
  set: GlowPulseSet,
  ages: ArrayLike<number>,
  deadFor: number,
): number {
  let level = 1;
  for (let i = 0; i < set.pulses.length; i++) {
    const age = ages[i];
    if (age === undefined || age < 0) continue;
    const p = set.pulses[i];
    level += (p.peak - 1) * glowPulseEnvelope(p, age);
  }
  if (deadFor >= 0 && set.deathFade !== undefined) {
    const k = set.deathFade > 0 ? Math.max(0, 1 - deadFor / set.deathFade) : 0;
    level *= k * k;
  }
  return Math.max(0, level);
}
