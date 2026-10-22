import type { GrassClearCircle } from '../grass_clear';
import type { ObjectMove } from '../moved_objects';
import type {
  BiomePaint,
  CampDef,
  GroundObjectDef,
  HeightStamp,
  NpcDef,
  PlacedAsset,
  StationDef,
  WorldContent,
  ZonePropsDef,
} from '../types';
import type { LayoutDeck } from './decks';
import type { LayoutPropRemoval } from './props';

export interface SceneryLayout {
  lamps?: WorldContent['sceneryLamps'];
  decks?: LayoutDeck[];
  propRemovals?: LayoutPropRemoval[];
  retainedFences?: ZonePropsDef['fences'];
  ambience?: WorldContent['sceneryAmbience'];
  collisions?: PlacedAsset[];
  additions?: PlacedAsset[];
  decorationExclusions?: string[];
}

export interface LayoutEnvironment {
  terrainEdits?: HeightStamp[];
  grassClear?: GrassClearCircle[];
  biomePaint?: Omit<BiomePaint, 'ids'> & { idsRle: string };
}

export interface BuildingPlacement {
  /** Canonical model path. Changing a building's model requires a content change. */
  path: string;
  x: number;
  z: number;
  rotation: number;
  /** Studio normalized scale (largest model dimension is 2.2 yards). */
  scale: number;
  lift: number;
  /** A detached Studio building has an absolute ground seat. */
  groundY?: number;
}

export type NpcPlacement = Pick<NpcDef, 'pos'> & Partial<Pick<NpcDef, 'facing'>>;
export type CampPlacement = Pick<CampDef, 'center' | 'radius' | 'count'>;

/** A reviewed split/merge of canonical camps with identical gameplay behavior. */
export interface CampEdit {
  /** Exact original identity, independent of array order. */
  sources: Pick<CampDef, 'mobId' | 'center'>[];
  placements: CampPlacement[];
}

export type LayoutRoad = { x: number; z: number }[];
export interface RoadLayout {
  /** Exact canonical geometry is the identity until roads gain authored IDs. */
  edits: { source: LayoutRoad; points: LayoutRoad | null }[];
  additions: { id: string; points: LayoutRoad }[];
}

/** Versioned export contract. Missing records mean "keep current game content". */
export interface WorldLayout {
  civic?: Partial<Record<import('./civic').CivicId, import('./civic').CivicPlacement>>;
  version: 1;
  buildings: Record<string, BuildingPlacement>;
  npcs: Record<string, NpcPlacement>;
  camps: CampEdit[];
  groundObjects: Record<string, Pick<GroundObjectDef, 'positions'>>;
  objectMoves: Record<string, ObjectMove>;
  roads?: RoadLayout;
  /** Only location changes; station identity, craft type and master stay canonical. */
  stations?: Record<string, Pick<StationDef, 'pos' | 'zoneId'>>;
  zoneGraveyards?: Record<string, { x: number; z: number }>;
  graveyards?: Record<string, { x: number; z: number }>;
  environment?: LayoutEnvironment;
  scenery?: SceneryLayout;
}
