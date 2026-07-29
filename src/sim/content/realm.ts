// The Veiled Hollow (levels 15-20). A sheltered valley realm sealed beneath
// the mountains north of Thornpeak long before the Gravecaller conspiracy;
// the seal has thinned, and a concealed cave in the Thornpeak cliffs now
// leads through. Permanent dusk, glowing flora, and the town of Eldergleam
// around the roots of a great tree. Reached only by portal: the southern
// border ridge is sealed (see sealedSouthBorder in world.ts).

import type {
  CampDef,
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

export const REALM_ZONE: ZoneDef = {
  id: 'veiled_hollow',
  name: 'The Veiled Hollow',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.55, A: 0.35, S: 0.1 },
  zMin: 900,
  zMax: 1440, // the northern 180yd is open ocean (see the coast in world.ts)
  levelRange: [15, 20],
  biome: 'dusk',
  sealedSouthBorder: true,
  hub: { x: -40, z: 1030, radius: 30, name: 'Eldergleam' },
  graveyard: { x: -60, z: 1004 },
  // Overlapping carves make organic shorelines: inlets and coves instead of
  // circular ponds. The tarn cuts into the western highlands; the falls pool
  // terrace above Starfall is shaped in world.ts (VEILED_HOLLOW_SHAPING).
  lakes: [
    { x: 110, z: 985, radius: 22 }, // Starfall Basin
    { x: 94, z: 1000, radius: 10 }, // ...its reedy northwest inlet
    { x: 126, z: 972, radius: 9 }, // ...and the quiet southeast cove
    { x: 75, z: 1165, radius: 18 }, // the Crystalline Shallows
    { x: 60, z: 1178, radius: 9 }, // ...shallow northern cove
    { x: 92, z: 1154, radius: 8 }, // ...crystal-flanked eastern cove
    { x: -120, z: 1105, radius: 12 }, // the Mirrormere, a highland tarn
    { x: -15, z: 1062, radius: 7 }, // the meadow pond by the garden road
    { x: 148, z: 1124, radius: 13 }, // the Mirrorshallow, beside the Westway meadow
    { x: 142, z: 1142, radius: 8 }, // ...its reeded southern finger
  ],
  pois: [
    { x: -40, z: 1030, label: 'Eldergleam', id: 'eldergleam' },
    { x: -140, z: 952, label: 'Duskfall Cave', id: 'duskfall_cave' },
    { x: -118, z: 988, label: 'Duskfall Overlook', id: 'duskfall_overlook' },
    { x: 30, z: 955, label: 'Elder Grove', id: 'elder_grove' },
    { x: 110, z: 985, label: 'Starfall Basin', id: 'starfall_basin' },
    { x: 125, z: 1085, label: 'The Sunken Court', id: 'the_sunken_court' },
    { x: 75, z: 1165, label: 'Crystalline Shallows', id: 'crystalline_shallows' },
    { x: -70, z: 1155, label: 'The Gleaming Deep', id: 'the_gleaming_deep' },
  ],
  welcome: 'The air hums with old magic. Seek Keeper Saelwyn beneath the great tree of Eldergleam.',
  welcomeQuestId: 'q_veil_thinned',
};

// Winding valley paths: the cave descent into Eldergleam, then spokes out to
// the grove, the basin, the ruins, and the mushroom forest.
export const REALM_ROADS: { x: number; z: number }[][] = [
  [
    // the Eldergleam ring: a circular walk around the great tree; the four
    // spoke roads below each end on this circle
    { x: -40, z: 1040 },
    { x: -33, z: 1038.1 },
    { x: -27.9, z: 1033 },
    { x: -26, z: 1026 },
    { x: -27.9, z: 1019 },
    { x: -33, z: 1013.9 },
    { x: -40, z: 1012 },
    { x: -47, z: 1013.9 },
    { x: -52.1, z: 1019 },
    { x: -54, z: 1026 },
    { x: -52.1, z: 1033 },
    { x: -47, z: 1038.1 },
    { x: -40, z: 1040 },
  ],
  [
    { x: -140, z: 955 },
    { x: -125, z: 980 },
    { x: -95, z: 1005 },
    { x: -53, z: 1022 },
  ], // Duskfall Cave -> the Eldergleam ring, west
  [
    { x: -45, z: 1039 },
    { x: -45, z: 1052 },
    { x: -60, z: 1105 },
    { x: -70, z: 1150 },
  ], // the Eldergleam ring, north -> the Gleaming Deep
  [
    { x: -26, z: 1030 },
    { x: -18, z: 1030 },
    { x: 30, z: 1042 },
    { x: 80, z: 1062 },
    { x: 120, z: 1085 },
  ], // the Eldergleam ring, east -> the Sunken Court
  [
    { x: -33, z: 1014 },
    { x: -30, z: 1010 },
    { x: 15, z: 982 },
    { x: 70, z: 975 },
    { x: 88, z: 982 },
    { x: 100, z: 984 },
  ], // the Eldergleam ring, southeast -> Starfall Basin -> the Star's Cradle causeway
  [
    { x: -62, z: 1155 },
    { x: -10, z: 1172 },
    { x: 38, z: 1170 },
  ], // the Gleaming Deep -> Crystalline Shallows
];

// Dense ground-cover flower drifts (dusk palette). The renderer's grass ring
// treats these circles like guaranteed field cells, so the whole area blooms
// instead of the usual scattered patches. Flowers are walk-through dressing:
// no colliders, and placement still skips water, steep ground, and roads.
export const REALM_FLOWER_MEADOWS: { x: number; z: number; r: number }[] = [
  // Starfall Basin: the meadow bowl around the fallen star's lake
  { x: 60, z: 972, r: 26 }, // the road meadow below Elder Grove
  { x: 92, z: 966, r: 20 }, // the south shore sweep
  { x: 80, z: 1002, r: 18 }, // the glimmerwisp meadow at the northwest inlet
];

