// Mog's Castle — the royal capital of the realm, a peaceful hub zone added to
// the original overworld just SOUTH of Eastbrook (its own zone band, reached on
// foot through a mountain pass). The largest settlement on the map: a curtain
// wall with corner towers and a gatehouse, the great Keep at the back with King
// Mog on his throne dais, and a full courtyard of services — royal weaponsmith,
// armory, market + World Market broker, provisioner, plus guards. Every
// structure is built from the KayKit Medieval Hexagon Pack (CC0), placed via the
// `castle` prop category (see CastlePieceDef in sim/types.ts).

import type {
  CampDef, CastlePieceDef, GroundObjectDef, ItemDef, MobTemplate, NpcDef,
  QuestDef, ZoneDef, ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

// --- castle geometry -------------------------------------------------------
// Center of the castle grounds and the curtain-wall half-extent.
const CX = 0;
const CZ = -360;
const P = 35; // wall sits at CX±P / CZ±P
const NORTH = CZ + P; // -325 (gate side, faces Eastbrook)
const SOUTH = CZ - P; // -395 (keep side)

// Uniform world scale for the hexagon kit (≈7 world units per native unit), so
// every piece keeps its authored proportions and tiles together as designed.
const S = 7;

// Native bounding-box sizes (x,y,z) of each converted hexagon model, measured
// from public/models/hexagon/*.glb. The renderer scales each model to the
// world w/d/h we derive here; the collider blocks the same footprint.
const NAT: Record<string, [number, number, number]> = {
  hexKeep: [1.98, 3.98, 2.26],
  hexTowerA: [0.99, 2.19, 1.15],
  hexTowerB: [1.20, 2.49, 1.38],
  hexBarracks: [1.44, 1.64, 1.57],
  hexBlacksmith: [1.29, 0.98, 1.25],
  hexMarket: [1.80, 0.98, 1.32],
  hexCathedral: [1.03, 1.65, 1.15],
  hexTavern: [1.17, 1.40, 1.33],
  hexHomeA: [0.79, 0.93, 0.85],
  hexHomeB: [0.87, 1.28, 1.10],
  hexWell: [0.65, 0.83, 0.75],
  hexWindmill: [1.13, 1.46, 0.82],
  hexArchery: [1.67, 1.79, 1.55],
  hexWall: [2.00, 1.10, 0.80],
  hexWallGate: [2.00, 1.41, 0.90],
  hexDais: [1.05, 0.29, 0.87],
  hexFlag: [0.06, 0.28, 0.26],
  hexBarrel: [0.20, 0.21, 0.20],
  hexCrate: [0.21, 0.21, 0.21],
  hexWeaponrack: [0.20, 0.24, 0.13],
  hexTarget: [0.24, 0.30, 0.14],
  hexPavilion: [0.52, 0.52, 0.52],
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A placed hexagon piece, scaled uniformly (S × sMul) from its native size. */
function piece(
  model: keyof typeof NAT, x: number, z: number, rot = 0,
  collide: CastlePieceDef['collide'] = 'obb', sMul = 1, cr?: number,
): CastlePieceDef {
  const [nx, ny, nz] = NAT[model];
  const k = S * sMul;
  return { model, x, z, rot, w: r2(nx * k), d: r2(nz * k), h: r2(ny * k), collide, cr };
}

function buildCastle(): CastlePieceDef[] {
  const out: CastlePieceDef[] = [];
  const seg = [-28, -14, 0, 14, 28]; // 5 wall segments per 70yd side

  // Curtain walls. North wall keeps a gate arch (walkable) at the center.
  for (const sx of seg) {
    if (sx === 0) out.push(piece('hexWallGate', CX + sx, NORTH, 0, 'none'));
    else out.push(piece('hexWall', CX + sx, NORTH, 0, 'obb'));
    out.push(piece('hexWall', CX + sx, SOUTH, 0, 'obb')); // south wall: solid
  }
  for (const sz of seg) {
    out.push(piece('hexWall', CX - P, CZ + sz, Math.PI / 2, 'obb')); // west
    out.push(piece('hexWall', CX + P, CZ + sz, Math.PI / 2, 'obb')); // east
  }

  // Corner towers (tall) + gatehouse turrets flanking the arch.
  for (const sx of [-P, P]) for (const sz of [NORTH, SOUTH]) {
    out.push(piece('hexTowerB', sx, sz, 0, 'circle'));
  }
  out.push(piece('hexTowerA', CX - 11, NORTH + 4, 0, 'circle'));
  out.push(piece('hexTowerA', CX + 11, NORTH + 4, 0, 'circle'));

  // The Keep — the grand centerpiece at the back, slightly oversized, facing
  // the gate. King Mog's throne dais sits in the courtyard before it.
  out.push(piece('hexKeep', CX, SOUTH + 7, 0, 'obb', 1.15));
  out.push(piece('hexDais', CX, CZ - 13, 0, 'none'));

  // Courtyard service buildings (doors turned inward toward the throne).
  out.push(piece('hexBlacksmith', CX - 23, CZ + 15, Math.PI / 2, 'obb')); // Royal Forge
  out.push(piece('hexBarracks', CX + 23, CZ + 15, -Math.PI / 2, 'obb')); // Armory
  out.push(piece('hexMarket', CX - 23, CZ - 2, Math.PI / 2, 'obb')); // Market
  out.push(piece('hexTavern', CX + 23, CZ - 2, -Math.PI / 2, 'obb')); // Tavern
  out.push(piece('hexWell', CX, CZ + 20, 0, 'circle', 1, 2.4)); // courtyard well

  // Outside the gate: the cathedral and a little town along the approach road.
  out.push(piece('hexCathedral', CX - 26, NORTH + 7, 0, 'obb'));
  out.push(piece('hexHomeA', CX + 22, NORTH + 13, 0.3, 'obb'));
  out.push(piece('hexHomeB', CX + 29, NORTH + 22, -0.4, 'obb'));
  out.push(piece('hexHomeB', CX - 31, NORTH + 22, 0.5, 'obb'));
  out.push(piece('hexHomeA', CX + 16, NORTH + 26, 0.1, 'obb'));
  out.push(piece('hexWindmill', CX - 50, CZ + 15, 0.2, 'obb')); // scenic, west
  out.push(piece('hexArchery', CX + 50, CZ, -Math.PI / 2, 'obb')); // training yard, east

  // Banners: corner towers, gate, and a banner-lined avenue up the road.
  for (const sx of [-P + 3, P - 3]) for (const sz of [NORTH - 3, SOUTH + 3]) {
    out.push(piece('hexFlag', sx, sz, 0, 'none', 2));
  }
  out.push(piece('hexFlag', CX - 9, NORTH + 1, 0, 'none', 2));
  out.push(piece('hexFlag', CX + 9, NORTH + 1, 0, 'none', 2));
  for (const az of [NORTH + 18, NORTH + 34]) {
    out.push(piece('hexFlag', CX - 6, az, 0, 'none', 2));
    out.push(piece('hexFlag', CX + 6, az, 0, 'none', 2));
  }

  // Courtyard clutter (small colliders) + the eastern tournament yard.
  out.push(piece('hexBarrel', CX - 29, CZ + 11, 0, 'circle', 1, 0.8));
  out.push(piece('hexCrate', CX - 28, CZ + 18, 0.4, 'circle', 1, 0.9));
  out.push(piece('hexBarrel', CX + 29, CZ - 8, 0, 'circle', 1, 0.8));
  out.push(piece('hexCrate', CX + 28, CZ - 1, 0.7, 'circle', 1, 0.9));
  out.push(piece('hexWeaponrack', CX + 18, CZ + 11, 0.2, 'none'));
  out.push(piece('hexWeaponrack', CX - 18, CZ + 11, -0.2, 'none'));
  out.push(piece('hexPavilion', CX + 44, CZ + 9, 0.2, 'circle', 1.3, 2.2));
  out.push(piece('hexPavilion', CX + 46, CZ - 12, -0.3, 'circle', 1.3, 2.2));
  out.push(piece('hexTarget', CX + 56, CZ + 4, -Math.PI / 2, 'none'));
  out.push(piece('hexTarget', CX + 56, CZ - 4, -Math.PI / 2, 'none'));
  out.push(piece('hexTarget', CX + 56, CZ - 12, -Math.PI / 2, 'none'));

  return out;
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_ZONE: ZoneDef = {
  id: 'mogs_castle',
  name: "Mog's Castle",
  zMin: -540,
  zMax: -180,
  levelRange: [1, 3],
  biome: 'vale',
  hub: { x: CX, z: CZ, radius: 64, name: "Mog's Castle" },
  graveyard: { x: 48, z: -312 },
  lakes: [],
  pois: [
    { x: CX, z: CZ, label: "Mog's Castle" },
    { x: CX, z: NORTH, label: 'Castle Gate' },
    { x: CX, z: SOUTH + 7, label: 'The Keep' },
    { x: CX - 23, z: CZ + 15, label: 'Royal Forge' },
    { x: CX + 23, z: CZ + 15, label: 'Armory' },
    { x: CX + 50, z: CZ, label: 'Tournament Yard' },
  ],
  welcome: "The royal banners of King Mog snap overhead. Seek the King upon his throne within the Keep.",
};

// ---------------------------------------------------------------------------
// NPCs — King Mog, the royal services, and the guard
// ---------------------------------------------------------------------------

const faceCenter = (x: number, z: number) => r2(Math.atan2(CX - x, CZ - z));

export const MOGS_CASTLE_NPCS: Record<string, NpcDef> = {
  king_mog: {
    id: 'king_mog', name: 'King Mog', title: 'Sovereign of the Realm',
    pos: { x: CX, z: CZ - 11 }, facing: 0, color: 0xd4af37,
    questIds: ['q_mog_audience', 'q_mog_bandits', 'q_mog_wolves'],
    greeting: "You stand in the throne room of King Mog, $C. Serve the crown well and the realm will remember your name.",
  },
  royal_weaponsmith: {
    id: 'royal_weaponsmith', name: 'Master Smith Dunmar', title: 'Royal Weaponsmith',
    pos: { x: CX - 15, z: CZ + 15 }, facing: faceCenter(CX - 15, CZ + 15), color: 0x9a7b4f,
    questIds: [],
    vendorItems: ['eastbrook_arming_sword', 'bronzework_mace', 'vale_carving_knife', 'hickory_shortstaff', 'royal_longsword'],
    greeting: 'The crown forges only the finest steel, $C. Arm yourself.',
  },
  royal_armorer: {
    id: 'royal_armorer', name: 'Quartermaster Hollis', title: 'Royal Armorer',
    pos: { x: CX + 15, z: CZ + 15 }, facing: faceCenter(CX + 15, CZ + 15), color: 0x6f7c83,
    questIds: [],
    vendorItems: ['eastbrook_chain_vest', 'valespun_robe', 'tanned_leather_jerkin', 'hobnail_boots', 'eastbrook_wool_trousers', 'royal_guard_plate'],
    greeting: 'Plate, mail, or leather — the armory outfits every soldier of the King.',
  },
  royal_provisioner: {
    id: 'royal_provisioner', name: 'Steward Maelin', title: 'Royal Provisioner',
    pos: { x: CX + 15, z: CZ - 2 }, facing: faceCenter(CX + 15, CZ - 2), color: 0x1e8449,
    questIds: [],
    vendorItems: ['baked_bread', 'spring_water', 'roasted_boar', 'castle_bread', 'kings_reserve_wine'],
    greeting: 'Bread from the royal ovens and wine from the King\'s own cellar. Eat, drink, rest.',
  },
  royal_trader: {
    id: 'royal_trader', name: 'Royal Trader Pim', title: 'Purveyor of Sundries',
    pos: { x: CX - 14, z: CZ - 2 }, facing: faceCenter(CX - 14, CZ - 2), color: 0x2e86c1,
    questIds: [],
    vendorItems: ['baked_bread', 'spring_water', 'tough_jerky', 'castle_bread'],
    greeting: 'Trinkets and travel-fare, all at a fair royal price, $C.',
  },
  market_keeper: {
    id: 'market_keeper', name: 'Market Keeper Vesh', title: 'Keeper of the World Market',
    pos: { x: CX - 9, z: CZ + 4 }, facing: faceCenter(CX - 9, CZ + 4), color: 0xffd24a,
    questIds: [], market: true,
    greeting: 'The World Market reaches even the castle walls, $C — buy from and sell to every adventurer in the realm.',
  },
  guard_gate_w: {
    id: 'guard_gate_w', name: 'Castle Guard', title: "King's Watch",
    pos: { x: CX - 9, z: NORTH - 6 }, facing: 0, color: 0x95a5a6,
    questIds: [],
    greeting: 'The gate is open to honest folk. Mind your manners within these walls.',
  },
  guard_gate_e: {
    id: 'guard_gate_e', name: 'Castle Guard', title: "King's Watch",
    pos: { x: CX + 9, z: NORTH - 6 }, facing: 0, color: 0x95a5a6,
    questIds: [],
    greeting: 'Welcome to the seat of King Mog. Long may he reign.',
  },
  guard_throne_w: {
    id: 'guard_throne_w', name: 'Royal Guard', title: 'Throne Sentinel',
    pos: { x: CX - 6, z: CZ - 7 }, facing: 0, color: 0x85929e,
    questIds: [],
    greeting: 'Stand respectfully before His Majesty.',
  },
  guard_throne_e: {
    id: 'guard_throne_e', name: 'Royal Guard', title: 'Throne Sentinel',
    pos: { x: CX + 6, z: CZ - 7 }, facing: 0, color: 0x85929e,
    questIds: [],
    greeting: 'The King sees all who enter his hall.',
  },
};

// ---------------------------------------------------------------------------
// Items — a few royal additions; vendors otherwise restock Vale staples
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_ITEMS: Record<string, ItemDef> = {
  royal_writ: {
    id: 'royal_writ', name: 'Royal Writ', kind: 'quest', sellValue: 0, questId: 'q_mog_audience',
  },
  castle_bread: {
    id: 'castle_bread', name: 'Castle Loaf', kind: 'food', quality: 'common',
    foodHp: 120, sellValue: 8, buyValue: 60,
  },
  kings_reserve_wine: {
    id: 'kings_reserve_wine', name: "King's Reserve Wine", kind: 'drink', quality: 'common',
    drinkMana: 120, sellValue: 8, buyValue: 60,
  },
  royal_longsword: {
    id: 'royal_longsword', name: 'Royal Guard Longsword', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 7, max: 12, speed: 2.3 }, stats: { str: 2 }, sellValue: 180, buyValue: 1800,
  },
  royal_guard_plate: {
    id: 'royal_guard_plate', name: 'Royal Guard Breastplate', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { sta: 6, armor: 60 }, sellValue: 160, buyValue: 1600,
  },
  // Quest rewards (unrestricted, so every archetype can equip them).
  mogs_royal_tabard: {
    id: 'mogs_royal_tabard', name: "Tabard of Mog's Court", kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { sta: 4, armor: 24 }, sellValue: 75,
  },
  mogs_guard_greaves: {
    id: 'mogs_guard_greaves', name: 'Greaves of the Royal Decree', kind: 'armor', slot: 'legs', quality: 'uncommon',
    stats: { sta: 3, agi: 2, armor: 30 }, sellValue: 80,
  },
  mogs_courier_boots: {
    id: 'mogs_courier_boots', name: "Boots of the King's Courier", kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { agi: 3, armor: 18 }, sellValue: 55,
  },
};

// ---------------------------------------------------------------------------
// Ground objects — the Royal Writ for the intro quest
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_OBJECTS: GroundObjectDef[] = [
  { itemId: 'royal_writ', name: 'Royal Writ', positions: [{ x: CX + 7, z: NORTH - 12 }] },
];

// ---------------------------------------------------------------------------
// Quests — King Mog's royal favors. The fighting happens out in the Vale, so
// the capital itself stays peaceful.
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_QUESTS: Record<string, QuestDef> = {
  q_mog_audience: {
    id: 'q_mog_audience', name: "An Audience with the King",
    giverNpcId: 'king_mog', turnInNpcId: 'king_mog',
    text: "So you would have the crown's favor, $N? My herald let a Royal Writ slip from his hands as he crossed the courtyard. Recover it and bring it before the throne, and we shall talk of greater things.",
    completionText: 'The royal seal, unbroken. You have a careful eye, $N — the realm has need of such people.',
    objectives: [{ type: 'collect', itemId: 'royal_writ', count: 1, label: 'Royal Writ recovered' }],
    xpReward: 300, copperReward: 200,
    itemRewards: { warrior: 'mogs_royal_tabard', rogue: 'mogs_royal_tabard', mage: 'mogs_royal_tabard' },
  },
  q_mog_bandits: {
    id: 'q_mog_bandits', name: 'By Royal Decree',
    giverNpcId: 'king_mog', turnInNpcId: 'king_mog',
    text: "Bandits choke the roads between my castle and Eastbrook to the north, and an unguarded road is an insult to the crown. Ride out, $N, and put ten Vale Bandits to the sword.",
    completionText: 'Ten fewer brigands on my roads. The crown is in your debt, $N.',
    objectives: [{ type: 'kill', targetMobId: 'vale_bandit', count: 10, label: 'Vale Bandit slain' }],
    xpReward: 350, copperReward: 260,
    itemRewards: { warrior: 'mogs_guard_greaves', rogue: 'mogs_guard_greaves', mage: 'mogs_guard_greaves' },
    requiresQuest: 'q_mog_audience',
  },
  q_mog_wolves: {
    id: 'q_mog_wolves', name: "The King's Hunt",
    giverNpcId: 'king_mog', turnInNpcId: 'king_mog',
    text: "Forest wolves harry my couriers on the northern road and the hunt has grown too bold for my outriders alone. Thin the pack, $N — eight Forest Wolves should teach the rest to keep their distance.",
    completionText: 'The roads will be quieter now. Well hunted, $N.',
    objectives: [{ type: 'kill', targetMobId: 'forest_wolf', count: 8, label: 'Forest Wolf slain' }],
    xpReward: 300, copperReward: 220,
    itemRewards: { warrior: 'mogs_courier_boots', rogue: 'mogs_courier_boots', mage: 'mogs_courier_boots' },
    requiresQuest: 'q_mog_audience',
  },
};

export const MOGS_CASTLE_QUEST_ORDER: string[] = [
  'q_mog_audience', 'q_mog_bandits', 'q_mog_wolves',
];

// ---------------------------------------------------------------------------
// Mobs & camps — none: Mog's Castle is a peaceful royal capital.
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_MOBS: Record<string, MobTemplate> = {};
export const MOGS_CASTLE_CAMPS: CampDef[] = [];

// ---------------------------------------------------------------------------
// Roads — the royal approach: south from Eastbrook, through the mountain pass
// at z=-180, up to the castle gate.
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_ROADS: { x: number; z: number }[][] = [
  [
    { x: 0, z: -28 }, { x: 0, z: -90 }, { x: 0, z: -150 }, { x: 0, z: -180 },
    { x: 0, z: -230 }, { x: 0, z: -280 }, { x: 0, z: NORTH + 6 },
  ],
];

// ---------------------------------------------------------------------------
// Props — the castle itself, plus a town well, graveyard and courtyard braziers
// ---------------------------------------------------------------------------

export const MOGS_CASTLE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  graveyards: [{ x: 48, z: -312 }],
  campfires: [[-10, CZ - 6], [10, CZ - 6], [-10, NORTH - 9], [10, NORTH - 9]],
  castle: buildCastle(),
};
