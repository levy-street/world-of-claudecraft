import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';
import { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, id: number, x: number, z: number) {
  const e = sim.entities.get(id)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function spawnMob(sim: Sim, id: number, x: number, z: number) {
  const mob = createMob(id, MOBS['forest_wolf'], 5, sim.groundPos(x, z));
  sim.entities.set(id, mob);
  return mob;
}

function lastError(events: SimEvent[], pid: number): string | undefined {
  const errs = events.filter(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return errs.length ? errs[errs.length - 1].text : undefined;
}

function formParty(sim: Sim, leader: number, members: number[]) {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

// Drive /assist through Sim.chat: parse the command, build the (scoped) roster, apply
// the target, and read the self-only reply. This is the Sim.chat-side companion to the
// pure-core assist.test.ts; it locks the candidate scoping (interest range + party).
describe('/assist command (Sim.chat)', () => {
  it('targets a nearby player\'s target and replies "Assisting X."', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, -300, 0);
    teleport(sim, b, -300, 5); // within ASSIST_RANGE of Aleph
    const mob = spawnMob(sim, 90001, -290, 5);
    sim.targetEntity(mob.id, b); // Bet is fighting the wolf

    expect(sim.chat('/assist Bet', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe('Assisting Bet.');
    expect(sim.entities.get(a)!.targetId).toBe(mob.id);
  });

  it('supports the /as alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, -300, 0);
    teleport(sim, b, -300, 5);
    const mob = spawnMob(sim, 90002, -290, 5);
    sim.targetEntity(mob.id, b);

    expect(sim.chat('/as Bet', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe('Assisting Bet.');
    expect(sim.entities.get(a)!.targetId).toBe(mob.id);
  });

  it('replies "X has no target." when the named player has nothing targeted', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, -300, 0);
    teleport(sim, b, -300, 5);

    expect(sim.chat('/assist Bet', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe('Bet has no target.');
  });

  it('resolves a party member by name regardless of distance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    formParty(sim, a, [b]);
    teleport(sim, a, -300, 0);
    teleport(sim, b, 300, 0); // far across the map, but in Aleph's party
    const mob = spawnMob(sim, 90003, 305, 0);
    sim.targetEntity(mob.id, b);

    expect(sim.chat('/assist Bet', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe('Assisting Bet.');
    expect(sim.entities.get(a)!.targetId).toBe(mob.id);
  });

  it('does not resolve a distant, non-party player (out of interest range)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, -300, 0);
    teleport(sim, b, 300, 0); // far away and not partied
    const mob = spawnMob(sim, 90004, 305, 0);
    sim.targetEntity(mob.id, b);

    expect(sim.chat('/assist Bet', a)).toBeNull();
    // Bet is outside the roster, so it reads as "no player named ... online".
    expect(lastError(sim.events, a)).toBe("There is no player named 'Bet' online.");
    expect(sim.entities.get(a)!.targetId).toBeNull();
  });

  it('refuses to assist yourself', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, -300, 0);
    expect(sim.chat('/assist Aleph', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe("You can't assist yourself.");
  });

  it('with no name, assists the player you currently have targeted', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, -300, 0);
    teleport(sim, b, -300, 5);
    const mob = spawnMob(sim, 90005, -290, 5);
    sim.targetEntity(mob.id, b);
    sim.targetEntity(b, a); // Aleph has Bet targeted

    expect(sim.chat('/assist', a)).toBeNull();
    expect(lastError(sim.events, a)).toBe('Assisting Bet.');
    expect(sim.entities.get(a)!.targetId).toBe(mob.id);
  });
});
