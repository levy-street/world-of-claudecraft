import { resolvePosition } from '../sim/colliders';
import { Aura, Entity, MoveInput, RUN_SPEED, TURN_SPEED } from '../sim/types';
import { groundHeight, WATER_LEVEL } from '../sim/world';

const BACKPEDAL_MULT = 0.65;
const BODY_RADIUS = 0.5;
const MAX_CLIMB_SLOPE = 1.5;
const SWIM_DEPTH = 0.8;
const SWIM_SPEED_MULT = 0.65;

function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isStunned(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'stun' || a.kind === 'incapacitate' || a.kind === 'polymorph');
}

function isRooted(e: Entity): boolean {
  return isStunned(e) || e.auras.some((a) => a.kind === 'root');
}

function moveSpeedMult(auras: Aura[]): number {
  let slow = 1, speed = 1;
  for (const a of auras) {
    if (a.kind === 'slow' || a.kind === 'stealth') slow = Math.min(slow, a.value);
    if (a.kind === 'buff_speed') speed = Math.max(speed, a.value);
  }
  return slow * speed;
}

export function predictPlayerMovement(
  seed: number,
  e: Entity,
  pos: { x: number; y: number; z: number },
  facing: number,
  input: MoveInput,
  dt: number,
): number {
  if (!Number.isFinite(dt) || dt <= 0 || e.dead || e.chargeTargetId !== null) return facing;
  dt = Math.min(dt, 0.1);

  if (!isStunned(e)) {
    if (input.turnLeft) facing = normAngle(facing + TURN_SPEED * dt);
    if (input.turnRight) facing = normAngle(facing - TURN_SPEED * dt);
  }

  let mx = 0, mz = 0;
  if (input.forward) mz += 1;
  if (input.back) mz -= 1;
  if (input.strafeLeft) mx -= 1;
  if (input.strafeRight) mx += 1;
  if ((mx !== 0 || mz !== 0) && !isRooted(e)) {
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    let speed = RUN_SPEED * moveSpeedMult(e.auras);
    if (mz < 0) speed *= BACKPEDAL_MULT;
    const ground = groundHeight(pos.x, pos.z, seed);
    const swimming = ground < WATER_LEVEL - SWIM_DEPTH && pos.y <= WATER_LEVEL - 0.6;
    if (swimming) speed *= SWIM_SPEED_MULT;

    const sin = Math.sin(facing), cos = Math.cos(facing);
    const wx = mz * sin - mx * cos;
    const wz = mz * cos + mx * sin;
    let nx = pos.x + wx * speed * dt;
    let nz = pos.z + wz * speed * dt;

    if (!swimming) {
      const h1 = groundHeight(nx, nz, seed);
      const run = Math.hypot(nx - pos.x, nz - pos.z);
      if (h1 > ground && run > 1e-5 && (h1 - ground) / run > MAX_CLIMB_SLOPE) {
        nx = pos.x;
        nz = pos.z;
      }
    }
    const resolved = resolvePosition(seed, nx, nz, BODY_RADIUS);
    pos.x = resolved.x;
    pos.z = resolved.z;
  }

  return facing;
}