// The way in. Side a is the crystal cave on a probed LEVEL bench high on
// the central Thornpeak Heights, well clear of every mob camp, its mouth
// facing northwest out toward the Gravewyrm road (ringed with pink
// flowers; the modeled gate is render/hollow_gates.ts). Side b is the
// Duskfall tree cave on its own level shelf off the realm's southern
// wall. Landings sit ~5yd outside the opposite trigger so arrivals never
// bounce straight back.
export const REALM_PORTALS: PortalDef[] = [
  {
    id: 'duskfall_passage',
    a: { x: 10, z: 770, landing: { x: 6.5, z: 773.5, facing: -0.79 } },
    b: { x: -122, z: 959, landing: { x: -126.9, z: 957.9, facing: -1.79 } },
    radius: 2.0,
    enterText: 'A veil of dusk parts before you, and the Hollow opens ahead.',
    leaveText: 'The veil closes behind you, and the mountain air bites again.',
  },
];

// ---------------------------------------------------------------------------
// Creatures. Beautiful first, dangerous second: most of the Hollow is passive
// or neutral; the hostile pockets are the corrupted fringe. Every creature
// reuses an existing rigged family (stags use the real stag model via
// MOB_KEYS in render/characters/manifest.ts; the stone guardians borrow the
// golem rig with a stone tint).
// ---------------------------------------------------------------------------

export const REALM_MOBS: Record<string, MobTemplate> = {
  glimmerwisp: {
    id: 'glimmerwisp',
    name: 'Glimmerwisp',
    minLevel: 15,
    maxLevel: 16,
    family: 'elemental',
    hpBase: 44,
    hpPerLevel: 16,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 0, // drifting ambient light, harmless unless harmed
    loot: [{ itemId: 'wisp_mote', chance: 0.6, questId: 'q_wisp_lights' }],
    scale: 0.7,
    color: 0xffc4ec,
  },
  duskwisp: {
    id: 'duskwisp',
    name: 'Duskwisp',
    minLevel: 15,
    maxLevel: 16,
    family: 'elemental',
    hpBase: 52,
    hpPerLevel: 19,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 9,
    // Duskchill: a clinging cold that seeps in where the veil has torn
    venom: { chance: 0.25, perTick: 4, interval: 2, duration: 8, name: 'Duskchill' },
    loot: [
      { copper: 70, chance: 1 },
      { itemId: 'duskwisp_essence', chance: 0.6, questId: 'q_veil_thinned' },
      { itemId: 'starfall_shard', chance: 0.5, questId: 'q_shards_of_starfall' },
    ],
    scale: 0.8,
    color: 0x7a5f9e,
  },
  veiled_stag: {
    id: 'veiled_stag',
    name: 'Veiled Stag',
    minLevel: 15,
    maxLevel: 16,
    family: 'beast',
    hpBase: 60,
    hpPerLevel: 20,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 2.1,
    armorPerLevel: 12,
    moveSpeed: 9,
    aggroRadius: 0, // grazes in peace
    loot: [{ itemId: 'gleaming_antler', chance: 0.55, questId: 'q_gleaming_antlers' }],
    scale: 1.0,
    color: 0xb9a3cf,
  },
  veiled_doe: {
    id: 'veiled_doe',
    name: 'Veiled Doe',
    minLevel: 14,
    maxLevel: 15,
    family: 'beast',
    hpBase: 48,
    hpPerLevel: 16,
    dmgBase: 7,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 10,
    moveSpeed: 9.5,
    aggroRadius: 0, // shies from everything; fights only if cornered
    loot: [{ copper: 40, chance: 1 }],
    scale: 0.9,
    color: 0xcdbfdc,
  },
  gleamstag: {
    id: 'gleamstag',
    name: 'The Gleamstag',
    minLevel: 17,
    maxLevel: 17,
    family: 'beast',
    rare: true,
    elite: true,
    respawnMult: 7,
    hpBase: 300,
    hpPerLevel: 50,
    dmgBase: 15,
    dmgPerLevel: 3.6,
    attackSpeed: 1.8,
    armorPerLevel: 22,
    moveSpeed: 9.5,
    aggroRadius: 0, // even the legend will not strike first
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'gleamstag_charm', chance: 1 },
    ],
    scale: 1.3,
    color: 0xf2dcff,
  },
  mushroom_pixie: {
    id: 'mushroom_pixie',
    name: 'Gleamfolk Pixie',
    minLevel: 15,
    maxLevel: 16,
    family: 'kobold',
    hpBase: 50,
    hpPerLevel: 17,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.2,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 0, // the little folk of the village never strike first
    loot: [],
    scale: 1.0,
    color: 0xd8c4f0,
  },
  sporeling_gatherer: {
    id: 'sporeling_gatherer',
    name: 'Sporeling Gatherer',
    minLevel: 15,
    maxLevel: 15,
    family: 'kobold',
    hpBase: 48,
    hpPerLevel: 17,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.2,
    armorPerLevel: 10,
    moveSpeed: 7,
    aggroRadius: 0, // the mushroom folk tend their rings in peace
    loot: [],
    scale: 0.8,
    color: 0xd8b98a,
  },
  corrupted_sporeling: {
    id: 'corrupted_sporeling',
    name: 'Corrupted Sporeling',
    minLevel: 16,
    maxLevel: 17,
    family: 'kobold',
    hpBase: 60,
    hpPerLevel: 21,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.0,
    armorPerLevel: 15,
    moveSpeed: 7.5,
    aggroRadius: 10,
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
    loot: [
      { copper: 85, chance: 1 },
      { itemId: 'spore_heart', chance: 0.65, questId: 'q_spore_hearts' },
    ],
    scale: 0.85,
    color: 0x5e4a72,
  },
  treant_elder: {
    id: 'treant_elder',
    name: 'Treant Elder',
    minLevel: 18,
    maxLevel: 18,
    family: 'ogre',
    elite: true,
    hpBase: 150,
    hpPerLevel: 27,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 26,
    moveSpeed: 6,
    aggroRadius: 6, // rooted patience; do not test it
    wardAllies: { radius: 14, every: 10, amount: 70, duration: 8, name: 'Bark Ward' },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'elder_bark', chance: 0.7, questId: 'q_treant_accord' },
    ],
    scale: 1.45,
    color: 0x4f7a38, // mossy bark green (drives the treant rig wash)
  },
  ancient_guardian: {
    id: 'ancient_guardian',
    name: 'Ancient Guardian',
    minLevel: 18,
    maxLevel: 19,
    family: 'elemental',
    elite: true,
    hpBase: 165,
    hpPerLevel: 28,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 10,
    stoneskin: { amount: 90, every: 12, duration: 8, name: 'Stone Bulwark' },
    loot: [
      { copper: 170, chance: 1 },
      { itemId: 'guardian_core', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0x9a94a8,
  },
  // --- wandering bosses: rare elites with their own silhouettes (the crab
  // and bull rigs appear nowhere else in the game) ---
  old_marrowshell: {
    id: 'old_marrowshell',
    name: 'Old Marrowshell',
    minLevel: 17,
    maxLevel: 17,
    family: 'beast',
    rare: true,
    elite: true,
    ccImmune: true,
    canSwim: true,
    respawnMult: 6,
    hpBase: 340,
    hpPerLevel: 54,
    dmgBase: 16,
    dmgPerLevel: 3.8,
    attackSpeed: 2.0,
    armorPerLevel: 34,
    moveSpeed: 6.5,
    aggroRadius: 9,
    stoneskin: { amount: 110, every: 12, duration: 8, name: 'Ancient Carapace' },
    venom: { chance: 0.3, perTick: 5, interval: 2, duration: 10, name: 'Coldwater Rot' },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'guardian_core', chance: 1 },
      { itemId: 'duskfang_dirk', chance: 0.35 },
    ],
    scale: 1.5,
    color: 0x8fb8d8,
  },
  aurelhorn: {
    id: 'aurelhorn',
    name: 'Aurelhorn, First of the Herd',
    minLevel: 18,
    maxLevel: 18,
    family: 'beast',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 6,
    hpBase: 360,
    hpPerLevel: 56,
    dmgBase: 17,
    dmgPerLevel: 3.8,
    attackSpeed: 1.9,
    armorPerLevel: 26,
    moveSpeed: 9,
    aggroRadius: 0, // the herd's warden strikes only when the herd is struck
    aoePulse: {
      min: 22,
      max: 30,
      radius: 8,
      every: 9,
      name: 'Trampling Charge',
      school: 'physical',
    },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'gleaming_antler', chance: 1 },
      { itemId: 'veilsteel_blade', chance: 0.35 },
    ],
    scale: 1.45,
    color: 0xd8c49a,
  },
  waking_warden: {
    id: 'waking_warden',
    name: 'The Waking Warden',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    respawnMult: 4,
    hpBase: 420,
    hpPerLevel: 60,
    dmgBase: 18,
    dmgPerLevel: 4.0,
    attackSpeed: 2.1,
    armorPerLevel: 32,
    moveSpeed: 7,
    aggroRadius: 12,
    aoePulse: { min: 24, max: 32, radius: 9, every: 10, name: 'Sundering Toll' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.35, hasteMult: 1.25 },
    loot: [
      { copper: 600, chance: 1 },
      { itemId: 'wardens_seal', chance: 1, questId: 'q_waking_warden' },
    ],
    scale: 1.5,
    color: 0xb08fd8,
  },
};

