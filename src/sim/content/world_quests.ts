import type {
  EscortDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  WorldQuestBeamPuzzleDef,
  WorldQuestDef,
} from '../types';

export const WORLD_QUEST_MIN_LEVEL = 10;

export const EASTBROOK_FREIGHT_CARAVAN_MOB_ID = 'eastbrook_freight_caravan';
export const EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID = 'esc_wq_eastbrook_caravan';
export const WILLOWFEN_REMEDY_CARAVAN_MOB_ID = 'willowfen_remedy_caravan';
export const WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID = 'esc_wq_willowfen_caravan';
export const FROSTVEIL_SUPPLY_CARAVAN_MOB_ID = 'frostveil_supply_caravan';
export const FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID = 'esc_wq_frostveil_caravan';

export const WORLD_QUEST_MOBS: Record<string, MobTemplate> = {
  [EASTBROOK_FREIGHT_CARAVAN_MOB_ID]: {
    id: EASTBROOK_FREIGHT_CARAVAN_MOB_ID,
    name: 'Eastbrook Freight Caravan',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    maxLevel: 20,
    family: 'humanoid',
    hpBase: 650,
    hpPerLevel: 45,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 25,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1,
    color: 0x8b5a2b,
  },
  [WILLOWFEN_REMEDY_CARAVAN_MOB_ID]: {
    id: WILLOWFEN_REMEDY_CARAVAN_MOB_ID,
    name: 'Willowfen Remedy Caravan',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    maxLevel: 20,
    family: 'humanoid',
    hpBase: 650,
    hpPerLevel: 45,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 25,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1,
    color: 0x718957,
  },
  [FROSTVEIL_SUPPLY_CARAVAN_MOB_ID]: {
    id: FROSTVEIL_SUPPLY_CARAVAN_MOB_ID,
    name: 'Frostveil Supply Caravan',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    maxLevel: 20,
    family: 'humanoid',
    hpBase: 650,
    hpPerLevel: 45,
    dmgBase: 1,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 25,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 1,
    color: 0x7a91a6,
  },
};

/** Public-event route from Eastbrook's quay to its market, following the
 * authored quay walk and main street exactly. The existing escort engine owns
 * movement, wave pauses, shared completion credit, death, and respawn. */
