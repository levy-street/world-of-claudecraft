import {
  GLIDER_APPRENTICE_NPC_DEF,
  GLIDER_APPRENTICE_NPC_ID,
  GLIDER_LAUNCH_SITE,
  GLIDER_NPC_DEF,
  GLIDER_NPC_ID,
  GLIDER_QUEST_ID,
} from './content/world_quest_glider';
import { displacePlayer } from './displacement';
import { createNpc } from './entity';
import { GLIDER_TOWER } from './glider_tower_layout';
import {
  createGliderFlightState,
  type GliderFlightState,
  tickGliderFlight,
} from './minigames/glider_flight';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { clearAfkOnMove } from './social/away';
import { type Entity, INTERACT_RANGE, type WorldQuestProgress } from './types';
import { gliderCourseById } from './world_quest_glider_levels';
import { emitWorldQuestScore } from './world_quest_score_events';

export function ensureGliderInstructor(ctx: SimContext): void {
  if (ctx.cfg.world && !ctx.cfg.world.npcs[GLIDER_NPC_DEF.id]) return;
  if (!ctx.entities.has(GLIDER_NPC_ID)) {
    ctx.addEntity(
      createNpc(
        GLIDER_NPC_ID,
        GLIDER_NPC_DEF,
        ctx.groundPos(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z),
      ),
    );
  }
  if (!ctx.entities.has(GLIDER_APPRENTICE_NPC_ID)) {
    ctx.addEntity(
      createNpc(
        GLIDER_APPRENTICE_NPC_ID,
        GLIDER_APPRENTICE_NPC_DEF,
        ctx.groundPos(GLIDER_APPRENTICE_NPC_DEF.pos.x, GLIDER_APPRENTICE_NPC_DEF.pos.z),
      ),
    );
  }
}

export function clearGliderEncounter(meta: PlayerMeta, progress: WorldQuestProgress): void {
  if (!progress.glider) return;
  if (progress.glider.practiceOnly) {
    progress.state = 'completed';
    progress.count = 1;
  }
  delete progress.glider;
  meta.wireRev++;
}

function returnGliderToLaunch(ctx: SimContext, player: Entity): void {
  player.pos = ctx.groundPos(GLIDER_NPC_DEF.pos.x + 1, GLIDER_NPC_DEF.pos.z);
  player.prevPos = { ...player.pos };
  player.vx = player.vy = player.vz = 0;
  player.onGround = true;
  player.jumping = false;
  player.followTargetId = null;
  player.autoAttack = false;
  player.fallStartY = player.pos.y;
}

export function updateGliderLaunchUpdraft(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  if (player.dead || player.inCombat || meta.vehicle) return false;
  if (player.pos.y >= 40) return false;
  const dx = player.pos.x - GLIDER_TOWER.updraft.x;
  const dz = player.pos.z - GLIDER_TOWER.updraft.z;
  if (dx * dx + dz * dz > GLIDER_TOWER.updraft.radius * GLIDER_TOWER.updraft.radius) {
    return false;
  }
  if (player.mountKey) ctx.forceDismount(player);
  displacePlayer(
    ctx,
    player,
    {
      x: GLIDER_NPC_DEF.pos.x + 1,
      z: GLIDER_NPC_DEF.pos.z,
      facing: GLIDER_LAUNCH_SITE.playerFacing,
    },
    'A howling updraft carries you swiftly back up to The Shear!',
  );
  meta.wireRev++;
  return true;
}

function abortGliderFlight(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  progress: WorldQuestProgress,
): void {
  const state = progress.glider;
  if (!state || (state.phase !== 'countdown' && state.phase !== 'flying')) return;
  state.phase = 'failed';
  returnGliderToLaunch(ctx, player);
  meta.wireRev++;
  ctx.emit({
    type: 'log',
    pid: meta.entityId,
    text: 'The updraft carries you back to Zephyr. Speak with him to try again.',
  });
}

/** Rotation expiry must not turn an airborne participant into a lethal fall. */
export function cancelGliderForRotation(ctx: SimContext, meta: PlayerMeta): void {
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID);
  const phase = progress?.glider?.phase;
  if (!progress || (phase !== 'countdown' && phase !== 'flying')) return;
  const player = ctx.entities.get(meta.entityId);
  if (player && !player.dead) returnGliderToLaunch(ctx, player);
  clearGliderEncounter(meta, progress);
}

