// The Guardian of the Breath's 50 percent phase over a REAL Sim claim (the
// team's design of 2026-11-17, src/sim/encounters/smith_heart/breath_isles.ts
// and breath_isle_adds.ts): the lock at half health, the Gale Cocoon and
// Skyrend Nova, Thessaly's Updrafts and the two chains of isles, each isle's
// adds and its Closing Storm (Sky's Reckoning when it runs out), the Riven
// Squall's split, the Gust Herald's Shoving Gale, the Shieldbearer's ward,
// the Mender's kickable Mending Gale, the Stillstones, the way home and the
// storm breaking after it; the nova run out; the ball never meeting the
// phase; a wipe that brings everyone home; the old Bulwark rounds gone.

import { describe, expect, it } from 'vitest';
import { frontWardAmount } from '../src/sim/combat/front_ward';
import { BREATH, BREATH_ISLES } from '../src/sim/content/smith_heart_layout';
import { clearHeart } from '../src/sim/encounters/smith_heart/breath_heart';
import {
  BREATH_CASTS,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import {
  inShoveLine,
  livingIsleAdds,
  playersOnIsle,
} from '../src/sim/encounters/smith_heart/breath_isle_adds';
import {
  cornicePads,
  isleAt,
  isleSpots,
  rideArc,
} from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import {
  closingOf,
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_MOBS,
  ISLE_OBJECTS,
  ISLE_TIERS,
  ISLE_TUNING as IT,
  padOf,
  padTemplate,
} from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { islePlayers } from '../src/sim/encounters/smith_heart/breath_isles';
import { DT, type Entity } from '../src/sim/types';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

/** Hold the wind calm (the open rim throws an idle raid off). */
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

function pulled(n = 6, tier: '' | 'heroic' = '', seed = 23): BreathFight {
  const f = breathFight(n, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  if (tier) f.dev(`/dev heart breath ${tier}`);
  f.tick(2);
  stillAir(f);
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  return f;
}

/** Take the guardian to half health and let the phase begin. */
function toIsles(f: BreathFight): void {
  const b = f.boss();
  b.hp = Math.floor(b.maxHp * IT.at) - 5;
  for (let i = 0; i < ticks(2) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
  expect(f.state()?.isles.stage).toBe('nova');
}

function addsOn(f: BreathFight, isle: number): Entity[] {
  return (f.state()?.isles.adds ?? [])
    .filter((a) => a.isle === isle)
    .map((a) => f.sim.ctx.entities.get(a.id))
    .filter((e): e is Entity => !!e && !e.dead);
}

function killIsle(f: BreathFight, isle: number): void {
  for (const e of addsOn(f, isle))
    f.sim.ctx.dealDamage(f.boss(), e, e.hp + 1, false, 'nature', 'Test', 'hit', true);
  f.tick(2);
}

/** Step `p` into the pad from `from` (-1 the Cornice) to `to`; returns once landed. */
function ride(f: BreathFight, p: Entity, from: number, to: number): void {
  const at = from < 0 ? cornicePads()[isleSpots()[to].side] : isleSpots()[from].pad;
  if (!at) throw new Error('no pad');
  // Out of the last landing's grace first, then onto the pad.
  f.tick(ticks(IT.rideGrace + 0.1));
  f.put(p, at.x, at.z);
  f.tick(ticks(IT.rideSeconds + 0.6));
  expect(isleAt(f.local(p).x, f.local(p).z)).toBe(to);
}

describe('the Islands of the Wind: the layout', () => {
  it('six isles, three a side, each its own floor, climbing round the rim, inside the band', () => {
    expect(BREATH_ISLES).toHaveLength(6);
    for (const side of [0, 1] as const) {
      const chain = BREATH_ISLES.filter((b) => b.side === side);
      expect(chain.map((b) => b.step)).toEqual([0, 1, 2]);
      expect(chain[1].h).toBeGreaterThan(chain[0].h);
      expect(chain[2].h).toBeGreaterThan(chain[1].h);
    }
    BREATH_ISLES.forEach((b, i) => {
      expect(isleAt(b.x, b.z)).toBe(i);
      expect(b.z).toBeLessThan(238);
      const sp = isleSpots()[i];
      expect(isleAt(sp.land.x, sp.land.z)).toBe(i);
      for (const a of sp.adds) expect(isleAt(a.x, a.z)).toBe(i);
      if (sp.pad) expect(isleAt(sp.pad.x, sp.pad.z)).toBe(i);
      if (sp.stone) expect(isleAt(sp.stone.x, sp.stone.z)).toBe(i);
      expect(sp.pad === null).toBe(sp.step === 2);
      expect(sp.stone === null).toBe(sp.step !== 2);
    });
  });

  it('the pads and codecs read back; the ride arc is the fixed one', () => {
    expect(padOf(padTemplate(-1, 3))).toEqual({ from: -1, to: 3 });
    expect(padOf(padTemplate(1, 2))).toEqual({ from: 1, to: 2 });
    expect(padOf('sh_breath_updraft_c_h')).toBeNull();
    const a = { x: 0, y: 60, z: 0 };
    const b = { x: 10, y: 80, z: 0 };
    expect(rideArc(a, b, 0)).toEqual(a);
    expect(rideArc(a, b, 1)).toEqual(b);
    expect(rideArc(a, b, 0.5).y).toBeGreaterThan(80);
  });
});

describe('the Islands of the Wind: the lock and the start', () => {
  it('no isles above half health (the old Bulwark rounds at 70 and 80 are gone)', () => {
    const f = pulled(6, 'heroic');
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.6);
    f.tick(ticks(3));
    expect(f.state()?.isles.stage).toBe('idle');
    expect(f.state()?.half).toBe('wind');
    expect(b.castingAbility).not.toBe('heart_breath_gale_bulwark');
    expect(f.objects(ISLE_OBJECTS.padPrefix)).toHaveLength(0);
    expect(b.damageImmune ?? false).toBe(false);
  });

  it('at half health the guardian is locked, cocooned, channels the nova; two pads, two isles wake', () => {
    const f = pulled(6);
    const b = f.boss();
    toIsles(f);
    const st = f.state()!;
    expect(st.half).toBe('isles');
    expect(b.damageImmune).toBe(true);
    expect(has(b, ISLE_AURAS.cocoon)).toBe(true);
    expect(b.castingAbility).toBe(ISLE_CASTS.nova);
    expect(b.channeling).toBe(true);
    expect(b.castTotal).toBe(ISLE_TIERS.normal.novaSeconds);
    // Untouchable: a blow takes nothing.
    const hp = b.hp;
    f.sim.ctx.dealDamage(f.players[0], b, 5000, false, 'physical', 'Test', 'hit', false);
    expect(b.hp).toBe(hp);
    const pads = f.objects(ISLE_OBJECTS.padPrefix).map((e) => padOf(e.templateId));
    expect(pads).toEqual(
      expect.arrayContaining([
        { from: -1, to: 0 },
        { from: -1, to: 3 },
      ]),
    );
    expect(pads).toHaveLength(2);
    expect(
      addsOn(f, 0)
        .map((e) => e.templateId)
        .sort(),
    ).toEqual([ISLE_MOBS.mender, ISLE_MOBS.sentinel].sort());
    expect(addsOn(f, 3)).toHaveLength(2);
    expect(addsOn(f, 1)).toHaveLength(0);
    // The wind still: no blow, no sky volley while the raid is out.
    f.tick(ticks(20));
    expect(f.state()?.wind.phase).toBe('calm');
    expect(f.objects(BREATH_OBJECTS.strikePrefix)).toHaveLength(0);
  });

  it('a big hit through the mark never takes it under half health', () => {
    const f = pulled(6);
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * IT.at) + 10;
    f.sim.ctx.dealDamage(
      f.players[0],
      b,
      Math.floor(b.maxHp * 0.2),
      false,
      'physical',
      'Test',
      'hit',
      false,
    );
    f.tick(2);
    expect(b.hp).toBeGreaterThanOrEqual(Math.floor(b.maxHp * IT.at) - 1);
    expect(b.damageImmune).toBe(true);
  });

  it('a Knotted Gale in play: the phase waits for it (locked), and no new ball comes after', () => {
    const f = pulled(6, 'heroic');
    f.dev('/dev heart breath heart');
    expect(f.state()?.heart).not.toBeNull();
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * IT.at) - 5;
    f.tick(3);
    expect(b.damageImmune).toBe(true);
    expect(f.state()?.isles.stage).toBe('idle');
    f.tick(ticks(5));
    expect(f.state()?.isles.stage).toBe('idle');
    // The ball is thrown (gone); the phase begins and never meets another.
    clearHeart(f.sim.ctx, f.inst, f.state()!);
    for (let i = 0; i < ticks(2) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
    expect(f.state()?.heart).toBeNull();
    expect(f.state()?.isles.stage).toBe('nova');
    const st = f.state()!;
    st.heartTimer = 0;
    f.tick(ticks(5));
    expect(f.state()?.heart).toBeNull();
  });
});

describe('the Islands of the Wind: the isles', () => {
  it('a pad carries a player to its isle, stunned and carried; the storm closes from the landing', () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    const pad = cornicePads()[0];
    f.put(p, pad.x, pad.z);
    f.tick(2);
    expect(has(p, ISLE_AURAS.riding)).toBe(true);
    expect(p.carriedBy).toBeDefined();
    f.tick(ticks(IT.rideSeconds));
    expect(isleAt(f.local(p).x, f.local(p).z)).toBe(0);
    expect(has(p, ISLE_AURAS.riding)).toBe(false);
    const closing = f.objects(ISLE_OBJECTS.closingPrefix).map((e) => closingOf(e.templateId));
    expect(closing).toHaveLength(1);
    expect(closing[0]?.isle).toBe(0);
    expect(closing[0]?.whole).toBe(ISLE_TIERS.normal.closingSeconds);
    // The wardens turn on the one set down among them.
    expect(addsOn(f, 0).every((e) => e.inCombat)).toBe(true);
  });

  it('an isle cleared: Thessaly raises the next pad and its adds rise (herald and squall)', () => {
    const f = pulled(6);
    toIsles(f);
    ride(f, f.players[1], -1, 0);
    killIsle(f, 0);
    const pads = f.objects(ISLE_OBJECTS.padPrefix).map((e) => padOf(e.templateId));
    expect(pads).toContainEqual({ from: 0, to: 1 });
    expect(
      addsOn(f, 1)
        .map((e) => e.templateId)
        .sort(),
    ).toEqual([ISLE_MOBS.herald, ISLE_MOBS.squall].sort());
    // Its storm stands down.
    expect(f.objects(ISLE_OBJECTS.closingPrefix)).toHaveLength(0);
    ride(f, f.players[1], 0, 1);
    killIsle(f, 1);
    expect(addsOn(f, 1).filter((e) => e.templateId === ISLE_MOBS.fragment)).toHaveLength(2);
    killIsle(f, 1);
    expect(addsOn(f, 2).map((e) => e.templateId)).toEqual([ISLE_MOBS.shieldbearer]);
  });

  it("the Closing Storm runs out: Sky's Reckoning strikes under everyone on the isle", () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    ride(f, p, -1, 0);
    // Hold the adds off (they would hit too): no damage but the storm's.
    for (const e of addsOn(f, 0)) {
      e.encounterHeld = true;
      e.inCombat = false;
    }
    const st = f.state()!;
    st.isles.isles[0].closing = 0.2;
    p.hp = p.maxHp;
    f.tick(ticks(0.5));
    expect(f.objects(BREATH_OBJECTS.strikePrefix).length).toBeGreaterThan(0);
    const before = p.hp;
    f.tick(ticks(IT.reckonWarn + 0.2), false);
    expect(before - p.hp).toBeGreaterThanOrEqual(
      Math.round(p.maxHp * ISLE_TIERS.normal.reckonShare) - 1,
    );
    // Normal: painful, never one strike's wipe.
    expect(p.dead).toBe(false);
  });

  it("the Gust Herald's Shoving Gale slides the line toward the rim; normal holds it on the isle", () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    ride(f, p, -1, 0);
    killIsle(f, 0);
    ride(f, p, 0, 1);
    const herald = addsOn(f, 1).find((e) => e.templateId === ISLE_MOBS.herald)!;
    const a = f.state()!.isles.adds.find((x) => x.id === herald.id)!;
    a.next = 0;
    for (const e of addsOn(f, 1)) if (e !== herald) e.encounterHeld = true;
    for (let i = 0; i < ticks(2) && herald.castingAbility !== ISLE_CASTS.shove; i++) f.tick();
    expect(herald.castingAbility).toBe(ISLE_CASTS.shove);
    expect(a.dir).toBeDefined();
    const dir = a.dir!;
    const at0 = { ...p.pos };
    expect(inShoveLine(a.at!, dir, p.pos.x, p.pos.z)).toBe(true);
    f.tick(ticks(IT.shoveCast + IT.shoveSlide + 0.5));
    const moved = (p.pos.x - at0.x) * dir.ux + (p.pos.z - at0.z) * dir.uz;
    expect(moved).toBeGreaterThan(0.4);
    expect(p.dead).toBe(false);
    expect(isleAt(f.local(p).x, f.local(p).z)).toBe(1);
  });

  it("the Shieldbearer's ward turns aside a blow from the front, never one from behind", () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    ride(f, p, -1, 0);
    killIsle(f, 0);
    ride(f, p, 0, 1);
    killIsle(f, 1);
    killIsle(f, 1);
    const sb = addsOn(f, 2).find((e) => e.templateId === ISLE_MOBS.shieldbearer);
    expect(sb).toBeDefined();
    const ward = sb!.auras.find((a) => a.id === ISLE_AURAS.ward)!;
    expect(ward.value).toBe(ISLE_TIERS.normal.wardCut);
    const front = {
      ...f.players[1],
      pos: {
        x: sb!.pos.x + Math.sin(sb!.facing) * 3,
        y: sb!.pos.y,
        z: sb!.pos.z + Math.cos(sb!.facing) * 3,
      },
    } as Entity;
    const back = {
      ...f.players[1],
      pos: {
        x: sb!.pos.x - Math.sin(sb!.facing) * 3,
        y: sb!.pos.y,
        z: sb!.pos.z - Math.cos(sb!.facing) * 3,
      },
    } as Entity;
    expect(frontWardAmount(sb!, front, 1000)).toBe(
      Math.round(1000 * (1 - ISLE_TIERS.normal.wardCut)),
    );
    expect(frontWardAmount(sb!, back, 1000)).toBe(1000);
  });

  it("the Gale Mender's Mending Gale mends its isle's adds; a kick cuts it and nothing is mended", () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    ride(f, p, -1, 0);
    const mender = addsOn(f, 0).find((e) => e.templateId === ISLE_MOBS.mender)!;
    const sentinel = addsOn(f, 0).find((e) => e.templateId === ISLE_MOBS.sentinel)!;
    const a = f.state()!.isles.adds.find((x) => x.id === mender.id)!;
    sentinel.hp = Math.round(sentinel.maxHp * 0.3);
    // Its Gale Bolt (the trash kit's own bar) out of the way.
    mender.castingAbility = null;
    a.at = null;
    a.next = 0;
    f.tick(2);
    expect(mender.castingAbility).toBe(ISLE_CASTS.mending);
    // Kicked: cut.
    f.sim.ctx.cancelCast(mender);
    f.tick(ticks(IT.mendCast + 0.5));
    expect(sentinel.hp).toBeLessThan(Math.round(sentinel.maxHp * 0.31));
    mender.castingAbility = null;
    a.at = null;
    a.next = 0;
    f.tick(2);
    expect(mender.castingAbility).toBe(ISLE_CASTS.mending);
    f.tick(ticks(IT.mendCast + 0.2));
    expect(sentinel.hp).toBeGreaterThanOrEqual(
      Math.round(sentinel.maxHp * (0.3 + ISLE_TIERS.normal.mendShare)) - 2,
    );
  });
});

