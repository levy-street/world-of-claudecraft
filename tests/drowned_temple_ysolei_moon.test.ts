// Ysolei calls the moon (src/sim/encounters/drowned_temple/ysolei_moon.ts):
// Moonlight Tears at 75 and 45 percent roll from the island rim at her (a
// body stops one and wears its Moonsear; one that reaches her is a Moonswell
// stack), and at 20 percent the Full Moon: a Falling Moon bar under her
// Plenilune Ward; break it for the eclipse or the moon falls.

import { describe, expect, it } from 'vitest';
import { ALTAR_STONE, MOON_ALTAR } from '../src/sim/content/drowned_temple_layout';
import {
  MOON_TEAR_TEMPLATE,
  MOONGLOW_TEMPLATE,
  tearDamage,
  tearLandingSpots,
  YSOLEI_BECKONING_MOON,
  YSOLEI_ECLIPSE_EXPOSED,
  YSOLEI_ECLIPSED,
  YSOLEI_FALLING_MOON,
  YSOLEI_ID,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_MOON_TUNING,
  YSOLEI_MOONBORNE_MIGHT,
  YSOLEI_MOONSEAR,
  YSOLEI_MOONSWELL,
  YSOLEI_PLENILUNE_WARD,
  YSOLEI_UNDERTOW,
} from '../src/sim/encounters/drowned_temple';
import type { Entity, YsoleiFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  local,
  objects,
  put,
  run,
  took,
  until,
} from './helpers/temple_fight';

const M = YSOLEI_MOON_TUNING;
/** Off the island, past the causeway: no tear rolls here. */
const AWAY = { x: MOON_ALTAR.x + MOON_ALTAR.r + 12, z: MOON_ALTAR.z + 14 };

function ysoleiFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; b: Entity } {
  const f = fight(difficulty);
  const b = boss(f, YSOLEI_ID);
  put(f, f.tank, ALTAR_STONE.x + 8, MOON_ALTAR.z);
  for (const p of f.others) put(f, p, AWAY.x, AWAY.z);
  engage(f, b);
  run(f, 0.2, keepAway(f));
  return { f, b };
}

function keepAway(f: Fight): () => void {
  return () => {
    put(f, f.tank, ALTAR_STONE.x + 8, MOON_ALTAR.z);
    for (const p of f.others) put(f, p, AWAY.x, AWAY.z);
  };
}

function state(b: Entity): YsoleiFightState {
  const st = b.templeFight;
  if (st?.kind !== 'ysolei') throw new Error('no ysolei fight');
  return st;
}

/** Push her to a health share with the Undertow far off. Her Moonspawn and
 *  her enrage (and their roars) are answered already, so the moon is all that
 *  share opens. */
function toShare(b: Entity, share: number): YsoleiFightState {
  const st = state(b);
  b.hp = Math.floor(b.maxHp * share);
  b.firedSummons = 99;
  st.summonsRoared = 99;
  st.wrathRoared = true;
  st.undertowTimer = 20;
  st.lunarTimer = 20;
  return st;
}

