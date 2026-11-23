import { cleanPetName } from '../src/sim/pet/pet_commands';
import type { Sim } from '../src/sim/sim';

/** Screen the normalized pet/buddy name, never a raw oversized wire token.
 *  Invalid shapes skip the matcher and reach the sim's authoritative refusal. */
export function screenCompanionRename(
  name: string,
  offensiveName: (name: string) => boolean,
  rename: (name: string) => void,
  rejectName: () => void,
): void {
  const clean = cleanPetName(name);
  if (clean !== null && offensiveName(clean)) rejectName();
  else rename(clean ?? name);
}

/** Hunter-pet counterpart of the buddy wire handler; keeps screening identical. */
export function dispatchPetRename(
  sim: Sim,
  pid: number,
  msg: Record<string, unknown>,
  offensiveName: (name: string) => boolean,
  rejectName: () => void,
): void {
  if (typeof msg.name !== 'string') return;
  screenCompanionRename(msg.name, offensiveName, (name) => sim.renamePet(name, pid), rejectName);
}
