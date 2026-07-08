// The Vale Cup behavior spec (docs/prd/vale-cup.md): queue guards, packing,
// bot backfill, practice, the full match lifecycle (countdown / kickoff /
// dribble / kick / goals / golden / over), the sport-kit swap round trip,
// desertion, standings persistence, determinism, and rng purity.
//
// Inventory note (v0.21): fresh characters spawn WITH starter rations, so no
// assertion here compares exact inventories; the kit round-trip compares the
// ABILITY list, not bags.

import { describe, expect, it } from 'vitest';
import { SPORT_KITS, VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import { DUNGEON_X_THRESHOLD, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  endCupMatch,
  VALE_CUP_BRAM_ID,
  VC_BACKFILL_WAIT,
  VC_DESERTER_LOCKOUT,
  VC_GOLDEN_CAP,
  VC_MATCH_DURATION,
  vcupPackTeams,
} from '../src/sim/social/vale_cup';
import type { SimEvent } from '../src/sim/types';
import {
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  isOnPitch,
  PITCH,
  PITCH_CENTER,
} from '../src/sim/vale_cup_layout';
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

function addAt(sim: Sim, cls: Parameters<Sim['addPlayer']>[0], name: string, x = 0, z = -40) {
  const pid = sim.addPlayer(cls, name);
  teleport(sim, pid, x, z);
  return pid;
}

function errorsOf(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as any).text as string);
}

// Ready up every human fighter in the current match (bots auto-ready), so the
// briefing ends at once and the whistle countdown begins.
function readyAll(sim: Sim) {
  const matches = [sim.vcup.match, ...sim.vcup.practices].filter((m) => m !== null);
  for (const m of matches) {
    for (const pid of [...m!.teamA, ...m!.teamB]) {
      if (!sim.vcup.botPids.includes(pid)) sim.vcupReady(pid);
    }
  }
}

// Queue a 1v1 and run it to the active phase (briefing readied, kickoff done).
function startBout(sim: Sim, a: number, b: number) {
  sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
  sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
  sim.tick();
  expect(sim.vcup.match).toBeTruthy();
  readyAll(sim);
  for (let i = 0; i < 20 * 5 && sim.vcup.match!.phase !== 'active'; i++) sim.tick();
  expect(sim.vcup.match!.phase).toBe('active');
  return sim.vcup.match!;
}

function tickUntil(sim: Sim, pred: () => boolean, maxTicks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < maxTicks && !pred(); i++) out.push(...sim.tick());
  return out;
}

describe('Vale Cup: queue guards', () => {
  it('rejects a dead, instanced, dueling-free litany with the arena literals', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const e = sim.entities.get(a)!;
    e.dead = true;
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('You cannot queue for the arena while dead.');
    e.dead = false;
    teleport(sim, a, DUNGEON_X_THRESHOLD + 50, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('You cannot queue from inside an instance.');
  });

  it('rejects a missing banner nation', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(2, 'atlantis' as never, 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('Pick a banner nation first.');
  });

  it('rejects dueling and mid-trade queuers with the arena literals', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    (sim as any).duels.set(a, { a, b: -1, state: 'active' });
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('You cannot queue while dueling.');
    (sim as any).duels.delete(a);
    (sim as any).trades.set(a, {});
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('Finish your trade before queueing.');
  });

  it('rejects a party larger than the bracket', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 2, -40);
    const c = addAt(sim, 'rogue', 'Gimel', 4, -40);
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    sim.drainEvents();
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('That bracket needs a smaller party.');
  });

  it('only the party leader may queue the team', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 2, -40);
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.drainEvents();
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, b);
    expect(errorsOf(sim.drainEvents())).toContain(
      'Only the party leader may queue your team for the Vale Cup.',
    );
  });

  it('the Groundskeeper remembers deserters', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcup.deserters.set('aleph', sim.time + 120);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    expect(errorsOf(sim.drainEvents())).toContain('The Groundskeeper remembers. Come back later.');
    expect(sim.cupInfoFor(a)!.deserterFor).toBeGreaterThan(0);
  });

  it('re-queueing the same bracket re-emits the position; another bracket errors', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(3, 'vale', 'striker', false, a);
    sim.drainEvents();
    sim.vcupQueueJoin(3, 'vale', 'striker', false, a);
    const again = sim.drainEvents();
    expect(again.some((e) => e.type === 'vcupQueued' && (e as any).position === 1)).toBe(true);
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a);
    const err = errorsOf(sim.drainEvents());
    expect(err.some((t) => t.startsWith('You are already in the Vale Cup 3v3 queue.'))).toBe(true);
  });

  it('vcupSetRole updates a queued role; 1v1 and 2v2 force the all-rounder kit', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(3, 'vale', 'striker', false, a);
    expect(sim.cupInfoFor(a)!.role).toBe('striker');
    sim.vcupSetRole('keeper', a);
    expect(sim.cupInfoFor(a)!.role).toBe('keeper');
    sim.vcupQueueLeave(a);
    sim.vcupQueueJoin(2, 'vale', 'keeper', false, a);
    expect(sim.cupInfoFor(a)!.role).toBe('allrounder');
  });
});

