// Death recovery uses the live claim's retained boss corpses as progress,
// just like dungeon gates, and the gates' own derived state as the proof that
// the arena can be walked to. No saved state, tick work, or rng draws.
import { isBlocked } from '../colliders';
import { DUNGEON_CHECKPOINTS, type DungeonCheckpoint } from '../content/dungeon_checkpoints';
import { DUNGEONS, instanceOrigin } from '../data';
import { MAX_AGGRO_RADIUS } from '../mob/aggro_ranges';
import { PLAYER_BODY_RADIUS } from '../pathfind';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { type DungeonDef, dist2d, type Entity } from '../types';
import { dungeonGateState } from './dungeon_gates';

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
    // Live positions include patrols and surviving summons. Check the whole
    // entity roster for proximity, so even an unrostered hazard mob is seen.
    let unsafe = false;
    for (const mob of ctx.entities.values()) {
      if (
        mob.kind === 'mob' &&
        !mob.dead &&
        mob.ownerId === null &&
        dist2d(mob.pos, pos) < MAX_AGGRO_RADIUS
      ) {
        unsafe = true;
        break;
      }
    }
    if (
      unsafe ||
      ctx.groundAoEs.some(
        (area) => area.remaining > 0 && dist2d(area.pos, pos) <= area.radius + PLAYER_BODY_RADIUS,
      )
    )
      continue;
    return { x: checkpoint.pos.x, z: checkpoint.pos.z };
  }
  return dungeon.entry;
}
