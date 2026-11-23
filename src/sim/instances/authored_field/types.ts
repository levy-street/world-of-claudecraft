// Data shape of an authored open-air instance field (G9 in
// docs/design/dungeon-rework/README.md). Plain numbers only: the sim reads it
// for ground height and collision, the renderer reads the SAME record for the
// terrain mesh, the cliff and retaining-wall dressing, the kit placements, and
// the light zones, so what you see is what you stand on.
//
// Coordinates are instance-local yards (the slot origin is 0,0; z forward).

/** How the renderer dresses the drop along a surface's generated cliff edges. */
export type FieldEdgeStyle = 'masonry' | 'rock' | 'balustrade' | 'bone';

/** What a flat surface is paved with (render-only material pick). */
export type FieldGround =
  | 'flagstone'
  | 'earth'
  | 'grave'
  | 'frost'
  | 'bone'
  | 'ritual'
  // The Sunken Bastion: tidal mud, sea-worn wet stone and a barnacled quay.
  | 'mud'
  | 'wetstone'
  | 'quay'
  // A flooded channel's bed under standing water (the Bastion's moat ring):
  // drawn as mud by the terrain, as water on the painted map.
  | 'shallows'
  // The Wildheart Basin: jungle loam under moss and fern, and wet basalt.
  | 'moss'
  | 'basalt'
  // Steel works: riveted steel deck plate, catwalk bar grating, and
  // soot-stained flagstone (unused while the Stormbrass Foundry is parked).
  | 'plate'
  | 'grating'
  | 'soot'
  // Gravewyrm Sanctum: wind-packed snow, clear glacier and lake ice, and the
  // bare slate of Thornpeak.
  | 'snow'
  | 'ice'
  | 'slate';

interface FieldSurfaceBase {
  id: string;
  /** Walkable, but drawn by its dungeon's own visuals (a bridge that only
   *  exists once its gate opens), so the generic terrain skips it. */
  hidden?: boolean;
  /** Dressing along the cliffs this surface stands ABOVE (default 'rock'). */
  edge?: FieldEdgeStyle;
  ground?: FieldGround;
}

/** A flat convex-or-concave polygon at one height. */
export interface FieldPolySurface extends FieldSurfaceBase {
  kind: 'poly';
  points: readonly (readonly [number, number])[];
  h: number;
}

/** A flat disc at one height. */
export interface FieldCircleSurface extends FieldSurfaceBase {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  h: number;
}

/**
 * A walkway along a polyline whose vertices carry their own heights: a stair,
 * a ramp, a causeway, one arm of a spiral. Height inside the band is the
 * linear blend along the nearest segment, so a two-point path is a straight
 * ramp and a multi-point path turns corners without a seam. Author every path
 * to START and END with a short flat run inside the surface it joins, so the
 * join is continuous and no cliff is generated there.
 */
export interface FieldPathSurface extends FieldSurfaceBase {
  kind: 'path';
  points: readonly (readonly [number, number, number])[];
  halfWidth: number;
  /** Render as a flight of steps instead of a smooth ramp. */
  stairs?: boolean;
}

export type FieldSurface = FieldPolySurface | FieldCircleSurface | FieldPathSurface;

/** An authored wall (a ruined curtain wall, a gatehouse flank): one OBB. */
export interface FieldWall {
  id: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  /** Visual height above the ground under its centre (sight top follows it). */
  height: number;
}

/** A dressing piece from the dungeon's kit. `r` or `hw`/`hd` add a collider. */
export interface FieldProp {
  kind: string;
  x: number;
  z: number;
  rot: number;
  scale?: number;
  /** Circle footprint radius (yards, already scaled). */
  r?: number;
  /** Box footprint half extents (yards, already scaled), rotated by `rot`. */
  hw?: number;
  hd?: number;
  /** Visual height of the collider (sight top); defaults to 6. */
  h?: number;
}

/** One lighting mood region (render-only: key tint, fog tint, torch colour). */
export interface FieldLightZone {
  id: string;
  x: number;
  z: number;
  r: number;
  /** Ambient key tint for the zone. */
  key: number;
  /** Local warm or cold accent light colour (lanterns, braziers, frost). */
  accent: number;
  /** Fog tint while the camera stands in this zone. */
  fog: number;
}

export interface AuthoredFieldDef {
  /** The DungeonDef.interior key this field serves. */
  key: string;
  /** Walkable envelope; everything outside is sealed by generated cliffs. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Height of the void between surfaces (the mist chasm floor). */
  voidHeight: number;
  /** A drop taller than this between neighbouring ground becomes a cliff wall. */
  cliffStep: number;
  /** Ordered: a later surface wins where two overlap. */
  surfaces: readonly FieldSurface[];
  walls: readonly FieldWall[];
  props: readonly FieldProp[];
  lightZones: readonly FieldLightZone[];
  /** What the painted dungeon map shows in the void round the terraces (the
   *  sea round a coastal fortress, the mist of a chasm, or the jungle canopy
   *  of a gorge floor, or the blue dark of a glacier's crevasses; default
   *  mist). Render and UI only. */
  mapVoid?: 'sea' | 'mist' | 'jungle' | 'crevasse';
}
