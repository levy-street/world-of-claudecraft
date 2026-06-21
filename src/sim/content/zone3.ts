// Zone 3 — Thornpeak Heights (levels 13-20). The Gravecallers serve Korzul
// the Gravewyrm, an ancient dragon sealed beneath the peaks. Highwatch holds
// the wall against ogres, waking elementals, and the open chanting of the
// Wyrmcult at the Gravewyrm Sanctum gates.

import type {
  CampDef, GroundObjectDef, ItemDef, MobTemplate, NpcDef, QuestDef, ZoneDef, ZonePropsDef,
} from '../types';

export const ZONE3_ZONE: ZoneDef = {
  id: 'thornpeak_heights',
  name: 'Thornpeak Heights',
  zMin: 540,
  zMax: 900,
  levelRange: [13, 20],
  biome: 'peaks',
  hub: { x: 0, z: 660, radius: 20, name: 'Highwatch' },
  graveyard: { x: 15, z: 645 },
  lakes: [{ x: -70, z: 760, radius: 18 }],
  pois: [
    { x: 0, z: 660, label: 'Highwatch' },
    { x: -50, z: 590, label: 'Stalker Ridge' },
    { x: 85, z: 615, label: 'Deeprock Burrows' },
    { x: -90, z: 700, label: 'Ogre Foothills' },
    { x: -130, z: 740, label: "Drogmar's War-Camp" },
    { x: 110, z: 760, label: 'Stormcrag' },
    { x: -70, z: 770, label: 'The Glimmermere' },
    { x: 55, z: 820, label: 'Wyrmcult Tents' },
    { x: -40, z: 830, label: 'Revenant Fields' },
    { x: 0, z: 880, label: 'Gravewyrm Sanctum' },
  ],
  welcome: 'Captain Thessaly holds the wall at Highwatch — barely.',
};

// Mountain road from Fenbridge up to Highwatch, then spokes.
export const ZONE3_ROADS: { x: number; z: number }[][] = [
  [{ x: 0, z: 320 }, { x: 10, z: 450 }, { x: 0, z: 540 }, { x: 0, z: 660 }],        // Fenbridge -> Highwatch
  [{ x: -6, z: 666 }, { x: -60, z: 700 }, { x: -110, z: 735 }],                     // -> ogre war-camp
  [{ x: 6, z: 668 }, { x: 70, z: 720 }, { x: 110, z: 760 }],                        // -> Stormcrag
  [{ x: 0, z: 676 }, { x: 0, z: 780 }, { x: 0, z: 860 }],                           // -> Sanctum Approach
];

// ---------------------------------------------------------------------------
// Mobs (overworld only — the Gravewyrm Sanctum mobs live in content/dungeons)
// ---------------------------------------------------------------------------

