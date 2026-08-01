export type MeshTriangle = number[][];

export function glbIO(): {
  read(path: string): Promise<unknown>;
  write(path: string, document: unknown): Promise<void>;
};
export function documentTriangles(document: unknown): MeshTriangle[];
export function readGlbTriangles(
  path: string,
): Promise<{ document: unknown; triangles: MeshTriangle[] }>;
export function decompressForEditing<T>(document: T): T;
