// Sexton Marrow's mechanics in the kills a playtest gives him (2026-10-12:
// "Sexton Marrow mechanics didn't go off"). His kit started on every pull, but
// too late for a strong party: the first Shovelful waited 6 s and the first
// grave 14 s of fight time that the Burial Toll freezes, and a Toll that came
// due mid-bar threw that bar away for its whole cadence. A real five player
// kill, through sim.tick(), on his real pool, at two paces and both
// difficulties: every mechanic goes off at least once.

import { describe, expect, it, vi } from 'vitest';
import {
  BELL_YARD,
  MARROW_BLOW_STACKS,
  MARROW_BONES_RISE,
  MARROW_BURIAL_TOLL,
  MARROW_GRAVE_OPENS,
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_ID,
  MARROW_MEASURE,
  MARROW_MEASURED,
  MARROW_SHOVELFUL,
  MARROW_TUNING,
} from '../src/sim/encounters/hollow_crypt';
import { combatProfileForMob } from '../src/sim/mob_combat';
import { DT, type Entity, RUN_SPEED } from '../src/sim/types';
import {
  boss,
  cryptFight,
  type Fight,
  put,
  run,
  tick,
  took,
  until,
} from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 240_000 });

const T = MARROW_TUNING;
const KEEP = new Set([MARROW_ID]);
const MID = { x: BELL_YARD.x, z: BELL_YARD.z };

interface Seen {
  seconds: number;
  shovelBars: number;
  measureBars: number;
  graves: number;
  tollRings: number;
  bones: number;
}

/** The party in the yard: the tank on him, four on the rim. */
function yard(difficulty: 'normal' | 'heroic'): { f: Fight; marrow: Entity; hold: () => void } {
  const f = cryptFight(difficulty, 4, KEEP);
  const marrow = boss(f, MARROW_ID);
  const party = [f.tank, ...f.others];
  const spots = [
    [MID.x, MID.z + 3.5],
    [MID.x - 14, MID.z - 9],
    [MID.x + 14, MID.z - 9],
    [MID.x - 14, MID.z + 11],
    [MID.x + 14, MID.z + 11],
  ];
  const hold = () => {
    for (const [i, p] of party.entries()) put(f, p, spots[i][0], spots[i][1]);
  };
  hold();
  f.sim.ctx.aggroMob(marrow, f.tank, false);
  return { f, marrow, hold };
}

/** Kill him for real at a steady pace: `damageSeconds` of party damage on his
 *  live pool (his two Tolls, immune, come on top), dealt through the damage
 *  path twice a second. */
function kill(difficulty: 'normal' | 'heroic', damageSeconds: number): { f: Fight; seen: Seen } {
  const { f, marrow, hold } = yard(difficulty);
  const party = [f.tank, ...f.others];
  const chunk = Math.ceil(marrow.maxHp / (damageSeconds * 2 * party.length));
  const seen: Seen = {
    seconds: 0,
    shovelBars: 0,
    measureBars: 0,
    graves: 0,
    tollRings: 0,
    bones: 0,
  };
  let last: string | null = null;
  let ticks = 0;
  for (; ticks < 120 / DT && !marrow.dead; ticks++) {
    if (ticks % 10 === 0) {
      for (const p of party) {
        if (marrow.dead) break;
        f.sim.ctx.dealDamage(p, marrow, chunk, false, 'physical', null, 'hit', false, {
          mult: p === f.tank ? 8 : 1,
        });
      }
    }
    tick(f, hold);
    const casting = marrow.castingAbility;
    if (casting !== last) {
      if (casting === MARROW_SHOVELFUL) seen.shovelBars++;
      else if (casting === MARROW_MEASURE) seen.measureBars++;
      else if (casting === MARROW_BURIAL_TOLL) seen.tollRings++;
      last = casting;
    }
  }
  expect(marrow.dead).toBe(true);
  seen.seconds = ticks * DT;
  seen.graves = f.cues.filter((c) => c.ability === MARROW_GRAVE_OPENS).length;
  seen.bones = f.cues.filter((c) => c.ability === MARROW_BONES_RISE).length;
  return { f, seen };
}

