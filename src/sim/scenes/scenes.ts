// The Last Bell scene system, sim side: an authored scene is a timed list
// of ops played for one story claim's audience. Generalizes the Nythraxis
// delayed-dialogue pattern into reusable, data-declared scripts
// (registerScene; content in src/sim/content/scenarios/).
//
// The architecture splits a cutscene across the sim/client seam: the sim
// knows WHEN and WHAT (it schedules ops on the tick clock, applies the
// authoritative ones, and emits the rest as personal 'scene' SimEvents to
// every participant), and it never knows what a camera is. The client's
// scene director interprets camera shots, letterboxing, input lock,
// subtitles, fades, and music directives; all presentation, zero authority.
//
// Text rule (S3): dialogue lines carry STABLE KEYS (plus a resolved speaker
// entity id for portraits/positioning); the client renders t(key). The sim
// emits no English prose here.
//
// Skip: any participant may request a skip; the scene fast-forwards for the
// whole claim when EVERY living participant has requested it (solo skip is
// immediate). Fast-forward applies remaining authoritative ops instantly so
// the world state after a skipped scene is identical to a watched one.
//
// Fairness note: scenes play inside safe scenario stages (the sequencer
// only cues a scene on a stage without live pressure), and the input lock
// is presentation: server-side combat authority is never bypassed either way.

import type { SimContext } from '../sim_context';
import { setSquadDirective, squadActorEntity } from '../squad/squad';
import type {
  Entity,
  SceneDollyLookAt,
  SceneReconnectState,
  SceneRigPoint,
  SceneWireOp,
} from '../types';
import { fastForwardActorMoves } from './actor_move';
import {
  clearScriptedPlayerWalks,
  fastForwardScriptedPlayerWalks,
  placePlayerAtWalkEndpoint,
  resolvedPlayerWalkSpeed,
  startScriptedPlayerWalk,
} from './player_walk';
import {
  registeredSceneIds,
  registerScene,
  type SceneAttachShotDef,
  type SceneDef,
  type SceneDollyLookAtDef,
  type SceneDollyShotDef,
  type SceneOpDef,
  type SceneRigPointDef,
  sceneById,
} from './registry';

export {
  registeredSceneIds,
  registerScene,
  type SceneAttachShotDef,
  type SceneDef,
  type SceneDollyLookAtDef,
  type SceneDollyShotDef,
  type SceneOpDef,
  type SceneRigPointDef,
  sceneById,
};

export interface ScenePlayback {
  sceneId: string;
  claimId: number;
  dungeonId: string;
  startedAt: number;
  /** Index-aligned with the def's ops (sorted by `at` at registration). */
  emitted: boolean[];
  /** Every pid that received this playback's start op. */
  startedAudience: Set<number>;
  skipRequested: Set<number>;
  /** Personal shared-world playback: the audience is exactly this player,
   * camera points are world coords, and actor ops are unavailable. */
  audiencePid?: number;
}

export function sceneActiveFor(ctx: SimContext, claimId: number): boolean {
  return ctx.scenePlaybacks.has(claimId);
}

function participants(ctx: SimContext, playback: ScenePlayback): Entity[] {
  if (playback.audiencePid !== undefined) {
    const p = ctx.entities.get(playback.audiencePid);
    return p ? [p] : [];
  }
  const inst = ctx.instances.find(
    (i) => i.dungeonId === playback.dungeonId && i.exitId === playback.claimId,
  );
  if (!inst) return [];
  const origin = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    if (Math.abs(p.pos.x - origin.x) < 120 && Math.abs(p.pos.z - origin.z) < 250) out.push(p);
  }
  return out;
}

/** Persistent scene state for a reconnecting participant. One-shot camera,
 * line, animation, fade, and prop history is deliberately not replayed. */
export function sceneReconnectStateFor(ctx: SimContext, pid: number): SceneReconnectState | null {
  let active: ScenePlayback | null = null;
  for (const playback of ctx.scenePlaybacks.values()) {
    if (!playback.startedAudience.has(pid)) continue;
    if (active === null || playback.startedAt >= active.startedAt) active = playback;
  }
  if (active === null) return null;
  const def = sceneById(active.sceneId);
  if (!def) return null;
  let inputLocked = false;
  let letterbox = false;
  let musicSilenced = false;
  for (let index = 0; index < def.ops.length; index++) {
    if (!active.emitted[index]) continue;
    const op = def.ops[index];
    if (op.kind === 'inputLock') inputLocked = op.on;
    if (op.kind === 'letterbox') letterbox = op.on;
    if (op.kind === 'music' && op.directive === 'silence') musicSilenced = true;
    if (op.kind === 'music' && op.directive === 'resume') musicSilenced = false;
  }
  return {
    sceneId: active.sceneId,
    remainingSeconds: Math.max(0, def.duration - (ctx.time - active.startedAt)),
    inputLocked,
    letterbox,
    musicSilenced,
  };
}

