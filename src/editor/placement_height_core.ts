import { MAX_PLACEMENT_Y_OFFSET } from '../sim/map_doc';

export const PLACEMENT_HEIGHT_STEPS = [0.1, 0.5, 1, 5] as const;
export const DEFAULT_PLACEMENT_HEIGHT_STEP = 0.5;

/** Clamp the whole selection's delta, keeping its vertical spacing intact. */
export function selectionHeightTarget(
  current: number,
  requested: number,
  memberHeights: readonly number[],
): number {
  if (!Number.isFinite(current) || !Number.isFinite(requested)) return current;
  let minDelta = -MAX_PLACEMENT_Y_OFFSET - current;
  let maxDelta = MAX_PLACEMENT_Y_OFFSET - current;
  for (const height of memberHeights) {
    if (!Number.isFinite(height)) return current;
    minDelta = Math.max(minDelta, -MAX_PLACEMENT_Y_OFFSET - height);
    maxDelta = Math.min(maxDelta, MAX_PLACEMENT_Y_OFFSET - height);
  }
  if (minDelta > maxDelta) return current;
  return current + Math.max(minDelta, Math.min(maxDelta, requested - current));
}
