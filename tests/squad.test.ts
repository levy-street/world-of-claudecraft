import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { isBgPos } from '../src/sim/data';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function tp(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Ten solo players, queued, advanced one tick so matchmaking seats a 5v5.
function tenInQueue(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `P${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    pids.push(pid);
  }
  for (const pid of pids) sim.bgQueueJoin(pid);
  sim.tick(); // matchmakeBg seats them
  return { sim, pids };
}

function toActive(sim: Sim, match: any) {
  for (let i = 0; i < 20 * 10 && match.state !== 'active'; i++) sim.tick();
}

describe('Ravenrift: queue + matchmaking', () => {
  it('needs ten players; then forms two teams of five and seats them in a battleground', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 9; i++) {
      const pid = sim.addPlayer('warrior', `W${i}`);
      tp(sim, pid, 0, -40);
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // 9 isn't enough

    const tenth = sim.addPlayer('mage', 'Tenth');
    tp(sim, tenth, 0, -40);
    sim.bgQueueJoin(tenth);
    sim.tick();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match).toBeTruthy();
    expect(match.teams[0].length).toBe(5);
    expect(match.teams[1].length).toBe(5);
    // every fighter whisked onto the battleground sands
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
    }
    expect(match.state).toBe('countdown');
  });

  it('keeps a queued party together on one team', () => {
    const sim = makeWorld();
    // a party of five
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    const party = [leader];
    for (let i = 0; i < 4; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      party.push(m);
    }
    // plus five solos
    const solos: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      solos.push(s);
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole party
    sim.tick();
    const match = sim.bgMatchFor(leader)!;
    expect(match).toBeTruthy();
    const teamOfLeader = match.teams[0].includes(leader) ? 0 : 1;
    for (const m of party) expect(match.teams[teamOfLeader]).toContain(m);
  });

  it('refuses to queue from inside an instance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 80, 88);
    sim.enterCrypt(a);
    sim.bgQueueJoin(a);
    expect((sim as any).bgGroupContaining(a)).toBe(null);
  });
});

describe('Ravenrift: flags + scoring', () => {
  it('grab the enemy flag, run it home, score — first to five wins', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.state).toBe('active');

    const carrier = match.teams[0][0];
    const azure = match.flags[1]; // team 0 captures the Azure flag
    const crimsonHome = match.flags[0].home;

    let ended: any = null;
    for (let cap = 0; cap < 5 && !ended; cap++) {
      // onto the enemy flag → pick it up
      tp(sim, carrier, azure.home.x, azure.home.z);
      sim.tick();
      expect(match.flags[1].state).toBe('carried');
      expect(match.flags[1].carrier).toBe(carrier);
      // run it back to your own stand → capture
      tp(sim, carrier, crimsonHome.x, crimsonHome.z);
      const evs = sim.tick();
      const end = evs.find((e) => e.type === 'bgEnd');
      if (end) ended = end;
      expect(match.scores[0]).toBe(cap + 1);
      // captured flag resets home (unless the match just ended)
      if (!ended) expect(match.flags[1].state).toBe('home');
    }
    expect(match.scores[0]).toBe(5);
    expect(ended).toBeTruthy();
    expect(ended.won).toBe(true); // from carrier's (team 0) perspective
    expect(sim.bgMatchFor(carrier)).toBe(null); // cleaned up
  });

  it('dying drops the flag and queues a keep respawn (no graveyard run)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const azure = match.flags[1];
    tp(sim, carrier, azure.home.x, azure.home.z);
    sim.tick();
    expect(match.flags[1].carrier).toBe(carrier);

    const e = sim.entities.get(carrier)!;
    (sim as any).dealDamage(null, e, 99999, false, 'physical', null, 'hit');
    sim.tick();
    expect(e.dead).toBe(true);
    expect(match.flags[1].state).toBe('dropped'); // flag dropped where they fell
    expect(match.respawn.has(carrier)).toBe(true); // timed respawn queued
    // releasing does nothing in a battleground
    sim.releaseSpirit(carrier);
    expect(e.dead).toBe(true);
  });

  it('a dropped flag a teammate touches returns home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimsonFlag = match.flags[0];
    const enemy = match.teams[1][0]; // Azure steals the Crimson flag
    tp(sim, enemy, crimsonFlag.home.x, crimsonFlag.home.z);
    sim.tick();
    expect(match.flags[0].state).toBe('carried');
    // enemy dies, flag drops
    (sim as any).dealDamage(null, sim.entities.get(enemy)!, 99999, false, 'physical', null, 'hit');
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    // a Crimson defender walks over their own dropped flag → instant return
    const defender = match.teams[0][1];
    const fe = sim.entities.get(match.flags[0].entityId)!;
    tp(sim, defender, fe.pos.x, fe.pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
  });
});

describe('Ravenrift: speed runes + teams', () => {
  it('stepping on a sprint rune grants haste and spends the rune', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const rune = match.runes[0];
    expect(rune.active).toBe(true);
    tp(sim, runner, rune.pos.x, rune.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    expect(e.auras.some((a) => a.kind === 'buff_speed' && a.value > 1)).toBe(true);
    expect(match.runes[0].active).toBe(false); // consumed, now recharging
  });

  it('enemies are hostile, teammates are not', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = sim.entities.get(match.teams[0][0])!;
    const mate = sim.entities.get(match.teams[0][1])!;
    const foe = sim.entities.get(match.teams[1][0])!;
    expect(sim.isHostileTo(a, foe)).toBe(true);
    expect(sim.isHostileTo(a, mate)).toBe(false);
  });
});

describe('Ravenrift: ranking + forfeit', () => {
  it('a win moves both teams\' squad Elo and records W/L', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winnerPid = match.teams[0][0];
    const loserPid = match.teams[1][0];
    const r0 = sim.meta(winnerPid)!.squadRating;
    const rL = sim.meta(loserPid)!.squadRating;
    const carrier = winnerPid;
    const azure = match.flags[1];
    const crimsonHome = match.flags[0].home;
    for (let cap = 0; cap < 5; cap++) {
      tp(sim, carrier, azure.home.x, azure.home.z); sim.tick();
      tp(sim, carrier, crimsonHome.x, crimsonHome.z); sim.tick();
    }
    expect(sim.meta(winnerPid)!.squadRating).toBeGreaterThan(r0);
    expect(sim.meta(loserPid)!.squadRating).toBeLessThan(rL);
    expect(sim.meta(winnerPid)!.squadWins).toBe(1);
    expect(sim.meta(loserPid)!.squadLosses).toBe(1);
    // restored to the overworld where they queued
    expect(isBgPos(sim.entities.get(winnerPid)!.pos.x)).toBe(false);
  });

  it('a team that fully disconnects forfeits the match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winners = [...match.teams[0]];
    const r0 = sim.meta(winners[0])!.squadRating;
    for (const pid of [...match.teams[1]]) sim.removePlayer(pid);
    expect(sim.bgMatchFor(winners[0])).toBe(null);
    expect(sim.meta(winners[0])!.squadRating).toBeGreaterThan(r0);
    expect(sim.meta(winners[0])!.squadWins).toBe(1);
  });

  it('squad ladder sorts online players by squad rating', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Low');
    const b = sim.addPlayer('mage', 'High');
    sim.meta(a)!.squadRating = 1400;
    sim.meta(b)!.squadRating = 1700;
    expect(sim.squadLadder().map((r) => r.name)).toEqual(['High', 'Low']);
  });

  it('squad rating round-trips through CharacterState', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Keeper');
    sim.meta(a)!.squadRating = 1633;
    sim.meta(a)!.squadWins = 7;
    const state = sim.serializeCharacter(a)!;
    expect(state.squadRating).toBe(1633);
    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('druid', 'Keeper', { state });
    expect(sim2.meta(a2)!.squadRating).toBe(1633);
    expect(sim2.meta(a2)!.squadWins).toBe(7);
  });
});
