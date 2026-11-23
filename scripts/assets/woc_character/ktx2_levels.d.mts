// Types for ktx2_levels.mjs (the WOC armor build's KTX2 top-level cut; tests read it directly).

export declare const KTX2_IDENTIFIER: Uint8Array;
export declare const KTX2_SUPERCOMPRESSION_ZSTD: number;
export declare const KTX2_DF_MODEL_UASTC: number;
export declare const KTX2_LEVEL_INDEX_OFFSET: number;
export declare const KTX2_LEVEL_INDEX_ENTRY: number;

/** One level as a container stores it: where its bytes sit, and the bytes. */
export interface Ktx2Level {
  byteOffset: number;
  byteLength: number;
  uncompressedByteLength: number;
  data: Uint8Array;
}

/** A read container: the header fields, the index, the three data blocks and the levels
 *  (level 0, the largest, first). */
export interface Ktx2Container {
  vkFormat: number;
  typeSize: number;
  pixelWidth: number;
  pixelHeight: number;
  pixelDepth: number;
  layerCount: number;
  faceCount: number;
  levelCount: number;
  supercompressionScheme: number;
  dfdByteOffset: number;
  dfdByteLength: number;
  kvdByteOffset: number;
  kvdByteLength: number;
  sgdByteOffset: number;
  sgdByteLength: number;
  dfd: Uint8Array;
  kvd: Uint8Array;
  sgd: Uint8Array;
  levels: Ktx2Level[];
}

/** What writeKtx2 lays out: the header fields, the descriptor, the key/value data and the
 *  levels (level 0 first). */
export interface Ktx2Write {
  vkFormat: number;
  typeSize: number;
  pixelWidth: number;
  pixelHeight: number;
  pixelDepth: number;
  layerCount: number;
  faceCount: number;
  supercompressionScheme: number;
  dfd: Uint8Array;
  kvd: Uint8Array;
  sgd?: Uint8Array;
  levels: { data: Uint8Array; uncompressedByteLength: number }[];
}

export declare function readKtx2(bytes: Uint8Array | ArrayBuffer): Ktx2Container;
export declare function assertSplittableKtx2(ktx: Ktx2Container): void;
export declare function writeKtx2(ktx: Ktx2Write): Uint8Array;
export declare function splitKtx2TopLevel(bytes: Uint8Array | ArrayBuffer): {
  half: Uint8Array;
  top: Uint8Array;
};
