import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find(
    (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
  );
  return e?.text;
}

describe('/buyback command', () => {
  it('reports an empty buyback list', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/buyback', a);
    expect(errorText(sim.tick(), a)).toBe('Your vendor buyback list is empty.');
  });

  it('lists buyback items most-recent first with per-item repurchase price', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    // most-recent-first, as recordVendorBuyback unshifts each sale
    meta.vendorBuyback = [
      { itemId: 'wolf_fang', count: 3 },
      { itemId: 'worn_sword', count: 1 },
    ];
    sim.tick();

    sim.chat('/buyback', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Vendor buyback (2): Cracked Wolf Fang x3 (4c each), Worn Shortsword (10c each). Repurchase at any merchant.',
    );
  });

  it('ignores stale entries with unknown items or zero count', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(a)!;
    meta.vendorBuyback = [
      { itemId: 'no_such_item', count: 2 },
      { itemId: 'worn_sword', count: 0 },
      { itemId: 'wolf_fang', count: 1 },
    ];
    sim.tick();

    sim.chat('/buyback', a);
    expect(errorText(sim.tick(), a)).toBe(
      'Vendor buyback (1): Cracked Wolf Fang (4c each). Repurchase at any merchant.',
    );
  });

  it('is reachable via the /bb and /repurchase aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/bb', a);
    expect(errorText(sim.tick(), a)).toBe('Your vendor buyback list is empty.');
    sim.chat('/repurchase', a);
    expect(errorText(sim.tick(), a)).toBe('Your vendor buyback list is empty.');
  });

  it('does not broadcast a chat message for the readout', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const sent = sim.chat('/buyback', a);
    expect(sent).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
