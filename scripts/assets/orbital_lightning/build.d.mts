export function sourceFingerprint(kind: 'orb' | 'impact', root?: string): string;
export function buildComponent(kind: 'orb' | 'impact', root?: string): Promise<Uint8Array>;
