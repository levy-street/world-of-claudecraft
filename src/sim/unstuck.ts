// Server-authoritative Unstuck countdown and graveyard teleport.
//
// Unstuck is intentionally not a short-range teleport. An eligible player may
// start it from any valid world position. If they remain idle and undisturbed
// for the countdown they are moved to the nearest graveyard, which is the one
// point in every zone guaranteed to be reachable open ground. Unstuck never
// kills and never leaves a corpse:
//  - alive: they are simply moved there, still alive, with their pools intact.
//  - dead or a ghost: they are moved there and raised on the Pale Keeper's hp
//    terms (a fifth of their pools). This is the escape hatch for a spirit that
//    cannot reach its corpse or an angel.
// Either way the price is Unstuck Sickness (all attributes -75%, level-scaled up
// to 5 minutes), and neither outcome can be reached by an attempt that started on
// the other side of the life/death line (see cancelReason).

import { moverHeight, resolvePosition } from './colliders';
import { isRooted, isStunned } from './combat/cc';
import {
  bgOriginAt,
  INSTANCE_X_BASE,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isRiftPos,
  riftInstanceOrigin,
  zoneAt,
} from './data';
import { delveModuleZOffset } from './delves/runs';
import { PLAYER_BODY_RADIUS } from './pathfind';
import { riftInstanceAtPos } from './rift/runs';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { bgCarryingFlag, bgTeamOf, bgUnstuckDestination } from './social/battleground';
import {
  applyUnstuckSickness,
  moveToGraveyardForUnstuck,
  reviveAtGraveyardForUnstuck,
} from './spirit';
import { settleTeleportArrival } from './teleport_arrival';
import {
  DT,
  type Entity,
  emptyMoveInput,
  isConsuming,
  type UnstuckArea,
  type UnstuckBlockedReason,
  type UnstuckCancelReason,
  type UnstuckEvent,
  type UnstuckPosition,
  type Vec3,
} from './types';
import { UNSTUCK_COOLDOWN_ID } from './unstuck_cooldown';

export const UNSTUCK_COUNTDOWN_SECONDS = 10;
export const UNSTUCK_RETRY_SECONDS = 15;
export const UNSTUCK_SUCCESS_COOLDOWN_SECONDS = 5 * 60;
export { UNSTUCK_COOLDOWN_ID } from './unstuck_cooldown';

const POSITION_EPS = 1e-4;
const CANCEL_MOVE_DISTANCE = 0.5;
const CANCEL_VERTICAL_DISTANCE = 0.25;
const BG_WALL_PRESS_PROBE_DISTANCE = 0.35;
const BG_WALL_PRESS_MIN_PROGRESS = 0.05;
const BG_WALL_PRESS_ESC_GRACE_SECONDS = 3;
const battlegroundWallPressGrace = new WeakMap<SimContext, Map<number, number>>();

export interface PendingUnstuck {
  startedAt: number;
  endsAt: number;
  origin: UnstuckPosition;
  area: UnstuckArea;
  damageTaken: number;
  lastAnnouncedSecond: number;
  /**
   * Whether the invoker was dead or a ghost when the countdown began. A crossing of the
   * life/death line IN EITHER DIRECTION is a cancel, so an attempt can never resolve as
   * the outcome the player did not ask for. That matters most in the living-to-dead
   * direction: without it, dying mid-countdown would be answered by a graveyard revive,
   * which would make a pre-started /unstuck a cheaper alternative to the death loop.
   */
  startedDead: boolean;
}

export type CancelledUnstuckEvent = Extract<UnstuckEvent, { phase: 'cancelled' }> & {
  pid: number;
};

interface LocatedPoint {
  area: UnstuckArea;
  point: UnstuckPosition;
}

function located(area: UnstuckArea, pos: Vec3, origin: { x: number; z: number }): LocatedPoint {
  return {
    area,
    point: { ...pos, localX: pos.x - origin.x, localZ: pos.z - origin.z },
  };
}

