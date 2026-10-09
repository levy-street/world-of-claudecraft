// The shared look of every dungeon floor telegraph (cones, rings, lanes and
// the kick glyphs), as pure numbers: the threat palette every mob and boss
// draws from, and the per-frame intensities of each layer of the shader
// (telegraph_material.ts) as a cast's bar runs. Used by the Hollow Crypt and
// Sunken Bastion painters and the Bastion's boss casts, so a cone reads the
// same in every dungeon.
//
// Presentation only: the timing a player reads is the sim's own cast bar
// (castRemaining / castTotal), untouched here; this only decides how bright
// each layer draws at that fill.
//
// Three-free, DOM-free, deterministic.

/** What standing in the shape costs you. The colour is the threat, never the
 *  school: a player learns four colours, not one per element. */
export type TelegraphThreat = 'danger' | 'lethal' | 'control' | 'interrupt';

/** One hue per threat, brighter than any dungeon dressing (the floor ladder rule). */
export const TELEGRAPH_THREAT_COLORS: Readonly<Record<TelegraphThreat, number>> = {
  // Avoidable damage: cleaves, sweeps, slams, bolts, death bursts.
  danger: 0xff6a2a,
  // A boss's signature hit: the one that kills if you stay.
  lethal: 0xff2d44,
  // Crowd control: a stun or a knockdown, not damage.
  control: 0xb67bff,
  // Kick the caster: a heal or a ward you should interrupt.
  interrupt: 0xffc83a,
};

/** The element's own flavour, carried by the motes and the fill front only
 *  (never the rim or the body, which carry the threat). */
export const TELEGRAPH_ACCENTS = {
  physical: 0xffe0b0,
  frost: 0xbff0ff,
  brine: 0x8dffe0,
  shadow: 0xa6ffcf,
  bone: 0xfff2d6,
  holy: 0xfff6c4,
  // The Hollow Crypt drake's spectral Barrowflame: ghost fire, green-white.
  ghostfire: 0xa8ff6a,
} as const;

/** Fill of a telegraph in [0, 1]: 0 as the bar opens, 1 as it lands. */
export function telegraphFillOf(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/** When the last-moment warning starts (fraction of the bar). */
export const TELEGRAPH_WARN_FROM = 0.72;

export interface TelegraphLook {
  /** The dim tint of the whole shape (always on: the footprint). */
  base: number;
  /** The swept, filled part behind the fill front. */
  filled: number;
  /** The bright leading edge of the fill (the timing a player reads). */
  front: number;
  /** The crisp outline (always on, on every tier). */
  rim: number;
  /** 0..1 warning pulse over the bar's last stretch. */
  warn: number;
  /** Cosmetic layers (flowing bands, motes, the edge curtain): 0 on the low
   *  tier, never carrying anything a player must read. */
  detail: number;
}

/**
 * Layer intensities at `fill` of the bar, `clock` seconds in, written into
 * `out` (a painter passes one reused object: no per-frame allocation). The
 * rim and the fill front never drop below a readable floor on any tier; the
 * warning pulse speeds up as the bar ends, and `detail` gates only the
 * cosmetic layers.
 */
export function telegraphLook(
  fill: number,
  clock: number,
  detailOn: boolean,
  out: TelegraphLook = { base: 0, filled: 0, front: 0, rim: 0, warn: 0, detail: 0 },
): TelegraphLook {
  const f = Math.min(1, Math.max(0, fill));
  const late = Math.max(0, (f - TELEGRAPH_WARN_FROM) / (1 - TELEGRAPH_WARN_FROM));
  const rate = 10 + late * 16;
  out.base = 0.13 + 0.05 * f;
  out.filled = 0.2 + 0.12 * f;
  out.front = f > 0 && f < 1 ? 0.75 : 0;
  out.rim = 0.9;
  out.warn = late > 0 ? late * (0.5 + 0.5 * Math.sin(clock * rate)) : 0;
  out.detail = detailOn ? 1 : 0;
  return out;
}

/** Height of the glowing curtain standing on a telegraph's edge (yards). */
export const TELEGRAPH_CURTAIN_HEIGHT = 0.7;

/**
 * The outline of a unit fan about +z (a cone of `arcDeg`, or the full circle
 * at 360) as stations for the edge curtain: the arc, then for a cone its two
 * flanks back to the apex, each station with its running length along the
 * outline (unit radius). A closed ring repeats its first station at the end.
 */
export function telegraphOutline(
  arcDeg: number,
  arcSegments: number,
  flankSegments: number,
): { points: [number, number][]; along: number[] } {
  const cone = arcDeg < 360;
  const half = (Math.min(360, arcDeg) * Math.PI) / 180 / 2;
  const points: [number, number][] = [];
  if (cone) {
    for (let i = 0; i <= flankSegments; i++) {
      const t = i / flankSegments;
      points.push([Math.sin(-half) * t, Math.cos(-half) * t]);
    }
  }
  for (let i = cone ? 1 : 0; i <= arcSegments; i++) {
    const a = -half + (2 * half * i) / arcSegments;
    points.push([Math.sin(a), Math.cos(a)]);
  }
  if (cone) {
    for (let i = flankSegments - 1; i >= 0; i--) {
      const t = i / flankSegments;
      points.push([Math.sin(half) * t, Math.cos(half) * t]);
    }
  }
  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    along.push(along[i - 1] + Math.hypot(bx - ax, bz - az));
  }
  return { points, along };
}
