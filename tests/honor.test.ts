import { describe, expect, it } from 'vitest';
import type { TalentAllocation } from '../src/sim/content/talents';
import { DUNGEON_X_THRESHOLD, MOBS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import {
  ARENA_DAILY_TAPER_START,
  ARENA_LOSS_HONOR_SHARE,
  awardBattlegroundAssistHonor,
  awardBattlegroundHonor,
  awardBattlegroundKillHonor,
  awardFiestaCompletionHonor,
  awardFiestaKillHonor,
  awardRankedArenaResultHonor,
  BATTLEGROUND_ASSIST_HONOR,
  BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
  BATTLEGROUND_KILL_HONOR,
  BATTLEGROUND_LOSS_HONOR,
  BATTLEGROUND_RESULT_DR,
  BATTLEGROUND_WIN_HONOR,
  battlegroundResultMultiplier,
  FIESTA_COMPLETION_HONOR,
  FIESTA_KILL_HONOR,
  FIESTA_WIN_BONUS_HONOR,
  grantHonor,
  HONOR_REPEAT_DR,
  PVP_VITALITY_CAP,
  PVP_VITALITY_RATING_PER_PCT,
  pvpVitalityAppliesTo,
  pvpVitalityFromRating,
  RANKED_ARENA_LOSS_HONOR,
  RANKED_ARENA_WIN_HONOR,
  repeatHonorMultiplier,
} from '../src/sim/pvp';
import type { ArenaMatch } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import * as arena from '../src/sim/social/arena';
import * as fiesta from '../src/sim/social/fiesta';
import { armorReduction, type Entity, type EquipSlot, type PlayerClass } from '../src/sim/types';
import { RL_TEST_WORLD } from './sim_shared';

function world(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: RL_TEST_WORLD });
}

// Fixture reset days in this file are deliberately WEEKDAYS: the Double Honor
// Weekend (src/sim/pvp/honor_event.ts) doubles every battleground award on
// Saturday and Sunday reset days and boosts played-out losses, and these
// suites pin the BASE amounts. The event has its own describe near the
// bottom, on weekend keys on purpose.

function liveArena(): { sim: Sim; a: number; b: number; match: ArenaMatch } {
  const sim = world();
  sim.resetDay = '2026-07-08';
  const a = sim.addPlayer('warrior', 'Aleph', { characterId: 101 });
  const b = sim.addPlayer('mage', 'Bet', { characterId: 202 });
  sim.setPlayerLevel(arena.ARENA_MIN_LEVEL, a);
  sim.setPlayerLevel(arena.ARENA_MIN_LEVEL, b);
  sim.arenaQueueJoin(a);
  sim.arenaQueueJoin(b);
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const match = sim.arenaMatchFor(a);
    if (match?.state === 'active') return { sim, a, b, match };
  }
  throw new Error('ranked arena did not start');
}

function liveArena2v2(): { sim: Sim; match: ArenaMatch } {
  const sim = world();
  sim.resetDay = '2026-07-08';
  const classes = ['warrior', 'mage', 'rogue', 'priest'] as const;
  const pids = classes.map((cls, i) => sim.addPlayer(cls, `Ranked${i}`, { characterId: 500 + i }));
  for (const pid of pids) sim.setPlayerLevel(arena.ARENA_MIN_LEVEL, pid);
  for (const pid of pids) sim.arenaQueueJoin(pid, '2v2');
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const match = sim.arenaMatchFor(pids[0]);
    if (match?.state === 'active') return { sim, match };
  }
  throw new Error('ranked 2v2 arena did not start');
}

function liveFiesta(): { sim: Sim; match: ArenaMatch; pids: number[] } {
  const sim = world();
  sim.resetDay = '2026-07-08';
  const classes = ['warrior', 'mage', 'rogue', 'priest'] as const;
  const pids = classes.map((cls, i) => sim.addPlayer(cls, `Fiesta${i}`, { characterId: 300 + i }));
  for (const pid of pids) sim.arenaQueueJoin(pid, 'fiesta');
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const match = sim.arenaMatchFor(pids[0]);
    if (match?.state === 'active') return { sim, match, pids };
  }
  throw new Error('Fiesta did not start');
}

describe('honor currency', () => {
  it('grants spendable and lifetime honor through one event and round-trips persistence', () => {
    const sim = world();
    const pid = sim.addPlayer('warrior', 'Saver');
    const meta = sim.meta(pid)!;

    expect(grantHonor(sim.ctx, meta, 125.9, 'arena_win')).toBe(125);
    expect(meta.honor).toBe(125);
    expect(meta.lifetimeHonor).toBe(125);
    expect(sim.events).toContainEqual({
      type: 'honor',
      pid,
      amount: 125,
      reason: 'arena_win',
    });

    meta.honor -= 25;
    const saved = sim.serializeCharacter(pid)!;
    const loaded = world();
    const loadedPid = loaded.addPlayer('warrior', 'Saver', { state: saved });
    expect(loaded.meta(loadedPid)!.honor).toBe(100);
    expect(loaded.meta(loadedPid)!.lifetimeHonor).toBe(125);
  });

  it('ignores non-positive and non-finite grant amounts', () => {
    const sim = world();
    const pid = sim.addPlayer('warrior', 'Guarded');
    const meta = sim.meta(pid)!;
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(grantHonor(sim.ctx, meta, amount, 'arena_win')).toBe(0);
    }
    expect(meta.honor).toBe(0);
    expect(meta.lifetimeHonor).toBe(0);
    expect(sim.events.some((event) => event.type === 'honor')).toBe(false);
  });

  it('sanitizes malformed persisted balances and DR counters', () => {
    const seed = world();
    const seedPid = seed.addPlayer('warrior', 'Seed');
    const state = seed.serializeCharacter(seedPid)! as unknown as Record<string, unknown>;
    state.honor = Number.NaN;
    state.lifetimeHonor = Number.POSITIVE_INFINITY;
    state.honorArenaDaily = {
      date: 7,
      winsByOpponent: { valid: 2.9, invalid: -3, nan: Number.NaN },
      fiestaCompletionsByOpponent: null,
      totalWins: Number.POSITIVE_INFINITY,
    };

    const loaded = world();
    const pid = loaded.addPlayer('warrior', 'Seed', { state: state as never });
    const meta = loaded.meta(pid)!;
    expect(meta.honor).toBe(0);
    expect(meta.lifetimeHonor).toBe(0);
    expect(meta.honorArenaDaily).toEqual({
      date: '',
      winsByOpponent: { valid: 2 },
      fiestaCompletionsByOpponent: {},
      totalWins: 0,
    });
  });
});

