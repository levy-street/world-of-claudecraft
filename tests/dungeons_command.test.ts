import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { DUNGEON_LIST, zoneAt } from '../src/sim/data';

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

describe('/dungeons command', () => {
  it('lists every dungeon with its door zone and suggested party size', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const parts = DUNGEON_LIST.map(
      (d) => `${d.name} (${zoneAt(d.doorPos.z).name}, ${d.suggestedPlayers} players)`,
    );
    const expected = `Dungeons (${parts.length}): ${parts.join(', ')}.`;

    sim.chat('/dungeons', a);
    expect(lastError(sim.tick())).toBe(expected);
  });

  it('responds to the /dungeon and /instances aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dungeon', a);
    const first = lastError(sim.tick());
    sim.chat('/instances', a);
    const second = lastError(sim.tick());

    expect(first).toMatch(/^Dungeons \(/);
    expect(second).toBe(first);
  });

  it('is self-only and never logged or spoken', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const result = sim.chat('/dungeons', a);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
