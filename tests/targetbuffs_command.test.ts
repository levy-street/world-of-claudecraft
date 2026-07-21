import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  const e = events.find((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error');
  return e?.text;
}

function aura(partial: Partial<Aura> & Pick<Aura, 'name' | 'kind'>): Aura {
  return {
    id: partial.id ?? partial.name.toLowerCase(),
    name: partial.name,
    kind: partial.kind,
    remaining: partial.remaining ?? 10,
    duration: partial.duration ?? 10,
    value: partial.value ?? 0,
    sourceId: partial.sourceId ?? 0,
    school: partial.school ?? 'physical',
    stacks: partial.stacks,
  };
}

describe('/targetbuffs command', () => {
  it('reports no target when nothing is targeted', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/targetbuffs', a);
    expect(errorText(sim.tick())).toBe('You have no target.');
  });

  it('reports an empty effect list for a clean target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    sim.targetEntity(b, a);
    sim.chat('/targetbuffs', a);
    expect(errorText(sim.tick())).toBe('Bet has no active effects.');
  });

  it('tags each aura on the target as a buff or debuff with stacks and remaining time', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const target = sim.entities.get(b)!;
    target.auras = [
      aura({ name: 'Rend', kind: 'dot', remaining: 3.2 }),
      aura({ name: 'Sunder Armor', kind: 'sunder', remaining: 11.6, stacks: 3 }),
      aura({ name: 'Battle Shout', kind: 'buff_ap', remaining: 109.4 }),
    ];
    sim.targetEntity(b, a);
    sim.chat('/targetbuffs', a);
    expect(errorText(sim.tick())).toBe(
      'Effects on Bet (3): Rend [debuff] (4s), Sunder Armor x3 [debuff] (12s), Battle Shout [buff] (110s).',
    );
  });

  it('tags combat-penalty debuffs (silence/disarm) as debuffs, sharing the HUD classifier', () => {
    // Regression: these kinds were previously absent from the sim-local harmful set
    // and so mis-tagged as [buff]. Unifying onto isDebuffAura fixes the drift.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const target = sim.entities.get(b)!;
    target.auras = [
      aura({ name: 'Silenced', kind: 'silence', remaining: 4 }),
      aura({ name: 'Disarm', kind: 'disarm', remaining: 6 }),
      aura({ name: 'Sapped Might', kind: 'buff_ap', remaining: 8, value: -40 }),
    ];
    sim.targetEntity(b, a);
    sim.chat('/targetbuffs', a);
    expect(errorText(sim.tick())).toBe(
      'Effects on Bet (3): Silenced [debuff] (4s), Disarm [debuff] (6s), Sapped Might [debuff] (8s).',
    );
  });

  it('responds to the /debuffs and /tb aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/debuffs', a);
    expect(errorText(sim.tick())).toBe('You have no target.');
    sim.chat('/tb', a);
    expect(errorText(sim.tick())).toBe('You have no target.');
  });
});