describe('ranked Arena honor', () => {
  it('pays the winner the faucet and the loser a third of it, exactly once', () => {
    const { sim, a, b, match } = liveArena();
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');

    // Pinned to the literals (not the constants) so a wrong 1v1 faucet or a
    // wrong loss share reddens here.
    expect(sim.meta(a)!.honor).toBe(25);
    expect(sim.meta(b)!.honor).toBe(8);
    expect(RANKED_ARENA_WIN_HONOR['1v1']).toBe(25);
    expect(RANKED_ARENA_LOSS_HONOR['1v1']).toBe(8);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaLosses).toBe(1);

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');
    expect(sim.meta(a)!.honor).toBe(25);
    expect(sim.meta(b)!.honor).toBe(8);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaWins).toBe(0);
  });

  it('pays both brackets a loss award of one third of their own win award', () => {
    for (const format of ['1v1', '2v2'] as const) {
      expect(RANKED_ARENA_LOSS_HONOR[format]).toBe(
        Math.round(RANKED_ARENA_WIN_HONOR[format] * ARENA_LOSS_HONOR_SHARE),
      );
      // A loss is worth clearly less than a win: the gap is the whole reason to
      // play to win rather than to farm completions.
      expect(RANKED_ARENA_LOSS_HONOR[format]).toBeLessThan(RANKED_ARENA_WIN_HONOR[format]);
      expect(RANKED_ARENA_LOSS_HONOR[format]).toBeGreaterThan(0);
    }
    expect(ARENA_LOSS_HONOR_SHARE).toBeCloseTo(1 / 3, 10);
  });

  it('pays a drawn bout the loss award to BOTH sides', () => {
    const { sim, a, b, match } = liveArena();
    arena.endArenaMatch(sim.ctx, match, null, 'timeout');

    expect(sim.meta(a)!.honor).toBe(8);
    expect(sim.meta(b)!.honor).toBe(8);
    expect(sim.meta(a)!.arenaWins).toBe(0);
    expect(sim.meta(b)!.arenaWins).toBe(0);
    // The draw pays through the loss reason, not the win one: a drawn bout has
    // no winner to name.
    const reasons = sim.events
      .filter((event) => event.type === 'honor')
      .map((event) => (event as { reason: string }).reason);
    expect(reasons).toEqual(['arena_complete', 'arena_complete']);
  });

  it('pays the 2v2 loss award to every member of the losing team', () => {
    const { sim, match } = liveArena2v2();
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');

    for (const pid of match.teamB) {
      expect(sim.meta(pid)!.honor).toBe(17);
      expect(RANKED_ARENA_LOSS_HONOR['2v2']).toBe(17);
      expect(sim.meta(pid)!.arena2v2Losses).toBe(1);
    }
  });

  it('pays no honor for a forfeit win but still moves rating, win count, and Deeds', () => {
    // Mirrors Fiesta's own reason !== 'forfeit' guard on completion honor: a
    // forfeit (an opponent disconnect) must not be a free Honor farm, but the
    // rating swing and win/loss ledger stay forfeit-inclusive (deliberately,
    // per src/sim/deeds.ts's own comment) so a disconnect cannot grief the
    // survivor's ladder standing. The LOSING side is the load-bearing half now
    // that a played-out loss pays: conceding on sight must never be a way to
    // buy the loss award.
    const { sim, a, b, match } = liveArena();
    const ratingBefore = sim.meta(a)!.arenaRating;

    arena.endArenaMatch(sim.ctx, match, 'A', 'forfeit');

    expect(sim.meta(a)!.honor).toBe(0);
    expect(sim.meta(b)!.honor).toBe(0);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaLosses).toBe(1);
    expect(sim.meta(a)!.arenaRating).toBeGreaterThan(ratingBefore);
  });

  it('pays no honor for a 2v2 forfeit win but still moves rating and win count', () => {
    const { sim, match } = liveArena2v2();
    const ratingBefore = sim.meta(match.teamA[0])!.arena2v2Rating;

    arena.endArenaMatch(sim.ctx, match, 'A', 'forfeit');

    for (const pid of match.teamA) {
      expect(sim.meta(pid)!.honor).toBe(0);
      expect(sim.meta(pid)!.arena2v2Wins).toBe(1);
    }
    for (const pid of match.teamB) {
      expect(sim.meta(pid)!.honor).toBe(0);
      expect(sim.meta(pid)!.arena2v2Losses).toBe(1);
    }
    expect(sim.meta(match.teamA[0])!.arena2v2Rating).toBeGreaterThan(ratingBefore);
  });

  it('awards the 2v2 faucet to both winners through a real ranked result', () => {
    const { sim, match } = liveArena2v2();
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');

    for (const pid of match.teamA) {
      // Pinned to the literal (not the constant) so a wrong 2v2 faucet reddens here.
      expect(sim.meta(pid)!.honor).toBe(50);
      expect(RANKED_ARENA_WIN_HONOR['2v2']).toBe(50);
      expect(sim.meta(pid)!.arena2v2Wins).toBe(1);
    }
    // What the losing team is paid is pinned by its own case above.
    for (const pid of match.teamB) {
      expect(sim.meta(pid)!.arena2v2Losses).toBe(1);
    }
  });

  it('applies repeat-opponent DR, the daily taper, and UTC rollover deterministically', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const pid = sim.addPlayer('warrior', 'Climber');
    const meta = sim.meta(pid)!;

    const repeat = Array.from({ length: 4 }, () =>
      awardRankedArenaResultHonor(sim.ctx, meta, '1v1', '["character:9"]', 'win'),
    );
    expect(repeat).toEqual([25, 0, 0, 0]);

    const fresh = world();
    fresh.resetDay = '2026-07-08';
    const freshPid = fresh.addPlayer('warrior', 'Taper');
    const freshMeta = fresh.meta(freshPid)!;
    for (let i = 0; i < ARENA_DAILY_TAPER_START; i++) {
      expect(
        awardRankedArenaResultHonor(fresh.ctx, freshMeta, '1v1', `["character:${i}"]`, 'win'),
      ).toBe(25);
    }
    expect(
      awardRankedArenaResultHonor(fresh.ctx, freshMeta, '1v1', '["character:next"]', 'win'),
    ).toBe(12);

    fresh.resetDay = '2026-07-09';
    expect(
      awardRankedArenaResultHonor(fresh.ctx, freshMeta, '1v1', '["character:next"]', 'win'),
    ).toBe(25);
  });

  it('decays a repeated loss to the same team and rolls the counter over each day', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const meta = sim.meta(sim.addPlayer('warrior', 'Loser'))!;
    const key = '["character:9"]';

    const repeat = Array.from({ length: 4 }, () =>
      awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'loss'),
    );
    // The same ARENA_REPEAT_DR curve the win award is on: the day's first meeting
    // pays, every rematch pays nothing, so a traded pair cannot farm the loss arm.
    expect(repeat).toEqual([8, 0, 0, 0]);

    sim.resetDay = '2026-07-09';
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'loss')).toBe(8);
  });

  it('keeps the loss counter off the win counter, in both directions', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const meta = sim.meta(sim.addPlayer('warrior', 'Rematch'))!;
    const key = '["character:9"]';

    // Losing to a team first must not spend the award for beating it later.
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'loss')).toBe(8);
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'win')).toBe(25);
    // And each counter is spent exactly once, so the pairing's whole day is
    // win + loss and no more: the win-trading ceiling.
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'loss')).toBe(0);
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'win')).toBe(0);
    expect(meta.honor).toBe(33);
  });

  it('tapers loss awards on the daily win count without letting losses advance it', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const meta = sim.meta(sim.addPlayer('warrior', 'Grinder'))!;

    // A day of nothing but losses never tapers itself: the taper caps arena
    // INCOME, and a player must not be able to pad it by conceding bouts.
    for (let i = 0; i < ARENA_DAILY_TAPER_START + 2; i++) {
      expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', `["character:${i}"]`, 'loss')).toBe(
        8,
      );
    }
    expect(meta.honorArenaDaily?.totalWins).toBe(0);
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', '["character:win"]', 'win')).toBe(25);

    // Wins do taper the loss award, on the same curve they taper themselves.
    const winner = world();
    winner.resetDay = '2026-07-08';
    const winnerMeta = winner.meta(winner.addPlayer('warrior', 'Champion'))!;
    for (let i = 0; i < ARENA_DAILY_TAPER_START; i++) {
      awardRankedArenaResultHonor(winner.ctx, winnerMeta, '1v1', `["character:${i}"]`, 'win');
    }
    expect(
      awardRankedArenaResultHonor(winner.ctx, winnerMeta, '1v1', '["character:next"]', 'loss'),
    ).toBe(4);
  });

  it('does not reset a persisted daily window when the host has no reset day', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const pid = sim.addPlayer('warrior', 'Replay');
    const meta = sim.meta(pid)!;
    const key = '["name:opponent"]';
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', key, 'win')).toBe(25);
    // The persisted window is carried into a SECOND world that was never fed
    // a day (the tests/delves.test.ts shape): Sim.resetDay is monotone
    // non-decreasing, so '' on the first world would be held at 2026-07-08
    // and exercise nothing; a never-fed sim is the one host that observes ''.
    const saved = sim.serializeCharacter(pid)!;
    const replay = world();
    expect(replay.resetDay).toBe('');
    const replayPid = replay.addPlayer('warrior', 'Replay', { state: saved });
    const replayMeta = replay.meta(replayPid)!;
    expect(replayMeta.honorArenaDaily?.date).toBe('2026-07-08');
    expect(awardRankedArenaResultHonor(replay.ctx, replayMeta, '1v1', key, 'win')).toBe(0);
  });

  it('round-trips the loss counter and leaves an unused one out of the save', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const pid = sim.addPlayer('warrior', 'Persist');
    const meta = sim.meta(pid)!;

    // Absent, not empty, until a loss pays: a save written before this existed
    // must round-trip byte-identical.
    awardRankedArenaResultHonor(sim.ctx, meta, '1v1', '["character:9"]', 'win');
    expect(sim.serializeCharacter(pid)!.honorArenaDaily?.lossesByOpponent).toBeUndefined();

    awardRankedArenaResultHonor(sim.ctx, meta, '1v1', '["character:9"]', 'loss');
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.honorArenaDaily?.lossesByOpponent).toEqual({ '1v1:["character:9"]': 1 });

    const loaded = world();
    loaded.resetDay = '2026-07-08';
    const loadedPid = loaded.addPlayer('warrior', 'Persist', { state: saved });
    const loadedMeta = loaded.meta(loadedPid)!;
    // The spent counter survives the reload, so relogging cannot re-arm it.
    expect(
      awardRankedArenaResultHonor(loaded.ctx, loadedMeta, '1v1', '["character:9"]', 'loss'),
    ).toBe(0);
  });

  it('sanitizes a malformed persisted loss counter', () => {
    const seed = world();
    const seedPid = seed.addPlayer('warrior', 'Corrupt');
    const state = seed.serializeCharacter(seedPid)! as unknown as Record<string, unknown>;
    state.honorArenaDaily = {
      date: '2026-07-08',
      winsByOpponent: {},
      lossesByOpponent: { valid: 3.7, negative: -2, nan: Number.NaN },
      fiestaCompletionsByOpponent: {},
      totalWins: 0,
    };

    const loaded = world();
    const meta = loaded.meta(loaded.addPlayer('warrior', 'Corrupt', { state: state as never }))!;
    expect(meta.honorArenaDaily?.lossesByOpponent).toEqual({ valid: 3 });
  });
});