describe('Moonlight Tears: called at 75 and 45 percent', () => {
  it('beckons the moon under 75 percent, then three tears land on the rim', () => {
    const { f, b } = ysoleiFight();
    const st = toShare(b, 0.74);
    expect(until(f, () => b.castingAbility === YSOLEI_BECKONING_MOON, 1, keepAway(f))).toBe(true);
    expect(b.castTotal).toBe(M.callCast);
    run(f, M.callCast + 0.2, keepAway(f));
    const tears = objects(f, MOON_TEAR_TEMPLATE);
    expect(tears.length).toBe(M.tearCount);
    // On the rim, evenly spread.
    for (const t of tears) {
      const at = local(f, t);
      const r = Math.hypot(at.x - MOON_ALTAR.x, at.z - MOON_ALTAR.z);
      expect(r).toBeGreaterThan(MOON_ALTAR.r - M.tearRimInset - 2);
    }
    expect(st.tearWaves).toBe(1);
  });

  it('heroic: four tears', () => {
    const { f, b } = ysoleiFight('heroic');
    toShare(b, 0.74);
    run(f, M.callCast + 0.3, keepAway(f));
    expect(objects(f, MOON_TEAR_TEMPLATE).length).toBe(M.tearCountHeroic);
  });

  it('a second wave under 45 percent, never a third', () => {
    const { f, b } = ysoleiFight();
    const st = toShare(b, 0.44);
    run(f, 0.2, keepAway(f));
    expect(st.tearWaves).toBe(2);
    expect(st.tearCalls).toBe(1);
  });

  it('will not beckon with the Undertow about to rise', () => {
    const { f, b } = ysoleiFight();
    const st = toShare(b, 0.74);
    st.undertowTimer = M.callCast + M.callUndertowGap - 1;
    run(f, 0.2, keepAway(f));
    expect(b.castingAbility).not.toBe(YSOLEI_BECKONING_MOON);
  });

  it('the tears roll slowly at her and each one that reaches her is a Moonswell stack', () => {
    const { f, b } = ysoleiFight();
    toShare(b, 0.74);
    run(f, M.callCast + 0.2, keepAway(f));
    const tear = objects(f, MOON_TEAR_TEMPLATE)[0];
    const d0 = Math.hypot(tear.pos.x - b.pos.x, tear.pos.z - b.pos.z);
    run(f, 1, keepAway(f));
    const d1 = Math.hypot(tear.pos.x - b.pos.x, tear.pos.z - b.pos.z);
    expect(d0 - d1).toBeCloseTo(M.tearSpeed, 1);
    const hpBefore = b.hp;
    expect(until(f, () => objects(f, MOON_TEAR_TEMPLATE).length === 0, 15, keepAway(f))).toBe(true);
    const swell = aura(b, YSOLEI_MOONSWELL);
    expect(swell?.stacks).toBe(M.tearCount);
    expect(swell?.value).toBeCloseTo(M.moonswellDamage * M.tearCount, 6);
    expect(b.hp).toBeGreaterThan(hpBefore);
  });

  it('a body in a tear’s way stops it and wears Moonsear; the next one on them hurts far more', () => {
    const { f, b } = ysoleiFight();
    toShare(b, 0.74);
    run(f, M.callCast + 0.2, keepAway(f));
    const blocker = f.others[0];
    const st = state(b);
    // Stand on each tear's path in turn, a few yards ahead of it.
    const catchOne = (): number => {
      const tr = st.tears[0];
      const bl = local(f, b);
      const dx = bl.x - tr.x;
      const dz = bl.z - tr.z;
      const d = Math.hypot(dx, dz);
      const spot = { x: tr.x + (dx / d) * 3, z: tr.z + (dz / d) * 3 };
      const before = st.tears.length;
      const from = f.hits.length;
      const keep = () => {
        keepAway(f)();
        put(f, blocker, spot.x, spot.z);
      };
      expect(until(f, () => st.tears.length < before, 3, keep)).toBe(true);
      return took(f, blocker, 'Moonlight Tear', from);
    };
    const first = catchOne();
    expect(first).toBeGreaterThanOrEqual(M.tearMin);
    expect(first).toBeLessThanOrEqual(M.tearMax);
    expect(aura(blocker, YSOLEI_MOONSEAR)?.stacks).toBe(1);
    const second = catchOne();
    expect(second).toBeGreaterThanOrEqual(tearDamage(M.tearMin, 1));
    expect(second).toBeLessThanOrEqual(tearDamage(M.tearMax, 1));
    expect(aura(blocker, YSOLEI_MOONSEAR)?.stacks).toBe(2);
    // A stopped tear never reaches her.
    expect(aura(b, YSOLEI_MOONSWELL)?.stacks ?? 0).toBe(0);
  });

  it('keeps the burn’s count even on a body whose slow immunity drops the aura', () => {
    const { f, b } = ysoleiFight();
    toShare(b, 0.74);
    run(f, M.callCast + 0.2, keepAway(f));
    const blocker = f.others[0];
    blocker.auras.push({
      id: 'test_slow_immunity',
      name: 'Freedom',
      kind: 'slow_immunity',
      remaining: 999,
      duration: 999,
      value: 0,
      sourceId: blocker.id,
      school: 'holy',
    });
    const st = state(b);
    const catchOne = (): number => {
      const tr = st.tears[0];
      const before = st.tears.length;
      const from = f.hits.length;
      const keep = () => {
        keepAway(f)();
        put(f, blocker, tr.x, tr.z);
      };
      expect(until(f, () => st.tears.length < before, 3, keep)).toBe(true);
      return took(f, blocker, 'Moonlight Tear', from);
    };
    catchOne();
    const second = catchOne();
    expect(second).toBeGreaterThanOrEqual(tearDamage(M.tearMin, 1));
  });

  it('opens the next wave only once the last tear has gone', () => {
    const { f, b } = ysoleiFight();
    const st = toShare(b, 0.44);
    run(f, M.callCast + 0.2, keepAway(f));
    expect(st.tears.length).toBeGreaterThan(0);
    expect(st.tearCalls).toBe(1);
    run(f, 1, keepAway(f));
    expect(b.castingAbility).not.toBe(YSOLEI_BECKONING_MOON);
    expect(until(f, () => st.tears.length === 0, 15, keepAway(f))).toBe(true);
    expect(until(f, () => b.castingAbility === YSOLEI_BECKONING_MOON, 1, keepAway(f))).toBe(true);
  });

  it('a reset drops the tears, the moon’s auras and every burn', () => {
    const { f, b } = ysoleiFight('heroic');
    toShare(b, 0.74);
    run(f, M.callCast + 0.2, keepAway(f));
    const st = state(b);
    const tr = st.tears[0];
    run(f, 0.3, () => {
      keepAway(f)();
      put(f, f.others[0], tr.x, tr.z);
    });
    expect(aura(f.others[0], YSOLEI_MOONSEAR)).toBeDefined();
    expect(objects(f, MOONGLOW_TEMPLATE).length).toBeGreaterThan(0);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    b.inCombat = false;
    b.aggroTargetId = null;
    b.aiState = 'evade';
    run(f, 0.2);
    expect(objects(f, MOON_TEAR_TEMPLATE).length).toBe(0);
    expect(objects(f, MOONGLOW_TEMPLATE).length).toBe(0);
    expect(aura(f.others[0], YSOLEI_MOONSEAR)).toBeUndefined();
    expect(b.castingAbility).toBeNull();
    for (const id of [YSOLEI_MOONSWELL, YSOLEI_PLENILUNE_WARD, YSOLEI_MOONBORNE_MIGHT])
      expect(aura(b, id)).toBeUndefined();
  });

  it('heroic: a stopped tear leaves a pool of moonlight', () => {
    const { f, b } = ysoleiFight('heroic');
    toShare(b, 0.74);
    run(f, M.callCast + 0.2, keepAway(f));
    const st = state(b);
    const tr = st.tears[0];
    const blocker = f.others[0];
    const keep = () => {
      keepAway(f)();
      put(f, blocker, tr.x, tr.z);
    };
    run(f, 0.2, keep);
    expect(objects(f, MOONGLOW_TEMPLATE).length).toBe(1);
  });

  it('lands its tears on fixed, evenly spaced spots', () => {
    const spots = tearLandingSpots(3, 0);
    expect(spots.length).toBe(3);
    const a = spots.map((s) => Math.atan2(s.x - MOON_ALTAR.x, s.z - MOON_ALTAR.z));
    expect(Math.abs(a[1] - a[0])).toBeCloseTo((Math.PI * 2) / 3, 6);
    expect(tearDamage(80, 0)).toBe(80);
    expect(tearDamage(80, 2)).toBe(Math.round(80 * (1 + 2 * M.moonsearBonus)));
  });
});

