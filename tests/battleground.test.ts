import { describe, expect, it } from 'vitest';
import { BG_GRAVEYARDS, BG_POWER_RUNES, BG_SPEED_RUNES } from '../src/sim/battleground_layout';
import { offerResurrection } from '../src/sim/combat/resurrection_offer';
import { battlegroundOrigin, instanceOrigin, isBgPos } from '../src/sim/data';
import { BATTLEGROUND_LOSS_HONOR, BATTLEGROUND_WIN_HONOR } from '../src/sim/pvp';
import { eloDelta, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import {
  BG_CARRIER_VULN_DELAY,
  BG_CARRIER_VULN_INTERVAL,
  BG_END_HOLD,
  BG_MAX_DURATION,
  BG_MIN_LEVEL,
  BG_MIN_RATING,
  BG_POWER_RUNE_VALUE,
  BG_WAVE_OFFSET,
  BG_WAVE_PERIOD,
  bgResolveDesertion,
  devEndBg,
  devStartBg,
  endBgMatch,
  updateBattleground,
} from '../src/sim/social/battleground';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function tp(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

// Ten solo players, queued, advanced one tick so matchmaking seats a 5v5.
function tenInQueue(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `P${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    sim.entities.get(pid)!.level = 20; // the queue floor (BG_MIN_LEVEL)
    pids.push(pid);
  }
  for (const pid of pids) sim.bgQueueJoin(pid);
  sim.tick(); // matchmakeBg seats them
  return { sim, pids };
}

function toActive(sim: Sim, match: BgMatch) {
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
}

// True when the entity stands inside its team's graveyard plot (world coords).
function inGraveyard(sim: Sim, match: BgMatch, pid: number, team: 0 | 1): boolean {
  const o = battlegroundOrigin(match.slot);
  const plot = BG_GRAVEYARDS[team];
  const e = sim.entities.get(pid)!;
  return (
    Math.abs(e.pos.x - (o.x + plot.x)) <= plot.hw && Math.abs(e.pos.z - (o.z + plot.z)) <= plot.hd
  );
}

function kill(sim: Sim, pid: number, killerPid: number | null = null) {
  const e = sim.entities.get(pid)!;
  const killer = killerPid !== null ? sim.entities.get(killerPid)! : null;
  sim.ctx.dealDamage(killer, e, 9_999_999, false, 'physical', null, 'hit');
}

// Grab the enemy flag with a deliberate press, then run it home for a capture.
function captureOnce(sim: Sim, match: BgMatch, carrier: number) {
  const azure = match.flags[1];
  const crimsonHome = match.flags[0].home;
  tp(sim, carrier, azure.pos.x, azure.pos.z);
  sim.bgFlagAction(carrier);
  sim.tick();
  tp(sim, carrier, crimsonHome.x, crimsonHome.z);
  sim.tick();
}

describe('Thornhollow Fields: queue + matchmaking', () => {
  it('needs ten players; then forms two teams of five and seats them in the battleground band', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 9; i++) {
      const pid = sim.addPlayer('warrior', `W${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // 9 is not enough

    const tenth = sim.addPlayer('mage', 'Tenth');
    tp(sim, tenth, 0, -40);
    sim.entities.get(tenth)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(tenth);
    sim.tick();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match).toBeTruthy();
    expect(match.teams[0]).toHaveLength(5);
    expect(match.teams[1]).toHaveLength(5);
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
    }
    expect(match.state).toBe('countdown');
  });

  it('keeps a queued party together on one team, filled with solos', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const party = [leader];
    for (let i = 0; i < 3; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      party.push(m);
    }
    const solos: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      solos.push(s);
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole party as one group
    sim.tick();
    const match = sim.bgMatchFor(leader)!;
    expect(match).toBeTruthy();
    const teamOfLeader = match.teams[0].includes(leader) ? 0 : 1;
    for (const m of party) expect(match.teams[teamOfLeader]).toContain(m);
  });

  it('refuses to queue from inside an instance, while dead, or twice', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    const dungeonInstance = instanceOrigin(0, 0);
    tp(sim, a, dungeonInstance.x, dungeonInstance.z); // a dungeon instance band
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);

    tp(sim, a, 0, -40);
    kill(sim, a);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);

    const b = sim.addPlayer('mage', 'B');
    tp(sim, b, 0, -40);
    sim.entities.get(b)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(b);
    sim.bgQueueJoin(b); // idempotent re-queue
    expect(sim.bgInfoFor(b)!.queued).toBe(true);
    expect(sim.bgInfoFor(b)!.queueSize).toBe(1);
    sim.bgQueueLeave(b);
    expect(sim.bgInfoFor(b)!.queued).toBe(false);
  });
});

describe('Thornhollow Fields: team parties for the match', () => {
  it('welds each all-solo team into one party at start and disbands both at the end', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    for (const team of [0, 1] as const) {
      const roster = match.teams[team];
      const party = sim.partyOf(roster[0])!;
      expect(party).toBeTruthy();
      expect([...party.members].sort((a, b) => a - b)).toEqual([...roster].sort((a, b) => a - b));
      for (const pid of roster) expect(sim.partyOf(pid)?.id).toBe(party.id);
    }
    // two teams, two DIFFERENT parties: party chat can never leak cross-team
    expect(sim.partyOf(match.teams[0][0])!.id).not.toBe(sim.partyOf(match.teams[1][0])!.id);
    endBgMatch(sim.ctx, match, 0, 'caps');
    for (const pid of pids) expect(sim.partyOf(pid)).toBe(null);
  });

  it('a queued premade keeps its party id and leader; merged solos drop out at the end', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const premade = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      premade.push(m);
    }
    const beforeId = sim.partyOf(leader)!.id;
    for (let i = 0; i < 7; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole premade as one group
    sim.tick();
    const match = sim.bgMatchFor(leader)!;
    const team = match.teams[0].includes(leader) ? 0 : 1;
    const party = sim.partyOf(leader)!;
    expect(party.id).toBe(beforeId); // the premade's party object survived
    expect(party.leader).toBe(leader);
    expect([...party.members].sort((a, b) => a - b)).toEqual(
      [...match.teams[team]].sort((a, b) => a - b),
    );
    endBgMatch(sim.ctx, match, null, 'timeout');
    const after = sim.partyOf(leader)!;
    expect(after.id).toBe(beforeId);
    expect([...after.members].sort((a, b) => a - b)).toEqual([...premade].sort((a, b) => a - b));
    for (const pid of match.teams[team]) {
      if (!premade.includes(pid)) expect(sim.partyOf(pid)).toBe(null);
    }
  });

  it('an auto-added deserter leaves the team party; the rest stay grouped', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    const roster = [...match.teams[0]];
    const deserter = roster[1]; // never the base solo the fresh party formed on
    bgResolveDesertion(sim.ctx, deserter);
    expect(sim.partyOf(deserter)).toBe(null);
    const party = sim.partyOf(roster[0])!;
    expect(party.members).toHaveLength(4);
    expect(party.members).not.toContain(deserter);
  });
});

