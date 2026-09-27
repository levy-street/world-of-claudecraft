// Public ink projection shared by offline and authoritative online worlds.
// Explicit fields prevent private memorization, corner, and scoring state leaking.
import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { SpatialGrid } from './spatial';
import type { Entity, WorldQuestProgress } from './types';
import { WORLD_QUEST_TRACE_VARIANTS, worldQuestTraceShape } from './world_quest_trace_variants';

export const PUBLIC_WORLD_QUEST_TRACE_RADIUS = 35;
export const PUBLIC_WORLD_QUEST_TRACE_LIMIT = 4;
export const PUBLIC_WORLD_QUEST_TRACE_TAIL = 32;

interface PublicTraceBase {
  pid: number;
  name: string;
  questId: string;
  shapeIndex: number;
  variant: string;
  trail: { x: number; z: number }[];
}
export type NearbyWorldQuestTrace = PublicTraceBase &
  (
    | { phase: 'drawing' }
    | { phase: 'success'; score: number; rating: 'bronze' | 'silver' | 'gold'; expiresAt: number }
  );

export interface PublicTraceWorld {
  readonly time: number;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly players: ReadonlyMap<number, { worldQuestLog: ReadonlyMap<string, WorldQuestProgress> }>;
  readonly playerGrid: Pick<SpatialGrid, 'forEachInRadius'>;
  isHostileTo(viewer: Entity, other: Entity): boolean;
}

export interface PublicTraceCandidate {
  player: Entity;
  /** Squared viewer-relative distance, already computed by snapshot interest. */
  distance: number;
}

/** One linear pass per broadcast replaces the former player-grid pass per
 *  viewer. Validation still happens when each public row is projected. */
export function activePublicWorldQuestTracePids(
  world: Pick<PublicTraceWorld, 'time' | 'players'>,
): ReadonlySet<number> {
  const active = new Set<number>();
  if (!Number.isFinite(world.time)) return active;
  for (const [pid, meta] of world.players) {
    for (const progress of meta.worldQuestLog.values()) {
      const state = progress.tracing;
      if (
        state &&
        Number.isFinite(state.expiresAt) &&
        state.expiresAt > world.time &&
        (state.phase === 'drawing' || state.phase === 'success')
      ) {
        active.add(pid);
        break;
      }
    }
  }
  return active;
}

/** One public-only row decoder. Reconstructing a whitelist never carries extras. */
export function decodePublicWorldQuestTrace(
  value: unknown,
  viewerId: number,
  now: number,
): NearbyWorldQuestTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<PublicTraceBase> & {
    phase?: unknown;
    score?: unknown;
    rating?: unknown;
    expiresAt?: unknown;
  };
  if (
    !Number.isSafeInteger(row.pid) ||
    (row.pid as number) <= 0 ||
    row.pid === viewerId ||
    typeof row.name !== 'string' ||
    row.name.length === 0 ||
    row.name.length > 64 ||
    [...row.name].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    typeof row.questId !== 'string' ||
    !Object.hasOwn(WORLD_QUESTS_BY_ID, row.questId) ||
    typeof row.variant !== 'string' ||
    !WORLD_QUEST_TRACE_VARIANTS.some((variant) => variant === row.variant) ||
    !Number.isSafeInteger(row.shapeIndex) ||
    !worldQuestTraceShape(WORLD_QUESTS_BY_ID[row.questId], row.shapeIndex as number, row.variant) ||
    (row.phase !== 'drawing' && row.phase !== 'success') ||
    !Array.isArray(row.trail) ||
    row.trail.length > PUBLIC_WORLD_QUEST_TRACE_TAIL
  )
    return undefined;
  const trail: PublicTraceBase['trail'] = [];
  for (const point of row.trail) {
    if (
      !point ||
      typeof point !== 'object' ||
      typeof point.x !== 'number' ||
      !Number.isFinite(point.x) ||
      typeof point.z !== 'number' ||
      !Number.isFinite(point.z)
    )
      return undefined;
    trail.push({ x: point.x, z: point.z });
  }
  const base: PublicTraceBase = {
    pid: row.pid as number,
    name: row.name,
    questId: row.questId,
    shapeIndex: row.shapeIndex as number,
    variant: row.variant,
    trail,
  };
  if (row.phase === 'drawing') return { ...base, phase: 'drawing' };
  if (
    row.shapeIndex !== WORLD_QUESTS_BY_ID[row.questId].count - 1 ||
    !Number.isSafeInteger(row.score) ||
    (row.score as number) < 0 ||
    (row.score as number) > 100 ||
    (row.rating !== 'bronze' && row.rating !== 'silver' && row.rating !== 'gold') ||
    typeof row.expiresAt !== 'number' ||
    !Number.isFinite(row.expiresAt) ||
    row.expiresAt <= now
  )
    return undefined;
  return {
    ...base,
    phase: 'success',
    score: row.score as number,
    rating: row.rating,
    expiresAt: row.expiresAt,
  };
}

