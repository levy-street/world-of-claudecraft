// World PvP bounties (src/sim/pvp/world_pvp_bounty.ts + its pure rules in
// world_pvp_bounty_rules.ts): a FLAGGED player paid for five world kills in a
// row without dying earns a bounty. The realm is told, the holder's entity
// carries the `bounty` display bit (the blood-red name tag), the holder's own
// kills pay on the bounty curve (15, then 10, then 5, then 0 per victim inside
// the hour, against the ordinary 10, 5, 2, 0), and whoever kills the holder
// shares a DOUBLED honor pool. Any death ends the streak and the bounty, and so
// does the flag dropping. Gold never moves on the bounty curve. The kill
// harness (a stripped world, contested ground, the real damage hub) is
// tests/world_pvp.test.ts's.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_KILL_HONOR,
  worldPvpZonePolicyAt,
} from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import {
  noteWorldPvpStreakKill,
  WORLD_PVP_BOUNTY_EARNED_LINE,
  WORLD_PVP_BOUNTY_LAPSED_LINE,
  worldPvpBountyCollectedLine,
  worldPvpBountyPlacedLine,
} from '../src/sim/pvp/world_pvp_bounty';
import {
  WORLD_PVP_BOUNTY_HOLDER_DR,
  WORLD_PVP_BOUNTY_KILL_HONOR_MULT,
  WORLD_PVP_BOUNTY_STREAK,
  worldPvpBountyHolderMultiplier,
  worldPvpKillHonorPool,
  worldPvpStreakEarnsBounty,
} from '../src/sim/pvp/world_pvp_bounty_rules';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const SEED = 7;
const CONTESTED = { x: 60, z: 700 };

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

let nextCharacterId = 1;

function addFighter(sim: Sim, name: string, level = 20): number {
  const pid = sim.addPlayer('warrior', name, {
    autoEquip: true,
    characterId: nextCharacterId++,
  });
  sim.setPlayerLevel(level, pid);
  const e = ent(sim, pid);
  e.hp = e.maxHp;
  e.pos = { x: CONTESTED.x, y: groundHeight(CONTESTED.x, CONTESTED.z, SEED), z: CONTESTED.z };
  e.prevPos = { ...e.pos };
  return pid;
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}

function advanceClock(sim: Sim, seconds: number): void {
  (sim as unknown as { time: number }).time += seconds;
  sim.tick();
}

function flag(sim: Sim, pid: number, on = true): void {
  advanceClock(sim, WORLD_PVP_TOGGLE_COOLDOWN + 1);
  sim.setWorldPvpFlag(on, pid);
}

/** A flagged fighter on contested ground. */
function flaggedFighter(sim: Sim, name: string, level = 20): number {
  const pid = addFighter(sim, name, level);
  flag(sim, pid);
  return pid;
}

function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(
    ent(sim, killerPid),
    victim,
    victim.hp + 1_000,
    false,
    'physical',
    'Mortal Strike',
    'hit',
  );
}

function revive(sim: Sim, pid: number): void {
  const e = ent(sim, pid);
  e.dead = false;
  e.hp = e.maxHp;
}

/** Kill `count` fresh flagged victims (of the killer's level) with `killerPid`. */
function streak(sim: Sim, killerPid: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const victim = flaggedFighter(sim, `Mark${nextCharacterId}`, ent(sim, killerPid).level);
    slay(sim, killerPid, victim);
  }
}

/** One more kill of `victimPid` by `killerPid`; returns what it paid. */
function killAgain(sim: Sim, killerPid: number, victimPid: number) {
  sim.lootCorpse(victimPid, killerPid);
  sim.meta(victimPid)!.copper = 10_000;
  const goldBefore = sim.meta(killerPid)!.copper;
  const honorBefore = sim.meta(killerPid)!.honor;
  revive(sim, victimPid);
  slay(sim, killerPid, victimPid);
  const droppedGold = ent(sim, victimPid).loot?.copper ?? 0;
  return {
    gold: sim.meta(killerPid)!.copper - goldBefore + droppedGold,
    honor: sim.meta(killerPid)!.honor - honorBefore,
  };
}

