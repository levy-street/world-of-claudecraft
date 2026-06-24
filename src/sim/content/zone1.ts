// Zone 1 — Eastbrook Vale (levels 1-7). The starter zone: town of Eastbrook,
// wolves and boars, the bandit camp, and Brother Aldric's Gravecaller chain
// leading to the Hollow Crypt.

import type {
  CampDef,
  GroundObjectDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';

export const TOWN_RADIUS = 26;
export const GRAVEYARD_POS = { x: -12, z: -14 };
// Basin carved into the heightfield. Pushed to the far northeast so its
// shoreline meets the fishing dock and the murloc camp instead of drowning them.
export const LAKE = { x: -92, z: 88, radius: 30 };

export const ZONE1_ZONE: ZoneDef = {
  id: 'eastbrook_vale',
  name: 'Eastbrook Vale',
  zMin: -180,
  zMax: 180,
  levelRange: [1, 7],
  biome: 'vale',
  hub: { x: 0, z: 0, radius: TOWN_RADIUS, name: 'Eastbrook' },
  graveyard: GRAVEYARD_POS,
  lakes: [LAKE],
  pois: [
    { x: 0, z: -3, label: 'Eastbrook' },
    { x: -2, z: 70, label: 'Wolf Run' },
    { x: 65, z: 0, label: 'Boar Meadow' },
    { x: -88, z: 82, label: 'Mirror Lake' },
    { x: -60, z: 4, label: 'Webwood' },
    { x: -84, z: -64, label: 'Copper Dig' },
    { x: 76, z: -76, label: 'Bandit Camp' },
    { x: 80, z: 80, label: 'Fallen Chapel' },
    { x: -5, z: -52, label: 'Reliquary Hill' },
    { x: 40, z: 140, label: 'Brightwood Glade' },
  ],
  welcome: 'Find Marshal Redbrook in town — he has work for you.',
  welcomeQuestId: 'q_wolves',
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const ZONE1_MOBS: Record<string, MobTemplate> = {
  warlock_imp: {
    id: 'warlock_imp',
    name: 'Fire Demon',
    minLevel: 1,
    maxLevel: 20,
    family: 'demon',
    hpBase: 24,
    hpPerLevel: 11,
    dmgBase: 2,
    dmgPerLevel: 0.7,
    attackSpeed: 2.0,
    armorPerLevel: 5,
    moveSpeed: 8,
    aggroRadius: 0,
    loot: [],
    scale: 0.65,
    color: 0xff5a2e,
    petRole: 'ranged_dps',
    petSpell: { name: 'Firebolt', school: 'fire', min: 8, max: 11, range: 24, every: 2.0 },
  },
  warlock_voidwalker: {
    id: 'warlock_voidwalker',
    name: 'Void Demon',
    minLevel: 10,
    maxLevel: 20,
    family: 'demon',
    hpBase: 95,
    hpPerLevel: 24,
    dmgBase: 3,
    dmgPerLevel: 1.0,
    attackSpeed: 2.4,
    armorPerLevel: 28,
    moveSpeed: 7.2,
    aggroRadius: 0,
    loot: [],
    scale: 0.9,
    color: 0x6b4bb5,
    petRole: 'melee_tank',
  },
  forest_wolf: {
    id: 'forest_wolf',
    name: 'Forest Wolf',
    minLevel: 1,
    maxLevel: 2,
    family: 'beast',
    hpBase: 28,
    hpPerLevel: 14,
    dmgBase: 3,
    dmgPerLevel: 1.6,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 10,
    loot: [
      { copper: 8, chance: 1 },
      { itemId: 'wolf_fang', chance: 0.45 },
      { itemId: 'milepost_boots', chance: 0.1 },
    ],
    scale: 0.9,
    color: 0x7f8c8d,
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
  },
  old_greyjaw: {
    id: 'old_greyjaw',
    name: 'Old Greyjaw',
    minLevel: 4,
    maxLevel: 4,
    family: 'beast',
    rare: true,
    hpBase: 110,
    hpPerLevel: 20,
    dmgBase: 5,
    dmgPerLevel: 2.0,
    attackSpeed: 1.8,
    armorPerLevel: 16,
    moveSpeed: 8.5,
    aggroRadius: 12,
    // The old wolf turns savage as the fight wears on: each wound it takes can
    // send it into a blood frenzy, swinging 30% faster for 8s.
    frenzyOnHit: { chance: 0.25, hasteMult: 1.3, duration: 8, name: 'Blood Frenzy' },
    loot: [
      { copper: 60, chance: 1 },
      { itemId: 'greyjaw_fang', chance: 1, questId: 'q_greyjaw' },
      { itemId: 'wolf_fang', chance: 1 },
    ],
    scale: 1.25,
    color: 0x566061,
  },
  wild_boar: {
    id: 'wild_boar',
    name: 'Wild Boar',
    minLevel: 2,
    maxLevel: 3,
    family: 'beast',
    hpBase: 34,
    hpPerLevel: 16,
    dmgBase: 4,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 14,
    moveSpeed: 7.5,
    aggroRadius: 9,
    // Stiff bristles prick anyone who melees the boar.
    thorns: { value: 2, name: 'Bristled Hide' },
    loot: [
      { copper: 12, chance: 1 },
      { itemId: 'boar_hide', chance: 0.6, questId: 'q_boars' },
      { itemId: 'tough_jerky', chance: 0.3 },
      { itemId: 'trail_leggings', chance: 0.1 },
    ],
    scale: 0.85,
    color: 0x935116,
  },
  webwood_spider: {
    id: 'webwood_spider',
    name: 'Webwood Lurker',
    minLevel: 2,
    maxLevel: 4,
    family: 'spider',
    hpBase: 30,
    hpPerLevel: 15,
    dmgBase: 4,
    dmgPerLevel: 1.7,
    attackSpeed: 1.8,
    armorPerLevel: 8,
    moveSpeed: 8,
    aggroRadius: 10,
    venom: {
      chance: 0.35,
      perTick: 2,
      interval: 2,
      duration: 10,
      name: 'Spider Venom',
      school: 'nature',
    },
    ensnare: { chance: 0.25, duration: 3, name: 'Sticky Web', school: 'nature' },
    loot: [
      { copper: 14, chance: 1 },
      { itemId: 'webwood_silk', chance: 0.55, questId: 'q_spiders' },
      { itemId: 'spider_leg', chance: 0.4 },
    ],
    scale: 0.9,
    color: 0x4a235a,
  },
  mogger: {
    id: 'mogger',
    name: 'Mogger',
    minLevel: 6,
    maxLevel: 6,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 4,
    hpBase: 300,
    hpPerLevel: 58,
    dmgBase: 12,
    dmgPerLevel: 3.5,
    attackSpeed: 2.2,
    armorPerLevel: 34,
    moveSpeed: 7.4,
    aggroRadius: 14,
    aoePulse: { min: 14, max: 20, radius: 8, every: 10, name: 'Ground Pound', school: 'physical' },
    summonAdds: { mobId: 'mogger_lackey', count: 2, atHpPct: [0.7] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.6, hasteMult: 1.3 },
    wardAllies: {
      radius: 12,
      every: 12,
      amount: 70,
      duration: 8,
      name: 'Bracing Order',
      school: 'physical',
    },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'linen_scrap', chance: 1 },
      { itemId: 'moggers_stomper_boots', chance: 0.3 },
      { itemId: 'moggers_shiv', chance: 0.25, rollGroup: 'mogger_chase' },
      { itemId: 'cryptstalker_jerkin', chance: 0.25, rollGroup: 'mogger_chase' },
    ],
    scale: 1.28,
    color: 0x8e5b33,
  },
  mogger_lackey: {
    id: 'mogger_lackey',
    name: 'Mogger Lackey',
    minLevel: 5,
    maxLevel: 6,
    family: 'humanoid',
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 7.5,
    aggroRadius: 12,
    stunOnHit: { chance: 0.12, duration: 1, name: 'Skullthump', school: 'physical' },
    loot: [],
    scale: 0.95,
    color: 0x7b4b2b,
  },
  mudfin_murloc: {
    id: 'mudfin_murloc',
    name: 'Mudfin Skulker',
    minLevel: 3,
    maxLevel: 5,
    family: 'murloc',
    hpBase: 36,
    hpPerLevel: 17,
    dmgBase: 5,
    dmgPerLevel: 1.9,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13, // murlocs aggro from far and bring friends
    loot: [
      { copper: 18, chance: 1 },
      { itemId: 'mudfin_scale', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.2 },
    ],
    scale: 0.8,
    color: 0x52be80,
    // Mudfin Hex: the skulker's oracle-chant briefly turns a foe into a critter.
    // Low chance and it breaks the instant the victim takes damage (the murloc's
    // own next bite ends it), so it's a brief flavor incap — but a murloc pack
    // can chain it just long enough to make a careless pull dangerous.
    polymorphHex: { chance: 0.12, duration: 4, name: 'Mudfin Hex', school: 'nature' },
  },
  tunnel_rat: {
    id: 'tunnel_rat',
    name: 'Tunnel Rat Digger',
    minLevel: 4,
    maxLevel: 6,
    family: 'kobold',
    hpBase: 42,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 2.0,
    attackSpeed: 2.1,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 10,
    loot: [
      { copper: 22, chance: 1 },
      { itemId: 'tallow_candle', chance: 0.6 },
      { itemId: 'blessed_wax', chance: 0.45, questId: 'q_rite' },
      { itemId: 'linen_scrap', chance: 0.25 },
      { itemId: 'mossy_handwraps', chance: 0.15 },
    ],
    scale: 0.85,
    color: 0x9c640c,
  },
  grix_the_tunnelking: {
    id: 'grix_the_tunnelking',
    name: 'Grix the Tunnelking',
    minLevel: 7,
    maxLevel: 7,
    family: 'kobold',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 280,
    hpPerLevel: 52,
    dmgBase: 11,
    dmgPerLevel: 3.3,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 13,
    aoePulse: { min: 12, max: 18, radius: 8, every: 9, name: 'Cave-In', school: 'physical' },
    summonAdds: { mobId: 'tunnel_rat', count: 2, atHpPct: [0.55, 0.3] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'tallow_candle', chance: 1 },
      // The hoarder's stash — a guaranteed step up the potion ladder this early.
      { itemId: 'lesser_healing_potion', chance: 1 },
      { itemId: 'tunnelkings_spade', chance: 0.3 },
      { itemId: 'moggers_copper_cudgel', chance: 0.25, rollGroup: 'grix_tunnelking_chase' },
      { itemId: 'hollowbone_hauberk', chance: 0.25, rollGroup: 'grix_tunnelking_chase' },
    ],
    scale: 1.15,
    color: 0xb9770e,
  },
  vale_bandit: {
    id: 'vale_bandit',
    name: 'Vale Bandit',
    minLevel: 3,
    maxLevel: 5,
    family: 'humanoid',
    hpBase: 40,
    hpPerLevel: 18,
    dmgBase: 5,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 11,
    loot: [
      { copper: 25, chance: 1 },
      { itemId: 'bandit_bandana', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x943126,
    // A practiced thug flings a handful of road grit to foul your aim.
    blind: { chance: 0.25, miss: 0.3, duration: 5, name: 'Blinding Powder', school: 'physical' },
  },
  restless_bones: {
    id: 'restless_bones',
    name: 'Restless Bones',
    minLevel: 5,
    maxLevel: 7,
    family: 'undead',
    hpBase: 46,
    hpPerLevel: 19,
    dmgBase: 7,
    dmgPerLevel: 2.1,
    attackSpeed: 2.3,
    armorPerLevel: 14,
    moveSpeed: 6.5,
    aggroRadius: 11,
    loot: [
      { copper: 30, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'ghostly_essence', chance: 0.55, questId: 'q_rite' },
    ],
    scale: 1.0,
    color: 0xd5dbdb,
    // A grave-cold wail saps the strength from the living it strikes.
    demoralize: { ap: 20, duration: 8, name: 'Withering Wail' },
    // Grave-touch: a clawing swing may fester a creeping necrotic rot (shadow DoT).
    soulrot: { chance: 0.25, perTick: 4, interval: 3, duration: 12, name: 'Soulrot' },
  },
  captain_verlan: {
    // A rare named undead champion risen among the ruins' Restless Bones —
    // the undead family's rare elite, filling the gap beside Old Greyjaw
    // (beast), Elder Bristleback (beast), Sableweb Matriarch (spider) and
    // Mogger (humanoid). A heavy, slow striker that erupts in a shadow nova
    // and goes berserk when low; loot mirrors the other rare elites.
    id: 'captain_verlan',
    name: 'Captain Verlan',
    minLevel: 7,
    maxLevel: 7,
    family: 'undead',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 280,
    hpPerLevel: 56,
    dmgBase: 12,
    dmgPerLevel: 3.4,
    attackSpeed: 2.6,
    armorPerLevel: 32,
    moveSpeed: 7.4,
    aggroRadius: 13,
    aoePulse: {
      min: 13,
      max: 19,
      radius: 9,
      every: 9,
      name: 'Hollow Nova',
      school: 'shadow',
      fx: 'nova',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'oathbound_greaves', chance: 0.3 },
      { itemId: 'verlans_oathblade', chance: 0.25, rollGroup: 'verlan_chase' },
      { itemId: 'hollow_vigil_staff', chance: 0.25, rollGroup: 'verlan_chase' },
      { itemId: 'gravewardens_shiv', chance: 0.25, rollGroup: 'verlan_chase' },
    ],
    scale: 1.26,
    color: 0x3b4a5a,
  },
  wraithbinder_maldrec: {
    id: 'wraithbinder_maldrec',
    name: 'Wraithbinder Maldrec',
    minLevel: 7,
    maxLevel: 7,
    family: 'undead',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 320,
    hpPerLevel: 60,
    dmgBase: 12,
    dmgPerLevel: 3.4,
    attackSpeed: 2.3,
    armorPerLevel: 28,
    moveSpeed: 6.8,
    aggroRadius: 13,
    // A fallen Gravecaller who bound his own soul to the chapel dead. A pulse of
    // grave-cold shadow rolls off him, and he tears the restless bones from the
    // ground to fight at his side, growing frantic as he is unmade.
    aoePulse: { min: 13, max: 19, radius: 9, every: 9, name: 'Grave Chill', school: 'shadow' },
    summonAdds: { mobId: 'restless_bones', count: 2, atHpPct: [0.65, 0.35] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'maldrecs_soulbinder', chance: 0.25 },
      { itemId: 'hollowbone_hauberk', chance: 0.25, rollGroup: 'maldrec_chase' },
      { itemId: 'gravewoven_raiment', chance: 0.25, rollGroup: 'maldrec_chase' },
      { itemId: 'cryptstalker_jerkin', chance: 0.25, rollGroup: 'maldrec_chase' },
    ],
    scale: 1.22,
    color: 0x6f7f8f,
  },
  gorrak: {
    id: 'gorrak',
    name: 'Gorrak the Ruthless',
    minLevel: 6,
    maxLevel: 6,
    family: 'humanoid',
    hpBase: 160,
    hpPerLevel: 30,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 30,
    moveSpeed: 7,
    aggroRadius: 13,
    boss: true,
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'bandit_bandana', chance: 1 },
      { itemId: 'oiled_boots', chance: 0.5 },
      { itemId: 'quilted_trousers', chance: 0.5 },
      { itemId: 'gorraks_cruel_chopper', chance: 0.25 },
      { itemId: 'gorraks_cleaver', chance: 0.3 },
    ],
    scale: 1.25,
    color: 0x6c3483,
  },
};

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export const ZONE1_NPCS: Record<string, NpcDef> = {
  the_merchant: {
    id: 'the_merchant',
    name: 'The Merchant',
    title: 'Keeper of the World Market',
    // centerpiece of the square, just north of the well, facing the approach
    pos: { x: 0, z: 9.5 },
    facing: Math.PI,
    color: 0xd4af37,
    questIds: [],
    market: true,
    greeting:
      'Welcome to the World Market, $C. Buy from every adventurer in the realm — or set out your own wares and let coin find you.',
  },
  marshal_redbrook: {
    id: 'marshal_redbrook',
    name: 'Marshal Redbrook',
    title: 'Town Marshal',
    pos: { x: 4, z: 6 },
    facing: Math.PI,
    color: 0xb7950b,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader', 'q_mogger'],
    greeting: 'Keep your blade close, $C. The Vale is not what it was.',
  },
  trader_wilkes: {
    id: 'trader_wilkes',
    name: 'Trader Wilkes',
    title: 'Provisioner',
    pos: { x: -7, z: 3 },
    facing: Math.PI / 2,
    color: 0x1e8449,
    questIds: ['q_boars', 'q_supplies'],
    vendorItems: [
      'baked_bread',
      'spring_water',
      'roasted_boar',
      'tough_jerky',
      'minor_healing_potion',
      'minor_mana_potion',
    ],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
  },
  apothecary_lin: {
    id: 'apothecary_lin',
    name: 'Apothecary Lin',
    title: 'Herbalist',
    pos: { x: 11, z: -3 },
    facing: -Math.PI / 2,
    color: 0x7d3c98,
    questIds: ['q_spiders'],
    greeting: 'Careful where you step in the eastern woods, friend.',
  },
  brother_aldric: {
    id: 'brother_aldric',
    name: 'Brother Aldric',
    title: 'Priest of the Vale',
    pos: { x: -14, z: -10 },
    facing: 0.8,
    color: 0xf7f9f9,
    questIds: [
      'q_bones',
      'q_whispers',
      'q_names_of_the_dead',
      'q_silence_the_call',
      'q_rite',
      'q_sexton',
      'q_hollow',
      'q_gravecallers_trail',
      'q_fenbridge_muster',
    ],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  smith_haldren: {
    id: 'smith_haldren',
    name: 'Smith Haldren',
    title: 'Armorer & Weaponsmith',
    pos: { x: 7, z: 16.5 },
    facing: -2.7,
    color: 0x707b7c,
    questIds: [],
    vendorItems: [
      'eastbrook_arming_sword',
      'bronzework_mace',
      'vale_carving_knife',
      'hickory_shortstaff',
      'eastbrook_chain_vest',
      'valespun_robe',
      'tanned_leather_jerkin',
      'hobnail_boots',
      'eastbrook_wool_trousers',
    ],
    greeting: 'Mind the sparks, $C. Good steel is the difference between a scar and a grave.',
  },
  fisherman_brandt: {
    id: 'fisherman_brandt',
    name: 'Fisherman Brandt',
    title: 'Old Salt',
    // in town (east edge, glaring out at Mirror Lake) — his old spot by the
    // dock sat inside the Mudfin spawn radius and new players got ambushed
    // walking up to a quest giver
    pos: { x: -16, z: 6 },
    facing: -0.75,
    color: 0x2471a3,
    questIds: ['q_murlocs'],
    vendorItems: ['simple_fishing_pole'],
    greeting: 'Grlmurlgrl— sorry, been listening to those fish-men too long.',
  },
  foreman_odell: {
    id: 'foreman_odell',
    name: 'Foreman Odell',
    title: 'Mine Foreman',
    // in town (south edge, scowling toward his overrun dig) — his old spot
    // sat inside the Tunnel Rat spawn radius
    pos: { x: -4, z: -14 },
    facing: -2.14,
    color: 0xa04000,
    questIds: ['q_mine'],
    greeting: "Whole dig's crawling with those candle-headed vermin!",
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const ZONE1_QUESTS: Record<string, QuestDef> = {
  q_wolves: {
    id: 'q_wolves',
    name: 'Wolves at the Door',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'The forest wolves grow bold, snapping at travelers on the north road. Thin their numbers, $N. Slay 8 Forest Wolves and Eastbrook will breathe easier.',
    completionText: 'Fine work. The road feels safer already.',
    objectives: [
      { type: 'kill', targetMobId: 'forest_wolf', count: 8, label: 'Forest Wolf slain' },
    ],
    xpReward: 250,
    copperReward: 75,
    itemRewards: {},
  },
  q_greyjaw: {
    id: 'q_greyjaw',
    name: 'The Old Wolf',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: "There is one wolf no trap has held: Old Greyjaw. He has taken three hounds and a stable boy's arm. He prowls the deep woods north of the wolf runs. Bring me his fang.",
    completionText:
      'So the old devil is dead at last. The stable boy will sleep easier — and so will I.',
    objectives: [
      { type: 'collect', itemId: 'greyjaw_fang', count: 1, label: "Old Greyjaw's Fang" },
    ],
    xpReward: 450,
    copperReward: 150,
    itemRewards: {
      warrior: 'greyjaw_pelt_cloak',
      mage: 'greyjaw_pelt_cloak',
      rogue: 'greyjaw_pelt_cloak',
    },
    requiresQuest: 'q_wolves',
  },
  q_boars: {
    id: 'q_boars',
    name: 'Bristleback Hides',
    giverNpcId: 'trader_wilkes',
    turnInNpcId: 'trader_wilkes',
    text: 'Boar hide makes the finest travel packs, and the meadows west of town are crawling with the beasts. Bring me 5 Bristly Boar Hides and I will make it worth your time.',
    completionText: 'Ah, fine bristly hides! These will fetch a good price.',
    objectives: [{ type: 'collect', itemId: 'boar_hide', count: 5, label: 'Bristly Boar Hide' }],
    xpReward: 350,
    copperReward: 120,
    itemRewards: {},
  },
  q_spiders: {
    id: 'q_spiders',
    name: 'Webwood Menace',
    giverNpcId: 'apothecary_lin',
    turnInNpcId: 'apothecary_lin',
    text: 'The lurkers in the eastern woods spin a silk I need for my poultices — and they have grown far too numerous besides. Cull 6 Webwood Lurkers and cut 4 silk glands from their bellies.',
    completionText: "Ugh, still twitching. Perfect. Here, you've earned this.",
    objectives: [
      { type: 'kill', targetMobId: 'webwood_spider', count: 6, label: 'Webwood Lurker slain' },
      { type: 'collect', itemId: 'webwood_silk', count: 4, label: 'Webwood Silk Gland' },
    ],
    xpReward: 420,
    copperReward: 140,
    itemRewards: {},
    minLevel: 2,
  },
  q_murlocs: {
    id: 'q_murlocs',
    name: 'Trouble at the Lake',
    giverNpcId: 'fisherman_brandt',
    turnInNpcId: 'fisherman_brandt',
    text: 'Twenty years I have fished Mirror Lake, and never lost a net until those gurgling fish-men crawled out of the shallows. Drive the Mudfin back — slay 8 of them. And watch yourself: where there is one murloc, there are five.',
    completionText: 'Hah! That will teach them to mind their own mudholes.',
    objectives: [
      { type: 'kill', targetMobId: 'mudfin_murloc', count: 8, label: 'Mudfin Skulker slain' },
    ],
    xpReward: 520,
    copperReward: 180,
    itemRewards: {},
    minLevel: 3,
  },
  q_mine: {
    id: 'q_mine',
    name: 'Rats in the Mine',
    giverNpcId: 'foreman_odell',
    turnInNpcId: 'foreman_odell',
    text: 'We struck a fine copper vein and then those kobold vermin came boiling out of the hillside. My crew will not set foot in the dig until it is cleared. Put down 10 Tunnel Rat Diggers.',
    completionText: 'Ha! Back to work, lads! You have my thanks — and my coin.',
    objectives: [
      { type: 'kill', targetMobId: 'tunnel_rat', count: 10, label: 'Tunnel Rat Digger slain' },
    ],
    xpReward: 620,
    copperReward: 220,
    itemRewards: {},
    minLevel: 4,
  },
  q_bones: {
    id: 'q_bones',
    name: 'The Restless Dead',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'The old ruin on the northwest hill was a chapel once, and its yard a resting place. Something has stirred the dead from their sleep. Grant them peace, $N — return 8 Restless Bones to the earth.',
    completionText: 'May they rest now, and may the Light forgive whatever woke them.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'restless_bones',
        count: 8,
        label: 'Restless Bones laid to rest',
      },
    ],
    xpReward: 700,
    copperReward: 260,
    itemRewards: {},
    minLevel: 5,
  },
  q_supplies: {
    id: 'q_supplies',
    name: 'Stolen Supplies',
    giverNpcId: 'trader_wilkes',
    turnInNpcId: 'trader_wilkes',
    text: 'Those bandits hit my last wagon and made off with four crates of goods — tools, salt, good Eastbrook linen. The crates are stacked around their camp in the southeast hills. Steal them back for me, would you?',
    completionText: 'My crates! Barely a scratch on them. You are a wonder.',
    objectives: [
      { type: 'collect', itemId: 'supply_crate', count: 4, label: 'Stolen Supply Crate' },
    ],
    xpReward: 550,
    copperReward: 250,
    itemRewards: {},
    minLevel: 3,
  },
  q_whispers: {
    id: 'q_whispers',
    name: 'Whispers Below',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'You have laid the dead to rest, but they will not stay resting — something calls them back. Search the chapel ruin for any trace of the one doing the calling. If you find a sigil or seal, bring it to me untouched.',
    completionText:
      'This sigil... it bears the mark of the Gravecallers, a sect I had prayed was extinct. This is worse than I feared, $N.',
    objectives: [
      { type: 'collect', itemId: 'gravecaller_sigil', count: 1, label: "Gravecaller's Sigil" },
    ],
    xpReward: 400,
    copperReward: 150,
    itemRewards: {},
    requiresQuest: 'q_bones',
  },
  q_names_of_the_dead: {
    id: 'q_names_of_the_dead',
    name: 'The Names of the Dead',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'If the Gravecallers raised our dead, I must know whose graves they robbed. The chapel sexton kept a burial ledger, and the wind has scattered its pages across the chapel yard. Gather 3 of them for me, $N — the dead deserve to be called by their names.',
    completionText:
      "These poor souls... and look here. Sexton Marrow — the chapel's own living caretaker — his grave the first disturbed. Morthen began with the very man who buried Eastbrook's dead.",
    objectives: [
      {
        type: 'collect',
        itemId: 'weathered_ledger_page',
        count: 3,
        label: 'Weathered Ledger Page',
      },
    ],
    xpReward: 600,
    copperReward: 250,
    itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_silence_the_call: {
    id: 'q_silence_the_call',
    name: 'Silence the Call',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "Every name in that ledger is a soul Morthen means to drag from the earth, and the chapel yard already crawls with those he has called. Return 12 Restless Bones to their graves, $N, before the Gravecaller's whisper swells into a chorus.",
    completionText:
      'The yard grows quieter — but the calling has not stopped. It rises from below now, $N. From the crypt itself.',
    objectives: [
      { type: 'kill', targetMobId: 'restless_bones', count: 12, label: 'Restless Bones silenced' },
    ],
    xpReward: 750,
    copperReward: 300,
    itemRewards: {},
    requiresQuest: 'q_names_of_the_dead',
  },
  q_rite: {
    id: 'q_rite',
    name: 'The Binding Rite',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'The crypt beneath the chapel must be unsealed if we are to stop the Gravecaller — but only a binding rite will let the living pass. I need 4 lumps of Blessed Tallow — the kobold diggers hoard candles by the crate — and 6 Ghostly Essences from the restless dead.',
    completionText:
      'It is done. The way below stands open... and may the Light forgive me for opening it. Gather your strongest companions before you descend, $N. No one should face the Hollow alone.',
    objectives: [
      { type: 'collect', itemId: 'blessed_wax', count: 4, label: 'Blessed Tallow' },
      { type: 'collect', itemId: 'ghostly_essence', count: 6, label: 'Ghostly Essence' },
    ],
    xpReward: 700,
    copperReward: 500,
    itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_hollow: {
    id: 'q_hollow',
    name: 'Into the Hollow',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "Morthen the Gravecaller waits at the bottom of the Hollow Crypt, ringed by the elite dead he has raised. He is far beyond any one hero — take four companions, no fewer. End him, and the Vale's dead will finally sleep.",
    completionText:
      'The whispering has stopped. You have done what the whole Vale could not, $N — the dead sleep, and Eastbrook owes you everything it has.',
    objectives: [
      { type: 'kill', targetMobId: 'morthen', count: 1, label: 'Morthen the Gravecaller slain' },
    ],
    xpReward: 1500,
    copperReward: 10000,
    itemRewards: {
      warrior: 'gravecaller_blade',
      rogue: 'widowfang_dirk',
      mage: 'gravecaller_staff',
    },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_sexton: {
    id: 'q_sexton',
    name: "The Sexton's Bell",
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "The ledger named him and the crypt holds him: Sexton Marrow, the chapel's caretaker, the first man Morthen raised — guarding his master's door in death as faithfully as he kept the chapel in life. Take four companions into the Hollow Crypt and grant the old sexton the rest he was robbed of, $N.",
    completionText:
      'So Marrow is free at last. Ring no bell for him — he heard enough of them in life.',
    objectives: [
      { type: 'kill', targetMobId: 'sexton_marrow', count: 1, label: 'Sexton Marrow laid to rest' },
    ],
    xpReward: 1000,
    copperReward: 600,
    itemRewards: {
      warrior: 'marrowtread_boots',
      mage: 'sextons_slippers',
      rogue: 'gravewalker_softboots',
    },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_gravecallers_trail: {
    id: 'q_gravecallers_trail',
    name: "The Gravecaller's Trail",
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'Morthen is dead, yet a question gnaws at me: a sect that hid for a century does not spend itself on one village chapel. He kept a grimoire — his rites, his correspondence. If anything of it survives, it lies in the vestry of the ruined chapel above the crypt. Search the ruin and bring me whatever remains of his writings, $N.',
    completionText:
      "Morthen wrote to a 'Mistcaller' in the northern fen. The sect is not dead, $N — it has merely been patient.",
    objectives: [
      { type: 'collect', itemId: 'morthen_grimoire', count: 1, label: "Morthen's Grimoire" },
    ],
    xpReward: 900,
    copperReward: 400,
    itemRewards: {},
    requiresQuest: 'q_hollow',
  },
  q_bandits: {
    id: 'q_bandits',
    name: 'Bandits of the Vale',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'A pack of cutthroats has made camp in the southwest hills. They have robbed three wagons this week. Drive them out — slay 10 Vale Bandits.',
    completionText: 'Ten fewer knives in the dark. Take this — you have earned it.',
    objectives: [
      { type: 'kill', targetMobId: 'vale_bandit', count: 10, label: 'Vale Bandit slain' },
    ],
    xpReward: 550,
    copperReward: 200,
    itemRewards: { warrior: 'redbrook_blade', mage: 'apprentice_staff', rogue: 'keen_dirk' },
    requiresQuest: 'q_wolves',
  },
  q_ringleader: {
    id: 'q_ringleader',
    name: 'The Ringleader',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'The bandits answer to one man: Gorrak the Ruthless. Cut off the head and the body will scatter. He skulks at the heart of their camp. End him, $N.',
    completionText:
      'Gorrak is dead? Then the Vale is free of his shadow. You have done Eastbrook a great service.',
    objectives: [
      { type: 'kill', targetMobId: 'gorrak', count: 1, label: 'Gorrak the Ruthless slain' },
    ],
    xpReward: 800,
    copperReward: 500,
    itemRewards: { warrior: 'militia_vest', mage: 'woven_robe', rogue: 'shadow_jerkin' },
    requiresQuest: 'q_bandits',
  },
  q_mogger: {
    id: 'q_mogger',
    name: 'Mogger Must Fall',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'Mogger has split carts, flattened fences, and killed enough livestock to empty half the Vale. Do not face him alone. Take two strong companions into the eastern meadow and put the brute down for good.',
    completionText:
      "Mogger dead at last. Eastbrook's fields are safer, and you leave the Vale with one more tale worth retelling.",
    objectives: [{ type: 'kill', targetMobId: 'mogger', count: 1, label: 'Mogger slain' }],
    xpReward: 1200,
    copperReward: 900,
    itemRewards: {
      warrior: 'bristleback_maul',
      mage: 'sableweb_slippers',
      rogue: 'moggers_stomper_boots',
    },
    requiresQuest: 'q_gravecallers_trail',
    minLevel: 6,
    suggestedPlayers: 3,
  },
};

export const ZONE1_QUEST_ORDER = [
  'q_wolves',
  'q_boars',
  'q_spiders',
  'q_greyjaw',
  'q_murlocs',
  'q_supplies',
  'q_bandits',
  'q_mine',
  'q_bones',
  'q_ringleader',
  'q_whispers',
  'q_names_of_the_dead',
  'q_silence_the_call',
  'q_rite',
  'q_sexton',
  'q_hollow',
  'q_gravecallers_trail',
  'q_mogger',
];

// ---------------------------------------------------------------------------
// World layout. Town sits at origin. +z north, +x WEST (east is -x:
// facing 0 looks along +z and turning right decreases facing, so the
// rendered world and the corrected map both put -x on your right).
// ---------------------------------------------------------------------------

export const ZONE1_CAMPS: CampDef[] = [
  // Wolves: north woods
  { mobId: 'forest_wolf', center: { x: -15, z: 55 }, radius: 22, count: 7 },
  { mobId: 'forest_wolf', center: { x: 20, z: 70 }, radius: 20, count: 6 },
  { mobId: 'old_greyjaw', center: { x: 0, z: 95 }, radius: 8, count: 1 },
  // Boars: east meadow
  { mobId: 'wild_boar', center: { x: 55, z: 12 }, radius: 22, count: 6 },
  { mobId: 'wild_boar', center: { x: 80, z: -15 }, radius: 18, count: 5 },
  { mobId: 'mogger', center: { x: 118, z: -26 }, radius: 5, count: 1 },
  // Spiders: western woods
  { mobId: 'webwood_spider', center: { x: -60, z: 5 }, radius: 22, count: 7 },
  // Murlocs: lake shore northwest — camp straddles the waterline
  { mobId: 'mudfin_murloc', center: { x: -75, z: 57 }, radius: 14, count: 8 },
  // Kobolds: mine southwest
  { mobId: 'tunnel_rat', center: { x: -82, z: -62 }, radius: 20, count: 9 },
  // Bandits: southeast camp
  { mobId: 'vale_bandit', center: { x: 65, z: -65 }, radius: 24, count: 7 },
  { mobId: 'vale_bandit', center: { x: 90, z: -90 }, radius: 16, count: 5 },
  { mobId: 'gorrak', center: { x: 92, z: -92 }, radius: 2, count: 1 },
  // Undead: ruins northeast
  { mobId: 'restless_bones', center: { x: 80, z: 78 }, radius: 18, count: 8 },
  { mobId: 'captain_verlan', center: { x: 92, z: 90 }, radius: 4, count: 1 },
];

// Spawned LAST in the merged CAMPS array (see data.ts) so these appended draws
// fall after every other zone's camp spawns — and the camp loop is the final
// RNG consumer at construction (ground objects, dungeon doors and addPlayer draw
// none). Keeping the rare elite at the tail means adding it shifts no other
// content's deterministic spawn rolls, so fixed-seed tests stay stable.
export const ZONE1_CHAPEL_CAMPS: CampDef[] = [
  // A pair of bone guardians flank the chapel's broken altar; their binder lurks within.
  { mobId: 'restless_bones', center: { x: 88, z: 90 }, radius: 6, count: 2 },
  { mobId: 'wraithbinder_maldrec', center: { x: 88, z: 92 }, radius: 3, count: 1 },
];

export const ZONE1_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'supply_crate',
    name: 'Stolen Supply Crate',
    positions: [
      { x: 58, z: -58 },
      { x: 73, z: -70 },
      { x: 86, z: -82 },
      { x: 95, z: -97 },
      { x: 64, z: -76 },
      { x: 81, z: -94 },
    ],
  },
  {
    itemId: 'gravecaller_sigil',
    name: "Gravecaller's Sigil",
    positions: [
      { x: 84, z: 88 },
      { x: 76, z: 92 },
    ],
  },
  {
    itemId: 'weathered_ledger_page',
    name: 'Weathered Ledger Page',
    positions: [
      { x: 78, z: 84 },
      { x: 83, z: 88 },
      { x: 86, z: 92 },
    ],
  },
  {
    itemId: 'morthen_grimoire',
    name: "Morthen's Grimoire",
    positions: [{ x: 78, z: 86 }],
  },
];

// Roads from town toward each hub — used for terrain painting and the map.
// Roads from town toward each hub — used for terrain painting and the map.
export const ZONE1_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: 8 },
    { x: -8, z: 30 },
    { x: -15, z: 55 },
    { x: -2, z: 78 },
  ], // north to wolves
  [
    { x: 8, z: 2 },
    { x: 30, z: 8 },
    { x: 55, z: 12 },
  ], // east to boars
  [
    { x: 6, z: -6 },
    { x: 30, z: -30 },
    { x: 50, z: -50 },
    { x: 65, z: -65 },
  ], // southeast to bandits
  [
    { x: -8, z: 6 },
    { x: -35, z: 25 },
    { x: -58, z: 48 },
    { x: -66, z: 58 },
  ], // northwest to lake
  [
    { x: -6, z: -6 },
    { x: -30, z: -28 },
    { x: -55, z: -45 },
    { x: -70, z: -55 },
  ], // southwest to mine
  [
    { x: 6, z: 8 },
    { x: 35, z: 35 },
    { x: 60, z: 60 },
    { x: 78, z: 74 },
  ], // northeast to ruins
];

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data)
// ---------------------------------------------------------------------------

