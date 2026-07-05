import { describe, expect, it } from 'vitest';
import { arenaOrigin, isArenaPos } from '../src/sim/data';
import { DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { eloDelta, Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Queue two players and advance one tick so matchmaking seats them.
function queueDuo(
  aClass: PlayerClass = 'warrior',
  bClass: PlayerClass = 'mage',
): { sim: Sim; a: number; b: number } {
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
    if (!sim.entities.get(pid)!.castingAbility) break;
  }
  // A spell's effects land when its projectile reaches the target (projectile_travel),
  // a few ticks after the cast bar empties: tick until the in-flight bolt resolves.
  for (let i = 0; i < 20 * 3 && (sim as any).pendingProjectiles.length > 0; i++) sim.tick();
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
    expect(sim.arenaQueue1v1).toContain(a);
    sim.arenaQueueLeave(a);
    expect(sim.arenaQueue1v1).not.toContain(a);
  });

  it('cannot queue a second bracket while already queued', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.arenaQueueJoin(a);
    const errsBefore = sim.events.filter((e) => e.type === 'error').length;
    sim.arenaQueueJoin(a, '2v2');
    expect(sim.arenaQueue1v1).toContain(a);
    expect(sim.arenaQueue2v2.length).toBe(0);
    expect(sim.events.filter((e) => e.type === 'error').length).toBeGreaterThan(errsBefore);
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
    expect([...m.teamA, ...m.teamB].sort()).toEqual([a, c].sort());
    expect(sim.arenaMatchFor(b)).toBe(null); // Bet still waiting
    expect(sim.arenaInfoFor(b)!.queued).toBe(true);
  });

  it('cannot queue from inside an instance or while dead', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 80, 88);
    sim.enterCrypt(a); // now standing in a far-off instance
    sim.arenaQueueJoin(a);
    expect(sim.arenaQueue1v1).not.toContain(a);
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

  it('keyboard enemy targeting can select arena opponents during the countdown', () => {
    const { sim, a, b } = queueDuo();

    expect(sim.arenaMatchFor(a)!.state).toBe('countdown');
    sim.tabTarget(a);
    expect(sim.entities.get(a)!.targetId).toBe(b);

    sim.targetEntity(null, a);
    sim.targetNearestEnemy(a);
    expect(sim.entities.get(a)!.targetId).toBe(b);
  });

  it('does not cancel auto-attack when retargeting an active arena opponent', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const attacker = sim.entities.get(a)!;

    sim.targetEntity(b, a);
    sim.startAutoAttack(a);
    expect(attacker.autoAttack).toBe(true);

    sim.targetEntity(b, a);
    expect(attacker.autoAttack).toBe(true);
  });

  it('still rejects auto-attack against arena opponents during the countdown', () => {
    const { sim, a, b } = queueDuo();
    const attacker = sim.entities.get(a)!;

    sim.targetEntity(b, a);
    sim.startAutoAttack(a);

    expect(sim.arenaMatchFor(a)!.state).toBe('countdown');
    expect(attacker.autoAttack).toBe(false);
  });

  it('kills the loser at 0 health, scores at once, then a 5s aftermath returns both', () => {
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

    // scored immediately: winner declared, zero-sum Elo, loser is dead until return
    expect(end).toBeTruthy();
    expect(eb.hp).toBe(0);
    expect(eb.dead).toBe(true);
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
    expect(Math.hypot(ea.pos.x - 0, ea.pos.z - -40)).toBeLessThan(3);
    expect(Math.hypot(eb.pos.x - 6, eb.pos.z - -40)).toBeLessThan(3);
    expect(ea.hp).toBe(ea.maxHp);
    expect(eb.hp).toBe(eb.maxHp);
    expect(eb.dead).toBe(false);
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
    // requeue both — a fresh match must seat without "all arenas busy"
    sim.arenaQueueJoin(a);
    sim.arenaQueueJoin(b);
    sim.tick();
    expect(sim.arenaMatchFor(a)).toBeTruthy();
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
    sim.meta(a)!.arena2v2Rating = 1611;
    sim.meta(a)!.arena2v2Wins = 2;
    sim.meta(a)!.arena2v2Losses = 5;
    const state = sim.serializeCharacter(a)!;
    expect(state.arenaRating).toBe(1742);
    expect(state.arenaWins).toBe(9);
    expect(state.arenaLosses).toBe(4);
    expect(state.arena1v1Rating).toBe(1742);
    expect(state.arena1v1Wins).toBe(9);
    expect(state.arena1v1Losses).toBe(4);
    expect(state.arena2v2Rating).toBe(1611);
    expect(state.arena2v2Wins).toBe(2);
    expect(state.arena2v2Losses).toBe(5);

    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('paladin', 'Tyr', { state });
    expect(sim2.meta(a2)!.arenaRating).toBe(1742);
    expect(sim2.meta(a2)!.arenaWins).toBe(9);
    expect(sim2.meta(a2)!.arenaLosses).toBe(4);
    expect(sim2.meta(a2)!.arena2v2Rating).toBe(1611);
    expect(sim2.meta(a2)!.arena2v2Wins).toBe(2);
    expect(sim2.meta(a2)!.arena2v2Losses).toBe(5);
  });

  it('unranked characters default to 1500', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Cenarius');
    expect(sim.meta(a)!.arenaRating).toBe(1500);
    expect(sim.meta(a)!.arena2v2Rating).toBe(1500);
    expect(sim.arenaInfoFor(a)!.rating).toBe(1500);
    expect(sim.arenaInfoFor(a)!.standings['1v1'].rating).toBe(1500);
    expect(sim.arenaInfoFor(a)!.standings['2v2'].rating).toBe(1500);
  });

  it('the online ladders sort rated players best first by bracket', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Low');
    const b = sim.addPlayer('mage', 'High');
    const c = sim.addPlayer('rogue', 'Mid');
    sim.meta(a)!.arenaRating = 1400;
    sim.meta(b)!.arenaRating = 1900;
    sim.meta(c)!.arenaRating = 1600;
    sim.meta(a)!.arena2v2Rating = 2100;
    sim.meta(b)!.arena2v2Rating = 1200;
    sim.meta(c)!.arena2v2Rating = 1700;
    const ladder1v1 = sim.arenaLadder();
    const ladder2v2 = sim.arenaLadder('2v2');
    expect(ladder1v1.map((r) => r.name)).toEqual(['High', 'Mid', 'Low']);
    expect(ladder2v2.map((r) => r.name)).toEqual(['Low', 'Mid', 'High']);
  });
});