describe('Vale Cup: matchmaking and packing', () => {
  it('a lone queuer waits; a second fills the 1v1 and the one slot busies', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.tick();
    expect(sim.vcup.match).toBe(null);
    expect(sim.cupInfoFor(a)!.queued).toBe(true);
    expect(sim.cupInfoFor(a)!.queueSizes[1]).toBe(1);
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    expect(sim.vcup.match!.rated).toBe(true);
    expect(sim.cupInfoFor(a)!.queued).toBe(false);
    expect(sim.cupInfoFor(a)!.match!.team).toBe('A');
    expect(sim.cupInfoFor(b)!.match!.team).toBe('B');
  });

  it('packs a premade against solos in a 2v2 (first-fit, queue order)', () => {
    const sim = makeWorld();
    const a1 = addAt(sim, 'warrior', 'AlephOne');
    const a2 = addAt(sim, 'mage', 'AlephTwo', 2, -40);
    const s1 = addAt(sim, 'rogue', 'SoloOne', 4, -40);
    const s2 = addAt(sim, 'priest', 'SoloTwo', 6, -40);
    sim.partyInvite(a2, a1);
    sim.partyAccept(a2);
    sim.drainEvents();
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a1);
    sim.vcupQueueJoin(2, 'thornpeak', 'allrounder', false, s1);
    sim.vcupQueueJoin(2, 'ogre', 'allrounder', false, s2);
    sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.teamA).toEqual([a1, a2]);
    expect(match.teamB).toEqual([s1, s2]);
    expect(match.nationA).toBe('vale');
    expect(match.nationB).toBe('thornpeak');
    expect(match.awayPalette).toBe(false);
  });

  it('packs solos and premades into full teams for every bracket (pure first-fit)', () => {
    const unit = (n: number, ...pids: number[]) => ({
      pids,
      nation: 'vale' as const,
      roles: {},
      joinedAtTick: n,
      guilds: {},
    });
    // 5v5 from ten solos: five per side, queue order.
    const solos = Array.from({ length: 10 }, (_, i) => unit(i, 100 + i));
    const five = vcupPackTeams(solos, 5)!;
    expect(five.a.flatMap((u) => u.pids)).toEqual([100, 101, 102, 103, 104]);
    expect(five.b.flatMap((u) => u.pids)).toEqual([105, 106, 107, 108, 109]);
    // 3v3 from a trio, a duo, and solos: the duo cannot join the full trio side.
    const mixed = [unit(0, 1, 2, 3), unit(1, 4, 5), unit(2, 6), unit(3, 7)];
    const three = vcupPackTeams(mixed, 3)!;
    expect(three.a.flatMap((u) => u.pids)).toEqual([1, 2, 3]);
    expect(three.b.flatMap((u) => u.pids)).toEqual([4, 5, 6]);
    // Not enough bodies: no match.
    expect(vcupPackTeams([unit(0, 1, 2)], 2)).toBe(null);
  });

  it('gives a freed pitch to the oldest-waiting bracket (FIFO), not the smallest', () => {
    const sim = makeWorld();
    // Occupy the pitch with a 1v1 rated bout.
    const a = addAt(sim, 'warrior', 'Occ1', 0, -40);
    const b = addAt(sim, 'mage', 'Occ2', 4, -40);
    const bout = startBout(sim, a, b);
    // While it runs, a 3v3 group queues FIRST...
    const trio = Array.from({ length: 6 }, (_, i) =>
      addAt(sim, 'warrior', `Trio${i}`, 10 + i, -40),
    );
    for (const pid of trio) sim.vcupQueueJoin(3, 'vale', 'striker', false, pid);
    for (let i = 0; i < 40; i++) sim.tick(); // 2s later...
    // ...then a fresh 1v1 pair queues (smaller bracket, but younger).
    const c = addAt(sim, 'rogue', 'Late1', 20, -40);
    const d = addAt(sim, 'priest', 'Late2', 24, -40);
    sim.vcupQueueJoin(1, 'ogre', 'allrounder', false, c);
    sim.vcupQueueJoin(1, 'thornpeak', 'allrounder', false, d);
    // Free the pitch and let matchmaking choose.
    (bout as any).scoreA = 1;
    (bout as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
    tickUntil(sim, () => sim.vcup.match !== null, 20 * 2);
    const next = sim.vcup.match!;
    expect(next.bracket).toBe(3); // the older 3v3 gets the pitch, not the young 1v1
    expect(next.teamA.concat(next.teamB).sort()).toEqual([...trio].sort());
    // The 1v1 pair is still queued, waiting their turn.
    expect(sim.cupInfoFor(c)!.queued).toBe(true);
  });

  it('the away side plays the inverted palette when both pick the same banner', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, b);
    sim.tick();
    expect(sim.vcup.match!.awayPalette).toBe(true);
  });

  it('autofills a keeper on each 3v3 side when every human picked outfield', () => {
    const sim = makeWorld();
    // Six solo queuers, all outfield (striker), pack into two full teams of 3.
    const pids = Array.from({ length: 6 }, (_, i) =>
      addAt(sim, 'warrior', `Field${i}`, i * 2, -40),
    );
    for (const pid of pids) sim.vcupQueueJoin(3, 'vale', 'striker', false, pid);
    sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    // Exactly one keeper per side, and it is the last-listed seat (never seat 0).
    for (const team of [match.teamA, match.teamB]) {
      const keepers = team.filter((pid) => match.roles[pid] === 'keeper');
      expect(keepers).toEqual([team[team.length - 1]]);
      expect(match.roles[team[0]]).toBe('striker'); // the captain keeps their pick
    }
  });

  it('does not add a second keeper when a human already picked keeper', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: 6 }, (_, i) => addAt(sim, 'warrior', `K${i}`, i * 2, -40));
    // First queuer on each packed side picks keeper (queue order: A=0,1,2 B=3,4,5).
    sim.vcupQueueJoin(3, 'vale', 'keeper', false, pids[0]);
    sim.vcupQueueJoin(3, 'vale', 'striker', false, pids[1]);
    sim.vcupQueueJoin(3, 'vale', 'sweeper', false, pids[2]);
    sim.vcupQueueJoin(3, 'mirefen', 'keeper', false, pids[3]);
    sim.vcupQueueJoin(3, 'mirefen', 'striker', false, pids[4]);
    sim.vcupQueueJoin(3, 'mirefen', 'sweeper', false, pids[5]);
    sim.tick();
    const match = sim.vcup.match!;
    for (const team of [match.teamA, match.teamB]) {
      expect(team.filter((pid) => match.roles[pid] === 'keeper').length).toBe(1);
    }
  });

  it('never autofills a keeper in 1v1 or 2v2 (all-rounder brackets)', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: 4 }, (_, i) => addAt(sim, 'warrior', `R${i}`, i * 2, -40));
    for (const pid of pids) sim.vcupQueueJoin(2, 'vale', 'allrounder', false, pid);
    sim.tick();
    const match = sim.vcup.match!;
    for (const pid of [...match.teamA, ...match.teamB]) {
      expect(match.roles[pid]).toBe('allrounder');
    }
  });
});

describe('Vale Cup: parimutuel betting', () => {
  // Stage a bot showcase in the briefing window, then seat two spectators at the
  // Sowfield with copper to wager.
  function stageBettableMatch() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Host' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const match = sim.vcup.match!;
    expect(match.phase).toBe('briefing');
    const s1 = addAt(sim, 'warrior', 'Bettor1', PITCH_CENTER.x, PITCH_CENTER.z - 22);
    const s2 = addAt(sim, 'warrior', 'Bettor2', PITCH_CENTER.x + 3, PITCH_CENTER.z - 22);
    sim.players.get(s1)!.copper = 1000;
    sim.players.get(s2)!.copper = 1000;
    return { sim, match, s1, s2 };
  }

  it('winners split the whole pool pro-rata and the record persists', () => {
    const { sim, match, s1, s2 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 300, s2);
    expect(sim.players.get(s1)!.copper).toBe(900);
    expect(sim.players.get(s2)!.copper).toBe(700);
    expect(match.bets.poolA).toBe(100);
    expect(match.bets.poolB).toBe(300);
    // A wins: winPool 100, losePool 300. s1 gets stake 100 + 100*300/100 = 400.
    endCupMatch(sim.ctx, match, 'A');
    expect(sim.players.get(s1)!.copper).toBe(900 + 400);
    expect(sim.players.get(s2)!.copper).toBe(700); // lost stake stays debited
    expect(sim.players.get(s1)!.vcupBetWins).toBe(1);
    expect(sim.players.get(s1)!.vcupBetNet).toBe(300);
    expect(sim.players.get(s2)!.vcupBetLosses).toBe(1);
    expect(sim.players.get(s2)!.vcupBetNet).toBe(-300);
  });

  it('a draw (or a winner nobody backed) refunds every stake', () => {
    const { sim, match, s1, s2 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 200, s2);
    endCupMatch(sim.ctx, match, null); // golden-cap draw
    expect(sim.players.get(s1)!.copper).toBe(1000); // refunded
    expect(sim.players.get(s2)!.copper).toBe(1000);
    expect(sim.players.get(s1)!.vcupBetWins).toBe(0);
    expect(sim.players.get(s1)!.vcupBetLosses).toBe(0);
  });

  it('rejects a second wager on the opposite side, allows topping up the same side', () => {
    const { sim, match, s1 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 50, s1); // rejected: already backed A
    expect(match.bets.poolB).toBe(0);
    expect(sim.players.get(s1)!.copper).toBe(900);
    sim.vcupBet('A', 50, s1); // top up A
    expect(match.bets.poolA).toBe(150);
    expect(match.bets.wagers.get(s1)!.stake).toBe(150);
    expect(sim.players.get(s1)!.copper).toBe(850);
  });

  it('refuses a bet from a participant, from off-site, and once betting closes', () => {
    const { sim, match, s1 } = stageBettableMatch();
    // A participant (a seated bot) cannot bet on its own match.
    const bot = match.teamA[0];
    sim.vcupBet('A', 100, bot);
    expect(match.bets.poolA).toBe(0);
    // Off-site spectator: teleport far away, the bet is refused.
    teleport(sim, s1, 0, -300);
    sim.vcupBet('A', 100, s1);
    expect(match.bets.poolA).toBe(0);
    expect(sim.players.get(s1)!.copper).toBe(1000);
    // Betting closes once the phase leaves briefing.
    teleport(sim, s1, PITCH_CENTER.x, PITCH_CENTER.z - 22);
    match.phase = 'active';
    sim.vcupBet('A', 100, s1);
    expect(match.bets.poolA).toBe(0);
  });
});

