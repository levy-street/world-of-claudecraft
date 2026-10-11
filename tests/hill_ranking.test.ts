// King of the Hill: the five-minute reminder, the hold ranking and the Weekly
// Vault point (src/sim/pvp/hill.ts, src/sim/pvp/hill_ranking.ts). While a hill
// stands the realm hears where it is every HILL_NOTICE_SECONDS with the
// standings; when it falls the final standings are told and, when that hold
// lasted HILL_VAULT_MIN_HOLD_SECONDS, every player who stood inside for the
// group that held it longest (every group tied at the top) earns one point on
// the Weekly Vault's PvP row. The client matcher re-renders every new line
// (src/ui/sim_i18n.ts).
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  endHillNow,
  HILL_CAPTURE_SECONDS,
  HILL_DURATION_SECONDS,
  HILL_NOTICE_SECONDS,
  HILL_RANKING_SHOWN,
  HILL_VAULT_LINE,
  HILL_VAULT_MIN_HOLD_SECONDS,
  HILL_VAULT_MIN_INSIDE_SECONDS,
  type HillHoldRecord,
  hillLongestHolds,
  hillRanking,
  hillRankLine,
  hillStillStandsLine,
  hillVaultPayees,
  NO_HILL_VAULT_CREDIT,
  spawnHillNow,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { recordWeeklyPvpWin } from '../src/sim/weekly_rewards';
import { groundHeight } from '../src/sim/world';
import { localizeSimText } from '../src/ui/sim_i18n';

const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const SEED = 7;

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

function addPlayer(sim: Sim, name: string): number {
  const pid = sim.addPlayer('warrior', name, {
    autoEquip: true,
    characterId: 2000 + sim.players.size,
  });
  sim.setPlayerLevel(20, pid);
  const e = ent(sim, pid);
  e.hp = e.maxHp;
  return pid;
}

function place(sim: Sim, pid: number, x: number, z: number): void {
  const e = ent(sim, pid);
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}
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
function jumpTo(sim: Sim, time: number): void {
  (sim as unknown as { time: number }).time = time;
}

/** Realm-wide log lines (no pid), or one player's own. */
function logLines(events: SimEvent[], pid?: number): string[] {
  return events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
    .filter((ev) => (pid === undefined ? ev.pid === undefined : ev.pid === pid))
    .map((ev) => ev.text);
}

function vaultPvp(sim: Sim, pid: number): number {
  return sim.meta(pid)?.weeklyRewards?.pvp ?? 0;
}

/** Bank the rest of the Weekly Vault hold floor on `key`'s record at once, so
 *  a test about WHO the longest hold pays need not tick ten sim minutes. The
 *  banking itself is pinned with real ticks ('the hold ranking', and 'the hold
 *  floor' below). */
function bankHoldFloor(sim: Sim, key: string): void {
  const record = sim.hillState.active!.holds.get(key)!;
  record.seconds = Math.max(record.seconds, HILL_VAULT_MIN_HOLD_SECONDS);
}

/** A risen hill in the Drakelands, the fighters placed outside it. */
function hillWorld(names: string[]): { sim: Sim; pids: number[] } {
  const sim = world();
  const pids = names.map((n) => addPlayer(sim, n));
  expect(spawnHillNow(sim.ctx, 'drakelands')).not.toBeNull();
  for (const pid of pids) outside(sim, pid);
  sim.tick();
  sim.events = [];
  return { sim, pids };
}

/** A record whose holders each stood inside `inside` seconds (default a full
 *  minute), or the given [pid, seconds] pairs. */
function record(
  key: string,
  seconds: number,
  holders: Array<number | [number, number]> = [],
  name = key,
): HillHoldRecord {
  const entries = holders.map((h): [number, number] => (Array.isArray(h) ? h : [h, 60]));
  return { key, seconds, name, party: key.startsWith('party:'), holders: new Map(entries) };
}
const anyGroup = () => true;

