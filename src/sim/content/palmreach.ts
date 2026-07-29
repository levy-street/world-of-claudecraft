// The Palmreach (level 20). North past the Wraithwood's last black eaves
// the road spills out of the Tanglemouth onto hot white sand: a tropical
// realm of flat coral beaches ringed with palms, a jungle interior so green
// it eats the horizon, giant vine-hung banyans at the Vinefall, and the
// turquoise Sapphire Lagoon cupped in the eastern arm. The beach village of
// Drifthaven keeps its fires lit on the strand. Terrain: the REACH_* tables
// in world.ts (the coast applier flattens every shore into wide beach);
// the palms, banyans, and vines live in render/jungle_features.ts (the
// greatTrees records below give the sim its solid trunk colliders).

import type {
  CampDef,
  EscortDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const PALMREACH_ZONE: ZoneDef = {
  id: 'palmreach',
  name: 'The Palmreach',
  riftPortalEligible: true,
  riftTierWeights: { A: 0.4, S: 0.6 },
  zMin: 700,
  zMax: 1260,
  xMin: -540,
  xMax: -180,
  levelRange: [20, 20],
  biome: 'jungle',
  southPassX: -400, // the Tanglemouth: up from the fen into the green
  eastPassZ: 820, // the Sunway: off the heights, down into the sun
  hub: { x: -300, z: 820, radius: 16, name: 'Drifthaven' },
  graveyard: { x: -318, z: 802 },
  lakes: [
    { x: -270, z: 950, radius: 15 }, // the Sapphire Lagoon
    { x: -380, z: 1000, radius: 10 }, // the jungle pool
    { x: -336, z: 1158, radius: 11 }, // the northern tarn
  ],
  pois: [
    { x: -300, z: 820, label: 'Drifthaven', id: 'drifthaven' },
    { x: -420, z: 732, label: 'The Tanglemouth', id: 'the_tanglemouth' },
    { x: -460, z: 890, label: 'The Palmstrand', id: 'the_palmstrand' },
    { x: -360, z: 980, label: 'The Emerald Tangle', id: 'the_emerald_tangle' },
    { x: -400, z: 1080, label: 'The Vinefall', id: 'the_vinefall' },
    { x: -270, z: 950, label: 'The Sapphire Lagoon', id: 'the_sapphire_lagoon' },
    { x: -256, z: 1090, label: 'The Sunken Idol', id: 'the_sunken_idol' },
  ],
  welcome:
    'Warm sand, loud birds, and a jungle that eats the horizon. Drifthaven keeps a fire lit on the beach for you.',
  welcomeQuestId: 'q_pr_down_to_drifthaven',
};

export const PALMREACH_ROADS: { x: number; z: number }[][] = [
  [
    { x: -402, z: 706 },
    { x: -400, z: 752 },
    { x: -356, z: 790 },
    { x: -300, z: 820 },
  ], // the Tanglemouth -> along the shore -> Drifthaven
  [
    { x: -300, z: 820 },
    { x: -360, z: 860 },
    { x: -420, z: 880 },
    { x: -452, z: 888 },
  ], // Drifthaven -> the Palmstrand
  [
    { x: -300, z: 820 },
    { x: -326, z: 900 },
    { x: -350, z: 964 },
  ], // Drifthaven -> the Emerald Tangle
  [
    { x: -350, z: 964 },
    { x: -378, z: 1030 },
    { x: -396, z: 1070 },
  ], // the Tangle -> the Vinefall
  [
    { x: -300, z: 820 },
    { x: -276, z: 890 },
    { x: -242, z: 928 },
    { x: -238, z: 1018 },
    { x: -256, z: 1072 },
  ], // Drifthaven -> east around the Lagoon -> the Sunken Idol
  [
    { x: -256, z: 1072 },
    { x: -274, z: 1142 },
    { x: -296, z: 1196 },
    { x: -318, z: 1236 },
    { x: -330, z: 1254 },
  ], // the Sunken Idol -> up the north cape -> the Nightgate
  [
    { x: -242, z: 928 },
    { x: -212, z: 874 },
    { x: -186, z: 822 },
  ], // the lagoon road -> east down the Sunway (off the heights)
] as { x: number; z: number }[][];

// No portals: walked into through the Tanglemouth.
export const PALMREACH_PORTALS: PortalDef[] = [];

// The Palmreach's inhabitants: crabs work the tide line, boars root the
// thickets, weavers curtain the canopy in web, and the Guardian stands its
// drowned ring at the Sunken Idol. The castaway navigator is the escort-run
// escortee for q_pr_the_lost_navigator.
export const PALMREACH_MOBS: Record<string, MobTemplate> = {
  tide_scuttler: {
    id: 'tide_scuttler',
    name: 'Tide Scuttler',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 54,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 14, // shell
    moveSpeed: 7,
    aggroRadius: 8, // beach crabs mind their tidepools
    loot: [],
    scale: 1.15,
    color: 0xe86848,
  },
  thicket_boar: {
    id: 'thicket_boar',
    name: 'Thicket Boar',
    minLevel: 20,
    maxLevel: 20,
    family: 'beast',
    hpBase: 62,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 11,
    loot: [],
    scale: 1.2,
    color: 0x6a4e38,
  },
  canopy_weaver: {
    id: 'canopy_weaver',
    name: 'Canopy Weaver',
    minLevel: 20,
    maxLevel: 20,
    family: 'spider',
    hpBase: 56,
    hpPerLevel: 19,
    dmgBase: 12,
    dmgPerLevel: 2.3,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8.5,
    aggroRadius: 12,
    loot: [{ itemId: 'canopy_silk_hank', chance: 0.6, questId: 'q_pr_canopy_silk' }],
    scale: 1.25,
    color: 0x4e8a3c,
  },
  idol_guardian: {
    id: 'idol_guardian',
    name: 'The Idol Guardian',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 150,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 18, // carved stone
    moveSpeed: 7,
    aggroRadius: 14,
    elite: true,
    loot: [],
    scale: 1.5,
    color: 0x9aa87e,
  },
  // The Pearlwake's chart-reader (q_pr_the_lost_navigator). Escort-run
  // escortee: non-hostile, never wanders (moveSpeed 0; src/sim/escort.ts
  // drives all movement), never fights back. Sturdy enough to survive an
  // ambush wave long enough for the escorting player to peel it.
  castaway_navigator: {
    id: 'castaway_navigator',
    name: 'Navigator Suli',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    hpBase: 240,
    hpPerLevel: 20,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 0.95,
    color: 0x4a7a9c,
  },
};
// The folk of the strand: a watcher keeps the Tanglemouth waycamp, the
// salvage-boss and the Pearl-Mother hold Drifthaven, and one hermit camps
// alone under the Vinefall banyans, the only local who ever walked toward
// the drums. Okku stands far from the hub on purpose: the jungle chain
// sends players out to find him.
export const PALMREACH_NPCS: Record<string, NpcDef> = {
  strandwatcher_pell: {
    id: 'strandwatcher_pell',
    name: 'Strandwatcher Pell',
    title: 'Watcher of the Tanglemouth',
    pos: { x: -416, z: 722 },
    facing: 1.0,
    color: 0xc9b07a,
    questIds: ['q_pr_down_to_drifthaven'],
    greeting:
      'Out of the black trees at last. Breathe, stranger, the sun holds this side of the pass.',
  },
  salvage_boss_ryna: {
    id: 'salvage_boss_ryna',
    name: 'Salvage-Boss Ryna',
    title: 'Mistress of the Wreck Line',
    pos: { x: -296, z: 816 },
    facing: -0.8,
    color: 0xb46a3c,
    questIds: [
      'q_pr_down_to_drifthaven',
      'q_pr_wreck_line_cargo',
      'q_pr_scuttler_cull',
      'q_pr_the_lost_navigator',
    ],
    greeting:
      'A $C with working arms, good. The wreck line pays well, if the crabs leave you enough fingers to count it.',
  },
  pearlmother_isha: {
    id: 'pearlmother_isha',
    name: 'Pearl-Mother Isha',
    title: 'Elder of the Divers',
    pos: { x: -293, z: 810 },
    facing: 0.6,
    color: 0x8fb8b0,
    questIds: ['q_pr_boars_in_the_gardens', 'q_pr_the_man_who_went_in'],
    greeting: 'The sea gives, the sand keeps, and the jungle takes. Stay on the strand, stranger.',
  },
  hermit_okku: {
    id: 'hermit_okku',
    name: 'Okku',
    title: 'The Man Who Went In',
    // 12.4 yd out from the great banyan at (-400, 1080), on the shoulder of
    // the Tangle road's last waypoint (2.2 yd from it, 2.4 yd off the road
    // line, so he reads as standing at the path edge). The trunk COLLIDER is
    // only r * 1.45 (4.6 yd), but the rendered banyan scales to
    // t.r * (2.5..3.0) and its roots flare wider still: at z 1074 he showed
    // as a nameplate floating in the bark, and at z 1071.5 (8.7 yd out) he
    // still clipped the trunk. Keep him a full 12 yd clear.
    pos: { x: -397, z: 1068 },
    facing: -0.24, // atan2(dx, dz) toward the banyan he went in to
    color: 0x6f8a5a,
    questIds: [
      'q_pr_the_man_who_went_in',
      'q_pr_canopy_silk',
      'q_pr_what_the_drums_guard',
      'q_pr_idol_guardian',
    ],
    greeting:
      'Quiet now. The drums count everything that walks under the trees, and they have already counted you.',
  },
};
export const PALMREACH_QUESTS: Record<string, QuestDef> = {
  q_pr_down_to_drifthaven: {
    id: 'q_pr_down_to_drifthaven',
    name: 'Down to Drifthaven',
    giverNpcId: 'strandwatcher_pell',
    turnInNpcId: 'salvage_boss_ryna',
    text: 'Out of the black trees and into the sun, $N. Follow the shore road north and you will strike Drifthaven before the tide turns. Ask for Salvage-Boss Ryna, she has work for any pair of hands since the storm, and tell her the Tanglemouth road is still open.',
    completionText:
      'Pell sent you? Then you walked the whole Tanglemouth road alone, and that is reference enough for me. Welcome to Drifthaven, $N. Grab a rope, we are short-handed.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'salvage_boss_ryna',
        count: 1,
        label: 'Report to Salvage-Boss Ryna',
      },
    ],
    xpReward: 2600,
    copperReward: 1000,
    itemRewards: {},
    minLevel: 19,
  },
  q_pr_wreck_line_cargo: {
    id: 'q_pr_wreck_line_cargo',
    name: 'The Wreck Line',
    giverNpcId: 'salvage_boss_ryna',
    turnInNpcId: 'salvage_boss_ryna',
    text: 'The storm three nights back drove the Pearlwake onto the reef, and her cargo is strewn the whole length of the wreck line between here and the Palmstrand. Three crates of trade goods are still lying in the surf, $N. Bring them in before the tide, or the crabs, claim what is left.',
    completionText:
      'Salt-stained but sound, all three. The divers eat this month because of you, $N.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'pearlwake_cargo_crate',
        count: 3,
        label: 'Pearlwake Cargo recovered',
      },
    ],
    xpReward: 4600,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_pr_down_to_drifthaven',
  },
  q_pr_scuttler_cull: {
    id: 'q_pr_scuttler_cull',
    name: 'Shellbacked Thieves',
    giverNpcId: 'salvage_boss_ryna',
    turnInNpcId: 'salvage_boss_ryna',
    text: 'Every wreck on this coast draws the tide scuttlers, and the Pearlwake has drawn half the reef. My salvage crews will not work a line with those claws in the shallows. Crack ten of them, $N, and the wreck line is ours again.',
    completionText:
      'Ten fewer claws in the surf. My crews are already wading back out, and not one of them said thank you, so I will: thank you, $N.',
    objectives: [
      { type: 'kill', targetMobId: 'tide_scuttler', count: 10, label: 'Tide Scuttler cracked' },
    ],
    xpReward: 4800,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_pr_down_to_drifthaven',
  },
  q_pr_the_lost_navigator: {
    id: 'q_pr_the_lost_navigator',
    name: 'The Lost Navigator',
    giverNpcId: 'salvage_boss_ryna',
    turnInNpcId: 'salvage_boss_ryna',
    text: 'We pulled every hand off the Pearlwake but one: Navigator Suli, who swam for the far strand and never walked in. A diver spotted her holed up in the bow wreckage past the Palmstrand, alive, and too spent to run the gauntlet alone. Walk her home along the shore road, $N. The crabs will not like it, and the jungle likes it less.',
    completionText:
      'Suli is by the fire, still swearing she could have swum it. You brought back the only chart-reader on this coast, $N. These are from her sea chest, with her blessing.',
    objectives: [
      {
        type: 'escort',
        escortId: 'esc_pr_navigator',
        count: 1,
        label: 'Navigator Suli seen safely to Drifthaven',
      },
    ],
    xpReward: 5600,
    copperReward: 3200,
    itemRewards: {
      warrior: 'saltwalker_sandals',
      mage: 'saltwalker_sandals',
      rogue: 'saltwalker_sandals',
    },
    requiresQuest: 'q_pr_wreck_line_cargo',
    minLevel: 20,
  },
  q_pr_boars_in_the_gardens: {
    id: 'q_pr_boars_in_the_gardens',
    name: 'Boars in the Gardens',
    giverNpcId: 'pearlmother_isha',
    turnInNpcId: 'pearlmother_isha',
    text: 'Whatever stirs in the deep green, it pushes the thicket boars out onto our strand. They have rooted up the garden terraces twice this week, and they will have the drying racks next. Ten boars, $N, and push the rest back under the trees.',
    completionText:
      'The racks stand and the gardens can be replanted. The boars did not choose to come onto the sand, $N. Remember that: something moved them.',
    objectives: [
      { type: 'kill', targetMobId: 'thicket_boar', count: 10, label: 'Thicket Boar driven off' },
    ],
    xpReward: 4600,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_pr_down_to_drifthaven',
  },
  q_pr_the_man_who_went_in: {
    id: 'q_pr_the_man_who_went_in',
    name: 'The Man Who Went In',
    giverNpcId: 'pearlmother_isha',
    turnInNpcId: 'hermit_okku',
    text: 'The divers will not step past the treeline, $N, and I will not ask them to. You have heard the drums by now: everyone does, by the second night. One man on this island ever walked toward that sound and came back. Okku. He camps under the great banyans at the Vinefall, deep up the Tangle road. Find him, and ask him what the green is hiding.',
    completionText:
      "Isha sent you? The Pearl-Mother has not spoken my name in years. Sit out of the vines' reach, $N, and I will tell you what I know: the drums are not the danger. They are the warning.",
    objectives: [
      {
        type: 'interact',
        targetNpcId: 'hermit_okku',
        count: 1,
        label: 'Find Okku at the Vinefall',
      },
    ],
    xpReward: 2800,
    copperReward: 1100,
    itemRewards: {},
    requiresQuest: 'q_pr_down_to_drifthaven',
    minLevel: 20,
  },
  q_pr_canopy_silk: {
    id: 'q_pr_canopy_silk',
    name: 'Silk from the Canopy',
    giverNpcId: 'hermit_okku',
    turnInNpcId: 'hermit_okku',
    text: 'Look up, $N. Every canopy from here to the idol is webbed like a fishing net, and the weavers grow bolder each season. I string their own silk across the paths, tripline bells, so the jungle cannot creep up on me. Six good hanks off the canopy weavers will restring my lines.',
    completionText:
      'Good, strong silk. My bells will sing a while longer, and nothing walks these paths at night without me knowing, $N. Lately, something has been walking often.',
    objectives: [
      { type: 'collect', itemId: 'canopy_silk_hank', count: 6, label: 'Canopy Silk Hank' },
    ],
    xpReward: 5000,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_pr_the_man_who_went_in',
  },
  q_pr_what_the_drums_guard: {
    id: 'q_pr_what_the_drums_guard',
    name: 'What the Drums Guard',
    giverNpcId: 'hermit_okku',
    turnInNpcId: 'hermit_okku',
    text: 'I have walked as near the Sunken Idol as a living man dares, and I saw two things: the weavers have curtained the idol road in web, and the old offering bowls along it have been filled again. Freshly, $N. Cut eight weavers off the road and bring me three of those offerings. I would know what hand still feeds a dead god.',
    completionText:
      'Moss, pearl-shell, and boar blood, packed by fingers. Something in that ruin still keeps its rites, $N, and the Guardian keeps everything else out. It is time we spoke of it plainly.',
    objectives: [
      { type: 'kill', targetMobId: 'canopy_weaver', count: 8, label: 'Canopy Weaver cut down' },
      {
        type: 'interact',
        targetObjectItemId: 'sunken_offering_bowl',
        count: 3,
        label: 'Refilled Offering Bowl gathered',
      },
    ],
    xpReward: 5200,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_pr_canopy_silk',
    minLevel: 20,
  },
  q_pr_idol_guardian: {
    id: 'q_pr_idol_guardian',
    name: 'The Idol Guardian',
    giverNpcId: 'hermit_okku',
    turnInNpcId: 'hermit_okku',
    text: 'The idol is older than the island, $N. Older than the drums, older than the name Palmreach. Its Guardian has stood in that drowned ring since before the palms grew, and now it wakes and walks the columns at night. Whatever the offerings feed, the Guardian is its door-ward. Bring a friend, and break it.',
    completionText:
      'You felled a thing the jungle itself would not touch. Look there, behind the idol: the Guardian was never guarding the columns, $N, it was guarding the steps beneath them. The drums have gone quiet tonight. Whatever sleeps below the Wildheart Basin now knows your name.',
    objectives: [
      { type: 'kill', targetMobId: 'idol_guardian', count: 1, label: 'The Idol Guardian broken' },
    ],
    xpReward: 6200,
    copperReward: 3800,
    itemRewards: {
      warrior: 'sunken_idol_mantle',
      mage: 'sunken_idol_mantle',
      rogue: 'sunken_idol_mantle',
    },
    requiresQuest: 'q_pr_what_the_drums_guard',
    minLevel: 20,
    suggestedPlayers: 2,
  },
};