describe('Fiesta honor', () => {
  it('awards a cross-team takedown plus non-forfeit completion/win bonuses once', () => {
    const { sim, match } = liveFiesta();
    const killerPid = match.teamA[0];
    const victimPid = match.teamB[0];
    fiesta.fiestaTakedown(sim.ctx, match, killerPid, sim.entities.get(victimPid)!);

    expect(sim.meta(killerPid)!.honor).toBe(FIESTA_KILL_HONOR);
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');
    expect(sim.meta(killerPid)!.honor).toBe(
      FIESTA_KILL_HONOR + FIESTA_COMPLETION_HONOR + FIESTA_WIN_BONUS_HONOR,
    );
    expect(sim.meta(match.teamA[1])!.honor).toBe(FIESTA_COMPLETION_HONOR + FIESTA_WIN_BONUS_HONOR);
    expect(sim.meta(match.teamB[0])!.honor).toBe(FIESTA_COMPLETION_HONOR);

    const balances = [...match.teamA, ...match.teamB].map((pid) => sim.meta(pid)!.honor);
    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');
    expect([...match.teamA, ...match.teamB].map((pid) => sim.meta(pid)!.honor)).toEqual(balances);
  });

  it('applies per-victim kill DR and repeat-opposition completion DR', () => {
    const sim = world();
    sim.resetDay = '2026-07-08';
    const pid = sim.addPlayer('rogue', 'Fighter');
    const meta = sim.meta(pid)!;
    const pairs = new Map<string, number>();
    expect(Array.from({ length: 4 }, () => awardFiestaKillHonor(sim.ctx, meta, 99, pairs))).toEqual(
      [20, 10, 5, 0],
    );

    const beforeCompletion = meta.honor;
    const bonuses = Array.from({ length: 4 }, () =>
      awardFiestaCompletionHonor(sim.ctx, meta, '["character:enemy"]', true),
    );
    expect(bonuses).toEqual([60, 30, 15, 0]);
    expect(meta.honor - beforeCompletion).toBe(105);
  });

  it('denies same-team takedown honor and all offline-practice honor', () => {
    const sameTeam = liveFiesta();
    const allyKiller = sameTeam.match.teamA[0];
    const allyVictim = sameTeam.match.teamA[1];
    fiesta.fiestaTakedown(
      sameTeam.sim.ctx,
      sameTeam.match,
      allyKiller,
      sameTeam.sim.entities.get(allyVictim)!,
    );
    expect(sameTeam.sim.meta(allyKiller)!.honor).toBe(0);

    const practice = new Sim({ seed: 7, playerClass: 'warrior', world: RL_TEST_WORLD });
    expect(practice.startFiestaPractice()).toBe(true);
    let match: ArenaMatch | null = null;
    for (let i = 0; i < 20 * 8; i++) {
      practice.updateFiestaBots();
      practice.tick();
      match = practice.arenaMatchFor(practice.playerId);
      if (match?.state === 'active') break;
    }
    expect(match?.practice).toBe(true);
    const killer = match!.teamA[0];
    const victim = match!.teamB[0];
    fiesta.fiestaTakedown(practice.ctx, match!, killer, practice.entities.get(victim)!);
    arena.endArenaMatch(practice.ctx, match!, 'A', 'defeat');
    for (const pid of [...match!.teamA, ...match!.teamB]) {
      expect(practice.meta(pid)!.honor).toBe(0);
    }
  });

  it('pays no completion or win honor for a forfeit', () => {
    const { sim, match } = liveFiesta();
    arena.endArenaMatch(sim.ctx, match, 'A', 'forfeit');
    for (const pid of [...match.teamA, ...match.teamB]) expect(sim.meta(pid)!.honor).toBe(0);
  });
});