function claimOrigin(ctx: SimContext, playback: ScenePlayback): { x: number; z: number } | null {
  if (playback.audiencePid !== undefined) return null; // world coords verbatim
  const inst = ctx.instances.find(
    (i) => i.dungeonId === playback.dungeonId && i.exitId === playback.claimId,
  );
  return inst ? ctx.instanceOriginOf(inst) : null;
}

function resolveRigPoint(
  ctx: SimContext,
  origin: { x: number; z: number } | null,
  point: SceneRigPointDef,
): SceneRigPoint {
  const x = origin ? origin.x + point.x : point.x;
  const z = origin ? origin.z + point.z : point.z;
  return { x, y: ctx.groundPos(x, z).y + point.height, z };
}

function cameraShotDuration(def: SceneDef, opIndex: number): number {
  const current = def.ops[opIndex];
  if (current?.kind !== 'camera' || current.shot.kind === 'release') return 0;
  for (let index = opIndex + 1; index < def.ops.length; index++) {
    const next = def.ops[index];
    if (next.kind === 'camera' && next.at > current.at) return next.at - current.at;
  }
  return Math.max(0, def.duration - current.at);
}

// A personal shared-world scene (the ferry arrival): audience of one, no
// claim, camera points are world coords, keyed by -pid so claim playbacks
// (positive entity-id keys) never collide.
export function playSceneForPlayer(ctx: SimContext, pid: number, sceneId: string): boolean {
  const def = sceneById(sceneId);
  if (!def || !ctx.entities.has(pid)) return false;
  const key = -pid;
  if (ctx.scenePlaybacks.has(key)) return false;
  const playback: ScenePlayback = {
    sceneId,
    claimId: key,
    dungeonId: '',
    startedAt: ctx.time,
    emitted: def.ops.map(() => false),
    startedAudience: new Set(),
    skipRequested: new Set(),
    audiencePid: pid,
  };
  ctx.scenePlaybacks.set(key, playback);
  emitToAudience(ctx, playback, { kind: 'start', duration: def.duration });
  return true;
}

export function playScene(ctx: SimContext, claimId: number, sceneId: string): boolean {
  const def = sceneById(sceneId);
  if (!def) return false;
  const inst = ctx.instances.find((i) => i.exitId === claimId && i.partyKey !== null);
  if (!inst) return false;
  if (ctx.scenePlaybacks.has(claimId)) return false; // one scene at a time per claim
  const playback: ScenePlayback = {
    sceneId,
    claimId,
    dungeonId: inst.dungeonId,
    startedAt: ctx.time,
    emitted: def.ops.map(() => false),
    startedAudience: new Set(),
    skipRequested: new Set(),
  };
  ctx.scenePlaybacks.set(claimId, playback);
  emitToAudience(ctx, playback, { kind: 'start', duration: def.duration });
  return true;
}

function emitToAudience(ctx: SimContext, playback: ScenePlayback, op: SceneWireOp): void {
  for (const p of participants(ctx, playback)) {
    ctx.emit({ type: 'scene', sceneId: playback.sceneId, op, pid: p.id });
    if (op.kind === 'start') playback.startedAudience.add(p.id);
  }
}

function emitTerminalToStartedAudience(
  ctx: SimContext,
  playback: ScenePlayback,
  op: SceneWireOp,
): void {
  for (const pid of playback.startedAudience) {
    ctx.emit({ type: 'scene', sceneId: playback.sceneId, op, pid });
  }
}

export function isSceneTerminalTeardownOp(op: SceneWireOp): boolean {
  switch (op.kind) {
    case 'end':
      return true;
    case 'camera':
      return op.shot.kind === 'release';
    case 'letterbox':
    case 'inputLock':
      return !op.on;
    case 'fade':
      return op.to === 'clear';
    case 'music':
      return op.directive === 'resume';
    default:
      return false;
  }
}

function emitResolvedOp(ctx: SimContext, playback: ScenePlayback, op: SceneWireOp): void {
  if (isSceneTerminalTeardownOp(op)) {
    emitTerminalToStartedAudience(ctx, playback, op);
    return;
  }
  for (const participant of participants(ctx, playback)) {
    if (!playback.startedAudience.has(participant.id)) continue;
    ctx.emit({ type: 'scene', sceneId: playback.sceneId, op, pid: participant.id });
  }
}