// ---------------------------------------------------------------------------
// The people of Eldergleam.
// ---------------------------------------------------------------------------

export const REALM_NPCS: Record<string, NpcDef> = {
  keeper_saelwyn: {
    id: 'keeper_saelwyn',
    name: 'Keeper Saelwyn',
    title: 'Keeper of the Hollow',
    pos: { x: -43, z: 1016 },
    facing: -2.85, // back to the great tree, greeting arrivals from the ring
    color: 0xd8c4f0,
    questIds: [
      'q_veil_thinned',
      'q_calming_the_deep',
      'q_sunken_court',
      'q_waking_warden',
      'q_seal_restored',
    ],
    greeting: 'Few of your kind have stood beneath these boughs, $C. Walk gently, and be welcome.',
  },
  loremother_bryn: {
    id: 'loremother_bryn',
    name: 'Loremother Bryn',
    title: 'Voice of the Shrine',
    pos: { x: -20, z: 1015 },
    facing: -0.9,
    color: 0xc4b08a,
    questIds: ['q_spore_hearts', 'q_wisp_lights', 'q_treant_accord', 'q_spore_tide'],
    greeting: 'Every light in this valley remembers something, $N. Help me listen.',
  },
  provisioner_fenna: {
    id: 'provisioner_fenna',
    name: 'Provisioner Fenna',
    title: 'Eldergleam Provisioner',
    pos: { x: -46, z: 1031 },
    facing: -0.87,
    color: 0x8fbf8a,
    questIds: ['q_gleaming_antlers', 'q_grove_menace', 'q_hollow_the_huntsman'],
    vendorItems: [
      'trail_hardtack',
      'meltwater_flask',
      'roast_mountain_goat',
      'glacier_melt',
      'healing_potion',
      'mana_potion',
    ],
    greeting: 'Bread still warm, water still sweet. The Hollow provides, and so do I.',
  },
  wardsmith_orun: {
    id: 'wardsmith_orun',
    name: 'Wardsmith Orun',
    title: 'Keeper of the Old Forges',
    pos: { x: -34, z: 1031 },
    facing: 0.87,
    color: 0x9a86b8,
    questIds: [],
    vendorItems: ['wardplate_cuirass', 'nightweave_tunic', 'veilcloth_robe'],
    greeting: 'These forges cooled centuries ago, $C, but their work still holds an edge.',
  },
  archivist_tullo: {
    id: 'archivist_tullo',
    name: 'Archivist Tullo',
    title: 'Reader of Stones',
    pos: { x: -31, z: 1021 },
    facing: 2.08, // back to the great tree, looking out toward his monuments
    color: 0xb8a8d8,
    questIds: ['q_monument_tour', 'q_shards_of_starfall', 'q_wardens_echoes'],
    greeting:
      'The monuments out there have not spoken to anyone in an age. Perhaps they were waiting for fresh ears.',
  },
  // The huntsman keeps a lookout among the stag meadows, far from Eldergleam:
  // Fenna's breadcrumb sends players out to find him, and his chain hunts the
  // Hollow's two wandering rare bosses.
  huntsman_deral: {
    id: 'huntsman_deral',
    name: 'Huntsman Deral',
    title: 'Warden of the Herds',
    pos: { x: 18, z: 1104 },
    facing: -0.6,
    color: 0x7d9668,
    questIds: ['q_hollow_the_huntsman', 'q_hollow_old_marrowshell', 'q_hollow_first_of_the_herd'],
    greeting: 'Quiet now. The herd knows every sound this valley makes, and so do I.',
  },
};

