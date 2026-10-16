export const ASSET: { source: string; target: string; node: string; material: string };
export function sourceFingerprint(root?: string): string;
export function buildMountains(srcDir: string, root?: string): Promise<Uint8Array>;
