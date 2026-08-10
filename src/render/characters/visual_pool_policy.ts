/**
 * Bounded-retention check shared by the render reuse pools: true while `currentCount` leaves
 * room under `maxCount`. Inactive CharacterVisual instances retain a unique Skeleton and its
 * GPU bone texture, so a finite cap disposes overflow and visiting new populations cannot grow
 * GPU memory monotonically. Infinity means unbounded (the ground-object pool's desktop
 * configuration); a non-finite or non-positive cap fails closed. The character-visual pool
 * layers least-recently-released eviction on top of this predicate (visual_pool.ts).
 */
export function shouldRetainPooledCharacterVisual(currentCount: number, maxCount: number): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return false;
  if (maxCount === Number.POSITIVE_INFINITY) return true;
  if (!Number.isFinite(maxCount) || maxCount <= 0) return false;
  return currentCount < Math.floor(maxCount);
}
