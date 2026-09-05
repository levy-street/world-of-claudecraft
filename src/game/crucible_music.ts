// Final owner-supplied productions, separate from the procedural authoring zones.
export type CrucibleFloor = 1 | 2 | 3 | 4;

export const CRUCIBLE_STREAM_URLS: Readonly<Record<CrucibleFloor, string>> = {
  1: '/audio/music/a_way_through_the_embers.mp3?v=14a001b98e5b',
  2: '/audio/music/even_iron_must_yield.mp3?v=ebd0f6c6b99d',
  3: '/audio/music/a_fate_still_unwritten.mp3?v=78d0bc42726a',
  4: '/audio/music/the_future_is_not_yours_to_keep.mp3?v=a6e896149cb0',
};

const FLOORS: Readonly<Record<string, CrucibleFloor>> = {
  ignivar_forge_approach: 1,
  ignivar_raid_arena: 2,
  ignivar_molten_assembly: 3,
  ignivar_inner_crucible: 4,
  ignivar_forge_lift: 1,
};

export function crucibleFloorForDungeon(dungeonId: string | null): CrucibleFloor | null {
  return dungeonId !== null && Object.hasOwn(FLOORS, dungeonId) ? FLOORS[dungeonId] : null;
}
