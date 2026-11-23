// Pure geometry for Wake of the Fallen Star (mob/boss_starwake.ts): where the lava
// fissures run, where the geysers burst, and the proof that the ground between them is
// safe.
//
// Split out so every layer reads the same numbers: the sim decides damage with these
// functions, the renderer draws the same strips and circles from the same event fields,
// and a Vitest drives it directly. No SimContext, no rng, no clock: the caller draws the
// random rotation and jitter and hands them in, so the draw order lives in ONE place.
//
// Angles follow the rest of the boss kit: a direction `a` is the unit vector
// (sin a, cos a), so `Math.atan2(dirX, dirZ)` recovers it.

export interface StarwakePoint {
  x: number;
  z: number;
}

/** One fissure: a straight strip from `origin`, `length` yards down a unit direction. */
export interface StarwakeFissure {
  originX: number;
  originZ: number;
  dirX: number;
  dirZ: number;
  length: number;
}

/** A geyser circle (and, after it bursts, the molten pool it leaves). */
export interface StarwakeCircle {
  x: number;
  z: number;
  radius: number;
}

/** How the fissures are laid out for one cast. */
export interface StarwakeLayoutDef {
  /** Where the fallen star sits. */
  star: StarwakePoint;
  /** Closest and farthest the boss may stand from the star for the fissures to run FROM it. */
  starMinReach: number;
  starMaxReach: number;
  /** Star mode: this many fissures fanned over `fanDeg` degrees toward the boss. */
  fanCount: number;
  fanDeg: number;
  /** Star mode: how far past the boss the fissures run, and their length bounds. */
  reachPast: number;
  minLength: number;
  maxLength: number;
  /** Feet mode: this many fissures spread evenly round the boss, each this long. */
  ringCount: number;
  ringLength: number;
  /** Largest per-fissure angular wobble, degrees, either way. */
  jitterDeg: number;
}

export type StarwakeMode = 'star' | 'feet';

export interface StarwakeLayout {
  mode: StarwakeMode;
  origin: StarwakePoint;
  fissures: StarwakeFissure[];
}

const DEG = Math.PI / 180;

const dist2d = (a: StarwakePoint, b: StarwakePoint): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Which way the fissures run this cast.
 *
 * STAR: the boss fights within reach of his crater, so the fire comes out of the fallen
 * star itself and fans TOWARD him, through the fight. That is the lore read (the star
 * that woke him wakes again) and the fair one: the raid is looking at him, and the
 * fissures arrive from a place everyone can see lighting up.
 *
 * FEET: he has marched to a far picket (up to 88 yards out), where a fan from the crater
 * would be a hundred yards of strip that mostly crosses empty fen and reaches the fight
 * as two thin tips. There the star's fire runs under the fen and bursts out beneath HIM,
 * spreading evenly round his feet. Also used when he stands almost on the star, where
 * "toward him" has no direction.
 */
export function starwakeMode(def: StarwakeLayoutDef, boss: StarwakePoint): StarwakeMode {
  const d = dist2d(boss, def.star);
  return d >= def.starMinReach && d <= def.starMaxReach ? 'star' : 'feet';
}

/** How many jitter draws a layout takes (one per fissure), so the caller can draw them. */
export function starwakeFissureCount(def: StarwakeLayoutDef, mode: StarwakeMode): number {
  return mode === 'star' ? def.fanCount : def.ringCount;
}

/**
 * Lay the fissures out.
 *
 * `turn` in [0, 1) rotates the whole pattern: in star mode it slides the fan by up to one
 * gap either way (so the boss is sometimes in a lane and sometimes on a fissure), in feet
 * mode it spins the ring through one full gap. `jitter[i]` in [-1, 1] wobbles fissure i by
 * up to `jitterDeg`. Both are the caller's rng draws, handed in, so this stays pure.
 */
export function starwakeLayout(
  def: StarwakeLayoutDef,
  boss: StarwakePoint,
  turn: number,
  jitter: readonly number[],
): StarwakeLayout {
  const mode = starwakeMode(def, boss);
  const fissures: StarwakeFissure[] = [];
  if (mode === 'star') {
    const toBoss = Math.atan2(boss.x - def.star.x, boss.z - def.star.z);
    const n = Math.max(2, def.fanCount);
    const gap = (def.fanDeg * DEG) / (n - 1);
    const slide = (turn - 0.5) * gap;
    const length = Math.min(
      def.maxLength,
      Math.max(def.minLength, dist2d(boss, def.star) + def.reachPast),
    );
    for (let i = 0; i < n; i++) {
      const a = toBoss + (i - (n - 1) / 2) * gap + slide + (jitter[i] ?? 0) * def.jitterDeg * DEG;
      fissures.push(fissureAt(def.star, a, length));
    }
    return { mode, origin: { x: def.star.x, z: def.star.z }, fissures };
  }
  const n = Math.max(2, def.ringCount);
  const gap = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a = (turn + i) * gap + (jitter[i] ?? 0) * def.jitterDeg * DEG;
    fissures.push(fissureAt(boss, a, def.ringLength));
  }
  return { mode, origin: { x: boss.x, z: boss.z }, fissures };
}

