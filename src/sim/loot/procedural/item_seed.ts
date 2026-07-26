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

const U64_MASK = (1n << 64n) - 1n;

function rotateLeft64(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & U64_MASK;
}

function sipRound(
  state: readonly [bigint, bigint, bigint, bigint],
): [bigint, bigint, bigint, bigint] {
  let [v0, v1, v2, v3] = state;
  v0 = (v0 + v1) & U64_MASK;
  v1 = rotateLeft64(v1, 13n) ^ v0;
  v0 = rotateLeft64(v0, 32n);
  v2 = (v2 + v3) & U64_MASK;
  v3 = rotateLeft64(v3, 16n) ^ v2;
  v0 = (v0 + v3) & U64_MASK;
  v3 = rotateLeft64(v3, 21n) ^ v0;
  v2 = (v2 + v1) & U64_MASK;
  v1 = rotateLeft64(v1, 17n) ^ v2;
  v2 = rotateLeft64(v2, 32n);
  return [v0, v1, v2, v3];
}

function littleEndianU64(bytes: readonly number[], offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index++)
    value |= BigInt(bytes[offset + index] ?? 0) << BigInt(index * 8);
  return value;
}

function sipHash24(secretHex: string, message: string): bigint {
  if (!/^[0-9a-f]{32}$/.test(secretHex)) {
    throw new Error('procedural loot secret must be exactly 128 bits of lowercase hex');
  }
  const keyBytes = Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(secretHex.slice(index * 2, index * 2 + 2), 16),
  );
  const bytes = [...new TextEncoder().encode(message)];
  const k0 = littleEndianU64(keyBytes, 0);
  const k1 = littleEndianU64(keyBytes, 8);
  let state: [bigint, bigint, bigint, bigint] = [
    0x736f6d6570736575n ^ k0,
    0x646f72616e646f6dn ^ k1,
    0x6c7967656e657261n ^ k0,
    0x7465646279746573n ^ k1,
  ];
  const completeLength = bytes.length - (bytes.length % 8);
  for (let offset = 0; offset < completeLength; offset += 8) {
    const block = littleEndianU64(bytes, offset);
    state[3] ^= block;
    state = sipRound(sipRound(state));
    state[0] ^= block;
  }
  // SipHash stores only the low byte of the message length in the high byte of
  // the final 64-bit word. Mask explicitly so long diagnostic/tool messages
  // cannot leak bits above the word and perturb the round function.
  let tail = BigInt(bytes.length & 0xff) << 56n;
  for (let index = completeLength; index < bytes.length; index++) {
    tail |= BigInt(bytes[index]) << BigInt((index - completeLength) * 8);
  }
  state[3] ^= tail;
  state = sipRound(sipRound(state));
  state[0] ^= tail;
  state[2] ^= 0xffn;
  state = sipRound(sipRound(sipRound(sipRound(state))));
  return (state[0] ^ state[1] ^ state[2] ^ state[3]) & U64_MASK;
}

export function deriveSecretSeed32(secretHex: string, parts: readonly (number | string)[]): number {
  const keyed = sipHash24(secretHex, JSON.stringify(parts));
  const seed = Number(keyed & 0xffff_ffffn) >>> 0;
  return seed === 0 ? 0x9e3779b9 : seed;
}

export function deriveSecretProceduralItemSeed(
  secretHex: string,
  worldSeed: number,
  context: ItemDropContext,
): number {
  return deriveSecretSeed32(secretHex, [
    'procedural-item-v2',
    worldSeed,
    context.source,
    context.sourceEntityId,
    context.sourceSpawnSequence,
    context.lootSlotIndex,
    context.recipientId ?? 0,
  ]);
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
