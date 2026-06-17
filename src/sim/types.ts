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
export type ArenaFormat = '1v1' | '2v2';

export interface ArenaCombatant {
  pid: number;
  name: string;
  cls: PlayerClass;
  level: number;
}
export const ALL_CLASSES: PlayerClass[] = [
  'warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid',
];
export type ResourceType = 'rage' | 'mana' | 'energy';
export const OVERHEAD_EMOTE_IDS = [
  'wave', 'laugh', 'question', 'cheer', 'dance', 'point', 'flex', 'salute', 'cry', 'bow', 'clap', 'roar', 'kneel',
] as const;
export type OverheadEmoteId = typeof OVERHEAD_EMOTE_IDS[number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type EntityKind = 'player' | 'mob' | 'npc' | 'object';

export type AiState = 'idle' | 'chase' | 'attack' | 'flee' | 'evade' | 'dead';

export type AuraKind =
  | 'dot' | 'slow' | 'stun' | 'root' | 'incapacitate' | 'polymorph'
  | 'attackspeed' | 'debuff_ap' | 'buff_ap' | 'buff_armor' | 'buff_int' | 'buff_dodge' | 'buff_speed' | 'buff_haste'
  | 'hot' | 'absorb' | 'imbue' | 'buff_sta' | 'buff_allstats' | 'thorns' | 'form_bear'
  | 'form_cat' | 'stealth' | 'defensive_stance' | 'righteous_fury' | 'sunder' | 'mortal_wound' | 'silence';

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

export type CrowdControlDrCategory = 'root' | 'polymorph' | 'fear';

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
  | 'troll' | 'ogre' | 'elemental' | 'dragonkin' | 'demon';
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
  // Boss mechanic: damage multiplier (and optional swing-speed haste) once hp
  // drops below the threshold. hasteMult > 1 makes the enraged mob swing faster.
  enrage?: { belowHpPct: number; dmgMult: number; hasteMult?: number };
  // Mob mechanic: a one-time desperation self-heal the first time hp drops
  // below the threshold (healPct is a fraction of maxHp). Resets on evade/respawn.
  desperateHeal?: { belowHpPct: number; healPct: number };
  // Support mechanic ("Mend"): while in combat, periodically heal every wounded
  // living friendly mob within `radius` (incl. itself) for `healMin..healMax`.
  // Telegraphed: the first cast lands one full `every` interval after combat
  // opens. Resets on evade/respawn. Routes through the normal heal path, so it
  // shows green floating text and grants no threat to the menders themselves.
  mendAlly?: { healMin: number; healMax: number; radius: number; every: number; name: string; school?: Aura['school'] };
  // Boss mechanic ("War Stomp"): periodic ground slam that stuns nearby players
  // for `duration`s (and optionally deals min..max damage). Telegraphed: the
  // first slam only lands one full `every` interval after combat starts.
  stomp?: { radius: number; every: number; duration: number; min?: number; max?: number; name: string; school?: string };
  // Melee mechanic: each landed swing also splashes onto other players near the
  // primary target for `mult` of the (pre-armor) hit. Classic-WoW Cleave.
  cleave?: { radius: number; mult: number; name?: string };
  // On-hit debuff: a chance per landed melee swing to inflict a stacking-refresh
  // damage-over-time poison on the struck target (spiders, serpents, scorpions).
  venom?: { chance: number; perTick: number; interval: number; duration: number; name: string; school?: string };
  // On-death mechanic ("Death Throes"): a volatile creature does not detonate
  // the instant it dies. Its corpse destabilizes for `delay` seconds (a
  // telegraph players can run from), then bursts for min..max `school` damage
  // to everyone within `radius`. Deterministic: the fuse rides the corpse tick.
  deathThroes?: { min: number; max: number; radius: number; delay: number; name: string; school?: Aura['school'] };
  // Classic beast "Frenzy": when a mob with this trait dies, nearby living
  // same-family hostile mobs briefly attack faster (hasteMult, e.g. 1.3 = +30%
  // swing speed) for `duration` seconds. Applied as a buff_haste aura.
  packFrenzy?: { radius: number; hasteMult: number; duration: number };
  // Melee mechanic: a landed swing has `chance` to inflict a Mortal Wound debuff
  // that reduces all healing the victim receives by `healReduction` for `duration`.
  mortalStrike?: { chance: number; healReduction: number; duration: number; name: string; school?: string };
  // On-hit lifesteal: a landed melee swing heals the mob for `healFrac` of the
  // damage it just dealt (drowned undead, leeches, vampiric beasts). Unlike the
  // other on-hit affixes it sustains the attacker instead of debuffing the
  // victim. Optional `chance` gates the proc (defaults to every landed hit).
  lifeleech?: { healFrac: number; chance?: number; name?: string };
  // Combat mechanic: a landed melee hit has `chance` to corrode the victim's
  // armor: a stacking `sunder` debuff (up to `maxStacks`) so the victim takes
  // more physical damage from everyone until it expires. Rides the existing
  // sunder aura; no new aura kind.
  corrode?: { chance: number; armor: number; maxStacks: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit web mechanic: a landed melee swing has `chance` to ensnare the struck
  // player in place — a `root` aura for `duration`s (naga/spider snares). Rides the
  // existing root aura + crowd-control DR; no new aura kind. Players only; rooting a
  // fellow mob is meaningless and would let a friendly pet trivially lock enemies.
  ensnare?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit debuff: a chance per landed melee swing to mire the victim, slowing
  // their ATTACK SPEED (an `attackspeed` aura, `mult` > 1 lengthens the swing
  // interval) for `duration`s. Rides the existing swingIntervalMult hook — no new
  // combat math. Distinct from a movement snare (`slow`) or an AP cut (`debuff_ap`).
  slowStrike?: { chance: number; mult: number; duration: number; name: string; school?: Aura['school'] };
  // On-hit mechanic ("Mana Burn"): a landed melee swing has `chance` to drain a
  // flat `amount` of mana from a mana-using victim (casters). Rage/energy users
  // are unaffected. Drains only what mana the victim still has; no overkill.
  manaBurn?: { chance: number; amount: number; name: string; school?: Aura['school'] };
  // On-hit curse: a landed melee swing has `chance` to fog the victim's mind,
  // draining `int` Intellect for `duration` and thus shrinking a caster's mana
  // pool (recalcPlayerStats clamps current mana down with the smaller ceiling).
  // Rides the existing buff_int aura with a NEGATIVE value, so there is no new
  // resource math. Only meaningful on mana users — applied to them alone.
  enfeeble?: { chance: number; int: number; duration: number; name: string; school?: Aura['school'] };
  // Combat mechanic: a landed melee hit has `chance` to terrify the victim — a
  // fear that sends the struck player fleeing for `duration`s. Rides the existing
  // `fear_incap` incapacitate aura the player-cast Fear uses, so `updateFearMovement`
  // drives the panicked run with no new aura kind or movement hook.
  dread?: { chance: number; duration: number; name: string; school?: Aura['school'] };
  // Pet mechanic: this creature is a ranged caster (warlock Imp) — instead of
  // closing to melee, it stays at `range` and hurls bolts of `school` damage.
  // updatePet reads this; the bolt damage comes from the mob's weapon range.
  petRanged?: { range: number; school: Aura['school'] };
  petRole?: PetRole;
  petSpell?: { name: string; school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature'; min: number; max: number; range: number; every: number };
  // On-hit mechanic: chance to silence the victim, locking out spell (non-physical) casts for a duration.
  silence?: { chance: number; duration: number; name: string; school?: string };
  // On-hit chill: a landed melee swing has `chance` to slow the victim's
  // movement to `mult` of normal for `duration` seconds (frost school). Reuses
  // the standard `slow` aura, so it rides the same movement path as Frostbolt.
  chillOnHit?: { chance: number; mult: number; duration: number; name: string };
  // On-hit affix: a successful melee hit saps the player victim's attack power
  // for a few seconds (classic Demoralizing Shout / Curse of Weakness), making
  // the damage *they* deal weaker. `ap` is the attack-power reduction (applied
  // as a negative buff_ap aura); `chance` defaults to 1 (every hit, refreshing).
  demoralize?: { ap: number; duration: number; chance?: number; name?: string };
  // Innate "spiked hide" trait: melee attackers take flat damage back on every
  // connecting swing — the mob-side equivalent of the druid Thorns aura.
  thorns?: { value: number; school?: Aura['school']; name?: string };
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
  | { type: 'aoeAttackPower'; amount: number; duration: number; radius: number } // demoralizing roar/shout
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
  | { type: 'dismissPet' } // release the caster's pet back to the wild
  | { type: 'summonPet'; templateId: string } // warlock demon summon: creates/replaces a controlled pet
  | { type: 'summonDemon'; mobId: string }; // warlock: summon a demon pet (imp/voidwalker)

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
  interior: 'crypt' | 'sanctum' | 'temple'; // renderer + collider interior builder key
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
  vx: number; // horizontal air velocity (x, yards/sec)
  vz: number; // horizontal air velocity (z, yards/sec)
  vy: number; // vertical velocity (jumping/falling)
  onGround: boolean;
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
  pulseTimer: number; // boss aoe pulse countdown
  stompTimer: number; // boss War Stomp stun-pulse countdown
  detonateTimer: number; // Death Throes fuse on a volatile corpse; Infinity = no pending detonation
  mendTimer: number; // mendAlly support-heal cast countdown
  firedSummons: number; // summonAdds thresholds already triggered
  summonedIds: number[]; // live adds this boss summoned; despawned on reset
  enraged: boolean; // enrage mechanic active
  healedThisPull: boolean; // desperation self-heal already used this pull
  spawnPos: Vec3;
  leashAnchor: Vec3 | null; // refreshed by hostile player/pet actions; spawnPos remains the true home
  evadeStall: number; // seconds an evading mob has failed to get closer to home; snaps it home if it can't path back (e.g. across water)
  fleeTimer: number; // seconds left in a low-HP panic flee; counts down in the 'flee' state
  hasFled: boolean; // a cowardly mob flees only once per pull; cleared when it resets at spawn
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
  skin: number; // player appearance: index into SKINS[visualKey]; 0 = default. synced in identity fields.
}

// `pid` (when present) marks a personal event that should only be delivered to
// that player entity's owner; events without pid are world-visible.
export type SimEvent = { pid?: number } & (
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; crit: boolean; school: string; ability: string | null; kind: 'hit' | 'miss' | 'dodge' | 'parry' }
  | { type: 'heal'; targetId: number; amount: number }
  | { type: 'death'; entityId: number; killerId: number }
  | { type: 'xp'; amount: number }
  | { type: 'levelup'; level: number }
  // post-cap cosmetic progression (Max-Level XP Overflow): crossing a virtual
  // level past the cap, and unlocking a cosmetic lifetime-XP milestone
  | { type: 'virtualLevelUp'; level: number }
  | { type: 'milestoneUnlocked'; milestoneId: string }
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
  | { type: 'chat'; fromPid: number; from: string; text: string; channel?: 'say' | 'yell' | 'whisper' | 'general' | 'party' | 'guild' | 'officer' | 'world' | 'lfg' | 'emote' | 'roll'; entityId?: number; to?: string }
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
  | { type: 'arenaFound'; format: ArenaFormat; oppName: string; oppClass: PlayerClass; oppLevel: number; allies: ArenaCombatant[]; enemies: ArenaCombatant[] }
  | { type: 'arenaCountdown'; seconds: number }
  | { type: 'arenaStart' }
  | { type: 'arenaEnd'; format: ArenaFormat; won: boolean; draw: boolean; oppName: string; ratingBefore: number; ratingAfter: number; allies: ArenaCombatant[]; enemies: ArenaCombatant[] }
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
  devCommands?: boolean; // local dev: /dev level|tp|give chat cheats
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
  let lo = 1, hi = MAX_VIRTUAL_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (VLEVEL_CUM[mid] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Progress within the current virtual level: how much lifetime XP into it, and
// how much that level costs in total. Pre-cap callers use the level bar instead.
export function virtualLevelProgress(lifetimeXp: number): { level: number; into: number; span: number } {
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

export function armorReduction(armor: number, attackerLevel: number): number {
  const a = Math.max(0, armor);
  return Math.min(0.75, a / (a + 85 * attackerLevel + 400));
}
