// Nyxaris's TWIN PULSARS, the pure half: every tunable, where the orbs hang and
// where they take station, who each one hunts, how a beam pursues its quarry,
// and what it hits. No rng, no DOM: the renderer imports this file, so the beam
// on screen is the beam that burns.
//
// The orbs are a permanent part of the boss. DORMANT they ride above his
// shoulders (a third above his head in a legendary hoard) and are scenery: a
// boss aura, drawn by the renderer, never an entity. ACTIVATED they leave him for
// fixed stations in the room and become real, attackable mobs; he is immune
// until the last one dies. Each hunts one player with a beam that CHASES: its
// aim point runs after the target at under a player's pace and turns only so
// fast, so it can be outrun and out-turned, never out-waited.

import { RUN_SPEED } from '../types';

export const PULSAR_CUE_VARIANTS = [
  'arcane-pulsar-ward',
  'arcane-pulsar',
  'arcane-pulsar-lock',
  'arcane-pulsar-beam',
] as const;
export function isPulsarVariant(variant: string | undefined): boolean {
  return (PULSAR_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

/** The mob an activated orb is (src/sim/content/rift/mobs.ts). */
export const HOARD_PULSAR_TEMPLATE = 'hoard_bound_pulsar';
/** Boss auras the renderer reads: how many orbs ride him, and his ward. */
export const HOARD_BOUND_PULSARS_AURA_ID = 'hoard_bound_pulsars';
export const HOARD_PULSAR_WARD_AURA_ID = 'hoard_pulsar_ward';

export const PULSARS = Object.freeze({
  // ---- how many
  /** ORB_COUNT_NORMAL / ORB_COUNT_LEGENDARY / LEGENDARY_ENABLED. */
  orbCountNormal: 2,
  orbCountLegendary: 3,
  legendaryEnabled: true,
  // ---- dormant: above the shoulders, a little behind, in the boss's own frame
  /** ORB_HEIGHT / ORB_HORIZONTAL_OFFSET, in units of the boss's own scale (a
   *  hoard boss is a giant, and his size varies), and ORB_HOVER_AMOUNT in yards. */
  orbHeight: 1.95,
  orbHorizontalOffset: 1.05,
  orbBackOffset: 0.3,
  /** The legendary third: higher, over his head, the triangle's apex. */
  orbTopHeight: 2.8,
  orbHoverAmount: 0.16,
  // ---- active: fixed stations in the room
  stationDistance: 7.5,
  /** Forward of square: never backed into the wall he stands against. */
  stationAngle: Math.PI * 0.42,
  stationFrontDistance: 9,
  stationHeight: 3,
  // ---- the cycle
  /** ACTIVATION_CAST_TIME: the orbs light, leave him, and take station. */
  activationCastSec: 1.8,
  /** How long the group has before the orbs overload and burst on their own. */
  maxPhaseSec: 40,
  overloadDamageFraction: 0.6,
  /** ORB_RESPAWN_DELAY: how long he goes without them after they die. */
  orbRespawnDelaySec: 14,
  /** ORB_HEALTH, each, as a share of the boss's own (already party-scaled) health. */
  orbHealthFraction: 0.045,
  // ---- the beam
  /** TARGET_WARNING_TIME: a harmless line locked on the target before it fires. */
  targetWarningSec: 0.7,
  /** BEAM_TRACK_SPEED: the aim point's pace, under a player's run. */
  beamTrackSpeed: 5.6,
  /** However rare the hoard, never quicker than this share of a player's run. */
  beamTrackSpeedCap: RUN_SPEED * 0.93,
  /** BEAM_LAG: the beam lands this far SHORT of its target (toward the orb) and
   *  sweeps in from there, so the first instant of fire is never a hit. */
  beamStartLag: 4,
  /** BEAM_TURN_SPEED: how fast the chase can change direction, radians a second. */
  beamTurnSpeed: 3.2,
  /** Orbs hunting the SAME player take turns of this length, so nobody is ever
   *  chased by two live beams at once (a lone player faces them one at a time). */
  beamShareSec: 6,
  /** BEAM_WIDTH: the burning core's radius. The drawn core is built to it. */
  beamWidth: 0.9,
  /** BEAM_DAMAGE per tick, as a share of the reference health, and BEAM_DAMAGE_TICK. */
  beamDamageFraction: 0.11,
  beamDamageTickSec: 0.3,
  /** The beam's cue is a heartbeat: re-sent this often, living this long, so a
   *  client follows the aim point and a dead orb's beam dies with it. */
  beamHeartbeatTicks: 2,
  beamHeartbeatLifeSec: 0.45,
  /** The targeting line needs no such rate: the client draws it to the target
   *  entity itself, so its cue is only kept alive, a little over once a second. */
  lockHeartbeatTicks: 16,
  lockHeartbeatLifeSec: 1.2,
});

export type HoardRarity = 'common' | 'rare' | 'epic' | 'legendary';
export function pulsarCount(rarity: HoardRarity | undefined): number {
  return PULSARS.legendaryEnabled && rarity === 'legendary'
    ? PULSARS.orbCountLegendary
    : PULSARS.orbCountNormal;
}

/** The whole ward's life: the activation, then the phase's full allowance. */
export const PULSAR_WARD_TOTAL_SEC = PULSARS.activationCastSec + PULSARS.maxPhaseSec;

/** Where orb `index` rides while dormant, in the boss's own frame (`x` to his
 *  right, `y` up, `z` forward), for a boss drawn at `scale`. Left, right, then
 *  the apex. */
export function pulsarAnchor(
  index: number,
  scale = 1,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  if (index >= 2) {
    out.x = 0;
    out.y = PULSARS.orbTopHeight * scale;
    out.z = -PULSARS.orbBackOffset * 0.5 * scale;
    return out;
  }
  out.x = (index === 0 ? -1 : 1) * PULSARS.orbHorizontalOffset * scale;
  out.y = PULSARS.orbHeight * scale;
  out.z = -PULSARS.orbBackOffset * scale;
  return out;
}

/** Where orb `index` takes station once activated, in the world: to his left and
 *  right, a little forward of square, and the third out in front of him. */
export function pulsarStation(
  index: number,
  bossX: number,
  bossZ: number,
  facing: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  // The boss's frame: forward is (sin f, cos f), his right is (cos f, -sin f), so a
  // station `a` radians to his right bears f + a. Index 0 is his left, as it rides.
  const angle = index >= 2 ? facing : facing + (index === 0 ? -1 : 1) * PULSARS.stationAngle;
  const distance = index >= 2 ? PULSARS.stationFrontDistance : PULSARS.stationDistance;
  out.x = bossX + Math.sin(angle) * distance;
  out.z = bossZ + Math.cos(angle) * distance;
  return out;
}

/** The aim point's pace in a hoard whose rarity runs hazards at `speed`. */
export function beamTrackSpeed(speed = 1): number {
  return Math.min(PULSARS.beamTrackSpeedCap, PULSARS.beamTrackSpeed * speed);
}

/** Who each orb hunts. Different players while there are enough; with fewer
 *  players than orbs the rest double up (it cannot be helped). `livingIds` must
 *  be sorted; `turn` rotates who is first, so it is not always the same player. */
export function assignPulsarTargets(
  orbCount: number,
  livingIds: readonly number[],
  turn: number,
): number[] {
  const out: number[] = [];
  if (livingIds.length === 0) return out;
  const start = ((Math.floor(turn) % livingIds.length) + livingIds.length) % livingIds.length;
  for (let orb = 0; orb < orbCount; orb++) {
    out.push(livingIds[(start + orb) % livingIds.length]);
  }
  return out;
}

export interface BeamAim {
  x: number;
  z: number;
  /** The way the chase is running, radians (0 faces +z). */
  heading: number;
}

/** One step of the chase. The aim point runs at `speed` along its heading, and
 *  the heading swings toward the target by at most `turn * dt`: it sweeps after
 *  its quarry and overshoots a sharp turn, never snaps onto them. It stops ON a
 *  target it has caught (one who stood still), never past them. */
export function stepBeamAim(
  aim: BeamAim,
  targetX: number,
  targetZ: number,
  speed: number,
  turn: number,
  dt: number,
): BeamAim {
  const dx = targetX - aim.x;
  const dz = targetZ - aim.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return aim;
  const want = Math.atan2(dx, dz);
  let swing = want - aim.heading;
  while (swing > Math.PI) swing -= Math.PI * 2;
  while (swing < -Math.PI) swing += Math.PI * 2;
  const limit = turn * dt;
  aim.heading += swing > limit ? limit : swing < -limit ? -limit : swing;
  const step = speed * dt;
  // Close enough, and pointed at them: it lands on the target rather than orbit.
  if (distance <= step && Math.abs(swing) <= limit) {
    aim.x = targetX;
    aim.z = targetZ;
    return aim;
  }
  aim.x += Math.sin(aim.heading) * step;
  aim.z += Math.cos(aim.heading) * step;
  return aim;
}

/** Whether a point on the floor is inside the beam: within `beamWidth` of the
 *  segment from the orb's station to the aim point. The drawn core is that
 *  segment at that width, so a hit is always one the player could see. */
export function pointInPulsarBeam(
  orbX: number,
  orbZ: number,
  aimX: number,
  aimZ: number,
  pointX: number,
  pointZ: number,
  radius: number = PULSARS.beamWidth,
): boolean {
  const sx = aimX - orbX;
  const sz = aimZ - orbZ;
  const lengthSq = sx * sx + sz * sz;
  let t = lengthSq > 1e-9 ? ((pointX - orbX) * sx + (pointZ - orbZ) * sz) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = orbX + sx * t;
  const cz = orbZ + sz * t;
  return (pointX - cx) ** 2 + (pointZ - cz) ** 2 <= radius * radius;
}
