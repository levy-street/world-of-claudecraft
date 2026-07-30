import type { SpatialGrid } from '../spatial';
import type { Entity } from '../types';

// Shared same-faction ally scan for mob support mechanics (Mend, Ward, the
// channeled protectee heal, Rally, War Cadence). Each of those periodically
// walks every living friendly mob within a radius of the caster; this queries
// the SpatialGrid instead of the full entity map so the cost tracks nearby
// entities, not total world population. `predicate` layers on any
// mechanic-specific filter (wounded-only, exclude self, ...).
export function findNearbyAllies(
  grid: SpatialGrid,
  mob: Entity,
  radius: number,
  predicate: (ally: Entity) => boolean = () => true,
): Entity[] {
  const found: Entity[] = [];
  grid.forEachInRadius(mob.pos.x, mob.pos.z, radius, (e) => {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) return; // skip players, pets, corpses
    if (e.hostile !== mob.hostile) return; // same-faction mobs only
    if (!predicate(e)) return;
    found.push(e);
  });
  // The grid yields entities in cell-bucket order, not the entity-creation
  // order the old `entities.values()` scan relied on for per-ally rng draw
  // mapping (mendAlly) and max-hp tie-breaking (channelHeal's protectee
  // pick). Entity ids are assigned monotonically, so sorting by id restores
  // that same creation order deterministically.
  found.sort((a, b) => a.id - b.id);
  return found;
}
