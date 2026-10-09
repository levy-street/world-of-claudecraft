// HUD domain: dungeon encounter prompts the local player acts on: the Gaol
// Turnkey's Iron Cage escape, Gaoler Ossick's chain alert, the Wildheart
// Basin's, the Gravewyrm Sanctum's and the Hollow Crypt's alerts (the shared encounter alert
// painter) and the trash engine's use prompt (a Soul Brazier to topple, a
// Remembrance Candle to relight, on the same painter), composed by the HUD as one DungeonPrompts member; and the
// floating avoidance word.

export type {
  BastionAlertEntity,
  BastionAlertInput,
  BastionAlertKind,
  BastionAlertView,
} from './bastion_alert_view';
export { BASTION_ALERT_KINDS, buildBastionAlertView } from './bastion_alert_view';
export type { CageEscapeDeps } from './cage_escape_painter';
export { CageEscapePrompt } from './cage_escape_painter';
export type { CageEscapeInput, CageEscapeLive, CageEscapeView } from './cage_escape_view';
export { buildCageEscapeView } from './cage_escape_view';
export type { CryptSceneEntity, CryptSceneWorld } from './crypt_alert_scene_core';
export { CryptAlertSceneScan } from './crypt_alert_scene_core';
export type {
  CryptAlertEntity,
  CryptAlertInput,
  CryptAlertKind,
  CryptAlertScene,
  CryptAlertView,
} from './crypt_alert_view';
export {
  buildCryptAlertView,
  CRYPT_ALERT_KINDS,
  CRYPT_SOFT_ALERT_KINDS,
  EMPTY_CRYPT_SCENE,
  inMarkedHalf,
} from './crypt_alert_view';
export type { DungeonPromptsFrame } from './dungeon_prompts';
export { DungeonPrompts } from './dungeon_prompts';
export type { AlertLook, EncounterAlertDeps } from './encounter_alert_painter';
export { EncounterAlert } from './encounter_alert_painter';
export type {
  EncounterAlertHidden,
  EncounterAlertLive,
  EncounterAlertView,
} from './encounter_alert_view';
export { fctAvoidanceText } from './fct_avoidance_core';
export type { GaolChainDeps } from './gaol_chain_painter';
export { GaolChainAlert } from './gaol_chain_painter';
export type { GaolChainInput, GaolChainKind, GaolChainView } from './gaol_chain_view';
export { buildGaolChainView, wardHealthText, wardHitText } from './gaol_chain_view';
export type {
  KitUseBody,
  KitUsePromptInput,
  KitUsePromptKind,
  KitUsePromptView,
} from './kit_use_prompt_view';
export {
  buildKitUsePromptView,
  KIT_USE_PROMPT_KINDS,
  KIT_USE_PROMPT_RADIUS,
  KitUseSceneScan,
} from './kit_use_prompt_view';
export type { SanctumSceneEntity, SanctumSceneWorld } from './sanctum_alert_scene_core';
export { SanctumAlertSceneScan } from './sanctum_alert_scene_core';
export type {
  SanctumAlertEntity,
  SanctumAlertInput,
  SanctumAlertKind,
  SanctumAlertScene,
  SanctumAlertView,
} from './sanctum_alert_view';
export { buildSanctumAlertView, SANCTUM_ALERT_KINDS } from './sanctum_alert_view';
export type {
  WildheartAlertEntity,
  WildheartAlertInput,
  WildheartAlertKind,
  WildheartAlertView,
} from './wildheart_alert_view';
export { buildWildheartAlertView, WILDHEART_ALERT_KINDS } from './wildheart_alert_view';
