/**
 * Inactive CharacterVisual instances retain a unique Skeleton and its GPU bone texture. Desktop
 * keeps the historical unbounded reuse pool to avoid travel hitches; a finite residency profile
 * disposes overflow so visiting new populations cannot grow GPU memory monotonically.
 */
export function shouldRetainPooledCharacterVisual(currentCount: number, maxCount: number): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return false;
  if (maxCount === Number.POSITIVE_INFINITY) return true;
  if (!Number.isFinite(maxCount) || maxCount <= 0) return false;
  return currentCount < Math.floor(maxCount);
}
