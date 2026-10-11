// Bonelord Xarreth's two arena mechanics, as pure shared choreography: the
// authoritative sim and the renderer both read these functions, so the blade a
// player sees is exactly the blade that hits.
//
// WANDERING SCYTHE. A giant bone scythe spins about a pivot while the pivot
// itself travels the room along a closed-form path. Two transforms at once:
//   pivot(t)  = anchor + path(u(t))           (translation, scythePivot)
//   blade(t)  = facing + dir * spin(t)        (rotation, scytheAngle)
// The dangerous region is the BLADE: an annular sector out at the end of the
// shaft. Inside the inner radius (hugging the moving pivot) and beyond the reach
// are both safe, and so is the rest of the ring until the blade comes round.
// Nobody jumps it; it is read and walked around.
//
// SOUL HARVEST. Souls appear around the room, hold a moment, then are drawn in
// a straight line to the boss. A player who reaches one releases it; one that
// arrives is absorbed for a stack of Harvested Soul.
//
// Everything rides the ordinary hoard cue wire with no new fields:
//   scythe carrier  kind 'sweep', variant 'bone-scythe'
//                   x,z = anchor (the boss's post), facing = blade start angle,
//                   radius = lateral span W (negative = the route mirrored, for
//                   the second scythe of a pair), halfAngle = forward sign * depth,
//                   pattern = cue id % patterns (the ember-meteor precedent)
//   harvest carrier kind 'sweep', variant 'bone-harvest' (x,z = the boss)
//   one soul        kind 'mark', variant 'bone-soul', x,z = where it appears,
//                   radius = its interception radius (no targetId: see the sim),
//                   total = its whole life (appear + hold + travel)

/** The three cue variants these mechanics own. ONE list: the sim routes them to
 *  hoard_bone_reaper.ts, hoard_bone_reaper.ts (render) draws them, and the generic
 *  floor telegraph skips exactly these, so a future bone-* cue can never fall
 *  between the two painters undrawn. */
