// World PvP forfeit (src/sim/pvp/world_pvp_forfeit.ts + world_pvp_payouts.ts):
// a player who leaves the world while a world fight is live dies to their
// opponent on the spot. The opponent is paid the honor pool and the kill at
// once, the kill/death record moves at once, the leaver's gold stake leaves
// their purse at once, and the stake reaches the winner
// WORLD_PVP_FORFEIT_PAYOUT_SECONDS later. Every rule of a real kill holds (the
// per-pair diminishing returns, the flagged-only stake); a player in no live
// fight, in a sanctuary, or whose opponent already fell leaves freely.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, PLAYER_START, ZONES } from '../src/sim/data';
import {
  forfeitWorldPvpFightOnDeparture,
  loadWorldPvpPayouts,
  WORLD_PVP_ASSIST_WINDOW,
  WORLD_PVP_FORFEIT_PAYOUT_SECONDS,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_PENDING_PAYOUT_LIMIT,
  worldPvpFightOpponent,
  worldPvpForfeitKillLine,
  worldPvpForfeitPayoutLine,
} from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const SEED = 7;
const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const CONTESTED = { x: 60, z: 700 }; // Thornpeak Heights, the mutual-flag rule
const FFA = { x: 353.8, z: 2262.4 }; // the Drakelands

function world(): Sim {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: ARENA_FREE_WORLD,
  });
  sim.resetDay = '2026-07-08';
  return sim;
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}

function place(sim: Sim, pid: number, spot: { x: number; z: number }, dx = 0): void {
  const e = ent(sim, pid);
  const x = spot.x + dx;
  e.pos = { x, y: groundHeight(x, spot.z, SEED), z: spot.z };
  e.prevPos = { ...e.pos };
}

function addFighter(sim: Sim, name: string, characterId: number, dx = 0): number {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true, characterId });
  sim.setPlayerLevel(20, pid);
  const e = ent(sim, pid);
  e.hp = e.maxHp;
  place(sim, pid, CONTESTED, dx);
  return pid;
}

function advanceClock(sim: Sim, seconds: number): void {
  (sim as unknown as { time: number }).time += seconds;
  sim.tick();
}

function flag(sim: Sim, pid: number): void {
  advanceClock(sim, WORLD_PVP_TOGGLE_COOLDOWN + 1);
  sim.setWorldPvpFlag(true, pid);
}

function hit(sim: Sim, attackerPid: number, victimPid: number, amount = 5): void {
  sim.ctx.dealDamage(
    ent(sim, attackerPid),
    ent(sim, victimPid),
    amount,
    false,
    'physical',
    'Slam',
    'hit',
  );
}

function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(
    ent(sim, killerPid),
    victim,
    victim.hp + 1_000,
    false,
    'physical',
    'Slam',
    'hit',
  );
}

function revive(sim: Sim, pid: number): void {
  const e = ent(sim, pid);
  e.dead = false;
  e.hp = e.maxHp;
}

function logLines(events: SimEvent[], pid: number): string[] {
  return events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log' && ev.pid === pid)
    .map((ev) => ev.text);
}

function honorEvents(sim: Sim, pid: number) {
  return sim.events.filter(
    (ev): ev is Extract<SimEvent, { type: 'honor' }> => ev.type === 'honor' && ev.pid === pid,
  );
}

/** Two flagged level-20 strangers side by side on contested ground. */
function fight(): { sim: Sim; a: number; b: number } {
  const sim = world();
  const a = addFighter(sim, 'Aleph', 1001);
  const b = addFighter(sim, 'Bet', 1002, 2);
  flag(sim, a);
  flag(sim, b);
  sim.events = [];
  return { sim, a, b };
}

describe('the tuning literal', () => {
  it('holds the gold for five minutes', () => {
    expect(WORLD_PVP_FORFEIT_PAYOUT_SECONDS).toBe(300);
  });
});

