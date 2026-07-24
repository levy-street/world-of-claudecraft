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
import type { Entity, SceneWireOp } from '../types';

// Authoring shapes: actor ids and instance-local coords; resolved to entity
// ids and world coords at emit time.
export type SceneOpDef = { at: number } & (
  | { kind: 'line'; speaker: string; speakerActorId?: string; key: string; dur?: number }
  | {
      kind: 'camera';
      shot:
        | {
            kind: 'focus';
            actorId?: string;
            x?: number;
            z?: number;
            dist?: number;
            pitch?: number;
            yaw?: number;
            dur: number;
          }
        | { kind: 'release' };
    }
  | { kind: 'letterbox'; on: boolean }
  | { kind: 'inputLock'; on: boolean }
  | { kind: 'fade'; to: 'black' | 'clear'; dur: number }
  | { kind: 'music'; directive: string }
  | { kind: 'actorMove'; actorId: string; x: number; z: number }
  | { kind: 'actorFace'; actorId: string; facing: number }
  | { kind: 'anim'; actorId: string; anim: string }
);

export interface SceneDef {
  id: string;
  /** Total scene length in seconds; the end op emits when it elapses. */
  duration: number;
  ops: readonly SceneOpDef[];
}

export interface ScenePlayback {
  sceneId: string;
  claimId: number;
  dungeonId: string;
  startedAt: number;
  /** Index-aligned with the def's ops (sorted by `at` at registration). */
  emitted: boolean[];
  skipRequested: Set<number>;
}

const SCENES: Record<string, SceneDef> = {};

export function registerScene(def: SceneDef): void {
  // Ops evaluate in time order whatever order the author listed them.
  SCENES[def.id] = { ...def, ops: [...def.ops].sort((a, b) => a.at - b.at) };
}

export function sceneById(id: string): SceneDef | undefined {
  return SCENES[id];
}

export function sceneActiveFor(ctx: SimContext, claimId: number): boolean {
  return ctx.scenePlaybacks.has(claimId);
}

function participants(ctx: SimContext, playback: ScenePlayback): Entity[] {
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

function claimOrigin(ctx: SimContext, playback: ScenePlayback): { x: number; z: number } | null {
  const inst = ctx.instances.find(
    (i) => i.dungeonId === playback.dungeonId && i.exitId === playback.claimId,
  );
  return inst ? ctx.instanceOriginOf(inst) : null;
}

export function playScene(ctx: SimContext, claimId: number, sceneId: string): boolean {
  const def = SCENES[sceneId];
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
    skipRequested: new Set(),
  };
  ctx.scenePlaybacks.set(claimId, playback);
  emitToAudience(ctx, playback, { kind: 'start', duration: def.duration });
  return true;
}

function emitToAudience(ctx: SimContext, playback: ScenePlayback, op: SceneWireOp): void {
  for (const p of participants(ctx, playback)) {
    ctx.emit({ type: 'scene', sceneId: playback.sceneId, op, pid: p.id });
  }
}

// Resolve an authoring op to its wire shape (entity ids + world coords) and
// apply its authoritative side (actor movement/facing) to the sim.
function resolveAndApply(
  ctx: SimContext,
  playback: ScenePlayback,
  op: SceneOpDef,
  applyOnly: boolean,
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
      if (op.shot.kind === 'release') return { kind: 'camera', shot: { kind: 'release' } };
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
  }
}

function finishScene(ctx: SimContext, playback: ScenePlayback, skipped: boolean): void {
  const def = SCENES[playback.sceneId];
  if (def && skipped) {
    // Fast-forward the remaining authoritative ops so world state matches a
    // watched scene; presentation ops are dropped (the client tears down on
    // the end op).
    for (let i = 0; i < def.ops.length; i++) {
      if (!playback.emitted[i]) resolveAndApply(ctx, playback, def.ops[i], true);
    }
  }
  emitToAudience(ctx, playback, { kind: 'end' });
  ctx.scenePlaybacks.delete(playback.claimId);
}

// A participant asks to skip the claim's active scene. Solo skip is
// immediate; in a party the scene ends once every LIVING participant asks.
export function requestSceneSkip(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  for (const playback of ctx.scenePlaybacks.values()) {
    const audience = participants(ctx, playback);
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

// Per-tick driver, called from the Sim tick body after scenarios (a stage
// that cues a scene arms it the same tick; ops start next tick). Zero work
// while no scene is live.
export function updateScenes(ctx: SimContext): void {
  for (const playback of [...ctx.scenePlaybacks.values()]) {
    const def = SCENES[playback.sceneId];
    if (!def) {
      ctx.scenePlaybacks.delete(playback.claimId);
      continue;
    }
    // A recycled claim tears its scene down silently.
    const claimAlive = ctx.instances.some(
      (i) => i.dungeonId === playback.dungeonId && i.exitId === playback.claimId,
    );
    if (!claimAlive) {
      ctx.scenePlaybacks.delete(playback.claimId);
      continue;
    }
    const elapsed = ctx.time - playback.startedAt;
    for (let i = 0; i < def.ops.length; i++) {
      if (playback.emitted[i] || def.ops[i].at > elapsed) continue;
      playback.emitted[i] = true;
      const wire = resolveAndApply(ctx, playback, def.ops[i], false);
      if (wire) emitToAudience(ctx, playback, wire);
    }
    if (elapsed >= def.duration) finishScene(ctx, playback, false);
  }
}
