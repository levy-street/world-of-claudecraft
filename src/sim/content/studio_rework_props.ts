// The Studio town rework's edits to the shipped props tables (the Eastbrook and
// Mirefen changes map, #4593): native scenery records the map removed or moved.
// Records are matched by table and anchor (x, z; a fence by its midpoint), so an
// edit whose record is gone or moved later matches nothing and is inert;
// tests/studio_rework_props.test.ts pins that every edit still matches.
// Pure data plus one pure function; data.ts applies it to the merged PROPS.
import type { ZonePropsDef } from '../types';

type PropTable = Exclude<keyof ZonePropsDef, 'raceCourse'>;

export interface StudioPropEdit {
  table: PropTable;
  /** The record's anchor: its (x, z), a tuple record's [x, z], a fence's midpoint. */
  at: { x: number; z: number };
  remove?: true;
  /** New anchor, and the yaw added to the record's own rotation (radians). */
  to?: { x: number; z: number; turn: number };
  /** The terrain keeps the calm pad the shipped record had (terrain_calm_anchors.ts reads
   *  GROUND_PROPS): set on the edits round the Wickharbor harbor and ferry wharf, whose
   *  models were built in Blender on the ground those pads shaped. */
  keepGround?: true;
}

export const STUDIO_REWORK_PROP_EDITS: readonly StudioPropEdit[] = [
  { table: 'buildings', at: { x: -440, z: 900 }, remove: true },
  { table: 'buildings', at: { x: -410, z: 1130 }, remove: true },
  { table: 'buildings', at: { x: -380, z: 795 }, remove: true },
  { table: 'buildings', at: { x: -370, z: 1045 }, remove: true },
  { table: 'buildings', at: { x: -280, z: 1055 }, remove: true },
  { table: 'buildings', at: { x: 352, z: 598 }, remove: true },
  { table: 'campfires', at: { x: -360, z: 2068 }, to: { x: -347.885, z: 2063.675, turn: 0 } },
  { table: 'campfires', at: { x: -355.5, z: 351.5 }, remove: true },
  { table: 'campfires', at: { x: -334, z: -10 }, to: { x: -334.919, z: -5.606, turn: 0 } },
  { table: 'campfires', at: { x: -83, z: 1746 }, to: { x: -79.17, z: 1737.283, turn: 0 } },
  { table: 'campfires', at: { x: -61, z: 56 }, to: { x: -81.645, z: 64.049, turn: 0 } },
  { table: 'campfires', at: { x: -30, z: 1560 }, to: { x: -43.156, z: 1567.501, turn: 0 } },
  { table: 'campfires', at: { x: -28, z: 1564 }, to: { x: -23.524, z: 1582.564, turn: 0 } },
  { table: 'campfires', at: { x: 2, z: 658 }, remove: true },
  { table: 'campfires', at: { x: 304, z: 66 }, to: { x: 300.315, z: 59.439, turn: 0 } },
  { table: 'campfires', at: { x: 324, z: 798 }, remove: true },
  { table: 'campfires', at: { x: 388, z: 716 }, to: { x: 383.237, z: 740.002, turn: 0 } },
  { table: 'campfires', at: { x: 432, z: 361 }, remove: true, keepGround: true },
  { table: 'campfires', at: { x: 455, z: 363 }, remove: true, keepGround: true },
  { table: 'crates', at: { x: -372.5, z: 351.5 }, remove: true },
  { table: 'crates', at: { x: -302, z: 816 }, to: { x: -288.047, z: 813.885, turn: 0 } },
  { table: 'crates', at: { x: -284, z: 1057 }, remove: true },
  { table: 'crates', at: { x: -49, z: 1030 }, remove: true },
  { table: 'crates', at: { x: -38, z: 1558 }, remove: true },
  { table: 'crates', at: { x: -33, z: 1565 }, remove: true },
  { table: 'crates', at: { x: -27, z: 1558 }, remove: true },
  { table: 'crates', at: { x: 290, z: 72 }, remove: true },
  { table: 'crates', at: { x: 294, z: 68 }, to: { x: 288.579, z: 59.53, turn: 0 } },
  { table: 'crates', at: { x: 300, z: 808 }, remove: true },
  { table: 'crates', at: { x: 308, z: 60 }, remove: true },
  { table: 'crates', at: { x: 357, z: 627 }, remove: true },
  { table: 'crates', at: { x: 441, z: 359 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: -448, z: 452 }, remove: true },
  { table: 'decorProps', at: { x: -428, z: 417 }, remove: true },
  { table: 'decorProps', at: { x: -392, z: 232 }, remove: true },
  { table: 'decorProps', at: { x: -392, z: 266 }, remove: true },
  { table: 'decorProps', at: { x: -390.8, z: 214.3 }, remove: true },
  { table: 'decorProps', at: { x: -390, z: 560 }, remove: true },
  { table: 'decorProps', at: { x: -388, z: 608 }, remove: true },
  { table: 'decorProps', at: { x: -383, z: 587 }, remove: true },
  { table: 'decorProps', at: { x: -382, z: 296 }, remove: true },
  { table: 'decorProps', at: { x: -374.4, z: 200.9 }, remove: true },
  { table: 'decorProps', at: { x: -372.3, z: 222 }, remove: true },
  { table: 'decorProps', at: { x: -268, z: 434 }, remove: true },
  { table: 'decorProps', at: { x: -258, z: 473 }, remove: true },
  { table: 'decorProps', at: { x: -100, z: -33 }, to: { x: -116.72, z: -32.11, turn: 0 } },
  { table: 'decorProps', at: { x: -95.8, z: -62 }, to: { x: -96.978, z: -70.754, turn: 0 } },
  // The two Eastbrook start crates keep their shipped x: the map's half-yard
  // nudge east put them across the sight line north of the player start.
  { table: 'decorProps', at: { x: -95.5, z: -46.2 }, to: { x: -95.5, z: -45.478, turn: 0 } },
  { table: 'decorProps', at: { x: -95.5, z: -44 }, to: { x: -95.5, z: -42.27, turn: 0 } },
  { table: 'decorProps', at: { x: -95.4, z: -64 }, to: { x: -98.623, z: -70.976, turn: 0 } },
  { table: 'decorProps', at: { x: -89, z: -41 }, to: { x: -97.366, z: 1.488, turn: -1.4525 } },
  { table: 'decorProps', at: { x: -87.5, z: -44.5 }, to: { x: -99.863, z: -41.927, turn: 0 } },
  { table: 'decorProps', at: { x: 201, z: 417 }, remove: true },
  { table: 'decorProps', at: { x: 204, z: 404 }, remove: true },
  { table: 'decorProps', at: { x: 208, z: 411 }, remove: true },
  { table: 'decorProps', at: { x: 212, z: 417 }, remove: true },
  { table: 'decorProps', at: { x: 214, z: 399 }, remove: true },
  { table: 'decorProps', at: { x: 216, z: 412 }, remove: true },
  { table: 'decorProps', at: { x: 217, z: 405 }, remove: true },
  { table: 'decorProps', at: { x: 220, z: 416 }, remove: true },
  { table: 'decorProps', at: { x: 243, z: 256 }, remove: true },
  { table: 'decorProps', at: { x: 245, z: 245 }, remove: true },
  { table: 'decorProps', at: { x: 246.5, z: 906 }, remove: true },
  { table: 'decorProps', at: { x: 249, z: 252 }, remove: true },
  { table: 'decorProps', at: { x: 250, z: 884 }, remove: true },
  { table: 'decorProps', at: { x: 254, z: 259 }, remove: true },
  { table: 'decorProps', at: { x: 256, z: 242 }, remove: true },
  { table: 'decorProps', at: { x: 258, z: 878 }, remove: true },
  { table: 'decorProps', at: { x: 259, z: 246 }, remove: true },
  { table: 'decorProps', at: { x: 259, z: 253 }, remove: true },
  { table: 'decorProps', at: { x: 263, z: 258 }, remove: true },
  { table: 'decorProps', at: { x: 268, z: 915 }, remove: true },
  { table: 'decorProps', at: { x: 270.5, z: 878 }, remove: true },
  { table: 'decorProps', at: { x: 276.5, z: 909 }, remove: true },
  { table: 'decorProps', at: { x: 283, z: 908.5 }, remove: true },
  { table: 'decorProps', at: { x: 293, z: 531 }, remove: true },
  { table: 'decorProps', at: { x: 296, z: 784 }, to: { x: 298, z: 800, turn: -1.5708 } },
  { table: 'decorProps', at: { x: 297, z: 527 }, remove: true },
  { table: 'decorProps', at: { x: 299, z: 536 }, remove: true },
  { table: 'decorProps', at: { x: 305, z: 529 }, remove: true },
  { table: 'decorProps', at: { x: 306, z: 860 }, remove: true },
  { table: 'decorProps', at: { x: 309, z: 533 }, remove: true },
  { table: 'decorProps', at: { x: 314, z: 798 }, to: { x: 313.959, z: 798.332, turn: 0 } },
  { table: 'decorProps', at: { x: 317, z: 598 }, remove: true },
  { table: 'decorProps', at: { x: 336.8, z: 878 }, remove: true },
  { table: 'decorProps', at: { x: 346, z: 620 }, remove: true },
  { table: 'decorProps', at: { x: 352, z: 655 }, remove: true },
  { table: 'decorProps', at: { x: 356, z: 673 }, remove: true },
  { table: 'decorProps', at: { x: 358, z: 656 }, remove: true },
  { table: 'decorProps', at: { x: 361, z: 660 }, remove: true },
  { table: 'decorProps', at: { x: 361, z: 667 }, remove: true },
  { table: 'decorProps', at: { x: 365, z: 672 }, remove: true },
  { table: 'decorProps', at: { x: 365.4, z: 742.6 }, remove: true },
  { table: 'decorProps', at: { x: 370, z: 743.5 }, to: { x: 372.097, z: 743.398, turn: 0 } },
  { table: 'decorProps', at: { x: 374, z: 591.5 }, to: { x: 374.809, z: 596.641, turn: 2.3736 } },
  { table: 'decorProps', at: { x: 377.5, z: 1862.5 }, remove: true },
  { table: 'decorProps', at: { x: 379, z: 1861 }, remove: true },
  { table: 'decorProps', at: { x: 379, z: 1864 }, remove: true },
  { table: 'decorProps', at: { x: 380, z: 634 }, remove: true },
  { table: 'decorProps', at: { x: 380, z: 1867 }, remove: true },
  { table: 'decorProps', at: { x: 388, z: 1861 }, remove: true },
  { table: 'decorProps', at: { x: 388.5, z: 1864 }, remove: true },
  { table: 'decorProps', at: { x: 389.5, z: 1862.5 }, remove: true },
  { table: 'decorProps', at: { x: 394, z: 620 }, remove: true },
  { table: 'decorProps', at: { x: 402, z: 720 }, remove: true },
  { table: 'decorProps', at: { x: 404, z: 612 }, remove: true },
  { table: 'decorProps', at: { x: 409, z: 618 }, remove: true },
  { table: 'decorProps', at: { x: 416.6, z: 751.4 }, remove: true },
  { table: 'decorProps', at: { x: 437.3, z: 755 }, remove: true },
  { table: 'decorProps', at: { x: 438, z: 638 }, remove: true },
  {
    table: 'decorProps',
    at: { x: 443, z: 362 },
    to: { x: 437, z: 372, turn: 0 },
    keepGround: true,
  },
  { table: 'decorProps', at: { x: 446, z: 383 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 446, z: 581 }, remove: true },
  { table: 'decorProps', at: { x: 446, z: 592 }, remove: true },
  {
    table: 'decorProps',
    at: { x: 447, z: 321 },
    to: { x: 419.727, z: 359.623, turn: 0 },
    keepGround: true,
  },
  { table: 'decorProps', at: { x: 447, z: 362 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 448, z: 558 }, remove: true },
  { table: 'decorProps', at: { x: 450, z: 576 }, remove: true },
  { table: 'decorProps', at: { x: 452, z: 938 }, remove: true },
  { table: 'decorProps', at: { x: 453, z: 570 }, remove: true },
  { table: 'decorProps', at: { x: 457, z: 362 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 458, z: 606 }, remove: true },
  { table: 'decorProps', at: { x: 460, z: 618 }, remove: true },
  { table: 'decorProps', at: { x: 460, z: 940 }, remove: true },
  { table: 'decorProps', at: { x: 470, z: 310 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 476, z: 634 }, remove: true },
  { table: 'decorProps', at: { x: 477, z: 336 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 486, z: 340 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 492, z: 744 }, remove: true },
  { table: 'decorProps', at: { x: 504, z: 760 }, remove: true },
  { table: 'decorProps', at: { x: 515, z: 305 }, remove: true, keepGround: true },
  { table: 'decorProps', at: { x: 516, z: 750 }, remove: true },
  { table: 'docks', at: { x: -286, z: 838 }, remove: true },
  { table: 'docks', at: { x: -277.3, z: -1.1 }, remove: true },
  { table: 'docks', at: { x: -64, z: 60 }, to: { x: -79.377, z: 72.658, turn: -1.8509 } },
  { table: 'fences', at: { x: -356, z: 330.5 }, to: { x: -353.806, z: 329.719, turn: 0 } },
  { table: 'fences', at: { x: -347, z: 2089 }, remove: true },
  { table: 'fences', at: { x: -58, z: 1552 }, remove: true },
  { table: 'fences', at: { x: -40, z: 1579 }, remove: true },
  { table: 'fences', at: { x: -9, z: 648 }, remove: true },
  { table: 'fences', at: { x: -6, z: 1541 }, remove: true },
  { table: 'fences', at: { x: 9, z: 648 }, remove: true },
  { table: 'fences', at: { x: 195.5, z: 407.5 }, remove: true },
  { table: 'fences', at: { x: 205, z: 396.5 }, remove: true },
  { table: 'fences', at: { x: 240, z: 246.5 }, remove: true },
  { table: 'fences', at: { x: 250, z: 237 }, remove: true },
  { table: 'fences', at: { x: 285, z: 72 }, remove: true },
  { table: 'fences', at: { x: 290.5, z: 92.25 }, remove: true },
  { table: 'fences', at: { x: 298, z: 55 }, remove: true },
  { table: 'fences', at: { x: 316.3, z: 58.3 }, remove: true },
  { table: 'fences', at: { x: 360, z: 1416 }, remove: true },
  { table: 'fences', at: { x: 360, z: 1446 }, remove: true },
  { table: 'fences', at: { x: 442.5, z: 351 }, remove: true },
  { table: 'fences', at: { x: 447, z: 355.5 }, remove: true },
  { table: 'fences', at: { x: 470.5, z: 305 }, remove: true },
  { table: 'fences', at: { x: 475, z: 309 }, remove: true },
  { table: 'graveyards', at: { x: 15, z: 645 }, remove: true },
  { table: 'graveyards', at: { x: 309, z: 793 }, remove: true },
  { table: 'graveyards', at: { x: 392, z: 1408 }, to: { x: 386, z: 1420, turn: 0 } },
  { table: 'mudHuts', at: { x: -316, z: 826 }, remove: true },
  { table: 'mudHuts', at: { x: -289.5, z: 816.5 }, remove: true },
  { table: 'mudHuts', at: { x: -273, z: 1062 }, remove: true },
  { table: 'mudHuts', at: { x: -78, z: 54 }, remove: true },
  { table: 'mudHuts', at: { x: -73, z: 59 }, remove: true },
  { table: 'mudHuts', at: { x: -69, z: 55 }, remove: true },
  { table: 'stalls', at: { x: -370, z: 349.5 }, remove: true },
  { table: 'stalls', at: { x: -366, z: 2080 }, remove: true },
  { table: 'stalls', at: { x: -354, z: 2068 }, remove: true },
  { table: 'stalls', at: { x: -352, z: 314 }, remove: true },
  { table: 'stalls', at: { x: -312, z: 55.6 }, remove: true },
  { table: 'stalls', at: { x: -305, z: 812 }, remove: true },
  { table: 'stalls', at: { x: -296, z: 828 }, remove: true },
  { table: 'stalls', at: { x: -47, z: 1032 }, remove: true },
  { table: 'stalls', at: { x: -36, z: 1566 }, remove: true },
  { table: 'stalls', at: { x: -34, z: 1554 }, remove: true },
  { table: 'stalls', at: { x: -33, z: 1032 }, remove: true },
  { table: 'stalls', at: { x: -25, z: 1568 }, remove: true },
  { table: 'stalls', at: { x: -24, z: 1556 }, remove: true },
  { table: 'stalls', at: { x: -7.5, z: 667 }, remove: true },
  { table: 'stalls', at: { x: -4.5, z: 673.5 }, remove: true },
  { table: 'stalls', at: { x: 300, z: 74 }, remove: true },
  { table: 'stalls', at: { x: 310, z: 68 }, remove: true },
  { table: 'stalls', at: { x: 326, z: 802 }, remove: true },
  { table: 'stalls', at: { x: 356, z: 1426 }, remove: true },
  { table: 'stalls', at: { x: 419, z: 352 }, remove: true },
  { table: 'stalls', at: { x: 452, z: 370 }, remove: true, keepGround: true },
  { table: 'stalls', at: { x: 464, z: 345 }, remove: true, keepGround: true },
  { table: 'tents', at: { x: -506, z: 1039 }, remove: true },
  { table: 'tents', at: { x: -445, z: 1000 }, remove: true },
  { table: 'tents', at: { x: -411, z: 449 }, remove: true },
  { table: 'tents', at: { x: -312, z: 834 }, remove: true },
  { table: 'tents', at: { x: -299, z: 52.5 }, remove: true },
  { table: 'tents', at: { x: -288, z: 826 }, remove: true },
  { table: 'tents', at: { x: -280, z: 1551 }, remove: true },
  { table: 'tents', at: { x: -256, z: 877 }, remove: true },
  { table: 'tents', at: { x: -250, z: 888 }, remove: true },
  { table: 'tents', at: { x: -245, z: 876 }, remove: true },
  { table: 'tents', at: { x: -136, z: 752 }, remove: true },
  { table: 'tents', at: { x: -128, z: 744 }, remove: true },
  { table: 'tents', at: { x: -120, z: 733 }, remove: true },
  { table: 'tents', at: { x: -104.5, z: -81.9 }, remove: true },
  { table: 'tents', at: { x: -80, z: 1742 }, remove: true },
  { table: 'tents', at: { x: -62, z: 783 }, remove: true },
  { table: 'tents', at: { x: -28, z: 494 }, remove: true },
  { table: 'tents', at: { x: -22, z: 486 }, remove: true },
  { table: 'tents', at: { x: -12, z: 1500 }, remove: true },
  { table: 'tents', at: { x: -3, z: 505 }, remove: true },
  { table: 'tents', at: { x: 12, z: 474 }, remove: true },
  { table: 'tents', at: { x: 20, z: 466 }, remove: true },
  { table: 'tents', at: { x: 27, z: 953 }, remove: true },
  { table: 'tents', at: { x: 28, z: 848 }, remove: true },
  { table: 'tents', at: { x: 31, z: 962 }, remove: true },
  { table: 'tents', at: { x: 34, z: 1746 }, remove: true },
  { table: 'tents', at: { x: 35, z: 952 }, remove: true },
  { table: 'tents', at: { x: 50, z: 815 }, remove: true },
  { table: 'tents', at: { x: 58, z: 25 }, remove: true },
  { table: 'tents', at: { x: 58, z: 823 }, remove: true },
  { table: 'tents', at: { x: 60, z: 812 }, remove: true },
  { table: 'tents', at: { x: 68, z: 16 }, remove: true },
  { table: 'tents', at: { x: 113, z: 47 }, remove: true },
  { table: 'tents', at: { x: 119, z: 39 }, remove: true },
  { table: 'tents', at: { x: 292, z: 62 }, remove: true },
  { table: 'tents', at: { x: 300, z: 60 }, remove: true },
  { table: 'tents', at: { x: 314, z: 70 }, remove: true },
  { table: 'tents', at: { x: 365, z: 627 }, remove: true },
  { table: 'tents', at: { x: 375, z: 612 }, remove: true },
  { table: 'tents', at: { x: 497, z: 2097 }, remove: true },
  { table: 'wells', at: { x: -360, z: 2074 }, to: { x: -360.913, z: 2070.926, turn: 0 } },
  { table: 'wells', at: { x: -352.5, z: 348.5 }, remove: true },
  { table: 'wells', at: { x: -40, z: 1035 }, remove: true },
  { table: 'wells', at: { x: -30, z: 1562 }, remove: true },
  { table: 'wells', at: { x: 0, z: 662 }, to: { x: 0.587, z: 659.323, turn: 0 } },
  { table: 'wells', at: { x: 305, z: 71 }, to: { x: 303.766, z: 68.827, turn: 0 } },
  { table: 'wells', at: { x: 324, z: 814 }, to: { x: 321.747, z: 810.12, turn: 0 } },
  { table: 'wells', at: { x: 375, z: 603 }, remove: true },
  { table: 'wells', at: { x: 419, z: 1891 }, remove: true },
  { table: 'wells', at: { x: 427, z: 362 }, remove: true, keepGround: true },
];

