// The Guardian of the Breath's rework of 2026-11-03 over a REAL Sim claim
// (src/sim/encounters/smith_heart/breath_isles.ts, breath_cradle.ts): the
// Islands of the Wind (the Gale Bulwark at each tier's marks, the isles'
// adds, the regrowth while any lives, the Gale Mender's kickable Mending
// Gale, the scripted ride out and home on its fixed arc, the Homeward Gale
// when the last add falls, mythic's Windworn, the break, the burst that keeps
// the fight from stalling, a reset that brings every rider home), the
// CHANNELED Thunder's Cradle (nothing else cast, heroic's three lifted), and
// the Summit Roar that throws a raid tanked by the edge off the Cornice.

import { describe, expect, it } from 'vitest';
import { BREATH, BREATH_ISLES } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_MOBS,
  ISLE_NAMES,
  ISLE_OBJECTS,
  ISLE_TUNING as IT,
  inBreathArena,
  isleAt,
  isleSpots,
  rideArc,
  rideOf,
  rideTemplate,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { dischargeCradles } from '../src/sim/encounters/smith_heart/breath_cradle';
import { islePlayers } from '../src/sim/encounters/smith_heart/breath_isles';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';
import { hitsOf } from './helpers/council_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

/** Hold the wind calm: on the open rim an idle raid is carried off the edge. */
function stillAir(f: BreathFight): void {
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (st) {
    st.wind.remaining = 9999;
    st.inhaleTimer = 9999;
    st.circleTimer = 9999;
  }
}

