// The Guardian of the Quench over a REAL Sim (docs/design/raid/smith_heart.md
// section 7.3, encounters/smith_heart/quench*.ts, on tests/helpers/
// quench_fight.ts): the shore ice rising round the lake, the cold bar rising
// alone and falling in a huddle, the freeze and its shatter (the hit, the
// splash, Frost-Brittle, the reset), heroic's contagious splash and its
// chain, the strain cracking the ice under a lingering huddle and the hole it
// opens, the water's trap (held, hurt, released on the rim, never killed by
// it), a walk into a hole, the blades waking at half health, the echoes'
// timing (3 s, 2 s below a quarter) and facing, the safe lee behind a blade,
// Tempering Strike's echoes, heroic's crossing (the swap, the lane's hits and
// holes), the deepening cold, the wipe putting the lake back, the Quench vein
// and the seal's quarter lit by the fall, and determinism.

import { describe, expect, it } from 'vitest';
import { QUENCH_BLADE_SPOTS, QUENCH_RIMEWALL } from '../src/sim/content/smith_heart_layout';
import {
  bladeStateOf,
  CROSSING_PAIRS,
  coldStep,
  crackOf,
  echoDelay,
  echoOf,
  huddlesOf,
  inBladeLee,
  insideRimewall,
  laneHoleSpots,
  laneOf,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  smithHeartProgress,
  smithHeartVeinWon,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const ticks = (s: number) => Math.round(s / DT);

/** A pulled fight, the shore ice standing; the guardian's breath held off
 *  (a test that wants it asks for it). */
function pulled(n = 6, seed = 29): QuenchFight {
  const f = quenchFight(n, seed);
  expect(f.dev('/dev heart quench pull')).toBe(true);
  f.tick(ticks(T.rimRise) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  return f;
}

/** Tick until `pred` holds (at most `seconds`); returns the events. */
function until(f: QuenchFight, pred: () => boolean, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 20 && !pred(); i++) out.push(...f.tick(1));
  return out;
}

/** The fight's exact cold for a player. */
function coldOf(f: QuenchFight, e: Entity): number {
  return f.state()?.chill[e.id]?.cold ?? 0;
}

function setCold(f: QuenchFight, e: Entity, v: number): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.chill[e.id] = { cold: v, frozen: 0 };
}

/** The blades' current spots (the fight's own view). */
function blades(f: QuenchFight): { x: number; z: number }[] {
  return (f.state()?.blades ?? []).map((b) => ({ x: b.x, z: b.z }));
}

/** Wake the blades at once (dev, no bar). */
function awake(f: QuenchFight): void {
  expect(f.dev('/dev heart quench blades')).toBe(true);
  expect(f.state()?.half).toBe('echoes');
}

const warnKeys = (ev: readonly SimEvent[]) =>
  ev
    .filter((e) => e.type === 'chat')
    .map((e) => (e as { textKey?: string }).textKey ?? '')
    .filter((k) => k.startsWith('hudChrome.quenchGuardian.'));

