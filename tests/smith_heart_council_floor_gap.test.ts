// The Hammer Council's floor gap (src/sim/encounters/smith_heart/
// council_floor_gap.ts and council_floor.ts): the pure rule, then a REAL Sim
// claim where two floor mechanics come due together and start a gap apart,
// the delayed one's cadence kept, the dev triggers bypassing the gap, the
// Wrath guard (normal: Wake the Stone and Mountain's Rush never run into a
// Wrath; heroic: they may), and the same seed giving the same fight.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_CASTS,
  type CouncilFightState,
  councilScopeForDev,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import {
  clearOfWrath,
  RUSH_FLOOR_SECONDS,
  wakeSeconds,
} from '../src/sim/encounters/smith_heart/council_floor';
import {
  FLOOR_PRIORITY,
  type FloorCandidate,
  type FloorGapState,
  type FloorMechanic,
  floorOpen,
  maxFloorHold,
  nextAfterHold,
  runFloorGate,
} from '../src/sim/encounters/smith_heart/council_floor_gap';
import { DT, type Entity } from '../src/sim/types';
import { type CouncilFight, councilFight } from './helpers/council_fight';

const GAP = T.floorGap;

describe('the floor gap rule (pure)', () => {
  it('is tuned at 4 s and lists the floor mechanics, the Wrath first', () => {
    expect(GAP).toBe(4);
    expect(FLOOR_PRIORITY).toEqual(['wrath', 'echo', 'wake', 'rush', 'rock']);
  });

  it('opens with no floor start yet, and a gap after the last one', () => {
    expect(floorOpen(null, 0, GAP)).toBe(true);
    expect(floorOpen(10, 13.95, GAP)).toBe(false);
    expect(floorOpen(10, 14, GAP)).toBe(true);
  });

  it('takes the wait off the next interval, never below one gap', () => {
    expect(nextAfterHold(25, 0, GAP)).toBe(25);
    expect(nextAfterHold(25, 3.5, GAP)).toBe(21.5);
    expect(nextAfterHold(5, 3, GAP)).toBe(GAP);
    expect(nextAfterHold(25, -1, GAP)).toBe(25);
  });

  /** Drive the gate with fake mechanics due at given clocks, each resetting
   *  its own clock the way the council's do. */
  function drive(due: Partial<Record<FloorMechanic, number>>, seconds: number) {
    const st: FloorGapState = { clock: 0, lastFloorAt: null, floorHeld: {} };
    const at = { ...due };
    const log: { key: FloorMechanic; clock: number; held: number }[] = [];
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      st.clock = i * DT;
      const cands: FloorCandidate[] = (Object.keys(at) as FloorMechanic[]).map((key) => ({
        key,
        due: st.clock >= (at[key] ?? Infinity) - 1e-9,
        start: () => {
          log.push({ key, clock: st.clock, held: st.floorHeld[key] ?? 0 });
          st.floorHeld[key] = 0;
          at[key] = Infinity;
          return true;
        },
      }));
      // Shuffled on purpose: the order is the gate's, not the caller's.
      runFloorGate(st, GAP, DT, cands.reverse());
    }
    return log;
  }

  it('spaces mechanics due together by a gap each, in the stable order, and every one fires', () => {
    const log = drive({ rock: 1, wake: 1, wrath: 1, echo: 1, rush: 1 }, 30);
    expect(log.map((l) => l.key)).toEqual(['wrath', 'echo', 'wake', 'rush', 'rock']);
    for (let i = 1; i < log.length; i++) {
      expect(log[i].clock - log[i - 1].clock).toBeGreaterThanOrEqual(GAP - 1e-9);
      expect(log[i].clock - log[i - 1].clock).toBeLessThan(GAP + DT + 1e-9);
    }
    // Each waited what it was held, and that is what comes off its next interval.
    for (const l of log) expect(l.held).toBeCloseTo(l.clock - 1, 5);
  });

  it('a mechanic due shortly after another waits only the rest of the gap', () => {
    const log = drive({ rock: 2, wake: 3.5 }, 12);
    expect(log[0]).toMatchObject({ key: 'rock' });
    expect(log[0].clock).toBeCloseTo(2, 5);
    expect(log[1].key).toBe('wake');
    expect(log[1].clock).toBeCloseTo(6, 5);
    expect(log[1].held).toBeCloseTo(2.5, 5);
  });

  it('one that cannot start (its caster busy) never blocks the rest', () => {
    const st: FloorGapState = { clock: 5, lastFloorAt: null, floorHeld: {} };
    const started = runFloorGate(st, GAP, DT, [
      { key: 'wrath', due: true, start: () => false },
      { key: 'rock', due: true, start: () => true },
    ]);
    expect(started).toEqual(['rock']);
    expect(st.lastFloorAt).toBe(5);
    expect(st.floorHeld.wrath ?? 0).toBe(0);
  });

  it('caps a wait at one gap per floor mechanic (a mechanic that could not start anyway)', () => {
    const st: FloorGapState = { clock: 0, lastFloorAt: 0, floorHeld: {} };
    for (let i = 0; i < 2000; i++) {
      st.lastFloorAt = st.clock;
      runFloorGate(st, GAP, DT, [{ key: 'rock', due: true, start: () => true }]);
      st.clock += DT;
    }
    expect(st.floorHeld.rock).toBeCloseTo(maxFloorHold(GAP), 5);
  });
});

