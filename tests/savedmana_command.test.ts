import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function chatEvents(events: SimEvent[]): Extract<SimEvent, { type: 'chat' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'chat' }> => e.type === 'chat');
}

function errorText(sim: Sim, cmd: string, pid: number): string | undefined {
  sim.chat(cmd, pid);
  const events = sim.tick();
  // a readout is self-only and must never leak as chat
  expect(chatEvents(events)).toHaveLength(0);
  const err = events.find((e) => e.type === 'error');
  return err && err.type === 'error' ? err.text : undefined;
}

describe('/savedmana command', () => {
  it('reports mana parked while a druid is shapeshifted', () => {
    const sim = makeWorld();
    const d = sim.addPlayer('druid', 'Ash');
    sim.tick();
    const e = sim.entities.get(d)!;
    // simulate bear form: the mana bar is swapped for rage and the mana pool
    // is parked aside (entity.ts:126-130)
    e.resourceType = 'rage';
    e.savedMana = 340;
    sim.tick();
    expect(errorText(sim, '/savedmana', d)).toBe(
      'You have 340 mana parked while shifted; it returns when you leave your form.',
    );
  });

  it('aliases /parkedmana and /sm work too', () => {
    const sim = makeWorld();
    const d = sim.addPlayer('druid', 'Ash');
    sim.tick();
    const e = sim.entities.get(d)!;
    e.resourceType = 'energy';
    e.savedMana = 12;
    sim.tick();
    const expected = 'You have 12 mana parked while shifted; it returns when you leave your form.';
    expect(errorText(sim, '/parkedmana', d)).toBe(expected);
    expect(errorText(sim, '/sm', d)).toBe(expected);
  });

  it('explains a druid that is not shapeshifted has no parked mana', () => {
    const sim = makeWorld();
    const d = sim.addPlayer('druid', 'Ash');
    sim.tick();
    expect(errorText(sim, '/savedmana', d)).toBe(
      'Your mana is not parked — you are not shapeshifted.',
    );
  });

  it('reports nothing parked when shifted with an empty saved pool', () => {
    const sim = makeWorld();
    const d = sim.addPlayer('druid', 'Ash');
    sim.tick();
    const e = sim.entities.get(d)!;
    e.resourceType = 'rage';
    e.savedMana = 0;
    sim.tick();
    expect(errorText(sim, '/savedmana', d)).toBe('You have no mana parked while shifted.');
  });

  it('tells non-mana classes the mechanic never applies', () => {
    const sim = makeWorld();
    const w = sim.addPlayer('warrior', 'Bron');
    sim.tick();
    expect(errorText(sim, '/savedmana', w)).toBe(
      'Only mana-using classes park mana; your class never does.',
    );
  });
});
