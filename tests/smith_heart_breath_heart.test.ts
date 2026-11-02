// The Guardian of the Breath's Knotted Gale (Mythic) over a REAL Sim claim: the ball
// and its fuse, the two portals opened at their marked players' feet (the fall too),
// the carrier's load, the one-way crossing, the throw at any gap, a dead carrier, phase
// 2's two balls and one pair, the clock's holds, the reset, determinism and the player
// text. The online path: tests/smith_heart_breath_heart_wire.test.ts.

import { describe, expect, it } from 'vitest';
import {
  type NearbyInteractionHud,
  type NearbyInteractionWorld,
  tryNearbyInteraction,
} from '../src/game/nearby_interaction';
import { carriesLoad, movesCaster } from '../src/sim/combat/carried_load';
import { CORNICE_GAPS } from '../src/sim/content/smith_heart_layout';
import {
  atGapLip,
  circleClear,
  gapDistance,
  inBreathArena,
  knotGrid,
  knotSpot,
} from '../src/sim/encounters/smith_heart/breath_geometry';
import { heartDevTrigger, startHeart } from '../src/sim/encounters/smith_heart/breath_heart';
import {
  BREATH_AURAS,
  BREATH_CUES,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  BREATH_OBJECTS,
  KNOT_HOP_TEXT,
  KNOT_NOT_AT_LIP_ERROR,
  knotOf,
  knotTemplate,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { heldFast, throwPlayer } from '../src/sim/encounters/smith_heart/breath_scope';
import { moveSpeedMult } from '../src/sim/player_motion';
import { type Entity, RUN_SPEED } from '../src/sim/types';
import { WIND_DRIFT_AURA } from '../src/sim/wind_drift';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildKnotAlertView } from '../src/ui/hud/dungeon/knot_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);

function mythic(n = 6, seed = 23): BreathFight {
  const f = breathFight(n, seed);
  f.dev('/dev heart breath pull');
  f.dev('/dev heart breath mythic');
  const st = f.state();
  if (!st) throw new Error('no fight');
  // The clocks of everything else, out of the way.
  st.inhaleTimer = 999;
  st.circleTimer = 999;
  st.heartTimer = 999;
  return f;
}

function round(f: BreathFight, form = '') {
  expect(f.dev(`/dev heart breath heart${form}`)).toBe(true);
  const heart = f.state()?.heart;
  if (!heart) throw new Error('no round');
  return heart;
}

const entity = (f: BreathFight, id: number | null) => f.sim.ctx.entities.get(id ?? -1) as Entity;
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
/** A free player who wears no mark and carries nothing. */
function third(f: BreathFight): Entity {
  const h = f.state()?.heart;
  const p = f.players.find(
    (e) =>
      !e.dead &&
      !h?.bearers.includes(e.id) &&
      !h?.knots.some((k) => k.carrierId === e.id) &&
      e.id !== f.boss().aggroTargetId,
  );
  if (!p) throw new Error('no third');
  return p;
}
/** A floor spot at gap `g`'s lip. */
function lip(g: (typeof CORNICE_GAPS)[number]): { x: number; z: number } {
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const x = g.x + Math.sin(a) * (g.r + 2);
    const z = g.z + Math.cos(a) * (g.r + 2);
    if (inBreathArena(x, z) && atGapLip(x, z) && gapDistance(x, z) > 0.5) return { x, z };
  }
  throw new Error(`no lip at ${g.deg}`);
}
/** A spot off the floor just past gap `g`'s throat. */
function overVoid(g: (typeof CORNICE_GAPS)[number]): { x: number; z: number } {
  const a = (g.deg * Math.PI) / 180;
  for (let d = 0; d < 30; d += 0.5) {
    const x = g.x + Math.sin(a) * d;
    const z = g.z + Math.cos(a) * d;
    if (!inBreathArena(x, z)) return { x, z };
  }
  throw new Error('no void');
}
/** Leave the floor mid-air, as a body going over the lip does. */
function fallOver(f: BreathFight, p: Entity, g: (typeof CORNICE_GAPS)[number]): void {
  const at = overVoid(g);
  const w = f.world(at.x, at.z);
  p.pos.x = w.x;
  p.pos.z = w.z;
  p.pos.y -= 2;
  p.onGround = false;
  f.sim.ctx.rebucket(p);
}
function carry(f: BreathFight, p: Entity, k = 0) {
  const knot = f.state()?.heart?.knots[k];
  if (!knot) throw new Error('no ball');
  f.put(p, knot.x, knot.z);
  f.tick();
  expect(knot.carrierId).toBe(p.id);
  return knot;
}

