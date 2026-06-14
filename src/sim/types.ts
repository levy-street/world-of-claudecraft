// Core shared types for the simulation. The sim layer has zero DOM/rendering deps.

export const TICK_RATE = 20; // sim ticks per second
export const DT = 1 / TICK_RATE;
export const RUN_SPEED = 7; // yards/sec, classic run speed
export const TURN_SPEED = Math.PI; // rad/sec keyboard turning
export const MELEE_RANGE = 5; // yards
export const INTERACT_RANGE = 5;
export const GCD = 1.5; // seconds
export const CAST_PUSHBACK_SEC = 0.5; // vanilla: each hit delays a cast by 0.5s
export const CHANNEL_PUSHBACK_FRACTION = 0.25; // vanilla: each hit shaves 25% off a channel
export const FISHING_CAST_ID = 'fishing';
export const FISHING_CAST_NAME = 'Fishing';
export const FISHING_CAST_TIME = 5;

export type PlayerClass =
  | 'warrior' | 'paladin' | 'hunter' | 'rogue' | 'priest'
  | 'shaman' | 'mage' | 'warlock' | 'druid';
export const ALL_CLASSES: PlayerClass[] = [
  'warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid',
];
export type ResourceType = 'rage' | 'mana' | 'energy';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

export type AiState = 'idle' | 'chase' | 'attack' | 'evade' | 'dead';

export type AuraKind =
  | 'dot' | 'slow' | 'stun' | 'root' | 'incapacitate' | 'polymorph'
  | 'attackspeed' | 'buff_ap' | 'buff_armor' | 'buff_int' | 'buff_dodge' | 'buff_speed' | 'buff_haste'
  | 'hot' | 'absorb' | 'imbue' | 'buff_sta' | 'buff_allstats' | 'thorns' | 'form_bear'
  | 'form_cat' | 'stealth' | 'defensive_stance' | 'righteous_fury' | 'sunder';

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
}

export type CrowdControlDrCategory = 'root';

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

export type EquipSlot = 'mainhand' | 'chest' | 'legs' | 'feet';

export type ItemUse =
  | { type: 'fishing' };

export interface ItemDef {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'quest' | 'junk' | 'food' | 'drink' | 'tool' | 'potion';
  slot?: EquipSlot;
  weapon?: WeaponInfo;
  stats?: Partial<Stats>;
  use?: ItemUse;
  sellValue: number; // copper (vendor buys at this)
  buyValue?: number; // copper (vendor sells at this)
  questId?: string;
  // consumables: total restored over 18 seconds while sitting
  foodHp?: number;
  drinkMana?: number;
  // potions: restored instantly, usable in combat, share a cooldown (#103)
  potionHp?: number;
  potionMana?: number;
  quality?: 'poor' | 'common' | 'uncommon' | 'rare' | 'epic'; // gray/white/green/blue/purple name colors
  requiredClass?: PlayerClass[];
}

export interface InvSlot {
  itemId: string;
  count: number;
}

export interface LootSlot extends InvSlot {
  // Quest corpse loot can be personal: each listed player can take one copy.
  personalFor?: number[];
}

export interface CorpseLoot {
  copper: number;
  items: LootSlot[];
}

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
  | 'beast' | 'humanoid' | 'murloc' | 'spider' | 'kobold' | 'undead'
  | 'troll' | 'ogre' | 'elemental' | 'dragonkin';

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
  boss?: boolean;
  rare?: boolean;
  // Elite scaling, vanilla-style: ~2.3x health, ~1.5x damage, double XP.
  elite?: boolean;
  // Rare/miniboss controls.
  canSwim?: boolean;
  ccImmune?: boolean;
  respawnMult?: number;
  // Boss mechanic: periodic AoE pulse around the mob while in combat.
  aoePulse?: { min: number; max: number; radius: number; every: number; name: string; school?: string; fx?: 'nova' | 'projectile' };
  // Boss mechanic: spawn adds when hp first drops below each threshold (descending fractions).
  summonAdds?: { mobId: string; count: number; atHpPct: number[] };
  // Boss mechanic: damage multiplier once hp drops below the threshold.
  enrage?: { belowHpPct: number; dmgMult: number };
}

