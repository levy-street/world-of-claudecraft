// Living Rime and Living Warmth, the Guardian of the Quench's healer
// mechanics (the owner's review of 2026-11-09; encounters/smith_heart/
// quench_rime.ts and quench_life_warmth.ts, over a REAL Sim on tests/helpers/
// quench_fight.ts): the per-tier rows (carriers, absorb, the leap, the
// warmth's rate), the first cast at 12 s and every 25 s, who it never takes
// (the active tank, the frozen, the trapped, the slash-marked, the rimed), its
// slow and doubled cold, healed through (nothing happens), not healed through
// (the freeze and a 6 yd burst), a freeze by the cold itself bursting it at
// once, Heroic's leap to the nearest other player, the wipe clearing it, and
// healing received lowering the cold (half on Heroic, nothing at full health,
// nothing a crust drank). Plus the client's reading of it: the tooltip, the
// player's own alert, the raid frame's badge, the sound and the look.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  QUENCH_COLD_SOUNDS,
  QUENCH_CUE_SOUNDS,
  QUENCH_MARK_SOUNDS,
} from '../src/game/smith_heart_quench_audio_core';
import { QuenchFightFx } from '../src/render/smith_heart_fx/quench_fight_fx';
import { quenchFightClaims } from '../src/render/smith_heart_fx/quench_fight_fx_core';
import {
  QUENCH_RIME_POOLS,
  rimeLook,
  rimePlate,
} from '../src/render/smith_heart_fx/quench_rime_core';
import { applyHeal } from '../src/sim/combat/heal';
import { noteHealTaken, takeHealTaken } from '../src/sim/combat/heal_taken';
import { quenchScopeForDev } from '../src/sim/encounters/smith_heart';
import { freezePlayer } from '../src/sim/encounters/smith_heart/quench_cold';
import {
  coldStep,
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import { lifeWarmthCold } from '../src/sim/encounters/smith_heart/quench_life_warmth';
import {
  burstRime,
  pickRimeTargets,
  rimeLeapTarget,
} from '../src/sim/encounters/smith_heart/quench_rime';
import { partyFrameAuras } from '../src/sim/party_frame_info';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildQuenchAlertView } from '../src/ui/hud/dungeon/quench_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const has = (e: Entity, id: string) => aura(e, id) !== undefined;

/** A pulled fight on `tier`, the shore ice standing, the breath and the
 *  slashes held off (a test that wants them asks). */
function pulled(tier: 'normal' | 'heroic' | 'mythic' = 'normal', n = 6): QuenchFight {
  const f = quenchFight(n);
  if (tier !== 'normal') expect(f.dev(`/dev heart quench ${tier}`)).toBe(true);
  expect(f.dev('/dev heart quench pull')).toBe(true);
  f.tick(ticks(T.rimRise) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  expect(st.difficulty).toBe(tier);
  st.breathTimer = 999;
  st.slashTimer = 999;
  return f;
}

function scope(f: QuenchFight) {
  const s = quenchScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no scope');
  return s;
}

const tank = (f: QuenchFight) => f.boss().aggroTargetId;
const carriers = (f: QuenchFight) => f.players.filter((p) => has(p, QUENCH_AURAS.rime));

/** Every carrier's cold and cold rate made quiet: alone but not freezing. */
function setCold(f: QuenchFight, e: Entity, v: number): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.chill[e.id] = { cold: v, frozen: 0 };
}

/** A heal from the first raider that is not `target`. */
function heal(f: QuenchFight, target: Entity, amount: number): number {
  const healer = f.players.find((p) => p.id !== target.id) as Entity;
  return applyHeal(f.sim.ctx, healer, target, amount, 'Test Mend', null, false);
}

