// v0.42.0 integration surface: the Vespers Dirge range-refresh and Doctrine
// Scouring Mercy rescue hooks in one import. Other priest modules keep their
// established direct-submodule-import convention; this barrel is additive.
export {
  captureDirgeReapplication,
  DIRGE_ABILITY_ID,
  DIRGE_BASE_DURATION,
  DIRGE_DEFAULT_RANGE,
  DIRGE_MAX_DURATION,
  type DirgePriorState,
  refreshDirgeFieldAfterReapplication,
} from './dirge_refresh';
export {
  applyScouringMercyRescueCopies,
  doctrineScouringMercyRescue,
  SCOURING_MERCY_RESCUE_FRACTION,
  SCOURING_MERCY_RESCUE_MAX_RECIPIENTS,
  SCOURING_MERCY_RESCUE_RADIUS,
  selectScouringMercyRescueRecipients,
} from './doctrine_rescue';
export { vespersDirgeSpMultiplier } from './vespers';
