export interface BalgathStarwakeNodeContract {
  readonly name: string;
  readonly role: 'crystal' | 'chunk' | 'crust' | 'column';
  readonly anchor: 'base' | 'centroid';
  readonly maxTriangles: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly minFootprint?: number;
  readonly maxFootprint?: number;
  readonly minRadius?: number;
  readonly maxRadius?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minThickness?: number;
  readonly maxThickness?: number;
}
export const BALGATH_STARWAKE_FILE: string;
export const BALGATH_STARWAKE_ROOT: string;
export const BALGATH_STARWAKE_MATERIALS: readonly string[];
export const BALGATH_STARWAKE_BLENDER_VERSION: string;
export const BALGATH_STARWAKE_MAX_BYTES: number;
export const BALGATH_STARWAKE_MAX_TRIANGLES: number;
export const BALGATH_STARWAKE_NODES: readonly BalgathStarwakeNodeContract[];
export const BALGATH_STARWAKE_CENTRE_TOLERANCE: number;
