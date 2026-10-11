// Death recovery uses the live claim's retained boss corpses as progress,
// just like dungeon gates, and the gates' own derived state as the proof that
// the arena can be walked to. No saved state, tick work, or rng draws.
import { isBlocked } from '../colliders';
import { DUNGEON_CHECKPOINTS, type DungeonCheckpoint } from '../content/dungeon_checkpoints';
import { DUNGEONS, instanceOrigin } from '../data';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../mob/aggro_ranges';
import { PATROL_REJOIN_DISTANCE } from '../mob/patrol';
import { projectOntoLoop } from '../mob/patrol_route';
import { PLAYER_BODY_RADIUS } from '../pathfind';
import { isClearOfRiftEntry, RIFT_ENTRY_CLEAR_RADIUS } from '../rift/entry_clearance';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { type DungeonDef, dist2d, type Entity, type Vec3 } from '../types';
import { dungeonGateState } from './dungeon_gates';

/**
 * A ground patroller a few yards behind its point walks straight at it instead
 * of along its loop (mob/patrol.ts), so a patrol can be this far off its loop
 * where the loop turns.
 */
const PATROL_LOOP_CLEAR_RADIUS = MAX_AGGRO_RADIUS + PATROL_REJOIN_DISTANCE;

/** A living mob nobody owns: every one of them is taken for a threat. */
function standsWild(mob: Entity): boolean {
  return mob.kind === 'mob' && !mob.dead && mob.ownerId === null;
}

/** Is every gate on the way in to `checkpoint` open in this claim, right now? */
function routeOpen(
  ctx: SimContext,
  inst: InstanceSlot,
  dungeon: DungeonDef,
  checkpoint: DungeonCheckpoint,
): boolean {
  return checkpoint.gates.every((gateId) => {
    const gate = dungeon.gates?.find((g) => g.id === gateId);
    return gate !== undefined && dungeonGateState(ctx, inst, gate) === 'open';
  });
}

/**
 * Can a mob reach an arrival standing on `pos` without being walked up to? Never
 * measured from where an idle mob happens to stand, which changes from one
 * moment (and one host's idle cull) to the next, but from everywhere it can go:
 *   a wanderer  drifts round its spawn point, so its HOME must clear the rift
 *               entry clearance (the detection ceiling plus the wander ring,
 *               rift/entry_clearance.ts);
 *   a patrol    walks its loop instead, so its LOOP must clear the ceiling, with
 *               room for the corner it cuts;
 *   any body    standing inside the ceiling right now refuses the point,
 *               whatever its home or loop.
 */
function mobsThreaten(ctx: SimContext, inst: InstanceSlot, pos: Vec3): boolean {
  // The entity grid, as the idle aggro scan reads the player grid: it holds
  // every entity, rostered to the claim or not, bucketed at the end of the last
  // tick, and the answer is a plain "is there one", so visit order cannot matter.
  // Wide enough to find a wanderer anywhere in a ring whose home is too close.
  if (
    ctx.grid.someInRadius(
      pos.x,
      pos.z,
      RIFT_ENTRY_CLEAR_RADIUS + MAX_WANDER_RADIUS,
      (mob) =>
        standsWild(mob) &&
        (dist2d(mob.pos, pos) < MAX_AGGRO_RADIUS ||
          (!patrolLoop(mob) && !isClearOfRiftEntry(pos, mob.spawnPos.x, mob.spawnPos.z))),
    )
  )
    return true;
  for (const id of inst.mobIds) {
    const mob = ctx.entities.get(id);
    const loop = mob && patrolLoop(mob);
    if (!mob || !loop || !standsWild(mob)) continue;
    if (projectOntoLoop(loop, pos.x, pos.z).d < PATROL_LOOP_CLEAR_RADIUS) return true;
  }
  return false;
}

/** The loop a patrolling mob walks, or null for a mob that wanders or stands. */
function patrolLoop(mob: Entity): readonly { x: number; z: number }[] | null {
  const points = mob.dungeonPatrol?.points;
  return points && points.length > 0 ? points : null;
}

/** Instance-local arrival. Ordinary entries and unrelated corpses use the door. */
export function dungeonReentryPoint(
  ctx: SimContext,
  inst: InstanceSlot,
  player: Entity,
): { x: number; z: number } {
  const dungeon = DUNGEONS[inst.dungeonId];
  const checkpoints = DUNGEON_CHECKPOINTS[inst.dungeonId];
  if (
    !checkpoints ||
    inst.partyKey === null ||
    inst.exitId === null ||
    !player.dead ||
    !player.ghost ||
    !player.corpsePos ||
    player.corpseInstanceId !== inst.exitId
  )
    return dungeon.entry;

  // Include appended encounter adds (Knellwyrm, Bonewalkers, etc.). A return
  // during a pull never grants a shortcut back into that ongoing fight.
  for (const id of inst.mobIds) {
    const mob = ctx.entities.get(id);
    if (mob && !mob.dead && (mob.inCombat || mob.aiState !== 'idle')) return dungeon.entry;
  }

  const defeated = (bossId: string): boolean => {
    // Static spawn ordinal binds proof to this claim's authored boss rather
    // than an identically named summon or a corpse in a neighbour's slot.
    const indices = dungeon.spawns.flatMap((spawn, i) => (spawn.mobId === bossId ? [i] : []));
    return (
      indices.length > 0 &&
      indices.every((i) => {
        const boss = ctx.entities.get(inst.mobIds[i]);
        return boss?.templateId === bossId && boss.dead;
      })
    );
  };
  const origin = instanceOrigin(dungeon.index, inst.slot);
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    const checkpoint = checkpoints[i];
    if (!checkpoint.bosses.every(defeated)) continue;
    // A dead boss alone proves nothing about the way in: the arena is offered
    // only while a group could walk to it through its open gates.
    if (!routeOpen(ctx, inst, dungeon, checkpoint)) continue;
    const pos = ctx.groundPos(origin.x + checkpoint.pos.x, origin.z + checkpoint.pos.z);
    if (isBlocked(ctx.cfg.seed, pos.x, pos.z, PLAYER_BODY_RADIUS)) continue;
    if (
      mobsThreaten(ctx, inst, pos) ||
      ctx.groundAoEs.some(
        (area) => area.remaining > 0 && dist2d(area.pos, pos) <= area.radius + PLAYER_BODY_RADIUS,
      )
    )
      continue;
    return { x: checkpoint.pos.x, z: checkpoint.pos.z };
  }
  return dungeon.entry;
}
