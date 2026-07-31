export interface TankMapFamilySpec {
  readonly albedoSize: number;
  readonly reliefSize: number;
}

export interface TankMetalMapSpec extends TankMapFamilySpec {
  readonly scratches: number;
  readonly chips: number;
}

export interface TankFabricMapSpec extends TankMapFamilySpec {
  readonly pebblePeriod: number;
  readonly weavePeriod: number;
}

export interface TankMapSet {
  readonly albedoSize: number;
  readonly reliefSize: number;
  readonly albedo: Buffer;
  readonly normal: Buffer;
  readonly orm: Buffer;
}

export interface TankSurfaceMaps {
  readonly metal: TankMapSet;
  readonly fabric: TankMapSet;
  readonly preview: Buffer;
}

export const NORMAL_SCALE: number;
export const TANK_MAP_SPECS: {
  readonly metal: TankMetalMapSpec;
  readonly fabric: TankFabricMapSpec;
};

export function buildTankSurfaceMaps(): Promise<TankSurfaceMaps>;

/** Authored fields, exported for the tiling contract test (see the note on
 *  buildMetalAlbedo). Values are unit-range scalars, row-major, size x size. */
export function buildMetalAlbedo(size: number, spec: TankMetalMapSpec): Float32Array;
export function buildMetalRelief(
  size: number,
  spec: TankMetalMapSpec,
): { height: Float32Array; wear: Float32Array };
export function buildFabricAlbedo(size: number, spec: TankFabricMapSpec): Float32Array;
export function buildFabricRelief(size: number, spec: TankFabricMapSpec): Float32Array;
