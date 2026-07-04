// Unit tests for the pure Gravemarch battleground helpers
// (src/sim/social/battleground.ts): team packing, respawn timer math, the
// timeout resolution ladder, bulwark target priority, structural shielding,
// and the Knell silence window bookkeeping. No Sim instance needed.
import { describe, expect, it } from 'vitest';
import type { BgStructureDef, BgTeam } from '../src/sim/battleground_layout';
import { BG_STRUCTURES } from '../src/sim/battleground_layout';
import { BATTLEGROUND_X_MIN, DELVE_BAND_X_MAX, DELVE_LIST, delveOrigin } from '../src/sim/data';
import {
  BG_RESPAWN_MAX,
  type BgQueueUnit,
  bgPickBulwarkTarget,
  bgRespawnTime,
  bgStructureShielded,
  bgTimeoutWinner,
  packBgTeams,
  splitBgTeams,
} from '../src/sim/social/battleground';

let nextPid = 1;
function unit(size: number, rating = 1500): BgQueueUnit {
  const pids: number[] = [];
  for (let i = 0; i < size; i++) pids.push(nextPid++);
  return { pids, rating, queuedAt: 0 };
}

describe('battleground module: team packing', () => {
  it('packs ten solos into two teams of five, anchor on team A', () => {
    const units = Array.from({ length: 10 }, () => unit(1));
    const pack = packBgTeams(units)!;
    expect(pack).toBeTruthy();
    expect(pack.a.length).toBe(5);
    expect(pack.b.length).toBe(5);
    expect(pack.used.length).toBe(10);
    expect(pack.a).toContain(units[0].pids[0]); // the anchor seats on A
  });

  it('keeps premades intact: a 3-stack + 2-stack land on one team together', () => {
    const trio = unit(3);
    const duo = unit(2);
    const solos = Array.from({ length: 5 }, () => unit(1));
    const pack = packBgTeams([trio, duo, ...solos])!;
    expect(pack).toBeTruthy();
    // the anchor trio seats whole on team A
    for (const pid of trio.pids) expect(pack.a).toContain(pid);
    // every used unit's pids land on ONE side, never split
    for (const u of pack.used) {
      const onA = u.pids.every((p) => pack.a.includes(p));
      const onB = u.pids.every((p) => pack.b.includes(p));
      expect(onA || onB).toBe(true);
    }
  });

  it('prefers rating-nearest candidates to the anchor', () => {
    const anchor = unit(1, 1500);
    const near = Array.from({ length: 9 }, () => unit(1, 1510));
    const far = Array.from({ length: 9 }, () => unit(1, 2400));
    // far units queued earlier than near ones: rating proximity must still win
    const pack = packBgTeams([anchor, ...far, ...near])!;
    const seated = new Set(pack.used);
    expect(seated.has(anchor)).toBe(true);
    for (const u of near) expect(seated.has(u)).toBe(true);
    for (const u of far) expect(seated.has(u)).toBe(false);
  });

  it('returns null when ten seats cannot be filled', () => {
    expect(packBgTeams(Array.from({ length: 9 }, () => unit(1)))).toBe(null);
    expect(packBgTeams([])).toBe(null);
  });

  it('skips a selection that cannot split 5/5 (4+3+3) and finds a legal one', () => {
    // 4+3+3 = 10 but cannot split into 5/5; adding solos gives a legal pack.
    expect(packBgTeams([unit(4), unit(3), unit(3)])).toBe(null);
    const four = unit(4);
    const threeA = unit(3);
    const threeB = unit(3);
    const solos = [unit(1), unit(1), unit(1)];
    const pack = packBgTeams([four, threeA, threeB, ...solos])!;
    expect(pack).toBeTruthy();
    expect(pack.a.length).toBe(5);
    expect(pack.b.length).toBe(5);
  });

  it('splitBgTeams puts the anchor half on team A', () => {
    const a = unit(5);
    const b = unit(5);
    const split = splitBgTeams([a, b], 5, b)!;
    expect(split.a).toContain(b);
    expect(split.b).toContain(a);
  });
});

describe('battleground module: respawn timer math', () => {
  it('grows 8s + 1s per prior death + 1.5s per elapsed minute, capped at 30', () => {
    expect(bgRespawnTime(1, 0)).toBe(8);
    expect(bgRespawnTime(2, 0)).toBe(9);
    expect(bgRespawnTime(1, 60)).toBe(9.5);
    expect(bgRespawnTime(3, 130)).toBe(8 + 2 + 3);
    expect(bgRespawnTime(30, 900)).toBe(BG_RESPAWN_MAX);
  });
});

