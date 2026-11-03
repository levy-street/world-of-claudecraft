// Fixed exploration collectibles. IDs are persisted keys; never rename or reorder.
export const HAUNTED_PUMPKIN_EDITION = '2026';
export const HAUNTED_PUMPKIN_TEMPLATE = 'ground_haunted_pumpkin';
export interface GourdlightPumpkin {
  id: string;
  zoneId: string;
  x: number;
  z: number;
}
export const GOURDLIGHT_PUMPKINS: readonly GourdlightPumpkin[] = [
  { id: 'eastbrook_vale_1', zoneId: 'eastbrook_vale', x: -3, z: -90 }, // Eastbrook (clear of the square's dressing)
  { id: 'eastbrook_vale_2', zoneId: 'eastbrook_vale', x: -10, z: 4 }, // Wolf Run
  { id: 'eastbrook_vale_3', zoneId: 'eastbrook_vale', x: 69, z: -76 }, // Boar Meadow
  { id: 'eastbrook_vale_4', zoneId: 'eastbrook_vale', x: -71, z: -5 }, // Sableweb
  { id: 'eastbrook_vale_5', zoneId: 'eastbrook_vale', x: -21, z: 149 }, // Copper Dig
  { id: 'mirefen_marsh_1', zoneId: 'mirefen_marsh', x: 16, z: 312 }, // Fenbridge (clear of the street dressing)
  { id: 'mirefen_marsh_2', zoneId: 'mirefen_marsh', x: -52, z: 238 }, // Prowler Reeds
  { id: 'mirefen_marsh_3', zoneId: 'mirefen_marsh', x: 89, z: 303 }, // Widow Thicket
  { id: 'mirefen_marsh_4', zoneId: 'mirefen_marsh', x: 89, z: 426 }, // Drowned Chapel
  { id: 'mirefen_marsh_5', zoneId: 'mirefen_marsh', x: -82, z: 447 }, // Troll Mounds
  { id: 'thornpeak_heights_1', zoneId: 'thornpeak_heights', x: 11, z: 669 }, // Highwatch
  { id: 'thornpeak_heights_2', zoneId: 'thornpeak_heights', x: -62, z: 598 }, // Stalker Ridge
  { id: 'thornpeak_heights_3', zoneId: 'thornpeak_heights', x: 94, z: 603 }, // Deeprock Burrows
  { id: 'thornpeak_heights_4', zoneId: 'thornpeak_heights', x: -101, z: 691 }, // Ogre Foothills
  { id: 'thornpeak_heights_5', zoneId: 'thornpeak_heights', x: -117, z: 747 }, // Drogmar's War-Camp
  { id: 'veiled_hollow_1', zoneId: 'veiled_hollow', x: -29, z: 1039 }, // Eldershine
  { id: 'veiled_hollow_2', zoneId: 'veiled_hollow', x: -152, z: 960 }, // Duskfall Cave
  { id: 'veiled_hollow_3', zoneId: 'veiled_hollow', x: -109, z: 976 }, // Duskfall Overlook
  { id: 'veiled_hollow_4', zoneId: 'veiled_hollow', x: 19, z: 946 }, // Elder Grove
  { id: 'veiled_hollow_5', zoneId: 'veiled_hollow', x: 138, z: 1092 }, // The Sunken Court
  { id: 'drakelands_1', zoneId: 'drakelands', x: 415, z: 1909 }, // Wyrmwatch
  { id: 'drakelands_2', zoneId: 'drakelands', x: 348, z: 1948 }, // The Gatewood
  { id: 'drakelands_3', zoneId: 'drakelands', x: 339, z: 2088 }, // Cinder Dunes
  { id: 'drakelands_4', zoneId: 'drakelands', x: 407, z: 2023 }, // Trollmoot
  { id: 'drakelands_5', zoneId: 'drakelands', x: 499, z: 2199 }, // The Last Keep
  { id: 'frostveil_1', zoneId: 'frostveil', x: -19, z: 1566 }, // Icemantle
  { id: 'frostveil_2', zoneId: 'frostveil', x: -22, z: 1503 }, // The Snowline
  { id: 'frostveil_3', zoneId: 'frostveil', x: 39, z: 1728 }, // The Aurora Steps
  { id: 'frostveil_4', zoneId: 'frostveil', x: -101, z: 1751 }, // The Shiverfen
  { id: 'frostveil_5', zoneId: 'frostveil', x: 113, z: 1817 }, // The Howling Terraces
  { id: 'amberfall_1', zoneId: 'amberfall', x: -339, z: 1857 }, // The Goldmelt
  { id: 'amberfall_2', zoneId: 'amberfall', x: -444, z: 1991 }, // The Gilded Orchard
  { id: 'amberfall_3', zoneId: 'amberfall', x: -281, z: 1948 }, // Harvest Hollow
  { id: 'amberfall_4', zoneId: 'amberfall', x: -441, z: 2201 }, // Cindermaple Rise
  { id: 'amberfall_5', zoneId: 'amberfall', x: -263, z: 2237 }, // The Leaning Monolith
  { id: 'willowfen_1', zoneId: 'willowfen', x: -369, z: 217 }, // The Amberfen Steps
  { id: 'willowfen_2', zoneId: 'willowfen', x: -456, z: 316 }, // The Lilymoors
  { id: 'willowfen_3', zoneId: 'willowfen', x: -421, z: 454 }, // Willowweep
  { id: 'willowfen_4', zoneId: 'willowfen', x: -328, z: 490 }, // The Drowsy Flats
  { id: 'nightbloom_1', zoneId: 'nightbloom', x: -359, z: 1429 }, // Moonrest
  { id: 'nightbloom_2', zoneId: 'nightbloom', x: -402, z: 1300 }, // The Nightgate
  { id: 'nightbloom_3', zoneId: 'nightbloom', x: -275, z: 1374 }, // The Moonspring
  { id: 'nightbloom_4', zoneId: 'nightbloom', x: -452, z: 1487 }, // Gloamfield
  { id: 'nightbloom_5', zoneId: 'nightbloom', x: -259, z: 1545 }, // The Standing Vigil
  { id: 'wraithwood_1', zoneId: 'wraithwood', x: 401, z: 1301 }, // The Crowgate
  { id: 'wraithwood_2', zoneId: 'wraithwood', x: 268, z: 1492 }, // Widow's Thicket
  { id: 'wraithwood_3', zoneId: 'wraithwood', x: 449, z: 1518 }, // The Hanging Glade
  { id: 'wraithwood_4', zoneId: 'wraithwood', x: 289, z: 1611 }, // The Mournstone Chapel
  { id: 'wraithwood_5', zoneId: 'wraithwood', x: 393, z: 1687 }, // The Huntsman's Clearing
  { id: 'palmreach_1', zoneId: 'palmreach', x: -289, z: 829 }, // Drifthaven
  { id: 'palmreach_2', zoneId: 'palmreach', x: -432, z: 740 }, // The Tanglemouth
  { id: 'palmreach_3', zoneId: 'palmreach', x: -451, z: 878 }, // The Palmstrand
  { id: 'palmreach_4', zoneId: 'palmreach', x: -371, z: 971 }, // The Emerald Tangle
  { id: 'palmreach_5', zoneId: 'palmreach', x: -387, z: 1087 }, // The Vinefall
  { id: 'evergarden_1', zoneId: 'evergarden', x: 331, z: 819 }, // Hedgewick
  { id: 'evergarden_2', zoneId: 'evergarden', x: 398, z: 740 }, // The Garden Gate
  { id: 'evergarden_3', zoneId: 'evergarden', x: 369, z: 863 }, // The Parterre Walk
  { id: 'evergarden_4', zoneId: 'evergarden', x: 249, z: 880 }, // Dawnhold Castle
  { id: 'evergarden_5', zoneId: 'evergarden', x: 373, z: 953 }, // The Great Maze
  { id: 'galecrest_1', zoneId: 'galecrest', x: 428, z: 366 }, // Wickharbor
  { id: 'galecrest_2', zoneId: 'galecrest', x: 188, z: 448 }, // The Windway
  { id: 'galecrest_3', zoneId: 'galecrest', x: 289, z: 308 }, // The Howling Downs
  { id: 'galecrest_4', zoneId: 'galecrest', x: 487, z: 299 }, // The Old Beacon
  { id: 'galecrest_5', zoneId: 'galecrest', x: 468, z: 542 }, // The Shear
  { id: 'farshore_isle_1', zoneId: 'farshore_isle', x: 316, z: 79 }, // Gullhaven
  { id: 'farshore_isle_2', zoneId: 'farshore_isle', x: 238, z: 22 }, // The Landing
  { id: 'farshore_isle_3', zoneId: 'farshore_isle', x: 384, z: -17 }, // The Watch Meadow
  { id: 'farshore_isle_4', zoneId: 'farshore_isle', x: 391, z: -81 }, // The Sundered Cliffs
  { id: 'farshore_isle_5', zoneId: 'farshore_isle', x: 447, z: 65 }, // The Riftfields
  { id: 'willowfen_5', zoneId: 'willowfen', x: -343, z: 376 }, // Bridgemere outskirts
];