export function startGliderFlight(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
  progress: WorldQuestProgress,
  practice = false,
): void {
  if (
    npc.dead ||
    npc.kind !== 'npc' ||
    ctx.entities.get(npc.id) !== npc ||
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE ||
    Math.abs(player.pos.y - npc.pos.y) > 3 ||
    progress.glider?.phase === 'countdown' ||
    progress.glider?.phase === 'flying' ||
    player.dead ||
    player.inCombat ||
    player.mountKey ||
    (player.mountCastRemaining ?? 0) > 0 ||
    meta.vehicle ||
    player.leap ||
    player.climb ||
    player.valkyrsCalling ||
    player.chargeTargetId !== null ||
    player.jumping ||
    meta.mountRace
  ) {
    return;
  }

  // Handle Return Updraft Apprentice at the landing pad
  if (npc.id === GLIDER_APPRENTICE_NPC_ID && npc.templateId === GLIDER_APPRENTICE_NPC_DEF.id) {
    if (
      Math.hypot(
        npc.pos.x - GLIDER_APPRENTICE_NPC_DEF.pos.x,
        npc.pos.z - GLIDER_APPRENTICE_NPC_DEF.pos.z,
      ) > 0.1
    )
      return;
    returnGliderToLaunch(ctx, player);
    meta.wireRev++;
    ctx.emit({
      type: 'log',
      pid: meta.entityId,
      text: 'A howling updraft carries you swiftly back up to The Shear!',
    });
    return;
  }

  if (
    npc.id !== GLIDER_NPC_ID ||
    npc.templateId !== GLIDER_NPC_DEF.id ||
    Math.hypot(npc.pos.x - GLIDER_NPC_DEF.pos.x, npc.pos.z - GLIDER_NPC_DEF.pos.z) > 0.1
  ) {
    return;
  }

  ctx.cancelCast(player);
  player.autoAttack = false;
  player.followTargetId = null;

  player.pos = {
    x: GLIDER_LAUNCH_SITE.playerLaunch.x,
    y: GLIDER_LAUNCH_SITE.playerLaunch.y,
    z: GLIDER_LAUNCH_SITE.playerLaunch.z,
  };
  player.prevPos = { ...player.pos };
  player.facing = GLIDER_LAUNCH_SITE.playerFacing;

  const courseId = gliderCourseById(progress.glider?.courseId).id;
  const practiceOnly = practice || progress.glider?.practiceOnly;
  progress.glider = {
    ...createGliderFlightState(true),
    courseId,
    ...(practiceOnly ? { practiceOnly: true as const } : {}),
  };
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;

  meta.wireRev++;
  ctx.emit({
    type: 'log',
    pid: meta.entityId,
    text: 'Prepare for launch! 3... 2... 1...',
  });
}

/** Pure locomotion tick: advances mechanical glider flight identically on every host. */
export function advanceGliderMovement(ctx: SimContext, player: Entity, meta: PlayerMeta): boolean {
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID);
  const state = progress?.glider;
  if (!progress || !state || (state.phase !== 'flying' && state.phase !== 'countdown'))
    return false;

  if (player.dead) {
    clearGliderEncounter(meta, progress);
    return false;
  }
  if (player.inCombat || player.mountKey || meta.vehicle) {
    abortGliderFlight(ctx, meta, player, progress);
    return true;
  }

  const beforePhase = state.phase;
  const beforeRings = state.passedRings.length;
  const beforeBoosts = state.windBoosts?.length ?? 0;

  tickGliderFlight(state, player, meta.moveInput, gliderCourseById(state.courseId), ctx.cfg.seed);
  // The tick mutates phase beyond the entry guard's countdown/flying narrowing.
  const phaseAfterTick = state.phase as GliderFlightState['phase'];
  player.onGround = phaseAfterTick === 'won' || phaseAfterTick === 'failed';
  player.fallStartY = player.pos.y;
  if (phaseAfterTick === 'failed') {
    returnGliderToLaunch(ctx, player);
    ctx.emit({
      type: 'log',
      pid: meta.entityId,
      text: 'The updraft carries you back to Zephyr. Speak with him to try again.',
    });
  }

  if (beforePhase === 'countdown' && state.phase === 'flying') {
    ctx.emit({
      type: 'log',
      pid: meta.entityId,
      text: 'The wind catches your glider! Steer through the rings and touch down in the marked landing zone!',
    });
  }

  const input = meta.moveInput;
  if (
    input.turnLeft ||
    input.turnRight ||
    input.strafeLeft ||
    input.strafeRight ||
    input.forward ||
    input.back ||
    input.dive ||
    input.surface ||
    (input.gliderPitch !== undefined && input.gliderPitch !== 0)
  ) {
    meta.lastActiveTick = ctx.tickCount;
    clearAfkOnMove(ctx, meta, player);
  }

  if (
    state.tick % 4 === 0 ||
    state.phase !== beforePhase ||
    state.passedRings.length !== beforeRings ||
    (state.windBoosts?.length ?? 0) !== beforeBoosts
  ) {
    meta.wireRev++;
  }

  return true;
}

/** Returning true authorizes canonical WQ credit when landing criteria are met. */
export function updateGliderEncounter(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  progress: WorldQuestProgress,
): boolean {
  const state = progress.glider;
  if (!state) return false;
  if (player.dead) {
    clearGliderEncounter(meta, progress);
    return false;
  }
  if (player.inCombat || player.mountKey || meta.vehicle)
    abortGliderFlight(ctx, meta, player, progress);
  if (state.phase !== 'won' || !state.result) return false;
  if (!progress.gliderResult || state.result.score > progress.gliderResult.score) {
    progress.gliderResult = { ...state.result };
    meta.wireRev++;
    emitWorldQuestScore(
      ctx,
      meta.entityId,
      GLIDER_QUEST_ID,
      state.result.rating,
      state.result.score,
    );
  }
  if (state.practiceOnly) {
    if (progress.state !== 'completed') {
      progress.state = 'completed';
      progress.count = 1;
      meta.wireRev++;
    }
    return false;
  }
  return true;
}
