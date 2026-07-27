import { describe, expect, it } from 'vitest';
import {
  deriveProceduralItemSeed,
  deriveSecretProceduralItemSeed,
  formatProceduralItemUid,
  hash32Parts,
} from '../src/sim/loot/procedural';
import type { ItemDropContext } from '../src/sim/procedural_item';

const CONTEXT: ItemDropContext = {
  source: 'dungeon',
  sourceEntityId: 41,
  sourceSpawnSequence: 7,
  lootSlotIndex: 2,
  recipientId: 91,
  sourceTemplateId: 'test_boss',
};

describe('procedural item identity', () => {
  it('derives a stable non-zero child seed from the authoritative tuple', () => {
    expect(deriveProceduralItemSeed(12345, CONTEXT)).toBe(2177513945);
    expect(deriveProceduralItemSeed(12345, CONTEXT)).not.toBe(0);
  });

  it('requires the private server key to predict a live procedural result', () => {
    const publicTupleGuess = deriveProceduralItemSeed(12345, CONTEXT);
    const first = deriveSecretProceduralItemSeed(
      '000102030405060708090a0b0c0d0e0f',
      12345,
      CONTEXT,
    );
    const rotated = deriveSecretProceduralItemSeed(
      'f0e0d0c0b0a090807060504030201000',
      12345,
      CONTEXT,
    );

    expect(first).toBe(4211982041);
    expect(first).not.toBe(publicTupleGuess);
    expect(rotated).toBe(1779677970);
    expect(rotated).not.toBe(first);
    expect(() => deriveSecretProceduralItemSeed('public-world-seed', 12345, CONTEXT)).toThrow(
      /128 bits/,
    );
  });

  it.each([
    ['world seed', 12346, CONTEXT],
    ['entity', 12345, { ...CONTEXT, sourceEntityId: 42 }],
    ['spawn sequence', 12345, { ...CONTEXT, sourceSpawnSequence: 8 }],
    ['slot', 12345, { ...CONTEXT, lootSlotIndex: 3 }],
    ['recipient', 12345, { ...CONTEXT, recipientId: 92 }],
    ['source kind', 12345, { ...CONTEXT, source: 'raid' as const }],
  ])('changes when %s changes', (_label, worldSeed, context) => {
    expect(deriveProceduralItemSeed(worldSeed, context)).not.toBe(
      deriveProceduralItemSeed(12345, CONTEXT),
    );
  });

  it('hashes strings and integers without relying on object key order', () => {
    expect(hash32Parts('a', 1, 'b', 2)).toBe(hash32Parts('a', 1, 'b', 2));
    expect(hash32Parts('a', 1, 'b', 2)).not.toBe(hash32Parts('b', 1, 'a', 2));
  });

  it('formats realm-scoped monotonic persisted UIDs', () => {
    expect(formatProceduralItemUid('realm_1', 42)).toBe('pi1:realm_1:42');
    expect(formatProceduralItemUid('realm_1', '00042')).toBe('pi1:realm_1:42');
  });

  it.each([
    ['', '1'],
    ['UPPER', '1'],
    ['spaces here', '1'],
    ['realm', '-1'],
    ['realm', '1.2'],
    ['realm', ''],
  ])('rejects invalid UID input %s:%s', (namespace, serial) => {
    expect(() => formatProceduralItemUid(namespace, serial)).toThrow();
  });
});