function realmLines(sim: Sim): string[] {
  return sim.events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log' && ev.pid === undefined,
    )
    .map((ev) => ev.text);
}

function personalLines(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log' && ev.pid === pid)
    .map((ev) => ev.text);
}

describe('the bounty rules', () => {
  it('pins the streak, the doubled pool and the holder curve the owner asked for', () => {
    expect(WORLD_PVP_BOUNTY_STREAK).toBe(5);
    expect(WORLD_PVP_BOUNTY_KILL_HONOR_MULT).toBe(2);
    expect(worldPvpKillHonorPool(false)).toBe(WORLD_PVP_KILL_HONOR);
    expect(worldPvpKillHonorPool(true)).toBe(20);
    expect(WORLD_PVP_BOUNTY_HOLDER_DR).toEqual([1.5, 1, 0.5, 0]);
    // A solo holder out of the 10-honor pool: 15, then 10 (not 5), then 5 (not 2), then 0.
    const paid = [0, 1, 2, 3, 9].map((n) =>
      Math.floor(WORLD_PVP_KILL_HONOR * worldPvpBountyHolderMultiplier(n)),
    );
    expect(paid).toEqual([15, 10, 5, 0, 0]);
    expect(worldPvpBountyHolderMultiplier(-1)).toBe(1.5);
  });

  it('a streak earns the bounty at five and above', () => {
    expect(worldPvpStreakEarnsBounty(4)).toBe(false);
    expect(worldPvpStreakEarnsBounty(5)).toBe(true);
    expect(worldPvpStreakEarnsBounty(6)).toBe(true);
  });
});

describe('earning a bounty', () => {
  it('four paid kills are not enough; the fifth places the bounty and tells the realm once', () => {
    const sim = world();
    const hunter = flaggedFighter(sim, 'Aleph');
    streak(sim, hunter, 4);
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(4);
    expect(sim.meta(hunter)!.worldPvp!.bounty).toBeUndefined();
    expect(ent(sim, hunter).bounty).toBeUndefined();

    sim.events = [];
    streak(sim, hunter, 1);
    expect(sim.meta(hunter)!.worldPvp!.bounty).toBe(true);
    expect(ent(sim, hunter).bounty).toBe(true);
    expect(realmLines(sim)).toContain(worldPvpBountyPlacedLine('Aleph'));
    expect(personalLines(sim, hunter)).toContain(WORLD_PVP_BOUNTY_EARNED_LINE);

    // A sixth kill keeps the bounty standing without announcing it again.
    sim.events = [];
    streak(sim, hunter, 1);
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(6);
    expect(realmLines(sim)).not.toContain(worldPvpBountyPlacedLine('Aleph'));
  });

  it('an assist is a paid kill too: every paid contributor builds a streak', () => {
    const sim = world();
    const blow = flaggedFighter(sim, 'Aleph');
    const helper = flaggedFighter(sim, 'Bet');
    for (let i = 0; i < WORLD_PVP_BOUNTY_STREAK; i++) {
      const victim = flaggedFighter(sim, `Mark${nextCharacterId}`);
      sim.ctx.dealDamage(ent(sim, helper), ent(sim, victim), 5, false, 'physical', 'Slam', 'hit');
      slay(sim, blow, victim);
    }
    expect(sim.meta(helper)!.worldPvp!.bounty).toBe(true);
    expect(ent(sim, helper).bounty).toBe(true);
  });

  it('a fully decayed kill pays nothing and does not count toward the streak', () => {
    const sim = world();
    const hunter = flaggedFighter(sim, 'Aleph');
    const victim = flaggedFighter(sim, 'Bet');
    slay(sim, hunter, victim);
    killAgain(sim, hunter, victim);
    killAgain(sim, hunter, victim);
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(3);
    expect(killAgain(sim, hunter, victim).honor).toBe(0);
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(3);
  });

  it('only a FLAGGED contributor builds a streak', () => {
    const sim = world();
    const pid = addFighter(sim, 'Aleph');
    const meta = sim.meta(pid)!;
    meta.worldPvp = { flagged: false, disarmAt: null, kills: 0, deaths: 0 };
    for (let i = 0; i < WORLD_PVP_BOUNTY_STREAK; i++) {
      noteWorldPvpStreakKill(sim.ctx, ent(sim, pid), meta.worldPvp);
    }
    expect(meta.worldPvp.streak).toBeUndefined();
    expect(meta.worldPvp.bounty).toBeUndefined();
    expect(ent(sim, pid).bounty).toBeUndefined();
  });

  it('a bounty is per player: two hot streaks carry two bounties at once', () => {
    const sim = world();
    const a = flaggedFighter(sim, 'Aleph');
    const b = flaggedFighter(sim, 'Bet');
    streak(sim, a, WORLD_PVP_BOUNTY_STREAK);
    streak(sim, b, WORLD_PVP_BOUNTY_STREAK);
    expect(ent(sim, a).bounty).toBe(true);
    expect(ent(sim, b).bounty).toBe(true);
  });
});

