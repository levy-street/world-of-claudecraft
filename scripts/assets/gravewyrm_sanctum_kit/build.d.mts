export const GRAVEWYRM_SANCTUM_KIT_PIECES: string[];
export const ASSET: { source: string; target: string; root: string; materials: string[] };
export function sourceFingerprint(root?: string): string;
export function buildKit(root?: string): Promise<Uint8Array>;