describe('a player who leaves mid-fight forfeits it', () => {
  it('dies to the opponent: honor and the record now, the debit now, the gold in five minutes', () => {
    const { sim, a, b } = fight();
    sim.meta(a)!.copper = 0;
    sim.meta(b)!.copper = 20_000; // 2g: 10% = 20s
    hit(sim, a, b);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);

    expect(ent(sim, b).dead).toBe(true);
    expect(sim.meta(a)!.honor).toBe(WORLD_PVP_KILL_HONOR);
    expect(honorEvents(sim, a)).toEqual([
      { type: 'honor', pid: a, amount: WORLD_PVP_KILL_HONOR, reason: 'world_kill' },
    ]);
    expect(sim.worldPvpInfoFor(a)).toMatchObject({ kills: 1, deaths: 0 });
    expect(sim.worldPvpInfoFor(b)).toMatchObject({ kills: 0, deaths: 1 });
    // The leaver's purse is debited at once; the winner's share waits.
    expect(sim.meta(b)!.copper).toBe(18_000);
    expect(sim.meta(a)!.copper).toBe(0);
    expect(sim.meta(a)!.worldPvp!.pending).toEqual([
      { copper: 2_000, dueAt: sim.time + WORLD_PVP_FORFEIT_PAYOUT_SECONDS, from: 'Bet' },
    ]);
    expect(logLines(sim.events, a)).toContain(worldPvpForfeitKillLine('Bet', 2_000));
    expect(worldPvpForfeitKillLine('Bet', 2_000)).toBe(
      'Bet left the fight and is defeated: 20s from their purse reaches you in 5 minutes.',
    );
    expect(sim.events.some((ev) => ev.type === 'playerDeath' && ev.pid === b)).toBe(true);

    // One second short of the delay: still held.
    advanceClock(sim, WORLD_PVP_FORFEIT_PAYOUT_SECONDS - 1);
    expect(sim.meta(a)!.copper).toBe(0);
    // Then paid exactly once, with its own notice, and the hold is gone.
    (sim as unknown as { time: number }).time += 1;
    const paid = sim.tick();
    expect(sim.meta(a)!.copper).toBe(2_000);
    expect(logLines(paid, a)).toEqual([worldPvpForfeitPayoutLine('Bet', 2_000)]);
    expect(sim.meta(a)!.worldPvp!.pending).toBeUndefined();
    expect(sim.worldPvpBooks.nextPayoutAt).toBe(Number.POSITIVE_INFINITY);
    advanceClock(sim, WORLD_PVP_FORFEIT_PAYOUT_SECONDS);
    expect(sim.meta(a)!.copper).toBe(2_000);
  });

  it('an aggressor who threw every blow and took none still forfeits to the one they hit', () => {
    const { sim, a, b } = fight();
    hit(sim, b, a);
    expect(worldPvpFightOpponent(sim.ctx, ent(sim, b))?.id).toBe(a);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(ent(sim, b).dead).toBe(true);
    expect(sim.meta(a)!.honor).toBe(WORLD_PVP_KILL_HONOR);
  });

  it('the most recent live attacker is the opponent; a fallen one is skipped', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 1);
    const c = addFighter(sim, 'Gimel', 3, 4);
    const b = addFighter(sim, 'Bet', 2, 2);
    for (const pid of [a, b, c]) flag(sim, pid);
    hit(sim, a, b);
    advanceClock(sim, 1);
    hit(sim, c, b);
    expect(worldPvpFightOpponent(sim.ctx, ent(sim, b))?.id).toBe(c);
    ent(sim, c).dead = true;
    expect(worldPvpFightOpponent(sim.ctx, ent(sim, b))?.id).toBe(a);
  });

  it('runs once: a second departure call on the corpse does nothing', () => {
    const { sim, a, b } = fight();
    sim.meta(b)!.copper = 10_000;
    hit(sim, a, b);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
    expect(sim.meta(a)!.honor).toBe(WORLD_PVP_KILL_HONOR);
    expect(sim.meta(a)!.worldPvp!.pending).toHaveLength(1);
    expect(sim.meta(b)!.copper).toBe(9_000);
    expect(sim.worldPvpBooks.forfeitVictim).toBeNull();
  });

  it('keeps the per-pair diminishing returns: a second kill inside the hour pays half', () => {
    const { sim, a, b } = fight();
    sim.meta(b)!.copper = 10_000;
    slay(sim, a, b);
    expect(sim.meta(a)!.honor).toBe(10);
    expect(sim.meta(a)!.copper).toBe(1_000);
    revive(sim, b);
    hit(sim, a, b);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(sim.meta(a)!.honor).toBe(15);
    // 10% of the 9_000 left is 900, halved by the repeat: 450 held, 450 debited.
    expect(sim.meta(b)!.copper).toBe(8_550);
    expect(sim.meta(a)!.worldPvp!.pending).toEqual([
      expect.objectContaining({ copper: 450, from: 'Bet' }),
    ]);
  });

  it('an unflagged leaver on free-for-all ground stakes no gold, but the kill and honor stand', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 1);
    const b = addFighter(sim, 'Bet', 2, 2);
    place(sim, a, FFA);
    place(sim, b, FFA, 2);
    sim.tick();
    sim.meta(b)!.copper = 50_000;
    hit(sim, b, a); // b opens: b is marked, a stays unflagged
    hit(sim, a, b);
    expect(ent(sim, a).pvpFlag).toBeFalsy();
    sim.events = [];
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, a)).toBe(true);
    expect(ent(sim, a).dead).toBe(true);
    expect(sim.meta(b)!.honor).toBe(WORLD_PVP_KILL_HONOR);
    expect(sim.meta(b)!.worldPvp!.pending).toBeUndefined();
    expect(logLines(sim.events, b)).toContain('Aleph left the fight and is defeated.');
  });
});

