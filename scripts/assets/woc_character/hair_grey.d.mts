// Types for hair_grey.mjs (the WOC head packs' grey hair textures; tests read it directly).
import type { Document, Texture } from '@gltf-transform/core';

export declare const WOC_HAIR_LUMA: readonly [number, number, number];
export declare const WOC_HAIR_GREY_KTX: {
  readonly codec: 'etc1s';
  readonly srgb: true;
  readonly qlevel: number;
  readonly clevel: number;
};
export declare function srgbByteToLinear(byte: number): number;
export declare function linearToSrgbByte(linear: number): number;
export declare function greyTexelByte(r: number, g: number, b: number): number;
export declare function greyTexels(data: Uint8Array, channels: number): Uint8Array;
export declare function greyPng(png: Uint8Array): Promise<Uint8Array>;
export declare function isHairRoleMaterial(name: string): boolean;
export declare function hairGreyTextures(doc: Document): Texture[];