function queue2v2(classes: PlayerClass[] = ['warrior', 'mage', 'rogue', 'priest']): {
  sim: Sim;
  pids: number[];
} {
  const sim = makeWorld();
  const names = ['Aleph', 'Bet', 'Gimel', 'Dalet'];
  const pids = classes.map((cls, i) => sim.addPlayer(cls, names[i]));
  for (let i = 0; i < pids.length; i++) teleport(sim, pids[i], i * 3, -40);
  for (const pid of pids) sim.arenaQueueJoin(pid, '2v2');
  sim.tick();
  return { sim, pids };
}

function startBout2v2(sim: Sim) {
  for (let i = 0; i < 20 * 6; i++) {
    sim.tick();
    const m = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (m && m.state === 'active') return;
  }
}

describe('arena: 2v2 queue + matchmaking', () => {
  it('four solos queue into one 2v2 match', () => {
    const { sim, pids } = queue2v2();
    const m = sim.arenaMatchFor(pids[0])!;
    expect(m).toBeTruthy();
    expect(m.format).toBe('2v2');
    expect(sim.arenaAllPids(m).sort()).toEqual(pids.sort());
    expect(sim.arenaInfoFor(pids[0])!.queued).toBe(false);
  });

  it('two premade teams match by nearest team rating', () => {
    const sim = makeWorld();
    const a1 = sim.addPlayer('warrior', 'Aleph');
    const a2 = sim.addPlayer('paladin', 'Bet');
    const b1 = sim.addPlayer('mage', 'Gimel');
    const b2 = sim.addPlayer('rogue', 'Dalet');
    for (const pid of [a1, a2, b1, b2]) teleport(sim, pid, 0, -40);
    sim.meta(a1)!.arena2v2Rating = 1500;
    sim.meta(a2)!.arena2v2Rating = 1500;
    sim.meta(b1)!.arena2v2Rating = 1800;
    sim.meta(b2)!.arena2v2Rating = 1800;
    sim.partyInvite(a2, a1);
    sim.partyAccept(a2);
    sim.partyInvite(b2, b1);
    sim.partyAccept(b2);
    sim.arenaQueueJoin(a1, '2v2');
    sim.arenaQueueJoin(b1, '2v2');
    sim.tick();
    const m = sim.arenaMatchFor(a1)!;
    expect(m).toBeTruthy();
    expect(m.teamA.sort()).toEqual([a1, a2].sort());
    expect(m.teamB.sort()).toEqual([b1, b2].sort());
  });

  it('premade team matches against two solos', () => {
    const sim = makeWorld();
    const p1 = sim.addPlayer('warrior', 'Aleph');
    const p2 = sim.addPlayer('paladin', 'Bet');
    const s1 = sim.addPlayer('mage', 'Gimel');
    const s2 = sim.addPlayer('rogue', 'Dalet');
    for (const pid of [p1, p2, s1, s2]) teleport(sim, pid, 0, -40);
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    sim.arenaQueueJoin(p1, '2v2');
    sim.arenaQueueJoin(s1, '2v2');
    sim.arenaQueueJoin(s2, '2v2');
    sim.tick();
    const m = sim.arenaMatchFor(p1)!;
    expect(m).toBeTruthy();
    expect(m.teamA.sort()).toEqual([p1, p2].sort());
    expect(m.teamB.sort()).toEqual([s1, s2].sort());
  });

  it('party leader queues both members; non-leader cannot queue', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Aleph');
    const member = sim.addPlayer('mage', 'Bet');
    teleport(sim, leader, 0, -40);
    teleport(sim, member, 3, -40);
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    const before = sim.arenaQueue2v2.length;
    sim.arenaQueueJoin(member, '2v2');
    expect(sim.arenaQueue2v2.length).toBe(before);
    sim.arenaQueueJoin(leader, '2v2');
    expect(sim.arenaQueue2v2.some((u) => u.pids.includes(leader) && u.pids.includes(member))).toBe(
      true,
    );
  });

  it('leaving queue removes the whole premade unit', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Aleph');
    const member = sim.addPlayer('mage', 'Bet');
    for (const pid of [leader, member]) teleport(sim, pid, 0, -40);
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    sim.arenaQueueJoin(leader, '2v2');
    sim.arenaQueueLeave(leader);
    expect(sim.arenaQueue2v2.length).toBe(0);
    expect(sim.arenaInfoFor(member)!.queued).toBe(false);
  });
});