export const ZONE3_MOBS: Record<string, MobTemplate> = {
  ridge_stalker: {
    id: 'ridge_stalker', name: 'Ridge Stalker', minLevel: 13, maxLevel: 14, family: 'beast',
    hpBase: 58, hpPerLevel: 21, dmgBase: 10, dmgPerLevel: 2.5, attackSpeed: 1.9,
    armorPerLevel: 14, moveSpeed: 8, aggroRadius: 11,
    // Rending Claws: the stalker's raking swipes can open a bleeding wound — a
    // refreshing physical DoT (~5 every 3s for 9s). Distinct from poison: it is
    // physical-school, so it bypasses poison cleanses and ignores nature resist.
    bleed: { chance: 0.25, perTick: 5, interval: 3, duration: 9, name: 'Rending Claws', school: 'physical' },
    loot: [
      { copper: 60, chance: 1 },
      { itemId: 'ridge_stalker_pelt', chance: 0.6, questId: 'q_stalker_pelts' },
    ],
    scale: 0.95, color: 0x8c8270,
  },
  // The apex of the southern ridge: a grizzled, scar-pelted old cat that has
  // outlived three generations of its pack. A rare elite counterpart to the
  // Ridge Stalkers, met first when climbing into Thornpeak. Reuses existing
  // mechanics only — a rending pounce (aoePulse) and a wounded-beast enrage.
  old_cragmaw: {
    id: 'old_cragmaw', name: 'Old Cragmaw', minLevel: 14, maxLevel: 14, family: 'beast', rare: true,
    elite: true, canSwim: true, ccImmune: true, respawnMult: 7.2,
    hpBase: 320, hpPerLevel: 56, dmgBase: 16, dmgPerLevel: 4.0, attackSpeed: 1.7,
    armorPerLevel: 24, moveSpeed: 8.6, aggroRadius: 13,
    aoePulse: { min: 22, max: 30, radius: 8, every: 9, name: 'Savage Pounce', school: 'physical' },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'ridge_stalker_pelt', chance: 1 },
      { itemId: 'cragmaw_prowlboots', chance: 0.3 },
    ],
    scale: 1.3, color: 0x6e6453,
  },
  deeprock_kobold: {
    id: 'deeprock_kobold', name: 'Deeprock Tunneler', minLevel: 14, maxLevel: 15, family: 'kobold',
    hpBase: 60, hpPerLevel: 22, dmgBase: 10, dmgPerLevel: 2.5, attackSpeed: 2.1,
    armorPerLevel: 18, moveSpeed: 7, aggroRadius: 10,
    loot: [
      { copper: 65, chance: 1 },
      { itemId: 'glowing_wax', chance: 0.5, questId: 'q_glowing_wax' },
      { itemId: 'tallow_candle', chance: 0.4 },
      { itemId: 'healing_potion', chance: 0.08 },
    ],
    scale: 0.85, color: 0x9c7a3c,
    // Jarring Swing: a heavy mining-pick blow knocks the victim off-balance,
    // cutting their dodge for 8s so the tunneler's strikes land more reliably.
    staggerHit: { chance: 0.3, dodgeReduction: 0.05, duration: 8, name: 'Off-Balance' },
  },
  ironvein_foreman: {
    id: 'ironvein_foreman', name: 'Ironvein Foreman', minLevel: 16, maxLevel: 16, family: 'kobold', rare: true,
    elite: true, canSwim: true, ccImmune: true, respawnMult: 864,
    hpBase: 420, hpPerLevel: 70, dmgBase: 19, dmgPerLevel: 4.4, attackSpeed: 2.0,
    armorPerLevel: 38, moveSpeed: 7, aggroRadius: 12,
    aoePulse: { min: 28, max: 38, radius: 8, every: 10, name: 'Powder Keg', school: 'fire' },
    summonAdds: { mobId: 'ironvein_sapper', count: 2, atHpPct: [0.50] },
    rally: { radius: 14, every: 12, ap: 40, duration: 10, name: 'Rallying Banner' },
    enrage: { belowHpPct: 0.30, dmgMult: 1.45, hasteMult: 1.3 },
    loot: [
      { copper: 420, chance: 1 },
      { itemId: 'glowing_wax', chance: 1 },
      { itemId: 'ironvein_pickblade', chance: 0.25 },
      { itemId: 'ironvein_lantern_staff', chance: 0.25 },
      { itemId: 'gutripper_shiv', chance: 0.25, rollGroup: 'ironvein_foreman_chase' },
      { itemId: 'deathlord_sabatons', chance: 0.25, rollGroup: 'ironvein_foreman_chase' },
    ],
    scale: 1.05, color: 0xb0823a,
  },
  ironvein_sapper: {
    id: 'ironvein_sapper', name: 'Ironvein Sapper', minLevel: 15, maxLevel: 16, family: 'kobold',
    hpBase: 58, hpPerLevel: 20, dmgBase: 11, dmgPerLevel: 2.6, attackSpeed: 2.0,
    armorPerLevel: 18, moveSpeed: 7.5, aggroRadius: 12,
    smolder: { chance: 0.25, perTick: 5, interval: 3, duration: 12, name: 'Smoldering Fuse' },
    // The sapper's blasting powder clings and smolders: a struck foe catches fire.
    cinder: { chance: 0.3, perTick: 5, interval: 3, duration: 12, name: 'Cinderburn', school: 'fire' },
    loot: [],
    scale: 0.85, color: 0x8f6b34,
  },
  thornpeak_ogre: {
    id: 'thornpeak_ogre', name: 'Thornpeak Ogre', minLevel: 15, maxLevel: 16, family: 'ogre',
    hpBase: 66, hpPerLevel: 23, dmgBase: 11, dmgPerLevel: 2.6, attackSpeed: 2.6,
    armorPerLevel: 22, moveSpeed: 7, aggroRadius: 11,
    concuss: { chance: 0.2, duration: 2, name: 'Concussive Blow' },
    loot: [
      { copper: 75, chance: 1 },
      { itemId: 'ogre_toe_ring', chance: 0.35 },
    ],
    scale: 1.3, color: 0x9e7b53,
  },
  ogre_crusher: {
    id: 'ogre_crusher', name: 'Thornpeak Crusher', minLevel: 16, maxLevel: 17, family: 'ogre', elite: true,
    hpBase: 64, hpPerLevel: 23, dmgBase: 11, dmgPerLevel: 2.6, attackSpeed: 2.6,
    armorPerLevel: 24, moveSpeed: 7, aggroRadius: 12,
    // Disarming Smash: a war-camp crusher's two-handed blow can batter the weapon
    // from your grip, cutting off auto-attack for a few seconds — a real threat to
    // a tank holding the pack. The inverse of the Summoner's Silencing Shriek.
    disarm: { chance: 0.25, duration: 6, name: 'Disarming Smash', school: 'physical' },
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'ogre_toe_ring', chance: 0.5 },
    ],
    scale: 1.35, color: 0x7e5c3e,
  },
  warlord_drogmar: {
    id: 'warlord_drogmar', name: 'Warlord Drogmar', minLevel: 17, maxLevel: 17, family: 'ogre',
    elite: true, boss: true,
    hpBase: 200, hpPerLevel: 30, dmgBase: 12, dmgPerLevel: 2.7, attackSpeed: 2.6,
    armorPerLevel: 28, moveSpeed: 7, aggroRadius: 14,
    aoePulse: { min: 22, max: 30, radius: 10, every: 12, name: 'Ground Slam' },
    // The longer the warlord is left to swing, the harder he hits: every landed
    // blow stokes his Battle Fury, stacking attack power up to a hard cap. A
    // drawn-out fight snowballs, so burn him down or kite him off you to bleed
    // the stacks back off.
    rampage: { ap: 20, maxStacks: 5, duration: 10, name: 'Battle Fury', school: 'physical' },
    loot: [
      { copper: 2000, chance: 1 },
      { itemId: 'drogmar_warboots', chance: 0.3 },
      { itemId: 'drogmars_skullcleaver', chance: 0.25 },
    ],
    scale: 1.5, color: 0x8c3b2e,
  },
  brutok_skullsmasher: {
    // The ogre family's rare elite — a hulking two-fisted mauler that prowls
    // the crags above the Crusher warbands. Slow, heavily armored and brutal:
    // it slams the ground in a physical shockwave and goes berserk when low.
    // Fills the ogre rare gap beside Ironvein Foreman (kobold), Shardlord
    // Kazzix (elemental) and Marrowlord Varkas (undead).
    id: 'brutok_skullsmasher', name: 'Brutok Skullsmasher', minLevel: 17, maxLevel: 17, family: 'ogre', rare: true,
    elite: true, ccImmune: true, respawnMult: 432,
    hpBase: 360, hpPerLevel: 60, dmgBase: 16, dmgPerLevel: 3.6, attackSpeed: 2.7,
    armorPerLevel: 30, moveSpeed: 7, aggroRadius: 13,
    aoePulse: { min: 22, max: 30, radius: 10, every: 10, name: 'Skull Smash', school: 'physical', fx: 'nova' },
    enrage: { belowHpPct: 0.30, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'cracked_ogre_tusk', chance: 1 },
      { itemId: 'skullsmasher_warbelt', chance: 0.3 },
      { itemId: 'brutoks_maul', chance: 0.25, rollGroup: 'brutok_chase' },
      { itemId: 'crag_warden_cudgel', chance: 0.25, rollGroup: 'brutok_chase' },
      { itemId: 'skullsplitter_dirk', chance: 0.25, rollGroup: 'brutok_chase' },
    ],
    scale: 1.45, color: 0x6e5235,
  },
  stormcrag_elemental: {
    id: 'stormcrag_elemental', name: 'Stormcrag Elemental', minLevel: 17, maxLevel: 18, family: 'elemental',
    hpBase: 62, hpPerLevel: 22, dmgBase: 12, dmgPerLevel: 2.7, attackSpeed: 2.2,
    armorPerLevel: 20, moveSpeed: 6.5, aggroRadius: 11,
    loot: [
      { copper: 80, chance: 1 },
      { itemId: 'storm_core', chance: 0.55, questId: 'q_shard_cores' },
      { itemId: 'blessed_embers', chance: 0.55, questId: 'q_breaking_the_seal' },
      { itemId: 'inert_storm_shard', chance: 0.4 },
    ],
    scale: 1.1, color: 0x5dade2,
    // A touch of the storm's cold numbs the limbs: each landed swing has a
    // chance to slow the victim to half speed for a few seconds.
    chillOnHit: { chance: 0.35, mult: 0.5, duration: 6, name: 'Numbing Chill' },
    // Static Charge: the elemental's storm clings to whatever it strikes, leaving
    // the victim conductive so every spell that lands on them bites deeper —
    // +18% magic damage taken from all attackers for a while.
    spellVuln: { chance: 0.3, amp: 0.18, duration: 10, name: 'Static Charge', school: 'nature' },
  },
  shardlord_kazzix: {
    id: 'shardlord_kazzix', name: 'Shardlord Kazzix', minLevel: 18, maxLevel: 18, family: 'elemental', rare: true,
    hpBase: 160, hpPerLevel: 28, dmgBase: 13, dmgPerLevel: 2.8, attackSpeed: 2.2,
    armorPerLevel: 24, moveSpeed: 7, aggroRadius: 12,
    loot: [
      { copper: 500, chance: 1 },
      { itemId: 'kazzix_heartshard', chance: 1, questId: 'q_kazzix' },
      { itemId: 'inert_storm_shard', chance: 1 },
    ],
    // The Shardlord's rimebound core sheathes its blows in killing cold, leaving
    // a frost burn that gnaws at the victim long after the strike lands.
    frostbite: { chance: 0.3, perTick: 6, interval: 3, duration: 12, name: 'Frostbite', school: 'frost' },
    scale: 1.3, color: 0xaed6f1,
  },
  wyrmcult_zealot: {
    id: 'wyrmcult_zealot', name: 'Wyrmcult Zealot', minLevel: 17, maxLevel: 19, family: 'humanoid',
    hpBase: 62, hpPerLevel: 22, dmgBase: 12, dmgPerLevel: 2.7, attackSpeed: 2.0,
    armorPerLevel: 20, moveSpeed: 7, aggroRadius: 11,
    loot: [
      { copper: 90, chance: 1 },
      { itemId: 'wyrmcult_orders', chance: 0.5, questId: 'q_cult_orders' },
      { itemId: 'frayed_prayer_beads', chance: 0.35 },
    ],
    // The zealot's fevered chanting claws at a caster's mind, draining Intellect
    // and shrinking their mana pool for a while.
    enfeeble: { chance: 0.3, int: 12, duration: 12, name: 'Maddening Whisper', school: 'shadow' },
    // The Wyrmcult hoards their master's flame: a branding strike seals away the
    // victim's fire magic so it can never rival the wyrm's, while leaving every
    // other school free (a single-school counterspell, distinct from a full silence).
    lockout: { chance: 0.25, duration: 6, name: 'Wyrmward Sigil', school: 'fire' },
    scale: 1.0, color: 0x76448a,
  },
  wyrmcult_necromancer: {
    id: 'wyrmcult_necromancer', name: 'Wyrmcult Necromancer', minLevel: 18, maxLevel: 19, family: 'humanoid',
    hpBase: 58, hpPerLevel: 21, dmgBase: 13, dmgPerLevel: 2.8, attackSpeed: 2.0,
    armorPerLevel: 16, moveSpeed: 7, aggroRadius: 11,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'ritual_phylactery', chance: 0.55, questId: 'q_necromancers' },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    manaBurn: { chance: 0.3, amount: 80, name: 'Mana Sear', school: 'shadow' },
    // Spectral Ward: a shroud of dark wards that lashes back at any caster whose
    // spell strikes the necromancer — the magic-school twin of melee thorns.
    spellReflect: { value: 9, name: 'Spectral Ward', school: 'shadow' },
    scale: 1.0, color: 0x533566,
  },
  boneclad_revenant: {
    id: 'boneclad_revenant', name: 'Boneclad Revenant', minLevel: 18, maxLevel: 19, family: 'undead',
    hpBase: 66, hpPerLevel: 23, dmgBase: 12, dmgPerLevel: 2.7, attackSpeed: 2.3,
    armorPerLevel: 18, moveSpeed: 6.5, aggroRadius: 11,
    enervate: { chance: 0.3, sta: 14, duration: 12, name: 'Soul Siphon', school: 'shadow' },
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'runed_bone_shard', chance: 0.7, questId: 'q_nythraxis_restless_dead' },
    ],
    scale: 1.05, color: 0xcacfd2,
  },
  fallen_captain_aldren: {
    id: 'fallen_captain_aldren', name: 'Fallen Captain Aldren', minLevel: 20, maxLevel: 20, family: 'undead',
    elite: true, rare: true, canSwim: true, ccImmune: true, respawnMult: 4,
    hpBase: 390, hpPerLevel: 72, dmgBase: 22, dmgPerLevel: 4.2, attackSpeed: 2.2,
    armorPerLevel: 42, moveSpeed: 7.2, aggroRadius: 18,
    cleave: { radius: 7, mult: 0.75, name: 'Grave-Cleaver' },
    loot: [
      { copper: 450, chance: 1 },
      { itemId: 'captains_crest', chance: 1, questId: 'q_nythraxis_sealed_crypt' },
      { itemId: 'bone_fragments', chance: 1 },
    ],
    scale: 1.15, color: 0xbfc7ca,
  },
  corrupted_priest_malric: {
    id: 'corrupted_priest_malric', name: 'Corrupted Priest Malric', minLevel: 20, maxLevel: 20, family: 'undead',
    elite: true, rare: true, canSwim: true, ccImmune: true, respawnMult: 4,
    hpBase: 360, hpPerLevel: 68, dmgBase: 23, dmgPerLevel: 4.3, attackSpeed: 2.3,
    armorPerLevel: 26, moveSpeed: 6.9, aggroRadius: 18,
    manaBurn: { chance: 0.4, amount: 130, name: 'Withered Benediction', school: 'shadow' },
    mendAlly: { healMin: 48, healMax: 70, radius: 14, every: 7, name: 'Profane Mending', school: 'shadow' },
    petSpell: { name: 'Mind Blast', school: 'shadow', min: 38, max: 56, range: 28, every: 2.8 },
    aoePulse: { min: 28, max: 42, radius: 16, every: 8, name: 'Shadow Nova', school: 'shadow', fx: 'nova' },
    loot: [
      { copper: 450, chance: 1 },
      { itemId: 'priests_sigil', chance: 1, questId: 'q_nythraxis_sealed_crypt' },
      { itemId: 'frayed_prayer_beads', chance: 0.5 },
    ],
    scale: 1.05, color: 0xd5d0e8,
  },
  deathstalker_voss: {
    id: 'deathstalker_voss', name: 'Deathstalker Voss', minLevel: 20, maxLevel: 20, family: 'undead',
    elite: true, rare: true, canSwim: true, ccImmune: true, respawnMult: 4,
    hpBase: 410, hpPerLevel: 74, dmgBase: 24, dmgPerLevel: 4.5, attackSpeed: 2.1,
    armorPerLevel: 44, moveSpeed: 7.4, aggroRadius: 18,
    cleave: { radius: 7, mult: 0.7, name: 'Deathstalker Cleave' },
    mortalStrike: { chance: 0.45, healReduction: 0.5, duration: 10, name: 'Forgotten Wound', school: 'physical' },
    loot: [
      { copper: 450, chance: 1 },
      { itemId: 'royal_seal', chance: 1, questId: 'q_nythraxis_sealed_crypt' },
      { itemId: 'bone_fragments', chance: 1 },
    ],
    scale: 1.18, color: 0xc7c0b2,
  },
  vision_aldren_warrior: {
    id: 'vision_aldren_warrior', name: 'Vision of Captain Aldren', minLevel: 20, maxLevel: 20, family: 'humanoid',
    hpBase: 1, hpPerLevel: 0, dmgBase: 0, dmgPerLevel: 0, attackSpeed: 2,
    armorPerLevel: 0, moveSpeed: 0, aggroRadius: 0,
    loot: [], scale: 1.0, color: 0xb8d7ff,
  },
  vision_malric_mage: {
    id: 'vision_malric_mage', name: 'Vision of High Priest Malric', minLevel: 20, maxLevel: 20, family: 'humanoid',
    hpBase: 1, hpPerLevel: 0, dmgBase: 0, dmgPerLevel: 0, attackSpeed: 2,
    armorPerLevel: 0, moveSpeed: 0, aggroRadius: 0,
    loot: [], scale: 1.0, color: 0xc9b6ff,
  },
  vision_deathstalker_voss: {
    id: 'vision_deathstalker_voss', name: 'Vision of Royal Assassin Voss', minLevel: 20, maxLevel: 20, family: 'humanoid',
    hpBase: 1, hpPerLevel: 0, dmgBase: 0, dmgPerLevel: 0, attackSpeed: 2,
    armorPerLevel: 0, moveSpeed: 0, aggroRadius: 0,
    loot: [], scale: 1.0, color: 0xb8d7ff,
  },
  bound_guardian: {
    id: 'bound_guardian', name: 'The Bound Guardian', minLevel: 20, maxLevel: 20, family: 'undead',
    elite: true, boss: true, canSwim: true, ccImmune: true, respawnMult: 1000,
    hpBase: 310, hpPerLevel: 48, dmgBase: 16, dmgPerLevel: 3.4, attackSpeed: 2.4,
    armorPerLevel: 42, moveSpeed: 6.8, aggroRadius: 16,
    aoePulse: { min: 30, max: 44, radius: 10, every: 10, name: 'Sealbreak Shockwave', school: 'shadow' },
    summonAdds: { mobId: 'varkas_boneguard', count: 2, atHpPct: [0.50] },
    enrage: { belowHpPct: 0.25, dmgMult: 1.45, hasteMult: 1.25 },
    loot: [
      { copper: 1200, chance: 1 },
      { itemId: 'kings_signet', chance: 1, questId: 'q_nythraxis_bound_guardian' },
    ],
    scale: 1.35, color: 0xa8b0b8,
  },
  marrowlord_varkas: {
    id: 'marrowlord_varkas', name: 'Marrowlord Varkas', minLevel: 19, maxLevel: 19, family: 'undead', rare: true,
    elite: true, canSwim: true, ccImmune: true, respawnMult: 864,
    hpBase: 480, hpPerLevel: 80, dmgBase: 22, dmgPerLevel: 5.0, attackSpeed: 2.4,
    armorPerLevel: 44, moveSpeed: 6.5, aggroRadius: 13,
    aoePulse: { min: 30, max: 42, radius: 11, every: 9, name: 'Marrow Rot', school: 'shadow' },
    summonAdds: { mobId: 'varkas_boneguard', count: 2, atHpPct: [0.66, 0.33] },
    knockback: { chance: 0.25, distance: 6, name: 'Crushing Sweep' },
    stoneskin: { amount: 260, every: 14, duration: 8, name: 'Bone Carapace', school: 'shadow' },
    loot: [
      { copper: 650, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'marrowlord_boneboots', chance: 0.3 },
      { itemId: 'necromancers_legwraps', chance: 0.25, rollGroup: 'marrowlord_varkas_chase' },
    ],
    scale: 1.25, color: 0xd8d0bd,
  },
  varkas_boneguard: {
    id: 'varkas_boneguard', name: 'Varkas Boneguard', minLevel: 18, maxLevel: 19, family: 'undead',
    hpBase: 64, hpPerLevel: 22, dmgBase: 12, dmgPerLevel: 2.8, attackSpeed: 2.3,
    armorPerLevel: 20, moveSpeed: 6.5, aggroRadius: 12,
    // Shattering Maul: a landed hit can crack the victim's guard, leaving them
    // taking +18% physical damage from every attacker for 8s.
    expose: { chance: 0.25, dmgIncrease: 0.18, duration: 8, name: 'Cracked Guard' },
    loot: [],
    scale: 1.0, color: 0xc9c2b5,
  },
  // Voskar the Emberwing — a young drake the Wyrmcult chained above the Sanctum
  // and starved into a weapon. The only dragonkin rare on the peaks: it breathes
  // fire in a wide cone, and its searing bite leaves wounds that refuse to close.
  voskar_emberwing: {
    id: 'voskar_emberwing', name: 'Voskar the Emberwing', minLevel: 19, maxLevel: 19, family: 'dragonkin', rare: true,
    elite: true, canSwim: true, ccImmune: true, respawnMult: 864,
    hpBase: 470, hpPerLevel: 78, dmgBase: 22, dmgPerLevel: 4.9, attackSpeed: 2.5,
    armorPerLevel: 42, moveSpeed: 7, aggroRadius: 13,
    aoePulse: { min: 30, max: 44, radius: 10, every: 9, name: 'Ember Breath', school: 'fire', fx: 'nova' },
    // Searing Maw: the drake's molten bite cauterizes flesh shut, blunting healing.
    mortalStrike: { chance: 0.35, healReduction: 0.5, duration: 8, name: 'Searing Maw', school: 'fire' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'emberwing_cinderscale', chance: 1 },
      { itemId: 'emberwing_legguards', chance: 0.25, rollGroup: 'voskar_emberwing_chase' },
      { itemId: 'emberfang_warblade', chance: 0.25, rollGroup: 'voskar_emberwing_chase' },
    ],
    scale: 1.3, color: 0xe8702a,
  },
};

