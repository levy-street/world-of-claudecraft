import type { Document } from '@gltf-transform/core';

export declare const SCENERY_LOD_ASSETS: readonly {
  source: string;
  output: string;
  sha256: string;
  materials?: readonly string[];
}[];
export declare function isSceneryLodCopyCatalogId(id: string): boolean;
export declare function addSceneryLod(
  document: Document,
  options?: { materials?: readonly string[] },
): Promise<
  {
    mesh: string;
    height: number;
    triangles: number;
    levels: { triangles: number; maxDeviation: number }[];
  }[]
>;
