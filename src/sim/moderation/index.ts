// Public surface of src/sim/moderation/: host-agnostic sanction state the sim
// wears. Import from this barrel, never from the modules directly.
export {
  CHEATER_MARK_AURA_ID,
  CHEATER_MARK_MAX_SECONDS,
  type CheaterMark,
  cheaterMarkAfterPlayed,
  cheaterMarkAura,
  isCheaterMarkActive,
  normalizeCheaterMark,
  normalizeCheaterMarkSeconds,
} from './cheater_mark';
