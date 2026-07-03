// The Drowned Temple — a self-contained side-wing reached through a moongate
// portal on the shore of the Glimmermere, a glowing tarn high in Thornpeak
// Heights. Its own lore (the Pale Choir, who drowned worshipping Ysolei, the
// Drowned Moon), its own mobs, quests, loot and instanced interior — nothing
// here touches the Gravecaller storyline of zones 1-3.
//
// Everything is merged into the flat engine tables by sim/data.ts, exactly the
// way the per-zone modules and content/dungeons.ts are. Levels ~15-18: a step
// up from the Sunken Bastion (13) for players climbing toward the Sanctum (20).

import type {
  CampDef,
  DungeonDef,
  DungeonSpawn,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PlayerClass,
  QuestDef,
  ZonePropsDef,
} from '../types';

// Archetype class-locks (match content/items.ts so REWARD_ARCHETYPE hand-offs
// land on an item the whole group can equip).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// The moongate sits on the south shore of the Glimmermere tarn (-70, 760) in
// Thornpeak Heights; the surface camp and Ondrel cluster just south of it.
export const MOONGATE_POS = { x: -70, z: 792 };

// ---------------------------------------------------------------------------
// Mobs — overworld (the Glimmermere shore)
// ---------------------------------------------------------------------------

export const TEMPLE_MOBS: Record<string, MobTemplate> = {
  glimmermere_wader: {
    id: 'glimmermere_wader',
    name: 'Glimmermere Wader',
    minLevel: 15,
    maxLevel: 16,
    family: 'mudfin',
    hpBase: 70,
    hpPerLevel: 22,
    dmgBase: 10,
    dmgPerLevel: 2.5,
    attackSpeed: 1.9,
    armorPerLevel: 14,
    moveSpeed: 8,
    aggroRadius: 13, // waders swarm in from far, murloc-style
    loot: [
      { copper: 70, chance: 1 },
      { itemId: 'pale_pearl', chance: 0.4 },
      { itemId: 'moonpale_scale', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0x8fb6c4,
  },
  drowned_votary: {
    id: 'drowned_votary',
    name: 'Drowned Votary',
    minLevel: 15,
    maxLevel: 16,
    family: 'undead',
    hpBase: 74,
    hpPerLevel: 22,
    dmgBase: 10,
    dmgPerLevel: 2.5,
    attackSpeed: 2.0,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 11,
    loot: [
      { copper: 80, chance: 1 },
      { itemId: 'drowned_offering', chance: 0.6, questId: 'q_drowned_choir' },
      { itemId: 'briny_idol', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x6c8f8a,
  },
  sethrael_palecoil: {
    id: 'sethrael_palecoil',
    name: 'Sethrael the Palecoil',
    minLevel: 16,
    maxLevel: 16,
    family: 'dragonkin',
    rare: true,
    hpBase: 175,
    hpPerLevel: 28,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 7.5,
    aggroRadius: 12,
    loot: [
      { copper: 500, chance: 1 },
      { itemId: 'palecoil_heartscale', chance: 1, questId: 'q_palecoil' },
      { itemId: 'moonpale_scale', chance: 1 },
      { itemId: 'pale_pearl', chance: 0.5 },
    ],
    scale: 1.2,
    color: 0xbcd2e6,
  },
};

// ---------------------------------------------------------------------------
// Mobs — instanced (The Drowned Temple, 5-player elite)
// ---------------------------------------------------------------------------

export const TEMPLE_DUNGEON_MOBS: Record<string, MobTemplate> = {
  drowned_templeguard: {
    id: 'drowned_templeguard',
    name: 'Drowned Templeguard',
    minLevel: 16,
    maxLevel: 17,
    family: 'undead',
    elite: true,
    hpBase: 58,
    hpPerLevel: 22,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.3,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'pale_pearl', chance: 0.4 },
    ],
    scale: 1.1,
    color: 0x88a7a0,
  },
  pale_choir_acolyte: {
    id: 'pale_choir_acolyte',
    name: 'Pale Choir Acolyte',
    minLevel: 16,
    maxLevel: 17,
    family: 'humanoid',
    elite: true,
    hpBase: 54,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.0,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.4 },
      { itemId: 'briny_idol', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x9fb8d6,
  },
  glimmerscale_lurker: {
    id: 'glimmerscale_lurker',
    name: 'Glimmerscale Lurker',
    minLevel: 16,
    maxLevel: 17,
    family: 'spider',
    elite: true,
    hpBase: 56,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.7,
    attackSpeed: 1.8,
    armorPerLevel: 16,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [
      { copper: 200, chance: 1 },
      { itemId: 'spider_leg', chance: 0.5 },
      { itemId: 'moonpale_scale', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0xbfe1ec,
  },
  pearlguard_sentinel: {
    id: 'pearlguard_sentinel',
    name: 'Pearlguard Sentinel',
    minLevel: 17,
    maxLevel: 18,
    family: 'elemental',
    elite: true,
    hpBase: 64,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'pale_pearl', chance: 0.6 },
      { itemId: 'moonpale_scale', chance: 0.4 },
    ],
    scale: 1.15,
    color: 0x9fc6e0,
  },
  choirmother_selthe: {
    id: 'choirmother_selthe',
    name: 'Choirmother Selthe',
    minLevel: 18,
    maxLevel: 18,
    family: 'humanoid',
    elite: true,
    hpBase: 150,
    hpPerLevel: 26,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 14,
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'selthes_seastriders', chance: 0.4 },
      { itemId: 'briny_idol', chance: 0.5 },
    ],
    scale: 1.15,
    color: 0x6f8fae,
  },
  moonspawn: {
    id: 'moonspawn',
    name: 'Moonspawn',
    minLevel: 16,
    maxLevel: 16,
    family: 'mudfin',
    hpBase: 44,
    hpPerLevel: 15,
    dmgBase: 8,
    dmgPerLevel: 2.1,
    attackSpeed: 1.9,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [], // summoned by Ysolei — nothing to loot
    scale: 0.9,
    color: 0xcfe0ff,
  },
  ysolei: {
    id: 'ysolei',
    name: 'Ysolei, Avatar of the Drowned Moon',
    minLevel: 18,
    maxLevel: 18,
    family: 'dragonkin',
    elite: true,
    boss: true,
    hpBase: 300,
    hpPerLevel: 38,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.5,
    armorPerLevel: 28,
    moveSpeed: 7,
    aggroRadius: 18,
    aoePulse: { min: 22, max: 32, radius: 13, every: 9, name: 'Lunar Tide' },
    summonAdds: { mobId: 'moonspawn', count: 2, atHpPct: [0.6, 0.3] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 6000, chance: 1 },
      { itemId: 'ysols_pearl_greaves', chance: 0.5 },
      // exclusive "one of three" blue chests (weights sum to 1.0)
      { itemId: 'moonshroud_breastplate', chance: 0.34, rollGroup: 'ysolei_blue' },
      { itemId: 'moonshroud_robe', chance: 0.33, rollGroup: 'ysolei_blue' },
      { itemId: 'moonshroud_tunic', chance: 0.33, rollGroup: 'ysolei_blue' },
    ],
    scale: 1.65,
    color: 0xbcd2ec,
  },
};

