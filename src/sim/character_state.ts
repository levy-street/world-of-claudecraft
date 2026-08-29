// Persisted character and pet save shapes. This is a type-only leaf: hosts may
// describe JSONB state without evaluating the simulation coordinator or any
// gameplay module. New fields remain optional unless every historical save can
// supply them.

import type { SavedBankState } from './bank';
import type { SavedLoadout, TalentAllocation } from './content/talents';
import type { SavedCooldowns } from './cooldown_persist';
import type { SavedDeedStats } from './deeds';
import type { PlayerEquipment } from './entity';
import type { JailState } from './jail';
import type { SavedMaterialsVaultState } from './materials_vault';
import type { ArchetypeState } from './professions/archetype';
import type { ToolEffectSlot } from './professions/tools';
import type { SavedReliquaryState } from './reliquary';
import type {
  EquipSlot,
  HonorArenaDailyState,
  InvSlot,
  ItemInstancePayload,
  PetMode,
  QuestProgress,
  SkinCatalog,
  SkinRank,
} from './types';

// Persistable character state (stored as JSONB server-side). The arena fields
// are optional so characters saved before the Ashen Coliseum existed load
// cleanly (addPlayer falls back to the unranked defaults).
export interface CharacterState {
  // Production content migration revision. Revision 1 is the v0.26 all-class
  // Talents V2 migration; revision 2 is the v0.29 Hunter redesign repick.
  // Absent means a pre-v0.26 character JSONB save.
  contentRevision?: number;
  level: number;
  xp: number;
  // Post-cap progression. All optional so characters saved before the Max-Level
  // XP Overflow system load cleanly (addPlayer backfills lifetimeXp from level).
  lifetimeXp?: number;
  // Soulbound PvP progression. Optional so pre-honor saves load at zero.
  honor?: number;
  lifetimeHonor?: number;
  honorArenaDaily?: HonorArenaDailyState;
  prestigeRank?: number;
  unlockedMilestones?: string[];
  // Rested XP pool. Optional so pre-rested-XP saves load cleanly (defaults to 0).
  restedXp?: number;
  // Lifetime played time in seconds (unfloored, for drift-free accumulation; only
  // the display floors), accumulated across every prior session (this session's
  // elapsed time is folded in at save; see PlayerMeta.totalPlayedSeconds and
  // /playtime in social/chat.ts). Optional so pre-/playtime saves load cleanly
  // (defaults to 0).
  totalPlayedSeconds?: number;
  // Gathering profession proficiency (JSONB; optional so pre-professions saves
  // load cleanly, defaulting every profession to 0). `professions` is the legacy
  // pre-rename key, still WRITTEN on every save alongside the current
  // `gatheringProficiency` key (dual-write for downgrade back-compat); reads
  // prefer `gatheringProficiency` and fall back to `professions`.
  professions?: Partial<Record<string, number>>;
  gatheringProficiency?: Partial<Record<string, number>>;
  // Slotted tool effects, keyed by gathering profession id (JSONB). OPTIONAL,
  // and written only when the player actually has one: a slot is rare, so an
  // always-present `{}` would add a key to every character row in the realm to
  // say nothing. Absent loads to an absent PlayerMeta field, which is the
  // default the parity digest depends on, so a save written before this field
  // existed loads byte-identically.
  toolEffectSlots?: Partial<Record<string, ToolEffectSlot>>;
  copper: number;
  hp: number;
  resource: number;
  pos: { x: number; z: number };
  facing: number;
  equipment: PlayerEquipment;
  // Per-slot ItemInstancePayload for whichever equipped piece carries one (an
  // enchanted item's rolled.stats or a rift-forged upgrade's payload).
  // Optional so pre-Enchanting saves load cleanly (defaults to no instances).
  equipmentInstance?: Partial<Record<EquipSlot, ItemInstancePayload>>;
  /** Legacy plural key written by this branch's earlier rift-gear saves. */
  equipmentInstances?: Partial<Record<EquipSlot, ItemInstancePayload>>;
  inventory: InvSlot[];
  // Equipped bag sockets. Optional so pre-bag saves load cleanly (defaults to
  // 4 empty sockets; an over-capacity legacy inventory is tolerated).
  bags?: (string | null)[];
  // Per-character bank (JSONB; optional so pre-bank saves load cleanly, defaulting
  // to an empty bank with no purchased/bonus slots). sanitizeBankState is the one
  // load path (never destroys items; tolerates an over-capacity inventory). The
  // SavedBankState socket fields are optional and written only once a socket is
  // unlocked, so pre-socket and zero-socket saves stay byte-equal.
  bank?: SavedBankState;
  // Per-character Materials Vault (JSONB; optional so pre-vault saves load cleanly,
  // defaulting to the empty locked vault). sanitizeVaultState is the one load path
  // (never destroys stock; tolerates an over-capacity count).
  vault?: SavedMaterialsVaultState;
  vendorBuyback?: InvSlot[];
  questLog: QuestProgress[];
  questsDone: string[];
  // Legacy arenaRating/Wins/Losses are treated as 1v1 data. The explicit
  // 1v1 fields are written by new saves, while old saves fall back cleanly.
  arenaRating?: number;
  arenaWins?: number;
  arenaLosses?: number;
  arena1v1Rating?: number;
  arena1v1Wins?: number;
  arena1v1Losses?: number;
  arena1v1Draws?: number;
  arena2v2Rating?: number;
  arena2v2Wins?: number;
  arena2v2Losses?: number;
  arena2v2Draws?: number;
  // Thornhollow Fields battleground standing (JSONB; optional and written only once a
  // result or capture exists, so pre-Thornhollow Fields saves load cleanly and
  // unchanged saves stay byte-equal).
  bgRating?: number;
  bgWins?: number;
  bgLosses?: number;
  bgDraws?: number;
  bgCaptures?: number;
  // The Vale Cup standing (JSONB; optional and written only once a result
  // exists, so pre-cup saves load cleanly and unchanged saves stay byte-equal).
  vcupWins?: number;
  vcupLosses?: number;
  vcupDraws?: number;
  // Guild-banner cup record (JSONB; written only once a guild result exists, so
  // pre-guild-entry saves stay byte-equal).
  vcupGuildWins?: number;
  vcupGuildLosses?: number;
  // The Vale Cup spectator betting record (JSONB; written only once a bet has
  // settled, so pre-betting saves stay byte-equal).
  vcupBetWins?: number;
  vcupBetLosses?: number;
  vcupBetNet?: number;
  // Talents & Specializations (JSONB). All optional so characters saved before
  // talents existed load cleanly; contentRevision owns point-tree -> row migration.
  talents?: TalentAllocation;
  loadouts?: SavedLoadout[];
  activeLoadout?: number;
  raidLockouts?: Record<string, number>;
  // Ability/potion cooldowns as remaining-time deltas (JSONB; optional so pre-fix
  // saves load cleanly with no cooldowns). Persisted so logging out and back in no
  // longer wipes cooldowns and lets a player bypass them by relogging.
  cooldowns?: SavedCooldowns;
  // Per-player gather-node respawn timers as remaining-time deltas (D6; JSONB,
  // nodeId -> remaining seconds, the cooldowns scheme above applied to node
  // readiness). Optional with zero-default omission: absent for pre-D6 saves
  // and whenever every node is ready, so unchanged characters stay byte-equal.
  // Loaded through applyNodeReadiness (professions/node_persist.ts): re-anchored
  // to the loading sim's clock, filtered to live node ids, clamped to one
  // respawn. Closes the relog exploit that used to reset every node timer.
  nodeHarvestCooldowns?: Record<string, number>;
  pet?: PetState | null;
  // WoW-style ghost state (JSONB; optional so pre-ghost saves load alive). A player who
  // logs out as a released spirit resumes as a ghost at the graveyard with the corpse
  // still marked, rather than free-resurrecting on relog. See src/sim/spirit.ts.
  ghost?: boolean;
  corpsePos?: { x: number; z: number } | null;
  // True when the character was saved dead (JSONB; optional so older saves load
  // alive exactly as before). A dead-but-UNRELEASED logout resumes as a released
  // ghost on relog (auto-release-on-logout), so logging out cannot bypass the
  // death loop. See the addPlayer ghost block + src/sim/spirit.ts.
  dead?: boolean;
  // The Keeper's Toll (Resurrection Sickness) remaining seconds (JSONB; optional/null when
  // none). Persisted so the penalty cannot be shed by logging out and back in.
  resSickness?: number | null;
  // Unstuck Sickness remaining seconds, same contract as resSickness above (JSONB;
  // optional/null when none, so pre-feature saves stay byte-equal and load clean).
  unstuckSickness?: number | null;
  jail?: JailState;
  // Z-key sheathed-weapon toggle (JSONB; written only while sheathed, so pre-feature
  // saves and unsheathed characters stay byte-equal and load with the weapon drawn).
  weaponStowed?: boolean;
  // Paperdoll helmet-visibility preference (JSONB; written only while hidden, same
  // pre-feature byte-equality contract as weaponStowed).
  helmHidden?: boolean;
  skin?: number; // appearance index (JSONB; optional so pre-skin saves load as 0)
  skinCatalog?: SkinCatalog;
  // Pending skin-select event rank (JSONB; optional so older saves load as null).
  pendingSkinRank?: SkinRank | null;
  pendingSkinCatalog?: SkinCatalog | null;
  pendingSkinItemId?: string | null;
  // LEGACY. The old "selected mount" pick, written by builds before reins became
  // usable items. Still declared so an existing save deserializes without a type
  // error, but nothing reads it and nothing writes it any more: the field simply
  // ages out of saves as characters are re-saved. Do NOT reintroduce a reader.
  selectedMount?: string;
  // One-time riding-lesson training fee (100g), charged when the first lesson
  // race starts (or through legacy mount_train_begin). Optional and absent until
  // paid, so pre-mount-training saves (and every save before the fee is ever
  // charged) stay byte-equal.
  mountTrainingFeePaid?: boolean;
  // Riding skill purchased from Marla (80g). Optional and absent until bought.
  ridingTrained?: boolean;
  // PBE boost kit version applied (server/pbe_boost.ts); absent outside PBE.
  pbeBoostKit?: number;
  delveMarks?: number;
  delveClears?: Record<string, number>;
  companionUpgrades?: Record<string, number>;
  delveLoreUnlocked?: string[];
  delveDaily?: { date: string; firstClearXp: string[]; markClears: number };
  heroicDaily?: { date: string; marked: string[] };
  // Ravenpost welcome letter already sent (optional so pre-mail saves load
  // cleanly and receive the announcement letter once on their next login).
  mailWelcomed?: boolean;
  // Guild trend letter already sent (optional so older saves load
  // cleanly and receive at most one letter when their crafts qualify).
  guildLetterSent?: boolean;
  // Repeatable work-order cooldowns (Professions 2.0; JSONB, quest id ->
  // availableAt tick). Written only when non-empty (zero-default omission), so
  // older and no-work-order saves stay byte-equal; loaded through
  // clampCadenceOnLoad (tick-reset safe).
  questCadence?: Record<string, number>;
  // Per-major acknowledged craft tier (Professions 2.0; JSONB, craft id
  // -> tier). Written only when non-empty (zero-default omission), so
  // older and unattuned saves stay byte-equal.
  tierMailSent?: Record<string, number>;
  // Per-pair quested hobby (Professions 2.0; JSONB, canonical pair id ->
  // craft id). Written only when non-empty (zero-default omission), so older
  // saves and characters that never quested a hobby stay byte-equal.
  questedHobbies?: Record<string, string>;
  // First-tier tutorial already sent (Professions 2.0; JSONB, optional
  // so older saves load cleanly and fire it once when they first qualify).
  // Written only when true (zero-default omission).
  profTierTutorialSent?: boolean;
  // Spawn greeting already sent (tutorial island; JSONB, optional so older
  // saves load cleanly and latch silently on their next swept tick).
  // Written only when true (zero-default omission).
  tutorialGreetingSent?: boolean;
  // World-boss loot lockouts now ride `raidLockouts` (keyed worldboss:<mobId>). The
  // legacy per-day `worldBossDaily` field is intentionally dropped: pre-migration saves
  // that still carry it just ignore it (a player locked at deploy may loot once more, a
  // one-time, player-friendly transition), and their lockouts persist via raidLockouts
  // from then on.
  // World-boss daily loot record. Optional so saves from before world bosses load
  // cleanly (addPlayer falls back to an empty record).
  worldBossDaily?: { date: string; looted: string[] };
  // Flat per-craft skill tracking (#1126; JSONB, additive back-compat: absent or
  // partial on older saves loads the missing crafts as 0, see normalizeCraftSkills).
  craftSkills?: Record<string, number>;
  // Recipe acquisition (#1299; JSONB, additive back-compat: absent on older
  // saves loads as an empty set, i.e. no learned non-grandfathered recipes).
  knownRecipes?: string[];
  // Grandfather normalize already applied (JSONB, additive
  // back-compat, the mailWelcomed idiom): absent/false on an older save
  // triggers the one-time PRE_TRAINING_RECIPE_IDS union on load, then true
  // is persisted so it never re-runs (it is idempotent anyway).
  recipesGrandfathered?: boolean;
  // Mastery reset already applied (JSONB, the recipesGrandfathered
  // idiom): absent/false on a pre-curve save triggers the one-time
  // applyMasteryReset on load (professions/mastery_reset.ts), then LITERAL
  // true is serialized unconditionally (any blob written by curve-era code
  // has the reset applied), so it can never re-fire.
  masteryResetApplied?: boolean;
  // Proficiency display heal already applied (issue 2339; JSONB, the
  // masteryResetApplied idiom): absent/false on a save written while the
  // character sheet still ROUNDED its Gathering rows triggers the one-time
  // healDisplayRoundedProficiency on load (a value the old sheet displayed
  // as a crossed band threshold, 99.5 to 99.99 reading "100", bumps to that
  // threshold so the join retro pass grants the stranded 100/200 gathering
  // deeds), then LITERAL true is serialized unconditionally so it can never
  // re-fire on the floored post-fix display.
  proficiencyDisplayHealApplied?: boolean;
  townFocus?: Record<string, number>;
  // Active-archetype state (#1129, superseded scope; JSONB, back-compat: absent on
  // older saves loads as emptyArchetypeState, see normalizeArchetypeState).
  archetype?: Partial<ArchetypeState>;
  // The Book of Deeds (JSONB; ALL optional and written only once non-empty, so
  // pre-deed saves load cleanly and stay byte-equal until the system engages).
  // `deeds` maps deed id to the utcDay earned ('' when unknown); `renown` is
  // denormalized for a later SQL sort index and RECOMPUTED from `deeds` on
  // load (the sim is authoritative). Loading also unions the legacy
  // `unlockedMilestones` ids into `deeds` (milestone unification), while new
  // grants keep dual-writing `unlockedMilestones` for one release as
  // forward-only rollback insurance.
  deeds?: Record<string, string>;
  deedStats?: SavedDeedStats;
  activeTitle?: string | null;
  activeBorder?: string | null;
  renown?: number;
  // The Reliquary (JSONB; optional, written only when non-empty so pre-system
  // saves load cleanly and stay byte-equal until the system engages).
  reliquary?: SavedReliquaryState;
}

export interface PetState {
  templateId: string;
  name: string;
  level: number;
  hp: number;
  dead: boolean;
  mode?: PetMode;
  autoTaunt?: boolean;
  autoWaterJet?: boolean;
  autoSkill?: boolean;
}