/** Resolve a position into a stable content identity plus instance-local coords. */
export function unstuckLocationAt(ctx: SimContext, pid: number, pos: Vec3): LocatedPoint | null {
  const rift = riftInstanceAtPos(ctx, pos);
  if (rift) {
    if (!rift.memberIds.has(pid)) return null;
    const origin = riftInstanceOrigin(rift.slot, rift.floorIndex);
    return located(
      {
        kind: 'rift',
        id: `seed:${rift.seed >>> 0}:floor:${rift.floorIndex}`,
        instanceId: String(rift.instanceId),
        slot: rift.slot,
      },
      pos,
      origin,
    );
  }
  if (isRiftPos(pos.x)) return null;

  const delve = ctx.delveRunForPlayer(pid);
  if (delve && isDelvePos(pos.x)) {
    const moduleId = delve.modules[delve.moduleIndex];
    if (!moduleId) return null;
    return located(
      {
        kind: 'delve',
        id: `${delve.delveId}:module:${moduleId}`,
        instanceId: `seed:${delve.seed >>> 0}:tier:${delve.tierId}`,
        slot: delve.slot,
      },
      pos,
      { x: delve.origin.x, z: delve.origin.z + delveModuleZOffset(delve) },
    );
  }
  if (isDelvePos(pos.x)) return null;

  if (isBgPos(pos.x)) {
    const match = ctx.bgMatches.get(pid);
    if (!match || match.slot !== bgOriginAt(pos.z).slot) return null;
    const origin = bgOriginAt(pos.z);
    return located(
      {
        kind: 'battleground',
        id: 'thornhollow_fields',
        instanceId: String(match.id),
        slot: match.slot,
      },
      pos,
      origin,
    );
  }

  const claimId = ctx.instanceClaimIdAt(pos);
  if (claimId !== null) {
    const instance = ctx.instances.find(
      (candidate) => candidate.exitId === claimId && candidate.partyKey === ctx.instanceKeyFor(pid),
    );
    if (!instance) return null;
    return located(
      {
        kind: 'dungeon',
        id: instance.dungeonId,
        instanceId: String(claimId),
        slot: instance.slot,
      },
      pos,
      ctx.instanceOriginOf(instance),
    );
  }
  if (pos.x >= INSTANCE_X_BASE) return null;

  const zone = zoneAt(pos.x, pos.z);
  return located({ kind: 'overworld', id: zone.id }, pos, { x: 0, z: 0 });
}

function sameArea(a: UnstuckArea, b: UnstuckArea): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    (a.instanceId ?? null) === (b.instanceId ?? null) &&
    (a.slot ?? null) === (b.slot ?? null)
  );
}

function hasMoveInput(meta: PlayerMeta): boolean {
  const input = meta.moveInput;
  return input.forward || input.back || input.strafeLeft || input.strafeRight || input.jump;
}

function hasAnyMovementInput(meta: PlayerMeta): boolean {
  const input = meta.moveInput;
  return hasMoveInput(meta) || input.turnLeft || input.turnRight || input.dive || input.surface;
}

function moveInputVector(meta: PlayerMeta, p: Entity): { x: number; z: number } | null {
  const input = meta.moveInput;
  let mx = 0;
  let mz = 0;
  if (input.forward) mz += 1;
  if (input.back) mz -= 1;
  if (input.strafeLeft) mx -= 1;
  if (input.strafeRight) mx += 1;
  const len = Math.hypot(mx, mz);
  if (len <= POSITION_EPS) return null;
  mx /= len;
  mz /= len;
  const sin = Math.sin(p.facing);
  const cos = Math.cos(p.facing);
  return { x: mz * sin - mx * cos, z: mz * cos + mx * sin };
}

function forcedAction(p: Entity): boolean {
  return (
    p.chargeTargetId !== null ||
    p.followTargetId !== null ||
    p.auras.some((aura) => aura.id === 'fear_incap' && aura.kind === 'incapacitate')
  );
}

function competitive(ctx: SimContext, pid: number, p: Entity): boolean {
  if (ctx.bgMatches.has(pid) && isBgPos(p.pos.x)) return false;
  return ctx.duels.has(pid) || ctx.arenaMatches.has(pid) || isArenaPos(p.pos.x);
}

/**
 * A dead, unreleased body is frozen: the tick runs no movement for it, so its
 * velocity, `onGround`, and `jumping` keep whatever value they held at the instant
 * of death and never update again. Gating on them would strand exactly the player
 * Unstuck exists to rescue, since dying mid-fall leaves `onGround` false forever.
 * A ghost is excluded: it moves under the ordinary movement update, so its motion
 * is live and the stand-still contract still means something. Only these physics
 * fields go stale; handleDeath already clears casting, eating, drinking, sitting,
 * charge, and follow, so the action gates stay honest for a corpse.
 */