describe('Vale Cup: bot showcase', () => {
  it('auto-stages a 3v3 bot exhibition after 60s idle when showcase is enabled', () => {
    // A human is online (so someone can watch), nobody queues: after the idle
    // stretch the Sowfield stages a full bot-vs-bot match with distinct nations.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.teamA.length).toBe(3);
    expect(match.teamB.length).toBe(3);
    expect(match.nationA).not.toBe(match.nationB);
    // Every fighter is a bot (no human seated in an exhibition).
    expect(sim.vcup.botPids.length).toBe(6);
    for (const pid of [...match.teamA, ...match.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(true);
    }
    expect(match.rated).toBe(false);
  });

  it('does not stage a showcase when the flag is off (tests/goldens stay quiet)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    for (let i = 0; i < 20 * 65; i++) sim.tick();
    expect(sim.vcup.match).toBe(null);
  });

  it('preempts a live bot exhibition the moment two humans can form a rated match', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const showcase = sim.vcup.match!;
    expect(showcase).toBeTruthy();
    expect(showcase.rated).toBe(false);
    // Two humans queue a 1v1: the exhibition must yield the pitch to them.
    const a = addAt(sim, 'mage', 'RealOne', 0, -40);
    const b = addAt(sim, 'rogue', 'RealTwo', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    // A couple of ticks: preempt (frees the pitch), remove bots, seat the rated match.
    for (let i = 0; i < 4 && !(sim.vcup.match && sim.vcup.match.rated); i++) sim.tick();
    const real = sim.vcup.match!;
    expect(real).toBeTruthy();
    expect(real.id).not.toBe(showcase.id);
    expect(real.rated).toBe(true);
    expect(real.teamA).toContain(a);
    expect(real.teamB).toContain(b);
    // The showcase bots are gone (only the two real humans remain seated).
    for (const pid of [...real.teamA, ...real.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(false);
    }
  });

  it('does not preempt a bot-backfilled match (a human is playing in it)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    // A lone human queues and gets bot-backfilled after the wait: that match has
    // a human seated, so a second late queuer must NOT tear it down.
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, sim.primaryId);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 + 4 && !sim.vcup.match; i++) sim.tick();
    const backfilled = sim.vcup.match!;
    expect(backfilled).toBeTruthy();
    expect(backfilled.rated).toBe(false);
    expect(backfilled.teamA).toContain(sim.primaryId);
    const late = addAt(sim, 'mage', 'Latecomer', 0, -40);
    sim.vcupQueueJoin(1, 'ogre', 'allrounder', false, late);
    for (let i = 0; i < 6; i++) sim.tick();
    // The human's backfilled match is untouched; the latecomer waits in queue.
    expect(sim.vcup.match!.id).toBe(backfilled.id);
    expect(sim.cupInfoFor(late)!.queued).toBe(true);
  });

  it('bots use the pass mechanic to build up in a showcase match', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    // Record every ability a bot casts across the briefing + a chunk of play.
    const casts: string[] = [];
    const orig = sim.castAbility.bind(sim);
    (sim as unknown as { castAbility: typeof sim.castAbility }).castAbility = (id, pid, aim) => {
      casts.push(id);
      return orig(id, pid, aim);
    };
    // Stop as soon as a pass fires (fast in the common case; the full window is
    // the upper bound so the test never runs away under full-suite load).
    for (let i = 0; i < 20 * 240 && !casts.includes('sport_pass'); i++) sim.tick();
    // The AI plays crisp lead passes in build-up (not just hopeful shots).
    expect(casts).toContain('sport_pass');
  });
});

describe('Vale Cup: bot backfill and practice', () => {
  it('backfills both sides with bots after the human unit waits out the timer (unrated)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 - 2; i++) sim.tick();
    expect(sim.vcup.match).toBe(null); // still waiting at 59.9s
    sim.tick();
    sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.rated).toBe(false);
    expect(sim.vcup.botPids.length).toBe(3);
    expect(match.teamA[0]).toBe(a);
    // Bot names are lore-flavored and unique.
    const names = [...match.rosterA, ...match.rosterB].map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    // Unrated: ready up, force a quick decision, confirm no standing moved.
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    (match as any).scoreA = 1;
    (match as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
    expect(sim.vcup.match).toBe(null);
    expect(sim.vcup.botPids.length).toBe(0);
    const meta = sim.players.get(a)!;
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0);
  });

  it('practice seats you on a PRIVATE instanced pitch, not the physical slot', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(3);
    // The one physical Sowfield slot stays free; practice lives in its own list.
    expect(sim.vcup.match).toBe(null);
    const match = sim.vcup.practices[0];
    expect(match).toBeTruthy();
    expect(match.bracket).toBe(3);
    expect(match.rated).toBe(false);
    expect(match.practice?.ownerPid).toBe(sim.primaryId);
    expect(sim.vcup.botPids.length).toBe(5);
    expect(match.teamA[0]).toBe(sim.primaryId);
    expect(match.roles[match.teamB[0]]).toBe('keeper');
    // Seated far from the Sowfield (its own instance band), not on the real pitch.
    const me = sim.entities.get(sim.primaryId)!;
    expect(me.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });

  it('a full practice bout plays itself out and cleans up, returning me home', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter', playerName: 'Solo' });
    const home = { ...sim.entities.get(sim.primaryId)!.pos };
    sim.vcupPracticeStart(1);
    expect(sim.vcup.practices.length).toBe(1);
    let end: SimEvent | undefined;
    for (let i = 0; i < 20 * (VC_MATCH_DURATION + 60) && sim.vcup.practices.length > 0; i++) {
      for (const ev of sim.tick()) if (ev.type === 'vcupEnd') end = ev;
    }
    expect(sim.vcup.practices.length).toBe(0);
    expect(end).toBeTruthy();
    expect(sim.vcup.botPids.length).toBe(0);
    expect(sim.players.size).toBe(1); // bots removed
    const meta = sim.players.get(sim.primaryId)!;
    expect(meta.sportRole).toBe(null);
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0); // unrated
    // Returned to where I started (not left out in the instance band).
    const me = sim.entities.get(sim.primaryId)!;
    expect(Math.hypot(me.pos.x - home.x, me.pos.z - home.z)).toBeLessThan(2);
  });
});