describe('Knotted Gale: the row', () => {
  it('is mythic only; every tier else never starts a round', () => {
    expect(BREATH_DIFFICULTY.mythic.stormHeart).toBe(true);
    expect(BREATH_DIFFICULTY.heroic.stormHeart).toBe(false);
    expect(BREATH_DIFFICULTY.normal.stormHeart).toBe(false);
    for (const tier of ['', 'heroic']) {
      const f = breathFight(4);
      f.dev('/dev heart breath pull');
      if (tier) f.dev(`/dev heart breath ${tier}`);
      f.tick(ticks(30));
      expect(f.state()?.heart).toBeNull();
      expect(f.state()?.heartRuns).toBe(0);
      expect(f.objects(BREATH_OBJECTS.knotPrefix)).toHaveLength(0);
    }
  });

  it('the template round-trips and the Cornice is too small for half speed', () => {
    expect(knotOf(knotTemplate('held', 12.5))).toEqual({ state: 'held', fuse: 12.5 });
    expect(knotOf('sh_breath_cradle_5')).toBeNull();
    // The farthest ball: half speed walks it inside the fuse with time to spare (why
    // the load is a crawl); at the load's own speed it takes nearly the whole fuse.
    const far = Math.max(...knotGrid().map((g) => g.far)) - T.heartLipReach;
    expect(far / (RUN_SPEED * 0.5)).toBeLessThan(T.heartFuse * 0.6);
    expect(far / (RUN_SPEED * T.heartWalkMult)).toBeGreaterThan(T.heartFuse * 0.75);
    // Where a ball really drops is that far.
    for (let salt = 0; salt < 40; salt++) {
      const at = knotSpot(salt * 97);
      expect(gapDistance(at.x, at.z)).toBeGreaterThanOrEqual(T.heartFar);
      expect(inBreathArena(at.x, at.z)).toBe(true);
    }
  });
});