function expectWholeKit(f: Fight, seen: Seen, difficulty: 'normal' | 'heroic'): void {
  // Shovelful landed on the tank in front of him.
  expect(seen.shovelBars).toBeGreaterThanOrEqual(1);
  expect(took(f, f.tank, 'Shovelful')).toBeGreaterThan(0);
  // Measured for the Grave marked somebody and the grave caved in.
  expect(seen.measureBars).toBeGreaterThanOrEqual(1);
  expect(seen.graves).toBeGreaterThanOrEqual(1);
  // Both Tolls rang on everyone, and a grave gave up its dead.
  expect(seen.tollRings).toBe(T.tollAt.length);
  expect(
    f.hits.filter((h) => h.targetId === f.tank.id && h.ability === 'Burial Toll'),
  ).toHaveLength(T.tollAt.length);
  expect(seen.bones).toBeGreaterThanOrEqual(1);
  if (difficulty === 'heroic') expect(took(f, f.tank, "Gravedigger's Blow")).toBeGreaterThan(0);
}

describe('Sexton Marrow: his first uses come early', () => {
  it('measures at 2 s, swings the first Shovelful at 4 s and opens the first grave at 7 s', () => {
    const { f, marrow, hold } = yard('normal');
    marrow.maxHp = 1e6;
    marrow.hp = marrow.maxHp;
    const at = { measure: -1, shovel: -1, grave: -1 };
    let victimId = -1;
    for (let t = DT; t < 9; t += DT) {
      tick(f, hold);
      if (at.measure < 0 && marrow.castingAbility === MARROW_MEASURE) {
        at.measure = t;
        victimId = marrow.castTargetId ?? -1;
      }
      if (at.shovel < 0 && marrow.castingAbility === MARROW_SHOVELFUL) at.shovel = t;
      if (at.grave < 0 && f.cues.some((c) => c.ability === MARROW_GRAVE_OPENS)) at.grave = t;
    }
    // Seconds into the fight, to a few ticks (it was 9, 6 and 14).
    expect(at.measure).toBeGreaterThan(2 - DT / 2);
    expect(at.measure).toBeLessThan(2.25);
    expect(at.shovel).toBeGreaterThan(4 - DT / 2);
    expect(at.shovel).toBeLessThan(4.25);
    expect(at.grave).toBeGreaterThan(7 - DT / 2);
    expect(at.grave).toBeLessThan(7.4);
    // The damage is what it was: the cave-in's 42 to 52 on its mark, and the
    // Shovelful one and a half of his 32 to 50 swing, less the tank's armor.
    const caveIn = f.hits.filter((h) => h.targetId === victimId && h.ability === 'Open Grave');
    expect(caveIn).toHaveLength(1);
    expect(caveIn[0].amount).toBeGreaterThanOrEqual(42);
    expect(caveIn[0].amount).toBeLessThanOrEqual(52);
    const spade = f.hits.filter((h) => h.targetId === f.tank.id && h.ability === 'Shovelful');
    expect(spade).toHaveLength(1);
    expect(spade[0].amount).toBeGreaterThan(0);
    expect(spade[0].amount).toBeLessThanOrEqual(Math.round(50 * 1.5));
  });
});

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`Sexton Marrow killed for real (${difficulty})`, () => {
    it('shows his whole kit in a kill of about a minute', () => {
      const { f, seen } = kill(difficulty, 46);
      expect(seen.seconds).toBeGreaterThan(50);
      expect(seen.seconds).toBeLessThan(75);
      expectWholeKit(f, seen, difficulty);
    });

    it('still shows his whole kit when a strong party kills him in under half a minute', () => {
      const { f, seen } = kill(difficulty, 12);
      expect(seen.seconds).toBeLessThan(30);
      expectWholeKit(f, seen, difficulty);
    });
  });
}

