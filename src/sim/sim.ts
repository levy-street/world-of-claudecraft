import type {
  AccountCosmetics,
  DailyRewardHistory,
  DailyRewardSpinResult,
  DailyRewardStatus,
  DelveCompanionInfo,
  DelveRunInfo,
  LockpickView,
} from '../world_api';
import { lineOfSightClear, resolveMovement, resolvePosition } from './colliders';
import { auraAffectsStats, removeCancelableAura } from './combat/aura_cancel';
import {
  cleanseFriendlyNpcAuras,
  isRejectedFriendlyNpcAura,
  updateAuras,
  updateRegen,
  updateTimers,
} from './combat/auras';
import {
  meleeSwing as meleeSwingImpl,
  rangedSwing as rangedSwingImpl,
  startAutoAttack as startAutoAttackImpl,
  stopAutoAttack as stopAutoAttackImpl,
  updatePlayerAutoAttack as updatePlayerAutoAttackImpl,
} from './combat/auto_attack';
import {
  cancelCast as cancelCastImpl,
  castAbilityBySlot as castAbilityBySlotImpl,
  castAbility as castAbilityImpl,
  pushbackCast as pushbackCastImpl,
  spendResource as spendResourceImpl,
  updateCasting as updateCastingImpl,
} from './combat/casting_lifecycle';
import { isRooted, isStunned } from './combat/cc';
import {
  dealDamage as dealDamageImpl,
  grantXp as grantXpImpl,
  handleDeath as handleDeathImpl,
} from './combat/damage';
import { runEffects as runEffectsImpl } from './combat/effect_dispatch';
import {
  applyHeal as applyHealImpl,
  consumeHealAbsorb as consumeHealAbsorbImpl,
  critVulnBonus as critVulnBonusImpl,
  healingTakenMult as healingTakenMultImpl,
  healingThreat as healingThreatImpl,
  hexOutputMult as hexOutputMultImpl,
} from './combat/heal';
import { isSpellResisted } from './combat/spell_resist';
// A3: the augment/power-up content helpers used by the Fiesta match logic
// (AUGMENTS_BY_ID/AugmentDef/eligibleAugments/POWERUPS/PowerupDef/tierForWave)
// moved to social/fiesta.ts with that logic; sim.ts keeps only the type used by
// the PlayerMeta interface + the power-up catalog the fiestaMatchInfo accessor reads.
import { type AugmentSpecial, type AugmentTier, POWERUPS_BY_ID } from './content/augments';
import { MAILBOXES } from './content/mailboxes';
import {
  classHasSkin,
  EVENT_SKIN_TOKEN_ID,
  MECH_CHROMAS,
  mechChromaItemId,
  mechChromaSkinIndex,
  rankAllowsMechChroma,
  rankAllowsSkin,
  rollSkinRank,
} from './content/skins';
import {
  cloneAllocation,
  computeTalentModifiers,
  emptyAllocation,
  emptyModifiers,
  type Role,
  repairAllocation,
  type SavedLoadout,
  type TalentAllocation,
  type TalentModifiers,
  talentPointsAtLevel,
} from './content/talents';
import { applyCooldowns, type SavedCooldowns, serializeCooldowns } from './cooldown_persist';
import type { DelveShopGate, DelveShopOffer } from './data';
import {
  abilitiesKnownAt,
  arenaOrigin,
  CAMPS,
  CLASSES,
  DEEPFEN_SHALLOWS_LAKE,
  DELVE_COMPANIONS,
  DELVE_LIST,
  DELVE_SLOT_COUNT,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  delveAt,
  delveOrigin,
  dungeonAt,
  FISHING_RARE_ID,
  FISHING_TABLES,
  GROUND_OBJECTS,
  INSTANCE_SLOT_COUNT,
  ITEMS,
  isDelvePos,
  MOBS,
  NPCS,
  PLAYER_START,
  QUESTS,
  zoneAt,
} from './data';
import * as companionMod from './delves/companion';
import * as lockpickMod from './delves/lockpick_controller';
import * as runsMod from './delves/runs';
import * as nythraxis from './encounters/nythraxis';
// A3: ARENA_SPAWNS_A_2v2/B_2v2 (read only by the moved fiestaRevive) now live with
// social/fiesta.ts. The dungeon-wall consts (DUNGEON_WALL_HW/X) are now read only by
// delves/runs.ts + render/dungeon.ts; W11 dropped the stranded sim.ts import. I2a's delve
// move also dropped the now-unused delve_layout import (DELVE_MODULE_LAYOUTS et al.).
import {
  createGroundObject,
  createMob,
  createNpc,
  createPlayer,
  type PlayerEquipment,
  recalcPlayerStats,
} from './entity';
import {
  addEntityToRoster,
  type DelayedEvent,
  drainDelayedEvents,
  dropEntityFromRoster,
  type GroundAoE,
  rebucketEntity,
  releasePlayerSpirit,
  releaseSpiritInDelve as releaseSpiritInDelveImpl,
  runDespawnDecay,
  tickGroundAoEs,
} from './entity_roster';
import { canEquipItem } from './equipment_rules';
import { fleeSpeed } from './flee_speed';
import { formatMoney } from './format_money';
import * as interaction from './interaction';
import { meetsLevelRequirement } from './item_level_req';
import * as items from './items';
import {
  type DevLeaderboardPage,
  type GuildLeaderboardPage,
  LEADERBOARD_PAGE_SIZE,
  type LeaderboardPage,
  paginateDevLeaderboard,
  paginateGuildLeaderboard,
  paginateLeaderboard,
} from './leaderboard_page';
import type { Ante, PickAction } from './lockpick';
// L1: the loot-distribution layer (party-loot strategy, the rollLoot roller, copper
// split, need-greed roll lifecycle, corpse-loot helpers) moved to ./loot/loot_roll.ts;
// Sim keeps thin same-named delegates that call these.
import {
  activeLootRolls as activeLootRollsImpl,
  assignMasterLoot as assignMasterLootImpl,
  type PendingLootRoll,
  partyLootCandidatesForMob as partyLootCandidatesForMobImpl,
  resolveLootRoll as resolveLootRollImpl,
  rollLoot as rollLootImpl,
  setPartyLootMaster as setPartyLootMasterImpl,
  submitLootRoll as submitLootRollImpl,
} from './loot/loot_roll';
import { type MailSave, PostOffice } from './mail/post_office';
import { Market, type MarketListing, type MarketSave } from './market';
import { defaultMarketQuery, type MarketQuery } from './market_query';
import * as lifecycle from './mob/lifecycle';
import { resetEvadingMob as resetEvadingMobFn, updateMob as updateMobFn } from './mob/locomotion';
import { runMobSwingAffixes } from './mob/mob_swing';
import {
  retargetMob as retargetMobFn,
  updateMobTarget as updateMobTargetFn,
} from './mob/targeting';
import { combatProfileForMob, effectiveMobMeleeRange, type MobCombatProfile } from './mob_combat';
import {
  findPlayerPath,
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from './pathfind';
import * as petAi from './pet/pet_ai';
import * as petCommands from './pet/pet_commands';
import {
  applyTalentAllocation,
  deleteTalentLoadout,
  respecTalents,
  saveTalentLoadout,
  setTalentSpec,
  spendTalentPoint,
  switchTalentLoadout,
  talentPointBudget,
} from './progression/talents';
import { prestige as prestigeImpl, updateRested } from './progression/xp';
import { advancePendingProjectiles, type PendingProjectile } from './projectile_travel';
import { sanitizeRemovedZone1Content } from './removed_zone1_content';
import { Rng } from './rng';
import { persistedResource } from './serialize_resource';
import { createSimContext, type SimContext, type SimContextHost } from './sim_context';
import * as chatMod from './social/chat';
import * as tradeMod from './social/trade';

// Same pattern for the Ravenpost mail book (server/db.ts persists it as a
// per-realm world_state row alongside the market).
export type { MailSave } from './mail/post_office';
// Re-export so server/db.ts's `import type { MarketSave } from '../src/sim/sim'`
// stays valid now that the type lives in market.ts.
export type { MarketSave } from './market';

import {
  enterCrypt as enterCryptImpl,
  enterDungeon as enterDungeonImpl,
  instanceInfoAt as instanceInfoAtImpl,
  instanceKeyFor as instanceKeyForImpl,
  instanceOriginOf as instanceOriginOfImpl,
  instanceSlotAt as instanceSlotAtImpl,
  leaveCrypt as leaveCryptImpl,
  leaveDungeon as leaveDungeonImpl,
  updateDoorTriggers as updateDoorTriggersImpl,
  updateInstances as updateInstancesImpl,
} from './instances/dungeons';
import * as questCommands from './quests/quest_commands';
import {
  checkQuestReady,
  onInventoryChangedForQuests,
  onMobKilledForQuests,
} from './quests/quest_credit';

// computeQuestState (the pure quest-state fn) moved to quests/quest_commands.ts (W4);
// re-export it here so ClientWorld's `import { computeQuestState } from '../sim/sim'`
// (online.ts) stays byte-identical.
export { computeQuestState } from './quests/quest_commands';

import { completeCurrentQuestsForDev, completeQuestForDev } from './quests/dev_quest_commands';
import * as arenaMod from './social/arena';
import * as duelMod from './social/duel';

// A2: eloDelta (with ARENA_K_FACTOR) moved to social/arena.ts. Re-exported so the
// public path `import { Sim, eloDelta } from './sim'` (tests/arena.test.ts) holds.
export { eloDelta } from './social/arena';

import * as fiestaMod from './social/fiesta';
// A3: Fiesta tuning consts moved to social/fiesta.ts; these five are read back here
// by the fiestaMatchInfo presentation accessor (which STAYS on Sim).
import {
  FIESTA_POWERUP_TELEGRAPH,
  FIESTA_POWERUP_TTL,
  FIESTA_RING_CX,
  FIESTA_RING_CZ,
  FIESTA_TOTAL_WAVES,
} from './social/fiesta';
import * as fiestaBotsMod from './social/fiesta_bots';
import { PartyMachine } from './social/party';
import { SpatialGrid } from './spatial';
import { isStunDrCategory } from './stun_dr';
import { Targeting } from './targeting';
import {
  addThreat,
  clearThreat,
  TAUNT_FORCE_SECONDS,
  threatEntries,
  threatModifier,
  topThreatValue,
} from './threat';
import {
  type AbilityDef,
  type AbilityEffect,
  type ArenaCombatant,
  type ArenaFormat,
  type ArenaStanding,
  type Aura,
  type AuraKind,
  angleTo,
  armorReduction,
  type CrowdControlDrCategory,
  DELVE_COMPANION_HEAL_INTERVAL,
  type DelveDef,
  type DelveModuleDef,
  type DelveRun,
  DT,
  DUNGEON_LEASH_DISTANCE,
  dist2d,
  type Entity,
  type EquipSlot,
  type ErrorReason,
  emptyMoveInput,
  FISHING_CAST_ID,
  FISHING_CAST_TIME,
  GCD,
  type InvSlot,
  isConsuming,
  isPetClass,
  isQuestTurnInNpc,
  LEASH_DISTANCE,
  type LootRollChoice,
  type LootRollPrompt,
  type LootStrategies,
  MAX_LEVEL,
  type MasterLootThreshold,
  MELEE_RANGE,
  type MobFamily,
  type MoveInput,
  normAngle,
  type OverheadEmoteId,
  type PetMode,
  type PlayerClass,
  type QuestProgress,
  type QuestState,
  RUN_SPEED,
  type SimConfig,
  type SimEvent,
  type SkinCatalog,
  type SkinRank,
  swingMissChance,
  TURN_SPEED,
  type Vec3,
  virtualLevel,
  xpToReachLevel,
} from './types';
import { groundHeight, WATER_LEVEL } from './world';

// TRIVIAL_LEVEL_GAP moved to mob/targeting.ts (used only by isTrivialTo).
// CORPSE_DURATION moved to combat/damage.ts (C1; used only by the death path).
// LEASH_DISTANCE / DUNGEON_LEASH_DISTANCE moved to types.ts (M2; shared with mob/locomotion.ts).
// EVADE_SPEED_MULT / EVADE_STALL_TIMEOUT moved to mob/locomotion.ts (M2; slice-only).
// Heading offsets (radians) a mob tries when its straight path is blocked, so it
// can slide around a prop instead of pinning on it. Desired heading (0) first;
// only evaluated past the first entry when that straight step is obstructed.
const MOVE_SLIDE_FAN = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6];
const BACKPEDAL_MULT = 0.65;
// Low-HP flee ("fear"): a cowardly mob at or below this HP fraction panics, turns
// and runs from its attacker for FLEE_DURATION seconds at FLEE_SPEED_MULT speed,
// rallying same-family allies it runs past (mob/social_aggro.ts). It flees only once
// per pull, then recovers its nerve and re-engages if it survived.
const FLEE_HP_THRESHOLD = 0.2;
const FLEE_DURATION = 5;
// FLEE_SPEED_MULT / FLEE_MAX_SPEED and the cap math live in ./flee_speed.ts.
// FLEE_RETURN_GRACE moved to mob/locomotion.ts (M2; used only by recoverFromFlee).
// Only sentient, cowardly families flee; beasts/undead/elementals/dragonkin fight
// to the death. Elites, rares, and bosses never flee regardless of family.
const FLEEING_FAMILIES: ReadonlySet<MobFamily> = new Set(['humanoid', 'kobold', 'murloc', 'troll']);
const GRAVITY = 16;
const JUMP_VELOCITY = 6; // apex = v^2/2g ≈ 1.125 yd
// Exported for social/chat_readouts.ts (the /falling readout shares the landing-damage
// threshold with the in-sim fall-damage model below).
export const FALL_SAFE_DISTANCE = 12; // yards of free fall before damage
// Host-agnostic raid-lockout fallback: when no host injects a reset boundary (offline
// browser, headless RL env, tests), a kill locks for a flat 24h day. The authoritative
// server overrides this with its realm-local 3 AM daily reset via SimConfig.raidResetMs.
const DEFAULT_RAID_LOCKOUT_MS = 24 * 60 * 60 * 1000;
// OBJECT_RESPAWN moved to types.ts (shared with the extracted Nythraxis crypt-relic
// respawn). The NYTHRAXIS_* encounter consts (relic summons, Aldric id, wardstone /
// gravebreaker / soul-rend / deathless / transition tuning, room radius, lockout ms,
// party-interact + vision delays) moved to encounters/nythraxis.ts (N1), the only
// code that reads them. NYTHRAXIS_BOSS_ID / NYTHRAXIS_ADD_ID stay in types.ts.
// PARTY_MAX / RAID_MIN / RAID_MAX / RAID_GROUP_MAX moved to social/party.ts (A1),
// the only code that reads them.
// RAID_ALLOWED_DUNGEON_IDS / RAID_REQUIRED_DUNGEON_IDS moved to instances/dungeons.ts
// (I1: read only by enterDungeon's raid gate).
// DAMAGE_IDLE_DESPAWN_SECONDS / DAMAGE_IDLE_DESPAWN_MOB_IDS moved to entity_roster.ts
// (the despawn prologue's home); imported above for the damage-path timer reset.
// PARTY_XP_RANGE moved to types.ts (C1; read by the damage-core xp-split + M1 assist); no longer imported by sim.ts.
// RESTED_* rested-XP tuning + isResting/updateRested moved to progression/xp.ts (G1b),
// the only code that reads them.
// A2: DUEL_COUNTDOWN/DUEL_FORFEIT_DISTANCE moved to social/duel.ts; the Ashen
// Coliseum 1v1 arena tuning (ARENA_COUNTDOWN/RETURN_DELAY/MAX_DURATION/BASE_RATING/
// MIN_RATING/K_FACTOR) + eloDelta moved to social/arena.ts (ARENA_BASE_RATING is
// imported back via arenaMod for the PlayerMeta ctor default).
const ARENA_LADDER_SIZE = 10; // live online standings shipped to clients
// A3: the 2v2 Fiesta tuning consts (score limit, augment waves, respawn growth,
// hazard ring, power-ups, standard level) moved to social/fiesta.ts with the match
// logic. FIESTA_RING_CX/CZ, FIESTA_TOTAL_WAVES, and FIESTA_POWERUP_TELEGRAPH/TTL are
// imported back (above) for the fiestaMatchInfo presentation accessor, which stays
// on Sim. (A2 already moved FIESTA_COUNTDOWN to social/arena.ts.)
const PVP_ROOT_DR_RESET = 18; // seconds before a repeated PvP root is fresh again
const PVP_STUN_DR_RESET = 18; // stuns share the root-style 100/50/25/immune scheme
const PVP_POLYMORPH_DR_RESET = 60;
const PVP_FEAR_DR_RESET = 60;
const PVP_CC_DR_MULTIPLIERS = [1, 0.5, 0.25] as const;
const PVP_POLYMORPH_DR_DURATIONS = [10, 5, 1] as const;
const PVP_FEAR_DR_DURATIONS = [8, 4, 2, 1] as const;
// Exported for social/chat.ts (broadcastEmote) + the /roll say/yell ranges; the in-sim
// say/yell distance checks read it too. /say carries a short distance; /yell across a camp.
export const SAY_RANGE = 25;
// YELL_RANGE moved to types.ts (the chat router + the extracted Nythraxis yells share it).
// OVERHEAD_EMOTE_DURATION moved to social/chat.ts (playEmote moved with it).

// EmoteDef/EMOTES/EMOTE_ALIASES + ASSIST_RANGE moved to social/chat.ts (W5) with the
// chat() router; HARMFUL_AURA_KINDS/isHarmfulAura + NEARBY_RANGE/NEARBY_MAX moved to
// social/chat_readouts.ts with the /targetbuffs + /nearby readouts.
// CHAT_BURST / CHAT_REFILL moved to social/chat.ts (chatAllowed moved with them).
// Max characters in a single chat line, matching classic WoW's 255-char editbox.
// Authoritative cap: enforced here in the deterministic core so every host agrees;
// the client maxlength + server chat-log slices mirror it.
export const MAX_CHAT_MESSAGE_LEN = 255;
// A2: DUEL_FORFEIT_DISTANCE moved to social/duel.ts.
// G2: TRADE_RANGE moved to social/trade.ts with the trade methods.
// The World Market (the Merchant's auction house) moved to market.ts (L2); the
// MARKET_* consts live there now (MARKET_MAX_LISTINGS moved with the /listings readout
// to social/chat_readouts.ts in W5, which imports it from market.ts directly).
// VENDOR_BUYBACK_LIMIT moved to items.ts (W2) with the vendor sell/buyback methods.
// INSTANCE_EMPTY_TIMEOUT relocated to types.ts (I1); no longer referenced in sim.ts.
// Delve run-lifecycle consts moved to src/sim/delves/runs.ts (I2a): the solid-prop
// radii (DELVE_CHEST/GRAVE/WALL_SOLID_R), DELVE_INTERACT_RANGE, DELVE_BAD_AIR_INTERVAL,
// DELVE_RAISE_DEAD_CHANNEL, DELVE_EXIT_PORTAL_RADIUS, DELVE_LORE_ORDER, and (re-exported
// below) DELVE_MODULE_NAMES + DELVE_IMPLEMENTED_AFFIXES. DELVE_PLATE_RADIUS +
// DELVE_COMPANION_MAX_RANK + DELVE_COMPANION_HEAL_INTERVAL relocated to types.ts
// (consumed by the I2a run module + I2c companion AI; of these sim.ts still reads only
// DELVE_COMPANION_HEAL_INTERVAL, in the delve-companion path).
// The companion (I2c) AI tuning consts (HEAL_RANGE/FOLLOW/HEAL_PCT) now live with the
// per-tick brain in src/sim/delves/companion.ts; only LEVEL_PCT (spawn-only) stays.
// Tessa's combat level as a fraction of the owner's, indexed by rank (1-3): she
// arrives a junior aide and grows into a true peer as you invest Marks. Pairs with
// DELVE_COMPANION_HEAL_PCT so a rank-up lifts both her survivability and her healing.
const DELVE_COMPANION_LEVEL_PCT = [0, 0.5, 0.75, 1.0]; // index = rank

// DELVE_MODULE_NAMES + DELVE_IMPLEMENTED_AFFIXES now live in src/sim/delves/runs.ts;
// re-exported from there so external importers (src/ui/sim_i18n.ts, tests) are unchanged.
export { DELVE_IMPLEMENTED_AFFIXES, DELVE_MODULE_NAMES } from './delves/runs';

const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE; // rise/run above which a ground move is blocked (cliffs, world rim)

// How far a mob pulls same-family neighbours into a fight ("social aggro").
// Murlocs (the clustered water mobs players call "frogs") used to pull too much,
// chain-aggroing the whole pond and making solo pulls impossible (#102). Tune
// per family here; everything else falls back to the default.
// POTION_COOLDOWN moved to items.ts (W2) with the useItem potion branch.
const DEFAULT_SOCIAL_PULL_RADIUS = 5;
const SOCIAL_PULL_RADIUS: Partial<Record<MobFamily, number>> = {
  murloc: 8,
};
// PACK_FRENZY_AURA_ID moved to mob/lifecycle.ts (M4; used only by frenzyPackmates).
// BLOOD_FRENZY_AURA_ID moved to combat/damage.ts (C1; used only by maybeFrenzyOnHit).
const SWIM_SURFACE_Y = WATER_LEVEL - 0.75; // body bobs just below the water line
const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
const SWIM_SPEED_MULT = 0.65;
const FISHING_SAMPLE_DISTANCES = [4, 8, 12, 16, 20, 24];
const DEEPFEN_FISHING_SHORE_MARGIN = 10;
const THE_CODFATHER_ITEM_ID = 'the_codfather';
const THE_CODFATHER_QUEST_ID = 'q_the_codfather';
// DOOR_TRIGGER_RADIUS moved to instances/dungeons.ts (I1: read only by updateDoorTriggers).
// NYTHRAXIS_PARTY_INTERACT_RANGE / NYTHRAXIS_VISION_LINE_DELAY moved to
// encounters/nythraxis.ts (N1) with the crypt-quest helpers that read them.
const BODY_RADIUS = PLAYER_BODY_RADIUS;
const CHARGE_SPEED_MULT = 3; // warrior charge runs at 3x normal speed
const CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1; // stop inside melee range
const FOLLOW_STOP_DIST = 3; // /follow trails this close behind the leader (yards)
const FOLLOW_MAX_RANGE = 60; // give up follow once the leader is this far away
// Pet-AI tick tuning (PET_LEASH/PET_FOLLOW_DISTANCE/PET_PATH_*/PET_WAYPOINT_REACHED/
// PET_ASSIST_RANGE/PET_AGGRESSIVE_RANGE/PET_OWNER_IDLE_TICKS) moved with the slice to
// src/sim/pet/pet_ai.ts (P1a). PET_GROWL_INTERVAL + PET_TELEPORT_DISTANCE relocated to
// ./types: PET_GROWL_INTERVAL is consumed by pet_ai.ts + pet_commands.ts (petTaunt, P1b),
// PET_TELEPORT_DISTANCE by pet_ai.ts + the delve-companion follow (delves/companion.ts);
// sim.ts imports neither now.
// A pet only keeps its OWNER flagged in combat while it is actively trading blows
// (its combatTimer resets to 0 on every hit dealt/taken). A pet that merely holds a
// target it is chasing or can't reach stops dragging the owner into perpetual combat
// past this window, so the owner's out-of-combat health regen resumes. Matches the
// 5s combat-linger used for the owner's own inCombat flag.
const PET_COMBAT_LINGER = 5;
// PET_TAUNT_RANGE / PET_FEED_DURATION / PET_FEED_TICK / DEMON_HEAL_MANA_COST /
// DEMON_HEAL_DURATION / DEMON_HEAL_TICK / TAMED_TARGET_RESPAWN_SECONDS moved with the
// slice to src/sim/pet/pet_commands.ts (P1b); DEMON_HEAL_CAST_ID -> ./types (read by the
// casting channel-tick arm now in combat/casting_lifecycle.ts; sim.ts no longer imports it).
// LOOT_ROLL_TIMEOUT moved with the loot slice to src/sim/loot/loot_roll.ts (L1).

export interface Party {
  id: number;
  leader: number; // pid
  members: number[]; // pids
  raid: boolean;
  raidGroups: Map<number, 1 | 2>; // pid -> raid subgroup
  lootStrategies: LootStrategies;
}

export interface TradeSession {
  a: number;
  b: number;
  offerA: { items: InvSlot[]; copper: number };
  offerB: { items: InvSlot[]; copper: number };
  acceptedA: boolean;
  acceptedB: boolean;
}

export interface DuelState {
  a: number;
  b: number;
  state: 'countdown' | 'active';
  timer: number; // countdown remaining / elapsed
}

// GroundAoE type moved to entity_roster.ts (the ground-AoE drain's home); imported above.

export type { ArenaFormat } from './types';

export interface ArenaQueueUnit {
  pids: number[]; // length 1 (solo) or 2 (premade)
  rating: number; // avg member rating for this queue's bracket
}

// A live arena bout. Combatants are teleported into a private arena instance
// slot; `returns` remembers where each was standing so the match can put them
// back when it ends. Ratings are snapshotted at the start purely for the
// result message — the authoritative values live on each PlayerMeta.
export interface ArenaMatch {
  id: number;
  format: ArenaFormat;
  teamA: number[];
  teamB: number[];
  slot: number; // arena instance slot
  state: 'countdown' | 'active' | 'over';
  timer: number; // countdown remaining, then elapsed once active, then return countdown
  returns: Map<number, { x: number; z: number; facing: number }>;
  ratingA: number; // team avg at start
  ratingB: number;
  defeated: Set<number>;
  fiesta?: FiestaState; // present only for format === 'fiesta'
}

// Everything that makes a Fiesta bout a fiesta. Lives on the ArenaMatch so it is
// torn down with the match. Deterministic throughout: augment offers draw from
// `rng` (seeded from the sim stream at match start) so a replay re-offers the
// same cards.
export interface FiestaState {
  scoreA: number;
  scoreB: number;
  scoreLimit: number;
  wave: number; // 0 before the first wave opens, then 1..FIESTA_TOTAL_WAVES
  nextWaveAt: number; // active-timer value (s) at which the next wave opens
  // Pending augment offers, by pid — the three cards a fighter has yet to pick.
  offers: Map<number, { tier: AugmentTier; wave: number; choices: string[] }>;
  ringRadius: number; // current hazard-ring radius (instance-local)
  ringTarget: number; // radius it is easing toward
  respawn: Map<number, number>; // pid -> seconds until revive (absent = alive)
  deaths: Map<number, number>; // pid -> times downed (drives respawn growth)
  kills: Map<number, number>; // pid -> takedowns this bout (scoreboard)
  streak: Map<number, number>; // pid -> takedowns since last death (word pops)
  lastKill: Map<number, number>; // pid -> active-timer of last takedown (double-kill window)
  // Augment offers wait here until the player's NEXT death so a pick never
  // interrupts a live fight (pid -> queued offers, oldest first).
  pending: Map<number, { tier: AugmentTier; wave: number; choices: string[] }[]>;
  powerups: FiestaPowerup[];
  nextPowerupId: number;
  powerupTimer: number; // s until the next power-up spawn attempt
  firstBlood: boolean;
  rng: Rng;
}

// A ring power-up: telegraphs for FIESTA_POWERUP_TELEGRAPH seconds ('spawning'),
// then becomes grabbable ('ready') until it times out.
export interface FiestaPowerup {
  id: number;
  defId: string;
  x: number;
  z: number;
  state: 'spawning' | 'ready';
  timer: number; // spawning: countdown to ready; ready: countdown to despawn
}

// A2: eloDelta (with ARENA_K_FACTOR) moved to social/arena.ts; re-exported from the
// import block above so `import { Sim, eloDelta } from './sim'` is preserved.

export interface InstanceSlot {
  dungeonId: string;
  slot: number;
  partyKey: string | null; // party id or 'solo:<pid>'
  mobIds: number[];
  objectIds: number[];
  exitId: number | null;
  emptyFor: number;
}

export interface ResolvedAbility {
  def: AbilityDef;
  rank: number;
  cost: number;
  castTime: number;
  cooldown: number; // base def.cooldown, after talent cooldown modifiers
  effects: AbilityEffect[];
  threatFlat: number; // classic bonus threat on a successful use
  threatMult: number; // classic multiplier on this ability's damage-threat
  castWhileMoving?: boolean; // talent-granted mobility (def.castWhileMoving covers baseline)
}

export interface RewardCounters {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  xpGained: number;
  questsCompleted: number;
  questProgress: number;
  lootCopper: number;
  levelUps: number;
}

export interface SentChat {
  channel: 'say' | 'yell' | 'whisper' | 'general' | 'party' | 'world' | 'lfg';
  message: string;
  target?: string;
}

export interface SkinClaimResult {
  catalog: SkinCatalog;
  skin: number;
  chromaId?: string;
}

export interface ItemUseResult {
  type: 'mechChroma';
  chromaId: string;
}

// Opt-in global chat channels a player can /join and /leave. `general` is
// always-on (everyone hears /general), so it is intentionally not joinable here.
export const JOINABLE_CHANNELS = ['world', 'lfg'] as const;
export type JoinableChannel = (typeof JOINABLE_CHANNELS)[number];