describe('Vale Cup: match lifecycle', () => {
  it('runs whistle -> kickoff -> dribble -> kick -> goal -> reset, and first-to-5 ends early', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    const found = sim.tick();
    expect(found.filter((e) => e.type === 'vcupFound').length).toBe(2);
    const match = sim.vcup.match!;
    // The match opens on the pre-match briefing; readying up starts the whistle.
    expect(match.phase).toBe('briefing');
    // Fighters stand on the pitch in their own halves; the sport kit is live.
    const ae = sim.entities.get(a)!;
    expect(isOnPitch(ae.pos.x, ae.pos.z)).toBe(true);
    expect(sim.players.get(a)!.known.map((k) => k.def.id)).toEqual([...SPORT_KITS.allrounder]);
    // No ball during the briefing/whistle; kickoff spawns it at the center spot.
    expect(match.ball).toBe(null);
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'countdown', 20 * 1);
    expect(match.phase).toBe('countdown');
    const kickoffEvents = tickUntil(sim, () => match.phase === 'active', 20 * 4);
    expect(kickoffEvents.some((e) => e.type === 'vcupKickoff')).toBe(true);
    const ballE = sim.entities.get(match.ball!.entityId)!;
    expect(ballE.templateId).toBe(VALE_CUP_BALL_TEMPLATE_ID);
    expect(ballE.hostile).toBe(false);
    expect(ballE.pos.x).toBeCloseTo(PITCH_CENTER.x, 3);

    // DRIBBLE: the kickoff taker runs east through the ball and carries it.
    const am = sim.players.get(a)!;
    am.moveInput.forward = true;
    for (let i = 0; i < 20; i++) sim.tick();
    am.moveInput.forward = false;
    expect(ballE.pos.x).toBeGreaterThan(PITCH_CENTER.x + 2);

    // KICK: stage the ball just outside the east goal (the pitch is wide, so a
    // shot from the center spot would not reach) and boot it in for team A.
    // Park the lone opponent in a corner so their body cannot trap the shot.
    teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1);
    match.ball!.x = GOAL_LINE_EAST_X - 6;
    match.ball!.z = PITCH_CENTER.z;
    teleport(sim, a, GOAL_LINE_EAST_X - 8, PITCH_CENTER.z);
    sim.entities.get(a)!.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, { x: GOAL_LINE_EAST_X + 12, z: PITCH_CENTER.z });
    const goalEvents = tickUntil(sim, () => match.phase === 'goal', 20 * 8);
    const goal = goalEvents.find((e) => e.type === 'vcupGoal') as any;
    expect(goal).toBeTruthy();
    expect(goal.team).toBe('A');
    expect(goal.scorerName).toBe('Aleph');
    expect(match.scoreA).toBe(1);
    expect(match.kickoffTeam).toBe('B'); // kickoff goes to the conceding team

    // Celebrate 4s, then the kickoff reset: ball back at the center spot.
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.ball!.x).toBeCloseTo(PITCH_CENTER.x, 3);

    // First to 5 ends it early: repeat the move four more times, each staged at
    // the east goal (opponent parked in the far corner out of the shot lane).
    for (let g = 0; g < 4; g++) {
      teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1);
      match.ball!.x = GOAL_LINE_EAST_X - 6;
      match.ball!.z = PITCH_CENTER.z;
      teleport(sim, a, GOAL_LINE_EAST_X - 8, PITCH_CENTER.z);
      sim.entities.get(a)!.facing = Math.PI / 2;
      sim.castAbility('sport_shoot', a, { x: GOAL_LINE_EAST_X + 12, z: PITCH_CENTER.z });
      tickUntil(sim, () => match.phase === 'goal', 20 * 10);
      tickUntil(sim, () => match.phase !== 'goal', 20 * 6);
    }
    expect(match.scoreA).toBe(5);
    expect(match.phase).toBe('over');
    expect(match.ended).toBe(true);
    expect(sim.players.get(a)!.vcupWins).toBe(1);
    expect(sim.players.get(b)!.vcupLosses).toBe(1);

    // Aftermath: everyone goes home, the ball despawns, the slot frees.
    const ballId = match.ball!.entityId;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 10);
    expect(sim.entities.get(ballId)).toBeUndefined();
    expect(sim.entities.get(a)!.pos.x).toBeCloseTo(0, 1);
    expect(sim.entities.get(a)!.pos.z).toBeCloseTo(-40, 1);
    expect(sim.cupInfoFor(a)!.board[0]).toEqual({ name: 'Aleph', wins: 1 });
  });

  it('credits no scorer on an own goal the other side never touched in', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    // Team A puts the ball into its OWN (west) goal: park both fighters clear of
    // the lane, stage the ball at the west mouth with A as the last toucher, and
    // send it in. (Shoot always aims at the ENEMY goal, so an own goal is staged.)
    teleport(sim, a, PITCH.xMax - 2, PITCH.zMax - 2);
    teleport(sim, b, PITCH.xMax - 2, PITCH.zMin + 2);
    match.ball!.x = GOAL_LINE_WEST_X + 4;
    match.ball!.z = PITCH_CENTER.z;
    match.ball!.y = groundHeight(match.ball!.x, match.ball!.z, sim.cfg.seed);
    match.ball!.vx = -20;
    match.ball!.vy = 0;
    match.ball!.vz = 0;
    match.ball!.lastTouchPid = a;
    match.ball!.lastTouchTeam = 'A';
    match.ball!.lastKickPid = a;
    match.ball!.lastKickTeam = 'A';
    const events = tickUntil(sim, () => match.phase === 'goal', 20 * 8);
    const goal = events.find((e) => e.type === 'vcupGoal') as any;
    expect(goal.team).toBe('B');
    expect(match.scoreB).toBe(1);
    expect(goal.scorerName).toBe(''); // no confident scorer: nameless banner
  });

  it('full-time draw goes to golden goal; the golden cap ends in a draw', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    (match as any).clock = VC_MATCH_DURATION - 0.05;
    const goldenEvents = tickUntil(sim, () => match.phase === 'golden', 20 * 2);
    expect(goldenEvents.some((e) => e.type === 'vcupGolden')).toBe(true);
    expect(match.golden).toBe(true);
    expect(match.kickoffTeam).toBe('B');
    (match as any).goldenClock = VC_GOLDEN_CAP - 0.05;
    const endEvents = tickUntil(sim, () => match.phase === 'over', 20 * 2);
    const end = endEvents.find((e) => e.type === 'vcupEnd') as any;
    expect(end.winner).toBe(null);
    expect(sim.players.get(a)!.vcupDraws).toBe(1);
    expect(sim.players.get(b)!.vcupDraws).toBe(1);
  });

  it('a golden goal wins immediately after the celebrate', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    (match as any).clock = VC_MATCH_DURATION - 0.05;
    tickUntil(sim, () => match.phase === 'golden', 20 * 2);
    // Clear the lone opponent out of the shot lane (their body would trap it),
    // then stage the golden goal at the east mouth (the pitch is wide).
    teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1);
    match.ball!.x = GOAL_LINE_EAST_X - 6;
    match.ball!.z = PITCH_CENTER.z;
    teleport(sim, a, GOAL_LINE_EAST_X - 8, PITCH_CENTER.z);
    sim.entities.get(a)!.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, { x: GOAL_LINE_EAST_X + 12, z: PITCH_CENTER.z });
    tickUntil(sim, () => match.phase === 'over', 20 * 12);
    expect(match.phase).toBe('over');
    expect(sim.players.get(a)!.vcupWins).toBe(1);
    expect(sim.players.get(b)!.vcupLosses).toBe(1);
  });
});

