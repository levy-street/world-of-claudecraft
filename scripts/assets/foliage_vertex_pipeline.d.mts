import type { Document } from '@gltf-transform/core';

export interface FoliageTownTreeAsset {
  readonly path: string;
  readonly inputSha256: string;
  readonly outputSha256: string;
  readonly semanticSha256: string;
}

export const FOLIAGE_TOWN_TREE_ASSETS: readonly FoliageTownTreeAsset[];

export function triangleAttributeFingerprint(document: Document): string;

export function optimizeFoliageVertexDocument(document: Document, encoder: unknown): Promise<void>;
