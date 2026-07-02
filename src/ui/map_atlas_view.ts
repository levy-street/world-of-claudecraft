// Pure, host-agnostic model for the WoW-style hierarchical world map.
//
// The in-game map has three levels of "zoom out": the procedural ZONE map
// (map_window_view.ts, unchanged), the painted BREACH region map (the ten
// contested territories ringing the eternal war zone), and the painted WORLD
// map (the whole continent of Valdris). Right-click walks up one level; a
// left-click on a region shape drills back down. The painted levels use the
// maintainer's cartography art (public/map/*.webp) with clickable region
// silhouettes extracted from that art (the same polygons the WOC Interactive
// Map ships, in its 1264x848 source-art pixel space); each shape's `label` is
// the region's pole of inaccessibility, the safest interior point for a tag.
//
// This core is DOM/canvas/i18n-free: it owns the atlas data, the level
// navigation rules, contain-fit projection, polygon hit-testing, and the flat
// draw model (shapes + labels in canvas pixels). The thin canvas consumer is
// map_atlas_painter.ts; Hud orchestrates clicks and level state.

import { ZONES } from '../sim/data';

export type AtlasLevelId = 'world' | 'breach';

/** Which map accent a region shape uses (resolved to --color-map-* tokens). */
export type AtlasAccent = 'kael' | 'veth' | 'ossara' | 'war' | 'landing' | 'contested';

/** What clicking a shape opens. `island` resolves to the player's Landing zone
 *  (the tutorial island is three zone bands sharing one painted region). */
export type AtlasTarget =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'level'; level: AtlasLevelId }
  | { kind: 'island' };

export interface AtlasNode {
  id: string;
  target: AtlasTarget;
  accent: AtlasAccent;
  /** Region silhouette(s) in source-art pixel space (multi-part regions hover
   *  and click as one unit). */
  polys: readonly (readonly (readonly [number, number])[])[];
  /** Label anchor in source-art pixel space. */
  label: readonly [number, number];
}

export interface AtlasLevelDef {
  id: AtlasLevelId;
  /** Painted background art, served from public/. */
  image: string;
  artW: number;
  artH: number;
  /** Hit-test order: earlier nodes win overlaps (the Breach core sits inside
   *  the territory ring, so it is listed first on the breach level). */
  nodes: readonly AtlasNode[];
}

/** The three Landing bands share the world map's tutorial-island shape. */
export const ISLAND_ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;

/** Zones whose "up one level" view is the Breach region map. */
export const BREACH_LEVEL_ZONE_IDS = [
  'the_breach',
  'grey_hollows',
  'thornfen_border',
  'ironpass_crossing',
  'emberveil_marshes',
  'pale_crossing',
  'ashveil_wastes',
  'saltbone_flats',
  'duskwall_ruins',
  'cindral_ridge',
  'redspire_pass',
] as const;

// The Breach core has no silhouette in the extracted set (the territory ring
// tiles the whole art), so it gets a synthetic disc over the crater; listed
// first so it wins the overlap.
const BREACH_CORE_POLY: [number, number][] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  BREACH_CORE_POLY.push([Math.round(632 + Math.cos(a) * 96), Math.round(420 + Math.sin(a) * 92)]);
}

