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

import { isRooted, isStunned } from './combat/cc';
import {
  INSTANCE_X_BASE,
  isArenaPos,
  isDelvePos,
  isRiftPos,
  riftInstanceOrigin,
  zoneAt,
} from './data';
import { delveModuleZOffset } from './delves/runs';
import { riftInstanceAtPos } from './rift/runs';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { moveToGraveyardForUnstuck, reviveAtGraveyardForUnstuck } from './spirit';
import {
  DT,
  type Entity,
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

function isValeCupPlayer(ctx: SimContext, pid: number): boolean {
  const matches = ctx.vcup.match ? [ctx.vcup.match, ...ctx.vcup.practices] : ctx.vcup.practices;
  return matches.some((match) => match.teamA.includes(pid) || match.teamB.includes(pid));
}

function hasMoveInput(meta: PlayerMeta): boolean {
  const input = meta.moveInput;
  return input.forward || input.back || input.strafeLeft || input.strafeRight || input.jump;
}

function forcedMovement(p: Entity): boolean {
  return (
    p.chargeTargetId !== null ||
    p.followTargetId !== null ||
    p.auras.some((aura) => aura.id === 'fear_incap' && aura.kind === 'incapacitate') ||
    Math.hypot(p.vx, p.vy, p.vz) > POSITION_EPS
  );
}

function competitive(ctx: SimContext, pid: number, p: Entity): boolean {
  return (
    ctx.duels.has(pid) ||
    ctx.arenaMatches.has(pid) ||
    isValeCupPlayer(ctx, pid) ||
    isArenaPos(p.pos.x)
  );
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

function motionBlock(p: Entity): UnstuckBlockedReason | null {
  if (isFrozenCorpse(p)) return null;
  if (!p.onGround || p.jumping) return 'falling';
  if (forcedMovement(p)) return 'moving';
  return null;
}

function blockedReason(ctx: SimContext, meta: PlayerMeta, p: Entity): UnstuckBlockedReason | null {
  if (p.jailed) return 'jailed';
  if (p.inCombat || p.combatTimer < 5) return 'combat';
  if (isStunned(p) || isRooted(p)) return 'controlled';
  const motion = motionBlock(p);
  if (motion) return motion;
  if (p.castingAbility !== null || isConsuming(p) || p.sitting) return 'busy';
  if (competitive(ctx, p.id, p)) return 'competitive';
  if (ctx.tradeFor(p.id)) return 'trading';
  if (!unstuckLocationAt(ctx, p.id, p.pos)) return 'invalid_area';
  if (hasMoveInput(meta)) return 'moving';
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
  if (
    hasMoveInput(meta) ||
    Math.hypot(p.pos.x - pending.origin.x, p.pos.z - pending.origin.z) > CANCEL_MOVE_DISTANCE ||
    Math.abs(p.pos.y - pending.origin.y) > CANCEL_VERTICAL_DISTANCE
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
    motionBlock(p) !== null ||
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
  if (wasDead) reviveAtGraveyardForUnstuck(ctx, p.id);
  else moveToGraveyardForUnstuck(ctx, p.id);
  p.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_SUCCESS_COOLDOWN_SECONDS);

  const destination = unstuckLocationAt(ctx, p.id, p.pos)?.point ?? {
    ...p.pos,
    localX: p.pos.x,
    localZ: p.pos.z,
  };
  ctx.emit({
    type: 'unstuck',
    phase: 'completed',
    reason: wasDead ? 'revived_at_graveyard' : 'moved_to_graveyard',
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