export const WORLD_QUEST_ESCORTS: Record<string, EscortDef> = {
  [EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID]: {
    id: EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID,
    npcMobId: EASTBROOK_FREIGHT_CARAVAN_MOB_ID,
    worldQuestId: 'wq_eastbrook_caravan',
    start: { x: -92, z: -32 },
    waypoints: [
      { x: -92, z: -46 },
      { x: -92, z: -56 },
      { x: -88, z: -60 },
      { x: -80, z: -66 },
      { x: -70, z: -68 },
      { x: -62, z: -76 },
      { x: -56, z: -88 },
      { x: -44, z: -98 },
      { x: -26, z: -101 },
      { x: -20, z: -102 },
    ],
    moveSpeed: 4,
    ambushes: [
      { atWaypoint: 2, mobId: 'vale_bandit', count: 3, level: 10, radius: 6 },
      { atWaypoint: 5, mobId: 'vale_bandit', count: 4, level: 10, radius: 7 },
      { atWaypoint: 8, mobId: 'vale_bandit', count: 5, level: 10, radius: 8 },
    ],
    creditRadius: 35,
    respawnSeconds: 30,
    startText: "I'm Tobin. This is my old friend Bram's last delivery. Stay close.",
    successText: 'We made it, Bram. Your toys are home. Thank you for helping me keep my promise.',
    failText: 'The caravan is lost!',
    story: {
      speaker: 'Tobin',
      lineSpacingSeconds: 7,
      ambushText: 'Hands off that chest! Cover the horses!',
      lines: [
        {
          atWaypoint: 0,
          text: 'Bram vanished on the north road. His last letter asked me to bring this chest to the market.',
        },
        {
          atWaypoint: 3,
          text: "The bandits heard 'precious cargo'. Bram never owned anything worth stealing.",
        },
        {
          atWaypoint: 6,
          text: "Inside? Wooden horses and patched dolls. He repaired them for Eastbrook's children.",
        },
      ],
    },
  },
  [WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID]: {
    id: WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID,
    npcMobId: WILLOWFEN_REMEDY_CARAVAN_MOB_ID,
    worldQuestId: 'wq_willowfen_caravan',
    // Willowweep's dry shore, around the western moat, then over the only
    // Fenway crossing. Intermediate points stay on WILLOWFEN_ROADS.
    start: { x: -412, z: 442 },
    waypoints: [
      { x: -414, z: 424 },
      { x: -416, z: 406 },
      { x: -417, z: 384 },
      { x: -418, z: 362 },
      { x: -411, z: 338 },
      { x: -404, z: 314 },
      { x: -393, z: 316 },
      { x: -360, z: 322 },
      { x: -360, z: 338 },
      { x: -360, z: 350 },
    ],
    moveSpeed: 4,
    ambushes: [
      { atWaypoint: 1, mobId: 'bogtoad', count: 3, level: 10, radius: 6 },
      { atWaypoint: 3, mobId: 'willow_sprite', count: 4, level: 10, radius: 7 },
      { atWaypoint: 6, mobId: 'bogtoad', count: 5, level: 10, radius: 6 },
    ],
    creditRadius: 35,
    respawnSeconds: 30,
    startText: "I'm Mira. These remedies must reach Bridgemere. Walk with me?",
    successText:
      'Safe at the bridge. Tonight, someone in Bridgemere will sleep without a fever. Thank you.',
    failText: 'The remedy caravan is lost!',
    story: {
      speaker: 'Mira',
      lineSpacingSeconds: 7,
      ambushText: 'Keep them away from the medicine! I cannot replace those bottles!',
      lines: [
        {
          atWaypoint: 0,
          text: 'Mother Sedge taught me this remedy. The first patient she saved was the bridgewright who called her a witch.',
        },
        {
          atWaypoint: 3,
          text: 'He offered her gold. She asked him to mend the Fenway so nobody would face the marsh alone.',
        },
        {
          atWaypoint: 7,
          text: 'That is why I make this trip. A sound bridge and a little kindness can carry a whole town.',
        },
      ],
    },
  },
  [FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID]: {
    id: FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID,
    npcMobId: FROSTVEIL_SUPPLY_CARAVAN_MOB_ID,
    worldQuestId: 'wq_frostveil_caravan',
    // Icemantle to the Aurora Steps, following FROSTVEIL_ROADS around the
    // Glacier Tarn's western shore instead of cutting across its frozen lake.
    start: { x: -12, z: 1578 },
    waypoints: [
      { x: -5, z: 1585 },
      { x: 10, z: 1600 },
      { x: 26, z: 1613 },
      { x: 42, z: 1626 },
      { x: 35, z: 1644 },
      { x: 28, z: 1662 },
      { x: 34, z: 1681 },
      { x: 40, z: 1700 },
      { x: 35, z: 1720 },
      { x: 30, z: 1740 },
    ],
    moveSpeed: 4,
    ambushes: [
      { atWaypoint: 1, mobId: 'snowdrift_wolf', count: 3, level: 10, radius: 6 },
      { atWaypoint: 5, mobId: 'rime_elemental', count: 4, level: 10, radius: 7 },
      { atWaypoint: 8, mobId: 'terrace_howler', count: 5, level: 10, radius: 8 },
    ],
    creditRadius: 35,
    respawnSeconds: 30,
    startText:
      'Orin, at your service. Blankets and lamp oil for the Aurora Steps. Keep an eye on the snow.',
    successText:
      'Supplies delivered. Keep that lantern burning, friends. Nobody gets left in the snow.',
    failText: 'The supply caravan is lost!',
    story: {
      speaker: 'Orin',
      lineSpacingSeconds: 7,
      ambushText: 'Wolves or worse! Form up by the wagon and protect the horses!',
      lines: [
        {
          atWaypoint: 0,
          text: 'My first winter patrol vanished here in a whiteout. I thought the mountain had swallowed every road.',
        },
        {
          atWaypoint: 3,
          text: 'A lantern appeared through the snow. A young scout had tied herself to a post and come looking for us.',
        },
        {
          atWaypoint: 6,
          text: 'I never learned her name. Every winter I bring oil to the Steps, so the next patrol sees that same light.',
        },
      ],
    },
  },
};

export const FARSHORE_SALVAGE_OBJECT_ITEM_ID = 'wreckfield_flotsam_crate';
export const FARSHORE_SALVAGE_ENTITY_ID_START = 2_147_100_100;

