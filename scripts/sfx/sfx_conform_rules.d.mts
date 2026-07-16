export declare const TARGET_BITRATE: number;
export declare const MIN_SOURCE_BITRATE: number;
export declare const TARGET_SAMPLE_RATE: number;
export declare const DURATION_THRESHOLD: number;
export declare const TARGET_PEAK_DBFS: number;
export declare const TARGET_LUFS: number;
export declare const NORM_TOLERANCE: number;
export declare const LOSSLESS_EXTENSIONS: Set<string>;
export declare const TARGET_MONO_CHANNELS: number;
export declare const TARGET_STEREO_CHANNELS: number;

export declare function expectedChannelsForEntry(
  entry: { stereo?: boolean; [key: string]: unknown } | null | undefined,
): number;
export declare function channelProblem(channels: number, expected: number): string | null;

export interface FileStats {
  duration: number;
  bitrate: number;
  sampleRate: number;
  peakDb?: number | null;
  lufs?: number | null;
  isLossless?: boolean;
  isMp3?: boolean;
}

export interface Classification {
  reject: boolean;
  problems: string[];
  normBranch: 'peak' | 'lufs' | null;
}

export declare function classify(stats: FileStats): Classification;
