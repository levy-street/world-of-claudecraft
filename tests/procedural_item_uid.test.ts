import { describe, expect, it } from 'vitest';
import {
  deterministicOfflineProceduralItemUidLease,
  ProceduralItemUidAllocator,
} from '../src/sim/procedural_item_uid';
import { Sim } from '../src/sim/sim';

describe('ProceduralItemUidAllocator', () => {
  it('allocates every serial in a half-open lease exactly once, then fails closed', () => {
    const allocator = new ProceduralItemUidAllocator({
      realmNamespace: 'lease_test',
      startSerial: '99',
      endExclusive: '102',
    });

    expect(allocator.allocate()).toBe('pi1:lease_test:99');
    expect(allocator.allocate()).toBe('pi1:lease_test:100');
    expect(allocator.allocate()).toBe('pi1:lease_test:101');
    expect(allocator.allocatedCount).toBe(3n);
    expect(() => allocator.allocate()).toThrow(/exhausted/);
  });

  it.each([
    { realmNamespace: 'test', startSerial: '0', endExclusive: '2' },
    { realmNamespace: 'test', startSerial: '2', endExclusive: '2' },
    { realmNamespace: 'test', startSerial: '3', endExclusive: '2' },
    { realmNamespace: 'test', startSerial: 'not-decimal', endExclusive: '2' },
    { realmNamespace: 'UPPER', startSerial: '1', endExclusive: '2' },
  ])('rejects an invalid lease %#', (lease) => {
    expect(() => new ProceduralItemUidAllocator(lease)).toThrow();
  });
});

describe('Sim procedural item UID allocation', () => {
  it('uses the supplied lease synchronously and refuses replacement after first use', () => {
    const sim = new Sim({
      seed: 123,
      playerClass: 'warrior',
      noPlayer: true,
      proceduralItemUidLease: {
        realmNamespace: 'live_test',
        startSerial: '500',
        endExclusive: '502',
      },
    });

    expect(sim.allocateProceduralItemUid()).toBe('pi1:live_test:500');
    expect(() =>
      sim.configureProceduralItemUidLease({
        realmNamespace: 'replacement',
        startSerial: '1',
        endExclusive: '2',
      }),
    ).toThrow(/after allocation/);
    expect(sim.allocateProceduralItemUid()).toBe('pi1:live_test:501');
    expect(() => sim.allocateProceduralItemUid()).toThrow(/exhausted/);
  });

  it('uses deterministic seed-scoped defaults for offline and test Sims', () => {
    const lease = deterministicOfflineProceduralItemUidLease(20_061);
    expect(lease.realmNamespace).toBe('offline_20061');

    const first = new Sim({ seed: 20_061, playerClass: 'mage', noPlayer: true });
    const replay = new Sim({ seed: 20_061, playerClass: 'mage', noPlayer: true });
    const other = new Sim({ seed: 20_062, playerClass: 'mage', noPlayer: true });

    expect(first.allocateProceduralItemUid()).toBe(replay.allocateProceduralItemUid());
    expect(first.allocateProceduralItemUid()).toBe(replay.allocateProceduralItemUid());
    expect(other.allocateProceduralItemUid()).not.toBe(first.allocateProceduralItemUid());
  });
});
