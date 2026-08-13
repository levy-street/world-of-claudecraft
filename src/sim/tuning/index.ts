// The class power tuner's public surface. Import from here, not from the
// individual modules, outside src/sim/tuning.
//
// What this subsystem is: an operator-facing balance lever. A staff account
// with the `tuner` role moves per-ability, per-channel sliders in the admin
// dashboard; the document is persisted per realm and installed onto the ability
// table at the next server boot (see install.ts for why it is boot-scoped).
// Nothing here resolves gameplay: it only rewrites the authored content numbers
// the Sim already reads.

export {
  AURA_VALUE_EFFECTS,
  auraValueFieldSpec,
  EFFECT_TUNED_FIELDS,
  MAGNITUDE_AURA_KINDS,
  MARKER_AURA_KINDS,
  MULTIPLIER_AURA_KINDS,
  REFLECT_AURA_KINDS,
  type TunedFieldSpec,
  type TunedFieldTable,
  UNTUNED_DEF_FIELDS,
  UNTUNED_EFFECT_FIELDS,
  UNTUNED_RANK_FIELDS,
} from './ability_fields';
export {
  abilityTuningChannels,
  abilityTuningKnobs,
  applyAbilityTuning,
  type TunedSite,
  type TunedSiteVisitor,
  walkTunedAbility,
} from './ability_knobs';
export {
  buildClassTuningCatalog,
  type ClassTuningCatalog,
  type TunerAbilityInfo,
  type TunerAbilitySource,
  type TunerChannelInfo,
  type TunerClassInfo,
  type TunerSpecInfo,
  type TunerWeaponInfo,
} from './catalog';
export {
  clampTuningFactor,
  isEffectiveTuningSite,
  isNeutralFactor,
  isTuningChannel,
  scaleTuningValue,
  TIME_TUNING_CHANNELS,
  TUNING_CHANNELS,
  TUNING_FACTOR_STEP,
  TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR,
  TUNING_NEUTRAL_FACTOR,
  type TuningChannel,
  type TuningValueKind,
  WEAPON_TUNING_CHANNELS,
} from './channels';
export {
  type AbilityTuning,
  CLASS_TUNING_VERSION,
  type ClassTuningDocument,
  classRangedWeaponId,
  classTuningDocumentKey,
  countTunedChannels,
  emptyClassTuningDocument,
  isEmptyClassTuningDocument,
  isTunableEntryId,
  MAX_TUNED_ABILITIES,
  MAX_TUNED_WEAPONS,
  sanitizeClassTuningDocument,
  type WeaponTuning,
} from './document';
export {
  activeClassTuning,
  applyClassTuning,
  installClassTuning,
  installedTunedAbilityIds,
  installedTunedWeaponIds,
  uninstallClassTuning,
} from './install';
export {
  applyWeaponTuning,
  MIN_SWING_SECONDS,
  walkTunedWeapon,
  weaponDps,
  weaponTuningKnobs,
} from './weapon_knobs';