describe('Thornhollow Fields: the post-match hold (frozen result screen)', () => {
  function playToCaps() {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    for (let i = 0; i < 5; i++) captureOnce(sim, match, carrier);
    return { sim, pids, match, carrier };
  }

  it('winning on caps freezes the match: state ended, result resolved, combat off, nobody moved home yet', () => {
    const { sim, match, carrier } = playToCaps();
    expect(match.state).toBe('ended');
    expect(match.winner).toBe(0);
    expect(match.resultRecorded).toBe(true);
    // ratings + W/L landed at the freeze, not at the release
    expect(sim.players.get(carrier)!.bgWins).toBe(1);
    expect(sim.players.get(carrier)!.bgRating).toBeGreaterThan(1500);
    // everyone is still inside the band, and cross-team combat is off
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
      expect(sim.bgMatchFor(pid)).toBe(match);
    }
    const enemy = match.teams[1][0];
    // The hostility arm requires state 'active': the two sides read friendly
    // again the moment the screen freezes, so no ability can target across.
    expect(sim.isHostileTo(sim.entities.get(carrier)!, sim.entities.get(enemy)!)).toBe(false);
    // the wire view carries the hold: state, winner, and the countdown slot
    const view = sim.bgInfoFor(carrier)!.match!;
    expect(view.state).toBe('ended');
    expect(view.winner).toBe(0);
    expect(view.countdown).toBeGreaterThan(0);
    expect(view.countdown).toBeLessThanOrEqual(BG_END_HOLD);
    // both flags came silently home for the screen
    expect(match.flags[0].state).toBe('home');
    expect(match.flags[1].state).toBe('home');
  });

  it('after the hold everyone is released home exactly once (parties unwound too)', () => {
    const { sim, pids, match } = playToCaps();
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    for (const pid of pids) {
      expect(sim.bgMatchFor(pid)).toBe(null);
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(false);
      expect(sim.partyOf(pid)).toBe(null);
    }
    expect(match.fightersReleased).toBe(true);
  });

  it('a desertion-forfeit still ends immediately (no hold with an empty side)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    for (const pid of [...match.teams[1]]) bgResolveDesertion(sim.ctx, pid);
    expect(match.resultRecorded).toBe(true);
    expect(match.fightersReleased).toBe(true);
    for (const pid of match.teams[0]) expect(sim.bgMatchFor(pid)).toBe(null);
  });
});

describe('Thornhollow Fields: release is never gated by a stale arena entry (playtest regression)', () => {
  it('releases into the team graveyard even while arenaMatches still holds an entry', () => {
    // The playtest bug: a leaked arenaMatches entry (jail/cross-queue holes)
    // made releasePlayerSpirit silently no-op for one player all match. The
    // bg membership must WIN over the arena guard.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][1];
    kill(sim, victim, match.teams[1][0]);
    sim.tick();
    // The stale leak lands AFTER the death (no tick runs over the stub entry:
    // updateArena would choke on a shapeless match; the release path only
    // asks arenaMatches.has, which is exactly what the real leak exposed).
    sim.arenaMatches.set(victim, {} as never);
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
    sim.arenaMatches.delete(victim);
  });

  it('refuses the Thornhollow Fields queue while in an arena match (the front door)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 0, -40);
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    sim.arenaMatches.set(a, {} as never);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);
    sim.arenaMatches.delete(a);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
  });

  it('a fighter seated by the form-up never keeps ghost/corpse state into the battle', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const victim = match.teams[0][0];
    kill(sim, victim); // environmental death during the form-up
    sim.tick();
    sim.releaseSpirit(victim);
    expect(sim.entities.get(victim)!.ghost).toBe(true);
    toActive(sim, match);
    const e = sim.entities.get(victim)!;
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBe(null);
  });
});

