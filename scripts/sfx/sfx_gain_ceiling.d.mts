export declare const SFX_GAIN_CEILING_PATH: string;

export declare function computeSfxGainCeilings(
  repoRoot: string,
  ffmpegPath: string,
): Record<string, number>;

export declare function readSfxGainCeilings(repoRoot: string): Record<string, number>;

export declare function writeSfxGainCeilings(
  repoRoot: string,
  ffmpegPath: string,
): { path: string; ceilings: Record<string, number> };
