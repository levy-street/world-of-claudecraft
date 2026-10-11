// Pure plans for the Buried Hoard boss dressing (src/render/hoard_boss_dressing.ts):
// the ice crystals that grow out of Hoarfrost's Treacherous Ice, the crawling
// arcs over Vharok's charged ground, and the lightning that wraps Vharok while
// Storm Surge stacks on him. DOM-free and Three-free so the numbers the look is
// built on are pinned by a Node test; the adapter only writes them to meshes.
//
// Dressing is COSMETIC: the actionable telegraph (the floor disc, its rim and
// its countdown) is hoard_boss_fx.ts and never depends on anything here, so a
// low graphics tier can shed all of this without hiding information.

/** Crystals around one ice patch. */
export const HOARD_ICE_SHARD_COUNT = 16;
/** Arcs crawling over one charged field. */
export const HOARD_STORM_ARC_COUNT = 12;
/** Points per arc polyline. */
export const HOARD_STORM_ARC_POINTS = 7;
/** Bolts that can wrap the surged boss at the stack cap. */
export const HOARD_SURGE_BOLT_COUNT = 10;
/** How often (Hz) arcs and bolts re-roll their shape: fast enough to crackle,
 *  slow enough to read as lightning rather than noise. */
export const HOARD_LIGHTNING_REROLL_HZ = 14;
/** The calm re-roll under reduced motion: the lightning still reads as alive,
 *  without the strobe. */
export const HOARD_LIGHTNING_CALM_HZ = 1.5;

/** A cheap deterministic hash in [0, 1): the dressing never touches Math.random,
 *  so a captured frame is reproducible and the test below can pin shapes. */
export function hoardHash(a: number, b: number, c = 0): number {
  let h =
    (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>>
    0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 0x1_0000_0000;
}

export interface HoardIceShardPlan {
  /** Position on the patch, as a fraction of its radius, and the facing. */
  angle: number;
  radiusFraction: number;
  /** Full-grown height and girth in yards, and the outward lean in radians. */
  height: number;
  girth: number;
  lean: number;
}

/** The fixed crown of crystals for a patch: a jagged rim with a few taller
 *  spires, leaning outward like frost heaved out of the ground. Seeded by the
 *  cue id so two patches never look stamped. */
export function hoardIceShards(cueId: number): HoardIceShardPlan[] {
  const out: HoardIceShardPlan[] = [];
  for (let index = 0; index < HOARD_ICE_SHARD_COUNT; index++) {
    const jitter = hoardHash(cueId, index, 1);
    const tall = hoardHash(cueId, index, 2) > 0.72;
    out.push({
      angle: ((index + jitter * 0.7) / HOARD_ICE_SHARD_COUNT) * Math.PI * 2,
      radiusFraction: 0.78 + hoardHash(cueId, index, 3) * 0.2,
      height: (tall ? 2.6 : 1.1) + hoardHash(cueId, index, 4) * (tall ? 1.4 : 0.9),
      girth: (tall ? 0.95 : 0.6) + hoardHash(cueId, index, 5) * 0.35,
      lean: 0.18 + hoardHash(cueId, index, 6) * 0.3,
    });
  }
  return out;
}

/** How grown the crystals are: they heave up through the warning (eased, so the
 *  last third snaps), stand full through the hazard, and sink as it fades. */
export function hoardIceGrowth(
  phase: 'warning' | 'hazard',
  remaining: number,
  total: number,
): number {
  const safeTotal = total > 0 ? total : 1;
  const progress = Math.max(0, Math.min(1, 1 - remaining / safeTotal));
  if (phase === 'warning') return progress * progress * (3 - 2 * progress) * 0.85;
  const fadeOut = Math.max(0, Math.min(1, remaining / 0.6));
  return 0.85 + 0.15 * Math.min(1, progress * 6) - (1 - fadeOut) * 0.85;
}

/** One jagged arc across a field: a chord between two rim points, its inner
 *  points displaced sideways. `bucket` is the re-roll tick. Returns flat x,z
 *  pairs as fractions of the field radius, written into `out` (a caller-owned
 *  scratch the adapter reuses, so a re-roll allocates nothing). */
export function hoardStormArc(
  cueId: number,
  arcIndex: number,
  bucket: number,
  out: number[] = [],
): number[] {
  const from = hoardHash(cueId, arcIndex, bucket) * Math.PI * 2;
  const sweep = (0.45 + hoardHash(cueId, arcIndex, bucket + 7) * 1.1) * Math.PI;
  const to = from + sweep;
  const reach = 0.55 + hoardHash(cueId, arcIndex, bucket + 13) * 0.4;
  const ax = Math.cos(from) * reach;
  const az = Math.sin(from) * reach;
  const bx = Math.cos(to) * reach;
  const bz = Math.sin(to) * reach;
  const nx = -(bz - az);
  const nz = bx - ax;
  out.length = 0;
  for (let point = 0; point < HOARD_STORM_ARC_POINTS; point++) {
    const t = point / (HOARD_STORM_ARC_POINTS - 1);
    // Pinned ends, a belly of displacement in the middle.
    const belly = Math.sin(t * Math.PI);
    const kick = (hoardHash(cueId * 31 + arcIndex, point, bucket) - 0.5) * 0.32 * belly;
    out.push(ax + (bx - ax) * t + nx * kick, az + (bz - az) * t + nz * kick);
  }
  return out;
}

export interface HoardSurgePlan {
  /** 0 at no stacks, 1 at the cap. */
  intensity: number;
  /** Bolts wrapping the boss right now. */
  bolts: number;
  /** Shell radius and height as multiples of the boss's own footprint. */
  shellScale: number;
  /** Shell opacity, with a fast electrical flutter on top of the intensity. */
  shellOpacity: number;
  /** Ground ring spin (radians per second). */
  ringSpin: number;
}

/** The charged look for `stacks` of Storm Surge. Nothing shows at zero. */
export function hoardSurgePlan(
  stacks: number,
  maxStacks: number,
  elapsed: number,
  calm = false,
): HoardSurgePlan {
  const cap = Math.max(1, maxStacks);
  const intensity = Math.max(0, Math.min(1, stacks / cap));
  if (intensity <= 0)
    return { intensity: 0, bolts: 0, shellScale: 1, shellOpacity: 0, ringSpin: 0 };
  // Reduced motion holds the shell steady: no flutter, no spin.
  const flutter = calm ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 23) * Math.sin(elapsed * 7.3);
  return {
    intensity,
    bolts: Math.max(2, Math.round(HOARD_SURGE_BOLT_COUNT * intensity)),
    shellScale: 1.05 + intensity * 0.35,
    shellOpacity: (0.12 + intensity * 0.3) * (0.7 + 0.3 * flutter),
    ringSpin: calm ? 0 : 1.2 + intensity * 4.5,
  };
}

/** One bolt climbing the surged boss: flat x,y,z triples in the boss's local
 *  frame (radius 1, height 1), a rising helix kicked sideways per point. */
export function hoardSurgeBolt(
  boltIndex: number,
  bucket: number,
  points: number,
  out: number[] = [],
): number[] {
  const start = hoardHash(boltIndex, bucket, 3) * Math.PI * 2;
  const twist = (hoardHash(boltIndex, bucket, 5) - 0.5) * 3.2;
  out.length = 0;
  for (let point = 0; point < points; point++) {
    const t = point / (points - 1);
    const angle = start + twist * t;
    const radius = 0.78 + (hoardHash(boltIndex * 17 + point, bucket, 9) - 0.5) * 0.5;
    out.push(Math.cos(angle) * radius, t, Math.sin(angle) * radius);
  }
  return out;
}
