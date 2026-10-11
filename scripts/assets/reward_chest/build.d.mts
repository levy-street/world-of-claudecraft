export const SOURCE: string;
export const TARGET: string;
export const NODES: string[];
export const MATERIALS: string[];
export function sourceFingerprint(root?: string): string;
export function buildChest(root?: string): Promise<Uint8Array>;
