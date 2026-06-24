import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

// Two players in one party, not near any quest giver. Returns their pids + sim.
function partyOfTwo() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
  const a = sim.addPlayer('warrior', 'Aki'); // sharer
  const b = sim.addPlayer('warrior', 'Bex'); // recipient
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  return { sim, a, b };
}

// Pick a real, low-level, no-prerequisite quest from the live table.
function simpleQuestId(): string {
  const id = Object.keys(QUESTS).find((q) => {
    const def = QUESTS[q];
    return (
      !def.requiresQuest && !def.retired && (def.minLevel ?? 1) <= 1 && def.shareable !== false
    );
  });
  if (!id) throw new Error('no simple shareable quest found');
  return id;
}

describe('acceptLinkedQuest', () => {
  it('a party member accepts a shared quest with no giver NPC nearby', () => {
    const { sim, a, b } = partyOfTwo();
    const q = simpleQuestId();
    sim.acceptLinkedQuest(q, a, b);
    expect(sim.questState(q, b)).toBe('active');
  });

  it('notifies the sharer when accepted', () => {
    const { sim, a, b } = partyOfTwo();
    const q = simpleQuestId();
    sim.tick(); // drain prior events
    sim.acceptLinkedQuest(q, a, b);
    const events = sim.tick();
    const noticeToSharer = events.some(
      (e) =>
        e.type === 'log' &&
        (e as any).pid === a &&
        /accepted your shared quest/.test((e as any).text),
    );
    expect(noticeToSharer).toBe(true);
  });

  it('rejects a non-party clicker', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aki');
    const c = sim.addPlayer('warrior', 'Cas'); // NOT in a party with Aki
    const q = simpleQuestId();
    sim.acceptLinkedQuest(q, a, c);
    expect(sim.questState(q, c)).not.toBe('active');
  });

  it('rejects a non-shareable quest', () => {
    const { sim, a, b } = partyOfTwo();
    const q = simpleQuestId();
    QUESTS[q].shareable = false;
    try {
      sim.acceptLinkedQuest(q, a, b);
      expect(sim.questState(q, b)).not.toBe('active');
    } finally {
      delete QUESTS[q].shareable; // restore shared table for other tests
    }
  });

  it('rejects when the recipient is below minLevel', () => {
    const { sim, a, b } = partyOfTwo();
    const q = Object.keys(QUESTS).find(
      (x) =>
        (QUESTS[x].minLevel ?? 1) > 1 && !QUESTS[x].requiresQuest && QUESTS[x].shareable !== false,
    );
    if (!q) return; // no such quest in this content set; skip
    sim.acceptLinkedQuest(q, a, b); // recipient is level 1
    expect(sim.questState(q, b)).not.toBe('active');
  });

  it('rejects a quest the recipient already has', () => {
    const { sim, a, b } = partyOfTwo();
    const q = simpleQuestId();
    sim.acceptLinkedQuest(q, a, b);
    expect(sim.questState(q, b)).toBe('active');
    sim.acceptLinkedQuest(q, a, b); // second accept is a no-op (already active)
    expect(sim.questState(q, b)).toBe('active');
  });

  it('re-grants a missing required item on linked accept (parity with acceptQuest)', () => {
    // q_nythraxis_bound_guardian needs the Crypt Keystone, earned in the prior quest.
    // A party member who no longer holds it must have it re-granted on accept, exactly
    // as the NPC path does, or the quest is permanently uncompletable.
    const { sim, a, b } = partyOfTwo();
    const q = 'q_nythraxis_bound_guardian';
    const def = QUESTS[q];
    expect(def.requiredItems).toContain('crypt_keystone');
    // Make the recipient eligible (level + prerequisite) but NOT holding the keystone.
    sim.setPlayerLevel(def.minLevel ?? 20, b);
    (sim as any).resolve(b).meta.questsDone.add(def.requiresQuest as string);
    expect(sim.questState(q, b)).toBe('available');
    expect((sim as any).countItem('crypt_keystone', b)).toBe(0);

    sim.acceptLinkedQuest(q, a, b);

    expect(sim.questState(q, b)).toBe('active');
    expect((sim as any).countItem('crypt_keystone', b)).toBeGreaterThan(0);
  });

  it('is deterministic — same inputs, same result twice', () => {
    const run = () => {
      const { sim, a, b } = partyOfTwo();
      const q = simpleQuestId();
      sim.acceptLinkedQuest(q, a, b);
      return sim.questState(q, b);
    };
    expect(run()).toBe(run());
  });
});