const EPS = 1e-6;

/** A record's anchor in the shape its table stores. */
export function propRecordAnchor(record: unknown): { x: number; z: number } | null {
  if (Array.isArray(record)) {
    return typeof record[0] === 'number' && typeof record[1] === 'number'
      ? { x: record[0], z: record[1] }
      : null;
  }
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (typeof r.x1 === 'number' && typeof r.x2 === 'number') {
    return { x: (r.x1 + (r.x2 as number)) / 2, z: ((r.z1 as number) + (r.z2 as number)) / 2 };
  }
  return typeof r.x === 'number' && typeof r.z === 'number' ? { x: r.x, z: r.z as number } : null;
}

function moved(record: unknown, to: { x: number; z: number; turn: number }): unknown {
  if (Array.isArray(record)) return [to.x, to.z, ...record.slice(2)];
  const r = record as Record<string, number>;
  if (typeof r.x1 === 'number') {
    // A fence run: carry both ends rigidly about its midpoint.
    const mx = (r.x1 + r.x2) / 2;
    const mz = (r.z1 + r.z2) / 2;
    const c = Math.cos(to.turn);
    const s = Math.sin(to.turn);
    const end = (x: number, z: number) => ({
      x: to.x + (x - mx) * c + (z - mz) * s,
      z: to.z - (x - mx) * s + (z - mz) * c,
    });
    const a = end(r.x1, r.z1);
    const b = end(r.x2, r.z2);
    return { ...r, x1: a.x, z1: a.z, x2: b.x, z2: b.z };
  }
  const out: Record<string, number> = { ...r, x: to.x, z: to.z };
  if (typeof r.rot === 'number') out.rot = r.rot + to.turn;
  return out;
}

