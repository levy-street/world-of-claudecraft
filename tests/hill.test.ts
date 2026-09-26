// King of the Hill (src/sim/pvp/hill.ts): the three-hour schedule (a random
// warning inside each window, the rise fifteen minutes on, the fall 45 minutes
// after) and its realm announcements, the spot (dry, open, clear of the hub,
// wholly inside a free-for-all zone, the same on every host, drawn from a
// private rng, a retry searching new ground), the contest (a party as one
// group, raids not counted, any level counted, the strict majority, the
// tie, the lapse, the dead), the capture notices, the Honor trickle (a minute
// of presence pays one, only inside, only holders, a bank kept across a step
// out), the readout from each viewer's seat, the /hill and /dev hill arms, and
// the kill switch.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, ZONES, zoneContaining } from '../src/sim/data';
import {
  HILL_ACCRUAL_SECONDS,
  HILL_CAPTURE_SECONDS,
  HILL_DURATION_SECONDS,
  HILL_FIRST_WINDOW_AT_SECONDS,
  HILL_LATEST_WARN_OFFSET_SECONDS,
  HILL_LOST_LINE,
  HILL_RADIUS,
  HILL_RAMP_MAX_HONOR,
  HILL_RAMP_STEP_HONOR,
  HILL_TAKEN_LINE,
  HILL_WARNING_SECONDS,
  HILL_WINDOW_SECONDS,
  hillContains,
  hillFallenLine,
  hillPlanFor,
  hillRiseLine,
  hillWarningLine,
  spawnHill,
  spawnHillNow,
} from '../src/sim/pvp';
import { HILL_READOUT_NONE_LINE, pickHillSpot } from '../src/sim/pvp/hill';
import { HILL_DEV_USAGE, parseHillDevCommand } from '../src/sim/pvp/hill_dev';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { Entity, SimConfig, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight, isInWaterBody } from '../src/sim/world';

const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const SEED = 7;
const FFA_IDS = ['drakelands', 'frostveil', 'amberfall'];

function world(extra: Partial<SimConfig> = {}): Sim {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: ARENA_FREE_WORLD,
    ...extra,
  });
  sim.resetDay = '2026-07-08';
  return sim;
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}

function addPlayer(sim: Sim, name: string, level = 20): number {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true, characterId: 1000 + pid0(sim) });
  sim.setPlayerLevel(level, pid);
  const e = ent(sim, pid);
  e.hp = e.maxHp;
  return pid;
}
function pid0(sim: Sim): number {
  return sim.players.size;
}

function place(sim: Sim, pid: number, x: number, z: number): void {
  const e = ent(sim, pid);
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

/** Stand a player inside the hill (offset from the centre) or just outside it. */
function inside(sim: Sim, pid: number, dx = 0, dz = 0): void {
  const hill = sim.hillState.active!;
  place(sim, pid, hill.x + dx, hill.z + dz);
}
function outside(sim: Sim, pid: number): void {
  const hill = sim.hillState.active!;
  place(sim, pid, hill.x + hill.radius + 5, hill.z);
}

function tickSeconds(sim: Sim, seconds: number): SimEvent[] {
  const seen: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) seen.push(...sim.tick());
  return seen;
}

function logLines(events: SimEvent[], pid?: number): string[] {
  return events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
    .filter((ev) => (pid === undefined ? ev.pid === undefined : ev.pid === pid))
    .map((ev) => ev.text);
}

function honorEvents(events: SimEvent[], pid: number) {
  return events.filter(
    (ev): ev is Extract<SimEvent, { type: 'honor' }> => ev.type === 'honor' && ev.pid === pid,
  );
}

function jumpTo(sim: Sim, time: number): void {
  (sim as unknown as { time: number }).time = time;
}

/** A sim with a hill standing and the fighters placed inside on contested-free
 *  ground: the hill is in a free-for-all zone, so everyone is hostile already. */
function hillWorld(names: string[]): { sim: Sim; pids: number[] } {
  const sim = world();
  const pids = names.map((n) => addPlayer(sim, n));
  expect(spawnHillNow(sim.ctx, 'drakelands')).not.toBeNull();
  // Stand everyone outside first (the presence pass runs on the tick boundary).
  for (const pid of pids) outside(sim, pid);
  sim.tick();
  sim.events = [];
  return { sim, pids };
}