// ---------------------------------------------------------------------------
// NPC — Ondrel Vane keeps a lonely watch at the moongate
// ---------------------------------------------------------------------------

export const TEMPLE_NPCS: Record<string, NpcDef> = {
  tidewatcher_ondrel: {
    id: 'tidewatcher_ondrel',
    name: 'Ondrel Vane',
    title: 'Tidewatcher',
    pos: { x: -66, z: 786 },
    facing: -2.4,
    color: 0x7fa6c9,
    questIds: [
      'q_glimmermere_light',
      'q_tarn_waders',
      'q_drowned_choir',
      'q_palecoil',
      'q_silence_the_choir',
      'q_drowned_moon',
    ],
    greeting:
      'The mere drinks the moonlight, $C, and gives back the drowned. I have watched that gate for thirty nights — and tonight it is open.',
  },
};

// ---------------------------------------------------------------------------
// Quests — a soloable lead-up on the shore, then a 5-player finale below
// ---------------------------------------------------------------------------

export const TEMPLE_QUESTS: Record<string, QuestDef> = {
  q_glimmermere_light: {
    id: 'q_glimmermere_light',
    name: 'Light on the Water',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: 'Look there, $N — under the surface, a stair of pale stone running down into the dark, and a gate of cold light at the head of it. The old wardens scratched warnings into the shore-rocks before the water took them. Take a rubbing of one for me; I would read what they feared before we go any closer.',
    completionText:
      'A waking-prayer... to something they called the Drowned Moon. And below it, in a steadier hand: "It only sleeps." The water has been listening a long time, $N.',
    objectives: [
      { type: 'collect', itemId: 'moongate_rubbing', count: 1, label: 'Warding Rubbing taken' },
    ],
    xpReward: 3200,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 15,
  },
  q_tarn_waders: {
    id: 'q_tarn_waders',
    name: 'What the Tarn Gives Up',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: 'Since the gate opened, things climb out of the mere at dusk — bloated, pale, finned where hands ought to be. Glimmermere Waders, the old rubbings name them. They drag anything living back down with them. Cull ten before they thin my watch to nothing.',
    completionText:
      'Ten back in the water. They feel no cold, $N, and no fear — only the pull of that gate. Whatever sings to them, it sings loud.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'glimmermere_wader',
        count: 10,
        label: 'Glimmermere Wader slain',
      },
    ],
    xpReward: 3400,
    copperReward: 1600,
    itemRewards: {},
    requiresQuest: 'q_glimmermere_light',
  },
  q_drowned_choir: {
    id: 'q_drowned_choir',
    name: 'The Drowned Choir',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: 'The waders do not act alone. Among them walk the Drowned Votaries — the cult that sank with the temple, still in their rotted vestments, still singing the prayer from the shore-rocks. Silence eight of them, and bring me six of the offerings they carry. I would know what they mean to give their goddess.',
    completionText:
      "Pearls, knuckle-bones, a child's carved fish... grave-gifts, $N. They are not raising the dead. They are dressing them, the way you dress a body for burial. The temple is a tomb that refuses to close.",
    objectives: [
      { type: 'kill', targetMobId: 'drowned_votary', count: 8, label: 'Drowned Votary silenced' },
      { type: 'collect', itemId: 'drowned_offering', count: 6, label: 'Drowned Offering' },
    ],
    xpReward: 3800,
    copperReward: 1800,
    itemRewards: {
      warrior: 'tidewatchers_wraps',
      mage: 'tidewatchers_wraps',
      rogue: 'tidewatchers_wraps',
    },
    requiresQuest: 'q_tarn_waders',
  },
  q_palecoil: {
    id: 'q_palecoil',
    name: 'Sethrael the Palecoil',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: "One shape in the mere is no drowned man. A serpent the colour of bone glides the deep shelf where the stair begins — Sethrael, the rubbings call it, the Palecoil, the moon's own watch-beast. While it guards that water, no one reaches the gate alive. Go down to the shelf and kill it, $N. Take its heartscale so I know the deed is done.",
    completionText:
      'Cold as the bottom of the world, and still it twitches. The shelf is clear, $N — the stair to the gate stands open. I almost wish it did not.',
    objectives: [
      { type: 'collect', itemId: 'palecoil_heartscale', count: 1, label: "Sethrael's Heartscale" },
    ],
    xpReward: 4000,
    copperReward: 2000,
    itemRewards: { warrior: 'moonscale_saber', mage: 'palecoil_rod', rogue: 'tideglass_dirk' },
    requiresQuest: 'q_tarn_waders',
    minLevel: 16,
  },
  q_silence_the_choir: {
    id: 'q_silence_the_choir',
    name: 'Silence the Choir',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: 'The singing comes from below the gate now, and one voice leads it: Choirmother Selthe, who first taught the cult to drown without dying. While she keeps the prayer, the temple will never sleep — and the mere will never stop giving up its dead. Take companions through the gate and end her. This is no errand for a lone blade, $N.',
    completionText:
      'The prayer falters... and for the first time in thirty nights, the mere is quiet. But quiet is not the same as ended. Selthe was only the choir. Something below it still listens.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'choirmother_selthe',
        count: 1,
        label: 'Choirmother Selthe slain',
      },
    ],
    xpReward: 4400,
    copperReward: 2400,
    itemRewards: {
      warrior: 'drownstep_sabatons',
      mage: 'drownstep_slippers',
      rogue: 'drownstep_treads',
    },
    requiresQuest: 'q_drowned_choir',
    minLevel: 16,
    suggestedPlayers: 5,
  },
  q_drowned_moon: {
    id: 'q_drowned_moon',
    name: 'The Drowned Moon',
    giverNpcId: 'tidewatcher_ondrel',
    turnInNpcId: 'tidewatcher_ondrel',
    text: "I have read the last of the rubbings, $N, and I understand now what the cult drowned themselves to keep asleep. Ysolei — the Drowned Moon made flesh — coils on the altar at the temple's heart, and the stolen warmth of every life the mere took is pouring into her waking. When the moon stands full she rises, and the water rises with her — the tarn, the wall, the whole mountain under it. Gather the strongest you can find and put her back to sleep. For good, this time.",
    completionText:
      'The altar is dark, the water is still, and the moon over the tarn is only the moon. You drowned a goddess tonight, $N — and the mountain will never know how close it came. Let the wardens of the shore-rocks rest easy at last.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ysolei',
        count: 1,
        label: 'Ysolei, Avatar of the Drowned Moon, slain',
      },
    ],
    xpReward: 5000,
    copperReward: 12000,
    itemRewards: {
      warrior: 'drownedmoon_maul',
      mage: 'drownedmoon_scepter',
      rogue: 'drownedmoon_kris',
    },
    requiresQuest: 'q_silence_the_choir',
    minLevel: 16,
    suggestedPlayers: 5,
  },
};

