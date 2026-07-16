// The Vale Cup match behavior spec (docs/prd/vale-cup.md): queue guards,
// matchmaking and packing, the full match lifecycle (countdown / kickoff /
// dribble / kick / goals / golden / over), the sport-move kit, possession,
// desertion, and the closed pitch. Split from the original single-file
// tests/vale_cup.test.ts along describe boundaries for CI shard balance (a
// pure move; the shared staging helpers live in tests/vale_cup_util.ts).
//
// Inventory note (v0.21): fresh characters spawn WITH starter rations, so no
// assertion here compares exact inventories.

import { describe, expect, it, vi } from 'vitest';
import { SPORT_KITS, VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
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
import {
  addAt,
  errorsOf,
  makeWorld,
  readyAll,
  startBout,
  teleport,
  tickUntil,
} from './vale_cup_util';

// The full-match bot sims here run thousands of deterministic ticks; the 5s
// vitest default is too tight for them under CI's parallel load (they complete
// in well under a second locally). Give the file the headroom the other heavy
// sim suites use (climb_slope, sim, dungeons).
vi.setConfig({ testTimeout: 30000 });

describe('Vale Cup: possession gate (must be on the ball to play it)', () => {
  // Stage a resting ball near the east goal, park the opponent in a far corner
  // so it cannot trap, and return the live match + ball for a strike attempt.
  function stageRestingBall(sim: Sim, a: number, b: number) {
    const match = startBout(sim, a, b);
    teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1);
    const ball = match.ball!;
    ball.x = GOAL_LINE_EAST_X - 6;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.holderPid = null;
    return { match, ball };
  }
  const ballSpeed = (ball: { vx: number; vz: number }) => Math.hypot(ball.vx, ball.vz);
  const aimAtGoal = { x: GOAL_LINE_EAST_X + 12, z: PITCH_CENTER.z };

  it('rejects a shot from off the ball (the reported anywhere-on-the-map bug)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 2, -40);
    const { ball } = stageRestingBall(sim, a, b);
    // Stand ~24yd off the ball: inside the old sport_shoot.range (34) that let a
    // shot fire from anywhere, but well outside actual possession.
    teleport(sim, a, ball.x - 24, ball.z);
    sim.entities.get(a)!.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, aimAtGoal);
    expect(ballSpeed(ball)).toBe(0); // no possession, no launch
  });

  it('rejects a kick and a pass from off the ball', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 2, -40);
    const { ball } = stageRestingBall(sim, a, b);
    teleport(sim, a, ball.x - 16, ball.z); // inside sport_kick(18)/sport_pass(42) range
    sim.entities.get(a)!.facing = Math.PI / 2;
    sim.castAbility('sport_kick', a, aimAtGoal);
    expect(ballSpeed(ball)).toBe(0);
    sim.castAbility('sport_pass', a, aimAtGoal);
    expect(ballSpeed(ball)).toBe(0);
  });

  it('lets you strike the ball once it is at your feet', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 2, -40);
    const { ball } = stageRestingBall(sim, a, b);
    teleport(sim, a, ball.x - 2, ball.z); // on the ball (within VC_POSSESSION_RADIUS)
    sim.entities.get(a)!.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, aimAtGoal);
    expect(ballSpeed(ball)).toBeGreaterThan(0); // struck: the shot launches
  });
});

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