describe('the schedule and the announcements', () => {
  it('warns the realm at a random moment in the window, rises 15 minutes on, falls 45 after', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const plan = hillPlanFor(sim.ctx, 0);
    const windowStart = HILL_FIRST_WINDOW_AT_SECONDS;
    expect(plan.warnAt).toBeGreaterThanOrEqual(windowStart);
    expect(plan.warnAt).toBeLessThanOrEqual(windowStart + HILL_LATEST_WARN_OFFSET_SECONDS);
    expect(plan.risesAt - plan.warnAt).toBe(HILL_WARNING_SECONDS);
    expect(plan.closesAt - plan.risesAt).toBe(HILL_DURATION_SECONDS);
    expect(plan.closesAt).toBeLessThanOrEqual(windowStart + HILL_WINDOW_SECONDS);
    // Nothing before the warning.
    jumpTo(sim, plan.warnAt - 2);
    tickSeconds(sim, 1);
    expect(sim.hillState.active).toBeNull();
    expect(sim.hillInfoFor(a)).toBeNull();
    // The warning names the zone and the minutes, and marks the ground.
    let seen = tickSeconds(sim, 2);
    const hill = sim.hillState.active!;
    expect(hill.phase).toBe('warning');
    expect(FFA_IDS).toContain(hill.zoneId);
    expect(hill.radius).toBe(HILL_RADIUS);
    const zone = ZONES.find((z) => z.id === hill.zoneId)!;
    expect(logLines(seen)).toContain(hillWarningLine(zone.name, 15));
    expect(sim.hillInfoFor(a)).toMatchObject({
      zoneId: hill.zoneId,
      phase: 'warning',
      holder: 'none',
      minutesLeft: 15,
    });
    // The rise.
    jumpTo(sim, plan.risesAt - 1);
    seen = tickSeconds(sim, 2);
    expect(hill.phase).toBe('active');
    expect(logLines(seen)).toContain(hillRiseLine(zone.name));
    expect(sim.hillInfoFor(a)).toMatchObject({ phase: 'active', minutesLeft: 45 });
    // The fall.
    jumpTo(sim, plan.closesAt - 1);
    seen = tickSeconds(sim, 2);
    expect(sim.hillState.active).toBeNull();
    expect(logLines(seen)).toContain(hillFallenLine(zone.name));
    expect(sim.hillInfoFor(a)).toBeNull();
  });

  it('nobody can contest the hill while it is only announced', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const hill = spawnHillNow(sim.ctx, 'drakelands', { warn: true })!;
    expect(hill.phase).toBe('warning');
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 5);
    expect(hill.holder).toBeNull();
    expect(hill.counts.size).toBe(0);
    expect(sim.hillInfoFor(a)).toMatchObject({ phase: 'warning', inside: false, contest: 0 });
  });

  it('one hill per window, at a different time each window, and none on a switched-off realm', () => {
    const sim = world();
    const offsets = new Set<number>();
    for (let w = 0; w < 6; w++) {
      const plan = hillPlanFor(sim.ctx, w);
      const windowStart = HILL_FIRST_WINDOW_AT_SECONDS + w * HILL_WINDOW_SECONDS;
      offsets.add(plan.warnAt - windowStart);
      expect(plan.closesAt).toBeLessThanOrEqual(windowStart + HILL_WINDOW_SECONDS);
    }
    expect(offsets.size).toBeGreaterThan(1);
    const first = hillPlanFor(sim.ctx, 0);
    jumpTo(sim, first.warnAt);
    tickSeconds(sim, 1);
    expect(sim.hillState.active?.ordinal).toBe(0);
    jumpTo(sim, first.closesAt);
    tickSeconds(sim, 2);
    expect(sim.hillState.active).toBeNull();
    // Still window 0's time: the next hill waits for window 1's own warning.
    expect(sim.hillState.window).toBe(1);
    const second = hillPlanFor(sim.ctx, 1);
    jumpTo(sim, second.warnAt);
    tickSeconds(sim, 1);
    expect(sim.hillState.active?.ordinal).toBe(1);
    const closed = world({ worldPvpDisabled: true });
    jumpTo(closed, hillPlanFor(closed.ctx, 0).warnAt + 10);
    tickSeconds(closed, 2);
    expect(closed.hillState.active).toBeNull();
  });

  it('a realm that slept through windows plans the current one, and a late hill keeps its full warning', () => {
    const sim = world();
    const plan = hillPlanFor(sim.ctx, 3);
    jumpTo(sim, plan.risesAt + 5);
    const seen = tickSeconds(sim, 1);
    const hill = sim.hillState.active!;
    expect(hill.ordinal).toBe(3);
    // Found after its planned rise: it slides whole instead of rising unannounced.
    expect(hill.phase).toBe('warning');
    expect(hill.risesAt - hill.warnAt).toBe(HILL_WARNING_SECONDS);
    expect(hill.closesAt - hill.risesAt).toBe(HILL_DURATION_SECONDS);
    const zone = ZONES.find((z) => z.id === hill.zoneId)!;
    expect(logLines(seen)).toContain(hillWarningLine(zone.name, 15));
    expect(sim.hillState.window).toBe(4);
  });

  it('a /dev hill standing past the planned warning delays the real one, never shortens it', () => {
    const sim = world();
    const plan = hillPlanFor(sim.ctx, 0);
    jumpTo(sim, plan.warnAt - 60);
    spawnHillNow(sim.ctx, 'amberfall');
    const devClose = sim.hillState.active!.closesAt;
    expect(devClose).toBeGreaterThan(plan.risesAt);
    // While the dev hill stands, the planned warning waits.
    jumpTo(sim, plan.risesAt + 5);
    tickSeconds(sim, 1);
    expect(sim.hillState.active!.closesAt).toBe(devClose);
    // It falls, and the next pass warns of the real hill in full.
    jumpTo(sim, devClose - 1);
    const seen = tickSeconds(sim, 3);
    expect(logLines(seen)).toContain(hillFallenLine('The Amberfall'));
    const hill = sim.hillState.active!;
    expect(hill.warnAt).toBeGreaterThanOrEqual(devClose);
    expect(hill.ordinal).toBe(0);
    expect(hill.phase).toBe('warning');
    expect(hill.risesAt - hill.warnAt).toBe(HILL_WARNING_SECONDS);
    const zone = ZONES.find((z) => z.id === hill.zoneId)!;
    expect(logLines(seen)).toContain(hillWarningLine(zone.name, 15));
  });

  it('a failed spot retries a minute on with new ground, and the retried hill keeps its full warning', () => {
    const sim = world();
    const real = sim.hillProbe;
    let calls = 0;
    // The first search finds only water; every later one sees the real world.
    (sim as unknown as { hillProbe: typeof real }).hillProbe = {
      ...real,
      wet: (x, z) => calls === 0 || real.wet(x, z),
    };
    const plan = hillPlanFor(sim.ctx, 0);
    jumpTo(sim, plan.warnAt);
    tickSeconds(sim, 1);
    expect(sim.hillState.active).toBeNull();
    expect(sim.hillState.attempts).toBe(1);
    calls = 1;
    tickSeconds(sim, 30);
    expect(sim.hillState.active).toBeNull();
    const seen = tickSeconds(sim, 31);
    const hill = sim.hillState.active!;
    expect(hill).not.toBeNull();
    expect(hill.warnAt).toBeGreaterThan(plan.warnAt);
    expect(hill.risesAt - hill.warnAt).toBe(HILL_WARNING_SECONDS);
    const zone = ZONES.find((z) => z.id === hill.zoneId)!;
    expect(logLines(seen)).toContain(hillWarningLine(zone.name, 15));
  });

  it('the whole schedule draws nothing from the world rng on the tick path', () => {
    const run = (disabled: boolean) => {
      const sim = world({ worldPvpDisabled: disabled });
      const plan = hillPlanFor(sim.ctx, 0);
      jumpTo(sim, plan.warnAt - 1);
      tickSeconds(sim, 3);
      jumpTo(sim, plan.risesAt - 1);
      tickSeconds(sim, 3);
      jumpTo(sim, plan.closesAt - 1);
      tickSeconds(sim, 3);
      return sim.rng.next();
    };
    // The same ticks with the hill switched off: any world draw would split them.
    expect(run(false)).toBe(run(true));
  });
});