function fissureAt(origin: StarwakePoint, angle: number, length: number): StarwakeFissure {
  return {
    originX: origin.x,
    originZ: origin.z,
    dirX: Math.sin(angle),
    dirZ: Math.cos(angle),
    length,
  };
}

/** Whether a point is inside a fissure's strip (which starts AT its origin). */
export function insideFissure(
  f: StarwakeFissure,
  halfWidth: number,
  x: number,
  z: number,
): boolean {
  const dx = x - f.originX;
  const dz = z - f.originZ;
  const along = dx * f.dirX + dz * f.dirZ;
  if (along < 0 || along > f.length) return false;
  return Math.abs(dx * f.dirZ - dz * f.dirX) <= halfWidth;
}

/** Whether a point is inside a circle (geyser or pool). */
export function insideCircle(c: StarwakeCircle, x: number, z: number): boolean {
  return Math.hypot(x - c.x, z - c.z) <= c.radius;
}

/** Where each fissure's own geyser bursts: `fraction` of the way down it. */
export function fissureGeyserCenters(
  fissures: readonly StarwakeFissure[],
  fraction: number,
): StarwakePoint[] {
  return fissures.map((f) => ({
    x: f.originX + f.dirX * f.length * fraction,
    z: f.originZ + f.dirZ * f.length * fraction,
  }));
}

/**
 * The SAFE LANES: one per gap between neighbouring fissures, as the unit direction that
 * splits the gap (from the layout's origin) and the gap's half-angle in radians. In feet
 * mode the ring wraps, so the last fissure's gap with the first is a lane too; in star
 * mode the two outer flanks of the fan are open ground and are not listed.
 */
export function starwakeLanes(
  layout: StarwakeLayout,
): { dirX: number; dirZ: number; halfAngle: number }[] {
  const angles = layout.fissures.map((f) => Math.atan2(f.dirX, f.dirZ)).sort((a, b) => a - b);
  const lanes: { dirX: number; dirZ: number; halfAngle: number }[] = [];
  const pairs = layout.mode === 'feet' ? angles.length : angles.length - 1;
  for (let i = 0; i < pairs; i++) {
    const a = angles[i];
    let b = angles[(i + 1) % angles.length];
    if (b <= a) b += Math.PI * 2;
    const mid = (a + b) / 2;
    lanes.push({ dirX: Math.sin(mid), dirZ: Math.cos(mid), halfAngle: (b - a) / 2 });
  }
  return lanes;
}

/**
 * The nearest distance from the origin at which a lane is wider than the fissures either
 * side of it: past this, a player standing on the lane's centre line is outside both
 * strips. `halfWidth / sin(halfAngle)`.
 */
export function laneClearDistance(halfAngle: number, halfWidth: number): number {
  const s = Math.sin(Math.max(1e-6, halfAngle));
  return halfWidth / s;
}

/**
 * The nearest point to `from` that no hazard covers: outside every fissure strip and
 * every circle. Searched on rings of growing radius, eight bearings then more, so the
 * answer is deterministic and cheap. Null if nothing within `maxRadius` is clear, which
 * the layout rules make impossible for the shipped numbers (tests pin it).
 */
export function nearestSafeSpot(
  from: StarwakePoint,
  fissures: readonly StarwakeFissure[],
  halfWidth: number,
  circles: readonly StarwakeCircle[],
  maxRadius: number,
  step = 0.5,
): StarwakePoint | null {
  const clear = (x: number, z: number): boolean =>
    !fissures.some((f) => insideFissure(f, halfWidth, x, z)) &&
    !circles.some((c) => insideCircle(c, x, z));
  if (clear(from.x, from.z)) return { x: from.x, z: from.z };
  for (let r = step; r <= maxRadius + 1e-9; r += step) {
    const bearings = Math.max(8, Math.ceil((Math.PI * 2 * r) / step));
    for (let i = 0; i < bearings; i++) {
      const a = (i / bearings) * Math.PI * 2;
      const x = from.x + Math.sin(a) * r;
      const z = from.z + Math.cos(a) * r;
      if (clear(x, z)) return { x, z };
    }
  }
  return null;
}
