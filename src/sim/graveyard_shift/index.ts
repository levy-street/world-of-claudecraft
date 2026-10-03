// Graveyard Shift: the solo side adventure where the player covers Morthen's
// shift in the Hollow Crypt against adventurer bots. Public surface only; see
// the local CLAUDE.md for the module map.

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