// Level-braided presentation order (not strictly chain order), matching the
// Veiled Hollow convention.
export const PALMREACH_QUEST_ORDER: string[] = [
  'q_pr_down_to_drifthaven',
  'q_pr_wreck_line_cargo',
  'q_pr_scuttler_cull',
  'q_pr_boars_in_the_gardens',
  'q_pr_the_man_who_went_in',
  'q_pr_canopy_silk',
  'q_pr_the_lost_navigator',
  'q_pr_what_the_drums_guard',
  'q_pr_idol_guardian',
];
export const PALMREACH_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  pearlwake_cargo_crate: {
    id: 'pearlwake_cargo_crate',
    name: 'Pearlwake Cargo Crate',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_pr_wreck_line_cargo',
    noVendorSell: true,
  },
  canopy_silk_hank: {
    id: 'canopy_silk_hank',
    name: 'Canopy Silk Hank',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_pr_canopy_silk',
  },
  sunken_offering_bowl: {
    id: 'sunken_offering_bowl',
    name: 'Refilled Offering Bowl',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_pr_what_the_drums_guard',
    noVendorSell: true,
  },
  // --- quest rewards ---
  saltwalker_sandals: {
    id: 'saltwalker_sandals',
    name: 'Saltwalker Sandals',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 60, sta: 2, agi: 3 },
    sellValue: 1000,
  },
  sunken_idol_mantle: {
    id: 'sunken_idol_mantle',
    name: 'Mantle of the Sunken Idol',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 76, sta: 6, spi: 4 },
    sellValue: 2400,
  },
};
export const PALMREACH_CAMPS: CampDef[] = [
  { mobId: 'tide_scuttler', center: { x: -456, z: 878 }, radius: 10, count: 3 },
  { mobId: 'tide_scuttler', center: { x: -252, z: 840 }, radius: 10, count: 3 },
  { mobId: 'thicket_boar', center: { x: -368, z: 940 }, radius: 10, count: 3 },
  // moved off the Emerald Run's new river valley onto the dry shoulder
  { mobId: 'thicket_boar', center: { x: -410, z: 960 }, radius: 10, count: 3 },
  { mobId: 'canopy_weaver', center: { x: -326, z: 1060 }, radius: 10, count: 3 },
  { mobId: 'canopy_weaver', center: { x: -426, z: 1120 }, radius: 10, count: 2 },
  { mobId: 'idol_guardian', center: { x: -256, z: 1090 }, radius: 5, count: 1 },
];
export const PALMREACH_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'pearlwake_cargo_crate',
    name: 'Pearlwake Cargo Crate',
    // Strewn along the wreck line where the Pearlwake broke up, hugging the
    // Drifthaven -> Palmstrand shore road.
    positions: [
      { x: -352, z: 866 },
      { x: -396, z: 876 },
      { x: -434, z: 888 },
    ],
  },
  {
    itemId: 'sunken_offering_bowl',
    name: 'Refilled Offering Bowl',
    // The old offering bowls line the last stretch of the idol road, short of
    // the Guardian's drowned ring.
    positions: [
      { x: -244, z: 1036 },
      { x: -252, z: 1056 },
      { x: -266, z: 1072 },
    ],
  },
];

