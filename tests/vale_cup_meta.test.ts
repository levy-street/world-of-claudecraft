// The Vale Cup meta behavior spec (docs/prd/vale-cup.md): parimutuel betting,
// the sport-kit swap round trip and standings persistence, determinism and rng
// purity, parallel private practice, and guild banners. Split from the
// original single-file tests/vale_cup.test.ts along describe boundaries for CI
// shard balance (a pure move; the shared staging helpers live in
// tests/vale_cup_util.ts).
//
// Inventory note (v0.21): fresh characters spawn WITH starter rations, so no
// assertion here compares exact inventories; the kit round-trip compares the
// ABILITY list, not bags.

import { describe, expect, it, vi } from 'vitest';
import { VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import { DUNGEON_X_THRESHOLD, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { endCupMatch, VALE_CUP_BRAM_ID, VC_MATCH_DURATION } from '../src/sim/social/vale_cup';
import { GOAL_LINE_EAST_X, PITCH_CENTER } from '../src/sim/vale_cup_layout';
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
