// Target-of-target resolution: the id of the entity that a given entity is
// currently targeting. A mob carries it as `aggroTargetId` (its hate-table
// target, mirrored on the wire as `aggro`); a player carries it as `targetId`
// (mirrored as `tgt`). Host-agnostic and DOM-free so a Vitest drives it against
// both a Sim entity and a ClientWorld-shaped entity; the HUD resolves the id to
// an entity through `IWorld.entities`, and the assist action targets it.

import type { Entity } from '../sim/types';

/** The id `entity` is targeting, or null (mob hate-target first, then player target). */
export function targetOfTargetId(entity: Entity | null | undefined): number | null {
  if (!entity) return null;
  return entity.aggroTargetId ?? entity.targetId ?? null;
}
