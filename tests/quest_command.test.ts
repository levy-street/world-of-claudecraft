// The /quest command (aliases /quests, /ql) is a self-only readout of the
// active quest log: one entry per tracked quest with per-objective progress.
// Like the other readout commands it emits a single 'error' event addressed to
// the caller and returns null, so it never enters the chat log and needs no
// server interceptor to work online.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { QUESTS } from '../src/sim/data';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorTo(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid)
    .map((e) => e.text);
}

describe('/quest command', () => {
  it('reports an empty log when no quests are tracked', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    expect(sim.chat('/quest', a)).toBeNull();
    expect(errorTo(sim.tick(), a)).toContain('Your quest log is empty.');
  });

  it('lists each tracked quest with capped per-objective progress', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    // Pick a multi-objective quest if one exists, else the first quest.
    const quest =
      Object.values(QUESTS).find((q) => q.objectives.length > 1) ?? Object.values(QUESTS)[0];
    // Overshoot the first objective to prove the readout caps at the target.
    const counts = quest.objectives.map((o) => o.count);
    counts[0] = quest.objectives[0].count + 5;
    meta.questLog.set(quest.id, { questId: quest.id, counts, state: 'active' });
    sim.tick();

    expect(sim.chat('/quests', a)).toBeNull();
    const line = errorTo(sim.tick(), a).find((t) => t.startsWith('Quest log'));
    expect(line).toBeDefined();
    expect(line).toContain('Quest log (1):');
    expect(line).toContain(quest.name);
    const o0 = quest.objectives[0];
    expect(line).toContain(`${o0.label} ${o0.count}/${o0.count}`); // capped, not count+5
  });

  it('tags ready quests and is alias-compatible (/ql)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    const quest = Object.values(QUESTS)[0];
    meta.questLog.set(quest.id, {
      questId: quest.id,
      counts: quest.objectives.map((o) => o.count),
      state: 'ready',
    });
    sim.tick();

    expect(sim.chat('/ql', a)).toBeNull();
    const line = errorTo(sim.tick(), a).find((t) => t.startsWith('Quest log'));
    expect(line).toContain(`${quest.name} (ready)`);
  });
});