describe('the ranking rules (pure)', () => {
  it('ranks longest first, keeps first-held order on a tie, and drops groups that never held', () => {
    const ranked = hillRanking([
      record('solo:1', 90),
      record('party:2', 300),
      record('solo:3', 0),
      record('party:4', 90),
    ]);
    expect(ranked.map((r) => r.key)).toEqual(['party:2', 'solo:1', 'party:4']);
  });

  it('the longest hold is every group tied at the top, or nobody on an unheld stand', () => {
    expect(
      hillLongestHolds([record('solo:1', 90), record('party:2', 300)]).map((r) => r.key),
    ).toEqual(['party:2']);
    expect(
      hillLongestHolds([record('solo:1', 300), record('party:2', 300), record('solo:3', 10)]).map(
        (r) => r.key,
      ),
    ).toEqual(['solo:1', 'party:2']);
    expect(hillLongestHolds([record('solo:1', 0)])).toEqual([]);
    expect(hillLongestHolds([])).toEqual([]);
  });

  it('pays every holder of every group tied at the top once, and nobody else', () => {
    const floor = HILL_VAULT_MIN_HOLD_SECONDS;
    expect(
      hillVaultPayees(
        [
          record('party:1', floor, [10, 11]),
          record('party:2', floor, [11, 12]),
          record('solo:13', floor - 1, [13]),
        ],
        floor,
        HILL_VAULT_MIN_INSIDE_SECONDS,
        anyGroup,
      ),
    ).toEqual([10, 11, 12]);
    expect(
      hillVaultPayees([record('party:1', 0, [10])], 0, HILL_VAULT_MIN_INSIDE_SECONDS, anyGroup),
    ).toEqual([]);
  });

  it('pays nobody unless the longest hold lasted ten minutes, counted on the group total', () => {
    const floor = HILL_VAULT_MIN_HOLD_SECONDS;
    expect(floor).toBe(10 * 60);
    const asked = vi.fn(() => true);
    // A lone player's minute on an empty hill tops the standings but pays nothing.
    expect(
      hillVaultPayees(
        [record('solo:1', floor - 1, [[1, floor - 1]])],
        floor,
        HILL_VAULT_MIN_INSIDE_SECONDS,
        asked,
      ),
    ).toEqual([]);
    expect(asked).not.toHaveBeenCalled();
    // Groups tied at the top under the floor: still nobody.
    expect(
      hillVaultPayees(
        [record('party:2', 120, [20]), record('party:3', 120, [30])],
        floor,
        HILL_VAULT_MIN_INSIDE_SECONDS,
        anyGroup,
      ),
    ).toEqual([]);
    // At the floor exactly it pays, and the floor is the group's total hold:
    // two members who each stood one minute inside are both paid.
    expect(
      hillVaultPayees(
        [
          record('party:4', floor, [
            [40, 60],
            [41, 60],
          ]),
        ],
        floor,
        HILL_VAULT_MIN_INSIDE_SECONDS,
        anyGroup,
      ),
    ).toEqual([40, 41]);
  });

  it('pays only a holder who stood inside a full minute and is still in the group', () => {
    expect(HILL_VAULT_MIN_INSIDE_SECONDS).toBe(60);
    const seen: Array<[number, string]> = [];
    const payees = hillVaultPayees(
      [
        record('party:1', HILL_VAULT_MIN_HOLD_SECONDS, [
          [10, 60],
          [11, 59],
          [12, 200],
          [13, 1],
        ]),
      ],
      HILL_VAULT_MIN_HOLD_SECONDS,
      HILL_VAULT_MIN_INSIDE_SECONDS,
      (pid, key) => {
        seen.push([pid, key]);
        return pid !== 12; // 12 left the party before the fall
      },
    );
    expect(payees).toEqual([10]);
    // Membership is asked of the group the player held for.
    expect(seen).toEqual([
      [10, 'party:1'],
      [12, 'party:1'],
    ]);
  });

  it('shows three places', () => {
    expect(HILL_RANKING_SHOWN).toBe(3);
  });
});

describe('the lines', () => {
  it('reads a party by its leader and a lone player by name, the hold rounded up to whole minutes', () => {
    expect(hillStillStandsLine('The Drakelands', 25)).toBe(
      'The hill still stands in The Drakelands: it falls in 25 minutes.',
    );
    expect(hillStillStandsLine('The Drakelands', 1)).toBe(
      'The hill still stands in The Drakelands: it falls in 1 minute.',
    );
    expect(hillRankLine(1, { ...record('party:4', 121), name: 'Bet' })).toBe(
      "Hill ranking #1: Bet's group, held 3 minutes.",
    );
    expect(hillRankLine(2, { ...record('solo:9', 60), name: 'Aleph' })).toBe(
      'Hill ranking #2: Aleph, held 1 minute.',
    );
  });

  it('every new line is recognized by the client matcher', () => {
    expect(localizeSimText(hillStillStandsLine('The Drakelands', 25))).toBe(
      'The hill still stands in The Drakelands: it falls in 25 minutes.',
    );
    expect(localizeSimText(hillStillStandsLine('The Drakelands', 1))).toBe(
      'The hill still stands in The Drakelands: it falls in 1 minute.',
    );
    expect(localizeSimText("Hill ranking #1: Bet's group, held 3 minutes.")).toBe(
      "Hill ranking #1: Bet's group, held 3 minutes.",
    );
    expect(localizeSimText('Hill ranking #2: Aleph, held 1 minute.')).toBe(
      'Hill ranking #2: Aleph, held 1 minute.',
    );
    expect(localizeSimText(HILL_VAULT_LINE)).toBe(HILL_VAULT_LINE);
  });
});