export const TEMPLE_QUEST_ORDER = [
  'q_glimmermere_light',
  'q_tarn_waders',
  'q_drowned_choir',
  'q_palecoil',
  'q_silence_the_choir',
  'q_drowned_moon',
];

// ---------------------------------------------------------------------------
// World layout — the Glimmermere shore (south of the tarn at -70,760)
// ---------------------------------------------------------------------------

export const TEMPLE_CAMPS: CampDef[] = [
  { mobId: 'glimmermere_wader', center: { x: -78, z: 778 }, radius: 16, count: 7 },
  { mobId: 'glimmermere_wader', center: { x: -56, z: 800 }, radius: 14, count: 5 },
  { mobId: 'drowned_votary', center: { x: -90, z: 802 }, radius: 16, count: 7 },
  { mobId: 'drowned_votary', center: { x: -64, z: 814 }, radius: 12, count: 5 },
  { mobId: 'sethrael_palecoil', center: { x: -96, z: 814 }, radius: 3, count: 1 },
];

export const TEMPLE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'moongate_rubbing',
    name: 'Warded Shore-Rock',
    positions: [
      { x: -74, z: 786 },
      { x: -68, z: 783 },
      { x: -76, z: 796 },
      { x: -64, z: 794 },
    ],
  },
];

// Static props for the surface site: a ring of drowned columns around the gate
// and Ondrel's lonely little camp just south of it (rendering + collision share
// this, like every other ZonePropsDef).
export const TEMPLE_PROPS: ZonePropsDef = {
  buildings: [],
  wells: [],
  stalls: [],
  mines: [],
  docks: [],
  tents: [{ x: -62, z: 783, rot: 1.4, scale: 1.1 }],
  crates: [
    [-60, 786],
    [-58, 789],
  ],
  campfires: [[-63, 788]],
  mudHuts: [],
  ruinRings: [{ x: -70, z: 792, ringR: 7, columns: 6 }],
  fences: [],
  graveyards: [],
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const TEMPLE_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  moongate_rubbing: {
    id: 'moongate_rubbing',
    name: 'Warding Rubbing',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_glimmermere_light',
  },
  drowned_offering: {
    id: 'drowned_offering',
    name: 'Drowned Offering',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_drowned_choir',
  },
  palecoil_heartscale: {
    id: 'palecoil_heartscale',
    name: "Sethrael's Heartscale",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_palecoil',
  },

  // --- quest greens (uncommon) ---
  tidewatchers_wraps: {
    id: 'tidewatchers_wraps',
    name: "Tidewatcher's Wraps",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 65, sta: 3, spi: 2 },
    sellValue: 600,
  },
  moonscale_saber: {
    id: 'moonscale_saber',
    name: 'Moonscale Saber',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 17, max: 28, speed: 2.4 },
    stats: { str: 5, sta: 2 },
    sellValue: 700,
    requiredClass: WAR,
  },
  palecoil_rod: {
    id: 'palecoil_rod',
    name: 'Palecoil Rod',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 18, max: 31, speed: 3.0 },
    stats: { int: 6, spi: 2 },
    sellValue: 700,
    requiredClass: MAG,
  },
  tideglass_dirk: {
    id: 'tideglass_dirk',
    name: 'Tideglass Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 11, max: 18, speed: 1.7, dagger: true },
    stats: { agi: 6 },
    sellValue: 700,
    requiredClass: ROG,
  },

  // --- quest & dungeon blues (rare) ---
  drownstep_sabatons: {
    id: 'drownstep_sabatons',
    name: 'Drownstep Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 90, sta: 4, str: 2 },
    sellValue: 1400,
    requiredClass: WAR,
  },
  drownstep_slippers: {
    id: 'drownstep_slippers',
    name: 'Drownstep Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 35, int: 5, spi: 3 },
    sellValue: 1400,
    requiredClass: MAG,
  },
  drownstep_treads: {
    id: 'drownstep_treads',
    name: 'Drownstep Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 60, agi: 6, sta: 2 },
    sellValue: 1400,
    requiredClass: ROG,
  },
  drownedmoon_maul: {
    id: 'drownedmoon_maul',
    name: 'Drowned Moon Maul',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 24, max: 38, speed: 2.6 },
    stats: { str: 8, sta: 4 },
    sellValue: 2200,
    requiredClass: WAR,
  },
  drownedmoon_scepter: {
    id: 'drownedmoon_scepter',
    name: 'Drowned Moon Scepter',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 26, max: 42, speed: 3.0 },
    stats: { int: 10, spi: 4 },
    sellValue: 2200,
    requiredClass: MAG,
  },
  drownedmoon_kris: {
    id: 'drownedmoon_kris',
    name: 'Drowned Moon Kris',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 16, max: 25, speed: 1.7, dagger: true },
    stats: { agi: 9, sta: 3 },
    sellValue: 2200,
    requiredClass: ROG,
  },
  moonshroud_breastplate: {
    id: 'moonshroud_breastplate',
    name: 'Moonwrack Breastplate',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 200, sta: 7, str: 4 },
    sellValue: 2400,
    requiredClass: WAR,
  },
  moonshroud_robe: {
    id: 'moonshroud_robe',
    name: 'Moonwrack Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 70, int: 10, spi: 5 },
    sellValue: 2400,
    requiredClass: MAG,
  },
  moonshroud_tunic: {
    id: 'moonshroud_tunic',
    name: 'Moonwrack Tunic',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 125, agi: 9, sta: 4 },
    sellValue: 2400,
    requiredClass: ROG,
  },
  ysols_pearl_greaves: {
    id: 'ysols_pearl_greaves',
    name: "Ysolei's Pearl Greaves",
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 130, sta: 6, spi: 3 },
    sellValue: 2000,
  },
  selthes_seastriders: {
    id: 'selthes_seastriders',
    name: "Selthe's Sea-Striders",
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 75, agi: 4, sta: 3 },
    sellValue: 1200,
  },

  // --- junk (gray) ---
  pale_pearl: {
    id: 'pale_pearl',
    name: 'Pale Pearl',
    kind: 'junk',
    quality: 'poor',
    sellValue: 30,
  },
  moonpale_scale: {
    id: 'moonpale_scale',
    name: 'Moonpale Scale',
    kind: 'junk',
    quality: 'poor',
    sellValue: 26,
  },
  briny_idol: {
    id: 'briny_idol',
    name: 'Briny Idol',
    kind: 'junk',
    quality: 'poor',
    sellValue: 32,
  },
};