describe('Thornhollow Fields honor income', () => {
  function bgPlayer(): { sim: Sim; meta: NonNullable<ReturnType<Sim['meta']>> } {
    const sim = world();
    sim.resetDay = '2026-08-06';
    const pid = sim.addPlayer('warrior', 'Fielder', { characterId: 700 });
    return { sim, meta: sim.meta(pid)! };
  }

  it("pays 160 for the day's first win and 120 for the next", () => {
    const { sim, meta } = bgPlayer();
    const first = awardBattlegroundHonor(sim.ctx, meta, '["character:1"]', 'win');
    expect(first.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(first.total).toBe(160);
    // A fresh opposing identity, so the repeat curve is not what is measured:
    // only the bonus should be missing the second time.
    const second = awardBattlegroundHonor(sim.ctx, meta, '["character:2"]', 'win');
    expect(second.firstWinBonus).toBe(0);
    expect(second.total).toBe(BATTLEGROUND_WIN_HONOR);
    expect(second.total).toBe(120);
  });

  it('neither arms nor claims the daily bonus on a loss or a draw', () => {
    const { sim, meta } = bgPlayer();
    for (const outcome of ['loss', 'draw'] as const) {
      const paid = awardBattlegroundHonor(sim.ctx, meta, `["character:${outcome}"]`, outcome);
      expect(paid.firstWinBonus).toBe(0);
      expect(paid.total).toBe(BATTLEGROUND_LOSS_HONOR);
      expect(meta.honorArenaDaily!.bgFirstWinClaimed).toBeUndefined();
    }
    // The bonus survived both, and the day's first WIN still collects it.
    const win = awardBattlegroundHonor(sim.ctx, meta, '["character:win"]', 'win');
    expect(win.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(meta.honorArenaDaily!.bgFirstWinClaimed).toBe(true);
  });

  it('pays the daily bonus undecayed on top of a decayed base award', () => {
    const { sim, meta } = bgPlayer();
    const key = '["character:premade"]';
    // Three results against the same roster first, so the fourth sits on the
    // curve's floor. Losses, so none of them claims the bonus.
    for (let i = 0; i < 3; i++) awardBattlegroundHonor(sim.ctx, meta, key, 'loss');
    const win = awardBattlegroundHonor(sim.ctx, meta, key, 'win');
    // Base is floored at 0.25 (60 -> 15); the bonus is NOT decayed with it.
    expect(win.total - win.firstWinBonus).toBe(30);
    expect(win.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(win.total).toBe(70);
  });

  it('floors the result curve at a quarter and never reaches zero', () => {
    const { sim, meta } = bgPlayer();
    const key = '["character:stable-premade"]';
    // Many more results than the curve is long: the tail is the whole point.
    const paid = Array.from(
      { length: 10 },
      () => awardBattlegroundHonor(sim.ctx, meta, key, 'loss').total,
    );
    expect(paid).toEqual([40, 20, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(paid.every((amount) => amount > 0)).toBe(true);

    const wins = bgPlayer();
    const winPaid = Array.from(
      { length: 6 },
      () => awardBattlegroundHonor(wins.sim.ctx, wins.meta, key, 'win').total,
    );
    // The first carries the +20 daily bonus; the rest are the floored base.
    expect(winPaid).toEqual([160, 60, 30, 30, 30, 30]);
  });

  it('keeps the battleground result curve separate from the shared Fiesta one', () => {
    // The regression the separate-curve decision exists to prevent: editing
    // HONOR_REPEAT_DR in place to floor the battleground would retune Fiesta,
    // battleground kills, and battleground assists along with it.
    expect(HONOR_REPEAT_DR).toEqual([1, 0.5, 0.25, 0]);
    expect(BATTLEGROUND_RESULT_DR).toEqual([1, 0.5, 0.25, 0.25]);
    expect(repeatHonorMultiplier(3)).toBe(0);
    expect(battlegroundResultMultiplier(3)).toBe(0.25);
    // Past the end of each array the last entry holds.
    expect(repeatHonorMultiplier(99)).toBe(0);
    expect(battlegroundResultMultiplier(99)).toBe(0.25);
  });

  it('leaves Fiesta awards on the shared zero-floor curve', () => {
    const sim = world();
    sim.resetDay = '2026-08-06';
    const pid = sim.addPlayer('rogue', 'Partygoer', { characterId: 701 });
    const meta = sim.meta(pid)!;
    const pairs = new Map<string, number>();
    expect(Array.from({ length: 5 }, () => awardFiestaKillHonor(sim.ctx, meta, 99, pairs))).toEqual(
      [20, 10, 5, 0, 0],
    );
    const completions = Array.from({ length: 5 }, () =>
      awardFiestaCompletionHonor(sim.ctx, meta, '["character:enemy"]', false),
    );
    expect(completions).toEqual([20, 10, 5, 0, 0]);
  });

  it('leaves battleground kill and assist honor on the shared curve, per match', () => {
    const { sim, meta } = bgPlayer();
    const kills = new Map<string, number>();
    expect(
      Array.from({ length: 5 }, () => awardBattlegroundKillHonor(sim.ctx, meta, 99, kills)),
    ).toEqual([10, 5, 2, 0, 0]);
    expect(BATTLEGROUND_KILL_HONOR).toBe(10);

    const assists = new Map<string, number>();
    expect(
      Array.from({ length: 5 }, () => awardBattlegroundAssistHonor(sim.ctx, meta, 99, assists)),
    ).toEqual([4, 2, 1, 0, 0]);
    expect(BATTLEGROUND_ASSIST_HONOR).toBe(4);

    // The counters live on the MATCH, so a new match starts the curve over.
    const nextMatch = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, meta, 99, nextMatch)).toBe(10);
  });
});

describe('weekly Double Honor', () => {
  it('doubles battleground kill and assist drips before the single floor, all weekend', () => {
    const sim = world();
    sim.resetDay = '2026-08-15'; // a Saturday
    const pid = sim.addPlayer('warrior', 'Weekender');
    const meta = sim.meta(pid)!;

    // Doubled BEFORE grantHonor's single floor: the third (0.25-decayed) kill
    // pays floor(5 * 0.25 * 2) = 2, and the second pays 5, never floor-then-double.
    const kills = new Map<string, number>();
    expect(
      Array.from({ length: 5 }, () => awardBattlegroundKillHonor(sim.ctx, meta, 99, kills)),
    ).toEqual([20, 10, 5, 0, 0]);
    const assists = new Map<string, number>();
    expect(
      Array.from({ length: 5 }, () => awardBattlegroundAssistHonor(sim.ctx, meta, 99, assists)),
    ).toEqual([8, 4, 2, 0, 0]);
    expect(sim.events).toContainEqual({
      type: 'honor',
      pid,
      amount: 10,
      reason: 'battleground_kill',
    });

    // Sunday is still inside the window; the Monday rollover closes it.
    sim.resetDay = '2026-08-16';
    const sunday = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, meta, 100, sunday)).toBe(20);
    sim.resetDay = '2026-08-17';
    const monday = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, meta, 101, monday)).toBe(10);
  });

  it('opens 12 hours early: Friday pays double once the lead probe reads Saturday', () => {
    const sim = world();
    sim.resetDay = '2026-08-21'; // a Friday
    sim.eventLeadDay = '2026-08-21'; // Friday morning: the probe has not crossed yet
    const pid = sim.addPlayer('warrior', 'EarlyBird');
    const meta = sim.meta(pid)!;

    // Before the probe crosses, Friday is an ordinary weekday.
    const morning = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, meta, 100, morning)).toBe(10);

    // From 3 PM realm time the host's probe reads Saturday: every award path
    // doubles, and the loss boost opens with the same window.
    sim.eventLeadDay = '2026-08-22';
    const evening = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, meta, 101, evening)).toBe(20);
    const loss = awardBattlegroundHonor(sim.ctx, meta, '["character:fri"]', 'loss');
    expect(loss.total).toBe(BATTLEGROUND_WIN_HONOR * 2);
    expect(loss.firstWinBonus, 'a loss never claims the daily bonus').toBe(0);
  });

  it('pays a played-out loss and draw the WIN base during the weekend, and the loss base outside it', () => {
    const sim = world();
    sim.resetDay = '2026-08-16'; // a Sunday, inside the window
    const pid = sim.addPlayer('warrior', 'Stalwart', { characterId: 704 });
    const meta = sim.meta(pid)!;

    // The weekend loss boost: a played-out loss pays the WIN base, doubled,
    // and a draw the same; the DR curve still applies on the shared counter.
    const loss = awardBattlegroundHonor(sim.ctx, meta, '["character:sun"]', 'loss');
    expect(loss.total).toBe(BATTLEGROUND_WIN_HONOR * 2);
    expect(loss.firstWinBonus, 'a loss never claims the daily bonus').toBe(0);
    const draw = awardBattlegroundHonor(sim.ctx, meta, '["character:sun"]', 'draw');
    expect(draw.total).toBe(Math.floor(BATTLEGROUND_WIN_HONOR * 0.5) * 2);
    // The first WIN still arms the daily bonus on top: losing first, then
    // winning, keeps the day's headline reward intact.
    const win = awardBattlegroundHonor(sim.ctx, meta, '["character:sun"]', 'win');
    expect(win.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR * 2);

    // Monday: weekday loss economics are untouched.
    sim.resetDay = '2026-08-17';
    const weekday = awardBattlegroundHonor(sim.ctx, meta, '["character:mon"]', 'loss');
    expect(weekday.total).toBe(BATTLEGROUND_LOSS_HONOR);
  });

  it('leaves arena and Fiesta honor at base rate on the weekend (5v5-only scope)', () => {
    const sim = world();
    sim.resetDay = '2026-08-15'; // a Saturday
    const pid = sim.addPlayer('warrior', 'Purist', { characterId: 703 });
    const meta = sim.meta(pid)!;

    // The issue scopes the event to the 5v5 CTF explicitly, so a Saturday
    // ranked arena win and a Fiesta kill both pay exactly their weekday rate.
    expect(awardRankedArenaResultHonor(sim.ctx, meta, '1v1', '["character:foe"]', 'win')).toBe(
      RANKED_ARENA_WIN_HONOR['1v1'],
    );
    const pairs = new Map<string, number>();
    expect(awardFiestaKillHonor(sim.ctx, meta, 99, pairs)).toBe(FIESTA_KILL_HONOR);
    // And the funnel itself never applies the event: raw grants stay raw.
    expect(grantHonor(sim.ctx, meta, 60, 'arena_win')).toBe(60);
  });

  it('doubles the whole battleground result, first-win bonus included, with the DR curve intact', () => {
    const sim = world();
    sim.resetDay = '2026-08-15'; // a Saturday
    const pid = sim.addPlayer('warrior', 'SatWinner', { characterId: 702 });
    const meta = sim.meta(pid)!;

    const first = awardBattlegroundHonor(sim.ctx, meta, '["character:sat"]', 'win');
    expect(first.total).toBe((BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR) * 2);
    expect(first.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR * 2);
    // The anti-farm decay applies first, then the event doubling: the repeat
    // win against the same team pays 2 x floor(60 * 0.5), not 2 x 60.
    const repeat = awardBattlegroundHonor(sim.ctx, meta, '["character:sat"]', 'win');
    expect(repeat.total).toBe(Math.floor(BATTLEGROUND_WIN_HONOR * 0.5) * 2);
    expect(repeat.firstWinBonus).toBe(0);
  });

  it('never fires without a host calendar (the empty reset day)', () => {
    const sim = world(); // resetDay stays '': headless / replay / parity runs
    const pid = sim.addPlayer('warrior', 'Headless');
    const kills = new Map<string, number>();
    expect(awardBattlegroundKillHonor(sim.ctx, sim.meta(pid)!, 99, kills)).toBe(
      BATTLEGROUND_KILL_HONOR,
    );
  });
});

