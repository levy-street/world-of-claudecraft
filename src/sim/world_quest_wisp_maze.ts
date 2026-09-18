import {
  WISP_MAZE_NPC_DEF,
  WISP_MAZE_NPC_ID,
  WISP_MAZE_QUEST_ID,
  WISP_MAZE_SITE,
} from './content/world_quest_wisp_maze';
import { createNpc } from './entity';
import { createWispMaze, tickWispMaze, type WispMazeDifficulty } from './minigames/wisp_maze';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { clearAfkOnMove } from './social/away';
import {
  DT,
  type Entity,
  INTERACT_RANGE,
  normAngle,
  TURN_SPEED,
  type WorldQuestProgress,
} from './types';

export function ensureWispMazeInstructor(ctx: SimContext): void {
  if (
    (ctx.cfg.world && !ctx.cfg.world.npcs[WISP_MAZE_NPC_DEF.id]) ||
    ctx.entities.has(WISP_MAZE_NPC_ID)
  )
    return;
  ctx.addEntity(
    createNpc(
      WISP_MAZE_NPC_ID,
      WISP_MAZE_NPC_DEF,
      ctx.groundPos(WISP_MAZE_NPC_DEF.pos.x, WISP_MAZE_NPC_DEF.pos.z),
    ),
  );
}
export function pauseWispMaze(meta: PlayerMeta): void {
  const state = meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze;
  if (state && state.phase !== 'won' && !state.paused) {
    state.paused = true;
    meta.wireRev++;
  }
}
function canPlay(player: Entity, meta: PlayerMeta): boolean {
  return (
    !player.dead &&
    !player.ghost &&
    !player.inCombat &&
    !player.mountKey &&
    !(player.mountCastRemaining ?? 0) &&
    !meta.vehicle &&
    !meta.mountRace &&
    !player.leap &&
    !player.climb &&
    !player.valkyrsCalling &&
    player.chargeTargetId === null
  );
}
export function startWispMaze(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
  progress: WorldQuestProgress,
  difficulty?: WispMazeDifficulty,
): void {
  if (
    !canPlay(player, meta) ||
    npc.id !== WISP_MAZE_NPC_ID ||
    npc.templateId !== WISP_MAZE_NPC_DEF.id ||
    npc.kind !== 'npc' ||
    npc.dead ||
    ctx.entities.get(npc.id) !== npc ||
    Math.hypot(npc.pos.x - WISP_MAZE_NPC_DEF.pos.x, npc.pos.z - WISP_MAZE_NPC_DEF.pos.z) > 0.1 ||
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE + 2 ||
    Math.abs(player.pos.y - npc.pos.y) > 3
  )
    return;
  if (progress.wispMaze && !progress.wispMaze.paused && progress.wispMaze.phase !== 'won') return;
  const day = Number(meta.worldQuestCycle.split('_').at(-1)) || 0;
  if (!progress.wispMaze || progress.wispMaze.phase === 'won')
    progress.wispMaze = createWispMaze(
      Math.imul(meta.entityId, 7919) ^ ctx.tickCount,
      difficulty ?? (['easy', 'normal', 'hard'] as const)[Math.abs(day) % 3],
    );
  const state = progress.wispMaze;
  state.paused = false;
  ctx.cancelCast(player);
  player.autoAttack = false;
  player.followTargetId = null;
  player.vx = player.vy = player.vz = 0;
  player.pos = ctx.groundPos(WISP_MAZE_SITE.x + state.playerX, WISP_MAZE_SITE.z + state.playerZ);
  player.prevPos = { ...player.pos };
  player.onGround = true;
  player.jumping = false;
  player.facing = Math.PI;
  meta.wireRev++;
}

/** Normal facing and directional input feed the private collision kernel, never combat stats. */
export function advanceWispMazeMovement(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): boolean {
  const state = meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze;
  if (!state || state.paused || state.phase === 'won') return false;
  const expectedX = WISP_MAZE_SITE.x + state.playerX,
    expectedZ = WISP_MAZE_SITE.z + state.playerZ;
  if (
    !canPlay(player, meta) ||
    Math.hypot(player.pos.x - expectedX, player.pos.z - expectedZ) > 1
  ) {
    pauseWispMaze(meta);
    return false;
  }
  const input = meta.moveInput;
  player.facing = normAngle(
    player.facing + (Number(input.turnLeft) - Number(input.turnRight)) * TURN_SPEED * DT,
  );
  const forward = Number(input.forward) - Number(input.back),
    right = Number(input.strafeRight) - Number(input.strafeLeft);
  const sin = Math.sin(player.facing),
    cos = Math.cos(player.facing);
  const serial = state.feedbackSerial,
    phase = state.phase;
  const old = { ...player.pos };
  tickWispMaze(state, { x: forward * sin - right * cos, z: forward * cos + right * sin });
  player.pos = ctx.groundPos(WISP_MAZE_SITE.x + state.playerX, WISP_MAZE_SITE.z + state.playerZ);
  player.vx = (player.pos.x - old.x) / DT;
  player.vz = (player.pos.z - old.z) / DT;
  player.vy = 0;
  player.onGround = true;
  player.jumping = false;
  player.fallStartY = player.pos.y;
  player.autoAttack = false;
  player.followTargetId = null;
  if (forward || right || input.turnLeft || input.turnRight) {
    meta.lastActiveTick = ctx.tickCount;
    clearAfkOnMove(ctx, meta, player);
  }
  if (state.tick % 4 === 0 || state.feedbackSerial !== serial || state.phase !== phase)
    meta.wireRev++;
  return true;
}

export function leaveWispMaze(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  const state = meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze;
  if (
    !state ||
    state.paused ||
    !canPlay(player, meta) ||
    Math.hypot(
      player.pos.x - WISP_MAZE_SITE.x - state.playerX,
      player.pos.z - WISP_MAZE_SITE.z - state.playerZ,
    ) > 1
  )
    return;
  pauseWispMaze(meta);
  player.pos = ctx.groundPos(WISP_MAZE_NPC_DEF.pos.x, WISP_MAZE_NPC_DEF.pos.z + 1);
  player.prevPos = { ...player.pos };
  player.vx = player.vy = player.vz = 0;
  player.onGround = true;
  player.jumping = false;
}

export function updateWispMaze(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  progress: WorldQuestProgress,
): boolean {
  if (!progress.wispMaze) return false;
  if (!canPlay(player, meta)) {
    pauseWispMaze(meta);
    return false;
  }
  if (progress.wispMaze.phase === 'won') {
    leaveWispMaze(ctx, meta, player);
    return true;
  }
  return false;
}
