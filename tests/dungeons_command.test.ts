import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { DUNGEON_LIST, DUNGEONS, zoneAt } from '../src/sim/data';
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

    const parts = DUNGEON_LIST.filter((d) => d.id !== FIRE_AND_FLY_DUNGEON_ID).map(
      (d) => `${d.name} (${zoneAt(d.doorPos.x, d.doorPos.z).name}, ${d.suggestedPlayers} players)`,
    );
    const expected = `Dungeons (${parts.length}): ${parts.join(', ')}.`;

    sim.chat('/dungeons', a);
    // The readout comes first, then the difficulty status line (heroic
    // feature), then the reset usage line.
    const texts = errorTexts(sim.tick());
    expect(texts[texts.length - 3]).toBe(expected);
    // The Fire and Fly arena is a private mini-game room, not a dungeon; the
    // door-less raid rooms around it stay listed.
    expect(texts[texts.length - 3]).not.toContain(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].name);
    expect(texts[texts.length - 3]).toContain('The Forge-Lift (');
    expect(texts[texts.length - 2]).toBe(
      'Dungeon difficulty: Normal. Use /dungeon heroic to change it.',
    );
    expect(texts[texts.length - 1]).toBe(
      'Use /dungeon reset to abandon your empty instances after changing difficulty.',
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
