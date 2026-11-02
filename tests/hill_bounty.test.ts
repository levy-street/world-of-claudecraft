// King of the Hill bounties (src/sim/pvp/hill_bounty.ts + hill_bounty_rules.ts):
// the League-style tables, the payout and streaks over a real risen hill, the
// hill's repeat cap against the world's hourly decay, the announcer on the
// readout, the badge and its teardown, the wire bits, and the HUD cores.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { writeEntityPresenceBits } from '../server/entity_presence_wire';
import { wireEntity } from '../server/game';
import { applyEntityPresenceBits } from '../src/net/entity_presence_wire';
import { BUILTIN_WORLD, PLAYER_START } from '../src/sim/data';
import {
  endHillNow,
  HILL_BOUNTY_REPEAT_CAP,
  HILL_CALLOUT_SECONDS,
  hillBountyHonor,
  hillRepeatHonorMultiplier,
  hillStreakCallout,
  spawnHillNow,
} from '../src/sim/pvp';
import { noteWorldPvpStreakKill } from '../src/sim/pvp/world_pvp_bounty';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { hillBountyTagLabel } from '../src/ui/hill_bounty_tag';
import { buildHillBarView, hillCalloutText, hillCalloutToShow } from '../src/ui/hud/hill';
import { fillTargetFrameDescriptor } from '../src/ui/target_frame_descriptor';
import type { UnitFrameDescriptor } from '../src/ui/unit_frame';
import type { HillCalloutInfo, HillInfo } from '../src/world_api';

const SEED = 7;
const ARENA_FREE_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

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
  return sim.entities.get(pid) as Entity;
}

function place(sim: Sim, pid: number, x: number, z: number): void {
  const e = ent(sim, pid);
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

/** A risen hill in the Drakelands with `names` standing inside it, flagged by the circle. */
function join(sim: Sim, name: string, characterId: number): number {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true, characterId });
  sim.setPlayerLevel(20, pid);
  return pid;
}

function hillFight(names: string[]): { sim: Sim; pids: number[] } {
  const sim = world();
  const pids = names.map((name, i) => join(sim, name, 2000 + i));
  const hill = spawnHillNow(sim.ctx, 'drakelands');
  expect(hill?.phase).toBe('active');
  for (const [i, pid] of pids.entries()) place(sim, pid, (hill?.x ?? 0) + i * 3, hill?.z ?? 0);
  tickSeconds(sim, 1);
  for (const pid of pids) expect(ent(sim, pid).pvpFlag, 'the circle flags').toBe(true);
  return { sim, pids };
}

/** Stand the victim back up, land a live hit (clears the paid-death guard), then kill. */
function kill(sim: Sim, killer: number, victim: number): number {
  const v = ent(sim, victim);
  v.dead = false;
  v.hp = v.maxHp;
  const before = sim.meta(killer)?.honor ?? 0;
  sim.ctx.dealDamage(ent(sim, killer), v, 5, false, 'physical', 'Slam', 'hit');
  sim.ctx.dealDamage(ent(sim, killer), v, v.hp + 1_000, false, 'physical', 'Strike', 'hit');
  expect(v.dead).toBe(true);
  return (sim.meta(killer)?.honor ?? 0) - before;
}

describe('the bounty tables (League of Legends, scaled to 10 Honor)', () => {
  it('pays more for a kill streak and less for a death streak', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => hillBountyHonor(k, 0))).toEqual([
      10, 10, 15, 20, 23, 27, 30, 33, 33, 33,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) => hillBountyHonor(0, d))).toEqual([
      10, 10, 9, 7, 6, 5, 3, 3, 3,
    ]);
    // A running kill streak decides even against a stale death count.
    expect(hillBountyHonor(3, 4)).toBe(20);
  });

  it('pays full Honor for the first five kills of a pair, then nothing', () => {
    expect(HILL_BOUNTY_REPEAT_CAP).toBe(5);
    expect([0, 1, 2, 3, 4, 5, 6].map(hillRepeatHonorMultiplier)).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });

  it('calls each streak from three kills on, Legendary from eight', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(hillStreakCallout)).toEqual([
      null,
      null,
      null,
      'killingSpree',
      'rampage',
      'unstoppable',
      'dominating',
      'godlike',
      'legendary',
      'legendary',
    ]);
  });
});

