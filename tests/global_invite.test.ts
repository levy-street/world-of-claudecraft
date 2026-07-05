import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find(
    (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
  );
  return e?.text;
}

// Put two entities far enough apart that any proximity gate (trade is 10yd,
// duel 30yd, interest scope ~90yd) would reject them.
function placeFarApart(sim: Sim, a: number, b: number) {
  sim.entities.get(a)!.pos.x = 0;
  sim.entities.get(a)!.pos.z = 0;
  sim.entities.get(b)!.pos.x = 1000;
  sim.entities.get(b)!.pos.z = 1000;
}

describe('/invite — global party invite by name', () => {
  it('invites a player across the whole world (no proximity required)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    placeFarApart(sim, a, b);

    const sent = sim.chat('/invite Bet', a);
    expect(sent).toBeNull(); // a command, never a broadcast chat line

    // The invite landed despite the 1000yd separation.
    const ev = sim.tick();
    expect(ev.some((e) => e.type === 'partyInvite' && e.pid === b)).toBe(true);

    // Accepting forms the party for both, confirming the end-to-end flow.
    sim.partyAccept(b);
    const partyA = sim.partyOf(a);
    expect(partyA).not.toBeNull();
    expect(sim.partyOf(b)).toBe(partyA);
    expect(partyA!.leader).toBe(a);
  });

  it('resolves the name case-insensitively when unambiguous', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    sim.chat('/invite bet', a); // lowercase
    expect(sim.tick().some((e) => e.type === 'partyInvite' && e.pid === b)).toBe(true);
  });

  it('keeps /inv as the inventory readout, never an invite alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    sim.chat('/inv Bet', a);
    expect(sim.tick().some((e) => e.type === 'partyInvite' && e.pid === b)).toBe(false);
  });

  it('errors on an unknown name (recognized "no player named" toast)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/invite Nobody', a);
    expect(errorText(sim.tick(), a)).toBe("There is no player named 'Nobody' online.");
  });

  it('errors with a usage hint when no name is given', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/invite', a);
    expect(errorText(sim.tick(), a)).toBe('Invite whom? Usage: /invite <name>.');
  });

  it('delegates party validation: cannot invite someone already in a party', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.tick();
    // b joins c's party first.
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    sim.tick();
    sim.chat('/invite Bet', a);
    expect(errorText(sim.tick(), a)).toBe('Bet is already in a party.');
  });
});