describe('Knotted Gale: the round', () => {
  it('drops a ball far from the gaps, two marks on non-tanks, the fuse on the template', () => {
    const f = mythic();
    const h = round(f);
    expect(h.knots).toHaveLength(1);
    expect(gapDistance(h.knots[0].x, h.knots[0].z)).toBeGreaterThanOrEqual(T.heartFar);
    const a = entity(f, h.markA);
    const b = entity(f, h.markB);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(f.boss().aggroTargetId);
    expect(b.id).not.toBe(f.boss().aggroTargetId);
    expect(has(a, BREATH_AURAS.portalA)).toBe(true);
    expect(has(b, BREATH_AURAS.portalB)).toBe(true);
    f.tick(ticks(3));
    const obj = f.objects(BREATH_OBJECTS.knotPrefix)[0];
    const of = knotOf(obj.templateId);
    expect(of?.state).toBe('free');
    expect(of?.fuse).toBeGreaterThan(T.heartFuse - 3.6);
    expect(of?.fuse).toBeLessThanOrEqual(T.heartFuse - 2.5);
    expect(obj.scale).toBe(T.heartPickR);
  });

  it('out of time it kills the whole Cornice, shields or not, game masters aside', () => {
    const f = mythic();
    round(f);
    const gm = f.players[5];
    gm.gm = true;
    f.tick(ticks(T.heartFuse) - 2);
    expect(f.players.filter((p) => p.dead)).toHaveLength(0);
    // The ball runs out with no keep-alive and a huge pool.
    for (const p of f.players) {
      p.maxHp = 5000000;
      p.hp = 5000000;
    }
    const evs = f.tick(4, false);
    for (const p of f.players) expect(p.dead, p.name).toBe(p !== gm);
    expect(evs.some((e) => e.type === 'spellfxAt' && e.ability === BREATH_CUES.knotBurst)).toBe(
      true,
    );
    expect(f.state()?.heart ?? null).toBeNull();
  });

  it('opens each portal exactly where its player stands when the mark ends', () => {
    const f = mythic();
    const h = round(f);
    const a = entity(f, h.markA);
    const b = entity(f, h.markB);
    f.put(a, -10, 190);
    const spot = lip(CORNICE_GAPS[0]);
    f.put(b, spot.x, spot.z);
    expect(h.portalA).toBeNull();
    f.tick(ticks(T.heartMark) - 2);
    expect(h.portalA).toBeNull();
    const atA = f.local(a);
    const atB = f.local(b);
    f.tick(3);
    expect(has(a, BREATH_AURAS.portalA)).toBe(false);
    expect(has(b, BREATH_AURAS.portalB)).toBe(false);
    expect(Math.hypot((h.portalA?.x ?? 0) - atA.x, (h.portalA?.z ?? 0) - atA.z)).toBeLessThan(3);
    expect(Math.hypot((h.portalB?.x ?? 0) - atB.x, (h.portalB?.z ?? 0) - atB.z)).toBeLessThan(3);
    expect(f.objects(BREATH_OBJECTS.portalA)).toHaveLength(1);
    expect(f.objects(BREATH_OBJECTS.portalB)[0].scale).toBe(T.heartPortalR);
  });

  it('a Portal B player who falls through a gap opens it at the lip they left', () => {
    const f = mythic();
    const h = round(f);
    const b = entity(f, h.markB);
    const g = CORNICE_GAPS[0];
    const spot = lip(g);
    f.put(b, spot.x, spot.z);
    f.tick(2);
    const left = f.local(b);
    f.tick(ticks(T.heartMark) - 12);
    const stood = f.local(b);
    fallOver(f, b, g);
    f.tick(14);
    expect(h.portalB).not.toBeNull();
    const dist = Math.hypot((h.portalB?.x ?? 0) - stood.x, (h.portalB?.z ?? 0) - stood.z);
    expect(dist).toBeLessThan(6);
    expect(atGapLip(h.portalB?.x ?? 0, h.portalB?.z ?? 0)).toBe(true);
    expect(left).toBeDefined();
  });

  it('a third player takes it up: heavy, immune to the wind; the marked never do', () => {
    const f = mythic();
    const h = round(f);
    const knot = h.knots[0];
    // A marked player on the ball: nothing.
    const a = entity(f, h.markA);
    f.put(a, knot.x, knot.z);
    f.tick(2);
    expect(knot.carrierId).toBeNull();
    f.put(a, -10, 190);
    const p = third(f);
    const before = moveSpeedMult(p);
    carry(f, p);
    expect(has(p, BREATH_AURAS.laden)).toBe(true);
    expect(moveSpeedMult(p)).toBeCloseTo(before * T.heartWalkMult, 5);
    expect(heldFast(p)).toBe(true);
    // Slow immunity does not lift the load: it is not a snare.
    p.auras.push({ ...p.auras[0], id: 'x', kind: 'slow_immunity', remaining: 5, duration: 5 });
    expect(moveSpeedMult(p)).toBeCloseTo(before * T.heartWalkMult, 5);
    p.auras = p.auras.filter((x) => x.id !== 'x');
    // The wind: no aura through a blow, no throw moves them, and the ball rides along.
    f.dev('/dev heart breath blow 90');
    f.tick(10);
    expect(has(p, WIND_DRIFT_AURA)).toBe(false);
    expect(has(third(f), WIND_DRIFT_AURA)).toBe(true);
    expect(throwPlayer({ ctx: f.sim.ctx, inst: f.inst }, p, 1, 0, 10)).toBe(0);
    expect(knotOf(entity(f, knot.objectId).templateId)?.state).toBe('held');
    const at = f.local(p);
    expect(Math.hypot(knot.x - at.x, knot.z - at.z)).toBeLessThan(0.01);
    // The aura's bar is the fuse.
    const load = p.auras.find((x) => x.id === BREATH_AURAS.laden);
    expect(load?.duration).toBe(T.heartFuse);
    expect(Math.abs((load?.remaining ?? 0) - knot.fuse)).toBeLessThan(0.2);
  });

  it('a marked player standing where the portal opens is not thrown across', () => {
    const f = mythic();
    const h = round(f);
    const a = f.players.find((e) => e.id === h.markA) as Entity;
    const b = f.players.find((e) => e.id === h.markB) as Entity;
    f.put(a, -10, 190);
    f.put(b, 10, 190);
    f.tick(ticks(T.heartMark) + 2);
    const A = h.portalA as NonNullable<typeof h.portalA>;
    const B = h.portalB as NonNullable<typeof h.portalB>;
    expect(Math.hypot(f.local(a).x - A.x, f.local(a).z - A.z)).toBeLessThan(1.5);
    expect(Math.hypot(f.local(b).x - B.x, f.local(b).z - B.z)).toBeLessThan(1.5);
  });

  it('anyone crosses, both ways, with or without the ball', () => {
    const f = mythic();
    const h = round(f);
    const walker = third(f);
    const p = f.players.find((e) => e !== walker && !h.bearers.includes(e.id)) as Entity;
    f.tick(ticks(T.heartMark));
    const A = h.portalA as NonNullable<typeof h.portalA>;
    const B = h.portalB as NonNullable<typeof h.portalB>;
    // No ball, A to B: told so.
    f.put(walker, A.x, A.z);
    const evs = f.tick(1);
    expect(Math.hypot(f.local(walker).x - B.x, f.local(walker).z - B.z)).toBeLessThan(0.5);
    expect(evs.some((e) => e.type === 'log' && e.text === KNOT_HOP_TEXT)).toBe(true);
    expect(evs.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.portalHop)).toBe(true);
    // No ball, B to A.
    f.put(p, B.x, B.z);
    f.tick(1);
    expect(Math.hypot(f.local(p).x - A.x, f.local(p).z - A.z)).toBeLessThan(0.5);
    // The ball rides along, the way the carrier came back.
    carry(f, p);
    f.put(p, B.x, B.z);
    f.tick(1);
    const at = f.local(p);
    expect(Math.hypot(at.x - A.x, at.z - A.z)).toBeLessThan(0.5);
    expect(h.knots[0].x).toBe(at.x);
    expect(h.knots[0].z).toBe(at.z);
  });

  it('one crossing per walk in: no bouncing until the body steps clear', () => {
    const f = mythic();
    const h = round(f);
    const walker = third(f);
    f.tick(ticks(T.heartMark));
    const A = h.portalA as NonNullable<typeof h.portalA>;
    const B = h.portalB as NonNullable<typeof h.portalB>;
    f.put(walker, A.x, A.z);
    f.tick(1);
    // Standing in B after the hop: it stays there.
    f.tick(10);
    expect(Math.hypot(f.local(walker).x - B.x, f.local(walker).z - B.z)).toBeLessThan(0.5);
    // Clear of both, then back in B: across again.
    const clear = { x: (A.x + B.x) / 2 + T.heartPortalR * 2, z: (A.z + B.z) / 2 };
    f.put(walker, clear.x, clear.z);
    f.tick(1);
    f.put(walker, B.x, B.z);
    f.tick(1);
    expect(Math.hypot(f.local(walker).x - A.x, f.local(walker).z - A.z)).toBeLessThan(0.5);
  });

  it('the carrier moves on foot only: charge and blink are refused, unbilled', () => {
    const f = mythic();
    round(f);
    const p = third(f);
    const free = f.players.find(
      (e) => e !== p && !f.state()?.heart?.bearers.includes(e.id),
    ) as Entity;
    carry(f, p);
    expect(carriesLoad(p)).toBe(true);
    expect(carriesLoad(free)).toBe(false);
    for (const type of ['charge', 'blinkForward', 'repositionToAim', 'hunterTrailbreak'])
      expect(movesCaster([{ type }]), type).toBe(true);
    expect(movesCaster([{ type: 'damage' }])).toBe(false);
    // The warrior's real charge on the guardian: the carrier stays, unbilled; a free
    // player at the same range goes, so it is the load that stopped it.
    const boss = f.local(f.boss());
    for (const pid of f.pids) f.sim.setPlayerLevel(20, pid);
    const cast = (who: Entity) => {
      f.put(who, boss.x + 16, boss.z);
      who.targetId = f.boss().id;
      who.cooldowns.delete('charge');
      f.sim.castAbility('charge', f.pids[f.players.indexOf(who)]);
    };
    cast(p);
    expect(p.chargeTargetId ?? null).toBeNull();
    expect(p.cooldowns.get('charge') ?? 0).toBe(0);
    cast(free);
    expect(free.chargeTargetId).toBe(f.boss().id);
  });

  it('throws at the lip of ANY gap, and refuses anywhere else', () => {
    for (const g of CORNICE_GAPS) {
      const f = mythic(6);
      const h = round(f);
      const p = third(f);
      const knot = carry(f, p);
      f.put(p, -10, 190);
      f.tick();
      f.sim.interact(p.id);
      const away = f.tick(1);
      expect(away.some((e) => e.type === 'error' && e.text === KNOT_NOT_AT_LIP_ERROR)).toBe(true);
      expect(h.knots).toContain(knot);
      const spot = lip(g);
      f.put(p, spot.x, spot.z);
      f.sim.interact(p.id);
      const evs = f.tick(1);
      expect(evs.some((e) => e.type === 'spellfxAt' && e.ability === BREATH_CUES.knotThrow)).toBe(
        true,
      );
      // The last ball gone ends the round: no ball, no portals, no load, no burst.
      expect(f.state()?.heart).toBeNull();
      expect(has(p, BREATH_AURAS.laden)).toBe(false);
      expect(f.objects(BREATH_OBJECTS.knotPrefix)).toHaveLength(0);
      expect(f.objects(BREATH_OBJECTS.portalA)).toHaveLength(0);
      f.tick(ticks(T.heartFuse));
      expect(f.players.filter((e) => e.dead)).toHaveLength(0);
    }
  });

  it('a stunned carrier cannot throw; an interact press with no load stays ordinary', () => {
    const f = mythic();
    round(f);
    const p = third(f);
    carry(f, p);
    const spot = lip(CORNICE_GAPS[1]);
    f.put(p, spot.x, spot.z);
    p.auras.push({ ...p.auras[0], id: 'st', kind: 'stun', remaining: 3, duration: 3 });
    f.sim.interact(p.id);
    f.tick(1);
    expect(f.state()?.heart).not.toBeNull();
    p.auras = p.auras.filter((a) => a.id !== 'st');
  });

  it('a dead carrier drops it where they fell, still ticking, free to all but the marked', () => {
    const f = mythic();
    const h = round(f);
    const p = third(f);
    const knot = carry(f, p);
    f.put(p, 0, 190);
    f.tick(2);
    const fell = f.local(p);
    const fuse = knot.fuse;
    f.sim.ctx.handleDeath(p, null, 'Test');
    f.tick(1);
    expect(knot.carrierId).toBeNull();
    expect(Math.hypot(knot.x - fell.x, knot.z - fell.z)).toBeLessThan(0.5);
    expect(knot.fuse).toBeLessThan(fuse);
    expect(knotOf(entity(f, knot.objectId).templateId)?.state).toBe('free');
    const marked = entity(f, h.bearers[0]);
    f.put(marked, knot.x, knot.z);
    f.tick(2);
    expect(knot.carrierId).toBeNull();
    f.put(marked, -10, 190);
    carry(f, third(f));
  });

  it('a body that goes over a lip with it counts as thrown', () => {
    const f = mythic();
    round(f);
    const p = third(f);
    carry(f, p);
    const g = CORNICE_GAPS[0];
    const spot = lip(g);
    f.put(p, spot.x, spot.z);
    f.tick(1);
    fallOver(f, p, g);
    const evs = f.tick(1);
    expect(evs.some((e) => e.type === 'spellfxAt' && e.ability === BREATH_CUES.knotThrow)).toBe(
      true,
    );
    expect(f.state()?.heart).toBeNull();
  });

  it('a Thessaly anchor does not stop a walk through a portal', () => {
    const f = mythic();
    const h = round(f);
    const p = third(f);
    carry(f, p);
    f.tick(ticks(T.heartMark));
    p.auras.push({ ...p.auras[0], id: BREATH_AURAS.anchor, kind: 'internal_cd' });
    const A = h.portalA as NonNullable<typeof h.portalA>;
    const B = h.portalB as NonNullable<typeof h.portalB>;
    f.put(p, A.x, A.z);
    f.tick(1);
    expect(Math.hypot(f.local(p).x - B.x, f.local(p).z - B.z)).toBeLessThan(0.5);
  });

  it('the fight marks nobody already in the round; the round marks nobody already marked', () => {
    const f = mythic();
    const st = f.state();
    const h = round(f);
    const p = third(f);
    carry(f, p);
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast) + ticks(T.barrageSeconds) + 4);
    f.dev('/dev heart breath conductor');
    const marked = st?.drawn?.playerId ?? st?.bar?.targetId;
    if (marked !== undefined && marked !== null) {
      expect(marked).not.toBe(p.id);
      expect(h.bearers).not.toContain(marked);
    }
  });
});