describe('hill kills in the Sim', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'a victim world bounty doubles the hill bounty with killer=%s victim=%s',
    (killerBounty, victimBounty) => {
      const {
        sim,
        pids: [a, b, c],
      } = hillFight(['Aleph', 'Bet', 'Gimel']);
      for (let i = 0; i < 3; i++) kill(sim, b, c);
      expect(ent(sim, b).hillBounty).toBe(20);
      for (const [pid, enabled] of [
        [a, killerBounty],
        [b, victimBounty],
      ] as const) {
        if (enabled)
          for (let i = 0; i < 5; i++)
            noteWorldPvpStreakKill(sim.ctx, ent(sim, pid), sim.meta(pid)!.worldPvp!);
      }
      expect(ent(sim, a).bounty === true).toBe(killerBounty);
      expect(ent(sim, b).bounty === true).toBe(victimBounty);
      expect(kill(sim, a, b)).toBe(victimBounty ? 40 : 20);
      expect(ent(sim, b).bounty).toBeFalsy();
      expect(ent(sim, b).hillBounty).toBeUndefined();
    },
  );

  it('keeps the ordinary 10/5/2 repeat curve off the hill without a world bounty', () => {
    const {
      sim,
      pids: [a, b],
    } = hillFight(['Aleph', 'Bet']);
    const hill = sim.hillState.active!;
    place(sim, a, hill.x + hill.radius + 20, hill.z);
    place(sim, b, hill.x + hill.radius + 23, hill.z);
    expect([kill(sim, a, b), kill(sim, a, b), kill(sim, a, b)]).toEqual([10, 5, 2]);
  });
  it('pays the victim bounty, builds a streak, badges it, and a shut down pays it out', () => {
    const {
      sim,
      pids: [a, b, c],
    } = hillFight(['Aleph', 'Bet', 'Gimel']);
    // Bet dies three times: worth 10, 10 (one death), then 9 (two deaths).
    expect(kill(sim, a, b)).toBe(10);
    expect(ent(sim, a).hillBounty, 'one kill is no streak yet').toBeUndefined();
    expect(kill(sim, a, b)).toBe(10);
    expect(ent(sim, a).hillBounty).toBe(15);
    expect(kill(sim, a, b)).toBe(9);
    expect(ent(sim, a).hillBounty).toBe(20);
    expect(ent(sim, b).hillBounty, 'a death streak is never advertised').toBeUndefined();
    expect(sim.hillInfoFor(c)?.callout).toMatchObject({
      kind: 'killingSpree',
      killer: 'Aleph',
      victim: '',
      streak: 3,
    });
    // Gimel ends the spree and collects Aleph's 20.
    expect(kill(sim, c, a)).toBe(20);
    expect(ent(sim, a).hillBounty, 'the shut down clears the badge').toBeUndefined();
    expect(sim.hillInfoFor(b)?.callout).toMatchObject({
      kind: 'shutDown',
      killer: 'Gimel',
      victim: 'Aleph',
      streak: 3,
    });
  });

  it('caps one pair at five full-Honor kills per hill, where the open world decays by the hour', () => {
    const {
      sim,
      pids: [a, b],
    } = hillFight(['Aleph', 'Bet']);
    const paid = Array.from({ length: HILL_BOUNTY_REPEAT_CAP + 1 }, () => kill(sim, a, b));
    // Bet's own death streak lowers the price; the sixth kill of the pair pays nothing.
    expect(paid).toEqual([10, 10, 9, 7, 6, 0]);

    // Five hill kills also earn a world bounty: off-hill payouts use its 15/10/5 curve.
    const hill = sim.hillState.active as { x: number; z: number; radius: number };
    place(sim, a, hill.x + hill.radius + 20, hill.z);
    place(sim, b, hill.x + hill.radius + 23, hill.z);
    sim.worldPvpBooks.killsByPair.clear();
    expect([kill(sim, a, b), kill(sim, a, b), kill(sim, a, b)]).toEqual([15, 10, 5]);
  });

  it('shows the latest call to everyone in the zone for a few seconds only', () => {
    const {
      sim,
      pids: [a, b, watcher],
    } = hillFight(['Aleph', 'Bet', 'Watcher']);
    for (let i = 0; i < 3; i++) kill(sim, a, b);
    const id = sim.hillInfoFor(watcher)?.callout?.id;
    expect(id).toBeTruthy();
    expect(sim.hillInfoFor(a)?.callout?.id, 'the same call for every viewer').toBe(id);
    tickSeconds(sim, HILL_CALLOUT_SECONDS + 1);
    expect(sim.hillInfoFor(watcher)?.callout).toBeNull();
  });

  it('splits gold only between gold earners: a helper decayed out of the stake still takes the bounty', () => {
    const {
      sim,
      pids: [a, helper, b],
    } = hillFight(['Aleph', 'Helper', 'Bet']);
    const victim = sim.meta(b) as { copper: number; honor: number };
    // Helper already took this victim three times this hour: the gold decay is spent.
    sim.worldPvpBooks.killsByPair.set('character:2001>character:2002', {
      count: 3,
      since: sim.time,
    });
    victim.copper = 10_000;
    const goldBefore = [sim.meta(a)?.copper ?? 0, sim.meta(helper)?.copper ?? 0];
    const honorBefore = [sim.meta(a)?.honor ?? 0, sim.meta(helper)?.honor ?? 0];
    const v = ent(sim, b);
    sim.ctx.dealDamage(ent(sim, helper), v, 5, false, 'physical', 'Slam', 'hit');
    sim.ctx.dealDamage(ent(sim, a), v, v.hp + 1_000, false, 'physical', 'Strike', 'hit');
    expect(sim.meta(a)?.copper).toBe(goldBefore[0]);
    expect(v.loot?.copper).toBe(10_000 - victim.copper);
    expect(v.loot?.copper).toBeGreaterThan(0);
    place(sim, a, v.pos.x, v.pos.z);
    expect(sim.lootCorpse(b, a)).toBe(true);
    const gold = [
      (sim.meta(a)?.copper ?? 0) - goldBefore[0],
      (sim.meta(helper)?.copper ?? 0) - goldBefore[1],
    ];
    const honor = [
      (sim.meta(a)?.honor ?? 0) - honorBefore[0],
      (sim.meta(helper)?.honor ?? 0) - honorBefore[1],
    ];
    expect(gold[1], 'the decayed helper takes no gold').toBe(0);
    expect(gold[0], 'the killer takes the whole stake, not a two-way share').toBe(
      10_000 - victim.copper,
    );
    expect(gold[0]).toBeGreaterThan(0);
    expect(honor, 'both earn the 10 Honor bounty, five each').toEqual([5, 5]);
    const lines = sim.events
      .filter((ev) => ev.type === 'log' && ev.pid === a)
      .map((ev) => (ev as { text: string }).text);
    expect(
      lines.some((l) => l === "Loot Bet's body to claim your spoils."),
      'the killer was directed to collect the purse',
    ).toBe(true);
    expect(
      lines.some((l) => l.includes('split')),
      'the purse was not split with the decayed helper',
    ).toBe(false);
    expect(
      sim.worldPvpBooks.killsByPair.get('character:2001>character:2002')?.count,
      'the spent decay does not climb further',
    ).toBe(3);
  });

  it('survives a relog: the streak, the bounty and the repeat cap follow the character', () => {
    const {
      sim,
      pids: [a, b, c],
    } = hillFight(['Aleph', 'Bet', 'Gimel']);
    for (let i = 0; i < 3; i++) kill(sim, a, b);
    expect(ent(sim, a).hillBounty).toBe(20);
    // Aleph relogs: a new entity id for the same character.
    const hill = sim.hillState.active as { x: number; z: number };
    sim.removePlayer(a);
    const back = join(sim, 'Aleph', 2000);
    expect(back).not.toBe(a);
    place(sim, back, hill.x, hill.z);
    tickSeconds(sim, 1);
    expect(ent(sim, back).hillBounty, 'the badge comes back with the character').toBe(20);
    expect(kill(sim, c, back), 'and the bounty still pays').toBe(20);
  });

  it('shows the badge only in the hill zone, and brings it back on return', () => {
    const {
      sim,
      pids: [a, b],
    } = hillFight(['Aleph', 'Bet']);
    kill(sim, a, b);
    kill(sim, a, b);
    expect(ent(sim, a).hillBounty).toBe(15);
    const hill = sim.hillState.active as { x: number; z: number };
    place(sim, a, PLAYER_START.x, PLAYER_START.z);
    tickSeconds(sim, 1);
    expect(ent(sim, a).hillBounty, 'away from the hill').toBeUndefined();
    place(sim, a, hill.x, hill.z);
    tickSeconds(sim, 1);
    expect(ent(sim, a).hillBounty).toBe(15);
  });

  it('ends a kill streak on any death while the hill stands, not only a hill kill', () => {
    const {
      sim,
      pids: [a, b, c],
    } = hillFight(['Aleph', 'Bet', 'Gimel']);
    for (let i = 0; i < 3; i++) kill(sim, a, b);
    expect(ent(sim, a).hillBounty).toBe(20);
    // A fall, with no player in it: the streak and its bounty are gone.
    const A = ent(sim, a);
    sim.ctx.dealDamage(null, A, A.hp + 1_000, false, 'physical', 'Fall', 'hit');
    expect(A.dead).toBe(true);
    expect(A.hillBounty).toBeUndefined();
    // So the next kill starts a fresh streak: no Legendary, no bounty yet.
    A.dead = false;
    A.hp = A.maxHp;
    tickSeconds(sim, HILL_CALLOUT_SECONDS + 1);
    kill(sim, a, b);
    expect(ent(sim, a).hillBounty).toBeUndefined();
    expect(sim.hillInfoFor(c)?.callout ?? null).toBeNull();

    // A hostile kill away from the circle ends it the same way. (Gimel this
    // time: a sixth kill of Bet would be past the pair cap and build nothing.)
    for (let i = 0; i < 2; i++) kill(sim, a, c);
    expect(ent(sim, a).hillBounty).toBe(20);
    place(sim, a, PLAYER_START.x, PLAYER_START.z);
    place(sim, c, PLAYER_START.x + 3, PLAYER_START.z);
    tickSeconds(sim, 1);
    kill(sim, c, a);
    const hill = sim.hillState.active as { x: number; z: number };
    place(sim, a, hill.x, hill.z);
    tickSeconds(sim, 1);
    expect(ent(sim, a).hillBounty, 'no streak survives the death').toBeUndefined();
  });

  it('never reuses a callout id when the same window raises a new hill', () => {
    const {
      sim,
      pids: [a, b, watcher],
    } = hillFight(['Aleph', 'Bet', 'Watcher']);
    for (let i = 0; i < 3; i++) kill(sim, a, b);
    const first = sim.hillInfoFor(watcher)?.callout?.id;
    endHillNow(sim.ctx);
    const again = spawnHillNow(sim.ctx, 'drakelands') as { x: number; z: number };
    for (const [i, pid] of [a, b, watcher].entries()) place(sim, pid, again.x + i * 3, again.z);
    tickSeconds(sim, 1);
    for (let i = 0; i < 3; i++) kill(sim, a, b);
    const second = sim.hillInfoFor(watcher)?.callout?.id;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('takes every badge down when the hill ends', () => {
    const {
      sim,
      pids: [a, b],
    } = hillFight(['Aleph', 'Bet']);
    kill(sim, a, b);
    kill(sim, a, b);
    expect(ent(sim, a).hillBounty).toBe(15);
    endHillNow(sim.ctx);
    expect(ent(sim, a).hillBounty).toBeUndefined();
  });
});