describe("the holder's honor curve", () => {
  it('pays a holder 15, 10, 5, 0 per victim where a non-holder gets 10, 5, 2, 0', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    const plain = flaggedFighter(sim, 'Bet');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    const victimA = flaggedFighter(sim, 'Gimel');
    const victimB = flaggedFighter(sim, 'Dalet');
    revive(sim, victimA);
    const holderPaid = [0, 1, 2, 3].map(() => killAgain(sim, holder, victimA).honor);
    const plainPaid = [0, 1, 2, 3].map(() => killAgain(sim, plain, victimB).honor);
    expect(holderPaid).toEqual([15, 10, 5, 0]);
    expect(plainPaid).toEqual([10, 5, 2, 0]);
  });

  it('never raises the gold a holder takes: the stake stays on the ordinary curve', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    const victim = flaggedFighter(sim, 'Gimel');
    expect(killAgain(sim, holder, victim).gold).toBe(1_000);
    expect(killAgain(sim, holder, victim).gold).toBe(500);
    expect(killAgain(sim, holder, victim).gold).toBe(250);
  });
});

describe('ending a bounty', () => {
  it('killing a holder pays double honor, tells the realm and clears the mark', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    const hunter = flaggedFighter(sim, 'Bet');
    sim.events = [];
    slay(sim, hunter, holder);
    expect(sim.meta(hunter)!.honor).toBe(2 * WORLD_PVP_KILL_HONOR);
    expect(realmLines(sim)).toContain(worldPvpBountyCollectedLine('Bet', 'Aleph'));
    expect(sim.meta(holder)!.worldPvp!.bounty).toBe(false);
    expect(sim.meta(holder)!.worldPvp!.streak).toBe(0);
    expect(ent(sim, holder).bounty).toBe(false);
    // The bounty does not pass to the killer: one kill is one kill of a streak.
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(1);
    expect(ent(sim, hunter).bounty).toBeUndefined();
  });

  it('the doubled pool splits among contributors like the ordinary one', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    const blow = flaggedFighter(sim, 'Bet');
    const helper = flaggedFighter(sim, 'Gimel');
    revive(sim, holder);
    sim.ctx.dealDamage(ent(sim, helper), ent(sim, holder), 5, false, 'physical', 'Slam', 'hit');
    slay(sim, blow, holder);
    expect(sim.meta(blow)!.honor + sim.meta(helper)!.honor).toBe(2 * WORLD_PVP_KILL_HONOR);
    expect(sim.meta(helper)!.honor).toBe(WORLD_PVP_KILL_HONOR);
  });

  it('a death to anything but a player ends it quietly, with a notice to the holder alone', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    sim.events = [];
    sim.ctx.dealDamage(null, ent(sim, holder), 100_000, false, 'physical', 'Falling', 'hit');
    expect(ent(sim, holder).dead).toBe(true);
    expect(ent(sim, holder).bounty).toBe(false);
    expect(sim.meta(holder)!.worldPvp!.streak).toBe(0);
    expect(personalLines(sim, holder)).toContain(WORLD_PVP_BOUNTY_LAPSED_LINE);
    expect(realmLines(sim).some((line) => line.includes('collected the bounty'))).toBe(false);
  });

  it('a death resets a streak short of the bounty too', () => {
    const sim = world();
    const hunter = flaggedFighter(sim, 'Aleph');
    streak(sim, hunter, 4);
    sim.ctx.dealDamage(null, ent(sim, hunter), 100_000, false, 'physical', 'Falling', 'hit');
    revive(sim, hunter);
    streak(sim, hunter, 1);
    expect(sim.meta(hunter)!.worldPvp!.streak).toBe(1);
    expect(ent(sim, hunter).bounty).toBeFalsy();
  });

  it('the flag dropping ends the bounty and the streak', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    ent(sim, holder).inCombat = false;
    flag(sim, holder, false);
    // Jump the clock past the disarm instead of ticking five minutes of sim.
    (sim as unknown as { time: number }).time += WORLD_PVP_DISARM_SECONDS + 1;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      // Out of combat: the engaged pass keeps inCombat up for 5 s after the
      // last blow, and the jump above did not age that timer.
      ent(sim, holder).combatTimer = 100;
      ent(sim, holder).inCombat = false;
      for (const ev of sim.tick()) if (ev.type === 'log' && ev.pid === holder) seen.push(ev.text);
    }
    expect(ent(sim, holder).pvpFlag).toBe(false);
    expect(ent(sim, holder).bounty).toBe(false);
    expect(sim.meta(holder)!.worldPvp!.streak).toBe(0);
    expect(seen).toContain(WORLD_PVP_BOUNTY_LAPSED_LINE);
  });
});