const FARSHORE_SALVAGE_POSITIONS = [
  // Layout 1: the high-tide line north of Gullhaven.
  { x: 277, z: 82 },
  { x: 285, z: 82 },
  { x: 293, z: 82 },
  { x: 301, z: 82 },
  { x: 281, z: 90 },
  { x: 289, z: 90 },
  { x: 297, z: 90 },
  { x: 289, z: 102 },
  // Layout 2: debris washed farther south after a change in current.
  { x: 273, z: 78 },
  { x: 281, z: 78 },
  { x: 289, z: 78 },
  { x: 301, z: 78 },
  { x: 277, z: 86 },
  { x: 285, z: 86 },
  { x: 289, z: 86 },
  { x: 301, z: 86 },
  // Layout 3: a broad scatter along the northern strand.
  { x: 273, z: 90 },
  { x: 281, z: 94 },
  { x: 285, z: 94 },
  { x: 293, z: 94 },
  { x: 301, z: 94 },
  { x: 285, z: 98 },
  { x: 293, z: 98 },
  { x: 297, z: 98 },
] as const;

const FARSHORE_SALVAGE_ENTITY_IDS = FARSHORE_SALVAGE_POSITIONS.map(
  (_, index) => FARSHORE_SALVAGE_ENTITY_ID_START + index,
);

export const FARSHORE_SALVAGE_LAYOUTS: readonly (readonly number[])[] = [
  FARSHORE_SALVAGE_ENTITY_IDS.slice(0, 8),
  FARSHORE_SALVAGE_ENTITY_IDS.slice(8, 16),
  FARSHORE_SALVAGE_ENTITY_IDS.slice(16, 24),
];

export const WORLD_QUEST_ITEMS: Record<string, ItemDef> = {
  eastbrook_freight_crate: {
    id: 'eastbrook_freight_crate',
    name: 'Eastbrook Freight Crate',
    kind: 'quest',
    sellValue: 0,
    questId: 'wq_eastbrook_bandits',
    noVendorSell: true,
    pickupDeny: 'The freight order is not active.',
  },
  eastbrook_freight_wagon: {
    id: 'eastbrook_freight_wagon',
    name: 'Eastbrook Freight Wagon',
    kind: 'quest',
    sellValue: 0,
    questId: 'wq_eastbrook_bandits',
    noVendorSell: true,
    pickupDeny: 'The freight order is not active.',
  },
  leyline_cache: {
    id: 'leyline_cache',
    name: 'Miniature Ley Cache',
    kind: 'quest',
    sellValue: 0,
    questId: 'wq_galecrest_wisps',
    noVendorSell: true,
    pickupDeny: 'The cache is dormant. A ley disturbance may awaken it.',
  },
  confection_game_box: {
    id: 'confection_game_box',
    name: "Confectioner's Game Box",
    kind: 'quest',
    sellValue: 0,
    questId: 'wq_palmreach_confections',
    noVendorSell: true,
    pickupDeny: 'The game box is sealed until its confectionery challenge returns.',
  },
};

export const WORLD_QUEST_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'eastbrook_freight_crate',
    name: 'Eastbrook Freight Crate',
    positions: [{ x: -63, z: -90 }],
    entityIds: [2_147_100_003],
  },
  {
    itemId: 'eastbrook_freight_wagon',
    name: 'Eastbrook Freight Wagon',
    positions: [{ x: -80, z: -82 }],
    entityIds: [2_147_100_004],
  },
  {
    itemId: 'leyline_cache',
    name: 'Miniature Ley Cache',
    positions: [{ x: 420, z: 330 }],
    entityIds: [2_147_100_001],
  },
  {
    itemId: 'confection_game_box',
    name: "Confectioner's Game Box",
    positions: [{ x: -325, z: 820 }],
    entityIds: [2_147_100_002],
  },
  {
    // Reuse the existing flotsam interaction token so these scenery-only
    // props never enter bags or require six fake inventory items. Their stable
    // ids select the bespoke model and personal weekly visibility.
    itemId: FARSHORE_SALVAGE_OBJECT_ITEM_ID,
    name: 'Shipwreck Debris',
    positions: [...FARSHORE_SALVAGE_POSITIONS],
    entityIds: [...FARSHORE_SALVAGE_ENTITY_IDS],
  },
];