// Per-player progression and bags. The entity holds combat state; this holds
// everything that belongs to the character sheet.
export interface PlayerMeta {
  entityId: number;
  // Stable database character id when running on the server. Offline/sim-only
  // callers fall back to entityId for systems that need a rename-proof owner key.
  characterId?: number;
  cls: PlayerClass;
  name: string;
  // Dev-only test dummy spawned via "/dev bot <name>" (social/chat.ts, gated by
  // devCommands): a stationary player you can target and whisper to exercise social
  // features offline; a whisper to it auto-replies. Runtime-only, never serialized.
  isDevBot?: boolean;
  skin: number; // appearance index into the render SKINS[player_<cls>]; persisted, synced
  skinCatalog: SkinCatalog;
  // Cosmetic skin-select event: the rank rolled when the event token was used,
  // pending a lock-in. Set on use, cleared on claim. Persisted so the reward
  // survives reconnect; re-using the token re-shows the same rank (no reroll).
  pendingSkinRank: SkinRank | null;
  pendingSkinCatalog: SkinCatalog | null;
  pendingSkinItemId: string | null;
  moveInput: MoveInput;
  // Monotonic counter bumped when a bulky, rarely-changing wire field (the
  // inventory, and the collection-quest progress derived from it) mutates, so a
  // host can cheaply tell whether that state needs re-sending without diffing
  // it every frame. Runtime-only signal, never serialized/persisted.
  wireRev: number;
  inventory: InvSlot[];
  vendorBuyback: InvSlot[];
  copper: number;
  equipment: PlayerEquipment;
  xp: number;
  // Post-cap progression (Max-Level XP Overflow). `lifetimeXp` is the monotonic
  // 64-bit-safe total of all XP ever earned — it keeps growing at the cap and is
  // the leaderboard sort key + virtual-level source. `prestigeRank` and
  // `unlockedMilestones` are cosmetic-only. All persisted in CharacterState.
  lifetimeXp: number;
  prestigeRank: number;
  unlockedMilestones: Set<string>;
  // Classic Rested XP pool (copper-less XP units). Accrues while resting in an
  // inn, spent to double kill XP. Persisted in CharacterState.
  restedXp: number;
  known: ResolvedAbility[];
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  counters: RewardCounters;
  autoEquip: boolean;
  // sim.time when this character entered the world; powers /played. Session-only
  // (sim.time resets to 0 each server boot), so it reports time this session.
  joinedAt: number;
  // Tick of the player's last deliberate action (movement, ability cast, or pet
  // command). Session-only, never persisted. Powers the anti-AFK gate on
  // aggressive pet auto-pull (see PET_OWNER_IDLE_TICKS) so an idle owner's pet
  // cannot farm the area alone.
  lastActiveTick: number;
  // Ashen Coliseum standings. Legacy arenaRating/Wins/Losses are the 1v1
  // bracket; 2v2 is fully independent and persisted alongside them.
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  arena2v2Rating: number;
  arena2v2Wins: number;
  arena2v2Losses: number;
  // Talents & Specializations. `talents` is the active allocation; `talentMods`
  // is its precomputed flat struct — resolved only on allocation/respec/loadout
  // change (recomputeTalents), never walked on the combat or stat hot path.
  talents: TalentAllocation;
  talentMods: TalentModifiers;
  // 2v2 Fiesta (session-only, never persisted). `fiestaAugments` is the ordered
  // list of augment ids picked this bout; `fiestaMods` is talentMods with those
  // augments folded in (the effective modifier the stat/ability hot paths use
  // while in a Fiesta match); `fiestaSpecial` aggregates the non-modifier augment
  // effects (lifesteal, move speed). All cleared when the bout ends.
  fiestaAugments: string[];
  fiestaMods: TalentModifiers | null;
  fiestaSpecial: AugmentSpecial;
  // Pre-Fiesta character snapshot while standardized to level 20 (see
  // fiestaStandardize); restored on bout exit and used by serializeCharacter so
  // the temporary level-20 build is never persisted.
  fiestaRestore: { level: number; xp: number; talents: TalentAllocation } | null;
  loadouts: SavedLoadout[];
  activeLoadout: number; // index into loadouts, or -1 for none
  raidLockouts: Map<string, number>; // dungeon id -> epoch ms expiry
  // Transient presence status. Set by /afk and /dnd, cleared when the player
  // chats again. Session-only — never persisted, so it resets on login.
  away: AwayStatus | null;
  // Session-only: name of the last player who whispered us, for "/r" replies.
  // Never persisted — a fresh login starts with no reply target.
  lastWhisperFrom?: string;
  // Session-only World Market browse query: the search string, the type / subtype /
  // rarity filters, and the page index. The server filters + paginates against this,
  // so the player can page through and filter the WHOLE market a window at a time.
  // Never persisted, resets on login.
  marketQuery: MarketQuery;
  // One-time Ravenpost welcome letter sent (persisted in CharacterState, so
  // existing characters get the service announcement exactly once).
  mailWelcomed: boolean;
  // Delve meta progression (persisted in CharacterState).
  delveMarks: number;
  delveClears: Record<string, number>;
  companionUpgrades: Record<string, number>;
  delveLoreUnlocked: Set<string>;
  delveDaily: { date: string; firstClearXp: Set<string>; markClears: number };
}

// Away-from-keyboard / do-not-disturb presence. `afk` still delivers whispers
// (the sender just gets a heads-up); `dnd` withholds them.
export interface AwayStatus {
  mode: 'afk' | 'dnd';
  message: string;
}

// ---------------------------------------------------------------------------
// The World Market — a single shared, server-authoritative auction house run by
// the Merchant NPC — moved to market.ts (L2). Its types (MarketListing,
// MarketCollection, MarketSave) and the MARKET_* consts live there now; MarketSave
// is re-exported from this module (above) for server/db.ts.
// ---------------------------------------------------------------------------

// Persistable character state (stored as JSONB server-side). The arena fields
// are optional so characters saved before the Ashen Coliseum existed load
// cleanly (addPlayer falls back to the unranked defaults).
export interface CharacterState {
  level: number;
  xp: number;
  // Post-cap progression. All optional so characters saved before the Max-Level
  // XP Overflow system load cleanly (addPlayer backfills lifetimeXp from level).
  lifetimeXp?: number;
  prestigeRank?: number;
  unlockedMilestones?: string[];
  // Rested XP pool. Optional so pre-rested-XP saves load cleanly (defaults to 0).
  restedXp?: number;
  copper: number;
  hp: number;
  resource: number;
  pos: { x: number; z: number };
  facing: number;
  equipment: PlayerEquipment;
  inventory: InvSlot[];
  vendorBuyback?: InvSlot[];
  questLog: { questId: string; counts: number[]; state: 'active' | 'ready' | 'done' }[];
  questsDone: string[];
  // Legacy arenaRating/Wins/Losses are treated as 1v1 data. The explicit
  // 1v1 fields are written by new saves, while old saves fall back cleanly.
  arenaRating?: number;
  arenaWins?: number;
  arenaLosses?: number;
  arena1v1Rating?: number;
  arena1v1Wins?: number;
  arena1v1Losses?: number;
  arena2v2Rating?: number;
  arena2v2Wins?: number;
  arena2v2Losses?: number;
  // Talents & Specializations (JSONB; no schema migration). All optional so
  // characters saved before talents existed load cleanly (default: no points spent).
  talents?: TalentAllocation;
  loadouts?: SavedLoadout[];
  activeLoadout?: number;
  raidLockouts?: Record<string, number>;
  // Ability/potion cooldowns as remaining-time deltas (JSONB; optional so pre-fix
  // saves load cleanly with no cooldowns). Persisted so logging out and back in no
  // longer wipes cooldowns and lets a player bypass them by relogging.
  cooldowns?: SavedCooldowns;
  pet?: PetState | null;
  skin?: number; // appearance index (JSONB; optional so pre-skin saves load as 0)
  skinCatalog?: SkinCatalog;
  // Pending skin-select event rank (JSONB; optional so older saves load as null).
  pendingSkinRank?: SkinRank | null;
  pendingSkinCatalog?: SkinCatalog | null;
  pendingSkinItemId?: string | null;
  delveMarks?: number;
  delveClears?: Record<string, number>;
  companionUpgrades?: Record<string, number>;
  delveLoreUnlocked?: string[];
  delveDaily?: { date: string; firstClearXp: string[]; markClears: number };
  // Ravenpost welcome letter already sent (optional so pre-mail saves load
  // cleanly and receive the announcement letter once on their next login).
  mailWelcomed?: boolean;
}

export interface PetState {
  templateId: string;
  name: string;
  level: number;
  hp: number;
  dead: boolean;
  mode?: PetMode;
  autoTaunt?: boolean;
}

// PendingMobRespawn is exported so SimContext can type the live `pendingMobRespawns`
// view that pet_commands.ts (completeTame) pushes the tamed beast's respawn into.
export interface PendingMobRespawn {
  templateId: string;
  level: number;
  pos: Vec3;
  facing: number;
  dungeonId: string | null;
  timer: number;
}

// computeQuestState (the pure quest-state fn) moved to quests/quest_commands.ts (W4),
// re-exported from sim.ts (see the import region) so the ClientWorld import stays
// byte-identical.

// copyPos moved to entity_roster.ts (used only by the despawn prologue).

function freshCounters(): RewardCounters {
  return {
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    deaths: 0,
    xpGained: 0,
    questsCompleted: 0,
    questProgress: 0,
    lootCopper: 0,
    levelUps: 0,
  };
}

// isPetClass relocated to types.ts (P1b; imported in the './types' block above). The
// cast-toggle predicates (isFormToggle/isToggleBuff/isStealthToggle/preservesStealth/
// isShamanShock/ignoresDamagePushback) live in combat/casting_lifecycle.ts (C4a).

export class Sim {
  cfg: Required<Omit<SimConfig, 'noPlayer'>>;
  rng: Rng;
  time = 0;
  tickCount = 0;
  entities = new Map<number, Entity>();
  // The shared SimContext seam (S0b): a live view of rng/time/tickCount/entities +
  // emit, plus the cross-system callbacks the extracted game-system slices route
  // through instead of reaching into Sim. Built once in the ctor (buildSimContext);
  // it moves no behavior. See src/sim/sim_context.ts.
  readonly ctx: SimContext;
  // Party/raid state machine (A1): owns parties/partyByPid/partyInvites/nextPartyId
  // and the invite/accept/convert/move/leave/kick/disband logic, moved off Sim
  // behind SimContext. Built in the ctor after `ctx`. Sim keeps thin delegates
  // (partyOf + the eight command methods) so IWorld + foreign call sites resolve.
  private party!: PartyMachine;
  // Player target selection + the party-scoped raid-marker store (T1): owns
  // partyMarkers and the tab/nearest/friendly selectors, moved off Sim behind
  // SimContext. Built in the ctor after `ctx`. Sim keeps thin delegates (the nine
  // selectors + markersFor/setMarker/clearMarker/markerFor) so IWorld + the foreign
  // main/hud/renderer/server/obs call sites resolve; clearEntityMarker/dropPartyMarkers
  // reach it through the seam.
  private targeting!: Targeting;
  players = new Map<number, PlayerMeta>(); // keyed by entity id
  // spatial indexes for radius queries; re-bucketed at the end of each tick
  // and kept roster-exact on spawn/despawn/teleport
  readonly grid = new SpatialGrid();
  readonly playerGrid = new SpatialGrid();
  private engagedPids = new Set<number>();
  primaryId = -1; // the local/RL player in single-player contexts
  nextId = 1;
  events: SimEvent[] = [];
  // Owned by E1 (entity_roster drains it); stays on Sim because N1/M3 schedule into
  // it. Exposed as a live view via SimContext.
  private delayedEvents: DelayedEvent[] = [];
  // In-flight projectiles (projectile_travel.ts): pushed by the ranged combat paths,
  // drained in the tick prologue when each bolt's flight elapses. Live view on ctx.
  private pendingProjectiles: PendingProjectile[] = [];
  // social systems
  // parties / partyByPid / partyInvites / nextPartyId moved to the PartyMachine
  // (src/sim/social/party.ts, session A1); reached via `this.party`.
  accountCosmetics: AccountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  private nextLootRollId = 1;
  private pendingLootRolls = new Map<number, PendingLootRoll>();
  trades = new Map<number, TradeSession>(); // pid -> shared session (both pids point at it)
  tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  duels = new Map<number, DuelState>(); // pid -> shared duel (both pids)
  duelInvites = new Map<number, { fromPid: number; expires: number }>();
  // arena: format-specific queues, live bouts keyed by every participant pid,
  // and the set of busy instance slots
  arenaQueue1v1: number[] = [];
  arenaQueue2v2: ArenaQueueUnit[] = [];
  arenaQueueFiesta: ArenaQueueUnit[] = []; // 2v2 Fiesta (party mode) queue
  arenaMatches = new Map<number, ArenaMatch>(); // pid -> shared match (both pids)
  private arenaBusySlots = new Set<number>();
  private nextArenaMatchId = 1;
  // per-player chat token bucket (anti-spam); refilled lazily by sim time
  private chatTokens = new Map<number, { tokens: number; at: number }>();
  // per-player set of opt-in global channels (world, lfg) joined via /join
  private channelSubs = new Map<number, Set<JoinableChannel>>();
  // dungeon instances
  instances: InstanceSlot[] = [];
  // delve instances (separate slot pool from dungeons)
  delveRuns: DelveRun[] = [];
  private delvePetStash = new Map<number, PetState>();
  // Real-world UTC day ('YYYY-MM-DD') for the delve daily reset (FR-5.1). The sim
  // core must stay deterministic, so it never reads the wall clock itself: the host
  // (server/offline client) sets this each tick from `new Date()`. Empty string =
  // "no calendar known" (headless/replay), the daily window then never rolls over,
  // keeping same-seed runs reproducible. Tests may set it to pin a date.
  utcDay = '';
  // the World Market (the Merchant's auction house): the Market instance owns the
  // listing book, per-seller collections, the id counter, and the Merchant entity
  // id. Constructed in the ctor after the SimContext (it consumes the seam); Sim
  // keeps thin delegates + the `marketListings` getter below so server/IWorld/the
  // /listings readout call sites resolve unchanged.
  market!: Market;
  // The Ravenpost (in-game mail): the PostOffice owns the world-scoped mail
  // book, the id counter, and the mailbox entity ids; Sim keeps thin delegates
  // (the market shape). Constructed in the ctor after the SimContext.
  postOffice!: PostOffice;
  /** When true, /dev level|tp|give chat commands are accepted (local dev only). */
  readonly devCommands: boolean;
  private pendingMobRespawns: PendingMobRespawn[] = [];
  private groundAoEs: GroundAoE[] = [];