/** Spatially scoped, bounded nearest-four selection; no realm-wide player scan. */
export function nearbyWorldQuestTraces(
  world: PublicTraceWorld,
  viewerId: number,
  sharedCandidates?: readonly PublicTraceCandidate[],
): readonly NearbyWorldQuestTrace[] {
  const viewer = world.entities.get(viewerId);
  if (!viewer || !Number.isFinite(world.time)) return [];
  const candidates: { distance: number; trace: NearbyWorldQuestTrace }[] = [];
  const visit = (player: Entity, distance: number) => {
    if (
      player.id === viewerId ||
      player.kind !== 'player' ||
      player.dead ||
      player.stealthed ||
      player.dungeonId !== viewer.dungeonId ||
      world.isHostileTo(viewer, player) ||
      !Number.isFinite(distance) ||
      distance > PUBLIC_WORLD_QUEST_TRACE_RADIUS ** 2
    )
      return;
    const meta = world.players.get(player.id);
    if (!meta) return;
    for (const progress of meta.worldQuestLog.values()) {
      const state = progress.tracing;
      if (
        !state ||
        state.questId !== progress.questId ||
        !Number.isFinite(state.expiresAt) ||
        state.expiresAt <= world.time ||
        !Array.isArray(state.trail) ||
        state.trail.length > 256 ||
        (state.phase !== 'drawing' && state.phase !== 'success')
      )
        continue;
      if (
        state.phase === 'drawing'
          ? progress.state !== 'active' || state.shapeIndex !== progress.count
          : progress.state !== 'completed' || state.shapeIndex !== progress.count - 1
      )
        continue;
      const trace = decodePublicWorldQuestTrace(
        {
          pid: player.id,
          name: player.name.slice(0, 64),
          questId: progress.questId,
          shapeIndex: state.shapeIndex,
          variant: progress.traceVariant ?? 'star',
          phase: state.phase,
          trail: state.trail.slice(-PUBLIC_WORLD_QUEST_TRACE_TAIL),
          ...(state.phase === 'success'
            ? {
                score: progress.traceResult?.score,
                rating: progress.traceResult?.rating,
                expiresAt: state.expiresAt,
              }
            : {}),
        },
        viewerId,
        world.time,
      );
      if (!trace) continue;
      candidates.push({ distance, trace });
      candidates.sort((a, b) => a.distance - b.distance || a.trace.pid - b.trace.pid);
      if (candidates.length > PUBLIC_WORLD_QUEST_TRACE_LIMIT) candidates.pop();
      break;
    }
  };
  if (sharedCandidates) {
    for (const { player, distance } of sharedCandidates) visit(player, distance);
  } else {
    world.playerGrid.forEachInRadius(
      viewer.pos.x,
      viewer.pos.z,
      PUBLIC_WORLD_QUEST_TRACE_RADIUS,
      visit,
    );
  }
  return candidates.map(({ trace }) => trace);
}
