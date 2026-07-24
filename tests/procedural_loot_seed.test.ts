import { describe, expect, it } from 'vitest';
import {
  deriveProceduralItemSeed,
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