describe('Thornhollow Fields: dev-forced matches are unrated (jgyy review)', () => {
  it('a devStartBg match moves no rating, W/L, or honor on resolve', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('warrior', `D${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    devStartBg(sim.ctx);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(false);
    toActive(sim, match);
    const carrier = match.teams[0][0];
    for (let i = 0; i < 5; i++) captureOnce(sim, match, carrier);
    expect(match.state).toBe('ended');
    for (const pid of pids) {
      expect(sim.meta(pid)!.bgRating).toBe(1500);
      expect(sim.meta(pid)!.bgWins).toBe(0);
      expect(sim.meta(pid)!.bgLosses).toBe(0);
      expect(sim.meta(pid)!.honor ?? 0).toBe(0);
    }
    // a queue-made match stays rated (the flag defaults true)
    const { sim: sim2, pids: pids2 } = tenInQueue();
    expect(sim2.bgMatchFor(pids2[0])!.rated).toBe(true);
  });
});

describe('Thornhollow Fields: /dev bg end (early resolve)', () => {
  it('resolves the match on the current score through the normal hold, once', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    expect(devEndBg(sim.ctx, pids[0])).toBe(true);
    expect(match.state).toBe('ended');
    expect(match.winner).toBe(0); // 1:0 resolves for Crimson, not a draw
    expect(match.resultRecorded).toBe(true);
    expect(devEndBg(sim.ctx, pids[0])).toBe(false); // already resolved
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // released home like any finish
  });
});

describe('Thornhollow Fields: the level 20 queue floor', () => {
  it('refuses an under-leveled solo queue and admits exactly BG_MIN_LEVEL', () => {
    expect(BG_MIN_LEVEL).toBe(20);
    const sim = makeWorld();
    const low = sim.addPlayer('warrior', 'Lowbie');
    sim.entities.get(low)!.level = BG_MIN_LEVEL - 1;
    sim.bgQueueJoin(low);
    expect(sim.bgInfoFor(low)!.queued).toBe(false);
    const ready = sim.addPlayer('mage', 'Ready');
    sim.entities.get(ready)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(ready);
    expect(sim.bgInfoFor(ready)!.queued).toBe(true);
  });

  it('refuses a party containing a single under-leveled member', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    const buddy = sim.addPlayer('mage', 'Buddy');
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    sim.entities.get(buddy)!.level = BG_MIN_LEVEL - 1;
    sim.partyInvite(buddy, leader);
    sim.partyAccept(buddy);
    sim.bgQueueJoin(leader);
    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(buddy)!.queued).toBe(false);
    // level the buddy and the same queue press works
    sim.entities.get(buddy)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(leader);
    expect(sim.bgInfoFor(leader)!.queued).toBe(true);
    expect(sim.bgInfoFor(buddy)!.queued).toBe(true);
  });
});

describe('Thornhollow Fields: match tallies (kills, deaths, captures)', () => {
  it('counts deaths, credits only enemy killers, and counts captures on the wire rows', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const victim = match.teams[1][0];
    kill(sim, victim, killer);
    sim.tick();
    let rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === killer)).toMatchObject({ kills: 1, deaths: 0, captures: 0 });
    expect(rows.find((p) => p.pid === victim)).toMatchObject({ kills: 0, deaths: 1, captures: 0 });
    // a same-team death counts the death and credits nobody
    const tkVictim = match.teams[0][1];
    const tkDealer = match.teams[0][2];
    kill(sim, tkVictim, tkDealer);
    sim.tick();
    rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === tkVictim)).toMatchObject({ deaths: 1 });
    expect(rows.find((p) => p.pid === tkDealer)).toMatchObject({ kills: 0 });
    // and NOBODY else picked the team kill up by mistake (jgyy review): the
    // only kill on the board is still the killer's first one.
    expect(rows.reduce((sum, p) => sum + p.kills, 0)).toBe(1);
    // a capture lands on the carrier's row
    captureOnce(sim, match, killer);
    rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === killer)).toMatchObject({ kills: 1, captures: 1 });
  });

  it('feeds every match member a bgKill event with names and teams', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const victim = match.teams[1][0];
    kill(sim, victim, killer);
    const evs = sim.tick().filter((e) => e.type === 'bgKill');
    expect(evs).toHaveLength(10); // one per match member, both teams
    const mine = evs.find((e) => 'pid' in e && e.pid === killer)!;
    expect(mine).toMatchObject({
      killerName: sim.players.get(killer)!.name,
      victimName: sim.players.get(victim)!.name,
      killerTeam: 0,
      victimTeam: 1,
    });
    // a team kill still feeds, unattributed: null killer, null killer team
    kill(sim, match.teams[0][1], match.teams[0][2]);
    const evs2 = sim.tick().filter((e) => e.type === 'bgKill');
    expect(evs2).toHaveLength(10);
    expect(evs2[0]).toMatchObject({ killerName: null, killerTeam: null, victimTeam: 0 });
  });
});

describe('Thornhollow Fields: power runes (Battle / Ward)', () => {
  it('opens both pads on the same seeded face, applies the right buff, and flips per claim', () => {
    // determinism: the same seed opens the same face
    const face = (seed: number) => {
      const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
      const pids: number[] = [];
      const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
      for (let i = 0; i < 10; i++) {
        const pid = sim.addPlayer(classes[i % 5], `P${i}`);
        sim.entities.get(pid)!.level = 20;
        pids.push(pid);
        sim.bgQueueJoin(pid);
      }
      sim.tick();
      return { sim, match: sim.bgMatchFor(pids[0])! };
    };
    // The sprint pads are spawned first, the power pads after, so the field's
    // own pad counts decide where the power block starts.
    const firstPower = BG_SPEED_RUNES.length;
    const a = face(42);
    const b = face(42);
    expect(a.match.runes.length).toBe(BG_SPEED_RUNES.length + BG_POWER_RUNES.length);
    expect(a.match.runes[firstPower].type).toBe(b.match.runes[firstPower].type);
    // every sprint pad stays sprint; all power pads share one opening face
    expect(a.match.runes.slice(0, firstPower).every((r) => r.type === 'sprint')).toBe(true);
    const powerFaces = a.match.runes.slice(firstPower).map((r) => r.type);
    expect(new Set(powerFaces).size).toBe(1);
    expect(['damage', 'defense']).toContain(powerFaces[0]);

    const { sim, match } = a;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const power = match.runes[firstPower];
    const openingFace = power.type;
    tp(sim, runner, power.pos.x, power.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    const expectedKind = openingFace === 'damage' ? 'buff_dmg_done' : 'shield_wall';
    const buff = e.auras.find((au) => au.kind === expectedKind);
    expect(buff).toBeTruthy();
    expect(buff!.value).toBeCloseTo(BG_POWER_RUNE_VALUE, 5);
    // the claimed pad flips its face for the next spawn
    expect(power.type).toBe(openingFace === 'damage' ? 'defense' : 'damage');
    expect(power.active).toBe(false);
  });
});

describe('Thornhollow Fields: the form-up hold', () => {
  it('a runner slipping out during the countdown is set back and told why', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const runner = match.teams[0][0];
    const o = battlegroundOrigin(match.slot);
    tp(sim, runner, o.x, o.z - 60); // out past the keep, into the field chamber
    const evs = sim.tick();
    const e = sim.entities.get(runner)!;
    const lz = e.pos.z - o.z;
    expect(lz).toBeGreaterThanOrEqual(-128); // back inside the Crimson keep box
    expect(lz).toBeLessThanOrEqual(-108);
    expect(
      evs.some(
        (v) =>
          v.type === 'error' &&
          v.pid === runner &&
          v.text === 'The gates open when the battle begins.',
      ),
    ).toBe(true);
  });
});

describe('Thornhollow Fields: the graveyard rite', () => {
  it('a corpse NEVER auto-releases (the press is the player own move); the ward binds the ghost', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    kill(sim, victim);
    sim.tick();
    const e = sim.entities.get(victim)!;
    // a full half minute (three whole waves) later, the corpse still lies
    // where it fell: no timer touches it, and no wave raises an unreleased body
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(e.dead).toBe(true);
    expect(e.ghost).toBeFalsy();
    // and the corpse shows NO respawn countdown (the wave readout is a ghost's)
    expect(sim.bgInfoFor(victim)!.match!.respawnIn).toBe(0);
    // the deliberate press releases into the plot...
    sim.releaseSpirit(victim);
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
    // ...where the wave countdown NOW shows
    sim.tick();
    expect(sim.bgInfoFor(victim)!.match!.respawnIn).toBeGreaterThan(0);
    // the ward: teleport the spirit outside the plot and the next tick pulls
    // it back inside (a spirit cannot scout or leave before its wave)
    tp(sim, victim, 0, -40);
    sim.tick();
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
  });

  it('the wave raises only released spirits: an unreleased corpse waits for a later wave', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = match.teams[0][0];
    const b = match.teams[0][1];
    // die just before a wave, release only a: the wave raises the released
    // spirit and leaves the corpse untouched
    while (BG_WAVE_PERIOD - (match.timer % BG_WAVE_PERIOD) > 3) sim.tick();
    kill(sim, a);
    kill(sim, b);
    sim.tick();
    sim.releaseSpirit(a); // a releases immediately; b lies on its corpse
    const target = Math.ceil(match.timer / BG_WAVE_PERIOD) * BG_WAVE_PERIOD + 0.3;
    while (match.timer < target) sim.tick();
    expect(sim.entities.get(a)!.dead).toBe(false); // the released spirit rose
    expect(sim.entities.get(b)!.dead).toBe(true); // the corpse waited
    // b releases LATE and the following wave raises it too
    sim.releaseSpirit(b);
    while (sim.entities.get(b)!.dead && match.timer < 60) sim.tick();
    expect(sim.entities.get(b)!.dead).toBe(false);
    expect(inGraveyard(sim, match, b, 0)).toBe(true);
  });

  it('corpse and Spirit Healer resurrection are refused inside a match (wave-only)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    // teleport the ghost onto its own corpse: the corpse rez still refuses
    if (e.corpsePos) tp(sim, victim, e.corpsePos.x, e.corpsePos.z);
    sim.resurrectAtCorpse(victim);
    expect(e.dead).toBe(true);
    expect(sim.resurrectAtSpiritHealer(victim)).toBe(false);
  });
});

describe('Thornhollow Fields: ghost-state teardown (review pins)', () => {
  it('a match ending while a spirit waits clears ghost and corpse state on the way home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[1][0];
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    updateBattleground(sim.ctx); // seat the release fully
    endBgMatch(sim.ctx, match, 0, 'caps');
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBeNull();
    expect(isBgPos(e.pos.x)).toBe(false); // sent home, not stranded in the band
  });

  it('deserting while a spirit restores the body and sends it home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const leaver = match.teams[1][0];
    kill(sim, leaver);
    sim.tick();
    sim.releaseSpirit(leaver);
    const e = sim.entities.get(leaver)!;
    expect(e.ghost).toBe(true);
    sim.bgResolveDesertion(leaver);
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBeNull();
    expect(isBgPos(e.pos.x)).toBe(false);
  });

  it('a player-cast resurrection offer is refused in-match (the wave is the one way back)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const caster = sim.entities.get(match.teams[0][0])!;
    const fallen = match.teams[0][1];
    kill(sim, fallen);
    sim.tick();
    const target = sim.entities.get(fallen)!;
    expect(offerResurrection(sim.ctx, caster, target, 1)).toBe(false);
    expect(sim.ctx.pendingResurrections.has(fallen)).toBe(false);
    expect(target.dead).toBe(true);
  });
});

describe('Thornhollow Fields: deliberate pickup + automatic return', () => {
  it('walking over a flag never picks it up; the deliberate press does', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.state).toBe('active');
    const raider = match.teams[0][0];
    const azure = match.flags[1];
    tp(sim, raider, azure.pos.x, azure.pos.z);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(match.flags[1].state).toBe('home'); // strafing through does nothing
    sim.bgFlagAction(raider);
    sim.tick();
    expect(match.flags[1].state).toBe('carried');
    expect(match.flags[1].carrier).toBe(raider);
  });

  it('the flag action errors politely with no flag in reach and never grabs the OWN flag', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimson = match.teams[0][0];
    // own flag: pressing on it does nothing (only a dropped own flag returns, by proximity)
    tp(sim, crimson, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(crimson);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
    expect(match.flags[1].state).toBe('home');
  });

  it('grab, run it home, score; first to five captures wins and cleans up', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const returnPos = match.returns.get(carrier)!;

    let ended = false;
    for (let cap = 0; cap < 5; cap++) {
      captureOnce(sim, match, carrier);
      expect(match.scores[0]).toBe(cap + 1);
      if (cap < 4) expect(match.flags[1].state).toBe('home'); // captured flag resets home
    }
    // The fifth capture freezes the match on the result screen first; the
    // release home comes only after the BG_END_HOLD lapses.
    expect(match.state).toBe('ended');
    expect(sim.bgMatchFor(carrier)).toBe(match);
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    ended = sim.bgMatchFor(carrier) === null;
    expect(ended).toBe(true);
    expect(match.scores[0]).toBe(5);
    // restored to the overworld exactly where they queued
    const e = sim.entities.get(carrier)!;
    expect(isBgPos(e.pos.x)).toBe(false);
    expect(e.pos.x).toBeCloseTo(returnPos.x, 3);
    expect(e.pos.z).toBeCloseTo(returnPos.z, 3);
    // meta recorded the result + captures
    expect(sim.meta(carrier)!.bgWins).toBe(1);
    expect(sim.meta(carrier)!.bgCaptures).toBe(5);
    expect(sim.meta(match.teams[1][0])!.bgLosses).toBe(1);
  });

  it('a dropped flag auto-returns home after 20 seconds untouched', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    // carry it away from everyone, then die
    tp(sim, enemy, match.flags[0].home.x + 10, match.flags[0].home.z + 20);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    // Decisive two-sided pin on the 20s timer: still dropped at 19s, home
    // once the clock passes 20s.
    for (let i = 0; i < 20 * 19; i++) sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(match.flags[0].state).toBe('home');
  });

  it('the flag OWN team returns a dropped flag by proximity, instantly', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    tp(sim, enemy, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const defender = match.teams[0][1];
    tp(sim, defender, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // walk-over return, no press needed
  });

  it('same-tick race: an automatic return beats a pickup press', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const thief = match.teams[1][0];
    tp(sim, thief, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(thief);
    sim.tick();
    tp(sim, thief, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, thief);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const dropX = match.flags[0].pos.x;
    const dropZ = match.flags[0].pos.z;
    // a defender stands on it AND an enemy presses in the same tick
    const defender = match.teams[0][1];
    const secondThief = match.teams[1][1];
    tp(sim, defender, dropX, dropZ);
    tp(sim, secondThief, dropX, dropZ);
    sim.bgFlagAction(secondThief);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // the return won the race
    expect(match.flags[0].carrier).toBe(null);
  });

  it('flags and invisibility never mix: a grab reveals, going hidden drops', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const e = sim.entities.get(runner)!;
    const hide = () =>
      sim.ctx.applyAura(e, {
        id: 'stealth',
        name: 'Stealth',
        kind: 'stealth',
        value: 0.5,
        remaining: 3600,
        duration: 3600,
        sourceId: e.id,
        school: 'physical',
      });
    // a stealthed runner CAN press the grab, but the grab is a revealing act:
    // the stealth aura is stripped in the same tick the carry starts
    hide();
    expect(e.stealthed).toBe(true);
    tp(sim, runner, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(runner);
    sim.tick();
    expect(match.flags[1].carrier).toBe(runner);
    expect(e.stealthed).toBe(false);
    expect(e.auras.some((a) => a.kind === 'stealth')).toBe(false);
    // going hidden WHILE carrying (stealth, vanish, invisibility: every source
    // rides the stealth aura kind) drops the flag at the carrier's feet; the
    // runner stays hidden but flagless, so the enemy team never chases an
    // entity their snapshots cannot see
    hide();
    expect(e.stealthed).toBe(true);
    sim.tick();
    expect(match.flags[1].state).toBe('dropped');
    expect(match.flags[1].carrier).toBe(null);
    expect(e.stealthed).toBe(true); // the hide itself survives; the flag does not
    expect(match.flags[1].pos.x).toBeCloseTo(e.pos.x, 3);
    expect(match.flags[1].pos.z).toBeCloseTo(e.pos.z, 3);
    // and the dropped flag then behaves like any drop: an enemy re-press takes it
    const azure = match.teams[1].find((pid) => pid !== runner)!;
    tp(sim, azure, match.flags[1].pos.x, match.flags[1].pos.z);
    sim.bgFlagAction(azure);
    sim.tick();
    expect(match.flags[1].state).toBe('home'); // own team: proximity return wins
  });
});

describe('Thornhollow Fields: death, wave respawn, spawn protection', () => {
  it('carrier death drops the flag in place and releasing does nothing', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    expect(match.flags[1].carrier).toBe(carrier);
    kill(sim, carrier);
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.dead).toBe(true);
    expect(match.flags[1].state).toBe('dropped');
    // The classic rite: releasing rises the spirit in the CRIMSON keep
    // graveyard plot; the dropped flag stays where it fell.
    sim.releaseSpirit(carrier);
    expect(e.dead).toBe(true);
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, carrier, 0)).toBe(true);
    expect(match.flags[1].state).toBe('dropped');
  });

  it('wave respawn: 10s period, the two team clocks offset by 5s, whole wave together', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.waveIn[0]).toBeCloseTo(BG_WAVE_PERIOD, 1);
    expect(match.waveIn[1]).toBeCloseTo(BG_WAVE_OFFSET, 1);
    // kill one member of each team plus a second Crimson a moment later
    const c1 = match.teams[0][0];
    const c2 = match.teams[0][1];
    const a1 = match.teams[1][0];
    kill(sim, c1);
    kill(sim, a1);
    sim.tick();
    sim.releaseSpirit(c1); // the wave raises released spirits (release first)
    sim.releaseSpirit(a1);
    for (let i = 0; i < 20; i++) sim.tick(); // 1s later
    kill(sim, c2);
    sim.tick();
    sim.releaseSpirit(c2);
    // Azure's first wave fires at 5s: a1 back up, both Crimson still down
    while (match.waveIn[1] < BG_WAVE_PERIOD - 0.5 || sim.entities.get(a1)!.dead) {
      sim.tick();
      if (match.timer > 6) break;
    }
    expect(sim.entities.get(a1)!.dead).toBe(false);
    expect(sim.entities.get(c1)!.dead).toBe(true);
    expect(sim.entities.get(c2)!.dead).toBe(true);
    // Crimson's wave fires at 10s: BOTH fallen Crimson respawn together
    while (sim.entities.get(c1)!.dead && match.timer < 11) sim.tick();
    expect(sim.entities.get(c1)!.dead).toBe(false);
    expect(sim.entities.get(c2)!.dead).toBe(false); // died later, joined the same wave
    // risen inside the keep graveyard plot (in place), not where they fell
    expect(isBgPos(sim.entities.get(c1)!.pos.x)).toBe(true);
    expect(inGraveyard(sim, match, c1, 0)).toBe(true);
    expect(inGraveyard(sim, match, c2, 0)).toBe(true);
  });

  it('a death just after a wave waits for the NEXT wave (never respawns instantly)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    // wait for Crimson's first wave to fire, then die immediately after
    while (match.timer < BG_WAVE_PERIOD + 0.2) sim.tick();
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    expect(sim.entities.get(victim)!.dead).toBe(true);
    // still dead 8s later; alive after the full next tick at 20s
    while (match.timer < BG_WAVE_PERIOD + 8) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(true);
    while (match.timer < BG_WAVE_PERIOD * 2 + 0.5) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(false);
  });
});

describe('Thornhollow Fields: the classic capture gate', () => {
  it('a capture only resolves while your OWN flag is home, and fires the moment it returns', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const raider = match.teams[0][0]; // Crimson, carrying the Azure flag
    const thief = match.teams[1][0]; // Azure, stealing the Crimson flag
    tp(sim, thief, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(thief);
    sim.tick();
    expect(match.flags[0].state).toBe('carried'); // Crimson's flag is OUT
    tp(sim, raider, match.flags[1].pos.x, match.flags[1].pos.z);
    sim.bgFlagAction(raider);
    sim.tick();
    expect(match.flags[1].state).toBe('carried');
    // at the stand with the enemy flag, but the own flag is stolen: NO capture
    tp(sim, raider, match.flags[0].home.x, match.flags[0].home.z);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(match.scores[0]).toBe(0);
    expect(match.flags[1].state).toBe('carried'); // still waiting at the stand
    // the thief dies, a defender walk-over returns the Crimson flag home:
    // the waiting carrier captures AUTOMATICALLY on the next tick
    kill(sim, thief);
    sim.tick();
    const defender = match.teams[0][1];
    tp(sim, defender, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
    sim.tick();
    expect(match.scores[0]).toBe(1); // the gated capture resolved itself
    expect(match.flags[1].state).toBe('home');
  });
});

describe('Thornhollow Fields: carrier vulnerability (Focused Assault lineage)', () => {
  it('stacks after the fatigue delay (75s), one more every 15s, and amplifies damage taken', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const attacker = match.teams[1][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    tp(sim, carrier, match.flags[1].home.x + 6, match.flags[1].home.z - 8); // off the stand
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    // fast-forward the hold clock to just before the threshold
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY - 0.2;
    for (let i = 0; i < 8; i++) sim.tick();
    let vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln).toBeTruthy();
    expect(vuln!.stacks).toBe(1);
    // one more interval, one more stack (uncapped)
    match.flags[1].carrySeconds += BG_CARRIER_VULN_INTERVAL;
    sim.tick();
    vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln!.stacks).toBe(2);
    expect(vuln!.value).toBeCloseTo(0.2, 5);
    // decisive damage check: two stacks take 20% more than clean (sub-lethal
    // amounts, or the overkill clamp equalizes both hits)
    const atk = sim.entities.get(attacker)!;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const withVuln = e.maxHp - e.hp;
    expect(withVuln).toBeGreaterThan(0);
    expect(e.dead).toBe(false);
    // drop the flag (death), stacks clear, same hit lands clean
    kill(sim, carrier);
    sim.tick();
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    e.dead = false;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const clean = e.maxHp - e.hp;
    expect(withVuln / clean).toBeCloseTo(1.2, 1);
  });

  it('clears on capture and on return', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY + 1;
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(true);
    // capture clears the stacks
    tp(sim, carrier, match.flags[0].home.x, match.flags[0].home.z);
    sim.tick();
    expect(match.scores[0]).toBe(1);
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
  });
});

describe('Thornhollow Fields: runes, hostility, and the match clock', () => {
  it('pins the whole live tune as literals (re-pin deliberately when retuning)', () => {
    // The behavior suites use these constants symbolically, so THIS block is
    // what actually fails on a silent retune: every tuned number ships pinned.
    expect(BG_CARRIER_VULN_DELAY).toBe(75); // ~two 236yd flag runs
    expect(BG_CARRIER_VULN_INTERVAL).toBe(15);
    expect(BG_MAX_DURATION).toBe(720); // 12 minute cap, scaled with the field
    expect(BG_WAVE_PERIOD).toBe(10);
    expect(BG_WAVE_OFFSET).toBe(5);
    expect(BG_POWER_RUNE_VALUE).toBeCloseTo(0.15, 10);
    expect(BATTLEGROUND_WIN_HONOR).toBe(60);
    expect(BATTLEGROUND_LOSS_HONOR).toBe(20);
    // the one deliberate zero-sum exception: the loser-side rating floor
    expect(BG_MIN_RATING).toBe(100);
  });

  it('the rating floor holds a loss at BG_MIN_RATING while the winner keeps the full delta', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    sim.meta(loser)!.bgRating = BG_MIN_RATING + 1; // one point above the floor
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winner);
    expect(sim.meta(loser)!.bgRating).toBe(BG_MIN_RATING); // clamped, not negative
    expect(sim.meta(winner)!.bgRating).toBeGreaterThan(1500); // winner unaffected
  });

  it('stepping on a sprint rune grants 1.4x haste for 10s and the rune recharges over 30s', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const rune = match.runes[0];
    expect(rune.active).toBe(true);
    tp(sim, runner, rune.pos.x, rune.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    const sprint = e.auras.find((a) => a.id === 'bg_sprint_rune');
    expect(sprint).toBeTruthy();
    expect(sprint!.value).toBeCloseTo(1.4, 5);
    expect(sprint!.duration).toBeCloseTo(10, 5);
    expect(rune.active).toBe(false); // consumed, now recharging
    tp(sim, runner, rune.pos.x + 20, rune.pos.z); // step away
    rune.cooldown = 0.1; // fast-forward the 30s recharge
    sim.tick();
    sim.tick();
    expect(match.runes[0].active).toBe(true);
    expect(match.runes[0].cooldown).toBeLessThanOrEqual(0);
  });

  it('enemies are hostile, teammates are not (and cannot be healed cross-team)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = sim.entities.get(match.teams[0][0])!;
    const mate = sim.entities.get(match.teams[0][1])!;
    const foe = sim.entities.get(match.teams[1][0])!;
    expect(sim.isHostileTo(a, foe)).toBe(true);
    expect(sim.isHostileTo(a, mate)).toBe(false);
    expect(sim.isHostileTo(foe, a)).toBe(true);
  });

  it('an equal score at the 720s cap is a draw: Elo moves by the 0.5 draw math, no W/L', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    // skew the team averages so the draw math must move points
    for (const pid of match.teams[0]) sim.meta(pid)!.bgRating = 1600;
    for (const pid of match.teams[1]) sim.meta(pid)!.bgRating = 1400;
    match.ratingAvg = [1600, 1400];
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    // give Azure an equalizer via the mirror path
    const azureRunner = match.teams[1][0];
    tp(sim, azureRunner, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.bgFlagAction(azureRunner);
    sim.tick();
    tp(sim, azureRunner, match.flags[1].home.x, match.flags[1].home.z);
    sim.tick();
    expect(match.scores).toEqual([1, 1]);
    match.timer = BG_MAX_DURATION - 0.1;
    for (let i = 0; i < 5; i++) sim.tick();
    expect(match.state).toBe('ended'); // the cap freezes the result screen first
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null);
    const expected = eloDelta(1600, 1400, 0.5); // negative: the favorite dropped a draw
    expect(expected).toBeLessThan(0);
    for (const pid of match.teams[0]) {
      expect(sim.meta(pid)!.bgRating).toBe(1600 + expected);
      expect(sim.meta(pid)!.bgWins).toBe(0);
      expect(sim.meta(pid)!.bgLosses).toBe(0);
    }
    for (const pid of match.teams[1]) expect(sim.meta(pid)!.bgRating).toBe(1400 - expected);
  });

  it('pins the decisive Elo delta to a literal (jgyy review: catches uniform scaling)', () => {
    // 1600 vs 1400, decisive win for the favorite: the exact arena-formula
    // output, pinned as a NUMBER so a K or curve change cannot pass silently.
    expect(eloDelta(1600, 1400, 1)).toBe(8);
    expect(eloDelta(1400, 1600, 1)).toBe(24); // the underdog's win pays more
  });

  it('team Elo is zero-sum on a decisive result', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const before = [...match.teams[0], ...match.teams[1]].reduce(
      (s, p) => s + sim.meta(p)!.bgRating,
      0,
    );
    const winners = [...match.teams[0]];
    const losers = [...match.teams[1]];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winners[0]);
    const after = [...winners, ...losers].reduce((s, p) => s + sim.meta(p)!.bgRating, 0);
    expect(after).toBe(before); // zero-sum (no one near the floor)
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(losers[0])!.bgRating).toBeLessThan(1500);
  });

  it('a team that fully leaves forfeits: rating moves, no honor is paid', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winners = [...match.teams[0]];
    const honorBefore = sim.meta(winners[0])!.honor;
    for (const pid of [...match.teams[1]]) sim.removePlayer(pid);
    expect(sim.bgMatchFor(winners[0])).toBe(null);
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(winners[0])!.bgWins).toBe(1);
    expect(sim.meta(winners[0])!.honor).toBe(honorBefore); // forfeits pay nothing
  });
});

describe('Thornhollow Fields: review-hardening pins', () => {
  it('the ACTIVE battleground phase draws ZERO rng (the one draw is at match start)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // Drive the phase DIRECTLY (not sim.tick, whose other phases draw) across
    // countdown tail, wave respawns, rune claims (sprint AND power, so the
    // face alternation is proven draw-free), and a capture: the observer must
    // count zero draws. (setObserver, not the private field: a field rename
    // must fail this test, never vacuously pass it.)
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const runner = match.teams[0][0];
    tp(sim, runner, match.runes[0].pos.x, match.runes[0].pos.z);
    // a power-rune claim inside the window proves the alternation draws nothing
    const powerRunner = match.teams[0][2];
    tp(sim, powerRunner, match.runes[4].pos.x, match.runes[4].pos.z);
    kill(sim, match.teams[1][1]);
    sim.releaseSpirit(match.teams[1][1]); // the wave raises released spirits only
    const timerBefore = match.timer;

    // 20s covers the worst chain: the 6s auto-release just missing a wave,
    // then the full 10s to the next one (release + ward + revive all inside
    // this phase, still zero draws).
    for (let i = 0; i < 20 * 20; i++) updateBattleground(sim.ctx);
    expect(draws).toBe(0); // zero draws across 20s of battleground
    expect(match.timer).toBeGreaterThan(timerBefore + 10); // and the phase really ran
    expect(sim.entities.get(match.teams[1][1])!.dead).toBe(false); // released + wave-raised
  });

  it('a single deserter takes the rating loss and the recorded L; the team fights on', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const leaver = match.teams[1][0];
    const stayer = match.teams[1][1];
    const before = sim.meta(leaver)!.bgRating;
    // the server's pre-save path resolves the desertion while the meta is live
    sim.bgResolveDesertion(leaver);
    expect(sim.meta(leaver)!.bgRating).toBeLessThan(before); // the loss delta landed
    expect(sim.meta(leaver)!.bgLosses).toBe(1);
    const afterFirst = sim.meta(leaver)!.bgRating;
    sim.bgResolveDesertion(leaver); // idempotent: already off the roster
    expect(sim.meta(leaver)!.bgRating).toBe(afterFirst);
    // the match continues a player down; nobody else was scored yet
    expect(sim.bgMatchFor(stayer)).toBe(match);
    expect(sim.bgMatchFor(leaver)).toBe(null);
    expect(match.teams[1]).toHaveLength(4);
    expect(sim.meta(stayer)!.bgLosses).toBe(0);
  });

  it('an over-size group (a raid) is refused with a message, never silently truncated', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    const members = [leader];
    for (let i = 0; i < 5; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      members.push(m);
    }
    // assemble a six-member group directly on the PartyMachine (raid-size
    // groups exceed the normal invite cap; the offline staging precedent)
    const machine = (
      sim as unknown as {
        party: { parties: Map<number, unknown>; partyByPid: Map<number, number> };
      }
    ).party;
    machine.parties.set(77, { id: 77, leader, members: [...members] });
    for (const m of members) machine.partyByPid.set(m, 77);
    sim.bgQueueJoin(leader); // group of six
    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(leader)!.queueSize).toBe(0);
  });

  it('a queued player who walks into an instance is evicted with the leave notice', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 0, -40);
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(a);
    sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
    const dungeonInstance = instanceOrigin(0, 0);
    tp(sim, a, dungeonInstance.x, dungeonInstance.z); // a dungeon instance band
    const evs = sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(false);
    expect(evs.some((e) => e.type === 'bgUnqueued' && e.pid === a)).toBe(true);
  });

  it('a live participant cannot enter a delve mid-match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    sim.enterDelve('collapsed_reliquary', 'tier1', pid);
    sim.tick();
    expect(sim.bgMatchFor(pid)).toBe(match); // still in the match, not in a delve
    expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
  });

  it('the honor DR window round-trips through CharacterState and clears on UTC rollover', () => {
    const { sim, pids } = tenInQueue();
    sim.utcDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winner);
    const daily = sim.meta(winner)!.honorArenaDaily!;
    expect(daily.bgResultsByOpponent).toBeTruthy();
    expect(Object.values(daily.bgResultsByOpponent!)).toEqual([1]);
    expect(daily.date).toBe('2026-07-26');
    // ROLLOVER: the next award on a new UTC day re-keys the window and pays
    // the full price again (the reset arm in pvp/honor.ts dailyWindow)
    const honorAfterDayOne = sim.meta(winner)!.honor;
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick(); // run out the result screen
    sim.utcDay = '2026-07-27';
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    const rematch = sim.bgMatchFor(winner)!;
    toActive(sim, rematch);
    const rewinner = rematch.teams[0].includes(winner) ? winner : rematch.teams[1][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, rematch, rematch.teams[0][0]);
    const team0Won = rematch.teams[0].includes(rewinner);
    const meta = sim.meta(rewinner)!;
    expect(meta.honorArenaDaily!.date).toBe('2026-07-27'); // window re-keyed
    expect(Object.values(meta.honorArenaDaily!.bgResultsByOpponent ?? {})).toEqual([1]);
    // full price again, NOT the same-day repeat decay
    const paid = meta.honor - (rewinner === winner ? honorAfterDayOne : 0);
    expect(paid).toBe(team0Won ? BATTLEGROUND_WIN_HONOR : BATTLEGROUND_LOSS_HONOR);
    // persists across a save/load round trip (the anti-win-trading window)
    const state = sim.serializeCharacter(winner)!;
    expect(state.honorArenaDaily!.bgResultsByOpponent).toEqual(daily.bgResultsByOpponent);
    const sim2 = makeWorld();
    const reloaded = sim2.addPlayer('warrior', 'Reload', { state });
    expect(sim2.meta(reloaded)!.honorArenaDaily!.bgResultsByOpponent).toEqual(
      daily.bgResultsByOpponent,
    );
  });
});

describe('Thornhollow Fields: honor + persistence', () => {
  it('a played-out win pays BATTLEGROUND_WIN_HONOR, the losers BATTLEGROUND_LOSS_HONOR, repeat-decayed', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winner);
    expect(sim.meta(winner)!.honor).toBe(BATTLEGROUND_WIN_HONOR);
    expect(sim.meta(winner)!.lifetimeHonor).toBe(BATTLEGROUND_WIN_HONOR);
    expect(sim.meta(loser)!.honor).toBe(BATTLEGROUND_LOSS_HONOR);
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick(); // run out the result screen

    // the same ten rematch: the repeat vs the SAME opposing team pays half
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    const rematch = sim.bgMatchFor(winner)!;
    expect(rematch).toBeTruthy();
    toActive(sim, rematch);
    const winner2 = rematch.teams[0][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, rematch, winner2);
    const w2meta = sim.meta(winner2)!;
    const firstAward = rematch.teams[0].includes(winner)
      ? BATTLEGROUND_WIN_HONOR
      : BATTLEGROUND_LOSS_HONOR;
    expect(w2meta.honor).toBe(firstAward + Math.floor(BATTLEGROUND_WIN_HONOR * 0.5));
  });

  it('battleground standing round-trips through CharacterState and stays absent until first result', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Keeper');
    // untouched standing: the save carries NO bg fields (byte-stable saves)
    const clean = sim.serializeCharacter(a)!;
    expect(clean.bgRating).toBeUndefined();
    expect(clean.bgWins).toBeUndefined();
    sim.meta(a)!.bgRating = 1633;
    sim.meta(a)!.bgWins = 7;
    sim.meta(a)!.bgCaptures = 19;
    const state = sim.serializeCharacter(a)!;
    expect(state.bgRating).toBe(1633);
    expect(state.bgWins).toBe(7);
    expect(state.bgLosses).toBe(0);
    expect(state.bgCaptures).toBe(19);
    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('druid', 'Keeper', { state });
    expect(sim2.meta(a2)!.bgRating).toBe(1633);
    expect(sim2.meta(a2)!.bgWins).toBe(7);
    expect(sim2.meta(a2)!.bgCaptures).toBe(19);
  });
});