// Resolve an authoring op to its wire shape (entity ids + world coords) and
// apply its authoritative side (actor movement/facing) to the sim.
function resolveAndApply(
  ctx: SimContext,
  playback: ScenePlayback,
  op: SceneOpDef,
  applyOnly: boolean,
  shotDuration = 0,
): SceneWireOp | null {
  const origin = claimOrigin(ctx, playback);
  const actorEntity = (actorId: string | undefined): Entity | null =>
    actorId !== undefined ? squadActorEntity(ctx, playback.claimId, actorId) : null;
  switch (op.kind) {
    case 'line': {
      const speaker = actorEntity(op.speakerActorId);
      return applyOnly
        ? null
        : {
            kind: 'line',
            speaker: op.speaker,
            speakerEntityId: speaker?.id ?? null,
            key: op.key,
            dur: op.dur ?? 4,
          };
    }
    case 'camera': {
      if (applyOnly) return null;
      if (op.shot.kind === 'release') {
        return {
          kind: 'camera',
          shot: op.shot.pose ? { kind: 'release', pose: op.shot.pose } : { kind: 'release' },
        };
      }
      if (op.shot.kind === 'dolly') {
        const points = op.shot.points.map((point) => resolveRigPoint(ctx, origin, point));
        const authoredLookAt = op.shot.lookAt;
        let lookAt: SceneDollyLookAt;
        switch (authoredLookAt.kind) {
          case 'point':
            lookAt = {
              kind: 'point' as const,
              point: resolveRigPoint(ctx, origin, authoredLookAt.point),
            };
            break;
          case 'spline':
            lookAt = {
              kind: 'spline' as const,
              points: authoredLookAt.points.map((point) => resolveRigPoint(ctx, origin, point)),
            };
            break;
          case 'subject': {
            const target = actorEntity(authoredLookAt.actorId);
            lookAt = {
              kind: 'subject' as const,
              entityId: target?.id ?? null,
              offset: authoredLookAt.offset,
              fallback: resolveRigPoint(ctx, origin, authoredLookAt.fallback),
            };
            break;
          }
        }
        return {
          kind: 'camera',
          shot: { kind: 'dolly', points, lookAt, dur: op.shot.dur },
        };
      }
      if (op.shot.kind === 'attach') {
        return {
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: op.shot.target,
            dur: shotDuration,
            fallbackFrame: {
              position: resolveRigPoint(ctx, origin, op.shot.fallbackFrame.point),
              yaw: op.shot.fallbackFrame.yaw,
            },
            offset: op.shot.offset,
            lookAt: op.shot.lookAt,
          },
        };
      }
      const target = actorEntity(op.shot.actorId);
      const wx = target ? target.pos.x : origin ? origin.x + (op.shot.x ?? 0) : (op.shot.x ?? 0);
      const wz = target ? target.pos.z : origin ? origin.z + (op.shot.z ?? 0) : (op.shot.z ?? 0);
      const wy = target ? target.pos.y : ctx.groundPos(wx, wz).y;
      return {
        kind: 'camera',
        shot: {
          kind: 'focus',
          entityId: target?.id ?? null,
          x: wx,
          y: wy,
          z: wz,
          dist: op.shot.dist ?? 8,
          pitch: op.shot.pitch ?? 0.3,
          yaw: op.shot.yaw ?? 0,
          dur: op.shot.dur,
        },
      };
    }
    case 'letterbox':
      return applyOnly ? null : { kind: 'letterbox', on: op.on };
    case 'inputLock':
      return applyOnly ? null : { kind: 'inputLock', on: op.on };
    case 'fade':
      return applyOnly ? null : { kind: 'fade', to: op.to, dur: op.dur };
    case 'music':
      return applyOnly ? null : { kind: 'music', directive: op.directive };
    case 'playerWalk': {
      const x = origin ? origin.x + op.to.x : op.to.x;
      const z = origin ? origin.z + op.to.z : op.to.z;
      const to = ctx.groundPos(x, z);
      for (const player of participants(ctx, playback)) {
        if (!playback.startedAudience.has(player.id)) continue;
        if (applyOnly) {
          placePlayerAtWalkEndpoint(ctx, player, to);
        } else {
          startScriptedPlayerWalk(ctx, playback.claimId, player, to, op.speed);
        }
      }
      return applyOnly
        ? null
        : { kind: 'playerWalk', to, speed: resolvedPlayerWalkSpeed(op.speed) };
    }
    case 'actorMove': {
      // Authoritative: order the actor to the point (hold directive), so a
      // skipped scene leaves actors exactly where a watched one does.
      if (origin) {
        setSquadDirective(ctx, playback.claimId, op.actorId, {
          kind: 'hold',
          x: origin.x + op.x,
          z: origin.z + op.z,
        });
      }
      return null;
    }
    case 'actorFace': {
      const actor = actorEntity(op.actorId);
      if (actor) actor.facing = op.facing;
      return null;
    }
    case 'anim': {
      const actor = actorEntity(op.actorId);
      return applyOnly || !actor ? null : { kind: 'anim', entityId: actor.id, anim: op.anim };
    }
    case 'prop':
      // Pure presentation: the client resolves the target key and segment id
      // to a render prop path.
      return applyOnly ? null : { kind: 'prop', target: op.target, cue: op.cue };
  }
}

