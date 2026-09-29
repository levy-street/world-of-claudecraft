// Fire and Fly's private arena around the turret seat: entry claims the
// player's own arena slot under their solo key (never the party's) and sets
// them on the tower roof; the exit puts them back exactly where they stood
// and frees the slot. The arena spawns nothing, so neither draws world rng.

import { FIRE_AND_FLY_DUNGEON_ID } from './content/fire_and_fly_arena';
import { DUNGEONS, dungeonAt } from './data';
import { FIRE_AND_FLY_TOWER } from './fire_and_fly_field';
import {
  freeInstance,
  instanceOriginOf,
  markInstanceClaimed,
  soloInstanceKeyFor,
} from './instances/dungeons';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import type { InstanceSlot, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { arenaQueueLeave } from './social/arena';
import { RES_HP_FRACTION, revivePlayerAt } from './spirit';
import { settleTeleportArrival } from './teleport_arrival';
import type { Entity, TurretReturnPoint, Vec3 } from './types';
import { groundHeight } from './world';

const ARENA_TEXT_COLOR = '#b9f';

function ownArena(ctx: SimContext, pid: number): InstanceSlot | undefined {
  const key = soloInstanceKeyFor(ctx, pid);
  return ctx.instances.find(
    (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.partyKey === key,
  );
}

/**
 * Claims a fresh arena slot for the player, first releasing one their key
 * still holds (a relog mid-game), so every entry starts clean. Null when every
 * slot is taken. The claim opens no exit portal (exitId stays null), so the
 * claim-id readers (instanceClaimIdAt, claimedInstanceAt) see no claim here:
 * no instance combat hold, no corpse claim id. Harmless while the arena spawns
 * nothing; an arena that ever holds entities needs a claim identity first.
 */
export function claimTurretArena(ctx: SimContext, pid: number): InstanceSlot | null {
  const stale = ownArena(ctx, pid);
  if (stale) freeInstance(ctx, stale);
  const free = ctx.instances.find(
    (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.partyKey === null,
  );
  if (!free) return null;
  markInstanceClaimed(ctx, free, soloInstanceKeyFor(ctx, pid), 'normal');
  return free;
}

/** Sets the player on the tower roof at the arena's center and returns their feet. */
export function enterTurretArena(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  arena: InstanceSlot,
): Vec3 {
  const center = instanceOriginOf(arena);
  cancelProfessionSessionOnDisplacement(ctx, player);
  player.pos = {
    x: center.x,
    y: groundHeight(center.x, center.z, ctx.cfg.seed) + FIRE_AND_FLY_TOWER.roofY,
    z: center.z,
  };
  player.prevPos = { ...player.pos };
  ctx.rebucket(player);
  settleTeleportArrival(player);
  player.facing = 0;
  player.prevFacing = 0;
  player.dungeonEntrySeq = (player.dungeonEntrySeq ?? 0) + 1;
  meta.moveInput.turnLeft = false;
  meta.moveInput.turnRight = false;
  player.targetId = null;
  arena.enteredBy.add(meta.entityId);
  // A queued arena match must never pop for a player standing in an instance.
  arenaQueueLeave(ctx, meta.entityId);
  ctx.emit({
    type: 'log',
    text: DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].enterText,
    color: ARENA_TEXT_COLOR,
    pid: meta.entityId,
  });
  return { ...player.pos };
}

/**
 * Leaves the arena: a player still inside the arena band (or whose body lies
 * there) goes back exactly to `returnTo`, alive. The arena cannot hurt its
 * player, so a death inside came from elsewhere, and the slot is about to be
 * freed: a corpse left in it could never be reached again, so the instance
 * death model (a spirit run back through a door) has nothing to run to.
 * Anyone who left the arena another way stays where that took them. The
 * player's slot is freed either way. True when this call brought them back.
 */
export function exitTurretArena(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  returnTo: TurretReturnPoint,
): boolean {
  const inside = (pos: Vec3 | null | undefined) =>
    !!pos && dungeonAt(pos.x)?.id === FIRE_AND_FLY_DUNGEON_ID;
  const home = inside(player.pos) || ((player.dead || player.ghost) && inside(player.corpsePos));
  if (home) {
    if (player.dead || player.ghost) {
      revivePlayerAt(ctx, meta.entityId, returnTo, RES_HP_FRACTION);
    }
    cancelProfessionSessionOnDisplacement(ctx, player);
    player.pos = { x: returnTo.x, y: returnTo.y, z: returnTo.z };
    player.prevPos = { ...player.pos };
    ctx.rebucket(player);
    settleTeleportArrival(player);
    player.facing = returnTo.facing;
    player.prevFacing = returnTo.facing;
    player.targetId = null;
    player.autoAttack = false;
    ctx.emit({
      type: 'log',
      text: DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].leaveText,
      color: ARENA_TEXT_COLOR,
      pid: meta.entityId,
    });
  }
  const arena = ownArena(ctx, meta.entityId);
  if (arena) freeInstance(ctx, arena);
  return home;
}