function pulled(n = 6, tier: '' | 'heroic' | 'mythic' = '', seed = 23): BreathFight {
  const f = breathFight(n, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  if (tier) f.dev(`/dev heart breath ${tier}`);
  f.tick(2);
  stillAir(f);
  // Everyone on the threat table (a real raid fights it): one rider leaving
  // the Cornice is never the guardian's last target.
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  return f;
}

/** Take the guardian just under a health mark and let the round start. */
function crossMark(f: BreathFight, frac: number): void {
  const b = f.boss();
  b.hp = Math.floor(b.maxHp * frac) - 1;
  for (let i = 0; i < ticks(3) && !f.state()?.isles.round; i++) f.tick();
}

function addsOf(f: BreathFight): Entity[] {
  return (f.state()?.isles.adds ?? [])
    .map((a) => f.sim.ctx.entities.get(a.id))
    .filter((e): e is Entity => !!e && !e.dead);
}

function shield(f: BreathFight) {
  return f.boss().auras.find((a) => a.id === ISLE_AURAS.bulwark);
}

/** Ride `p` out by stepping into isle `i`'s Gale Path; returns once landed. */
function rideOut(f: BreathFight, p: Entity, i: number): SimEvent[] {
  const path = isleSpots()[i].path;
  f.put(p, path.x, path.z);
  return f.tick(ticks(IT.rideSeconds + 0.6));
}

describe('the Islands of the Wind: the round', () => {
  it('normal: at 70 the Bulwark rises on a channel, one isle wakes with a Sentinel and a Mender', () => {
    const f = pulled(4);
    const b = f.boss();
    crossMark(f, 0.85);
    expect(f.state()?.isles.round).toBeNull();
    crossMark(f, BREATH_DIFFICULTY.normal.isleAt[0]);
    const round = f.state()?.isles.round;
    expect(round?.isles.length).toBe(1);
    const s = shield(f);
    expect(s?.kind).toBe('absorb');
    expect(s?.value).toBe(Math.round(b.maxHp * IT.bulwarkShare));
    expect(b.castingAbility).toBe(ISLE_CASTS.bulwark);
    expect(b.channeling).toBe(true);
    const adds = addsOf(f);
    expect(adds.map((e) => e.templateId).sort()).toEqual(
      [ISLE_MOBS.mender, ISLE_MOBS.sentinel].sort(),
    );
    for (const e of adds) {
      const at = f.local(e);
      expect(isleAt(at.x, at.z)).toBe(round?.isles[0]);
    }
    expect(f.objects(ISLE_OBJECTS.pathPrefix)).toHaveLength(1);
    // Planted: no swing, no other bar while it holds.
    const at = { ...b.pos };
    f.tick(ticks(4));
    expect(b.pos.x).toBe(at.x);
    expect(b.castingAbility).toBe(ISLE_CASTS.bulwark);
  });

  it('heroic and mythic: both isles at 80, and again at 60; one round per mark', () => {
    for (const tier of ['heroic', 'mythic'] as const) {
      const f = pulled(4, tier);
      crossMark(f, 0.8);
      expect(f.state()?.isles.round?.isles).toEqual([0, 1]);
      expect(addsOf(f)).toHaveLength(4);
      expect(f.objects(ISLE_OBJECTS.pathPrefix)).toHaveLength(2);
      f.dev('/dev heart breath bulwark');
      f.tick(2);
      expect(f.state()?.isles.round).toBeNull();
      expect(addsOf(f)).toHaveLength(0);
      expect(f.objects(ISLE_OBJECTS.pathPrefix)).toHaveLength(0);
      crossMark(f, 0.6);
      expect(f.state()?.isles.round?.isles).toEqual([0, 1]);
      expect(f.state()?.isles.next).toBe(2);
    }
  });

  it('the Bulwark regrows while any add lives, and only then', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const whole = f.state()?.isles.round?.whole ?? 0;
    const s = shield(f);
    if (!s) throw new Error('no bulwark');
    s.value = whole * 0.2;
    // Out of the Mender's way (its channel is its own test).
    for (const a of f.state()?.isles.adds ?? []) a.next = 999;
    f.tick(ticks(2));
    expect(s.value).toBeCloseTo(whole * (0.2 + IT.regrowShare * 2), -1);
    f.dev('/dev heart breath killisle');
    const before = s.value;
    f.tick(ticks(2));
    expect(s.value).toBe(before);
  });

  it("the Mender's Mending Gale restores the Bulwark; a kick cuts it and it starts over", () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const st = f.state();
    const whole = st?.isles.round?.whole ?? 0;
    const mender = addsOf(f).find((e) => e.templateId === ISLE_MOBS.mender) as Entity;
    const sentinel = addsOf(f).find((e) => e.templateId === ISLE_MOBS.sentinel) as Entity;
    // The regrowth alone off (the Sentinel gone), the Mender's channel left.
    f.sim.ctx.dealDamage(null, sentinel, sentinel.hp + 1, false, 'physical', null, 'hit', true);
    const s = shield(f);
    if (!s) throw new Error('no bulwark');
    for (
      let i = 0;
      i < ticks(IT.mendFirst + 1) && mender.castingAbility !== ISLE_CASTS.mending;
      i++
    )
      f.tick();
    expect(mender.castingAbility).toBe(ISLE_CASTS.mending);
    expect(mender.channeling).toBe(true);
    // A kick (the interrupt clears the cast): nothing restored.
    s.value = whole * 0.1;
    f.sim.ctx.cancelCast(mender);
    f.tick(ticks(IT.mendCast + 0.5));
    expect(s.value).toBeLessThan(whole * 0.1 + whole * IT.regrowShare * (IT.mendCast + 1));
    // Uninterrupted the next time: a third of the whole back.
    for (
      let i = 0;
      i < ticks(IT.mendEvery + 1) && mender.castingAbility !== ISLE_CASTS.mending;
      i++
    )
      f.tick();
    const v0 = s.value;
    const ev = f.tick(ticks(IT.mendCast + 0.2));
    expect(s.value - v0).toBeGreaterThan(whole * IT.mendShare - whole * 0.05);
    expect(ev.some((e) => e.type === 'spellfx' && e.sourceId === mender.id)).toBe(true);
  });

  it('broken, the round ends: the guardian fights on, the adds and the paths go', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const b = f.boss();
    const s = shield(f);
    if (!s) throw new Error('no bulwark');
    f.dev('/dev heart breath killisle');
    // The raid strikes it down.
    f.sim.ctx.dealDamage(f.players[0], b, s.value + 5, false, 'physical', null, 'hit', true);
    f.tick(2);
    expect(f.state()?.isles.round).toBeNull();
    expect(b.castingAbility).not.toBe(ISLE_CASTS.bulwark);
    expect(shield(f)).toBeUndefined();
    expect(f.objects(ISLE_OBJECTS.pathPrefix)).toHaveLength(0);
  });

  it('held too long it bursts over the Cornice and the round ends (the fight never stalls)', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const ev = f.tick(ticks(IT.bulwarkMax + 1));
    expect(f.state()?.isles.round).toBeNull();
    expect(addsOf(f)).toHaveLength(0);
    const hits = hitsOf(ev, ISLE_NAMES.burst);
    expect(hits.length).toBe(f.players.length);
    for (const h of hits) expect(h).toBeGreaterThanOrEqual(IT.burstMin);
  });
});