// ---------------------------------------------------------------------------
// NPCs (Highwatch hub)
// ---------------------------------------------------------------------------

export const ZONE3_NPCS: Record<string, NpcDef> = {
  captain_thessaly: {
    id: 'captain_thessaly', name: 'Captain Thessaly', title: 'Highwatch Captain',
    pos: { x: 4, z: 664 }, facing: -2.0, color: 0x85929e,
    questIds: ['q_highwatch_summons', 'q_stalkers', 'q_ogre_bounty', 'q_crushers', 'q_drogmar', 'q_revenants', 'q_revenant_vanguard'],
    greeting: 'Two hundred years this wall has held, $C. It will not break on my watch — but it groans.',
  },
  brother_aldric_highwatch: {
    id: 'brother_aldric_highwatch', name: 'Brother Aldric', title: 'Priest of the Vale',
    pos: { x: -10, z: 656 }, facing: 0.8, color: 0xf7f9f9,
    questIds: [
      'q_zealots', 'q_cult_orders', 'q_necromancers', 'q_wyrm_sigils', 'q_breaking_the_seal',
      'q_voice_below', 'q_sanctum_gate', 'q_velkhar', 'q_gravewyrm',
      'q_nythraxis_restless_dead', 'q_nythraxis_graves', 'q_nythraxis_sealed_crypt',
      'q_nythraxis_bound_guardian', 'q_nythraxis_scourges_end',
    ],
    greeting: 'From a chapel yard in the Vale to the roof of the world... the trail we have followed ends here. I can feel the mountain listening.',
  },
  // Spawned dynamically inside the Crypt of Nythraxis encounter (see
  // spawnNythraxisAldric in sim.ts); `dynamic` keeps the world loader from
  // surface-placing him while still letting the client mirror him as a quest
  // turn-in NPC. pos/facing are unused — the encounter sets his position.
  brother_aldric_raid: {
    id: 'brother_aldric_raid', name: 'Brother Aldric', title: 'Priest of the Vale',
    pos: { x: 0, z: 0 }, facing: 0, color: 0xd7d0b4,
    questIds: ['q_nythraxis_scourges_end'],
    dynamic: true,
    // Shares the Highwatch Aldric's name/title/greeting so all three entity
    // strings reuse his existing 13-locale translations (no new untranslated copy).
    greeting: 'From a chapel yard in the Vale to the roof of the world... the trail we have followed ends here. I can feel the mountain listening.',
  },
  scout_maren_highwatch: {
    id: 'scout_maren_highwatch', name: 'Scout Maren', title: "Marshal's Scout",
    pos: { x: 7, z: 670 }, facing: -2.4, color: 0x6e8b3d,
    questIds: ['q_ogre_edges', 'q_ogre_totems', 'q_korgath'],
    greeting: 'I tracked cultists through the fen at your side, and the trail led here. The peaks are worse, $C. Stay sharp.',
  },
  quartermaster_bree: {
    id: 'quartermaster_bree', name: 'Quartermaster Bree', title: 'Highwatch Quartermaster',
    pos: { x: -5, z: 668 }, facing: 1.6, color: 0xca8a2a,
    questIds: ['q_stalker_pelts', 'q_glowing_wax'],
    vendorItems: [
      'trail_hardtack', 'meltwater_flask', 'roast_mountain_goat', 'glacier_melt',
      'healing_potion', 'mana_potion',
      'highwatch_breastplate', 'peakwool_robe', 'stalkerhide_jerkin', 'cragwalker_boots', 'windguard_leggings',
    ],
    greeting: 'Wool, hardtack, and steel-shod boots — Highwatch runs on all three, and I am short of everything.',
  },
  armorer_hode: {
    id: 'armorer_hode', name: 'Armorer Hode', title: 'Master Armorer',
    pos: { x: -2, z: 672 }, facing: 2.8, color: 0x717d7e,
    questIds: [],
    vendorItems: ['highwatch_warblade', 'craghorn_staff', 'icevein_dirk'],
    greeting: 'Forge is hot and the grindstone is turning. If it cuts, I sell it.',
  },
  loremaster_caddis: {
    id: 'loremaster_caddis', name: 'Loremaster Caddis', title: 'Loremaster',
    pos: { x: 12, z: 655 }, facing: -1.2, color: 0x3b6ea5,
    questIds: ['q_kobold_tunnels', 'q_elementals', 'q_shard_cores', 'q_kazzix'],
    greeting: 'Mind the loose shale, $C. The mountain has been... restless of late. I intend to learn why.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const ZONE3_QUESTS: Record<string, QuestDef> = {
  q_highwatch_summons: {
    id: 'q_highwatch_summons', name: 'The Watch on the Peaks',
    giverNpcId: 'brother_aldric_fen', turnInNpcId: 'captain_thessaly',
    text: "Vael's last words have not left me, $N: the Wyrm stirs beneath the peaks. Captain Thessaly commands the wall at Highwatch, at the head of the mountain road north. A summons stands posted at her gate — take it up, and tell her Brother Aldric is climbing the mountain behind you.",
    completionText: "Aldric's word reaches far. If the priest of the Vale is climbing the mountain himself, then it is as bad as I feared. Welcome to Highwatch, $N.",
    objectives: [{ type: 'collect', itemId: 'highwatch_summons', count: 1, label: 'Highwatch Summons' }],
    xpReward: 500, copperReward: 500, itemRewards: {},
    minLevel: 12,
  },
  q_stalkers: {
    id: 'q_stalkers', name: 'Stalkers on the Ridge',
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: 'The ridge cats have come down from the high snows hungry, and my patrols bleed for it. Every stalker you put down is a soldier I keep on the wall. Thin them, $N — twelve, to start.',
    completionText: 'Twelve fewer shadows on the ridge. The patrols will breathe easier tonight.',
    objectives: [{ type: 'kill', targetMobId: 'ridge_stalker', count: 12, label: 'Ridge Stalker slain' }],
    xpReward: 2200, copperReward: 1000, itemRewards: {},
  },
  q_stalker_pelts: {
    id: 'q_stalker_pelts', name: 'Winter Is Coming to Highwatch',
    giverNpcId: 'quartermaster_bree', turnInNpcId: 'quartermaster_bree',
    text: 'Winter on this mountain does not knock, $N — it kicks the door in. Eight ridge stalker pelts will line enough cloaks to see the wall through the first snows. The beasts prowl the ridges flanking the road south.',
    completionText: 'Thick as my arm, these. The watch will not freeze this year — take these treads for your trouble.',
    objectives: [{ type: 'collect', itemId: 'ridge_stalker_pelt', count: 8, label: 'Ridge Stalker Pelt' }],
    xpReward: 2300, copperReward: 1000,
    itemRewards: { warrior: 'ridgestalker_treads', mage: 'ridgestalker_treads', rogue: 'ridgestalker_treads' },
  },
  q_kobold_tunnels: {
    id: 'q_kobold_tunnels', name: 'Deeprock Trouble',
    giverNpcId: 'loremaster_caddis', turnInNpcId: 'loremaster_caddis',
    text: 'The kobolds at Deeprock Burrows are digging deeper than any candle-rat has business digging — straight down, as if something were calling them. Their tunnels run beneath our wall, $N. Collapse the matter: kill twelve Deeprock Tunnelers.',
    completionText: 'Straight down, every shaft of it — kobolds do not dig like that on their own. I must consult my books.',
    objectives: [{ type: 'kill', targetMobId: 'deeprock_kobold', count: 12, label: 'Deeprock Tunneler slain' }],
    xpReward: 2500, copperReward: 1200, itemRewards: {},
    minLevel: 14,
  },
  q_glowing_wax: {
    id: 'q_glowing_wax', name: 'Strange Wax',
    giverNpcId: 'quartermaster_bree', turnInNpcId: 'quartermaster_bree',
    text: 'Caddis showed me a candle taken off one of those tunnelers — the wax glows, $N, and it is warm as a heartbeat. He wants more for study, and I want it off my requisition list. Bring back six lumps of the glowing wax.',
    completionText: 'Still warm. The Loremaster says the glow matches no flame he knows of. I say it is mountain trouble, and I say it kindly.',
    objectives: [{ type: 'collect', itemId: 'glowing_wax', count: 6, label: 'Glowing Wax' }],
    xpReward: 2500, copperReward: 1200, itemRewards: {},
    requiresQuest: 'q_kobold_tunnels',
  },
  q_ogre_edges: {
    id: 'q_ogre_edges', name: 'Ogres at the Foothills',
    giverNpcId: 'scout_maren_highwatch', turnInNpcId: 'scout_maren_highwatch',
    text: 'The Thornpeak clans never come this far east — yet here they are, camped in the eastern foothills with war paint on. Somebody is paying them, $N, and ogres do not take promises. Cut twelve of them down while I find out who holds the purse.',
    completionText: 'Twelve down, and still they are not pulling back. Whoever bought them paid in something heavier than gold.',
    objectives: [{ type: 'kill', targetMobId: 'thornpeak_ogre', count: 12, label: 'Thornpeak Ogre slain' }],
    xpReward: 2900, copperReward: 1400, itemRewards: {},
    minLevel: 15,
  },
  q_ogre_totems: {
    id: 'q_ogre_totems', name: 'Totems of War',
    giverNpcId: 'scout_maren_highwatch', turnInNpcId: 'scout_maren_highwatch',
    text: 'Around the war-camp the ogres have raised totems — crude things of hide and skull, but they mark a muster, not a raid. Tear down six of them and bring them to me. Mind the crushers on the perimeter, $N.',
    completionText: 'Skull, hide... and look here — wyrm-scale bindings. These totems were gifts, $N. The cult is arming the clans.',
    objectives: [{ type: 'collect', itemId: 'ogre_war_totem', count: 6, label: 'Ogre War Totem' }],
    xpReward: 2800, copperReward: 1400, itemRewards: {},
    requiresQuest: 'q_ogre_edges',
  },
  q_ogre_bounty: {
    id: 'q_ogre_bounty', name: "The Captain's Bounty",
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: "Maren's totems tell me all I need to know: the clans are bought, and my wall is their first errand. I will not wait for them to muster. Fourteen more Thornpeak Ogres, $N — and I will pay bounty on every one.",
    completionText: 'Bounty paid in full. The foothills are quieter — now we deal with the ones doing the buying.',
    objectives: [{ type: 'kill', targetMobId: 'thornpeak_ogre', count: 14, label: 'Thornpeak Ogre slain' }],
    xpReward: 3000, copperReward: 1500, itemRewards: {},
    requiresQuest: 'q_ogre_totems',
  },
  q_crushers: {
    id: 'q_crushers', name: 'Break the War-Camp',
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: "Drogmar's war-camp squats in the eastern crags, and his crushers are the spine of it — each one worth three of my soldiers. Take companions; this is no errand for one blade. Break ten crushers and the warlord's muster breaks with them.",
    completionText: 'Ten crushers down. The war-camp is a body without a spine — time to take the head.',
    objectives: [{ type: 'kill', targetMobId: 'ogre_crusher', count: 10, label: 'Thornpeak Crusher slain' }],
    xpReward: 3600, copperReward: 2000, itemRewards: {},
    minLevel: 16, suggestedPlayers: 3,
  },
  q_drogmar: {
    id: 'q_drogmar', name: 'Warlord Drogmar',
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: "Warlord Drogmar took the Wyrmcult's coin and swore the clans to the mountain's waking. He is the hammer they mean to swing at my wall — and when he slams the ground, $N, do not be standing near him. Take your companions into the war-camp and end him, for Highwatch.",
    completionText: 'Drogmar, dead in his own camp. The clans will scatter to the high passes — you have bought my wall a winter, $N.',
    objectives: [{ type: 'kill', targetMobId: 'warlord_drogmar', count: 1, label: 'Warlord Drogmar slain' }],
    xpReward: 4000, copperReward: 2500,
    itemRewards: { warrior: 'drogmars_skullcleaver', mage: 'ogre_bonecharm_staff', rogue: 'gutripper_shiv' },
    requiresQuest: 'q_crushers', suggestedPlayers: 3,
  },
  q_elementals: {
    id: 'q_elementals', name: 'The Mountain Wakes',
    giverNpcId: 'loremaster_caddis', turnInNpcId: 'loremaster_caddis',
    text: 'Stormcrag has stood silent a thousand years, and now the very stones of it get up and walk. Elementals do not simply wake, $N — something beneath this mountain is turning in its sleep. Put twelve of them down so I may study what remains.',
    completionText: 'The fragments hum like struck bells. The mountain is not angry, $N... it is being disturbed.',
    objectives: [{ type: 'kill', targetMobId: 'stormcrag_elemental', count: 12, label: 'Stormcrag Elemental slain' }],
    xpReward: 3600, copperReward: 1800, itemRewards: {},
    minLevel: 16,
  },
  q_shard_cores: {
    id: 'q_shard_cores', name: 'Cores of the Storm',
    giverNpcId: 'loremaster_caddis', turnInNpcId: 'loremaster_caddis',
    text: "At each elemental's heart sits a storm core — a knot of lightning bound in stone. Six of them, set side by side, will tell me where the disturbance is centered. I suspect I already know, $N, and I dearly hope that I am wrong.",
    completionText: 'Each core leans the same way, like iron filings to a lodestone. They point south, $N. To the Sanctum.',
    objectives: [{ type: 'collect', itemId: 'storm_core', count: 6, label: 'Storm Core' }],
    xpReward: 3700, copperReward: 1800, itemRewards: {},
    requiresQuest: 'q_elementals',
  },
  q_kazzix: {
    id: 'q_kazzix', name: 'The Shardlord',
    giverNpcId: 'loremaster_caddis', turnInNpcId: 'loremaster_caddis',
    text: 'Among the elementals one burns brighter than the rest: Shardlord Kazzix, a storm given shoulders. Its heartshard would anchor every reading I have taken — if you can wrench it from the thing. It walks the far crags west of Stormcrag, beyond the second camp.',
    completionText: 'The heartshard! Still crackling — magnificent. Take these leggings; I sized them off a guess and a prayer.',
    objectives: [{ type: 'collect', itemId: 'kazzix_heartshard', count: 1, label: "Kazzix's Heartshard" }],
    xpReward: 3800, copperReward: 2000,
    itemRewards: { warrior: 'stormshard_leggings', mage: 'stormshard_leggings', rogue: 'stormshard_leggings' },
    minLevel: 17,
  },
  q_zealots: {
    id: 'q_zealots', name: 'Chants on the Wind',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'When the wind comes off the southern peaks, $N, it carries chanting. The Wyrmcult no longer hides — they have raised tents below the Sanctum and they sing to what sleeps beneath it. Silence twelve zealots. Every voice stilled buys the mountain another night of sleep.',
    completionText: 'The wind is quieter. But what troubles me is not the chanting, $N — it is that something may be chanting back.',
    objectives: [{ type: 'kill', targetMobId: 'wyrmcult_zealot', count: 12, label: 'Wyrmcult Zealot slain' }],
    xpReward: 4000, copperReward: 2000, itemRewards: {},
    minLevel: 17,
  },
  q_cult_orders: {
    id: 'q_cult_orders', name: 'Orders from Below',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'The zealots move with purpose now — watches set, supplies counted, like soldiers before a siege. Cultists who organize are cultists taking orders, $N. Kill eight more and bring me four sets of their written orders. I would know the hand that commands them.',
    completionText: "This script... I last saw its like in Morthen's grimoire, in Eastbrook. The same hand has guided every grave we have fought over, $N.",
    objectives: [
      { type: 'kill', targetMobId: 'wyrmcult_zealot', count: 8, label: 'Wyrmcult Zealot slain' },
      { type: 'collect', itemId: 'wyrmcult_orders', count: 4, label: 'Wyrmcult Orders' },
    ],
    xpReward: 3800, copperReward: 1800, itemRewards: {},
    requiresQuest: 'q_zealots',
  },
  q_necromancers: {
    id: 'q_necromancers', name: 'The Phylactery Ring',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'The orders speak of a "ring of phylacteries" — soul-vessels, $N, set about the Sanctum to feed it. The cult\'s necromancers carry them like holy relics. Kill eight necromancers and bring me three phylacteries unbroken. I must know what souls they hold.',
    completionText: 'Light forgive us. These hold the dead of the Vale and the fen — every corpse the Gravecallers ever raised, harvested. They were never building an army, $N. They were gathering a tithe.',
    objectives: [
      { type: 'kill', targetMobId: 'wyrmcult_necromancer', count: 8, label: 'Wyrmcult Necromancer slain' },
      { type: 'collect', itemId: 'ritual_phylactery', count: 3, label: 'Ritual Phylactery' },
    ],
    xpReward: 4200, copperReward: 2200, itemRewards: {},
    requiresQuest: 'q_cult_orders', minLevel: 18,
  },
  q_revenants: {
    id: 'q_revenants', name: 'The Revenant Fields',
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: 'East of the Sanctum road lies an old battlefield — the vanguard of the last army that tried to take this mountain, two hundred years buried. The cult has called them up, bones in rusted plate. Put twelve revenants back in the ground, $N.',
    completionText: 'They were soldiers once, like mine. Whatever called them up has no respect for the dead — or a use for them I do not care to learn.',
    objectives: [{ type: 'kill', targetMobId: 'boneclad_revenant', count: 12, label: 'Boneclad Revenant slain' }],
    xpReward: 4300, copperReward: 2200, itemRewards: {},
    minLevel: 18,
  },
  q_revenant_vanguard: {
    id: 'q_revenant_vanguard', name: 'Bones of the Vanguard',
    giverNpcId: 'captain_thessaly', turnInNpcId: 'captain_thessaly',
    text: 'The revenants are forming ranks, $N — true ranks, shield-lines and columns, drilling with no drummer. They are being mustered for the Sanctum gate. Break fourteen more before that march begins, and Highwatch will owe you its best steel.',
    completionText: 'The fields lie still again. Take this — it was made for the defenders of the wall, and no one has earned it more.',
    objectives: [{ type: 'kill', targetMobId: 'boneclad_revenant', count: 14, label: 'Boneclad Revenant slain' }],
    xpReward: 4500, copperReward: 2400,
    itemRewards: { warrior: 'boneplate_vest', mage: 'revenant_silk_robe', rogue: 'nightwalk_jerkin' },
    requiresQuest: 'q_revenants',
  },
  q_wyrm_sigils: {
    id: 'q_wyrm_sigils', name: 'Sigils of the Wyrm',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'It is time you knew the whole of it, $N. The Gravecallers serve Korzul the Gravewyrm — an ancient dragon sealed beneath this mountain — and every soul they have stolen since Eastbrook is a tithe poured into its waking. On the Sanctum Approach the cult has laid sigils to thin the seal. Bring me three; I would read the rite they are working.',
    completionText: 'Yes... a waking-litany, generations in the writing. They are close, $N. Closer than I dared fear.',
    objectives: [{ type: 'collect', itemId: 'gravewyrm_sigil', count: 3, label: 'Gravewyrm Sigil' }],
    xpReward: 3600, copperReward: 2000, itemRewards: {},
    requiresQuest: 'q_necromancers', minLevel: 18,
  },
  q_breaking_the_seal: {
    id: 'q_breaking_the_seal', name: 'Breaking the Seal',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'The seal on the Sanctum was wrought with mountain-fire, and only mountain-fire will let us pass without tearing it wide open. The stormcrag elementals carry embers of that first forging in their cores. Bring me five Blessed Embers, $N — for if the cult opens that gate first, they will not be careful, and the Wyrm will not wake gently.',
    completionText: 'They burn blue and clean — the mountain remembers its old oath. With these I can unbind the gate for us alone.',
    objectives: [{ type: 'collect', itemId: 'blessed_embers', count: 5, label: 'Blessed Embers' }],
    xpReward: 4200, copperReward: 2200, itemRewards: {},
    requiresQuest: 'q_wyrm_sigils',
  },
  q_voice_below: {
    id: 'q_voice_below', name: 'The Voice Below',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'Last night the whole cult camp knelt at once, $N — every zealot, every necromancer, all facing the Sanctum. Korzul speaks to them in their sleep now; Vael heard the same voice in the fen, and Morthen before him. Cut the congregation down — ten zealots, six necromancers — before that voice has hands enough to pull the gate open itself.',
    completionText: 'The kneeling has stopped. We have not silenced the voice, $N — only thinned its choir. It must be enough.',
    objectives: [
      { type: 'kill', targetMobId: 'wyrmcult_zealot', count: 10, label: 'Wyrmcult Zealot slain' },
      { type: 'kill', targetMobId: 'wyrmcult_necromancer', count: 6, label: 'Wyrmcult Necromancer slain' },
    ],
    xpReward: 4400, copperReward: 2400,
    itemRewards: { warrior: 'zealotsbane_blade', mage: 'emberwood_staff', rogue: 'cultist_flayer' },
    requiresQuest: 'q_breaking_the_seal',
  },
  q_sanctum_gate: {
    id: 'q_sanctum_gate', name: 'The Sanctum Gate',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'This is the last threshold, $N. The gate of the Gravewyrm Sanctum was locked with a keystone, and the cult shattered it into shards rather than see it turned against them. The shards lie scattered in the gate plaza, under the eyes of the boneclad dead. Bring me three, and I will open the way the Light intended — quietly.',
    completionText: 'The shards sit true... and the gate knows its key. The way below stands open, $N. Gather the strongest companions you can find — what comes next, no one should face alone.',
    objectives: [{ type: 'collect', itemId: 'sanctum_key_shard', count: 3, label: 'Sanctum Key Shard' }],
    xpReward: 4000, copperReward: 2000, itemRewards: {},
    requiresQuest: 'q_voice_below',
  },
  q_korgath: {
    id: 'q_korgath', name: 'The Bound Guardian',
    giverNpcId: 'scout_maren_highwatch', turnInNpcId: 'scout_maren_highwatch',
    text: "My last sweep of the Sanctum's mouth found chains, $N — chains thick as a ship's mast, and something ogre-shaped straining inside them. The cult bound a champion at the threshold: Korgath, fed on rage for longer than either of us has been alive. Take four companions and put him down — and when the chains come off, do not let him corner you.",
    completionText: 'Korgath, broken at last. Even his chains deserved a kinder end than that. The wraps are yours — wear them past the threshold he kept.',
    objectives: [{ type: 'kill', targetMobId: 'korgath_the_bound', count: 1, label: 'Korgath the Bound slain' }],
    xpReward: 4200, copperReward: 2500,
    itemRewards: { warrior: 'korgaths_chainwraps', mage: 'korgaths_chainwraps', rogue: 'korgaths_chainwraps' },
    requiresQuest: 'q_sanctum_gate', minLevel: 18, suggestedPlayers: 5,
  },
  q_velkhar: {
    id: 'q_velkhar', name: 'The Grand Necromancer',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'Every thread we have followed — Morthen, Vael, the phylacteries — was spun by one hand: Grand Necromancer Velkhar, first of the Gravecallers, keeper of the waking rite. He stands in the ritual vault below, pouring two lands\' worth of stolen souls into the Wyrm. End him, $N, and the tithe ends with him.',
    completionText: 'Velkhar is dead, and the rite is headless. But you felt it down there, did you not? The souls are already spent — the Wyrm is no longer asleep.',
    objectives: [{ type: 'kill', targetMobId: 'grand_necromancer_velkhar', count: 1, label: 'Grand Necromancer Velkhar slain' }],
    xpReward: 4500, copperReward: 3000,
    itemRewards: { warrior: 'boneguard_breastplate', mage: 'staff_of_velkhar', rogue: 'shadowmeld_tunic' },
    requiresQuest: 'q_sanctum_gate', minLevel: 18, suggestedPlayers: 5,
  },
  q_gravewyrm: {
    id: 'q_gravewyrm', name: 'Korzul the Gravewyrm',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'There is no rite left to stop, $N — only the Wyrm itself, half-woken in its hollow, gorged on the dead of the Vale and the fen. If it rises, the wall, the marsh, Eastbrook — everything we have defended falls in a single night. Take your companions into the Wyrm\'s Hollow and finish what we began in a chapel yard so long ago. The Light has carried you this far; carry it the rest of the way.',
    completionText: 'It is over. The dead of three lands may rest, the mountain sleeps unhaunted — and it is your name, $N, that every bell from here to Eastbrook rings tonight.',
    objectives: [{ type: 'kill', targetMobId: 'korzul_the_gravewyrm', count: 1, label: 'Korzul the Gravewyrm slain' }],
    xpReward: 5300, copperReward: 25000,
    itemRewards: { warrior: 'gravewyrm_scale_hauberk', mage: 'wyrmcult_grand_robe', rogue: 'wyrmscale_jerkin' },
    requiresQuest: 'q_velkhar', minLevel: 18, suggestedPlayers: 5,
  },
  q_nythraxis_restless_dead: {
    id: 'q_nythraxis_restless_dead', name: 'Unrest in the Bonefields',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'Something has changed in Thornpeak Heights, $N. The dead no longer wander aimlessly. They gather and march through the northern bonefields beyond Highwatch, where the old battlefield meets the cliff road. Go there, investigate the unrest among the Boneclad Revenants, and bring back any proof of what is driving them.',
    completionText: 'The same mark appears on every shard... a crown. I have seen this before, cut into old graves no Eastbrook record remembers.',
    objectives: [{ type: 'collect', itemId: 'runed_bone_shard', count: 10, label: 'Runed Bone Shard' }],
    xpReward: 4200, copperReward: 2000, itemRewards: {},
    minLevel: 20,
  },
  q_nythraxis_graves: {
    id: 'q_nythraxis_graves', name: 'Graves of the Forgotten',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'I have seen these marks before, on three old graves around the northern battlefield. Captain Aldren lies on the eastern rise, High Priest Malric near the central broken road, and Royal Assassin Voss by the western cliff. Touch each grave and listen, $N. The dead may remember what the living forgot.',
    completionText: 'Aldren remained loyal, Malric refused to accept death, and Voss saw the danger before anyone else. All three served the same forgotten king.',
    objectives: [
      { type: 'interact', targetObjectItemId: 'grave_sir_aldren', count: 1, label: 'Vision at the Grave of Captain Aldren' },
      { type: 'interact', targetObjectItemId: 'grave_high_priest_malric', count: 1, label: 'Vision at the Grave of High Priest Malric' },
      { type: 'interact', targetObjectItemId: 'grave_captain_voss', count: 1, label: 'Vision at the Grave of Royal Assassin Voss' },
    ],
    xpReward: 4300, copperReward: 2200, itemRewards: {},
    requiresQuest: 'q_nythraxis_restless_dead', minLevel: 20,
  },
  q_nythraxis_sealed_crypt: {
    id: 'q_nythraxis_sealed_crypt', name: 'The Abandoned Crypt',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'The visions point to the abandoned crypt in the western cliff. There is an old legend that the crypt housed a king. Perhaps Thornpeak sealed him below after Malric\'s ritual twisted him into something deathless. Enter the crypt and see what remains inside.',
    completionText: 'The keystone halves fit together, and Voss\'s diary names what they sealed: the signet of King Nythraxis. If the diary is true, that signet is the key to his tomb.',
    objectives: [
      { type: 'collect', itemId: 'captains_crest', count: 1, label: 'Crypt Keystone Upper' },
      { type: 'collect', itemId: 'priests_sigil', count: 1, label: 'Crypt Keystone Lower' },
      { type: 'collect', itemId: 'royal_seal', count: 1, label: 'Ancient Diary' },
    ],
    xpReward: 4600, copperReward: 2500,
    itemRewards: { warrior: 'crypt_keystone', mage: 'crypt_keystone', rogue: 'crypt_keystone' },
    requiresQuest: 'q_nythraxis_graves', minLevel: 20,
  },
  q_nythraxis_bound_guardian: {
    id: 'q_nythraxis_bound_guardian', name: 'The Bound Guardian',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    text: 'Voss wrote that the survivors sealed the King\'s Signet behind an ancient guardian, so no one could reach the tomb of Nythraxis by accident or ambition. Take the Crypt Keystone to the ritual circle on the flat ground east of the abandoned crypt and south-east of the western grave. Use it there, break the guardian, and bring back the signet.',
    completionText: 'The three relics tell the same story: Aldren fought to defend his king, Malric broke the boundary of death, and Voss tried to stop what followed. The seal is weakening, and this signet is the key to Nythraxis\'s tomb. You are now attuned to enter The Crypt of Nythraxis. Return to the abandoned crypt, unlock the royal door, and face Nythraxis before the old king\'s rage spills beyond Thornpeak.',
    objectives: [
      { type: 'interact', targetObjectItemId: 'crypt_ritual_circle', count: 1, label: 'Crypt Keystone used at the ritual circle' },
      { type: 'kill', targetMobId: 'bound_guardian', count: 1, label: 'The Bound Guardian defeated' },
      { type: 'collect', itemId: 'kings_signet', count: 1, label: "King's Signet" },
    ],
    xpReward: 5200, copperReward: 3500,
    itemRewards: { warrior: 'kings_signet', mage: 'kings_signet', rogue: 'kings_signet' },
    requiresQuest: 'q_nythraxis_sealed_crypt', minLevel: 20, suggestedPlayers: 5,
  },
  q_nythraxis_scourges_end: {
    id: 'q_nythraxis_scourges_end', name: 'Scourge\'s End',
    giverNpcId: 'brother_aldric_highwatch', turnInNpcId: 'brother_aldric_highwatch',
    turnInNpcIds: ['brother_aldric_highwatch', 'brother_aldric_raid'],
    text: 'The signet has opened the way, $N, but an open tomb is not a victory. Nythraxis was a king once, and the ruin beneath Thornpeak is still bound to his will. Enter the crypt with allies you trust. Break the deathless crown before its command reaches the battlefield above.',
    completionText: 'Then the crown is silent at last. Thornpeak will still carry its dead, but no king below it will call them to war again. You have ended what Aldren, Malric, and Voss could only contain.',
    objectives: [{ type: 'kill', targetMobId: 'nythraxis_scourge_of_thornpeak', count: 1, label: 'Nythraxis slain' }],
    xpReward: 0, copperReward: 25000,
    itemRewards: {},
    requiresQuest: 'q_nythraxis_bound_guardian', minLevel: 20, suggestedPlayers: 10,
  },
};

export const ZONE3_QUEST_ORDER = [
  'q_highwatch_summons', 'q_stalkers', 'q_stalker_pelts', 'q_kobold_tunnels', 'q_glowing_wax',
  'q_ogre_edges', 'q_ogre_totems', 'q_ogre_bounty', 'q_crushers', 'q_drogmar',
  'q_elementals', 'q_shard_cores', 'q_kazzix', 'q_zealots', 'q_cult_orders',
  'q_necromancers', 'q_revenants', 'q_revenant_vanguard', 'q_wyrm_sigils', 'q_breaking_the_seal',
  'q_voice_below', 'q_sanctum_gate', 'q_korgath', 'q_velkhar', 'q_gravewyrm',
  'q_nythraxis_restless_dead', 'q_nythraxis_graves', 'q_nythraxis_sealed_crypt',
  'q_nythraxis_bound_guardian', 'q_nythraxis_scourges_end',
];

// ---------------------------------------------------------------------------
// World layout
// ---------------------------------------------------------------------------

export const ZONE3_CAMPS: CampDef[] = [
  // Ridge stalkers: the ridge flanking the road from the pass
  { mobId: 'ridge_stalker', center: { x: -50, z: 590 }, radius: 22, count: 7 },
  { mobId: 'ridge_stalker', center: { x: 45, z: 600 }, radius: 20, count: 6 },
  { mobId: 'old_cragmaw', center: { x: -82, z: 575 }, radius: 5, count: 1 },
  // Kobolds: Deeprock Burrows, west
  { mobId: 'deeprock_kobold', center: { x: 75, z: 625 }, radius: 18, count: 8 },
  { mobId: 'deeprock_kobold', center: { x: 105, z: 600 }, radius: 14, count: 6 },
  { mobId: 'ironvein_foreman', center: { x: 100, z: 617 }, radius: 5, count: 1 },
  // Ogres: eastern foothills rising to Drogmar's war-camp
  { mobId: 'thornpeak_ogre', center: { x: -90, z: 700 }, radius: 22, count: 7 },
  { mobId: 'thornpeak_ogre', center: { x: -60, z: 730 }, radius: 18, count: 6 },
  { mobId: 'ogre_crusher', center: { x: -125, z: 740 }, radius: 18, count: 8 },
  { mobId: 'warlord_drogmar', center: { x: -132, z: 748 }, radius: 2, count: 1 },
  // A lone rare ogre prowls the ridge north of the warband
  { mobId: 'brutok_skullsmasher', center: { x: -45, z: 768 }, radius: 4, count: 1 },
  // Elementals: Stormcrag, far west
  { mobId: 'stormcrag_elemental', center: { x: 110, z: 760 }, radius: 20, count: 8 },
  { mobId: 'stormcrag_elemental', center: { x: 135, z: 795 }, radius: 16, count: 6 },
  { mobId: 'shardlord_kazzix', center: { x: 145, z: 815 }, radius: 8, count: 1 },
  // Wyrmcult: tents below the Sanctum
  { mobId: 'wyrmcult_zealot', center: { x: 55, z: 820 }, radius: 20, count: 8 },
  { mobId: 'wyrmcult_zealot', center: { x: 25, z: 845 }, radius: 16, count: 6 },
  { mobId: 'wyrmcult_necromancer', center: { x: 40, z: 855 }, radius: 14, count: 5 },
  // Revenants: the old battlefield and the Sanctum gate plaza
  { mobId: 'boneclad_revenant', center: { x: -40, z: 830 }, radius: 20, count: 8 },
  { mobId: 'boneclad_revenant', center: { x: -15, z: 860 }, radius: 16, count: 6 },
  { mobId: 'marrowlord_varkas', center: { x: -34, z: 842 }, radius: 5, count: 1 },
  // Voskar the Emberwing: perched on a scorched crag east of the Sanctum tents,
  // with two zealot drakebinders posted to keep their captive on its chain.
  { mobId: 'voskar_emberwing', center: { x: 80, z: 845 }, radius: 4, count: 1 },
  { mobId: 'wyrmcult_zealot', center: { x: 80, z: 845 }, radius: 7, count: 2 },
];

export const ZONE3_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'highwatch_summons',
    name: 'Highwatch Summons',
    positions: [{ x: 1, z: 654 }, { x: -2, z: 657 }],
  },
  {
    itemId: 'ogre_war_totem',
    name: 'Ogre War Totem',
    positions: [
      { x: -116, z: 726 }, { x: -122, z: 733 }, { x: -129, z: 727 }, { x: -136, z: 738 },
      { x: -140, z: 747 }, { x: -133, z: 753 }, { x: -124, z: 750 },
    ],
  },
  {
    itemId: 'gravewyrm_sigil',
    name: 'Gravewyrm Sigil',
    positions: [{ x: -8, z: 852 }, { x: -3, z: 857 }, { x: 3, z: 861 }, { x: 8, z: 866 }],
  },
  {
    itemId: 'sanctum_key_shard',
    name: 'Sanctum Key Shard',
    positions: [{ x: -6, z: 872 }, { x: -2, z: 876 }, { x: 2, z: 873 }, { x: 6, z: 878 }],
  },
  {
    itemId: 'grave_sir_aldren',
    name: 'Grave of Captain Aldren',
    positions: [{ x: 138, z: 838 }],
  },
  {
    itemId: 'grave_high_priest_malric',
    name: 'Grave of High Priest Malric',
    positions: [{ x: 141, z: 712 }],
  },
  {
    itemId: 'grave_captain_voss',
    name: 'Grave of Royal Assassin Voss',
    positions: [{ x: -139, z: 787 }],
  },
  {
    itemId: 'crypt_ritual_circle',
    name: 'Ritual Circle',
    positions: [{ x: 68, z: 800 }],
  },
];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const ZONE3_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  highwatch_summons: { id: 'highwatch_summons', name: 'Highwatch Summons', kind: 'quest', sellValue: 0, questId: 'q_highwatch_summons' },
  ridge_stalker_pelt: { id: 'ridge_stalker_pelt', name: 'Ridge Stalker Pelt', kind: 'quest', sellValue: 0, questId: 'q_stalker_pelts' },
  glowing_wax: { id: 'glowing_wax', name: 'Glowing Wax', kind: 'quest', sellValue: 0, questId: 'q_glowing_wax' },
  ogre_war_totem: { id: 'ogre_war_totem', name: 'Ogre War Totem', kind: 'quest', sellValue: 0, questId: 'q_ogre_totems' },
  storm_core: { id: 'storm_core', name: 'Storm Core', kind: 'quest', sellValue: 0, questId: 'q_shard_cores' },
  kazzix_heartshard: { id: 'kazzix_heartshard', name: "Kazzix's Heartshard", kind: 'quest', sellValue: 0, questId: 'q_kazzix' },
  wyrmcult_orders: { id: 'wyrmcult_orders', name: 'Wyrmcult Orders', kind: 'quest', sellValue: 0, questId: 'q_cult_orders' },
  ritual_phylactery: { id: 'ritual_phylactery', name: 'Ritual Phylactery', kind: 'quest', sellValue: 0, questId: 'q_necromancers' },
  gravewyrm_sigil: { id: 'gravewyrm_sigil', name: 'Gravewyrm Sigil', kind: 'quest', sellValue: 0, questId: 'q_wyrm_sigils' },
  blessed_embers: { id: 'blessed_embers', name: 'Blessed Embers', kind: 'quest', sellValue: 0, questId: 'q_breaking_the_seal' },
  sanctum_key_shard: { id: 'sanctum_key_shard', name: 'Sanctum Key Shard', kind: 'quest', sellValue: 0, questId: 'q_sanctum_gate' },
  runed_bone_shard: { id: 'runed_bone_shard', name: 'Runed Bone Shard', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_restless_dead' },
  grave_sir_aldren: { id: 'grave_sir_aldren', name: 'Grave of Captain Aldren', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_graves' },
  grave_high_priest_malric: { id: 'grave_high_priest_malric', name: 'Grave of High Priest Malric', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_graves' },
  grave_captain_voss: { id: 'grave_captain_voss', name: 'Grave of Royal Assassin Voss', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_graves' },
  ancient_crypt_door: { id: 'ancient_crypt_door', name: 'Ancient Crypt Door', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_sealed_crypt' },
  captains_crest: { id: 'captains_crest', name: 'Crypt Keystone Upper', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_sealed_crypt' },
  priests_sigil: { id: 'priests_sigil', name: 'Crypt Keystone Lower', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_sealed_crypt' },
  royal_seal: { id: 'royal_seal', name: 'Ancient Diary', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_sealed_crypt' },
  crypt_keystone: { id: 'crypt_keystone', name: 'Crypt Keystone', kind: 'quest', quality: 'uncommon', sellValue: 0, questId: 'q_nythraxis_bound_guardian' },
  crypt_ritual_circle: { id: 'crypt_ritual_circle', name: 'Ritual Circle', kind: 'quest', sellValue: 0, questId: 'q_nythraxis_bound_guardian' },
  kings_signet: { id: 'kings_signet', name: "King's Signet", kind: 'quest', quality: 'rare', sellValue: 0, questId: 'q_nythraxis_bound_guardian' },
  // --- quest greens (uncommon) ---
  ridgestalker_treads: {
    id: 'ridgestalker_treads', name: 'Ridgestalker Treads', kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 50, agi: 3, sta: 2 }, sellValue: 600,
  },
  // Old Cragmaw's rare drop — a notch above the Ridgestalker Treads. Leather,
  // so it stays unrestricted by class.
  cragmaw_prowlboots: {
    id: 'cragmaw_prowlboots', name: 'Cragmaw Prowlboots', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 58, agi: 5, sta: 3 }, sellValue: 750,
  },
  boneplate_vest: {
    id: 'boneplate_vest', name: 'Boneplate Vest', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 170, sta: 6, str: 3 }, sellValue: 800, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  revenant_silk_robe: {
    id: 'revenant_silk_robe', name: 'Revenant Silk Robe', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 60, int: 7, spi: 4 }, sellValue: 800, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  nightwalk_jerkin: {
    id: 'nightwalk_jerkin', name: 'Nightwalk Jerkin', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 105, agi: 7, sta: 2 }, sellValue: 800, requiredClass: ['rogue', 'hunter'],
  },
  zealotsbane_blade: {
    id: 'zealotsbane_blade', name: 'Zealotsbane Blade', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 18, max: 29, speed: 2.3 }, stats: { str: 6, sta: 2 }, sellValue: 900, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  emberwood_staff: {
    id: 'emberwood_staff', name: 'Emberwood Staff', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 20, max: 33, speed: 3.0 }, stats: { int: 8, spi: 3 }, sellValue: 900, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  cultist_flayer: {
    id: 'cultist_flayer', name: 'Cultist Flayer', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 12, max: 19, speed: 1.7, dagger: true }, stats: { agi: 7 }, sellValue: 900, requiredClass: ['rogue', 'hunter'],
  },
  drogmar_warboots: {
    id: 'drogmar_warboots', name: "Drogmar's Warboots", kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 85, str: 3, sta: 4 }, sellValue: 950, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  ironvein_pickblade: {
    id: 'ironvein_pickblade', name: 'Ironvein Pickblade', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 13, max: 21, speed: 1.8, dagger: true }, stats: { agi: 7, sta: 2 }, sellValue: 950, requiredClass: ['rogue', 'hunter'],
  },
  ironvein_lantern_staff: {
    id: 'ironvein_lantern_staff', name: 'Ironvein Lantern Staff', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 19, max: 31, speed: 3.0 }, stats: { int: 7, spi: 3 }, sellValue: 950, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  marrowlord_boneboots: {
    id: 'marrowlord_boneboots', name: 'Marrowlord Boneboots', kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 90, sta: 5, str: 2 }, sellValue: 1050, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  // Brutok Skullsmasher (rare ogre) — guaranteed trophy + warbelt
  skullsmasher_warbelt: {
    id: 'skullsmasher_warbelt', name: "Skullsmasher's Warbelt", kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 96, sta: 5, str: 3 }, sellValue: 1050,
  },
  // Voskar the Emberwing drops (rare elite dragonkin)
  emberwing_cinderscale: {
    id: 'emberwing_cinderscale', name: 'Emberwing Cinderscale', kind: 'junk', quality: 'common',
    sellValue: 320,
  },
  emberwing_legguards: {
    id: 'emberwing_legguards', name: 'Emberwing Legguards', kind: 'armor', slot: 'legs', quality: 'rare',
    stats: { armor: 120, sta: 6, str: 4 }, sellValue: 2200, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  emberfang_warblade: {
    id: 'emberfang_warblade', name: 'Emberfang Warblade', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 26, max: 41, speed: 2.5 }, stats: { str: 8, sta: 3 }, sellValue: 2400, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  // --- quest & dungeon blues (rare) ---
  // Brutok Skullsmasher chase weapons (mutually exclusive: brutok_chase)
  brutoks_maul: {
    id: 'brutoks_maul', name: "Brutok's Maul", kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 24, max: 37, speed: 2.7 }, stats: { str: 8, sta: 3 }, sellValue: 2000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  crag_warden_cudgel: {
    id: 'crag_warden_cudgel', name: 'Crag Warden Cudgel', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 23, max: 36, speed: 3.0 }, stats: { int: 8, spi: 4 }, sellValue: 2000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  skullsplitter_dirk: {
    id: 'skullsplitter_dirk', name: 'Skullsplitter Dirk', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 15, max: 23, speed: 1.7, dagger: true }, stats: { agi: 8, sta: 3 }, sellValue: 2000, requiredClass: ['rogue', 'hunter'],
  },
  drogmars_skullcleaver: {
    id: 'drogmars_skullcleaver', name: "Drogmar's Skullcleaver", kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 22, max: 35, speed: 2.6 }, stats: { str: 7, sta: 4 }, sellValue: 2000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  ogre_bonecharm_staff: {
    id: 'ogre_bonecharm_staff', name: 'Ogre Bonecharm Staff', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 24, max: 38, speed: 3.0 }, stats: { int: 9, spi: 4 }, sellValue: 2000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  gutripper_shiv: {
    id: 'gutripper_shiv', name: 'Gutripper Shiv', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 14, max: 22, speed: 1.7, dagger: true }, stats: { agi: 8, sta: 3 }, sellValue: 2000, requiredClass: ['rogue', 'hunter'],
  },
  stormshard_leggings: {
    id: 'stormshard_leggings', name: 'Stormshard Leggings', kind: 'armor', slot: 'legs', quality: 'rare',
    stats: { armor: 110, sta: 5 }, sellValue: 1800,
  },
  korgaths_chainwraps: {
    id: 'korgaths_chainwraps', name: "Korgath's Chainwraps", kind: 'armor', slot: 'legs', quality: 'rare',
    stats: { armor: 125, sta: 6 }, sellValue: 2200,
  },
  boneguard_breastplate: {
    id: 'boneguard_breastplate', name: 'Boneguard Breastplate', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 210, sta: 7, str: 4 }, sellValue: 2500, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  staff_of_velkhar: {
    id: 'staff_of_velkhar', name: 'Staff of Velkhar', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 27, max: 43, speed: 3.0 }, stats: { int: 10, spi: 5 }, sellValue: 2500, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  shadowmeld_tunic: {
    id: 'shadowmeld_tunic', name: 'Shadowmeld Tunic', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 130, agi: 9, sta: 4 }, sellValue: 2500, requiredClass: ['rogue', 'hunter'],
  },
  gravewyrm_scale_hauberk: {
    id: 'gravewyrm_scale_hauberk', name: 'Gravewyrm Scale Hauberk', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 230, sta: 8, str: 5 }, sellValue: 3000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  wyrmcult_grand_robe: {
    id: 'wyrmcult_grand_robe', name: 'Wyrmcult Grand Robe', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 75, int: 11, spi: 5 }, sellValue: 3000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  wyrmscale_jerkin: {
    id: 'wyrmscale_jerkin', name: 'Wyrmscale Jerkin', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 145, agi: 10, sta: 5 }, sellValue: 3000, requiredClass: ['rogue', 'hunter'],
  },
  gravewyrm_stalkers_treads: {
    id: 'gravewyrm_stalkers_treads', name: "Gravewyrm Stalker's Treads", kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 105, agi: 10, sta: 5 }, sellValue: 3200, requiredClass: ['rogue', 'hunter'],
  },
  gravewyrm_sabatons: {
    id: 'gravewyrm_sabatons', name: 'Gravewyrm Sabatons', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 145, str: 5, sta: 6 }, sellValue: 3200, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  wyrmcult_soulsteps: {
    id: 'wyrmcult_soulsteps', name: 'Wyrmcult Soulsteps', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 68, int: 9, spi: 5 }, sellValue: 3200, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  deathlord_warplate: {
    id: 'deathlord_warplate', name: 'Deathlord Warplate', kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 270, str: 8, sta: 10 }, sellValue: 9000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  necromancers_starshroud: {
    id: 'necromancers_starshroud', name: "Necromancer's Starshroud", kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 92, int: 14, spi: 8 }, sellValue: 9000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  wyrmshadow_harness: {
    id: 'wyrmshadow_harness', name: 'Wyrmshadow Harness', kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 170, agi: 13, sta: 7 }, sellValue: 9000, requiredClass: ['rogue', 'hunter'],
  },
  deathlord_legguards: {
    id: 'deathlord_legguards', name: 'Deathlord Legguards', kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 240, str: 8, sta: 9 }, sellValue: 9000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  deathlord_sabatons: {
    id: 'deathlord_sabatons', name: 'Deathlord Sabatons', kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 205, str: 7, sta: 8 }, sellValue: 9000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  necromancers_soulsteps: {
    id: 'necromancers_soulsteps', name: "Necromancer's Soulsteps", kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 80, int: 12, spi: 7 }, sellValue: 9000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  necromancers_legwraps: {
    id: 'necromancers_legwraps', name: "Necromancer's Legwraps", kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 86, int: 13, spi: 7 }, sellValue: 9000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  wyrmshadow_treads: {
    id: 'wyrmshadow_treads', name: 'Wyrmshadow Treads', kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 145, agi: 11, sta: 7 }, sellValue: 9000, requiredClass: ['rogue', 'hunter'],
  },
  wyrmshadow_legguards: {
    id: 'wyrmshadow_legguards', name: 'Wyrmshadow Legguards', kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 155, agi: 12, sta: 7 }, sellValue: 9000, requiredClass: ['rogue', 'hunter'],
  },
  // --- the three epics (Korzul drops) ---
  wyrmfang_greatblade: {
    id: 'wyrmfang_greatblade', name: 'Wyrmfang Greatblade', kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 30, max: 48, speed: 2.6 }, stats: { str: 10, sta: 6 }, sellValue: 8000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  staff_of_the_gravewyrm: {
    id: 'staff_of_the_gravewyrm', name: 'Staff of the Gravewyrm', kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 32, max: 52, speed: 3.0 }, stats: { int: 12, spi: 6 }, sellValue: 8000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  fang_of_korzul: {
    id: 'fang_of_korzul', name: 'Fang of Korzul', kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 19, max: 30, speed: 1.7, dagger: true }, stats: { agi: 11, sta: 5 }, sellValue: 8000, requiredClass: ['rogue', 'hunter'],
  },
  // --- Inventory 2.0 epics: one per armor archetype, filling the new slots and
  // named into the existing Deathlord/Necromancer's/Wyrmshadow Korzul epic families.
  // Budgeted just under the matching chest epic and slot-weighted (head≈1.0,
  // shoulder≈0.75, gloves≈0.65) so they slot cleanly into each set. ---
  deathlords_dread_visage: {
    id: 'deathlords_dread_visage', name: "Deathlord's Dread Visage", kind: 'armor', slot: 'helmet', quality: 'epic',
    stats: { armor: 245, str: 7, sta: 9 }, sellValue: 9000, requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  necromancers_soulspire_mantle: {
    id: 'necromancers_soulspire_mantle', name: "Necromancer's Soulspire Mantle", kind: 'armor', slot: 'shoulder', quality: 'epic',
    stats: { armor: 70, int: 11, spi: 6 }, sellValue: 9000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  wyrmshadow_talongrips: {
    id: 'wyrmshadow_talongrips', name: 'Wyrmshadow Talongrips', kind: 'armor', slot: 'gloves', quality: 'epic',
    stats: { armor: 110, agi: 10, sta: 5 }, sellValue: 9000, requiredClass: ['rogue', 'hunter'],
  },
  deathless_heartwood: {
    id: 'deathless_heartwood', name: 'Heartwood of the Deathless Crown', kind: 'weapon', slot: 'mainhand', quality: 'legendary',
    weapon: { min: 42, max: 68, speed: 3.2 }, stats: { agi: 24, sta: 18, int: 20 }, sellValue: 25000, requiredClass: ['druid'],
  },
  kingsbane_last_oath: {
    id: 'kingsbane_last_oath', name: 'Kingsbane, Last Oath of Thornpeak', kind: 'weapon', slot: 'mainhand', quality: 'legendary',
    weapon: { min: 46, max: 74, speed: 2.8 }, stats: { str: 24, sta: 20 }, sellValue: 25000, requiredClass: ['warrior', 'paladin'],
  },
  crownforged_dreadhelm: {
    id: 'crownforged_dreadhelm', name: 'Crownforged Dreadhelm', kind: 'armor', slot: 'helmet', quality: 'epic',
    stats: { armor: 310, str: 12, sta: 14 }, sellValue: 12000, requiredClass: ['warrior', 'paladin'],
  },
  crownforged_warspaulders: {
    id: 'crownforged_warspaulders', name: 'Crownforged Warspaulders', kind: 'armor', slot: 'shoulder', quality: 'epic',
    stats: { armor: 260, str: 10, sta: 12 }, sellValue: 12000, requiredClass: ['warrior', 'paladin'],
  },
  nighttalon_crown: {
    id: 'nighttalon_crown', name: 'Nighttalon Crown', kind: 'armor', slot: 'helmet', quality: 'epic',
    stats: { armor: 190, agi: 16, sta: 10 }, sellValue: 12000, requiredClass: ['rogue', 'hunter', 'druid'],
  },
  nighttalon_shoulderguards: {
    id: 'nighttalon_shoulderguards', name: 'Nighttalon Shoulderguards', kind: 'armor', slot: 'shoulder', quality: 'epic',
    stats: { armor: 165, agi: 14, sta: 9 }, sellValue: 12000, requiredClass: ['rogue', 'hunter', 'druid'],
  },
  soulflame_cowl: {
    id: 'soulflame_cowl', name: 'Soulflame Cowl', kind: 'armor', slot: 'helmet', quality: 'epic',
    stats: { armor: 105, int: 17, sta: 10 }, sellValue: 12000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  soulflame_mantle: {
    id: 'soulflame_mantle', name: 'Soulflame Mantle', kind: 'armor', slot: 'shoulder', quality: 'epic',
    stats: { armor: 92, int: 15, sta: 9 }, sellValue: 12000, requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  stormcallers_crown: {
    id: 'stormcallers_crown', name: "Stormcaller's Crown", kind: 'armor', slot: 'helmet', quality: 'epic',
    stats: { armor: 225, int: 16, sta: 12 }, sellValue: 12000, requiredClass: ['shaman'],
  },
  stormcallers_spaulders: {
    id: 'stormcallers_spaulders', name: "Stormcaller's Spaulders", kind: 'armor', slot: 'shoulder', quality: 'epic',
    stats: { armor: 190, int: 14, sta: 11 }, sellValue: 12000, requiredClass: ['shaman'],
  },
  // --- vendor food & drink (Quartermaster Bree) ---
  trail_hardtack: {
    id: 'trail_hardtack', name: 'Highwatch Trail Hardtack', kind: 'food', quality: 'common',
    foodHp: 552, sellValue: 75, buyValue: 1200,
  },
  meltwater_flask: {
    id: 'meltwater_flask', name: 'Meltwater Flask', kind: 'drink', quality: 'common',
    drinkMana: 672, sellValue: 75, buyValue: 1200,
  },
  roast_mountain_goat: {
    id: 'roast_mountain_goat', name: 'Roast Mountain Goat', kind: 'food', quality: 'common',
    foodHp: 874, sellValue: 150, buyValue: 2500,
  },
  glacier_melt: {
    id: 'glacier_melt', name: 'Glacier Melt', kind: 'drink', quality: 'common',
    drinkMana: 900, sellValue: 150, buyValue: 2500,
  },
  // --- vendor whites (Armorer Hode + Quartermaster Bree) ---
  highwatch_warblade: {
    id: 'highwatch_warblade', name: 'Highwatch Warblade', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 15, max: 24, speed: 2.3 }, sellValue: 600, buyValue: 6000,
  },
  craghorn_staff: {
    id: 'craghorn_staff', name: 'Craghorn Staff', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 16, max: 27, speed: 3.0 }, stats: { int: 2 }, sellValue: 600, buyValue: 6000,
  },
  icevein_dirk: {
    id: 'icevein_dirk', name: 'Icevein Dirk', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 10, max: 16, speed: 1.8, dagger: true }, sellValue: 600, buyValue: 6000,
  },
  highwatch_breastplate: {
    id: 'highwatch_breastplate', name: 'Highwatch Breastplate', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 160 }, sellValue: 700, buyValue: 7000,
  },
  peakwool_robe: {
    id: 'peakwool_robe', name: 'Peakwool Robe', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 50 }, sellValue: 500, buyValue: 5000,
  },
  stalkerhide_jerkin: {
    id: 'stalkerhide_jerkin', name: 'Stalkerhide Jerkin', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 95 }, sellValue: 600, buyValue: 6000,
  },
  cragwalker_boots: {
    id: 'cragwalker_boots', name: 'Cragwalker Boots', kind: 'armor', slot: 'feet', quality: 'common',
    stats: { armor: 55 }, sellValue: 400, buyValue: 4000,
  },
  windguard_leggings: {
    id: 'windguard_leggings', name: 'Windguard Leggings', kind: 'armor', slot: 'legs', quality: 'common',
    stats: { armor: 70 }, sellValue: 450, buyValue: 4500,
  },
  // --- junk (gray) ---
  ogre_toe_ring: { id: 'ogre_toe_ring', name: 'Ogre Toe Ring', kind: 'junk', quality: 'poor', sellValue: 25 },
  cracked_ogre_tusk: { id: 'cracked_ogre_tusk', name: 'Cracked Ogre Tusk', kind: 'junk', quality: 'poor', sellValue: 42 },
  inert_storm_shard: { id: 'inert_storm_shard', name: 'Inert Storm Shard', kind: 'junk', quality: 'poor', sellValue: 28 },
  frayed_prayer_beads: { id: 'frayed_prayer_beads', name: 'Frayed Prayer Beads', kind: 'junk', quality: 'poor', sellValue: 30 },
  cracked_wyrm_scale: { id: 'cracked_wyrm_scale', name: 'Cracked Wyrm Scale', kind: 'junk', quality: 'poor', sellValue: 35 },
};

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data). Highwatch
// sits on a high plateau (~9 elevation); the lake at (-70,760) stays clear.
// ---------------------------------------------------------------------------