describe('Guardian of the Quench: the shore ice', () => {
  it('heaves up round the lake at the pull and walls once it stands, throwing the shelf onto the ice', () => {
    const f = quenchFight(3);
    // One raider still on the rock shelf, south, past the lake's edge.
    f.put(f.players[2], 198, -40);
    expect(insideRimewall(198, -40)).toBe(false);
    f.dev('/dev heart quench pull');
    const pull = f.tick(2);
    expect(warnKeys(pull)).toContain('hudChrome.quenchGuardian.warn.rim');
    expect(warnKeys(pull)).toContain('hudChrome.quenchGuardian.say.pull');
    const rising = f.objects(QUENCH_OBJECTS.rimRise);
    expect(rising.length).toBe(QUENCH_RIMEWALL.segments);
    expect(rising.every((e) => !e.kitObject)).toBe(true);
    f.tick(ticks(T.rimRise));
    expect(f.objects(QUENCH_OBJECTS.rimRise)).toEqual([]);
    const up = f.objects(QUENCH_OBJECTS.rim).filter((e) => e.templateId === QUENCH_OBJECTS.rim);
    expect(up.length).toBe(QUENCH_RIMEWALL.segments);
    expect(up.every((e) => e.kitObject?.kind === 'wall')).toBe(true);
    const thrown = f.local(f.players[2]);
    expect(insideRimewall(thrown.x, thrown.z, 1)).toBe(true);
    // A walk out toward the shelf stops at the ring.
    const w = f.players[2];
    f.put(w, 198, -26);
    w.facing = Math.PI;
    const meta = f.sim.players.get(w.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    f.tick(ticks(3));
    meta.moveInput.forward = false;
    const out = f.local(w);
    expect(insideRimewall(out.x, out.z)).toBe(true);
  });
});

describe('Guardian of the Quench: frostbite', () => {
  it('rises alone (full in about 30 s) and falls with two or more others close; one is not enough', () => {
    const f = pulled(6);
    const [, , a, b, c] = f.players;
    // Far apart, out of the guardian's reach.
    f.put(a, 182, 14);
    f.put(b, 214, 14);
    f.put(c, 198, 24);
    f.tick(1);
    const a0 = coldOf(f, a);
    f.tick(ticks(3));
    expect(coldOf(f, a) - a0).toBeCloseTo(3 * T.coldRise, 0);
    expect(aura(a, QUENCH_AURAS.cold)?.value).toBe(Math.round(coldOf(f, a)));
    expect(aura(a, QUENCH_AURAS.cold)?.value2).toBe(1);
    // A pair: still rising.
    f.put(b, 184, 14);
    f.tick(1);
    const pair0 = coldOf(f, a);
    f.tick(ticks(2));
    expect(coldOf(f, a)).toBeGreaterThan(pair0);
    expect(has(a, QUENCH_AURAS.warmth)).toBe(false);
    // Three together: it falls, and they wear the huddle's warmth.
    f.put(c, 183, 16);
    f.tick(1);
    const warm0 = coldOf(f, a);
    f.tick(ticks(1));
    expect(warm0 - coldOf(f, a)).toBeCloseTo(T.coldFall, 0);
    expect(has(a, QUENCH_AURAS.warmth)).toBe(true);
    expect(aura(a, QUENCH_AURAS.cold)?.value2).toBe(-1);
    expect(coldStep(2)).toBe(-T.coldFall);
    expect(coldStep(1)).toBeCloseTo(T.coldRise);
  });

  it('at full the player freezes solid; 4 s on the ice shatters: the hit, the splash, Frost-Brittle, the bar reset', () => {
    const f = pulled(6);
    const [, , a, near, far] = f.players;
    f.put(a, 182, 14);
    f.put(near, 185, 14);
    f.put(far, 182 + T.warmR + 4, 14);
    f.tick(1);
    setCold(f, a, T.coldMax - 0.1);
    const ev0 = f.tick(2);
    expect(has(a, QUENCH_AURAS.frozen)).toBe(true);
    expect(aura(a, QUENCH_AURAS.frozen)?.kind).toBe('stun');
    expect(aura(a, QUENCH_AURAS.frozen)?.unbreakableControl).toBe(true);
    expect(coldOf(f, a)).toBe(0);
    expect(warnKeys(ev0)).toContain('hudChrome.quenchGuardian.warn.frozen');
    // Frozen: no cold while encased.
    f.tick(ticks(2));
    expect(coldOf(f, a)).toBe(0);
    const near0 = coldOf(f, near);
    const far0 = coldOf(f, far);
    const ev = until(f, () => !has(a, QUENCH_AURAS.frozen), 3);
    expect(has(a, QUENCH_AURAS.frozen)).toBe(false);
    expect(hitsOf(ev, QUENCH_NAMES.shatter, a.id).length).toBe(1);
    const brittle = aura(a, QUENCH_AURAS.brittle);
    expect(brittle?.kind).toBe('vulnerability');
    expect(brittle?.value).toBeCloseTo(T.brittlePct);
    expect(brittle?.remaining).toBeGreaterThan(T.brittleSeconds - 0.2);
    // The splash: the close one's bar jumps, the far one's only climbs as
    // a lone bar does.
    const rose = coldOf(f, far) - far0;
    expect(rose).toBeLessThan(T.coldRise * 3);
    expect(coldOf(f, near) - near0 - rose).toBeGreaterThan(QUENCH_DIFFICULTY.normal.splashCold - 1);
    expect(hitsOf(ev, QUENCH_NAMES.shatter, near.id)).toEqual([]);
  });

  it('heroic: contagious cold splashes further and harder and sets off a chain', () => {
    const f = pulled(6);
    f.dev('/dev heart quench heroic');
    expect(f.state()?.difficulty).toBe('heroic');
    const [, , a, b, c, d] = f.players;
    const R = QUENCH_DIFFICULTY.heroic;
    expect(R.splashR).toBeGreaterThan(QUENCH_DIFFICULTY.normal.splashR);
    expect(R.splashCold).toBeGreaterThan(QUENCH_DIFFICULTY.normal.splashCold);
    // b stands outside the normal splash but inside heroic's.
    f.put(a, 182, 14);
    f.put(b, 182 + 8, 14);
    f.put(c, 182 + 8 + 9, 14);
    f.put(d, 182, 30);
    f.tick(1);
    setCold(f, b, 60);
    f.dev('/dev heart quench burst', a.id);
    until(f, () => has(b, QUENCH_AURAS.frozen), 6);
    expect(has(b, QUENCH_AURAS.frozen)).toBe(true);
    // b's own shatter reaches c in turn (its cold jumps).
    const c0 = coldOf(f, c);
    until(f, () => !has(b, QUENCH_AURAS.frozen), 6);
    expect(coldOf(f, c) - c0).toBeGreaterThan(R.splashCold - 2);
    expect(has(d, QUENCH_AURAS.frozen)).toBe(false);
  });
});

describe('Guardian of the Quench: the ice gives way', () => {
  it('a huddle lingering on one spot cracks the ice after 8 s, and the hole opens 2.5 s later under them', () => {
    const f = pulled(6);
    const [, , a, b, c] = f.players;
    f.put(a, 184, 14);
    f.put(b, 186, 14);
    f.put(c, 185, 16);
    f.tick(1);
    expect(
      huddlesOf([a, b, c].map((p) => ({ id: p.id, ...f.local(p) }))).map((h) => h.ids),
    ).toEqual([[a.id, b.id, c.id].sort((x, y) => x - y)]);
    const ev = until(f, () => f.objects(QUENCH_OBJECTS.crackPrefix).length > 0, 12);
    expect(f.state()?.clock).toBeGreaterThan(T.rimRise + T.strainLinger - 0.5);
    const crack = f.objects(QUENCH_OBJECTS.crackPrefix)[0];
    expect(crackOf(crack.templateId)).toBe(T.crackWarn);
    expect(crack.scale).toBe(T.holeR);
    expect(warnKeys(ev)).toContain('hudChrome.quenchGuardian.warn.crack');
    f.tick(ticks(T.crackWarn) - 2);
    expect(f.objects(QUENCH_OBJECTS.hole)).toEqual([]);
    f.tick(3);
    const hole = f.objects(QUENCH_OBJECTS.hole);
    expect(hole.length).toBe(1);
    expect(hole[0].scale).toBe(T.holeR);
    // Standing on it: all three went in.
    for (const p of [a, b, c]) expect(has(p, QUENCH_AURAS.trapped)).toBe(true);
  });

  it('a huddle that keeps moving never breaks the ice', () => {
    const f = pulled(6);
    const [, , a, b, c] = f.players;
    for (let k = 0; k < 6; k++) {
      const x = 180 + k * 6;
      f.put(a, x, 14);
      f.put(b, x + 2, 14);
      f.put(c, x + 1, 16);
      f.tick(ticks(5));
    }
    expect(f.objects(QUENCH_OBJECTS.crackPrefix)).toEqual([]);
    expect(f.objects(QUENCH_OBJECTS.hole)).toEqual([]);
  });

  it('the water holds a body 4 s (rooted, hurt, chilled), sets it on the rim, and never kills on its own', () => {
    const f = pulled(6);
    const p = f.players[2];
    f.put(p, 186, 14);
    f.tick(1);
    p.maxHp = 1200;
    p.hp = 90;
    const c0 = coldOf(f, p);
    f.dev('/dev heart quench hole', p.id);
    const ev = f.tick(1, false);
    expect(has(p, QUENCH_AURAS.trapped)).toBe(true);
    expect(aura(p, QUENCH_AURAS.trapped)?.kind).toBe('root');
    expect(coldOf(f, p) - c0).toBeGreaterThan(T.plungeCold - 2);
    const all = [...ev, ...f.tick(ticks(T.trapSeconds) + 4, false)];
    expect(p.dead).toBe(false);
    expect(p.hp).toBeGreaterThanOrEqual(1);
    expect(hitsOf(all, QUENCH_NAMES.water, p.id).length).toBeGreaterThanOrEqual(1);
    // Out on the rim, free.
    expect(has(p, QUENCH_AURAS.trapped)).toBe(false);
    const hole = f.state()?.holes[0];
    if (!hole) throw new Error('no hole');
    expect(dist(f.local(p), hole)).toBeGreaterThan(hole.r);
    // The water's cold stops one short of full: it never freezes them in it.
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(Math.max(...Object.values(st.chill).map((c) => c.cold))).toBeLessThanOrEqual(T.coldMax);
  });

  it('walking into a hole drops you in (movement respects the holes)', () => {
    const f = pulled(4);
    const w = f.players[2];
    const a = f.players[3];
    f.put(a, 186, 14);
    f.dev('/dev heart quench hole', a.id);
    f.tick(ticks(T.trapSeconds) + 6);
    expect(has(a, QUENCH_AURAS.trapped)).toBe(false);
    const hole = f.state()?.holes[0];
    if (!hole) throw new Error('no hole');
    f.put(w, hole.x, hole.z - 8);
    w.facing = 0;
    const meta = f.sim.players.get(w.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    until(f, () => has(w, QUENCH_AURAS.trapped), 3);
    meta.moveInput.forward = false;
    expect(has(w, QUENCH_AURAS.trapped)).toBe(true);
    // Held: forward input moves it no further while in the water.
    const held = f.local(w);
    meta.moveInput.forward = true;
    f.tick(ticks(1));
    meta.moveInput.forward = false;
    expect(dist(f.local(w), held)).toBeLessThan(0.05);
  });
});

describe('Guardian of the Quench: the blades and their echoes', () => {
  it('at half health the guardian raises its arms and the four blades tear free and float', () => {
    const f = pulled(4);
    expect(f.objects(QUENCH_OBJECTS.bladePrefix).map((e) => bladeStateOf(e.templateId))).toEqual([
      'sunk',
      'sunk',
      'sunk',
      'sunk',
    ]);
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.49);
    const ev = until(f, () => b.castingAbility === QUENCH_CASTS.wake, 4);
    expect(b.castingAbility).toBe(QUENCH_CASTS.wake);
    expect(f.state()?.half).toBe('wake');
    expect(warnKeys(ev)).toContain('hudChrome.quenchGuardian.warn.wake');
    expect(
      f.objects(QUENCH_OBJECTS.bladePrefix).every((e) => bladeStateOf(e.templateId) === 'wake'),
    ).toBe(true);
    until(f, () => f.state()?.half === 'echoes', T.wakeCast + 1);
    expect(f.state()?.half).toBe('echoes');
    expect(has(b, QUENCH_AURAS.awake)).toBe(true);
    for (const e of f.objects(QUENCH_OBJECTS.bladePrefix)) {
      expect(bladeStateOf(e.templateId)).toBe('float');
      expect(e.kind).toBe('object');
      expect(e.kitObject?.kind).toBe('wall');
    }
  });

  it('every breath is echoed by each blade 3 s after it lands (2 s below a quarter), facing the way the guardian faced', () => {
    for (const low of [false, true]) {
      const f = pulled(4);
      awake(f);
      const b = f.boss();
      if (low) b.hp = Math.floor(b.maxHp * 0.2);
      f.dev('/dev heart quench breath');
      const facing = f.state()?.bar?.facing ?? Number.NaN;
      const echoes = f.objects(QUENCH_OBJECTS.echoPrefix);
      expect(echoes.length).toBe(4);
      const delay = echoDelay(low ? 0.2 : 0.6);
      expect(delay).toBe(low ? T.echoDelayLow : T.echoDelay);
      for (const e of echoes) {
        expect(e.facing).toBeCloseTo(facing, 6);
        expect(echoOf(e.templateId)).toEqual({
          kind: 'breath',
          seconds: Math.round((T.breathCast + delay) * 10) / 10,
          hit: false,
        });
        expect(e.scale).toBe(T.breathRange);
      }
      // A raider in front of a blade, down the breath's line.
      const blade = blades(f)[0];
      const victim = f.players[3];
      f.put(victim, blade.x + Math.sin(facing) * 9, blade.z + Math.cos(facing) * 9);
      const ev = f.tick(ticks(T.breathCast + delay) - 2);
      expect(hitsOf(ev, QUENCH_NAMES.echoBreath, victim.id)).toEqual([]);
      const land = f.tick(4);
      expect(hitsOf(land, QUENCH_NAMES.echoBreath, victim.id).length).toBe(1);
      expect(
        f.objects(QUENCH_OBJECTS.echoPrefix).every((e) => echoOf(e.templateId)?.hit === true),
      ).toBe(true);
      f.tick(ticks(T.echoShow) + 2);
      expect(f.objects(QUENCH_OBJECTS.echoPrefix)).toEqual([]);
    }
  });

  it('turning the guardian aims the echoes: their facing follows the tank', () => {
    const f = pulled(4);
    awake(f);
    const b = f.boss();
    const tank = f.players.find((p) => p.id === b.aggroTargetId);
    if (!tank) throw new Error('no tank');
    const seen: { want: number; got: number }[] = [];
    for (const [x, z] of [
      [198, -12],
      [208, -2],
      [190, 8],
    ]) {
      f.put(tank, x, z);
      f.tick(ticks(1));
      f.dev('/dev heart quench breath');
      const want = Math.atan2(tank.pos.x - b.pos.x, tank.pos.z - b.pos.z);
      const echoes = f.objects(QUENCH_OBJECTS.echoPrefix).filter((e) => {
        const o = echoOf(e.templateId);
        return o?.kind === 'breath' && !o.hit;
      });
      expect(echoes.length).toBe(4);
      for (const e of echoes) seen.push({ want, got: e.facing });
      f.tick(ticks(T.breathCast + T.echoDelay + T.echoShow) + 4);
    }
    for (const { want, got } of seen) {
      expect(Math.cos(got - want)).toBeGreaterThan(0.999);
    }
    // Three turns, three different aims.
    expect(new Set(seen.map((v) => Math.round(v.got * 10))).size).toBe(3);
  });

  it('behind a blade, on the side away from the attack, is always safe', () => {
    const f = pulled(5);
    awake(f);
    f.dev('/dev heart quench breath');
    const facing = f.state()?.bar?.facing ?? 0;
    const blade = blades(f)[1];
    const [, , front, behind, aside] = f.players;
    const ux = Math.sin(facing);
    const uz = Math.cos(facing);
    f.put(front, blade.x + ux * 6, blade.z + uz * 6);
    f.put(behind, blade.x - ux * 3, blade.z - uz * 3);
    // Well behind, but out of the lee's reach: not sheltered (it may or may
    // not stand in another echo; the rule is the lee itself).
    f.put(aside, blade.x - ux * (T.leeR + 3), blade.z - uz * (T.leeR + 3));
    expect(inBladeLee(blade, facing, f.local(behind))).toBe(true);
    expect(inBladeLee(blade, facing, f.local(aside))).toBe(false);
    const ev = f.tick(ticks(T.breathCast + T.echoDelay) + 4);
    expect(hitsOf(ev, QUENCH_NAMES.echoBreath, front.id).length).toBeGreaterThan(0);
    expect(hitsOf(ev, QUENCH_NAMES.echoBreath, behind.id)).toEqual([]);
    expect(hitsOf(ev, QUENCH_NAMES.breath, behind.id)).toEqual([]);
  });

  it("Tempering Strike's swing raises a strike echo at every blade, landing 3 s later", () => {
    const f = pulled(3);
    awake(f);
    const ev = until(
      f,
      () =>
        f.objects(QUENCH_OBJECTS.echoPrefix).some((e) => echoOf(e.templateId)?.kind === 'strike'),
      30,
    );
    const echoes = f.objects(QUENCH_OBJECTS.echoPrefix);
    expect(echoes.length).toBe(4);
    // The same tick as the swing's cleave cue.
    const last = ev.slice(-80);
    expect(
      last.some(
        (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === 'brood_cleave',
      ),
    ).toBe(true);
    expect(echoOf(echoes[0].templateId)?.seconds).toBe(T.echoDelay);
    expect(echoes[0].facing).toBeCloseTo(f.boss().facing, 1);
    expect(echoes[0].scale).toBe(T.strikeRange);
  });

  it('the cold deepens every 20 s once the blades wake (the soft enrage)', () => {
    const f = pulled(2);
    awake(f);
    f.tick(ticks(T.deepenEvery * 2) + 2);
    expect(f.state()?.deepenStacks).toBe(2);
    expect(aura(f.boss(), QUENCH_AURAS.deepening)?.stacks).toBe(2);
  });
});

describe('Guardian of the Quench: heroic, the crossing', () => {
  it('two blades swap places along a telegraphed lane that strikes and cracks into holes', () => {
    const f = pulled(5);
    f.dev('/dev heart quench heroic');
    awake(f);
    const before = blades(f);
    f.dev('/dev heart quench dance');
    const st = f.state();
    if (!st?.dance) throw new Error('no crossing');
    const [ia, ib] = CROSSING_PAIRS[st.dance.pair];
    const lane = f.objects(QUENCH_OBJECTS.lanePrefix)[0];
    expect(laneOf(lane.templateId)).toEqual({ state: 'warn', seconds: T.danceWarn });
    // A raider in the lane's middle (away from the guardian's own spot).
    const victim = f.players[4];
    const mid = { x: (before[ia].x + before[ib].x) / 2, z: (before[ia].z + before[ib].z) / 2 };
    const t = 0.3;
    const on = {
      x: before[ia].x + (before[ib].x - before[ia].x) * t,
      z: before[ia].z + (before[ib].z - before[ia].z) * t,
    };
    f.put(victim, on.x, on.z);
    expect(dist(f.local(lane), mid)).toBeLessThan(0.01);
    f.tick(ticks(T.danceWarn) + 1);
    const flying = f
      .objects(QUENCH_OBJECTS.bladePrefix)
      .filter((e) => bladeStateOf(e.templateId) === 'fly');
    expect(flying.length).toBe(2);
    expect(flying.every((e) => !e.kitObject)).toBe(true);
    const ev = f.tick(ticks(T.danceFly) + 2);
    expect(hitsOf(ev, QUENCH_NAMES.cross, victim.id).length).toBe(1);
    // Swapped.
    const after = blades(f);
    expect(dist(after[ia], before[ib])).toBeLessThan(0.01);
    expect(dist(after[ib], before[ia])).toBeLessThan(0.01);
    for (const i of [ia, ib]) {
      const e = f.sim.ctx.entities.get(st.blades[i].objectId);
      expect(e && bladeStateOf(e.templateId)).toBe('float');
    }
    // The lane cracks, then opens into holes along it.
    const spots = laneHoleSpots(before[ia], before[ib]);
    expect(f.objects(QUENCH_OBJECTS.crackPrefix).length).toBe(spots.length);
    f.tick(ticks(T.laneCrack) + 2);
    expect(f.objects(QUENCH_OBJECTS.hole).length).toBe(spots.length);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
  });

  it('never crosses on normal; mythic is heroic whole behind its own switch', () => {
    const f = pulled(2);
    awake(f);
    f.tick(ticks(T.danceFirst + T.danceEvery + 2));
    expect(f.state()?.dances).toBe(0);
    expect(QUENCH_DIFFICULTY.mythic).toEqual(QUENCH_DIFFICULTY.heroic);
    f.dev('/dev heart quench mythic');
    expect(f.state()?.difficulty).toBe('mythic');
    f.dev('/dev heart quench mythic off');
    expect(f.state()?.difficulty).toBe('normal');
  });
});

describe('Guardian of the Quench: the wipe and the fall', () => {
  it('a wipe puts the lake back: no bars, frost, holes, echoes or lanes, the blades sunk home, the shore ice down', () => {
    const f = pulled(4);
    f.dev('/dev heart quench heroic');
    f.dev('/dev heart quench hole', f.players[1].id);
    f.dev('/dev heart quench crack', f.players[2].id);
    awake(f);
    f.dev('/dev heart quench breath');
    f.dev('/dev heart quench dance');
    f.tick(ticks(4));
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    f.tick(ticks(3), false);
    expect(f.state()).toBeNull();
    for (const prefix of [
      QUENCH_OBJECTS.crackPrefix,
      QUENCH_OBJECTS.hole,
      QUENCH_OBJECTS.echoPrefix,
      QUENCH_OBJECTS.lanePrefix,
      QUENCH_OBJECTS.rimRise,
      QUENCH_OBJECTS.rim,
    ])
      expect(f.objects(prefix), prefix).toEqual([]);
    for (const p of f.players)
      for (const id of [
        QUENCH_AURAS.cold,
        QUENCH_AURAS.warmth,
        QUENCH_AURAS.frozen,
        QUENCH_AURAS.trapped,
      ])
        expect(has(p, id), id).toBe(false);
    expect(has(f.boss(), QUENCH_AURAS.awake)).toBe(false);
    expect(has(f.boss(), QUENCH_AURAS.deepening)).toBe(false);
    const bl = f.objects(QUENCH_OBJECTS.bladePrefix);
    expect(bl.length).toBe(4);
    for (const e of bl) {
      expect(bladeStateOf(e.templateId)).toBe('sunk');
      expect(e.kitObject?.kind).toBe('wall');
      const at = f.local(e);
      expect(QUENCH_BLADE_SPOTS.some((s) => dist(s, at) < 0.01)).toBe(true);
    }
    // The crossing was in flight at the wipe: still one blade per home.
    const homes = bl.map((e) => QUENCH_BLADE_SPOTS.findIndex((s) => dist(s, f.local(e)) < 0.01));
    expect(new Set(homes).size).toBe(4);
  });

  it('a player who left the lake as the fight ended keeps no cold or warmth', () => {
    const f = pulled(3);
    f.tick(ticks(2));
    const gone = f.players[2];
    expect(f.cold(gone)).toBeDefined();
    // Far off the lake (past the listeners' reach) on the tick it ends.
    f.put(gone, 0, -400);
    f.dev('/dev heart quench reset');
    for (const id of [QUENCH_AURAS.cold, QUENCH_AURAS.warmth, QUENCH_AURAS.trapped])
      expect(has(gone, id), id).toBe(false);
  });

  it('a cut breath takes its echoes with it; a landed one keeps them', () => {
    const f = pulled(3);
    awake(f);
    // Breath echoes only (the template's `b_`; a strike's swing raises its own).
    f.dev('/dev heart quench breath');
    expect(f.objects(`${QUENCH_OBJECTS.echoPrefix}b_`).length).toBe(4);
    f.boss().castingAbility = null;
    const ev = f.tick(ticks(T.breathCast + 4));
    expect(f.objects(`${QUENCH_OBJECTS.echoPrefix}b_`)).toEqual([]);
    for (const p of f.players) expect(hitsOf(ev, QUENCH_NAMES.echoBreath, p.id)).toEqual([]);
    f.tick(ticks(T.barGap + 1));
    f.dev('/dev heart quench breath');
    f.tick(ticks(T.breathCast) + 2);
    expect(f.objects(`${QUENCH_OBJECTS.echoPrefix}b_`).length).toBe(4);
  });

  it("its fall lights the Quench vein and the seal's quarter; the shore ice falls and the lake refreezes", () => {
    const f = pulled(2);
    f.dev('/dev heart quench hole', f.players[1].id);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'quench')).toBe(false);
    f.sim.ctx.handleDeath(f.boss(), f.players[0]);
    const ev = f.tick(3);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'quench')).toBe(true);
    expect(smithHeartProgress(f.sim.ctx, f.inst).mask & 4).toBe(4);
    expect(
      ev.some(
        (e) =>
          e.type === 'chat' &&
          (e as { textKey?: string }).textKey === 'hudChrome.quenchGuardian.say.death',
      ),
    ).toBe(true);
    expect(f.state()?.finished).toBe(true);
    expect(f.objects(QUENCH_OBJECTS.hole)).toEqual([]);
    expect(f.objects(QUENCH_OBJECTS.rim)).toEqual([]);
    expect(has(f.players[1], QUENCH_AURAS.trapped)).toBe(false);
  });
});

describe('Guardian of the Quench: determinism', () => {
  it('the same seed and the same raid fight the same fight', () => {
    const run = () => {
      const f = quenchFight(6, 41);
      f.dev('/dev heart quench pull');
      f.dev('/dev heart quench heroic');
      // A huddle that will break the ice, and a raid left to the cold.
      f.put(f.players[2], 184, 14);
      f.put(f.players[3], 186, 14);
      f.put(f.players[4], 185, 16);
      const ev = f.tick(ticks(40));
      f.boss().hp = Math.floor(f.boss().maxHp * 0.45);
      ev.push(...f.tick(ticks(50)));
      const st = f.state();
      return JSON.stringify({
        half: st?.half,
        holes: st?.holes.map((h) => [Math.round(h.x * 100), Math.round(h.z * 100)]),
        cold: f.players.map((p) => Math.round(coldOf(f, p) * 100)),
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