describe('the Islands of the Wind: the ride', () => {
  it('the arc is fixed: its ends exact, its middle over both, eased', () => {
    const a = { x: 0, y: 60, z: 0 };
    const b = { x: 30, y: 66, z: 10 };
    expect(rideArc(a, b, 0)).toEqual(a);
    const end = rideArc(a, b, 1);
    expect(end.x).toBeCloseTo(b.x, 9);
    expect(end.y).toBeCloseTo(b.y, 9);
    const mid = rideArc(a, b, 0.5);
    expect(mid.y).toBeCloseTo(66 + IT.rideApex, 6);
    expect(rideArc(a, b, 0.25).x).toBeLessThan(30 * 0.25);
    expect(rideOf(rideTemplate('home', 1, 3.2))).toEqual({ dir: 'home', isle: 1, seconds: 3.2 });
  });

  it('a Gale Path carries a player to the isle, stunned, over the void; the wardens turn on them', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    const path = isleSpots()[i].path;
    f.put(p, path.x, path.z);
    f.tick(2);
    expect(p.carriedBy).toBeDefined();
    expect(has(p, ISLE_AURAS.riding)).toBe(true);
    expect(f.objects(ISLE_OBJECTS.ridePrefix)).toHaveLength(1);
    // Halfway: high over the void, never on any floor.
    f.tick(ticks(IT.rideSeconds / 2));
    const mid = f.local(p);
    expect(p.pos.y).toBeGreaterThan(BREATH_ISLES[i].h + IT.rideApex * 0.6);
    expect(inBreathArena(mid.x, mid.z)).toBe(false);
    expect(p.dead).toBe(false);
    f.tick(ticks(IT.rideSeconds / 2 + 0.3));
    const at = f.local(p);
    expect(isleAt(at.x, at.z)).toBe(i);
    expect(p.carriedBy).toBeUndefined();
    expect(has(p, ISLE_AURAS.riding)).toBe(false);
    expect(p.pos.y).toBeCloseTo(BREATH_ISLES[i].h, 0);
    expect(islePlayers(f.sim.ctx, f.inst).map((q) => q.p.id)).toContain(p.id);
    for (const e of addsOf(f))
      if (f.state()?.isles.adds.find((a) => a.id === e.id)?.isle === i)
        expect(e.threat.has(p.id)).toBe(true);
  });

  it('the last add falls: a Homeward Gale rises and carries them back beside the path', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    rideOut(f, p, i);
    expect(f.objects(ISLE_OBJECTS.homePrefix)).toHaveLength(0);
    f.dev('/dev heart breath killisle');
    f.tick(2);
    expect(f.objects(ISLE_OBJECTS.homePrefix)).toHaveLength(1);
    const home = isleSpots()[i].home;
    f.put(p, home.x, home.z);
    f.tick(ticks(IT.rideSeconds + 0.6));
    const at = f.local(p);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    const back = isleSpots()[i].back;
    expect(Math.hypot(at.x - back.x, at.z - back.z)).toBeLessThan(2);
    // Normal and heroic: no Windworn.
    expect(has(p, ISLE_AURAS.windworn)).toBe(false);
    // Nobody left on the isle: its Homeward Gale goes.
    f.tick(2);
    expect(f.objects(ISLE_OBJECTS.homePrefix)).toHaveLength(0);
  });

  it('heroic: the same player rides again; mythic: Windworn keeps them home', () => {
    for (const tier of ['heroic', 'mythic'] as const) {
      const f = pulled(4, tier);
      crossMark(f, 0.8);
      const p = f.players[2];
      rideOut(f, p, 0);
      // Clear isle 0 only, ride home.
      for (const a of f.state()?.isles.adds ?? []) {
        const e = f.sim.ctx.entities.get(a.id);
        if (e && a.isle === 0)
          f.sim.ctx.dealDamage(null, e, e.hp + 1, false, 'physical', null, 'hit', true);
      }
      f.tick(2);
      const home = isleSpots()[0].home;
      f.put(p, home.x, home.z);
      f.tick(ticks(IT.rideSeconds + IT.rideGrace * 2 + 1));
      expect(has(p, ISLE_AURAS.windworn)).toBe(tier === 'mythic');
      // The other isle's path still stands: step in.
      const path = isleSpots()[1].path;
      f.put(p, path.x, path.z);
      f.tick(3);
      expect(p.carriedBy !== undefined).toBe(tier === 'heroic');
    }
  });

  it('a reset brings every rider and every body on an isle back to the Cornice', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const i = f.state()?.isles.round?.isles[0] as number;
    const rider = f.players[2];
    rideOut(f, rider, i);
    const flying = f.players[3];
    const path = isleSpots()[i].path;
    f.put(flying, path.x, path.z);
    f.tick(10);
    expect(flying.carriedBy).toBeDefined();
    f.dev('/dev heart breath reset');
    f.tick(2);
    for (const p of [rider, flying]) {
      const at = f.local(p);
      expect(inBreathArena(at.x, at.z)).toBe(true);
      expect(p.carriedBy).toBeUndefined();
      expect(p.pos.y).toBeCloseTo(BREATH.cornice.h, 0);
    }
    expect(addsOf(f)).toHaveLength(0);
    expect(f.objects(ISLE_OBJECTS.ridePrefix)).toHaveLength(0);
  });

  it('is deterministic: the same seed picks the same isle and raises the same adds', () => {
    const trace = () => {
      const f = pulled(4, '', 41);
      crossMark(f, 0.7);
      return JSON.stringify({
        isles: f.state()?.isles.round?.isles,
        adds: addsOf(f).map((e) => [
          e.templateId,
          f.local(e).x.toFixed(3),
          f.local(e).z.toFixed(3),
        ]),
      });
    };
    expect(trace()).toBe(trace());
  });
});