export const ZONE1_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'house', x: 10, z: 12, w: 7, d: 6, rot: -0.4 },
    { kind: 'house', x: -10, z: 10, w: 6, d: 5, rot: 0.5 },
    { kind: 'inn', x: 12, z: -6, w: 6, d: 7, rot: 2.4 },
    { kind: 'chapel', x: -16, z: -8, w: 5, d: 7, rot: 0.9 },
  ],
  wells: [{ x: 0, z: 2, r: 1.5 }],
  stalls: [
    { x: -8.5, z: 3, rot: Math.PI / 2, r: 1.7 },
    { x: 9.5, z: 17.5, rot: -2.7, r: 1.7 }, // Smith Haldren's smithy stall
    { x: 0, z: 11.5, rot: Math.PI, r: 1.8 }, // The Merchant's World Market stall
  ],
  mines: [{ x: -88, z: -68, rot: 0.8 }],
  docks: [{ x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } }],
  tents: [
    { x: 62, z: -61, rot: 0.4, scale: 1 },
    { x: 69, z: -69, rot: 2.1, scale: 1 },
    { x: 88, z: -86, rot: 1.2, scale: 1.3 },
    { x: 95, z: -94, rot: -0.6, scale: 1 },
  ],
  crates: [
    [60, -63],
    [66, -67],
    [87, -88],
    [93, -90],
    [70, -72],
  ],
  campfires: [
    [3, -4],
    [65, -65],
    [90, -90],
    [-80, -60],
    [-61, 56],
  ],
  mudHuts: [
    [-73, 59],
    [-78, 54],
    [-69, 55],
  ],
  ruinRings: [
    { x: 80, z: 78, ringR: 7, columns: 7 },
    { x: -5, z: -60, ringR: 8, columns: 6 },
  ],
  fences: [
    { x1: 16, z1: 16, x2: 22, z2: 4 },
    { x1: -16, z1: 14, x2: -20, z2: 2 },
  ],
  graveyards: [
    { x: -14, z: -14 },
    { x: 4, z: -56 },
  ],
  delveMarkers: [{ x: -5, z: -52, delveId: 'collapsed_reliquary' }],
};