describe('Knotted Gale: when', () => {
  it('starts on its clock in phase 1, at most three times', () => {
    const f = breathFight(6);
    f.dev('/dev heart breath pull');
    f.dev('/dev heart breath mythic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.heart).toBeNull();
    f.tick(ticks(T.heartFirst) - 2);
    expect(st.heart).toBeNull();
    f.tick(4);
    expect(st.heart).not.toBeNull();
    expect(st.heart?.knots).toHaveLength(1);
    expect(st.heartRuns).toBe(1);
    // The third was the last of phase 1.
    const f2 = mythic();
    const st2 = f2.state();
    if (!st2) throw new Error('no fight');
    st2.heartRuns = T.heartWindRuns;
    st2.heartTimer = 0;
    f2.tick(10);
    expect(st2.heart).toBeNull();
  });

  it('never starts into the indrawn breath, nor a fuse short of it', () => {
    const f = mythic();
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.inhaleTimer = T.heartFuse - 1;
    st.heartTimer = 0;
    f.tick(10);
    expect(st.heart).toBeNull();
    st.inhaleTimer = 999;
    f.dev('/dev heart breath inhale');
    expect(st.wind.phase).toBe('inhale');
    st.heartTimer = 0;
    f.tick(ticks(2));
    expect(st.heart).toBeNull();
    // Once it has passed, the wait ends.
    f.tick(ticks(T.inhaleCast + T.gustCast + T.barGap + 1));
    expect(st.wind.phase).not.toBe('inhale');
    expect(st.wind.phase).not.toBe('exhale');
    expect(st.heart).not.toBeNull();
  });

  it('phase 2: two balls apart, one pair of portals, never during the barrage', () => {
    const f = mythic();
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast) + 2);
    expect(st.half).toBe('storm');
    expect(st.barrage).not.toBeNull();
    f.tick(ticks(T.barrageSeconds) - 4);
    expect(st.heart).toBeNull();
    f.tick(ticks(T.heartStormFirst) - 2);
    expect(st.heart).toBeNull();
    f.tick(20);
    const h = st.heart;
    if (!h) throw new Error('no round');
    expect(h.knots).toHaveLength(2);
    const [k1, k2] = h.knots;
    expect(Math.hypot(k1.x - k2.x, k1.z - k2.z)).toBeGreaterThanOrEqual(T.heartApart - 15);
    // Two carriers, one A: both cross by the same pair, and only both thrown ends it.
    const c1 = third(f);
    carry(f, c1, 0);
    const c2 = third(f);
    carry(f, c2, 1);
    f.tick(ticks(T.heartMark));
    expect(f.objects(BREATH_OBJECTS.portalA)).toHaveLength(1);
    expect(f.objects(BREATH_OBJECTS.portalB)).toHaveLength(1);
    const spot = lip(CORNICE_GAPS[0]);
    f.put(c1, spot.x, spot.z);
    f.sim.interact(c1.id);
    f.tick(1);
    expect(st.heart?.knots).toHaveLength(1);
    expect(f.objects(BREATH_OBJECTS.portalA)).toHaveLength(1);
    f.put(c2, spot.x, spot.z);
    f.sim.interact(c2.id);
    f.tick(1);
    expect(st.heart).toBeNull();
    expect(st.heartTimer).toBeGreaterThan(T.heartStormEvery - T.heartFuse - 5);
  });

  it('a wipe or reset clears everything; the next pull starts clean', () => {
    const f = mythic();
    const h = round(f, ' 2');
    const p = third(f);
    carry(f, p);
    f.tick(ticks(T.heartMark));
    expect(h.portalA).not.toBeNull();
    f.dev('/dev heart breath reset');
    expect(f.state()).toBeNull();
    f.tick(1);
    expect(f.state()?.heart ?? null).toBeNull();
    expect(f.objects(BREATH_OBJECTS.knotPrefix)).toHaveLength(0);
    expect(f.objects(BREATH_OBJECTS.portalA)).toHaveLength(0);
    expect(f.objects(BREATH_OBJECTS.portalB)).toHaveLength(0);
    for (const e of f.players) {
      expect(has(e, BREATH_AURAS.laden)).toBe(false);
      expect(has(e, BREATH_AURAS.portalA)).toBe(false);
      expect(has(e, BREATH_AURAS.portalB)).toBe(false);
    }
  });

  it('is deterministic: the same seed, the same balls and marks', () => {
    const trace = () => {
      const f = mythic(6, 41);
      const h = round(f, ' 2');
      f.tick(ticks(T.heartMark) + 1);
      return JSON.stringify({
        k: h.knots.map((k) => [k.x, k.z, k.fuse]),
        b: h.bearers,
        a: h.portalA,
        c: h.portalB,
      });
    };
    expect(trace()).toBe(trace());
  });

  it('dev: alone the round still plays (a lone mark, B at the lip, the forced steps)', () => {
    const f = mythic(1);
    const h = round(f);
    const me = f.players[0];
    expect(h.markA).toBe(me.id);
    expect(h.markB).toBeNull();
    f.tick(ticks(T.heartMark) + 1);
    expect(h.portalA).not.toBeNull();
    expect(atGapLip(h.portalB?.x ?? 0, h.portalB?.z ?? 0)).toBe(true);
    // Alone, a marked player may carry.
    carry(f, me);
    f.dev('/dev heart breath reset');
    f.dev('/dev heart breath pull');
    f.dev('/dev heart breath heart');
    const st = f.state();
    expect(st?.difficulty).toBe('mythic');
    const h2 = st?.heart;
    if (!h2 || !st) throw new Error('no round');
    st.inhaleTimer = 999;
    f.put(me, -10, 190);
    f.tick(1);
    f.dev('/dev heart breath heart portal a');
    expect(h2.portalA).not.toBeNull();
    expect(h2.markA).toBeNull();
    const spot = lip(CORNICE_GAPS[0]);
    f.put(me, spot.x, spot.z);
    f.tick(1);
    f.dev('/dev heart breath heart portal b');
    expect(h2.portalB).not.toBeNull();
    f.dev('/dev heart breath heart carry');
    expect(h2.knots[0].carrierId).toBe(me.id);
    f.dev('/dev heart breath heart burst');
    me.maxHp = 50000;
    f.tick(2, false);
    expect(me.dead).toBe(true);
    expect(startHeart).toBeTypeOf('function');
    expect(heartDevTrigger).toBeTypeOf('function');
  });
});