describe('Living Rime: the rows', () => {
  it('takes 1, 2 and 3 players for 600, 900 and 900, and leaps from Heroic up', () => {
    expect(QUENCH_DIFFICULTY.normal).toMatchObject({
      rimeTargets: 1,
      rimeAbsorb: 600,
      rimeLeap: false,
    });
    expect(QUENCH_DIFFICULTY.heroic).toMatchObject({
      rimeTargets: 2,
      rimeAbsorb: 900,
      rimeLeap: true,
    });
    expect(QUENCH_DIFFICULTY.mythic).toMatchObject({
      rimeTargets: 3,
      rimeAbsorb: 900,
      rimeLeap: true,
    });
    expect(T.rimeFirst).toBe(12);
    expect(T.rimeEvery).toBe(25);
    expect(T.rimeSeconds).toBe(10);
    expect(T.rimeSlow).toBe(0.7);
    expect(T.rimeColdMult).toBe(2);
    expect(T.rimeBurstR).toBe(6);
  });

  it('names it Living Rime, and Living Warmth, both localized', () => {
    expect(QUENCH_NAMES.rime).toBe('Living Rime');
    expect(QUENCH_NAMES.lifeWarmth).toBe('Living Warmth');
    expect(localizeSimAuraName('Living Rime')).toBe('Living Rime');
    expect(localizeSimAuraName('Living Warmth')).toBe('Living Warmth');
  });
});