describe('who collects, and what counts', () => {
  it('a kill that pays nobody collects nothing: the bounty lapses quietly', () => {
    const sim = world();
    // A level-12 holder is grey to a level-20 killer (gap 8 > 5): the blow pays
    // nothing, so nobody collected the bounty and the realm hears nothing.
    const holder = flaggedFighter(sim, 'Aleph', 12);
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    expect(ent(sim, holder).bounty).toBe(true);
    const capped = flaggedFighter(sim, 'Bet');
    sim.events = [];
    slay(sim, capped, holder);
    expect(sim.meta(capped)!.honor).toBe(0);
    expect(ent(sim, holder).bounty).toBe(false);
    expect(realmLines(sim).some((line) => line.includes('collected the bounty'))).toBe(false);
    expect(personalLines(sim, holder)).toContain(WORLD_PVP_BOUNTY_LAPSED_LINE);
  });

  it('a holder who kills a holder takes the doubled pool on the holder curve', () => {
    const sim = world();
    const a = flaggedFighter(sim, 'Aleph');
    const b = flaggedFighter(sim, 'Bet');
    streak(sim, a, WORLD_PVP_BOUNTY_STREAK);
    streak(sim, b, WORLD_PVP_BOUNTY_STREAK);
    const before = sim.meta(a)!.honor;
    slay(sim, a, b);
    // floor(20 * 1.5): the two rules compound by design.
    expect(sim.meta(a)!.honor - before).toBe(30);
  });

  it('an assist whose share floors to nothing does not build a streak', () => {
    const sim = world();
    // Eleven contributors split a 10-honor pool: each assist's share floors to
    // zero, and a victim with an empty purse stakes no gold.
    const blow = flaggedFighter(sim, 'Aleph');
    const helpers = Array.from({ length: 10 }, (_, i) => flaggedFighter(sim, `Help${i}`));
    const victim = flaggedFighter(sim, 'Gimel');
    sim.meta(victim)!.copper = 0;
    for (const h of helpers) {
      sim.ctx.dealDamage(ent(sim, h), ent(sim, victim), 1, false, 'physical', 'Slam', 'hit');
    }
    slay(sim, blow, victim);
    for (const h of helpers) {
      expect(sim.meta(h)!.honor).toBe(0);
      expect(sim.meta(h)!.worldPvp!.streak ?? 0).toBe(0);
    }
    expect(sim.meta(blow)!.worldPvp!.streak).toBe(1);
  });

  it('an assist credited after the helper died does not restart their streak', () => {
    const sim = world();
    const blow = flaggedFighter(sim, 'Aleph');
    const helper = flaggedFighter(sim, 'Bet');
    streak(sim, helper, 3);
    const victim = flaggedFighter(sim, 'Gimel');
    sim.ctx.dealDamage(ent(sim, helper), ent(sim, victim), 5, false, 'physical', 'Slam', 'hit');
    sim.ctx.dealDamage(null, ent(sim, helper), 100_000, false, 'physical', 'Falling', 'hit');
    expect(ent(sim, helper).dead).toBe(true);
    slay(sim, blow, victim);
    expect(sim.meta(helper)!.honor).toBeGreaterThan(0); // the assist still pays
    expect(sim.meta(helper)!.worldPvp!.streak).toBe(0);
  });
});