describe('the spot', () => {
  it('is dry, clear of colliders, clear of the hub, and wholly inside its zone, for every window', () => {
    const sim = world();
    for (let ordinal = 0; ordinal < 12; ordinal++) {
      const hill = spawnHill(sim.ctx, ordinal, hillPlanFor(sim.ctx, ordinal))!;
      expect(hill, `ordinal ${ordinal}`).not.toBeNull();
      const zone = ZONES.find((z) => z.id === hill.zoneId)!;
      expect(FFA_IDS).toContain(zone.id);
      expect(isInWaterBody(hill.x, hill.z)).toBe(false);
      expect(isBlocked(SEED, hill.x, hill.z, 6)).toBe(false);
      expect(Math.hypot(hill.x - zone.hub.x, hill.z - zone.hub.z)).toBeGreaterThan(
        zone.hub.radius + 50,
      );
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rx = hill.x + Math.cos(a) * hill.radius;
        const rz = hill.z + Math.sin(a) * hill.radius;
        expect(zoneContaining(rx, rz)?.id, `ordinal ${ordinal} rim ${i}`).toBe(zone.id);
        expect(isInWaterBody(rx, rz), `ordinal ${ordinal} rim ${i}`).toBe(false);
      }
    }
  });

  it('is the same on every host for the same seed, and draws nothing from the world rng', () => {
    const a = world();
    const b = world();
    const before = a.rng.next();
    expect(b.rng.next()).toBe(before);
    const ha = spawnHillNow(a.ctx)!;
    const hb = spawnHillNow(b.ctx)!;
    expect([ha.zoneId, ha.x, ha.z]).toEqual([hb.zoneId, hb.x, hb.z]);
    expect(hillPlanFor(a.ctx, 2)).toEqual(hillPlanFor(b.ctx, 2));
    const c = world();
    c.rng.next();
    expect(c.rng.next()).toBe(a.rng.next());
  });

  it('gives up when no open ground is found, and a retry searches new ground', () => {
    const sim = world();
    const zone = ZONES.find((z) => z.id === 'drakelands')!;
    const drowned = pickHillSpot(sim.ctx, new Rng(1), zone, {
      wet: () => true,
      steep: () => false,
      blocked: () => false,
      zoneIdAt: () => zone.id,
    });
    expect(drowned).toBeNull();
    // The retry salts its attempt number in: the same window, a different draw.
    const times = hillPlanFor(sim.ctx, 0);
    const first = spawnHill(sim.ctx, 0, times, 0, 'drakelands')!;
    const retry = spawnHill(sim.ctx, 0, times, 1, 'drakelands')!;
    expect(`${retry.x},${retry.z}`).not.toBe(`${first.x},${first.z}`);
  });
});

