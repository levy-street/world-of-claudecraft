// Public calligraphy is a social silhouette, never another player's guide.
import type { Entity, WorldQuestDef, WorldQuestTraceDef } from '../sim/types';
import {
  type NearbyWorldQuestTrace,
  PUBLIC_WORLD_QUEST_TRACE_LIMIT,
  PUBLIC_WORLD_QUEST_TRACE_RADIUS,
  PUBLIC_WORLD_QUEST_TRACE_TAIL,
} from '../sim/world_quest_trace_public';
import {
  WORLD_QUEST_TRACE_VARIANTS,
  worldQuestTraceShape,
} from '../sim/world_quest_trace_variants';

export const PUBLIC_TRACE_SLOTS = PUBLIC_WORLD_QUEST_TRACE_LIMIT;
const EMPTY_PUBLIC_TRACES: readonly NearbyWorldQuestTrace[] = [];
export interface PublicTraceSlot {
  trace: NearbyWorldQuestTrace | null;
  shape: WorldQuestTraceDef | null;
  name: string;
  x: number;
  z: number;
}
export interface PublicTraceReader {
  nearbyWorldQuestTraces: readonly NearbyWorldQuestTrace[];
  player: Pick<Entity, 'id' | 'pos'>;
  entities: ReadonlyMap<number, Pick<Entity, 'id' | 'kind' | 'name' | 'hostile' | 'dead' | 'pos'>>;
}

export function newPublicTraceSlots(): PublicTraceSlot[] {
  return Array.from({ length: PUBLIC_TRACE_SLOTS }, () => ({
    trace: null,
    shape: null,
    name: '',
    x: 0,
    z: 0,
  }));
}

/** Offline projections can mint an equivalent record every render read. Compare
 * the bounded ink coordinates, not object identity, before touching GPU buffers. */
export function publicTraceTrailChangedInto(
  samples: Float64Array,
  previousCount: number,
  trail: readonly { x: number; z: number }[],
): boolean {
  let changed = previousCount !== trail.length;
  for (let i = 0; i < trail.length; i++) {
    changed ||= samples[i * 2] !== trail[i].x || samples[i * 2 + 1] !== trail[i].z;
    samples[i * 2] = trail[i].x;
    samples[i * 2 + 1] = trail[i].z;
  }
  return changed;
}

function publicShape(
  world: PublicTraceReader,
  trace: NearbyWorldQuestTrace,
  definitions: Readonly<Record<string, WorldQuestDef>>,
): WorldQuestTraceDef | undefined {
  const entity = world.entities.get(trace.pid);
  if (entity?.kind !== 'player' || entity.hostile || entity.dead || trace.pid === world.player.id)
    return;
  if (
    entity.name !== trace.name ||
    !trace.name ||
    trace.name.length > 64 ||
    !safePublicName(trace.name)
  )
    return;
  const distance = Math.hypot(entity.pos.x - world.player.pos.x, entity.pos.z - world.player.pos.z);
  if (!Number.isFinite(distance) || distance > PUBLIC_WORLD_QUEST_TRACE_RADIUS) return;
  if (trace.phase !== 'drawing' && trace.phase !== 'success') return;
  if (
    !Array.isArray(trace.trail) ||
    trace.trail.length > PUBLIC_WORLD_QUEST_TRACE_TAIL ||
    trace.trail.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))
  )
    return;
  if (
    trace.phase === 'success' &&
    (!Number.isInteger(trace.score) ||
      trace.score < 0 ||
      trace.score > 100 ||
      !['bronze', 'silver', 'gold'].includes(trace.rating) ||
      !Number.isFinite(trace.expiresAt) ||
      trace.expiresAt <= 0)
  )
    return;
  const quest = definitions[trace.questId];
  if (
    !quest ||
    !Number.isInteger(trace.shapeIndex) ||
    trace.shapeIndex < 0 ||
    !WORLD_QUEST_TRACE_VARIANTS.some((variant) => variant === trace.variant)
  )
    return;
  return worldQuestTraceShape(quest, trace.shapeIndex, trace.variant);
}

function safePublicName(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (
      code < 32 ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
      return false;
  }
  return true;
}

/** Retain owner slots through snapshot reordering; retire stale slots before
 * taking a free one. Exactly four slots and four candidate reads per pass. */
export function publicTraceSlotsInto(
  slots: PublicTraceSlot[],
  world: PublicTraceReader,
  definitions: Readonly<Record<string, WorldQuestDef>>,
): void {
  const traces = world.nearbyWorldQuestTraces ?? EMPTY_PUBLIC_TRACES;
  const limit = Math.min(PUBLIC_TRACE_SLOTS, traces.length);
  for (const slot of slots) {
    if (!slot.trace) continue;
    let next: NearbyWorldQuestTrace | null = null;
    for (let i = 0; i < limit; i++)
      if (traces[i].pid === slot.trace.pid && publicShape(world, traces[i], definitions)) {
        next = traces[i];
        break;
      }
    slot.trace = next;
    if (!next) {
      slot.shape = null;
      slot.name = '';
    }
  }
  for (let i = 0; i < limit; i++) {
    const trace = traces[i];
    const shape = publicShape(world, trace, definitions);
    if (!shape) continue;
    let slot = slots.find((candidate) => candidate.trace?.pid === trace.pid);
    if (!slot) slot = slots.find((candidate) => candidate.trace === null);
    if (!slot) continue;
    slot.trace = trace;
    slot.shape = shape;
    slot.name = trace.name;
    let x = 0;
    let z = 0;
    const count = shape.points.length - 1;
    for (let point = 0; point < count; point++) {
      x += shape.points[point].x;
      z += shape.points[point].z;
    }
    slot.x = x / count;
    slot.z = z / count;
  }
}