export const MAP_ATLAS: Record<AtlasLevelId, AtlasLevelDef> = {
  world: {
    id: 'world',
    image: '/map/world.webp',
    artW: 1264,
    artH: 848,
    nodes: [
      {
        id: 'kael',
        target: { kind: 'zone', zoneId: 'kael_empire' },
        accent: 'kael',
        label: [816, 208],
        polys: [
          [
            [877, 376.4],
            [862, 366.8],
            [832, 356],
            [781, 347.1],
            [738, 330.7],
            [714, 310],
            [680, 309.3],
            [651, 301],
            [633, 274.5],
            [607, 267],
            [590, 258],
            [563, 253.7],
            [540, 256.4],
            [516, 264.4],
            [487, 289],
            [454, 324.7],
            [420, 317.6],
            [373, 315.4],
            [330, 309.3],
            [257, 291],
            [223.7, 232],
            [215.7, 207],
            [215.3, 186],
            [207.6, 158],
            [207.5, 122],
            [216.3, 80],
            [228.4, 58],
            [238, 48],
            [265, 35.6],
            [286, 37.9],
            [335, 57.1],
            [364, 59.5],
            [383, 54.5],
            [401, 38],
            [435, 31.6],
            [755, 31.5],
            [782, 34],
            [808, 54.5],
            [826, 62.7],
            [890, 82],
            [943, 113.2],
            [961, 118.5],
            [971, 131.8],
            [983, 136.4],
            [997, 151.8],
            [1019, 162.5],
            [1026, 169],
            [1056, 201.2],
            [1064.4, 217],
            [1080, 233.2],
            [1096.6, 258],
            [1107.1, 283],
            [1109.5, 303],
            [1097, 352],
            [1086, 359.1],
            [1062, 363.2],
            [993, 357.5],
            [927, 357.6],
            [887, 368],
            [877, 376.4],
          ],
        ],
      },
      {
        id: 'veth',
        target: { kind: 'zone', zoneId: 'veth_confederation' },
        accent: 'veth',
        label: [332, 581],
        polys: [
          [
            [544, 839.1],
            [532, 838.5],
            [515, 820.4],
            [458, 784],
            [426, 783.3],
            [384, 773.6],
            [352, 773.3],
            [333, 757.7],
            [322, 762.4],
            [257, 810.6],
            [234, 823],
            [208, 822.5],
            [191.1, 806],
            [183.8, 794],
            [173.6, 766],
            [175.3, 714],
            [164, 692],
            [153.7, 655],
            [153.7, 642],
            [159.3, 620],
            [127.9, 542],
            [115.7, 480],
            [127, 467.1],
            [149, 453],
            [176.6, 423],
            [186.7, 405],
            [191.3, 387],
            [188.5, 360],
            [213, 341],
            [221, 325.2],
            [240, 316],
            [242.5, 304],
            [252, 294.5],
            [265, 291.7],
            [354, 313.3],
            [435, 319.7],
            [451, 324.5],
            [456.5, 330],
            [471.3, 376],
            [473.6, 458],
            [484, 490],
            [498.4, 517],
            [519.1, 544],
            [549, 575.9],
            [564.9, 584],
            [569.9, 594],
            [551.7, 668],
            [551.7, 697],
            [573.7, 752],
            [594.5, 780],
            [595.4, 786],
            [582, 807.8],
            [559, 834.9],
            [544, 839.1],
          ],
        ],
      },
      {
        id: 'ossara',
        target: { kind: 'zone', zoneId: 'ossara_domain' },
        accent: 'ossara',
        label: [999, 576],
        polys: [
          [
            [1006, 757.1],
            [969, 757.4],
            [897, 745.5],
            [875, 753.4],
            [809, 739.1],
            [778.5, 723],
            [781.7, 688],
            [808, 615],
            [825, 584],
            [844.3, 532],
            [869.2, 490],
            [879.1, 466],
            [885.5, 437],
            [885.3, 410],
            [879.5, 399],
            [881.2, 384],
            [878.9, 378],
            [882, 372],
            [887, 368],
            [927, 357.6],
            [993, 357.5],
            [1062, 363.2],
            [1093, 357.7],
            [1105, 366],
            [1136, 399.2],
            [1150.2, 423],
            [1157.3, 444],
            [1159.4, 480],
            [1153.6, 507],
            [1151.5, 543],
            [1159.3, 564],
            [1160.2, 583],
            [1153.7, 602],
            [1153.3, 617],
            [1126.6, 665],
            [1067, 737],
            [1040, 749],
            [1028, 749.7],
            [1006, 757.1],
          ],
        ],
      },
      {
        id: 'breach',
        target: { kind: 'level', level: 'breach' },
        accent: 'war',
        label: [690, 484],
        polys: [
          [
            [608, 789],
            [599, 785.8],
            [578.5, 763],
            [551.7, 697],
            [551.7, 668],
            [565.3, 615],
            [568.8, 596],
            [567, 587],
            [551, 578],
            [501, 521.8],
            [476, 470],
            [471.3, 376],
            [455.8, 327],
            [476, 300],
            [516, 264.4],
            [559, 253.6],
            [590, 258],
            [607, 267],
            [633, 274.5],
            [651, 301],
            [680, 309.3],
            [714, 310],
            [734.6, 329],
            [769, 343.1],
            [818, 355.3],
            [832, 356],
            [862, 366.8],
            [880.5, 382],
            [879.7, 399],
            [885.4, 409],
            [885.3, 439],
            [875.1, 478],
            [844.8, 531],
            [825, 584],
            [808, 615],
            [791, 666],
            [783.9, 679],
            [776, 721.8],
            [754.4, 737],
            [717, 756.7],
            [702.8, 760],
            [644, 785.1],
            [608, 789],
          ],
        ],
      },
      {
        id: 'landing',
        target: { kind: 'island' },
        accent: 'landing',
        label: [138, 395],
        polys: [
          [
            [117, 475.3],
            [111, 473.8],
            [82.4, 449],
            [73.9, 432],
            [73.7, 416],
            [78.5, 402],
            [105.1, 357],
            [121, 344],
            [139, 341.7],
            [152, 345.7],
            [182, 363.1],
            [189, 371],
            [191.3, 387],
            [186.2, 406],
            [169.9, 432],
            [148, 453.9],
            [117, 475.3],
          ],
        ],
      },
    ],
  },
  breach: {
    id: 'breach',
    image: '/map/breach.webp',
    artW: 1264,
    artH: 848,
    nodes: [
      // the eternal-war core first: it sits inside the territory ring
      {
        id: 'breach_core',
        target: { kind: 'zone', zoneId: 'the_breach' },
        accent: 'war',
        label: [632, 420],
        polys: [BREACH_CORE_POLY],
      },
      {
        id: 'ashveil',
        target: { kind: 'zone', zoneId: 'ashveil_wastes' },
        accent: 'contested',
        label: [682, 262],
        polys: [
          [
            [741, 590.4],
            [676.9, 565],
            [660, 551.9],
            [589, 539.7],
            [569, 537.6],
            [537, 547.3],
            [524, 545.8],
            [489, 549.5],
            [438, 548.2],
            [431.2, 544],
            [437.9, 520],
            [430.8, 509],
            [421.6, 408],
            [421.4, 377],
            [413.7, 349],
            [405.8, 292],
            [456, 240.2],
            [476, 239.6],
            [540, 246.8],
            [604, 235.7],
            [624, 235.5],
            [712, 245.5],
            [771, 243.7],
            [831.8, 297],
            [837.6, 404],
            [841.7, 441],
            [849.1, 459],
            [850, 475],
            [815.8, 521],
            [803, 560.9],
            [760.9, 578],
            [741, 590.4],
          ],
        ],
      },
      {
        id: 'palecrossing',
        target: { kind: 'zone', zoneId: 'pale_crossing' },
        accent: 'contested',
        label: [272, 156],
        polys: [
          [
            [290, 301.1],
            [212, 292.2],
            [131, 297.4],
            [115, 295],
            [109.8, 290],
            [97, 239],
            [89.7, 221],
            [81.6, 158],
            [81.6, 131],
            [94.8, 85],
            [120, 36.6],
            [138, 12.5],
            [164, 15.4],
            [181, 7.5],
            [214, 7.6],
            [222, 10.8],
            [231, 7.6],
            [258, 7.6],
            [281, 13.5],
            [336, 7.5],
            [410, 7.6],
            [431, 10.5],
            [445.2, 31],
            [451.5, 85],
            [447.5, 155],
            [456.5, 239],
            [404, 291],
            [363, 291.6],
            [290, 301.1],
          ],
        ],
      },
      {
        id: 'ironpass',
        target: { kind: 'zone', zoneId: 'ironpass_crossing' },
        accent: 'contested',
        label: [565, 125],
        polys: [
          [
            [542, 246.3],
            [464, 239.3],
            [456, 232],
            [447.5, 155],
            [451.5, 85],
            [445.5, 28],
            [446.5, 20],
            [453, 13.2],
            [466, 12],
            [480, 23.3],
            [502, 23.5],
            [513, 20.5],
            [531, 7.6],
            [673, 7.5],
            [693, 13.5],
            [721, 7.6],
            [758, 7.5],
            [777, 11.4],
            [799, 9.7],
            [807, 15],
            [823, 15.7],
            [827.8, 19],
            [829.4, 38],
            [825.1, 62],
            [795.9, 145],
            [775.1, 234],
            [770, 241.8],
            [758, 245.4],
            [712, 245.5],
            [607, 235.5],
            [542, 246.3],
          ],
        ],
      },
      {
        id: 'emberveil',
        target: { kind: 'zone', zoneId: 'emberveil_marshes' },
        accent: 'contested',
        label: [944, 151],
        polys: [
          [
            [836, 298],
            [780.1, 251],
            [773.6, 240],
            [795.9, 145],
            [813.1, 102],
            [827.1, 54],
            [829.2, 11],
            [837, 7.5],
            [854, 11.5],
            [882, 9.6],
            [894, 13.5],
            [912, 9.6],
            [922, 13.4],
            [932, 7.7],
            [953, 7.5],
            [977, 15.5],
            [1009, 7.8],
            [1036, 10],
            [1050, 19.7],
            [1066, 25.2],
            [1085, 44.6],
            [1101.8, 80],
            [1141.2, 143],
            [1157.1, 175],
            [1165.3, 206],
            [1165.5, 237],
            [1161, 258],
            [1153.8, 274],
            [1148.1, 279],
            [1130, 285.1],
            [1082, 297.4],
            [904, 287.5],
            [868, 293.4],
            [855, 292.2],
            [836, 298],
          ],
        ],
      },
      {
        id: 'greyhollows',
        target: { kind: 'zone', zoneId: 'grey_hollows' },
        accent: 'contested',
        label: [943, 389],
        polys: [
          [
            [962, 487.1],
            [930, 487.3],
            [856, 475.3],
            [850.5, 471],
            [841.7, 441],
            [835.6, 384],
            [833.5, 308],
            [836, 300.1],
            [855, 292.2],
            [868, 293.4],
            [903, 287.5],
            [1082, 297.4],
            [1146, 279.7],
            [1155, 282],
            [1181.2, 311],
            [1195.1, 339],
            [1199.5, 361],
            [1199.3, 385],
            [1193.1, 410],
            [1185.2, 428],
            [1155, 476.9],
            [1151, 478.8],
            [1064, 467.5],
            [1022, 471.7],
            [962, 487.1],
          ],
        ],
      },
      {
        id: 'cindral',
        target: { kind: 'zone', zoneId: 'cindral_ridge' },
        accent: 'contested',
        label: [1096, 561],
        polys: [
          [
            [1121, 665.2],
            [1096, 653.9],
            [1062, 645.6],
            [1024, 651.4],
            [982, 651.3],
            [966, 642],
            [937, 637],
            [897, 621],
            [888, 614],
            [879, 613],
            [855, 594.5],
            [825.2, 578],
            [807, 559.8],
            [805.7, 550],
            [814.8, 523],
            [841.1, 487],
            [855, 475.6],
            [933, 487.5],
            [961, 487.3],
            [1022, 471.7],
            [1064, 467.5],
            [1150, 478.8],
            [1161, 490.6],
            [1184.7, 536],
            [1185.7, 557],
            [1191.3, 575],
            [1170, 621.8],
            [1150, 643.9],
            [1121, 665.2],
          ],
        ],
      },
      {
        id: 'thornfen',
        target: { kind: 'zone', zoneId: 'thornfen_border' },
        accent: 'contested',
        label: [830, 705],
        polys: [
          [
            [978, 839],
            [941, 835],
            [927, 823.3],
            [907, 817.7],
            [878, 817.3],
            [844, 809.6],
            [795, 811],
            [782, 804.6],
            [747, 776.4],
            [728, 765],
            [721.5, 747],
            [725.4, 710],
            [723.6, 661],
            [737.7, 596],
            [744, 588],
            [792, 564.3],
            [807, 561],
            [826, 578.6],
            [859, 596.4],
            [878, 612.5],
            [888, 614],
            [914.9, 629],
            [937, 637],
            [966, 642],
            [982, 651.3],
            [1001, 652.8],
            [1063, 645.7],
            [1096, 653.9],
            [1119, 666],
            [1121.5, 672],
            [1121.1, 704],
            [1110.2, 736],
            [1091.9, 764],
            [1068, 781.2],
            [1008, 808.4],
            [993.1, 821],
            [986, 834],
            [978, 839],
          ],
        ],
      },
      {
        id: 'duskwall',
        target: { kind: 'zone', zoneId: 'duskwall_ruins' },
        accent: 'contested',
        label: [568, 679],
        polys: [
          [
            [512, 838.3],
            [503, 835.9],
            [486, 817.1],
            [422, 764],
            [423.7, 734],
            [427.4, 726],
            [426.8, 688],
            [431.4, 669],
            [419.2, 641],
            [411.7, 631],
            [413.2, 555],
            [430, 546.8],
            [468, 549.5],
            [536, 547.4],
            [574, 537.6],
            [634, 549.3],
            [654, 549.9],
            [665, 554.4],
            [676.9, 565],
            [736, 589.2],
            [738.1, 593],
            [735.3, 613],
            [723.6, 661],
            [725.4, 710],
            [721.5, 746],
            [725.2, 758],
            [723, 762.9],
            [675, 790.7],
            [611, 807.8],
            [597.1, 819],
            [586, 837],
            [562, 837.3],
            [550, 827.1],
            [538, 837],
            [512, 838.3],
          ],
        ],
      },
      {
        id: 'saltbone',
        target: { kind: 'zone', zoneId: 'saltbone_flats' },
        accent: 'contested',
        label: [218, 679],
        polys: [
          [
            [196, 833.1],
            [173, 829],
            [160, 817.8],
            [142.1, 813],
            [88.8, 732],
            [73.9, 688],
            [59.1, 627],
            [63.4, 608],
            [67.2, 553],
            [73, 548],
            [97, 543.6],
            [146, 543.4],
            [175, 539.5],
            [213, 541.5],
            [251, 533.6],
            [273, 537.5],
            [290, 533.6],
            [324.6, 557],
            [340, 563.3],
            [408, 561.2],
            [411.3, 566],
            [413.5, 584],
            [411.7, 631],
            [419.2, 641],
            [431.4, 669],
            [426.8, 688],
            [427.4, 726],
            [423.7, 734],
            [423.4, 756],
            [420, 763.8],
            [402, 777.2],
            [376, 789.1],
            [356, 793.4],
            [307, 793.9],
            [254, 815.1],
            [231, 816],
            [213, 830.5],
            [196, 833.1],
          ],
        ],
      },
      {
        id: 'redspire',
        target: { kind: 'zone', zoneId: 'redspire_pass' },
        accent: 'contested',
        label: [207, 417],
        polys: [
          [
            [394, 563.1],
            [339, 563.1],
            [320.6, 555],
            [290, 533.6],
            [273, 537.5],
            [251, 533.6],
            [213, 541.5],
            [175, 539.5],
            [146, 543.4],
            [97, 543.6],
            [67, 549],
            [32, 520],
            [27.7, 505],
            [28.8, 487],
            [25, 473],
            [7.7, 453],
            [7.6, 431],
            [11.3, 423],
            [12, 405],
            [55.8, 374],
            [69, 361],
            [88.5, 335],
            [90.5, 318],
            [111, 296],
            [149, 297.5],
            [212, 292.2],
            [286, 301.5],
            [363, 291.6],
            [402, 292],
            [406.5, 296],
            [409.3, 306],
            [413.7, 349],
            [421.3, 376],
            [430.8, 509],
            [437.9, 521],
            [425, 549],
            [394, 563.1],
          ],
        ],
      },
    ],
  },
};

