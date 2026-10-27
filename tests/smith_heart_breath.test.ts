// The Guardian of the Breath over a REAL Sim (docs/design/raid/smith_heart.md
// section 7.2, encounters/smith_heart/breath*.ts, on tests/helpers/
// breath_fight.ts): the blow cycle and its turns, the calm shortening, the
// push and the walk against it, the gaps that kill and the wall that pins,
// Captain Thessaly's circle (three seats, the anchor's immunity to the wind,
// the indrawn breath, the exhale and every throw, none in phase 2), the
// indrawn breath and Bellows Gust, the storm breaking at half health, the
// Leaping Bolt's reach, the Thunder's Cradle's split and its soakers, Drawn
// Lightning's strikes and charged ground, the swelling storm, heroic's spent
// anchors, loose gales and storm gusts, the wipe putting the Cornice back, the
// Breath vein and the seal's quarter lit by its fall, and determinism.

import { describe, expect, it } from 'vitest';
import { CORNICE_GAPS, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import {
  BLOW_BEARINGS,
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  BREATH_OBJECTS,
  blowBearing,
  breathWindOf,
  calmOf,
  calmSeconds,
  cradleShare,
  forkPath,
  smithHeartProgress,
  smithHeartVeinWon,
  swellMult,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { authoredFieldCliffRuns } from '../src/sim/instances/authored_field';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../src/sim/wind_drift';
import { type BreathFight, breathFight } from './helpers/breath_fight';
import { hitsOf } from './helpers/council_fight';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** A pulled fight, its puller at the dev spot. */
function pulled(n = 6, seed = 23): BreathFight {
  const f = breathFight(n, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  return f;
}

/** Tick until `pred` holds (at most `seconds`); returns the events. */
function until(f: BreathFight, pred: () => boolean, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 20 && !pred(); i++) out.push(...f.tick(1));
  return out;
}

describe('Guardian of the Breath: the bellows breathes', () => {
  it('telegraphs each blow, blows 10 s toward one bearing, falls calm, then turns', () => {
    const f = pulled(4);
    const segs: { phase: string; bearing: number; ticks: number }[] = [];
    for (let i = 0; i < 20 * 34; i++) {
      f.tick(1);
      const w = f.wind();
      if (!w) throw new Error('no wind');
      const last = segs[segs.length - 1];
      if (last && last.phase === w.phase && last.bearing === w.bearingDeg) last.ticks++;
      else segs.push({ phase: w.phase, bearing: w.bearingDeg, ticks: 1 });
    }
    const blows = segs.filter((s) => s.phase === 'blow');
    expect(blows.length).toBeGreaterThanOrEqual(2);
    // Every whole blow lasts its 10 s, a gather of the same bearing before it.
    const st = f.state();
    if (!st) throw new Error('no state');
    blows.slice(0, 2).forEach((b, k) => {
      expect(b.ticks).toBe(Math.round(T.blowSeconds / DT));
      expect(b.bearing).toBe(blowBearing(st.start, k));
      const i = segs.indexOf(b);
      expect(segs[i - 1].phase).toBe('gather');
      expect(segs[i - 1].bearing).toBe(b.bearing);
      expect(segs[i - 1].ticks).toBe(Math.round(T.gatherSeconds / DT));
    });
    // It turns: each blow another way, every one from the authored list.
    expect(blows[1].bearing).not.toBe(blows[0].bearing);
    for (const b of blows) expect(BLOW_BEARINGS).toContain(b.bearing);
  });

  it('the calm shortens as its health drops, 5 s at full to 3 s at half', () => {
    expect(calmSeconds(1)).toBe(T.calmMax);
    expect(calmSeconds(0.75)).toBeCloseTo(4, 9);
    expect(calmSeconds(0.5)).toBe(T.calmMin);
    expect(calmSeconds(0.2)).toBe(T.calmMin);
    // In the fight: a blow ending at 60 percent leaves calm and gather 3.4 s.
    const f = pulled(4);
    until(f, () => f.wind()?.phase === 'blow', 8);
    f.boss().hp = Math.round(f.boss().maxHp * 0.6);
    until(f, () => f.wind()?.phase === 'calm', 12);
    let ticks = 0;
    until(
      f,
      () => {
        if (f.wind()?.phase === 'blow') return true;
        ticks++;
        return false;
      },
      8,
    );
    expect(ticks * DT).toBeCloseTo(calmSeconds(f.boss().hp / f.boss().maxHp), 1);
  });
});

describe('Guardian of the Breath: the push, the rim and the gaps', () => {
  it('carries the idle downwind and lets a walker make headway against it', () => {
    const f = pulled(4);
    const [, idle, walker] = f.players;
    f.put(idle, -20, 205);
    f.put(walker, -20, 188);
    f.tick(2);
    f.dev('/dev heart breath blow 90');
    f.tick(2);
    expect(has(idle, WIND_DRIFT_AURA)).toBe(true);
    const i0 = f.local(idle);
    const w0 = f.local(walker);
    walker.facing = -Math.PI / 2;
    const meta = f.sim.players.get(walker.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    f.tick(40);
    meta.moveInput.forward = false;
    const speed = BREATH_DIFFICULTY.normal.windSpeed;
    expect((f.local(idle).x - i0.x) / 2).toBeCloseTo(speed, 0);
    // West into an east wind: a run less the wind, still headway.
    const headway = (w0.x - f.local(walker).x) / 2;
    expect(headway).toBeGreaterThan(7 - speed - 0.6);
    expect(headway).toBeLessThan(7 - speed + 0.6);
  });

  it('takes no wind along: a body carried off the Cornice mid-blow stops drifting at once', () => {
    const f = pulled(3);
    const p = f.players[1];
    f.dev('/dev heart breath blow 90');
    f.tick(10);
    expect(has(p, WIND_DRIFT_AURA)).toBe(true);
    // A teleport away mid-blow (a hearth, the exit, a dev jump).
    f.put(p, 0, 70);
    f.tick(1);
    expect(has(p, WIND_DRIFT_AURA)).toBe(false);
    const at = f.local(p);
    f.tick(20);
    expect(dist(f.local(p), at)).toBeLessThan(0.01);
  });

  it('a body blown over the lip of a gap falls into the void and dies', () => {
    const f = pulled(3);
    const victim = f.players[1];
    victim.maxHp = 1200;
    victim.hp = 1200;
    const gap = CORNICE_GAPS.find((g) => g.deg === 182);
    if (!gap) throw new Error('gap');
    f.put(victim, gap.x, gap.z + 5);
    f.dev('/dev heart breath blow 180');
    const ev = until(f, () => victim.dead, 12);
    expect(victim.dead).toBe(true);
    expect(victim.pos.y).toBeLessThan(SMITH_HEART_FIELD.voidHeight + 3);
    // Said once, with the place it went over.
    const warn = ev.filter(
      (e) =>
        e.type === 'chat' &&
        (e as { textKey?: string }).textKey === 'hudChrome.breathGuardian.warn.fell',
    );
    expect(warn.length).toBeGreaterThan(0);
  });

  it('walking out through a gap on a still Cornice kills too', () => {
    const f = pulled(3);
    const walker = f.players[1];
    walker.maxHp = 1200;
    walker.hp = 1200;
    const gap = CORNICE_GAPS.find((g) => g.deg === 22);
    if (!gap) throw new Error('gap');
    const a = (gap.deg * Math.PI) / 180;
    f.put(walker, gap.x - Math.sin(a) * 4, gap.z - Math.cos(a) * 4);
    f.dev('/dev heart breath calm');
    walker.facing = a;
    const meta = f.sim.players.get(walker.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    until(f, () => walker.dead, 10);
    expect(walker.dead).toBe(true);
  });

  it('where the wall stands the wind pins a body and hurts it each second; never in the calm', () => {
    const f = pulled(3);
    const p = f.players[1];
    const a = (160 * Math.PI) / 180;
    f.put(p, Math.sin(a) * 40, 196 + Math.cos(a) * 30);
    f.dev('/dev heart breath blow 180');
    // Carried onto the wall, then held against it for the rest of the blow.
    until(f, () => has(p, BREATH_AURAS.pinned), 5);
    expect(has(p, BREATH_AURAS.pinned)).toBe(true);
    const ev = f.tick(20 * 4);
    const hits = hitsOf(ev, BREATH_NAMES.pinned, p.id);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.length).toBeLessThanOrEqual(5);
    for (const h of hits) expect(h).toBeGreaterThanOrEqual(T.pinMin);
    expect(p.dead).toBe(false);
    f.dev('/dev heart breath calm');
    const calm = f.tick(20 * 2);
    expect(hitsOf(calm, BREATH_NAMES.pinned, p.id)).toEqual([]);
    expect(has(p, BREATH_AURAS.pinned)).toBe(false);
  });

  it("the gaps are the rim's only open lips, four of them", () => {
    const open = authoredFieldCliffRuns(SMITH_HEART_FIELD).filter((r) => r.open);
    expect(open.length).toBeGreaterThan(0);
    for (const r of open) {
      const mid = { x: (r.ax + r.bx) / 2, z: (r.az + r.bz) / 2 };
      expect(CORNICE_GAPS.some((g) => dist(g, mid) <= g.r)).toBe(true);
    }
    expect(
      new Set(
        open.map((r) => CORNICE_GAPS.findIndex((g) => dist(g, { x: r.ax, z: r.az }) <= g.r + 0.5)),
      ).size,
    ).toBe(4);
  });
});

describe("Guardian of the Breath: Captain Thessaly's circle of calm", () => {
  function seatedCircle(): { f: BreathFight; at: { x: number; z: number } } {
    const f = pulled(6);
    expect(f.dev('/dev heart breath circle')).toBe(true);
    const obj = f.objects(BREATH_OBJECTS.calmPrefix)[0];
    expect(calmOf(obj.templateId)?.state).toBe('land');
    const at = f.local(obj);
    // Four step in while it lands; three take its anchor.
    for (const [i, p] of f.players.slice(1, 5).entries())
      f.put(p, at.x + Math.sin(i * 1.6) * 1.5, at.z + Math.cos(i * 1.6) * 1.5);
    f.tick(Math.round(T.circleLand / DT) + 2);
    return { f, at };
  }

  it('anchors the first three in it, never a fourth, then reads spent', () => {
    const { f } = seatedCircle();
    const anchored = f.players.filter((p) => has(p, BREATH_AURAS.anchor));
    expect(anchored.length).toBe(T.circleSeats);
    const obj = f.objects(BREATH_OBJECTS.calmPrefix)[0];
    expect(calmOf(obj.templateId)?.state).toBe('spent');
    const a = anchored[0].auras.find((x) => x.id === BREATH_AURAS.anchor);
    expect(a?.duration).toBe(T.anchorSeconds);
  });

  it('the anchored stand still in the wind while the unanchored drift', () => {
    const { f } = seatedCircle();
    const anchored = f.players.filter((p) => has(p, BREATH_AURAS.anchor));
    const loose = f.players.slice(1, 5).find((p) => !has(p, BREATH_AURAS.anchor)) as Entity;
    const before = anchored.map((p) => f.local(p));
    const l0 = f.local(loose);
    f.dev('/dev heart breath blow 90');
    f.tick(40);
    anchored.forEach((p, i) => {
      expect(has(p, WIND_DRIFT_AURA)).toBe(false);
      expect(dist(f.local(p), before[i])).toBeLessThan(0.05);
    });
    expect(dist(f.local(loose), l0)).toBeGreaterThan(4);
  });

  it('the anchored keep their feet through the indrawn breath and the exhale', () => {
    const { f } = seatedCircle();
    const anchored = f.players.filter((p) => has(p, BREATH_AURAS.anchor));
    const before = anchored.map((p) => f.local(p));
    f.dev('/dev heart breath inhale');
    until(f, () => f.boss().castingAbility === BREATH_CASTS.gust, 7);
    for (const p of anchored) expect(has(p, WIND_PULL_AURA)).toBe(false);
    f.tick(Math.round(T.gustCast / DT) + 2);
    anchored.forEach((p, i) => {
      expect(dist(f.local(p), before[i])).toBeLessThan(0.05);
    });
  });

  it('plants nothing once the storm has broken', () => {
    const f = pulled(4);
    f.dev('/dev heart breath phase2');
    f.tick(Math.round(T.stormCast / DT) + 2);
    f.tick(20 * (T.circleEvery + 6));
    expect(f.objects(BREATH_OBJECTS.calmPrefix)).toEqual([]);
    expect(f.dev('/dev heart breath circle')).toBe(true);
    expect(f.objects(BREATH_OBJECTS.calmPrefix)).toEqual([]);
  });
});

describe('Guardian of the Breath: the indrawn breath and Bellows Gust', () => {
  it('draws everyone in, bites whoever stands before its mouth, then throws them outward', () => {
    const f = pulled(4);
    const boss = f.boss();
    const [tank, inFront, aside] = f.players;
    void tank;
    f.dev('/dev heart breath inhale');
    f.tick(1);
    const v = f.objects(BREATH_OBJECTS.vortex)[0];
    expect(v).toBeDefined();
    expect(v.scale).toBe(T.vortexR);
    const vAt = f.local(v);
    f.put(inFront, vAt.x, vAt.z);
    const b = f.local(boss);
    f.put(aside, b.x - Math.cos(boss.facing) * 14, b.z + Math.sin(boss.facing) * 14);
    f.tick(2);
    expect(has(aside, WIND_PULL_AURA)).toBe(true);
    const a0 = dist(f.local(aside), f.local(boss));
    const ev = until(f, () => boss.castingAbility === BREATH_CASTS.gust, 6);
    expect(dist(f.local(aside), f.local(boss))).toBeLessThan(a0 - 4);
    expect(hitsOf(ev, BREATH_NAMES.vortex, inFront.id).length).toBeGreaterThan(2);
    expect(f.objects(BREATH_OBJECTS.vortex)).toEqual([]);
    const near = dist(f.local(aside), f.local(boss));
    const gust = f.tick(Math.round(T.gustCast / DT) + 2);
    expect(hitsOf(gust, BREATH_NAMES.gust, aside.id).length).toBe(1);
    expect(dist(f.local(aside), f.local(boss))).toBeGreaterThan(near + 8);
    expect(f.wind()?.phase).toBe('calm');
  });
});

describe('Guardian of the Breath: the storm breaks at half health', () => {
  it('draws the wind in, freezes on its bar, tears open, and strikes fall on telegraphed spots', () => {
    const f = pulled(4);
    const boss = f.boss();
    f.dev('/dev heart breath blow 90');
    f.tick(10);
    boss.hp = Math.floor(boss.maxHp * 0.49);
    const ev = until(f, () => boss.castingAbility === BREATH_CASTS.storm, 3);
    expect(f.state()?.half).toBe('break');
    expect(f.wind()?.phase).toBe('break');
    f.tick(1);
    for (const p of f.players) expect(has(p, WIND_DRIFT_AURA)).toBe(false);
    expect(
      ev.some(
        (e) =>
          e.type === 'chat' &&
          (e as { textKey?: string }).textKey === 'hudChrome.breathGuardian.warn.storm',
      ),
    ).toBe(true);
    f.tick(Math.round(T.stormCast / DT));
    expect(has(boss, BREATH_AURAS.stormForm)).toBe(true);
    expect(f.state()?.half).toBe('storm');
    expect(f.wind()?.phase).toBe('storm');
    // The barrage: spots on the floor first, the strike after their warning.
    f.tick(4);
    const spots = f.objects(BREATH_OBJECTS.strikePrefix);
    expect(spots.length).toBeGreaterThan(0);
    const spot = spots[0];
    const victim = f.players[2];
    f.put(victim, f.local(spot).x, f.local(spot).z);
    const hits = hitsOf(f.tick(Math.round(T.strikeWarn / DT) + 2), BREATH_NAMES.strike, victim.id);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('Guardian of the Breath: the Storm', () => {
  function storm(n = 6, heroic = false): BreathFight {
    const f = pulled(n);
    if (heroic) f.dev('/dev heart breath heroic');
    f.dev('/dev heart breath phase2');
    f.tick(Math.round((T.stormCast + T.barrageSeconds) / DT) + 4);
    for (const sp of f.objects(BREATH_OBJECTS.strikePrefix)) void sp;
    return f;
  }

  it('the Leaping Bolt jumps to anyone within 8 yd, again and again, and no farther', () => {
    const at = (id: number, x: number) => ({ id, pos: { x, z: 0 } });
    const line = [at(1, 0), at(2, 6), at(3, 12), at(4, 18), at(5, 30)];
    expect(forkPath(line[0], line).map((p) => p.id)).toEqual([1, 2, 3, 4]);
    const spread = [at(1, 0), at(2, 9), at(3, 18)];
    expect(forkPath(spread[0], spread).map((p) => p.id)).toEqual([1]);
    // In the fight: a stacked group takes it all, the far one none.
    const f = storm(6);
    const [, a, b, c, d, far] = f.players;
    // A chain of four 5 to 6 yd apart, well clear of the tank; one far off.
    f.put(a, 12, 205);
    f.put(b, 12, 210);
    f.put(c, 12, 215);
    f.put(d, 7, 218);
    f.put(far, 20, 178);
    f.tick(2);
    f.dev('/dev heart breath chain');
    const target = f.state()?.bar?.targetId;
    expect(target).toBeDefined();
    const ev = f.tick(Math.round(T.forkCast / DT) + 2);
    const struck = new Set(
      ev
        .filter(
          (e) => e.type === 'damage' && (e as { ability?: string }).ability === BREATH_NAMES.fork,
        )
        .map((e) => (e as { targetId?: number }).targetId),
    );
    // Whoever it starts on, it forks through their own group and no farther.
    const group = [a, b, c, d].map((p) => p.id);
    const expected = group.includes(target as number) ? group : [target as number];
    expect([...struck].sort()).toEqual([...expected].sort());
  });

  it("Thunder's Cradle lifts a player and splits its discharge between those under it", () => {
    const f = storm(6);
    f.dev('/dev heart breath eye');
    const tid = f.state()?.bar?.targetId as number;
    const lifted = f.sim.ctx.entities.get(tid) as Entity;
    f.tick(Math.round(T.cradleCast / DT) + 1);
    const c = f.state()?.cradle;
    expect(c?.playerId).toBe(tid);
    f.tick(20);
    expect(lifted.carriedBy).toBeDefined();
    expect(lifted.pos.y).toBeGreaterThan(60 + T.cradleLift - 0.5);
    expect(has(lifted, BREATH_AURAS.cradled)).toBe(true);
    // Three gather under it (with the lifted: four, normal's need), the rest away.
    const others = f.players.filter((p) => p.id !== tid);
    others.slice(0, 3).forEach((p, i) => {
      f.put(p, (c?.x ?? 0) + i - 1, (c?.z ?? 0) + 1);
    });
    others.slice(3).forEach((p, i) => {
      f.put(p, (c?.x ?? 0) + 15, (c?.z ?? 0) + 8 + i * 3);
    });
    const ev = until(f, () => f.state()?.cradle === null, T.cradleHold + 1);
    const share = cradleShare(4, BREATH_DIFFICULTY.normal.cradleSoakers);
    expect(share.backlash).toBe(false);
    const under = hitsOf(ev, BREATH_NAMES.cradle);
    expect(under.length).toBe(4);
    for (const h of under) expect(h).toBe(share.each);
    expect(hitsOf(ev, BREATH_NAMES.backlash)).toEqual([]);
    expect(lifted.carriedBy).toBeUndefined();
  });

  it('too few under the Cradle: heavier shares and a backlash over the whole Cornice', () => {
    expect(cradleShare(2, 4).backlash).toBe(true);
    expect(cradleShare(2, 4).each).toBe(Math.round((T.cradleTotal / 2) * T.cradlePenaltyMult));
    const f = storm(6);
    f.dev('/dev heart breath eye');
    const tid = f.state()?.bar?.targetId as number;
    f.tick(Math.round(T.cradleCast / DT) + 1);
    const c = f.state()?.cradle;
    for (const p of f.players.filter((q) => q.id !== tid))
      f.put(p, (c?.x ?? 0) + 14, (c?.z ?? 0) + 10);
    const ev = until(f, () => f.state()?.cradle === null, T.cradleHold + 1);
    expect(hitsOf(ev, BREATH_NAMES.cradle)).toEqual([cradleShare(1, 4).each]);
    expect(hitsOf(ev, BREATH_NAMES.backlash).length).toBe(f.players.length);
  });

  it("Drawn Lightning strikes at its conductor's feet every 2 s and leaves charged ground", () => {
    const f = storm(4);
    f.dev('/dev heart breath conductor');
    const tid = f.state()?.bar?.targetId as number;
    const conductor = f.sim.ctx.entities.get(tid) as Entity;
    f.tick(Math.round(T.drawnCast / DT) + 1);
    expect(has(conductor, BREATH_AURAS.drawn)).toBe(true);
    // It walks; each strike falls where it stands at that moment.
    const meta = f.sim.players.get(conductor.id);
    if (!meta) throw new Error('meta');
    conductor.facing = Math.PI / 2;
    const seen = new Map<number, { x: number; z: number }>();
    let charged = 0;
    for (let t = 0; t < 20 * 9; t++) {
      meta.moveInput.forward = t % 40 < 10;
      for (const s of f.objects(BREATH_OBJECTS.strikePrefix)) {
        if (seen.has(s.id)) continue;
        seen.set(s.id, f.local(s));
        expect(dist(f.local(s), f.local(conductor))).toBeLessThan(0.5);
      }
      charged = Math.max(charged, f.objects(BREATH_OBJECTS.chargedPrefix).length);
      f.tick(1);
    }
    meta.moveInput.forward = false;
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(charged).toBeGreaterThanOrEqual(3);
    // A body standing in the charged ground is bitten once a second.
    const patch = f.objects(BREATH_OBJECTS.chargedPrefix)[0];
    const other = f.players.find((p) => p.id !== tid) as Entity;
    f.put(other, f.local(patch).x, f.local(patch).z);
    const hits = hitsOf(f.tick(20 * 3), 'Charged Ground', other.id);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('the storm swells: each pulse harder than the first, without end', () => {
    expect(swellMult(0)).toBe(1);
    expect(swellMult(10)).toBeCloseTo(1 + 10 * T.swellGrowth, 9);
    const f = storm(3);
    const p = f.players[1];
    const ev = f.tick(20 * 60);
    const hits = hitsOf(ev, BREATH_NAMES.swell, p.id);
    expect(hits.length).toBeGreaterThan(8);
    const first = hits.slice(0, 3).reduce((a, b) => a + b, 0);
    const last = hits.slice(-3).reduce((a, b) => a + b, 0);
    expect(last).toBeGreaterThan(first * 1.4);
    const swell = f.boss().auras.find((a) => a.id === BREATH_AURAS.swell);
    expect(swell?.stacks).toBe(f.state()?.swellPulses);
  });
});

describe('Guardian of the Breath: heroic', () => {
  it('an anchor that ran out leaves its player spent; no circle takes them again (normal: none)', () => {
    for (const heroic of [false, true]) {
      const f = pulled(4);
      if (heroic) f.dev('/dev heart breath heroic');
      f.dev('/dev heart breath circle');
      const at = f.local(f.objects(BREATH_OBJECTS.calmPrefix)[0]);
      const p = f.players[1];
      f.put(p, at.x, at.z);
      f.tick(Math.round(T.circleLand / DT) + 2);
      expect(has(p, BREATH_AURAS.anchor)).toBe(true);
      f.tick(Math.round(T.anchorSeconds / DT) + 2);
      expect(has(p, BREATH_AURAS.anchor)).toBe(false);
      expect(has(p, BREATH_AURAS.spent)).toBe(heroic);
      // A new circle under them: the spent are refused.
      f.dev('/dev heart breath circle');
      const again = f.local(f.objects(BREATH_OBJECTS.calmPrefix)[0]);
      f.put(p, again.x, again.z);
      f.tick(Math.round(T.circleLand / DT) + 2);
      expect(has(p, BREATH_AURAS.anchor)).toBe(!heroic);
    }
  });

  it('loose gales wander the Cornice after each exhale and toss whoever they touch', () => {
    const f = pulled(4);
    f.dev('/dev heart breath heroic');
    f.dev('/dev heart breath inhale');
    until(f, () => f.objects(BREATH_OBJECTS.gale).length > 0, 8);
    const gales = f.objects(BREATH_OBJECTS.gale);
    expect(gales.length).toBe(T.galeCount);
    const start = gales.map((g) => f.local(g));
    f.tick(20);
    gales.forEach((g, i) => {
      expect(dist(f.local(g), start[i])).toBeGreaterThan(0.5);
    });
    const p = f.players[2];
    const g = gales[0];
    f.put(p, f.local(g).x, f.local(g).z);
    const before = f.local(p);
    const hits = hitsOf(f.tick(2), BREATH_NAMES.gale, p.id);
    expect(hits.length).toBe(1);
    expect(dist(f.local(p), before)).toBeGreaterThan(3);
    // Normal: none.
    const n = pulled(4);
    n.dev('/dev heart breath inhale');
    n.tick(Math.round((T.inhaleCast + T.gustCast) / DT) + 4);
    expect(n.objects(BREATH_OBJECTS.gale)).toEqual([]);
  });

  it('storm gusts return in phase 2, telegraphed, and push like a blow (normal: never)', () => {
    for (const heroic of [false, true]) {
      const f = pulled(3);
      if (heroic) f.dev('/dev heart breath heroic');
      f.dev('/dev heart breath phase2');
      const phases = new Set<string>();
      let pushed = false;
      for (let t = 0; t < 20 * (T.stormCast + T.barrageSeconds + T.gustFirst + 8); t++) {
        f.tick(1);
        const ph = f.wind()?.phase ?? '';
        phases.add(ph);
        if (ph === 'gust' && has(f.players[1], WIND_DRIFT_AURA)) pushed = true;
      }
      expect(phases.has('gustgather')).toBe(heroic);
      expect(phases.has('gust')).toBe(heroic);
      expect(pushed).toBe(heroic);
    }
  });

  it('mythic is heroic whole, behind its own dev switch', () => {
    expect(BREATH_DIFFICULTY.mythic).toEqual(BREATH_DIFFICULTY.heroic);
    const f = pulled(2);
    expect(f.state()?.difficulty).toBe('normal');
    f.dev('/dev heart breath mythic');
    expect(f.state()?.difficulty).toBe('mythic');
    f.dev('/dev heart breath mythic off');
    expect(f.state()?.difficulty).toBe('normal');
  });
});

describe('Guardian of the Breath: the wipe and the fall', () => {
  it('a wipe puts the Cornice back: wind still, no objects, no marks, the stone body, Thessaly at her post', () => {
    const f = pulled(4);
    f.dev('/dev heart breath circle');
    f.tick(20 * 3);
    f.dev('/dev heart breath phase2');
    f.tick(20 * 6);
    f.dev('/dev heart breath eye');
    f.tick(20 * 3);
    expect(has(f.boss(), BREATH_AURAS.stormForm)).toBe(true);
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    f.tick(20 * 3, false);
    expect(f.state()).toBeNull();
    expect(breathWindOf(f.objects(BREATH_OBJECTS.windPrefix)[0].templateId)?.phase).toBe('still');
    for (const prefix of [
      BREATH_OBJECTS.calmPrefix,
      BREATH_OBJECTS.vortex,
      BREATH_OBJECTS.gale,
      BREATH_OBJECTS.strikePrefix,
      BREATH_OBJECTS.chargedPrefix,
      BREATH_OBJECTS.cradlePrefix,
    ])
      expect(f.objects(prefix), prefix).toEqual([]);
    for (const p of f.players)
      for (const id of [WIND_DRIFT_AURA, WIND_PULL_AURA, ...Object.values(BREATH_AURAS)])
        expect(has(p, id), id).toBe(false);
    expect(has(f.boss(), BREATH_AURAS.stormForm)).toBe(false);
    expect(f.inst.npcIds.map((id) => f.sim.ctx.entities.get(id)?.templateId)).toContain(
      'heart_captain_thessaly',
    );
    expect(authoredFieldCliffRuns(SMITH_HEART_FIELD).some((r) => r.open)).toBe(true);
  });

  it("its fall lights the Breath vein and the seal's quarter, and Thessaly says so", () => {
    const f = pulled(2);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'breath')).toBe(false);
    f.sim.ctx.handleDeath(f.boss(), f.players[0]);
    const ev = f.tick(3);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'breath')).toBe(true);
    expect(smithHeartProgress(f.sim.ctx, f.inst).mask & 2).toBe(2);
    expect(
      ev.some(
        (e) =>
          e.type === 'chat' &&
          (e as { textKey?: string }).textKey === 'hudChrome.breathGuardian.say.thessaly_victory',
      ),
    ).toBe(true);
    expect(f.state()?.finished).toBe(true);
  });
});

describe('Guardian of the Breath: determinism', () => {
  it('the same seed and the same raid fight the same fight', () => {
    const run = () => {
      const f = pulled(6, 41);
      const ev = f.tick(20 * 70);
      return JSON.stringify({
        wind: f.wind(),
        pos: f.players.map((p) => [Math.round(p.pos.x * 100), Math.round(p.pos.z * 100)]),
        hits: ev
          .filter((e) => e.type === 'damage')
          .map((e) => [(e as { ability?: string }).ability, (e as { amount?: number }).amount])
          .slice(0, 400),
      });
    };
    expect(run()).toBe(run());
  });
});
