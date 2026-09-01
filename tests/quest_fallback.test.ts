import { describe, expect, it } from 'vitest';
import { bagCapacity, bagPools, countFit } from '../src/sim/bags';
import { ITEMS, QUESTS } from '../src/sim/data';
import { questFallbackGrants } from '../src/sim/quest_fallback';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestDef } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { expectDefined } from './helpers/defined';

const BOUND_GUARDIAN = 'q_nythraxis_bound_guardian';
const KEYSTONE = 'crypt_keystone';
const HIGHWATCH_ALDRIC = 'brother_aldric_highwatch';

function quest(extra: Partial<QuestDef>): QuestDef {
  return {
    id: 'q_test',
    name: 'Test',
    giverNpcId: 'g',
    turnInNpcId: 'g',
    text: '',
    completionText: '',
    objectives: [],
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    ...extra,
  };
}

describe('questFallbackGrants (pure)', () => {
  it('returns nothing when the quest declares no required items', () => {
    expect(questFallbackGrants(quest({}), () => false)).toEqual([]);
    expect(questFallbackGrants(quest({ requiredItems: [] }), () => false)).toEqual([]);
  });

  it('grants a required item the player is missing', () => {
    expect(questFallbackGrants(quest({ requiredItems: ['a'] }), () => false)).toEqual(['a']);
  });

  it('does not grant a required item the player already holds', () => {
    expect(questFallbackGrants(quest({ requiredItems: ['a'] }), () => true)).toEqual([]);
  });

  it('grants only the missing subset and de-duplicates', () => {
    const have = new Set(['b']);
    const out = questFallbackGrants(quest({ requiredItems: ['a', 'b', 'c', 'a'] }), (id) =>
      have.has(id),
    );
    expect(out).toEqual(['a', 'c']);
  });

  it('is deterministic for the same inputs', () => {
    const q = quest({ requiredItems: ['x', 'y'] });
    const run = () => questFallbackGrants(q, (id) => id === 'y');
    expect(run()).toEqual(run());
  });

  it('the Bound Guardian quest declares the Crypt Keystone as a required item', () => {
    expect(QUESTS[BOUND_GUARDIAN].requiredItems).toContain(KEYSTONE);
  });
});

// Integration: drive the real Sim.acceptQuest path and assert the keystone is
// re-granted on accept when missing (the original progression-block scenario),
// and not duplicated when already held.
function makeAttunedPlayerAtGiver(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Tester');
  const meta = sim.players.get(pid)!;
  // Satisfy accept gates: prerequisite done + minLevel.
  meta.questsDone.add('q_nythraxis_sealed_crypt');
  const p = sim.entities.get(pid)! as Entity;
  p.level = 20;
  // Stand on the quest giver so the proximity check passes.
  const aldric = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === HIGHWATCH_ALDRIC && !e.dead,
  )!;
  p.pos.x = aldric.pos.x;
  p.pos.z = aldric.pos.z;
  p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(p);
  return { sim, pid };
}

describe('Sim.acceptQuest quest-item fallback', () => {
  it('re-grants the Crypt Keystone when the player accepts the quest without it', () => {
    const { sim, pid } = makeAttunedPlayerAtGiver();
    expect(sim.countItem(KEYSTONE, pid)).toBe(0);
    sim.acceptQuest(BOUND_GUARDIAN, pid);
    expect(sim.players.get(pid)!.questLog.get(BOUND_GUARDIAN)?.state).toBe('active');
    expect(sim.countItem(KEYSTONE, pid)).toBe(1);
  });

  it('does not duplicate the keystone when the player already holds one', () => {
    const { sim, pid } = makeAttunedPlayerAtGiver();
    sim.addItem(KEYSTONE, 1, pid);
    sim.acceptQuest(BOUND_GUARDIAN, pid);
    expect(sim.countItem(KEYSTONE, pid)).toBe(1);
  });

  it('grants the required item past a FULL bag, the ratified capacity bypass', () => {
    // RULED (qr-19-qprofintro-overflow-grant, 2026-09-01): the requiredItems
    // fallback grant deliberately skips the capacity pre-check on accept,
    // because a required item the player can no longer obtain must never be
    // lost to a full bag. That was doctrine in a comment and nothing measured
    // it, so a later capacity gate could soft-lock the chain while every suite
    // stayed green. This arm is the measurement.
    const { sim, pid } = makeAttunedPlayerAtGiver();
    const meta = sim.players.get(pid)!;
    const capacity = bagCapacity(meta.bags);
    // Fill the REMAINING general slots with distinct junk ids, so nothing can
    // merge into an existing stack and quietly make room. Counting the free
    // slots rather than assuming an empty bag keeps this honest if the starter
    // kit ever changes.
    const need = capacity - meta.inventory.length;
    expect(need, 'the fresh player leaves room to fill').toBeGreaterThan(0);
    const filler = Object.values(ITEMS)
      .filter((d) => d.kind === 'junk' && d.id !== KEYSTONE)
      .slice(0, need);
    expect(filler.length, 'enough distinct junk ids to fill the bags').toBe(need);
    for (const def of filler) sim.addItem(def.id, 1, pid);
    expect(meta.inventory.length, 'bags are exactly full before the accept').toBe(capacity);

    sim.acceptQuest(BOUND_GUARDIAN, pid);

    expect(meta.questLog.get(BOUND_GUARDIAN)?.state, 'the accept still succeeds').toBe('active');
    expect(sim.countItem(KEYSTONE, pid), 'the required item is granted anyway').toBe(1);
    expect(
      meta.inventory.length,
      'and the bag is deliberately left OVER capacity rather than the grant refused',
    ).toBeGreaterThan(capacity);
  });

  it('the turn-in reward DOES gate on a full bag, the other half of the asymmetry', () => {
    // The asymmetry is the design, per the same ruling and the capacity
    // doctrine header in src/sim/bags.ts: the grant bypasses, the REWARD does
    // not. Pinning only the bypass would let the reward silently start
    // bypassing too and nothing would notice.
    const { sim, pid } = makeAttunedPlayerAtGiver();
    const meta = sim.players.get(pid)!;
    const capacity = bagCapacity(meta.bags);
    const need = capacity - meta.inventory.length;
    const filler = Object.values(ITEMS)
      .filter((d) => d.kind === 'junk' && d.id !== KEYSTONE)
      .slice(0, need);
    for (const def of filler) sim.addItem(def.id, 1, pid);
    // The accept itself is the bypass path and is expected to overflow.
    sim.acceptQuest(BOUND_GUARDIAN, pid);
    expect(meta.inventory.length, 'the accept overflowed, as the bypass allows').toBeGreaterThan(
      capacity,
    );
    // countFit is what the reward path consults. Ask it for an id the player
    // does NOT already hold, so no existing stack can absorb it: the keystone
    // itself would top up the stack the accept just granted and read as room
    // that does not exist for a fresh item.
    const unheld = Object.values(ITEMS).find(
      (d) => d.kind === 'junk' && !meta.inventory.some((s) => s.itemId === d.id),
    );
    const rewardId = expectDefined(unheld).id;
    const rewardable = countFit(meta.inventory, bagPools(meta.bags), rewardId, 1);
    expect(rewardable, 'the reward path finds no room on this same bag').toBe(0);
  });
});
