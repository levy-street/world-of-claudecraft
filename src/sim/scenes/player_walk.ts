// Authoritative scripted player walking for Last Bell scenes. The scene op
// resolves its endpoint before entering this module; the live state stays on
// Sim as ctx.scriptedPlayerWalks, keyed by player entity id.
//
// Each active tick turns the player toward the endpoint and supplies a normal
// forward MoveInput to stepPlayerMotion. That shared kernel still owns speed
// modifiers, footing, slope gates, collision, and vertical movement. This
// module only caps the last step at the remaining distance and settles tiny
// floating-point residue exactly onto the authored endpoint.
//
// Authors must keep the route to an endpoint from carrying the player over a
// drop greater than the 12 yard FALL_SAFE_DISTANCE. Fall damage can reach
// rng-backed damage resolution, while a scripted walk must draw no rng.

import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import type { SimContext } from '../sim_context';
import { type Entity, emptyMoveInput, type MoveInput, RUN_SPEED } from '../types';

export interface ScriptedPlayerWalk {
  playbackKey: number;
  to: { x: number; z: number };
  speed: number;
}

export interface ScriptedPlayerWalkStep {
  input: MoveInput;
  speed: number;
  maxDistance: number;
}

const ARRIVAL_EPSILON = 1e-5;
const FORWARD_INPUT: MoveInput = { ...emptyMoveInput(), forward: true };

export function resolvedPlayerWalkSpeed(speed?: number): number {
  return speed !== undefined && Number.isFinite(speed) && speed > 0 ? speed : RUN_SPEED;
}

function distanceTo(player: Entity, to: { x: number; z: number }): number {
  return Math.hypot(to.x - player.pos.x, to.z - player.pos.z);
}

function exactEndpoint(ctx: SimContext, player: Entity, to: { x: number; z: number }): void {
  const endpoint = ctx.groundPos(to.x, to.z);
  player.pos.x = endpoint.x;
  player.pos.y = endpoint.y;
  player.pos.z = endpoint.z;
}

/**
 * Fare-style hard placement for skip fast-forward: terrain supplies y, both
 * interpolation endpoints agree, and the spatial indexes update immediately.
 */
export function placePlayerAtWalkEndpoint(
  ctx: SimContext,
  player: Entity,
  to: { x: number; z: number },
): void {
  cancelProfessionSessionOnDisplacement(ctx, player);
  player.pos = ctx.groundPos(to.x, to.z);
  player.prevPos = { ...player.pos };
  ctx.rebucket(player);
}

export function startScriptedPlayerWalk(
  ctx: SimContext,
  playbackKey: number,
  player: Entity,
  to: { x: number; z: number },
  speed?: number,
): void {
  if (distanceTo(player, to) <= ARRIVAL_EPSILON) {
    placePlayerAtWalkEndpoint(ctx, player, to);
    ctx.scriptedPlayerWalks.delete(player.id);
    return;
  }
  ctx.scriptedPlayerWalks.set(player.id, {
    playbackKey,
    to: { ...to },
    speed: resolvedPlayerWalkSpeed(speed),
  });
}

/**
 * Resolve this tick's scripted intent. A null result leaves normal player
 * movement in control.
 */
export function prepareScriptedPlayerWalkStep(
  ctx: SimContext,
  player: Entity,
): ScriptedPlayerWalkStep | null {
  const walk = ctx.scriptedPlayerWalks.get(player.id);
  if (!walk) return null;
  const remaining = distanceTo(player, walk.to);
  if (remaining <= ARRIVAL_EPSILON) {
    exactEndpoint(ctx, player, walk.to);
    ctx.scriptedPlayerWalks.delete(player.id);
    return null;
  }
  player.facing = Math.atan2(walk.to.x - player.pos.x, walk.to.z - player.pos.z);
  return { input: FORWARD_INPUT, speed: walk.speed, maxDistance: remaining };
}

/** Settle and clear after stepPlayerMotion reaches the endpoint this tick. */
export function finishScriptedPlayerWalkStep(ctx: SimContext, player: Entity): void {
  const walk = ctx.scriptedPlayerWalks.get(player.id);
  if (!walk || distanceTo(player, walk.to) > ARRIVAL_EPSILON) return;
  exactEndpoint(ctx, player, walk.to);
  ctx.scriptedPlayerWalks.delete(player.id);
}

/** Scene-end parity for an already-running walk. */
export function fastForwardScriptedPlayerWalks(ctx: SimContext, playbackKey: number): void {
  for (const [playerId, walk] of ctx.scriptedPlayerWalks) {
    if (walk.playbackKey !== playbackKey) continue;
    const player = ctx.entities.get(playerId);
    if (player) placePlayerAtWalkEndpoint(ctx, player, walk.to);
    ctx.scriptedPlayerWalks.delete(playerId);
  }
}

/** Unconditional scene teardown without moving a walk that did not arrive. */
export function clearScriptedPlayerWalks(ctx: SimContext, playbackKey: number): void {
  for (const [playerId, walk] of ctx.scriptedPlayerWalks) {
    if (walk.playbackKey === playbackKey) ctx.scriptedPlayerWalks.delete(playerId);
  }
}
