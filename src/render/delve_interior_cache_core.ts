// Delve interior build-cache decision (pure, Three-free). A delve module's
// z-stacked position within a slot is reused across runs, but which moduleId
// occupies that position is re-randomized every run (pickDelveModules), so a
// build cached by POSITION must be invalidated when the moduleId there
// changes: otherwise the previous run's walls (built at that position for a
// different room shape) keep standing while this run's mobs/interactables/
// boss spawn against the true (current) module's geometry, so they read as
// spawned outside the walls and the stale geometry never blocks movement
// where the player actually is.
export type DelveInteriorBuildAction = 'skip' | 'build' | 'rebuild';

export interface DelveInteriorPlacement {
  moduleId: string;
  ox: number;
  oz: number;
}

export function delveInteriorBuildAction(
  cached: DelveInteriorPlacement | undefined,
  next: DelveInteriorPlacement,
  pending: boolean,
): DelveInteriorBuildAction {
  if (pending) return 'skip';
  if (!cached) return 'build';
  return cached.moduleId === next.moduleId && cached.ox === next.ox && cached.oz === next.oz
    ? 'skip'
    : 'rebuild';
}