describe('Living Rime over a real fight', () => {
  for (const [tier, count, absorb] of [
    ['normal', 1, 600],
    ['heroic', 2, 900],
    ['mythic', 3, 900],
  ] as const) {
    it(`${tier}: first 12 s in on ${count} non-tank players, ${absorb} each, slowed 30%`, () => {
      const f = pulled(tier);
      const st = f.state();
      if (!st) throw new Error('no fight');
      let at = -1;
      for (let i = 0; i < ticks(20); i++) {
        f.tick(1);
        if (st.rimes.length > 0) {
          at = st.clock;
          break;
        }
      }
      expect(at).toBeGreaterThan(T.rimeFirst - 2 * DT);
      expect(at).toBeLessThan(T.rimeFirst + 2 * DT);
      const on = carriers(f);
      expect(on).toHaveLength(count);
      for (const p of on) {
        expect(p.id).not.toBe(tank(f));
        const crust = aura(p, QUENCH_AURAS.rime);
        expect(crust?.kind).toBe('heal_absorb');
        expect(crust?.value).toBe(absorb);
        expect(crust?.value2).toBe(absorb);
        expect(crust?.undispellable).toBe(true);
        const slow = aura(p, QUENCH_AURAS.rimeSlow);
        expect(slow?.kind).toBe('slow');
        expect(slow?.value).toBeCloseTo(0.7, 9);
      }
      // Healed through at once, the next comes 25 s after the first.
      for (const p of on) heal(f, p, absorb);
      f.tick(1);
      expect(st.rimes).toHaveLength(0);
      const first = st.clock;
      for (let i = 0; i < ticks(30) && st.rimes.length === 0; i++) f.tick(1);
      expect(st.clock - first).toBeGreaterThan(T.rimeEvery - 1.1);
      expect(st.clock - first).toBeLessThan(T.rimeEvery + 0.1);
    });
  }

  it('never takes the active tank, the frozen, the trapped, the slash-marked or the rimed', () => {
    const f = pulled('normal', 7);
    const s = scope(f);
    const [a, b, c, d, e] = f.players.filter((p) => p.id !== tank(f));
    freezePlayer(s, a);
    s.st.trapped[b.id] = { x: 0, z: 0, r: 3, remaining: 4, tick: 1 };
    c.auras.push({
      id: QUENCH_AURAS.marked,
      name: "Smith's Blade",
      kind: 'internal_cd',
      remaining: 3,
      duration: 3,
      value: 1,
      value2: 1,
      sourceId: s.boss.id,
      school: 'frost',
    });
    s.st.rimes.push({ id: d.id, remaining: 5 });
    const picked = pickRimeTargets(s, 10).map((p) => p.id);
    const tankId = tank(f);
    expect(tankId).not.toBeNull();
    for (const banned of [tankId, a.id, b.id, c.id, d.id]) expect(picked).not.toContain(banned);
    expect(picked).toContain(e.id);
    // Only the tank and the excluded left: nobody, never a fallback.
    const fewer = pickRimeTargets(s, 10).filter((p) => p.id !== e.id);
    expect(fewer.every((p) => ![tankId, a.id, b.id, c.id, d.id].includes(p.id))).toBe(true);
  });

  it("doubles its carrier's cold rise while it holds", () => {
    const f = pulled();
    const [carrier, other] = f.players.filter((p) => p.id !== tank(f));
    // Both alone, far apart.
    f.put(carrier, 160, 10);
    f.put(other, 220, 10);
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    setCold(f, carrier, 10);
    setCold(f, other, 10);
    f.tick(ticks(1));
    const st = f.state();
    if (!st) throw new Error('no fight');
    const rose = st.chill[carrier.id].cold - 10;
    const plain = st.chill[other.id].cold - 10;
    expect(plain).toBeCloseTo(coldStep(0), 1);
    expect(rose).toBeCloseTo(plain * T.rimeColdMult, 1);
  });

  it('healed through within 10 s: it falls away and nothing else happens', () => {
    const f = pulled();
    const carrier = f.players.find((p) => p.id !== tank(f)) as Entity;
    const near = f.players.find((p) => p.id !== tank(f) && p.id !== carrier.id) as Entity;
    f.put(carrier, 170, 10);
    f.put(near, 172, 10);
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    f.tick(ticks(3), false);
    carrier.hp = 1;
    expect(heal(f, carrier, 400)).toBe(0);
    expect(aura(carrier, QUENCH_AURAS.rime)?.value).toBe(200);
    heal(f, carrier, 250);
    const ev = f.tick(1);
    expect(has(carrier, QUENCH_AURAS.rime)).toBe(false);
    expect(has(carrier, QUENCH_AURAS.rimeSlow)).toBe(false);
    expect(st.rimeBreaks).toBe(1);
    expect(st.rimes).toHaveLength(0);
    expect(
      ev.some(
        (e) =>
          e.type === 'spellfx' && e.ability === QUENCH_CUES.rimeBreak && e.targetId === carrier.id,
      ),
    ).toBe(true);
    setCold(f, near, 0);
    f.tick(ticks(T.rimeSeconds + 1));
    expect(st.rimeBursts).toBe(0);
    expect(has(carrier, QUENCH_AURAS.frozen)).toBe(false);
    expect(has(near, QUENCH_AURAS.splashed)).toBe(false);
  });

  it('not healed through: its carrier freezes and the cold bursts on everyone within 6 yd', () => {
    const f = pulled();
    const free = f.players.filter((p) => p.id !== tank(f));
    const [carrier, inside, outside] = free;
    f.put(carrier, 170, 12);
    f.put(inside, 170 + T.rimeBurstR - 0.5, 12);
    f.put(outside, 170 + T.rimeBurstR + 1.5, 12);
    for (const p of free.slice(3)) f.put(p, 230, -20);
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    // Hold every bar low so nothing but the burst moves them much.
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks(T.rimeSeconds) + 1 && st.rimeBursts === 0; i++) {
      setCold(f, carrier, 0);
      setCold(f, inside, 0);
      setCold(f, outside, 0);
      events.push(...f.tick(1));
    }
    expect(st.rimeBursts).toBe(1);
    expect(st.clock).toBeGreaterThan(0);
    expect(has(carrier, QUENCH_AURAS.frozen)).toBe(true);
    expect(has(carrier, QUENCH_AURAS.rime)).toBe(false);
    expect(st.chill[inside.id].cold).toBeGreaterThanOrEqual(
      QUENCH_DIFFICULTY.normal.splashCold - 1,
    );
    expect(st.chill[outside.id].cold).toBeLessThan(2);
    expect(aura(inside, QUENCH_AURAS.splashed)?.value2).toBe(carrier.id);
    const burst = events.find((e) => e.type === 'spellfxAt' && e.ability === QUENCH_CUES.rimeBurst);
    expect(burst && burst.type === 'spellfxAt' ? burst.radius : null).toBe(T.rimeBurstR);
    // Normal never leaps.
    expect(carriers(f)).toHaveLength(0);
  });

  it('a carrier frozen by their own cold bursts at once', () => {
    const f = pulled();
    const carrier = f.players.find((p) => p.id !== tank(f)) as Entity;
    f.put(carrier, 170, 12);
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    setCold(f, carrier, 99.9);
    f.tick(2);
    expect(has(carrier, QUENCH_AURAS.frozen)).toBe(true);
    expect(st.rimeBursts).toBe(1);
    expect(st.clock).toBeLessThan(T.rimRise + 1);
  });

  it('heroic: a burst leaps to the nearest other player with a fresh 900', () => {
    const f = pulled('heroic');
    const free = f.players.filter((p) => p.id !== tank(f));
    const [carrier, nearest, farther] = free;
    f.put(carrier, 170, 12);
    f.put(farther, 170, 12 + 4);
    f.put(nearest, 170 + 2.5, 12);
    for (const p of free.slice(3)) f.put(p, 230, -20);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    const s = scope(f);
    expect(rimeLeapTarget(s, carrier)?.id).toBe(nearest.id);
    setCold(f, nearest, 0);
    setCold(f, farther, 0);
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks(T.rimeSeconds) + 1 && st.rimeBursts === 0; i++)
      events.push(...f.tick(1));
    expect(st.rimeBursts).toBe(1);
    expect(has(carrier, QUENCH_AURAS.frozen)).toBe(true);
    expect(aura(nearest, QUENCH_AURAS.rime)?.value).toBe(900);
    expect(has(farther, QUENCH_AURAS.rime)).toBe(false);
    expect(st.rimes.map((r) => r.id)).toEqual([nearest.id]);
    expect(st.rimes[0].remaining).toBeGreaterThan(T.rimeSeconds - 0.2);
    expect(
      events.some(
        (e) =>
          e.type === 'spellfx' &&
          e.ability === QUENCH_CUES.rime &&
          e.sourceId === carrier.id &&
          e.targetId === nearest.id,
      ),
    ).toBe(true);
  });

  it('normal: a burst never leaps', () => {
    const f = pulled();
    const [carrier, nearest] = f.players.filter((p) => p.id !== tank(f));
    f.put(carrier, 170, 12);
    f.put(nearest, 172, 12);
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    burstRime(scope(f), carrier);
    expect(has(nearest, QUENCH_AURAS.rime)).toBe(false);
  });

  it('a wipe takes every crust off', () => {
    const f = pulled();
    const carrier = f.players.find((p) => p.id !== tank(f)) as Entity;
    expect(f.dev('/dev heart quench rime', carrier.id)).toBe(true);
    expect(f.dev('/dev heart quench reset')).toBe(true);
    expect(has(carrier, QUENCH_AURAS.rime)).toBe(false);
    expect(has(carrier, QUENCH_AURAS.rimeSlow)).toBe(false);
  });
});