export const BONE_REAPER_CUE_VARIANTS = ['bone-scythe', 'bone-harvest', 'bone-soul'] as const;
export function isBoneReaperVariant(variant: string | undefined): boolean {
  return (BONE_REAPER_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

/** The boss's stack buff: read by the renderer for his empowered look. */
export const HOARD_HARVESTED_SOUL_AURA_ID = 'hoard_harvested_soul';

export const BONE_SCYTHE = Object.freeze({
  /** The boss channels; the scythe assembles and spins up. Harmless. */
  castSec: 1.4,
  /** How long the blade wanders the room at full speed. */
  activeSec: 13,
  /** It slows, destabilises and breaks apart. Harmless. */
  endSec: 1.1,
  /** Seconds per full turn at speed. */
  rotationPeriod: 3.4,
  /** +1 turns the blade the way scytheAngle increases (counter-clockwise from above). */
  rotationDirection: 1 as 1 | -1,
  /** Pivot to blade tip, yards: how far the hazard reaches. */
  reach: 8.6,
  /** Pivot to the blade's heel: inside this the shaft passes overhead harmlessly. */
  bladeInner: 5.0,
  /** The blade's arc, radians, LEADING the shaft in the direction of the turn. */
  bladeArc: 0.62,
  /** A little tolerance behind the shaft, so the hit never lags the visible edge. */
  bladeTrail: 0.08,
  /** One sweep hits a player once; the next pass is a full turn away. */
  hitCooldownSec: 1.6,
  damageFraction: 0.3,
  /** Thrown outward from the pivot, so a hit also gets the player out. */
  knockback: 5,
  /** Seconds the pivot takes to reach speed and to stop: weight, not a rotor. */
  easeSec: 1.6,
  patterns: 3,
  /** Yards kept between the blade tip and the boss's post at the path's nearest. */
  bossClearance: 2,
  /** A second blade rides with the first from this many living players. */
  pairMinPlayers: 3,
  /** Room the path must leave between the blade tip and the wall. */
  wallMargin: 2.5,
  minLateral: 3,
  /** Caps the route's width, and with it the pivot's pace: at 9 the three routes
   *  average about 3.5 to 4.5 yards a second, well under a player's run. */
  maxLateral: 9,
  /** A second, mirrored scythe needs at least this much lateral room to stay readable. */
  pairMinLateral: 6,
  minDepth: 16,
  maxDepth: 30,
  /** The blade's routes never run further than this from him: he is the fight,
   *  and a blade that wandered to the far end of the room was no threat (playtest). */
  pathDepth: 20,
});

export const BONE_SCYTHE_TOTAL_SEC =
  BONE_SCYTHE.castSec + BONE_SCYTHE.activeSec + BONE_SCYTHE.endSec;

export type BoneScythePhase = 'summon' | 'active' | 'ending' | 'done';

export function scythePhase(elapsed: number): BoneScythePhase {
  if (elapsed < BONE_SCYTHE.castSec) return 'summon';
  if (elapsed < BONE_SCYTHE.castSec + BONE_SCYTHE.activeSec) return 'active';
  if (elapsed < BONE_SCYTHE_TOTAL_SEC) return 'ending';
  return 'done';
}

export function scythePatternOf(cueId: number): number {
  return ((cueId % BONE_SCYTHE.patterns) + BONE_SCYTHE.patterns) % BONE_SCYTHE.patterns;
}

/** Turns completed by `elapsed`, as an angle: it spins up over the cast, holds
 *  its speed while it wanders, and runs down as it breaks apart. Closed form,
 *  so any two hosts agree to the bit. */
export function scytheSpin(elapsed: number): number {
  const omega = (Math.PI * 2) / BONE_SCYTHE.rotationPeriod;
  const cast = BONE_SCYTHE.castSec;
  const activeEnd = cast + BONE_SCYTHE.activeSec;
  const t = Math.max(0, Math.min(BONE_SCYTHE_TOTAL_SEC, elapsed));
  // Spin-up: angular speed rises linearly 0 -> omega, so the angle is a parabola.
  if (t <= cast) return (omega * t * t) / (2 * cast);
  const atCast = (omega * cast) / 2;
  if (t <= activeEnd) return atCast + omega * (t - cast);
  // Run-down: speed falls linearly to 40 percent of omega by the end.
  const s = t - activeEnd;
  const k = (0.6 * omega) / BONE_SCYTHE.endSec;
  return atCast + omega * BONE_SCYTHE.activeSec + omega * s - (k * s * s) / 2;
}

/** The shaft's world angle (the same convention as Entity.facing: 0 looks +z). */
export function scytheAngle(facing: number, elapsed: number): number {
  return facing + BONE_SCYTHE.rotationDirection * scytheSpin(elapsed);
}

/** Path progress 0..1 with a weighted start and stop: it leans into motion over
 *  easeSec and settles the same way, never snapping. */
export function scytheProgress(elapsed: number): number {
  const active = BONE_SCYTHE.activeSec;
  const t = Math.max(0, Math.min(active, elapsed - BONE_SCYTHE.castSec));
  const e = Math.min(BONE_SCYTHE.easeSec, active / 2);
  // Trapezoid speed profile, integrated: area under it normalised to 1.
  const cruise = active - e;
  const area = (x: number): number => {
    if (x <= e) return (x * x) / (2 * e);
    if (x <= active - e) return e / 2 + (x - e);
    const r = active - x;
    return cruise - (r * r) / (2 * e);
  };
  return area(t) / cruise;
}

export interface BoneScytheFrame {
  /** Lateral half-extent the pivot may use, yards. */
  lateral: number;
  /** +1 when the room opens toward +z from the boss, -1 toward -z. */
  forwardSign: 1 | -1;
  /** How far in front of the boss the pivot may range, yards. */
  depth: number;
}

/** Pack the frame into the two spare numbers of the carrier cue. */
export function encodeScytheFrame(frame: BoneScytheFrame): { radius: number; halfAngle: number } {
  return { radius: frame.lateral, halfAngle: frame.forwardSign * frame.depth };
}

export function decodeScytheFrame(radius: number, halfAngle: number): BoneScytheFrame {
  return {
    // A NEGATIVE lateral is a mirrored route (the second scythe of a pair): the
    // path maths takes it as is, so left and right simply swap.
    lateral: radius,
    // Object.is: a -1 sign on a zero depth packs as -0, which `< 0` would lose.
    forwardSign: halfAngle < 0 || Object.is(halfAngle, -0) ? -1 : 1,
    depth: Math.abs(halfAngle),
  };
}

/** Size a frame to the room: `halfWidth` is the room's half-width in front of
 *  the boss, `clearDepth` how far that width holds. */
export function scytheFrameFor(
  halfWidth: number,
  clearDepth: number,
  forwardSign: 1 | -1,
): BoneScytheFrame {
  const lateral = Math.max(
    BONE_SCYTHE.minLateral,
    Math.min(BONE_SCYTHE.maxLateral, halfWidth - BONE_SCYTHE.reach - BONE_SCYTHE.wallMargin),
  );
  const depth = Math.max(BONE_SCYTHE.minDepth, Math.min(BONE_SCYTHE.maxDepth, clearDepth));
  return { lateral, forwardSign, depth };
}

/** The pivot's offset from the anchor at path progress `u`, in the boss's frame:
 *  `x` lateral, `f` forward (away from the boss, into the room). Three readable
 *  routes; none aims at a player, and all keep the blade off the boss's post. */
const PATH_SCRATCH = { x: 0, f: 0 };

export function scythePathPoint(
  pattern: number,
  u: number,
  frame: BoneScytheFrame,
  out: { x: number; f: number } = { x: 0, f: 0 },
): { x: number; f: number } {
  const w = frame.lateral;
  // The nearest the PIVOT comes to the boss keeps the blade tip off his post AND
  // off the melee standing on him: whoever holds the boss is never swept for it.
  const near = BONE_SCYTHE.reach + BONE_SCYTHE.bossClearance;
  const far = Math.max(near + 6, Math.min(frame.depth, BONE_SCYTHE.pathDepth));
  const mid = (near + far) / 2;
  const span = (far - near) / 2;
  const tau = Math.PI * 2;
  if (pattern === 0) {
    // Serpentine: one full weave side to side as it walks away down the room.
    out.x = w * Math.sin(tau * u);
    out.f = near + (far - near) * u;
    return out;
  }
  if (pattern === 1) {
    // Grand loop: one slow circuit of the room, starting and ending by the boss.
    out.x = w * Math.sin(tau * u);
    out.f = mid - span * Math.cos(tau * u);
    return out;
  }
  // Figure of eight across the middle of the room.
  out.x = w * Math.sin(tau * u);
  out.f = mid + span * 0.6 * Math.sin(tau * 2 * u);
  return out;
}

/** The pivot's WORLD position at `elapsed`. Pass `out` to reuse an object (the
 *  renderer does, every frame). */
export function scythePivot(
  anchorX: number,
  anchorZ: number,
  pattern: number,
  frame: BoneScytheFrame,
  elapsed: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const p = scythePathPoint(pattern, scytheProgress(elapsed), frame, PATH_SCRATCH);
  out.x = anchorX + p.x;
  out.z = anchorZ + frame.forwardSign * p.f;
  return out;
}

/** Is `point` under the blade right now? The blade is the annular sector from
 *  bladeInner to reach, leading the shaft by bladeArc in the direction of the turn. */
export function pointInScytheBlade(
  pivot: { x: number; z: number },
  shaftAngle: number,
  point: { x: number; z: number },
): boolean {
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < BONE_SCYTHE.bladeInner * BONE_SCYTHE.bladeInner) return false;
  if (d2 > BONE_SCYTHE.reach * BONE_SCYTHE.reach) return false;
  // Angle of the point AHEAD of the shaft, measured the way the blade turns.
  const tau = Math.PI * 2;
  let ahead = (Math.atan2(dx, dz) - shaftAngle) * BONE_SCYTHE.rotationDirection;
  ahead = ((ahead % tau) + tau) % tau;
  if (ahead > Math.PI) ahead -= tau;
  return ahead >= -BONE_SCYTHE.bladeTrail && ahead <= BONE_SCYTHE.bladeArc;
}

// ---------------------------------------------------------------------------

export const SOUL_HARVEST = Object.freeze({
  /** The boss channels and the souls take shape where they will start. */
  castSec: 1.6,
  /** They hold, brighten and turn toward him before they move. */
  holdSec: 0.9,
  /** Souls for a lone player, and one more for each player after the first. The
   *  hoard's rarity adds its own (hoard_scaling.ts `extra`). */
  soloCount: 3,
  perExtraPlayer: 1,
  minCount: 2,
  maxCount: 8,
  /** Yards per second once drawn, before the hoard's rarity presses it. */
  speed: 4.4,
  /** A player this close releases the soul. Generous: no pixel hunting. */
  interactionRadius: 2.4,
  /** A soul this close to the boss is his. */
  absorbRadius: 2.6,
  /** No soul starts nearer the boss than this. */
  minSpawnDistance: 14,
  /** Nor nearer another soul than this: they are never all in one place. */
  minSeparation: 9,
  /** Nor nearer a player than this, so none is released by accident on arrival. */
  playerClearance: 6,
  /** Yards kept between a soul's start and the wall. */
  wallMargin: 2.5,
  damagePerStack: 0.06,
  maxStacks: 8,
  /** A stack's life, refreshed by every new one. */
  stackDurationSec: 45,
  /** Releasing a soul BURDENS whoever did it: they take this much more damage
   *  per stack. One player cannot simply sweep the room; a party shares them out,
   *  and a lone player chooses which to take and which to let him have. */
  burdenPerStack: 0.08,
  /** Alone there is nobody to share them out with: a lone player's burden is lighter. */
  soloBurdenPerStack: 0.03,
  burdenMaxStacks: 6,
  burdenDurationSec: 20,
  /** Releasing a soul can also repay the player (off for now; the hook is live). */
  playerRewardEnabled: false,
  playerRewardHealFraction: 0.03,
});

/** The burden a released soul lays on the player who released it. */
export const HOARD_SOUL_BURDEN_AURA_ID = 'hoard_soul_burden';

/** Souls for `livingPlayers`, pressed by the hoard's rarity (`extra`). */
export function soulCountFor(livingPlayers: number, extra = 0): number {
  const byHeads =
    SOUL_HARVEST.soloCount + Math.max(0, livingPlayers - 1) * SOUL_HARVEST.perExtraPlayer;
  return Math.max(SOUL_HARVEST.minCount, Math.min(SOUL_HARVEST.maxCount, byHeads + extra));
}

/** A cheap integer hash to [0, 1): deterministic, no rng draw. */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Where the souls appear, in the boss's frame (`x` lateral, `f` forward into the
 *  room): scattered over the WHOLE room, near walls and far end included, at
 *  mixed distances so they arrive at different times and have to be chosen
 *  between. Each takes its own slice of the compass (so they surround the room
 *  rather than bunch), a seeded distance within it, and is nudged until it is
 *  clear of the boss and of every soul already placed. `halfWidth` is the room's
 *  half-width and `clearDepth` how far it was measured clear. */