describe('the five-minute reminder', () => {
  it('tells the realm where the hill stands every five minutes while risen, never while announced', () => {
    const sim = world();
    addPlayer(sim, 'Aleph');
    const hill = spawnHillNow(sim.ctx, 'drakelands', { warn: true, warningSeconds: 600 })!;
    const stillStands = (events: SimEvent[]) =>
      logLines(events).filter((l) => l.startsWith('The hill still stands'));
    // The warning counts down with no reminder (they start once it rises),
    // even past where the first would sound had it risen at the warning.
    jumpTo(sim, hill.warnAt + HILL_NOTICE_SECONDS);
    expect(stillStands(tickSeconds(sim, 2))).toEqual([]);
    jumpTo(sim, hill.risesAt - 0.5);
    tickSeconds(sim, 2);
    expect(hill.phase).toBe('active');
    // Each reminder sounds on its own pass: step the clock to just before each.
    const reminders: string[] = [];
    const passes = HILL_DURATION_SECONDS / HILL_NOTICE_SECONDS + 1;
    for (let i = 0; i < passes; i++) {
      jumpTo(sim, Math.min(hill.nextNoticeAt, hill.closesAt) - 0.5);
      reminders.push(...stillStands(tickSeconds(sim, 2)));
    }
    // Every five minutes of the stand, counting down; at its end the hill falls
    // instead (read off HILL_DURATION_SECONDS so a retuned stand keeps this true).
    const expected: string[] = [];
    for (
      let left = HILL_DURATION_SECONDS - HILL_NOTICE_SECONDS;
      left > 0;
      left -= HILL_NOTICE_SECONDS
    ) {
      expected.push(hillStillStandsLine('The Drakelands', left / 60));
    }
    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(reminders).toEqual(expected);
    expect(HILL_NOTICE_SECONDS).toBe(300);
    expect(hill.zoneId).toBe('drakelands');
    expect(sim.hillState.active).toBeNull();
  });
});

describe('the hold ranking', () => {
  it('ranks each group by its total hold across separate holds, named by its leader', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet', 'Gimel']);
    const [a, b, c] = pids;
    const hill = sim.hillState.active!;
    // Aleph takes the empty hill and holds it for about two minutes.
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 120);
    // Bet's party (Bet leads, Gimel joins) outnumbers Aleph and takes it.
    sim.partyInvite(c, b);
    sim.partyAccept(c);
    inside(sim, b, 4, 0);
    inside(sim, c, -4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    const party = `party:${sim.partyOf(b)!.id}`;
    expect(hill.holder).toBe(party);
    // They hold it up to the next reminder, which tells the realm the standings.
    let seen: SimEvent[] = [];
    for (let s = 0; s < HILL_NOTICE_SECONDS; s++) {
      seen = tickSeconds(sim, 1);
      if (logLines(seen).some((l) => l.startsWith('The hill still stands'))) break;
    }
    const party0 = hill.holds.get(party)!;
    const solo0 = hill.holds.get(`solo:${a}`)!;
    expect(solo0.name).toBe('Aleph');
    expect(party0.name).toBe('Bet');
    expect(party0.party).toBe(true);
    expect(solo0.party).toBe(false);
    // Aleph's hold ran from the capture until the party's capture (about 3 minutes).
    expect(solo0.seconds).toBeGreaterThanOrEqual(175);
    expect(solo0.seconds).toBeLessThanOrEqual(185);
    expect([...party0.holders.keys()].sort()).toEqual([b, c].sort());
    expect([...solo0.holders.keys()]).toEqual([a]);
    // The party has held about a minute of the five: Aleph ranks first.
    expect(party0.seconds).toBeGreaterThanOrEqual(55);
    expect(party0.seconds).toBeLessThanOrEqual(65);
    const ranking = logLines(seen).filter((l) => l.startsWith('Hill ranking'));
    expect(ranking).toEqual([
      'Hill ranking #1: Aleph, held 3 minutes.',
      // The standings sound before the pass banks its second: a minute held.
      "Hill ranking #2: Bet's group, held 1 minute.",
    ]);
  });

  it('banks nothing for a group that walks away, and adds to its own record when it retakes', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet']);
    const [a, b] = pids;
    const hill = sim.hillState.active!;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 30);
    const held = hill.holds.get(`solo:${a}`)!.seconds;
    expect(held).toBeGreaterThanOrEqual(29);
    outside(sim, a);
    tickSeconds(sim, 60);
    // Aleph still holds the empty hill, but an empty hold earns no rank: a
    // quiet realm's hill cannot be won from afar.
    expect(hill.holder).toBe(`solo:${a}`);
    expect(hill.holds.get(`solo:${a}`)!.seconds).toBe(held);
    expect(hill.holds.get(`solo:${a}`)!.holders.get(a)).toBe(held);
    // Bet takes the empty hill, then Aleph takes it back while Bet is away.
    inside(sim, b);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    expect(hill.holder).toBe(`solo:${b}`);
    outside(sim, b);
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 10);
    expect(hill.holder).toBe(`solo:${a}`);
    // One record per group, in the order they first held.
    expect([...hill.holds.keys()]).toEqual([`solo:${a}`, `solo:${b}`]);
    expect(hill.holds.get(`solo:${a}`)!.seconds).toBeGreaterThan(held);
  });
});