describe('Living Warmth: healing received lowers the cold', () => {
  it('1 cold per 2% of maximum health healed on Normal, half on Heroic and Mythic', () => {
    expect(QUENCH_DIFFICULTY.normal.lifeWarmth).toBe(0.5);
    expect(QUENCH_DIFFICULTY.heroic.lifeWarmth).toBe(0.25);
    expect(QUENCH_DIFFICULTY.mythic.lifeWarmth).toBe(0.25);
    expect(lifeWarmthCold(240, 1200, 0.5)).toBeCloseTo(10, 9);
    expect(lifeWarmthCold(240, 1200, 0.25)).toBeCloseTo(5, 9);
    expect(lifeWarmthCold(0, 1200, 0.5)).toBe(0);
  });

  for (const [tier, rate] of [
    ['normal', 0.5],
    ['heroic', 0.25],
  ] as const) {
    it(`${tier}: a heal of 10% of health takes ${10 * rate} cold off, a twin unhealed keeps it`, () => {
      const f = pulled(tier);
      const [healed, twin] = f.players.filter((p) => p.id !== tank(f));
      f.put(healed, 160, 10);
      f.put(twin, 230, 10);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.rimeTimer = 999;
      setCold(f, healed, 50);
      setCold(f, twin, 50);
      healed.hp = Math.round(healed.maxHp / 2);
      expect(heal(f, healed, healed.maxHp * 0.1)).toBeCloseTo(healed.maxHp * 0.1, 0);
      f.tick(1, false);
      const drop = st.chill[twin.id].cold - st.chill[healed.id].cold;
      expect(drop).toBeCloseTo(10 * rate, 5);
    });
  }

  it("a HoT's ticks warm too (every heal path a heal absorb sees counts)", () => {
    const f = pulled();
    const [healed, twin] = f.players.filter((p) => p.id !== tank(f));
    f.put(healed, 160, 10);
    f.put(twin, 230, 10);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    setCold(f, healed, 60);
    setCold(f, twin, 60);
    healed.hp = 1;
    const tick = Math.round(healed.maxHp * 0.04);
    healed.auras.push({
      id: 'test_mending_hot',
      name: 'Test Mending',
      kind: 'hot',
      remaining: 3.5,
      duration: 3.5,
      value: tick,
      tickInterval: 1,
      sourceId: twin.id,
      school: 'holy',
    });
    for (let i = 0; i < ticks(3.2); i++) {
      healed.hp = Math.min(healed.hp, 1 + i);
      f.tick(1, false);
    }
    // Three ticks of 4% each: 6 cold off on Normal.
    const drop = st.chill[twin.id].cold - st.chill[healed.id].cold;
    expect(drop).toBeGreaterThan(3 * 4 * 0.5 - 0.6);
    expect(drop).toBeLessThan(3 * 4 * 0.5 + 0.6);
  });

  it('warms nobody during the Blades Hunt, nor a frozen body', () => {
    const f = pulled('mythic');
    const [healed, twin, frozen] = f.players.filter((p) => p.id !== tank(f));
    f.put(healed, 160, 10);
    f.put(twin, 230, 10);
    f.put(frozen, 200, 30);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    st.flurry = { lines: [], gap: 999 };
    setCold(f, healed, 50);
    setCold(f, twin, 50);
    healed.hp = 1;
    heal(f, healed, Math.round(healed.maxHp * 0.2));
    f.tick(1, false);
    expect(st.chill[healed.id].cold).toBeCloseTo(st.chill[twin.id].cold, 6);
    st.flurry = null;
    freezePlayer(scope(f), frozen);
    frozen.hp = 1;
    heal(f, frozen, Math.round(frozen.maxHp * 0.2));
    f.tick(1, false);
    expect(st.chill[frozen.id].cold).toBe(0);
  });

  it('never picks a body sealed in an immunity', () => {
    const f = pulled();
    const p = f.players.find((q) => q.id !== tank(f)) as Entity;
    const s = scope(f);
    expect(pickRimeTargets(s, 10).some((q) => q.id === p.id)).toBe(true);
    p.damageImmune = true;
    expect(pickRimeTargets(s, 10).some((q) => q.id === p.id)).toBe(false);
    p.damageImmune = false;
  });

  it('a dev run can switch it off (the bots comparison run)', () => {
    const f = quenchFight(6);
    expect(f.dev('/dev heart quench rime off')).toBe(true);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(30));
    const st = f.state();
    expect(st?.rimeOff).toBe(true);
    expect(st?.rimes).toHaveLength(0);
    expect(f.dev('/dev heart quench rime on')).toBe(true);
    expect(f.state()?.rimeOff).toBeUndefined();
  });

  it('warms nothing at full health, nor through a crust that drank the heal', () => {
    const f = pulled();
    const [full, crusted, twin] = f.players.filter((p) => p.id !== tank(f));
    f.put(full, 160, 10);
    f.put(crusted, 200, 10);
    f.put(twin, 230, 10);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.rimeTimer = 999;
    expect(f.dev('/dev heart quench rime', crusted.id)).toBe(true);
    for (const p of [full, crusted, twin]) setCold(f, p, 50);
    full.hp = full.maxHp;
    crusted.hp = 1;
    expect(heal(f, full, 5000)).toBe(0);
    expect(heal(f, crusted, 500)).toBe(0);
    f.tick(1, false);
    // The crusted one's cold rises twice as fast: measure against its own rate.
    expect(st.chill[full.id].cold).toBeCloseTo(st.chill[twin.id].cold, 6);
    expect(st.chill[crusted.id].cold).toBeGreaterThan(st.chill[twin.id].cold);
  });

  it('the tally hands a heal over once, and never a stale one', () => {
    const f = quenchFight(1);
    const p = f.players[0];
    const ctx = f.sim.ctx;
    noteHealTaken(ctx, p, 120);
    noteHealTaken(ctx, p, 30);
    expect(takeHealTaken(ctx, p)).toBe(150);
    expect(takeHealTaken(ctx, p)).toBe(0);
    noteHealTaken(ctx, p, 99);
    f.tick(5);
    expect(takeHealTaken(ctx, p)).toBe(0);
  });
});