describe('the bounty on the wire and in the HUD', () => {
  it('ships the bounty bit only while set, and the decode clears it when absent', () => {
    const out: Record<string, unknown> = {};
    writeEntityPresenceBits(out, { hillBounty: 23 } as Entity);
    expect(out).toEqual({ hbn: 23 });
    const quiet: Record<string, unknown> = {};
    writeEntityPresenceBits(quiet, {} as Entity);
    expect(quiet).toEqual({});
    const e = {} as Entity;
    applyEntityPresenceBits(e, { hbn: 23, pvp: 1 });
    expect(e.hillBounty).toBe(23);
    expect(e.pvpFlag).toBe(true);
    applyEntityPresenceBits(e, {});
    expect(e.hillBounty).toBeUndefined();
  });

  it('never collides with the $WOC holder balance on the composed entity record', () => {
    const sim = world();
    const pid = join(sim, 'Holder', 3000);
    const e = ent(sim, pid);
    e.holderBalance = 500;
    const balanceOnly = wireEntity(e);
    const decoded = {} as Entity;
    applyEntityPresenceBits(decoded, balanceOnly);
    expect(decoded.hillBounty, 'a holder with no bounty shows no bounty').toBeUndefined();
    e.hillBounty = 23;
    const both = wireEntity(e) as { hb?: number; hbn?: number };
    expect(both.hbn).toBe(23);
    expect(both.hb, 'the balance keeps its own key').toBe(500);
  });

  it('tags a bountied player on the nameplate helper and the target frame, never a mob', () => {
    expect(hillBountyTagLabel({ kind: 'player', hillBounty: 23 })).toBe('<Bounty 23>');
    expect(hillBountyTagLabel({ kind: 'player' })).toBe('');
    expect(hillBountyTagLabel({ kind: 'mob', hillBounty: 23 })).toBe('');
    const target = {
      kind: 'player',
      name: 'Aleph',
      hp: 10,
      maxHp: 10,
      resource: 0,
      maxResource: 0,
      level: 20,
      hillBounty: 27,
      auras: [],
    } as unknown as Entity;
    const d = fillTargetFrameDescriptor(
      {} as UnitFrameDescriptor,
      target,
      { pre: '', post: '' },
      null,
    );
    expect(d.name).toBe('<Bounty 27> Aleph');
  });

  it('announces each call exactly once, with the announcer line', () => {
    const call: HillCalloutInfo = {
      id: '3.1',
      kind: 'rampage',
      killer: 'Aleph',
      victim: '',
      streak: 4,
    };
    const info = {
      zoneId: 'drakelands',
      x: 0,
      z: 0,
      radius: 50,
      phase: 'active',
      minutesLeft: 10,
      standing: 'counted',
      inZone: true,
      inside: false,
      holder: 'none',
      holderCount: 0,
      yourCount: 0,
      challenger: 'none',
      challengerCount: 0,
      contest: 0,
      callout: call,
    } as HillInfo;
    const view = buildHillBarView(info, { x: 100, z: 0 });
    expect(hillCalloutToShow(null, view)).toBe(call);
    expect(hillCalloutToShow('3.1', view), 'already shown').toBeNull();
    expect(hillCalloutToShow(null, buildHillBarView({ ...info, inZone: false }, null))).toBeNull();
    expect(hillCalloutText(call)).toBe('Aleph is on a Rampage!');
    expect(
      hillCalloutText({ ...call, kind: 'shutDown', killer: 'Gimel', victim: 'Aleph', streak: 4 }),
    ).toBe('Gimel has shut down Aleph!');
  });
});