describe("the leaver's record counts the forfeit as one death", () => {
  it('the death lands at once and is what the leaver saves and reloads with', () => {
    const { sim, a, b } = fight();
    hit(sim, a, b);
    forfeitWorldPvpFightOnDeparture(sim.ctx, b);
    expect(sim.worldPvpInfoFor(b)).toMatchObject({ kills: 0, deaths: 1 });
    expect(sim.worldPvpInfoFor(a)).toMatchObject({ kills: 1, deaths: 0 });
    const saved = sim.serializeCharacter(b)!;
    expect(saved.worldPvp).toMatchObject({ deaths: 1 });
    expect(saved.dead).toBe(true);
    const loaded = world();
    const pid = loaded.addPlayer('warrior', 'Bet', { state: saved, characterId: 1002 });
    expect(loaded.worldPvpInfoFor(pid)).toMatchObject({ deaths: 1 });
  });

  it('counts even when the opponent is owed nothing (the per-pair returns are spent)', () => {
    const { sim, a, b } = fight();
    for (let i = 0; i < 3; i++) {
      slay(sim, a, b);
      revive(sim, b);
      hit(sim, a, b);
    }
    const honorBefore = sim.meta(a)!.honor;
    const killsBefore = sim.worldPvpInfoFor(a)!.kills;
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(3);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(4);
    expect(sim.meta(a)!.honor).toBe(honorBefore);
    expect(sim.worldPvpInfoFor(a)!.kills).toBe(killsBefore);
  });
});