  constructor(cfg: SimConfig) {
    this.devCommands = cfg.devCommands ?? false;
    this.cfg = {
      seed: cfg.seed,
      playerClass: cfg.playerClass,
      respawnSeconds: cfg.respawnSeconds ?? 25,
      autoEquip: cfg.autoEquip ?? false,
      playerName: cfg.playerName ?? 'Adventurer',
      devCommands: this.devCommands,
      lockoutNowMs: cfg.lockoutNowMs ?? (() => Math.floor(this.time * 1000)),
      raidResetMs: cfg.raidResetMs ?? ((nowMs: number) => nowMs + DEFAULT_RAID_LOCKOUT_MS),
    };
    this.rng = new Rng(cfg.seed);
    // S0b seam: the shared SimContext every extracted slice routes through. Built
    // once here (the rng now exists); a live view + bound callbacks, it draws no rng
    // and mutates nothing, so it cannot perturb the construction draws below.
    this.ctx = this.buildSimContext();
    // Party/raid machine (A1): constructed after ctx (it consumes the seam). The
    // ctx party callbacks are lazy arrows, so this assignment before any tick/command
    // is what they resolve against; nothing below this point draws on the machine
    // during construction.
    this.party = new PartyMachine(this.ctx);
    // Target selection + raid-marker store (T1): also constructed after ctx (it
    // consumes the seam). The ctx clearEntityMarker/dropPartyMarkers callbacks are
    // lazy arrows resolving against this instance.
    this.targeting = new Targeting(this.ctx);
    // World Market (L2): owns its state; consumes the seam, so it is built right
    // after the SimContext. The NPC loop below sets its merchantId, then seed().
    this.market = new Market(this.ctx);
    // Ravenpost mail: owns the mail book; consumes the seam. The mailbox object
    // loop below (after ground objects) registers its mailbox entity ids.
    this.postOffice = new PostOffice(this.ctx);

    // NPCs — nudged out of buildings and deep water if their data position is bad
    for (const npcDef of Object.values(NPCS)) {
      if (npcDef.dynamic) continue; // spawned on demand by its owning system, not surface-placed
      const safe = this.findSafePos(npcDef.pos.x, npcDef.pos.z, WATER_LEVEL + 0.6);
      const npc = createNpc(this.nextId++, npcDef, this.groundPos(safe.x, safe.z));
      this.addEntity(npc);
      if (npcDef.market) this.market.merchantIds.push(npc.id); // every auctioneer anchors the shared World Market
    }
    this.market.seed();

    // Mobs from camps
    for (const camp of CAMPS) {
      const template = MOBS[camp.mobId];
      // Aquatic/flagged swimmers may wade in the shallows; everyone else
      // still spawns on dry land even though combat movement can enter water.
      const minHeight = this.mobCanSpawnInWater(template) ? WATER_LEVEL - 0.5 : WATER_LEVEL + 0.4;
      for (let i = 0; i < camp.count; i++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * camp.radius;
        const safe = this.findSafePos(
          camp.center.x + Math.sin(ang) * r,
          camp.center.z + Math.cos(ang) * r,
          minHeight,
        );
        const pos = this.groundPos(safe.x, safe.z);
        const level = this.rng.int(template.minLevel, template.maxLevel);
        const mob = createMob(this.nextId++, template, level, pos);
        mob.facing = this.rng.range(-Math.PI, Math.PI);
        mob.prevFacing = mob.facing;
        mob.wanderTimer = this.rng.range(2, 10);
        this.addEntity(mob);
      }
    }

    // Ground objects
    for (const objDef of GROUND_OBJECTS) {
      for (const p of objDef.positions) {
        const obj = createGroundObject(
          this.nextId++,
          objDef.itemId,
          objDef.name,
          this.groundPos(p.x, p.z),
        );
        this.addEntity(obj);
      }
    }

    // Ravenpost mailboxes: one interactable raven pillar per town (draws no
    // rng; findSafePos is deterministic, so the camp draws above are unmoved).
    for (const boxDef of MAILBOXES) {
      const safe = this.findSafePos(boxDef.x, boxDef.z, WATER_LEVEL + 0.6);
      const box = createGroundObject(this.nextId++, '', 'Mailbox', this.groundPos(safe.x, safe.z));
      box.templateId = 'mailbox';
      box.objectItemId = null;
      box.lootable = true; // interactable
      this.addEntity(box);
      this.postOffice.mailboxIds.push(box.id);
    }

    // Dungeon entrances + their private instance slots
    for (const dungeon of DUNGEON_LIST) {
      if (dungeon.overworldDoor === false) {
        for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
          this.instances.push({
            dungeonId: dungeon.id,
            slot: i,
            partyKey: null,
            mobIds: [],
            objectIds: [],
            exitId: null,
            emptyFor: 0,
          });
        }
        continue;
      }
      const doorName = dungeon.id === 'nythraxis_crypt' ? 'Abandoned Crypt' : dungeon.name;
      const door = createGroundObject(
        this.nextId++,
        '',
        doorName,
        this.groundPos(dungeon.doorPos.x, dungeon.doorPos.z),
      );
      door.templateId = 'dungeon_door';
      door.dungeonId = dungeon.id;
      door.objectItemId = null;
      door.lootable = true; // interactable
      this.addEntity(door);
      for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
        this.instances.push({
          dungeonId: dungeon.id,
          slot: i,
          partyKey: null,
          mobIds: [],
          objectIds: [],
          exitId: null,
          emptyFor: 0,
        });
      }
    }

    for (const delve of DELVE_LIST) {
      for (let i = 0; i < DELVE_SLOT_COUNT; i++) {
        const origin = delveOrigin(delve.index, i);
        this.delveRuns.push({
          delveId: delve.id,
          slot: i,
          partyKey: null,
          seed: 0,
          tierId: 'normal',
          affixes: [],
          modules: [],
          moduleIndex: 0,
          origin: { x: origin.x, z: origin.z },
          mobIds: [],
          objectIds: [],
          objective: { kind: delve.objective, counts: [0], complete: false },
          completed: false,
          emptyFor: 0,
          deathsThisRun: {},
          objectState: {},
          raiseDeadChannel: null,
          restlessPending: [],
          badAirTimer: 0,
          companionBarks: [],
          exitPortalOpen: false,
          bountiful: false,
          rewardChestId: null,
          surfaceExitId: null,
          lockpick: null,
        });
      }
    }

    if (!cfg.noPlayer) {
      this.addPlayer(this.cfg.playerClass, this.cfg.playerName, { autoEquip: this.cfg.autoEquip });
    }
  }

  private lockoutNowMs(): number {
    return this.cfg.lockoutNowMs?.() ?? Math.floor(this.time * 1000);
  }

  // The next raid-reset instant for a given lockout "now". The host owns the boundary
  // (server: realm-local 3 AM daily reset); offline/headless fall back to a flat 24h day.
  private raidResetMs(nowMs: number): number {
    return this.cfg.raidResetMs(nowMs);
  }

  // -------------------------------------------------------------------------
  // Entity roster: every add/remove/teleport goes through these so the
  // spatial indexes always match the entities map
  // -------------------------------------------------------------------------

  // Roster ops live in entity_roster.ts (E1). These thin delegates keep the public
  // surface (`sim.addEntity`/`sim.rebucket`) and every internal `this.addEntity` /
  // `this.dropEntity` / `this.rebucket` call site resolving unchanged through the seam.
  addEntity(e: Entity): void {
    addEntityToRoster(this.ctx, e);
  }

  private dropEntity(id: number): void {
    dropEntityFromRoster(this.ctx, id);
  }

  rebucket(e: Entity): void {
    rebucketEntity(this.ctx, e);
  }

  private updatePendingMobRespawns(): void {
    if (this.pendingMobRespawns.length === 0) return;
    for (let i = this.pendingMobRespawns.length - 1; i >= 0; i--) {
      const pending = this.pendingMobRespawns[i];
      pending.timer -= DT;
      if (pending.timer > 0) continue;
      const template = MOBS[pending.templateId];
      if (template) {
        const mob = createMob(this.nextId++, template, pending.level, { ...pending.pos });
        mob.facing = pending.facing;
        mob.prevFacing = pending.facing;
        mob.dungeonId = pending.dungeonId;
        this.addEntity(mob);
      }
      this.pendingMobRespawns.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Players: join / leave / persistence
  // -------------------------------------------------------------------------

  addPlayer(
    cls: PlayerClass,
    name: string,
    opts?: { autoEquip?: boolean; state?: CharacterState; characterId?: number },
  ): number {
    const savedState = opts?.state ? sanitizeRemovedZone1Content(opts.state).state : undefined;
    // Characters saved inside a dungeon instance rejoin at its entrance —
    // their old instance is gone (or belongs to someone else) by now.
    let savedPos = savedState?.pos ?? null;
    // Delve must be checked BEFORE the dungeon branch: dungeonAt() returns null
    // for any x >= ARENA_X_MIN (which includes the delve band), so the dungeon
    // branch's `?? DUNGEON_LIST[0]` fallback would otherwise swallow a delve
    // position and eject the player to a dungeon door instead of the board door
    // (FR-1.6). The two bands are disjoint, so `else if` keeps dungeon handling intact.
    if (savedPos && isDelvePos(savedPos.x)) {
      const delve = delveAt(savedPos.x) ?? DELVE_LIST[0];
      savedPos = { x: delve.doorPos.x, z: delve.doorPos.z - 4 };
    } else if (savedPos && savedPos.x > DUNGEON_X_THRESHOLD) {
      const dungeon = dungeonAt(savedPos.x) ?? DUNGEON_LIST[0];
      savedPos = { x: dungeon.doorPos.x, z: dungeon.doorPos.z - 4 };
    }
    const startPos = savedPos
      ? this.groundPos(savedPos.x, savedPos.z)
      : this.groundPos(PLAYER_START.x, PLAYER_START.z);
    const savedArena1v1: ArenaStanding = {
      rating: savedState?.arena1v1Rating ?? savedState?.arenaRating ?? arenaMod.ARENA_BASE_RATING,
      wins: savedState?.arena1v1Wins ?? savedState?.arenaWins ?? 0,
      losses: savedState?.arena1v1Losses ?? savedState?.arenaLosses ?? 0,
    };
    const savedArena2v2: ArenaStanding = {
      rating: savedState?.arena2v2Rating ?? arenaMod.ARENA_BASE_RATING,
      wins: savedState?.arena2v2Wins ?? 0,
      losses: savedState?.arena2v2Losses ?? 0,
    };
    const player = createPlayer(this.nextId++, cls, startPos, name);
    this.addEntity(player);
    const classDef = CLASSES[cls];
    const meta: PlayerMeta = {
      entityId: player.id,
      characterId: opts?.characterId,
      cls,
      name,
      skin: savedState?.skin ?? 0,
      skinCatalog: savedState?.skinCatalog === 'mech' ? 'mech' : 'class',
      pendingSkinRank: savedState?.pendingSkinRank ?? null,
      pendingSkinCatalog: savedState?.pendingSkinCatalog ?? null,
      pendingSkinItemId: savedState?.pendingSkinItemId ?? null,
      moveInput: emptyMoveInput(),
      wireRev: 0,
      inventory: [],
      vendorBuyback: [],
      copper: 0,
      equipment: { mainhand: classDef.startWeapon, chest: classDef.startChest },
      xp: 0,
      lifetimeXp: 0,
      prestigeRank: 0,
      unlockedMilestones: new Set(),
      restedXp: 0,
      known: [],
      questLog: new Map(),
      questsDone: new Set(),
      counters: freshCounters(),
      autoEquip: opts?.autoEquip ?? false,
      joinedAt: this.time,
      lastActiveTick: this.tickCount,
      arenaRating: savedArena1v1.rating,
      arenaWins: savedArena1v1.wins,
      arenaLosses: savedArena1v1.losses,
      arena2v2Rating: savedArena2v2.rating,
      arena2v2Wins: savedArena2v2.wins,
      arena2v2Losses: savedArena2v2.losses,
      talents: emptyAllocation(),
      talentMods: emptyModifiers(),
      fiestaAugments: [],
      fiestaMods: null,
      fiestaSpecial: {},
      fiestaRestore: null,
      loadouts: [],
      activeLoadout: -1,
      raidLockouts: new Map(),
      away: null,
      marketQuery: defaultMarketQuery(),
      mailWelcomed: false,
      delveMarks: 0,
      delveClears: {},
      companionUpgrades: {},
      delveLoreUnlocked: new Set(),
      delveDaily: { date: '', firstClearXp: new Set(), markClears: 0 },
    };
    this.players.set(player.id, meta);
    player.skinCatalog = meta.skinCatalog;
    player.skin = meta.skin; // mirror onto the entity so the renderer + wire can read it
    if (this.primaryId === -1) this.primaryId = player.id;

    if (savedState) {
      const s = savedState;
      player.level = Math.max(1, Math.min(MAX_LEVEL, s.level));
      player.facing = s.facing;
      player.prevFacing = s.facing;
      meta.xp = s.xp;
      // Backfill lifetimeXp for pre-overflow saves from the level they reached
      // plus their current bar progress, so the leaderboard is meaningful for
      // existing characters from day one.
      meta.lifetimeXp = s.lifetimeXp ?? xpToReachLevel(player.level) + Math.max(0, s.xp);
      meta.prestigeRank = s.prestigeRank ?? 0;
      meta.restedXp = Math.max(0, s.restedXp ?? 0);
      if (s.unlockedMilestones)
        for (const id of s.unlockedMilestones) meta.unlockedMilestones.add(id);
      meta.copper = s.copper;
      meta.equipment = { ...s.equipment };
      meta.inventory = s.inventory.map((i) => ({ ...i }));
      meta.vendorBuyback = (s.vendorBuyback ?? []).map((i) => ({ ...i }));
      for (const q of s.questLog) {
        if (q.state !== 'done')
          meta.questLog.set(q.questId, {
            questId: q.questId,
            counts: [...q.counts],
            state: q.state,
          });
      }
      for (const q of s.questsDone) meta.questsDone.add(q);
      if (s.talents)
        // Revalidate the persisted build against the current rules + level budget
        // before it is baked into the flat mods below. A stored allocation replays
        // verbatim on load, so without this an over-budget, prereq-broken, or gated
        // build (stale tuning, a level-down, or a tampered save) would still grant
        // its stats/abilities. An honest in-budget build is returned unchanged.
        meta.talents = repairAllocation(
          cls,
          {
            spec: s.talents.spec ?? null,
            ranks: { ...s.talents.ranks },
            choices: { ...s.talents.choices },
          },
          talentPointsAtLevel(player.level),
        );
      if (s.loadouts)
        meta.loadouts = s.loadouts.map((l) => ({
          name: l.name,
          alloc: cloneAllocation(l.alloc),
          bar: [...(l.bar ?? [])],
        }));
      if (typeof s.activeLoadout === 'number') meta.activeLoadout = s.activeLoadout;
      if (s.raidLockouts) {
        const now = this.lockoutNowMs();
        for (const [dungeonId, until] of Object.entries(s.raidLockouts)) {
          if (Number.isFinite(until) && until > now) meta.raidLockouts.set(dungeonId, until);
        }
      }
      meta.mailWelcomed = s.mailWelcomed === true;
      meta.delveMarks = s.delveMarks ?? 0;
      meta.delveClears = { ...(s.delveClears ?? {}) };
      meta.companionUpgrades = { ...(s.companionUpgrades ?? {}) };
      if (s.delveLoreUnlocked) for (const id of s.delveLoreUnlocked) meta.delveLoreUnlocked.add(id);
      if (s.delveDaily) {
        meta.delveDaily = {
          date: s.delveDaily.date,
          firstClearXp: new Set(s.delveDaily.firstClearXp),
          markClears: s.delveDaily.markClears,
        };
      }
    }

    // Resolve the flat talent struct once, before the stat pass + ability
    // resolver below consume it (they only ever read these flat numbers).
    meta.talentMods = computeTalentModifiers(cls, meta.talents);
    this.refreshKnownAbilities(meta, false);
    recalcPlayerStats(player, cls, meta.equipment, meta.talentMods);
    if (savedState) {
      player.hp = Math.max(1, Math.min(player.maxHp, savedState.hp));
      player.resource =
        classDef.resourceType === 'mana'
          ? Math.min(player.maxResource, Math.max(0, savedState.resource))
          : classDef.resourceType === 'energy'
            ? 100
            : 0;
    } else {
      player.hp = player.maxHp;
      player.resource =
        classDef.resourceType === 'mana'
          ? player.maxResource
          : classDef.resourceType === 'energy'
            ? 100
            : 0;
    }
    player.swingTimer = 0;
    // Restore ability/potion cooldowns so a relog cannot reset them (see
    // cooldown_persist.ts). Re-anchored to this sim's clock; a fresh character has none.
    player.potionCooldownUntil = applyCooldowns(savedState?.cooldowns, player.cooldowns, this.time);
    // Re-derive the display copy from the restored authority; otherwise a relog inside
    // the shared potion cooldown paints the action bar as READY (no swipe) while the
    // use-gate (which reads potionCooldownUntil) still rejects the quaff.
    player.potionCdRemaining = Math.max(0, player.potionCooldownUntil - this.time);
    if (savedState?.pet) this.restorePet(player, savedState.pet);
    // One-time Ravenpost welcome (doubles as the service announcement for
    // characters saved before mail existed). Flipped before the send so a
    // re-entrant save can never double-book the letter.
    if (!meta.mailWelcomed) {
      meta.mailWelcomed = true;
      this.postOffice.sendWelcome(meta);
    }
    return player.id;
  }

  // Spawn a stationary test player ("/dev bot <name>", gated by devCommands in
  // social/chat.ts): a dummy you can target and whisper to exercise social features
  // offline. Placed a few yards from the primary player so it is visible, and marked
  // isDevBot so a whisper to it auto-replies (see the whisper handler in chat.ts).
  // Returns the new pid, or -1 if the name is blank or already taken (whisper
  // resolution needs a unique name). Never reached in production (the caller runs
  // only when devCommands is on).
  spawnDevBot(name: string): number {
    const clean = name.trim();
    if (!clean) return -1;
    for (const m of this.players.values())
      if (m.name.toLowerCase() === clean.toLowerCase()) return -1;
    const pid = this.addPlayer('mage', clean);
    const meta = this.players.get(pid);
    if (meta) meta.isDevBot = true;
    const me = this.entities.get(this.primaryId);
    const e = this.entities.get(pid);
    if (e && me) {
      e.pos = this.groundPos(me.pos.x + 3, me.pos.z + 3);
      e.prevPos = { ...e.pos };
      this.rebucket(e);
    }
    return pid;
  }

  removePlayer(pid: number): void {
    const meta = this.players.get(pid);
    if (!meta) return;
    // If the leaver owns a live lockpick session, abandon it (preserves
    // attemptAvailable so a remaining party member can still pick the chest).
    // Must run before party removal / dropEntity, since delveRunForPlayer
    // resolves via the still-present entity position and party key.
    const leavingRun = this.delveRunForPlayer(pid);
    if (leavingRun?.lockpick && leavingRun.lockpick.ownerId === pid)
      this.ctx.abandonLockpick(leavingRun);
    // leave social systems cleanly. removeFromParty lives on the PartyMachine now
    // (A1); reach it through the seam, keeping this call in its load-bearing
    // teardown position (must run while the leaver is still in players/entities).
    this.ctx.removeFromParty(pid, 'has left the party');
    const trade = this.trades.get(pid);
    if (trade) this.tradeCancel(pid);
    const duel = this.duels.get(pid);
    if (duel) this.endDuel(duel, duel.a === pid ? duel.b : duel.a);
    // arena: leaving the queue is free; disconnecting mid-bout forfeits it
    this.arenaDequeue(pid);
    const match = this.arenaMatches.get(pid);
    if (match) {
      const team = this.arenaTeamOf(match, pid);
      this.endArenaMatch(match, team === 'A' ? 'B' : team === 'B' ? 'A' : null, 'forfeit');
    }
    this.party.partyInvites.delete(pid);
    this.tradeInvites.delete(pid);
    this.duelInvites.delete(pid);
    // mobs forget the leaving player; persistent hunter pets are serialized
    // with the character and removed from the live world instead of released
    const pet = this.petOf(pid, true);
    if (pet) this.despawnPersistentPet(pet);
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob') continue;
      m.threat.delete(pid);
      if (m.forcedTargetId === pid) {
        m.forcedTargetId = null;
        m.forcedTargetTimer = 0;
      }
      if (m.aggroTargetId === pid) {
        m.aggroTargetId = null;
        if (!m.dead && m.aiState !== 'dead' && m.ownerId === null) this.retargetMob(m);
      }
      if (m.tappedById === pid && !m.dead) m.tappedById = null;
    }
    for (const other of this.players.values()) {
      const e = this.entities.get(other.entityId);
      if (e && e.targetId === pid) e.targetId = null;
    }
    this.dropEntity(pid);
    this.players.delete(pid);
    this.chatTokens.delete(pid);
    this.channelSubs.delete(pid);
    // The caller serializes the character before removePlayer (saveCharacterOnLeave),
    // and serializePet reads delvePetStash when the pet is stowed for a delve, so the
    // pet is already persisted by now. Drop the transient stash entry here so the map
    // can't grow unbounded across sessions.
    this.delvePetStash.delete(pid);
    if (this.primaryId === pid)
      this.primaryId = this.players.size > 0 ? [...this.players.keys()][0] : -1;
  }

  serializeCharacter(pid: number): CharacterState | null {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return null;
    // While a Fiesta bout has standardized this character to level 20 with a
    // throwaway build, persist the PRE-fiesta snapshot so an autosave or
    // mid-match disconnect never writes the temporary state to the database.
    const restore = meta.fiestaRestore;
    // Warlock demons are not persisted across logout: drop the snapshot so a relog
    // forces a fresh re-summon instead of laundering the summon cooldown for free.
    // Hunter pets (non-demon) persist. See pet_commands.isDemonPetState.
    const petSnapshot = this.serializePet(pid);
    const state: CharacterState = {
      level: restore ? restore.level : e.level,
      xp: restore ? restore.xp : meta.xp,
      lifetimeXp: meta.lifetimeXp,
      prestigeRank: meta.prestigeRank,
      unlockedMilestones: [...meta.unlockedMilestones],
      restedXp: meta.restedXp,
      copper: meta.copper,
      hp: e.hp,
      // A druid saved while shifted runs on rage/energy with its mana parked in
      // savedMana; persist the parked mana so reload (always caster form) restores
      // it instead of clamping the form bar into the mana pool.
      resource: persistedResource(
        CLASSES[meta.cls].resourceType,
        e.resourceType,
        e.resource,
        e.savedMana,
      ),
      pos: { x: e.pos.x, z: e.pos.z },
      facing: e.facing,
      equipment: { ...meta.equipment },
      inventory: meta.inventory.map((i) => ({ ...i })),
      vendorBuyback: meta.vendorBuyback.map((i) => ({ ...i })),
      questLog: [...meta.questLog.values()].map((q) => ({
        questId: q.questId,
        counts: [...q.counts],
        state: q.state,
      })),
      questsDone: [...meta.questsDone],
      arenaRating: meta.arenaRating,
      arenaWins: meta.arenaWins,
      arenaLosses: meta.arenaLosses,
      arena1v1Rating: meta.arenaRating,
      arena1v1Wins: meta.arenaWins,
      arena1v1Losses: meta.arenaLosses,
      arena2v2Rating: meta.arena2v2Rating,
      arena2v2Wins: meta.arena2v2Wins,
      arena2v2Losses: meta.arena2v2Losses,
      talents: cloneAllocation(restore ? restore.talents : meta.talents),
      loadouts: meta.loadouts.map((l) => ({
        name: l.name,
        alloc: cloneAllocation(l.alloc),
        bar: [...l.bar],
      })),
      activeLoadout: meta.activeLoadout,
      raidLockouts: Object.fromEntries(
        [...meta.raidLockouts].filter(([, until]) => until > this.lockoutNowMs()),
      ),
      pet: petCommands.isDemonPetState(petSnapshot) ? null : petSnapshot,
      cooldowns: serializeCooldowns(e.cooldowns, e.potionCooldownUntil, this.time),
      skin: meta.skin,
      skinCatalog: meta.skinCatalog,
      pendingSkinRank: meta.pendingSkinRank,
      pendingSkinCatalog: meta.pendingSkinCatalog,
      pendingSkinItemId: meta.pendingSkinItemId,
      delveMarks: meta.delveMarks,
      delveClears: { ...meta.delveClears },
      companionUpgrades: { ...meta.companionUpgrades },
      delveLoreUnlocked: [...meta.delveLoreUnlocked],
      delveDaily: {
        date: meta.delveDaily.date,
        firstClearXp: [...meta.delveDaily.firstClearXp],
        markClears: meta.delveDaily.markClears,
      },
      mailWelcomed: meta.mailWelcomed,
    };
    return sanitizeRemovedZone1Content(state).state;
  }

  /** Set a player's appearance skin (meta + entity). Bounded; the renderer
   *  falls back to the default for an unknown index. Used by creation, the
   *  in-game changer, and the server's changeSkin command. */
  setPlayerSkin(pid: number, skin: number, catalog: SkinCatalog = 'class'): boolean {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return false;
    const maxSkin = catalog === 'mech' ? MECH_CHROMAS.length - 1 : 7;
    const idx = Math.max(0, Math.min(maxSkin, Math.floor(skin)));
    meta.skin = idx;
    meta.skinCatalog = catalog;
    e.skin = idx;
    e.skinCatalog = catalog;
    return true;
  }

  changeSkin(skin: number, catalog: SkinCatalog = 'class'): void {
    this.setPlayerSkin(this.primaryId, skin, catalog);
  }

  /** Set a player's guild name (online only) so it rides the entity wire and
   *  shows under their nameplate. Guilds live in the server social DB, not the
   *  Sim, so this is a passive display field. Offline/headless leave it ''. */
  setPlayerGuild(pid: number, guild: string): void {
    const e = this.entities.get(pid);
    if (e) e.guild = guild;
  }

  /** Cosmetic skin-select event: rolls a rarity rank (once) and emits the
   *  personal `skinEvent` cue that opens the client overlay. Re-using the token
   *  re-shows the already-rolled rank — no reroll — so a player can't spam-roll.
   *  The token is consumed on claim (claimEventSkin), not here. */
  private openSkinSelect(meta: PlayerMeta, catalog: SkinCatalog, itemId: string): void {
    if (meta.pendingSkinRank === null) {
      meta.pendingSkinRank = rollSkinRank(this.rng.next());
      meta.pendingSkinCatalog = catalog;
      meta.pendingSkinItemId = itemId;
    } else {
      meta.pendingSkinCatalog = meta.pendingSkinCatalog ?? catalog;
      meta.pendingSkinItemId = meta.pendingSkinItemId ?? itemId;
    }
    const eventCatalog = meta.pendingSkinCatalog ?? 'class';
    this.emit({
      type: 'skinEvent',
      rank: meta.pendingSkinRank,
      catalog: eventCatalog === 'mech' ? 'mech' : undefined,
      pid: meta.entityId,
    });
  }

  /** Lock in a chosen skin from the skin-select event. Server-authoritative:
   *  rejects (no-op) unless there's a pending rank, the skin's tier is within
   *  that rank, and the player still holds the token. Consumes one token and
   *  clears the pending rank on success. Satisfies IWorld.claimEventSkin. */
  claimEventSkin(skin: number, pid?: number): SkinClaimResult | null {
    const r = this.resolve(pid);
    if (!r) return null;
    const { meta } = r;
    const granted = meta.pendingSkinRank;
    if (granted === null) return null; // no active event
    const catalog = meta.pendingSkinCatalog ?? 'class';
    const tokenItemId = meta.pendingSkinItemId ?? EVENT_SKIN_TOKEN_ID;
    if (this.countItem(tokenItemId, meta.entityId) <= 0) return null; // token gone
    if (catalog === 'mech') {
      if (!rankAllowsMechChroma(granted, skin)) return null; // chroma tier above rolled rank
      const chroma = MECH_CHROMAS[skin];
      if (!chroma) return null;
      this.removeItem(tokenItemId, 1, meta.entityId);
      meta.pendingSkinRank = null;
      meta.pendingSkinCatalog = null;
      meta.pendingSkinItemId = null;
      const mechChromaIds = this.accountCosmetics.mechChromaIds.includes(chroma.id)
        ? this.accountCosmetics.mechChromaIds
        : [...this.accountCosmetics.mechChromaIds, chroma.id];
      this.accountCosmetics = { ...this.accountCosmetics, mechChromaIds };
      this.setPlayerSkin(meta.entityId, skin, 'mech');
      return { catalog: 'mech', skin, chromaId: chroma.id };
    }
    if (!rankAllowsSkin(granted, skin)) return null; // tier above the rolled rank
    if (!classHasSkin(meta.cls, skin)) return null; // skin doesn't exist for this class
    this.removeItem(tokenItemId, 1, meta.entityId);
    this.setPlayerSkin(meta.entityId, skin);
    meta.pendingSkinRank = null;
    meta.pendingSkinCatalog = null;
    meta.pendingSkinItemId = null;
    return { catalog: 'class', skin };
  }

  private unlockMechChromaFromItem(
    meta: PlayerMeta,
    itemId: string,
    chromaId: string,
  ): ItemUseResult | undefined {
    const skin = mechChromaSkinIndex(chromaId);
    if (skin < 0) return undefined;
    if (this.countItem(itemId, meta.entityId) <= 0) return undefined;
    this.removeItem(itemId, 1, meta.entityId);
    const mechChromaIds = this.accountCosmetics.mechChromaIds.includes(chromaId)
      ? this.accountCosmetics.mechChromaIds
      : [...this.accountCosmetics.mechChromaIds, chromaId];
    this.accountCosmetics = { ...this.accountCosmetics, mechChromaIds };
    this.setPlayerSkin(meta.entityId, skin, 'mech');
    return { type: 'mechChroma', chromaId };
  }

  unequipMechChroma(chromaId: string, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const skin = mechChromaSkinIndex(chromaId);
    const itemId = mechChromaItemId(chromaId);
    if (skin < 0 || !itemId) return false;
    if (!this.accountCosmetics.mechChromaIds.includes(chromaId)) return false;
    this.accountCosmetics = {
      ...this.accountCosmetics,
      mechChromaIds: this.accountCosmetics.mechChromaIds.filter((id) => id !== chromaId),
    };
    for (const meta of this.players.values()) {
      if (meta.skinCatalog === 'mech' && meta.skin === skin) {
        this.setPlayerSkin(meta.entityId, 0, 'class');
      }
    }
    this.addItem(itemId, 1, r.meta.entityId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Back-compat accessors: single-player contexts (offline game, RL env, tests)
  // address "the" player; these delegate to the primary player.
  // -------------------------------------------------------------------------

  get playerId(): number {
    return this.primaryId;
  }
  get player(): Entity {
    return this.entities.get(this.primaryId)!;
  }
  private get primary(): PlayerMeta {
    return this.players.get(this.primaryId)!;
  }
  get moveInput(): MoveInput {
    return this.primary.moveInput;
  }
  get inventory(): InvSlot[] {
    return this.primary.inventory;
  }
  get vendorBuyback(): InvSlot[] {
    return this.primary.vendorBuyback;
  }
  get equipment(): PlayerEquipment {
    return this.primary.equipment;
  }
  get copper(): number {
    return this.primary.copper;
  }
  set copper(v: number) {
    this.primary.copper = v;
  }
  get xp(): number {
    return this.primary.xp;
  }
  set xp(v: number) {
    this.primary.xp = v;
  }
  get lifetimeXp(): number {
    return this.primary.lifetimeXp;
  }
  get restedXp(): number {
    return this.primary.restedXp;
  }
  get prestigeRank(): number {
    return this.primary.prestigeRank;
  }
  get unlockedMilestones(): string[] {
    return [...this.primary.unlockedMilestones];
  }
  // Offline leaderboard: rank the players the local sim knows about by lifetime
  // XP. Online play overrides this with the cached, realm-scoped server query.
  // Paged through the same helper the server uses so both worlds behave alike.
  leaderboard(page = 0, pageSize = LEADERBOARD_PAGE_SIZE): Promise<LeaderboardPage> {
    const rows = [...this.players.values()]
      .map((m) => {
        const e = this.entities.get(m.entityId);
        return e ? { meta: m, e } : null;
      })
      .filter((x): x is { meta: PlayerMeta; e: Entity } => x !== null)
      .sort(
        (a, b) =>
          b.meta.lifetimeXp - a.meta.lifetimeXp ||
          b.e.level - a.e.level ||
          a.meta.name.localeCompare(b.meta.name),
      )
      .map(({ meta, e }, i) => ({
        rank: i + 1,
        name: meta.name,
        cls: meta.cls,
        level: e.level,
        virtualLevel: virtualLevel(meta.lifetimeXp),
        lifetimeXp: meta.lifetimeXp,
        prestigeRank: meta.prestigeRank,
      }));
    return Promise.resolve(paginateLeaderboard(rows, page, pageSize));
  }
  // Guilds are a server-only social system (they live in the server's social DB,
  // never in the deterministic sim), so the offline world ranks no guilds: an
  // empty page, paged through the same helper so the board renders its empty
  // state. Online play overrides this with the cached, realm-scoped server query.
  guildLeaderboard(page = 0, pageSize = LEADERBOARD_PAGE_SIZE): Promise<GuildLeaderboardPage> {
    return Promise.resolve(paginateGuildLeaderboard([], page, pageSize));
  }
  // The developer board is sourced from GitHub's contributor stats, which the
  // offline world cannot fetch, so it ranks none: an empty page through the same
  // helper. Online play overrides this with the cached server query.
  devLeaderboard(page = 0, pageSize = LEADERBOARD_PAGE_SIZE): Promise<DevLeaderboardPage> {
    return Promise.resolve(paginateDevLeaderboard([], page, pageSize));
  }

  dailyRewards(): Promise<DailyRewardStatus> {
    const day = '1970-01-01';
    return Promise.resolve({
      day,
      resetAt: '1970-01-02T00:00:00.000Z',
      prizePoolUsd: 0,
      prizePoolSol: null,
      eligibility: {
        eligible: false,
        reason: 'no_wallet',
        walletPubkey: null,
        wocBalance: null,
        wocUsdPrice: null,
        usdValue: null,
        minUsd: 20,
      },
      score: 0,
      rank: null,
      spin: { claimed: false, points: null, outcomeKey: null, claimedAt: null },
      tasks: [],
      leaderboard: [],
    });
  }

  async spinDailyReward(): Promise<DailyRewardSpinResult> {
    const status = await this.dailyRewards();
    return { ...status, awardedPoints: 0, outcomeKey: '' };
  }

  dailyRewardHistory(): Promise<DailyRewardHistory> {
    return Promise.resolve({ payouts: [] });
  }

  get known(): ResolvedAbility[] {
    return this.primary.known;
  }
  get questLog(): Map<string, QuestProgress> {
    return this.primary.questLog;
  }
  get questsDone(): Set<string> {
    return this.primary.questsDone;
  }
  raidLockouts(): import('../world_api').RaidLockout[] {
    const now = this.lockoutNowMs();
    const out: import('../world_api').RaidLockout[] = [];
    for (const [id, until] of this.primary.raidLockouts) {
      const msRemaining = until - now;
      if (msRemaining > 0) out.push({ id, msRemaining });
    }
    return out;
  }
  get counters(): RewardCounters {
    return this.primary.counters;
  }
  get talents(): TalentAllocation {
    return this.primary.talents;
  }
  get talentSpec(): string | null {
    return this.primary.talentMods.spec;
  }
  get talentRole(): Role | null {
    return this.primary.talentMods.role;
  }
  get loadouts(): SavedLoadout[] {
    return this.primary.loadouts;
  }
  get activeLoadout(): number {
    return this.primary.activeLoadout;
  }

  meta(pid: number): PlayerMeta | null {
    return this.players.get(pid) ?? null;
  }

  private resolve(pid?: number): { meta: PlayerMeta; e: Entity } | null {
    const id = pid ?? this.primaryId;
    const meta = this.players.get(id);
    const e = this.entities.get(id);
    if (!meta || !e) return null;
    return { meta, e };
  }

  playerGcdFor(cls: PlayerClass): number {
    return cls === 'rogue' ? 1.0 : GCD; // rogue GCD is 1.0 sec
  }
  get playerGcd(): number {
    return this.playerGcdFor(this.primary.cls);
  }

  groundPos(x: number, z: number): Vec3 {
    return { x, y: groundHeight(x, z, this.cfg.seed), z };
  }

  // Deterministic outward spiral to the nearest spot that is on dry-enough
  // ground and not inside a building/prop. Keeps NPCs out of houses and lakes.
  findSafePos(x: number, z: number, minHeight: number): { x: number; z: number } {
    const seed = this.cfg.seed;
    const ok = (px: number, pz: number): boolean => {
      if (groundHeight(px, pz, seed) < minHeight) return false;
      const res = resolvePosition(seed, px, pz, 0.6);
      return Math.abs(res.x - px) < 1e-4 && Math.abs(res.z - pz) < 1e-4;
    };
    if (ok(x, z)) return { x, z };
    const GOLDEN = 2.39996; // radians; even angular coverage
    for (let i = 1; i <= 80; i++) {
      const r = 0.9 * Math.sqrt(i) * 2.2;
      const a = i * GOLDEN;
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  /** Drain queued events without advancing simulation (offline HUD sync). */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Build the shared SimContext seam (S0b). Pure plumbing: it exposes the live core
  // primitives (rng/time/tickCount/entities via getters) and binds the still-on-Sim
  // methods the early extracted slices call. It MOVES NO behavior - every callback
  // routes straight back to the Sim method of the same name (the callback registry
  // in 02-WORKING-MEMORY.md). As a later slice owns one of these, it reimplements the
  // callback in its own module without renaming it here, so consumers never change.
  private buildSimContext(): SimContext {
    const sim = this;
    const host: SimContextHost = {
      get rng() {
        return sim.rng;
      },
      get time() {
        return sim.time;
      },
      get tickCount() {
        return sim.tickCount;
      },
      get entities() {
        return sim.entities;
      },
      get players() {
        return sim.players;
      },
      get primaryId() {
        return sim.primaryId;
      },
      get tradeInvites() {
        return sim.tradeInvites;
      },
      get duelInvites() {
        return sim.duelInvites;
      },
      get nextId() {
        return sim.nextId;
      },
      set nextId(v) {
        sim.nextId = v;
      },
      get grid() {
        return sim.grid;
      },
      get playerGrid() {
        return sim.playerGrid;
      },
      get delayedEvents() {
        return sim.delayedEvents;
      },
      set delayedEvents(v) {
        sim.delayedEvents = v;
      },
      get pendingProjectiles() {
        return sim.pendingProjectiles;
      },
      set pendingProjectiles(v) {
        sim.pendingProjectiles = v;
      },
      get groundAoEs() {
        return sim.groundAoEs;
      },
      get dungeonDoorIds() {
        return sim.dungeonDoorIds;
      },
      set dungeonDoorIds(v) {
        sim.dungeonDoorIds = v;
      },
      get instances() {
        return sim.instances;
      },
      get arenaMatches() {
        return sim.arenaMatches;
      },
      get duels() {
        return sim.duels;
      },
      get cfg() {
        return sim.cfg;
      },
      // A2: duel + arena state stays on Sim, exposed as live views (backing fields
      // mutated in place / the queues reassigned by the matchmaker filter).
      get trades() {
        return sim.trades;
      },
      get arenaQueue1v1() {
        return sim.arenaQueue1v1;
      },
      set arenaQueue1v1(v) {
        sim.arenaQueue1v1 = v;
      },
      get arenaQueue2v2() {
        return sim.arenaQueue2v2;
      },
      set arenaQueue2v2(v) {
        sim.arenaQueue2v2 = v;
      },
      get arenaQueueFiesta() {
        return sim.arenaQueueFiesta;
      },
      set arenaQueueFiesta(v) {
        sim.arenaQueueFiesta = v;
      },
      get arenaBusySlots() {
        return sim.arenaBusySlots;
      },
      get nextArenaMatchId() {
        return sim.nextArenaMatchId;
      },
      set nextArenaMatchId(v) {
        sim.nextArenaMatchId = v;
      },
      get delveRuns() {
        return sim.delveRuns;
      },
      get delvePetStash() {
        return sim.delvePetStash;
      },
      get utcDay() {
        return sim.utcDay;
      },
      get pendingMobRespawns() {
        return sim.pendingMobRespawns;
      },
      // G2 social plumbing live views. partyInvites lives on the PartyMachine now (A1),
      // so it reads through sim.party; chatTokens/channelSubs stay direct Sim fields.
      // (trades/tradeInvites/duelInvites getters are already bound above; deduped.)
      get partyInvites() {
        return sim.party.partyInvites;
      },
      get chatTokens() {
        return sim.chatTokens;
      },
      get channelSubs() {
        return sim.channelSubs;
      },
      // L1 loot-distribution state stays on Sim (live views): the pending need-greed
      // rolls map (mutated in place) and the roll-id counter (bumped via ctx.nextLootRollId++).
      get pendingLootRolls() {
        return sim.pendingLootRolls;
      },
      get nextLootRollId() {
        return sim.nextLootRollId;
      },
      set nextLootRollId(v) {
        sim.nextLootRollId = v;
      },
      // W5 chat router/readouts live views: devCommands gates the /dev chat cheats;
      // marketListings is the Market book the /listings readout filters (the Market
      // instance is constructed after this host literal, so the getter reads it lazily).
      get devCommands() {
        return sim.devCommands;
      },
      get marketListings() {
        return sim.marketListings;
      },
      // LATE-bound (not .bind(sim)): a moved emit site (C5 meleeSwing/rangedSwing)
      // now emits via ctx.emit, and tests swap (sim as any).emit post-construction to
      // observe events (mob_blind/mob_cleave). An early .bind(sim) would capture the
      // original method and bypass that swap, breaking the dynamic-dispatch semantics
      // the pre-move this.emit had. (Mirrors the late-bound ctx.error C4a installed.)
      emit: (ev) => sim.emit(ev),
      dealDamage: sim.dealDamage.bind(sim),
      handleDeath: sim.handleDeath.bind(sim),
      cancelCast: sim.cancelCast.bind(sim),
      pushbackCast: sim.pushbackCast.bind(sim),
      refreshMobLeashFromAction: sim.refreshMobLeashFromAction.bind(sim),
      retargetMob: sim.retargetMob.bind(sim),
      // N1: the Nythraxis add-AI pair now lives in encounters/nythraxis.ts; late-bound
      // arrows so sim.ctx resolves at call time (mob/targeting.ts retarget reaches them).
      nythraxisAddFallbackTarget: (add) => nythraxis.nythraxisAddFallbackTarget(sim.ctx, add),
      scheduleNythraxisAddDespawnIfBossReset: (add) =>
        nythraxis.scheduleNythraxisAddDespawnIfBossReset(sim.ctx, add),
      isArenaCrossTeam: sim.isArenaCrossTeam.bind(sim),
      arenaTeamOf: sim.arenaTeamOf.bind(sim),
      endArenaMatch: sim.endArenaMatch.bind(sim),
      endDuel: sim.endDuel.bind(sim),
      fiestaTakedown: sim.fiestaTakedown.bind(sim),
      fiestaDown: sim.fiestaDown.bind(sim),
      // A2: isArenaCrossTeam/arenaTeamOf/endArenaMatch/endDuel (above) now forward to
      // social/arena.ts + social/duel.ts via Sim's thin delegates. The block below is
      // what the moved code CONSUMES that stays on Sim (clearAurasFromSource has
      // non-duel callers; entityInDungeon/hasPendingSocialInvite are core; the five
      // fiesta* hooks are A3-owned), plus the arena bodies EXPOSED for Fiesta (A3).
      clearAurasFromSource: sim.clearAurasFromSource.bind(sim),
      entityInDungeon: sim.entityInDungeon.bind(sim),
      hasPendingSocialInvite: sim.hasPendingSocialInvite.bind(sim),
      createFiestaState: sim.createFiestaState.bind(sim),
      fiestaStandardize: sim.fiestaStandardize.bind(sim),
      updateFiestaActive: sim.updateFiestaActive.bind(sim),
      fiestaRestoreChar: sim.fiestaRestoreChar.bind(sim),
      clearFiestaAugments: sim.clearFiestaAugments.bind(sim),
      readyArenaFighter: sim.readyArenaFighter.bind(sim),
      resetForArena: sim.resetForArena.bind(sim),
      isArenaTeamWiped: sim.isArenaTeamWiped.bind(sim),
      arenaIsDown: sim.arenaIsDown.bind(sim),
      arenaAllPids: sim.arenaAllPids.bind(sim),
      rollLoot: sim.rollLoot.bind(sim),
      applyHeal: sim.applyHeal.bind(sim),
      spellCrit: sim.spellCrit.bind(sim),
      applyAura: sim.applyAura.bind(sim),
      // General control-aura predicate (stays on Sim); the extracted Nythraxis
      // isNythraxisControlAura consults it through the seam.
      isControlAura: sim.isControlAura.bind(sim),
      applyRootAura: sim.applyRootAura.bind(sim),
      applyKnockback: sim.applyKnockback.bind(sim),
      diminishedCrowdControlDuration: sim.diminishedCrowdControlDuration.bind(sim),
      hostilesInRadius: sim.hostilesInRadius.bind(sim),
      breakStealth: sim.breakStealth.bind(sim),
      applyTaunt: sim.applyTaunt.bind(sim),
      summonPet: sim.summonPet.bind(sim),
      petOf: sim.petOf.bind(sim),
      completeTame: sim.completeTame.bind(sim),
      // partyOf stays bound to Sim's thin delegate (it forwards to this.party);
      // removeFromParty routes to the moved machine (points-at social/party, A1).
      // clearEntityMarker + dropPartyMarkers now route to the moved marker store
      // (points-at targeting, T1); lazy arrows since `sim.targeting` is built after ctx.
      clearEntityMarker: (id: number) => sim.targeting.clearEntityMarker(id),
      // P1b new shared-helper bindings; both STAY on Sim. error/playerGcdFor/
      // healingThreat/countItem are bound elsewhere in this host (C4a/C2/C3/Q1) - deduped.
      spendResource: sim.spendResource.bind(sim),
      removeItem: sim.removeItem.bind(sim),
      partyOf: sim.partyOf.bind(sim),
      removeFromParty: (pid: number, verb: string) => sim.party.removeFromParty(pid, verb),
      // dropPartyMarkers flips to the T1 marker store (targeting); lazy arrow since
      // sim.targeting is built after ctx. The T1 selectors consume isHostileTo/
      // isFriendlyTo/pvpController/stopFollow, which are already bound above (C4a/C1) and
      // stay on Sim.
      dropPartyMarkers: (partyId: number) => sim.targeting.dropPartyMarkers(partyId),
      // Q1 quest-credit trio now lives in quests/quest_credit.ts; the callbacks route
      // through `sim.ctx` (lazily read at call time, after the ctor sets it). countItem
      // stays on Sim (L2 inventory hub) and is consumed by the collect updater.
      onMobKilledForQuests: (mob, meta) => onMobKilledForQuests(sim.ctx, mob, meta),
      onInventoryChangedForQuests: (meta) => onInventoryChangedForQuests(sim.ctx, meta),
      checkQuestReady: (qp, meta) => checkQuestReady(sim.ctx, qp, meta),
      countItem: sim.countItem.bind(sim),
      completeQuestForDev: (questId, pid) => completeQuestForDev(sim.ctx, questId, pid),
      completeCurrentQuestsForDev: (pid) => completeCurrentQuestsForDev(sim.ctx, pid),
      // I1 dungeon instancing now lives in instances/dungeons.ts; these route through
      // the same-named Sim delegates (foreign callers use this.X). lockoutNowMs is the
      // shared raid-lockout clock that stays on Sim (N1 also writes through it);
      // raidResetMs is the host-owned reset boundary the lockout grant reads through.
      lockoutNowMs: sim.lockoutNowMs.bind(sim),
      raidResetMs: sim.raidResetMs.bind(sim),
      instanceKeyFor: sim.instanceKeyFor.bind(sim),
      instanceOriginOf: sim.instanceOriginOf.bind(sim),
      enterDungeon: sim.enterDungeon.bind(sim),
      leaveDungeon: sim.leaveDungeon.bind(sim),
      addEntity: sim.addEntity.bind(sim),
      dropEntity: sim.dropEntity.bind(sim),
      rebucket: sim.rebucket.bind(sim),
      resolve: sim.resolve.bind(sim),
      groundPos: sim.groundPos.bind(sim),
      playerMods: sim.playerMods.bind(sim),
      delveRunForPlayer: sim.delveRunForPlayer.bind(sim),
      delveModuleEntry: sim.delveModuleEntry.bind(sim),
      failDelveRun: sim.failDelveRun.bind(sim),
      pulseGroundAoE: sim.pulseGroundAoE.bind(sim),
      enterCombat: sim.enterCombat.bind(sim),
      hexOutputMult: sim.hexOutputMult.bind(sim),
      critVulnBonus: sim.critVulnBonus.bind(sim),
      pvpController: sim.pvpController.bind(sim),
      threatMod: sim.threatMod.bind(sim),
      clearNonPlayerStatAuras: sim.clearNonPlayerStatAuras.bind(sim),
      // C3 aura/regen runner (combat/auras.ts) consumes these: the incoming-heal mult +
      // effective-healing threat (both delegate to combat/heal.ts), and the per-aura stat
      // apply/remove on expiry (stays on Sim).
      healingTakenMult: sim.healingTakenMult.bind(sim),
      healingThreat: sim.healingThreat.bind(sim),
      applyNonPlayerStatAura: sim.applyNonPlayerStatAura.bind(sim),
      // N1: grantNythraxisLockout now lives in encounters/nythraxis.ts; late-bound arrow
      // (handleDeath in combat/damage.ts reaches it via ctx on the boss-death path).
      grantNythraxisLockout: (boss) => nythraxis.grantNythraxisLockout(sim.ctx, boss),
      // frenzyPackmates / armDeathThroes flipped points-at to mob/lifecycle (M4); their
      // late-bound lifecycle arrows live in the death-lifecycle block below.
      refreshKnownAbilities: sim.refreshKnownAbilities.bind(sim),
      syncPetLevel: sim.syncPetLevel.bind(sim),
      // M2 mob locomotion seam (all still on Sim; owners flip points-at later).
      moveToward: sim.moveToward.bind(sim),
      mobSwing: sim.mobSwing.bind(sim),
      updateRangedPetAttack: sim.updateRangedPetAttack.bind(sim),
      fleeMoveSpeed: sim.fleeMoveSpeed.bind(sim),
      usesProfiledMobCombat: sim.usesProfiledMobCombat.bind(sim),
      updateProfiledMobCombat: sim.updateProfiledMobCombat.bind(sim),
      tryMobMeleeSwingInRange: sim.tryMobMeleeSwingInRange.bind(sim),
      maybeFlee: sim.maybeFlee.bind(sim),
      aggroMob: sim.aggroMob.bind(sim),
      // C3 moved the CC predicates to combat/cc.ts; ctx.isStunned/isRooted (consumed by
      // mob/locomotion.ts, M2) now point at those pure functions instead of Sim methods.
      isStunned: isStunned,
      isRooted: isRooted,
      moveSpeedMult: sim.moveSpeedMult.bind(sim),
      swingIntervalMult: sim.swingIntervalMult.bind(sim),
      mobEffectiveMeleeRange: sim.mobEffectiveMeleeRange.bind(sim),
      mobCanSwim: sim.mobCanSwim.bind(sim),
      resolveMovePoint: sim.resolveMovePoint.bind(sim),
      // P1a pet AI lives in src/sim/pet/pet_ai.ts; locomotion.updateMob reaches it
      // through this seam binding (late-bound arrow so sim.ctx resolves at call time).
      updatePet: (pet) => petAi.updatePet(sim.ctx, pet),
      isDelveCompanionMob: sim.isDelveCompanionMob.bind(sim),
      // I2c delve companion AI lives in src/sim/delves/companion.ts; locomotion.updateMob's
      // owned-companion branch reaches it through this seam binding (late-bound arrow so
      // sim.ctx resolves at call time). points-at = delves/companion. The shared
      // mobSwing/moveToward/isHostileTo/isRooted/moveSpeedMult/swingIntervalMult it consumes
      // stay on Sim and are bound above (M2/T1/C4a), not re-bound for the companion slice.
      updateDelveCompanion: (companion) => companionMod.updateDelveCompanion(sim.ctx, companion),
      updateBossMechanics: sim.updateBossMechanics.bind(sim),
      // N1: updateNythraxisEncounter now lives in encounters/nythraxis.ts; late-bound
      // arrow (mob/locomotion.ts updateMob drives it via ctx). resetNythraxisEncounter
      // keeps its .bind delegate (foreign callers + a test reach sim.resetNythraxisEncounter).
      updateNythraxisEncounter: (boss) => nythraxis.updateNythraxisEncounter(sim.ctx, boss),
      resetNythraxisEncounter: sim.resetNythraxisEncounter.bind(sim),
      updateFearMovement: sim.updateFearMovement.bind(sim),
      // M4 mob death lifecycle: the five execution bodies live in mob/lifecycle.ts;
      // handleDeath (combat/damage.ts) + the updateMob corpse-tick reach them through
      // these seam bindings (late-bound arrows so sim.ctx resolves at call time, after
      // the ctor finishes building it). despawnPersistentPet (P1b, Sim thin delegate) +
      // clearNonPlayerStatAuras (P1b, Sim thin delegate) + delveDetectMult keep their
      // existing bindings elsewhere in this literal; despawnPet FLIPS to pet/pet_commands
      // (P1b removed the Sim method) and is bound at its M4/I2a location below.
      respawnMob: (mob) => lifecycle.respawnMob(sim.ctx, mob),
      // M2 evade reset (Sim thin delegate -> mob/locomotion.ts); N1's wipe reaches it
      // via ctx, and it re-enters resetNythraxisEncounter for the boss (mutual recursion).
      resetEvadingMob: sim.resetEvadingMob.bind(sim),
      despawnSummonedAdds: (boss) => lifecycle.despawnSummonedAdds(sim.ctx, boss),
      frenzyPackmates: (dead) => lifecycle.frenzyPackmates(sim.ctx, dead),
      armDeathThroes: (dead) => lifecycle.armDeathThroes(sim.ctx, dead),
      detonateCorpse: (dead) => lifecycle.detonateCorpse(sim.ctx, dead),
      // N1: the Nythraxis death dialogue now lives in encounters/nythraxis.ts; late-bound
      // arrow (updateMob's dead-branch fires it via ctx for every dead mob; draws no rng).
      onBossDeath: (mob) => nythraxis.onBossDeath(sim.ctx, mob),
      // M3 mob on-hit affix cascade seam: effectiveArmor (cleave splash armor) +
      // the devour recalc wrapper. Both stay on Sim; the cascade reaches them via ctx.
      effectiveArmor: sim.effectiveArmor.bind(sim),
      recalcPlayer: sim.recalcPlayer.bind(sim),
      // I2a delve run lifecycle now lives in src/sim/delves/runs.ts; the moved module
      // reaches the still-on-Sim helpers / gate predicates / pet seam / I2b lockpick /
      // I2c companion through these delegates. The five reach-in callbacks resolve back
      // to the moved body via the Sim delegate (delveRunForMob/onDelveBossDefeated/
      // delveDetectMult/startDelveRaiseDeadChannel + delveRunForPlayer above). These wrap
      // still-on-Sim methods as LATE-bound arrows (looked up at call time, not `.bind`d at
      // ctor) so they preserve the pre-move `this.X` semantics exactly, including tests
      // that reassign a method (e.g. delves.test.ts swaps sim.grantXp to observe payout).
      // grantXp/delveRunForMob/onDelveBossDefeated/delveDetectMult/despawnPet were also
      // bound above by C1/M2/C3 (eager .bind); deduped here to the I2a late-bound form so
      // the reassign-aware delve tests hold. grantXp/despawnPet stay Sim; the three delve
      // reach-ins delegate to delves/runs via their Sim method body.
      partyMembersForKey: (key) => sim.partyMembersForKey(key),
      grantXp: (amount, meta, opts) => sim.grantXp(amount, meta, opts),
      addItem: (itemId, count, pid) => sim.addItem(itemId, count, pid),
      // L2's World Market escrow (marketList) also consumes removeItem; it is bound once
      // above (P1b inventory-hub helper, points-at Sim) - deduped, not re-added here.
      spawnBossAdds: (boss, mobId, count) => sim.spawnBossAdds(boss, mobId, count),
      tradeFor: (pid) => sim.tradeFor(pid),
      duelFor: (pid) => sim.duelFor(pid),
      serializePet: (ownerPid) => sim.serializePet(ownerPid),
      restorePet: (owner, state) => sim.restorePet(owner, state),
      // despawnPet FLIPS points-at -> pet/pet_commands (P1b): no Sim delegate remains, so
      // the binding calls the module directly (late-bound; locomotion corpse-tick + the
      // in-module demon-stow reach it via ctx.despawnPet). despawnPersistentPet keeps a
      // thin Sim delegate (removePlayer consumes it), so its binding is unchanged.
      despawnPet: (pet) => petCommands.despawnPet(sim.ctx, pet),
      despawnPersistentPet: (pet) => sim.despawnPersistentPet(pet),
      isPetClass,
      spawnDelveCompanion: (run, pid, companionId) =>
        sim.spawnDelveCompanion(run, pid, companionId),
      despawnDelveCompanion: (run) => sim.despawnDelveCompanion(run),
      maybeCompanionBark: (run, pid, barkId) => sim.maybeCompanionBark(run, pid, barkId),
      abandonLockpick: (run) => lockpickMod.abandonLockpick(sim.ctx, run),
      tickLockpickTimeout: (run) => lockpickMod.tickLockpickTimeout(sim.ctx, run),
      delveRunForMob: (mobId) => sim.delveRunForMob(mobId),
      onDelveBossDefeated: (run) => sim.onDelveBossDefeated(run),
      delveDetectMult: (player) => sim.delveDetectMult(player),
      startDelveRaiseDeadChannel: (run, boss, mobId, count) =>
        sim.startDelveRaiseDeadChannel(run, boss, mobId, count),
      resolvedAbility: sim.resolvedAbility.bind(sim),
      playerGcdFor: sim.playerGcdFor.bind(sim),
      // LATE-bound (not .bind(sim)): the moved cast guards emit through ctx.error, and
      // several tests swap (sim as any).error post-construction to observe the message.
      // A .bind(sim) would early-capture the original method and bypass that stub,
      // breaking the `this.error` dynamic-dispatch semantics the pre-move code had.
      error: (pid, text, reason) => sim.error(pid, text, reason),
      isFriendlyTo: sim.isFriendlyTo.bind(sim),
      isHostileTo: sim.isHostileTo.bind(sim),
      lineOfSightBlocked: sim.lineOfSightBlocked.bind(sim),
      stopFollow: sim.stopFollow.bind(sim),
      tameError: sim.tameError.bind(sim),
      standUp: sim.standUp.bind(sim),
      breakGhostWolf: sim.breakGhostWolf.bind(sim),
      startAutoAttack: sim.startAutoAttack.bind(sim),
      revivePet: sim.revivePet.bind(sim),
      completeFishing: sim.completeFishing.bind(sim),
      applyDemonHealTick: sim.applyDemonHealTick.bind(sim),
      // C4b effect-dispatch surface: the per-effect switch the cast lifecycle hands
      // off to. awardCombo, the stat/LoS helpers, and meleeSwing STAY on Sim
      // (shared entry points; effectiveArmor is the M3 binding above, not re-bound
      // here); only `runEffects` flips points-at to combat/effect_dispatch. No Sim
      // runEffects method remains, so the binding calls the module directly with the
      // live ctx (late-bound: sim.ctx is assigned after this host literal is built,
      // and the arrow reads it only at call time).
      awardCombo: sim.awardCombo.bind(sim),
      meleeSwing: sim.meleeSwing.bind(sim),
      effectiveAttackPower: sim.effectiveAttackPower.bind(sim),
      hasLineOfSight: sim.hasLineOfSight.bind(sim),
      findChargePath: sim.findChargePath.bind(sim),
      runEffects: (p, meta, target, res) => runEffectsImpl(sim.ctx, p, meta, target, res),
      // P1a pet-AI seam: the helper the moved updatePet/petRangedAttack/petPickTarget
      // reach back for. syncPetAspect STAYS on Sim (pet-management, P1b owns it eventually);
      // effectiveAttackPower (C4b binding above) + isHostileTo (C4a binding above) are
      // already bound, not re-bound here.
      // C5 auto-attack consumes aggroMob/swingIntervalMult, already bound above (M2; deduped).
      syncPetAspect: sim.syncPetAspect.bind(sim),
      // G2 social plumbing: setPlayerLevel backs the /dev level cheat in social/chat.ts;
      // notice is the /join /leave chat-log line. Both stay on Sim. (hasPendingSocialInvite
      // already bound above; isRooted/moveSpeedMult/swingIntervalMult are M2 bindings above.)
      setPlayerLevel: sim.setPlayerLevel.bind(sim),
      notice: sim.notice.bind(sim),
      // Dev-only test-dummy spawner backing "/dev bot <name>" in social/chat.ts.
      spawnDevBot: sim.spawnDevBot.bind(sim),
      // L2 inventory/vendor (W2): the four still-on-Sim helpers the moved items.useItem
      // dispatches to. Late-bound arrows (looked up at call time, not `.bind`d at ctor)
      // so they preserve the pre-move `this.X` dynamic-dispatch semantics, including tests
      // that reassign a Sim method post-construction. startFishing/unlockMechChromaFromItem/
      // openSkinSelect are private on Sim; isSwimming is public. The owning facets stay TBD.
      startFishing: (p, meta) => sim.startFishing(p, meta),
      unlockMechChromaFromItem: (meta, itemId, chromaId) =>
        sim.unlockMechChromaFromItem(meta, itemId, chromaId),
      openSkinSelect: (meta, catalog, itemId) => sim.openSkinSelect(meta, catalog, itemId),
      isSwimming: (e) => sim.isSwimming(e),
      // Interaction (W3): the moved interaction.interact dispatches into the quest-NPC
      // surface that STAYS on Sim (W4 owns talkToNpc / interactNpcForQuests /
      // isQuestInteractionEntity). Late-bound arrows (call-time lookup, not `.bind`d) so
      // W4 can re-point them into the quests module without touching this binding, and so
      // a test that reassigns sim.talkToNpc is honored. talkToNpc is public; isQuestInteractionEntity
      // is private on Sim. Both MUST keep talkToNpc a resolvable Sim delegate (W4 contract).
      talkToNpc: (npcId, pid) => sim.talkToNpc(npcId, pid),
      isQuestInteractionEntity: (e) => sim.isQuestInteractionEntity(e),
      // W5 chat router/readouts reach-backs. Late-bound arrows (call-time lookup): the
      // /assist branch routes through Sim's targetEntity delegate (-> targeting.ts);
      // partyReadout reads the cap off the party machine; the /listings readout asks the
      // Market instance (constructed after this literal) for listing ownership.
      targetEntity: (id, pid) => sim.targetEntity(id, pid),
      partyCapacity: (party) => sim.party.partyCapacity(party),
      marketListingBelongsTo: (listing, meta) => sim.market.marketListingBelongsTo(listing, meta),
      queueQuestLetter: (questId, pid) => sim.postOffice.queueQuestLetter(questId, pid),
    };
    return createSimContext(host);
  }

  private refreshKnownAbilities(meta: PlayerMeta, announce: boolean): void {
    const e = this.entities.get(meta.entityId);
    if (!e) return;
    const before = new Map(meta.known.map((k) => [k.def.id, k.rank]));
    meta.known = abilitiesKnownAt(meta.cls, e.level, meta.talentMods);
    if (announce) {
      for (const k of meta.known) {
        const prev = before.get(k.def.id);
        if (prev === undefined || prev < k.rank) {
          this.emit({
            type: 'learnAbility',
            abilityId: k.def.id,
            rank: k.rank,
            pid: meta.entityId,
          });
          this.emit({
            type: 'log',
            pid: meta.entityId,
            text:
              prev === undefined
                ? `You have learned a new ability: ${k.def.name}.`
                : `Your ${k.def.name} has improved to Rank ${k.rank}.`,
            color: '#ffd100',
          });
        }
      }
    }
  }

  // Mark a player as a GM: invulnerable (see dealDamage). Server-side only —
  // set at join time from the characters.is_gm column.
  setGm(pid?: number, enabled = true): void {
    const r = this.resolve(pid);
    if (r) r.e.gm = enabled;
  }

  // Dev/test convenience: jump a player to a level (learns abilities, recalcs stats).
  setPlayerLevel(level: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    r.e.level = Math.max(1, Math.min(MAX_LEVEL, level));
    // Keep lifetimeXp consistent with the level so post-cap progression starts
    // from a sane baseline (virtualLevel never falls below the real level). Only
    // ever raises it — lifetimeXp is monotonic.
    r.meta.lifetimeXp = Math.max(r.meta.lifetimeXp, xpToReachLevel(r.e.level));
    recalcPlayerStats(r.e, r.meta.cls, r.meta.equipment, this.playerMods(r.meta));
    r.e.hp = r.e.maxHp;
    if (r.e.resourceType === 'mana') r.e.resource = r.e.maxResource;
    this.refreshKnownAbilities(r.meta, false);
    this.syncPetLevel(r.e);
  }

  // -------------------------------------------------------------------------
  // Talents & Specializations (server-authoritative). The application layer
  // (validate -> bake the flat TalentModifiers struct -> manage specs + the named
  // loadouts) lives in progression/talents.ts (G1a). These stay here as thin wrappers
  // that delegate into the module via this.ctx, so the IWorld / server-command surface
  // (sim.applyTalents(...) etc.) is unchanged. recomputeTalents (the SOLE tree walk),
  // talentLockReason, and sanitizeTalentAllocation are module-internal there. The
  // talent-facing getters (talents/talentSpec/talentRole/loadouts/activeLoadout) and
  // playerMods (the Fiesta overlay) stay on Sim.
  // -------------------------------------------------------------------------

  talentPoints(pid?: number): { total: number; spent: number } {
    return talentPointBudget(this.ctx, pid);
  }

  // Commit a whole staged allocation in one shot (the UI's "Apply"). Rejects any
  // allocation that fails server-side validation with a reason event (FR-4.5).
  applyTalents(alloc: TalentAllocation, pid?: number): boolean {
    return applyTalentAllocation(this.ctx, alloc, pid);
  }

  // Spend a single point into a node (incremental API; the UI mostly stages then
  // applies). Validated identically by building + checking a candidate alloc.
  spendTalent(nodeId: string, pid?: number): boolean {
    return spendTalentPoint(this.ctx, nodeId, pid);
  }

  // Choose / change specialization. Switching specs drops the previous spec
  // tree's points (they belonged to that tree); the class tree is untouched.
  setSpec(specId: string | null, pid?: number): boolean {
    return setTalentSpec(this.ctx, specId, pid);
  }

  // Free respec (out of combat): wipe all talent points. Spec is retained.
  respec(pid?: number): boolean {
    return respecTalents(this.ctx, pid);
  }

  // Save the current build (talents + spec + the given action-bar slot map) as a
  // named loadout. A same-named loadout is overwritten; otherwise appended up to
  // MAX_LOADOUTS. Returns the loadout index (-1 on failure).
  saveLoadout(
    name: string,
    bar: (string | null)[],
    pidOrAlloc?: number | TalentAllocation,
    allocMaybe?: TalentAllocation,
  ): number {
    return saveTalentLoadout(this.ctx, name, bar, pidOrAlloc, allocMaybe);
  }

  // Apply a saved loadout's talents (out of combat). The action bar is restored
  // client-side from the loadout's stored slot map. Re-validated server-side.
  switchLoadout(index: number, pid?: number): boolean {
    return switchTalentLoadout(this.ctx, index, pid);
  }

  deleteLoadout(index: number, pid?: number): boolean {
    return deleteTalentLoadout(this.ctx, index, pid);
  }

  // Threat modifier including the tank-role talent bonus (e.g. Protection's
  // Vengeance Mastery). Reads the precomputed flat threatPct — no tree walk.
  private threatMod(source: Entity, school: string): number {
    let m = threatModifier(source, school);
    if (source.kind === 'player') {
      const meta = this.players.get(source.id);
      if (meta) m *= 1 + this.playerMods(meta).global.threatPct;
    }
    return m;
  }

  resolvedAbility(abilityId: string, pid?: number): ResolvedAbility | null {
    const r = this.resolve(pid);
    if (!r) return null;
    const found = r.meta.known.find((k) => k.def.id === abilityId) ?? null;
    if (!found) return null;
    // A "draining curse" (cost_tax aura) inflates the resource cost of every
    // ability the victim uses. Resolve it here, the single choke point all cost
    // checks/spends read, so the affordability check and the spend stay in
    // lockstep. Return a shallow copy so the cached known-list entry is never
    // mutated.
    const tax = this.costTaxMult(r.e);
    if (tax > 1 && found.cost > 0) return { ...found, cost: Math.ceil(found.cost * tax) };
    return found;
  }

  // Highest active cost_tax aura, expressed as a cost multiplier (1 = no tax).
  private costTaxMult(e: Entity): number {
    let pct = 0;
    for (const a of e.auras) if (a.kind === 'cost_tax' && a.value > pct) pct = a.value;
    return 1 + pct;
  }

  // -------------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------------

  tick(): SimEvent[] {
    // The shared SimContext seam (`this.ctx`, built in the ctor) spans this whole
    // tick: the head/tail phases and the end-of-tick system block all run on the Sim
    // that holds it, so a later slice's extracted update() routes through `this.ctx`
    // without changing the phase order below. S0b threads the seam but moves no
    // behavior, so every phase here is byte-identical (the parity gate proves it).
    this.time += DT;
    this.tickCount++;
    this.updatePendingMobRespawns();
    tickGroundAoEs(this.ctx);

    runDespawnDecay(this.ctx);
    // Step in-flight projectiles toward their live targets before this tick's casts and
    // swings, so a homing bolt resolves on a fixed, deterministic phase boundary.
    advancePendingProjectiles(this.ctx);

    for (const meta of this.players.values()) {
      const p = this.entities.get(meta.entityId);
      if (!p) continue;
      if (!p.dead) {
        this.updatePlayerMovement(p, meta);
        this.updateDoorTriggers(p);
        this.updateCasting(p, meta);
        this.updatePlayerAutoAttack(p, meta);
        updateRegen(this.ctx, p, meta);
        updateRested(p, meta);
      }
      updateTimers(p);
      updateAuras(this.ctx, p);
    }

    for (const e of this.entities.values()) {
      if (e.kind === 'mob') {
        this.updateMob(e);
        updateAuras(this.ctx, e);
      } else if (e.kind === 'npc') {
        cleanseFriendlyNpcAuras(this.ctx, e);
      } else if (e.kind === 'object') {
        if (!e.lootable) {
          e.respawnTimer -= DT;
          if (e.respawnTimer <= 0) e.lootable = true;
        }
      }
    }

    // one pass over the entities collects every player a mob is engaged
    // with, instead of one full scan per player
    this.engagedPids.clear();
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      // a wild mob actively engaged keeps its target in combat — and if that
      // target is someone's pet, the pet's owner stays in combat too, so a
      // hunter/warlock can't regen, eat/drink, or use out-of-combat abilities
      // while their pet tanks
      if (
        e.ownerId === null &&
        (e.aiState === 'chase' || e.aiState === 'attack' || e.aiState === 'flee') &&
        e.aggroTargetId !== null
      ) {
        this.engagedPids.add(e.aggroTargetId);
        const tgt = this.entities.get(e.aggroTargetId);
        if (tgt && tgt.ownerId !== null) this.engagedPids.add(tgt.ownerId);
      }
      // a player's pet that is actively fighting an enemy keeps its owner in
      // combat. A pet merely holding a target it is not trading blows with (out of
      // reach, stale) must not freeze the owner's health regen indefinitely (#regen)
      if (e.ownerId !== null && e.aggroTargetId !== null && e.combatTimer < PET_COMBAT_LINGER)
        this.engagedPids.add(e.ownerId);
    }
    for (const meta of this.players.values()) {
      const p = this.entities.get(meta.entityId);
      if (p) p.inCombat = this.engagedPids.has(p.id) || p.combatTimer < 5;
    }

    this.updateDuels();
    this.updateArena();
    this.updateTradesAndInvites();
    this.updateLootRolls();
    this.updateInstances();
    this.updateDelveRuns();
    this.market.update();
    this.postOffice.update();
    drainDelayedEvents(this.ctx);

    // movement re-bucketing: queries during the next tick and the server's
    // snapshot broadcast right after this one see fresh cells
    this.grid.refresh(this.entities.values());
    this.playerGrid.refresh(this.playerEntities());

    const out = this.events;
    this.events = [];
    return out;
  }

  private updateLootRolls(): void {
    if (this.pendingLootRolls.size === 0) return; // skip the defensive copy on the common idle tick
    for (const roll of [...this.pendingLootRolls.values()]) {
      if (roll.expiresAt <= this.time) this.resolveLootRoll(roll);
    }
  }

  private *playerEntities(): Iterable<Entity> {
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (e) yield e;
    }
  }

  // -------------------------------------------------------------------------
  // Player movement
  // -------------------------------------------------------------------------

  private fearAura(e: Entity): Aura | undefined {
    return e.auras.find((a) => a.id === 'fear_incap' && a.kind === 'incapacitate');
  }
  private updateFearMovement(e: Entity): boolean {
    const aura = this.fearAura(e);
    if (!aura || e.auras.some((a) => a.kind === 'root')) return false;
    const angle = Number.isFinite(aura.value) ? aura.value : e.facing;
    const dest = this.groundPos(e.pos.x + Math.sin(angle) * 10, e.pos.z + Math.cos(angle) * 10);
    this.moveToward(e, dest, this.fleeMoveSpeed(e));
    return true;
  }
  private mobCanSwim(template: { family?: string; canSwim?: boolean } | undefined): boolean {
    return !!template;
  }
  private mobCanSpawnInWater(
    template: { family?: string; canSwim?: boolean } | undefined,
  ): boolean {
    return !!template && (template.canSwim === true || template.family === 'murloc');
  }
  private isControlAura(kind: AuraKind): boolean {
    return kind === 'stun' || kind === 'root' || kind === 'incapacitate' || kind === 'polymorph';
  }
  // Nythraxis CC-immunity predicates moved to encounters/nythraxis.ts (N1); Sim keeps
  // thin delegates because the hot applyAura immunity path reads them via this.X
  // (isNythraxisControlAura routes back through ctx.isControlAura, which stays on Sim).
  private isNythraxisControlAura(kind: AuraKind): boolean {
    return nythraxis.isNythraxisControlAura(this.ctx, kind);
  }
  private isNythraxisRaidEnemy(target: Entity): boolean {
    return nythraxis.isNythraxisRaidEnemy(target);
  }
  private isNythraxisScriptedControl(target: Entity, aura: Aura): boolean {
    return nythraxis.isNythraxisScriptedControl(target, aura);
  }
  // L1 loot distribution moved to loot/loot_roll.ts (behind SimContext). Sim keeps a
  // thin delegate for partyLootCandidatesForMob because dead_party_loot.test.ts reaches
  // it via cast; the strategy resolvers it used have no other caller and moved fully.
  private partyLootCandidatesForMob(mob: Entity): PlayerMeta[] {
    return partyLootCandidatesForMobImpl(this.ctx, mob);
  }
  moveSpeedMult(e: Entity): number {
    let slow = 1,
      speed = 1;
    for (const a of e.auras) {
      if (a.kind === 'slow' || a.kind === 'stealth') slow = Math.min(slow, a.value);
      // buff_speed and form_travel both carry a 1+fraction multiplier (1.4 = +40%).
      if (a.kind === 'buff_speed' || a.kind === 'form_travel') speed = Math.max(speed, a.value);
    }
    // Fiesta move-speed augments (only ever non-zero inside a Fiesta bout).
    if (e.kind === 'player') {
      const ms = this.players.get(e.id)?.fiestaSpecial.moveSpeedPct;
      if (ms) speed += ms;
    }
    return slow * speed;
  }

  private fleeMoveSpeed(e: Entity): number {
    return fleeSpeed(e.moveSpeed, this.moveSpeedMult(e));
  }

  // recoverFromFlee moved to mob/locomotion.ts (M2; called only by the flee arm).

  // Fiesta "Moon Boots" power-up: a buff_jump aura multiplies jump height.
  private jumpMult(e: Entity): number {
    let m = 1;
    for (const a of e.auras) if (a.kind === 'buff_jump') m = Math.max(m, a.value);
    return m;
  }

  // Sunder Armor stacks shave flat armor off the defender for physical hits.
  private effectiveArmor(e: Entity): number {
    let armor = e.stats.armor;
    for (const a of e.auras) {
      if (e.kind !== 'player' && a.kind === 'buff_armor') armor += a.value;
      if (a.kind === 'sunder') armor -= a.value * (a.stacks ?? 1);
    }
    return Math.max(0, armor);
  }

  private effectiveAttackPower(e: Entity): number {
    let attackPower = e.attackPower;
    if (e.kind !== 'player') {
      for (const a of e.auras) {
        if (a.kind === 'buff_ap') attackPower += a.value;
        else if (a.kind === 'debuff_ap') attackPower -= a.value;
      }
    }
    return Math.max(0, attackPower);
  }

  // Non-player stat-aura HP bookkeeping moved to pet/pet_commands.ts (P1b); Sim keeps
  // these thin delegates for the applyAura/aura-expiry callers (this.applyNonPlayerStatAura)
  // and respawnMob's ctx.clearNonPlayerStatAuras.
  private applyNonPlayerStatAura(target: Entity, aura: Aura, direction: 1 | -1): void {
    petCommands.applyNonPlayerStatAura(this.ctx, target, aura, direction);
  }

  private clearNonPlayerStatAuras(target: Entity): void {
    petCommands.clearNonPlayerStatAuras(this.ctx, target);
  }

  private syncPetAspect(pet: Entity, owner: Entity): void {
    const ownerAspect =
      owner.auras.find((a) => a.id === 'aspect_of_the_hawk' || a.id === 'aspect_of_the_cheetah') ??
      null;
    const aspectId = ownerAspect ? `pet_${ownerAspect.id}` : null;
    for (let i = pet.auras.length - 1; i >= 0; i--) {
      const aura = pet.auras[i];
      if (!aura.id.startsWith('pet_aspect_')) continue;
      if (aspectId !== aura.id) pet.auras.splice(i, 1);
    }
    if (!ownerAspect || !aspectId) return;
    const existing = pet.auras.find((a) => a.id === aspectId);
    if (existing) {
      existing.remaining = ownerAspect.remaining;
      existing.duration = ownerAspect.duration;
      existing.value = ownerAspect.value;
      return;
    }
    pet.auras.push({
      ...ownerAspect,
      id: aspectId,
      sourceId: owner.id,
    });
  }

  // swing interval multiplier: >1 = slower (thunder clap), haste divides
  swingIntervalMult(e: Entity): number {
    let m = 1;
    for (const a of e.auras) {
      if (a.kind === 'attackspeed') m *= a.value;
      if (a.kind === 'buff_haste') m /= a.value;
    }
    // Enrage frenzy: an enraged mob swings faster (mirrors the inline dmgMult
    // applied in mobSwing). Composes with any slow/haste auras above.
    if (e.enraged) {
      const h = MOBS[e.templateId]?.enrage?.hasteMult;
      if (h && h > 0) m /= h;
    }
    return m;
  }

  isSwimming(e: Entity): boolean {
    return (
      groundHeight(e.pos.x, e.pos.z, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH &&
      e.pos.y <= SWIM_SURFACE_Y + 0.15
    );
  }

  private findChargePath(p: Entity, target: Entity): Vec3[] {
    return findPlayerPath(this.cfg.seed, p.pos, target.pos, 64).map((w) => ({
      x: w.x,
      y: 0,
      z: w.z,
    }));
  }

  // Charge in flight: forced movement toward the target along the pathfound
  // route. Returns true while it owns the player's movement this tick.
  private updateChargeMovement(p: Entity): boolean {
    if (p.chargeTargetId === null) return false;
    const target = this.entities.get(p.chargeTargetId);
    p.chargeTimeLeft -= DT;
    const done = (arrived: boolean): boolean => {
      p.chargeTargetId = null;
      p.chargePath = [];
      if (target) p.facing = angleTo(p.pos, target.pos);
      if (arrived) this.startAutoAttack(p.id);
      return true;
    };
    if (!target || target.dead || p.chargeTimeLeft <= 0 || isRooted(p)) return done(false);
    if (dist2d(p.pos, target.pos) <= CHARGE_ARRIVE_RANGE) return done(true);
    if (p.sitting) this.standUp(p);
    // re-route when the target has run well away from where the path ends
    const pathEnd = p.chargePath[p.chargePath.length - 1];
    if (!pathEnd || dist2d(pathEnd, target.pos) > 4) p.chargePath = this.findChargePath(p, target);
    // steer at the next waypoint; the final leg homes on the live target
    while (p.chargePath.length > 1 && dist2d(p.pos, p.chargePath[0]) < 1) p.chargePath.shift();
    const wp = p.chargePath.length > 1 ? p.chargePath[0] : target.pos;
    p.facing = angleTo(p.pos, wp);
    const step = Math.min(RUN_SPEED * CHARGE_SPEED_MULT * DT, Math.max(0.01, dist2d(p.pos, wp)));
    const nx = p.pos.x + Math.sin(p.facing) * step;
    const nz = p.pos.z + Math.cos(p.facing) * step;
    // deep water and cliffs end the charge early rather than dragging the player in
    const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const h1 = groundHeight(nx, nz, this.cfg.seed);
    if (h1 < WATER_LEVEL - SWIM_DEPTH) return done(false);
    if (h1 > h0 && (h1 - h0) / step > MAX_CLIMB_SLOPE) return done(false);
    const resolved = this.resolveMove(p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, p);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    p.pos.y = groundHeight(resolved.x, resolved.z, this.cfg.seed);
    p.vy = 0;
    p.onGround = true;
    p.fallStartY = p.pos.y;
    return true;
  }

  // /follow: a second forced-movement mode (like charge) that trails another
  // player. Returns true when it has taken over locomotion for this tick so the
  // normal input-driven movement below is skipped. Any manual movement, combat,
  // or the leader slipping out of range ends the follow.
  stopFollow(p: Entity, msg?: string): void {
    if (p.followTargetId === null) return;
    p.followTargetId = null;
    if (msg) this.error(p.id, msg);
  }

  private updateFollowMovement(p: Entity, meta: PlayerMeta): boolean {
    if (p.followTargetId === null) return false;
    const inp = meta.moveInput;
    // any manual locomotion (incl. camera turns) breaks follow, classic-style
    if (
      inp.forward ||
      inp.back ||
      inp.strafeLeft ||
      inp.strafeRight ||
      inp.jump ||
      inp.turnLeft ||
      inp.turnRight
    ) {
      this.stopFollow(p, 'You stop following.');
      return false;
    }
    const t = this.entities.get(p.followTargetId);
    if (!t || t.dead || t.kind !== 'player' || !this.players.has(t.id)) {
      this.stopFollow(p, 'There is no one to follow.');
      return false;
    }
    if (p.inCombat) {
      this.stopFollow(p, 'You stop following - you are in combat.');
      return false;
    }
    const d = dist2d(p.pos, t.pos);
    if (d > FOLLOW_MAX_RANGE) {
      this.stopFollow(p, `${t.name} is too far away to follow.`);
      return false;
    }
    // always turn to face the leader, even while held in place
    p.facing = angleTo(p.pos, t.pos);
    if (isStunned(p) || isRooted(p) || d <= FOLLOW_STOP_DIST) return true;
    let speed = RUN_SPEED * this.moveSpeedMult(p);
    if (this.isSwimming(p)) speed *= SWIM_SPEED_MULT;
    const step = Math.min(speed * DT, d - FOLLOW_STOP_DIST);
    const nx = p.pos.x + Math.sin(p.facing) * step;
    const nz = p.pos.z + Math.cos(p.facing) * step;
    const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const h1 = groundHeight(nx, nz, this.cfg.seed);
    if (h1 < WATER_LEVEL - SWIM_DEPTH) return true; // don't trail into deep water
    if (h1 > h0 && step > 1e-5 && (h1 - h0) / step > MAX_CLIMB_SLOPE) return true; // wall/cliff
    const resolved = this.resolveMove(p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, p);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    p.pos.y = groundHeight(resolved.x, resolved.z, this.cfg.seed);
    p.vy = 0;
    p.onGround = true;
    p.fallStartY = p.pos.y;
    return true;
  }

  private updatePlayerMovement(p: Entity, meta: PlayerMeta): void {
    // Any locomotion key counts as a deliberate action for the anti-AFK pet gate.
    const mv = meta.moveInput;
    if (
      mv.forward ||
      mv.back ||
      mv.strafeLeft ||
      mv.strafeRight ||
      mv.turnLeft ||
      mv.turnRight ||
      mv.jump
    ) {
      meta.lastActiveTick = this.tickCount;
    }
    if (this.updateChargeMovement(p)) return;
    if (this.updateFollowMovement(p, meta)) return;
    if (this.updateFearMovement(p)) return;
    const inp = meta.moveInput;
    // Convention: facing f points along (sin f, cos f); the camera sits behind
    // the player, so screen-right is the world vector (-cos f, sin f).
    // Turning right therefore DECREASES facing.
    if (!isStunned(p)) {
      if (inp.turnLeft) p.facing = normAngle(p.facing + TURN_SPEED * DT);
      if (inp.turnRight) p.facing = normAngle(p.facing - TURN_SPEED * DT);
    }

    let mx = 0,
      mz = 0; // local: z forward, x strafe-right
    if (inp.forward) mz += 1;
    if (inp.back) mz -= 1;
    if (inp.strafeLeft) mx -= 1;
    if (inp.strafeRight) mx += 1;

    const wantsMove = mx !== 0 || mz !== 0 || inp.jump;
    if (wantsMove && p.sitting) this.standUp(p);

    const hasMoveInput = mx !== 0 || mz !== 0;
    const moving = hasMoveInput && !isRooted(p);
    const swimming = this.isSwimming(p);
    let wishX = 0,
      wishZ = 0,
      wishSpeed = 0;
    if (moving) {
      if (p.castingAbility) {
        // A mobile cast (def flag, or talent-granted via the resolved ability)
        // survives its caster's movement; everything else breaks, fishing included.
        const casting = this.resolvedAbility(p.castingAbility, p.id);
        const mobile = casting != null && (casting.def.castWhileMoving || casting.castWhileMoving);
        if (!mobile) this.cancelCast(p);
      }
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      let speed = RUN_SPEED * this.moveSpeedMult(p);
      if (mz < 0) speed *= BACKPEDAL_MULT;
      if (swimming) speed *= SWIM_SPEED_MULT;
      // world = forward * mz + right * mx, with right = (-cos f, sin f)
      const sin = Math.sin(p.facing),
        cos = Math.cos(p.facing);
      const wx = mz * sin - mx * cos;
      const wz = mz * cos + mx * sin;
      wishX = wx;
      wishZ = wz;
      wishSpeed = speed;
    }

    const movingOnGround = moving && (p.onGround || swimming);
    if (movingOnGround || (!p.onGround && (p.vx !== 0 || p.vz !== 0))) {
      const stepX = movingOnGround ? wishX * wishSpeed : p.vx;
      const stepZ = movingOnGround ? wishZ * wishSpeed : p.vz;
      let nx = p.pos.x + stepX * DT;
      let nz = p.pos.z + stepZ * DT;
      // cliffs and the world rim are walls, not ramps
      if (p.onGround && !swimming) {
        const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
        const h1 = groundHeight(nx, nz, this.cfg.seed);
        const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        if (h1 > h0 && run > 1e-5 && (h1 - h0) / run > MAX_CLIMB_SLOPE) {
          nx = p.pos.x;
          nz = p.pos.z;
          if (!p.onGround) {
            p.vx = 0;
            p.vz = 0;
          }
        }
      }
      // Slide along buildings, trees, crypt walls — but while airborne from a
      // jump, pass through fences for the whole arc. Keying off the jump itself
      // (not a height threshold) makes this independent of slope: an uphill
      // approach no longer flickers the clearance off right at the rail.
      const clearFences = !p.onGround && p.jumping;
      const resolved = this.resolveMove(p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, p, clearFences);
      p.pos.x = resolved.x;
      p.pos.z = resolved.z;
      if (!p.onGround && (resolved.x !== nx || resolved.z !== nz)) {
        p.vx = (resolved.x - p.prevPos.x) / DT;
        p.vz = (resolved.z - p.prevPos.z) / DT;
      }
    }

    // Vertical: jumping, gravity, swimming, fall damage
    const ground = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const deepWater = ground < WATER_LEVEL - SWIM_DEPTH;
    if (deepWater && p.pos.y <= SWIM_SURFACE_Y + 0.05) {
      // treading water at the surface
      p.pos.y = SWIM_SURFACE_Y;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      p.fallStartY = p.pos.y;
      if (inp.jump && !isRooted(p)) {
        // small hop to climb onto shores and docks
        p.vy = JUMP_VELOCITY * 0.7 * this.jumpMult(p);
        p.vx = wishX * wishSpeed;
        p.vz = wishZ * wishSpeed;
        p.onGround = false;
        p.jumping = true;
      }
      return;
    }
    if (inp.jump && p.onGround && !isRooted(p)) {
      p.vy = JUMP_VELOCITY * this.jumpMult(p);
      p.vx = wishX * wishSpeed;
      p.vz = wishZ * wishSpeed;
      p.onGround = false;
      p.jumping = true;
      p.fallStartY = p.pos.y;
    }
    if (!p.onGround) {
      p.vy -= GRAVITY * DT;
      p.pos.y += p.vy * DT;
      p.fallStartY = Math.max(p.fallStartY, p.pos.y);
      if (deepWater && p.pos.y <= SWIM_SURFACE_Y) {
        // splashing into deep water breaks the fall
        p.pos.y = SWIM_SURFACE_Y;
        p.vy = 0;
        p.vx = 0;
        p.vz = 0;
        p.onGround = true;
        p.jumping = false;
        p.fallStartY = p.pos.y;
        return;
      }
      if (p.pos.y <= ground) {
        p.pos.y = ground;
        p.vy = 0;
        p.vx = 0;
        p.vz = 0;
        p.onGround = true;
        p.jumping = false;
        const drop = p.fallStartY - ground;
        if (drop > FALL_SAFE_DISTANCE) {
          const dmg = Math.round(p.maxHp * (drop - FALL_SAFE_DISTANCE) * 0.07);
          if (dmg > 0) this.dealDamage(null, p, dmg, false, 'physical', 'Falling', 'hit', true);
        }
        p.fallStartY = ground;
      }
    } else {
      // Distinguish a walkable downhill slope from a genuine cliff/ledge. The
      // drop the ground can take in one tick scales with how far we moved: a
      // slope no steeper than MAX_CLIMB_SLOPE (the same gate that blocks uphill
      // climbs) is walkable, so we snap down to follow it instead of falling.
      // Only a steeper-than-walkable drop counts as walking off a ledge. The
      // 0.4 base keeps a near-stationary player snapped over tiny terrain noise.
      const run = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
      const maxStepDown = 0.4 + run * MAX_CLIMB_SLOPE;
      if (ground < p.pos.y - maxStepDown) {
        // walked off a ledge — not a jump, so fences still block
        p.onGround = false;
        p.jumping = false;
        p.vx = 0;
        p.vz = 0;
        p.vy = 0;
        p.fallStartY = p.pos.y;
      } else {
        p.pos.y = ground;
        p.fallStartY = ground;
      }
    }
  }

  private standUp(p: Entity): void {
    p.sitting = false;
    if (isConsuming(p)) {
      p.eating = null;
      p.drinking = null;
      this.emit({ type: 'log', text: 'You stand up.', color: '#999', pid: p.id });
    }
  }

  // -------------------------------------------------------------------------
  // Regen, timers, auras
  // -------------------------------------------------------------------------

  // updateRegen / updateTimers / cleanseFriendlyNpcAuras / updateAuras moved to
  // combat/auras.ts (C3); the tick() coordinator calls them in their existing per-entity
  // phase (dead players still tick timers/auras). updateAuras keeps its two load-bearing
  // e.dead guards (a DoT tick can kill the target mid-walk) inside the module.
  // updateGroundAoEs (the drain) moved to entity_roster.ts (tickGroundAoEs); it pulses
  // through this.ctx.pulseGroundAoE. pulseGroundAoE STAYS here (shared entry point,
  // also called on-cast from the effect path).
  private pulseGroundAoE(
    effect: GroundAoE,
    threatOpts?: { flat?: number; mult?: number },
    direct = false,
  ): void {
    const source = this.entities.get(effect.sourceId);
    if (!source || source.dead) return;
    this.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: source.id,
      school: effect.school,
      fx: 'tick',
    });
    for (const target of this.hostilesInRadius(source, effect.pos, effect.radius)) {
      if (!this.hasLineOfSight(source, target)) continue;
      const dmg = Math.round(this.rng.range(effect.min, effect.max) + (effect.spBonus ?? 0));
      this.dealDamage(
        source,
        target,
        dmg,
        false,
        effect.school,
        effect.ability,
        'hit',
        false,
        threatOpts,
        direct,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Casting, channeling & abilities
  // -------------------------------------------------------------------------

  // Casting lifecycle (cast start/progress/finish, GCD, resource+cost+talent mods,
  // cooldown arming) moved to src/sim/combat/casting_lifecycle.ts (C4a). These stay
  // as thin delegates so the tick() updateCasting call, the public castAbility /
  // castAbilityBySlot entry points (server/game.ts, hud.ts, obs.ts, tests), the
  // dealDamage spell-pushback arms (cancelCast/pushbackCast via the SimContext seam),
  // the despawn/demon-channel cancelCast callers, and the demon-heal/queued-swing
  // spendResource callers all resolve unchanged. runEffects now lives in
  // src/sim/combat/effect_dispatch.ts (C4b); the cast lifecycle reaches it (and every
  // other helper) only through SimContext.
  private updateCasting(p: Entity, meta: PlayerMeta): void {
    updateCastingImpl(this.ctx, p, meta);
  }

  private cancelCast(p: Entity): void {
    cancelCastImpl(this.ctx, p);
  }

  private abilityNeedsLineOfSight(ability: AbilityDef): boolean {
    if (!ability.requiresTarget) return false;
    return ability.school !== 'physical' || ability.range > MELEE_RANGE;
  }

  private hasLineOfSight(source: Entity, target: Entity): boolean {
    return lineOfSightClear(this.cfg.seed, source.pos, target.pos);
  }

  private lineOfSightBlocked(source: Entity, target: Entity, ability: AbilityDef): boolean {
    return this.abilityNeedsLineOfSight(ability) && !this.hasLineOfSight(source, target);
  }

  private pushbackCast(p: Entity): void {
    pushbackCastImpl(p);
  }

  castAbilityBySlot(slot: number, pid?: number, aim?: { x: number; z: number }): void {
    castAbilityBySlotImpl(this.ctx, slot, pid, aim);
  }

  castAbility(abilityId: string, pid?: number, aim?: { x: number; z: number }): void {
    castAbilityImpl(this.ctx, abilityId, pid, aim);
  }

  // IWorld ground-targeted cast: offline, the local player (pid undefined) casts
  // the ability aimed at the world point (x, z).
  castAbilityAt(abilityId: string, aim: { x: number; z: number }): void {
    castAbilityImpl(this.ctx, abilityId, undefined, aim);
  }

  // Voluntarily cancel one of a player's own helpful auras (the HUD right-click-a-buff
  // action). Authoritative: the pure predicate refuses debuffs, so a player can never
  // strip a silence/hex/root off themselves. Mirrors clearAurasFromSource's fade-event
  // + conditional stat recalc so a stripped buff_*/form_* actually un-folds.
  cancelAura(auraId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { e, meta } = r;
    const removed = removeCancelableAura(e.auras, auraId);
    if (!removed) return;
    this.emit({ type: 'aura', targetId: e.id, name: removed.name, gained: false });
    if (auraAffectsStats(removed)) {
      recalcPlayerStats(e, meta.cls, meta.equipment, this.playerMods(meta));
    }
  }

  private spendResource(p: Entity, cost: number): void {
    spendResourceImpl(p, cost);
  }

  private spellCrit(p: Entity): number {
    return 0.05 + p.stats.int * 0.0008;
  }

  // Heal core, heal multipliers, heal-absorb soak, crit-vuln bonus, and the
  // healing-threat fan-out moved to src/sim/combat/heal.ts (C2). These stay as thin
  // delegates so the foreign `this.X` callers (aura `hot` tick, regen/potion heal,
  // the heal ability effect, mob mendAlly, and dealDamage's hex/crit-vuln reads via
  // the seam) plus the existing `(sim as any).X` unit tests resolve unchanged.
  // threatEntryMatchesEntity moved too; it had no caller outside healingThreat, so it
  // is module-private there with no Sim delegate.
  private healingTakenMult(target: Entity): number {
    return healingTakenMultImpl(this.ctx, target);
  }

  private hexOutputMult(source: Entity | null): number {
    return hexOutputMultImpl(this.ctx, source);
  }

  private consumeHealAbsorb(target: Entity, healed: number): number {
    return consumeHealAbsorbImpl(this.ctx, target, healed);
  }

  private critVulnBonus(target: Entity): number {
    return critVulnBonusImpl(this.ctx, target);
  }

  private applyHeal(source: Entity, target: Entity, amount: number, ability: string): void {
    applyHealImpl(this.ctx, source, target, amount, ability);
  }

  private healingThreat(source: Entity, target: Entity, healed: number): void {
    healingThreatImpl(this.ctx, source, target, healed);
  }

  private awardCombo(p: Entity, target: Entity, points: number): void {
    if (p.comboTargetId !== target.id) {
      p.comboPoints = 0;
      p.comboTargetId = target.id;
    }
    p.comboPoints = Math.min(5, p.comboPoints + points);
    this.emit({ type: 'comboPoint', points: p.comboPoints, pid: p.id });
  }

  private applyAura(target: Entity, aura: Aura): void {
    if (target.kind === 'npc' && isRejectedFriendlyNpcAura(aura)) return;
    if (
      this.isNythraxisRaidEnemy(target) &&
      this.isNythraxisControlAura(aura.kind) &&
      aura.sourceId !== target.id &&
      !this.isNythraxisScriptedControl(target, aura)
    )
      return;
    if (
      target.kind === 'mob' &&
      MOBS[target.templateId]?.ccImmune &&
      this.isControlAura(aura.kind) &&
      aura.sourceId !== target.id &&
      !this.isNythraxisScriptedControl(target, aura)
    )
      return;
    const existing = target.auras.findIndex(
      (a) => a.id === aura.id && a.sourceId === aura.sourceId,
    );
    if (existing >= 0) {
      this.applyNonPlayerStatAura(target, target.auras[existing], -1);
      target.auras.splice(existing, 1);
    }
    target.auras.push(aura);
    if (aura.kind === 'stealth') target.stealthed = true; // keep the cache live without waiting for updateAuras
    this.applyNonPlayerStatAura(target, aura, 1);
    this.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: true });
    const source = this.entities.get(aura.sourceId);
    this.refreshMobLeashFromAction(source ?? null, target);
    if (target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment, this.playerMods(meta));
    }
  }

  private applyRootAura(
    source: Entity,
    target: Entity,
    name: string,
    id: string,
    duration: number,
    school: Aura['school'],
  ): void {
    const remaining = this.diminishedCrowdControlDuration(source, target, 'root', duration);
    if (remaining === null) return;
    this.applyAura(target, {
      id,
      name,
      kind: 'root',
      remaining,
      duration: remaining,
      value: 0,
      sourceId: source.id,
      school,
    });
  }

  // On-hit knockback: hurl `target` up to `distance` yards straight away from
  // `source`. Instantaneous displacement (no aura) walked in small steps so it can
  // be terrain-clamped exactly like a warrior charge — the shove stops at the last
  // safe footing before deep water or a cliff rather than stranding the victim off
  // the world. Returns the yards actually moved (0 if blocked immediately).
  private applyKnockback(source: Entity, target: Entity, distance: number): number {
    let dx = target.pos.x - source.pos.x;
    let dz = target.pos.z - source.pos.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      // exactly overlapping: shove along the mob's facing so the direction is stable
      dx = Math.sin(source.facing);
      dz = Math.cos(source.facing);
      len = 1;
    }
    const ux = dx / len,
      uz = dz / len;
    const STEP = 0.5;
    let moved = 0;
    let cx = target.pos.x,
      cz = target.pos.z;
    while (moved < distance) {
      const adv = Math.min(STEP, distance - moved);
      const nx = cx + ux * adv,
        nz = cz + uz * adv;
      const h0 = groundHeight(cx, cz, this.cfg.seed);
      const h1 = groundHeight(nx, nz, this.cfg.seed);
      if (h1 < WATER_LEVEL - SWIM_DEPTH) break; // would land in deep water
      if (h1 > h0 && (h1 - h0) / adv > MAX_CLIMB_SLOPE) break; // would slam into a cliff
      cx = nx;
      cz = nz;
      moved += adv;
    }
    if (moved <= 0) return 0;
    // resolveMovePoint is a no-op wrapper over resolvePosition outside a delve, and
    // applies the run's module colliders + portcullis doors when target is inside one.
    const resolved = this.resolveMovePoint(cx, cz, BODY_RADIUS, target);
    target.pos.x = resolved.x;
    target.pos.z = resolved.z;
    target.pos.y = groundHeight(resolved.x, resolved.z, this.cfg.seed);
    target.vy = 0;
    target.onGround = true;
    target.fallStartY = target.pos.y;
    return moved;
  }

  private diminishedCrowdControlDuration(
    source: Entity,
    target: Entity,
    category: CrowdControlDrCategory,
    duration: number,
  ): number | null {
    if (source.kind !== 'player' || target.kind !== 'player' || !this.isHostileTo(source, target)) {
      return duration;
    }
    const existing = target.ccDr.get(category);
    const stage = existing && existing.resetAt > this.time ? existing.stage : 0;
    const reset =
      category === 'polymorph'
        ? PVP_POLYMORPH_DR_RESET
        : category === 'fear'
          ? PVP_FEAR_DR_RESET
          : category === 'lockout'
            ? PVP_STUN_DR_RESET
            : isStunDrCategory(category)
              ? PVP_STUN_DR_RESET
              : PVP_ROOT_DR_RESET;
    if (category === 'polymorph') {
      target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
      return PVP_POLYMORPH_DR_DURATIONS[Math.min(stage, PVP_POLYMORPH_DR_DURATIONS.length - 1)];
    }
    if (category === 'fear') {
      target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
      return PVP_FEAR_DR_DURATIONS[Math.min(stage, PVP_FEAR_DR_DURATIONS.length - 1)];
    }
    if (stage >= PVP_CC_DR_MULTIPLIERS.length) return null;
    target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
    return duration * PVP_CC_DR_MULTIPLIERS[stage];
  }

  private hostilesInRadius(source: Entity, pos: Vec3, radius: number): Entity[] {
    const out: Entity[] = [];
    this.grid.forEachInRadius(pos.x, pos.z, radius, (e) => {
      if (e.id !== source.id && !e.dead && this.isHostileTo(source, e)) out.push(e);
    });
    return out;
  }

  private breakStealth(e: Entity): void {
    const idx = e.auras.findIndex((a) => a.kind === 'stealth');
    if (idx < 0) return;
    const name = e.auras[idx].name;
    e.auras.splice(idx, 1);
    e.stealthed = false; // keep the cache live without waiting for updateAuras
    this.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }

  private breakGhostWolf(e: Entity): void {
    const idx = e.auras.findIndex((a) => a.id === 'ghost_wolf');
    if (idx < 0) return;
    const name = e.auras[idx].name;
    e.auras.splice(idx, 1);
    this.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }

  // Taunt/Growl, classic semantics: never misses, lifts the caster's threat to
  // the top of the table, and forces the mob onto the caster for 3 seconds.
  private applyTaunt(p: Entity, mob: Entity): void {
    const top = topThreatValue(mob);
    const mine = mob.threat.get(p.id) ?? 0;
    mob.threat.set(p.id, Math.max(mine, top, 1));
    if (p.ownerId !== null && MOBS[mob.templateId]?.boss) {
      this.enterCombat(p, mob);
      return;
    }
    mob.forcedTargetId = p.id;
    mob.forcedTargetTimer = TAUNT_FORCE_SECONDS;
    if (mob.aiState === 'idle') this.aggroMob(mob, p, false);
    else if (mob.aiState === 'chase' || mob.aiState === 'attack') mob.aggroTargetId = p.id;
    else if (mob.aiState === 'flee') {
      mob.aggroTargetId = p.id;
      mob.aiState = 'attack';
      mob.fleeTimer = 0;
      mob.fleeReturnTimer = 0;
    }
    this.enterCombat(p, mob);
  }

  // -------------------------------------------------------------------------
  // Hunter pets
  // -------------------------------------------------------------------------

  // Pet commands & lifecycle moved to src/sim/pet/pet_commands.ts (P1b). Sim keeps
  // same-named thin delegates: the 9 public commands satisfy IWorld, and the lifecycle
  // helpers stay reachable for the foreign this.X/sim.X callers (persistence, the
  // updateCasting Demon-Heal-channel arm, the /pet + /pettaunt handlers, delve enter/
  // exit, and the tests). The seam (ctx) carries petOf/summonPet/completeTame/
  // despawnPersistentPet/despawnPet/clearNonPlayerStatAuras into the module.
  petOf(ownerPid: number, includeDead = false): Entity | null {
    return petCommands.petOf(this.ctx, ownerPid, includeDead);
  }

  stowPetForSpectate(ownerPid: number): PetState | null {
    return petCommands.stowPetForSpectate(this.ctx, ownerPid);
  }

  restorePetAfterSpectate(ownerPid: number, state: PetState | null): void {
    petCommands.restorePetAfterSpectate(this.ctx, ownerPid, state);
  }

  private serializePet(ownerPid: number): PetState | null {
    return petCommands.serializePet(this.ctx, ownerPid);
  }

  private restorePet(owner: Entity, state: PetState): void {
    petCommands.restorePet(this.ctx, owner, state);
  }

  private syncPetLevel(owner: Entity): void {
    petCommands.syncPetLevel(this.ctx, owner);
  }

  private tameError(p: Entity, target: Entity): string | null {
    return petCommands.tameError(this.ctx, p, target);
  }

  private completeTame(p: Entity, target: Entity): void {
    petCommands.completeTame(this.ctx, p, target);
  }

  private summonPet(owner: Entity, templateId: string): void {
    petCommands.summonPet(this.ctx, owner, templateId);
  }

  private createDemonPet(owner: Entity, mobId: string, emit = false): Entity | null {
    return petCommands.createDemonPet(this.ctx, owner, mobId, emit);
  }

  private despawnPersistentPet(pet: Entity): void {
    petCommands.despawnPersistentPet(this.ctx, pet);
  }

  abandonPet(pid?: number): void {
    petCommands.abandonPet(this.ctx, pid);
  }

  renamePet(name: string, pid?: number): void {
    petCommands.renamePet(this.ctx, name, pid);
  }

  revivePet(pid?: number): void {
    petCommands.revivePet(this.ctx, pid);
  }

  petAttack(pid?: number): void {
    petCommands.petAttack(this.ctx, pid);
  }

  petTaunt(pid?: number): void {
    petCommands.petTaunt(this.ctx, pid);
  }

  feedPet(itemId: string, pid?: number): void {
    petCommands.feedPet(this.ctx, itemId, pid);
  }

  healPet(pid?: number): void {
    petCommands.healPet(this.ctx, pid);
  }

  private applyDemonHealTick(owner: Entity): void {
    petCommands.applyDemonHealTick(this.ctx, owner);
  }

  setPetMode(mode: PetMode, pid?: number): void {
    petCommands.setPetMode(this.ctx, mode, pid);
  }

  setPetAutoTaunt(enabled: boolean, pid?: number): void {
    petCommands.setPetAutoTaunt(this.ctx, enabled, pid);
  }

  // despawnPet (summoned-demon hard despawn: player-target + threat scrub) moved to
  // pet/pet_commands.ts (P1b). No Sim delegate: the death/corpse-tick caller in
  // mob/locomotion.ts and the in-module stowPetForDelve demon path reach it via the
  // seam (ctx.despawnPet -> petCommands.despawnPet). Distinct from despawnPersistentPet
  // (threat scrub only), which Sim keeps as a delegate for removePlayer.

  // -------------------------------------------------------------------------
  // Auto-attack & melee
  // -------------------------------------------------------------------------

  // The swing system (player auto-attack driver + the melee/ranged white-hit table)
  // lives in src/sim/combat/auto_attack.ts (C5). These thin delegates keep the public
  // IWorld surface (start/stopAutoAttack), the tick() driver dispatch
  // (updatePlayerAutoAttack, kept byte-identical between updateCasting and
  // updateRegen), the ctx.meleeSwing weaponStrike entry (effect_dispatch), and the
  // `(sim as any)` test call sites (mob_blind/mob_thorns/mob_disarm/fixes) resolving
  // unchanged. meleeSwing still returns the connected flag effect_dispatch gates on.
  startAutoAttack(pid?: number): void {
    startAutoAttackImpl(this.ctx, pid);
  }

  stopAutoAttack(pid?: number): void {
    stopAutoAttackImpl(this.ctx, pid);
  }

  private updatePlayerAutoAttack(p: Entity, meta: PlayerMeta): void {
    updatePlayerAutoAttackImpl(this.ctx, p, meta);
  }

  private rangedSwing(
    attacker: Entity,
    target: Entity,
    ranged: { min: number; max: number; speed: number; wand?: boolean; school?: string },
  ): void {
    rangedSwingImpl(this.ctx, attacker, target, ranged);
  }

  private meleeSwing(
    attacker: Entity,
    target: Entity,
    bonus: number,
    abilityName: string | null,
    opts: {
      cannotBeDodged?: boolean;
      weaponMult?: number;
      threatFlat?: number;
      threatMult?: number;
    },
  ): boolean {
    return meleeSwingImpl(this.ctx, attacker, target, bonus, abilityName, opts);
  }

  // -------------------------------------------------------------------------
  // Damage / death
  // -------------------------------------------------------------------------

  dealDamage(
    source: Entity | null,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string | null,
    kind: 'hit' | 'miss' | 'dodge',
    noRage = false,
    threatOpts?: { flat?: number; mult?: number },
    direct = true,
  ): void {
    dealDamageImpl(
      this.ctx,
      source,
      target,
      amount,
      crit,
      school,
      ability,
      kind,
      noRage,
      threatOpts,
      direct,
    );
  }

  private enterCombat(a: Entity, b: Entity): void {
    a.combatTimer = 0;
    b.combatTimer = 0;
    a.inCombat = true;
    b.inCombat = true;
    // players and their pets pull wild mobs; pets never run wild-mob AI
    const aAttacker = a.kind === 'player' || (a.kind === 'mob' && a.ownerId !== null);
    if (b.kind === 'mob' && b.ownerId === null && !b.dead && aAttacker && b.aiState !== 'evade') {
      if (b.aiState === 'idle') this.aggroMob(b, a, true);
      else if (b.aggroTargetId === null) b.aggroTargetId = a.id;
    }
    if (
      a.kind === 'mob' &&
      a.ownerId === null &&
      !a.dead &&
      b.kind === 'player' &&
      a.aiState === 'idle'
    ) {
      this.aggroMob(a, b, false);
    }
  }

  private handleDeath(e: Entity, killer: Entity | null): void {
    // Body moved to combat/damage.ts (C1). The moved copy routes its quest-credit
    // call through ctx.onMobKilledForQuests (points-at quest_credit, Q1).
    handleDeathImpl(this.ctx, e, killer);
  }

  grantXp(amount: number, meta: PlayerMeta = this.primary, opts?: { fromKill?: boolean }): void {
    grantXpImpl(this.ctx, amount, meta, opts);
  }

  // Opt-in cosmetic prestige: only at the cap. Resets the level XP
  // bar, bumps the prestige rank for a badge by the name + on the leaderboard,
  // and deliberately leaves lifetimeXp, level, gear, talents, and learned
  // abilities untouched — strictly cosmetic, zero power change (FR-6.1/6.3).
  prestige(pid?: number): boolean {
    return prestigeImpl(this.ctx, pid);
  }

  // L1 loot distribution (party-loot strategy, rollLoot, copper split, need-greed
  // lifecycle, corpse-loot helpers) moved to loot/loot_roll.ts behind SimContext.
  // Sim keeps thin same-named delegates only where a foreign caller resolves them:
  //  - rollLoot: ctx.rollLoot (combat/damage.ts handleDeath) + (sim as any) test casts.
  //  - resolveLootRoll: the updateLootRolls tick driver (stays on Sim) calls it.
  //  - activeLootRolls/submitLootRoll: the public IWorld surface (HUD + player action).
  // The strategy resolvers + copper/need-greed internals had no external caller and
  // moved fully (no delegate). The corpse-loot helpers (distributeLootCopper/
  // awardSharedLootItem/lootSlotVisibleTo/pruneCorpseLoot) had their sole Sim caller
  // (lootCorpse) moved to interaction.ts (W3), which now imports them directly.
  private rollLoot(mob: Entity, meta: PlayerMeta, eligible: PlayerMeta[] = [meta]): void {
    rollLootImpl(this.ctx, mob, meta, eligible);
  }

  activeLootRolls(pid = this.playerId): LootRollPrompt[] {
    return activeLootRollsImpl(this.ctx, pid);
  }

  submitLootRoll(rollId: number, choice: LootRollChoice, pid?: number): void {
    submitLootRollImpl(this.ctx, rollId, choice, pid);
  }

  private resolveLootRoll(roll: PendingLootRoll): void {
    resolveLootRollImpl(this.ctx, roll);
  }

  assignMasterLoot(rollId: number, targetPids: number[], pid?: number): void {
    assignMasterLootImpl(this.ctx, rollId, targetPids, pid);
  }

  setPartyLootMaster(
    enabled: boolean,
    looter: number,
    threshold: MasterLootThreshold,
    pid?: number,
  ): void {
    setPartyLootMasterImpl(this.ctx, enabled, looter, threshold, pid);
  }

  // -------------------------------------------------------------------------
  // Mob AI
  // -------------------------------------------------------------------------

  private refreshMobLeashFromAction(source: Entity | null, target: Entity): void {
    if (
      !source ||
      source.id === target.id ||
      target.kind !== 'mob' ||
      target.ownerId !== null ||
      target.dead
    )
      return;
    if (source.kind !== 'player' && source.ownerId === null) return;
    target.leashAnchor = { ...target.pos };
  }

  // Target selection + threat switching live in mob/targeting.ts (M1). These thin
  // delegates keep every `this.retargetMob` / `this.updateMobTarget` / `this.isTrivialTo`
  // call site (and the ctx.retargetMob seam binding) resolving unchanged through the seam.
  private retargetMob(mob: Entity): void {
    retargetMobFn(this.ctx, mob);
  }

  // Nythraxis add-AI (findNythraxisBossForAdd + the fallback-target / despawn-if-reset
  // pair) moved to encounters/nythraxis.ts (N1). The mob-retarget block in
  // mob/targeting.ts reaches the pair through ctx.nythraxisAddFallbackTarget /
  // ctx.scheduleNythraxisAddDespawnIfBossReset (bound to the module in buildSimContext).

  // highestThreatTarget moved to mob/targeting.ts (M1); retargetMob/updateMobTarget
  // call it there. No Sim delegate: it had no caller outside those two methods.

  private updateMobTarget(mob: Entity): void {
    updateMobTargetFn(this.ctx, mob);
  }

  // Effective melee reach. Large creatures measure range from their centre, which
  // sits deep inside an oversized body — so a giant (e.g. Nythraxis at scale 3.1)
  // can never close to the flat MELEE_RANGE and barely swings. Scale reach with
  // size so big mobs connect from where the player actually stands (their feet).
  private mobMeleeRange(mob: Entity): number {
    return this.mobCombatProfile(mob).meleeRange;
  }

  private mobCombatProfile(mob: Entity): MobCombatProfile {
    return combatProfileForMob(mob.templateId, mob.scale);
  }

  private mobEffectiveMeleeRange(mob: Entity): number {
    const profile = this.mobCombatProfile(mob);
    const mobMoved = dist2d(mob.pos, mob.prevPos) > 0.05;
    return effectiveMobMeleeRange(profile, mobMoved);
  }

  private tryMobMeleeSwingInRange(mob: Entity, target: Entity): boolean {
    if (dist2d(mob.pos, target.pos) > this.mobEffectiveMeleeRange(mob)) return false;
    mob.aiState = 'attack';
    mob.facing = angleTo(mob.pos, target.pos);
    if (mob.swingTimer <= 0) {
      this.mobSwing(mob, target);
      mob.swingTimer = mob.weapon.speed * this.swingIntervalMult(mob);
    }
    return true;
  }

  private usesProfiledMobCombat(mob: Entity): boolean {
    const profile = this.mobCombatProfile(mob);
    return profile.swingWhilePursuing || profile.immediateSwingOnEnterRange || !profile.canLeash;
  }

  private updateProfiledMobCombat(mob: Entity): void {
    const profile = this.mobCombatProfile(mob);
    this.updateMobTarget(mob);
    const target = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
    if (!target || target.dead) {
      this.retargetMob(mob);
      return;
    }
    if (this.maybeFlee(mob, target)) return;

    if (profile.canLeash) {
      const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
      const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
      if (mob.fleeReturnTimer > 0) {
        mob.fleeReturnTimer = Math.max(0, mob.fleeReturnTimer - DT);
        if (dist2d(mob.pos, leashAnchor) <= leash - 1) mob.fleeReturnTimer = 0;
      }
      if (dist2d(mob.pos, leashAnchor) > leash && mob.fleeReturnTimer <= 0) {
        mob.aiState = 'evade';
        mob.aggroTargetId = null;
        clearThreat(mob);
        mob.leashAnchor = null;
        return;
      }
    }

    mob.swingTimer = Math.max(0, mob.swingTimer - DT);
    if (profile.swingWhilePursuing || mob.aiState === 'attack') {
      this.tryMobMeleeSwingInRange(mob, target);
    }

    if (dist2d(mob.pos, target.pos) > profile.desiredRange) {
      if (!isRooted(mob)) {
        this.moveToward(
          mob,
          target.pos,
          mob.moveSpeed * profile.chaseSpeedMult * this.moveSpeedMult(mob),
        );
      } else {
        mob.facing = angleTo(mob.pos, target.pos);
      }
    } else {
      mob.facing = angleTo(mob.pos, target.pos);
    }

    if (
      profile.immediateSwingOnEnterRange ||
      profile.swingWhilePursuing ||
      mob.aiState === 'attack'
    ) {
      this.tryMobMeleeSwingInRange(mob, target);
    }
    mob.aiState = dist2d(mob.pos, target.pos) <= profile.meleeRange ? 'attack' : 'chase';
  }

  aggroMob(mob: Entity, target: Entity, social: boolean): void {
    if (
      mob.dead ||
      mob.aiState === 'evade' ||
      mob.aiState === 'chase' ||
      mob.aiState === 'attack' ||
      mob.aiState === 'flee'
    )
      return;
    mob.aiState = 'chase';
    mob.aggroTargetId = target.id;
    mob.inCombat = true;
    mob.leashAnchor = { ...mob.pos };
    addThreat(mob, target.id, 1); // seed the hate table so taunts/heals have a baseline
    if (target.kind === 'player' && MOBS[mob.templateId]?.boss) {
      const run = this.delveRunForPlayer(target.id);
      if (run) this.maybeCompanionBark(run, target.id, 'boss_pull');
    }
    if (social) {
      const family = MOBS[mob.templateId]?.family;
      const pullRadius = (family && SOCIAL_PULL_RADIUS[family]) ?? DEFAULT_SOCIAL_PULL_RADIUS;
      this.grid.forEachInRadius(mob.pos.x, mob.pos.z, pullRadius, (m, d2) => {
        if (
          m.kind === 'mob' &&
          m.id !== mob.id &&
          !m.dead &&
          m.hostile &&
          m.aiState === 'idle' &&
          m.ownerId === null &&
          m.templateId === mob.templateId &&
          d2 < pullRadius * pullRadius
        ) {
          m.aiState = 'chase';
          m.aggroTargetId = target.id;
          m.inCombat = true;
          m.leashAnchor = { ...m.pos };
          addThreat(m, target.id, 1);
        }
      });
    }
  }

  private updateMob(mob: Entity): void {
    updateMobFn(this.ctx, mob);
  }

  // onBossDeath (the Nythraxis phase->dead + death dialogue) moved to
  // encounters/nythraxis.ts (N1). updateMob's dead-branch (mob/locomotion.ts) fires it
  // via ctx.onBossDeath for every dead mob (it draws no rng, so the unconditional call
  // preserves draw order); the arrow binding lives in buildSimContext.

  // resetEvadingMob moved to mob/locomotion.ts (M2). Sim keeps a thin delegate because
  // wipeNythraxisEncounter + 8 mob_* tests + the parity scenario call sim.resetEvadingMob.
  private resetEvadingMob(mob: Entity): void {
    resetEvadingMobFn(this.ctx, mob);
  }

  // Cowardly mobs panic once per pull at low HP: turn and run from the attacker
  // for a few seconds, rallying nearby same-family allies, then recover their nerve.
  // Returns true if the mob entered (or is already in) the flee state so the caller
  // can stop its turn.
  private canFlee(mob: Entity): boolean {
    if (mob.hasFled || mob.enraged) return false;
    const tmpl = MOBS[mob.templateId];
    if (!tmpl || tmpl.boss || tmpl.elite || tmpl.rare) return false;
    return FLEEING_FAMILIES.has(tmpl.family);
  }

  private maybeFlee(mob: Entity, _target: Entity): boolean {
    if (mob.maxHp <= 0 || mob.hp / mob.maxHp > FLEE_HP_THRESHOLD) return false;
    if (!this.canFlee(mob)) return false;
    mob.aiState = 'flee';
    mob.hasFled = true;
    mob.fleeTimer = FLEE_DURATION;
    this.emit({
      type: 'log',
      text: `${mob.name} attempts to flee!`,
      color: '#ffd966',
      entityId: mob.id,
    });
    // The rally is NOT seeded here at the panic spot. The fleer runs first and rallies
    // the first local same-family cluster it reaches, then turns back to fight with it;
    // that per-tick scan lives in the flee arm (mob/locomotion.ts -> mob/social_aggro.ts).
    return true;
  }

  mobSwing(mob: Entity, target: Entity): void {
    const missChance = swingMissChance(mob, target);
    const dodgeChance = target.kind === 'player' ? target.dodgeChance : 0.05;
    const roll = this.rng.next();
    if (roll < missChance) {
      this.emit({
        type: 'damage',
        sourceId: mob.id,
        targetId: target.id,
        amount: 0,
        crit: false,
        school: 'physical',
        ability: null,
        kind: 'miss',
      });
      return;
    }
    if (roll < missChance + dodgeChance) {
      this.emit({
        type: 'damage',
        sourceId: mob.id,
        targetId: target.id,
        amount: 0,
        crit: false,
        school: 'physical',
        ability: null,
        kind: 'dodge',
      });
      return;
    }
    let dmg =
      this.rng.range(mob.weapon.min, mob.weapon.max) +
      (this.effectiveAttackPower(mob) / 14) * mob.weapon.speed;
    const crit = this.rng.chance(0.05);
    if (crit) dmg *= 2;
    const enrage = MOBS[mob.templateId]?.enrage;
    if (mob.enraged && enrage) dmg *= enrage.dmgMult;
    const rawDmg = dmg; // pre-armor, post-crit/enrage — basis for cleave splash
    dmg *= 1 - armorReduction(this.effectiveArmor(target), mob.level);
    const dealt = Math.max(1, Math.round(dmg));
    this.dealDamage(mob, target, dealt, crit, 'physical', null, 'hit');
    runMobSwingAffixes(this.ctx, mob, target, { dealt, crit, rawDmg });
  }

  // Recompute a player victim's derived stats after the Devour Magic cascade in
  // mob_swing.ts strips a beneficial aura, so a stripped buff_armor/buff_ap/buff_int
  // actually un-folds. Routed through SimContext (ctx.recalcPlayer) so the extracted
  // module never reaches into the Sim players map directly.
  private recalcPlayer(target: Entity): void {
    const meta = this.players.get(target.id);
    if (meta) recalcPlayerStats(target, meta.cls, meta.equipment, meta.talentMods);
  }

  private updateRangedPetAttack(
    pet: Entity,
    target: Entity,
    spell: {
      name: string;
      school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
      min: number;
      max: number;
      range: number;
      every: number;
    },
  ): void {
    const d = dist2d(pet.pos, target.pos);
    if (d > spell.range) {
      if (!isRooted(pet)) this.moveToward(pet, target.pos, pet.moveSpeed * this.moveSpeedMult(pet));
      pet.swingTimer = Math.max(0, pet.swingTimer - DT);
      return;
    }
    pet.facing = angleTo(pet.pos, target.pos);
    pet.swingTimer -= DT;
    if (pet.swingTimer > 0) return;
    this.emit({
      type: 'spellfx',
      sourceId: pet.id,
      targetId: target.id,
      school: spell.school,
      fx: 'projectile',
    });
    // Pet spells are resisted, not missed (same semantics as player casts).
    if (isSpellResisted(this.rng, pet.level, target.level)) {
      this.emit({
        type: 'damage',
        sourceId: pet.id,
        targetId: target.id,
        amount: 0,
        crit: false,
        school: spell.school,
        ability: spell.name,
        kind: 'resist',
      });
      this.enterCombat(pet, target);
    } else {
      const dmg = Math.round(
        this.rng.range(spell.min + pet.level * 0.8, spell.max + pet.level * 1.1),
      );
      this.dealDamage(pet, target, Math.max(1, dmg), false, spell.school, spell.name, 'hit');
    }
    pet.swingTimer = spell.every;
  }

  // Step `e` one tick toward `dest`. With `ignoreObstacles`, the mover phases
  // straight through props — used to free a stuck evader, never for normal
  // locomotion. Returns true on arrival.
  private moveToward(e: Entity, dest: Vec3, speed: number, ignoreObstacles = false): boolean {
    const d = dist2d(e.pos, dest);
    if (d < 0.3) return true;
    const desired = angleTo(e.pos, dest);
    e.facing = desired;
    const step = Math.min(speed * DT, d);
    const canSwim = this.mobCanSwim(MOBS[e.templateId]);

    if (ignoreObstacles) {
      const nx = e.pos.x + Math.sin(desired) * step;
      const nz = e.pos.z + Math.cos(desired) * step;
      e.pos.x = nx;
      e.pos.z = nz;
      const g = groundHeight(nx, nz, this.cfg.seed);
      e.pos.y = Math.max(g, SWIM_SURFACE_Y); // ride the surface while phasing, don't sink under terrain/water
      return d - step < 0.3;
    }
    // Mobs have no nav mesh. Try the straight path first; only if a prop or the
    // waterline eats it do we fan the heading out and take the best slide AROUND
    // the obstacle. That lets a mob round the camp props to reach its target
    // instead of pinning on them. Open-ground movers take the first branch.
    let bestX = e.pos.x,
      bestZ = e.pos.z,
      bestProgress = 1e-3;
    for (const off of MOVE_SLIDE_FAN) {
      const a = desired + off;
      const nx = e.pos.x + Math.sin(a) * step;
      const nz = e.pos.z + Math.cos(a) * step;
      // landlocked creatures stop at the waterline instead of walking under it
      if (!canSwim && groundHeight(nx, nz, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH) continue;
      const r = this.resolveMovePoint(nx, nz, BODY_RADIUS, e);
      const progress = d - Math.hypot(r.x - dest.x, r.z - dest.z);
      if (progress > bestProgress) {
        bestProgress = progress;
        bestX = r.x;
        bestZ = r.z;
      }
      if (off === 0 && progress >= step - 1e-3) break; // straight path is clear
    }
    e.pos.x = bestX;
    e.pos.z = bestZ;
    const g = groundHeight(bestX, bestZ, this.cfg.seed);
    e.pos.y = canSwim && g < WATER_LEVEL - SWIM_DEPTH ? SWIM_SURFACE_Y : g;
    return dist2d(e.pos, dest) < 0.3;
  }

  // blockedTowardSpawn moved to mob/locomotion.ts (M2; called only by the evade arm).

  // respawnMob / despawnSummonedAdds / frenzyPackmates / armDeathThroes /
  // detonateCorpse moved to mob/lifecycle.ts (M4). The five execution bodies are
  // reached through SimContext: handleDeath fires ctx.frenzyPackmates +
  // ctx.armDeathThroes; the updateMob corpse-tick (mob/locomotion.ts) fires
  // ctx.detonateCorpse + ctx.respawnMob; resetEvadingMob fires
  // ctx.despawnSummonedAdds. despawnPersistentPet + clearNonPlayerStatAuras stay
  // Sim methods, now also exposed on the seam for the moved respawnMob to consume.

  // Boss threshold mechanics: add waves (summonAdds) and enrage. Checked
  // every tick while the boss is in combat; thresholds fire once per pull
  // and reset on evade/respawn.
  private updateBossMechanics(mob: Entity): void {
    const tmpl = MOBS[mob.templateId];
    if (
      !tmpl ||
      (!tmpl.summonAdds &&
        !tmpl.enrage &&
        !tmpl.desperateHeal &&
        !tmpl.mendAlly &&
        !tmpl.wardAllies &&
        !tmpl.rally &&
        !tmpl.warcry)
    )
      return;
    const hpFrac = mob.hp / Math.max(1, mob.maxHp);
    if (tmpl.summonAdds) {
      const thresholds = tmpl.summonAdds.atHpPct;
      while (mob.firedSummons < thresholds.length && hpFrac <= thresholds[mob.firedSummons]) {
        mob.firedSummons++;
        const run = this.delveRunForMob(mob.id);
        if (
          run &&
          this.findDelveObject(run, 'cracked_grave') &&
          this.startDelveRaiseDeadChannel(run, mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count)
        )
          continue;
        this.spawnBossAdds(mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count);
      }
    }
    // Delve bosses enrage on Heroic only (PRD delves.md §7.4: "Heroic: optional
    // enrage below 20% HP"). World bosses have no delve run, so they enrage as
    // before. Only resolved for enrage-capable templates, so the lookup is rare.
    const enrageRun = tmpl.enrage ? this.delveRunForMob(mob.id) : null;
    const enrageAllowed = !enrageRun || enrageRun.tierId === 'heroic';
    if (tmpl.enrage && enrageAllowed && !mob.enraged && hpFrac <= tmpl.enrage.belowHpPct) {
      mob.enraged = true;
      this.emit({ type: 'aura', targetId: mob.id, name: 'Enrage', gained: true });
      this.emit({
        type: 'log',
        text: `${mob.name} becomes enraged!`,
        color: '#ff6666',
        entityId: mob.id,
      });
      this.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: 'fire',
        fx: 'nova',
      });
    }
    if (tmpl.desperateHeal && !mob.healedThisPull && hpFrac <= tmpl.desperateHeal.belowHpPct) {
      mob.healedThisPull = true;
      const heal = Math.min(mob.maxHp - mob.hp, Math.round(mob.maxHp * tmpl.desperateHeal.healPct));
      if (heal > 0) {
        mob.hp += heal;
        this.emit({ type: 'heal', targetId: mob.id, amount: heal });
        this.emit({
          type: 'log',
          text: `${mob.name} draws on a desperate second wind!`,
          color: '#66ff99',
          entityId: mob.id,
        });
        this.emit({
          type: 'spellfx',
          sourceId: mob.id,
          targetId: mob.id,
          school: 'nature',
          fx: 'nova',
        });
      }
    }
    // Support "Mend": periodically heal every wounded friendly mob in range
    // (including the caster). Telegraphed via createMob seeding mendTimer to a
    // full interval, so the first cast never lands the instant combat opens.
    if (tmpl.mendAlly) {
      mob.mendTimer -= DT;
      if (mob.mendTimer <= 0) {
        mob.mendTimer = tmpl.mendAlly.every;
        const wounded: Entity[] = [];
        for (const ally of this.entities.values()) {
          if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
          if (ally.hostile !== mob.hostile || ally.hp >= ally.maxHp) continue; // only wounded same-faction mobs
          if (dist2d(ally.pos, mob.pos) > tmpl.mendAlly.radius) continue;
          wounded.push(ally);
        }
        if (wounded.length > 0) {
          const school = tmpl.mendAlly.school ?? 'nature';
          this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
          this.emit({
            type: 'log',
            text: `${mob.name} channels ${tmpl.mendAlly.name}.`,
            color: '#66ff99',
            entityId: mob.id,
          });
          for (const ally of wounded) {
            const amount = Math.round(this.rng.range(tmpl.mendAlly.healMin, tmpl.mendAlly.healMax));
            this.applyHeal(mob, ally, amount, tmpl.mendAlly.name);
          }
        }
      }
    }
    // Support "Ward": the defensive twin of Mend. Periodically wrap every living
    // friendly mob in range (including the caster) in an absorb shield. Unlike
    // Mend it targets healthy allies too — a barrier pre-empts the next blows.
    // Refreshes each interval, replacing any partially-soaked ward (same aura id).
    if (tmpl.wardAllies) {
      mob.wardTimer -= DT;
      if (mob.wardTimer <= 0) {
        mob.wardTimer = tmpl.wardAllies.every;
        const allies: Entity[] = [];
        for (const ally of this.entities.values()) {
          if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
          if (ally.hostile !== mob.hostile) continue; // same-faction mobs only
          if (dist2d(ally.pos, mob.pos) > tmpl.wardAllies.radius) continue;
          allies.push(ally);
        }
        if (allies.length > 0) {
          const school = tmpl.wardAllies.school ?? 'holy';
          this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
          this.emit({
            type: 'log',
            text: `${mob.name} channels ${tmpl.wardAllies.name}.`,
            color: '#aad4ff',
            entityId: mob.id,
          });
          for (const ally of allies) {
            this.applyAura(ally, {
              id: `ward_${mob.templateId}`,
              name: tmpl.wardAllies.name,
              kind: 'absorb',
              remaining: tmpl.wardAllies.duration,
              duration: tmpl.wardAllies.duration,
              value: tmpl.wardAllies.amount,
              sourceId: mob.id,
              school,
            });
          }
        }
      }
    }

    // Commander "Rally": periodically empower every friendly mob in range
    // (including the caster) with a refreshing attack-power buff. The offensive
    // twin of mendAlly — same telegraphed timer, same same-faction ally scan —
    // but it grants buff_ap (folded by effectiveAttackPower) instead of healing.
    if (tmpl.rally) {
      mob.rallyTimer -= DT;
      if (mob.rallyTimer <= 0) {
        mob.rallyTimer = tmpl.rally.every;
        const allies: Entity[] = [];
        for (const ally of this.entities.values()) {
          if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
          if (ally.hostile !== mob.hostile) continue; // only same-faction mobs
          if (dist2d(ally.pos, mob.pos) > tmpl.rally.radius) continue;
          allies.push(ally);
        }
        if (allies.length > 0) {
          const school = tmpl.rally.school ?? 'physical';
          this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
          this.emit({
            type: 'log',
            text: `${mob.name} unleashes ${tmpl.rally.name}!`,
            color: '#ffcc33',
            entityId: mob.id,
          });
          for (const ally of allies) {
            this.applyAura(ally, {
              id: `rally_${mob.templateId}`,
              name: tmpl.rally.name,
              kind: 'buff_ap',
              remaining: tmpl.rally.duration,
              duration: tmpl.rally.duration,
              value: tmpl.rally.ap,
              sourceId: mob.id,
              school,
            });
          }
        }
      }
    }
    // Support "War Cadence": periodically quicken every nearby friendly mob's
    // swings (including the caster) by re-applying a refreshing buff_haste aura.
    // Same telegraph as Mend; rides swingIntervalMult's existing buff_haste fold.
    if (tmpl.warcry) {
      mob.warcryTimer -= DT;
      if (mob.warcryTimer <= 0) {
        mob.warcryTimer = tmpl.warcry.every;
        const allies: Entity[] = [];
        for (const ally of this.entities.values()) {
          if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
          if (ally.hostile !== mob.hostile) continue; // same-faction only
          if (dist2d(ally.pos, mob.pos) > tmpl.warcry.radius) continue;
          allies.push(ally);
        }
        if (allies.length > 0) {
          const school = tmpl.warcry.school ?? 'physical';
          const auraId = `warcry_${mob.templateId}`;
          this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
          this.emit({
            type: 'log',
            text: `${mob.name} channels ${tmpl.warcry.name}.`,
            color: '#ffd27f',
            entityId: mob.id,
          });
          for (const ally of allies) {
            const existing = ally.auras.find((a) => a.id === auraId);
            if (existing) {
              existing.remaining = tmpl.warcry.duration; // refresh on each pulse; never stack
              continue;
            }
            ally.auras.push({
              id: auraId,
              name: tmpl.warcry.name,
              kind: 'buff_haste',
              remaining: tmpl.warcry.duration,
              duration: tmpl.warcry.duration,
              value: tmpl.warcry.hasteMult,
              sourceId: mob.id,
              school,
            });
            this.emit({ type: 'aura', targetId: ally.id, name: tmpl.warcry.name, gained: true });
          }
        }
      }
    }
  }

  // The Nythraxis encounter core (init/reset/wipe/update, dialogue + yell scheduling,
  // room/participant queries, lockout grant, Gravebreaker/Raise Fallen/adds, the Aldric
  // transition + wardstones, Soul Rend, Deathless Rage + ward channels) moved to
  // encounters/nythraxis.ts (N1). updateNythraxisEncounter + grantNythraxisLockout are
  // reached only via ctx (bound to the module in buildSimContext). Sim keeps one thin
  // delegate: resetNythraxisEncounter (reached by resetEvadingMob's boss-reset re-entry,
  // respawnMob, and nythraxis_aldric_npc.test.ts via cast). tryStartNythraxisWardChannel
  // moved with its sole callers (lootCorpse/pickUpObject/interact) to interaction.ts (W3),
  // which imports it directly from encounters/nythraxis.ts.
  private resetNythraxisEncounter(boss: Entity): void {
    nythraxis.resetNythraxisEncounter(this.ctx, boss);
  }

  private spawnBossAdds(boss: Entity, mobId: string, count: number): void {
    const template = MOBS[mobId];
    if (!template) return;
    this.emit({
      type: 'log',
      text: `${boss.name} calls for aid!`,
      color: '#ff6666',
      entityId: boss.id,
    });
    this.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
    });
    // adds spawned inside a claimed instance despawn with it
    const delveRun = this.delveRunForMob(boss.id);
    const inst = this.instances.find((i) => {
      if (i.partyKey === null) return false;
      const o = this.instanceOriginOf(i);
      return Math.abs(boss.pos.x - o.x) < 120 && Math.abs(boss.pos.z - o.z) < 250;
    });
    const [topThreatId] = threatEntries(boss, 1)[0] ?? [];
    const victimId = boss.aggroTargetId ?? topThreatId ?? null;
    const victim = victimId !== null ? this.entities.get(victimId) : null;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + 0.7;
      const pos = this.groundPos(
        boss.pos.x + Math.sin(ang) * 3.5,
        boss.pos.z + Math.cos(ang) * 3.5,
      );
      const level = this.rng.int(template.minLevel, template.maxLevel);
      const add = createMob(this.nextId++, template, level, pos);
      add.spawnPos = { ...boss.spawnPos }; // leashes with the boss; stays dead in instances
      add.tappedById = boss.tappedById;
      this.addEntity(add);
      boss.summonedIds.push(add.id);
      inst?.mobIds.push(add.id);
      delveRun?.mobIds.push(add.id);
      if (victim && !victim.dead && victim.kind === 'player') {
        add.aggroTargetId = victim.id;
        add.inCombat = true;
        add.aiState = dist2d(add.pos, victim.pos) > this.mobMeleeRange(add) ? 'chase' : 'attack';
        addThreat(add, victim.id, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Targeting
  // -------------------------------------------------------------------------

  // Target selection moved to src/sim/targeting.ts (T1); Sim keeps thin same-named
  // delegates so IWorld + the foreign main/hud/server/obs/interactions call sites
  // (and the internal assist command) resolve unchanged. enemyCandidates /
  // isEnemyTargetCandidate / friendlyCandidates are now module-private (no caller
  // outside the slice).
  targetEntity(id: number | null, pid?: number): void {
    this.targeting.targetEntity(id, pid);
  }

  tabTarget(pid?: number): void {
    this.targeting.tabTarget(pid);
  }

  targetNearestEnemy(pid?: number): void {
    this.targeting.targetNearestEnemy(pid);
  }

  targetNearestFriendly(pid?: number): void {
    this.targeting.targetNearestFriendly(pid);
  }

  friendlyTabTarget(pid?: number): void {
    this.targeting.friendlyTabTarget(pid);
  }

  // -------------------------------------------------------------------------
  // Inventory, items, vendor
  // -------------------------------------------------------------------------

  countItem(itemId: string, pid?: number): number {
    const r = this.resolve(pid);
    if (!r) return 0;
    let n = 0;
    for (const s of r.meta.inventory) if (s.itemId === itemId) n += s.count;
    return n;
  }

  addItem(itemId: string, count: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    const def = ITEMS[itemId];
    const existing = meta.inventory.find((s) => s.itemId === itemId);
    if (existing) existing.count += count;
    else meta.inventory.push({ itemId, count });
    this.emit({
      type: 'loot',
      // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
      text: `You receive: ${def?.name ?? itemId}${count > 1 ? ' x' + count : ''}.`,
      pid: meta.entityId,
    });
    this.ctx.onInventoryChangedForQuests(meta);
    if (meta.autoEquip && (def?.kind === 'weapon' || def?.kind === 'armor')) {
      this.maybeAutoEquip(itemId, meta);
    }
  }

  removeItem(itemId: string, count: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
      const s = meta.inventory[i];
      if (s.itemId !== itemId) continue;
      const take = Math.min(s.count, count);
      s.count -= take;
      count -= take;
      if (s.count <= 0) meta.inventory.splice(i, 1);
    }
    this.ctx.onInventoryChangedForQuests(meta);
  }

  discardItem(itemId: string, count = 1, pid?: number): void {
    items.discardItem(this.ctx, itemId, count, pid);
  }

  equipItem(itemId: string, pid?: number): void {
    items.equipItem(this.ctx, itemId, pid);
  }

  unequipItem(slot: EquipSlot, pid?: number): boolean {
    return items.unequipItem(this.ctx, slot, pid);
  }

  private hasFishableWaterAhead(p: Entity): boolean {
    const sin = Math.sin(p.facing);
    const cos = Math.cos(p.facing);
    return FISHING_SAMPLE_DISTANCES.some(
      (d) =>
        groundHeight(p.pos.x + sin * d, p.pos.z + cos * d, this.cfg.seed) <
        WATER_LEVEL - SWIM_DEPTH,
    );
  }

  private isAtDeepfenShallowsFishingSpot(p: Entity): boolean {
    const d = Math.hypot(p.pos.x - DEEPFEN_SHALLOWS_LAKE.x, p.pos.z - DEEPFEN_SHALLOWS_LAKE.z);
    return d <= DEEPFEN_SHALLOWS_LAKE.radius + DEEPFEN_FISHING_SHORE_MARGIN;
  }

  private shouldCatchCodfather(p: Entity, meta: PlayerMeta): boolean {
    const qp = meta.questLog.get(THE_CODFATHER_QUEST_ID);
    return (
      qp?.state === 'active' &&
      this.countItem(THE_CODFATHER_ITEM_ID, meta.entityId) === 0 &&
      this.isAtDeepfenShallowsFishingSpot(p)
    );
  }

  private startFishing(p: Entity, meta: PlayerMeta): void {
    if (p.dead) {
      this.error(meta.entityId, "You can't do that while dead.");
      return;
    }
    if (p.inCombat) {
      this.error(meta.entityId, "You can't do that while in combat.");
      return;
    }
    if (this.isSwimming(p)) {
      this.error(meta.entityId, "You can't do that while swimming.");
      return;
    }
    if (p.castingAbility || isConsuming(p)) {
      this.error(meta.entityId, 'You are busy.');
      return;
    }
    if (!this.hasFishableWaterAhead(p)) {
      this.error(meta.entityId, 'You need to face fishable water.');
      return;
    }
    if (p.sitting) this.standUp(p);
    p.castingAbility = FISHING_CAST_ID;
    p.castTotal = FISHING_CAST_TIME;
    p.castRemaining = FISHING_CAST_TIME;
    p.channeling = false;
    this.emit({
      type: 'castStart',
      entityId: p.id,
      ability: FISHING_CAST_ID,
      time: FISHING_CAST_TIME,
    });
  }

  private completeFishing(p: Entity, meta: PlayerMeta): void {
    if (this.shouldCatchCodfather(p, meta)) {
      this.addItem(THE_CODFATHER_ITEM_ID, 1, meta.entityId);
      return;
    }
    // The catch depends on which zone's water you're fishing — each has its own
    // weighted table (src/sim/content/items.ts). Fall back to the Vale table for
    // any spot without its own (e.g. fishable water inside a dungeon zone).
    const table = FISHING_TABLES[zoneAt(p.pos.z).id] ?? FISHING_TABLES.eastbrook_vale;
    const total = table.reduce((sum, e) => sum + e.weight, 0);
    let roll = this.rng.next() * total;
    let caught: string | null = null;
    for (const entry of table) {
      roll -= entry.weight;
      if (roll < 0) {
        caught = entry.itemId;
        break;
      }
    }
    if (caught === null) {
      this.emit({ type: 'log', text: 'No fish are biting.', color: '#999', pid: p.id });
      return;
    }
    if (caught === FISHING_RARE_ID) {
      this.emit({
        type: 'log',
        text: 'A rare catch! Something gleams on your line.',
        color: '#1eff00',
        pid: p.id,
      });
    }
    this.addItem(caught, 1, meta.entityId);
  }

  useItem(itemId: string, pid?: number): ItemUseResult | undefined {
    return items.useItem(this.ctx, itemId, pid);
  }

  buyItem(npcId: number, itemId: string, pid?: number): void {
    items.buyItem(this.ctx, npcId, itemId, pid);
  }

  sellItem(itemId: string, count = 1, pid?: number): void {
    items.sellItem(this.ctx, itemId, count, pid);
  }

  sellAllJunk(pid?: number): void {
    items.sellAllJunk(this.ctx, pid);
  }

  buyBackItem(itemId: string, pid?: number): void {
    items.buyBackItem(this.ctx, itemId, pid);
  }

  private maybeAutoEquip(itemId: string, meta: PlayerMeta): void {
    const def = ITEMS[itemId];
    if (!def?.slot) return;
    if (!canEquipItem(meta.cls, def)) return;
    // Skip silently (no error toast) if the piece is gated above the player's
    // level: auto-equip is a convenience, the explicit equip path is where the
    // "must be level N" message belongs.
    const e = this.entities.get(meta.entityId);
    if (e && !meetsLevelRequirement(e.level, def)) return;
    if (def.kind === 'weapon') {
      const cur = meta.equipment.mainhand ? ITEMS[meta.equipment.mainhand]?.weapon : null;
      const next = def.weapon;
      if (next && (!cur || next.min + next.max > cur.min + cur.max))
        this.equipItem(itemId, meta.entityId);
    } else {
      const cur = meta.equipment[def.slot] ? ITEMS[meta.equipment[def.slot]!] : null;
      if (!cur || (def.stats?.armor ?? 0) > (cur.stats?.armor ?? 0))
        this.equipItem(itemId, meta.entityId);
    }
  }

  // -------------------------------------------------------------------------
  // Interaction: looting, quest NPCs, ground objects
  // -------------------------------------------------------------------------

  // lootCorpse / pickUpObject / interact (the three IWorldInteraction members) moved
  // to interaction.ts (W3) behind SimContext. Sim keeps thin same-named PUBLIC delegates
  // (the widened `pid?` overload preserved) so the IWorld surface, server/game.ts, and
  // tests resolve them on the Sim facade unchanged; each forwards via this.ctx. The
  // quest-NPC dispatch they fan into (talkToNpc / isQuestInteractionEntity below) STAYS
  // on Sim (W4) and is reached through two append-only SimContext callbacks.
  lootCorpse(mobId: number, pid?: number): void {
    interaction.lootCorpse(this.ctx, mobId, pid);
  }

  pickUpObject(objId: number, pid?: number): void {
    interaction.pickUpObject(this.ctx, objId, pid);
  }

  interact(pid?: number): void {
    interaction.interact(this.ctx, pid);
  }

  private isQuestInteractionEntity(e: Entity): boolean {
    if (e.kind === 'npc') return true;
    return e.kind === 'mob' && !e.hostile && !e.dead && e.questIds.length > 0;
  }

  talkToNpc(npcId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    const npc = this.entities.get(npcId);
    if (!npc || !this.isQuestInteractionEntity(npc)) return;
    if (this.interactNpcForQuests(npc, meta)) return;
    for (const qid of npc.questIds) {
      const quest = QUESTS[qid];
      if (
        quest &&
        isQuestTurnInNpc(quest, npc.templateId) &&
        meta.questLog.get(qid)?.state === 'ready'
      ) {
        this.turnInQuest(qid, meta.entityId);
        return;
      }
    }
    for (const qid of npc.questIds) {
      if (
        QUESTS[qid].giverNpcId === npc.templateId &&
        this.questState(qid, meta.entityId) === 'available'
      ) {
        this.acceptQuest(qid, meta.entityId);
        return;
      }
    }
  }

  private interactNpcForQuests(npc: Entity, meta: PlayerMeta): boolean {
    let progressed = false;
    for (const qp of meta.questLog.values()) {
      if (qp.state !== 'active') continue;
      const quest = QUESTS[qp.questId];
      quest.objectives.forEach((objective, objectiveIndex) => {
        if (objective.type !== 'interact' || objective.targetNpcId !== npc.templateId) return;
        if (qp.counts[objectiveIndex] >= objective.count) return;
        qp.counts[objectiveIndex]++;
        progressed = true;
        meta.counters.questProgress++;
        this.emit({
          type: 'questProgress',
          questId: qp.questId,
          text: `${objective.label}: ${qp.counts[objectiveIndex]}/${objective.count}`,
          pid: meta.entityId,
        });
        this.ctx.checkQuestReady(qp, meta);
      });
    }
    return progressed;
  }

  // -------------------------------------------------------------------------
  // Quests
  // -------------------------------------------------------------------------

  // The quest command surface (questState + acceptQuest/acceptLinkedQuest/abandonQuest/
  // turnInQuest, plus the private helpers questNpcFor/finalizeQuestAccept and the pure
  // computeQuestState) moved to quests/quest_commands.ts (W4) behind SimContext. Sim
  // keeps these thin same-named PUBLIC delegates (the widened `pid?` overload preserved)
  // so the IWorld surface, server/game.ts, and the in-file interaction path (talkToNpc
  // above) resolve them on the Sim facade unchanged; each forwards via this.ctx. The
  // moved questNpcFor reaches the still-on-Sim isQuestInteractionEntity predicate via the
  // ctx.isQuestInteractionEntity callback.
  questState(questId: string, pid?: number): QuestState {
    return questCommands.questState(this.ctx, questId, pid);
  }

  acceptQuest(questId: string, pid?: number): void {
    questCommands.acceptQuest(this.ctx, questId, pid);
  }

  acceptLinkedQuest(questId: string, sharerPid: number, pid?: number): void {
    questCommands.acceptLinkedQuest(this.ctx, questId, sharerPid, pid);
  }

  abandonQuest(questId: string, pid?: number): void {
    questCommands.abandonQuest(this.ctx, questId, pid);
  }

  turnInQuest(questId: string, pid?: number): void {
    questCommands.turnInQuest(this.ctx, questId, pid);
  }

  completeQuestForDev(questId: string, pid?: number): boolean {
    return completeQuestForDev(this.ctx, questId, pid);
  }

  completeCurrentQuestsForDev(pid?: number): number {
    return completeCurrentQuestsForDev(this.ctx, pid);
  }

  // No-op in offline mode
  reportTelemetry(): void {}

  // Quest-credit math (onMobKilledForQuests / onInventoryChangedForQuests /
  // checkQuestReady) moved to quests/quest_credit.ts (Q1) behind SimContext. Foreign
  // callers reach the trio via this.ctx.<name>: the handleDeath party loop calls
  // ctx.onMobKilledForQuests, the inventory hub (addItem/removeItem/buyBackItem) and
  // finalizeQuestAccept call ctx.onInventoryChangedForQuests, and interactNpcForQuests
  // plus the N1 crypt interactObjectForQuests call ctx.checkQuestReady.

  // -------------------------------------------------------------------------
  // Player death / respawn
  // -------------------------------------------------------------------------

  // Player death/respawn lives in entity_roster.ts (E1, merged E2). Thin delegate
  // keeps the public IWorld surface (`sim.releaseSpirit`) resolving unchanged.
  releaseSpirit(pid?: number): void {
    releasePlayerSpirit(this.ctx, pid);
  }

  // chatAllowed / handleDevChat / whisperMessageForName / resolveWhisperTarget
  // moved to social/chat.ts (G2). The chat() router below dispatches to them via
  // chatMod.*(this.ctx, ...); they had no callers outside chat().

  chat(text: string, pid?: number): SentChat | null {
    return chatMod.chat(this.ctx, text, pid);
  }

  // PUBLIC (IWorld + server) overhead-emote entry; body moved to social/chat.ts (G2).
  playEmote(emoteId: OverheadEmoteId, pid?: number): void {
    chatMod.playEmote(this.ctx, emoteId, pid);
  }

  // findPlayerByName / broadcastEmote moved to social/chat.ts (G2); chat() reaches
  // them via chatMod.*(this.ctx, ...). They had no callers outside chat().

  // -------------------------------------------------------------------------
  // Hostility: mobs are hostile to players; controlled pets inherit their
  // owner's PvP hostility during active duels and arena matches.
  // -------------------------------------------------------------------------

  private pvpController(e: Entity | null): Entity | null {
    if (!e) return null;
    if (e.kind === 'player') return e;
    if (e.kind === 'mob' && e.ownerId !== null) {
      const owner = this.entities.get(e.ownerId);
      return owner?.kind === 'player' ? owner : null;
    }
    return null;
  }

  isHostileTo(attacker: Entity, target: Entity): boolean {
    if (target.kind === 'mob') {
      if (target.templateId.startsWith('vision_')) return false;
      if (target.ownerId !== null) {
        const owner = this.entities.get(target.ownerId);
        return !!owner && owner.kind === 'player' && this.isHostileTo(attacker, owner);
      }
      return target.hostile;
    }
    if (target.kind === 'player') {
      const attackerPlayer = this.pvpController(attacker);
      if (!attackerPlayer) return false;
      if (attackerPlayer.dead) return false;
      if (attackerPlayer.id === target.id) return false;
      const duel = this.duels.get(attackerPlayer.id);
      if (
        duel &&
        duel.state === 'active' &&
        ((duel.a === attackerPlayer.id && duel.b === target.id) ||
          (duel.b === attackerPlayer.id && duel.a === target.id))
      )
        return true;
      const match = this.arenaMatches.get(attackerPlayer.id);
      return (
        !!match &&
        match.state === 'active' &&
        !match.defeated.has(attackerPlayer.id) &&
        this.isArenaCrossTeam(match, attackerPlayer.id, target.id)
      );
    }
    return false;
  }

  private isFriendlyTo(caster: Entity, target: Entity): boolean {
    if (target.kind === 'player') return !this.isHostileTo(caster, target);
    if (target.kind === 'mob' && target.ownerId !== null) {
      const owner = this.entities.get(target.ownerId);
      return !!owner && owner.kind === 'player' && !this.isHostileTo(caster, owner);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Parties
  // -------------------------------------------------------------------------

  // A1: the party/raid state machine lives in src/sim/social/party.ts. partyOf + the
  // eight command methods stay as thin delegates so IWorld + the many foreign
  // `this.partyOf` call sites (loot/xp/tap/quest/arena/dungeon/UI) resolve unchanged;
  // hasPendingSocialInvite stays reachable for the trade/duel invite path still on Sim;
  // partyCapacity moved to the SimContext seam (W5), reached by the moved partyReadout.
  partyOf(pid: number): Party | null {
    return this.party.partyOf(pid);
  }

  private hasPendingSocialInvite(targetPid: number): boolean {
    return this.party.hasPendingSocialInvite(targetPid);
  }

  private entityInDungeon(e: Entity, dungeonId: string): boolean {
    return dungeonAt(e.pos.x)?.id === dungeonId;
  }

  partyInvite(targetPid: number, pid?: number): void {
    this.party.partyInvite(targetPid, pid);
  }

  partyAccept(pid?: number): void {
    this.party.partyAccept(pid);
  }

  partyDecline(pid?: number): void {
    this.party.partyDecline(pid);
  }

  partyLeave(pid?: number): void {
    this.party.partyLeave(pid);
  }

  partyKick(targetPid: number, pid?: number): void {
    this.party.partyKick(targetPid, pid);
  }

  partyPromote(targetPid: number, pid?: number): void {
    this.party.partyPromote(targetPid, pid);
  }

  convertPartyToRaid(pid?: number): void {
    this.party.convertPartyToRaid(pid);
  }

  convertRaidToParty(pid?: number): void {
    this.party.convertRaidToParty(pid);
  }

  moveRaidMember(targetPid: number, group: 1 | 2, pid?: number): void {
    this.party.moveRaidMember(targetPid, group, pid);
  }
  // nextRaidGroupFor / normalizeRaidGroups / removeFromParty moved to the
  // PartyMachine (src/sim/social/party.ts, A1). removeFromParty is reachable by
  // removePlayer through `this.ctx.removeFromParty` (the SimContext seam).

  // -------------------------------------------------------------------------
  // Raid markers (party-scoped target markers)
  // -------------------------------------------------------------------------

  // The raid-marker store + methods moved to src/sim/targeting.ts (T1); Sim keeps thin
  // same-named delegates so the foreign hud/renderer/server call sites resolve.
  // clearEntityMarker is no longer on Sim: the death/despawn hooks reach it through
  // this.ctx.clearEntityMarker, and the A1 disband path through this.ctx.dropPartyMarkers.
  markersFor(pid: number): Record<number, number> {
    return this.targeting.markersFor(pid);
  }

  setMarker(entityId: number, markerId: number, pid?: number): void {
    this.targeting.setMarker(entityId, markerId, pid);
  }

  clearMarker(entityId: number, pid?: number): void {
    this.targeting.clearMarker(entityId, pid);
  }

  markerFor(entityId: number): number | null {
    return this.targeting.markerFor(entityId);
  }

  // -------------------------------------------------------------------------
  // Duels
  // -------------------------------------------------------------------------

  duelRequest(targetPid: number, pid?: number): void {
    duelMod.duelRequest(this.ctx, targetPid, pid);
  }

  duelAccept(pid?: number): void {
    duelMod.duelAccept(this.ctx, pid);
  }

  duelDecline(pid?: number): void {
    duelMod.duelDecline(this.ctx, pid);
  }

  // Persistent social systems (friends / ignore / guilds) require an account
  // and database, so they only exist in online play. The offline Sim satisfies
  // the IWorld surface with inert stubs.
  realm = '';
  socialInfo: null = null;
  friendAdd(_name: string): void {}
  friendRemove(_name: string): void {}
  blockAdd(_name: string): void {}
  blockRemove(_name: string): void {}
  guildCreate(_name: string): void {}
  guildInvite(_name: string): void {}
  guildAccept(): void {}
  guildDecline(): void {}
  guildLeave(): void {}
  guildKick(_name: string): void {}
  guildPromote(_name: string): void {}
  guildDemote(_name: string): void {}
  guildTransfer(_name: string): void {}
  guildDisband(): void {}
  searchCharacters(_query: string): Promise<import('../world_api').CharacterSearchResult[]> {
    return Promise.resolve([]);
  }

  private updateDuels(): void {
    duelMod.updateDuels(this.ctx);
  }

  private clearAurasFromSource(target: Entity, sourceId: number): void {
    let statsDirty = false;
    for (let i = target.auras.length - 1; i >= 0; i--) {
      const a = target.auras[i];
      if (a.sourceId !== sourceId) continue;
      target.auras.splice(i, 1);
      this.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
      if (a.kind.startsWith('buff') || a.kind.startsWith('form')) statsDirty = true;
    }
    if (statsDirty && target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment, this.playerMods(meta));
    }
  }

  // winnerPid null = draw/cancelled
  private endDuel(duel: DuelState, winnerPid: number | null): void {
    duelMod.endDuel(this.ctx, duel, winnerPid);
  }

  duelFor(pid: number): DuelState | null {
    return duelMod.duelFor(this.ctx, pid);
  }

  // -------------------------------------------------------------------------
  // The Ashen Coliseum — ranked arena (1v1 + 2v2 queue, matchmaking, Elo)
  // -------------------------------------------------------------------------

  arenaQueueJoin(pidOrFormat?: number | ArenaFormat, format: ArenaFormat = '1v1'): void {
    arenaMod.arenaQueueJoin(this.ctx, pidOrFormat, format);
  }

  arenaQueueLeave(pid?: number): void {
    arenaMod.arenaQueueLeave(this.ctx, pid);
  }

  private isArenaQueued(pid: number): boolean {
    return arenaMod.isArenaQueued(this.ctx, pid);
  }

  private arenaQueuedFormat(pid: number): ArenaFormat | null {
    return arenaMod.arenaQueuedFormat(this.ctx, pid);
  }

  private arenaDequeue(pid: number): boolean {
    return arenaMod.arenaDequeue(this.ctx, pid);
  }

  private arenaTeamOf(match: ArenaMatch, pid: number): 'A' | 'B' | null {
    return arenaMod.arenaTeamOf(this.ctx, match, pid);
  }

  arenaAllPids(match: ArenaMatch): number[] {
    return arenaMod.arenaAllPids(match);
  }

  private arenaStanding(meta: PlayerMeta, format: ArenaFormat): ArenaStanding {
    return arenaMod.arenaStanding(meta, format);
  }

  private isArenaCrossTeam(match: ArenaMatch, attackerPid: number, targetPid: number): boolean {
    return arenaMod.isArenaCrossTeam(this.ctx, match, attackerPid, targetPid);
  }

  private arenaIsDown(match: ArenaMatch, pid: number): boolean {
    return arenaMod.arenaIsDown(match, pid);
  }

  private isArenaTeamWiped(match: ArenaMatch, team: 'A' | 'B'): boolean {
    return arenaMod.isArenaTeamWiped(match, team);
  }

  private arenaCombatants(pids: number[]): ArenaCombatant[] {
    return arenaMod.arenaCombatants(this.ctx, pids);
  }

  private updateArena(): void {
    arenaMod.updateArena(this.ctx);
  }

  // A3: createFiestaState (FiestaState factory + per-match sub-Rng seed) moved to
  // social/fiesta.ts. Thin delegate keeps the ctx.createFiestaState seam binding
  // (consumed by the moved arena startArenaMatch) resolving into the module.
  private createFiestaState(): FiestaState {
    return fiestaMod.createFiestaState(this.ctx);
  }

  private placeInArena(
    e: Entity,
    origin: { x: number; z: number },
    spawn: { x: number; z: number; facing: number },
  ): void {
    arenaMod.placeInArena(this.ctx, e, origin, spawn);
  }

  private resetForArena(e: Entity): void {
    arenaMod.resetForArena(this.ctx, e);
  }

  private readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void {
    arenaMod.readyArenaFighter(this.ctx, e, opts);
  }

  private endArenaMatch(
    match: ArenaMatch,
    winnerTeam: 'A' | 'B' | null,
    reason: 'defeat' | 'timeout' | 'forfeit',
  ): void {
    arenaMod.endArenaMatch(this.ctx, match, winnerTeam, reason);
  }

  private returnFromArena(match: ArenaMatch): void {
    arenaMod.returnFromArena(this.ctx, match);
  }

  arenaMatchFor(pid: number): ArenaMatch | null {
    return arenaMod.arenaMatchFor(this.ctx, pid);
  }

  // -------------------------------------------------------------------------
  // 2v2 Fiesta — the dopamine-maxxed party mode. Score-based respawning bouts
  // with augment waves and a closing hazard ring. The match lifecycle reuses the
  // arena's countdown/aftermath; everything below drives the active phase.
  // -------------------------------------------------------------------------

  // The effective talent modifiers for a player: their talents with any Fiesta
  // augments folded in. Every stat/ability/threat recompute reads through this,
  // so augments persist through aura procs, gear swaps, and respawns.
  playerMods(meta: PlayerMeta): TalentModifiers {
    return meta.fiestaMods ?? meta.talentMods;
  }

  // -------------------------------------------------------------------------
  // 2v2 Fiesta: match logic MOVED to social/fiesta.ts (A3). Sim keeps thin
  // same-named delegates for the foreign-reachable surface: the seam-bound hooks
  // (createFiestaState above; fiestaStandardize / updateFiestaActive /
  // fiestaRestoreChar / clearFiestaAugments consumed by the moved arena lifecycle;
  // fiestaTakedown / fiestaDown consumed by dealDamage's cross-team arms), the
  // public arenaAugmentPick command (HUD + offline bots), and fiestaOpenWave /
  // fiestaRespawnTime (parity scenario + fiesta tests). The module-internal helpers
  // (mergeAugmentMods, fiestaApplyAugments, fiestaDownEntity, fiestaRevive,
  // fiestaPresentPending, fiestaPickOffers, fiestaRingDamage, fiestaUpdatePowerups,
  // fiestaSpawnPowerup, fiestaGrabPowerup) have no foreign caller and live only in
  // the module. playerMods (above) + fiestaMatchInfo (below) STAY on Sim.
  // -------------------------------------------------------------------------

  private clearFiestaAugments(meta: PlayerMeta, e: Entity): void {
    fiestaMod.clearFiestaAugments(meta, e);
  }

  private fiestaStandardize(meta: PlayerMeta, e: Entity): void {
    fiestaMod.fiestaStandardize(this.ctx, meta, e);
  }

  private fiestaRestoreChar(meta: PlayerMeta, e: Entity): void {
    fiestaMod.fiestaRestoreChar(meta, e);
  }

  arenaAugmentPick(augmentId: string, pid?: number): void {
    fiestaMod.arenaAugmentPick(this.ctx, augmentId, pid);
  }

  private fiestaRespawnTime(deaths: number, elapsed: number): number {
    return fiestaMod.fiestaRespawnTime(deaths, elapsed);
  }

  private fiestaDown(match: ArenaMatch, victim: Entity, killerPid: number | null): void {
    fiestaMod.fiestaDown(this.ctx, match, victim, killerPid);
  }

  private fiestaTakedown(match: ArenaMatch, killerPid: number, victim: Entity): void {
    fiestaMod.fiestaTakedown(this.ctx, match, killerPid, victim);
  }

  private fiestaOpenWave(match: ArenaMatch): void {
    fiestaMod.fiestaOpenWave(this.ctx, match);
  }

  private updateFiestaActive(match: ArenaMatch): void {
    fiestaMod.updateFiestaActive(this.ctx, match);
  }

  // -------------------------------------------------------------------------
  // 2v2 Fiesta: OFFLINE/DEV practice vs bots. The harness (spawn + queue + steer
  // three AI player bots) MOVED to social/fiesta_bots.ts (A3). It is offline-only
  // and reaches deep into Sim (casting, auto-attack, movement, add/remove player),
  // so its functions take the Sim directly rather than polluting the seam with a
  // dozen offline-only callbacks; arena queue/return helpers route through the
  // arena module. fiestaBotPids STAYS a Sim field (the E1 "state stays on Sim"
  // pattern) so the module reads/writes it via sim.fiestaBotPids and the existing
  // tests' (sim as any).fiestaBotPids reads resolve unchanged. Sim keeps the four
  // public delegates so main.ts (offline loop) + tests resolve unchanged.
  // -------------------------------------------------------------------------

  fiestaBotPids: number[] = [];

  fiestaPracticeActive(): boolean {
    return fiestaBotsMod.fiestaPracticeActive(this);
  }

  startFiestaPractice(): boolean {
    return fiestaBotsMod.startFiestaPractice(this);
  }

  stopFiestaPractice(): void {
    fiestaBotsMod.stopFiestaPractice(this);
  }

  updateFiestaBots(): void {
    fiestaBotsMod.updateFiestaBots(this);
  }

  private fiestaMatchInfo(
    match: ArenaMatch,
    pid: number,
    team: 'A' | 'B',
  ): import('../world_api').FiestaMatchInfo {
    const f = match.fiesta!;
    const origin = arenaOrigin(match.slot);
    const meta = this.players.get(pid);
    const offer = f.offers.get(pid);
    const respawn = f.respawn.get(pid) ?? 0;
    const roster = (pids: number[]): import('../world_api').FiestaScoreboardPlayer[] =>
      pids.map((p) => {
        const m = this.players.get(p);
        const _e = this.entities.get(p);
        return {
          pid: p,
          name: m?.name ?? '?',
          cls: m?.cls ?? 'warrior',
          kills: f.kills.get(p) ?? 0,
          down: f.respawn.has(p),
          me: p === pid,
        };
      });
    const powerups = f.powerups.map((p) => ({
      id: p.id,
      defId: p.defId,
      x: p.x,
      z: p.z,
      state: p.state,
      frac:
        p.state === 'spawning'
          ? 1 - Math.max(0, p.timer) / FIESTA_POWERUP_TELEGRAPH
          : Math.max(0, p.timer) / FIESTA_POWERUP_TTL,
      color: POWERUPS_BY_ID[p.defId]?.color ?? 0xffffff,
    }));
    return {
      team,
      scoreA: f.scoreA,
      scoreB: f.scoreB,
      myScore: team === 'A' ? f.scoreA : f.scoreB,
      theirScore: team === 'A' ? f.scoreB : f.scoreA,
      scoreLimit: f.scoreLimit,
      wave: f.wave,
      totalWaves: FIESTA_TOTAL_WAVES,
      ring: { cx: origin.x + FIESTA_RING_CX, cz: origin.z + FIESTA_RING_CZ, radius: f.ringRadius },
      down: f.respawn.has(pid),
      respawnIn: Math.ceil(respawn),
      augments: meta ? [...meta.fiestaAugments] : [],
      offer: offer ? { tier: offer.tier, wave: offer.wave, choices: [...offer.choices] } : null,
      augmentPending: f.pending.get(pid)?.length ?? 0,
      teamA: roster(match.teamA),
      teamB: roster(match.teamB),
      powerups,
    };
  }

  // Live standings of rated players currently online, best first.
  arenaLadder(format: ArenaFormat = '1v1'): import('../world_api').ArenaLadderEntry[] {
    const rows: import('../world_api').ArenaLadderEntry[] = [];
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e) continue;
      const standing = this.arenaStanding(meta, format);
      rows.push({
        pid: meta.entityId,
        name: meta.name,
        cls: meta.cls,
        rating: standing.rating,
        wins: standing.wins,
        losses: standing.losses,
      });
    }
    rows.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
    return rows.slice(0, ARENA_LADDER_SIZE);
  }

  arenaInfoFor(pid: number): import('../world_api').ArenaInfo | null {
    const meta = this.players.get(pid);
    if (!meta) return null;
    const match = this.arenaMatches.get(pid);
    const queuedFmt = this.arenaQueuedFormat(pid);
    let matchInfo: import('../world_api').ArenaInfo['match'] = null;
    if (match) {
      const myTeam = this.arenaTeamOf(match, pid);
      if (myTeam) {
        const allyPids = (myTeam === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
        const enemyPids = myTeam === 'A' ? match.teamB : match.teamA;
        const allies = this.arenaCombatants(allyPids);
        const enemies = this.arenaCombatants(enemyPids);
        const primary = enemies[0];
        if (primary) {
          matchInfo = {
            format: match.format,
            state: match.state,
            oppName: enemies.map((e) => e.name).join(' & '),
            oppClass: primary.cls,
            oppLevel: primary.level,
            oppPid: primary.pid,
            allies,
            enemies,
            returnIn: match.state === 'over' ? Math.max(0, Math.ceil(match.timer)) : undefined,
            fiesta: match.fiesta ? this.fiestaMatchInfo(match, pid, myTeam) : undefined,
          };
        }
      }
    }
    const standings: Record<ArenaFormat, ArenaStanding> = {
      '1v1': this.arenaStanding(meta, '1v1'),
      '2v2': this.arenaStanding(meta, '2v2'),
      // Fiesta is unranked party play — it keeps no standing of its own; mirror
      // 2v2 just to satisfy the bracket record (the Fiesta UI never reads it).
      fiesta: this.arenaStanding(meta, '2v2'),
    };
    const ladders: Record<ArenaFormat, import('../world_api').ArenaLadderEntry[]> = {
      '1v1': this.arenaLadder('1v1'),
      '2v2': this.arenaLadder('2v2'),
      fiesta: [],
    };
    const format = match?.format ?? queuedFmt;
    const readoutFormat = format ?? '1v1';
    const standing = standings[readoutFormat];
    const playerCount = (q: ArenaQueueUnit[]) => q.reduce((n, u) => n + u.pids.length, 0);
    const queueSize =
      format === 'fiesta'
        ? playerCount(this.arenaQueueFiesta)
        : format === '2v2'
          ? playerCount(this.arenaQueue2v2)
          : format === '1v1'
            ? this.arenaQueue1v1.length
            : 0;
    return {
      rating: standing.rating,
      wins: standing.wins,
      losses: standing.losses,
      standings,
      format,
      queued: queuedFmt !== null,
      queueSize,
      match: matchInfo,
      ladder: ladders[readoutFormat],
      ladders,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  // Trade SESSION + INVITE state stays on Sim (live ctx views this.trades /
  // this.tradeInvites); the method bodies moved to social/trade.ts (G2). Sim keeps
  // thin same-named delegates so the IWorld + server + leave-path + tick() call
  // sites resolve unchanged.
  tradeRequest(targetPid: number, pid?: number): void {
    tradeMod.tradeRequest(this.ctx, targetPid, pid);
  }

  tradeAccept(pid?: number): void {
    tradeMod.tradeAccept(this.ctx, pid);
  }

  tradeSetOffer(items: InvSlot[], copper: number, pid?: number): void {
    tradeMod.tradeSetOffer(this.ctx, items, copper, pid);
  }

  tradeConfirm(pid?: number): void {
    tradeMod.tradeConfirm(this.ctx, pid);
  }

  tradeCancel(pid?: number): void {
    tradeMod.tradeCancel(this.ctx, pid);
  }

  // offerCovered / closeTrade are module-internal in social/trade.ts now (no Sim
  // delegate; only the moved trade methods used them).

  tradeFor(pid: number): TradeSession | null {
    return tradeMod.tradeFor(this.ctx, pid);
  }

  // Stays in the end-of-tick system block (trades phase, called from tick()). The
  // joint party/trade/duel invite-expiry sweep + the trade-drift cancel pass moved
  // verbatim to social/trade.ts; partyInvites/duelInvites route through ctx.
  private updateTradesAndInvites(): void {
    tradeMod.updateTradesAndInvites(this.ctx);
  }

  // -------------------------------------------------------------------------
  // The World Market — the Merchant's auction house
  // -------------------------------------------------------------------------

  // These are thin delegates to the Market instance (this.market), which owns the
  // listing book / collections / id counter / merchant id and runs the logic
  // (extracted to market.ts, L2). server/game.ts, server/main.ts, the IWorld
  // surface, and the /listings readout call these unchanged; the inventory hub
  // (addItem/removeItem/countItem) stays on Sim and the market reaches it via the
  // SimContext.

  /** Live read of the shared listing book (the /listings readout + tests). */
  get marketListings(): MarketListing[] {
    return this.market.marketListings;
  }

  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean {
    return this.market.rekeyMarketSeller(characterId, oldName, newName);
  }

  marketSearch(query: MarketQuery, pid?: number): void {
    this.market.marketSearch(query, pid);
  }

  marketList(itemId: string, count: number, price: number, pid?: number): void {
    this.market.marketList(itemId, count, price, pid);
  }

  marketBuy(listingId: number, pid?: number): void {
    this.market.marketBuy(listingId, pid);
  }

  marketCancel(listingId: number, pid?: number): void {
    this.market.marketCancel(listingId, pid);
  }

  marketCollect(pid?: number): void {
    this.market.marketCollect(pid);
  }

  marketInfoFor(pid: number): import('../world_api').MarketInfo | null {
    return this.market.marketInfoFor(pid);
  }

  serializeMarket(): MarketSave {
    return this.market.serializeMarket();
  }

  loadMarket(save: MarketSave | null | undefined): void {
    this.market.loadMarket(save);
  }

  // -------------------------------------------------------------------------
  // The Ravenpost — in-game mail
  // -------------------------------------------------------------------------

  // Thin delegates to the PostOffice instance (this.postOffice), which owns the
  // mail book / id counter / mailbox entity ids (mail/post_office.ts, the
  // market.ts shape). server/game.ts and the IWorld surface call these
  // unchanged; the inventory hub stays on Sim, reached via the SimContext.

  mailSend(
    to: string,
    subject: string,
    body: string,
    copper: number,
    items: InvSlot[],
    pid?: number,
  ): void {
    this.postOffice.mailSend(to, subject, body, copper, items, pid);
  }

  /** Server path: the recipient identity is resolved against the character DB. */
  mailSendResolved(
    recipient: { key: string; name: string },
    subject: string,
    body: string,
    copper: number,
    items: InvSlot[],
    pid?: number,
  ): void {
    this.postOffice.mailSendResolved(recipient, subject, body, copper, items, pid);
  }

  mailTake(mailId: number, pid?: number): void {
    this.postOffice.mailTake(mailId, pid);
  }

  mailDelete(mailId: number, pid?: number): void {
    this.postOffice.mailDelete(mailId, pid);
  }

  mailMarkRead(mailId: number, pid?: number): void {
    this.postOffice.mailMarkRead(mailId, pid);
  }

  mailInfoFor(pid: number): import('../world_api').MailInfo | null {
    return this.postOffice.mailInfoFor(pid);
  }

  mailUnreadFor(pid: number): number {
    return this.postOffice.mailUnreadFor(pid);
  }

  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean {
    return this.postOffice.rekeyMailOwner(characterId, oldName, newName);
  }

  serializeMail(): MailSave {
    return this.postOffice.serializeMail();
  }

  loadMail(save: MailSave | null | undefined): void {
    this.postOffice.loadMail(save);
  }

  // -------------------------------------------------------------------------
  // Dungeons: party-instanced elite content (the Hollow Crypt and friends)
  // -------------------------------------------------------------------------

  // The dungeon-instancing slice now lives in instances/dungeons.ts (I1, moved behind
  // SimContext). These are same-named thin delegates so every foreign `this.X` call
  // site + the tick loop resolve unchanged; the in-module helpers (canEnterNythraxisRaid/
  // isRaidLocked/nythraxisInstanceSealed/claimInstance/freeInstance) have no Sim caller
  // and live only in the module. The instance pool (`this.instances`) and door-id cache
  // (`dungeonDoorIds`) stay Sim-owned fields, exposed to the module as live SimContext views.

  private instanceKeyFor(pid: number): string {
    return instanceKeyForImpl(this.ctx, pid);
  }

  private instanceOriginOf(inst: InstanceSlot): { x: number; z: number } {
    return instanceOriginOfImpl(inst);
  }

  // Lazily built on first updateDoorTriggers, then appended on dungeon_door spawn
  // (entity_roster.addEntityToRoster). Stays Sim-owned; reached via ctx.dungeonDoorIds.
  private dungeonDoorIds: number[] | null = null;

  private updateDoorTriggers(p: Entity): void {
    updateDoorTriggersImpl(this.ctx, p);
  }

  enterDungeon(dungeonId: string, pid?: number): void {
    enterDungeonImpl(this.ctx, dungeonId, pid);
  }

  leaveDungeon(pid?: number): void {
    leaveDungeonImpl(this.ctx, pid);
  }

  // Legacy single-dungeon entry points (tests + scripts use these).
  enterCrypt(pid?: number): void {
    enterCryptImpl(this.ctx, pid);
  }

  leaveCrypt(pid?: number): void {
    leaveCryptImpl(this.ctx, pid);
  }

  private updateInstances(): void {
    updateInstancesImpl(this.ctx);
  }

  // UI-facing info objects (the same shapes the server sends over the wire)
  get partyInfo(): import('../world_api').PartyInfo | null {
    const party = this.partyOf(this.primaryId);
    if (!party) return null;
    return {
      leader: party.leader,
      raid: party.raid,
      master: { ...party.lootStrategies.master },
      members: party.members.flatMap((mPid) => {
        const meta = this.players.get(mPid);
        const e = this.entities.get(mPid);
        return meta && e
          ? [
              {
                pid: mPid,
                name: meta.name,
                cls: meta.cls,
                level: e.level,
                hp: e.hp,
                mhp: e.maxHp,
                res: Math.round(e.resource),
                mres: e.maxResource,
                rtype: e.resourceType,
                x: e.pos.x,
                z: e.pos.z,
                dead: e.dead ? 1 : 0,
                inCombat: e.inCombat ? 1 : 0,
                group: party.raidGroups.get(mPid) ?? 1,
              },
            ]
          : [];
      }),
    };
  }

  get tradeInfo(): import('../world_api').TradeInfo | null {
    return tradeMod.tradeInfoFor(this.ctx, this.primaryId);
  }

  get duelInfo(): import('../world_api').DuelInfo | null {
    const d = this.duelFor(this.primaryId);
    if (!d) return null;
    const otherPid = d.a === this.primaryId ? d.b : d.a;
    return { otherPid, otherName: this.players.get(otherPid)?.name ?? '?', state: d.state };
  }

  get arenaInfo(): import('../world_api').ArenaInfo | null {
    return this.primaryId === -1 ? null : this.arenaInfoFor(this.primaryId);
  }

  get marketInfo(): import('../world_api').MarketInfo | null {
    return this.primaryId === -1 ? null : this.marketInfoFor(this.primaryId);
  }

  get mailInfo(): import('../world_api').MailInfo | null {
    return this.primaryId === -1 ? null : this.mailInfoFor(this.primaryId);
  }

  get mailUnread(): number {
    return this.primaryId === -1 ? 0 : this.mailUnreadFor(this.primaryId);
  }

  instanceSlotAt(pos: Vec3): number | null {
    return instanceSlotAtImpl(this.ctx, pos);
  }

  instanceInfoAt(pos: Vec3): { slot: number; dungeonId: string } | null {
    return instanceInfoAtImpl(this.ctx, pos);
  }

  private error(pid: number, text: string, reason?: ErrorReason): void {
    this.emit(reason ? { type: 'error', text, pid, reason } : { type: 'error', text, pid });
  }

  // helpLines / inspectReadout moved to social/chat.ts (G2); chat() reaches them
  // via chatMod.*. notice() below stays (the /join handler in chat.ts consumes it
  // via ctx.notice, and the quest-share path still calls this.notice).

  // A positive, personal chat-log notice (e.g. confirming a /join). Unlike
  // error(), this lands in the chat log rather than flashing the error toast.
  private notice(pid: number, text: string, color = '#ffd100'): void {
    this.emit({ type: 'log', text, color, pid });
  }

  // handleChannelMembership moved to social/chat.ts (G2); the chat() /join /leave
  // branch reaches it via chatMod.handleChannelMembership(this.ctx, ...).

  // -------------------------------------------------------------------------
  // Delves, replayable modular instances (see docs/prd/delves.md)
  // -------------------------------------------------------------------------

  // Delve run lifecycle (I2a) lives in src/sim/delves/runs.ts; Sim keeps same-named
  // thin delegates so the IWorld surface, the shared reach-in entry points, the
  // interleaved I2b/I2c callers, the movement clamps, and the (sim as any) test casts
  // all resolve unchanged. The bodies moved verbatim behind SimContext.
  private delveOriginOf(run: DelveRun): { x: number; z: number } {
    return runsMod.delveOriginOf(run);
  }

  private delveModuleZOffset(run: DelveRun, moduleIndex = run.moduleIndex): number {
    return runsMod.delveModuleZOffset(run, moduleIndex);
  }

  private delveOccupancyRadius(run: DelveRun): number {
    return runsMod.delveOccupancyRadius(run);
  }

  private delveRunForEntity(e: Entity): DelveRun | null {
    return runsMod.delveRunForEntity(this.ctx, e);
  }

  // Swept move resolution for players, keeps v0.10.0's segment-based
  // resolveMovement (no tunnelling through thin walls) and layers the delve
  // module colliders + portcullis doors on top when inside a delve.
  private resolveMove(
    fromX: number,
    fromZ: number,
    nx: number,
    nz: number,
    r: number,
    e: Entity,
    ignoreFences = false,
  ): { x: number; z: number } {
    const run = isDelvePos(nx) || isDelvePos(e.pos.x) ? this.delveRunForEntity(e) : undefined;
    const res = resolveMovement(this.cfg.seed, fromX, fromZ, nx, nz, r, ignoreFences, run?.modules);
    if (!run) return res;
    const clamped = this.clampDelveModuleBounds(run, res.x, res.z, r);
    return this.clampDelveDoors(run, clamped.x, clamped.z, r);
  }

  // Point resolution for mob wander / blocked checks, with the same delve layering.
  private resolveMovePoint(nx: number, nz: number, r: number, e: Entity): { x: number; z: number } {
    const run = isDelvePos(nx) || isDelvePos(e.pos.x) ? this.delveRunForEntity(e) : undefined;
    const res = resolvePosition(this.cfg.seed, nx, nz, r, false, run?.modules);
    if (!run) return res;
    const clamped = this.clampDelveModuleBounds(run, res.x, res.z, r);
    return this.clampDelveDoors(run, clamped.x, clamped.z, r);
  }

  private clampDelveModuleBounds(
    run: DelveRun,
    x: number,
    z: number,
    r: number,
  ): { x: number; z: number } {
    return runsMod.clampDelveModuleBounds(run, x, z, r);
  }

  private clampDelveDoors(
    run: DelveRun,
    x: number,
    z: number,
    r: number,
  ): { x: number; z: number } {
    return runsMod.clampDelveDoors(this.ctx, run, x, z, r);
  }

  delveModuleEntry(run: DelveRun): Vec3 {
    return runsMod.delveModuleEntry(this.ctx, run);
  }

  delveRunForPlayer(pid: number): DelveRun | null {
    return runsMod.delveRunForPlayer(this.ctx, pid);
  }

  private delveRunForMob(mobId: number): DelveRun | null {
    return runsMod.delveRunForMob(this.ctx, mobId);
  }

  private partyMembersForKey(key: string): number[] {
    const out: number[] = [];
    for (const meta of this.players.values()) {
      if (this.instanceKeyFor(meta.entityId) === key) out.push(meta.entityId);
    }
    return out;
  }

  private refreshDelveDaily(meta: PlayerMeta): void {
    runsMod.refreshDelveDaily(this.ctx, meta);
  }

  private pickDelveModules(delve: DelveDef, seed: number, tierId: string): string[] {
    return runsMod.pickDelveModules(delve, seed, tierId);
  }

  private stowPetForDelve(pid: number): void {
    petCommands.stowPetForDelve(this.ctx, pid);
  }

  private restorePetFromDelveStash(pid: number): void {
    petCommands.restorePetFromDelveStash(this.ctx, pid);
  }

  private canEnterDelve(pid: number): string | null {
    return runsMod.canEnterDelve(this.ctx, pid);
  }

  enterDelve(delveId: string, tierId: string, pid?: number): void {
    runsMod.enterDelve(this.ctx, delveId, tierId, pid);
  }

  leaveDelve(pid?: number): void {
    runsMod.leaveDelve(this.ctx, pid);
  }

  private claimDelveRun(run: DelveRun, key: string, delveId: string, tierId: string): void {
    runsMod.claimDelveRun(this.ctx, run, key, delveId, tierId);
  }

  private spawnDelveModule(run: DelveRun): void {
    runsMod.spawnDelveModule(this.ctx, run);
  }

  private freeDelveRun(run: DelveRun): void {
    runsMod.freeDelveRun(this.ctx, run);
  }

  private updateDelveRuns(): void {
    runsMod.updateDelveRuns(this.ctx);
  }

  private ejectToDelveDoor(pid: number, delve: DelveDef): void {
    runsMod.ejectToDelveDoor(this.ctx, pid, delve);
  }

  private failDelveRun(run: DelveRun): void {
    runsMod.failDelveRun(this.ctx, run);
  }

  private onDelveBossDefeated(run: DelveRun): void {
    runsMod.onDelveBossDefeated(this.ctx, run);
  }

  private delveMarkPayout(run: DelveRun, meta: PlayerMeta): number {
    return runsMod.delveMarkPayout(this.ctx, run, meta);
  }

  private unlockNextDelveLore(meta: PlayerMeta, pid: number): void {
    runsMod.unlockNextDelveLore(this.ctx, meta, pid);
  }

  private grantDelveClearTo(run: DelveRun, delve: DelveDef, meta: PlayerMeta, pid: number): void {
    runsMod.grantDelveClearTo(this.ctx, run, delve, meta, pid);
  }

  private grantDelveRewards(run: DelveRun): void {
    runsMod.grantDelveRewards(this.ctx, run);
  }

  private openDelveSurfaceExit(run: DelveRun): void {
    runsMod.openDelveSurfaceExit(this.ctx, run);
  }

  // In-delve respawn lives in entity_roster.ts (E1, merged E2). Thin delegate keeps
  // the public method resolving unchanged.
  releaseSpiritInDelve(pid: number): void {
    releaseSpiritInDelveImpl(this.ctx, pid);
  }

  private pickDelveSpawnSet(mod: DelveModuleDef, seed: number, moduleIndex: number) {
    return runsMod.pickDelveSpawnSet(mod, seed, moduleIndex);
  }

  private spawnDelveInteractables(run: DelveRun, mod: DelveModuleDef, zBase: number): void {
    runsMod.spawnDelveInteractables(this.ctx, run, mod, zBase);
  }

  private createDelveObject(run: DelveRun, kind: string, pos: Vec3): Entity {
    return runsMod.createDelveObject(this.ctx, run, kind, pos);
  }

  private tickDelveRun(run: DelveRun): void {
    runsMod.tickDelveRun(this.ctx, run);
  }

  private emitDelveModuleEnter(run: DelveRun, mod: DelveModuleDef): void {
    runsMod.emitDelveModuleEnter(this.ctx, run, mod);
  }

  private spawnDelveModuleExit(run: DelveRun, mod: DelveModuleDef, zBase: number): void {
    runsMod.spawnDelveModuleExit(this.ctx, run, mod, zBase);
  }

  private findDelveExitPortal(run: DelveRun): Entity | null {
    return runsMod.findDelveExitPortal(this.ctx, run);
  }

  private tryOpenDelveExitPortal(run: DelveRun): void {
    runsMod.tryOpenDelveExitPortal(this.ctx, run);
  }

  private openDelveExitPortal(run: DelveRun): void {
    runsMod.openDelveExitPortal(this.ctx, run);
  }

  private advanceDelveModule(run: DelveRun): void {
    runsMod.advanceDelveModule(this.ctx, run);
  }

  private tickDelveModuleExit(run: DelveRun): void {
    runsMod.tickDelveModuleExit(this.ctx, run);
  }

  private tickDelvePressurePlates(run: DelveRun): void {
    runsMod.tickDelvePressurePlates(this.ctx, run);
  }

  private tickDelveRaiseDeadChannel(run: DelveRun): void {
    runsMod.tickDelveRaiseDeadChannel(this.ctx, run);
  }

  private tickDelveBadAir(run: DelveRun): void {
    runsMod.tickDelveBadAir(this.ctx, run);
  }

  private tickDelveRestlessGraves(run: DelveRun): void {
    runsMod.tickDelveRestlessGraves(this.ctx, run);
  }

  private rollDelveAffixes(delve: DelveDef, tierId: string, seed: number): string[] {
    return runsMod.rollDelveAffixes(delve, tierId, seed);
  }

  private delveDetectMult(player: Entity): number {
    return runsMod.delveDetectMult(this.ctx, player);
  }

  private findDelveObject(run: DelveRun, kind: string): Entity | null {
    return runsMod.findDelveObject(this.ctx, run, kind);
  }

  private startDelveRaiseDeadChannel(
    run: DelveRun,
    boss: Entity,
    mobId: string,
    count: number,
  ): boolean {
    return runsMod.startDelveRaiseDeadChannel(this.ctx, run, boss, mobId, count);
  }

  private isDelveCompanionMob(mob: Entity): boolean {
    return (
      mob.ownerId !== null &&
      Object.values(DELVE_COMPANIONS).some((c) => c.mobTemplateId === mob.templateId)
    );
  }

  private spawnDelveCompanion(run: DelveRun, pid: number, companionId: string): void {
    const def = DELVE_COMPANIONS[companionId];
    const owner = this.entities.get(pid);
    const template = def ? MOBS[def.mobTemplateId] : null;
    if (!def || !owner || !template || run.companion) return;
    // Tessa's combat level scales with her purchased rank (rank 1 = 50% of owner
    // level, up to 100% at rank 3), so Marks investment, not just being present,
    // is what makes her a peer. Floored at 1 so a low-level owner never yields 0.
    const rank = this.players.get(pid)?.companionUpgrades[companionId] ?? 1;
    const levelPct = DELVE_COMPANION_LEVEL_PCT[rank] ?? DELVE_COMPANION_LEVEL_PCT[1];
    const companionLevel = Math.max(1, Math.round(owner.level * levelPct));
    const mob = createMob(
      this.nextId++,
      template,
      companionLevel,
      this.groundPos(owner.pos.x + 1.5, owner.pos.z),
    );
    mob.ownerId = pid;
    mob.hostile = false;
    mob.aiState = 'idle';
    mob.wanderTimer = DELVE_COMPANION_HEAL_INTERVAL;
    this.addEntity(mob);
    run.companion = { companionId, entityId: mob.id };
  }

  private despawnDelveCompanion(run: DelveRun): void {
    if (!run.companion) return;
    if (this.entities.has(run.companion.entityId)) this.dropEntity(run.companion.entityId);
    run.companion = undefined;
  }

  private maybeCompanionBark(run: DelveRun, pid: number, barkId: string): void {
    if (!run.companion || run.companionBarks.includes(barkId)) return;
    run.companionBarks.push(barkId);
    this.emit({ type: 'companionBark', barkId, pid });
  }

  delveInteract(objectId: number, pid?: number): void {
    runsMod.delveInteract(this.ctx, objectId, pid);
  }

  // -------------------------------------------------------------------------
  // Lockpicking minigame ("Tumbler's Path"), server-authoritative. The session
  // state machine MOVED to delves/lockpick_controller.ts (I2b); Sim keeps thin
  // delegates so the public IWorld surface (engage/action/abort/view + the
  // lockpickState accessor below) stays reachable, while the per-tick timeout
  // clock and the leave/disconnect teardown reach the controller via SimContext
  // (ctx.tickLockpickTimeout / ctx.abandonLockpick). The full lock layout is
  // never serialized, only visibleCells() inside the fog window is emitted.
  // -------------------------------------------------------------------------

  /** Start a lockpicking attempt: commit an ante (1/2/3 lives = loot tier). */
  lockpickEngage(objectId: number, ante: Ante, pid?: number): void {
    lockpickMod.lockpickEngage(this.ctx, objectId, ante, pid);
  }

  /** Submit one pick action on the player's active attempt (server-authoritative). */
  lockpickAction(action: PickAction, pid?: number, sessionId?: string): void {
    lockpickMod.lockpickAction(this.ctx, action, pid, sessionId);
  }

  lockpickAbort(pid?: number, sessionId?: string): void {
    lockpickMod.lockpickAbort(this.ctx, pid, sessionId);
  }

  /** Claim item loot from an opened delve chest (shown on the loot overlay). */
  collectDelveChestLoot(chestId: number, pid?: number): void {
    runsMod.collectDelveChestLoot(this.ctx, chestId, pid);
  }

  /** Read-only projection of the active lockpick attempt for IWorld (offline). */
  lockpickViewFor(pid?: number): LockpickView | null {
    return lockpickMod.lockpickViewFor(this.ctx, pid);
  }

  companionUpgrade(companionId: string, pid?: number): void {
    runsMod.companionUpgrade(this.ctx, companionId, pid);
  }

  delveShopGateMet(meta: PlayerMeta, delveId: string, gate: DelveShopGate): boolean {
    return runsMod.delveShopGateMet(meta, delveId, gate);
  }

  delveShopOffersFor(delveId: string, pid: number): DelveShopOffer[] {
    return runsMod.delveShopOffersFor(this.ctx, delveId, pid);
  }

  delveClearsFor(pid: number): Record<string, number> {
    return runsMod.delveClearsFor(this.ctx, pid);
  }

  delveBuyShopItem(delveId: string, itemId: string, pid?: number): void {
    runsMod.delveBuyShopItem(this.ctx, delveId, itemId, pid);
  }

  delveCompanionWire(pid: number): DelveCompanionInfo | null {
    return runsMod.delveCompanionWire(this.ctx, pid);
  }

  delveRunWire(pid: number): object | null {
    return runsMod.delveRunWire(this.ctx, pid);
  }

  delveMarksFor(pid: number): number {
    return runsMod.delveMarksFor(this.ctx, pid);
  }

  companionUpgradesFor(pid: number): Record<string, number> {
    return runsMod.companionUpgradesFor(this.ctx, pid);
  }

  delveDailyWire(pid: number): { date: string; firstClearXp: string[]; markClears: number } {
    return runsMod.delveDailyWire(this.ctx, pid);
  }

  get delveRun(): DelveRunInfo | null {
    return this.delveRunWire(this.primaryId) as DelveRunInfo | null;
  }

  get delveRunInfo(): DelveRunInfo | null {
    return this.delveRun;
  }

  get companionState(): DelveCompanionInfo | null {
    return this.delveCompanionWire(this.primaryId);
  }

  get lockpickState(): LockpickView | null {
    return this.lockpickViewFor(this.primaryId);
  }

  get delveMarks(): number {
    return this.delveMarksFor(this.primaryId);
  }

  get companionUpgrades(): Record<string, number> {
    return this.companionUpgradesFor(this.primaryId);
  }

  delveShopOffers(delveId: string): DelveShopOffer[] {
    return this.delveShopOffersFor(delveId, this.primaryId);
  }

  get delveDaily(): { date: string; firstClearXp: string[]; markClears: number } {
    return this.delveDailyWire(this.primaryId);
  }
}

// formatMoney now lives in ./format_money (a leaf module, to break the value-cycle
// with market.ts and loot/loot_roll.ts). Re-exported here so existing importers
// (e.g. tests/gold_command.test.ts) that import it from './sim' keep working.
export { formatMoney };
