// Types for ktx_encode.mjs (the WOC character files' KTX2 encoder; tests read it directly).

/** One encode's settings: the codec, the transfer function, and the codec's own knobs (UASTC
 *  takes an RDO lambda, ETC1S a quality and a compression level). */
export interface KtxSettings {
  readonly codec: 'uastc' | 'etc1s';
  readonly srgb: boolean;
  readonly rdo?: number;
  readonly qlevel?: number;
  readonly clevel?: number;
}

/** The settings per map kind ('color', 'normal', 'data') and armor tier ('low' takes ETC1S
 *  colour; any other tier UASTC). */
export declare function encoderSettings(kind: string, tier: string): KtxSettings;
export declare function ktxArgs(settings: KtxSettings, input: string, output: string): string[];
export declare function ktxBinDir(repoRoot: string): string;
export declare function createKtxEncoder(options: {
  repoRoot: string;
  cacheDir: string;
  concurrency?: number;
}): {
  encode(png: Uint8Array, settings: KtxSettings): Promise<Buffer>;
  encodeLevels(pngs: Uint8Array[], settings: KtxSettings): Promise<Buffer>;
  stats: { encoded: number; cached: number };
};
