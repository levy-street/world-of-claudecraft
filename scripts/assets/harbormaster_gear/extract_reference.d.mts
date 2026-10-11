import type { Document } from '@gltf-transform/core';

export const REFERENCE_PARTS: readonly string[];
export const REFERENCE_BONES: readonly string[];
export function loadModularBody(file?: string): Promise<Document>;
export function boneFramePart(
  doc: Document,
  name: string,
  bone: string,
): { positions: Float32Array; indices: Uint32Array | null }[];
