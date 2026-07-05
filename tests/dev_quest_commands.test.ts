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
