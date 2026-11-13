// The placement record every Smith's Heart kit plan hands its painter
// (heart_kit.ts instances it): which Kit_* piece, where, how it is turned,
// stretched and sheared, and whether it casts a shadow or sheds on the low
// tier. Three-free, DOM-free.

/** One placed kit piece (instance-local yards; `rot` is three's rotation.y,
 *  the piece's front (local +Z) turned to (sin rot, cos rot)). */
export interface HeartKitPlacement {
  piece: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
  /** Stretch along local X (an edge module fitted to its run). */
  stretch?: number;
  /** Rise per yard along local +X (an edge module following a slope). */
  shear?: number;
  /** Extra scale up local Y on top of `scale` (a mountain rock piece fitted
   *  to the slope it skins). */
  rise?: number;
  /** Never casts a shadow (scenery far down a face, flat floor dressing). */
  noShadow?: boolean;
  /** Shed on the low tier (cosmetic dressing only). */
  cosmetic?: boolean;
}
