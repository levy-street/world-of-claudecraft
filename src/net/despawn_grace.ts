// The online roster's interest-boundary grace: an entity absent from one
// snapshot is held at its last pose for a short window before it is dropped,
// so boundary churn never deletes and re-creates it frame to frame. A
// close-range disappearance (an enemy going stealth) still drops at once.
// Lifted out of ClientWorld.applySnapshot; the mirror stays the owner of the
// maps and the timing constants.
import type { Entity } from '../sim/types';

export interface DespawnGraceInput {
  entities: Map<number, Entity>;
  /** Entity ids the snapshot carried (or listed as kept). */
  seen: ReadonlySet<number>;
  /** Wall-clock ms at which each missing entity was first missed. */
  missingSince: Map<number, number>;
  playerId: number;
  /** The moderator's own record stays while a spectate presents someone else. */
  ownPlayerId: number;
  spectating: string | null;
  now: number;
  graceMs: number;
  /** Squared distance under which a missing entity drops without grace. */
  immediateDropDistSq: number;
}

/** Drops the entities whose grace ran out; returns how many were dropped. */
export function pruneMissingEntities(input: DespawnGraceInput): number {
  const { entities, seen, missingSince, now } = input;
  const self = entities.get(input.playerId);
  let dropped = 0;
  for (const [id, e] of entities) {
    if (id === input.playerId) continue;
    if (typeof input.spectating === 'string' && id === input.ownPlayerId) {
      missingSince.delete(id);
      continue;
    }
    if (seen.has(id)) {
      missingSince.delete(id);
      continue;
    }
    const dx = self ? e.pos.x - self.pos.x : 0;
    const dz = self ? e.pos.z - self.pos.z : 0;
    if (dx * dx + dz * dz < input.immediateDropDistSq) {
      entities.delete(id);
      missingSince.delete(id);
      dropped++;
      continue;
    }
    const since = missingSince.get(id);
    if (since === undefined) {
      missingSince.set(id, now);
    } else if (now - since >= input.graceMs) {
      entities.delete(id);
      missingSince.delete(id);
      dropped++;
    }
  }
  return dropped;
}