// ---- over a real claim ----------------------------------------------------------------------

type Fight = CouncilFight & { st: CouncilFightState };

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  st.pulseTimer = 999;
  st.rushTimer = 999;
  st.energy = 0;
}

function pulled(n = 6, seed = 17): Fight {
  const f = councilFight(n, seed);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  st.lastFloorAt = null;
  return { ...f, st };
}

/** Tick until `cast` starts on `who` (the clock it started at), or null. */
function untilBar(f: Fight, who: () => Entity | null, cast: string, maxTicks: number) {
  for (let i = 0; i < maxTicks; i++) {
    f.tick();
    if (who()?.castingAbility === cast) return f.st.clock;
  }
  return null;
}

describe('the floor gap over a real claim', () => {
  it('Wake the Stone and Falling Rock due on one tick start a gap apart, the wake first', () => {
    const f = pulled();
    const slab = () => f.bodies().singer;
    f.st.wakeTimer = DT / 2;
    f.st.rockTimer = DT / 2;
    f.tick();
    const t0 = f.st.clock;
    expect(slab()?.castingAbility).toBe(COUNCIL_CASTS.wake);
    expect(f.st.lastFloorAt).toBeCloseTo(t0, 9);
    // Without the gap the rock would start after the wake's bar and its
    // 1.2 s breath (3.7 s); the gap holds it to 4 s.
    const t1 = untilBar(f, slab, COUNCIL_CASTS.rock, 200);
    expect(t1).not.toBeNull();
    expect((t1 as number) - t0).toBeGreaterThanOrEqual(GAP - 1e-6);
    expect((t1 as number) - t0).toBeLessThan(GAP + 2 * DT);
  });

  it("Mountain's Wrath and Falling Rock due together: the Wrath goes, the rock waits a gap", () => {
    const f = pulled();
    f.st.energy = T.energyMax;
    f.st.rockTimer = DT / 2;
    f.tick();
    const t0 = f.st.clock;
    expect(f.bodies().guardian?.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(f.bodies().singer?.castingAbility).toBeNull();
    const t1 = untilBar(f, () => f.bodies().singer, COUNCIL_CASTS.rock, 200);
    expect(t1).not.toBeNull();
    expect((t1 as number) - t0).toBeGreaterThanOrEqual(GAP - 1e-6);
    expect((t1 as number) - t0).toBeLessThan(GAP + 2 * DT);
  });

  it("the delayed rock's next start stays on its own cadence (no drift)", () => {
    const f = pulled();
    const slab = () => f.bodies().singer;
    f.st.wakeTimer = DT / 2;
    f.st.rockTimer = DT / 2;
    f.tick();
    // The rock was due on this tick: its cadence is this clock plus 25 s steps.
    const due = f.st.clock;
    f.st.wakeTimer = 999;
    const first = untilBar(f, slab, COUNCIL_CASTS.rock, 200) as number;
    expect(first - due).toBeGreaterThanOrEqual(GAP - 1e-6);
    // Its next interval is the cadence less the wait, the wait spent.
    expect(f.st.rockTimer).toBeCloseTo(T.rockEvery - (first - due), 1);
    expect(f.st.floorHeld.rock ?? 0).toBe(0);
    // Let the bar and its soak run out, then wait for the next rock.
    f.tick(Math.round((T.rockCast + 0.5) / DT));
    const second = untilBar(f, slab, COUNCIL_CASTS.rock, 30 * 20) as number;
    expect(second).not.toBeNull();
    expect(second - due).toBeGreaterThan(T.rockEvery - 2 * DT);
    expect(second - due).toBeLessThan(T.rockEvery + 2 * DT);
  });

  it("a delayed Wrath lands with its wait's worth of energy, so the next one keeps the rhythm", () => {
    const f = pulled();
    // A rock takes the floor first, then the energy fills: the Wrath waits.
    f.st.rockTimer = DT / 2;
    f.tick();
    f.st.rockTimer = 999;
    f.st.energy = T.energyMax;
    const start = untilBar(f, () => f.bodies().guardian, COUNCIL_CASTS.wrath, 200) as number;
    const waited = f.st.floorHeld.wrath ?? 0;
    expect(waited).toBeGreaterThan(GAP - 1 - 1e-6);
    expect(start).toBeGreaterThan(0);
    // The bar lands: the energy starts at the wait's worth, not at 0.
    f.tick(Math.round(T.wrathCast / DT) + 1);
    expect(f.bodies().guardian?.castingAbility).not.toBe(COUNCIL_CASTS.wrath);
    expect(f.st.wraths).toBe(1);
    const perSecond = T.energyMax / T.energyFillSeconds;
    expect(f.st.energy).toBeCloseTo(waited * perSecond, 0);
    expect(f.st.floorHeld.wrath ?? 0).toBe(0);
  });

  it('the dev triggers fire at once inside the gap, and stamp it', () => {
    const f = pulled();
    f.st.rockTimer = DT / 2;
    f.tick();
    const t0 = f.st.clock;
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.rock);
    f.tick(10);
    // Half a second in: the gap is closed, the dev Wrath goes anyway.
    f.dev('/dev heart council wrath');
    expect(f.bodies().guardian?.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(f.st.lastFloorAt).toBeGreaterThan(t0);
    const stamp = f.st.lastFloorAt as number;
    // And Wake the Stone (cutting the rock's bar) the same.
    f.dev('/dev heart council wake');
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.wake);
    expect(f.st.lastFloorAt).toBe(stamp);
  });

  it('a whole fight keeps every floor start a gap apart, the same seed giving the same fight', () => {
    const run = () => {
      const f = councilFight(6, 23);
      f.dev('/dev heart council pull');
      const starts: number[] = [];
      let last: number | null = null;
      for (let i = 0; i < 150 * 20; i++) {
        f.tick();
        const st = f.state();
        if (!st) break;
        if (st.lastFloorAt !== null && st.lastFloorAt !== last) {
          starts.push(Math.round(st.lastFloorAt * 1000) / 1000);
          last = st.lastFloorAt;
        }
      }
      const st = f.state();
      return {
        starts,
        wraths: st?.wraths,
        casts: st?.casts,
        hp: f.players.map((p) => p.hp),
        rng: f.sim.ctx.rng.next(),
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // The Wrath, the wakes and the rocks of two and a half minutes.
    expect(a.starts.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < a.starts.length; i++) {
      expect(a.starts[i] - a.starts[i - 1]).toBeGreaterThanOrEqual(GAP - 1e-3);
    }
  });
});

describe('the Wrath guard: normal keeps the Wake and the Rush clear of a Wrath', () => {
  /** Energy that puts the next Wrath bar `seconds` away on the Guardian's fill. */
  const energyFor = (seconds: number) =>
    T.energyMax - (seconds * T.energyMax) / T.energyFillSeconds;

  it('normal: neither starts when its floor time would run into the Wrath bar, and both wait for it to land', () => {
    const f = pulled();
    const s = councilScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('scope');
    // Plenty of time: both clear.
    f.st.energy = energyFor(30);
    expect(clearOfWrath(s, wakeSeconds(s))).toBe(true);
    expect(clearOfWrath(s, RUSH_FLOOR_SECONDS)).toBe(true);
    // The Wrath's bar 5 s away: the Wake (7.5 s of marks) is held, the Rush too.
    f.st.energy = energyFor(5);
    expect(clearOfWrath(s, wakeSeconds(s))).toBe(false);
    expect(clearOfWrath(s, RUSH_FLOOR_SECONDS)).toBe(false);
    // Over a real fight: due now, they wait for the Wrath to land.
    f.st.wakeTimer = DT / 2;
    f.st.rushTimer = DT / 2;
    let wrathStart: number | null = null;
    let wrathLand: number | null = null;
    let wake: number | null = null;
    let rush: number | null = null;
    for (let i = 0; i < 20 * 25; i++) {
      f.tick();
      const g = f.bodies().guardian;
      const c = f.bodies().singer;
      if (wrathStart === null && g?.castingAbility === COUNCIL_CASTS.wrath) wrathStart = f.st.clock;
      if (wrathLand === null && f.st.wraths > 0) wrathLand = f.st.clock;
      if (wake === null && c?.castingAbility === COUNCIL_CASTS.wake) wake = f.st.clock;
      if (rush === null && g?.castingAbility === COUNCIL_CASTS.rush) rush = f.st.clock;
    }
    expect(wrathStart).not.toBeNull();
    expect(wrathLand).not.toBeNull();
    expect(wake).not.toBeNull();
    expect(rush).not.toBeNull();
    expect(wake as number).toBeGreaterThanOrEqual(wrathLand as number);
    expect(rush as number).toBeGreaterThanOrEqual(wrathLand as number);
    // And the gap still holds between the two.
    expect(Math.abs((rush as number) - (wake as number))).toBeGreaterThanOrEqual(GAP - 1e-6);
  });

  it('heroic: they may run into a Wrath', () => {
    const f = pulled();
    f.dev('/dev heart council heroic on');
    const s = councilScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('scope');
    f.st.energy = energyFor(3);
    expect(clearOfWrath(s, wakeSeconds(s))).toBe(true);
    expect(clearOfWrath(s, RUSH_FLOOR_SECONDS)).toBe(true);
  });

  it('a whole normal fight: no Wake mark and no Rush mark is up while a Wrath bar runs', () => {
    const f = councilFight(8, 29);
    f.dev('/dev heart council pull');
    let overlaps = 0;
    let wraths = 0;
    for (let i = 0; i < 20 * 200; i++) {
      f.tick();
      const st = f.state();
      if (!st) break;
      const g = f.bodies().guardian;
      if (g?.castingAbility !== COUNCIL_CASTS.wrath) continue;
      wraths++;
      if (st.wakeMarks.length > 0 || st.rush !== null) overlaps++;
      if (f.players.some((p) => p.auras.some((a) => a.id === 'heart_mountains_rush_mark')))
        overlaps++;
    }
    expect(wraths).toBeGreaterThan(0);
    expect(overlaps).toBe(0);
  });
});