describe('Sexton Marrow: a Toll that comes due mid-bar', () => {
  const BARS = [
    { what: 'shovel', id: MARROW_SHOVELFUL, cast: T.shovelCast, mode: 'normal' },
    { what: 'measure', id: MARROW_MEASURE, cast: T.measureCast, mode: 'normal' },
    { what: 'blow', id: MARROW_GRAVEDIGGERS_BLOW, cast: T.blowCast, mode: 'heroic' },
  ] as const;
  for (const bar of BARS) {
    it(`lets his ${bar.what} bar land first, then strides to the rope`, () => {
      const { f, marrow, hold } = yard(bar.mode);
      marrow.maxHp = 1e6;
      marrow.hp = marrow.maxHp;
      run(f, DT * 2, hold);
      const st = marrow.cryptBossFight;
      if (st?.kind !== 'marrow') throw new Error('no fight');
      st.shovelTimer = bar.what === 'shovel' ? 0 : 99;
      st.measureTimer = bar.what === 'measure' ? 0 : 99;
      st.blowTimer = bar.what === 'blow' ? 0 : 99;
      expect(until(f, () => marrow.castingAbility === bar.id, 1, hold)).toBe(true);
      const victimId = marrow.castTargetId;
      // He drops under two thirds halfway through the bar.
      run(f, bar.cast / 2, hold);
      marrow.hp = Math.floor(marrow.maxHp * 0.6);
      const from = f.hits.length;
      let waited = 0;
      run(f, DT * 2, hold);
      waited += DT * 2;
      expect(st.toll).toBeNull();
      expect(marrow.castingAbility).toBe(bar.id);
      for (; st.toll === null && waited < bar.cast + 0.5; waited += DT) tick(f, hold);
      expect(st.toll).not.toBeNull();
      // The Toll waited for the rest of the bar and one tick more (the bar
      // lands on one tick, the Toll starts on the next), never longer.
      expect(waited).toBeLessThanOrEqual(bar.cast / 2 + DT * 2 + 1e-6);
      expect(st.tolls).toBe(1);
      expect(marrow.damageImmune).toBe(true);
      // And the bar did land.
      if (bar.what === 'shovel') expect(took(f, f.tank, 'Shovelful', from)).toBeGreaterThan(0);
      else if (bar.what === 'blow') {
        expect(took(f, f.tank, "Gravedigger's Blow", from)).toBeGreaterThan(0);
        expect(f.tank.auras.find((a) => a.id === MARROW_BLOW_STACKS)?.stacks).toBe(1);
      } else {
        const victim = f.others.find((p) => p.id === victimId);
        expect(victim?.auras.some((a) => a.id === MARROW_MEASURED)).toBe(true);
      }
    });
  }
});

describe('Sexton Marrow: a Shovelful that came due while he rang', () => {
  it('walks back to the one he fights before he swings, and never flings dirt at nobody', () => {
    const { f, marrow, hold } = yard('normal');
    marrow.maxHp = 1e6;
    marrow.hp = marrow.maxHp;
    run(f, DT * 2, hold);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    // The Toll begins with the spade already due; the grave is not.
    st.shovelTimer = 0;
    st.measureTimer = 99;
    marrow.hp = Math.floor(marrow.maxHp * 0.6);
    run(f, DT * 2, hold);
    expect(st.toll).not.toBeNull();
    expect(until(f, () => st.toll === null, T.tollStrideMax + T.tollRing + 1, hold)).toBe(true);
    // He stands at the rope, out of the cone's reach of his tank.
    const gap = () => Math.hypot(marrow.pos.x - f.tank.pos.x, marrow.pos.z - f.tank.pos.z);
    expect(gap()).toBeGreaterThan(T.shovelRange);
    const from = f.hits.length;
    expect(until(f, () => marrow.castingAbility === MARROW_SHOVELFUL, 6, hold)).toBe(true);
    expect(gap()).toBeLessThanOrEqual(T.shovelRange - T.shovelReachMargin + 1e-6);
    expect(until(f, () => marrow.castingAbility === null, T.shovelCast + 0.2, hold)).toBe(true);
    expect(took(f, f.tank, 'Shovelful', from)).toBeGreaterThan(0);
  });
});

describe("Sexton Marrow: a Gravedigger's Blow that came due while he rang (heroic)", () => {
  /** A Toll with the Blow (and, on request, the spade) due as it ends. */
  function afterToll(spadeDue: boolean) {
    const { f, marrow, hold } = yard('heroic');
    marrow.maxHp = 1e6;
    marrow.hp = marrow.maxHp;
    run(f, DT * 2, hold);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    st.shovelTimer = 99;
    st.measureTimer = 99;
    st.blowTimer = 99;
    marrow.hp = Math.floor(marrow.maxHp * 0.6);
    run(f, DT * 2, hold);
    expect(st.toll).not.toBeNull();
    // His timers wait on the Toll: both come due the tick it ends.
    st.blowTimer = 0;
    if (spadeDue) st.shovelTimer = 0;
    expect(until(f, () => st.toll === null, T.tollStrideMax + T.tollRing + 1, hold)).toBe(true);
    const gap = () => Math.hypot(marrow.pos.x - f.tank.pos.x, marrow.pos.z - f.tank.pos.z);
    // He stands at the rope, far out of reach of the tank in the yard's centre.
    expect(gap()).toBeGreaterThan(T.shovelRange);
    return { f, marrow, hold, gap };
  }

  it('walks back to his tank before he strikes, never from the bell rope', () => {
    const { f, marrow, hold, gap } = afterToll(false);
    const from = f.hits.length;
    expect(until(f, () => marrow.castingAbility === MARROW_GRAVEDIGGERS_BLOW, 6, hold)).toBe(true);
    expect(gap()).toBeLessThanOrEqual(T.shovelRange - T.shovelReachMargin + 1e-6);
    expect(until(f, () => marrow.castingAbility === null, T.blowCast + 0.2, hold)).toBe(true);
    expect(took(f, f.tank, "Gravedigger's Blow", from)).toBeGreaterThan(0);
  });

  it('keeps the spade first when both are due and he is out of reach', () => {
    const { f, marrow, hold } = afterToll(true);
    expect(until(f, () => marrow.castingAbility !== null, 6, hold)).toBe(true);
    expect(marrow.castingAbility).toBe(MARROW_SHOVELFUL);
  });
});

