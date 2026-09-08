// Fresh unclaimed InstanceSlot records for the Sim ctor's dungeon pre-allocation.
// Pure constructor: no entities, no rng, no SimContext. Doorless and
// overworld-door dungeons pre-allocate identical free slots; the claim
// lifecycle (instances/dungeons.ts) takes over from there.

import type { InstanceSlot } from '../sim';

export function freshInstanceSlot(dungeonId: string, slot: number): InstanceSlot {
  return {
    dungeonId,
    difficulty: 'normal',
    slot,
    partyKey: null,
    mobIds: [],
    npcIds: [],
    objectIds: [],
    exitId: null,
    bossExitId: null,
    emptyFor: 0,
    resetAvailableAt: 0,
    clearedBy: new Set(),
    enteredBy: new Set(),
    raidReturnKeys: new Set(),
    raidBossWelcomeKeys: new Set(),
  };
}