describe('Vale Cup: sport moves', () => {
  // Stage a lone shooter on the ball a fixed distance out from the empty east
  // goal, facing it, then fire sport_shoot at a given charge (encoded as the aim
  // distance) and report whether it scored. No keeper, no other fighters.
  function shootFromRange(charge: number, outYd: number): { scored: boolean; maxY: number } {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Striker');
    const b = addAt(sim, 'mage', 'Keep', 4, -40);
    const match = startBout(sim, a, b);
    teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1); // opponent far away
    const ballX = GOAL_LINE_EAST_X - outYd;
    match.ball!.x = ballX;
    match.ball!.z = PITCH_CENTER.z;
    match.ball!.y = groundHeight(ballX, PITCH_CENTER.z, sim.cfg.seed);
    match.ball!.vx = 0;
    match.ball!.vy = 0;
    match.ball!.vz = 0;
    match.ball!.holderPid = null;
    teleport(sim, a, ballX - 1.5, PITCH_CENTER.z);
    sim.entities.get(a)!.facing = Math.PI / 2; // face east at the goal
    (match as any).kickoffGraceUntil = 0; // past the whistle grace
    // Aim distance encodes charge: charge*range from the shooter.
    const r = charge * 34;
    const ae = sim.entities.get(a)!;
    sim.castAbility('sport_shoot', a, {
      x: ae.pos.x + Math.sin(ae.facing) * r,
      z: ae.pos.z + Math.cos(ae.facing) * r,
    });
    let scored = false;
    let maxY = 0;
    for (let i = 0; i < 20 * 4 && !scored; i++) {
      const gy = groundHeight(match.ball!.x, match.ball!.z, sim.cfg.seed);
      maxY = Math.max(maxY, match.ball!.y - gy);
      for (const e of sim.tick()) if (e.type === 'vcupGoal') scored = true;
    }
    return { scored, maxY };
  }

  it('Shoot: a well-judged charge scores under the bar; a max-power charge sails over', () => {
    // ~70% charge from close range is a clean goal under the bar.
    expect(shootFromRange(0.7, 10).scored).toBe(true);
    // Full charge from the same spot balloons over the crossbar: no goal.
    const maxed = shootFromRange(1, 10);
    expect(maxed.scored).toBe(false);
    expect(maxed.maxY).toBeGreaterThan(2.5); // it climbed above the bar height
  });

  it('the harvest truce floors damage between fighters to 0', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const be = sim.entities.get(b)!;
    teleport(sim, a, PITCH_CENTER.x - 3, PITCH_CENTER.z + 3);
    teleport(sim, b, PITCH_CENTER.x + 1, PITCH_CENTER.z + 3);
    // The no-damage truce: a raw damage call between fighters cannot hurt.
    const hp0 = be.hp;
    sim.dealDamage(ae, be, 50, false, 'physical', null, 'hit');
    expect(be.hp).toBe(hp0);
  });

  // A 2v2 with a1+a2 premade on team A (against two parked human solos), run to
  // active. Returns the match plus every pid so a pass test can stage positions.
  function start2v2(sim: Sim) {
    const a1 = addAt(sim, 'warrior', 'Passer');
    const a2 = addAt(sim, 'warrior', 'Mate', 2, -40);
    const s1 = addAt(sim, 'warrior', 'OppOne', 4, -40);
    const s2 = addAt(sim, 'warrior', 'OppTwo', 6, -40);
    sim.partyInvite(a2, a1);
    sim.partyAccept(a2);
    sim.drainEvents();
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a1);
    sim.vcupQueueJoin(2, 'ogre', 'allrounder', false, s1);
    sim.vcupQueueJoin(2, 'coliseum', 'allrounder', false, s2);
    sim.tick();
    const match = sim.vcup.match!;
    expect(match.teamA).toEqual([a1, a2]);
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.phase).toBe('active');
    return { match, a1, a2, s1, s2 };
  }

  it('Pass rolls the ball to the TARGETED teammate, leading their run', () => {
    const sim = makeWorld();
    const { match, a1, a2, s1, s2 } = start2v2(sim);
    // Passer on the ball at center; mate 12yd north; opponents parked far away.
    teleport(sim, a1, PITCH_CENTER.x, PITCH_CENTER.z);
    teleport(sim, a2, PITCH_CENTER.x, PITCH_CENTER.z + 12);
    teleport(sim, s1, PITCH.xMin + 2, PITCH_CENTER.z);
    teleport(sim, s2, PITCH.xMin + 2, PITCH_CENTER.z + 2);
    const ball = match.ball!;
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.holderPid = null;
    match.kickoffGraceUntil = 0; // past the whistle grace so the pass is full weight
    sim.entities.get(a1)!.targetId = a2; // select the teammate (tab/click)
    // Aim deliberately points elsewhere: a targeted pass ignores it and finds the mate.
    sim.castAbility('sport_pass', a1, { x: PITCH_CENTER.x, z: PITCH_CENTER.z });
    expect(ball.vz).toBeGreaterThan(4); // heads north toward the mate, at real pace
    expect(Math.abs(ball.vx)).toBeLessThan(Math.abs(ball.vz));
    expect(ball.lastTouchPid).toBe(a1);
  });

  it('Pass with no teammate targeted finds the best mate toward the aim', () => {
    const sim = makeWorld();
    const { match, a1, a2, s1, s2 } = start2v2(sim);
    teleport(sim, a1, PITCH_CENTER.x, PITCH_CENTER.z);
    teleport(sim, a2, PITCH_CENTER.x + 14, PITCH_CENTER.z); // mate to the EAST
    teleport(sim, s1, PITCH.xMin + 2, PITCH_CENTER.z);
    teleport(sim, s2, PITCH.xMin + 2, PITCH_CENTER.z + 2);
    const ball = match.ball!;
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.holderPid = null;
    match.kickoffGraceUntil = 0;
    sim.entities.get(a1)!.targetId = null; // nobody selected
    sim.castAbility('sport_pass', a1, { x: PITCH_CENTER.x + 10, z: PITCH_CENTER.z }); // aim east
    expect(ball.vx).toBeGreaterThan(4); // rolled east toward the only mate on that line
    expect(Math.abs(ball.vz)).toBeLessThan(Math.abs(ball.vx));
  });

  it('keeper role: grip catches a shot in the box (a save), holds, expires, and punts from the hold', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    const classes = ['warrior', 'mage', 'rogue', 'priest', 'paladin', 'shaman'] as const;
    for (let i = 0; i < 6; i++) pids.push(addAt(sim, classes[i], `Fighter${i}`, i * 2, -40));
    // Six solos, bracket 3: first three seat team A, next three team B. The
    // fourth queuer (team B seat 0) keeps goal for the EAST side.
    for (let i = 0; i < 6; i++) {
      sim.vcupQueueJoin(
        3,
        i < 3 ? 'vale' : 'coliseum',
        i === 3 ? 'keeper' : 'striker',
        false,
        pids[i],
      );
    }
    sim.tick();
    const match = sim.vcup.match!;
    expect(match.roles[pids[3]]).toBe('keeper');
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    const keeper = pids[3];
    const ke = sim.entities.get(keeper)!;
    // Clear every OTHER fighter out to the corners so only the keeper stands in
    // the shot lane (body control now lets any fighter trap a shot in flight).
    for (const p of pids) {
      if (p === keeper) continue;
      teleport(sim, p, PITCH.xMin + 1, PITCH.zMin + 1);
    }
    teleport(sim, keeper, GOAL_LINE_EAST_X - 2, PITCH_CENTER.z);
    // A shot crossing the box toward the east goal, fast enough to be a save.
    const ball = match.ball!;
    ball.x = ke.pos.x - 2.5;
    ball.z = ke.pos.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 16;
    ball.vz = 0;
    const events = tickUntil(sim, () => ball.holderPid !== null, 10);
    expect(ball.holderPid).toBe(keeper);
    expect(events.some((e) => e.type === 'vcupSave' && (e as any).keeperName === 'Fighter3')).toBe(
      true,
    );
    // The held ball is unkickable by others...
    const striker = pids[0];
    teleport(sim, striker, ke.pos.x - 2, ke.pos.z);
    sim.castAbility('sport_shoot', striker, { x: GOAL_LINE_WEST_X, z: PITCH_CENTER.z });
    sim.tick();
    expect(ball.holderPid).toBe(keeper);
    // ...and the keeper can clear straight out of the grip with a shot. Move the
    // striker off the clearance lane first, or their body would trap it.
    teleport(sim, striker, PITCH.xMin + 1, PITCH.zMax - 1);
    sim.castAbility('sport_shoot', keeper, { x: GOAL_LINE_WEST_X, z: PITCH_CENTER.z });
    sim.tick();
    expect(ball.holderPid).toBe(null);
    expect(ball.vx).toBeLessThan(0); // launched back up the field (toward the enemy goal)
    // A re-grip needs a MOVING ball; once it settles near the keeper it stays free.
    ball.vx = 0;
    ball.vz = 0;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(ball.holderPid).toBe(null);
  });

  it('a lone center-spot shot at kickoff cannot beat a set keeper in the first 3 seconds', () => {
    // Live-balance pin: keepers line up ON their goal line at every kickoff and
    // the whistle grace clamps a charged shot to the short-touch profile, so an
    // instant unchallenged shot from the center spot is savable, not a goal.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(3); // the bot side's seat 0 keeps goal
    const match = sim.vcup.practices[0];
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.phase).toBe('active');
    // The practice pitch is offset; the goal/center are shifted by match.origin.
    const goalX = GOAL_LINE_EAST_X + match.origin.x;
    const centerZ = PITCH_CENTER.z + match.origin.z;
    // The enemy keeper stands set on its goal line before the first touch.
    const keeperPid = match.teamB[0];
    expect(match.roles[keeperPid]).toBe('keeper');
    const keeperE = sim.entities.get(keeperPid)!;
    expect(Math.abs(keeperE.pos.x - goalX)).toBeLessThan(2);
    // I take the kickoff and immediately shoot straight at the goal mouth.
    sim.castAbility('sport_shoot', sim.primaryId, { x: goalX, z: centerZ });
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) events.push(...sim.tick());
    expect(events.some((e) => e.type === 'vcupGoal')).toBe(false);
    expect(match.scoreA).toBe(0);
  });

  it('opens on a briefing: bots pre-ready, humans ready up or auto-ready at the timer', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    const match = sim.vcup.match!;
    // Briefing is live; the kit is already swapped so the overlay can show it.
    expect(match.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.briefingLeft).toBeGreaterThan(0);
    expect(sim.cupInfoFor(a)!.match!.iAmReady).toBe(false);
    // One fighter readying is not enough; the other still holds the whistle.
    sim.vcupReady(a);
    sim.tick();
    expect(sim.vcup.match!.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.iAmReady).toBe(true);
    // Both ready -> the countdown starts on the next tick.
    sim.vcupReady(b);
    sim.tick();
    expect(sim.vcup.match!.phase).toBe('countdown');
  });

  it('auto-readies at the briefing timer when a fighter never readies', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    const match = sim.vcup.match!;
    // Nobody readies: the briefing times out and the match proceeds anyway.
    tickUntil(sim, () => match.phase !== 'briefing', 20 * 31);
    expect(match.phase).not.toBe('briefing');
  });

  it('kick power scales with aim distance: a short pass is softer than a long shot', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const ball = match.ball!;
    // Long boot at a far aim (>= the ability reach): near full power.
    teleport(sim, a, PITCH_CENTER.x - 2, PITCH_CENTER.z);
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vz = 0;
    ball.holderPid = null;
    ae.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, { x: PITCH_CENTER.x + 30, z: PITCH_CENTER.z });
    sim.tick();
    const farSpeed = Math.hypot(ball.vx, ball.vz);
    // Same boot at a SHORT aim: a soft pass, clearly slower.
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.vx = 0;
    ball.vz = 0;
    ball.holderPid = null;
    teleport(sim, a, PITCH_CENTER.x - 2, PITCH_CENTER.z);
    // wait out the boot cooldown
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    sim.castAbility('sport_shoot', a, { x: PITCH_CENTER.x + 5, z: PITCH_CENTER.z });
    sim.tick();
    const shortSpeed = Math.hypot(ball.vx, ball.vz);
    expect(shortSpeed).toBeLessThan(farSpeed * 0.75);
    expect(shortSpeed).toBeGreaterThan(0); // still a real touch
  });

  it('fighters cannot walk through each other on the pitch (soft separation)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const be = sim.entities.get(b)!;
    // Stack both fighters on the exact same spot mid-pitch.
    teleport(sim, a, PITCH_CENTER.x, PITCH_CENTER.z + 4);
    teleport(sim, b, PITCH_CENTER.x, PITCH_CENTER.z + 4);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    const gap = Math.hypot(ae.pos.x - be.pos.x, ae.pos.z - be.pos.z);
    expect(gap).toBeGreaterThanOrEqual(1.05); // 2 * VC_FIGHTER_RADIUS, settled apart
    // Both stayed on the pitch (the push resolves against the boards).
    expect(isOnPitch(ae.pos.x, ae.pos.z)).toBe(true);
    expect(isOnPitch(be.pos.x, be.pos.z)).toBe(true);
    // Separation is match-scoped: it ends with the match.
    expect(match.phase).not.toBe('over');
  });

  it('bot attacking is paced for a human game: few goals early, no blowout', () => {
    // Live-balance pin (the "they just quickly put it straight in" report): with
    // the human idle, the all-bot attack must not run away. Shot range gate +
    // deterministic aim error + a slower decision cadence keep the scoreline
    // human-playable. Deterministic (zero rng), so these are hard bounds.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Idle' });
    sim.vcupPracticeStart(3);
    const match = sim.vcup.practices[0];
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    const runTo = (seconds: number) => {
      while (match.clock < seconds && match.phase !== 'over') sim.tick();
    };
    // No early flurry: a handful of goals at most in the opening minute (a
    // keeper-defended pitch, not a shooting gallery).
    runTo(60);
    expect(match.scoreA + match.scoreB).toBeLessThanOrEqual(4);
    // No fast blowout: the match is not already decided (a team at the 5 cap)
    // in the first 90 seconds. Before the tuning it was 5-0 in ~30s; now a
    // keeper-defended goal keeps it a contest that plays out over minutes.
    runTo(90);
    expect(match.phase).not.toBe('over');
  });
});