const GALECREST_LEY_PUZZLES: readonly WorldQuestBeamPuzzleDef[] = [
  {
    columns: 3,
    rows: 3,
    source: { tileIndex: 3, side: 'west' },
    target: { tileIndex: 2, side: 'east' },
    tiles: [
      { kind: 'corner', initialRotation: 0 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'corner', initialRotation: 2 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 1 },
      { kind: 'straight', initialRotation: 0 },
    ],
  },
  {
    columns: 4,
    rows: 3,
    source: { tileIndex: 4, side: 'west' },
    target: { tileIndex: 3, side: 'east' },
    tiles: [
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'corner', initialRotation: 1 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'corner', initialRotation: 2 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 1 },
      { kind: 'straight', initialRotation: 0 },
    ],
  },
  {
    columns: 4,
    rows: 4,
    source: { tileIndex: 12, side: 'west' },
    target: { tileIndex: 3, side: 'north' },
    tiles: [
      { kind: 'corner', initialRotation: 2 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'corner', initialRotation: 1 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 3 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 1 },
      { kind: 'corner', initialRotation: 2 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'straight', initialRotation: 0 },
      { kind: 'corner', initialRotation: 1 },
      { kind: 'corner', initialRotation: 0 },
      { kind: 'straight', initialRotation: 1 },
    ],
  },
];

const PALMREACH_MATCH3_LEVELS = [
  {
    columns: 6,
    rows: 6,
    board: [
      2, 2, 3, 2, 2, 0, 4, 0, 0, 1, 3, 4, 3, 1, 1, 2, 4, 0, 0, 0, 1, 1, 0, 1, 2, 0, 4, 3, 2, 4, 4,
      4, 3, 0, 1, 1,
    ],
    refill: [
      4, 1, 2, 3, 1, 2, 3, 4, 3, 4, 0, 0, 2, 0, 1, 1, 4, 4, 4, 1, 1, 4, 0, 0, 0, 3, 4, 0, 0, 0, 0,
      3, 4, 1, 2, 4, 1,
    ],
    target: 72,
    maxMoves: 20,
  },
  {
    columns: 6,
    rows: 6,
    board: [
      2, 4, 0, 0, 2, 3, 2, 4, 4, 3, 3, 1, 1, 3, 3, 0, 4, 3, 2, 2, 4, 2, 0, 1, 0, 0, 3, 2, 3, 1, 0,
      1, 4, 3, 4, 2,
    ],
    refill: [
      2, 2, 0, 4, 3, 4, 0, 1, 2, 3, 1, 0, 1, 2, 1, 4, 3, 4, 4, 3, 1, 1, 3, 1, 2, 4, 2, 1, 4, 0, 2,
      2, 1, 1, 1, 3, 2,
    ],
    target: 72,
    maxMoves: 17,
  },
  {
    columns: 6,
    rows: 6,
    board: [
      0, 2, 4, 3, 4, 1, 4, 0, 3, 4, 4, 0, 3, 1, 1, 0, 2, 0, 1, 4, 1, 2, 2, 1, 4, 3, 3, 4, 3, 2, 0,
      1, 3, 3, 2, 0,
    ],
    refill: [
      4, 3, 1, 3, 3, 1, 4, 2, 0, 4, 1, 2, 0, 1, 1, 1, 4, 4, 2, 3, 2, 0, 3, 2, 0, 4, 4, 3, 4, 2, 2,
      2, 3, 3, 3, 1, 1,
    ],
    target: 72,
    maxMoves: 14,
  },
] as const;

/** One rotation candidate in every shipped overworld zone. Areas deliberately
 *  cover the authored targets, so the marker and credit describe the same
 *  physical space in every host. */
