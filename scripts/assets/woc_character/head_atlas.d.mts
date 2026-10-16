// Types for head_atlas.mjs (the head core's one colour atlas; tests read its pure helpers).
import type { Document, Texture } from '@gltf-transform/core';

/** Gutter round every cell, in texels (the source's own neighbours, by its wrap mode). */
export const HEAD_ATLAS_GUTTER: number;
/** Texels kept beyond the UV bounds inside a cell. */
export const HEAD_ATLAS_MARGIN: number;
/** Cells sit on this grid (the 4 x 4 codec block). */
export const HEAD_ATLAS_BLOCK: number;
/** Bits an atlas uv is stored at (a normalized unsigned 16 bit accessor, all of it used). */
export const HEAD_ATLAS_UV_BITS: number;

/** A rectangle to pack, in texels (its gutters included). */
export interface HeadAtlasRect {
  w: number;
  h: number;
}

/** A packed rectangle's origin in the bin. */
export interface HeadAtlasPoint {
  x: number;
  y: number;
}

/** A rectangle of the atlas, in atlas pixels. */
export interface HeadAtlasCellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One cell of an atlas, as headAtlasMipLevels reads it. */
export interface HeadAtlasLevelCell {
  /** The cell with its gutter. */
  rect: HeadAtlasCellRect;
  /** Its source image (RGBA, row major from the top) and glTF wrap modes; null: flat white. */
  source: {
    data: Uint8Array;
    width: number;
    height: number;
    wrapS: number;
    wrapT: number;
  } | null;
  /** The atlas pixel the source's texel (0, 0) sits on (it may lie outside the atlas). */
  at: [number, number];
}

/** One mip level: RGBA, row major from the top, opaque. */
export interface HeadAtlasLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What atlasHeadCore did to a pack's core. */
export interface HeadAtlasSummary {
  /** The atlas texture's name (`WocHead_<T>_core_atlas`). */
  atlas: string;
  size: [number, number];
  /** The size of every mip level, level 0 first, down to 1 x 1. */
  levels: [number, number][];
  /** The centre of the white cell, as a UV. */
  white: [number, number];
  /** Source textures packed. */
  sources: number;
  /** Textured core materials now sampling the atlas. */
  materials: number;
  cells: {
    texture: string;
    source: [number, number];
    /** The source rectangle copied: x, y, width, height (texels, before the gutter). */
    crop: [number, number, number, number];
    /** Where the crop's origin landed in the atlas. */
    at: [number, number];
  }[];
}

/** Whether a node is a core piece: the base head or a slot that rides the core file. */
export function isHeadCorePiece(nodeName: string): boolean;

/** A source coordinate folded back into [0, size) by a glTF wrap mode. */
export function wrapTexel(i: number, size: number, wrap: number): number;

/**
 * The texel span a cell copies for UV bounds [lo, hi] on one axis of a `size` texel source,
 * opened out to the block grid: its origin (may be negative) and its length.
 */
export function cropSpan(lo: number, hi: number, size: number): { origin: number; length: number };

/** MaxRects packing of `rects` into a W x H bin: each origin in input order, or null. */
export function packRects(
  rects: readonly HeadAtlasRect[],
  W: number,
  H: number,
): HeadAtlasPoint[] | null;

/** The smallest bin on the side-step grid that packs `rects`, or null when none does. */
export function smallestBin(
  rects: readonly HeadAtlasRect[],
): { W: number; H: number; placed: HeadAtlasPoint[] } | null;

/** The sizes of a W x H texture's mip levels, level 0 first, down to 1 x 1. */
export function headAtlasLevelSizes(W: number, H: number): [number, number][];

/**
 * Which atlas pixels the pieces read: `cellTriangles[c]` lists cell c's uv triangles, six
 * numbers each (three corners, in atlas pixels). Returns a W x H map, row major: a cell
 * index + 1 for every pixel within reach of one of its triangles, 0 elsewhere.
 */
export function headAtlasCoverage(
  W: number,
  H: number,
  cellTriangles: readonly ArrayLike<number>[],
): Uint8Array;

/**
 * Which cell every texel of a Wk x Hk level of a W x H atlas stands for (`rects`: the cells
 * with their gutters; `cover`: headAtlasCoverage's map of who reads what). A texel goes to
 * the cell that reads it, or with no reader to the cell under it, or with no cell under it
 * to the nearest. `owner` holds a cell index per texel, row major, or -1 for a texel no cell
 * has half of; `mixed` holds those texels' [cell index, share] lists, by texel index.
 */
export function headAtlasTexelCells(
  W: number,
  H: number,
  Wk: number,
  Hk: number,
  rects: readonly HeadAtlasCellRect[],
  cover?: Uint8Array | null,
): { owner: Int32Array; mixed: Map<number, [number, number][]> };

/**
 * The levels of a W x H atlas below level 0, from level 1 down to 1 x 1, built per cell: each
 * texel holds the box average (linear light) of its own cell's source over its footprint.
 */
export function headAtlasMipLevels(
  W: number,
  H: number,
  cells: readonly HeadAtlasLevelCell[],
  cover?: Uint8Array | null,
): HeadAtlasLevel[];

/**
 * The level PNGs (level 0 first, down to 1 x 1) of an atlas texture atlasHeadCore built, for
 * the encoder; null for any other texture.
 */
export function headAtlasLevelPngs(texture: Texture): Uint8Array[] | null;

/** The stored code of one atlas uv coordinate; throws for one outside [0, 1]. */
export function headAtlasUvCode(u: number): number;

/**
 * Move the TEXCOORD_0 of every primitive that samples an atlas atlasHeadCore built to a custom
 * attribute, out of a pack-wide quantization's reach. Returns the number of primitives held.
 */
export function holdHeadAtlasUvs(doc: Document): number;

/**
 * Put the held uvs back as TEXCOORD_0, written at HEAD_ATLAS_UV_BITS. Returns the number of
 * primitives released.
 */
export function releaseHeadAtlasUvs(doc: Document): number;

/**
 * Atlas a head pack's core in place (its textures still PNG masters). Returns a summary, or
 * null when the pack has no textured core piece; throws, before it changes anything, on a
 * core it cannot atlas faithfully. The atlas texture holds level 0; headAtlasLevelPngs holds
 * every level.
 */
export function atlasHeadCore(doc: Document): Promise<HeadAtlasSummary | null>;