describe('Vale Cup: desertion', () => {
  it('a deserter takes the loss and the lockout; the team plays short and forfeits when empty', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    const bMeta = sim.players.get(b)!;
    sim.removePlayer(b); // disconnect mid-match
    expect(match.benched.has(b)).toBe(true);
    expect(bMeta.vcupLosses).toBe(1);
    expect(sim.vcup.deserters.get('bet')).toBeGreaterThan(sim.time);
    // Team B has nobody left: team A wins by forfeit.
    tickUntil(sim, () => match.phase === 'over', 20 * 2);
    expect(sim.players.get(a)!.vcupWins).toBe(1);
    // A same-named rejoin is still locked out of the queue.
    tickUntil(sim, () => sim.vcup.match === null, 20 * 10);
    const b2 = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.drainEvents();
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, b2);
    expect(errorsOf(sim.drainEvents())).toContain('The Groundskeeper remembers. Come back later.');
    expect(sim.cupInfoFor(b2)!.deserterFor).toBeGreaterThan(0);
    expect(sim.cupInfoFor(b2)!.deserterFor).toBeLessThanOrEqual(VC_DESERTER_LOCKOUT);
  });

  it('vcupResolveDesertion is idempotent (the server calls it before the leave save)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    startBout(sim, a, b);
    const bMeta = sim.players.get(b)!;
    sim.vcupResolveDesertion(b);
    sim.vcupResolveDesertion(b);
    sim.removePlayer(b); // calls it a third time
    expect(bMeta.vcupLosses).toBe(1);
  });
});