export const ZONE3_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'house', x: 14, z: 671, w: 7, d: 6, rot: -0.5 },
    { kind: 'house', x: 8, z: 650, w: 6, d: 5, rot: 0.4 },
    { kind: 'house', x: 18, z: 660, w: 6, d: 5, rot: 1.2 },
    { kind: 'inn', x: -15, z: 666, w: 6, d: 7, rot: 0.6 },
    { kind: 'chapel', x: -16, z: 650, w: 5, d: 7, rot: 0.9 },
  ],
  wells: [{ x: 0, z: 662, r: 1.5 }],
  stalls: [
    { x: -7.5, z: 667, rot: Math.PI / 2, r: 1.7 },   // Quartermaster Bree
    { x: -4.5, z: 673.5, rot: -0.6, r: 1.7 },        // Armorer Hode
  ],
  mines: [
    { x: 88, z: 612, rot: -2.0 },                    // Deeprock Burrows
    { x: -152, z: 610, rot: Math.PI / 2 },           // Abandoned crypt entrance
  ],
  docks: [],
  tents: [
    // Drogmar's war-camp
    { x: -120, z: 733, rot: 0.5, scale: 1.3 },
    { x: -128, z: 744, rot: 2.0, scale: 1.3 },
    { x: -136, z: 752, rot: 1.0, scale: 1.5 },
    // Wyrmcult tents below the Sanctum
    { x: 50, z: 815, rot: 0.8, scale: 1 },
    { x: 58, z: 823, rot: -0.5, scale: 1 },
    { x: 60, z: 812, rot: 2.2, scale: 1 },
    { x: 28, z: 848, rot: 1.5, scale: 1 },
  ],
  crates: [[-118, 728], [-124, 735], [-130, 742], [52, 818], [57, 820]],
  campfires: [[2, 658], [-122, 736], [-136, 743], [52, 817], [28, 847]],
  mudHuts: [],
  ruinRings: [
    { x: -40, z: 830, ringR: 7, columns: 6 },        // Revenant Fields battlefield
    { x: 141, z: 712, ringR: 7, columns: 6 },        // Malric grave ruins
    { x: 138, z: 838, ringR: 7, columns: 6 },        // Aldren grave ruins
    { x: -139, z: 787, ringR: 7, columns: 6 },       // Royal Assassin Voss grave ruins
    { x: -12, z: 862, ringR: 6, columns: 5 },        // Sanctum Approach ruins
    { x: 12, z: 858, ringR: 6, columns: 5 },
  ],
  fences: [
    { x1: -14, z1: 649, x2: -4, z2: 647 },           // south gate, east run
    { x1: 4, z1: 647, x2: 14, z2: 649 },             // south gate, west run
  ],
  graveyards: [
    { x: 15, z: 645 },
    { x: 141, z: 712 },
    { x: 138, z: 838 },
    { x: -139, z: 787 },
  ],
};
