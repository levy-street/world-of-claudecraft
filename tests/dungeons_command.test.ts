import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST, zoneAt } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorTexts(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.text] : []));
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
    // The readout comes first, then the difficulty status line (heroic feature).
    const texts = errorTexts(sim.tick());
    expect(texts[texts.length - 2]).toBe(expected);
    expect(texts[texts.length - 1]).toBe(
      'Dungeon difficulty: Normal. Use /dungeon heroic to change it.',
    );
  });

  it('responds to the /dungeon and /instances aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dungeon', a);
    const first = errorTexts(sim.tick()).find((t) => t.startsWith('Dungeons ('));
    sim.chat('/instances', a);
    const second = errorTexts(sim.tick()).find((t) => t.startsWith('Dungeons ('));

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