describe('the Islands of the Wind: the stones and the end', () => {
  it('both Stillstones channeled: the cocoon breaks, everyone rides home, the storm breaks', () => {
    const f = pulled(6);
    toIsles(f);
    const b = f.boss();
    const [, east, west] = f.players;
    // East: the whole chain by the pads.
    ride(f, east, -1, 0);
    killIsle(f, 0);
    ride(f, east, 0, 1);
    killIsle(f, 1);
    killIsle(f, 1);
    ride(f, east, 1, 2);
    killIsle(f, 2);
    const st = f.state()!;
    const stoneId = st.isles.isles[2].stoneId;
    expect(stoneId).not.toBeNull();
    const stone = f.sim.ctx.entities.get(stoneId!)!;
    expect(stone.templateId).toBe(ISLE_MOBS.stillstone);
    const sp = isleSpots()[2].stone!;
    f.put(east, sp.x + 1.5, sp.z);
    east.targetId = stone.id;
    f.sim.interact(east.id);
    expect(east.castingAbility).toBe(ISLE_CASTS.still);
    f.tick(ticks(5.3));
    expect(st.isles.isles[2].stilled).toBe(true);
    expect(st.isles.stage).toBe('nova');
    expect(b.auras.find((a) => a.id === ISLE_AURAS.cocoon)?.value).toBe(1);
    // West by the dev line (the same rule), then the end.
    ride(f, west, -1, 3);
    f.dev('/dev heart breath still 1', west.id);
    f.tick(2);
    expect(st.isles.stage).toBe('home');
    expect(has(b, ISLE_AURAS.cocoon)).toBe(false);
    expect(b.castingAbility).not.toBe(ISLE_CASTS.nova);
    expect(livingIsleAdds({ ctx: f.sim.ctx, st })).toHaveLength(0);
    // Everyone out there rides home.
    expect(has(east, ISLE_AURAS.riding)).toBe(true);
    f.tick(ticks(IT.homeSeconds + 1));
    expect(islePlayers(f.sim.ctx, f.inst)).toHaveLength(0);
    for (const p of [east, west]) {
      expect(isleAt(f.local(p).x, f.local(p).z)).toBe(-1);
      expect(Math.abs(p.pos.y - BREATH.cornice.h)).toBeLessThan(2);
    }
    expect(st.isles.stage).toBe('done');
    expect(['break', 'storm']).toContain(st.half);
    expect(b.castingAbility).toBe(BREATH_CASTS.storm);
    expect(b.damageImmune).toBe(false);
  });

  it('the nova run out: normal leaves the raid at a tenth of its health; heroic kills', () => {
    for (const tier of ['', 'heroic'] as const) {
      const f = pulled(4, tier);
      toIsles(f);
      for (const p of f.players) p.hp = p.maxHp;
      f.dev('/dev heart breath nova');
      f.tick(1, false);
      const share = ISLE_TIERS[tier || 'normal'].novaShare;
      if (share >= 1) expect(f.players.every((p) => p.dead)).toBe(true);
      else
        for (const p of f.players) {
          expect(p.dead).toBe(false);
          expect(p.hp).toBeLessThanOrEqual(Math.ceil(p.maxHp * (1 - share)) + 1);
        }
      expect(f.state()?.isles.stage).toBe('home');
      expect(f.state()?.isles.burst).toBe(true);
    }
  });

  it('a wipe mid-phase brings every body home and leaves nothing of the phase', () => {
    const f = pulled(6);
    toIsles(f);
    const p = f.players[1];
    ride(f, p, -1, 0);
    expect(playersOnIsle({ ctx: f.sim.ctx, inst: f.inst } as never, 0)).toContain(p);
    f.dev('/dev heart breath reset');
    f.tick(2);
    expect(isleAt(f.local(p).x, f.local(p).z)).toBe(-1);
    expect(f.objects(ISLE_OBJECTS.padPrefix)).toHaveLength(0);
    expect(f.objects(ISLE_OBJECTS.closingPrefix)).toHaveLength(0);
    expect(f.boss().damageImmune ?? false).toBe(false);
    expect(
      f.inst.mobIds
        .map((id) => f.sim.ctx.entities.get(id))
        .filter((e) => e && Object.values(ISLE_MOBS).includes(e.templateId as never) && !e.dead),
    ).toHaveLength(0);
  });

  it('is deterministic: the same seed raises the same adds at the same spots', () => {
    const run = () => {
      const f = pulled(6, '', 41);
      toIsles(f);
      ride(f, f.players[1], -1, 0);
      f.tick(ticks(4));
      return addsOn(f, 0).map((e) => [
        e.templateId,
        Math.round(e.pos.x * 10),
        Math.round(e.pos.z * 10),
        e.hp,
      ]);
    };
    expect(run()).toEqual(run());
  });

  it('the storm break no longer fires on the mark itself', () => {
    expect(T.stormAt).toBe(IT.at);
  });
});