describe("Thunder's Cradle, channeled", () => {
  function storm(n: number, tier: '' | 'heroic' = ''): BreathFight {
    const f = pulled(n, tier);
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast + T.barrageSeconds + 1));
    const st = f.state();
    if (st) {
      st.forkTimer = 999;
      st.drawnTimer = 999;
      st.cradleTimer = 999;
      st.gustTimer = 999;
    }
    return f;
  }

  it('the guardian channels it: planted, no other bar while the lifted hang', () => {
    const f = storm(6);
    const b = f.boss();
    f.dev('/dev heart breath eye');
    f.tick(ticks(T.cradleCast) + 1);
    expect(b.castingAbility).toBe(BREATH_CASTS.cradleHold);
    expect(b.channeling).toBe(true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Everything else comes due: none begins.
    st.forkTimer = 0;
    st.drawnTimer = 0;
    const seen = new Set<string>();
    for (let i = 0; i < ticks(T.cradleHold - 0.5); i++) {
      f.tick();
      if (b.castingAbility) seen.add(b.castingAbility);
    }
    expect([...seen]).toEqual([BREATH_CASTS.cradleHold]);
    f.tick(ticks(1));
    expect(st.cradles).toHaveLength(0);
  });

  it('normal lifts one; heroic three, each its own circle and its own split', () => {
    for (const tier of ['', 'heroic'] as const) {
      const f = storm(9, tier);
      // Spread wide, so each lifted player's circle stands alone.
      f.players.forEach((p, k) => {
        f.put(p, -24 + (k % 3) * 18, 178 + Math.floor(k / 3) * 14);
      });
      f.dev('/dev heart breath eye');
      f.tick(ticks(T.cradleCast) + 2);
      const st = f.state();
      if (!st) throw new Error('no fight');
      const want = BREATH_DIFFICULTY[tier || 'normal'].cradleCount;
      expect(st.cradles).toHaveLength(want);
      expect(new Set(st.cradles.map((c) => c.playerId)).size).toBe(want);
      for (const c of st.cradles) {
        const p = f.sim.ctx.entities.get(c.playerId) as Entity;
        expect(has(p, BREATH_AURAS.cradled)).toBe(true);
        expect(p.carriedBy).toBeDefined();
      }
      if (tier === 'heroic') {
        // Two under each circle (three with its lifted): every split even.
        const free = f.players.filter((p) => !st.cradles.some((c) => c.playerId === p.id));
        st.cradles.forEach((c, k) => {
          for (const p of free.slice(k * 2, k * 2 + 2)) f.put(p, c.x + 0.5, c.z);
        });
        const scope = {
          ctx: f.sim.ctx,
          inst: f.inst,
          st,
          boss: f.boss(),
          players: f.players.filter((p) => !p.dead),
          rules: BREATH_DIFFICULTY.heroic,
        };
        const under = dischargeCradles(scope);
        expect(under.map((u) => u.length)).toEqual([3, 3, 3]);
      }
    }
  });
});