describe('Vale Cup: kit swap round trip and persistence', () => {
  it('restores the exact class kit, pets, cooldowns, and leaves level/xp/talents untouched', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warlock', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const ae = sim.entities.get(a)!;
    (sim as any).summonPet(ae, 'emberkin');
    expect(sim.petOf(a)).toBeTruthy();
    const aMeta = sim.players.get(a)!;
    const knownBefore = JSON.stringify(aMeta.known.map((k) => [k.def.id, k.rank, k.cost]));
    const levelBefore = ae.level;
    const xpBefore = aMeta.xp;
    const talentsBefore = JSON.stringify(aMeta.talents);

    const match = startBout(sim, a, b);
    expect(aMeta.sportRole).toBe('allrounder');
    expect(sim.petOf(a)).toBe(null); // stowed for the match
    expect((sim as any).delvePetStash.has(a)).toBe(true);
    teleport(sim, a, PITCH_CENTER.x, PITCH_CENTER.z); // stand on the ball to shoot
    sim.castAbility('sport_shoot', a, { x: PITCH_CENTER.x + 10, z: PITCH_CENTER.z });
    expect(ae.cooldowns.has('sport_shoot')).toBe(true);

    (match as any).scoreA = 5; // decide it now
    (match as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);

    expect(aMeta.sportRole).toBe(null);
    expect(JSON.stringify(aMeta.known.map((k) => [k.def.id, k.rank, k.cost]))).toBe(knownBefore);
    expect(ae.level).toBe(levelBefore);
    expect(aMeta.xp).toBe(xpBefore);
    expect(JSON.stringify(aMeta.talents)).toBe(talentsBefore);
    expect(ae.cooldowns.size).toBe(0); // arena-style wipe, sport cds included
    expect(sim.petOf(a)).toBeTruthy(); // restored from the stash
  });

  it('persists the RETURN position while mid-match, and standings round-trip via CharacterState', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    // Before any result: the standing keys stay absent (back-compat shape).
    const clean = sim.serializeCharacter(a)!;
    expect('vcupWins' in clean).toBe(false);

    const match = startBout(sim, a, b);
    const mid = sim.serializeCharacter(a)!;
    expect(mid.pos.x).toBeCloseTo(0, 5); // the queue spot, never mid-pitch
    expect(mid.pos.z).toBeCloseTo(-40, 5);

    (match as any).scoreA = 5;
    (match as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
    const won = sim.serializeCharacter(a)!;
    expect(won.vcupWins).toBe(1);
    expect(won.vcupLosses).toBe(0);

    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('warrior', 'Aleph', { state: won });
    const meta2 = sim2.players.get(a2)!;
    expect(meta2.vcupWins).toBe(1);
    expect(meta2.vcupLosses).toBe(0);
    expect(meta2.vcupDraws).toBe(0);
  });
});