describe('the contest', () => {
  it('a lone player takes an unheld hill after a minute inside, and is told', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS - 1);
    expect(sim.hillState.active!.holder).toBeNull();
    expect(sim.hillInfoFor(a)).toMatchObject({
      challenger: 'you',
      challengerCount: 1,
      inside: true,
    });
    const seen = tickSeconds(sim, 2);
    expect(sim.hillState.active!.holder).toBe(`solo:${a}`);
    expect(logLines(seen, a)).toContain(HILL_TAKEN_LINE);
    expect(sim.hillInfoFor(a)).toMatchObject({
      holder: 'you',
      holderCount: 1,
      yourCount: 1,
      challenger: 'none',
      contest: 0,
    });
  });

  it('a party counts as one group; a strict majority takes the hill and the ousted are told', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet', 'Gimel']);
    const [a, b, c] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`solo:${a}`);
    // One rival inside: a tie, nothing moves.
    inside(sim, b, 5, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 5);
    expect(sim.hillState.active!.holder).toBe(`solo:${a}`);
    expect(sim.hillInfoFor(b)).toMatchObject({
      holder: 'other',
      holderCount: 1,
      yourCount: 1,
      challenger: 'none',
    });
    // Two in one party beat one.
    sim.partyInvite(c, b);
    sim.partyAccept(c);
    inside(sim, c, -5, 0);
    tickSeconds(sim, 2);
    expect(sim.hillInfoFor(b)).toMatchObject({
      challenger: 'you',
      challengerCount: 2,
      yourCount: 2,
    });
    expect(sim.hillInfoFor(a)).toMatchObject({
      challenger: 'other',
      challengerCount: 2,
      holder: 'you',
    });
    sim.events = [];
    const seen = tickSeconds(sim, HILL_CAPTURE_SECONDS);
    const party = sim.partyOf(b)!;
    expect(sim.hillState.active!.holder).toBe(`party:${party.id}`);
    expect(logLines(seen, b)).toContain(HILL_TAKEN_LINE);
    expect(logLines(seen, c)).toContain(HILL_TAKEN_LINE);
    expect(logLines(seen, a)).toContain(HILL_LOST_LINE);
    expect(sim.hillInfoFor(c)).toMatchObject({ holder: 'you', holderCount: 2 });
  });

  it('a challenge that lapses starts over, and a swapped challenger restarts the clock', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet']);
    const [a, b] = pids;
    inside(sim, a);
    tickSeconds(sim, 30);
    expect(sim.hillInfoFor(a)!.contest).toBe(30);
    outside(sim, a);
    tickSeconds(sim, 2);
    expect(sim.hillInfoFor(a)!.contest).toBe(0);
    inside(sim, a);
    tickSeconds(sim, 10);
    expect(sim.hillInfoFor(a)!.contest).toBe(10);
    // Bet walks in alone as Aleph leaves: a new challenger, a fresh clock.
    outside(sim, a);
    inside(sim, b);
    tickSeconds(sim, 3);
    expect(sim.hillInfoFor(b)).toMatchObject({ challenger: 'you', contest: 3 });
  });

  it('a raid does not count at all, while a player of any level does', () => {
    const { sim, pids } = hillWorld(['R1', 'R2', 'R3', 'R4', 'R5', 'Solo', 'Novice']);
    const [r1, r2, r3, r4, r5, solo, novice] = pids;
    sim.setPlayerLevel(9, novice);
    // A raid needs a full party of five to convert; three of them take the field.
    for (const pid of [r2, r3, r4, r5]) {
      sim.partyInvite(pid, r1);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(r1);
    expect(sim.partyOf(r1)!.raid).toBe(true);
    for (const [i, pid] of [r1, r2, r3].entries()) inside(sim, pid, i * 4 - 6, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 5);
    // Three raiders stood a full minute on an empty hill: nothing.
    expect(sim.hillState.active!.holder).toBeNull();
    expect(sim.hillState.active!.counts.size).toBe(0);
    expect(sim.hillInfoFor(r1)).toMatchObject({
      standing: 'raid',
      inside: true,
      yourCount: 0,
      challenger: 'none',
    });
    // A level-9 lone player beside them counts, and takes it unopposed.
    inside(sim, novice, 0, 6);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`solo:${novice}`);
    expect(sim.hillInfoFor(novice)).toMatchObject({
      standing: 'counted',
      holder: 'you',
      holderCount: 1,
    });
    // Another lone player makes a tie, which never moves the hill.
    inside(sim, solo, 0, -6);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`solo:${novice}`);
    // Back to a party of three, the same players count again.
    sim.convertRaidToParty(r1);
    expect(sim.partyOf(r1)!.raid).toBe(false);
    tickSeconds(sim, 2);
    expect(sim.hillInfoFor(r1)).toMatchObject({ standing: 'counted', yourCount: 3 });
  });

  it('the dead do not count, and the holder keeps the hill while nobody beats them', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet']);
    const [a, b] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    ent(sim, a).dead = true;
    inside(sim, b, 4, 0);
    tickSeconds(sim, 2);
    expect(sim.hillInfoFor(b)).toMatchObject({
      holderCount: 0,
      challenger: 'you',
      challengerCount: 1,
    });
    ent(sim, a).dead = false;
    outside(sim, b);
    tickSeconds(sim, 2);
    expect(sim.hillState.active!.holder).toBe(`solo:${a}`);
    expect(sim.hillInfoFor(a)).toMatchObject({ holder: 'you', challenger: 'none', contest: 0 });
  });
});

