// Core shared types for the simulation. The sim layer has zero DOM/rendering deps.

import type { GatheringProfessionId } from './content/professions';
import type { LockSession, LootTier, PickAction, StepResult, VisibleCell } from './lockpick';

export const TICK_RATE = 20; // sim ticks per second
export const DT = 1 / TICK_RATE;
export const RUN_SPEED = 7; // yards/sec, classic run speed
export const TURN_SPEED = Math.PI; // rad/sec keyboard turning
export const MELEE_RANGE = 5; // yards
export const MELEE_ARC = 2.2; // radians half-arc within which melee swings connect
export const INTERACT_RANGE = 5;
// /yell broadcast radius and ground-object respawn delay: neutral consts shared by
// code that stays on Sim (the chat router, pickUpObject) and an extracted slice (the
// Nythraxis encounter's yells + crypt-relic respawn), so they live here, not in sim.ts.
export const YELL_RANGE = 100;
export const OBJECT_RESPAWN = 30;
// How many of a party member's auras ride the party wire (PartyMemberInfo.auras,
// the mini icon strip under each party frame row). A cap, not a filter: the first
// N in aura order, buffs and debuffs alike. Neutral const shared by Sim.partyInfo,
// the server's partyWire, and the world_api shape, so it lives here.
export const PARTY_MEMBER_AURA_CAP = 8;
// Pet tuning shared between the pet-AI slice (src/sim/pet/pet_ai.ts) and code that
// stays on Sim, so it lives in this neutral module (the slice-only PET_* consts live
// in pet_ai.ts). PET_GROWL_INTERVAL is read by the moved updatePet auto-taunt arm AND
// the on-Sim manual-growl command; PET_TELEPORT_DISTANCE by the moved petFollow heel,
// an on-Sim follow check, AND the I2c delve companion AI (delves/companion.ts) heel warp.
export const PET_GROWL_INTERVAL = 10; // controlled pets can tank by forcing attention
export const PET_TELEPORT_DISTANCE = 60; // owner this far AND no route exists: pet warps to heel (last resort)
// Leash distance: how far a pulled mob may be dragged from its leash anchor before
// it evades home. Shared between the mob-locomotion slice (chase/flee leash checks)
// and the profiled-combat path that stays on Sim, so it lives in this neutral module.
export const LEASH_DISTANCE = 45;
export const DUNGEON_LEASH_DISTANCE = 70;
// Nythraxis add template id. Used by the mob-locomotion slice (the add branch of
// updateMob); the boss id NYTHRAXIS_BOSS_ID lives lower in this file (C1 relocation).
export const NYTHRAXIS_ADD_ID = 'nythraxis_skeleton_warrior';
export const GCD = 1.5; // seconds
// Combat ratings are gear-facing stats converted to fractions in recalcPlayerStats.
export const HASTE_RATING_PER_PCT = 10; // 10 haste rating = 1% faster
export const CRIT_RATING_PER_PCT = 10; // 10 crit rating = +1% crit chance
export function hasteFractionFromRating(rating: number): number {
  return rating / (HASTE_RATING_PER_PCT * 100);
}
export function critFractionFromRating(rating: number): number {
  return rating / (CRIT_RATING_PER_PCT * 100);
}
// Shared cooldown across ALL combat potions (classic-era potion sickness): one
// potion locks every other potion for this long (#103). 2 minutes, the classic-era value.
export const POTION_COOLDOWN = 120; // seconds
export const CAST_PUSHBACK_SEC = 0.5; // classic-era: each hit delays a cast by 0.5s
export const CHANNEL_PUSHBACK_FRACTION = 0.25; // classic-era: each hit shaves 25% off a channel
// Tolerance for "this per-tick timer is effectively complete" comparisons (casting,
// channels, ground-AoE pulses). Shared across sim modules (sim.ts + entity_roster.ts).
export const CAST_COMPLETE_EPS = 1e-9;
export const FISHING_CAST_ID = 'fishing';
export const FISHING_CAST_NAME = 'Fishing';
export const FISHING_CAST_TIME = 5;
// Seconds an empty instance idles before it resets. Shared by the dungeon instance
// reaper (instances/dungeons.ts) and the delve reaper (sim.ts). NYTHRAXIS_BOSS_ID
// (the dungeon raid-door seal also keys off it) lives lower in this file (C1 relocation).
export const INSTANCE_EMPTY_TIMEOUT = 300;
// Delve pressure-plate trigger radius (yards). Shared by the I2a run module
// (delves/runs.ts: plate stepping + chest/exit proximity) and the I2b lockpick
// controller still on Sim (resolveLockChest proximity gate). Relocated from sim.ts.
export const DELVE_PLATE_RADIUS = 2.5;
// Max purchasable companion rank. Shared by the I2a run module (companionUpgrade cap)
// and the I2c companion AI (delves/companion.ts: updateDelveCompanion heal-pct index).
export const DELVE_COMPANION_MAX_RANK = 3;
// The warlock Demon Heal channel id. Shared by the casting/channel path on Sim (C4a
// relocation) and the P1b pet-command healPet/applyDemonHealTick slice; here so both
// import it cycle-free. (P1b's identical relocation deduped to this one decl.)
export const DEMON_HEAL_CAST_ID = 'demon_heal';
// Companion heal cadence (seconds). Shared by the I2c companion AI (delves/companion.ts:
// updateDelveCompanion wanderTimer reset) and Sim.spawnDelveCompanion (initial timer).
export const DELVE_COMPANION_HEAL_INTERVAL = 3;
// PET_TELEPORT_DISTANCE (the pet/companion last-resort heel warp) was relocated to this
// module by P1a (above); the I2c companion AI shares that same const, not re-declared here.

export type PlayerClass =
  | 'warrior'
  | 'paladin'
  | 'hunter'
  | 'rogue'
  | 'priest'
  | 'shaman'
  | 'mage'
  | 'warlock'
  | 'druid';

// Classes that command a persistent pet (hunter beast, warlock demon). Pure
// predicate, here so the pet-command slice imports it without a sim.ts cycle.
export function isPetClass(cls: PlayerClass): boolean {
  return cls === 'hunter' || cls === 'warlock';
}
// '1v1'/'2v2' are the ranked Ashen Coliseum ladders; 'fiesta' is the
// dopamine-maxxed 2v2 party mode (score-based, respawns, augments, a shrinking
// ring) — see docs/design and the Fiesta region of sim.ts.
export type ArenaFormat = '1v1' | '2v2' | 'fiesta';

export interface ArenaStanding {
  rating: number;
  wins: number;
  losses: number;
}

export interface ArenaCombatant {
  pid: number;
  name: string;
  cls: PlayerClass;
  level: number;
}
export const ALL_CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];
export type ResourceType = 'rage' | 'mana' | 'energy';
export const OVERHEAD_EMOTE_IDS = [
  'wave',
  'laugh',
  'question',
  'cheer',
  'dance',
  'point',
  'flex',
  'salute',
  'cry',
  'bow',
  'clap',
  'roar',
  'kneel',
] as const;
export type OverheadEmoteId = (typeof OVERHEAD_EMOTE_IDS)[number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

export type AiState = 'idle' | 'chase' | 'attack' | 'flee' | 'evade' | 'dead';

export type AuraKind =
  | 'dot'
  | 'slow'
  | 'stun'
  | 'root'
  | 'incapacitate'
  | 'polymorph'
  | 'attackspeed'
  | 'debuff_ap'
  | 'buff_ap'
  | 'buff_armor'
  | 'buff_int'
  | 'buff_agi'
  | 'buff_dodge'
  | 'buff_speed'
  | 'buff_haste'
  | 'buff_spellpower'
  | 'hot'
  | 'absorb'
  | 'imbue'
  | 'buff_sta'
  | 'buff_allstats'
  // Percentage drain on the whole stat block (value is a signed fraction, e.g.
  // -0.75 = stats reduced to 25%). Resurrection Sickness uses it; see
  // src/sim/spirit.ts and recalcPlayerStats.
  | 'buff_allstats_pct'
  | 'thorns'
  | 'form_bear'
  | 'form_cat'
  | 'form_travel'
  | 'stealth'
  | 'defensive_stance'
  | 'righteous_fury'
  | 'sunder'
  | 'mortal_wound'
  | 'silence'
  | 'blind'
  | 'disarm'
  | 'expose'
  | 'spellvuln'
  | 'lockout'
  | 'vulnerability'
  | 'hex'
  | 'tongues'
  | 'cost_tax'
  | 'heal_absorb'
  | 'critvuln'
  | 'next_cast_instant'
  | 'next_cast_free'
  | 'next_attack_crit'
  | 'buff_spi'
  // 2v2 Fiesta power-up buffs: `buff_scale` value = body-size multiplier (also
  // boosts max-hp when >1); `buff_jump` value = jump-height multiplier.
  | 'buff_scale'
  | 'buff_jump';

export interface Aura {
  id: string; // ability id that applied it
  name: string;
  kind: AuraKind;
  remaining: number; // seconds
  duration: number;
  value: number; // dot/hot: per tick; slow/haste/speed: multiplier; absorb: remaining; buffs: amount
  value2?: number; // imbue: judgement min; thorns unused
  value3?: number; // imbue: judgement max
  tickInterval?: number;
  tickTimer?: number;
  sourceId: number;
  school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  breaksOnDamage?: boolean;
  stacks?: number; // sunder armor: applications stack up to the effect's cap
  charges?: number; // thorns: remaining reflect charges (Lightning Shield); undefined => unlimited
  icd?: number; // thorns: internal-cooldown remaining, seconds (counts down each tick)
  icdMax?: number; // thorns: configured internal cooldown, seconds (re-armed on each reflect)
}

export type CrowdControlDrCategory =
  | 'root'
  | 'polymorph'
  | 'fear'
  | 'lockout'
  | 'openerStun'
  | 'controlledStun'
  | 'randomStun';

export interface CrowdControlDrState {
  stage: number;
  resetAt: number;
}

export interface Stats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  armor: number;
}

export interface WeaponInfo {
  min: number;
  max: number;
  speed: number; // seconds per swing
  dagger?: boolean; // backstab requires a dagger
}

export type EquipSlot =
  | 'mainhand'
  | 'helmet'
  | 'shoulder'
  | 'chest'
  | 'waist'
  | 'legs'
  | 'gloves'
  | 'feet';

// The eight equip slots, in the canonical paperdoll order. Single source for
// the entity loop and the server's unequip-command validation.
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

export type SkinCatalog = 'class' | 'mech';

export type ItemUse =
  | { type: 'fishing' }
  | { type: 'mechChroma'; chromaId: string }
  // Opens the client-side event skin-select overlay. The server rolls a rank on
  // use (see Sim.openSkinSelect) and the player locks one in via claimEventSkin.
  | { type: 'skinSelect'; catalog?: SkinCatalog }
  // A base gathering tool (see #1123). `tier` gates which node/material tiers
  // it can gather: see src/sim/professions/tools.ts (canGatherTier). This item
  // type never carries a durability field (this repo has no durability
  // mechanic anywhere), so a base tool can never become unusable.
  | { type: 'gatherTool'; professionId: GatheringProfessionId; tier: number };

// Rarity ranks for the cosmetic skin-select event, ordered low → high. A rolled
// rank unlocks its own tier and every tier below it (epic unlocks rare+uncommon).
export type SkinRank = 'uncommon' | 'rare' | 'epic';

export type ArmorType = 'cloth' | 'leather' | 'mail';

type ItemKind =
  | 'weapon'
  | 'armor'
  | 'quest'
  | 'junk'
  | 'food'
  | 'drink'
  | 'tool'
  | 'potion'
  | 'elixir'
  | 'bag';

interface BaseItemDef {
  id: string;
  name: string;
  slot?: EquipSlot;
  weapon?: WeaponInfo;
  stats?: Partial<Stats>;
  // Spell Power affix (caster gear): flat Spell Power, summed in recalcPlayerStats.
  // Kept off `Stats` because Spell Power is a derived combat rating (like attackPower),
  // not one of the six primary attributes.
  spellPower?: number;
  // Combat ratings, converted to crit%/haste% in recalcPlayerStats.
  critRating?: number;
  hasteRating?: number;
  use?: ItemUse;
  sellValue: number; // copper (vendor buys at this)
  buyValue?: number; // copper (vendor sells at this)
  questId?: string;
  noVendorSell?: boolean;
  noDiscard?: boolean;
  noMarketList?: boolean;
  /** Shown when interacting with a ground quest object before the quest is active. */
  pickupDeny?: string;
  /** Shown when the quest is active but the collect count is already met. */
  pickupEnough?: string;
  // consumables: total restored over 18 seconds while sitting
  foodHp?: number;
  drinkMana?: number;
  // potions: restored instantly, usable in combat, share a cooldown (#103)
  potionHp?: number;
  potionMana?: number;
  // elixirs: a temporary stat-buff aura granted on use (classic battle elixirs).
  // `aura` is a flavor name shown in the buff frame; `value` is the stat amount,
  // `duration` the buff length in seconds. Folds through the normal aura/stat path.
  elixir?: { aura: string; kind: AuraKind; value: number; duration: number };
  quality?: 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'; // gray/white/green/blue/purple/orange name colors
  // bags (kind:'bag'): extra inventory slots granted while equipped in one of
  // the 4 bag sockets (see src/sim/bags.ts; the 16-slot backpack is implicit).
  bagSlots?: number;
  // Max copies per inventory slot. When omitted the default is derived from
  // `kind` (weapon/armor/bag/tool: 1, everything else: 20); see stackSizeOf.
  stackSize?: number;
  requiredClass?: PlayerClass[];
  // Minimum character level needed to equip this piece. When omitted, the level
  // is DERIVED from `quality` (see src/sim/item_level_req.ts); set this only to
  // override the per-quality default for a specific item.
  requiredLevel?: number;
  /** Set id this piece belongs to; equipping enough pieces grants the set bonuses (see ITEM_SETS). */
  set?: string;
}

// Item-set bonuses (classic "tier set" style). Flat effects fold into
// recalcPlayerStats: primary stats feed the AP/crit/HP derivations, `ap`/`crit`
// add at their derivation steps, and `castPushbackReduction` (0..1) scales the
// damage-driven cast pushback in combat/casting_lifecycle.ts. `knockbackResistance` (0..1)
// scales on-hit knockback distance. Balance values are authored in
// content/item_sets.ts, never inline in engine code.
export interface SetProc {
  id: string; // unique aura/proc id, e.g. 'set_clearcasting'
  name: string; // buff display name, e.g. 'Clearcasting'
  trigger: 'spellCast' | 'meleeCrit' | 'spellCrit' | 'kill';
  chance: number; // 0..1 proc chance
  aura: AuraKind; // the buff to grant, e.g. 'next_cast_free'
  duration: number; // seconds the granted aura lasts
  value?: number; // optional aura value
  icd?: number; // internal cooldown seconds, min gap between procs
}