// ---------------------------------------------------------------------------
// Quests: one connected seal-restoration chain plus side work, levels 15-20.
// ---------------------------------------------------------------------------

export const REALM_QUESTS: Record<string, QuestDef> = {
  q_veil_thinned: {
    id: 'q_veil_thinned',
    name: 'The Thinned Veil',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'So the cave opened for you. Then the seal is weaker than I feared, $N. Where the veil tears, the wisps turn dark and cold. Bring me eight essences from the duskwisps and I will read how deep the wound runs.',
    completionText:
      'Cold, every one of them. The Hollow has perhaps a season before the tear becomes a rift. We have work to do, you and I.',
    objectives: [
      { type: 'collect', itemId: 'duskwisp_essence', count: 8, label: 'Duskwisp Essence' },
    ],
    xpReward: 3600,
    copperReward: 1600,
    itemRewards: {},
    minLevel: 14,
  },
  q_calming_the_deep: {
    id: 'q_calming_the_deep',
    name: 'Calming the Deep',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'The sporelings of the Gleaming Deep were gentle folk before the tear touched their rings. What the corruption takes, it does not give back. Grant the corrupted ones rest, $N: ten of them, in the north of the Deep.',
    completionText:
      'You did what I could not bear to. The gatherers still sing in the south rings; because of you, they will keep singing.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'corrupted_sporeling',
        count: 10,
        label: 'Corrupted Sporeling laid to rest',
      },
    ],
    xpReward: 4200,
    copperReward: 2000,
    itemRewards: {
      warrior: 'veilsteel_blade',
      rogue: 'duskfang_dirk',
      mage: 'gleamwood_stave',
    },
    requiresQuest: 'q_veil_thinned',
    minLevel: 15,
  },
  q_spore_hearts: {
    id: 'q_spore_hearts',
    name: 'Hearts of the Ring',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'When a sporeling falls to the dark, its heart keeps beating with borrowed shadow. Four of those hearts, cleansed at the shrine, may teach us how the corruption spreads. It is grim work, $N, but it is mending work.',
    completionText:
      'There. Cleansed, and quiet. Each one shows the same mark: the shadow flows FROM the Sunken Court. Tell Saelwyn.',
    objectives: [{ type: 'collect', itemId: 'spore_heart', count: 4, label: 'Spore Heart' }],
    xpReward: 4400,
    copperReward: 2200,
    itemRewards: {},
    requiresQuest: 'q_calming_the_deep',
    minLevel: 16,
  },
  q_sunken_court: {
    id: 'q_sunken_court',
    name: 'The Sunken Court',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'Bryn read the hearts true: the tear runs through the old court in the east, and its guardians have woken wrong. They were built to protect the seal; now they will crush anyone who nears it. Clear eight of them from the ruins.',
    completionText:
      'Eight guardians, stilled. I remember when they were raised, $N. Do not look so surprised; the Hollow keeps its keepers a long time.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ancient_guardian',
        count: 8,
        label: 'Ancient Guardian stilled',
      },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_spore_hearts',
    minLevel: 17,
  },
  q_waking_warden: {
    id: 'q_waking_warden',
    name: 'The Waking Warden',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'The court is quiet, but its master is not. The Warden that holds the seal has woken twisted, and while it stands, the seal cannot be mended. It will not fall easily; bring a friend if you can find one, $N. Bring two if you can find two.',
    completionText:
      'The bell of its voice is silent. I felt it from here, like a weight lifted off the whole valley.',
    objectives: [
      { type: 'kill', targetMobId: 'waking_warden', count: 1, label: 'The Waking Warden defeated' },
    ],
    xpReward: 6000,
    copperReward: 3800,
    itemRewards: {},
    requiresQuest: 'q_sunken_court',
    minLevel: 18,
    suggestedPlayers: 2,
  },
  q_seal_restored: {
    id: 'q_seal_restored',
    name: 'The Seal Restored',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: "Take the Warden's seal to the sealstone at the heart of the court and set it back where it was struck loose. Then the Hollow can begin to heal, and you, $N, will have done what no one of your kind has done before.",
    completionText:
      'I felt it close from here, gentle as dusk. The Hollow remembers its friends, $N. However far you travel, there will always be a light for you beneath the great tree.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'hollow_sealstone',
        count: 1,
        label: 'The seal set back in the sealstone',
      },
    ],
    xpReward: 7400,
    copperReward: 5500,
    itemRewards: {
      warrior: 'wardens_oathband',
      rogue: 'wardens_oathband',
      mage: 'wardens_oathband',
    },
    requiresQuest: 'q_waking_warden',
    minLevel: 18,
  },
  q_gleaming_antlers: {
    id: 'q_gleaming_antlers',
    name: 'Gleaming Antlers',
    giverNpcId: 'provisioner_fenna',
    turnInNpcId: 'provisioner_fenna',
    text: 'The veiled stags shed light where they graze, and their cast antlers hold it for years. Five of them, from the herds in the open glade at the heart of the valley, and my lanterns burn through the winter without oil. The stags need not be harmed, but they do not part with them easily.',
    completionText:
      'Look how they hold the light! No flame, no smoke, just the glow. The Hollow provides.',
    objectives: [
      { type: 'collect', itemId: 'gleaming_antler', count: 5, label: 'Gleaming Antler' },
    ],
    xpReward: 3400,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 14,
  },
  q_wisp_lights: {
    id: 'q_wisp_lights',
    name: 'Lights of the Shallows',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The glimmerwisps carry motes of the old starlight that fell here when the Hollow was sealed. Six motes, and the shrine lamps will burn for a year. Take only from those that fade; the Hollow gives enough without greed.',
    completionText:
      'Soft as the first stars. Set them here by the altar; the shrine will do the rest.',
    objectives: [{ type: 'collect', itemId: 'wisp_mote', count: 6, label: 'Wisp Mote' }],
    xpReward: 3400,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 14,
  },
  q_treant_accord: {
    id: 'q_treant_accord',
    name: 'The Treant Accord',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The elders of the Grove shed their outer bark as the corruption gnaws at their roots. Four lengths of it, and I can brew a salve for the whole Grove. They will not thank you while you pry it loose, $N, but they will stand a century longer for it.',
    completionText:
      'Thick and sound, all four. The salve will take a week to brew and a hundred years to finish its work. Trees measure kindness differently.',
    objectives: [{ type: 'collect', itemId: 'elder_bark', count: 4, label: 'Elder Bark' }],
    xpReward: 4400,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 17,
  },
  q_monument_tour: {
    id: 'q_monument_tour',
    name: 'What the Stones Remember',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'Three monuments still stand from before the sealing: one at the Duskfall Overlook, one in the Sunken Court, and one lost in the far northeast where nobody walks. Read them for me, $N. My knees gave out two centuries of stairs ago.',
    completionText:
      'An overlook, a court, and a forgotten corner... and all three verses of the sealing song, together for the first time since it was sung. You have made an old reader very happy.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'monument_overlook',
        count: 1,
        label: 'The Overlook monument read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'monument_court',
        count: 1,
        label: 'The Court monument read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'monument_north',
        count: 1,
        label: 'The forgotten monument read',
      },
    ],
    xpReward: 4200,
    copperReward: 2000,
    itemRewards: {},
    minLevel: 15,
  },

  q_grove_menace: {
    id: 'q_grove_menace',
    name: 'Menace in the Glade',
    giverNpcId: 'provisioner_fenna',
    turnInNpcId: 'provisioner_fenna',
    text: 'Duskwisps have started drifting in among my stalls after dark, $N, and their chill spoils everything it touches. Thin them out for me: ten of them, wherever the veil has torn.',
    completionText:
      'The night market can open again. You have a customer for life, or at least a discount.',
    objectives: [{ type: 'kill', targetMobId: 'duskwisp', count: 10, label: 'Duskwisp dispersed' }],
    xpReward: 4000,
    copperReward: 1900,
    itemRewards: {},
    requiresQuest: 'q_veil_thinned',
    minLevel: 15,
  },
  q_shards_of_starfall: {
    id: 'q_shards_of_starfall',
    name: 'Shards of Starfall',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'When the duskwisps pass over the crystal fields, slivers of old starlight cling to them like burrs. Six shards, $N, and I can date the sealing to the very season it was sung.',
    completionText:
      'Look at the striations! Autumn. The Hollow was sealed in autumn. Two hundred years of argument, settled by six little stones.',
    objectives: [{ type: 'collect', itemId: 'starfall_shard', count: 6, label: 'Starfall Shard' }],
    xpReward: 4000,
    copperReward: 1900,
    itemRewards: {},
    requiresQuest: 'q_monument_tour',
    minLevel: 16,
  },
  q_spore_tide: {
    id: 'q_spore_tide',
    name: 'Against the Spore Tide',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The salve holds the Grove, but the corruption presses harder at the Deep with every dusk. Twelve more of the corrupted must be laid to rest before the gatherers can reclaim their north rings, $N.',
    completionText: 'The rings in the north are singing again tonight. Quietly, but singing.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'corrupted_sporeling',
        count: 12,
        label: 'Corrupted Sporeling laid to rest',
      },
    ],
    xpReward: 4400,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_spore_hearts',
    minLevel: 17,
  },
  q_wardens_echoes: {
    id: 'q_wardens_echoes',
    name: 'Echoes of the Warden',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'Even with their master silenced, the court guardians repeat its last command like an echo that will not fade. Until the seal is set back, they will keep waking, $N. Still ten more of them so the masons can reach the sealstone.',
    completionText:
      'The echo grows fainter each time. Soon the court will hold nothing but wind and ivy, the way a ruin should.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ancient_guardian',
        count: 10,
        label: 'Ancient Guardian stilled',
      },
    ],
    xpReward: 5200,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_sunken_court',
    minLevel: 18,
  },
  // --- the huntsman's chain: the Hollow's two wandering rare bosses ---
  q_hollow_the_huntsman: {
    id: 'q_hollow_the_huntsman',
    name: 'The Warden of the Herds',
    giverNpcId: 'provisioner_fenna',
    turnInNpcId: 'huntsman_deral',
    text: 'You look like someone who can handle more than wisps, $N. Huntsman Deral keeps his lookout among the stag meadows east of here, and he has been asking after capable hands for weeks. Whatever he is tracking out there, he will not say it aloud in the village.',
    completionText:
      'Fenna sent you? Good. Then she trusts you, and I have two names that need crossing out.',
    objectives: [
      { type: 'interact', targetNpcId: 'huntsman_deral', count: 1, label: 'Find Huntsman Deral' },
    ],
    xpReward: 2400,
    copperReward: 900,
    itemRewards: {},
    minLevel: 16,
  },
  q_hollow_old_marrowshell: {
    id: 'q_hollow_old_marrowshell',
    name: 'The Old Shell of the Shallows',
    giverNpcId: 'huntsman_deral',
    turnInNpcId: 'huntsman_deral',
    text: 'The first name is Old Marrowshell, a crab the size of a cart that has hunted the eastern shallows since before Eldergleam had a gate. It wanders, $N, so you will have to walk the shoreline until you cross its track. Do not go alone, and do not trust its stillness.',
    completionText:
      'The shallows are just water again. I have watched that shell break better hunters than me, $N. Not you.',
    objectives: [
      { type: 'kill', targetMobId: 'old_marrowshell', count: 1, label: 'Old Marrowshell slain' },
    ],
    xpReward: 5600,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_hollow_the_huntsman',
    minLevel: 17,
    suggestedPlayers: 2,
  },
  q_hollow_first_of_the_herd: {
    id: 'q_hollow_first_of_the_herd',
    name: 'First of the Herd',
    giverNpcId: 'huntsman_deral',
    turnInNpcId: 'huntsman_deral',
    text: 'The second name is harder to say. Aurelhorn led these herds when my grandmother kept this lookout, and whatever woke in the Hollow woke him wrong. He tramples what he once warded, and the herd will not survive his madness. He roams the meadows near the old court roads. End him with mercy, $N, and bring a friend to share the weight of it.',
    completionText:
      'So the First falls to the last. The herd is already calmer, do you feel it? You did the Hollow a kindness today, even if it does not look like one.',
    objectives: [
      { type: 'kill', targetMobId: 'aurelhorn', count: 1, label: 'Aurelhorn given peace' },
    ],
    xpReward: 6000,
    copperReward: 3400,
    itemRewards: {},
    requiresQuest: 'q_hollow_old_marrowshell',
    minLevel: 18,
    suggestedPlayers: 2,
  },
};

