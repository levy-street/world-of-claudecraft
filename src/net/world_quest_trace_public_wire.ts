import {
  decodePublicWorldQuestTrace,
  type NearbyWorldQuestTrace,
  PUBLIC_WORLD_QUEST_TRACE_LIMIT,
} from '../sim/world_quest_trace_public';

/** Public trails are not deltas. Malformed arrays clear atomically, including duplicates. */
export function decodeNearbyWorldQuestTraces(
  value: unknown,
  viewerId: unknown,
  now: unknown,
): readonly NearbyWorldQuestTrace[] {
  if (
    !Number.isSafeInteger(viewerId) ||
    (viewerId as number) <= 0 ||
    typeof now !== 'number' ||
    !Number.isFinite(now) ||
    now < 0 ||
    !Array.isArray(value) ||
    value.length > PUBLIC_WORLD_QUEST_TRACE_LIMIT
  )
    return [];
  const seen = new Set<number>();
  const result: NearbyWorldQuestTrace[] = [];
  for (const raw of value) {
    const row = decodePublicWorldQuestTrace(raw, viewerId as number, now);
    if (!row || seen.has(row.pid)) return [];
    result.push(row);
    seen.add(row.pid);
  }
  return result;
}