describe('Knotted Gale: the player text', () => {
  it('names, warnings, hop and error all resolve through the catalog', () => {
    for (const n of [BREATH_NAMES.knot, BREATH_NAMES.laden, BREATH_NAMES.portalA])
      expect(localizeSimAuraName(n)).toBe(n);
    expect(localizeSimText(KNOT_HOP_TEXT)).toBe(KNOT_HOP_TEXT);
    expect(localizeSimText(KNOT_NOT_AT_LIP_ERROR)).toBe(KNOT_NOT_AT_LIP_ERROR);
    const f = mythic();
    const h = round(f);
    const p = third(f);
    carry(f, p);
    const spot = lip(CORNICE_GAPS[0]);
    f.put(p, spot.x, spot.z);
    f.sim.interact(p.id);
    const evs = f.tick(1);
    const warns = evs.filter((e) => e.type === 'chat' && e.channel === 'raidWarning');
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns)
      if (w.type === 'chat') expect(t(w.textKey as never, w.textValues)).toBe(w.text);
    expect(h).toBeDefined();
  });

  it('each aura says its rule; the load with the live walk', () => {
    for (const id of [BREATH_AURAS.portalA, BREATH_AURAS.portalB, BREATH_AURAS.laden]) {
      const d = auraEffectDescriptor({ id, kind: 'internal_cd', value: T.heartWalkMult });
      const text = t(d?.key as never, d?.nums as never);
      expect(text).not.toMatch(/\{\w+\}/);
      if (id === BREATH_AURAS.laden) expect(text).toContain(`${T.heartWalkMult * 100}%`);
    }
  });

  it('the alert tells each role its job, and the carrier the throw', () => {
    const base = { pos: { x: 0, z: 0 }, interactKey: 'F', touch: false };
    expect(buildKnotAlertView({ ...base, auras: [] }).visible).toBe(false);
    const a = buildKnotAlertView({
      ...base,
      auras: [{ id: BREATH_AURAS.portalA, remaining: 2.5, duration: 5 }],
    });
    expect(a.visible && a.kind === 'portalA' && a.progress === 0.5 && !a.pressable).toBe(true);
    const b = buildKnotAlertView({
      ...base,
      auras: [{ id: BREATH_AURAS.portalB, remaining: 2.5, duration: 5 }],
    });
    expect(b.visible && b.kind === 'portalB').toBe(true);
    const c = buildKnotAlertView({
      ...base,
      auras: [{ id: BREATH_AURAS.laden, remaining: 10, duration: 20 }],
    });
    expect(c.visible && c.kind === 'carry' && c.pressable && c.key === 'F').toBe(true);
    expect(
      buildKnotAlertView({
        ...base,
        dead: true,
        auras: [{ id: BREATH_AURAS.laden, remaining: 10, duration: 20 }],
      }).visible,
    ).toBe(false);
  });
});