export function soulSpawnOffsets(
  count: number,
  seed: number,
  frame: BoneScytheFrame,
  halfWidth = frame.lateral + BONE_SCYTHE.reach + BONE_SCYTHE.wallMargin,
  clearDepth = frame.depth + BONE_SCYTHE.reach,
): Array<{ x: number; f: number }> {
  const maxX = Math.max(4, halfWidth - SOUL_HARVEST.wallMargin);
  // Never past the depth the room was MEASURED clear to: a soul behind the far
  // wall cannot be caught, which would hand the boss a free stack.
  const far = Math.min(
    Math.max(SOUL_HARVEST.minSpawnDistance + 8, frame.depth + BONE_SCYTHE.reach),
    Math.max(SOUL_HARVEST.minSpawnDistance + 2, clearDepth),
  );
  const near = 4;
  const centerF = (near + far) / 2;
  const turn = hash01(seed) * Math.PI * 2;
  const out: Array<{ x: number; f: number }> = [];
  for (let index = 0; index < count; index++) {
    const slice = (Math.PI * 2) / count;
    const a = turn + slice * (index + 0.15 + 0.7 * hash01(seed * 31 + index));
    // Alternate far and nearer so neighbours never share an arrival time.
    const reach = (index % 2 === 0 ? 0.78 : 0.46) + 0.22 * hash01(seed * 17 + index * 7);
    out.push({
      x: Math.sin(a) * maxX * reach,
      f: centerF + Math.cos(a) * ((far - near) / 2) * reach,
    });
  }
  // Relax: push any two that crowd each other apart, keep everyone inside the
  // room and off the boss, and repeat until it holds. Deterministic (fixed
  // order, fixed passes) and cheap: at most eight souls, once per cast.
  const fit = (soul: { x: number; f: number }): void => {
    soul.x = Math.max(-maxX, Math.min(maxX, soul.x));
    soul.f = Math.max(near, Math.min(far, soul.f));
    const fromBoss = Math.hypot(soul.x, soul.f);
    if (fromBoss >= SOUL_HARVEST.minSpawnDistance) return;
    // Out along the ray from the boss, then down the room if the wall stops it.
    const k = SOUL_HARVEST.minSpawnDistance / Math.max(0.001, fromBoss);
    soul.x = Math.max(-maxX, Math.min(maxX, soul.x * k));
    const needF = Math.sqrt(
      Math.max(0, SOUL_HARVEST.minSpawnDistance * SOUL_HARVEST.minSpawnDistance - soul.x * soul.x),
    );
    soul.f = Math.min(far, Math.max(soul.f * k, needF));
  };
  for (const soul of out) fit(soul);
  const gap = SOUL_HARVEST.minSeparation + 0.05;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let df = out[j].f - out[i].f;
        let d = Math.hypot(dx, df);
        if (d >= gap) continue;
        if (d < 1e-6) {
          dx = 1;
          df = 0;
          d = 1;
        }
        const push = (gap - d) / 2;
        out[i].x -= (dx / d) * push;
        out[i].f -= (df / d) * push;
        out[j].x += (dx / d) * push;
        out[j].f += (df / d) * push;
        fit(out[i]);
        fit(out[j]);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** A soul's whole life in seconds, from its first wisp to the boss's ribs.
 *  `speedScale` is the hoard's rarity pressing its pace. */
export function soulLifeSec(distanceToBoss: number, speedScale = 1): number {
  const travel =
    Math.max(0, distanceToBoss - SOUL_HARVEST.absorbRadius) / (SOUL_HARVEST.speed * speedScale);
  return SOUL_HARVEST.castSec + SOUL_HARVEST.holdSec + travel;
}

export type SoulPhase = 'forming' | 'holding' | 'drawn';

export function soulPhase(elapsed: number): SoulPhase {
  if (elapsed < SOUL_HARVEST.castSec) return 'forming';
  if (elapsed < SOUL_HARVEST.castSec + SOUL_HARVEST.holdSec) return 'holding';
  return 'drawn';
}

/** A soul's WORLD position at `elapsed`: still, then a straight even pull that
 *  gathers pace over its first moments (a slight ease in, never a teleport). */
export function soulPosition(
  spawn: { x: number; z: number },
  boss: { x: number; z: number },
  elapsed: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
  life?: number,
): { x: number; z: number } {
  const dx = boss.x - spawn.x;
  const dz = boss.z - spawn.z;
  const distance = Math.hypot(dx, dz);
  const travelDistance = Math.max(0, distance - SOUL_HARVEST.absorbRadius);
  if (travelDistance <= 0) {
    out.x = spawn.x;
    out.z = spawn.z;
    return out;
  }
  // Its pace rides in its life (soulLifeSec): a rarer hoard draws them faster, and
  // the renderer reads the same life off the cue, so both walk the same line.
  const travelSec =
    life !== undefined
      ? Math.max(0.05, life - SOUL_HARVEST.castSec - SOUL_HARVEST.holdSec)
      : travelDistance / SOUL_HARVEST.speed;
  const t = Math.max(0, Math.min(travelSec, elapsed - SOUL_HARVEST.castSec - SOUL_HARVEST.holdSec));
  // Quadratic ease in over the first third, linear after, normalised to travelSec.
  const easeSec = travelSec / 3;
  const norm = travelSec - easeSec / 2;
  const covered = t <= easeSec ? (t * t) / (2 * easeSec) : easeSec / 2 + (t - easeSec);
  const k = ((covered / norm) * travelDistance) / distance;
  out.x = spawn.x + dx * k;
  out.z = spawn.z + dz * k;
  return out;
}
