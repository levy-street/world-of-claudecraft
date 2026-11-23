/** A GLB's parsed JSON chunk and its BIN chunk. */
export interface ParsedGlb {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

/** Beard ids the split ships in a file of their own (the catalog's BEARDS_WITH_OWN_FILE). */
export const BEARDS_WITH_OWN_FILE: ReadonlySet<string>;

/**
 * The head type and the split file (basename) one piece node ships in, read off its name
 * (WocHead_<T>_<slot>_<id>[_L|_R]). Throws on a name outside the export contract.
 */
export function fileOfPiece(name: string): { type: string; file: string };

/**
 * Float normals meshopt's octahedral encoder (8 bits) maps back onto exactly these codes:
 * four signed bytes per normal (u, v, the unit 127, w), three floats out per normal.
 */
export function normalsForCodes(codes: Int8Array): Float32Array;

/**
 * The octahedral codes a GLB stores for every NORMAL, by JSON accessor index, read out of the
 * compressed bytes without the filter; null when any normal (or a tangent) is stored another way.
 */
export function octahedralNormalCodes(glb: ParsedGlb): Map<number, Int8Array> | null;

/** Splits a GLB into its JSON and BIN chunks (throws on anything but a GLB 2). */
export function parseGlb(bytes: Uint8Array): ParsedGlb;