export const REALM_QUEST_ORDER: string[] = [
  'q_veil_thinned',
  'q_gleaming_antlers',
  'q_wisp_lights',
  'q_calming_the_deep',
  'q_spore_hearts',
  'q_monument_tour',
  'q_grove_menace',
  'q_shards_of_starfall',
  'q_treant_accord',
  'q_spore_tide',
  'q_sunken_court',
  'q_wardens_echoes',
  'q_hollow_the_huntsman',
  'q_hollow_old_marrowshell',
  'q_waking_warden',
  'q_hollow_first_of_the_herd',
  'q_seal_restored',
];

// ---------------------------------------------------------------------------
// Spawns. Appended LAST in data.ts CAMPS to keep existing rng draws stable.
// ---------------------------------------------------------------------------

export const REALM_CAMPS: CampDef[] = [
  { mobId: 'glimmerwisp', center: { x: 76, z: 1014 }, radius: 12, count: 4 },
  { mobId: 'glimmerwisp', center: { x: 60, z: 1150 }, radius: 14, count: 4 },
  { mobId: 'duskwisp', center: { x: 126, z: 1120 }, radius: 12, count: 4 },
  { mobId: 'duskwisp', center: { x: -30, z: 1200 }, radius: 14, count: 4 },
  { mobId: 'veiled_stag', center: { x: 12, z: 1118 }, radius: 16, count: 6 },
  // the does graze among the stags, closest to the heart of the glade
  { mobId: 'veiled_doe', center: { x: 8, z: 1124 }, radius: 12, count: 3 },
  { mobId: 'veiled_doe', center: { x: 18, z: 1112 }, radius: 10, count: 2 },
  { mobId: 'sporeling_gatherer', center: { x: -95, z: 1180 }, radius: 14, count: 5 },
  { mobId: 'corrupted_sporeling', center: { x: -25, z: 1218 }, radius: 14, count: 6 },
  { mobId: 'corrupted_sporeling', center: { x: -60, z: 1226 }, radius: 12, count: 5 },
  { mobId: 'treant_elder', center: { x: 25, z: 948 }, radius: 14, count: 3 },
  { mobId: 'ancient_guardian', center: { x: 125, z: 1085 }, radius: 16, count: 5 },
  { mobId: 'ancient_guardian', center: { x: 138, z: 1070 }, radius: 10, count: 3 },
  { mobId: 'waking_warden', center: { x: 125, z: 1085 }, radius: 3, count: 1 },
  // the rare glowing stag, deep in the hidden western clearing (no POI)
  { mobId: 'gleamstag', center: { x: -145, z: 1100 }, radius: 4, count: 1 },
  // wandering bosses (rare elites, long respawns, appended last for rng order)
  { mobId: 'old_marrowshell', center: { x: 103, z: 1144 }, radius: 5, count: 1 },
  { mobId: 'aurelhorn', center: { x: 22, z: 1110 }, radius: 6, count: 1 },
  // the Gleamfolk going about their village (appended last for rng order)
  { mobId: 'mushroom_pixie', center: { x: -95, z: 1186 }, radius: 16, count: 5 },
];