describe('the Honor trickle', () => {
  it('pays a holder one Honor for each minute inside, and nothing outside', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    sim.events = [];
    // The capture pass banks the first second of holding, so the first payout lands
    // HILL_ACCRUAL_SECONDS - 1 after the capture.
    let seen = tickSeconds(sim, HILL_ACCRUAL_SECONDS - 3);
    expect(honorEvents(seen, a)).toEqual([]);
    seen = tickSeconds(sim, 3);
    expect(honorEvents(seen, a)).toEqual([
      { type: 'honor', pid: a, amount: 2, reason: 'hill_hold' },
    ]);
    expect(sim.meta(a)!.honor).toBe(2);
    seen = tickSeconds(sim, 4 * HILL_ACCRUAL_SECONDS);
    expect(honorEvents(seen, a)).toHaveLength(4);
    // Minutes one to four pay 2 each; the fifth lands on the first ramp step
    // (five minutes held) and pays 4 (hillHonorPerPayout).
    expect(sim.meta(a)!.honor).toBe(12);
    expect(sim.hillState.active!.honorPaid).toBe(12);
    // Stepping out banks nothing but keeps what was banked, so a holder who
    // steps off the rim to fight does not forfeit the minute they stood.
    tickSeconds(sim, 30);
    const banked = sim.hillState.active!.accrual.get(a)!;
    expect(banked).toBeGreaterThan(0);
    outside(sim, a);
    const before = sim.meta(a)!.honor;
    seen = tickSeconds(sim, 2 * HILL_ACCRUAL_SECONDS);
    expect(honorEvents(seen, a)).toEqual([]);
    expect(sim.meta(a)!.honor).toBe(before);
    expect(sim.hillState.active!.accrual.get(a)).toBe(banked);
    inside(sim, a);
    seen = tickSeconds(sim, HILL_ACCRUAL_SECONDS - banked + 1);
    expect(honorEvents(seen, a)).toHaveLength(1);
  });

  it('pays every holder of the party inside, whatever their level, and nobody else', () => {
    const { sim, pids } = hillWorld(['A1', 'A2', 'A3', 'A4', 'Rival', 'Novice']);
    const party = pids.slice(0, 4);
    const [rival, novice] = pids.slice(4);
    sim.setPlayerLevel(9, novice);
    for (const pid of [...party.slice(1), novice]) {
      sim.partyInvite(pid, party[0]);
      sim.partyAccept(pid);
    }
    expect(sim.partyOf(party[0])!.members).toHaveLength(5);
    for (const [i, pid] of party.entries()) inside(sim, pid, i * 3 - 6, 0);
    inside(sim, novice, 0, 6);
    inside(sim, rival, 0, -6);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`party:${sim.partyOf(party[0])!.id}`);
    expect(sim.hillInfoFor(party[0])).toMatchObject({ holderCount: 5 });
    sim.events = [];
    const seen = tickSeconds(sim, HILL_ACCRUAL_SECONDS + 1);
    const paid = [...party, novice, rival].filter((pid) => honorEvents(seen, pid).length > 0);
    expect(paid).toEqual([...party, novice]);
    expect(sim.meta(rival)!.honor).toBe(0);
  });

  it('ramps with the hold and restarts at the first step when the hill changes hands', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet', 'Gimel']);
    const [a, b, c] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    // Held past the cap (the hold clock stands at 26 minutes rather than ticking
    // 26 minutes of sim): every minute now pays the capped amount.
    sim.hillState.active!.heldSeconds = 26 * 60;
    sim.events = [];
    const seen = tickSeconds(sim, HILL_ACCRUAL_SECONDS + 1);
    expect(honorEvents(seen, a)).toEqual([
      { type: 'honor', pid: a, amount: HILL_RAMP_MAX_HONOR, reason: 'hill_hold' },
    ]);
    // A two-player party takes it from the lone holder: its first minute pays 1.
    sim.partyInvite(c, b);
    sim.partyAccept(c);
    inside(sim, b, 4, 0);
    inside(sim, c, -4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`party:${sim.partyOf(b)!.id}`);
    expect(sim.hillState.active!.heldSeconds).toBeLessThan(5);
    sim.events = [];
    const after = tickSeconds(sim, HILL_ACCRUAL_SECONDS + 1);
    expect(honorEvents(after, b)).toEqual([
      { type: 'honor', pid: b, amount: HILL_RAMP_STEP_HONOR, reason: 'hill_hold' },
    ]);
  });

  it("a capture clears the old holder's banked minute", () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet', 'Gimel']);
    const [a, b, c] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 30);
    sim.partyInvite(c, b);
    sim.partyAccept(c);
    inside(sim, b, 4, 0);
    inside(sim, c, -4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(sim.hillState.active!.holder).toBe(`party:${sim.partyOf(b)!.id}`);
    expect(sim.hillState.active!.accrual.size).toBeLessThanOrEqual(2);
    expect(sim.meta(a)!.honor).toBe(2); // the one minute banked before the capture paid
  });
});

