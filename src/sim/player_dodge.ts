import { isRooted } from './combat/cc';
import { PLAYER_BODY_RADIUS } from './pathfind';
import type { SimContext } from './sim_context';
import { DT, type Entity } from './types';

export const DODGE_ENDURANCE_MAX = 100;
export const DODGE_ENDURANCE_COST = 50;
export const DODGE_ENDURANCE_REGEN_PER_SECOND = 5;
export const DODGE_DURATION = 0.75;
export const DODGE_DISTANCE = 6;
export const DODGE_SPEED = DODGE_DISTANCE / DODGE_DURATION;

export function playerEndurance(entity: Entity): number {
  return Math.min(DODGE_ENDURANCE_MAX, Math.max(0, entity.endurance ?? DODGE_ENDURANCE_MAX));
}

export function isPlayerDodging(entity: Entity): boolean {
  return entity.kind === 'player' && (entity.dodgeRemaining ?? 0) > 0;
}

export function clearPlayerDodge(entity: Entity, refill = false): void {
  entity.dodgeRemaining = undefined;
  entity.dodgeDirX = undefined;
  entity.dodgeDirZ = undefined;
  entity.vx = 0;
  entity.vz = 0;
  if (refill) entity.endurance = undefined;
}

export function tryStartPlayerDodge(
  ctx: SimContext,
  direction: Readonly<{ x: number; z: number }>,
  pid?: number,
): boolean {
  const resolved = ctx.resolve(pid);
  if (!resolved) return false;
  const player = resolved.e;
  const length = Math.hypot(direction.x, direction.z);
  if (
    player.kind !== 'player' ||
    player.dead ||
    player.ghost ||
    !player.onGround ||
    player.mountKey !== '' ||
    player.climb !== undefined ||
    player.riftSliding ||
    player.chargeTargetId !== null ||
    isRooted(player) ||
    isPlayerDodging(player) ||
    !Number.isFinite(length) ||
    length <= 1e-9 ||
    playerEndurance(player) < DODGE_ENDURANCE_COST
  ) {
    return false;
  }
  ctx.standUp(player);
  ctx.cancelCast(player);
  player.endurance = playerEndurance(player) - DODGE_ENDURANCE_COST;
  player.dodgeDirX = direction.x / length;
  player.dodgeDirZ = direction.z / length;
  player.dodgeRemaining = DODGE_DURATION;
  player.vx = player.dodgeDirX * DODGE_SPEED;
  player.vz = player.dodgeDirZ * DODGE_SPEED;
  resolved.meta.lastActiveTick = ctx.tickCount;
  return true;
}

function regenerateEndurance(entity: Entity): void {
  if (entity.endurance === undefined) return;
  const next = Math.min(
    DODGE_ENDURANCE_MAX,
    entity.endurance + DODGE_ENDURANCE_REGEN_PER_SECOND * DT,
  );
  entity.endurance = next >= DODGE_ENDURANCE_MAX - 1e-9 ? undefined : next;
}

/** Returns true while dodge owns horizontal movement for this tick. */
export function advancePlayerDodge(ctx: SimContext, entity: Entity): boolean {
  if (entity.kind !== 'player' || entity.dead || entity.ghost) {
    if (isPlayerDodging(entity)) clearPlayerDodge(entity);
    return false;
  }
  regenerateEndurance(entity);
  if (!isPlayerDodging(entity)) return false;
  if (isRooted(entity) || !entity.onGround) {
    clearPlayerDodge(entity);
    return false;
  }
  const dirX = entity.dodgeDirX ?? 0;
  const dirZ = entity.dodgeDirZ ?? 0;
  const step = Math.min(DODGE_SPEED * DT, DODGE_SPEED * (entity.dodgeRemaining ?? 0));
  const startX = entity.pos.x;
  const startZ = entity.pos.z;
  const wantedX = startX + dirX * step;
  const wantedZ = startZ + dirZ * step;
  const moved = ctx.resolveMove(
    startX,
    startZ,
    wantedX,
    wantedZ,
    PLAYER_BODY_RADIUS,
    entity,
    false,
  );
  entity.pos.x = moved.x;
  entity.pos.z = moved.z;
  entity.dodgeRemaining = Math.max(0, (entity.dodgeRemaining ?? 0) - DT);
  const actualDistance = Math.hypot(moved.x - startX, moved.z - startZ);
  if ((entity.dodgeRemaining ?? 0) <= 1e-9 || actualDistance < step * 0.2) {
    clearPlayerDodge(entity);
  }
  return true;
}

/**
 * Controlled evade check shared by melee, projectile and central direct damage.
 * The caller must run it before any hit-table RNG when it owns that roll.
 */
export function evadeIncomingAttack(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  school: string,
  ability: string | null,
  abilityId: string | null = null,
): boolean {
  if (!source || source.id === target.id || !isPlayerDodging(target)) return false;
  ctx.emit({
    type: 'damage',
    sourceId: source.id,
    targetId: target.id,
    amount: 0,
    crit: false,
    school,
    ability,
    abilityId,
    kind: 'dodge',
  });
  ctx.enterCombat(source, target);
  return true;
}