describe('WARFARE damage', () => {
  it('scales hostile player damage and leaves friendly and PvE paths unchanged', () => {
    const sim = world();
    const sourcePid = sim.addPlayer('warrior', 'Source');
    const targetPid = sim.addPlayer('mage', 'Target');
    const friendlyPid = sim.addPlayer('priest', 'Friendly');
    const source = sim.entities.get(sourcePid)!;
    const target = sim.entities.get(targetPid)!;
    const friendly = sim.entities.get(friendlyPid)!;
    source.stats.pvpOffense = 0.1;
    target.stats.pvpDefense = 0.2;
    target.maxHp = target.hp = 1_000;
    friendly.maxHp = friendly.hp = 1_000;
    sim.duels.set(sourcePid, {
      a: sourcePid,
      b: targetPid,
      state: 'active',
      timer: 0,
      controlled: new Map(),
    });
    sim.duels.set(targetPid, sim.duels.get(sourcePid)!);

    (sim as any).dealDamage(source, target, 100, false, 'arcane', null, 'hit');
    expect(target.hp).toBe(912);

    (sim as any).dealDamage(source, friendly, 100, false, 'arcane', null, 'hit');
    expect(friendly.hp).toBe(900);

    const mob = [...sim.entities.values()].find((entity) => entity.kind === 'mob')!;
    mob.maxHp = mob.hp = 1_000;
    (sim as any).dealDamage(source, mob, 100, false, 'arcane', null, 'hit');
    expect(mob.hp).toBe(900);

    target.hp = 1_000;
    (sim as any).dealDamage(mob, target, 100, false, 'arcane', null, 'hit');
    expect(target.hp).toBe(900);
  });

  it("applies to ALL PvP combat: pets fight with their owner's WARFARE, and PvE never moves", () => {
    const sim = world();
    const ownerPid = sim.addPlayer('hunter', 'Owner');
    const foePid = sim.addPlayer('mage', 'Foe');
    const owner = sim.entities.get(ownerPid)!;
    const foe = sim.entities.get(foePid)!;
    owner.stats.pvpOffense = 0.1;
    owner.stats.pvpDefense = 0.2;
    foe.stats.pvpOffense = 0.1;
    foe.stats.pvpDefense = 0.2;
    foe.maxHp = foe.hp = 1_000;
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, owner.level, { ...owner.pos });
    pet.ownerId = owner.id;
    pet.hostile = false;
    pet.maxHp = pet.hp = 1_000;
    sim.addEntity(pet);
    sim.duels.set(ownerPid, {
      a: ownerPid,
      b: foePid,
      state: 'active',
      timer: 0,
      controlled: new Map(),
    });
    sim.duels.set(foePid, sim.duels.get(ownerPid)!);

    // The pet hits the foe with its owner's Offense against the foe's Defense:
    // 100 x 1.1 x 0.8 = 88.
    (sim as any).dealDamage(pet, foe, 100, false, 'physical', null, 'hit');
    expect(foe.hp).toBe(912);
    // The foe hits the pet, which takes it with its owner's Defense.
    (sim as any).dealDamage(foe, pet, 100, false, 'arcane', null, 'hit');
    expect(pet.hp).toBe(912);

    // PvE never moves: the pet against a wild mob, and a wild mob against the pet.
    const mob = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.ownerId === null,
    )!;
    mob.maxHp = mob.hp = 1_000;
    (sim as any).dealDamage(pet, mob, 100, false, 'physical', null, 'hit');
    expect(mob.hp).toBe(900);
    pet.hp = 1_000;
    (sim as any).dealDamage(mob, pet, 100, false, 'physical', null, 'hit');
    expect(pet.hp).toBe(900);

    // Nor does a pet's damage to a player it is not hostile to (no fight between them).
    const bystanderPid = sim.addPlayer('priest', 'Bystander');
    const bystander = sim.entities.get(bystanderPid)!;
    bystander.stats.pvpDefense = 0.2;
    bystander.maxHp = bystander.hp = 1_000;
    (sim as any).dealDamage(pet, bystander, 100, false, 'physical', null, 'hit');
    expect(bystander.hp).toBe(900);
  });

  it('clamps oversized derived fractions on the applied damage path', () => {
    const sim = world();
    const sourcePid = sim.addPlayer('warrior', 'Source');
    const targetPid = sim.addPlayer('mage', 'Target');
    const source = sim.entities.get(sourcePid)!;
    const target = sim.entities.get(targetPid)!;
    source.stats.pvpOffense = 9;
    target.stats.pvpDefense = 9;
    target.maxHp = target.hp = 1_000;
    sim.duels.set(sourcePid, {
      a: sourcePid,
      b: targetPid,
      state: 'active',
      timer: 0,
      controlled: new Map(),
    });
    sim.duels.set(targetPid, sim.duels.get(sourcePid)!);

    (sim as any).dealDamage(source, target, 100, false, 'arcane', null, 'hit');
    // 100 x (1 + 0.30) x (1 - 0.30) = 91 at the raised WARFARE caps.
    expect(target.hp).toBe(909);
  });
});