describe('persistence', () => {
  it('the streak and the bounty are session-only: the save carries neither', () => {
    const sim = world();
    const holder = flaggedFighter(sim, 'Aleph');
    streak(sim, holder, WORLD_PVP_BOUNTY_STREAK);
    const saved = sim.serializeCharacter(holder)!;
    expect(saved.worldPvp).toEqual({
      flagged: true,
      kills: WORLD_PVP_BOUNTY_STREAK,
      rewardTicks: 5,
    });
    expect(JSON.stringify(saved)).not.toContain('bounty');
    expect(JSON.stringify(saved)).not.toContain('streak');
  });
});

describe('sim_i18n matcher: the bounty lines round-trip', () => {
  it('re-localizes every bounty line (English resolves to itself)', () => {
    setLanguage('en');
    const lines = [
      WORLD_PVP_BOUNTY_EARNED_LINE,
      WORLD_PVP_BOUNTY_LAPSED_LINE,
      worldPvpBountyPlacedLine('Aleph'),
      worldPvpBountyCollectedLine('Bet', 'Aleph'),
    ];
    for (const line of lines) expect(localizeSimText(line), line).toBe(line);
  });

  it('splices the player names through verbatim', () => {
    setLanguage('en');
    expect(localizeSimText(worldPvpBountyPlacedLine('Zayin'))).toContain('Zayin');
    const collected = localizeSimText(worldPvpBountyCollectedLine('Bet', 'Aleph'));
    expect(collected).toBe('Bet has collected the bounty on Aleph.');
  });
});

describe('determinism', () => {
  it('the same kills on two worlds earn the same bounties', () => {
    const run = () => {
      nextCharacterId = 500;
      const sim = world();
      const a = flaggedFighter(sim, 'Aleph');
      streak(sim, a, WORLD_PVP_BOUNTY_STREAK);
      const b = flaggedFighter(sim, 'Bet');
      slay(sim, b, a);
      return [sim.meta(a)!.honor, sim.meta(b)!.honor, ent(sim, a).bounty, ent(sim, b).bounty];
    };
    expect(run()).toEqual(run());
  });
});

// The contested spot must sit on ground that is neither a sanctuary nor
// free-for-all, or every assertion above is moot.
describe('the harness ground', () => {
  it('stands every fighter on contested ground', () => {
    expect(worldPvpZonePolicyAt(CONTESTED.x, CONTESTED.z)).toBe('contested');
  });
});
