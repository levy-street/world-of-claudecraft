import { describe, expect, it } from 'vitest';
import { Sim, eloDelta } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { isArenaPos } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Queue two players and advance one tick so matchmaking seats them.
function queueDuo(aClass: PlayerClass = 'warrior', bClass: PlayerClass = 'mage'): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer(aClass, 'Aleph');
  const b = sim.addPlayer(bClass, 'Bet');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 6, -40);
  sim.arenaQueueJoin(a);
  sim.arenaQueueJoin(b);
  sim.tick(); // updateArena() matchmakes the pair
  return { sim, a, b };
}

function face(sim: Sim, pid: number, targetId: number) {
  const e = sim.entities.get(pid)!;
  const t = sim.entities.get(targetId)!;
  e.facing = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
}

function finishCast(sim: Sim, pid: number) {
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick();
    if (!sim.entities.get(pid)!.castingAbility) return;
  }
}

// Run the countdown out so the bout goes live.
function startBout(sim: Sim) {
  for (let i = 0; i < 20 * 6; i++) {
    sim.tick();
    const m = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (m && m.state === 'active') return;
  }
}

describe('arena: Elo math', () => {
  it('even ratings split 16 points; zero-sum and symmetric', () => {
    expect(eloDelta(1500, 1500, 1)).toBe(16);
    // an upset (low beats high) is worth more than a favorite winning
    expect(eloDelta(1400, 1800, 1)).toBeGreaterThan(eloDelta(1800, 1400, 1));
    // a draw between equals moves nobody
    expect(eloDelta(1500, 1500, 0.5)).toBe(0);
  });
});

describe('arena: queue + matchmaking', () => {
  it('a lone contender waits; a second one triggers a match', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.arenaQueueJoin(a);
    sim.tick();
    expect(sim.arenaMatchFor(a)).toBe(null); // nobody to fight yet
    expect(sim.arenaInfoFor(a)!.queued).toBe(true);

    const b = sim.addPlayer('rogue', 'Bet');
    teleport(sim, b, 6, -40);
    sim.arenaQueueJoin(b);
    sim.tick();
    expect(sim.arenaMatchFor(a)).toBeTruthy();
    expect(sim.arenaMatchFor(b)).toBe(sim.arenaMatchFor(a)); // same shared match
    expect(sim.arenaInfoFor(a)!.queued).toBe(false);
  });

  it('leaving the queue cancels matchmaking', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.arenaQueueJoin(a);
    expect(sim.arenaQueue).toContain(a);
    sim.arenaQueueLeave(a);
    expect(sim.arenaQueue).not.toContain(a);
  });

  it('pairs the longest waiter with the nearest-rated challenger', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    for (const pid of [a, b, c]) teleport(sim, pid, 0, -40);
    sim.meta(a)!.arenaRating = 1500;
    sim.meta(b)!.arenaRating = 1800; // far from Aleph
    sim.meta(c)!.arenaRating = 1510; // closest to Aleph
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.arenaQueueJoin(c);
    sim.tick();
    // Aleph (front of line) should be matched against Gimel, not Bet
    const m = sim.arenaMatchFor(a)!;
    expect(m).toBeTruthy();
    expect([m.a, m.b].sort()).toEqual([a, c].sort());
    expect(sim.arenaMatchFor(b)).toBe(null); // Bet still waiting
    expect(sim.arenaInfoFor(b)!.queued).toBe(true);
  });

  it('cannot queue from inside an instance or while dead', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 80, 88);
    sim.enterCrypt(a); // now standing in a far-off instance
    sim.arenaQueueJoin(a);
    expect(sim.arenaQueue).not.toContain(a);
  });
});

