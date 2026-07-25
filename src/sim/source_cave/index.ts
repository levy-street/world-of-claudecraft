// The Source Cave subsystem: the pure, deterministic spec generator (Phase 1) plus
// the runtime dungeon wiring (Phase 2) that places and runs the cave in the Sim.
// Public surface only.

export {
  isSourceCaveChestSealed,
  onSourceCaveMobKilled,
  SOURCE_CAVE_CHEST_SEALED_TEMPLATE,
  SOURCE_CAVE_CHEST_TEMPLATE,
  SOURCE_CAVE_CORPSE_DESPAWN_SECONDS,
  sourceCaveChestOf,
  sourceCaveInstanceOccupied,
  spawnSourceCaveChest,
  trySourceCaveChestDeny,
  updateSourceCaveClear,
} from './clear';
export {
  SOURCE_CAVE_COMBAT_TIER_CAPS,
  SOURCE_CAVE_COMBATANT_CAP,
  type SourceCaveCombatCandidate,
  sourceCaveCombatantLogins,
  sourceCaveCombatRoles,
} from './combatants';
export {
  SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES,
  type SourceCaveMobCustomAttributes,
  sourceCaveMobCustomAttributesForLogin,
} from './custom_attributes';
export { enterSourceCave, leaveSourceCave } from './dungeon';
export {
  beginSourceCaveEncounter,
  buildSourceCaveWaveLogins,
  confirmSourceCaveReboot,
  createSourceCaveEncounterState,
  isDormantSourceCaveTargetSafe,
  SOURCE_CAVE_BOSS_DELAY,
  SOURCE_CAVE_CONFIRM_SECONDS,
  SOURCE_CAVE_CONFIRM_TEXT,
  SOURCE_CAVE_ENCIRCLE_RADIUS,
  SOURCE_CAVE_INITIAL_DELAY,
  SOURCE_CAVE_INTERMISSION_DELAY,
  SOURCE_CAVE_WIPE_RESET_DELAY,
  sourceCaveCombatMobIds,
  sourceCaveDefeatMobIds,
  sourceCaveExitSealed,
  sourceCaveRebootNeedsConfirmation,
  tryWakeSourceCaveWave,
  updateSourceCaveEncounters,
  wakeSourceCaveGuardian,
} from './encounter';
export { isSourceCaveGatedObject } from './interaction_objects';
export {
  isSourceCaveBanterTarget,
  SOURCE_CAVE_MOB_BANTER_LINES,
  sourceCaveMobBanter,
} from './mob_banter';
export { SOURCE_CAVE_SEAL_RADIUS } from './occupancy';
export { SOURCE_CAVE_PLACEHOLDER_ROSTER } from './placeholder_roster';
export {
  activateSourceCaveReboot,
  isSourceCaveRebootSafeTarget,
  SOURCE_CAVE_REBOOT_REACTION_YELLS,
  SOURCE_CAVE_REBOOT_SAFE_RADIUS,
  SOURCE_CAVE_REBOOT_TEMPLATE,
  SOURCE_CAVE_REBOOT_YELL,
  spawnSourceCaveReboot,
} from './reboot';
export {
  buildSourceCaveRuntime,
  isSourceCaveMobEntity,
  isSourceCavePos,
  SOURCE_CAVE_DEF,
  SOURCE_CAVE_DELVE_INDEX,
  SOURCE_CAVE_DOOR_ID,
  SOURCE_CAVE_DOOR_POS,
  SOURCE_CAVE_DUNGEON_ID,
  SOURCE_CAVE_SLOT_COUNT,
  type SourceCaveMobRank,
  type SourceCaveMobRankEntry,
  type SourceCaveRuntime,
  type SourceCaveRuntimeDef,
  sourceCaveLoginFromTemplateId,
  sourceCaveMobRankForTemplate,
  sourceCaveOrigin,
} from './runtime';
export {
  buildSourceCaveSpec,
  SOURCE_CAVE_MOB_MIN_DIST,
  sourceCaveArenaUsableRadius,
  sourceCaveChestLocalZ,
  sourceCaveEntryZ,
  sourceCaveExitZ,
  sourceCaveOuterRingRadius,
} from './spec';
export {
  type SourceCaveTierWeapon,
  sourceCaveMobTemplate,
  sourceCaveTierWeaponForLogin,
} from './templates';
export {
  SOURCE_CAVE_BOSS_OVERLAY,
  SOURCE_CAVE_TIER_PROFILES,
  SOURCE_CAVE_UNRANKED_PROFILE,
  type SourceCaveTierProfile,
  type SourceCaveTierProfileKey,
  sourceCaveMobProfileForMergedPrs,
  sourceCaveMobProfileForTier,
  sourceCaveTierProfileForMergedPrs,
} from './tier_profiles';
export type {
  SourceCaveCombatTier,
  SourceCaveEncounterPhase,
  SourceCaveEncounterState,
  SourceCaveMobSpec,
  SourceCaveRosterEntry,
  SourceCaveSpec,
} from './types';
export {
  SOURCE_CAVE_WANDER_RADIUS_MAX,
  SOURCE_CAVE_WANDER_RADIUS_MIN,
  updateSourceCaveIdleWander,
} from './wander';
export {
  interactWithSourceCaveWell,
  SOURCE_CAVE_WELL_BANTER_LINES,
} from './well_banter';
export { sourceCaveInfoWire } from './wire';