/** The atlas level "one right-click up" from a given zone's map. */
export function atlasParentLevel(zoneId: string): AtlasLevelId {
  return (BREACH_LEVEL_ZONE_IDS as readonly string[]).includes(zoneId) ? 'breach' : 'world';
}

/** The atlas level above `level`, or null at the top (the world map). */
export function atlasLevelUp(level: AtlasLevelId): AtlasLevelId | null {
  return level === 'breach' ? 'world' : null;
}

/** Resolve a shape click to a concrete zone or a deeper atlas level. The island
 *  opens the player's own Landing band when they are on the island, else the
 *  first band (Eastbrook Vale). */
export function resolveAtlasTarget(
  node: AtlasNode,
  playerZoneId: string,
): { kind: 'zone'; zoneId: string } | { kind: 'level'; level: AtlasLevelId } {
  if (node.target.kind === 'island') {
    const onIsland = (ISLAND_ZONE_IDS as readonly string[]).includes(playerZoneId);
    return { kind: 'zone', zoneId: onIsland ? playerZoneId : ISLAND_ZONE_IDS[0] };
  }
  return node.target;
}

/** The shape that represents `zoneId` on `level` (for the "you are here"
 *  highlight): island bands collapse into the landing shape on the world map,
 *  and every breach-ring band collapses into the breach shape there. */
