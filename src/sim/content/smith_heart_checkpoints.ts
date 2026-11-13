// The Smith's Heart's death-recovery points (docs/design/raid/smith_heart.md,
// "Death and the run back"), one per room a returning spirit can rise in. The
// raid's guardians fall in any order, so which point applies is not the table
// order of content/dungeon_checkpoints.ts but the kill order
// (encounters/smith_heart/checkpoint.ts): the room of the guardian the raid
// killed LAST, or the Heart once all four have fallen.
//
// Every point stands at its room's door, never on its fighting floor: just
// inside the arena's own mouth gate (the Quarry, the Cornice, the Lake, the
// Hearth), where nothing of the fight reaches (outside the Quarry's council
// radius, west of the Cornice's arena line, off the lake's ice and outside the
// shore ice's ring, off the Hearth's floor), or the Heart's Arrival Terrace,
// where the portal sets the raid down outside the Heart Bridge.
//
// `gates` is the walk from the Cleft to the point, every gate of it open, as
// in the dungeon table: a point is offered only while the group could walk to
// it. The Heart is reached through the seal's portal instead, so its row also
// needs the portal open (encounters/smith_heart/seal.ts smithHeartProgress).
// tests/smith_heart_checkpoints.test.ts walks each route on the real colliders.
import type { DungeonCheckpoint } from './dungeon_checkpoints';
import { HEART_ARRIVAL, type SmithHeartVein } from './smith_heart_layout';

/** A room a Smith's Heart spirit can rise in: a guardian's, or the Heart. */
export type SmithHeartCheckpointRoom = SmithHeartVein | 'final';

export type SmithHeartCheckpoint = Omit<DungeonCheckpoint, 'bosses'>;

export const SMITH_HEART_CHECKPOINTS: Readonly<
  Record<SmithHeartCheckpointRoom, SmithHeartCheckpoint>
> = {
  // On the Gallery's descent, just past the Pit Mouth: 55 yd from the pit's
  // middle, outside the council's reach (council_scope.ts COUNCIL_ARENA_R).
  hammer: { gates: ['hammer_pit_mouth'], pos: { x: -44, z: -188 } },
  // The top of the Cornice's climb, just past the Cornice Mouth and west of
  // the arena's line (breath_geometry.ts CLIMB_ARENA_X); the west rim keeps
  // its wall, so no gap of the void opens near it.
  breath: {
    gates: ['hammer_pit_mouth', 'the_slab', 'cornice_mouth'],
    pos: { x: -68, z: 192 },
  },
  // The basin's shelf, just past the Lake Mouth: off the lake's ice (its holes
  // stay for the claim's life) and outside the shore ice's ring.
  quench: {
    gates: ['hammer_pit_mouth', 'the_slab', 'lake_mouth'],
    pos: { x: 183, z: -52 },
  },
  // The bridge into the Hearth, just past the Hearth Mouth, short of the
  // Hearth's floor (heat_geometry.ts inHearthFloor) and its fires.
  heat: {
    gates: ['hammer_pit_mouth', 'the_slab', 'anvil_mouth'],
    pos: { x: -171.5, z: 0 },
  },
  // The Arrival Terrace, where the seal's portal sets the raid down: outside
  // the Heart Bridge, outside the final boss's reach.
  final: {
    gates: ['hammer_pit_mouth', 'the_slab'],
    pos: { x: HEART_ARRIVAL.x, z: HEART_ARRIVAL.z },
  },
};