describe('the Summit Roar', () => {
  it('a raid drawn to a guardian tanked by the edge is thrown off the Cornice', () => {
    const f = pulled(4);
    const b = f.boss();
    // The guardian at the east rim, the raid gathered at its mouth.
    const edge = isleSpots()[0].path;
    const isle = isleSpots()[0];
    const ox = (isle.x - edge.x) / Math.hypot(isle.x - edge.x, isle.z - edge.z);
    const oz = (isle.z - edge.z) / Math.hypot(isle.x - edge.x, isle.z - edge.z);
    const bw = f.world(edge.x - ox * 3, edge.z - oz * 3);
    b.pos.x = bw.x;
    b.pos.z = bw.z;
    b.pos.y = f.sim.ctx.groundPos(bw.x, bw.z).y;
    f.sim.ctx.rebucket(b);
    const victims = f.players.slice(1);
    // On its outer side, between it and the rim.
    victims.forEach((p, k) => {
      f.put(p, edge.x + ox * 1.5 - oz * (k - 1) * 2, edge.z + oz * 1.5 + ox * (k - 1) * 2);
    });
    f.dev('/dev heart breath roar');
    for (let i = 0; i < ticks(T.inhaleCast + T.gustCast + 6); i++) f.tick(1, false);
    expect(victims.some((p) => p.dead)).toBe(true);
  });

  it('is named Summit Roar everywhere the player reads it', () => {
    expect(BREATH_NAMES.gust).toBe('Summit Roar');
    expect(localizeSimAuraName('Summit Roar')).toBe('Summit Roar');
    expect(t(`abilityUi.cast.${BREATH_CASTS.gust}` as never)).toBe('Summit Roar');
  });
});

