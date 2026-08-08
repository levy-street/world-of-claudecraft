export function isConvertibleSkinPng(basename: string): boolean;
export function ktx2SiblingPath(pngPath: string): string;
export function buildKtxCreateArgs(opts: {
  hasAlpha: boolean;
  srcPath: string;
  dstPath: string;
}): string[];
export interface StandaloneTextureCompressionArgs {
  dir: string;
  dryRun: boolean;
  jobs: number;
  files: string[];
}
export function parseArgs(argv: string[], defaultDir: string): StandaloneTextureCompressionArgs;
