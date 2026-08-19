// Hand-written declarations for the procedural truck factory.
//
// Present because tests/weirdo_cream_truck_asset.test.ts imports the model's
// authored contracts (the cab clearances, the native bounds, the rider seat) and
// asserts the shipped GLB against them: a type-checked suite importing a plain
// .js module needs a declaration beside it, the same convention scripts/ uses
// for every .mjs a Vitest reaches into.
//
// Only the exported CONTRACT is declared. The geometry builder is declared
// loosely on purpose: nothing type-checked calls it, and pinning a three.js
// return shape here would just be a second thing to keep in sync.

export interface TruckBounds {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface TruckRiderSeat {
  readonly y: number;
  readonly z: number;
}

export interface TruckCab {
  readonly floorY: number;
  readonly backZ: number;
  readonly frontZ: number;
  readonly doorTopY: number;
  readonly innerHalfWidth: number;
  readonly screenZ: number;
  readonly screenTopY: number;
  readonly riderZ: number;
  readonly riderClearRadius: number;
}

export interface TruckMaterialContract {
  readonly name: string;
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly surface: 'metal' | 'fabric' | 'decal';
  readonly uvScale: number;
}

export interface TruckSocketDefinition {
  readonly id: string;
  readonly nodeName: string;
  readonly position: readonly [number, number, number];
  readonly purpose: string;
}

export const TRUCK_STAGES: readonly string[];
export const TRUCK_NATIVE_BOUNDS: TruckBounds;
export const TRUCK_RIDER_SEAT: TruckRiderSeat;
export const TRUCK_CLIP_NAMES: readonly string[];
export const TRUCK_CAB: TruckCab;
export const TRUCK_SOCKET_DEFINITIONS: readonly TruckSocketDefinition[];
export const TRUCK_MATERIAL_CONTRACT: readonly TruckMaterialContract[];

export function createWeirdoCreamTruck(options?: {
  stage?: string;
  sourceFingerprint?: string | null;
}): { root: unknown; animations: unknown[]; riderSeat: readonly number[] };
