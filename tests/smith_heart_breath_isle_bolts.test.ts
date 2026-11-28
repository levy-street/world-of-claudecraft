// Isle Lightning (encounters/smith_heart/breath_isle_bolts.ts; the team's
// playtest of 2026-11-25: the isles' adds read as a pinata): while an isle's
// adds stand and its Closing Storm closes, a volley of telegraphed strikes
// falls on it every tier's `boltEvery`; one under a hashed player, one on its
// floor; a share of health to whoever stays in the circle, nothing to whoever
// steps out; none once the adds are down; deterministic.

import { describe, expect, it } from 'vitest';
import { breathScopeForDev } from '../src/sim/encounters/smith_heart/breath';
import { BREATH_OBJECTS } from '../src/sim/encounters/smith_heart/breath_ids';
import { livingIsleAdds } from '../src/sim/encounters/smith_heart/breath_isle_adds';
import { isleBoltSpot, startIsleBolts } from '../src/sim/encounters/smith_heart/breath_isle_bolts';
import {
  cornicePads,
  isleAt,
  isleSpots,
} from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import { ISLE_TIERS, ISLE_TUNING as IT } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { DT, type Entity } from '../src/sim/types';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);
const scope = (f: BreathFight) => {
  const s = breathScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no fight');
  return s;
};

function stillAir(f: BreathFight): void {
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (st) {
    st.wind.remaining = 9999;
    st.inhaleTimer = 9999;
    st.circleTimer = 9999;
    st.skyTimer = 9999;
    st.blowTimer = 9999;
    st.heartTimer = 9999;
  }
}

function pulled(n: number, tier: '' | 'heroic', seed = 23): BreathFight {
  const f = breathFight(n, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  if (tier) f.dev(`/dev heart breath ${tier}`);
  f.tick(2);
  stillAir(f);
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  b.hp = Math.floor(b.maxHp * 0.5) - 5;
  for (let i = 0; i < ticks(2) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
  expect(f.state()?.isles.stage).toBe('nova');
  return f;
}

/** Ride `p` out to the first east isle, its adds held off (no other hits). */
function onIsle(f: BreathFight, p: Entity): void {
  const at = cornicePads()[isleSpots()[0].side];
  f.tick(ticks(IT.rideGrace + 0.1));
  f.put(p, at.x, at.z);
  f.tick(ticks(IT.rideSeconds + 0.6));
  expect(isleAt(f.local(p).x, f.local(p).z)).toBe(0);
  for (const e of livingIsleAdds({ ctx: f.sim.ctx, inst: f.inst, st: f.state()! } as never, 0)) {
    e.encounterHeld = true;
    e.inCombat = false;
  }
}

const bolts = (f: BreathFight) =>
  (f.state()?.isles.strikes ?? []).filter((k) => k.share !== undefined);

describe('Isle Lightning', () => {
  it('a volley falls on a landed isle on its clock: one under a player, one on its floor', () => {
    const f = pulled(4, '');
    const p = f.players[1];
    onIsle(f, p);
    const st = f.state()!.isles.isles[0];
    expect(st.bolt).toBeDefined();
    expect(bolts(f)).toHaveLength(0);
    f.tick(ticks(IT.boltFirst) + 2);
    const laid = bolts(f);
    expect(laid).toHaveLength(IT.boltMarks + IT.boltSpots);
    // One under the lone player, the other on the isle's own floor.
    expect(laid.some((k) => Math.hypot(k.x - f.local(p).x, k.z - f.local(p).z) < 1)).toBe(true);
    for (const k of laid) expect(isleAt(k.x, k.z)).toBe(0);
    expect(f.objects(BREATH_OBJECTS.strikePrefix).length).toBeGreaterThanOrEqual(laid.length);
    // The next on the tier's clock.
    expect(st.bolt ?? 0).toBeGreaterThan(ISLE_TIERS.normal.boltEvery - 1);
    expect(st.bolt ?? 0).toBeLessThanOrEqual(ISLE_TIERS.normal.boltEvery);
  });

  it('stand in it and it hurts a share of health; step out and it misses', () => {
    for (const tier of ['', 'heroic'] as const) {
      const f = pulled(4, tier);
      const p = f.players[1];
      onIsle(f, p);
      p.hp = p.maxHp;
      startIsleBolts(scope(f), 0);
      f.tick(ticks(IT.boltWarn + 0.2), false);
      const share = ISLE_TIERS[tier || 'normal'].boltShare;
      expect(p.maxHp - p.hp).toBeGreaterThanOrEqual(Math.round(p.maxHp * share) - 1);
      expect(p.dead).toBe(false);
      // Again, but stepped out of the circle before it lands.
      p.hp = p.maxHp;
      startIsleBolts(scope(f), 0);
      const k = bolts(f).find((b) => Math.hypot(b.x - f.local(p).x, b.z - f.local(p).z) < 1);
      expect(k).toBeDefined();
      const sp = isleSpots()[0];
      // A spot on the isle clear of every strike laid.
      let clear: { x: number; z: number } | null = null;
      for (let a = 0; a < 64 && !clear; a++) {
        const r = sp.r * 0.55;
        const x = sp.x + Math.sin(a) * r;
        const z = sp.z + Math.cos(a) * r;
        if (isleAt(x, z) !== 0) continue;
        if (bolts(f).every((b) => Math.hypot(b.x - x, b.z - z) > IT.boltR + 1)) clear = { x, z };
      }
      expect(clear).not.toBeNull();
      f.put(p, clear!.x, clear!.z);
      f.tick(ticks(IT.boltWarn + 0.2), false);
      expect(p.hp).toBe(p.maxHp);
    }
  });

  it('none once the isle is cleared, none before anyone landed', () => {
    const f = pulled(4, '');
    f.tick(ticks(IT.boltFirst + 3));
    expect(bolts(f)).toHaveLength(0);
    const p = f.players[1];
    onIsle(f, p);
    for (const e of livingIsleAdds({ ctx: f.sim.ctx, inst: f.inst, st: f.state()! } as never, 0))
      f.sim.ctx.dealDamage(f.boss(), e, e.hp * 20 + 1, false, 'nature', 'Test', 'hit', true);
    f.tick(2);
    expect(f.state()!.isles.isles[0].cleared).toBe(true);
    f.tick(ticks(IT.boltFirst + ISLE_TIERS.normal.boltEvery + 1));
    expect(bolts(f)).toHaveLength(0);
  });

  it('hashed spots stay on the isle and repeat for the same salt', () => {
    for (let i = 0; i < 6; i++)
      for (let salt = 1; salt < 40; salt += 7) {
        const a = isleBoltSpot(i, salt);
        const b = isleBoltSpot(i, salt);
        expect(a).toEqual(b);
        if (a) expect(isleAt(a.x, a.z)).toBe(i);
      }
  });
});
