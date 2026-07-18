// Resolve WHO an entity is currently targeting, for the target-of-target frame
// (the classic mini-frame showing your target's own target). The field that holds
// "this entity's current target" depends on the entity KIND, which is the subtle
// rule this function pins: a mob / pet / npc tracks its combat target in
// `aggroTargetId` (highest threat, or a taunt-forced target), while a player or bot
// selects a `targetId`. Both fields ride the wire (server `dynamicFields` sends
// `aggro` for the former and `tgt` for the latter), so this resolution is
// host-agnostic: it returns the same id offline (live `Sim`) and online (mirrored
// `ClientWorld`). Returns null when the entity is not targeting anything; the caller
// still verifies the id resolves to a KNOWN entity, since the target-of-target can be
// outside the player's interest bubble even when its id is known.

import type { Entity } from '../sim/types';

export function targetOfTargetId(
  target: Pick<Entity, 'kind' | 'targetId' | 'aggroTargetId'>,
): number | null {
  return target.kind === 'player' ? target.targetId : target.aggroTargetId;
}
