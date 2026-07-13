export declare const TARGET_BITRATE: number;
export declare const MIN_SOURCE_BITRATE: number;
export declare const TARGET_SAMPLE_RATE: number;
export declare const DURATION_THRESHOLD: number;
export declare const TARGET_PEAK_DBFS: number;
export declare const TARGET_LUFS: number;
export declare const NORM_TOLERANCE: number;
export declare const LOSSLESS_EXTENSIONS: Set<string>;

export interface FileStats {
  duration: number;
  bitrate: number;
  sampleRate: number;
  peakDb?: number | null;
  lufs?: number | null;
  isLossless?: boolean;
}

export interface Classification {
  reject: boolean;
  problems: string[];
  normBranch: 'peak' | 'lufs' | null;
}

export declare function classify(stats: FileStats): Classification;
