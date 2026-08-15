export declare const SFX_GAIN_CEILING_PATH: string;

export interface SfxGainCeilingTrack {
  filename: string;
  sha256: string;
  size: number;
  peakDb: number;
}

export interface SfxGainCeilingRecord {
  ceilingDb: number;
  tracks: SfxGainCeilingTrack[];
}

export declare function computeSfxGainCeilingRecords(
  repoRoot: string,
  ffmpegPath: string,
): Record<string, SfxGainCeilingRecord>;

export declare function computeSfxGainCeilings(
  repoRoot: string,
  ffmpegPath: string,
): Record<string, number>;

export declare function readSfxGainCeilings(repoRoot: string): Record<string, number>;

export declare function writeSfxGainCeilings(
  repoRoot: string,
  ffmpegPath: string,
): { path: string; ceilings: Record<string, number> };
