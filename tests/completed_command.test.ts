import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { QUESTS } from '../src/sim/data';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function lastError(events: SimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.text;
  }
  return undefined;
}

describe('/completed command', () => {
  it('reports an empty completion log for a fresh character', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/completed', a);
    expect(lastError(sim.tick())).toBe('You have not completed any quests yet.');
  });

  it('lists turned-in quests in completion order with their names', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const ids = Object.keys(QUESTS).slice(0, 2);
    const meta = [...sim.players.values()].find((m) => m.entityId === a)!;
    for (const id of ids) meta.questsDone.add(id);

    const expected = `Completed quests (${ids.length}): ${ids.map((id) => QUESTS[id].name).join(', ')}.`;
    sim.chat('/questsdone', a);
    expect(lastError(sim.tick())).toBe(expected);
  });

  it('is self-only and never logged or spoken', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const result = sim.chat('/qdone', a);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
