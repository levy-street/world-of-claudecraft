import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid);
  return e?.text;
}

// Form a party with `leader` as leader and the rest as members, in order.
function formParty(sim: Sim, leader: number, members: number[]) {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

describe('/party readout command', () => {
  it('lists party members with level, class, and HP%, tagging the leader', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.tick();
    formParty(sim, a, [b, c]);

    // Wound Gimel to a known HP% so the readout is deterministic.
    const ce = sim.entities.get(c)!;
    ce.hp = Math.round(ce.maxHp * 0.4);

    const sent = sim.chat('/party', a);
    expect(sent).toBeNull(); // self-only readout is never broadcast
    const text = errorText(sim.tick(), a);
    expect(text).toBeDefined();
    expect(text).toContain('Party (3/5):');
    expect(text).toContain('Aleph');
    expect(text).toContain('[leader]');
    expect(text).toContain('Bet');
    expect(text).toContain('100%');
    expect(text).toContain('Gimel');
    expect(text).toContain('40%');
  });

  it('reports when you are not in a party', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Solo');
    sim.tick();
    sim.chat('/party', a);
    expect(errorText(sim.tick(), a)).toBe('You are not in a party.');
  });

  it('shows dead members as (dead)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    sim.tick();
    formParty(sim, a, [b]);
    sim.entities.get(b)!.hp = 0;

    sim.chat('/group', a); // alias
    const text = errorText(sim.tick(), a);
    expect(text).toContain('Bet');
    expect(text).toContain('(dead)');
  });
});