function isFrozenCorpse(p: Entity): boolean {
  return p.dead && !p.ghost;
}

function battlegroundWallTrap(ctx: SimContext, p: Entity): boolean {
  if (!ctx.bgMatches.has(p.id) || !isBgPos(p.pos.x)) return false;
  const match = ctx.bgMatches.get(p.id);
  if (!match) return false;
  const origin = bgOriginAt(p.pos.z);
  if (match.slot !== origin.slot) return false;
  const resolved = resolvePosition(
    ctx.cfg.seed,
    p.pos.x,
    p.pos.z,
    PLAYER_BODY_RADIUS,
    false,
    undefined,
    moverHeight(p),
  );
  return Math.hypot(resolved.x - p.pos.x, resolved.z - p.pos.z) > POSITION_EPS;
}

function battlegroundBlockedWallPress(ctx: SimContext, meta: PlayerMeta, p: Entity): boolean {
  if (!activeBattlegroundAt(ctx, p)) return false;
  const wish = moveInputVector(meta, p);
  if (!wish) return false;
  return battlegroundBlockedProbe(ctx, p, wish);
}

export function noteBattlegroundWallPressure(
  ctx: SimContext | undefined,
  meta: PlayerMeta,
  p: Entity,
): void {
  if (!ctx?.bgMatches) return;
  const grace = battlegroundWallPressGrace.get(ctx);
  if (!activeBattlegroundAt(ctx, p)) {
    grace?.delete(p.id);
    return;
  }
  if (battlegroundBlockedWallPress(ctx, meta, p)) {
    const activeGrace = grace ?? new Map<number, number>();
    if (!grace) battlegroundWallPressGrace.set(ctx, activeGrace);
    activeGrace.set(p.id, ctx.time + BG_WALL_PRESS_ESC_GRACE_SECONDS);
    return;
  }
  if (hasAnyMovementInput(meta)) grace?.delete(p.id);
}

function battlegroundBlockedProbe(
  ctx: SimContext,
  p: Entity,
  wish: { x: number; z: number },
): boolean {
  const probe = {
    x: p.pos.x + wish.x * BG_WALL_PRESS_PROBE_DISTANCE,
    z: p.pos.z + wish.z * BG_WALL_PRESS_PROBE_DISTANCE,
  };
  const origin = bgOriginAt(p.pos.z);
  if (!isBgPos(probe.x) || bgOriginAt(probe.z).slot !== origin.slot) return false;
  const resolved = resolvePosition(
    ctx.cfg.seed,
    probe.x,
    probe.z,
    PLAYER_BODY_RADIUS,
    false,
    undefined,
    moverHeight(p),
  );
  const pushed = Math.hypot(resolved.x - probe.x, resolved.z - probe.z) > POSITION_EPS;
  const progress = (resolved.x - p.pos.x) * wish.x + (resolved.z - p.pos.z) * wish.z;
  return pushed && progress < BG_WALL_PRESS_MIN_PROGRESS;
}

function battlegroundGeometryTrap(ctx: SimContext, meta: PlayerMeta, p: Entity): boolean {
  const wallPressUntil = battlegroundWallPressGrace.get(ctx)?.get(p.id) ?? 0;
  return (
    battlegroundWallTrap(ctx, p) ||
    battlegroundBlockedWallPress(ctx, meta, p) ||
    (!hasAnyMovementInput(meta) && activeBattlegroundAt(ctx, p) && wallPressUntil >= ctx.time)
  );
}

function activeBattlegroundAt(ctx: SimContext | undefined, p: Entity): boolean {
  const match = ctx?.bgMatches?.get(p.id);
  if (!match || !isBgPos(p.pos.x)) return false;
  return match.slot === bgOriginAt(p.pos.z).slot;
}

function motionBlock(ctx: SimContext, meta: PlayerMeta, p: Entity): UnstuckBlockedReason | null {
  if (isFrozenCorpse(p)) return null;
  if (forcedAction(p)) return 'moving';
  if (battlegroundGeometryTrap(ctx, meta, p)) return null;
  if (!p.onGround || p.jumping) return 'falling';
  if (Math.hypot(p.vx, p.vy, p.vz) > POSITION_EPS) return 'moving';
  return null;
}