export type AbilityEffect =
  | { type: 'weaponDamage'; bonus: number } // on-next-swing bonus (heroic strike)
  | { type: 'weaponStrike'; bonus: number; cannotBeDodged?: boolean; requiresBehind?: boolean; weaponMult?: number } // instant special attack (sinister strike, overpower, backstab)
  | { type: 'directDamage'; min: number; max: number }
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
  | { type: 'aoeAttackSpeed'; mult: number; duration: number; radius: number } // thunder clap rider
  | { type: 'aoeRoot'; duration: number; radius: number; min: number; max: number }
  | { type: 'selfBuff'; kind: AuraKind; value: number; duration: number }
  | { type: 'finisherHaste'; mult: number; basedur: number; perCombo: number } // slice and dice
  | { type: 'finisherStun'; base: number; perCombo: number } // kidney shot: stun seconds scale with combo
  | { type: 'gainResource'; amount: number } // bloodrage immediate
  | { type: 'selfDamagePctMax'; pct: number } // bloodrage cost
  | { type: 'charge' }
  | { type: 'sunder'; armor: number; maxStacks: number } // sunder armor: stacking armor debuff + flat threat
  | { type: 'taunt' } // taunt/growl: match top threat and force-attack the caster
  | { type: 'tamePet' } // hunter tame beast: the targeted mob becomes the caster's pet
  | { type: 'dismissPet' }; // release the caster's pet back to the wild

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
  channel?: { duration: number; ticks: number }; // arcane missiles
  cooldown: number; // seconds, 0 = none (GCD only)
  range: number; // yards; 0 = melee range
  minRange?: number;
  school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  requiresTarget: boolean;
  targetType?: 'enemy' | 'friendly'; // friendly = self or allied player (defaults to enemy)
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
  requiresStealth?: boolean; // ambush
  requiresOutOfCombat?: boolean; // stealth
  learnLevel: number;
  effects: AbilityEffect[];
  ranks?: AbilityRank[]; // later ranks (sorted by level)
  icon: string; // short label for UI
  iconColor: string;
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

export interface DungeonSpawn {
  mobId: string;
  x: number; // relative to instance origin
  z: number;
}

export interface DungeonDef {
  id: string;
  name: string;
  index: number; // x-band for instance origins; must be unique
  doorPos: { x: number; z: number }; // overworld entrance portal
  entry: { x: number; z: number }; // player arrival point (instance-local)
  exitOffset: { x: number; z: number }; // exit portal (instance-local)
  spawns: DungeonSpawn[];
  interior: 'crypt' | 'sanctum'; // renderer + collider interior builder key
  suggestedPlayers: number;
  enterText: string;
  leaveText: string;
}

export type BiomeId = 'vale' | 'marsh' | 'peaks';

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
  docks: { x: number; z: number; rot: number; hutLocal: { x: number; z: number; hw: number; hd: number } }[];
  tents: { x: number; z: number; rot: number; scale: number }[];
  crates: [number, number][];
  campfires: [number, number][];
  mudHuts: [number, number][];
  ruinRings: { x: number; z: number; ringR: number; columns: number }[];
  fences: { x1: number; z1: number; x2: number; z2: number }[];
  graveyards: { x: number; z: number }[]; // 6-headstone cluster anchor
}

export function emptyZoneProps(): ZonePropsDef {
  return {
    buildings: [], wells: [], stalls: [], mines: [], docks: [], tents: [],
    crates: [], campfires: [], mudHuts: [], ruinRings: [], fences: [], graveyards: [],
  };
}

export interface QuestObjective {
  type: 'kill' | 'collect';
  targetMobId?: string; // for kill
  itemId?: string; // for collect
  count: number;
  label: string;
}