export function atlasNodeForZone(level: AtlasLevelId, zoneId: string): AtlasNode | null {
  for (const node of MAP_ATLAS[level].nodes) {
    if (node.target.kind === 'zone' && node.target.zoneId === zoneId) return node;
    if (node.target.kind === 'island' && (ISLAND_ZONE_IDS as readonly string[]).includes(zoneId))
      return node;
    if (
      node.target.kind === 'level' &&
      node.target.level === 'breach' &&
      (BREACH_LEVEL_ZONE_IDS as readonly string[]).includes(zoneId)
    )
      return node;
  }
  return null;
}

/** Contain-fit of the level art into a canvas (letterboxed, centred). */
export interface AtlasFit {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  scale: number;
}

export function atlasFit(level: AtlasLevelId, canvasW: number, canvasH: number): AtlasFit {
  const { artW, artH } = MAP_ATLAS[level];
  const scale = Math.min(canvasW / artW, canvasH / artH);
  const dw = artW * scale;
  const dh = artH * scale;
  return { dx: (canvasW - dw) / 2, dy: (canvasH - dh) / 2, dw, dh, scale };
}

// Even-odd ray-cast point-in-polygon over one ring.
function inPoly(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The shape under a canvas point, or null (earlier nodes win overlaps). */
export function atlasHitTest(
  level: AtlasLevelId,
  canvasX: number,
  canvasY: number,
  fit: AtlasFit,
): AtlasNode | null {
  const ax = (canvasX - fit.dx) / fit.scale;
  const ay = (canvasY - fit.dy) / fit.scale;
  for (const node of MAP_ATLAS[level].nodes) {
    for (const poly of node.polys) {
      if (inPoly(ax, ay, poly)) return node;
    }
  }
  return null;
}

/** Level band a shape's label advertises, derived from the live zone table so
 *  the atlas can never drift from the sim's ranges. Group shapes span their
 *  member zones. */
export function atlasNodeLevelRange(node: AtlasNode): readonly [number, number] {
  const zoneIds =
    node.target.kind === 'zone'
      ? [node.target.zoneId]
      : node.target.kind === 'island'
        ? [...ISLAND_ZONE_IDS]
        : [...BREACH_LEVEL_ZONE_IDS];
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const zone of ZONES) {
    if (!zoneIds.includes(zone.id)) continue;
    min = Math.min(min, zone.levelRange[0]);
    max = Math.max(max, zone.levelRange[1]);
  }
  return [min === Number.POSITIVE_INFINITY ? 1 : min, max];
}

