import { describe, expect, it } from 'vitest';
import { questFallbackGrants } from '../src/sim/quest_fallback';
import { QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import type { Entity, QuestDef } from '../src/sim/types';

const BOUND_GUARDIAN = 'q_nythraxis_bound_guardian';
const KEYSTONE = 'crypt_keystone';
const HIGHWATCH_ALDRIC = 'brother_aldric_highwatch';

function quest(extra: Partial<QuestDef>): QuestDef {
  return {
    id: 'q_test', name: 'Test', giverNpcId: 'g', turnInNpcId: 'g',
    text: '', completionText: '', objectives: [], xpReward: 0, copperReward: 0,
    itemRewards: {}, ...extra,
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
    const out = questFallbackGrants(
      quest({ requiredItems: ['a', 'b', 'c', 'a'] }),
      (id) => have.has(id),
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
});
