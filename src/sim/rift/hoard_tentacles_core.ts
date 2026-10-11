// Abyssal Maw's TENTACLES OF THE ABYSS, the pure half: every tunable, how many
// rise and where, each attack's clock and its hitbox, and the check that a
// targeted player always has somewhere to go. No rng, no DOM: the renderer
// imports this file, so the line on the floor is the line that hits and the arm
// on screen is the arm that sweeps.
//
// A tentacle is a real, attackable mob once it has erupted; what the client
// needs rides ordinary hoard cues:
//   tide-tentacle   one per tentacle, at its place: the eruption's warning and
//                   its rise (`halfAngle` is which tentacle of the set it is)
//   tide-tentacle-up  the SAME id, standing. It stands until it is KILLED, so
//                   this one is a heartbeat: a short life, re-sent while it lives
//   tide-tentacle-fall  the SAME id, once it is killed (`halfAngle` 1) or the
//                   fight lets it go (0): the death throes, or its going under
//   tide-whip       a LINE WHIP: a rectangle from the tentacle along `facing`
//                   (`radius` is its length, `halfAngle` its HALF WIDTH in yards)
//   tide-sweep      a CIRCULAR SWEEP: an arm turning about the tentacle from
//                   `facing` (`radius` its reach, `halfAngle` its half angle; a
//                   NEGATIVE radius turns it the other way, so the wire carries
//                   nothing new)
//   tide-grab       a GRASP reaching for a player: a mark that rides them
//                   (`targetId`), `innerRadius` which tentacle is reaching
//   tide-grab-hold  the SAME id, once it has them: until its grip is broken

