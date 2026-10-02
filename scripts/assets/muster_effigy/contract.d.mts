export interface MusterEffigyPieceContract {
  readonly key: string;
  readonly file: string;
  readonly dir: string;
  readonly maxTriangles: number;
  readonly maxBytes: number;
}
export const MUSTER_EFFIGY_MATERIALS: readonly string[];
export const MUSTER_EFFIGY_BLENDER_VERSION: string;
export const MUSTER_EFFIGY_PIECES: readonly MusterEffigyPieceContract[];
export const MUSTER_EFFIGY_HEIGHT: { readonly min: number; readonly max: number };
export const MUSTER_EFFIGY_LANTERN_HEIGHT: number;
export const MUSTER_EFFIGY_PLANKS: { readonly min: number; readonly max: number };
export const MUSTER_MALLET_GRIP: {
  readonly reference: string;
  readonly buttY: number;
  readonly crownY: number;
  readonly translationY: number;
  readonly scale: number;
};