function sameAnchor(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS;
}

/** The edits whose shipped record still shapes the terrain (`keepGround`), left out. */
export function editsReshapingGround(
  edits: readonly StudioPropEdit[] = STUDIO_REWORK_PROP_EDITS,
): StudioPropEdit[] {
  return edits.filter((edit) => !edit.keepGround);
}

/** The props tables with every edit applied. Unmatched edits change nothing. */
export function applyStudioPropEdits(
  props: ZonePropsDef,
  edits: readonly StudioPropEdit[] = STUDIO_REWORK_PROP_EDITS,
): ZonePropsDef {
  const byTable = new Map<PropTable, StudioPropEdit[]>();
  for (const edit of edits) {
    const list = byTable.get(edit.table) ?? [];
    list.push(edit);
    byTable.set(edit.table, list);
  }
  const out = { ...props } as Record<string, unknown>;
  for (const [table, list] of byTable) {
    const records = props[table] as unknown[] | undefined;
    if (!Array.isArray(records)) continue;
    out[table] = records.flatMap((record) => {
      const anchor = propRecordAnchor(record);
      const edit = anchor && list.find((e) => sameAnchor(e.at, anchor));
      if (!edit) return [record];
      if (edit.remove) return [];
      return edit.to ? [moved(record, edit.to)] : [record];
    });
  }
  return out as unknown as ZonePropsDef;
}

/** Edits that match no record in `props` (a stale edit). */
export function unmatchedStudioPropEdits(
  props: ZonePropsDef,
  edits: readonly StudioPropEdit[] = STUDIO_REWORK_PROP_EDITS,
): StudioPropEdit[] {
  return edits.filter((edit) => {
    const records = props[edit.table] as unknown[] | undefined;
    return !(records ?? []).some((record) => {
      const anchor = propRecordAnchor(record);
      return anchor !== null && sameAnchor(edit.at, anchor);
    });
  });
}
