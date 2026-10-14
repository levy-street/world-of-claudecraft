// Pins for the King of the Hill pure rules (src/sim/pvp/hill_rules.ts): the
// standing (parties only, any level), the group key, the strict-maximum
// leader, the majority verdict, the contest clocks (paused, never reset, by a
// rival), the successor a hold follows across a group change, the spot probe, the
// three-hour schedule and the circle test.
import { describe, expect, it } from 'vitest';
import {
  HILL_ACCRUAL_SECONDS,
  HILL_CAPTURE_SECONDS,
  HILL_DURATION_SECONDS,
  HILL_FIRST_WINDOW_AT_SECONDS,
  HILL_LATEST_WARN_OFFSET_SECONDS,
  HILL_NOTICE_SECONDS,
  HILL_RADIUS,
  HILL_RAMP_MAX_HONOR,
  HILL_RAMP_STEP_HONOR,
  HILL_RAMP_STEP_SECONDS,
  HILL_VAULT_MIN_HOLD_SECONDS,
  HILL_VAULT_MIN_INSIDE_SECONDS,
  HILL_WARNING_SECONDS,
  HILL_WINDOW_SECONDS,
  type HillSpotProbe,
  hillChallengeStands,
  hillContains,
  hillGroupKey,
  hillHonorPerPayout,
  hillLeader,
  hillMinutesUntil,
  hillProgressStep,
  hillSpotIsOpen,
  hillStanding,
  hillSuccessorKey,
  hillTimes,
  hillTimesFrom,
  hillWindowAt,
} from '../src/sim/pvp/hill_rules';

describe('the tuning literals the copy and the docs quote', () => {
  it('pins the radius, the window, the warning, the stand, the capture length and the trickle', () => {
    expect(HILL_RADIUS).toBe(50);
    expect(HILL_WINDOW_SECONDS).toBe(3 * 3_600);
    expect(HILL_WARNING_SECONDS).toBe(15 * 60);
    expect(HILL_DURATION_SECONDS).toBe(45 * 60);
    expect(HILL_FIRST_WINDOW_AT_SECONDS).toBe(120);
    expect(HILL_LATEST_WARN_OFFSET_SECONDS).toBe(2 * 3_600);
    expect(HILL_CAPTURE_SECONDS).toBe(30);
    expect(HILL_ACCRUAL_SECONDS).toBe(60);
    expect(HILL_RAMP_STEP_SECONDS).toBe(5 * 60);
    expect(HILL_RAMP_STEP_HONOR).toBe(2);
    expect(HILL_RAMP_MAX_HONOR).toBe(12);
    // Owner spec 2026-09-29: the realm is reminded every five minutes, and the
    // Weekly Vault point needs a full minute inside.
    expect(HILL_NOTICE_SECONDS).toBe(5 * 60);
    expect(HILL_VAULT_MIN_INSIDE_SECONDS).toBe(60);
    // Owner decision 2026-10-05: the longest hold pays no vault point unless
    // it lasted ten minutes in total.
    expect(HILL_VAULT_MIN_HOLD_SECONDS).toBe(10 * 60);
  });
});

describe('hillStanding and hillGroupKey', () => {
  it('counts a party member or a lone player of any level, never a raid member', () => {
    expect(hillStanding(null)).toBe('counted');
    expect(hillStanding({ raid: false })).toBe('counted');
    expect(hillStanding({ raid: true })).toBe('raid');
  });

  it('keys a party member by the party, a lone player by themselves, and a raid not at all', () => {
    expect(hillGroupKey(7, { id: 3, raid: false })).toBe('party:3');
    expect(hillGroupKey(8, { id: 3, raid: false })).toBe('party:3');
    expect(hillGroupKey(7, { id: 3, raid: true })).toBeNull();
    expect(hillGroupKey(7, null)).toBe('solo:7');
    expect(hillGroupKey(8, null)).not.toBe(hillGroupKey(7, null));
  });
});

describe('hillLeader', () => {
  it('is the strict maximum, null on a tie or an empty hill, ignoring zero rows', () => {
    expect(hillLeader(new Map())).toBeNull();
    expect(hillLeader(new Map([['a', 0]]))).toBeNull();
    expect(hillLeader(new Map([['a', 2]]))).toEqual({ key: 'a', count: 2 });
    expect(
      hillLeader(
        new Map([
          ['a', 2],
          ['b', 3],
        ]),
      ),
    ).toEqual({ key: 'b', count: 3 });
    expect(
      hillLeader(
        new Map([
          ['a', 3],
          ['b', 3],
        ]),
      ),
    ).toBeNull();
    // A tie that is later beaten resolves; order of insertion never matters.
    expect(
      hillLeader(
        new Map([
          ['a', 3],
          ['b', 3],
          ['c', 4],
        ]),
      ),
    ).toEqual({ key: 'c', count: 4 });
    expect(
      hillLeader(
        new Map([
          ['c', 4],
          ['a', 3],
          ['b', 3],
        ]),
      ),
    ).toEqual({ key: 'c', count: 4 });
  });
});