describe("Sexton Marrow: the spade's gate covers his melee reach", () => {
  it('swings the Shovelful at a tank who keeps to the very edge of his melee reach', () => {
    const { f, marrow, hold } = yard('normal');
    marrow.maxHp = 1e6;
    marrow.hp = marrow.maxHp;
    const reach = combatProfileForMob(MARROW_ID, marrow.scale).meleeRange;
    // The gate (6 yd) lies outside the farthest spot he swings from (5 yd).
    expect(T.shovelRange - T.shovelReachMargin).toBeGreaterThan(reach);
    // The tank backs off every tick to stay at the edge of his reach, however
    // he closes: the farthest a target can stand while he keeps swinging.
    const seat = () => {
      hold();
      put(f, f.tank, marrow.pos.x - f.ox, marrow.pos.z - f.oz - (reach - 0.05));
    };
    const gap = () => Math.hypot(marrow.pos.x - f.tank.pos.x, marrow.pos.z - f.tank.pos.z);
    const from = f.hits.length;
    expect(
      until(f, () => marrow.castingAbility === MARROW_SHOVELFUL, T.shovelFirst + 0.5, seat),
    ).toBe(true);
    expect(gap()).toBeLessThanOrEqual(reach);
    // His melee landed from there before the spade came: he was swinging.
    const melee = f.hits.slice(from).filter((h) => h.targetId === f.tank.id && h.ability === null);
    expect(melee.length).toBeGreaterThan(0);
    // Planted for the bar, the tank still at the edge of his reach.
    const stay = [f.tank.pos.x - f.ox, f.tank.pos.z - f.oz];
    const still = () => {
      hold();
      put(f, f.tank, stay[0], stay[1]);
    };
    expect(until(f, () => marrow.castingAbility === null, T.shovelCast + 0.2, still)).toBe(true);
    expect(took(f, f.tank, 'Shovelful', from)).toBeGreaterThan(0);
  });
});