describe('The Full Moon at 20 percent: break the Plenilune Ward or the moon falls', () => {
  function toFullMoon(difficulty: 'normal' | 'heroic' = 'normal') {
    const { f, b } = ysoleiFight(difficulty);
    const st = toShare(b, 0.19);
    // The tear waves are already answered: the moon itself comes.
    st.tearWaves = M.tearsAt.length;
    st.tearCalls = 0;
    expect(until(f, () => b.castingAbility === YSOLEI_FALLING_MOON, 1, keepAway(f))).toBe(true);
    return { f, b, st };
  }

  it('raises a ward worth a share of her health over a long bar', () => {
    const { b, st } = toFullMoon();
    const ward = aura(b, YSOLEI_PLENILUNE_WARD);
    expect(ward?.kind).toBe('absorb');
    expect(ward?.value).toBe(Math.round(b.maxHp * M.wardShare));
    expect(ward?.value2).toBe(ward?.value);
    expect(b.castTotal).toBe(M.fallingCast);
    expect(st.fullMoon).toBe('falling');
  });

  it('heroic: the moon falls sooner', () => {
    const { b } = toFullMoon('heroic');
    expect(b.castTotal).toBe(M.fallingCastHeroic);
  });

  it('her Lunar Tide and Undertow wait while the moon descends', () => {
    const { f, b, st } = toFullMoon();
    st.undertowTimer = 0.5;
    st.lunarTimer = 0.1;
    let other = false;
    run(f, M.fallingCast - 1, () => {
      keepAway(f)();
      if (b.castingAbility === YSOLEI_UNDERTOW || b.castingAbility === YSOLEI_LUNAR_TIDE)
        other = true;
    });
    expect(other).toBe(false);
    expect(st.undertowTimer).toBeCloseTo(0.5, 6);
  });

  it('broken in time: the moon is eclipsed and she reels, exposed', () => {
    const { f, b, st } = toFullMoon();
    const ward = aura(b, YSOLEI_PLENILUNE_WARD);
    f.sim.ctx.dealDamage(f.tank, b, (ward?.value ?? 0) + 50, false, 'physical', 'Strike', 'hit');
    run(f, 0.1, keepAway(f));
    expect(b.castingAbility).toBeNull();
    expect(st.fullMoon).toBe('done');
    expect(aura(b, YSOLEI_ECLIPSED)?.kind).toBe('stun');
    expect(aura(b, YSOLEI_ECLIPSE_EXPOSED)?.value).toBeCloseTo(M.eclipseVuln, 6);
    expect(aura(b, YSOLEI_MOONBORNE_MIGHT)).toBeUndefined();
  });

  it('held to the bar’s end: the moon falls on the island and its might stays on her', () => {
    const { f, b, st } = toFullMoon();
    const onIsland = f.tank;
    const from = f.hits.length;
    run(f, M.fallingCast + 0.2, keepAway(f));
    expect(st.fullMoon).toBe('done');
    const hit = took(f, onIsland, 'Falling Moon', from);
    expect(hit).toBeGreaterThanOrEqual(M.fallMin);
    expect(hit).toBeLessThanOrEqual(M.fallMax);
    expect(aura(b, YSOLEI_MOONBORNE_MIGHT)?.value).toBeCloseTo(M.mightShare, 6);
    expect(aura(b, YSOLEI_PLENILUNE_WARD)).toBeUndefined();
  });

  it('never opens while tears still roll, and comes once', () => {
    const { f, b } = ysoleiFight();
    const st = toShare(b, 0.19);
    st.tearWaves = M.tearsAt.length;
    st.tearCalls = 0;
    st.tears.push({ x: MOON_ALTAR.x - 20, z: MOON_ALTAR.z, objectId: -1 });
    run(f, 0.2, keepAway(f));
    expect(b.castingAbility).not.toBe(YSOLEI_FALLING_MOON);
    st.tears = [];
    run(f, 0.2, keepAway(f));
    expect(b.castingAbility).toBe(YSOLEI_FALLING_MOON);
  });
});