describe('arena: a full bout', () => {
  it('teleports both fighters to the sands and gates damage to the active phase', () => {
    const { sim, a, b } = queueDuo();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    // both whisked away to the arena x-band, far from where they queued
    expect(isArenaPos(ea.pos.x)).toBe(true);
    expect(isArenaPos(eb.pos.x)).toBe(true);
    // same instance slot (close together in z)
    expect(Math.abs(ea.pos.z - eb.pos.z)).toBeLessThan(60);
    // countdown: not yet hostile, so no swing lands
    expect(sim.arenaMatchFor(a)!.state).toBe('countdown');
    expect(sim.isHostileTo(ea, eb)).toBe(false);

    startBout(sim);
    expect(sim.arenaMatchFor(a)!.state).toBe('active');
    expect(sim.isHostileTo(ea, eb)).toBe(true);
    // both started the bout at full health
    expect(ea.hp).toBe(ea.maxHp);
    expect(eb.hp).toBe(eb.maxHp);
  });

  it('keeps buffs cast during the countdown when the fight starts', () => {
    const { sim, b } = queueDuo();
    const mage = sim.entities.get(b)!;

    sim.castAbility('frost_armor', b);
    expect(mage.auras.some((aura) => aura.id === 'frost_armor')).toBe(true);

    startBout(sim);

    expect(sim.arenaMatchFor(b)!.state).toBe('active');
    expect(mage.auras.some((aura) => aura.id === 'frost_armor')).toBe(true);
  });

  it('ends at 1 health: winner declared and scored at once, then a 5s aftermath returns both', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    const rA0 = sim.meta(a)!.arenaRating;
    const rB0 = sim.meta(b)!.arenaRating;

    // Aleph lands a decisive blow
    (sim as any).dealDamage(ea, eb, 99999, false, 'physical', null, 'hit');
    const ev = sim.tick();
    const end = ev.find((e) => e.type === 'arenaEnd');

    // scored immediately: winner declared, zero-sum Elo, loser yields (no death)
    expect(end).toBeTruthy();
    expect(eb.hp).toBeGreaterThanOrEqual(1);
    expect(eb.dead).toBe(false);
    expect(sim.meta(a)!.arenaRating).toBe(rA0 + 16);
    expect(sim.meta(b)!.arenaRating).toBe(rB0 - 16);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaLosses).toBe(1);
    // but they hold on the sands for the aftermath rather than returning at once
    expect(sim.arenaMatchFor(a)!.state).toBe('over');
    expect(isArenaPos(ea.pos.x)).toBe(true);

    // run the ~5s aftermath out
    for (let i = 0; i < 20 * 6 && sim.arenaMatchFor(a); i++) sim.tick();

    // match cleaned up; both restored to where they queued (0,-40)/(6,-40), healed
    expect(sim.arenaMatchFor(a)).toBe(null);
    expect(sim.arenaMatchFor(b)).toBe(null);
    expect(isArenaPos(ea.pos.x)).toBe(false);
    expect(isArenaPos(eb.pos.x)).toBe(false);
    expect(Math.hypot(ea.pos.x - 0, ea.pos.z - (-40))).toBeLessThan(3);
    expect(Math.hypot(eb.pos.x - 6, eb.pos.z - (-40))).toBeLessThan(3);
    expect(ea.hp).toBe(ea.maxHp);
    expect(eb.hp).toBe(eb.maxHp);
  });

  it('a slot frees up after the bout so the arena can host again', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    (sim as any).dealDamage(ea, eb, 99999, false, 'physical', null, 'hit');
    // run the aftermath out so the slot is released
    for (let i = 0; i < 20 * 6 && sim.arenaMatchFor(a); i++) sim.tick();
    expect(sim.arenaMatchFor(a)).toBe(null);
    // A third contender can still be seated immediately: the free-slot check
    // must not be confused by the new rematch cooldown for Aleph/Bet.
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, c, 12, -40);
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.arenaQueueJoin(c);
    sim.tick();
    expect(sim.arenaMatchFor(a)).toBeTruthy();
    const rematch = sim.arenaMatchFor(a)!;
    expect([rematch.a, rematch.b].sort()).toEqual([a, c].sort());
    expect(sim.arenaMatchFor(b)).toBe(null);
    expect(sim.arenaInfoFor(b)!.queued).toBe(true);
  });

  it('does not immediately rematch the same pair after a bout', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    (sim as any).dealDamage(sim.entities.get(a)!, sim.entities.get(b)!, 99999, false, 'physical', null, 'hit');
    for (let i = 0; i < 20 * 6 && sim.arenaMatchFor(a); i++) sim.tick();

    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.tick();

    expect(sim.arenaMatchFor(a)).toBe(null);
    expect(sim.arenaMatchFor(b)).toBe(null);
    expect(sim.arenaInfoFor(a)!.queued).toBe(true);
    expect(sim.arenaInfoFor(b)!.queued).toBe(true);
  });

  it('keeps same-character rematch cooldowns across reconnects', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph', { characterKey: 'char:1' });
    const b = sim.addPlayer('mage', 'Bet', { characterKey: 'char:2' });
    teleport(sim, a, 0, -40);
    teleport(sim, b, 6, -40);
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.tick();
    startBout(sim);
    (sim as any).dealDamage(sim.entities.get(a)!, sim.entities.get(b)!, 99999, false, 'physical', null, 'hit');
    for (let i = 0; i < 20 * 6 && sim.arenaMatchFor(a); i++) sim.tick();
    sim.removePlayer(a);
    sim.removePlayer(b);

    const a2 = sim.addPlayer('warrior', 'Aleph', { characterKey: 'char:1' });
    const b2 = sim.addPlayer('mage', 'Bet', { characterKey: 'char:2' });
    teleport(sim, a2, 0, -40);
    teleport(sim, b2, 6, -40);
    sim.arenaQueueJoin(a2);
    sim.arenaQueueJoin(b2);
    sim.tick();

    expect(sim.arenaMatchFor(a2)).toBe(null);
    expect(sim.arenaMatchFor(b2)).toBe(null);
  });
});

