export function isConvertibleSkinPng(basename: string): boolean;
export function isConvertibleStandaloneImage(basename: string): boolean;
export function ktx2SiblingPath(srcPath: string): string;
export type StandaloneTextureEncoding = 'basis-lz' | 'uastc';
export type StandaloneTextureTransferFunction = 'linear' | 'srgb';
export interface StandaloneTextureClass {
  channel: string | null;
  encoding: StandaloneTextureEncoding;
  transferFunction: StandaloneTextureTransferFunction;
}
export function classifyStandaloneTexture(basename: string): StandaloneTextureClass;
export function buildKtxCreateArgs(opts: {
  hasAlpha: boolean;
  srcPath: string;
  dstPath: string;
  encoding?: StandaloneTextureEncoding;
  transferFunction?: StandaloneTextureTransferFunction;
}): string[];
export function flippedSourcePath(srcPath: string, tmpDir: string): string;
export function blockAlignmentError(width: number, height: number): string | null;
export interface StandaloneTextureCompressionArgs {
  dir: string;
  dryRun: boolean;
  flip: boolean;
  jobs: number;
  files: string[];
}
export function parseArgs(argv: string[], defaultDir: string): StandaloneTextureCompressionArgs;