describe('the readout and the chat arms', () => {
  it("shows the live fields only in the hill's zone, and the /hill line names the holder", () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet']);
    const [a, b] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    place(sim, b, 60, 700); // Thornpeak Heights, contested ground far away
    tickSeconds(sim, 1);
    expect(sim.hillInfoFor(b)).toMatchObject({
      inZone: false,
      inside: false,
      holder: 'other',
      holderCount: 0,
      yourCount: 0,
      challenger: 'none',
      contest: 0,
      radius: 50,
    });
    expect(sim.hillInfoFor(a)).toMatchObject({
      inZone: true,
      inside: true,
      holder: 'you',
      holderCount: 1,
    });
    sim.events = [];
    sim.chat('/hill', a);
    sim.chat('/hill', b);
    const errors = sim.events.filter(
      (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error',
    );
    expect(errors.find((ev) => ev.pid === a)?.text).toBe(
      'The hill stands in The Drakelands: your group holds it. It falls in 44 minutes.',
    );
    expect(errors.find((ev) => ev.pid === b)?.text).toBe(
      'The hill stands in The Drakelands: another group holds it. It falls in 44 minutes.',
    );
    const quiet = world();
    const q = addPlayer(quiet, 'Quiet');
    quiet.chat('/hill', q);
    expect(
      quiet.events.some((ev) => ev.type === 'error' && ev.text === HILL_READOUT_NONE_LINE),
    ).toBe(true);
  });

  it('/dev hill rises a hill now and stands the caller on its rim (dev commands only)', () => {
    const sim = world({ devCommands: true });
    const a = addPlayer(sim, 'Aleph');
    sim.chat('/dev hill frostveil', a);
    const hill = sim.hillState.active!;
    expect(hill.zoneId).toBe('frostveil');
    expect(hillContains(hill, ent(sim, a).pos.x, ent(sim, a).pos.z)).toBe(true);
    expect(hill.phase).toBe('active');
    const plain = world();
    const p = addPlayer(plain, 'Plain');
    plain.chat('/dev hill', p);
    plain.chat('/dev hill warn', p);
    expect(plain.hillState.active).toBeNull();
  });

  it('/dev hill warn counts down (full, or a short test countdown), then rise and end drive the phases', () => {
    const sim = world({ devCommands: true });
    const a = addPlayer(sim, 'Aleph');
    sim.chat('/dev hill warn', a);
    const full = sim.hillState.active!;
    expect(full.phase).toBe('warning');
    expect(full.risesAt - sim.time).toBe(HILL_WARNING_SECONDS);
    expect(hillContains(full, ent(sim, a).pos.x, ent(sim, a).pos.z)).toBe(true);
    // A short countdown in a named zone, then let it run out on its own.
    sim.chat('/dev hill warn amberfall 5', a);
    const short = sim.hillState.active!;
    expect(short).toMatchObject({ phase: 'warning', zoneId: 'amberfall' });
    expect(short.risesAt - sim.time).toBe(5);
    const seen = tickSeconds(sim, 7);
    expect(short.phase).toBe('active');
    expect(logLines(seen)).toContain(hillRiseLine('The Amberfall'));
    expect(short.closesAt - short.risesAt).toBe(HILL_DURATION_SECONDS);
    // Skip a countdown: the announced hill rises now and stands in full.
    sim.chat('/dev hill warn frostveil', a);
    sim.events = [];
    sim.chat('/dev hill rise', a);
    const risen = sim.hillState.active!;
    expect(risen).toMatchObject({ phase: 'active', zoneId: 'frostveil' });
    expect(risen.closesAt - sim.time).toBe(HILL_DURATION_SECONDS);
    expect(logLines(sim.events)).toContain(hillRiseLine('The Frostveil Reach'));
    // End it: the realm hears the fall.
    sim.events = [];
    sim.chat('/dev hill end', a);
    expect(sim.hillState.active).toBeNull();
    expect(logLines(sim.events)).toContain(hillFallenLine('The Frostveil Reach'));
    // Nothing to rise or end now: told so, nothing changes.
    sim.events = [];
    sim.chat('/dev hill rise', a);
    sim.chat('/dev hill end', a);
    expect(logLines(sim.events, a)).toEqual([
      '[dev] No hill is counting down.',
      '[dev] No hill stands.',
    ]);
    // A malformed line prints the usage.
    sim.events = [];
    sim.chat('/dev hill warn 5 6', a);
    expect(logLines(sim.events, a)).toEqual([HILL_DEV_USAGE]);
    expect(sim.hillState.active).toBeNull();
  });

  it("/dev hill next runs the real schedule now: the next window's own hill, warned in full", () => {
    const sim = world({ devCommands: true });
    const a = addPlayer(sim, 'Aleph');
    const reference = world();
    const expected = spawnHill(reference.ctx, 0, hillPlanFor(reference.ctx, 0))!;
    sim.chat('/dev hill next', a);
    const hill = sim.hillState.active!;
    expect(hill).toMatchObject({ ordinal: 0, phase: 'warning', zoneId: expected.zoneId });
    expect([hill.x, hill.z]).toEqual([expected.x, expected.z]);
    expect(hill.risesAt - hill.warnAt).toBe(HILL_WARNING_SECONDS);
    // The window is spent: the schedule plans the next one.
    expect(sim.hillState.window).toBe(1);
  });

  it('/hill during the warning says where and when the hill will rise', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    spawnHillNow(sim.ctx, 'drakelands', { warn: true });
    sim.events = [];
    sim.chat('/hill', a);
    const line = sim.events.find(
      (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === a,
    )?.text;
    expect(line).toBe('A hill will rise in The Drakelands in 15 minutes.');
    expect(hillWarningLine('The Drakelands', 1)).toBe(
      'A hill will rise in The Drakelands in 1 minute.',
    );
  });
});

