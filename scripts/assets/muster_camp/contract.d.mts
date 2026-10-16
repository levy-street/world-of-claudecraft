export interface MusterCampPieceContract {
  readonly key: string;
  readonly file: string;
  readonly tierClass: 'structure' | 'clutter';
  readonly maxTriangles: number;
  readonly maxBytes: number;
}
export const MUSTER_CAMP_MATERIALS: readonly string[];
export const MUSTER_CAMP_BLENDER_VERSION: string;
export const MUSTER_CAMP_PIECES: readonly MusterCampPieceContract[];
export const MUSTER_TORCH_FLAME_HEIGHT: number;