// ---------------------------------------------------------------------------
// Ground objects: the sealstone finale and the three monument stones.
// ---------------------------------------------------------------------------

export const REALM_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'hollow_sealstone',
    name: 'The Hollow Sealstone',
    positions: [{ x: 125, z: 1085 }],
  },
  {
    itemId: 'monument_overlook',
    name: 'Weathered Monument',
    positions: [{ x: -118, z: 990 }],
  },
  {
    itemId: 'monument_court',
    name: 'Sunken Monument',
    positions: [{ x: 112, z: 1096 }],
  },
  {
    itemId: 'monument_north',
    name: 'Forgotten Monument',
    positions: [{ x: 160, z: 1228 }],
  },
];

// ---------------------------------------------------------------------------
// Items: quest pieces, the Calming reward trio, the finale band, the rare
// stag charm, and Wardsmith Orun's armor stock.
// ---------------------------------------------------------------------------

export const REALM_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  duskwisp_essence: {
    id: 'duskwisp_essence',
    name: 'Duskwisp Essence',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veil_thinned',
  },
  spore_heart: {
    id: 'spore_heart',
    name: 'Spore Heart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_spore_hearts',
  },
  gleaming_antler: {
    id: 'gleaming_antler',
    name: 'Gleaming Antler',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_gleaming_antlers',
  },
  wisp_mote: {
    id: 'wisp_mote',
    name: 'Wisp Mote',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_wisp_lights',
  },
  starfall_shard: {
    id: 'starfall_shard',
    name: 'Starfall Shard',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_shards_of_starfall',
  },
  elder_bark: {
    id: 'elder_bark',
    name: 'Elder Bark',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_treant_accord',
  },
  hollow_sealstone: {
    id: 'hollow_sealstone',
    name: 'The Hollow Sealstone',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_seal_restored',
    noVendorSell: true,
    noDiscard: true,
  },
  monument_overlook: {
    id: 'monument_overlook',
    name: 'Weathered Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  monument_court: {
    id: 'monument_court',
    name: 'Sunken Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  monument_north: {
    id: 'monument_north',
    name: 'Forgotten Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  // --- drops ---
  guardian_core: {
    id: 'guardian_core',
    name: 'Guardian Core',
    kind: 'junk',
    sellValue: 180,
  },
  wardens_seal: {
    id: 'wardens_seal',
    name: "The Warden's Seal",
    kind: 'quest',
    sellValue: 0,
    noVendorSell: true,
  },
  gleamstag_charm: {
    id: 'gleamstag_charm',
    name: 'Gleamstag Charm',
    kind: 'junk',
    quality: 'rare',
    sellValue: 2500,
  },
  // --- Calming the Deep rewards (archetype trio) ---
  veilsteel_blade: {
    id: 'veilsteel_blade',
    name: 'Veilsteel Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 20, max: 32, speed: 2.4 },
    stats: { str: 6, sta: 3 },
    sellValue: 950,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  duskfang_dirk: {
    id: 'duskfang_dirk',
    name: 'Duskfang Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 13, max: 21, speed: 1.7, dagger: true },
    stats: { agi: 6, sta: 2 },
    sellValue: 950,
    requiredClass: ['rogue', 'hunter'],
  },
  gleamwood_stave: {
    id: 'gleamwood_stave',
    name: 'Gleamwood Stave',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 22, max: 35, speed: 2.9 },
    stats: { int: 7, sta: 2 },
    sellValue: 950,
    // Every staff carries the full caster proficiency group (shaman and paladin
    // included), the rule tests/equipment_proficiency.test.ts pins.
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
  // --- finale reward ---
  wardens_oathband: {
    id: 'wardens_oathband',
    name: "Warden's Oathband",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 40, sta: 5, spi: 4 },
    sellValue: 1800,
  },
  // --- Wardsmith Orun's stock ---
  wardplate_cuirass: {
    id: 'wardplate_cuirass',
    name: 'Wardplate Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 190, str: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
  nightweave_tunic: {
    id: 'nightweave_tunic',
    name: 'Nightweave Tunic',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 120, agi: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
  veilcloth_robe: {
    id: 'veilcloth_robe',
    name: 'Veilcloth Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 70, int: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
};

export const REALM_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // The two cave mouths of the Duskfall passage: the concealed entrance in
  // the Thornpeak cliffs and its twin on the realm's southern wall. The mine
  // arch faces its rot direction; the portal trigger sits just outside each.
  mines: [
    { x: -140, z: 847, rot: Math.PI }, // Thornpeak side, opening south
    { x: -140, z: 948, rot: 0 }, // realm side, opening north
  ],
  // Eldergleam: the hub town under the great tree (the tree itself is placed
  // by render/realm_flora.ts; these are the built structures around it).
  // The great tree's trunk is solid (colliders.ts); everything else rings it
  // at a respectful distance so the square breathes.
  // r matches the rendered trunk's root flare at ground level (the twisted_1
  // model spans 0.85 native at its base, 5.5yd at the 6.5x town scale), so
  // players collide with the visual bark instead of sinking into it.
  greatTrees: [{ x: -40, z: 1026, r: 5.5 }],
  buildings: [
    // The whole town is the KayKit medieval set in the Hollow's dusk palette
    // (violet roofs, warm timber; render/props.ts maps each kind to its GLB).
    // Layout is radial: everything rings the great tree at (-40,1026), placed
    // in the quiet sectors BETWEEN the four spoke roads, doors facing the
    // tree, well clear of the ring path (r 14) and every spoke corridor.
    { kind: 'hollowInn', x: -59, z: 1033, w: 6, d: 7, rot: 1.92 }, // northwest sector
    { kind: 'hollowHouse', x: -52, z: 1041, w: 7, d: 6, rot: 2.47 },
    { kind: 'hollowHouse', x: -33, z: 1044, w: 7, d: 6, rot: 2.77 }, // northeast sector
    { kind: 'hollowHouse', x: -24, z: 1038, w: 6, d: 6, rot: -2.21 },
    { kind: 'hollowSmith', x: -21, z: 1023, w: 7, d: 6.5, rot: -1.41 }, // southeast sector
    { kind: 'hollowChapel', x: -18, z: 1012, w: 5, d: 7, rot: -0.9 }, // the shrine
    { kind: 'hollowHouse', x: -47, z: 1008, w: 7, d: 6, rot: 0.37 }, // southwest sector
    { kind: 'hollowMarket', x: -54, z: 1010, w: 8, d: 6, rot: 0.72 }, // the Duskfall approach
  ],
  wells: [{ x: -40, z: 1035, r: 1.5 }], // inside the ring, north of the tree
  stalls: [
    // the market stalls nestle close under the tree, facing out at the ring
    { x: -47, z: 1032, rot: -0.87, r: 1.7 }, // Provisioner Fenna
    { x: -33, z: 1032, rot: 0.87, r: 1.7 }, // Wardsmith Orun
  ],
  crates: [
    [-49, 1030],
    [-31, 1030],
  ],
  campfires: [
    [-40, 1008], // town square gathering fire, south of the tree
    [-70, 1005], // wayfarer camp on the Duskfall road
    [32, 958], // Grove Keeper camp
  ],
  tents: [
    { x: 27, z: 953, rot: 0.6, scale: 1 }, // Grove Keeper camp
    { x: 35, z: 952, rot: -0.9, scale: 0.9 },
    { x: 31, z: 962, rot: 2.4, scale: 1.05 },
  ],
  fences: [
    // the magical garden hedge behind the northeast homes, clear of the
    // north and east roads
    { x1: -35, z1: 1052, x2: -30, z2: 1050 },
    { x1: -30, z1: 1050, x2: -26, z2: 1047 },
  ],
  ruinRings: [
    // the Sunken Court: an overgrown temple complex
    { x: 125, z: 1085, ringR: 9, columns: 7 },
    { x: 138, z: 1072, ringR: 6, columns: 5 },
    { x: 112, z: 1098, ringR: 5, columns: 4 },
    // the Duskfall Overlook: a broken vantage ring at the first viewpoint
    { x: -118, z: 988, ringR: 4, columns: 3 },
    // a lone forgotten monument in the far northeast (no POI: a secret)
    { x: 160, z: 1230, ringR: 4, columns: 3 },
  ],
  graveyards: [{ x: -60, z: 1004 }],
  // Hand-placed decor (render/props.ts PROP_ASSET_DEFS). Only the user-made
  // set remains: the pixie mushroom houses and the flora one-offs that the
  // realm_flora scatter already uses (the giant mushroom is the village
  // heart). Collider radii match the model footprints.
  decorProps: [
    // -- the pixie village in the Gleaming Deep: mushroom houses around the
    //    sporeling rings. Scaled 2x from the authored 4yd so they stand at
    //    regular village-house height (8yd); r doubles in lockstep. --
    { key: 'pixieMushroomHouse', x: -108, z: 1168, rot: 0.9, r: 3.4, h: 8, scale: 2 },
    { key: 'pixieMushroomHouse', x: -84, z: 1194, rot: -2.1, r: 3.4, h: 8, scale: 2 },
    { key: 'pixieMushroomHouse', x: -112, z: 1188, rot: 1.9, r: 3.4, h: 8, scale: 2 },
    { key: 'pixieMushroomHouse', x: -78, z: 1162, rot: -0.7, r: 3.4, h: 8, scale: 2 },
    { key: 'pixieMushroomHouse', x: -96, z: 1206, rot: 2.8, r: 3.4, h: 8, scale: 2 },
    // the village heart: the great mushroom (the user's own model, also the
    // Gleaming Deep giants), risen as the pixies' moot hall. Kept taller
    // than the 8yd houses so it stays the village centerpiece.
    { key: 'mushroomGiantPurple', x: -95, z: 1186, rot: 0.8, r: 1.9, h: 10, scale: 10 },
    { key: 'mushroomGlowCluster', x: -104, z: 1174, scale: 2.5 },
    { key: 'flowerGlow', x: -90, z: 1190, scale: 1.6 },
    // -- the Crystalline Shallows: generated crystal formations, a first
    //    amethyst set (more colorways to come); trunk-tight colliders --
    { key: 'crystalAmethystCluster', x: 58, z: 1150, rot: 0.7, r: 2.4, h: 6 },
    { key: 'crystalAmethystCluster', x: 97, z: 1145, rot: 2.3, r: 1.6, h: 4, scale: 0.65 },
    { key: 'crystalAmethystCluster', x: 88, z: 1183, rot: -1.1, r: 2.9, h: 7.5, scale: 1.25 },
    { key: 'crystalAmethystCluster', x: 52, z: 1166, rot: 3.0, r: 1.2, h: 3, scale: 0.5 },
    // the crystal mound: a walk-up cave mouth on the east shore, its mass
    // rising out of the lake water behind it
    { key: 'crystalMoundCave', x: 102, z: 1162, rot: -1.57, r: 5.2, h: 11 },
    // size-scatter around the whole lake: from knee-high shards to towers
    { key: 'crystalAmethystCluster', x: 66, z: 1142, rot: 1.2, r: 1.9, h: 4.8, scale: 0.8 },
    { key: 'crystalAmethystCluster', x: 82, z: 1140, rot: -0.6, r: 3.6, h: 9, scale: 1.5 },
    { key: 'crystalAmethystCluster', x: 104, z: 1152, rot: 2.0, r: 2.2, h: 5.4, scale: 0.9 },
    { key: 'crystalAmethystCluster', x: 95, z: 1178, rot: 0.3, r: 1.3, h: 3.3, scale: 0.55 },
    { key: 'crystalAmethystCluster', x: 50, z: 1186, rot: -2.2, r: 2.9, h: 7.2, scale: 1.2 },
    { key: 'crystalAmethystCluster', x: 48, z: 1176, rot: 1.7, r: 1.0, h: 2.4, scale: 0.4 },
    // -- Starfall Basin: the Star's Cradle on the southern rim (the fallen
    //    star's open face turned toward the road approach) and the stags'
    //    antler shrine on the meadow where the herd grazes --
    { key: 'starHeartCrystal', x: 110, z: 985, rot: -1.6, r: 4.6, h: 5.5 },
    // the C-shaped shrine wall (KayKit dungeon stone), gap west at the causeway.
    // 20 segments span the arc from gap edge to gap edge (step 0.27216 rad,
    // chord 2.17 vs 2.2 wall length), so the runs end flush at both gateposts.
    { key: 'kkWall', x: 103.21, z: 989.22, rot: -1.01, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 104.59, z: 990.89, rot: -0.74, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 106.37, z: 992.13, rot: -0.47, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 108.42, z: 992.84, rot: -0.2, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWallCracked', x: 110.59, z: 992.98, rot: 0.07, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 112.71, z: 992.53, rot: 0.35, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 114.64, z: 991.52, rot: 0.62, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 116.22, z: 990.03, rot: 0.89, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 117.34, z: 988.18, rot: 1.16, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWallCracked', x: 117.93, z: 986.09, rot: 1.43, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 117.93, z: 983.91, rot: 1.71, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 117.34, z: 981.82, rot: 1.98, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 116.22, z: 979.97, rot: 2.25, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 114.64, z: 978.48, rot: 2.52, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 112.71, z: 977.47, rot: 2.8, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWallCracked', x: 110.59, z: 977.02, rot: 3.07, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 108.42, z: 977.16, rot: -2.94, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 106.37, z: 977.87, rot: -2.67, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 104.59, z: 979.11, rot: -2.4, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkWall', x: 103.21, z: 980.78, rot: -2.13, r: 1.1, h: 2.4, scale: 0.55 },
    { key: 'kkPillar', x: 102.7, z: 988.26, rot: -1.15, r: 0.7, h: 3, scale: 0.6 },
    { key: 'kkPillar', x: 102.7, z: 981.74, rot: -1.99, r: 0.7, h: 3, scale: 0.6 },
    { key: 'stagShrine', x: 4, z: 1112, rot: 0.79, r: 2.0, h: 4.2 },
  ],
};