describe('the kill rules hold for a forfeit', () => {
  it('splits the honor and the held gold across every contributor; the blow takes the remainder', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 1);
    const c = addFighter(sim, 'Gimel', 3, 4);
    const b = addFighter(sim, 'Bet', 2, 2);
    for (const pid of [a, b, c]) flag(sim, pid);
    sim.meta(b)!.copper = 30_001; // 10% = 3_000, split 1_500 each
    hit(sim, c, b);
    hit(sim, a, b); // a is the most recent: the killing blow
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(sim.meta(a)!.honor).toBe(5);
    expect(sim.meta(c)!.honor).toBe(5);
    expect(sim.meta(a)!.worldPvp!.pending).toEqual([expect.objectContaining({ copper: 1_500 })]);
    expect(sim.meta(c)!.worldPvp!.pending).toEqual([expect.objectContaining({ copper: 1_500 })]);
    expect(sim.meta(b)!.copper).toBe(27_001);
    expect(sim.worldPvpInfoFor(c)).toMatchObject({ kills: 1 });
  });

  it('a grey leaver pays the opponent nothing, but the death still counts', () => {
    const { sim, a, b } = fight();
    sim.setPlayerLevel(14, b); // six below: grey to a level-20 opponent
    ent(sim, b).hp = ent(sim, b).maxHp;
    sim.meta(b)!.copper = 20_000;
    hit(sim, a, b);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(sim.meta(a)!.honor).toBe(0);
    expect(sim.meta(b)!.copper).toBe(20_000);
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(1);
  });

  it('a revived fighter who has only thrown blows since still forfeits in full (stale paid-death row)', () => {
    const { sim, a, b } = fight();
    slay(sim, a, b);
    revive(sim, b);
    hit(sim, b, a); // b only hits: nothing clears the paid-death row before the sweep
    expect(sim.worldPvpBooks.paidDeaths.has(b)).toBe(true);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(true);
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(2);
    expect(sim.worldPvpInfoFor(a)!.kills).toBe(2);
  });

  it('an opponent already on the way out is no opponent', () => {
    const { sim, a, b } = fight();
    hit(sim, a, b);
    sim.meta(a)!.leaving = true;
    expect(worldPvpFightOpponent(sim.ctx, ent(sim, b))).toBeNull();
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
  });
});

describe('a departure that is not a forfeit', () => {
  it('no blow traded, or the last one older than the assist window: nothing happens', () => {
    const { sim, a, b } = fight();
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
    hit(sim, a, b);
    advanceClock(sim, WORLD_PVP_ASSIST_WINDOW + 1);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
    expect(ent(sim, b).dead).toBe(false);
    expect(sim.meta(a)!.honor).toBe(0);
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(0);
  });

  it('a leaver who reached a sanctuary, or whose opponent already fell, leaves freely', () => {
    const { sim, a, b } = fight();
    hit(sim, a, b);
    place(sim, b, { x: PLAYER_START.x, z: PLAYER_START.z });
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
    expect(ent(sim, b).dead).toBe(false);

    place(sim, b, CONTESTED, 2);
    hit(sim, a, b);
    ent(sim, a).dead = true;
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
    expect(ent(sim, b).dead).toBe(false);
  });

  it('a duel, an unflagged pair on contested ground, and a kill-switched realm are no world fight', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 1);
    const b = addFighter(sim, 'Bet', 2, 2);
    // Unflagged on contested ground: the hit is booked nowhere.
    hit(sim, a, b);
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);

    const off = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: ARENA_FREE_WORLD,
      worldPvpDisabled: true,
    });
    const x = addFighter(off, 'Aleph', 1);
    const y = addFighter(off, 'Bet', 2, 2);
    hit(off, x, y);
    expect(forfeitWorldPvpFightOnDeparture(off.ctx, y)).toBe(false);
    expect(ent(off, y).dead).toBe(false);
  });

  it('an unknown or already dead pid is a no-op', () => {
    const { sim, b } = fight();
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, 999_999)).toBe(false);
    ent(sim, b).dead = true;
    expect(forfeitWorldPvpFightOnDeparture(sim.ctx, b)).toBe(false);
  });
});

