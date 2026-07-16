import { describe, expect, it } from 'vitest';
import {
  ARENA_DAILY_TAPER_START,
  awardFiestaCompletionHonor,
  awardFiestaKillHonor,
  awardRankedArenaWinHonor,
  FIESTA_COMPLETION_HONOR,
  FIESTA_KILL_HONOR,
  FIESTA_WIN_BONUS_HONOR,
  grantHonor,
  RANKED_ARENA_WIN_HONOR,
} from '../src/sim/pvp';
import type { ArenaMatch } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import * as arena from '../src/sim/social/arena';
import * as fiesta from '../src/sim/social/fiesta';

function world(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function liveArena(): { sim: Sim; a: number; b: number; match: ArenaMatch } {
  const sim = world();
  sim.utcDay = '2026-07-11';
  const a = sim.addPlayer('warrior', 'Aleph', { characterId: 101 });
  const b = sim.addPlayer('mage', 'Bet', { characterId: 202 });
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
  sim.utcDay = '2026-07-11';
  const classes = ['warrior', 'mage', 'rogue', 'priest'] as const;
  const pids = classes.map((cls, i) => sim.addPlayer(cls, `Ranked${i}`, { characterId: 500 + i }));
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
  sim.utcDay = '2026-07-11';
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
  it('awards only the winner and records the result exactly once', () => {
    const { sim, a, b, match } = liveArena();
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');

    expect(sim.meta(a)!.honor).toBe(RANKED_ARENA_WIN_HONOR['1v1']);
    expect(sim.meta(b)!.honor).toBe(0);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaLosses).toBe(1);

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');
    expect(sim.meta(a)!.honor).toBe(RANKED_ARENA_WIN_HONOR['1v1']);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaWins).toBe(0);
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
    for (const pid of match.teamB) {
      expect(sim.meta(pid)!.honor).toBe(0);
      expect(sim.meta(pid)!.arena2v2Losses).toBe(1);
    }
  });

  it('applies repeat-opponent DR, the daily taper, and UTC rollover deterministically', () => {
    const sim = world();
    sim.utcDay = '2026-07-11';
    const pid = sim.addPlayer('warrior', 'Climber');
    const meta = sim.meta(pid)!;

    const repeat = Array.from({ length: 4 }, () =>
      awardRankedArenaWinHonor(sim.ctx, meta, '1v1', '["character:9"]'),
    );
    expect(repeat).toEqual([25, 0, 0, 0]);

    const fresh = world();
    fresh.utcDay = '2026-07-11';
    const freshPid = fresh.addPlayer('warrior', 'Taper');
    const freshMeta = fresh.meta(freshPid)!;
    for (let i = 0; i < ARENA_DAILY_TAPER_START; i++) {
      expect(awardRankedArenaWinHonor(fresh.ctx, freshMeta, '1v1', `["character:${i}"]`)).toBe(25);
    }
    expect(awardRankedArenaWinHonor(fresh.ctx, freshMeta, '1v1', '["character:next"]')).toBe(12);

    fresh.utcDay = '2026-07-12';
    expect(awardRankedArenaWinHonor(fresh.ctx, freshMeta, '1v1', '["character:next"]')).toBe(25);
  });

  it('does not reset a persisted daily window when the host has no UTC day', () => {
    const sim = world();
    sim.utcDay = '2026-07-11';
    const pid = sim.addPlayer('warrior', 'Replay');
    const meta = sim.meta(pid)!;
    const key = '["name:opponent"]';
    expect(awardRankedArenaWinHonor(sim.ctx, meta, '1v1', key)).toBe(25);
    sim.utcDay = '';
    expect(awardRankedArenaWinHonor(sim.ctx, meta, '1v1', key)).toBe(0);
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
    sim.utcDay = '2026-07-11';
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

    const practice = new Sim({ seed: 7, playerClass: 'warrior' });
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
    sim.duels.set(sourcePid, { a: sourcePid, b: targetPid, state: 'active', timer: 0 });
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

  it('clamps oversized derived fractions on the applied damage path', () => {
    const sim = world();
    const sourcePid = sim.addPlayer('warrior', 'Source');
    const targetPid = sim.addPlayer('mage', 'Target');
    const source = sim.entities.get(sourcePid)!;
    const target = sim.entities.get(targetPid)!;
    source.stats.pvpOffense = 9;
    target.stats.pvpDefense = 9;
    target.maxHp = target.hp = 1_000;
    sim.duels.set(sourcePid, { a: sourcePid, b: targetPid, state: 'active', timer: 0 });
    sim.duels.set(targetPid, sim.duels.get(sourcePid)!);

    (sim as any).dealDamage(source, target, 100, false, 'arcane', null, 'hit');
    expect(target.hp).toBe(904);
  });
});
