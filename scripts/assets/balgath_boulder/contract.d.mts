export interface BalgathBoulderNodeContract {
  readonly name: string;
  readonly role: 'hero' | 'chunk' | 'shard';
  readonly maxTriangles: number;
  readonly minRadius?: number;
  readonly maxRadius?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
}
export const BALGATH_BOULDER_FILE: string;
export const BALGATH_BOULDER_ROOT: string;
export const BALGATH_BOULDER_MATERIALS: readonly string[];
export const BALGATH_BOULDER_BLENDER_VERSION: string;
export const BALGATH_BOULDER_MAX_BYTES: number;
export const BALGATH_BOULDER_NODES: readonly BalgathBoulderNodeContract[];
export const BALGATH_BOULDER_CENTRE_TOLERANCE: number;