describe('held gold persists with the winner', () => {
  it('round-trips the remaining countdown and pays on the new clock', () => {
    const { sim, a, b } = fight();
    sim.meta(b)!.copper = 20_000;
    hit(sim, a, b);
    forfeitWorldPvpFightOnDeparture(sim.ctx, b);
    advanceClock(sim, 100);
    const saved = sim.serializeCharacter(a)!;
    expect(saved.worldPvp?.pending).toEqual([
      {
        copper: 2_000,
        // 100 s plus the one tick advanceClock settles with.
        remaining: expect.closeTo(WORLD_PVP_FORFEIT_PAYOUT_SECONDS - 100 - DT, 6),
        from: 'Bet',
      },
    ]);

    const loaded = world();
    advanceClock(loaded, 50); // a different clock: the countdown re-anchors
    const pid = loaded.addPlayer('warrior', 'Aleph', { state: saved, characterId: 1001 });
    const copperBefore = loaded.meta(pid)!.copper;
    const remaining = saved.worldPvp!.pending![0].remaining;
    expect(loaded.worldPvpBooks.nextPayoutAt).toBeCloseTo(loaded.time + remaining, 6);
    advanceClock(loaded, remaining - 1);
    expect(loaded.meta(pid)!.copper).toBe(copperBefore);
    advanceClock(loaded, 1);
    expect(loaded.meta(pid)!.copper).toBe(copperBefore + 2_000);
    expect(loaded.serializeCharacter(pid)!.worldPvp?.pending).toBeUndefined();
  });

  it('a character with nothing owed writes no pending field', () => {
    const { sim, a, b } = fight();
    slay(sim, a, b);
    expect(sim.serializeCharacter(a)!.worldPvp).toEqual({ flagged: true, kills: 1 });
  });

  it('drops malformed rows and caps the count on load', () => {
    const now = 10;
    expect(loadWorldPvpPayouts('nope', now)).toEqual([]);
    expect(
      loadWorldPvpPayouts(
        [
          { copper: 500, remaining: 30, from: 'Bet' },
          { copper: 0, remaining: 30, from: 'Bet' },
          { copper: 500, remaining: -5, from: 'Bet' },
          { copper: 500, remaining: 30 },
          { copper: Number.NaN, remaining: 30, from: 'Bet' },
          null,
        ],
        now,
      ),
    ).toEqual([
      { copper: 500, dueAt: 40, from: 'Bet' },
      { copper: 500, dueAt: 10, from: 'Bet' },
    ]);
    const many = Array.from({ length: WORLD_PVP_PENDING_PAYOUT_LIMIT + 10 }, () => ({
      copper: 1,
      remaining: 1,
      from: 'Bet',
    }));
    expect(loadWorldPvpPayouts(many, now)).toHaveLength(WORLD_PVP_PENDING_PAYOUT_LIMIT);
  });
});

describe('the client matcher re-localizes the forfeit lines', () => {
  it('English resolves to itself through the worldPvp forfeit keys', () => {
    setLanguage('en');
    for (const line of [
      worldPvpForfeitKillLine('Bet', 0),
      worldPvpForfeitKillLine('Bet', 2_000),
      worldPvpForfeitPayoutLine('Bet', 2_000),
    ]) {
      expect(localizeSimText(line), line).toBe(line);
    }
  });
});

describe('determinism', () => {
  it('two identical runs agree on every purse, honor balance and the rng position', () => {
    const run = () => {
      const { sim, a, b } = fight();
      sim.meta(b)!.copper = 33_333;
      hit(sim, a, b);
      forfeitWorldPvpFightOnDeparture(sim.ctx, b);
      for (let i = 0; i < Math.round((WORLD_PVP_FORFEIT_PAYOUT_SECONDS + 1) / DT); i++) sim.tick();
      return {
        a: [sim.meta(a)!.copper, sim.meta(a)!.honor],
        b: [sim.meta(b)!.copper, sim.meta(b)!.honor],
        rng: sim.rng.next(),
      };
    };
    expect(run()).toEqual(run());
  });
});

// The zone table must still carry the two grounds this suite stands on.
it('stands on contested ground and on free-for-all ground', () => {
  expect(ZONES.some((z) => z.id === 'thornpeak_heights')).toBe(true);
  expect(ZONES.some((z) => z.id === 'drakelands')).toBe(true);
});