describe('the Islands of the Wind: what the raid reads', () => {
  it('every new aura says its rule; every name and bar is localized', () => {
    for (const id of [ISLE_AURAS.bulwark, ISLE_AURAS.riding, ISLE_AURAS.windworn]) {
      const d = auraEffectDescriptor({ id, kind: 'absorb', value: 1234 });
      const text = t(d?.key as never, d?.nums as never);
      expect(text, id).not.toMatch(/\{\w+\}/);
      if (id === ISLE_AURAS.bulwark) expect(text).toContain('1234');
    }
    for (const name of Object.values(ISLE_NAMES))
      expect(localizeSimAuraName(name), name).toBe(name);
    for (const id of Object.values(ISLE_CASTS))
      expect(t(`abilityUi.cast.${id}` as never), id).not.toContain('abilityUi');
    expect(t('abilityUi.cast.heart_breath_cradle_channel' as never)).toBe("Thunder's Cradle");
  });

  it('calls no raid warning banner through a whole round', () => {
    const f = pulled(4);
    const ev: SimEvent[] = [];
    crossMark(f, 0.7);
    ev.push(...rideOut(f, f.players[2], f.state()?.isles.round?.isles[0] as number));
    f.dev('/dev heart breath killisle');
    ev.push(...f.tick(ticks(3)));
    expect(ev.some((e) => e.type === 'chat' && e.channel === 'raidWarning')).toBe(false);
  });
});

describe('the Islands of the Wind: the review gaps', () => {
  it('a stunned Mender stops channeling and restores nothing', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const mender = addsOf(f).find((e) => e.templateId === ISLE_MOBS.mender) as Entity;
    const sentinel = addsOf(f).find((e) => e.templateId === ISLE_MOBS.sentinel) as Entity;
    f.sim.ctx.dealDamage(null, sentinel, sentinel.hp + 1, false, 'physical', null, 'hit', true);
    for (
      let i = 0;
      i < ticks(IT.mendFirst + 1) && mender.castingAbility !== ISLE_CASTS.mending;
      i++
    )
      f.tick();
    expect(mender.castingAbility).toBe(ISLE_CASTS.mending);
    const s = shield(f);
    if (!s) throw new Error('no bulwark');
    s.value = 10;
    f.sim.ctx.applyAura(mender, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: IT.mendCast + 1,
      duration: IT.mendCast + 1,
      value: 0,
      sourceId: f.players[1].id,
      school: 'physical',
    });
    f.tick(2);
    expect(mender.castingAbility).not.toBe(ISLE_CASTS.mending);
    f.tick(ticks(IT.mendCast));
    expect(s.value).toBeLessThan(f.boss().maxHp * IT.bulwarkShare * IT.mendShare);
  });

  it("the Knotted Gale's carrier and the anchored never ride", () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    p.auras.push({
      id: BREATH_AURAS.laden,
      name: 'Gale-Laden',
      kind: 'internal_cd',
      remaining: 20,
      duration: 20,
      value: 0.2,
      sourceId: f.boss().id,
      school: 'nature',
    });
    const path = isleSpots()[i].path;
    f.put(p, path.x, path.z);
    f.tick(4);
    expect(p.carriedBy).toBeUndefined();
  });

  it('a rider who dies in the air is set down, and no warden turns on the corpse', () => {
    const f = pulled(4);
    crossMark(f, 0.7);
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    const path = isleSpots()[i].path;
    f.put(p, path.x, path.z);
    f.tick(10);
    expect(p.carriedBy).toBeDefined();
    f.sim.ctx.dealDamage(null, p, p.hp + 1, false, 'physical', null, 'hit', true);
    f.tick(3, false);
    expect(p.carriedBy).toBeUndefined();
    expect(f.state()?.isles.rides).toHaveLength(0);
    for (const e of addsOf(f)) expect(e.threat.has(p.id)).toBe(false);
  });
});
