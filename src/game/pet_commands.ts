// The pet bar's command routing, shared by the keyboard arm (input.ts onPet,
// Ctrl+1..5 by default) and the controller arm (main.ts dispatchGamepadAction),
// so the two can never map a bind to different IWorld pet commands. Pure: it
// only needs the pet slice of IWorld.

import type { IWorld } from '../world_api';

export type PetCommand = 'attack' | 'taunt' | 'stop' | 'defensive' | 'aggressive';

export type PetCommandWorld = Pick<IWorld, 'petAttack' | 'petTaunt' | 'setPetMode'>;

/** Keybind action id (src/game/keybinds.ts) -> pet command. */
const PET_ACTIONS: Record<string, PetCommand> = {
  petAttack: 'attack',
  petTaunt: 'taunt',
  petStop: 'stop',
  petDefensive: 'defensive',
  petAggressive: 'aggressive',
};

export function runPetCommand(world: PetCommandWorld, command: PetCommand): void {
  if (command === 'attack') world.petAttack();
  else if (command === 'taunt') world.petTaunt();
  else if (command === 'stop') world.setPetMode('passive');
  else world.setPetMode(command);
}

/** True when `action` was one of the five pet binds (and it ran). */
export function dispatchPetAction(action: string, world: PetCommandWorld): boolean {
  if (!Object.hasOwn(PET_ACTIONS, action)) return false;
  runPetCommand(world, PET_ACTIONS[action]);
  return true;
}