describe('the Weekly Vault point', () => {
  it('pays the member left behind when a holding duo disbands', () => {
    const { sim, pids } = hillWorld(['Bet', 'Gimel']);
    const [bet, gimel] = pids;
    sim.partyInvite(gimel, bet);
    sim.partyAccept(gimel);
    const partyId = sim.partyOf(bet)!.id;
    inside(sim, bet);
    inside(sim, gimel, 4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_INSIDE_SECONDS + 5);
    const hill = sim.hillState.active!;
    expect(hill.holds.get(`party:${partyId}`)?.holders.has(bet)).toBe(true);
    expect(hill.holds.get(`party:${partyId}`)?.holders.has(gimel)).toBe(true);
    bankHoldFloor(sim, `party:${partyId}`);

    outside(sim, gimel);
    sim.partyLeave(gimel);
    expect(sim.partyOf(bet)).toBeNull();
    expect(sim.partyOf(gimel)).toBeNull();
    jumpTo(sim, hill.closesAt - 0.5);
    const seen = tickSeconds(sim, 2);
    expect(logLines(seen)).toContain("Hill ranking #1: Bet's group, held 10 minutes.");
    expect(vaultPvp(sim, bet)).toBe(1);
    expect(logLines(seen, bet)).toContain(HILL_VAULT_LINE);
    expect(vaultPvp(sim, gimel)).toBe(0);
  });

  it('also pays the member left behind when the leader disbands the duo', () => {
    const { sim, pids } = hillWorld(['Bet', 'Gimel']);
    const [bet, gimel] = pids;
    sim.partyInvite(gimel, bet);
    sim.partyAccept(gimel);
    inside(sim, bet);
    inside(sim, gimel, 4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_INSIDE_SECONDS + 5);
    bankHoldFloor(sim, `party:${sim.partyOf(bet)!.id}`);
    outside(sim, bet);
    sim.partyLeave(bet);
    const hill = sim.hillState.active!;
    jumpTo(sim, hill.closesAt - 0.5);
    tickSeconds(sim, 2);
    expect(vaultPvp(sim, gimel)).toBe(1);
    expect(vaultPvp(sim, bet)).toBe(0);
  });

  it('does not pay a disband survivor who joins another party before the fall', () => {
    const { sim, pids } = hillWorld(['Bet', 'Gimel', 'Dalet']);
    const [bet, gimel, dalet] = pids;
    sim.partyInvite(gimel, bet);
    sim.partyAccept(gimel);
    inside(sim, bet);
    inside(sim, gimel, 4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_INSIDE_SECONDS + 5);
    bankHoldFloor(sim, `party:${sim.partyOf(bet)!.id}`);
    outside(sim, gimel);
    sim.partyLeave(gimel);
    sim.partyInvite(dalet, bet);
    sim.partyAccept(dalet);
    sim.partyLeave(dalet);
    expect(sim.partyOf(bet)).toBeNull();
    const hill = sim.hillState.active!;
    jumpTo(sim, hill.closesAt - 0.5);
    tickSeconds(sim, 2);
    expect(vaultPvp(sim, bet)).toBe(0);
    expect(vaultPvp(sim, gimel)).toBe(0);
  });

  it('revokes the survivor exception when Dungeon Finder puts them in another party', () => {
    const { sim, pids } = hillWorld(['Bet', 'Gimel', 'Dalet']);
    const [bet, gimel, dalet] = pids;
    sim.partyInvite(gimel, bet);
    sim.partyAccept(gimel);
    inside(sim, bet);
    inside(sim, gimel, 4, 0);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_INSIDE_SECONDS + 5);
    bankHoldFloor(sim, `party:${sim.partyOf(bet)!.id}`);
    outside(sim, gimel);
    sim.partyLeave(gimel);
    expect(
      sim.ctx.formDungeonFinderGroup(
        [
          { partyId: null, leaderPid: dalet, members: [dalet] },
          { partyId: null, leaderPid: bet, members: [bet] },
        ],
        { raid: false },
      ),
    ).not.toBeNull();
    sim.partyLeave(dalet);
    expect(sim.partyOf(bet)).toBeNull();
    const hill = sim.hillState.active!;
    jumpTo(sim, hill.closesAt - 0.5);
    tickSeconds(sim, 2);
    expect(vaultPvp(sim, bet)).toBe(0);
  });

  it('pays each qualifying holder of the longest hold one PvP point at the fall, and nobody else', {
    timeout: 60_000,
  }, () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet', 'Gimel', 'Dalet', 'He', 'Vav']);
    const [a, b, c, d, e, v] = pids;
    const hill = sim.hillState.active!;
    // Aleph holds briefly, then Bet's party (Gimel, He) takes it and holds longer.
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 20);
    for (const pid of [c, e]) {
      sim.partyInvite(pid, b);
      sim.partyAccept(pid);
    }
    inside(sim, b, 4, 0);
    inside(sim, c, -4, 0);
    inside(sim, e, 0, 4);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 1);
    outside(sim, a);
    tickSeconds(sim, 70);
    // He steps out but stays in the party: a full minute inside, still paid.
    // Gimel stood as long but leaves the party before the fall: not paid.
    outside(sim, e);
    outside(sim, c);
    sim.partyLeave(c);
    // Vav joins and stands inside ten seconds: under a minute, not paid.
    sim.partyInvite(v, b);
    sim.partyAccept(v);
    inside(sim, v, 0, -4);
    tickSeconds(sim, 10);
    outside(sim, v);
    tickSeconds(sim, 90);
    // Dalet never stood on the hill at all.
    expect(vaultPvp(sim, b)).toBe(0);
    bankHoldFloor(sim, `party:${sim.partyOf(b)!.id}`);
    jumpTo(sim, hill.closesAt - 0.5);
    const seen = tickSeconds(sim, 2);
    expect(sim.hillState.active).toBeNull();
    const realm = logLines(seen);
    expect(realm).toContain('The hill in The Drakelands has fallen.');
    const ranking = realm.filter((l) => l.startsWith('Hill ranking'));
    expect(ranking).toEqual([
      "Hill ranking #1: Bet's group, held 10 minutes.",
      'Hill ranking #2: Aleph, held 2 minutes.',
    ]);
    // The standings follow the fall line.
    expect(realm.indexOf(ranking[0])).toBeGreaterThan(
      realm.indexOf('The hill in The Drakelands has fallen.'),
    );
    const record = hill.holds.get(`party:${sim.partyOf(b)!.id}`)!;
    expect(record.holders.get(v)).toBeLessThan(60);
    expect(record.holders.get(c)).toBeGreaterThanOrEqual(60);
    for (const pid of [b, e]) {
      expect(vaultPvp(sim, pid)).toBe(1);
      expect(logLines(seen, pid)).toContain(HILL_VAULT_LINE);
    }
    for (const pid of [a, c, d, v]) {
      expect(vaultPvp(sim, pid)).toBe(0);
      expect(logLines(seen, pid)).not.toContain(HILL_VAULT_LINE);
    }
  });

  it('an unheld hill falls with no standings and no point', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    const hill = sim.hillState.active!;
    jumpTo(sim, hill.closesAt - 0.5);
    const seen = tickSeconds(sim, 2);
    expect(logLines(seen)).toContain('The hill in The Drakelands has fallen.');
    expect(logLines(seen).filter((l) => l.startsWith('Hill ranking'))).toEqual([]);
    expect(vaultPvp(sim, a)).toBe(0);
  });

  it('a holder who left the realm before the fall is skipped', () => {
    const { sim, pids } = hillWorld(['Aleph', 'Bet']);
    const [a, b] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 65);
    bankHoldFloor(sim, `solo:${a}`);
    sim.removePlayer(a);
    const credit = vi.fn(() => true);
    endHillNow(sim.ctx, credit);
    expect(credit).not.toHaveBeenCalled();
    expect(vaultPvp(sim, b)).toBe(0);
  });

  it('/dev hill end resolves the fall the same way, through the injected credit', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 65);
    bankHoldFloor(sim, `solo:${a}`);
    const credit = vi.fn(() => true);
    sim.events = [];
    expect(endHillNow(sim.ctx, credit)).not.toBeNull();
    expect(credit).toHaveBeenCalledTimes(1);
    expect(credit).toHaveBeenCalledWith(sim.ctx, a);
    expect(logLines(sim.events, a)).toContain(HILL_VAULT_LINE);
  });

  it('says nothing when the vault row is already full (the credit did not move it)', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 65);
    bankHoldFloor(sim, `solo:${a}`);
    const credit = vi.fn(() => false);
    sim.events = [];
    endHillNow(sim.ctx, credit);
    expect(credit).toHaveBeenCalledTimes(1);
    expect(logLines(sim.events, a)).not.toContain(HILL_VAULT_LINE);
  });

  it('the real credit stops at the row cap of five', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(recordWeeklyPvpWin(sim.ctx, a));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(vaultPvp(sim, a)).toBe(5);
  });

  it('a caller that passes no credit (a test driving the pass) pays no vault point', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 65);
    bankHoldFloor(sim, `solo:${a}`);
    sim.events = [];
    expect(NO_HILL_VAULT_CREDIT(sim.ctx, a)).toBe(false);
    endHillNow(sim.ctx);
    expect(vaultPvp(sim, a)).toBe(0);
    expect(logLines(sim.events, a)).not.toContain(HILL_VAULT_LINE);
    // The standings are still told: only the vault credit is the host's.
    expect(logLines(sim.events).some((l) => l.startsWith('Hill ranking #1: Aleph'))).toBe(true);
  });

  it('a realm switched off mid-stand drops the hill with no standings and no point', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + 10);
    (sim as unknown as { worldPvpDisabled: boolean }).worldPvpDisabled = true;
    const seen = tickSeconds(sim, 2);
    expect(sim.hillState.active).toBeNull();
    expect(logLines(seen).filter((l) => l.startsWith('Hill ranking'))).toEqual([]);
    expect(vaultPvp(sim, a)).toBe(0);
  });
});