describe('Sexton Marrow: a tank who keeps just outside his melee', () => {
  /** Yards the kiter tries to hold from him: outside his 5 yd melee reach,
   *  inside the Shovelful's 8 yd cone. */
  const KITE = 6.5;

  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`standing off at ${KITE} yd does not spare the tank the spade (${difficulty})`, () => {
      const { f, marrow, hold } = yard(difficulty);
      marrow.maxHp = 1e6;
      marrow.hp = marrow.maxHp;
      const home = { x: marrow.pos.x - f.ox, z: marrow.pos.z - f.oz };
      const stand = () => {
        hold();
        put(f, f.tank, home.x, home.z - KITE);
      };
      const from = f.hits.length;
      expect(
        until(f, () => marrow.castingAbility === MARROW_SHOVELFUL, T.shovelFirst + 1, stand),
      ).toBe(true);
      expect(until(f, () => marrow.castingAbility === null, T.shovelCast + 0.2, stand)).toBe(true);
      expect(took(f, f.tank, 'Shovelful', from)).toBeGreaterThan(0);
    });

    it(`circling the yard at a run delays the spade, never suppresses it (${difficulty})`, () => {
      const { f, marrow, hold } = yard(difficulty);
      marrow.maxHp = 1e6;
      marrow.hp = marrow.maxHp;
      // The widest circle the Bell Yard allows, run at the player run speed,
      // starting 6.5 yd along it from him: he runs 7 yd a second on normal
      // (the player's own pace) and 8 on heroic, and cuts the chord.
      const R = 18;
      let a = Math.atan2(marrow.pos.x - f.ox - MID.x, marrow.pos.z - f.oz - MID.z) + KITE / R;
      const circle = () => {
        hold();
        a += (RUN_SPEED * DT) / R;
        put(f, f.tank, MID.x + Math.sin(a) * R, MID.z + Math.cos(a) * R);
      };
      const bars = { shovel: 0, blow: 0 };
      let first = -1;
      let last: string | null = null;
      const from = f.hits.length;
      for (let t = DT; t < 30; t += DT) {
        tick(f, circle);
        const cast = marrow.castingAbility;
        if (cast !== last) {
          if (cast === MARROW_SHOVELFUL) {
            bars.shovel++;
            if (first < 0) first = t;
          } else if (cast === MARROW_GRAVEDIGGERS_BLOW) bars.blow++;
          last = cast;
        }
      }
      // Measured: the first Shovelful at 8.7 s on normal and 5.4 s on heroic
      // (4 s when the tank stands), then on its 11 s clock.
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(difficulty === 'heroic' ? 7 : 11);
      expect(bars.shovel).toBeGreaterThanOrEqual(2);
      if (difficulty === 'heroic') expect(bars.blow).toBeGreaterThanOrEqual(2);
      else expect(bars.blow).toBe(0);
      // He caught the runner: his melee landed on the way.
      const melee = f.hits
        .slice(from)
        .filter((h) => h.targetId === f.tank.id && h.ability === null);
      expect(melee.length).toBeGreaterThan(0);
    });

    it(`kiting him at ${KITE} yd at a run cannot suppress the spade (${difficulty})`, () => {
      const { f, marrow, hold } = yard(difficulty);
      marrow.maxHp = 1e6;
      marrow.hp = marrow.maxHp;
      // The tank runs at the player run speed, always away from him, sliding
      // along the yard's rim: the best a kiter can do in the Bell Yard.
      const at = { x: marrow.pos.x - f.ox, z: marrow.pos.z - f.oz - KITE };
      const kite = () => {
        hold();
        const mx = marrow.pos.x - f.ox;
        const mz = marrow.pos.z - f.oz;
        let dx = at.x - mx;
        let dz = at.z - mz;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const want = { x: mx + dx * KITE, z: mz + dz * KITE };
        const sx = want.x - at.x;
        const sz = want.z - at.z;
        const s = Math.hypot(sx, sz);
        const step = Math.min(s, RUN_SPEED * DT);
        if (s > 1e-9) {
          at.x += (sx / s) * step;
          at.z += (sz / s) * step;
        }
        // Keep to the yard's floor.
        const rx = at.x - MID.x;
        const rz = at.z - MID.z;
        const r = Math.hypot(rx, rz);
        const rim = BELL_YARD.r - 2;
        if (r > rim) {
          at.x = MID.x + (rx / r) * rim;
          at.z = MID.z + (rz / r) * rim;
        }
        put(f, f.tank, at.x, at.z);
      };
      const casts = new Set<string>();
      let first = -1;
      for (let t = DT; t < 30; t += DT) {
        tick(f, kite);
        if (marrow.castingAbility) casts.add(marrow.castingAbility);
        if (first < 0 && marrow.castingAbility === MARROW_SHOVELFUL) first = t;
      }
      // The first Shovelful still comes on its clock, and on heroic the Blow too.
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(T.shovelFirst + 2);
      expect(casts.has(MARROW_GRAVEDIGGERS_BLOW)).toBe(difficulty === 'heroic');
    });
  }
});

describe('Sexton Marrow on heroic at the planning party DPS', () => {
  /** The heroic planning number his 24,996 pool was sized against. */
  const PARTY_DPS = 230;

  it('lasts about two minutes: seven graves, and the tank a minute at the Blow cap', () => {
    const { f, marrow, hold } = yard('heroic');
    const party = [f.tank, ...f.others];
    expect(marrow.maxHp).toBe(24996);
    const chunk = (PARTY_DPS * 0.5) / party.length;
    let capSeconds = 0;
    let ticks = 0;
    for (; ticks < 300 / DT && !marrow.dead; ticks++) {
      if (ticks % 10 === 0) {
        for (const p of party) {
          if (marrow.dead) break;
          f.sim.ctx.dealDamage(p, marrow, chunk, false, 'physical', null, 'hit', false, {
            mult: p === f.tank ? 8 : 1,
          });
        }
      }
      tick(f, hold);
      const stacks = f.tank.auras.find((a) => a.id === MARROW_BLOW_STACKS)?.stacks ?? 0;
      if (stacks >= T.blowMaxStacks) capSeconds += DT;
    }
    expect(marrow.dead).toBe(true);
    const seconds = ticks * DT;
    const graves = f.cues.filter((c) => c.ability === MARROW_GRAVE_OPENS).length;
    // Measured 121.1 s, 7 Open Graves and 62.5 s at six stacks (it was 82.1 s,
    // 5 and 17.4 s on the 16,099 he shipped with). Nobody steps out of a
    // grave or drops the stacks here: the upper bound of what the pool asks.
    expect(seconds).toBeGreaterThan(112);
    expect(seconds).toBeLessThan(130);
    expect(graves).toBe(7);
    expect(capSeconds).toBeGreaterThan(55);
    expect(capSeconds).toBeLessThan(70);
  });
});
