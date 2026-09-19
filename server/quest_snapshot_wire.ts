import { livePlaytimeSeconds } from '../src/sim/playtime';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import {
  activePublicWorldQuestTracePids,
  nearbyWorldQuestTraces,
  PUBLIC_WORLD_QUEST_TRACE_RADIUS,
  type PublicTraceCandidate,
  type PublicTraceWorld,
} from '../src/sim/world_quest_trace_public';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';

type EmitSelfKey = (key: string, value: unknown) => void;

export type { PublicTraceCandidate };

/** Small activity/progression mirrors must reconcile outside the heavy gate.
 * Session events missed while linkdead are not replayed on resume. Emit explicit
 * null/false clears, and preserve the host's byte-diff and ordering contract. */
export function emitActivitySelfKeys(
  emit: EmitSelfKey,
  sim: Sim,
  meta: PlayerMeta,
  pid: number,
): void {
  // Riding skill: persisted, so the client knows whether to show the riding
  // trainer UI without waiting on a mount/select command to fail. Wire key
  // `mntRtd`; delta-guarded, only changes once (false to true, never back).
  emit('mntRtd', meta.ridingTrained === true ? true : null);
  // Session-only lesson and race state must still reconcile after linkdead:
  // events sent while the socket is absent are not replayed on resume. These
  // self deltas are authoritative and clear stale client mirrors with false/null.
  emit('mntLesson', sim.mountLessonActiveFor(pid));
  emit('mntRace', sim.mountRaceViewFor(pid));
  emit('vehicle', sim.vehicleSessionFor(pid));
  // Book of Deeds: the Renown total and the two selected cosmetic ids
  // (title and nameplate border), cheap scalars diffed per tick (grants land
  // from sim sites that never mark this session dirty, and neither cosmetic
  // echo must wait on the heavy gate).
  emit('renown', meta.renown);
  emit('atitle', meta.activeTitle);
  emit('aborder', meta.activeBorder);
  // Lifetime played time (IWorldProgressionXp.playtimeSeconds), quantized to
  // whole minutes so the serialized form changes about once a minute and the
  // delta gate drops it from every other tick; the sheet displays minutes at
  // most, so no read loses precision.
  emit('ptime', Math.floor(livePlaytimeSeconds(meta, sim.time) / 60) * 60);
}
/** Per-viewer, unconditional snapshot suffix: absence is an explicit clear. */
export { activePublicWorldQuestTracePids, PUBLIC_WORLD_QUEST_TRACE_RADIUS };

/** Keep one observed entity as a public trace candidate: it must be an active tracer
 *  within the public trace radius of the viewer (squared distance, as the grid walk has). */
export function collectPublicTraceCandidate(
  tracerPids: ReadonlySet<number>,
  entity: Entity,
  distanceSq: number,
  out: PublicTraceCandidate[],
): void {
  if (
    tracerPids.size > 0 &&
    distanceSq <= PUBLIC_WORLD_QUEST_TRACE_RADIUS * PUBLIC_WORLD_QUEST_TRACE_RADIUS &&
    tracerPids.has(entity.id)
  ) {
    out.push({ player: entity, distance: distanceSq });
  }
}

export function nearbyQuestTraceWireJson(
  world: PublicTraceWorld,
  viewerId: number,
  sharedCandidates?: readonly PublicTraceCandidate[],
): string {
  return `,"qtraces":${JSON.stringify(nearbyWorldQuestTraces(world, viewerId, sharedCandidates))}`;
}

/** Emit the heavy owner-only quest snapshot family through the host's delta gate. */
export function emitQuestSelfKeys(emit: EmitSelfKey, sim: Sim, meta: PlayerMeta): void {
  // qlog carries creditedObjects (the opened-crate per-viewer hide,
  // src/sim/quests/opened_object_view.ts): bounded, personal, on-change.
  emit('qlog', [...meta.questLog.values()]);
  emit('qdone', [...meta.questsDone]);
  emit('wqday', meta.worldQuestCycle);
  emit('wqexp', sim.worldQuestExpiresAtMs);
  emit('wqlog', [...meta.worldQuestLog.values()].map(worldQuestProgressForWire));
  // Faction standing and the daily reroll ride the same owner-only gate: a
  // completion (every worldQuest* event is heavy-self) or a reroll (which bumps
  // wireRev) re-diffs them, and the three-key record is cheap to compare.
  emit('fac', meta.factions);
  // Clue Scrolls: the active hunt cursor (null when none). Every hunt
  // transition bumps wireRev (src/sim/clue_scrolls.ts), so the heavy gate
  // re-diffs it the tick it moves; the explicit null clears a finished or
  // abandoned hunt on the client.
  emit('cluh', meta.clueHunt);
  emit('wqrr', meta.worldQuestRerollCycle);
  emit('wqrep', meta.worldQuestReplacements ?? {});
  emit('wkq', meta.weeklyQuest);
  emit('wkexp', sim.weeklyQuestResetAtMs);
}
