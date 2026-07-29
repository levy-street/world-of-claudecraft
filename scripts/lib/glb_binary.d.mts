export interface Glb {
  buf: Buffer;
  json: Record<string, unknown> & {
    accessors: unknown[];
    bufferViews: unknown[];
    meshes?: unknown[];
  };
  bin: Buffer | null;
  binStart: number;
}

export interface AccessorSpan {
  view: number;
  start: number;
  end: number;
  stride: number;
}

export function readGlb(path: string): Glb;
export function accessorLayout(json: Glb['json'], index: number): Record<string, unknown> | null;
export function readAccessor(json: Glb['json'], bin: Buffer, index: number): Float64Array;
export function writeFloatAccessor(
  json: Glb['json'],
  bin: Buffer,
  index: number,
  values: ArrayLike<number>,
): void;
export function writeGlb(path: string, glb: Glb): void;
export function accessorSpan(json: Glb['json'], index: number): AccessorSpan | null;