/** The end op re-carries the def's authored release pose: a skip drops the
 * un-emitted camera/release op, and the director's unconditional end teardown
 * must hand the camera back to the same authored pose either way. */
function sceneEndOp(def: SceneDef | undefined): SceneWireOp {
  for (const op of def?.ops ?? []) {
    if (op.kind === 'camera' && op.shot.kind === 'release' && op.shot.pose) {
      return { kind: 'end', releasePose: op.shot.pose };
    }
  }
  return { kind: 'end' };
}

function finishScene(ctx: SimContext, playback: ScenePlayback, skipped: boolean): void {
  const def = sceneById(playback.sceneId);
  // Settle every already-emitted walk at its authored endpoint on both natural
  // completion and skip. A later un-emitted walk may still win in authoring
  // order through the skip-only applyOnly arm below.
  fastForwardScriptedPlayerWalks(ctx, playback.claimId);
  if (def && skipped) {
    // Fast-forward the remaining authoritative ops so world state matches a
    // watched scene; presentation ops are dropped (the client tears down on
    // the end op).
    for (let i = 0; i < def.ops.length; i++) {
      if (!playback.emitted[i]) resolveAndApply(ctx, playback, def.ops[i], true);
    }
  }
  if (def) {
    fastForwardActorMoves(ctx, playback.claimId, claimOrigin(ctx, playback), def.ops);
  }
  // End is unconditional teardown, including stale walk state whose player
  // entity disappeared before the endpoint could be placed.
  clearScriptedPlayerWalks(ctx, playback.claimId);
  emitTerminalToStartedAudience(ctx, playback, sceneEndOp(def));
  ctx.scenePlaybacks.delete(playback.claimId);
}

// A participant asks to skip the claim's active scene. Solo skip is
// immediate; in a party the scene ends once every LIVING participant asks.
export function requestSceneSkip(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  for (const playback of ctx.scenePlaybacks.values()) {
    const audience = participants(ctx, playback).filter((participant) =>
      playback.startedAudience.has(participant.id),
    );
    if (!audience.some((p) => p.id === r.meta.entityId)) continue;
    playback.skipRequested.add(r.meta.entityId);
    const living = audience.filter((p) => !p.dead);
    if (living.every((p) => playback.skipRequested.has(p.id))) {
      finishScene(ctx, playback, true);
    }
    return true;
  }
  return false;
}

// Per-tick driver, called from the Sim tick body after scenarios. A stage
// that cues a scene arms it and emits at:0 ops in the same tick; scripted
// player movement starts next tick because the player phase already ran.
// Zero work while no scene is live.
export function updateScenes(ctx: SimContext): void {
  for (const playback of [...ctx.scenePlaybacks.values()]) {
    const def = sceneById(playback.sceneId);
    if (!def) {
      clearScriptedPlayerWalks(ctx, playback.claimId);
      emitTerminalToStartedAudience(ctx, playback, { kind: 'end' });
      ctx.scenePlaybacks.delete(playback.claimId);
      continue;
    }
    // A recycled claim tears its scene down silently (personal playbacks
    // have no claim and run to completion or skip).
    const claimAlive =
      playback.audiencePid !== undefined ||
      ctx.instances.some(
        (i) => i.dungeonId === playback.dungeonId && i.exitId === playback.claimId,
      );
    if (!claimAlive) {
      clearScriptedPlayerWalks(ctx, playback.claimId);
      emitTerminalToStartedAudience(ctx, playback, sceneEndOp(def));
      ctx.scenePlaybacks.delete(playback.claimId);
      continue;
    }
    const elapsed = ctx.time - playback.startedAt;
    for (let i = 0; i < def.ops.length; i++) {
      if (playback.emitted[i] || def.ops[i].at > elapsed) continue;
      playback.emitted[i] = true;
      const wire = resolveAndApply(ctx, playback, def.ops[i], false, cameraShotDuration(def, i));
      if (wire) emitResolvedOp(ctx, playback, wire);
    }
    if (elapsed >= def.duration) finishScene(ctx, playback, false);
  }
}