function blockedReason(ctx: SimContext, meta: PlayerMeta, p: Entity): UnstuckBlockedReason | null {
  const bgGeometryTrap = battlegroundGeometryTrap(ctx, meta, p);
  if (p.jailed) return 'jailed';
  if (p.inCombat || p.combatTimer < 5) return 'combat';
  if (isStunned(p) || isRooted(p)) return 'controlled';
  const motion = motionBlock(ctx, meta, p);
  if (motion) return motion;
  if (p.castingAbility !== null || isConsuming(p) || p.sitting) return 'busy';
  if (bgCarryingFlag(ctx, p.id)) return 'competitive';
  if (competitive(ctx, p.id, p)) return 'competitive';
  if (ctx.tradeFor(p.id)) return 'trading';
  if (!unstuckLocationAt(ctx, p.id, p.pos)) return 'invalid_area';
  if (hasMoveInput(meta) && !bgGeometryTrap) return 'moving';
  if (activeBattlegroundAt(ctx, p) && !bgGeometryTrap && (!p.dead || p.ghost)) {
    return 'competitive';
  }
  return null;
}

function emitBlocked(
  ctx: SimContext,
  pid: number,
  reason: UnstuckBlockedReason,
  seconds?: number,
): void {
  ctx.emit({ type: 'unstuck', phase: 'blocked', reason, ...(seconds ? { seconds } : {}), pid });
}

/** Begin the authoritative idle countdown. Returns true only when accepted. */
export function requestUnstuck(ctx: SimContext, pid?: number): boolean {
  const resolved = ctx.resolve(pid);
  if (!resolved) return false;
  const { meta, e: p } = resolved;
  if (meta.pendingUnstuck) {
    emitBlocked(ctx, p.id, 'already_active');
    return false;
  }
  const cooldown = p.cooldowns.get(UNSTUCK_COOLDOWN_ID) ?? 0;
  if (cooldown > 0) {
    emitBlocked(ctx, p.id, 'cooldown', Math.max(1, Math.ceil(cooldown)));
    return false;
  }
  const blocked = blockedReason(ctx, meta, p);
  if (blocked) {
    emitBlocked(ctx, p.id, blocked);
    return false;
  }
  const current = unstuckLocationAt(ctx, p.id, p.pos);
  if (!current) {
    emitBlocked(ctx, p.id, 'invalid_area');
    return false;
  }
  meta.pendingUnstuck = {
    startedAt: ctx.time,
    endsAt: ctx.time + UNSTUCK_COUNTDOWN_SECONDS,
    origin: current.point,
    area: current.area,
    damageTaken: meta.counters.damageTaken,
    lastAnnouncedSecond: UNSTUCK_COUNTDOWN_SECONDS,
    startedDead: p.dead || p.ghost,
  };
  p.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_RETRY_SECONDS);
  ctx.emit({
    type: 'unstuck',
    phase: 'started',
    seconds: UNSTUCK_COUNTDOWN_SECONDS,
    pid: p.id,
  });
  return true;
}

function cancelReason(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pending: PendingUnstuck,
): UnstuckCancelReason | null {
  if (meta.counters.damageTaken > pending.damageTaken) return 'damaged';
  if (p.inCombat || p.combatTimer < 5) return 'combat';
  if (p.castingAbility !== null || isConsuming(p) || p.sitting) return 'busy';
  if (pending.area.kind === 'battleground' && bgCarryingFlag(ctx, p.id)) return 'state_changed';
  if (
    (hasMoveInput(meta) && !battlegroundGeometryTrap(ctx, meta, p)) ||
    (pending.area.kind !== 'battleground' &&
      (Math.hypot(p.pos.x - pending.origin.x, p.pos.z - pending.origin.z) > CANCEL_MOVE_DISTANCE ||
        Math.abs(p.pos.y - pending.origin.y) > CANCEL_VERTICAL_DISTANCE))
  )
    return 'moved';
  // Crossing the life/death line either way invalidates the attempt: a living player who
  // died must take the ordinary death loop rather than a discounted graveyard revive, and a
  // player who was raised mid-countdown no longer needs one.
  if ((p.dead || p.ghost) !== pending.startedDead) return 'state_changed';
  if (
    p.jailed ||
    isStunned(p) ||
    isRooted(p) ||
    motionBlock(ctx, meta, p) !== null ||
    competitive(ctx, p.id, p) ||
    ctx.tradeFor(p.id)
  )
    return 'state_changed';
  const current = unstuckLocationAt(ctx, p.id, p.pos);
  if (!current || !sameArea(current.area, pending.area)) return 'state_changed';
  return null;
}