describe('the hold floor', () => {
  it('a lone minute on an empty hill tops the standings but pays no vault point', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    const hill = sim.hillState.active!;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_INSIDE_SECONDS + 5);
    outside(sim, a);
    const record = hill.holds.get(`solo:${a}`)!;
    expect(record.holders.get(a)).toBeGreaterThanOrEqual(HILL_VAULT_MIN_INSIDE_SECONDS);
    expect(record.seconds).toBeLessThan(HILL_VAULT_MIN_HOLD_SECONDS);
    jumpTo(sim, hill.closesAt - 0.5);
    const seen = tickSeconds(sim, 2);
    expect(sim.hillState.active).toBeNull();
    expect(logLines(seen)).toContain('Hill ranking #1: Aleph, held 2 minutes.');
    expect(vaultPvp(sim, a)).toBe(0);
    expect(logLines(seen, a)).not.toContain(HILL_VAULT_LINE);
  });

  it('a lone player who really holds the hill ten minutes is paid', () => {
    const { sim, pids } = hillWorld(['Aleph']);
    const [a] = pids;
    const hill = sim.hillState.active!;
    inside(sim, a);
    tickSeconds(sim, HILL_CAPTURE_SECONDS + HILL_VAULT_MIN_HOLD_SECONDS + 5);
    const record = hill.holds.get(`solo:${a}`)!;
    expect(record.seconds).toBeGreaterThanOrEqual(HILL_VAULT_MIN_HOLD_SECONDS);
    expect(record.seconds).toBeLessThan(HILL_VAULT_MIN_HOLD_SECONDS + 10);
    jumpTo(sim, hill.closesAt - 0.5);
    const seen = tickSeconds(sim, 2);
    expect(logLines(seen)).toContain('Hill ranking #1: Aleph, held 11 minutes.');
    expect(vaultPvp(sim, a)).toBe(1);
    expect(logLines(seen, a)).toContain(HILL_VAULT_LINE);
  });
});