export interface QuestDef {
  id: string;
  name: string;
  giverNpcId: string;
  turnInNpcId: string;
  text: string;
  completionText: string;
  objectives: QuestObjective[];
  xpReward: number;
  copperReward: number;
  itemRewards: Partial<Record<PlayerClass, string>>;
  requiresQuest?: string; // prerequisite quest id (must be turned in)
  minLevel?: number;
  suggestedPlayers?: number; // group quests ("Suggested players: 5")
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
  pos: Vec3;
  prevPos: Vec3; // for render interpolation
  facing: number; // radians, 0 = +Z
  prevFacing: number;
  // online clients only: when this entity's last wire update landed and the
  // measured update cadence — distant entities are sent below snapshot rate,
  // so each interpolates on its own clock (see ClientWorld.applySnapshot)
  netUpdatedAt?: number;
  netInterval?: number;
  vy: number; // vertical velocity (jumping/falling)
  onGround: boolean;
  fallStartY: number;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceType: ResourceType | null;
  stats: Stats;
  weapon: WeaponInfo;
  attackPower: number;
  rangedPower: number; // hunters: ranged attack power
  critChance: number; // 0..1
  dodgeChance: number;
  moveSpeed: number;
  hostile: boolean;
  // combat
  targetId: number | null;
  autoAttack: boolean;
  swingTimer: number;
  inCombat: boolean;
  combatTimer: number; // time since last combat event
  auras: Aura[];
  ccDr: Map<CrowdControlDrCategory, CrowdControlDrState>;
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  channeling: boolean;
  channelTickTimer: number;
  channelTickEvery: number;
  gcdRemaining: number;
  cooldowns: Map<string, number>;
  queuedOnSwing: string | null; // heroic strike
  fiveSecondRule: number; // time since last mana spend
  comboPoints: number;
  comboTargetId: number | null;
  overpowerUntil: number; // sim-time until which overpower is usable
  potionCooldownUntil: number; // sim-time until a combat potion can be used again (#103)
  // warrior charge: forced run toward the target along a pathfound route
  chargeTargetId: number | null;
  chargeTimeLeft: number; // seconds; failsafe so a blocked charge can't run forever
  chargePath: Vec3[]; // waypoints consumed front-to-back; last leg homes on the live target
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
  petTauntTimer: number; // controlled pet Growl cooldown
  pulseTimer: number; // boss aoe pulse countdown
  firedSummons: number; // summonAdds thresholds already triggered
  summonedIds: number[]; // live adds this boss summoned; despawned on reset
  enraged: boolean; // enrage mechanic active
  spawnPos: Vec3;
  leashAnchor: Vec3 | null; // refreshed by hostile player/pet actions; spawnPos remains the true home
  wanderTarget: Vec3 | null;
  wanderTimer: number;
  aggroTargetId: number | null;
  /** GM character: invulnerable (dealDamage no-ops). Server-set from the
   *  characters.is_gm column; never user-settable. */
  gm?: boolean;
  respawnTimer: number;
  corpseTimer: number;
  lootable: boolean;
  loot: CorpseLoot | null;
  xpValue: number;
  // npc
  questIds: string[];
  vendorItems: string[];
  // object (ground interactable)
  objectItemId: string | null;
  dungeonId: string | null; // set on dungeon door/exit portals
  // misc
  dead: boolean;
  scale: number;
  color: number;
}