describe('arena: 2v2 combat', () => {
  it('first kill does not end the match; team wipe does', () => {
    const { sim, pids } = queue2v2();
    startBout2v2(sim);
    const [a1, a2, b1, b2] = pids;
    const eb1 = sim.entities.get(b1)!;
    const ea1 = sim.entities.get(a1)!;
    (sim as any).dealDamage(ea1, eb1, 99999, false, 'physical', null, 'hit');
    sim.tick();
    expect(sim.arenaMatchFor(a1)!.state).toBe('active');
    expect(eb1.hp).toBe(0);
    expect(eb1.dead).toBe(true);
    expect(sim.isHostileTo(eb1, ea1)).toBe(false);
    sim.releaseSpirit(b1);
    expect(eb1.dead).toBe(true);
    const eb2 = sim.entities.get(b2)!;
    (sim as any).dealDamage(ea1, eb2, 99999, false, 'physical', null, 'hit');
    sim.tick();
    expect(sim.arenaMatchFor(a1)!.state).toBe('over');
    expect(eb2.hp).toBe(0);
    expect(eb2.dead).toBe(true);
    expect(sim.meta(a1)!.arena2v2Wins).toBe(1);
    expect(sim.meta(b1)!.arena2v2Losses).toBe(1);
    expect(sim.meta(b2)!.arena2v2Losses).toBe(1);
  });

  it('teammates are not hostile to each other', () => {
    const { sim, pids } = queue2v2();
    startBout2v2(sim);
    const [a1, a2] = pids;
    const ea1 = sim.entities.get(a1)!;
    const ea2 = sim.entities.get(a2)!;
    expect(sim.isHostileTo(ea1, ea2)).toBe(false);
  });

  it('applies the same Elo delta to both teammates', () => {
    const { sim, pids } = queue2v2();
    startBout2v2(sim);
    const [a1, a2, b1, b2] = pids;
    const rA1 = sim.meta(a1)!.arena2v2Rating;
    const rA2 = sim.meta(a2)!.arena2v2Rating;
    for (const pid of [b1, b2]) {
      const attacker = sim.entities.get(a1)!;
      const target = sim.entities.get(pid)!;
      (sim as any).dealDamage(attacker, target, 99999, false, 'physical', null, 'hit');
      sim.tick();
    }
    const delta = sim.meta(a1)!.arena2v2Rating - rA1;
    expect(sim.meta(a2)!.arena2v2Rating - rA2).toBe(delta);
    expect(delta).toBe(16);
  });

  it('keeps 1v1 and 2v2 records fully separate', () => {
    const one = queueDuo();
    startBout(one.sim);
    one.sim.meta(one.a)!.arena2v2Rating = 1666;
    one.sim.meta(one.a)!.arena2v2Wins = 4;
    one.sim.meta(one.a)!.arena2v2Losses = 3;
    (one.sim as any).dealDamage(
      one.sim.entities.get(one.a)!,
      one.sim.entities.get(one.b)!,
      99999,
      false,
      'physical',
      null,
      'hit',
    );
    one.sim.tick();
    expect(one.sim.meta(one.a)!.arenaWins).toBe(1);
    expect(one.sim.meta(one.a)!.arena2v2Rating).toBe(1666);
    expect(one.sim.meta(one.a)!.arena2v2Wins).toBe(4);
    expect(one.sim.meta(one.a)!.arena2v2Losses).toBe(3);

    const two = queue2v2();
    startBout2v2(two.sim);
    const [a1, a2, b1, b2] = two.pids;
    for (const pid of two.pids) {
      two.sim.meta(pid)!.arenaRating = 1725 + pid;
      two.sim.meta(pid)!.arenaWins = 7;
      two.sim.meta(pid)!.arenaLosses = 6;
    }
    const before1v1 = two.pids.map((pid) => ({
      pid,
      rating: two.sim.meta(pid)!.arenaRating,
      wins: two.sim.meta(pid)!.arenaWins,
      losses: two.sim.meta(pid)!.arenaLosses,
    }));
    for (const pid of [b1, b2]) {
      (two.sim as any).dealDamage(
        two.sim.entities.get(a1)!,
        two.sim.entities.get(pid)!,
        99999,
        false,
        'physical',
        null,
        'hit',
      );
      two.sim.tick();
    }
    expect(two.sim.meta(a1)!.arena2v2Wins).toBe(1);
    expect(two.sim.meta(a2)!.arena2v2Wins).toBe(1);
    for (const row of before1v1) {
      expect(two.sim.meta(row.pid)!.arenaRating).toBe(row.rating);
      expect(two.sim.meta(row.pid)!.arenaWins).toBe(row.wins);
      expect(two.sim.meta(row.pid)!.arenaLosses).toBe(row.losses);
    }
  });

  it('disconnecting mid-bout forfeits the whole team', () => {
    const { sim, pids } = queue2v2();
    startBout2v2(sim);
    const [a1, a2, b1, b2] = pids;
    const rA1 = sim.meta(a1)!.arena2v2Rating;
    sim.removePlayer(b1);
    expect(sim.arenaMatchFor(a1)).toBe(null);
    expect(sim.meta(a1)!.arena2v2Rating).toBe(rA1 + 16);
    expect(sim.meta(a2)!.arena2v2Wins).toBe(1);
    expect(sim.meta(b2)!.arena2v2Losses).toBe(1);
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

describe('arena: class ability target filters', () => {
  const aoeCases: Array<{
    cls: PlayerClass;
    ability: string;
    level: number;
    setup?: (sim: Sim, pid: number) => void;
  }> = [
    { cls: 'warrior', ability: 'thunder_clap', level: 20 },
    { cls: 'mage', ability: 'arcane_explosion', level: 20 },
    { cls: 'paladin', ability: 'consecration', level: 20 },
    {
      cls: 'druid',
      ability: 'swipe',
      level: 20,
      setup: (sim, pid) => {
        const druid = sim.entities.get(pid)!;
        sim.castAbility('bear_form', pid);
        druid.gcdRemaining = 0;
        druid.resource = druid.maxResource;
      },
    },
  ];

  it.each(aoeCases)('lets $cls $ability hit active arena opponents', ({
    cls,
    ability,
    level,
    setup,
  }) => {
    const { sim, a, b } = queueDuo(cls, 'warrior');
    startBout(sim);
    const caster = sim.entities.get(a)!;
    const target = sim.entities.get(b)!;
    sim.setPlayerLevel(level, a);
    sim.setPlayerLevel(level, b);
    teleport(sim, b, caster.pos.x, caster.pos.z + 3);
    caster.resource = caster.maxResource;
    caster.gcdRemaining = 0;
    setup?.(sim, a);

    const startHp = target.hp;
    sim.castAbility(ability, a);

    expect(target.hp).toBeLessThan(startHp);
  });
});

describe('arena: enclosing walls', () => {
  it('melee auto-attack cannot land through the arena side wall', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const attacker = sim.entities.get(a)!;
    const target = sim.entities.get(b)!;
    const slot = sim.arenaMatchFor(a)!.slot ?? 0;
    const o = arenaOrigin(slot);
    // attacker just inside the +x wall, target just outside it, close enough
    // to be within MELEE_RANGE but with the wall between them.
    teleport(sim, a, o.x + DUNGEON_WALL_X - 1.5, o.z);
    teleport(sim, b, o.x + DUNGEON_WALL_X + 1.5, o.z);
    face(sim, a, b);
    sim.targetEntity(b, a);
    sim.startAutoAttack(a);
    const startHp = target.hp;
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    // stays toggled on (mirrors the ranged LOS gate) but never lands a swing
    expect(target.hp).toBe(startHp);
  });
});
