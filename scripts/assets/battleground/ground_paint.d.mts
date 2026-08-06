export interface PaintSwatch {
  id: number;
  color: number;
  label: string;
  textureSha: string;
  tileSize: number;
  light?: number;
}

export interface PaintGrid {
  cell: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  ids: number[];
  custom: PaintSwatch[];
}

export const PAINT_CELL: number;
export const BARE: number;
export const SWATCHES: PaintSwatch[];
export const GRASS_GROUND: ReadonlySet<number>;
export const SOFT_GROUND: ReadonlySet<number>;
export function buildPaint(): PaintGrid;
export function makePaintSampler(paint: PaintGrid): (x: number, z: number) => number;
