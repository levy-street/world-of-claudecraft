// The shape of a painted town's layout (sim/painted_towns/): a built-in town
// whose old kit houses were replaced by the painted Tidehold buildings. Types
// only, so the town modules and the barrel share them without a cycle.

import type { makeTownNpc, PlacedTownBuilding, Point2, TownPadStamp } from '../placed_town_kit';
import type { BuildingDef, ZonePropsDef } from '../types';

/** The towns rebuilt through this directory, in the registry's order. */
export type PaintedTownId =
  | 'gullhaven'
  | 'wickharbor'
  | 'hedgewick'
  | 'drifthaven'
  | 'bridgemere'
  | 'icemantle'
  | 'lanternmere'
  | 'moonrest'
  | 'gibbetmere'
  | 'eldershine';

/** A kit building record a layout replaced, exactly as its zone file had it. */
export interface ReplacedKitBuilding {
  readonly kind: BuildingDef['kind'];
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly rot: number;
}

/** A decor row a layout replaced (a hex-kit house, tavern or hall standing as
 *  `decorProps` dressing), exactly as its zone file had it. */
export type ReplacedDecorProp = NonNullable<ZonePropsDef['decorProps']>[number];

/** One NPC stand a layout owns (sim/placed_town_kit.ts makeTownNpc). */
export type TownNpcStand = ReturnType<typeof makeTownNpc>;

/** A level stamp with its falloff and mode set (placed_town_kit.ts levelTownPads). */
export type TownPad = TownPadStamp & { readonly falloff: 'smooth'; readonly mode: 'level' };

export interface PaintedTownLayout {
  readonly id: PaintedTownId;
  /** The frozen layout's version id, carried on the town view's root. */
  readonly layoutId: string;
  /** The zone the town stands in (every building's position is inside it). */
  readonly zoneId: string;
  /** The town circle the view culls and reveals by (the zone's hub). */
  readonly hub: { readonly center: Point2; readonly radius: number };
  readonly buildings: readonly PlacedTownBuilding[];
  /** The kit records this layout replaced, exactly as the zone file had them:
   *  Studio lifts their old conversions out of documents saved before. */
  readonly replacedKitBuildings: readonly ReplacedKitBuilding[];
  /** The hex-kit buildings standing as decor rows that this layout replaced,
   *  exactly as the zone file had them (Studio lifts their conversions too). */
  readonly replacedDecorProps: readonly ReplacedDecorProp[];
  /** Level ground under the buildings, appended to the built-in world's
   *  terrain edits after every other town's. */
  readonly pads: readonly TownPad[];
  /** The NPC stands the layout moved or owns (doors, counters). */
  readonly npcs: readonly TownNpcStand[];
}