export const WORLD_QUESTS: readonly WorldQuestDef[] = [
  {
    id: 'wq_eastbrook_bandits',
    zoneId: 'eastbrook_vale',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -74, z: -82, radius: 20 },
    objective: {
      type: 'delivery',
      pickupObjectItemId: 'eastbrook_freight_crate',
      deliveryObjectItemId: 'eastbrook_freight_wagon',
    },
    count: 6,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_eastbrook_caravan',
    zoneId: 'eastbrook_vale',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    // Marker sits on the waiting caravan at the quay; the radius covers its
    // full road to the market so completion remains area-authoritative.
    area: { x: -92, z: -32, radius: 110 },
    objective: { type: 'escort', escortId: EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID },
    count: 1,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_mirefen_gravecallers',
    zoneId: 'mirefen_marsh',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 0, z: 485, radius: 46 },
    objective: { type: 'kill', targetMobId: 'gravecaller_cultist' },
    count: 6,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_thornpeak_stormcrag',
    zoneId: 'thornpeak_heights',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 122, z: 778, radius: 46 },
    objective: { type: 'kill', targetMobId: 'stormcrag_elemental' },
    count: 6,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_hollow_sporelings',
    zoneId: 'veiled_hollow',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -42, z: 1222, radius: 38 },
    objective: { type: 'kill', targetMobId: 'corrupted_sporeling' },
    count: 5,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_drakelands_brood',
    zoneId: 'drakelands',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 382, z: 2310, radius: 132 },
    objective: { type: 'kill', targetMobId: 'dragonkin_broodguard' },
    count: 5,
    reward: { type: 'item', itemId: 'rift_essence', count: 1 },
  },
  {
    id: 'wq_frostveil_howlers',
    zoneId: 'frostveil',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -85, z: 1760, radius: 20 },
    objective: { type: 'interact', targetObjectItemId: 'sprung_trap' },
    count: 4,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_amberfall_lurkers',
    zoneId: 'amberfall',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -298, z: 2192, radius: 46 },
    objective: { type: 'kill', targetMobId: 'mere_lurker' },
    count: 3,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_willowfen_ore',
    zoneId: 'willowfen',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -370, z: 355, radius: 108 },
    objective: { type: 'gather', nodeType: 'ore' },
    count: 3,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_willowfen_caravan',
    zoneId: 'willowfen',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -412, z: 442, radius: 145 },
    objective: { type: 'escort', escortId: WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID },
    count: 1,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_frostveil_caravan',
    zoneId: 'frostveil',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -12, z: 1578, radius: 190 },
    objective: { type: 'escort', escortId: FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID },
    count: 1,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_nightbloom_barrow',
    zoneId: 'nightbloom',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -354, z: 1648, radius: 48 },
    objective: { type: 'kill', targetMobId: 'barrow_wight' },
    count: 4,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_wraithwood_restless',
    zoneId: 'wraithwood',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 360, z: 1592, radius: 72 },
    objective: { type: 'kill', targetMobId: 'wood_wraith' },
    count: 4,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_palmreach_confections',
    zoneId: 'palmreach',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -325, z: 820, radius: 18 },
    objective: {
      type: 'match3',
      activationObjectItemId: 'confection_game_box',
      levels: PALMREACH_MATCH3_LEVELS,
    },
    count: 72,
    reward: { type: 'item', itemId: 'rift_essence', count: 1 },
  },
  {
    id: 'wq_evergarden_watch',
    zoneId: 'evergarden',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 410, z: 1110, radius: 42 },
    objective: { type: 'kill', targetMobId: 'hedge_knight' },
    count: 3,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_galecrest_wisps',
    zoneId: 'galecrest',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 420, z: 330, radius: 18 },
    objective: {
      type: 'puzzle',
      activationObjectItemId: 'leyline_cache',
      puzzles: GALECREST_LEY_PUZZLES,
    },
    count: 1,
    reward: { type: 'xp', rate: 0.12 },
  },
  {
    id: 'wq_farshore_salvage',
    zoneId: 'farshore_isle',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: 287, z: 89, radius: 24 },
    objective: {
      type: 'salvage',
      objectItemId: FARSHORE_SALVAGE_OBJECT_ITEM_ID,
      layouts: FARSHORE_SALVAGE_LAYOUTS,
    },
    count: 8,
    reward: { type: 'copper', base: 2_500, perLevel: 175 },
  },
  {
    id: 'wq_proving_shore_scuttlers',
    zoneId: 'proving_shore',
    minLevel: WORLD_QUEST_MIN_LEVEL,
    area: { x: -380, z: -43, radius: 20 },
    objective: { type: 'kill', targetMobId: 'shore_scuttler' },
    count: 5,
    reward: { type: 'xp', rate: 0.12 },
  },
];

export const WORLD_QUESTS_BY_ID: Readonly<Record<string, WorldQuestDef>> = Object.fromEntries(
  WORLD_QUESTS.map((quest) => [quest.id, quest]),
);