export const TENTACLE_CUE_VARIANTS = [
  'tide-tentacle',
  'tide-tentacle-up',
  'tide-tentacle-fall',
  'tide-whip',
  'tide-sweep',
  'tide-grab',
  'tide-grab-hold',
] as const;
export function isTentacleVariant(variant: string | undefined): boolean {
  return (TENTACLE_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

/** The mob an erupted tentacle is (src/sim/content/rift/mobs.ts). */
export const HOARD_TENTACLE_TEMPLATE = 'hoard_abyssal_tentacle';

export const TENTACLES = Object.freeze({
  // ---- how many
  /** PLAYERS_PER_TENTACLE: one for every this many living players (rounded up). */
  playersPerTentacle: 2,
  /** BASE_TENTACLE_COUNT: added before the rarity bonus (the hoard's hazard bonus,
   *  hoard_scaling.ts, is RARITY_TENTACLE_BONUS: common -1, rare 0, epic and
   *  legendary +1). */
  baseTentacleCount: 0,
  minTentacles: 1,
  /** MAX_TENTACLES. */
  maxTentacles: 6,
  // ---- health
  /** TENTACLE_HEALTH, as a share of the boss's own health, which is already
   *  scaled by party size and rarity (HEALTH_PLAYER_SCALING and
   *  HEALTH_RARITY_SCALING ride on it). */
  healthFraction: 0.03,
  /** Each further tentacle in the set is this much of the last one's health, so
   *  a big set never turns killing them into a chore. */
  healthPerExtraTentacle: 0.9,
  // ---- rising and leaving
  /** SPAWN_WARNING. */
  spawnWarningSec: 1.1,
  eruptRadius: 3.2,
  eruptDamageFraction: 0.18,
  eruptKnockback: 4,
  /** Out of the floor in this long once the warning ends. After that it STANDS
   *  until it is killed: there is no waiting a tentacle out. */
  riseSec: 1,
  /** Its death throes (or its going under, if the fight lets it go). */
  retractSec: 1,
  /** The standing cue is a heartbeat: re-sent this often, living this long. */
  upHeartbeatTicks: 12,
  upLifeSec: 1.4,
  // ---- where
  minBossDistance: 9,
  maxBossDistance: 25,
  minSeparation: 11,
  wallMargin: 4,
  // ---- attacks
  /** ATTACK_INTERVAL between one tentacle's attacks, and the pause before its first. */
  attackIntervalSec: 5.4,
  firstAttackSec: 1.5,
  // LINE WHIP
  /** LINE_TELEGRAPH_DURATION, then the slam itself, then the residue. */
  whipTelegraphSec: 1.3,
  whipStrikeSec: 0.22,
  whipLingerSec: 0.5,
  whipLength: 22,
  whipHalfWidth: 2.4,
  /** LINE_DAMAGE. */
  whipDamageFraction: 0.3,
  whipKnockback: 3,
  // CIRCULAR SWEEP
  /** SWEEP_TELEGRAPH_DURATION, then the turn itself, then the settle. */
  sweepTelegraphSec: 1.6,
  sweepSec: 1.3,
  sweepLingerSec: 0.3,
  sweepRadius: 8.5,
  /** The ground right round the trunk is never swept: melee on it has a place. */
  sweepInnerRadius: 2.4,
  sweepArmHalfAngle: 0.3,
  /** SWEEP_DAMAGE. */
  sweepDamageFraction: 0.26,
  sweepKnockback: 5,
  // GRASP: it reaches for a player, and if they are still in reach when it
  // closes, it holds them where it stands and squeezes until its grip is broken.
  /** GRAB_TELEGRAPH_DURATION, and how far it can reach (run out of it to escape). */
  grabTelegraphSec: 1.5,
  grabRange: 13,
  /** Held this far from the trunk: inside the ground its own sweep never touches. */
  grabHoldDistance: 2,
  /** GRAB_MAX_DURATION: left unbroken it squeezes this long, then throws them. */
  grabHoldSec: 8,
  grabEverySec: 1,
  grabDamageFraction: 0.06,
  grabThrowDamageFraction: 0.2,
  grabThrowKnockback: 7,
  /** GRAB_BREAK_DAMAGE: this share of the tentacle's health, dealt while it holds
   *  someone, breaks its grip (killing it always does). The held player can strike
   *  it too, so a lone player is never stuck. */
  grabBreakFraction: 0.25,
  grabMissSec: 0.6,
  // ---- pressure
  /** DOUBLE_PATTERN_INTENSITY_THRESHOLD is HOARD_DOUBLE_MECHANIC_INTENSITY
   *  (hoard_scaling.ts); the partner's attack follows this long after. */
  doubleStaggerSec: 0.7,
  /** A new telegraph is only accepted if its target still has an open spot within
   *  this many yards; otherwise it waits this long and tries again. */
  escapeReach: 9,
  retrySec: 0.5,
});

/** The rise cue: the warning, then the rise. Standing is its own cue after that. */
export const TENTACLE_TOTAL_SEC = TENTACLES.spawnWarningSec + TENTACLES.riseSec;
export const GRAB_TELEGRAPH_TOTAL_SEC = TENTACLES.grabTelegraphSec;
export const WHIP_TOTAL_SEC =
  TENTACLES.whipTelegraphSec + TENTACLES.whipStrikeSec + TENTACLES.whipLingerSec;
export const SWEEP_TOTAL_SEC =
  TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec + TENTACLES.sweepLingerSec;

/** How many rise: about one for every two players, plus the hoard's rarity bonus. */
export function tentacleCount(living: number, rarityBonus = 0): number {
  const heads = Math.max(1, Math.floor(living));
  const count =
    TENTACLES.baseTentacleCount + Math.ceil(heads / TENTACLES.playersPerTentacle) + rarityBonus;
  return Math.max(TENTACLES.minTentacles, Math.min(TENTACLES.maxTentacles, count));
}

/** One tentacle's health in a set of `count`, from the boss's own. */
export function tentacleHealth(bossMaxHp: number, count: number): number {
  const thin = TENTACLES.healthPerExtraTentacle ** Math.max(0, count - 1);
  return Math.max(1, Math.round(bossMaxHp * TENTACLES.healthFraction * thin));
}

function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Where they rise, in the boss's frame (`x` lateral, `f` forward into the room):
 *  fanned across the room at mixed depths, off the boss, off the walls, apart. */
export function tentacleOffsets(
  count: number,
  seed: number,
  halfWidth: number,
  clearDepth: number,
): Array<{ x: number; f: number }> {
  const maxX = Math.max(0, halfWidth - TENTACLES.wallMargin);
  const near = TENTACLES.minBossDistance;
  const far = Math.max(
    near,
    Math.min(TENTACLES.maxBossDistance, clearDepth - TENTACLES.wallMargin),
  );
  const out: Array<{ x: number; f: number }> = [];
  for (let index = 0; index < count; index++) {
    const lane = count === 1 ? 0 : -1 + (2 * (index + 0.5)) / count;
    const jitter = (hash01(seed * 13 + index) - 0.5) * (count === 1 ? 1.3 : 0.7 / count);
    const depth = (index % 2 === 0 ? 0.12 : 0.58) + 0.36 * hash01(seed * 29 + index * 5);
    out.push({
      x: Math.max(-maxX, Math.min(maxX, (lane * 0.8 + jitter) * maxX)),
      f: near + (far - near) * depth,
    });
  }
  const gap = TENTACLES.minSeparation;
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const df = out[j].f - out[i].f;
        const d = Math.hypot(dx, df);
        if (d >= gap) continue;
        const push = (gap - d) / 2 + 0.01;
        const sx = dx >= 0 ? 1 : -1;
        const sf = df >= 0 ? 1 : -1;
        out[i].x = Math.max(-maxX, Math.min(maxX, out[i].x - sx * push));
        out[j].x = Math.max(-maxX, Math.min(maxX, out[j].x + sx * push));
        out[i].f = Math.max(near, Math.min(far, out[i].f - sf * push * 0.6));
        out[j].f = Math.max(near, Math.min(far, out[j].f + sf * push * 0.6));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

export type TentacleAttack = 'whip' | 'sweep' | 'grab';
const ATTACK_ORDER: readonly TentacleAttack[] = ['whip', 'sweep', 'grab'];

/** Which attack a tentacle makes: each cycles lash, sweep, grasp, and neighbours
 *  are out of step, so two attacking together are never making the same one. */
export function tentacleAttackKind(tentacleIndex: number, attackNumber: number): TentacleAttack {
  return ATTACK_ORDER[(tentacleIndex + attackNumber) % ATTACK_ORDER.length];
}

/** How many players may be held at once: never the whole party. A lone player may
 *  be held (they can strike the tentacle that holds them). */
export function maxGrabbed(living: number): number {
  if (living <= 1) return 1;
  return Math.max(1, Math.min(2, Math.floor((living - 1) / 2)));
}

/** Whether a grasp that closes now still has its target: they must be in reach. */
export function grabReaches(
  originX: number,
  originZ: number,
  pointX: number,
  pointZ: number,
): boolean {
  return Math.hypot(pointX - originX, pointZ - originZ) <= TENTACLES.grabRange;
}

/** Whether a point is under the whip: a rectangle from the trunk out along
 *  `facing`, `whipLength` long and `whipHalfWidth` to either side. */
export function pointInWhip(
  originX: number,
  originZ: number,
  facing: number,
  pointX: number,
  pointZ: number,
  length: number = TENTACLES.whipLength,
  halfWidth: number = TENTACLES.whipHalfWidth,
): boolean {
  const dx = pointX - originX;
  const dz = pointZ - originZ;
  const along = dx * Math.sin(facing) + dz * Math.cos(facing);
  if (along < 0 || along > length) return false;
  const across = dx * Math.cos(facing) - dz * Math.sin(facing);
  return Math.abs(across) <= halfWidth;
}

/** How far through its turn the sweeping arm is (0 to 1) `elapsed` seconds into
 *  the sweep cue: still through the telegraph, then a heavy, eased full turn. */
export function sweepProgress(elapsed: number): number {
  const t = (elapsed - TENTACLES.sweepTelegraphSec) / TENTACLES.sweepSec;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Slow off the mark, fast through the middle, heavy into the stop.
  return t * t * (3 - 2 * t);
}

/** The arm's bearing at `progress`: one full turn from `facing`, either way. */
export function sweepArmBearing(facing: number, direction: number, progress: number): number {
  return facing + direction * Math.PI * 2 * progress;
}

/** Whether the arm passed over a point between two moments of its turn: inside
 *  the swept ring (never the ground right round the trunk), and at a bearing the
 *  arm's middle crossed, give or take its half angle. Swept, so a fast arm can
 *  never step over a player between ticks. */
export function sweepPasses(
  originX: number,
  originZ: number,
  facing: number,
  direction: number,
  progressBefore: number,
  progressNow: number,
  pointX: number,
  pointZ: number,
  radius: number = TENTACLES.sweepRadius,
): boolean {
  if (progressNow <= progressBefore) return false;
  const dx = pointX - originX;
  const dz = pointZ - originZ;
  const distance = Math.hypot(dx, dz);
  if (distance < TENTACLES.sweepInnerRadius || distance > radius) return false;
  // How far round from the arm's start the point lies, in the arm's own direction.
  let turn = (Math.atan2(dx, dz) - facing) * direction;
  turn -= Math.PI * 2 * Math.floor(turn / (Math.PI * 2));
  const from = Math.PI * 2 * progressBefore - TENTACLES.sweepArmHalfAngle;
  const to = Math.PI * 2 * progressNow + TENTACLES.sweepArmHalfAngle;
  // The point's turn, and the same point one lap on (the arm starts ON a bearing,
  // so a point just behind the start is reached at the END of the lap).
  return (turn >= from && turn <= to) || (turn + Math.PI * 2 >= from && turn + Math.PI * 2 <= to);
}

export interface TentacleTelegraph {
  kind: 'whip' | 'sweep';
  x: number;
  z: number;
  facing: number;
}

/** Whether a point is inside a telegraph's WHOLE danger area (for a sweep, the
 *  full ring it will turn through). */
export function pointInTelegraph(tele: TentacleTelegraph, pointX: number, pointZ: number): boolean {
  if (tele.kind === 'whip') return pointInWhip(tele.x, tele.z, tele.facing, pointX, pointZ);
  const d = Math.hypot(pointX - tele.x, pointZ - tele.z);
  return d >= TENTACLES.sweepInnerRadius && d <= TENTACLES.sweepRadius;
}

/** Whether a player at (x, z) still has an open spot within `escapeReach` once
 *  every live telegraph is on the floor: the check a new telegraph must pass, so
 *  overlapping attacks get more complex, never unavoidable. */
export function hasEscape(x: number, z: number, telegraphs: readonly TentacleTelegraph[]): boolean {
  const open = (px: number, pz: number): boolean => {
    for (let i = 0; i < telegraphs.length; i++) {
      if (pointInTelegraph(telegraphs[i], px, pz)) return false;
    }
    return true;
  };
  if (open(x, z)) return true;
  for (let ring = 1; ring <= 3; ring++) {
    const reach = (TENTACLES.escapeReach * ring) / 3;
    for (let step = 0; step < 12; step++) {
      const a = (step / 12) * Math.PI * 2;
      if (open(x + Math.sin(a) * reach, z + Math.cos(a) * reach)) return true;
    }
  }
  return false;
}
