// Graveyard Shift: the solo side adventure where the player covers Morthen's
// shift in the Hollow Crypt against adventurer bots. Public surface only; see
// the local CLAUDE.md for the module map.

export {
  graveyardShiftPairHostile,
  isGraveyardShiftAdventurer,
  shiftPairHostile,
} from './hostility';
export { hasMorthenIdentity } from './morthen_identity';
export { knownAbilitiesFor } from './morthen_transform';
export {
  canStartGraveyardShift,
  endGraveyardShift,
  GRAVEYARD_SHIFT_MIN_LEVEL,
  graveyardShiftResolveLeave,
  startGraveyardShift,
  updateGraveyardShift,
} from './run_lifecycle';
export {
  GraveyardShiftBook,
  type GraveyardShiftOutcome,
  type GraveyardShiftRun,
  graveyardShiftRunFor,
} from './run_state';
export { graveyardShiftSaveState } from './save_override';