describe('battleground module: timeout resolution ladder', () => {
  const s = (team: BgTeam, alive: boolean, hpFrac = 1) => ({ team, alive, hpFrac });

  it('more enemy structures destroyed wins outright', () => {
    // team A destroyed two B structures; B destroyed one of A's
    const field = [s('A', false), s('A', true), s('B', false), s('B', false), s('B', true, 0.2)];
    expect(bgTimeoutWinner(field)).toBe('A');
  });

  it('falls back to higher own-structure hp fraction', () => {
    expect(bgTimeoutWinner([s('A', true, 0.9), s('B', true, 0.5)])).toBe('A');
    expect(bgTimeoutWinner([s('A', true, 0.4), s('B', true, 0.8)])).toBe('B');
  });

  it('draws within the 2 percent epsilon', () => {
    expect(bgTimeoutWinner([s('A', true, 0.5), s('B', true, 0.51)])).toBe(null);
    expect(bgTimeoutWinner([s('A', true, 1), s('B', true, 1)])).toBe(null);
  });
});

describe('battleground module: structural shielding', () => {
  const defs = new Map(BG_STRUCTURES.map((d) => [d.id, d]));
  const field = (dead: string[]) =>
    BG_STRUCTURES.map((def) => ({ def, alive: !dead.includes(def.id) }));

  it('outer bulwarks are never shielded; inner shielded while outer stands', () => {
    const f = field([]);
    expect(bgStructureShielded(f, defs.get('a_west_outer')!)).toBe(false);
    expect(bgStructureShielded(f, defs.get('a_west_inner')!)).toBe(true);
    const opened = field(['a_west_outer']);
    expect(bgStructureShielded(opened, defs.get('a_west_inner')!)).toBe(false);
    // the other lane's inner stays shielded
    expect(bgStructureShielded(opened, defs.get('a_east_inner')!)).toBe(true);
  });

  it('a warstone opens only when one of its own lanes lost BOTH bulwarks', () => {
    expect(bgStructureShielded(field([]), defs.get('a_warstone')!)).toBe(true);
    expect(bgStructureShielded(field(['a_west_outer']), defs.get('a_warstone')!)).toBe(true);
    expect(
      bgStructureShielded(field(['a_west_outer', 'a_west_inner']), defs.get('a_warstone')!),
    ).toBe(false);
    // either lane opens it
    expect(
      bgStructureShielded(field(['a_east_outer', 'a_east_inner']), defs.get('a_warstone')!),
    ).toBe(false);
    // cross-team lanes never open the other side's warstone
    expect(
      bgStructureShielded(field(['b_west_outer', 'b_west_inner']), defs.get('a_warstone')!),
    ).toBe(true);
  });
});

describe('battleground module: bulwark target priority', () => {
  it('a valid punished target holds the lock', () => {
    expect(bgPickBulwarkTarget(true, 7, [{ id: 1, d: 1 }], [{ id: 2, d: 1 }])).toBe(7);
  });

  it('prefers the nearest enemy minion over any player', () => {
    expect(
      bgPickBulwarkTarget(
        false,
        null,
        [
          { id: 1, d: 9 },
          { id: 2, d: 4 },
        ],
        [{ id: 3, d: 1 }],
      ),
    ).toBe(2);
  });

  it('falls back to the nearest enemy player, else none', () => {
    expect(
      bgPickBulwarkTarget(
        false,
        null,
        [],
        [
          { id: 3, d: 8 },
          { id: 4, d: 2 },
        ],
      ),
    ).toBe(4);
    expect(bgPickBulwarkTarget(false, null, [], [])).toBe(null);
  });
});

describe('battleground module: layout sanity for the drive code', () => {
  it('ships 8 bulwarks and 2 warstones, mirror-balanced', () => {
    expect(BG_STRUCTURES.length).toBe(10);
    expect(BG_STRUCTURES.filter((s) => s.kind === 'bulwark').length).toBe(8);
    expect(BG_STRUCTURES.filter((s) => s.kind === 'warstone').length).toBe(2);
    expect(BG_STRUCTURES.filter((s) => s.team === 'A').length).toBe(5);
  });
});

describe('battleground: instance-band ordering stays safe', () => {
  it('every delve band fits under DELVE_BAND_X_MAX and clear of the battleground band', () => {
    // isDelvePos was capped east when the battleground band was added; a
    // future delve whose index pushes its walls to the cap would silently
    // stop classifying as a delve. Pin the invariant so adding delve number
    // eight forces a reviewed decision about the band map.
    for (const d of DELVE_LIST) {
      const center = delveOrigin(d.index, 0).x;
      expect(center + 60).toBeLessThan(DELVE_BAND_X_MAX);
    }
    expect(DELVE_BAND_X_MAX).toBeLessThanOrEqual(BATTLEGROUND_X_MIN);
  });
});
