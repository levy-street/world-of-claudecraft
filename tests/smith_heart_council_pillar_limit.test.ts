// The Hammer Council's Narrow Shelter over a REAL Sim claim: from Heroic up a pillar
// shields only so many from Mountain's Wrath; one too many and everyone behind it
// takes part of the blast. Normal keeps no limit. Plus the rule's aura on the
// caster's bar (what the client reads) and the pure runes.

import { describe, expect, it } from 'vitest';
import {
  COVER_BREATH,
  pillarShelterCounts,
  shelterRunes,
} from '../src/render/smith_heart_fx/council_fx_core';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  councilShelterHalf,
  inCouncilShelter,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { raisePillar } from '../src/sim/encounters/smith_heart/council_pillars';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };

function pulled(n: number, tier?: 'heroic' | 'mythic'): CouncilFight {
  const f = councilFight(n, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  return f;
}

/** Hide `hiding` players behind column 0 from a Guardian at the pit's middle. */
function hide(f: CouncilFight, hiding: number): Entity[] {
  const g = f.bodies().guardian as Entity;
  const w = f.world(MID.x, MID.z);
  g.pos.x = w.x;
  g.pos.z = w.z;
  g.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  g.prevPos = { ...g.pos };
  f.sim.ctx.rebucket(g);
  const col = QUARRY_PILLAR_SPOTS[0];
  const dx = (col.x - MID.x) / 24;
  const dz = (col.z - MID.z) / 24;
  const behind = f.players.slice(0, hiding);
  for (const p of behind) f.put(p, MID.x + dx * 30, MID.z + dz * 30);
  return behind;
}

const wrathOn = (ev: SimEvent[], p: Entity) =>
  ev.filter(
    (e) =>
      e.type === 'damage' &&
      e.targetId === p.id &&
      (e as { ability?: string }).ability === COUNCIL_NAMES.wrath,
  ) as (SimEvent & { amount: number })[];

function land(f: CouncilFight): SimEvent[] {
  expect(f.dev('/dev heart council wrath')).toBe(true);
  return f.tick(Math.ceil(T.wrathCast * 20) + 2);
}

describe('Hammer Council: Narrow Shelter', () => {
  it('the limits: Normal 5, Heroic 4, Mythic 3', () => {
    expect(COUNCIL_DIFFICULTY.normal.pillarLimit).toBe(5);
    expect(COUNCIL_DIFFICULTY.heroic.pillarLimit).toBe(4);
    expect(COUNCIL_DIFFICULTY.mythic.pillarLimit).toBe(3);
  });

  it('normal: five are safe, a sixth and all six take part of the blast', () => {
    const f = pulled(5);
    const behind = hide(f, 5);
    const ev = land(f);
    for (const p of behind) expect(wrathOn(ev, p)).toEqual([]);
    const g = pulled(6);
    const six = hide(g, 6);
    const ev6 = land(g);
    for (const p of six) {
      const hits = wrathOn(ev6, p);
      expect(hits.length).toBe(1);
      expect(hits[0].amount).toBeLessThanOrEqual(
        Math.ceil(T.wrathMax * COUNCIL_DIFFICULTY.normal.crowdShare),
      );
    }
  });

  for (const [tier, limit] of [
    ['normal', 5],
    ['heroic', 4],
    ['mythic', 3],
  ] as const) {
    it(`${tier}: ${limit} players fit side by side in one risen pillar's shadow`, () => {
      const f = pulled(limit + 1, tier === 'normal' ? undefined : tier);
      const g = f.bodies().guardian as Entity;
      const w = f.world(MID.x, MID.z);
      g.pos.x = w.x;
      g.pos.z = w.z;
      g.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
      g.prevPos = { ...g.pos };
      f.sim.ctx.rebucket(g);
      // Only a risen pillar stands, 14 yd out toward column 0.
      for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
      f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
      const col = QUARRY_PILLAR_SPOTS[0];
      const ux = (col.x - MID.x) / Math.hypot(col.x - MID.x, col.z - MID.z);
      const uz = (col.z - MID.z) / Math.hypot(col.x - MID.x, col.z - MID.z);
      const at = { x: MID.x + ux * 14, z: MID.z + uz * 14 };
      const risen = raisePillar(f.sim.ctx, f.inst, g, [g], [], at.x, at.z, 1);
      expect(risen).not.toBeNull();
      const pl = f.pillars()[0];
      const pr = f.local(pl.e);
      // The players in a row across the shadow, a stride behind the stone,
      // spaced a body apart (0.8 yd): the row is the limit wide.
      const behind = f.players.slice(1, 1 + limit);
      const back = { x: pr.x + ux * (pl.r + 1.2), z: pr.z + uz * (pl.r + 1.2) };
      behind.forEach((p, i) => {
        const off = (i - (limit - 1) / 2) * 0.8;
        f.put(p, back.x - uz * off, back.z + ux * off);
      });
      f.put(f.players[0], MID.x + 3, MID.z);
      const ev = land(f);
      for (const p of behind) expect(wrathOn(ev, p), p.name).toEqual([]);
    });
  }

  it('heroic: four are safe', () => {
    const f = pulled(4, 'heroic');
    const behind = hide(f, 4);
    const ev = land(f);
    for (const p of behind) expect(wrathOn(ev, p)).toEqual([]);
  });

  it('heroic: a fifth and all five take part of the blast', () => {
    const f = pulled(5, 'heroic');
    const behind = hide(f, 5);
    const ev = land(f);
    const mult = COUNCIL_DIFFICULTY.heroic.damageMult * COUNCIL_DIFFICULTY.heroic.wrathMult;
    for (const p of behind) {
      const hits = wrathOn(ev, p);
      expect(hits.length).toBe(1);
      expect(hits[0].amount).toBeLessThanOrEqual(
        Math.ceil(T.wrathMax * mult * COUNCIL_DIFFICULTY.heroic.crowdShare),
      );
      expect(hits[0].amount).toBeGreaterThan(0);
      // It hurts, about half a Heroic-geared cloth body (1,335), and never
      // kills one on its own (the review of 2026-11-09: no accidental wipe).
      expect(hits[0].amount).toBeGreaterThan(1335 * 0.5);
      expect(hits[0].amount).toBeLessThan(1335 * 0.65);
    }
    expect(ev.some((e) => e.type === 'chat' && e.channel === 'raidWarning')).toBe(false);
  });

  it('mythic: three are safe, a fourth is not', () => {
    const safe = pulled(3, 'mythic');
    const three = hide(safe, 3);
    const evSafe = land(safe);
    for (const p of three) expect(wrathOn(evSafe, p)).toEqual([]);
    const f = pulled(4, 'mythic');
    const four = hide(f, 4);
    const ev = land(f);
    for (const p of four) expect(wrathOn(ev, p).length).toBe(1);
  });

  it('the caster wears the limit through the bar, and only then', () => {
    const f = pulled(2, 'heroic');
    const g = f.bodies().guardian as Entity;
    const limit = () => g.auras.find((a) => a.id === COUNCIL_AURAS.pillarLimit);
    expect(limit()).toBeUndefined();
    expect(f.dev('/dev heart council wrath')).toBe(true);
    expect(g.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(limit()?.value2).toBe(4);
    f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(limit()).toBeUndefined();
    // Normal wears its own limit too.
    const n = pulled(2);
    expect(n.dev('/dev heart council wrath')).toBe(true);
    const ng = n.bodies().guardian as Entity;
    expect(ng.auras.find((a) => a.id === COUNCIL_AURAS.pillarLimit)?.value2).toBe(5);
  });

  it('a reset takes the limit off the caster', () => {
    const f = pulled(2, 'heroic');
    const g = f.bodies().guardian as Entity;
    f.dev('/dev heart council wrath');
    f.dev('/dev heart council reset');
    expect(g.auras.some((a) => a.id === COUNCIL_AURAS.pillarLimit)).toBe(false);
  });

  it('the runes: lit one by one, all red past the limit', () => {
    expect(shelterRunes(0, 4)).toEqual({ lit: 0, over: false });
    expect(shelterRunes(4, 4)).toEqual({ lit: 4, over: false });
    expect(shelterRunes(5, 4)).toEqual({ lit: 4, over: true });
  });

  it('the client counts who shelters in which pillar shadow from the caster, overlaps at both', () => {
    // The cover radius CouncilPillarsFx.shelters hands: the wall plus the breath.
    const pillars = [
      { x: 10, z: 0, r: 2 + COVER_BREATH },
      { x: 17, z: 0, r: 2 + COVER_BREATH },
      { x: 0, z: 10, r: 2 + COVER_BREATH },
    ];
    const players = [
      // Behind the second pillar, still inside the first's shadow: BOTH.
      { x: 20, z: 0 },
      // Between the two: the first's shadow only.
      { x: 13, z: 0 },
      // Behind the third.
      { x: 0, z: 14 },
      // Beside the first (its side, never its shadow).
      { x: 10, z: 4.5 },
      // On the caster's side of the third.
      { x: 0, z: 6 },
    ];
    const out: number[] = [];
    pillarShelterCounts(0, 0, players, 5, pillars, 3, out);
    expect(out.slice(0, 3)).toEqual([2, 1, 1]);
  });

  it('says what it does in its tooltip and has a localized name', () => {
    const d = auraEffectDescriptor({
      id: COUNCIL_AURAS.pillarLimit,
      kind: 'vulnerability',
      value: 0,
      value2: 4,
    });
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('4');
    expect(text).toContain(`${Math.round(COUNCIL_DIFFICULTY.heroic.crowdShare * 100)}%`);
    // Normal's own share on Normal's limit.
    const n = auraEffectDescriptor({
      id: COUNCIL_AURAS.pillarLimit,
      kind: 'vulnerability',
      value: 0,
      value2: 5,
    });
    expect(t(n?.key as never, n?.nums as never)).toContain(
      `${Math.round(COUNCIL_DIFFICULTY.normal.crowdShare * 100)}%`,
    );
    expect(localizeSimAuraName('Narrow Shelter')).toBe('Narrow Shelter');
  });
});

// Jose's call of 2026-11-25: the shelter is the space BEHIND each pillar from
// the Wrath's caster (a strip from the far face `shelterLength` yards on, a
// little wider than the pillar), never its sides or the caster's side; a
// player inside two overlapping shadows counts at both.
describe("Hammer Council: the pillar's shadow from the caster", () => {
  /** Only risen pillars stand: one at each instance-local spot given. */
  function risenOnly(f: CouncilFight, spots: { x: number; z: number }[]): void {
    const g = f.bodies().guardian as Entity;
    for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    for (const s of spots)
      expect(raisePillar(f.sim.ctx, f.inst, g, [], [], s.x, s.z, 1)).not.toBeNull();
    expect(f.pillars().length).toBe(spots.length);
  }

  function plantGuardian(f: CouncilFight, x: number, z: number): void {
    const g = f.bodies().guardian as Entity;
    const w = f.world(x, z);
    g.pos.x = w.x;
    g.pos.z = w.z;
    g.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
    g.prevPos = { ...g.pos };
    f.sim.ctx.rebucket(g);
  }

  it('the shape: from the far face a set length on, a little wider than the pillar', () => {
    const r = T.risenR;
    expect(T.shelterLength).toBeGreaterThanOrEqual(8);
    expect(T.shelterLength).toBeLessThanOrEqual(10);
    // Wide enough for several side by side (a body is about a yard).
    expect(2 * councilShelterHalf(r, r)).toBeGreaterThanOrEqual(6);
    expect(councilShelterHalf(r, -0.1)).toBe(0);
    expect(councilShelterHalf(r, r + T.shelterLength + 0.1)).toBe(0);
    // A caster on the pillar shelters nobody.
    expect(inCouncilShelter(0, 0, r, 0.5, 0, -r - 1, 0)).toBe(false);
  });

  it('spares behind the pillar; strikes its sides, the caster side and past the tip, wherever the caster stands', () => {
    for (const from of [
      { x: MID.x, z: MID.z },
      { x: MID.x - 12, z: MID.z + 10 },
    ]) {
      const f = pulled(7);
      const [tank, behind, deep, front, beside, past] = f.players;
      const at = { x: MID.x + 5, z: MID.z };
      risenOnly(f, [at]);
      plantGuardian(f, from.x, from.z);
      const pl = f.pillars()[0];
      const pr = f.local(pl.e);
      const r = pl.r;
      const d = Math.hypot(pr.x - from.x, pr.z - from.z);
      const ux = (pr.x - from.x) / d;
      const uz = (pr.z - from.z) / d;
      const put = (p: Entity, along: number, lat: number) =>
        f.put(p, pr.x + ux * along + uz * lat, pr.z + uz * along - ux * lat);
      // Straight behind, and deep in the shadow off to one side.
      put(behind, r + 1.5, 0);
      put(deep, r + T.shelterLength - 1, -(r + T.shelterWiden - 0.5));
      // Between the caster and the pillar: no cover from the caster.
      put(front, -(r + 1.5), 0);
      // Beside it, level with its middle.
      put(beside, 0, r + 1.5);
      // Straight behind but past the shadow's tip.
      put(past, r + T.shelterLength + 1.5, 0);
      f.put(tank, from.x + 3, from.z);
      const ev = land(f);
      const tag = `caster at ${from.x},${from.z}`;
      expect(wrathOn(ev, behind), tag).toEqual([]);
      expect(wrathOn(ev, deep), tag).toEqual([]);
      expect(wrathOn(ev, front).length, tag).toBe(1);
      expect(wrathOn(ev, beside).length, tag).toBe(1);
      expect(wrathOn(ev, past).length, tag).toBe(1);
    }
  });

  it('a player inside two overlapping shadows counts at both pillars (Narrow Shelter)', () => {
    // Heroic (limit 4): A and B overlap; three stand at B alone, two in the
    // overlap. Counted at both, B holds five: one too many.
    const f = pulled(6, 'heroic');
    const [tank, ...rest] = f.players;
    // A, then B straight behind it from the caster: B's near shadow lies in
    // A's too.
    const a = { x: MID.x + 4, z: MID.z };
    const b = { x: MID.x + 11, z: MID.z };
    risenOnly(f, [a, b]);
    // Nearest the caster first.
    const [pa, pb] = f
      .pillars()
      .map((p) => f.local(p.e))
      .sort((u, v) => u.x - v.x);
    const r = T.risenR;
    // The caster on the line through both (the rise snaps to its spots).
    const gap = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    expect(gap).toBeLessThan(r + T.shelterLength - r - 1.5);
    const ux = (pb.x - pa.x) / gap;
    const uz = (pb.z - pa.z) / gap;
    const c = { x: pa.x - ux * 10, z: pa.z - uz * 10 };
    const behindB = (along: number, lat: number) => ({
      x: pb.x + ux * along + uz * lat,
      z: pb.z + uz * along - ux * lat,
    });
    const overlap = rest.slice(0, 2);
    const bOnly = rest.slice(2, 5);
    // Just behind B: in both shadows.
    for (const [i, p] of overlap.entries()) {
      const q = behindB(r + 1.5, (i - 0.5) * 0.9);
      f.put(p, q.x, q.z);
    }
    // Deeper behind B, past A's tip: B's shadow only.
    for (const [i, p] of bOnly.entries()) {
      const q = behindB(r + T.shelterLength - 1, (i - 1) * 0.9);
      f.put(p, q.x, q.z);
    }
    plantGuardian(f, c.x, c.z);
    f.put(tank, MID.x - 5, MID.z + 6);
    // Check the census the rule reads before landing.
    for (const p of overlap) {
      expect(inCouncilShelter(pa.x, pa.z, r, c.x, c.z, f.local(p).x, f.local(p).z)).toBe(true);
      expect(inCouncilShelter(pb.x, pb.z, r, c.x, c.z, f.local(p).x, f.local(p).z)).toBe(true);
    }
    for (const p of bOnly) {
      expect(inCouncilShelter(pa.x, pa.z, r, c.x, c.z, f.local(p).x, f.local(p).z)).toBe(false);
      expect(inCouncilShelter(pb.x, pb.z, r, c.x, c.z, f.local(p).x, f.local(p).z)).toBe(true);
    }
    const ev = land(f);
    // B is crowded: everyone counted there takes the share, exactly once (the
    // overlap pair too, though A alone would have held them).
    for (const p of [...overlap, ...bOnly]) expect(wrathOn(ev, p).length, p.name).toBe(1);
  });

  it('three at B alone and two in the overlap stay safe on Normal (limit 5)', () => {
    const f = pulled(6);
    const [tank, ...rest] = f.players;
    const a = { x: MID.x + 4, z: MID.z };
    const b = { x: MID.x + 11, z: MID.z };
    risenOnly(f, [a, b]);
    const [pa, pb] = f
      .pillars()
      .map((p) => f.local(p.e))
      .sort((u, v) => u.x - v.x);
    const r = T.risenR;
    const gap = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const ux = (pb.x - pa.x) / gap;
    const uz = (pb.z - pa.z) / gap;
    const put = (p: Entity, along: number, lat: number) =>
      f.put(p, pb.x + ux * along + uz * lat, pb.z + uz * along - ux * lat);
    for (const [i, p] of rest.slice(0, 2).entries()) put(p, r + 1.5, (i - 0.5) * 0.9);
    for (const [i, p] of rest.slice(2, 5).entries()) put(p, r + T.shelterLength - 1, (i - 1) * 0.9);
    plantGuardian(f, pa.x - ux * 10, pa.z - uz * 10);
    f.put(tank, MID.x - 5, MID.z + 6);
    const ev = land(f);
    for (const p of rest) expect(wrathOn(ev, p), p.name).toEqual([]);
  });
});