// The Lost Navigator (q_pr_the_lost_navigator): Suli shelters in the
// Pearlwake's bow wreckage past the Palmstrand and walks the shore road east
// to Drifthaven, through the scuttlers that pick the wreck line and the
// weavers that drop from the treeline. Waypoints hug the authored road curve
// above.
export const PALMREACH_ESCORTS: Record<string, EscortDef> = {
  esc_pr_navigator: {
    id: 'esc_pr_navigator',
    npcMobId: 'castaway_navigator',
    questId: 'q_pr_the_lost_navigator',
    start: { x: -456, z: 892 },
    waypoints: [
      { x: -420, z: 880 },
      { x: -360, z: 860 },
      { x: -328, z: 838 },
      { x: -300, z: 822 },
    ],
    moveSpeed: 4.5,
    ambushes: [
      { atWaypoint: 0, mobId: 'tide_scuttler', count: 3 },
      { atWaypoint: 2, mobId: 'canopy_weaver', count: 3 },
    ],
    creditRadius: 40,
    respawnSeconds: 30,
    startText:
      'You came down the wreck line for me? Then let us go before the tide turns. Stay between me and the water, the crabs come from the surf.',
    successText:
      'Drifthaven! I can smell the cookfires from here. I owe you my charts and my neck, friend.',
    failText: 'No... the sea spits me back once, not twice...',
  },
};