/** A projected shape ready for the painter to path-fill/stroke. */
export interface AtlasShapeModel {
  nodeId: string;
  accent: AtlasAccent;
  /** Projected rings in canvas pixels. */
  paths: { mx: number; my: number }[][];
  hover: boolean;
  playerHere: boolean;
}

/** A projected label chip: region title + level band. */
export interface AtlasLabelModel {
  nodeId: string;
  /** Zone id to localize for the title, or null for the two group shapes
   *  (island, breach region), which the painter titles via its own deps. */
  zoneId: string | null;
  mx: number;
  my: number;
  min: number;
  max: number;
  playerHere: boolean;
}

export interface AtlasModel {
  level: AtlasLevelId;
  image: string;
  fit: AtlasFit;
  shapes: AtlasShapeModel[];
  labels: AtlasLabelModel[];
}

export interface AtlasModelInput {
  level: AtlasLevelId;
  canvasW: number;
  canvasH: number;
  /** The zone the player stands in (drives the "you are here" highlight). */
  playerZoneId: string;
  hoverNodeId: string | null;
}

/** Build the flat draw model for one painted atlas level. */
export function buildAtlasModel(input: AtlasModelInput): AtlasModel {
  const { level, canvasW, canvasH, playerZoneId, hoverNodeId } = input;
  const def = MAP_ATLAS[level];
  const fit = atlasFit(level, canvasW, canvasH);
  const here = atlasNodeForZone(level, playerZoneId);
  const project = (p: readonly [number, number]): { mx: number; my: number } => ({
    mx: fit.dx + p[0] * fit.scale,
    my: fit.dy + p[1] * fit.scale,
  });

  const shapes: AtlasShapeModel[] = [];
  const labels: AtlasLabelModel[] = [];
  for (const node of def.nodes) {
    const playerHere = here?.id === node.id;
    shapes.push({
      nodeId: node.id,
      accent: node.accent,
      paths: node.polys.map((poly) => poly.map(project)),
      hover: hoverNodeId === node.id,
      playerHere,
    });
    const [min, max] = atlasNodeLevelRange(node);
    const { mx, my } = project(node.label);
    labels.push({
      nodeId: node.id,
      zoneId: node.target.kind === 'zone' ? node.target.zoneId : null,
      mx,
      my,
      min,
      max,
      playerHere,
    });
  }
  return { level, image: def.image, fit, shapes, labels };
}