describe('Living Rime on the client', () => {
  const crust = {
    id: QUENCH_AURAS.rime,
    kind: 'heal_absorb' as const,
    value: 420,
    value2: 600,
    remaining: 6.2,
    duration: 10,
  };

  it('the tooltip says what it absorbs, what it does and every tier', () => {
    const d = auraEffectDescriptor(crust);
    expect(d?.key).toBe('hudChrome.auraEffect.quenchGuardian.rime');
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('absorbs the next 420 healing');
    expect(text).toContain('(600 in all)');
    expect(text).toContain('30% slower');
    expect(text).toContain('2 times as fast');
    expect(text).toContain('within 10 sec');
    expect(text).toContain('within 6 yd');
    expect(text).toContain(`adding ${QUENCH_DIFFICULTY.normal.splashCold} cold`);
    expect(text).toContain('Normal: 600 on one player');
    expect(text).toContain('Heroic: 900 on 2 players');
    expect(text).toContain('on 3 players');
    const slow = auraEffectDescriptor({ id: QUENCH_AURAS.rimeSlow, kind: 'slow', value: 0.7 });
    expect(t(slow?.key as never, slow?.nums as never)).toContain('30% slower');
    // The cold's tooltip names Living Warmth's rate per tier.
    const cold = auraEffectDescriptor({ id: QUENCH_AURAS.cold, kind: 'internal_cd', value: 40 });
    const coldText = t(cold?.key as never, cold?.nums as never);
    expect(coldText).toContain('Living Warmth');
    expect(coldText).toContain('every 2% of your maximum health healed (4% on Heroic and Mythic)');
  });

  it("the carrier's own alert: leave the group, the healing left, its seconds", () => {
    const v = buildQuenchAlertView({
      auras: [crust, { id: QUENCH_AURAS.cold, value: 40, value2: 1 }],
    });
    expect(v.visible).toBe(true);
    if (!v.visible) return;
    expect(v.kind).toBe('rime');
    expect(v.title).toContain('Leave the group');
    expect(v.barLabel).toBe('Rime 420 / 600');
    expect(v.progress).toBeCloseTo(0.7, 9);
    expect(v.line).toContain('7 sec');
    expect(v.line).toContain('6 yd');
    // The freeze still comes first.
    const frozen = buildQuenchAlertView({
      auras: [crust, { id: QUENCH_AURAS.frozen, remaining: 3, duration: 6 }],
    });
    expect(frozen.visible && frozen.kind).toBe('frozen');
  });

  it("the raid frame badges the healing left as a share of the carrier's health", () => {
    const rows = partyFrameAuras(
      [
        {
          id: QUENCH_AURAS.rime,
          name: QUENCH_NAMES.rime,
          kind: 'heal_absorb',
          remaining: 6,
          duration: 10,
          value: 450,
          value2: 600,
          sourceId: 1,
          school: 'frost',
        },
      ],
      undefined,
      1200,
    );
    expect(rows[0]).toMatchObject({ id: QUENCH_AURAS.rime, poolPct: 38 });
    const d = auraEffectDescriptor({
      id: QUENCH_AURAS.rime,
      kind: 'heal_absorb',
      value: 1,
      poolPct: 38,
    });
    expect(t(d?.key as never, d?.nums as never)).toContain('38% of their maximum health');
  });

  it('sounds its close, its fall and its burst, and pings its carrier', () => {
    expect(QUENCH_CUE_SOUNDS[QUENCH_CUES.rime]?.key).toBe('heart_quench_bite');
    expect(QUENCH_CUE_SOUNDS[QUENCH_CUES.rimeBreak]?.key).toBe('heart_quench_bite');
    expect(QUENCH_CUE_SOUNDS[QUENCH_CUES.rimeBurst]?.key).toBe('heart_quench_shatter');
    expect(QUENCH_MARK_SOUNDS[QUENCH_AURAS.rime]).toBeDefined();
    expect(QUENCH_COLD_SOUNDS.warn.key).toBe('heart_quench_cold_warn');
    for (const cue of [QUENCH_CUES.rime, QUENCH_CUES.rimeBreak, QUENCH_CUES.rimeBurst])
      expect(quenchFightClaims(cue), cue).toBe(true);
  });

  it('its crust melts plate by plate as it is healed, its ring fills with its clock', () => {
    const P = QUENCH_RIME_POOLS.platesPer;
    expect(rimeLook(600, 600, 10, 0).plates).toBe(P);
    expect(rimeLook(300, 600, 10, 0).plates).toBe(Math.ceil(P / 2));
    expect(rimeLook(1, 600, 10, 0).plates).toBe(1);
    expect(rimeLook(0, 600, 10, 0).plates).toBe(0);
    expect(rimeLook(600, 600, 10, 0).fill).toBeCloseTo(0, 9);
    expect(rimeLook(600, 600, 2.5, 0).fill).toBeCloseTo(0.75, 9);
    // Plates sit still on the body (hashed by the carrier and the plate).
    expect(rimePlate(7, 3)).toEqual(rimePlate(7, 3));
    for (let k = 0; k < P; k++) {
      const p = rimePlate(7, k);
      expect(p.h).toBeGreaterThan(0.2);
      expect(p.h).toBeLessThan(2.3);
    }
  });

  it('draws the crust and the ring for a carrier, on the shared ice, and lets go of them', () => {
    const scene = new THREE.Scene();
    const fx = new QuenchFightFx(scene, () => 0);
    const carrier = {
      id: 77,
      kind: 'player',
      dead: false,
      pos: { x: 10, y: 0, z: 10 },
      auras: [{ ...crust, name: QUENCH_NAMES.rime, sourceId: 1, school: 'frost' }],
    };
    const world = { entities: new Map([[77, carrier]]) } as never;
    fx.rime.frame(world, [77], 1);
    expect(fx.rime.shownRings()).toBe(1);
    expect(fx.rime.drawnPlates()).toBe(rimeLook(420, 600, 6.2, 1).plates);
    let plates: THREE.InstancedMesh | null = null;
    scene.traverse((o) => {
      if (o.name === 'smithHeartQuenchRimeCrust') plates = o as THREE.InstancedMesh;
    });
    expect(plates).not.toBeNull();
    const mesh = plates as unknown as THREE.InstancedMesh;
    expect(mesh.visible).toBe(true);
    expect(mesh.instanceColor).toBeNull();
    // Healed down to a sliver: fewer plates, the ring stays.
    carrier.auras[0].value = 30;
    fx.rime.frame(world, [77], 1.1);
    expect(fx.rime.drawnPlates()).toBe(1);
    fx.rime.clear();
    expect(fx.rime.shownRings()).toBe(0);
    expect(mesh.visible).toBe(false);
    fx.dispose();
  });
});