export interface SetBonusEffect {
  str?: number;
  agi?: number;
  sta?: number;
  int?: number;
  spi?: number;
  ap?: number; // flat attack power
  sp?: number; // flat spell power (mirrors `ap` for the caster archetype)
  crit?: number; // flat crit chance, 0..1
  critRating?: number; // crit rating (converted to % in recalcPlayerStats)
  // Haste fraction (0.15 = 15% faster). ONE stat: it speeds melee and ranged
  // auto-attack swings AND shortens spell cast/channel time, all together
  // (folded into Entity.meleeHaste/rangedHaste/spellHaste in recalcPlayerStats).
  haste?: number;
  hasteRating?: number; // haste rating (converted to % in recalcPlayerStats)
  castPushbackReduction?: number; // 0..1: fraction of damage cast-pushback removed (1 = immune)
  knockbackResistance?: number; // 0..1: fraction of on-hit knockback distance resisted (1 = immune)
  proc?: SetProc;
}

export interface SetBonusTier {
  pieces: number; // equipped-piece threshold that unlocks this tier
  effect: SetBonusEffect;
  text: string; // English source, localized at the client tooltip
}

export interface ItemSet {
  id: string;
  name: string; // English source
  bonuses: SetBonusTier[]; // ascending by `pieces`
}

export interface ArmorItemDef extends BaseItemDef {
  kind: 'armor';
  slot: Exclude<EquipSlot, 'mainhand'>;
  armorType: ArmorType;
  weapon?: never;
}

export interface WeaponItemDef extends BaseItemDef {
  kind: 'weapon';
  slot: 'mainhand';
  weapon: WeaponInfo;
  armorType?: never;
  // Legendary "chance on action" procs; see WeaponProc below.
  weaponProcs?: WeaponProc[];
}

// A legendary weapon proc: a "chance on action" effect that rolls when the wielder
// performs the trigger action (lands a melee swing, lands a damaging spell, or lands
// a heal) and, on success, fires its effects. Handled by
// src/sim/combat/equip_procs.ts. The proc's rng roll is gated on the wielder actually
// carrying a proc weapon, so ordinary gear draws no extra rng and the deterministic
// draw order (and every parity golden that equips no legendary) is unchanged.
export type WeaponProcTrigger = 'meleeHit' | 'spellDamage' | 'heal';

export type WeaponProcEffect =
  // Thunderfury-style arc: a bolt that strikes the primary target and then jumps to
  // up to `jumps` nearby enemies for `falloff`-decaying damage.
  | {
      kind: 'chainArc';
      school: Aura['school'];
      damage: number;
      jumps: number;
      falloff: number;
      radius: number;
    }
  // Slows the primary target's attack speed (an `attackspeed` aura, mult > 1).
  | { kind: 'attackSlow'; name: string; mult: number; duration: number }
  // A damage-over-time on the target (e.g. Deathbloom).
  | {
      kind: 'dot';
      name: string;
      school: Aura['school'];
      perTick: number;
      interval: number;
      duration: number;
    }
  // A heal-over-time on the trigger's target (e.g. Lifebloom).
  | { kind: 'hot'; name: string; perTick: number; interval: number; duration: number };

export interface WeaponProc {
  id: string; // unique per item; used for the applied aura ids
  name: string; // player-visible proc name (also the chain arc's damage label)
  trigger: WeaponProcTrigger;
  chance: number; // 0..1 per trigger action
  effects: WeaponProcEffect[];
}

export interface OtherItemDef extends BaseItemDef {
  kind: Exclude<ItemKind, 'armor' | 'weapon'>;
  armorType?: never;
}

export type ItemDef = ArmorItemDef | WeaponItemDef | OtherItemDef;

// Per-instance item payload (#1165). Additive and OPTIONAL: most items stay plain
// {itemId, count} with no instance payload (fungible, market-listable). A slot
// carrying `instance` is non-fungible (signed, has rolled stats, or is
// character-bound) and is kept in its own slot entry, never merged with a plain
// stack of the same itemId. Inert in the World Market for now (blocked at list
// time, see market.ts marketList); #1146 wires real market handling for
// instanced items later.
export interface ItemInstancePayload {
  /** Player name that signed/crafted this specific copy, if any. */
  signer?: string;
  /** Remaining charges for a per-effect-limited item, keyed by effect id. */
  charges?: Record<string, number>;
  /** Rolled quality/stat values baked into this specific copy at creation time. */
  rolled?: { quality?: string; stats?: Record<string, number> };
  /** Player id (Entity id) this specific copy is bound to. */
  boundTo?: number;
}

export interface InvSlot {
  itemId: string;
  count: number;
  /** Additive, optional per-instance payload (#1165). Absent for ordinary fungible stacks. */
  instance?: ItemInstancePayload;
}

// A shallow `{ ...slot }` aliases `instance` (and its mutable `charges`/`rolled.stats`
// maps) between the live slot and a serialized/loaded copy: decrementing a charge on
// one would silently mutate the other. Deep-clone at every save/load boundary instead.
export function cloneInvSlot<T extends InvSlot>(slot: T): T {
  if (!slot.instance) return { ...slot };
  const src = slot.instance;
  const instance: ItemInstancePayload = { ...src };
  if (src.charges) instance.charges = { ...src.charges };
  if (src.rolled)
    instance.rolled = {
      ...src.rolled,
      ...(src.rolled.stats && { stats: { ...src.rolled.stats } }),
    };
  return { ...slot, instance };
}

export interface LootSlot extends InvSlot {
  // Quest corpse loot can be personal: each listed player can take one copy.
  personalFor?: number[];
  // Need/greed loot that everyone passed on becomes free-for-all corpse loot.
  openToAll?: boolean;
}

export interface CorpseLoot {
  copper: number;
  items: LootSlot[];
}

export type CurrencyLootStrategy = 'looter-takes-all' | 'fair-split';
export type LootRollChoice = 'need' | 'greed' | 'pass';
export type ItemLootStrategy = 'looter-takes-all' | 'need-greed' | 'round-robin';

// An open need-greed roll a player may still answer. Carried both on the
// transient `lootRoll` SimEvent and (for reliable re-delivery) on the self
// snapshot, so a client that missed the event can re-show the prompt from
// authoritative state rather than losing the roll permanently.
export interface LootRollPrompt {
  rollId: number;
  itemId: string;
  itemName: string;
  quality: ItemDef['quality'];
  expiresAt: number;
}

// Master loot intercepts roll-worthy drops at/above a quality threshold and hands
// the assignment decision to a single designated looter (the leader, or 0 = leader).
export type MasterLootThreshold = 'uncommon' | 'rare' | 'epic';
export interface MasterLootSettings {
  enabled: boolean;
  looter: number; // pid of the master looter; 0 means "the current leader"
  threshold: MasterLootThreshold;
}

export interface LootStrategies {
  currency: CurrencyLootStrategy;
  commonItems: ItemLootStrategy;
  premiumItems: ItemLootStrategy;
  master: MasterLootSettings;
}

export const DEFAULT_PARTY_LOOT_STRATEGIES: LootStrategies = {
  currency: 'fair-split',
  commonItems: 'round-robin',
  premiumItems: 'need-greed',
  master: { enabled: false, looter: 0, threshold: 'uncommon' },
};

export interface LootEntry {
  itemId?: string;
  copper?: number;
  chance: number; // 0..1
  questId?: string; // only drops while this quest is active and not complete
  // Entries sharing a rollGroup are exclusive: one rng draw is partitioned by
  // their chances, so at most one matching entry drops.
  rollGroup?: string;
}

export type MobFamily =
  | 'beast'
  | 'humanoid'
  | 'mudfin'
  | 'spider'
  | 'burrower'
  | 'undead'
  | 'troll'
  | 'ogre'
  | 'elemental'
  | 'dragonkin'
  | 'demon';
export type PetMode = 'passive' | 'defensive' | 'aggressive';
export type PetRole = 'melee_tank' | 'ranged_dps';