describe('the sky strikes wait out the indrawn breath and the Roar', () => {
  it('no volley lands on a raid pulled in or blasted; it falls once the wind is back', () => {
    const f = pulled(6);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wind.phase = 'inhale';
    st.wind.remaining = 9999;
    st.skyTimer = 0;
    f.tick(ticks(1));
    expect(f.objects(BREATH_OBJECTS.strikePrefix)).toHaveLength(0);
    st.wind.phase = 'calm';
    f.tick(ticks(1));
    expect(f.objects(BREATH_OBJECTS.strikePrefix).length).toBeGreaterThan(0);
  });
});

describe("Sky's Reckoning spares the Stillstone's channeler", () => {
  it('lays no strike under a player channeling Still the Gale, one under everyone else', () => {
    const f = pulled(6);
    toIsles(f);
    const [, a, c] = f.players;
    ride(f, a, -1, 0);
    killIsle(f, 0);
    ride(f, a, 0, 1);
    killIsle(f, 1);
    killIsle(f, 1);
    ride(f, a, 1, 2);
    killIsle(f, 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const stone = f.sim.ctx.entities.get(st.isles.isles[2].stoneId ?? -1);
    if (!stone) throw new Error('no stone');
    const sp = isleSpots()[2].stone;
    if (!sp) throw new Error('no stone spot');
    f.put(a, sp.x + 1.5, sp.z);
    f.put(c, isleSpots()[2].land.x, isleSpots()[2].land.z);
    a.targetId = stone.id;
    f.sim.interact(a.id);
    expect(a.castingAbility).toBe(ISLE_CASTS.still);
    st.isles.isles[2].closing = 0.05;
    f.tick(2);
    expect(a.castingAbility).toBe(ISLE_CASTS.still);
    const strikes = st.isles.strikes.filter((k) => k.isle === 2);
    const near = (p: Entity) =>
      strikes.some((k) => Math.hypot(k.x - f.local(p).x, k.z - f.local(p).z) < 0.5);
    expect(near(a)).toBe(false);
    expect(near(c)).toBe(true);
  });
});
