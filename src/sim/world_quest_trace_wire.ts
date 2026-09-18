// Session-only trace projection. Saves deliberately use the ordinary progress
// sanitizer instead: sim-clock deadlines and partial paths never survive a load.
import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { WorldQuestProgress, WorldQuestTraceState } from './types';
import { decodeForgeState } from './world_quest_forge_wire';
import { decodeGliderState } from './world_quest_glider_wire';
import { decodeInvestigationState } from './world_quest_investigation_wire';
import { decodeShadowState } from './world_quest_shadow_wire';
import { worldQuestTraceShape } from './world_quest_trace_variants';
import { decodeWispMazeState } from './world_quest_wisp_maze_wire';

export const WORLD_QUEST_TRACE_WIRE_POINT_LIMIT = 256;

function isPoint(value: unknown): value is { x: number; z: number } {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; z?: unknown };
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.z === 'number' &&
    Number.isFinite(point.z)
  );
}

/** Reject malformed readouts atomically, and never retain caller-owned arrays. */
export function decodeWorldQuestTrace(
  value: unknown,
  questId: string,
  variant?: string,
): WorldQuestTraceState | undefined {
  const quest = Object.hasOwn(WORLD_QUESTS_BY_ID, questId)
    ? WORLD_QUESTS_BY_ID[questId]
    : undefined;
  if (!quest || quest.objective.type !== 'tracing' || !value || typeof value !== 'object') {
    return undefined;
  }
  const trace = value as Partial<WorldQuestTraceState>;
  if (
    !Number.isSafeInteger(trace.shapeIndex) ||
    (trace.shapeIndex as number) < 0 ||
    (trace.shapeIndex as number) >= quest.objective.shapes.length
  )
    return undefined;
  const shape = worldQuestTraceShape(quest, trace.shapeIndex as number, variant);
  if (!shape) return undefined;
  if (
    trace.questId !== questId ||
    !['preview', 'drawing', 'failed', 'success'].includes(trace.phase ?? '') ||
    typeof trace.previewUntil !== 'number' ||
    !Number.isFinite(trace.previewUntil) ||
    trace.previewUntil < 0 ||
    typeof trace.expiresAt !== 'number' ||
    !Number.isFinite(trace.expiresAt) ||
    trace.expiresAt < trace.previewUntil ||
    !Array.isArray(trace.trail) ||
    trace.trail.length > WORLD_QUEST_TRACE_WIRE_POINT_LIMIT ||
    !Array.from(trace.trail).every(isPoint) ||
    !isPoint(trace.lastPosition) ||
    !Number.isSafeInteger(trace.segment) ||
    (trace.segment as number) < 0 ||
    (trace.segment as number) >= shape.points.length ||
    (trace.direction !== -1 && trace.direction !== 0 && trace.direction !== 1) ||
    typeof trace.started !== 'boolean' ||
    (trace.reason !== undefined &&
      !['off-path', 'movement', 'timeout', 'combat'].includes(trace.reason))
  )
    return undefined;
  return {
    questId,
    shapeIndex: trace.shapeIndex as number,
    phase: trace.phase as WorldQuestTraceState['phase'],
    previewUntil: trace.previewUntil,
    expiresAt: trace.expiresAt,
    trail: trace.trail.map(({ x, z }) => ({ x, z })),
    lastPosition: { x: trace.lastPosition.x, z: trace.lastPosition.z },
    segment: trace.segment as number,
    direction: trace.direction,
    started: trace.started,
    ...(trace.reason === undefined ? {} : { reason: trace.reason }),
  };
}

/** Snapshots run after the synchronous round update and canonical credit, never
 * between them. Intermediate rounds already preview the next counted shape;
 * only final success retains the just-completed shape beside completed credit. */
export function decodeWorldQuestProgressTrace(
  value: unknown,
  progress: Pick<WorldQuestProgress, 'questId' | 'count' | 'state' | 'traceVariant'>,
): WorldQuestTraceState | undefined {
  const trace = decodeWorldQuestTrace(value, progress.questId, progress.traceVariant);
  if (!trace) return undefined;
  if (progress.state === 'active') {
    return trace.phase !== 'success' && trace.shapeIndex === progress.count ? trace : undefined;
  }
  const quest = WORLD_QUESTS_BY_ID[progress.questId];
  return progress.state === 'completed' &&
    progress.count === quest.count &&
    trace.phase === 'success' &&
    trace.shapeIndex === progress.count - 1
    ? trace
    : undefined;
}

/** The owner-only wire projection retains normal progress and bounds the trace. */
export function worldQuestProgressForWire(progress: WorldQuestProgress): WorldQuestProgress {
  const {
    tracing: rawTrace,
    forging: rawForge,
    wispMaze: rawMaze,
    investigation: rawInvestigation,
    shadow: rawShadow,
    glider: rawGlider,
    ...base
  } = progress;
  const shadow =
    progress.state === 'active' ? decodeShadowState(rawShadow, progress.questId) : undefined;
  const investigation = decodeInvestigationState(rawInvestigation, progress.questId);
  const wispMaze = decodeWispMazeState(rawMaze, progress.questId);
  const forging = decodeForgeState(rawForge, progress.questId);
  const tracing = decodeWorldQuestProgressTrace(rawTrace, progress);
  const glider = decodeGliderState(rawGlider, progress.questId);
  return {
    ...base,
    ...(glider === undefined ? {} : { glider }),
    ...(investigation === undefined ? {} : { investigation }),
    ...(shadow === undefined ? {} : { shadow }),
    ...(wispMaze === undefined ? {} : { wispMaze }),
    ...(forging === undefined ? {} : { forging }),
    ...(base.forgeResult === undefined ? {} : { forgeResult: { ...base.forgeResult } }),
    ...(base.creditedObjects === undefined ? {} : { creditedObjects: [...base.creditedObjects] }),
    ...(base.puzzleRotations === undefined ? {} : { puzzleRotations: [...base.puzzleRotations] }),
    ...(base.match3Board === undefined ? {} : { match3Board: [...base.match3Board] }),
    ...(base.traceScores === undefined
      ? {}
      : { traceScores: base.traceScores.map((score) => ({ ...score })) }),
    ...(base.traceResult === undefined ? {} : { traceResult: { ...base.traceResult } }),
    ...(tracing === undefined ? {} : { tracing }),
  };
}