// `pid` (when present) marks a personal event that should only be delivered to
// that player entity's owner; events without pid are world-visible.
export type SimEvent = { pid?: number } & (
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; crit: boolean; school: string; ability: string | null; kind: 'hit' | 'miss' | 'dodge' | 'parry' }
  | { type: 'heal'; targetId: number; amount: number }
  | { type: 'death'; entityId: number; killerId: number }
  | { type: 'xp'; amount: number }
  | { type: 'levelup'; level: number }
  | { type: 'learnAbility'; abilityId: string; rank: number }
  | { type: 'loot'; text: string }
  | { type: 'error'; text: string }
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
  | { type: 'vendor'; action: 'buy' | 'sell' | 'buyback'; itemId: string }
  // say/yell are delivered only to players in range and carry the speaker's
  // entity id so the client can hang a chat bubble over their head; whisper
  // goes to the target (and echoes to the sender with `to` set); general is
  // a world-wide broadcast
  | { type: 'chat'; fromPid: number; from: string; text: string; channel?: 'say' | 'yell' | 'whisper' | 'general' | 'party' | 'guild' | 'officer' | 'roll'; entityId?: number; to?: string }
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
  // Ashen Coliseum 1v1 arena: queue state, match lifecycle, and rating result
  | { type: 'arenaQueued'; position: number }
  | { type: 'arenaUnqueued' }
  | { type: 'arenaFound'; oppName: string; oppClass: PlayerClass; oppLevel: number }
  | { type: 'arenaCountdown'; seconds: number }
  | { type: 'arenaStart' }
  | { type: 'arenaEnd'; won: boolean; draw: boolean; oppName: string; ratingBefore: number; ratingAfter: number }
  | { type: 'heal2'; sourceId: number; targetId: number; amount: number; crit: boolean; ability: string }
  // visual-only cue for the renderer: spell projectiles, dot ticks, aoe novas
  | { type: 'spellfx'; sourceId: number; targetId: number; school: string; fx: 'projectile' | 'tick' | 'nova' }
  // entityId (when set) anchors the log to that entity so the server only
  // delivers it to nearby players; anchorless logs broadcast server-wide
  | { type: 'log'; text: string; color?: string; entityId?: number }
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

export interface SimConfig {
  seed: number;
  playerClass: PlayerClass;
  respawnSeconds?: number; // mob respawn time (default 25)
  autoEquip?: boolean; // auto-equip better gear on loot (headless convenience)
  playerName?: string;
  noPlayer?: boolean; // multiplayer server: start with an empty world and addPlayer() later
}

export function emptyMoveInput(): MoveInput {
  return { forward: false, back: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, jump: false };
}

export function dist2d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
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

// XP required to go from level L to L+1 (real vanilla values, levels 1..20)
export const XP_TABLE = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600,
  8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200,
];
export const MAX_LEVEL = 20;

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.min(level - 1, XP_TABLE.length - 1)];
}

// Zero-difference band: how many levels below you a mob stops giving XP.
// Vanilla: ZD = 5 for player level 1-7, 6 for 8-9, 7 for 10-11, ...
export function zeroDiff(playerLevel: number): number {
  if (playerLevel <= 7) return 5;
  if (playerLevel <= 9) return 6;
  if (playerLevel <= 15) return 7;
  return 8;
}

// Real vanilla mob XP: base = 45 + 5 * mobLevel, scaled by level difference.
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

// Rage conversion constant (vanilla): c = 0.0091 L^2 + 3.23 L + 4.27
export function rageConversion(level: number): number {
  return 0.0091 * level * level + 3.23 * level + 4.27;
}

// Rage from dealing damage: 7.5 * d / c ; from taking damage: 2.5 * d / c
export function rageFromDealing(damage: number, level: number): number {
  return (7.5 * damage) / rageConversion(level);
}
export function rageFromTaking(damage: number, level: number): number {
  return (2.5 * damage) / rageConversion(level);
}

// Vanilla spell hit table by level difference (target - caster):
// equal: 96%, +1: 95%, +2: 94%, +3: 83%, beyond: -11%/level; lower: +1%/lvl, cap 99%.
export function spellHitChance(casterLevel: number, targetLevel: number): number {
  const diff = targetLevel - casterLevel;
  let hit: number;
  if (diff <= 0) hit = 96 + -diff * 1;
  else if (diff === 1) hit = 95;
  else if (diff === 2) hit = 94;
  else hit = 83 - (diff - 3) * 11;
  return Math.min(0.99, Math.max(0.01, hit / 100));
}

// Melee miss vs target by level difference (weapon skill = 5 * level):
// 5% base, +1%/level above (cliff at +3 handled via extra penalty), -0.2%/level below.
export function meleeMissChance(attackerLevel: number, targetLevel: number): number {
  const diff = targetLevel - attackerLevel;
  let miss = 5 + (diff > 0 ? diff * (diff > 2 ? 2 : 1) : diff * 0.2);
  return Math.min(0.6, Math.max(0.005, miss / 100));
}

export function armorReduction(armor: number, attackerLevel: number): number {
  const a = Math.max(0, armor);
  return Math.min(0.75, a / (a + 85 * attackerLevel + 400));
}