describe('arena: forfeit + persistence', () => {
  it('disconnecting mid-bout forfeits the match to the opponent', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const rA0 = sim.meta(a)!.arenaRating;
    sim.removePlayer(b); // Bet rage-quits
    expect(sim.arenaMatchFor(a)).toBe(null);
    expect(sim.meta(a)!.arenaRating).toBe(rA0 + 16); // Aleph wins by forfeit
    expect(sim.meta(a)!.arenaWins).toBe(1);
    // Aleph is back in the overworld, not stranded on the sands
    expect(isArenaPos(sim.entities.get(a)!.pos.x)).toBe(false);
  });

  it('rating, wins and losses round-trip through CharacterState', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('paladin', 'Tyr');
    sim.meta(a)!.arenaRating = 1742;
    sim.meta(a)!.arenaWins = 9;
    sim.meta(a)!.arenaLosses = 4;
    const state = sim.serializeCharacter(a)!;
    expect(state.arenaRating).toBe(1742);
    expect(state.arenaWins).toBe(9);
    expect(state.arenaLosses).toBe(4);

    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('paladin', 'Tyr', { state });
    expect(sim2.meta(a2)!.arenaRating).toBe(1742);
    expect(sim2.meta(a2)!.arenaWins).toBe(9);
    expect(sim2.meta(a2)!.arenaLosses).toBe(4);
  });

  it('unranked characters default to 1500', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Cenarius');
    expect(sim.meta(a)!.arenaRating).toBe(1500);
    expect(sim.arenaInfoFor(a)!.rating).toBe(1500);
  });

  it('the online ladder sorts rated players best first', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Low');
    const b = sim.addPlayer('mage', 'High');
    const c = sim.addPlayer('rogue', 'Mid');
    sim.meta(a)!.arenaRating = 1400;
    sim.meta(b)!.arenaRating = 1900;
    sim.meta(c)!.arenaRating = 1600;
    const ladder = sim.arenaLadder();
    expect(ladder.map((r) => r.name)).toEqual(['High', 'Mid', 'Low']);
  });
});

describe('arena: crowd control diminishing returns', () => {
  it('shortens repeated roots on the same arena target, then resets', () => {
    const { sim, a, b } = queueDuo('druid', 'warrior');
    startBout(sim);
    const druid = sim.entities.get(a)!;
    const warrior = sim.entities.get(b)!;
    (sim as any).rng.chance = () => true;
    sim.setPlayerLevel(8, a);
    druid.pos.x = warrior.pos.x;
    druid.pos.z = warrior.pos.z - 8;
    druid.targetId = b;
    face(sim, a, b);

    const castRoot = () => {
      druid.resource = druid.maxResource;
      druid.gcdRemaining = 0;
      sim.castAbility('entangling_roots', a);
      finishCast(sim, a);
    };

    castRoot();
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(12);
    warrior.auras = [];

    castRoot();
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(6);
    warrior.auras = [];

    castRoot();
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(3);
    warrior.auras = [];

    castRoot();
    expect(warrior.auras.some((aura) => aura.kind === 'root')).toBe(false);

    for (let i = 0; i < 20 * 18; i++) sim.tick();
    castRoot();
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(12);
  });

  it('lets Frost Nova root arena opponents through the same root category', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const warrior = sim.entities.get(a)!;
    const mage = sim.entities.get(b)!;
    sim.setPlayerLevel(10, b);
    mage.pos.x = warrior.pos.x;
    mage.pos.z = warrior.pos.z - 4;
    mage.facing = 0;

    sim.castAbility('frost_nova', b);
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(8);
    warrior.auras = [];
    mage.gcdRemaining = 0;
    mage.cooldowns.clear();

    sim.castAbility('frost_nova', b);
    expect(warrior.auras.find((aura) => aura.kind === 'root')?.duration).toBe(4);
  });
});