// Jose's playtest (2026-11-02): every ball fell beside Thessaly, every circle in
// the same place, the throw press never left the client (he walked into the void
// instead), and the wind at a carrier's back did nothing for them.
describe("Knotted Gale: Jose's playtest of 2026-11-02", () => {
  it('no round drops a ball where the last one fell, and the drops reach past the climb', () => {
    const f = mythic();
    const spots: { x: number; z: number }[] = [];
    let last: { x: number; z: number }[] = [];
    for (let r = 0; r < 6; r++) {
      const h = round(f, r % 2 === 0 ? '' : ' 2');
      const now = h.knots.map((k) => ({ x: k.x, z: k.z }));
      for (const k of now) {
        expect(gapDistance(k.x, k.z)).toBeGreaterThanOrEqual(T.heartFar);
        for (const o of last)
          expect(Math.hypot(k.x - o.x, k.z - o.z)).toBeGreaterThanOrEqual(T.heartApart);
      }
      if (now.length === 2)
        expect(Math.hypot(now[0].x - now[1].x, now[0].z - now[1].z)).toBeGreaterThanOrEqual(
          T.heartApart,
        );
      spots.push(...now);
      last = now;
    }
    // Not all at Thessaly's post (the old bar left only that patch).
    expect(spots.some((k) => Math.hypot(k.x - -56, k.z - 194.4) > 25)).toBe(true);
  });

  it('a ball never drops on the live circle of calm', () => {
    const f = mythic();
    f.dev('/dev heart breath circle');
    const calm = f.state()?.calm;
    if (!calm) throw new Error('no circle');
    for (let r = 0; r < 4; r++) {
      const h = round(f);
      for (const k of h.knots)
        expect(Math.hypot(k.x - calm.x, k.z - calm.z)).toBeGreaterThanOrEqual(T.heartApart);
    }
  });

  it('the wind at the carrier back quickens the load; facing into it, or no wind, does not', () => {
    const f = mythic();
    round(f);
    const p = third(f);
    const free = moveSpeedMult({ ...p, auras: p.auras.filter((a) => a.id !== BREATH_AURAS.laden) });
    carry(f, p);
    const load = () => p.auras.find((a) => a.id === BREATH_AURAS.laden)?.value;
    // Bearing 90 blows east: heading (sin, cos) = (1, 0), a facing of pi/2.
    f.dev('/dev heart breath blow 90');
    p.facing = Math.PI / 2 + 0.5;
    f.tick(2);
    expect(load()).toBe(T.heartTailMult);
    expect(moveSpeedMult(p)).toBeCloseTo(free * T.heartTailMult, 5);
    expect(has(p, WIND_DRIFT_AURA)).toBe(false);
    p.facing = -Math.PI / 2;
    f.tick(2);
    expect(load()).toBe(T.heartWalkMult);
    p.facing = Math.PI;
    f.tick(2);
    expect(load()).toBe(T.heartWalkMult);
    f.dev('/dev heart breath calm');
    p.facing = Math.PI / 2;
    f.tick(2);
    expect(load()).toBe(T.heartWalkMult);
  });
});