describe('the /dev hill grammar', () => {
  it('parses every arm and refuses malformed arguments', () => {
    expect(parseHillDevCommand('/dev hill')).toEqual({ kind: 'now' });
    expect(parseHillDevCommand('/devhill')).toEqual({ kind: 'now' });
    expect(parseHillDevCommand('/dev hill Drakelands')).toEqual({
      kind: 'now',
      zoneId: 'drakelands',
    });
    expect(parseHillDevCommand('/dev hill warn')).toEqual({ kind: 'warn' });
    expect(parseHillDevCommand('/dev hill warn 30')).toEqual({ kind: 'warn', seconds: 30 });
    expect(parseHillDevCommand('/dev hill warn frostveil 30')).toEqual({
      kind: 'warn',
      zoneId: 'frostveil',
      seconds: 30,
    });
    expect(parseHillDevCommand('/dev hill warn 30 frostveil')).toEqual({
      kind: 'warn',
      zoneId: 'frostveil',
      seconds: 30,
    });
    expect(parseHillDevCommand('/dev hill warn 0')).toEqual({ kind: 'warn', seconds: 1 });
    expect(parseHillDevCommand('/dev hill rise')).toEqual({ kind: 'rise' });
    expect(parseHillDevCommand('/dev hill end')).toEqual({ kind: 'end' });
    expect(parseHillDevCommand('/dev hill next')).toEqual({ kind: 'next' });
    for (const bad of [
      '/dev hill rise now',
      '/dev hill warn 5 6',
      '/dev hill warn a b',
      '/dev hill a b',
      '/dev hill 12',
      '/dev hill wraith-wood',
      '/dev gold 5',
    ]) {
      expect(parseHillDevCommand(bad), bad).toBeNull();
    }
  });
});

describe('determinism', () => {
  it('two identical runs agree on the holder, every purse of honor and the rng position', () => {
    const run = () => {
      const { sim, pids } = hillWorld(['Aleph', 'Bet']);
      const [a, b] = pids;
      inside(sim, a);
      tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_ACCRUAL_SECONDS + 5);
      inside(sim, b, 3, 0);
      tickSeconds(sim, 20);
      return {
        holder: sim.hillState.active!.holder,
        honor: [sim.meta(a)!.honor, sim.meta(b)!.honor],
        contest: sim.hillState.active!.contest,
        rng: sim.rng.next(),
      };
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first.honor).toEqual([HILL_RAMP_STEP_HONOR, 0]); // one paid minute at the ramp's first step
  });
});
