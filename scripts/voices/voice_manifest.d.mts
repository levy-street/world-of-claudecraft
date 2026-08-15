export function voiceClipHash(bytes: Uint8Array | Buffer): string;
export function voiceLineUrl(voiceNpc: string, key: string, hash: string): string;
export function buildVoiceManifestEntries(
  lines: Array<{ key: string; voiceNpc: string }>,
  diskPathFor: (line: { key: string; voiceNpc: string }) => string,
): Record<string, string>;