describe('hillChallengeStands', () => {
  it('needs a strict majority over the holder present, and beats an absent holder', () => {
    expect(hillChallengeStands(1, 0)).toBe(true);
    expect(hillChallengeStands(2, 1)).toBe(true);
    expect(hillChallengeStands(1, 1)).toBe(false);
    expect(hillChallengeStands(1, 2)).toBe(false);
    expect(hillChallengeStands(0, 0)).toBe(false);
  });
});

describe('hillProgressStep', () => {
  const step = (
    prev: [string, number][],
    counts: [string, number][],
    challenger: string | null,
    holder: string | null = null,
  ) => [...hillProgressStep(new Map(prev), new Map(counts), challenger, holder, 1)];

  it('banks a pass for the challenger, starting a fresh clock at one pass', () => {
    expect(step([['a', 10]], [['a', 2]], 'a')).toEqual([['a', 11]]);
    expect(step([], [['a', 1]], 'a')).toEqual([['a', 1]]);
  });

  it('pauses, never resets, a group still inside that is not the leader', () => {
    // A tie: nobody leads, both clocks hold still.
    expect(
      step(
        [['a', 10]],
        [
          ['a', 1],
          ['b', 1],
        ],
        null,
      ),
    ).toEqual([['a', 10]]);
    // A bigger group walked in: it counts, the old challenger waits.
    expect(
      step(
        [['a', 10]],
        [
          ['a', 1],
          ['b', 2],
        ],
        'b',
      ),
    ).toEqual([
      ['a', 10],
      ['b', 1],
    ]);
  });

  it('drops the clock of a group with nobody counted inside (dead or gone)', () => {
    expect(step([['a', 25]], [['b', 1]], 'b')).toEqual([['b', 1]]);
    expect(step([['a', 25]], [['a', 0]], null)).toEqual([]);
  });

  it('never carries a clock for the holder, and leaves its input untouched', () => {
    const prev = new Map([['h', 5]]);
    expect([...hillProgressStep(prev, new Map([['h', 3]]), null, 'h', 1)]).toEqual([]);
    expect([...prev]).toEqual([['h', 5]]);
  });
});

describe('hillSuccessorKey', () => {
  it('follows a lone holder into the party they formed', () => {
    expect(hillSuccessorKey([{ key: 'party:7', inside: true }])).toBe('party:7');
  });

  it('prefers the key with most members inside, then most members, then the earliest', () => {
    expect(
      hillSuccessorKey([
        { key: 'solo:1', inside: false },
        { key: 'solo:2', inside: true },
      ]),
    ).toBe('solo:2');
    expect(
      hillSuccessorKey([
        { key: 'solo:1', inside: false },
        { key: 'party:3', inside: false },
        { key: 'party:3', inside: false },
      ]),
    ).toBe('party:3');
    expect(
      hillSuccessorKey([
        { key: 'solo:1', inside: true },
        { key: 'solo:2', inside: true },
      ]),
    ).toBe('solo:1');
  });

  it('is null when no member still counts', () => {
    expect(hillSuccessorKey([])).toBeNull();
    expect(hillSuccessorKey([{ key: null, inside: true }])).toBeNull();
  });
});