export interface MobTemplate {
  id: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  family: MobFamily;
  hpPerLevel: number;
  hpBase: number;
  dmgBase: number; // min dmg at level 1
  dmgPerLevel: number;
  attackSpeed: number;
  armorPerLevel: number;
  moveSpeed: number;
  aggroRadius: number; // base, at equal level
  loot: LootEntry[];
  scale: number; // render hint
  color: number; // render hint
  // Profession harvesting: the skinning/salvage component types this mob's corpse
  // can yield (e.g. 'hide', 'horn', 'venomSac', 'gills', 'fang', 'claw', 'feather').
  // Consumed by the corpse-harvest command (src/sim/interaction.ts harvestCorpse)
  // via the tag-to-item map in src/sim/content/professions.ts (#1141).
  componentTags?: string[];
  boss?: boolean;
  rare?: boolean;
  // World boss: a server-wide elite that spawns on a fixed cadence (not from a
  // CAMP), announces itself when it rises, and drops PERSONAL loot to every player
  // who damaged it (gated to once per day per boss). The spawn schedule + location
  // live in src/sim/world_boss.ts; the loot roll runs through rollWorldBossLoot.
  worldBoss?: boolean;
  // Elite scaling, classic-style: ~2.3x health, ~1.5x damage, double XP.
  elite?: boolean;
  // Kill-XP multiplier (default 1). 0 marks a puzzle-object mob (e.g. the 1 HP
  // spider egg-sac) that must not pay full kill XP for a single hit.
  xpMult?: number;
  // Rare/miniboss controls.
  canSwim?: boolean;
  ccImmune?: boolean;
  // Immune to movement-speed slow auras (kind 'slow'). Distinct from ccImmune, which
  // blocks the hard control auras (stun/root/incapacitate/polymorph) but intentionally
  // leaves snares landing so most elites can still be kited; a raid boss sets both.
  slowImmune?: boolean;
  respawnMult?: number;
  // Boss mechanic: periodic AoE pulse around the mob while in combat.
  aoePulse?: {
    min: number;
    max: number;
    radius: number;
    every: number;
    name: string;
    school?: string;
    fx?: 'nova' | 'projectile';
  };
  // Boss mechanic: a periodic telegraphed HARDCAST. Unlike the instant aoePulse,
  // the mob shows a real cast bar (the entity casting fields carry castId) for
  // `castTime` seconds, then the spell lands as an AoE nova on every living player
  // within `radius`. The mob keeps meleeing while it casts (the bar is the
  // telegraph healers react to, not a channel). `yell` is barked at cast start.
  bigCast?: {
    castId: string;
    name: string;
    castTime: number;
    every: number;
    radius: number;
    min: number;
    max: number;
    school?: string;
    yell?: string;
  };
  // Boss bark lines, broadcast as 'yell'-channel chat to every player within
  // YELL_RANGE (mirroring the Nythraxis encounter yells; sim-emitted English by
  // the variable-routed-chat precedent, see the S3 note in
  // tests/localization_fixes.test.ts). engage fires once per pull on the first
  // player aggro, summon on each add wave, enrage when the enrage turns on.
  yells?: { engage?: string; summon?: string; enrage?: string };
  // Boss mechanic: spawn adds when hp first drops below each threshold (descending fractions).
  summonAdds?: { mobId: string; count: number; atHpPct: number[] };
  // Boss mechanic: damage multiplier (and optional swing-speed haste) once hp
  // drops below the threshold. hasteMult > 1 makes the enraged mob swing faster.
  enrage?: { belowHpPct: number; dmgMult: number; hasteMult?: number };
  // Mob mechanic: a one-time desperation self-heal the first time hp drops
  // below the threshold (healPct is a fraction of maxHp). Resets on evade/respawn.
  desperateHeal?: { belowHpPct: number; healPct: number };
  // Self-buff affix ("Battle Fury" / Rampage): every landed melee swing whips the
  // attacker into an escalating frenzy — a self-applied, stacking buff_ap aura (up
  // to `maxStacks`) that grows its attack power, and thus its melee damage, the
  // longer the fight drags on. Rides the existing buff_ap aura that
  // effectiveAttackPower already folds into mob swing damage, so there is no new
  // combat math. Unlike `enrage` (a one-shot threshold burst) or `packFrenzy` (a
  // haste pulse on an ally's death), this ramps continuously while the mob keeps
  // connecting. The single shared aura slot is refreshed each hit; left alone it
  // falls off after `duration`s, undoing the ramp — so burning the mob down or
  // kiting it out of melee both reset its fury.
  rampage?: {
    ap: number;
    maxStacks: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Support mechanic ("Mend"): while in combat, periodically heal every wounded
  // living friendly mob within `radius` (incl. itself) for `healMin..healMax`.
  // Telegraphed: the first cast lands one full `every` interval after combat
  // opens. Resets on evade/respawn. Routes through the normal heal path, so it
  // shows green floating text and grants no threat to the menders themselves.
  mendAlly?: {
    healMin: number;
    healMax: number;
    radius: number;
    every: number;
    name: string;
    school?: Aura['school'];
  };
  // Support mechanic ("Ward"): the defensive twin of `mendAlly`. While in combat,
  // periodically wrap every living friendly mob within `radius` (incl. itself) in
  // a damage-absorbing barrier soaking a flat `amount` for `duration`s — a leader
  // shielding the crew. Rides the existing `absorb` aura (soaked in dealDamage
  // before any HP loss), so there is no new aura kind or combat math. Telegraphed:
  // the first ward lands one full `every` interval after combat opens. Resets on
  // evade/respawn. Refreshes each interval, replacing any partially-soaked ward.
  wardAllies?: {
    radius: number;
    every: number;
    amount: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Commander mechanic ("Rallying Banner"): periodically empowers every friendly
  // mob in range (including the caster) with a refreshing `buff_ap` aura worth
  // `ap` attack power for `duration`s — the support twin of mendAlly, granting
  // offense instead of healing. Rides the existing buff_ap aura that
  // effectiveAttackPower already folds for mobs, so no new aura kind or combat
  // math. Telegraphed like stomp/mendAlly: the first rally only lands one full
  // interval after combat opens.
  rally?: {
    radius: number;
    every: number;
    ap: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Support "War Cadence": periodically quicken the swing speed of every nearby
  // friendly mob (including the caster) by `hasteMult` for `duration`s. Rides the
  // existing buff_haste primitive (the same aura packFrenzy uses, already folded
  // into swingIntervalMult), so it needs no new combat math. Telegraphed and
  // reset on evade/respawn exactly like mendAlly.
  warcry?: {
    radius: number;
    every: number;
    hasteMult: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Boss mechanic ("War Stomp"): periodic ground slam that stuns nearby players
  // for `duration`s (and optionally deals min..max damage). Telegraphed: the
  // first slam only lands one full `every` interval after combat starts.
  stomp?: {
    radius: number;
    every: number;
    duration: number;
    min?: number;
    max?: number;
    name: string;
    school?: string;
  };
  // Periodic self-shield: the mob wraps itself in a damage-absorbing barrier
  // every `every` seconds, soaking up to `amount` damage for `duration` seconds.
  // Reuses the existing `absorb` aura (soaked first in dealDamage) — no new combat math.
  stoneskin?: { amount: number; every: number; duration: number; name: string; school?: string };
  // Boss/elite mechanic ("Banshee's Wail"): a periodic, telegraphed scream that
  // terrifies every nearby player into fleeing for `duration`s. Unlike the
  // on-hit `dread`, this is a timed AoE — the room-clearing analogue of `stomp`,
  // but it applies the same `fear_incap` aura the player-cast Fear uses (driven
  // by `updateFearMovement`) instead of a stun. Telegraphed: the first wail only
  // lands one full `every` interval after combat opens. No new aura kind.
  terrify?: {
    radius: number;
    every: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Boss mechanic ("Howling Gale"): the ANTI-KITE snare. A periodic, room-wide AoE
  // that slows every player within `radius` to `mult` of run speed (moveSpeedMult
  // already honors `slow` auras, so 0.2 = 20% speed) for `duration`s. Unlike the
  // aoePulse/stomp/bigCast pulses, which gate on the boss being in melee range, this
  // one ALSO fires while the boss is chasing a fleeing target: that is the whole
  // point, a ranged kiter can otherwise hold a sub-run-speed boss out of melee
  // forever and none of the other pulses ever land. Deals no damage and draws no
  // rng (fixed radius/mult/duration). Telegraphed like the sibling pulses (the first
  // gust lands one full `every` after engage).
  aoeSlow?: {
    radius: number;
    mult: number;
    duration: number;
    every: number;
    name: string;
    school?: Aura['school'];
  };
  // Boss flavor ("loud"): a booming voice. `range` widens how far EVERY yell this mob
  // barks (engage/summon/enrage too) carries, past the default YELL_RANGE, and `lines`
  // are extra battle cries it bellows every `every`s while in combat (cycled in order,
  // no rng). Chat-channel text, so it ships English under the boss-yell precedent.
  battleYells?: { lines: string[]; every: number; range: number };
  // Melee mechanic: each landed swing also splashes onto other players near the
  // primary target for `mult` of the (pre-armor) hit. A classic-style cleave arc.
  cleave?: { radius: number; mult: number; name?: string };
  // On-hit debuff: a chance per landed melee swing to inflict a stacking-refresh
  // damage-over-time poison on the struck target (spiders, serpents, scorpions).
  venom?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: string;
  };
  // On-hit rot: a landed melee swing has `chance` to fester a refreshing SHADOW
  // damage-over-time wound on the victim ("Soulrot"). The same on-hit DoT seam as
  // `venom` (nature/poison) and `bleed` (physical), but shadow-school — the
  // undead/necrotic flavour, and it bites every class (resisted by shadow, not
  // nature/physical mitigation). Refreshes (never stacks) like venom.
  soulrot?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit bleed: a landed melee swing has `chance` to open a refreshing PHYSICAL
  // damage-over-time wound on the victim ("Rend"). Distinct from `venom` (a
  // nature/poison DoT) — bleeds are physical-school, the predator/beast flavour
  // of the same on-hit DoT seam. Refreshes (never stacks) like venom.
  bleed?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit frostbite: a landed melee swing has `chance` to open a refreshing
  // damage-over-time frost burn on the struck target — the frost twin of venom
  // (chilling/elemental creatures). Reuses the 'dot' aura; school defaults to 'frost'.
  frostbite?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: string;
  };
  // Burning fuse: a landed swing may set a refreshing fire DoT (the fire-school
  // sibling of venom; sappers, ember-touched creatures). Defaults to the 'fire' school.
  smolder?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: string;
  };
  // On-hit debuff: the fire-school twin of `venom` — a chance per landed melee
  // swing to set a stacking-refresh burning damage-over-time (cinder/ember mobs,
  // demolitionists carrying blasting powder). Same DoT seam, school defaults 'fire'.
  cinder?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: string;
  };
  // On-hit arcane DoT: the arcane-school sibling of venom (nature) / bleed
  // (physical) / soulrot (shadow) / frostbite (frost) / cinder (fire). A landed
  // swing may brand the victim with a searing arcane rune that festers as a
  // refreshing damage-over-time. Reuses the `dot` aura; only the default school
  // differs. Carried by corrupt spellcasters that channel raw arcane energy.
  arcaneRot?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    name: string;
    school?: string;
  };
  // On-hit debuff: a *stacking* poison DoT. Unlike `venom` (a single fixed-value
  // DoT that merely refreshes), each landed swing adds a stack — the per-tick
  // damage is `perTick * stacks`, ramping up to `maxStacks` — so the longer the
  // creature stays on its target the worse the venom bites (classic "Deadly
  // Poison"). Reuses the `dot` aura kind; the shared slot carries the stack count.
  stackPoison?: {
    chance: number;
    perTick: number;
    interval: number;
    duration: number;
    maxStacks: number;
    name: string;
    school?: string;
  };
  // On-death mechanic ("Death Throes"): a volatile creature does not detonate
  // the instant it dies. Its corpse destabilizes for `delay` seconds (a
  // telegraph players can run from), then bursts for min..max `school` damage
  // to everyone within `radius`. Deterministic: the fuse rides the corpse tick.
  deathThroes?: {
    min: number;
    max: number;
    radius: number;
    delay: number;
    name: string;
    school?: Aura['school'];
  };
  // Classic beast "Frenzy": when a mob with this trait dies, nearby living
  // same-family hostile mobs briefly attack faster (hasteMult, e.g. 1.3 = +30%
  // swing speed) for `duration` seconds. Applied as a buff_haste aura.
  packFrenzy?: { radius: number; hasteMult: number; duration: number };
  // Melee mechanic: a landed swing has `chance` to inflict a Mortal Wound debuff
  // that reduces all healing the victim receives by `healReduction` for `duration`.
  mortalStrike?: {
    chance: number;
    healReduction: number;
    duration: number;
    name: string;
    school?: string;
  };
  // Heal-absorb mechanic: a landed swing has `chance` to brand the victim with a
  // necrotic blight that devours the next `amount` points of incoming healing
  // (a consumable shield, not a percentage) before fading after `duration`.
  // Distinct from mortalStrike, which scales every heal down for its whole life.
  healAbsorb?: { chance: number; amount: number; duration: number; name: string; school?: string };
  // On-hit lifesteal: a landed melee swing heals the mob for `healFrac` of the
  // damage it just dealt (drowned undead, leeches, vampiric beasts). Unlike the
  // other on-hit affixes it sustains the attacker instead of debuffing the
  // victim. Optional `chance` gates the proc (defaults to every landed hit).
  lifeleech?: { healFrac: number; chance?: number; name?: string };
  // Melee mechanic: a landed swing has `chance` to land a concussive blow that
  // STUNS the victim for `duration`s (can't move, cast, or act). The single-target
  // cousin of War Stomp's AoE slam — rides the existing `stun` aura, no new kind.
  concuss?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // Melee mechanic: a landed swing has `chance` to crack the victim's guard with
  // an Expose debuff that raises the physical damage they take by `dmgIncrease`
  // (e.g. 0.15 = +15%) for `duration` seconds. Stacks multiplicatively with armor.
  expose?: { chance: number; dmgIncrease: number; duration: number; name: string; school?: string };
  // Combat mechanic: a landed melee hit has `chance` to corrode the victim's
  // armor: a stacking `sunder` debuff (up to `maxStacks`) so the victim takes
  // more physical damage from everyone until it expires. Rides the existing
  // sunder aura; no new aura kind.
  corrode?: {
    chance: number;
    armor: number;
    maxStacks: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Combat mechanic: a landed melee hit has `chance` to curse the victim with a
  // spell-vulnerability debuff (`spellvuln`) that amplifies all NON-physical
  // (magic) damage they take by `amp` (e.g. 0.15 = +15%) from every attacker for
  // `duration`. The arcane twin of `corrode` — corrode shreds armor (physical
  // mitigation); this raises magic damage taken. Holy is excluded so healing-
  // school spells stay unaffected.
  spellVuln?: {
    chance: number;
    amp: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Melee mechanic: a landed swing has `chance` to knock the victim off-balance,
  // cutting their dodge chance by `dodgeReduction` (a flat fraction, e.g. 0.05)
  // for `duration` seconds — so the attacker (and everyone else) lands more hits.
  // Rides the existing buff_dodge aura with a NEGATIVE value; no new aura kind.
  staggerHit?: { chance: number; dodgeReduction: number; duration: number; name: string };
  // On-hit web mechanic: a landed melee swing has `chance` to ensnare the struck
  // player in place — a `root` aura for `duration`s (naga/spider snares). Rides the
  // existing root aura + crowd-control DR; no new aura kind. Players only; rooting a
  // fellow mob is meaningless and would let a friendly pet trivially lock enemies.
  ensnare?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit debuff: a chance per landed crushing blow to briefly stun the victim.
  // Reuses the `stun` aura kind (same one the AoE stomp applies); players only, and
  // hostile-only so a friendly pet sharing the swing path never stuns the party.
  stunOnHit?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit debuff: a chance per landed melee swing to mire the victim, slowing
  // their ATTACK SPEED (an `attackspeed` aura, `mult` > 1 lengthens the swing
  // interval) for `duration`s. Rides the existing swingIntervalMult hook — no new
  // combat math. Distinct from a movement snare (`slow`) or an AP cut (`debuff_ap`).
  slowStrike?: {
    chance: number;
    mult: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit knockback: a landed melee swing has `chance` to physically hurl the
  // struck player `distance` yards straight away from the mob — an instantaneous
  // positional shove, not an aura. The displacement is terrain-clamped (it stops
  // before deep water and cliffs, reusing the charge-movement safety checks), so a
  // knockback can never strand the victim off the world. Players only; shoving a
  // fellow mob is meaningless and a friendly pet shares this swing path.
  knockback?: { chance: number; distance: number; name: string; school?: Aura['school'] };
  // On-hit curse ("Curse of Tongues"): a landed melee swing has `chance` to garble
  // the victim's incantations, stretching their SPELL CAST TIMES by `mult` (>1 =
  // slower) for `duration`s. Read at cast-start so it composes with the already
  // haste-resolved cast time — no new combat math. Distinct from `slowStrike` (melee
  // swing speed) and `silence` (a full spell lockout): a casting victim still casts,
  // just slower. Inert against rage/energy melee classes that never hard-cast.
  tongues?: {
    chance: number;
    mult: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit mechanic ("Mana Burn"): a landed melee swing has `chance` to drain a
  // flat `amount` of mana from a mana-using victim (casters). Rage/energy users
  // are unaffected. Drains only what mana the victim still has; no overkill.
  manaBurn?: { chance: number; amount: number; name: string; school?: Aura['school'] };
  // On-hit mechanic ("Sap Vigor"): the melee-resource twin of manaBurn. A landed
  // swing has `chance` to drain a flat `amount` of rage or energy from a melee
  // victim (warriors, rogues, feral druids), starving their ability use. Mana
  // users are unaffected. Drains only what the victim still has; no overkill.
  sapVigor?: { chance: number; amount: number; name: string; school?: Aura['school'] };
  // On-hit curse: a landed melee swing has `chance` to fog the victim's mind,
  // draining `int` Intellect for `duration` and thus shrinking a caster's mana
  // pool (recalcPlayerStats clamps current mana down with the smaller ceiling).
  // Rides the existing buff_int aura with a NEGATIVE value, so there is no new
  // resource math. Only meaningful on mana users — applied to them alone.
  enfeeble?: {
    chance: number;
    int: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit curse: a landed melee swing has `chance` to drain `sta` Stamina from
  // the victim for `duration`s, shrinking their maximum-HP pool (recalcPlayerStats
  // re-derives maxHp from Stamina and scales current HP down with the smaller
  // ceiling, clamped to a 1-HP floor — it never kills outright). Rides the
  // existing buff_sta aura with a NEGATIVE value, so there is no new HP math.
  // Affects every class (all players have Stamina), unlike enfeeble (mana only).
  enervate?: {
    chance: number;
    sta: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit disease ("plague"): a landed melee swing has `chance` to rot the
  // victim's vitality, draining `sta` Stamina for `duration`. recalcPlayerStats
  // folds the smaller Stamina through to a smaller maxHp (and current HP scales
  // down with the shrunken pool), so there is no new HP math. Rides the existing
  // buff_sta aura with a NEGATIVE value. Unlike enfeeble (casters only) it
  // afflicts everyone, since Stamina matters to every class.
  plague?: { chance: number; sta: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit curse: a landed melee swing has `chance` to wither the victim's sinews,
  // draining `agi` Agility for `duration`. Agility is a derived-stat hub — it feeds
  // armor (agi*2), dodge and crit — so a single drain shreds both the victim's
  // physical mitigation and their avoidance at once. Rides a `buff_agi` aura with a
  // NEGATIVE value (recalcPlayerStats folds it through), so there is no new stat math.
  wither?: { chance: number; agi: number; duration: number; name: string; school?: Aura['school'] };
  // Combat mechanic: a landed melee hit has `chance` to terrify the victim — a
  // fear that sends the struck player fleeing for `duration`s. Rides the existing
  // `fear_incap` incapacitate aura the player-cast Fear uses, so `updateFearMovement`
  // drives the panicked run with no new aura kind or movement hook.
  dread?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // Polymorph-on-hit (murloc oracle's hex): a landed hit can briefly turn the
  // victim into a harmless critter. Reuses the exact `polymorph` aura the mage's
  // Polymorph applies — `isStunned` locks out all actions and the aura breaks the
  // instant the victim takes damage — so no new aura kind, gating, or UI.
  polymorphHex?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit curse: a landed melee swing has `chance` to lay a curse of frailty on
  // the victim, raising all damage they take by `amp` (e.g. 0.15 = +15%) from
  // every source for `duration`s. Introduces the `vulnerability` aura kind, read
  // once in dealDamage as a damage multiplier (the offensive mirror of Defensive
  // Stance's 10% cut). Players only — amplifying a fellow mob would let a friendly
  // pet soften enemies for its owner.
  vulnerability?: {
    chance: number;
    amp: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Pet mechanic: this creature is a ranged caster (warlock Emberkin) — instead of
  // closing to melee, it stays at `range` and hurls bolts of `school` damage.
  // updatePet reads this; the bolt damage comes from the mob's weapon range.
  petRanged?: { range: number; school: Aura['school'] };
  petRole?: PetRole;
  petSpell?: {
    name: string;
    school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
    min: number;
    max: number;
    range: number;
    every: number;
    /** Telegraph seconds between the windup spellfx (the renderer starts the
     *  throw animation on it) and the actual release (projectile + damage).
     *  Eats into `every`, so the fire-to-fire cadence is unchanged; the
     *  release is committed once the windup starts. Omitted = release at the
     *  timer with no telegraph, the original behavior (warlock demon bolts). */
    windup?: number;
  };
  // On-hit mechanic: chance to silence the victim, locking out spell (non-physical) casts for a duration.
  silence?: { chance: number; duration: number; name: string; school?: string };
  // On-hit mechanic: a landed melee swing has `chance` to blind the victim,
  // adding `miss` to the chance their own melee/ranged swings whiff for
  // `duration` seconds. The flip side of `silence`: it spoils weapon attacks
  // rather than spells. The added miss chance is carried in the aura's `value`.
  blind?: { chance: number; miss: number; duration: number; name: string; school?: string };
  // On-hit mechanic ("Disarm"): a landed melee swing has `chance` to knock the
  // victim's weapon from their grip — a `disarm` aura that suppresses their
  // auto-attack (melee and ranged) for `duration` seconds. The inverse of silence:
  // silence locks out spells, disarm locks out weapon swings; movement and
  // instant abilities are untouched. Players only (only they auto-attack at the
  // primary-target swing path). Refreshes by id; never stacks.
  disarm?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit mechanic: chance to lock out a SINGLE spell school (a school-specific
  // counterspell) for a duration. Unlike `silence` (which blocks all non-physical
  // casts), only casts whose `ability.school` matches `school` are denied/broken.
  lockout?: { chance: number; duration: number; name: string; school: Aura['school'] };
  // On-hit "draining curse": a landed swing has `chance` to inflate every
  // ability the victim uses by `pct` (e.g. 0.4 = +40% resource cost) for
  // `duration` seconds — taxes mana/rage/energy alike, not a stat drain.
  costTax?: { chance: number; pct: number; duration: number; name: string; school?: string };
  // On-hit chill: a landed melee swing has `chance` to slow the victim's
  // movement to `mult` of normal for `duration` seconds (frost school). Reuses
  // the standard `slow` aura, so it rides the same movement path as Frostbolt.
  chillOnHit?: { chance: number; mult: number; duration: number; name: string };
  // On-hit affix: a successful melee hit saps the player victim's attack power
  // for a few seconds (classic Demoralizing Shout / Curse of Weakness), making
  // the damage *they* deal weaker. `ap` is the attack-power reduction (applied
  // as a negative buff_ap aura); `chance` defaults to 1 (every hit, refreshing).
  demoralize?: { ap: number; duration: number; chance?: number; name?: string };
  // On-hit curse: a landed melee swing has `chance` to siphon the victim's
  // Spirit for `duration`, slowing their out-of-combat mana/health regen
  // (updateRegen reads `stats.spi`). Rides a `buff_spi` aura with a NEGATIVE
  // value — recalcPlayerStats folds it and floors Spirit at 0, so there is no
  // new regen math. Distinct from manaBurn (one-shot mana drain) and enfeeble
  // (Intellect → mana-pool size): this attacks the REGEN axis. Only meaningful
  // on mana users; applied to them alone. Hostile mobs only (a friendly pet,
  // mobSwing's other caller, never debuffs the party).
  siphonSpirit?: {
    chance: number;
    spi: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // Innate "spiked hide" trait: melee attackers take flat damage back on every
  // connecting swing — the mob-side equivalent of the druid Thorns aura.
  thorns?: { value: number; school?: Aura['school']; name?: string };
  // Reactive "Frenzy": when this creature is WOUNDED (takes a landed player hit)
  // it has `chance` to fly into a blood frenzy, swinging faster (`hasteMult`,
  // e.g. 1.3 = +30% swing speed) for `duration`s. Rides the existing buff_haste
  // aura packFrenzy uses — no new combat math. Unlike packFrenzy (a death-rattle
  // that buffs survivors) or enrage (a fixed HP threshold), this is a per-hit
  // self-buff on the struck mob; it refreshes rather than stacks.
  frenzyOnHit?: { chance: number; hasteMult: number; duration: number; name?: string };
  // Innate "warded" trait: casters take flat damage back on every connecting
  // SPELL hit — the magic-school twin of `thorns` (which only punishes melee).
  // Reflects on any non-physical damage instance the mob survives.
  spellReflect?: { value: number; school?: Aura['school']; name?: string };
  // On-hit affix ("Weakening Hex"): a landed melee swing has `chance` to curse
  // the player victim, scaling BOTH the damage and the healing *they* deal by
  // (1 - reductionPct) for `duration` seconds. Distinct from `demoralize` (flat
  // attack-power cut, physical only) and `mortal_wound` (healing *received*):
  // this throttles the victim's whole offensive/support output — classic witch-
  // doctor / curse-of-weakness flavour. Rides a dedicated `hex` aura kind read in
  // dealDamage (outgoing) and applyHeal (outgoing).
  hex?: {
    chance: number;
    reductionPct: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit affix ("Find Weakness"): a landed melee swing has `chance` to leave the
  // victim's flesh exposed, so CRITICAL hits against them (from anyone, any school)
  // deal an extra `critDamage` fraction for `duration`s. Read once in the dealDamage
  // funnel (crit-only). Distinct from a flat-damage vuln (expose/spellvuln) — this
  // sharpens only the rare crits, the way a predator's bite finds the soft spot.
  critVuln?: {
    chance: number;
    critDamage: number;
    duration: number;
    name: string;
    school?: Aura['school'];
  };
  // On-hit purge ("Devour Magic"): a landed melee swing has `chance` to strip
  // one beneficial enhancement aura off the player victim — a positive buff_*
  // stat buff, a heal-over-time, an absorb shield, or a weapon imbue. Forms,
  // stances, stealth, and every debuff are left untouched. Removes nothing if
  // the victim carries no such buff. Players only; offensive against a fellow
  // mob is meaningless and a friendly pet (mobSwing's other caller) must never
  // strip its owner's party. Rides the existing aura system — no new aura kind.
  purgeOnHit?: { chance: number; name: string };
}

export type AbilityEffect =
  | { type: 'weaponDamage'; bonus: number } // on-next-swing bonus (heroic strike)
  | {
      type: 'weaponStrike';
      bonus: number;
      cannotBeDodged?: boolean;
      requiresBehind?: boolean;
      weaponMult?: number;
    } // instant special attack (sinister strike, overpower, backstab)
  | { type: 'directDamage'; min: number; max: number; vsRootedMult?: number }
  | { type: 'interrupt'; lockout: number }
  | { type: 'heal'; min: number; max: number } // friendly target (or self)
  | { type: 'hot'; total: number; duration: number; interval: number } // renew, rejuvenation
  | { type: 'absorb'; amount: number; duration: number } // power word: shield
  | { type: 'imbue'; bonus: number; duration: number; judgeMin?: number; judgeMax?: number } // seals / rockbiter: extra damage per swing
  | { type: 'judgement' } // consume your imbue, deal its judgement damage to the target
  | { type: 'lifeTap'; hp: number; mana: number }
  | { type: 'drainTick'; min: number; max: number; healFrac: number } // channel tick that heals the caster
  | { type: 'buffTarget'; kind: AuraKind; value: number; duration: number } // fortitude/might/mark on a friendly target
  | { type: 'finisherDamage'; base: number; perCombo: number; variance: number } // eviscerate
  | { type: 'dot'; total: number; duration: number; interval: number }
  | { type: 'slow'; mult: number; duration: number }
  | { type: 'root'; duration: number }
  | { type: 'stun'; duration: number }
  | { type: 'incapacitate'; duration: number } // gouge: breaks on damage
  | { type: 'polymorph'; duration: number } // sheep: breaks on damage, target heals
  | { type: 'aoeDamage'; min: number; max: number; radius: number }
  | {
      type: 'groundAoE';
      min: number;
      max: number;
      radius: number;
      duration: number;
      interval: number;
    }
  | { type: 'aoeAttackSpeed'; mult: number; duration: number; radius: number } // thunder clap rider
  | { type: 'aoeAttackPower'; amount: number; duration: number; radius: number } // demoralizing roar/shout
  | { type: 'aoeRoot'; duration: number; radius: number; min: number; max: number }
  | {
      type: 'selfBuff';
      kind: AuraKind;
      value: number;
      duration: number;
      // thorns auras only: a charge-limited reflect (Lightning Shield) caps how
      // many melee hits reflect, gated by an internal cooldown between reflects.
      charges?: number;
      internalCooldown?: number;
    }
  | { type: 'finisherHaste'; mult: number; basedur: number; perCombo: number } // slice and dice
  | { type: 'finisherStun'; base: number; perCombo: number } // kidney shot: stun seconds scale with combo
  | { type: 'gainResource'; amount: number } // bloodrage immediate
  | { type: 'selfDamagePctMax'; pct: number } // bloodrage cost
  | { type: 'charge' }
  | { type: 'sunder'; armor: number; maxStacks: number } // sunder armor: stacking armor debuff + flat threat
  | { type: 'taunt' } // taunt/growl: match top threat and force-attack the caster
  | { type: 'tamePet' } // hunter tame beast: the targeted mob becomes the caster's pet
  | { type: 'dismissPet' } // release the caster's pet back to the wild
  | { type: 'summonPet'; templateId: string } // warlock demon summon: creates/replaces a controlled pet
  | { type: 'summonDemon'; mobId: string }; // warlock: summon a demon pet (emberkin/gloomshade)

export interface AbilityRank {
  rank: number;
  level: number; // learned at this level
  cost: number;
  effects: AbilityEffect[];
  castTime?: number; // overrides base
  threatFlat?: number; // overrides the base threat.flat for this rank
}

export interface AbilityDef {
  id: string;
  name: string;
  class: PlayerClass;
  cost: number; // rage/mana/energy (rank 1; ranks may override)
  castTime: number; // 0 = instant
  // A cast/channel with this flag survives the player's own movement (the
  // move-input cancel skips it); talents can also grant it per-ability.
  castWhileMoving?: boolean;
  // A cast/channel with this flag cannot be stopped by interrupt effects.
  uninterruptible?: boolean;
  channel?: { duration: number; ticks: number }; // arcane missiles
  cooldown: number; // seconds, 0 = none (GCD only)
  range: number; // yards; 0 = melee range
  minRange?: number;
  // The attack travels to its target as a projectile, so its damage and effects
  // resolve when the bolt LANDS (projectile_travel), not at cast completion. Every
  // non-physical spell is a projectile by convention (keyed off school in
  // casting_lifecycle); a PHYSICAL ranged shot (hunter Aimed / Concussive Shot) must
  // set this explicitly, or it would deal its damage instantly while the arrow is
  // still visibly in flight. Melee physical attacks leave it unset.
  projectile?: boolean;
  // Overrides the flying-projectile VISUAL for this spell (the mechanic is
  // unchanged): 'lightning' draws a jagged electric bolt from caster to target
  // instead of the default glowing bolt. Renderer-only; the sim just forwards it.
  projectileFx?: 'lightning';
  school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  // Damage scaling source for the flat directDamage / DoT / AoE riders. Default:
  // non-physical damage scales with Spell Power; physical damage scales with melee
  // Attack Power (on top of the weapon/finisher paths, which already carry AP).
  // 'ranged' marks a hunter "attack spell" that scales off Ranged Attack Power
  // instead (Arcane Shot, Serpent Sting, Aimed Shot), regardless of school.
  scalesWith?: 'ranged';
  requiresTarget: boolean;
  targetType?: 'enemy' | 'friendly'; // friendly = self or allied player (defaults to enemy)
  // Ground-targeted ability: instead of an entity target, the cast is aimed at a
  // world point (the client proposes it, the server clamps it to `range`). Its area
  // effects (aoeDamage / groundAoE) center on that point. Implies requiresTarget:false.
  targetMode?: 'position';
  onNextSwing?: boolean; // heroic strike style: no GCD, queues on swing
  offGcd?: boolean;
  awardsCombo?: number; // rogue builders
  spendsCombo?: boolean; // rogue finishers
  requiresDodgeProc?: boolean; // overpower
  requiresTargetHpBelow?: number; // execute-style (fraction)
  // Classic threat riders: flat bonus threat on a successful use and/or a
  // multiplier on the damage-threat (both scale with stance/form modifiers).
  threat?: { flat?: number; mult?: number };
  requiresForm?: 'bear' | 'cat'; // druid form kit (maul/growl/swipe/claw/bite)
  // Mutually exclusive self-buff group: casting one ability in the group cancels
  // any active buff from a sibling in the same group (e.g. hunter aspects, where
  // only one aspect may be active at a time). Distinct from form toggles, which
  // are excluded by aura kind, not by group.
  exclusiveGroup?: string;
  requiresStealth?: boolean; // ambush
  requiresOutOfCombat?: boolean; // stealth
  learnLevel: number;
  effects: AbilityEffect[];
  ranks?: AbilityRank[]; // later ranks (sorted by level)
  description: string; // tooltip text, $d = damage placeholder
}

// ---------------------------------------------------------------------------
// Content shapes — zones, NPCs, camps, props, dungeons. The per-zone content
// modules in sim/content/ export records of these; sim/data.ts merges them.
// ---------------------------------------------------------------------------

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  pos: { x: number; z: number };
  facing: number;
  color: number;
  questIds: string[];
  vendorItems?: string[];
  // The Merchant: talking to this NPC opens the player-driven World Market
  // (auction house) instead of a fixed vendor stock.
  market?: boolean;
  greeting: string;
  // Registered but not surface-placed at world init. The owning system spawns
  // the entity on demand (e.g. the Nythraxis encounter walks Brother Aldric in
  // mid-fight). Keeping the def in NPCS lets the online client reconstruct its
  // questIds and treat it as a turn-in NPC.
  dynamic?: boolean;
}

export interface CampDef {
  mobId: string;
  center: { x: number; z: number };
  radius: number;
  count: number;
}

// Ground interactables (sparkle objects)
export interface GroundObjectDef {
  itemId: string;
  name: string;
  positions: { x: number; z: number }[];
}

// Gatherable world nodes (ore/wood/herb). Permanent, unowned fixtures: this
// issue is content plus visibility only, no harvest logic (see G3).
export type GatherNodeType = 'ore' | 'wood' | 'herb';

export interface GatherNodeDef {
  id: string;
  zoneId: string;
  type: GatherNodeType;
  pos: { x: number; z: number };
}

export interface DungeonSpawn {
  mobId: string;
  x: number; // relative to instance origin
  z: number;
}

export interface DungeonObjectSpawn {
  itemId: string;
  name: string;
  x: number; // relative to instance origin
  z: number;
  templateId?: 'dungeon_door' | 'dungeon_exit';
  dungeonId?: string;
}

export interface DungeonDef {
  id: string;
  name: string;
  index: number; // x-band for instance origins; must be unique
  doorPos: { x: number; z: number }; // overworld entrance portal
  overworldDoor?: boolean; // false for rooms only reached by internal instance doors
  entry: { x: number; z: number }; // player arrival point (instance-local)
  exitOffset: { x: number; z: number }; // exit portal (instance-local)
  spawns: DungeonSpawn[];
  objects?: DungeonObjectSpawn[];
  interior: 'crypt' | 'sanctum' | 'temple' | 'nythraxis'; // renderer + collider interior builder key
  suggestedPlayers: number;
  enterText: string;
  leaveText: string;
}

export type BiomeId = 'vale' | 'marsh' | 'peaks' | 'beach' | 'desert' | 'volcano' | 'cave';

export interface ZoneDef {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
  levelRange: [number, number];
  biome: BiomeId;
  hub: { x: number; z: number; radius: number; name: string };
  graveyard: { x: number; z: number };
  lakes: { x: number; z: number; radius: number }[];
  pois: { x: number; z: number; label: string }[];
  welcome: string; // chat-log hint shown on first entry
  welcomeQuestId?: string; // only show the hint while this quest is available
}

export interface BuildingDef {
  kind: 'house' | 'inn' | 'chapel';
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

// Static prop placement per zone — the renderer builds meshes from these and
// the collider grid blocks movement against them, so they must stay in sync.
export interface ZonePropsDef {
  buildings: BuildingDef[];
  wells: { x: number; z: number; r: number }[];
  stalls: { x: number; z: number; rot: number; r: number }[];
  mines: { x: number; z: number; rot: number }[];
  docks: {
    x: number;
    z: number;
    rot: number;
    hutLocal: { x: number; z: number; hw: number; hd: number };
  }[];
  tents: { x: number; z: number; rot: number; scale: number }[];
  crates: [number, number][];
  campfires: [number, number][];
  mudHuts: [number, number][];
  ruinRings: { x: number; z: number; ringR: number; columns: number }[];
  fences: { x1: number; z1: number; x2: number; z2: number }[];
  graveyards: { x: number; z: number }[]; // 6-headstone cluster anchor
  // delveId resolves to the delve's localized name at render time (the carved
  // entrance sign), so the marker carries no hardcoded English label.
  delveMarkers?: { x: number; z: number; delveId: string }[];
}

export function emptyZoneProps(): ZonePropsDef {
  return {
    buildings: [],
    wells: [],
    stalls: [],
    mines: [],
    docks: [],
    tents: [],
    crates: [],
    campfires: [],
    mudHuts: [],
    ruinRings: [],
    fences: [],
    graveyards: [],
  };
}

export interface QuestObjective {
  type: 'kill' | 'collect' | 'interact';
  targetMobId?: string; // for kill
  itemId?: string; // for collect
  targetObjectItemId?: string; // for interactable ground objects
  targetNpcId?: string; // for interactable NPC objectives
  count: number;
  label: string;
}

export interface QuestDef {
  id: string;
  name: string;
  giverNpcId: string;
  turnInNpcId: string;
  turnInNpcIds?: string[];
  text: string;
  completionText: string;
  objectives: QuestObjective[];
  xpReward: number;
  copperReward: number;
  itemRewards: Partial<Record<PlayerClass, string>>;
  requiresQuest?: string; // prerequisite quest id (must be turned in)
  requiredItems?: string[]; // quest items obtained earlier (e.g. a prerequisite reward) that this
  // quest needs; re-granted on accept if the player no longer has them, to avoid a progression block
  minLevel?: number;
  retired?: boolean; // remains finishable if already accepted, but cannot be newly accepted
  shareable?: boolean; // quest-link sharing allowed (default true; set false to opt out)
  suggestedPlayers?: number; // group quests ("Suggested players: 5")
}

export function questTurnInNpcIds(quest: QuestDef): readonly string[] {
  return quest.turnInNpcIds && quest.turnInNpcIds.length > 0
    ? quest.turnInNpcIds
    : [quest.turnInNpcId];
}

export function isQuestTurnInNpc(quest: QuestDef, templateId: string): boolean {
  return questTurnInNpcIds(quest).includes(templateId);
}

export type QuestState = 'unavailable' | 'available' | 'active' | 'ready' | 'done';

export interface QuestProgress {
  questId: string;
  counts: number[]; // per objective
  state: 'active' | 'ready' | 'done';
}

// Consumables restore their total over CONSUME_DURATION seconds while sitting,
// ticking on the classic 2-second regen tick. Food and drink run concurrently.
export const CONSUME_DURATION = 18; // seconds
export const CONSUME_TICKS = 9; // CONSUME_DURATION / 2s regen tick

export interface Consuming {
  itemId: string;
  kind: 'food' | 'drink';
  hpPer2s: number;
  manaPer2s: number;
  remaining: number;
}

export function isConsuming(e: { eating: Consuming | null; drinking: Consuming | null }): boolean {
  return e.eating !== null || e.drinking !== null;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  templateId: string; // mob/npc template id, or class for player
  name: string;
  level: number;
  guild: string;
  pos: Vec3;
  prevPos: Vec3; // for render interpolation
  facing: number; // radians, 0 = +Z
  prevFacing: number;
  // online clients only: when this entity's last wire update landed and the
  // measured update cadence — distant entities are sent below snapshot rate,
  // so each interpolates on its own clock (see ClientWorld.applySnapshot)
  netUpdatedAt?: number;
  netInterval?: number;
  vx: number; // horizontal air velocity (x, yards/sec)
  vz: number; // horizontal air velocity (z, yards/sec)
  vy: number; // vertical velocity (jumping/falling)
  onGround: boolean;
  // True while airborne from a deliberate jump (not from walking off a ledge).
  // Lets a jump clear fences for the whole arc, independent of slope.
  jumping: boolean;
  fallStartY: number;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceType: ResourceType | null;
  overheadEmoteId: OverheadEmoteId | null;
  overheadEmoteUntil: number;
  overheadEmoteSeq: number;
  stats: Stats;
  weapon: WeaponInfo;
  attackPower: number;
  rangedPower: number; // hunters: ranged attack power
  spellPower: number; // casters: added to spell damage via per-spell coefficients
  // Haste fractions from item-set bonuses (0 = none). Melee/ranged haste speed up
  // the respective auto-attack swing; spell haste shortens cast and channel time.
  meleeHaste: number;
  rangedHaste: number;
  spellHaste: number;
  setProcs: SetProc[];
  procReadyAt: Record<string, number>;
  critChance: number; // 0..1
  critRating: number; // accumulated crit rating from gear + set bonuses
  hasteRating: number; // accumulated haste rating from gear + set bonuses
  dodgeChance: number;
  castPushbackReduction: number; // 0..1: damage cast-pushback removed by item-set bonuses (1 = immune)
  knockbackResistance: number; // 0..1: on-hit knockback distance resisted by item-set bonuses (1 = immune)
  moveSpeed: number;
  hostile: boolean;
  // combat
  targetId: number | null;
  autoAttack: boolean;
  swingTimer: number;
  /** petSpell windup in flight: sim tick the committed release fires on
   *  (transient combat state like swingTimer; never persisted or wired). */
  rangedWindupReleaseTick?: number | null;
  inCombat: boolean;
  combatTimer: number; // time since last combat event
  auras: Aura[];
  // cached `auras.some(a => a.kind === 'stealth')`, refreshed in updateAuras.
  // Hosts read it per interest-scan visit (O(viewers x neighbors)); recomputing
  // it from auras each visit was a measurable cost in crowds.
  stealthed: boolean;
  ccDr: Map<CrowdControlDrCategory, CrowdControlDrState>;
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  // Entity-targeted casting: the target captured at cast start for entity-targeted
  // casts (hostile and friendly) and channels. Timed casts and channel ticks resolve
  // against this id, so retargeting mid-cast/mid-channel cannot redirect the spell,
  // and clearing your target no longer cancels a channel. The channel still cancels
  // if the locked target dies or turns non-hostile.
  castTargetId: number | null;
  // Ground-targeted casting: the world point a `targetMode: 'position'` ability is
  // aimed at, captured (server-clamped to range) when the cast begins and read by
  // its area effects when it resolves. null for normal entity/self casts.
  castAim: Vec3 | null;
  channeling: boolean;
  channelTickTimer: number;
  channelTickEvery: number;
  gcdRemaining: number;
  cooldowns: Map<string, number>;
  queuedOnSwing: string | null; // heroic strike
  queuedOnSwingFree?: boolean; // next_cast_free consumed at queue time
  fiveSecondRule: number; // time since last mana spend
  comboPoints: number; // retail-style: character-bound, not anchored to a target
  comboUntil: number; // sim-time until which unspent combo points persist
  overpowerUntil: number; // sim-time until which overpower is usable
  potionCooldownUntil: number; // sim-time until a combat potion can be used again (#103)
  // Same shared potion cooldown as REMAINING seconds, materialized per tick (like
  // gcdRemaining) so the action bar can paint a cooldown swipe without a client
  // clock. Derived from potionCooldownUntil; excluded from the parity trace.
  potionCdRemaining: number;
  // warrior charge: forced run toward the target along a pathfound route
  chargeTargetId: number | null;
  chargeTimeLeft: number; // seconds; failsafe so a blocked charge can't run forever
  chargePath: Vec3[]; // waypoints consumed front-to-back; last leg homes on the live target
  followTargetId: number | null; // /follow: auto-walk after another player until interrupted
  savedMana: number; // druid forms: mana put aside while running on rage/energy
  sitting: boolean;
  eating: Consuming | null;
  drinking: Consuming | null;
  // mob AI
  aiState: AiState;
  tappedById: number | null; // first player to damage this mob owns loot/xp/quest credit
  /** Classic-style hate table: attacker entity id (player or pet) -> threat.
   *  Wiped on evade/respawn/death; drives target selection with the 110%
   *  melee / 130% ranged pull-over rules. */
  threat: Map<number, number>;
  forcedTargetId: number | null; // taunt/growl: attack this target while the timer runs
  forcedTargetTimer: number; // seconds left on the forced-attack window
  ownerId: number | null; // controlled pets: owning player's entity id (null = wild)
  petMode: PetMode; // hunter pet behavior stance
  petTauntTimer: number; // controlled pet Growl cooldown
  petAutoTaunt?: boolean; // right-click autocast toggle for controlled pet Growl
  petManualTauntPending?: boolean; // manual Growl command waiting until the pet reaches range
  petPath: Vec3[]; // controlled pet heel route around obstacles; consumed front-to-back (like chargePath)
  petPathCooldown: number; // seconds until this pet may recompute its heel path again
  pulseTimer: number; // boss aoe pulse countdown
  stompTimer: number; // boss War Stomp stun-pulse countdown
  bigCastTimer: number; // boss telegraphed-hardcast (bigCast) cadence countdown
  yelledEngage: boolean; // engage bark fired this pull (reset on evade/respawn)
  stoneskinTimer: number; // periodic self-absorb barrier countdown
  terrifyTimer: number; // Banshee's Wail fear-pulse countdown
  aoeSlowTimer: number; // Howling Gale anti-kite snare-pulse countdown
  loudYellTimer: number; // battle-cry (loud boss) bark countdown
  loudYellIndex: number; // next battle-cry line to bark (cycles through battleYells.lines)
  detonateTimer: number; // Death Throes fuse on a volatile corpse; Infinity = no pending detonation
  mendTimer: number; // mendAlly support-heal cast countdown
  wardTimer: number; // wardAllies support-shield cast countdown
  rallyTimer: number; // rally commander-buff cast countdown
  warcryTimer: number; // warcry ally-haste pulse countdown
  firedSummons: number; // summonAdds thresholds already triggered
  summonedIds: number[]; // live adds this boss summoned; despawned on reset
  enraged: boolean; // enrage mechanic active
  healedThisPull: boolean; // desperation self-heal already used this pull
  nythraxis?: NythraxisEncounterState; // sim-only state for the Nythraxis raid encounter
  spawnPos: Vec3;
  leashAnchor: Vec3 | null; // refreshed by hostile player/pet actions; spawnPos remains the true home
  evadeStall: number; // seconds an evading mob has failed to get closer to home; snaps it home if it can't path back (e.g. across water)
  fleeTimer: number; // seconds left in a low-HP panic flee; counts down in the 'flee' state
  fleeReturnTimer: number; // grace after a panic flee hits leash edge, letting it run back before normal leash reset resumes
  hasFled: boolean; // a cowardly mob flees only once per pull; cleared when it resets at spawn
  wanderTarget: Vec3 | null;
  wanderTimer: number;
  aggroTargetId: number | null;
  /** GM character: invulnerable (dealDamage no-ops). Server-set from the
   *  characters.is_gm column; never user-settable. */
  gm?: boolean;
  /** True for a mob spawned BY a delve affix (e.g. Restless Graves' Raised
   *  Bonewalker). Affix re-trigger checks exclude these so an affix-spawned mob's
   *  own death can never re-trigger the same affix (would otherwise chain forever). */
  affixSpawned?: boolean;
  respawnTimer: number;
  corpseTimer: number;
  lootFfaTimer: number; // seconds of owner-lock left before tap loot opens to all (FFA); Infinity until rollLoot starts it
  // Profession harvest: single-use, first-come claim on this corpse's componentTags
  // yield. null = unharvested; once set to a player's entity id, every later attempt
  // (same tick or later) is denied. The opposite of a world gathering node (per-player).
  // SERVER-PRIVATE today: no snapshot delta mirrors it, so the online ClientWorld
  // always reads null (src/net/online.ts blankEntity). Mirror it over the wire
  // before any UI/render consumer reads it through IWorld.
  harvestClaimedBy: number | null;
  despawnTimer?: number;
  damageIdleDespawnTimer?: number;
  lootable: boolean;
  loot: CorpseLoot | null;
  lootRecipientIds?: number[];
  xpValue: number;
  // npc
  questIds: string[];
  vendorItems: string[];
  // object (ground interactable)
  objectItemId: string | null;
  dungeonId: string | null; // set on dungeon door/exit portals
  // misc
  dead: boolean;
  // Ghost/spirit state for the WoW-style death -> corpse-run -> resurrect loop.
  // `ghost` is true once the player has released their spirit: `dead` stays true
  // (a ghost still cannot fight or be attacked) but the spirit CAN move, runs at a
  // boosted speed, and is rendered translucent. `corpsePos` marks where the body
  // fell so the client can draw a corpse marker and the server can gate
  // resurrect-at-corpse on range. Both inert (false / null) for the living and for
  // every non-player entity. Owned by src/sim/spirit.ts.
  ghost: boolean;
  corpsePos: Vec3 | null;
  scale: number;
  color: number;
  skinCatalog: SkinCatalog; // player appearance catalog: class texture set or cosmetic body.
  skin: number; // player appearance: index into SKINS[visualKey]; 0 = default. synced in identity fields.
  // Equipped mainhand item id (players only; null otherwise). Render-only: the
  // client maps it to a held weapon model. Recomputed in recalcPlayerStats and
  // synced in identity fields (terse `mh`). The sim never reads it for gameplay.
  mainhandItemId: string | null;
  // Full worn equipment (players only; empty otherwise). Render-only mirror of
  // PlayerMeta.equipment, recomputed in recalcPlayerStats and synced in identity
  // fields (terse `eq`) so another player can be inspected. Like mainhandItemId,
  // the sim never reads it for gameplay (no effect on stats).
  equippedItems: Partial<Record<EquipSlot, string>>;
  // $WOC holder-tier flair (cosmetic): 0/undefined = none, 1-10 = Ember…Sovereign.
  // Set server-side from the player's connected-wallet balance and synced in
  // identity fields like skin. The sim never reads it (no gameplay effect).
  holderTier?: number;
  // Exact $WOC balance backing the tier, for the inspect-profile readout. Rides
  // alongside holderTier in identity fields; like it, the sim never reads it.
  holderBalance?: number;
  // Linked-Discord flair (cosmetic, server-set from the account's Discord link;
  // the sim never reads any of it): status tier, profile-picture URL, handle/
  // nickname, server-join epoch ms (for "member since"), and top staff/special
  // role key (drives the in-world name color + tag).
  discordTier?: number;
  discordAvatar?: string;
  discordName?: string;
  discordJoined?: number;
  discordRole?: string;
  // Developer-badge flair (cosmetic, server-set from a verified GitHub link plus
  // the repo's merged-PR stats; the sim never reads any of it): the tier index
  // (0/undefined = none, 1-5 = Tinkerer…Worldwright), the count of merged pull
  // requests backing it (for the inspect/card readout), and the GitHub login
  // (for the inspect readout and the public profile link).
  devTier?: number;
  devMergedPrs?: number;
  githubLogin?: string;
}

export interface NythraxisWardChannel {
  objectId: number;
  playerId: number | null;
  remaining: number;
  complete: boolean;
}

export interface NythraxisSoulRendMark {
  playerId: number;
  remaining: number;
}

export interface NythraxisDialogueCue {
  at: number;
  speaker: 'nythraxis' | 'aldric';
  text: string;
}

export interface NythraxisEncounterState {
  phase: 1 | 'transition' | 2 | 'dead';
  introSpoken: boolean;
  transitionStarted: boolean;
  transitionTimer: number;
  transitionCues: NythraxisDialogueCue[];
  transitionReleased: boolean;
  dialogueBusyUntil?: number;
  dialogueToken?: number;
  gravebreakerTimer: number;
  gravebreakerCasts?: number;
  raiseFallenTimer: number;
  soulRendTimer: number;
  soulRendMarks: NythraxisSoulRendMark[];
  soulRendLockout: number;
  deathlessTimer: number;
  deathlessCastRemaining: number;
  deathlessStunRemaining: number;
  wardChannels: NythraxisWardChannel[];
  finalStand: boolean;
  deathSpoken: boolean;
}

export type ErrorReason = 'target_dead';

// Ravenpost mail command outcomes. `sent`/`collected` are successes; the rest
// are refusals. The client maps each code to its localized line (the sim never
// emits mail text).
export type MailResultCode =
  | 'sent'
  | 'collected'
  | 'tooFar'
  | 'needRecipient'
  | 'noRecipient'
  | 'tooManyParcels'
  | 'noMailQuestItems'
  | 'notEnoughItems'
  | 'cantAffordPostage'
  | 'recipientBoxFull'
  | 'letterGone'
  | 'takeParcelsFirst';

// Guild calendar command outcomes (mirrors server/social.ts CalendarResultCode;
// `created`/`removed` are successes, the rest refusals).
export type CalendarResultCode =
  | 'created'
  | 'removed'
  | 'notInGuild'
  | 'notOfficer'
  | 'badInput'
  | 'calendarFull'
  | 'eventGone';

// `pid` (when present) marks a personal event that should only be delivered to
// that player entity's owner; events without pid are world-visible.
export type SimEvent = { pid?: number } & (
  | {
      type: 'damage';
      sourceId: number;
      targetId: number;
      amount: number;
      crit: boolean;
      school: string;
      ability: string | null;
      kind: 'hit' | 'miss' | 'dodge' | 'parry' | 'resist';
    }
  | { type: 'heal'; targetId: number; amount: number }
  | { type: 'death'; entityId: number; killerId: number }
  | { type: 'xp'; amount: number; rested?: number }
  | { type: 'levelup'; level: number }
  // post-cap cosmetic progression (Max-Level XP Overflow): crossing a virtual
  // level past the cap, and unlocking a cosmetic lifetime-XP milestone
  | { type: 'virtualLevelUp'; level: number }
  | { type: 'milestoneUnlocked'; milestoneId: string }
  | { type: 'learnAbility'; abilityId: string; rank: number }
  | { type: 'loot'; text: string }
  | {
      type: 'lootRoll';
      rollId: number;
      itemId: string;
      itemName: string;
      quality: ItemDef['quality'];
      expiresAt: number;
    }
  // master loot: sent only to the master looter; candidates are the eligible recipients
  | {
      type: 'masterLoot';
      rollId: number;
      itemId: string;
      itemName: string;
      quality: ItemDef['quality'];
      expiresAt: number;
      candidates: { pid: number; name: string }[];
    }
  | { type: 'error'; text: string; reason?: ErrorReason }
  | { type: 'questAccepted'; questId: string }
  | { type: 'questProgress'; questId: string; text: string }
  | { type: 'questReady'; questId: string }
  | { type: 'questDone'; questId: string }
  | { type: 'aura'; targetId: number; name: string; gained: boolean }
  | { type: 'castStart'; entityId: number; ability: string; time: number }
  | { type: 'castStop'; entityId: number; success: boolean }
  | { type: 'comboPoint'; points: number }
  | { type: 'playerDeath' }
  | { type: 'respawn' }
  // itemId names the single item for buy/sell/buyback; it is omitted for the
  // bulk "sell all junk" sweep, which the client treats as a plain refresh signal.
  | { type: 'vendor'; action: 'buy' | 'sell' | 'buyback'; itemId?: string }
  // Ravenpost mail. Structured data only, the client builds every visible
  // string (the lockpick convention). `mailbox` asks the client to open the
  // mail window (the interact path at a mailbox object); `mailArrived` is the
  // personal arrival cue (envelope toast + sound); `mailResult` reports a mail
  // command's outcome (`sent` carries the recipient name + postage in copper,
  // `collected` the coin taken, `tooManyParcels` the attachment cap). All
  // always carry pid.
  | { type: 'mailbox' }
  | { type: 'mailArrived'; senderName: string; letterId?: string }
  | { type: 'mailResult'; code: MailResultCode; value?: number; name?: string }
  // Guild calendar outcome. Emitted only by the server's SocialService (the
  // sim never books guild events); declared here so the one client event
  // switch stays exhaustively typed.
  | { type: 'calendarResult'; code: CalendarResultCode }
  // say/yell are delivered only to players in range and carry the speaker's
  // entity id so the client can hang a chat bubble over their head; whisper
  // goes to the target (and echoes to the sender with `to` set); general is
  // a world-wide broadcast
  | {
      type: 'chat';
      fromPid: number;
      from: string;
      text: string;
      channel?:
        | 'say'
        | 'yell'
        | 'whisper'
        | 'general'
        | 'party'
        | 'guild'
        | 'officer'
        | 'world'
        | 'lfg'
        | 'emote'
        | 'roll';
      entityId?: number;
      to?: string;
    }
  | { type: 'partyInvite'; fromPid: number; fromName: string }
  // a guild invitation from an online guild officer/leader; resolved by name
  // server-side so it carries no pid
  | { type: 'guildInvite'; fromName: string; guildName: string }
  | { type: 'tradeRequest'; fromPid: number; fromName: string }
  | { type: 'tradeDone' }
  | { type: 'duelRequest'; fromPid: number; fromName: string }
  | { type: 'duelCountdown'; seconds: number }
  | { type: 'duelStart' }
  | { type: 'duelEnd'; winnerName: string; loserName: string }
  // Ashen Coliseum arena: queue state, match lifecycle, and rating result
  | { type: 'arenaQueued'; position: number; format: ArenaFormat }
  | { type: 'arenaUnqueued' }
  | {
      type: 'arenaFound';
      format: ArenaFormat;
      oppName: string;
      oppClass: PlayerClass;
      oppLevel: number;
      allies: ArenaCombatant[];
      enemies: ArenaCombatant[];
    }
  | { type: 'arenaCountdown'; seconds: number }
  | { type: 'arenaStart' }
  | {
      type: 'arenaEnd';
      format: ArenaFormat;
      won: boolean;
      draw: boolean;
      oppName: string;
      ratingBefore: number;
      ratingAfter: number;
      allies: ArenaCombatant[];
      enemies: ArenaCombatant[];
    }
  // 2v2 Fiesta party mode. All carry pid (personal — delivered to each combatant).
  // `fiestaScore`: the running team tally changed. `fiestaWave`: a new augment
  // wave just opened. `fiestaWord`: an exaggerated word-pop cue (the client maps
  // `flavor` to a localized exclamation). `fiestaDown`: you were dropped and will
  // respawn in `seconds`. `augmentOffer`: pick one of these augment ids.
  // `augmentChosen`: a fighter locked in an augment (own or ally, for flavor).
  | { type: 'fiestaScore'; a: number; b: number; limit: number; team: 'A' | 'B' }
  | { type: 'fiestaWave'; wave: number; totalWaves: number }
  | {
      type: 'fiestaWord';
      flavor: 'firstblood' | 'kill' | 'doublekill' | 'spree' | 'shutdown' | 'revived' | 'ringclose';
      n?: number;
    }
  | { type: 'fiestaDown'; seconds: number }
  | { type: 'augmentOffer'; tier: 'silver' | 'gold' | 'prismatic'; wave: number; choices: string[] }
  | { type: 'augmentChosen'; augmentId: string; byPid: number; byName: string; mine: boolean }
  // A fighter grabbed a ring power-up (world event so everyone sees the glow).
  // Whether it's "mine" is decided client-side (entityId === local player).
  | { type: 'fiestaPowerup'; entityId: number; defId: string; glow: number; duration: number }
  | {
      type: 'heal2';
      sourceId: number;
      targetId: number;
      amount: number;
      crit: boolean;
      ability: string;
    }
  // visual-only cue for the renderer: spell projectiles, channel beams, dot
  // ticks, aoe novas, and the ranged-mob windup telegraph ('windup' fires at
  // the START of a petSpell windup so the throw animation leads the release;
  // the 'projectile' for the same throw follows petSpell.windup later).
  | {
      type: 'spellfx';
      sourceId: number;
      targetId: number;
      school: string;
      fx: 'projectile' | 'beam' | 'tick' | 'nova' | 'windup' | 'lightning';
    }
  // visual-only cue anchored to a WORLD POINT rather than an entity: a
  // ground-targeted spell's impact (the burst/nova lands where it was aimed, not
  // on the caster). The renderer drapes it onto the terrain at (x, z).
  | {
      type: 'spellfxAt';
      x: number;
      z: number;
      school: string;
      fx: 'burst' | 'nova';
      // blast radius in yards; when set the renderer flashes a terrain-draped
      // AoE ring of this size under the burst so the impact area reads clearly
      radius?: number;
    }
  // entityId (when set) anchors the log to that entity so the server only
  // delivers it to nearby players; anchorless logs broadcast server-wide
  | { type: 'log'; text: string; color?: string; entityId?: number }
  | { type: 'delveEntered'; delveId: string; tierId: string }
  | { type: 'delveObjectiveComplete'; delveId: string; tierId: string }
  | { type: 'delveComplete'; delveId: string; tierId: string }
  | { type: 'delveFailed'; delveId: string; tierId: string }
  | { type: 'delveLoreUnlock'; loreId: string }
  | { type: 'companionBark'; barkId: string; companionId: string; pid?: number }
  // Lockpicking minigame ("Tumbler's Path"). All personal (pid-scoped). The sim
  // emits structured data only, the client builds every visible string. Cells
  // are always limited to the fog window (anti-cheat: the full lock is never
  // serialized).
  | { type: 'lockpickOffer'; objectId: number; bountiful: boolean }
  | {
      type: 'lockpickSession';
      sessionId: string;
      objectId: number;
      w: number;
      h: number;
      col: number;
      row: number;
      page: number;
      pageCount: number;
      tries: number;
      triesTotal: number;
      lootTier: LootTier;
      allowed: Exclude<PickAction, 'abort'>[];
      visible: VisibleCell[];
      stepTimeoutMs: number | null;
    }
  | {
      type: 'lockpickStep';
      sessionId: string;
      col: number;
      row: number;
      page: number;
      pageCount: number;
      tries: number;
      triesTotal: number;
      result: StepResult;
      visible: VisibleCell[];
    }
  | {
      type: 'lockpickEnd';
      sessionId: string;
      outcome: 'success' | 'fail' | 'abandoned';
      lootTier?: LootTier;
    }
  | { type: 'lockpickBonus'; tier: LootTier; marks: number; copper: number }
  | {
      type: 'delveChestLoot';
      chestId: number;
      delveId: string;
      tierId: string;
      lootTier: LootTier;
      bountiful: boolean;
      items: { itemId: string; count: number }[];
    }
  // Carries the shrine as `entityId` so the server's eventAnchor interest-scopes
  // the pulse to players near the apse instead of broadcasting it realm-wide
  // (the HUD closes the rite popup on the first pulse).
  | { type: 'delveRitePulse'; entityId: number; shrineKind: RiteShrineKind }
  | {
      type: 'delveRiteFeedback';
      shrineId: number;
      shrineKind: RiteShrineKind;
      correct: boolean;
    }
  // Personal cue (carries `pid`) to open the rite difficulty popup when a player
  // interacts with the risen reliquary before choosing. Text-free: the client
  // renders its own localized copy, so no sim/server i18n matcher rule is needed.
  | { type: 'delveRiteChoosePrompt'; reliquaryId: number }
  // personal cue (carries `pid`) to open the cosmetic skin-select overlay with
  // the server-rolled rank. Text-free on purpose — the client renders its own
  // localized copy, so no sim/server i18n matcher rule is needed.
  | { type: 'skinEvent'; rank: SkinRank; catalog?: SkinCatalog }
  // Common-tier crafting outcome (#1127): mirrors CraftResult so the online
  // client can reflect the local result of a craftItem command without
  // deciding it itself. Text-free on purpose (see skinEvent above): the
  // client renders its own localized copy off the structured fields.
  | {
      type: 'craftResult';
      ok: boolean;
      recipeId: string;
      itemId?: string;
      count?: number;
      quality?: ItemDef['quality'];
      reason?: 'unknown_recipe' | 'insufficient_materials' | 'combo_requirement_unmet';
    }
);

export interface MoveInput {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  jump: boolean;
}

// A bounded height edit (the sculpt brush stamp), applied inside terrainHeight()
// exactly like MIREFEN_IMPACT_CRATER. Pure data, no RNG: the sim and renderer both
// sample it so collision and the ground mesh stay in agreement. Stamps apply in
// array order: `add` (default) adds `delta`, weighted by the falloff; `level`
// pulls the height toward the ABSOLUTE height `delta`, weighted by the falloff
// (the flatten/plateau brush; full weight means h becomes exactly `delta`).
export interface HeightStamp {
  x: number;
  z: number;
  radius: number;
  delta: number; // add: +raise / -lower at the centre; level: target height
  falloff: 'smooth' | 'flat';
  mode?: 'add' | 'level'; // absent = 'add' (v1 documents)
}

// A freely placed GLB model the editor drops onto the world. Rendered by the
// placed-asset instancer (never a Sim entity); when `collideRadius` is set (> 0)
// the sim additionally derives a static circle collider from this record, so
// what-you-see-is-what-you-collide-with holds for editor placements too.
// Carried on WorldContent so both sides read the SAME record.
export interface PlacedAsset {
  path: string; // public GLB url, e.g. "/models/props/well.glb"
  x: number;
  z: number;
  rotY: number; // radians
  scale: number;
  // Circle collider radius in yards (already scaled), or absent/0 for walk-through.
  collideRadius?: number;
}

// An invisible blocker wall (editor-authored, custom maps only): a world-space
// XZ segment the sim turns into a fence-width OBB collider at playtest. Pure
// collision data; there is NO render mesh for it in the shipped game, so map
// makers can wall off areas without visible geometry.
export interface BlockerDef {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

// A coarse 2D biome paint grid (editor). Each cell holds a biome id (0=vale,
// 1=marsh, 2=peaks) or 255 for unpainted. Where painted, it overrides both the
// terrain SHAPE (sim, in shapeAt) and the ground COLOR (render). Absent for the
// built-in world, so terrain stays byte-identical.
export interface BiomePaint {
  cell: number; // cell size in yards
  cols: number;
  rows: number;
  originX: number; // world x of the grid's (col 0) edge
  originZ: number; // world z of the grid's (row 0) edge
  ids: number[]; // length cols*rows; 0/1/2 = biome, 255 = unpainted
}

// A swappable world definition: the spatial + content data the terrain function
// and the Sim spawn loop derive a playable world from. The built-in 3-zone world
// is one of these (data.ts BUILTIN_WORLD); the map editor produces custom ones for
// offline play-testing. Injected via SimConfig.world plus the data.ts active-content
// registry (both, because terrain reaches the data by module global and the Sim
// reaches it by config). CAMPS order is a determinism contract: append, never
// reorder, since the Sim draws the shared Rng in array order.
export interface WorldContent {
  zones: ZoneDef[];
  camps: CampDef[];
  npcs: Record<string, NpcDef>;
  groundObjects: GroundObjectDef[];
  roads: { x: number; z: number }[][];
  props: ZonePropsDef;
  playerStart: { x: number; z: number };
  // Heightfield edits applied inside terrainHeight(). Absent/empty for the
  // built-in world, so its heightfield stays byte-identical.
  terrainEdits?: HeightStamp[];
  // Freely placed GLB models (editor). Rendered by the placed-asset instancer;
  // records with collideRadius also feed the sim's static colliders.
  placements?: PlacedAsset[];
  // Invisible blocker walls (editor). Collision-only OBBs in the sim's static
  // colliders; never rendered. Absent for the built-in world.
  blockers?: BlockerDef[];
  // 2D biome paint overriding terrain shape (sim) and color (render).
  biomePaint?: BiomePaint;
  // Water surface height for this map; absent = the built-in WATER_LEVEL (-4.5).
  // Read through waterLevel() in src/sim/world.ts, never directly.
  waterLevel?: number;
}

export interface SimConfig {
  seed: number;
  playerClass: PlayerClass;
  respawnSeconds?: number; // mob respawn time (default 25)
  autoEquip?: boolean; // auto-equip better gear on loot (headless convenience)
  playerName?: string;
  noPlayer?: boolean; // multiplayer server: start with an empty world and addPlayer() later
  devCommands?: boolean; // local dev: /dev level|tp|give chat cheats
  lockoutNowMs?: () => number; // host wall-clock for persisted raid lockouts
  // Live server: schedule the first world-boss rise at boot instead of one
  // interval out, so a freshly (re)started realm has Thunzharr up immediately.
  // Offline worlds and parity traces keep the default (first rise after one
  // interval), so this never fires inside a short deterministic scenario.
  worldBossAtBoot?: boolean;
  // Host-computed next raid-reset instant for a given lockout "now" (epoch ms). The
  // authoritative server uses its realm-local 3 AM daily reset; offline/headless omit
  // this and fall back to a flat 24h day. Keeps the time zone out of the sim core.
  raidResetMs?: (nowMs: number) => number;
  // Offline play-test: a custom world to run instead of the built-in one. The Sim
  // ctor reads spawns from here; render/terrain read it via the data.ts registry,
  // so callers that set this MUST also call setActiveWorldContent() with content
  // whose terrain-relevant fields are identical (see the sim.ts ctor invariant).
  world?: WorldContent;
  // Optional per-phase timing hook: tick() calls this after each internal phase and
  // the HOST owns the clock, attributing the elapsed time since its previous mark to
  // `phase` (keeps wall-clock reads out of the sim, per the determinism guard). The
  // server injects it to feed its tick profiler during an on-demand capture; undefined
  // offline/headless, so the sim draws no wall clock in a deterministic scenario.
  perfLap?: (phase: string) => void;
}

export function emptyMoveInput(): MoveInput {
  return {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
  };
}

export function dist2d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x,
    dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function angleTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function normAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------------------------------------------------------------------------
// Classic progression formulas
// ---------------------------------------------------------------------------

// XP required to go from level L to L+1 (classic-era curve values, levels 1..20)
export const XP_TABLE = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000,
  17700, 19400, 21300, 23200,
];
export const MAX_LEVEL = 20;

// Shared sim constants relocated here (C1) so both sim.ts and the extracted damage
// core (src/sim/combat/damage.ts) can import them without a sim.ts cycle.
export const PARTY_XP_RANGE = 80; // yards: members this close share kill xp/credit
// Nythraxis raid boss template id. Used by the damage-core death path (lockout on
// boss death) and the still-on-Sim encounter logic; N1 may re-home it when it owns
// the encounter. Kept here as the neutral shared seam in the meantime.
export const NYTHRAXIS_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
// The Drowned Litany finale boss. Used by the drowned_litany_boss driver.
export const SISTER_NHALIA_BOSS_ID = 'sister_nhalia_drowned_canticle';
// The Tolling Bells projectile mob (Drowned Litany finale): moved exclusively by
// the boss driver. Shared with mob/locomotion.ts so the AI dispatcher skips it.
export const TOLLING_BELL_TEMPLATE_ID = 'tolling_bell';

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.min(level - 1, XP_TABLE.length - 1)];
}

// ---------------------------------------------------------------------------
// Post-cap progression — "Max-Level XP Overflow" (see docs/prd/…).
//
// At the level cap, XP keeps accruing into a 64-bit lifetime counter that
// drives a cosmetic *virtual level* so the XP bar keeps "leveling" forever.
// The threshold table below is the cumulative lifetime XP needed to reach each
// virtual level. Real levels 1..20 reuse XP_TABLE exactly (so below the cap
// `virtualLevel(lifetimeXp) === level`); past the cap the per-level cost keeps
// growing geometrically (RuneScape-style ~10%/level) so the grind has a long
// tail but the bar always visibly moves. Built once and cached.
// ---------------------------------------------------------------------------

const POSTCAP_GROWTH = 1.1; // each virtual level past the cap costs ~10% more
export const MAX_VIRTUAL_LEVEL = 200; // table bound; far beyond any reachable lifetime total

// VLEVEL_CUM[v] = total lifetime XP required to *reach* virtual level v.
// VLEVEL_CUM[1] = 0; index 0 is unused padding.
const VLEVEL_CUM: number[] = (() => {
  const cum: number[] = [0, 0];
  let total = 0;
  // real levels: 1→2 … 19→20 come straight from XP_TABLE
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    total += XP_TABLE[lvl - 1];
    cum[lvl + 1] = total;
  }
  // post-cap: continue from the 20→21 step, growing geometrically
  let step = XP_TABLE[MAX_LEVEL - 1];
  for (let lvl = MAX_LEVEL; lvl < MAX_VIRTUAL_LEVEL; lvl++) {
    total += Math.round(step);
    cum[lvl + 1] = total;
    step *= POSTCAP_GROWTH;
  }
  return cum;
})();

// Total lifetime XP needed to reach a given (virtual or real) level. Used to
// backfill `lifetimeXp` for characters saved before the counter existed.
export function xpToReachLevel(level: number): number {
  return VLEVEL_CUM[Math.max(1, Math.min(MAX_VIRTUAL_LEVEL, Math.floor(level)))];
}

// Cosmetic virtual level for a lifetime-XP total. Below the cap this equals the
// real level; at/after the cap it climbs past MAX_LEVEL. O(log n) over the
// cached table — never recomputed per frame, never per combat tick.
export function virtualLevel(lifetimeXp: number): number {
  const xp = Math.max(0, lifetimeXp);
  let lo = 1,
    hi = MAX_VIRTUAL_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (VLEVEL_CUM[mid] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Progress within the current virtual level: how much lifetime XP into it, and
// how much that level costs in total. Pre-cap callers use the level bar instead.
export function virtualLevelProgress(lifetimeXp: number): {
  level: number;
  into: number;
  span: number;
} {
  const level = virtualLevel(lifetimeXp);
  const floor = VLEVEL_CUM[level];
  const next = VLEVEL_CUM[Math.min(level + 1, MAX_VIRTUAL_LEVEL)];
  const span = Math.max(1, next - floor);
  return { level, into: Math.max(0, Math.min(span, lifetimeXp - floor)), span };
}

// Cosmetic lifetime-XP milestones (Paragon-style). Strictly cosmetic — they
// grant titles / nameplate borders, never power. Ordered by threshold.
export interface MilestoneDef {
  id: string;
  lifetimeXp: number;
  kind: 'title' | 'border';
}
export const MILESTONES: MilestoneDef[] = [
  { id: 'veteran', lifetimeXp: 250_000, kind: 'title' },
  { id: 'champion', lifetimeXp: 500_000, kind: 'title' },
  { id: 'paragon', lifetimeXp: 1_000_000, kind: 'border' },
  { id: 'mythic', lifetimeXp: 2_500_000, kind: 'border' },
  { id: 'eternal', lifetimeXp: 5_000_000, kind: 'title' },
];

// Prestige cost. Each prestige rank requires a full level-cap bar's worth of
// post-cap lifetime XP, so prestige rank is a pure function of XP actually
// earned past the cap. This is the anti-abuse guard: the prestige command can't
// be spammed from a hacked client to inflate the (leaderboard-visible) rank —
// the server caps rank at maxPrestigeRank(lifetimeXp) regardless of how many
// prestige commands arrive.
export const PRESTIGE_XP_PER_RANK = xpForLevel(MAX_LEVEL); // = 23,200

// Highest prestige rank the given lifetime XP can support (post-cap XP / cost).
export function maxPrestigeRank(lifetimeXp: number): number {
  const earned = lifetimeXp - xpToReachLevel(MAX_LEVEL);
  return earned <= 0 ? 0 : Math.floor(earned / PRESTIGE_XP_PER_RANK);
}

// Authoritative prestige eligibility: at the cap, and with enough unspent
// post-cap XP for the next rank. Used server-side (enforced) and client-side
// (to enable/disable the button — display only).
export function canPrestige(level: number, lifetimeXp: number, prestigeRank: number): boolean {
  return level >= MAX_LEVEL && prestigeRank < maxPrestigeRank(lifetimeXp);
}

// Lifetime XP still needed before the next prestige rank unlocks (0 if ready).
export function xpUntilNextPrestige(lifetimeXp: number, prestigeRank: number): number {
  const target = xpToReachLevel(MAX_LEVEL) + (prestigeRank + 1) * PRESTIGE_XP_PER_RANK;
  return Math.max(0, target - lifetimeXp);
}

// Zero-difference band: how many levels below you a mob stops giving XP.
// Classic-era rule: ZD = 5 for player level 1-7, 6 for 8-9, 7 for 10-11, ...
export function zeroDiff(playerLevel: number): number {
  if (playerLevel <= 7) return 5;
  if (playerLevel <= 9) return 6;
  if (playerLevel <= 15) return 7;
  return 8;
}

// Classic-era mob XP: base = 45 + 5 * mobLevel, scaled by level difference.
export function mobXpValue(mobLevel: number, playerLevel: number): number {
  const base = 45 + 5 * mobLevel;
  const diff = mobLevel - playerLevel;
  if (diff >= 0) {
    return Math.round(base * (1 + 0.05 * Math.min(diff, 4)));
  }
  const zd = zeroDiff(playerLevel);
  if (-diff >= zd) return 0; // gray
  return Math.round(base * (1 - -diff / zd));
}

// Rage conversion constant (classic-era): c = 0.0091 L^2 + 3.23 L + 4.27
export function rageConversion(level: number): number {
  return 0.0091 * level * level + 3.23 * level + 4.27;
}

// Rage from dealing damage uses the classic outgoing-damage scale.
export function rageFromDealing(damage: number, level: number): number {
  return (7.5 * damage) / rageConversion(level);
}

// Rage from taking damage scales with the attacker's level so dungeon tanks get
// useful rage from being hit without hard-coding the current level cap.
export function rageFromTaking(damage: number, attackerLevel: number): number {
  return damage / (Math.max(1, attackerLevel) * 1.5);
}

// Attacking a target ABOVE your level adds a steep miss penalty (extra miss %),
// tuned so +2 is ~19% and +4 is ~85% miss: fighting way-above-level enemies is meant
// to be near-futile. The curve approximates 2.5 * diff^2.5, but is stored as an integer
// table (level diffs are always integers) so it stays bit-for-bit deterministic across
// engines — Math.pow with a fractional exponent is not guaranteed identical browser vs node.
//   +1 -> 2.5   +2 -> 14   +3 -> 39   +4 -> 80   (+5 and beyond saturate past the clamp)
const ABOVE_LEVEL_MISS_PCT = [0, 2.5, 14, 39, 80];
function aboveLevelMissPct(diff: number): number {
  if (diff <= 0) return 0;
  return diff < ABOVE_LEVEL_MISS_PCT.length ? ABOVE_LEVEL_MISS_PCT[diff] : 100;
}

// Spell hit by level difference (target - caster): 96% at equal level, a gentle
// +1%/level bonus below you, and the steep above-level penalty above. cap 99%, floor 5%.
export function spellHitChance(casterLevel: number, targetLevel: number): number {
  const diff = targetLevel - casterLevel;
  const hit = diff <= 0 ? 96 + -diff * 1 : 96 - aboveLevelMissPct(diff);
  return Math.min(0.99, Math.max(0.05, hit / 100));
}

// Melee miss vs target by level difference: 5% base, a gentle -0.2%/level below you,
// and the steep above-level penalty above. cap 95%, floor 0.5%.
export function meleeMissChance(attackerLevel: number, targetLevel: number): number {
  const diff = targetLevel - attackerLevel;
  const miss = diff > 0 ? 5 + aboveLevelMissPct(diff) : 5 + diff * 0.2;
  return Math.min(0.95, Math.max(0.005, miss / 100));
}

// Enemy mobs always connect at least this often against a player (or player-owned
// pet), regardless of level difference.
export const MOB_VS_PLAYER_MAX_MISS = 0.2;

// Per-swing miss chance with the above-level penalty applied DIRECTIONALLY. The
// steep penalty in meleeMissChance is an anti-power-level deterrent for PLAYERS
// hitting higher-level mobs; because it keys off (target - attacker) level it would
// otherwise also fire in reverse, making a low-level mob whiff on a higher-level
// player most of the time. A hostile wild mob swinging at a player (or a player-owned
// pet) caps its miss at MOB_VS_PLAYER_MAX_MISS (>= 80% hit); player/pet -> mob keeps
// the full scaling. Dodge and blind are separate, intended effects the caller layers on.
export function swingMissChance(attacker: Entity, target: Entity): number {
  const miss = meleeMissChance(attacker.level, target.level);
  const mobAttacker = attacker.kind === 'mob' && attacker.hostile && attacker.ownerId === null;
  const playerSide = target.kind === 'player' || target.ownerId !== null;
  return mobAttacker && playerSide ? Math.min(miss, MOB_VS_PLAYER_MAX_MISS) : miss;
}

export function armorReduction(armor: number, attackerLevel: number): number {
  const a = Math.max(0, armor);
  return Math.min(0.75, a / (a + 85 * attackerLevel + 400));
}

// ---------------------------------------------------------------------------
// Spell Power: caster damage scaling (classic-style cast-time / DoT-duration
// coefficient model). Casters convert Intellect into Spell Power; Spell Power
// then adds to each spell's damage via a per-spell coefficient. Hunter "attack
// spells" (Arcane Shot, Serpent Sting, Aimed Shot) instead scale off Ranged
// Attack Power, mirroring the physical attack-power path. The pure coefficient
// helpers live in src/sim/spell_scaling.ts; these are the tuning knobs.
// ---------------------------------------------------------------------------
// Spell Power gained per point of Intellect (1 Spell Power per 2 Intellect). Tuned
// (see tests/spell_power.test.ts) so a fully-leveled caster gets a meaningful but
// not dominant damage lift, scaling further as caster gear adds Int + Spell Power.
export const SPELL_POWER_PER_INT = 0.5;
// Direct nuke coefficient = clamp(castTime, MIN, MAX) / DIVISOR (classic-era 3.5). The
// max equals the divisor so the direct coefficient caps at 1.0 (a 3.5s+ cast gets
// full Spell Power; a 6s Pyroblast does not exceed it).
export const SPELL_COEFF_DIVISOR = 3.5;
export const SPELL_COEFF_MIN_CAST = 1.5; // instant / sub-1.5s casts use this floor
export const SPELL_COEFF_MAX_CAST = 3.5; // longer casts cap at a 1.0 coefficient
// Total DoT coefficient = duration / DURATION (classic-era 15), spread across ticks.
export const SPELL_DOT_COEFF_DURATION = 15;
// AoE spells take a reduced coefficient (the classic-era AoE penalty).
export const SPELL_AOE_COEFF_MULT = 0.333;
// Hunter ranged "attack spells" scale off Ranged Attack Power using the same
// cast/duration shape, scaled down by this factor (RAP is far larger than SP).
// Tuned so Arcane Shot / Aimed Shot / Serpent Sting gain a ~20-30% lift at cap.
export const RANGED_SPELL_AP_SCALE = 0.15;
// Melee physical "attack spells" (warrior Rend/Execute/Cleave, rogue Rupture/
// Garrote bleeds, druid feral bleeds, etc.) take the flat-damage portion of a
// special and scale it off melee Attack Power with the same shape. Melee AP is
// the same magnitude as Ranged AP, so it reuses the same scale-down factor. The
// weapon-swing and finisher portions already carry AP through their own paths;
// this only lifts the flat directDamage / DoT / AoE riders.
export const MELEE_SPELL_AP_SCALE = 0.15;

// ---------------------------------------------------------------------------
// Delves, replayable modular instances (see docs/prd/delves.md)
// ---------------------------------------------------------------------------

export type DelveTheme = 'crypt' | 'cave' | 'mine' | 'ruin' | 'sewer' | 'vault' | 'lair';

export type DelveObjectiveKind =
  | 'kill_boss'
  | 'recover_artifact'
  | 'seal_portal'
  | 'survive_ambush'
  | 'escort_researcher'
  | 'investigate_clues';

export interface DelveRewardTable {
  copperMin: number;
  copperMax: number;
  firstClearXp: number;
  repeatClearXp: number;
}

export interface DelveTierDef {
  id: string;
  label: string;
  enemyLevelBonus: number;
  affixCount: number;
  rewardMult: number;
  // Minimum player level required to select this tier (the Heroic gate). Omit for
  // an unrestricted tier. Enforced server-side in `enterDelve`.
  minPlayerLevel?: number;
  // Per-tier reward overrides; fall back to `delve.baseRewards` when omitted, so a
  // tier's XP/copper lives in content data, not inline in sim logic.
  firstClearXp?: number;
  repeatClearXp?: number;
  copperMin?: number;
  copperMax?: number;
  unlock?: { delveId: string; tierId: string; clears: number };
}

export interface DelvePatrol {
  mobId: string;
  from: { x: number; z: number };
  to: { x: number; z: number };
}

export interface DelveSpawnSet {
  id: string;
  weight: number;
  spawns: DungeonSpawn[];
  patrols?: DelvePatrol[];
}

export interface DelveInteractableSlot {
  x: number;
  z: number;
  variants: string[];
}

// A static environmental hazard circle (instance-local coords), e.g. the Drowned
// Litany's Blackwater pools. Standing players take damage on a fixed interval; it
// is NOT a collider (mobs/companions walk through, pathing ignores it), it only
// shapes where players choose to stand.
export interface DelveHazardZone {
  x: number;
  z: number;
  r: number;
  // An authored ellipse (e.g. the apse moat, wider along x than z to fit
  // between its flanking islands): rx/rz win over r for both the damage
  // check and every visual (map, render). Omit for a plain circle of radius r.
  rx?: number;
  rz?: number;
  tier?: 'shallow' | 'deep';
}

export interface DelveModuleDef {
  id: string;
  interior: 'crypt' | 'cave' | 'mine';
  layout: string;
  length: number;
  spawnSets: DelveSpawnSet[];
  interactableSlots: DelveInteractableSlot[];
  sideRoom?: { chance: number; moduleId: string };
  // Static Blackwater (or similar) hazard zones for this module, instance-local.
  hazards?: DelveHazardZone[];
}

export interface DelveDef {
  id: string;
  name: string;
  theme: DelveTheme;
  index: number;
  minLevel: number;
  suggestedPlayers: number;
  // Hard cap: a party larger than this may not enter (delves are solo/duo content).
  maxPlayers: number;
  doorPos: { x: number; z: number };
  modules: string[];
  moduleCount: [number, number];
  finaleModuleId: string;
  bosses: string[];
  objective: DelveObjectiveKind;
  tiers: DelveTierDef[];
  baseRewards: DelveRewardTable;
  boardNpcId: string;
  // Companion auto-hired for solo runs (e.g. Acolyte Tessa). Omit for delves that
  // ship without a companion. De-hardcodes the solo-spawn branch in `enterDelve`.
  autoCompanionId?: string;
  enterText: string;
  leaveText: string;
}

export interface DelveObjectiveState {
  kind: DelveObjectiveKind;
  counts: number[];
  complete: boolean;
}

export interface DelveCompanionState {
  companionId: string;
  entityId: number;
}

export interface DelveRun {
  delveId: string;
  slot: number;
  partyKey: string | null;
  seed: number;
  tierId: string;
  affixes: string[];
  modules: string[];
  moduleIndex: number;
  origin: { x: number; z: number };
  mobIds: number[];
  objectIds: number[];
  objective: DelveObjectiveState;
  companion?: DelveCompanionState;
  completed: boolean;
  emptyFor: number;
  deathsThisRun: Record<number, number>;
  objectState: Record<number, DelveObjectState>;
  raiseDeadChannel: DelveRaiseDeadChannel | null;
  restlessPending: DelveRestlessPending[];
  badAirTimer: number;
  /** Accumulates DT for the static Blackwater hazard pulse (damage every interval
   * a player stands in a module hazard zone). Reset on run start / module change. */
  blackwaterTimer: number;
  companionBarks: string[];
  /** Rank 3 boon: set once the once-per-run ally revive has been spent. Lives on
   * the run (like companionBarks), not on the companion state, so leaving and
   * re-entering mid-run cannot recharge it. */
  companionReviveUsed: boolean;
  /** True when the current module exit portal is active (trash cleared + plate if any). */
  exitPortalOpen: boolean;
  /** §7.6, this run rolled Bountiful (ultra-rare): the reward chest is a purple
   * Coffer that only yields to a Hard-tier + Premium-ante lockpick solve and
   * guarantees a signature rare. Rolled once at run start (Heroic 5% / Normal 2%). */
  bountiful: boolean;
  /** Entity id of the reward chest spawned after the finale boss dies, or null if not yet spawned. */
  rewardChestId: number | null;
  /** Entity id of the surface-exit portal spawned after the chest is opened, or null if not yet opened. */
  surfaceExitId: number | null;
  /** Active lockpicking attempt on the finale chest (single interactor, v1), or null. In-memory only. */
  lockpick: LockSession | null;
  /** Sister Nhalia boss mechanics (The Drowned Litany finale only). */
  nhaliaBoss?: DrownedLitanyBossState;
  /** Drowned Reliquary Rite shrine puzzle (The Drowned Litany finale only). */
  drownedLitanyRite?: DrownedLitanyRiteState;
  /** Sinkhole Baptistry wave progression (egg-sacs gated until wave 3). */
  litanyBaptistry?: DrownedLitanyBaptistryState;
}

export interface DrownedLitanyBaptistryState {
  /** Index of the active wave in BAPTISTRY_WAVES (0..2). */
  wave: number;
  eggsEnabled: boolean;
  /** Mob ids of the spawned spider_egg_sac adds (set once, at spawn time). */
  eggSacIds: number[];
  /** Subset of eggSacIds whose death burst has already fired, so a kill is processed once. */
  burstIds: number[];
}

export interface DelveDailyState {
  date: string;
  firstClearXp: string[];
  markClears: number;
}

export interface DelveCompanionDef {
  id: string;
  name: string;
  role: 'healer' | 'tank' | 'scout' | 'dps';
  mobTemplateId: string;
}

export interface DelveAffixDef {
  id: string;
  name: string;
  themes: DelveTheme[];
  blessing?: boolean;
}

export interface DelveObjectState {
  kind: string;
  triggered: boolean;
  hp: number;
  maxHp: number;
  linkIds: number[];
  open: boolean;
  // Lockpick chest gating (kind === 'locked_chest'). attemptAvailable is granted
  // when the chest spawns (boss defeated) and consumed on a SUCCESS or FAILED
  // attempt, a FAILED chest can only be retried by re-clearing the delve.
  attemptAvailable?: boolean;
  looted?: boolean;
  lootedTier?: LootTier;
  /** Item slots waiting on the post-unlock loot screen. */
  pendingLoot?: { itemId: string; count: number }[];
  /** Entity id of the player who picked the lock; only they may collect the loot. */
  lootOwnerId?: number;
  // Drowned Reliquary loot (kind === 'drowned_reliquary'): each party member rolls
  // and collects their own items independently, so there is no single owner to
  // front-run. Keyed by pid; emptied per member as they collect.
  partyLoot?: Record<number, { itemId: string; count: number }[]>;
}

export interface DelveRaiseDeadChannel {
  graveId: number;
  bossId: number;
  mobId: string;
  count: number;
  remaining: number;
}

/** A boss-spawned Blackwater Mark puddle (world coords, instance-local). */
export interface DrownedLitanyBlackwaterMark {
  x: number;
  z: number;
  remaining: number;
  tickTimer: number;
}

/** A single Tolling Bell projectile entity in flight (entity id + expiry timer). */
export interface TollingBellEntity {
  /** Entity id of the mob entity representing this bell. */
  entityId: number;
  /** Seconds until the bell expires (travels out of bounds). */
  remaining: number;
  /** Velocity direction: unit vector (dx, dz). */
  vx: number;
  vz: number;
}

/** Per-run Sister Nhalia encounter state (DelveRun.nhaliaBoss). */
export interface DrownedLitanyBossState {
  markTimer: number;
  marks: DrownedLitanyBlackwaterMark[];
  firedCantorPhases: number;
  /** Entity ids from the active Cantor phase; shield drops when all are dead. */
  cantorShieldAdds: number[];
  finalBellFired: boolean;
  /** Countdown until the next Tolling Bells volley (seconds). */
  bellVolleyTimer: number;
  /** Currently in-flight bell projectile entities. */
  bells: TollingBellEntity[];
}

export type RiteShrineKind =
  | 'rite_shrine_bell'
  | 'rite_shrine_candle'
  | 'rite_shrine_reed'
  | 'rite_shrine_skull';

export const RITE_SHRINE_KINDS: RiteShrineKind[] = [
  'rite_shrine_bell',
  'rite_shrine_candle',
  'rite_shrine_reed',
  'rite_shrine_skull',
];

/** Player-chosen rite difficulty: more playbacks + shorter for Easy, fewer + longer
 * for Hard. Loot ceiling rises with difficulty (Easy=low, Medium=medium, Hard=premium). */
export type RiteIntensity = 'easy' | 'medium' | 'hard';

export const RITE_INTENSITIES: RiteIntensity[] = ['easy', 'medium', 'hard'];

/** Per-run Drowned Reliquary Rite puzzle state (DelveRun.drownedLitanyRite). */
export interface DrownedLitanyRiteState {
  /** True after the reliquary rises until the player picks a difficulty; the
   * sequence is empty and playback has not started while this is set. */
  awaitingChoice: boolean;
  /** The chosen difficulty, or null while awaitingChoice. */
  intensity: RiteIntensity | null;
  sequence: RiteShrineKind[];
  currentIndex: number;
  mistakes: number;
  /** How many wrong touches are tolerated before the reliquary opens on low loot.
   * Equals tries - 1: a wrong touch fails the current try and (if tries remain)
   * replays the sequence from the top. */
  mistakesAllowed: number;
  /** Full attempts the player gets at repeating the sequence (Easy 3, Medium 2,
   * Hard 1). Each wrong touch consumes a try. */
  tries: number;
  /** How many times the full sequence is shown before input is accepted. */
  playbacks: number;
  /** Which playback pass (0-based) is currently showing. */
  playbackLoop: number;
  puzzleActive: boolean;
  sequencePlaying: boolean;
  playbackIndex: number;
  playbackTimer: number;
  shrineEntityIds: Record<RiteShrineKind, number>;
  reliquaryId: number;
  opened: boolean;
}

export interface DelveRestlessPending {
  at: number;
  x: number;
  z: number;
  mobId: string;
}