// WARFARE Vitality (owner rule, 2026-09-24): honor gear raises maximum health
// everywhere except PvE instances, so PvP gear gives players far more health than
// players without it while raid gear stays the raid pick.
describe('WARFARE Vitality', () => {
  const STR_KIT: Partial<Record<EquipSlot, string>> = {
    mainhand: 'final_argument_greatblade',
    helmet: 'furyforged_warhelm',
    shoulder: 'furyforged_warspaulders',
    chest: 'furyforged_warplate',
    waist: 'furyforged_girdle',
    legs: 'furyforged_legguards',
    gloves: 'furyforged_gauntlets',
    feet: 'furyforged_sabatons',
    neck: 'final_oath_medallion',
    ring1: 'iron_vow_band',
    ring2: 'unbroken_circle',
  };
  const AGI_KIT: Partial<Record<EquipSlot, string>> = {
    mainhand: 'first_blood_razor',
    helmet: 'ashstalker_cowl',
    shoulder: 'ashstalker_shoulderguards',
    chest: 'ashstalker_harness',
    waist: 'ashstalker_waistband',
    legs: 'ashstalker_legguards',
    gloves: 'ashstalker_grips',
    feet: 'ashstalker_treads',
    neck: 'razorwind_torque',
    ring1: 'fleetblood_band',
    ring2: 'last_step_signet',
  };
  const INSTANCE_X = DUNGEON_X_THRESHOLD + 900;

  function geared(cls: PlayerClass, spec: string, kit: Partial<Record<EquipSlot, string>>) {
    const sim = world();
    const pid = sim.addPlayer(cls, `V${cls}`);
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec, rows: {} } as TalentAllocation, pid);
    for (const [slot, id] of Object.entries(kit)) {
      sim.addItem(id, 1, pid);
      sim.equipItemToSlot(id, slot as EquipSlot, pid);
    }
    for (let i = 0; i < 12; i++) sim.tick();
    return { sim, pid, e: sim.entities.get(pid)! };
  }

  function standAt(sim: Sim, e: Entity, x: number): void {
    e.pos = { ...e.pos, x };
    e.prevPos = { ...e.pos };
    for (let i = 0; i < 12; i++) sim.tick();
  }

  it('reads the Warfare Defense Rating at six per percent, capped at +80%', () => {
    // A full Season 1 kit (302 rating) lands at about +50%; only the Warfare
    // Season 2 pieces carry the rating to reach the +80% cap.
    expect(PVP_VITALITY_RATING_PER_PCT).toBe(6);
    expect(PVP_VITALITY_CAP).toBe(0.8);
    expect(pvpVitalityFromRating(0)).toBe(0);
    expect(pvpVitalityFromRating(-40)).toBe(0);
    expect(pvpVitalityFromRating(60)).toBeCloseTo(0.1, 10);
    expect(pvpVitalityFromRating(182)).toBeCloseTo(182 / 600, 10);
    expect(pvpVitalityFromRating(302)).toBeCloseTo(302 / 600, 10);
    expect(pvpVitalityFromRating(480)).toBeCloseTo(0.8, 10);
    expect(pvpVitalityFromRating(9_999)).toBe(0.8);
  });

  it('applies in the open world and never on dungeon ground, keeping the health fraction', () => {
    const { sim, e } = geared('warrior', 'arms', STR_KIT);
    // The full Season 1 kit's 302 rating.
    expect(e.stats.pvpVitality).toBeCloseTo(302 / 600, 10);
    const open = e.maxHp;
    // Walking onto the instance plane (a dungeon band) switches it off; the
    // health FRACTION survives the switch.
    e.hp = Math.round(open * 0.6);
    standAt(sim, e, INSTANCE_X);
    expect(e.pvpVitalityActive).toBe(false);
    expect(e.maxHp).toBe(Math.round(open / (1 + 302 / 600)));
    expect(e.hp / e.maxHp).toBeCloseTo(0.6, 2);
    // Back in the open world it returns.
    standAt(sim, e, 0);
    expect(e.maxHp).toBe(open);
  });

  it('counts a live arena match as PvP, though the arena sits on the instance plane', () => {
    const { sim, a } = liveArena();
    const e = sim.entities.get(a)!;
    for (let i = 0; i < 12; i++) sim.tick();
    expect(e.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(pvpVitalityAppliesTo(sim.ctx, e)).toBe(true);
    expect(e.pvpVitalityActive).not.toBe(false);
    // The same ground outside a match is an instance: off.
    sim.arenaMatches.delete(a);
    expect(pvpVitalityAppliesTo(sim.ctx, e)).toBe(false);
    // A battleground match counts the same way (the membership is all the
    // context check reads; no tick runs against the placeholder match).
    (sim.bgMatches as Map<number, unknown>).set(a, {});
    expect(pvpVitalityAppliesTo(sim.ctx, e)).toBe(true);
    sim.bgMatches.delete(a);
    expect(pvpVitalityAppliesTo(sim.ctx, e)).toBe(false);
  });

  it('never makes honor gear the raid pick: in an instance every tank kit has less effective health than raid best-in-slot', () => {
    // Effective health against a level-22 boss's physical hit: health over the
    // share of the hit that survives armor. Raw health alone is the wrong
    // measure (a feral's honor kit carries 52 more health in bear form but about
    // a thousand less armor, so 872 less effective health), and the tier also
    // carries no hit, crit or haste rating at all (tests/warfare_gear_tier.test.ts).
    const BOSS_LEVEL = 22;
    const ehp = (e: Entity) => e.maxHp / (1 - armorReduction(e.stats.armor, BOSS_LEVEL));
    for (const [cls, spec, kit, bear] of [
      ['warrior', 'prot', STR_KIT, false],
      ['paladin', 'protection', STR_KIT, false],
      ['druid', 'feral', AGI_KIT, true],
    ] as [PlayerClass, string, Partial<Record<EquipSlot, string>>, boolean][]) {
      const sides = [kit, bestEpicGearFor(cls, spec)].map((k) => {
        const side = geared(cls, spec, k);
        if (bear) {
          side.e.auras.push({
            id: 'bear_form',
            name: 'Bear Form',
            kind: 'form_bear',
            remaining: 9999,
            duration: 9999,
            value: 0,
          } as never);
        }
        standAt(side.sim, side.e, INSTANCE_X);
        side.sim.ctx.recalcPlayer(side.e);
        return side.e;
      });
      const [honor, raid] = sides;
      expect(honor.pvpVitalityActive, `${cls}/${spec}`).toBe(false);
      expect(ehp(honor), `${cls}/${spec} honor kit effective health in an instance`).toBeLessThan(
        ehp(raid),
      );
    }
  });
});