describe("Captain Thessaly's circle: Jose's playtest of 2026-11-02", () => {
  it('lands somewhere new each time, whole on the floor and clear of the gaps', () => {
    const f = breathFight(4);
    f.dev('/dev heart breath pull');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.circleTimer = 999;
    const seen: { x: number; z: number }[] = [];
    for (let i = 0; i < 8; i++) {
      f.dev('/dev heart breath circle');
      const c = st.calm;
      if (!c) throw new Error('no circle');
      expect(circleClear(c.x, c.z, T.circleR)).toBe(true);
      const prev = seen[seen.length - 1];
      if (prev)
        expect(Math.hypot(c.x - prev.x, c.z - prev.z)).toBeGreaterThanOrEqual(T.circleApart);
      seen.push({ x: c.x, z: c.z });
      f.tick(ticks(3) + i);
    }
    // More than one distance from the guardian: not one fixed reach.
    const g = f.local(f.boss());
    const reaches = new Set(seen.map((c) => Math.round(Math.hypot(c.x - g.x, c.z - g.z) / 4)));
    expect(reaches.size).toBeGreaterThan(1);
  });
});

describe('the interact key while carrying a Knotted Gale', () => {
  it('sends the throw press straight to the world, never a scan of the room', () => {
    let presses = 0;
    let scanned = false;
    const world = {
      player: { auras: [{ id: BREATH_AURAS.laden, sourceId: 7 }] },
      interact: () => {
        presses++;
      },
      get entities() {
        scanned = true;
        return new Map();
      },
    } as unknown as NearbyInteractionWorld;
    const hud = { showError: () => {} } as unknown as NearbyInteractionHud;
    expect(tryNearbyInteraction(world, hud, 'away', 'nothing')).toBe(true);
    expect(presses).toBe(1);
    expect(scanned).toBe(false);
  });
});
