// Graveyard Shift: the solo side adventure where the player covers Morthen's
// shift in the Hollow Crypt against adventurer bots. Public surface only; see
// the local CLAUDE.md for the module map.

export { graveyardShiftPairHostile, isGraveyardShiftAdventurer } from './hostility';
export { hasMorthenIdentity } from './morthen_identity';
export { knownAbilitiesFor } from './morthen_transform';
export {
  canStartGraveyardShift,
  endGraveyardShift,
  GRAVEYARD_SHIFT_MIN_LEVEL,
  startGraveyardShift,
  updateGraveyardShift,
} from './run_lifecycle';
export {
  type GraveyardShiftOutcome,
  type GraveyardShiftRun,
  graveyardShiftRunFor,
} from './run_state';