// ---------------------------------------------------------------------------
// The Drowned Temple instance — paired elite packs through a flooded
// antechamber, Choirmother Selthe holding the threshold of the moon-sanctum,
// then Ysolei coiled on the great altar with two templeguards.
// ---------------------------------------------------------------------------

const TEMPLE_SPAWN_LIST: DungeonSpawn[] = [
  // antechamber
  { mobId: 'drowned_templeguard', x: -3, z: 14 },
  { mobId: 'drowned_templeguard', x: 3, z: 15 },
  { mobId: 'drowned_templeguard', x: -9, z: 30 },
  { mobId: 'pale_choir_acolyte', x: -5, z: 31 },
  { mobId: 'glimmerscale_lurker', x: 9, z: 44 },
  { mobId: 'drowned_templeguard', x: 5, z: 45 },
  { mobId: 'pearlguard_sentinel', x: -5, z: 56 },
  { mobId: 'pale_choir_acolyte', x: -1, z: 57 },
  // moon-sanctum (past the waist arch at z 66)
  { mobId: 'choirmother_selthe', x: -4, z: 80 },
  { mobId: 'pale_choir_acolyte', x: 2, z: 81 },
  { mobId: 'glimmerscale_lurker', x: 9, z: 92 },
  { mobId: 'drowned_templeguard', x: -7, z: 93 },
  { mobId: 'pearlguard_sentinel', x: -5, z: 104 },
  { mobId: 'drowned_templeguard', x: 3, z: 105 },
  // the altar
  { mobId: 'ysolei', x: 0, z: 116 },
  { mobId: 'drowned_templeguard', x: -4, z: 114 },
  { mobId: 'drowned_templeguard', x: 4, z: 114 },
];

export const TEMPLE_DUNGEON_DEFS: Record<string, DungeonDef> = {
  drowned_temple: {
    id: 'drowned_temple',
    name: 'The Drowned Temple',
    index: 3, // instance origin x = 900 + 3*600 = 2700 (clear of the arena band)
    doorPos: { ...MOONGATE_POS }, // the moongate on the Glimmermere shore
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: TEMPLE_SPAWN_LIST,
    interior: 'temple',
    suggestedPlayers: 5,
    enterText:
      'You step through the moongate — the air turns to cold water and pale light, and the singing closes over your head.',
    leaveText: 'You surface through the moongate into the mountain night.',
  },
};