function cancelUnstuck(
  ctx: SimContext,
  meta: PlayerMeta,
  pending: PendingUnstuck,
  reason: UnstuckCancelReason,
  emitEvent = true,
): CancelledUnstuckEvent {
  meta.pendingUnstuck = null;
  const event: CancelledUnstuckEvent = {
    type: 'unstuck',
    phase: 'cancelled',
    reason,
    area: pending.area,
    origin: pending.origin,
    duration: Math.max(0, ctx.time - pending.startedAt),
    pid: meta.entityId,
  };
  if (emitEvent) ctx.emit(event);
  return event;
}

export function cancelPendingUnstuckForDisconnect(
  ctx: SimContext,
  pid: number,
  emitEvent = true,
): CancelledUnstuckEvent | null {
  const meta = ctx.players.get(pid);
  const pending = meta?.pendingUnstuck;
  if (!meta || !pending) return null;
  return cancelUnstuck(ctx, meta, pending, 'disconnected', emitEvent);
}

function completeBattlegroundUnstuck(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
): UnstuckPosition | null {
  const destination = bgUnstuckDestination(ctx, p.id);
  if (!destination) return null;
  const match = ctx.bgMatches.get(p.id);
  const team = match ? bgTeamOf(match, p.id) : 0;
  p.pos = destination;
  p.prevPos = { ...p.pos };
  p.facing = team === 0 ? 0 : Math.PI;
  p.prevFacing = p.facing;
  ctx.rebucket(p);
  Object.assign(meta.moveInput, emptyMoveInput());
  p.vx = 0;
  p.vz = 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  delete p.queuedOnSwingFree;
  delete p.queuedOnSwingCostMultiplier;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  settleTeleportArrival(p);
  if (!p.dead && !p.ghost) applyUnstuckSickness(ctx, p);
  return unstuckLocationAt(ctx, p.id, p.pos)?.point ?? null;
}

function completeUnstuck(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pending: PendingUnstuck,
): void {
  meta.pendingUnstuck = null;
  // Both outcomes land on the same graveyard and charge the same Unstuck Sickness; they
  // differ only in whether a revive is needed on arrival. A living player is never killed.
  const wasDead = p.dead || p.ghost;
  const battlegroundDestination =
    pending.area.kind === 'battleground' ? completeBattlegroundUnstuck(ctx, meta, p) : null;
  if (!battlegroundDestination) {
    if (wasDead) reviveAtGraveyardForUnstuck(ctx, p.id);
    else moveToGraveyardForUnstuck(ctx, p.id);
  }
  p.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_SUCCESS_COOLDOWN_SECONDS);

  const destination = battlegroundDestination ??
    unstuckLocationAt(ctx, p.id, p.pos)?.point ?? {
      ...p.pos,
      localX: p.pos.x,
      localZ: p.pos.z,
    };
  ctx.emit({
    type: 'unstuck',
    phase: 'completed',
    reason: battlegroundDestination || !wasDead ? 'moved_to_graveyard' : 'revived_at_graveyard',
    area: pending.area,
    origin: pending.origin,
    destination,
    duration: Math.max(0, ctx.time - pending.startedAt),
    distance: Math.hypot(destination.x - pending.origin.x, destination.z - pending.origin.z),
    pid: p.id,
  });
}

/** Tick pending attempts after player movement/combat for this frame. */
export function updateUnstuck(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const pending = meta.pendingUnstuck;
    if (!pending) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p) {
      cancelUnstuck(ctx, meta, pending, 'disconnected');
      continue;
    }
    const cancelled = cancelReason(ctx, meta, p, pending);
    if (cancelled) {
      cancelUnstuck(ctx, meta, pending, cancelled);
      continue;
    }
    const seconds = Math.max(0, Math.ceil(pending.endsAt - ctx.time - DT / 2));
    if (seconds > 0 && seconds < pending.lastAnnouncedSecond) {
      pending.lastAnnouncedSecond = seconds;
      ctx.emit({ type: 'unstuck', phase: 'countdown', seconds, pid: p.id });
    }
    if (ctx.time + DT / 2 >= pending.endsAt) completeUnstuck(ctx, meta, p, pending);
  }
}
