// Type surface for still_key.mjs (the Guide model still filename/URL identity), so the
// vitest suite imports it under strict TS like the other declared scripts modules.
export declare function stillKey(
  model: string,
  tintHex?: string | null,
  tintStrength?: number,
): string;

export declare const STILLS_DIR: string;

export declare function stillUrl(
  model: string | null | undefined,
  tintHex?: string | null,
  tintStrength?: number,
): string | null;