describe('Vale Cup: determinism', () => {
  it('Groundskeeper Bram stands at the gate under his reserved id (no ctor id shift)', () => {
    const sim = makeWorld();
    const bram = sim.entities.get(VALE_CUP_BRAM_ID)!;
    expect(bram).toBeTruthy();
    expect(bram.kind).toBe('npc');
    expect(bram.name).toBe('Groundskeeper Bram');
    expect(MOBS[VALE_CUP_BALL_TEMPLATE_ID]).toBeTruthy();
  });

  it('the same seed and script replays an identical match (run-twice trace)', () => {
    const run = () => {
      const sim = new Sim({ seed: 5, playerClass: 'warrior', playerName: 'Solo' });
      sim.vcupPracticeStart(2);
      const trace: unknown[] = [];
      for (let i = 0; i < 20 * 45; i++) {
        const events = sim.tick();
        for (const ev of events) if (ev.type.startsWith('vcup')) trace.push(ev.type);
        if (i % 20 === 0) {
          const ball = sim.vcup.practices[0]?.ball;
          trace.push(
            ball ? [Math.round(ball.x * 1e6) / 1e6, Math.round(ball.z * 1e6) / 1e6] : null,
            sim.vcup.match?.phase ?? 'none',
            sim.vcup.match?.scoreA ?? -1,
            sim.vcup.match?.scoreB ?? -1,
          );
        }
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it('draws ZERO shared rng anywhere on the queue + match path (draw-value accounting)', () => {
    const script = (withCup: boolean): number[] => {
      const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
      const a = addAt(sim, 'warrior', 'Aleph');
      const b = addAt(sim, 'mage', 'Bet', 6, -40);
      const values: number[] = [];
      sim.rng.setObserver((v) => values.push(v));
      if (withCup) {
        sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
        sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
      }
      for (let i = 0; i < 20 * 15; i++) {
        if (withCup && i === 20 * 5) {
          sim.castAbility('sport_shoot', a, { x: GOAL_LINE_EAST_X, z: PITCH_CENTER.z });
        }
        sim.tick();
      }
      sim.rng.setObserver(null);
      return values;
    };
    // The whole cup flow (queue, standardize, kickoff, ball physics, a kick,
    // a goal) must not add, remove, or reorder ONE shared-stream draw relative
    // to the identical world without it.
    expect(script(true)).toEqual(script(false));
  });

  it('the BOT path (practice: spawn, chase, kicks, shoulders, dives) also draws zero shared rng', () => {
    const script = (withCup: boolean): number[] => {
      const sim = new Sim({ seed: 11, playerClass: 'warrior', playerName: 'Solo' });
      const values: number[] = [];
      sim.rng.setObserver((v) => values.push(v));
      if (withCup) sim.vcupPracticeStart(3);
      for (let i = 0; i < 20 * 30; i++) sim.tick();
      sim.rng.setObserver(null);
      return values;
    };
    expect(script(true)).toEqual(script(false));
  });
});

describe('Vale Cup: parallel private practice', () => {
  it('runs many practice matches at once, each on its own isolated pitch', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: 3 }, (_, i) => addAt(sim, 'warrior', `P${i}`, i * 3, -40));
    for (const pid of pids) sim.vcupPracticeStart(1, pid);
    expect(sim.vcup.practices.length).toBe(3);
    expect(sim.vcup.match).toBe(null); // the physical slot is untouched
    // Each match sits at a distinct origin, far enough apart that no two pitches
    // overlap (interest scoping keeps them private).
    const origins = sim.vcup.practices.map((m) => m.origin);
    for (let i = 0; i < origins.length; i++) {
      for (let j = i + 1; j < origins.length; j++) {
        expect(
          Math.hypot(origins[i].x - origins[j].x, origins[i].z - origins[j].z),
        ).toBeGreaterThan(200);
      }
    }
    // cupInfo lists everyone practicing (the Sowfield-region HUD indicator).
    const info = sim.cupInfoFor(pids[0])!;
    expect(info.practicing.length).toBe(3);
    // Each practicer sees THEIR OWN match as cupInfo.match.
    for (const pid of pids) {
      expect(sim.cupInfoFor(pid)!.match).toBeTruthy();
    }
  });

  it('practice runs alongside the one real Sowfield match without contention', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'RealA', 0, -40);
    const b = addAt(sim, 'mage', 'RealB', 4, -40);
    startBout(sim, a, b); // occupies vc.match
    const solo = addAt(sim, 'rogue', 'Practicer', 8, -40);
    sim.vcupPracticeStart(2, solo);
    // Both coexist: the real match on the pitch, the practice in its instance.
    expect(sim.vcup.match).toBeTruthy();
    expect(sim.vcup.practices.length).toBe(1);
    expect(sim.vcup.practices[0].practice?.ownerPid).toBe(solo);
  });

  it('a practice bout plays a real match of football (kickoff, ball moves)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(3, sim.primaryId);
    const match = sim.vcup.practices[0];
    tickUntil(sim, () => match.phase === 'active', 20 * 40);
    expect(match.phase).toBe('active');
    // The ball exists at the offset pitch and is driven by the bots.
    const ball = match.ball!;
    expect(ball).toBeTruthy();
    expect(ball.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const x0 = ball.x;
    const z0 = ball.z;
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    // The bots moved the ball off the center spot (a live game, not a frozen one).
    expect(Math.hypot(ball.x - x0, ball.z - z0)).toBeGreaterThan(1);
  });

  it('a human Shoot fires toward the practice goal, not back toward the Sowfield', () => {
    // Regression: sport landmarks are Sowfield-frame; on an offset practice pitch
    // the shot aim must add match.origin or it fires the wrong way (toward x=0).
    const sim = new Sim({ seed: 3, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(1, sim.primaryId);
    const match = sim.vcup.practices[0];
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.phase).toBe('active');
    const ball = match.ball!;
    // Team A (the human) attacks the EAST goal (+x). A charged shot must send the
    // ball east (positive vx), toward the offset enemy goal.
    const goalX = GOAL_LINE_EAST_X + match.origin.x;
    sim.castAbility('sport_shoot', sim.primaryId, { x: goalX, z: PITCH_CENTER.z + match.origin.z });
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('refuses to double-seat a player already practicing', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Solo' });
    sim.vcupPracticeStart(1, sim.primaryId);
    expect(sim.vcup.practices.length).toBe(1);
    sim.vcupPracticeStart(2, sim.primaryId);
    expect(errorsOf(sim.drainEvents())).toContain('You are already in an arena match.');
    expect(sim.vcup.practices.length).toBe(1);
  });
});

describe('Vale Cup: guild banners and the guild leaderboard', () => {
  // Force the live match to a decisive team-A win and tear it down.
  function decideForA(sim: Sim) {
    readyAll(sim);
    tickUntil(sim, () => sim.vcup.match?.phase === 'active', 20 * 6);
    const m = sim.vcup.match!;
    (m as any).scoreA = 1;
    (m as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
  }

  it('credits the guild W/L of banner entrants and builds the guild board', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Ada', 0, -40);
    const b = addAt(sim, 'mage', 'Bo', 4, -40);
    sim.setPlayerGuild(a, 'Wheat Kings');
    sim.setPlayerGuild(b, 'Mire Herons');
    sim.vcupQueueJoin(1, 'vale', 'allrounder', true, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', true, b);
    sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    // The roster shows each fighter's banner while they play.
    const roster = sim.cupInfoFor(a)!.match!;
    const all = [...roster.teamA, ...roster.teamB];
    expect(all.find((p) => p.pid === a)!.guild).toBe('Wheat Kings');
    expect(all.find((p) => p.pid === b)!.guild).toBe('Mire Herons');
    decideForA(sim);
    // Winner's guild gains a win, loser's a loss.
    expect(sim.players.get(a)!.vcupGuildWins).toBe(1);
    expect(sim.players.get(a)!.vcupGuildLosses).toBe(0);
    expect(sim.players.get(b)!.vcupGuildLosses).toBe(1);
    // Both guilds appear on the board, winner first.
    const board = sim.cupInfoFor(a)!.guildBoard;
    expect(board.find((g) => g.name === 'Wheat Kings')).toEqual({
      name: 'Wheat Kings',
      wins: 1,
      losses: 0,
    });
    expect(board.find((g) => g.name === 'Mire Herons')).toEqual({
      name: 'Mire Herons',
      wins: 0,
      losses: 1,
    });
    expect(board[0].name).toBe('Wheat Kings');
    // myGuild drives the "enter as guild" toggle.
    expect(sim.cupInfoFor(a)!.myGuild).toBe('Wheat Kings');
  });

  it('does not credit a guild when the player entered privately (banner off)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Ada', 0, -40);
    const b = addAt(sim, 'mage', 'Bo', 4, -40);
    sim.setPlayerGuild(a, 'Wheat Kings');
    sim.setPlayerGuild(b, 'Mire Herons');
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a); // private
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    expect(sim.cupInfoFor(a)!.match!.teamA.find((p) => p.pid === a)!.guild).toBe('');
    decideForA(sim);
    expect(sim.players.get(a)!.vcupGuildWins).toBe(0);
    expect(sim.players.get(b)!.vcupGuildLosses).toBe(0);
    expect(sim.cupInfoFor(a)!.guildBoard).toEqual([]);
  });

  it('forfeits guild credit if you leave the guild before the result', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Ada', 0, -40);
    const b = addAt(sim, 'mage', 'Bo', 4, -40);
    sim.setPlayerGuild(a, 'Wheat Kings');
    sim.setPlayerGuild(b, 'Mire Herons');
    sim.vcupQueueJoin(1, 'vale', 'allrounder', true, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', true, b);
    sim.tick();
    sim.setPlayerGuild(a, ''); // Ada quits her guild mid-match
    decideForA(sim);
    expect(sim.players.get(a)!.vcupGuildWins).toBe(0); // no banner to credit
    expect(sim.players.get(b)!.vcupGuildLosses).toBe(1); // Bo still repped his
  });

  it('deserting under a banner costs the guild a loss', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Ada', 0, -40);
    const b = addAt(sim, 'mage', 'Bo', 4, -40);
    sim.setPlayerGuild(a, 'Wheat Kings');
    sim.vcupQueueJoin(1, 'vale', 'allrounder', true, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', true, b);
    sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    sim.vcupResolveDesertion(a);
    expect(sim.players.get(a)!.vcupGuildLosses).toBe(1);
  });
});

describe('Vale Cup: the pitch is closed during a match', () => {
  it('lets a walk-up stand on the pitch when idle, but ejects them once a match is on', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Kick', 0, -40);
    const b = addAt(sim, 'mage', 'Boot', 4, -40);
    const spec = addAt(sim, 'rogue', 'Nosey', 8, -40);
    // Idle pitch: a walk-up can stand right on the center spot.
    teleport(sim, spec, PITCH_CENTER.x, PITCH_CENTER.z);
    sim.tick();
    let e = sim.entities.get(spec)!;
    expect(isOnPitch(e.pos.x, e.pos.z)).toBe(true);
    // Match on: the same walk-up mid-pitch is ejected off to the touchline.
    startBout(sim, a, b);
    teleport(sim, spec, PITCH_CENTER.x, PITCH_CENTER.z);
    sim.tick();
    e = sim.entities.get(spec)!;
    expect(isOnPitch(e.pos.x, e.pos.z)).toBe(false);
    // ...and repeatedly trying to walk back in keeps them out (barrier holds).
    for (let i = 0; i < 5; i++) {
      teleport(sim, spec, PITCH_CENTER.x, PITCH_CENTER.z);
      sim.tick();
      expect(isOnPitch(sim.entities.get(spec)!.pos.x, sim.entities.get(spec)!.pos.z)).toBe(false);
    }
  });
});
