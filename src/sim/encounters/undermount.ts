// The Undermount Descent: the four-wing raid under Thornpeak Heights (finale:
// Volzharr, the Buried Furnace). This module owns the wing-chain metadata and
// the pure seal predicate: each wing's door stays sealed until the prior wing's
// boss has been cleared (permanent raid progress, NOT the daily lockout, so a
// farm raid never re-clears wing 1 to reach wing 2). Per-wing encounter drivers
// land here later, following the encounters/nythraxis.ts pattern; for now this
// is the walking-skeleton backbone that the instance layer consults.
//
// Pure and host-agnostic: no rng, no Sim state, no DOM. The instance layer
// (src/sim/instances/dungeons.ts) is the only consumer and passes in the set of
// cleared wing dungeonIds it tracks.

export interface UndermountWing {
  /** The DUNGEON_DEFS id for this wing's instance. */
  dungeonId: string;
  /** 1-based wing number, in descent order. */
  order: number;
  /** The boss whose death clears the wing (the last boss to die in a duo). */
  bossMobId: string;
  /** The wing that must be cleared before this one's door opens; null for wing 1. */
  requires: string | null;
}

// Descent order. dungeonIds and bossMobIds are the stable content contract the
// DUNGEON_DEFS + MobTemplate records must match (the skeleton uses one stub boss
// per wing; the wing-1 duo and the real kits refine these in place later).
export const UNDERMOUNT_WINGS: readonly UndermountWing[] = [
  { dungeonId: 'undermount_wing1', order: 1, bossMobId: 'vosh_the_glazier', requires: null },
  {
    dungeonId: 'undermount_wing2',
    order: 2,
    bossMobId: 'the_forge_heart',
    requires: 'undermount_wing1',
  },
  {
    dungeonId: 'undermount_wing3',
    order: 3,
    bossMobId: 'odrenn_the_temperer',
    requires: 'undermount_wing2',
  },
  {
    dungeonId: 'undermount_wing4',
    order: 4,
    bossMobId: 'volzharr_buried_furnace',
    requires: 'undermount_wing3',
  },
] as const;

const WING_BY_DUNGEON = new Map(UNDERMOUNT_WINGS.map((w) => [w.dungeonId, w] as const));

/** The wing record for a dungeonId, or undefined if it is not an Undermount wing. */
export function undermountWing(dungeonId: string): UndermountWing | undefined {
  return WING_BY_DUNGEON.get(dungeonId);
}

/**
 * True when `dungeonId` is an Undermount wing whose prerequisite wing has not
 * been cleared. Non-Undermount dungeons and wing 1 (no prerequisite) are never
 * sealed. `cleared` is the set of wing dungeonIds whose boss the entering
 * raid/character has ever killed (permanent progress, not the daily lockout).
 */
export function undermountWingSealed(cleared: ReadonlySet<string>, dungeonId: string): boolean {
  const wing = WING_BY_DUNGEON.get(dungeonId);
  if (!wing || wing.requires === null) return false;
  return !cleared.has(wing.requires);
}
