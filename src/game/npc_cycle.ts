// Stepping through the NPCs standing near you, for the pad's d-pad.
//
// Why this is not the sim's friendly cycle: `isFriendlyTo` answers "may I heal or
// buff this", and an ordinary quest giver is NOT friendly by that rule (it falls
// through to false). That is correct for spells and useless for selection, so
// asking it to also mean "may I select this" would widen a combat predicate to
// suit the interface. Selection is a client concern and `IWorld.targetEntity`
// already exists for it, so the pad picks the entity and the sim stays as it is.
//
// Pure: distance sorting and cycling, no DOM and no world handle.

/** The little the cycle reads off an entity. */
export interface CycleEntity {
  id: number;
  kind: string;
  dead?: boolean;
  pos: { x: number; z: number };
}

/** How far out to consider an NPC, in yards. Beyond this the player cannot see
 *  who they picked, and a selection they cannot see is a selection they will not
 *  understand. */
export const NPC_CYCLE_RANGE = 40;

function distance2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The nearby NPCs, nearest first. Stable: ties break by id, so the order does
 *  not shuffle between presses while the player stands still. */
export function nearbyNpcs(
  entities: Iterable<CycleEntity>,
  origin: { x: number; z: number },
  range = NPC_CYCLE_RANGE,
): CycleEntity[] {
  const found: { e: CycleEntity; d: number }[] = [];
  for (const e of entities) {
    if (e.kind !== 'npc' || e.dead) continue;
    const d = distance2d(origin, e.pos);
    if (d <= range) found.push({ e, d });
  }
  found.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return found.map((f) => f.e);
}

/**
 * The next NPC to select, stepping from whatever is targeted now. Answers null
 * when there is nobody nearby.
 *
 * A target that is not an NPC (a wolf, a player) is treated as no position in the
 * list rather than as an error, so the first press off a hostile target lands on
 * the nearest NPC instead of somewhere arbitrary.
 */
export function nextNpcTarget(
  entities: Iterable<CycleEntity>,
  origin: { x: number; z: number },
  currentTargetId: number | null,
  step: 1 | -1 = 1,
  range = NPC_CYCLE_RANGE,
): number | null {
  const list = nearbyNpcs(entities, origin, range);
  if (list.length === 0) return null;
  const at = list.findIndex((e) => e.id === currentTargetId);
  if (at < 0) return list[step === 1 ? 0 : list.length - 1].id;
  return list[(at + step + list.length) % list.length].id;
}
