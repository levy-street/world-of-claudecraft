import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function eventTexts(events: SimEvent[], type: 'log' | 'error'): string[] {
  return events
    .filter((event): event is Extract<SimEvent, { type: 'log' | 'error' }> => event.type === type)
    .map((event) => event.text);
}

describe('dev quest completion commands', () => {
  it('completes a tracked collect quest through the normal turn-in flow', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.meta(pid)!;
    sim.tick();
    meta.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    const completedBefore = meta.counters.questsCompleted;
    sim.events = [];

    expect(sim.completeQuestForDev('q_boars', pid)).toBe(true);
    expect(meta.questLog.has('q_boars')).toBe(false);
    expect(meta.questsDone.has('q_boars')).toBe(true);
    expect(meta.counters.questsCompleted).toBe(completedBefore + 1);
    expect(sim.countItem('boar_hide', pid)).toBe(0);
    expect(sim.events).toContainEqual({ type: 'questDone', questId: 'q_boars', pid });
  });

  it('auto-accepts an available quest by id and completes it', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.meta(pid)!;
    sim.tick();
    sim.events = [];

    expect(sim.questState('q_wolves', pid)).toBe('available');
    expect(sim.completeQuestForDev('q_wolves', pid)).toBe(true);
    expect(meta.questLog.has('q_wolves')).toBe(false);
    expect(meta.questsDone.has('q_wolves')).toBe(true);
    expect(sim.events).toContainEqual({ type: 'questAccepted', questId: 'q_wolves', pid });
    expect(sim.events).toContainEqual({ type: 'questDone', questId: 'q_wolves', pid });
  });

  it('rejects unknown and unavailable quest ids', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.events = [];

    expect(sim.completeQuestForDev('no_such_quest', pid)).toBe(false);
    expect(sim.completeQuestForDev('q_bandits', pid)).toBe(false);
    expect(eventTexts(sim.events, 'error')).toEqual([
      'That quest is not available.',
      'That quest is not available.',
    ]);
  });

  it('completes only the quests currently tracked in the log', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.meta(pid)!;
    sim.tick();
    meta.questLog.set('q_wolves', { questId: 'q_wolves', counts: [0], state: 'active' });
    meta.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    sim.events = [];

    expect(sim.completeCurrentQuestsForDev(pid)).toBe(2);
    expect(meta.questsDone.has('q_wolves')).toBe(true);
    expect(meta.questsDone.has('q_boars')).toBe(true);
    expect(meta.questLog.size).toBe(0);
    expect(meta.questsDone.has('q_bandits')).toBe(false);
    expect(meta.questLog.has('q_bandits')).toBe(false);
  });
});

// D8: the cheat tops a collect objective up to its required count, and it has
// to count the same grades the real credit path counts (quest_credit.ts).
// Otherwise it mints plain copies on top of a bag that already satisfies the
// objective, and the player's own tracker and the cheat disagree about what
// "satisfied" means.
describe('dev collect satisfier spans material grades', () => {
  it('spends the fine copies it already holds instead of minting plain ones', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.meta(pid)!;
    sim.tick();
    // q_prof_workorder_forge collects copper_ore x8, an eastbrook material, so
    // this is the bag of a player who out-tooled the zone.
    for (let i = 0; i < 8; i++) sim.addItem('fine_copper_ore', 1, pid);

    // completeQuestForDev auto-accepts, tops the objective up, then turns in.
    expect(sim.completeQuestForDev('q_prof_workorder_forge', pid)).toBe(true);
    expect(meta.questsDone.has('q_prof_workorder_forge')).toBe(true);

    // The decisive pair. Grade-aware: the satisfier saw the objective already
    // covered, minted nothing, and the turn-in spent the fine copies. Blind to
    // grades: it would have minted 8 plain, base-first consumption would have
    // spent THOSE, and the 8 fine copies would still be sitting here.
    expect(sim.countItem('fine_copper_ore', pid)).toBe(0);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
  });

  it('still tops up when the bag holds neither grade', () => {
    // The control: the satisfier is not simply inert. Without this the case
    // above would pass on a cheat that had stopped granting anything at all.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.meta(pid)!;
    sim.tick();

    expect(sim.completeQuestForDev('q_prof_workorder_forge', pid)).toBe(true);
    expect(meta.questsDone.has('q_prof_workorder_forge')).toBe(true);
  });
});