describe('hillSpotIsOpen', () => {
  const open = (over: Partial<HillSpotProbe> = {}): HillSpotProbe => ({
    wet: () => false,
    steep: () => false,
    blocked: () => false,
    zoneIdAt: () => 'zone',
    ...over,
  });

  it('accepts dry, flat, clear ground wholly inside the zone', () => {
    expect(hillSpotIsOpen(open(), 'zone', 0, 0, HILL_RADIUS)).toBe(true);
  });

  it('refuses the wrong zone at the centre or on the rim', () => {
    expect(hillSpotIsOpen(open({ zoneIdAt: () => 'other' }), 'zone', 0, 0, 50)).toBe(false);
    const rimOut: HillSpotProbe['zoneIdAt'] = (x) => (x > 40 ? 'other' : 'zone');
    expect(hillSpotIsOpen(open({ zoneIdAt: rimOut }), 'zone', 0, 0, 50)).toBe(false);
    expect(hillSpotIsOpen(open({ zoneIdAt: () => null }), 'zone', 0, 0, 50)).toBe(false);
  });

  it('refuses water at the centre or on the rim, and steepness at the centre', () => {
    expect(hillSpotIsOpen(open({ wet: (x, z) => x === 0 && z === 0 }), 'zone', 0, 0, 50)).toBe(
      false,
    );
    expect(hillSpotIsOpen(open({ wet: (_x, z) => z < -40 }), 'zone', 0, 0, 50)).toBe(false);
    // A pond wholly inside the circle, away from the rim: the inner ring sees it.
    expect(
      hillSpotIsOpen(open({ wet: (x, z) => Math.hypot(x - 25, z) < 8 }), 'zone', 0, 0, 50),
    ).toBe(false);
    expect(hillSpotIsOpen(open({ steep: () => true }), 'zone', 0, 0, 50)).toBe(false);
  });

  it('refuses a collider at the centre only, with the wide clearance', () => {
    const seen: number[] = [];
    const probe = open({
      blocked: (_x, _z, r) => {
        seen.push(r);
        return false;
      },
    });
    expect(hillSpotIsOpen(probe, 'zone', 0, 0, 50)).toBe(true);
    expect(seen).toEqual([6]); // the rings are never collider-checked (forests)
    expect(hillSpotIsOpen(open({ blocked: (_x, _z, r) => r === 6 }), 'zone', 0, 0, 50)).toBe(false);
    expect(hillSpotIsOpen(open({ blocked: (x) => x > 45 }), 'zone', 0, 0, 50)).toBe(true);
  });
});
describe('the three-hour schedule', () => {
  it('opens the first window two minutes in and one every three hours after', () => {
    expect(hillWindowAt(0)).toBe(-1);
    expect(hillWindowAt(119)).toBe(-1);
    expect(hillWindowAt(120)).toBe(0);
    expect(hillWindowAt(120 + 10_799)).toBe(0);
    expect(hillWindowAt(120 + 10_800)).toBe(1);
  });

  it('warns at the offset, rises 15 minutes on, falls 45 after, always inside the window', () => {
    expect(hillTimes(0, 0)).toEqual({ warnAt: 120, risesAt: 120 + 900, closesAt: 120 + 3_600 });
    expect(hillTimes(2, 600)).toEqual({
      warnAt: 120 + 21_600 + 600,
      risesAt: 120 + 21_600 + 1_500,
      closesAt: 120 + 21_600 + 4_200,
    });
    // The latest offset ends exactly at the window's close; past it clamps.
    expect(hillTimes(0, HILL_LATEST_WARN_OFFSET_SECONDS).closesAt).toBe(120 + 10_800);
    expect(hillTimes(0, 99_999)).toEqual(hillTimes(0, HILL_LATEST_WARN_OFFSET_SECONDS));
    expect(hillTimes(0, -5)).toEqual(hillTimes(0, 0));
    expect(hillWindowAt(hillTimes(4, 1234).closesAt - 1)).toBe(4);
  });

  it('slides a late warning whole, keeping the full warning and stand', () => {
    const planned = hillTimes(0, 600);
    expect(hillTimesFrom(planned, planned.warnAt - 30)).toBe(planned);
    expect(hillTimesFrom(planned, planned.warnAt)).toBe(planned);
    expect(hillTimesFrom(planned, planned.warnAt + 100)).toEqual({
      warnAt: planned.warnAt + 100,
      risesAt: planned.warnAt + 100 + HILL_WARNING_SECONDS,
      closesAt: planned.warnAt + 100 + HILL_WARNING_SECONDS + HILL_DURATION_SECONDS,
    });
  });

  it('counts whole minutes up, never below zero', () => {
    expect(hillMinutesUntil(900, 0)).toBe(15);
    expect(hillMinutesUntil(900, 1)).toBe(15);
    expect(hillMinutesUntil(900, 841)).toBe(1);
    expect(hillMinutesUntil(900, 900)).toBe(0);
    expect(hillMinutesUntil(900, 1_000)).toBe(0);
  });
});

describe('hillContains', () => {
  it('is the closed disc', () => {
    const hill = { x: 100, z: -50, radius: 50 };
    expect(hillContains(hill, 100, -50)).toBe(true);
    expect(hillContains(hill, 150, -50)).toBe(true);
    expect(hillContains(hill, 150.1, -50)).toBe(false);
    expect(hillContains(hill, 100 + 35, -50 + 35)).toBe(true);
    expect(hillContains(hill, 100 + 36, -50 + 36)).toBe(false);
  });
});

describe('hillHonorPerPayout: the hold ramp', () => {
  it('pays 2 a minute for the first five minutes, +2 each five after, capped at 12', () => {
    expect(hillHonorPerPayout(0)).toBe(2);
    expect(hillHonorPerPayout(299)).toBe(2);
    expect(hillHonorPerPayout(300)).toBe(4);
    expect(hillHonorPerPayout(10 * 60)).toBe(6);
    expect(hillHonorPerPayout(20 * 60)).toBe(10);
    expect(hillHonorPerPayout(25 * 60)).toBe(12);
    expect(hillHonorPerPayout(45 * 60)).toBe(12);
    expect(hillHonorPerPayout(-5)).toBe(2);
  });

  it('pays about 380 for a full uncontested stand (owner tuning: doubled with the battlegrounds)', () => {
    // One payout per minute of the 45-minute stand after the 60-second capture.
    let total = 0;
    for (let minute = 1; minute <= 44; minute++) total += hillHonorPerPayout(minute * 60);
    expect(total).toBeGreaterThanOrEqual(360);
    expect(total).toBeLessThanOrEqual(400);
  });
});