export const PALMREACH_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Drifthaven: a driftwood village on the strand
  buildings: [
    { kind: 'inn', x: -308, z: 824, w: 6, d: 7, rot: 0.9 },
    { kind: 'house', x: -292, z: 814, w: 5, d: 5, rot: -0.7 },
    // the outlying hamlets, one house anchoring each mud-hut cluster: the
    // back-beach, the Vinefall approach, and the idol road (probed level)
    { kind: 'house', x: -380, z: 795, w: 5, d: 5, rot: 0.2 },
    { kind: 'house', x: -370, z: 1045, w: 5, d: 5, rot: 2.9 },
    { kind: 'house', x: -280, z: 1055, w: 5, d: 5, rot: 1.4 },
    // the second wave: lone homesteads spread wide (every site probed level
    // and dry, 18-plus yards clear of every other structure)
    { kind: 'house', x: -320, z: 780, w: 5, d: 5, rot: 1.8 },
    { kind: 'house', x: -270, z: 820, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: -440, z: 900, w: 5, d: 5, rot: 0.6 },
    { kind: 'house', x: -410, z: 1130, w: 5, d: 5, rot: 2.2 },
  ],
  wells: [{ x: -300, z: 822, r: 1.5 }],
  stalls: [
    { x: -296, z: 828, rot: 0.4, r: 1.6 },
    { x: -305, z: 812, rot: -1.6, r: 1.6 },
  ],
  tents: [
    { x: -288, z: 826, rot: 1.1, scale: 1 },
    { x: -312, z: 834, rot: -2.0, scale: 1.1 },
    // the Sunway camp: a traveller ring on the jungle shelf east of town
    { x: -245, z: 876, rot: -0.785, scale: 1 },
    { x: -256, z: 877, rot: 0.983, scale: 1.1 },
    { x: -250, z: 888, rot: 3.14, scale: 1 },
    // riverside camps: one tent each on the Emerald Run and West Arm banks
    { x: -445, z: 1000, rot: 2.3, scale: 1 },
    { x: -506, z: 1039, rot: 0.75, scale: 1 },
  ],
  crates: [
    [-302, 816],
    [-294, 820],
    [-246, 884], // the Sunway camp's stores
    [-376, 797], // the hamlets' yards
    [-374, 1047],
    [-284, 1057],
  ],
  campfires: [
    [-300, 818],
    [-418, 720], // the Tanglemouth's waycamp
    [-250, 881], // the Sunway camp
    [-380, 803], // the hamlets' hearths
    [-370, 1053],
    [-280, 1063],
    [-441, 997], // the riverside camps
    [-503, 1036],
  ],
  // a fishing dock running off the village beach into the shallows
  // Drifthaven's beach dock (kept on the strand: the flat coast has no open
  // water nearby to reach). hw/hd 0: no hut, so no thin post floats off it.
  docks: [{ x: -286, z: 838, rot: 0.6, hutLocal: { x: 40, z: 40, hw: 0, hd: 0 } }],
  mudHuts: [
    [-316, 826],
    [-290, 808],
    // the hamlet huts, two flanking each anchor house
    [-387, 803],
    [-373, 802],
    [-377, 1053],
    [-363, 1052],
    [-287, 1063],
    [-273, 1062],
    // lone huts on the far moors, each well away from everything else
    [-250, 1000],
    [-220, 1210],
  ],
  // beached rowboats along the river banks, the pool, and the lagoon shore
  decorProps: [
    { key: 'rowboat', x: -437, z: 984, rot: 1.2, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -356, z: 1194, rot: -0.6, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -498, z: 1034, rot: 2.0, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -396, z: 1006, rot: 0.4, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -288, z: 958, rot: -2.2, scale: 1, r: 1.4, h: 1.2 },
  ],
  // the Sunken Idol: a mossy ring of drowned-temple columns
  ruinRings: [{ x: -256, z: 1090, ringR: 8, columns: 6 }],
  // The giant banyans of the Vinefall and the deep Tangle: solid trunk
  // colliders in the sim, vine-hung crowns drawn by jungle_features.ts.
  // every spot probed LEVEL (height spread under 1.5 across the root ring)
  // and pushed back from the lakes, the rivers, and the road net
  greatTrees: [
    { x: -400, z: 1080, r: 3.2 },
    { x: -422, z: 1058, r: 2.8 },
    { x: -378, z: 1100, r: 3.0 },
    { x: -390, z: 930, r: 2.6 },
    { x: -446, z: 1030, r: 2.6 },
    { x: -338, z: 1120, r: 2.8 },
    { x: -368, z: 902, r: 3.0 },
    { x: -448, z: 1094, r: 2.8 },
    { x: -316, z: 970, r: 2.6 },
    { x: -306, z: 1128, r: 2.8 },
  ],
};
