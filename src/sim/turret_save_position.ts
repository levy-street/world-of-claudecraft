// Where a character save puts the player, and which way they face. The turret
// seat is never saved and its arena slot is gone by the next login, so a save
// taken while seated in the arena (an autosave, a linkdead flush, a shutdown)
// records the seat's return point, where leaving the seat would have put them.
// A seated player some other path already took out of the arena is saved where
// they stand, as the exit leaves them there. Any other save keeps the ferry
// rule: a ride saves its pier, never the sea.

import type { CharacterState } from './character_state';
import { FIRE_AND_FLY_DUNGEON_ID } from './content/fire_and_fly_arena';
import { dungeonAt } from './data';
import { ferrySavePosition } from './transport_ferry';
import type { Entity, VehicleSeat } from './types';

export function turretSavePosition(
  seat: VehicleSeat | null | undefined,
  e: Entity,
): Pick<CharacterState, 'pos' | 'facing'> {
  if (seat?.kind === 'turret' && dungeonAt(e.pos.x)?.id === FIRE_AND_FLY_DUNGEON_ID) {
    const back = seat.returnTo;
    return { pos: { x: back.x, z: back.z }, facing: back.facing };
  }
  return { pos: ferrySavePosition(e), facing: e.facing };
}
