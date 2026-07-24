import type { ItemDropContext } from '../../procedural_item';

function mix32(hash: number, value: number): number {
  let h = Math.imul(hash ^ (value >>> 0), 0x45d9f3b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash32Parts(...parts: readonly (number | string)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    if (typeof part === 'number') {
      hash = mix32(hash, Number.isFinite(part) ? Math.trunc(part) : 0);
      continue;
    }
    for (let i = 0; i < part.length; i++) hash = mix32(hash, part.charCodeAt(i));
    hash = mix32(hash, part.length);
  }
  return hash === 0 ? 0x9e3779b9 : hash;
}

export function deriveProceduralItemSeed(worldSeed: number, context: ItemDropContext): number {
  return hash32Parts(
    'procedural-item-v1',
    worldSeed,
    context.source,
    context.sourceEntityId,
    context.sourceSpawnSequence,
    context.lootSlotIndex,
    context.recipientId ?? 0,
  );
}

function normalizeSerial(serial: number | string): string {
  const raw = typeof serial === 'number' ? String(serial) : serial;
  if (!/^\d+$/.test(raw)) throw new Error('procedural item serial must be decimal digits');
  if (typeof serial === 'number' && (!Number.isSafeInteger(serial) || serial < 0))
    throw new Error('procedural item serial number must be a non-negative safe integer');
  return raw.replace(/^0+(?=\d)/, '');
}

export function formatProceduralItemUid(realmNamespace: string, serial: number | string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(realmNamespace))
    throw new Error('invalid procedural item realm namespace');
  return `pi1:${realmNamespace}:${normalizeSerial(serial)}`;
}
