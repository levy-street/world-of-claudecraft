// The Guardian of the Heat (docs/design/raid/smith_heart.md section 7.4),
// "the well of the first flame", over a REAL Sim: the guardian half sunk in
// its wellspring and its Cinder Grip on the tank, Basalt Fist and its Molten
// Swells, Hearth Flare, the overflows at 70 and 40 percent (normal without
// adds; heroic's Wellspawn walking, slowing, feeding; the Wellkeepers' trails
// healing them), the Hearthseeds and their Seedflames, Wakefire's bands,
// the Rolling Cinders (the hunt, the knockback and its crust), no fourth
// phase on any difficulty (it never leaves the wellspring),
// the wipe, the fall lighting the Heat vein, and determinism.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_GUARDIANS, SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  beyondFlare,
  FIST_SPAN,
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  HEAT_STAGES,
  heatTimed,
  heatTimedOf,
  inBand,
  inHearthFloor,
  inLane,
  inWave,
  inWell,
  phaseFloor,
  SHORE_POINTS,
  seedFalloff,
  smithHeartProgress,
  smithHeartVeinWon,
  spawnPace,
  swellBearings,
  swellLaneOf,
  swellLaneTemplate,
  HEAT_TUNING as T,
  WELLSPAWN_SPOTS,
  wakefireHoldsFist,
  wellDistance,
  wellOf,
  wellTemplate,
  zoneOf,
  zoneTemplate,
} from '../src/sim/encounters/smith_heart';
import { DT, type Entity, RUN_SPEED, type SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { HEAT_WAIT_SPOTS, type HeatFight, heatFight } from './helpers/heat_fight';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const ticks = (s: number) => Math.round(s / DT);

/** Hold every clock of the fight's own (a test that wants one asks). */
function hold(f: HeatFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.fistTimer = 999;
  st.flareTimer = 999;
  st.seedTimer = 999;
  st.zoneTimer = 999;
  st.cinderTimer = 999;
}

/** A pulled fight with its clocks held, the first player its tank (far
 *  ahead on its threat). */
function pulled(n = 5, seed = 31, heroic = false): HeatFight {
  const f = heatFight(n, seed);
  if (heroic) f.dev('/dev heart heat heroic');
  expect(f.dev('/dev heart heat pull')).toBe(true);
  f.boss().threat.set(f.players[0].id, 1e6);
  f.tick(2);
  hold(f);
  return f;
}

function until(f: HeatFight, pred: () => boolean, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 20 && !pred(); i++) out.push(...f.tick(1));
  return out;
}

const cues = (ev: readonly SimEvent[], ability: string) =>
  ev.filter(
    (e) =>
      (e.type === 'spellfx' || e.type === 'spellfxAt') &&
      (e as { ability?: string }).ability === ability,
  );

const chatKeys = (ev: readonly SimEvent[]) =>
  ev
    .filter((e) => e.type === 'chat')
    .map((e) => (e as { textKey?: string }).textKey ?? '')
    .filter((k) => k.startsWith('hudChrome.heatGuardian.'));

/** The adds of a template in the claim (alive). */
function adds(f: HeatFight, templateId: string): Entity[] {
  return f.inst.mobIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId && !e.dead);
}

/** Put the guardian's health at `frac` of its pool. */
function setHp(f: HeatFight, frac: number): void {
  const b = f.boss();
  b.hp = Math.max(1, Math.floor(b.maxHp * frac));
}

describe('Guardian of the Heat: the ids and the geometry', () => {
  it('round-trips every object template', () => {
    expect(heatTimedOf(HEAT_OBJECTS.seedPrefix, heatTimed(HEAT_OBJECTS.seedPrefix, 10))).toBe(10);
    expect(heatTimedOf(HEAT_OBJECTS.fallPrefix, 'sh_heat_seed_4')).toBeNull();
    expect(swellLaneOf(swellLaneTemplate('roll', 3.2))).toEqual({ state: 'roll', seconds: 3.2 });
    expect(swellLaneOf('sh_heat_lane_x_1')).toBeNull();
    expect(wellOf(wellTemplate('over'))).toBe('over');
    expect(wellOf('sh_heat_well_torn')).toBeNull();
    expect(zoneOf(zoneTemplate(2, 'burn', 2))).toEqual({ band: 2, state: 'burn', seconds: 2 });
    expect(zoneOf('sh_heat_zone_3_warn_4')).toBeNull();
  });

  it('holds each threshold, crawls the Wellspawn from half health, and falls the seeds off', () => {
    expect(phaseFloor(1)).toBe(T.overflowOneAt);
    expect(phaseFloor(2)).toBe(T.overflowTwoAt);
    expect(phaseFloor(3)).toBeNull();
    expect(spawnPace(1)).toBeCloseTo(1, 9);
    expect(spawnPace(0.75)).toBeGreaterThan(spawnPace(0.6));
    expect(spawnPace(0.5)).toBeCloseTo(T.spawnMinFactor, 9);
    expect(spawnPace(0.1)).toBeCloseTo(T.spawnMinFactor, 9);
    expect(seedFalloff(0)).toBe(T.seedMax);
    expect(seedFalloff(11)).toBeCloseTo(T.seedMax / 4, 6);
    expect(seedFalloff(T.seedReach)).toBe(0);
  });

  it('knows the wellspring, the reach, the bands, the lanes and the waves', () => {
    expect(inWell(HEARTH_WELL.x + HEARTH_WELL.r - 0.1, 0)).toBe(true);
    expect(inWell(HEARTH_WELL.x + HEARTH_WELL.r + 0.1, 0)).toBe(false);
    expect(beyondFlare(HEARTH_WELL.x + T.flareReach - 0.1, 0)).toBe(false);
    expect(beyondFlare(HEARTH_WELL.x + T.flareReach + 0.1, 0)).toBe(true);
    const R = HEARTH_WELL.r;
    expect(inBand(0, HEARTH_WELL.x + R + 2, 0)).toBe(true);
    expect(inBand(1, HEARTH_WELL.x + R + 12, 0)).toBe(true);
    expect(inBand(2, HEARTH_WELL.x + R + 30, 0)).toBe(true);
    expect(inBand(0, HEARTH_WELL.x + R + 12, 0)).toBe(false);
    // The swells: away from the wellspring first, then either side.
    const spot = { x: HEARTH_WELL.x + 15, z: 0 };
    const [away, left, right] = swellBearings(spot);
    expect(away).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(left - away)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(right - away)).toBeCloseTo(Math.PI / 2, 9);
    const h = T.laneHalf;
    expect(inLane(spot.x, 0, away, T.laneLength, h, spot.x + 10, h - 0.1)).toBe(true);
    expect(inLane(spot.x, 0, away, T.laneLength, h, spot.x + 10, h + 0.1)).toBe(false);
    expect(inLane(spot.x, 0, away, T.laneLength, h, spot.x - 2, 0)).toBe(false);
    // A wave's wall: its front and waveDepth behind it, the lane's width.
    expect(inWave(spot.x, 0, away, 20, spot.x + 19, 0)).toBe(true);
    expect(inWave(spot.x, 0, away, 20, spot.x + 20 - T.waveDepth + 0.1, h - 0.1)).toBe(true);
    expect(inWave(spot.x, 0, away, 20, spot.x + 20 - T.waveDepth - 0.1, 0)).toBe(false);
    expect(inWave(spot.x, 0, away, 20, spot.x + 21, 0)).toBe(false);
    expect(inWave(spot.x, 0, away, 20, spot.x + 18, h + 0.1)).toBe(false);
    // A wave just out of the spot never strikes back past it.
    expect(inWave(spot.x, 0, away, 0.5, spot.x + 0.2, 0)).toBe(true);
    expect(inWave(spot.x, 0, away, 0.5, spot.x - 4, 5)).toBe(false);
    for (const p of [...SHORE_POINTS, ...WELLSPAWN_SPOTS, ...HEAT_WAIT_SPOTS])
      expect(inHearthFloor(p.x, p.z)).toBe(true);
    expect(SHORE_POINTS.length).toBeGreaterThan(40);
    for (const p of HEAT_WAIT_SPOTS) {
      expect(beyondFlare(p.x, p.z)).toBe(false);
      expect(inWell(p.x, p.z)).toBe(false);
    }
  });
});

describe('Guardian of the Heat: the pass-5 Molten Swells (wider, deeper, still fair)', () => {
  it('rolls an 11 yd wide wall 5 yd deep (2.5 and 2.5 before the owner grew it)', () => {
    expect(T.laneHalf * 2).toBe(11);
    expect(T.waveDepth).toBe(5);
  });

  it('lets a player in the middle of a lane run out of it well inside the warning', () => {
    // The lanes show with the fist's 3 s bar and the wave rolls 0.6 s later:
    // at run speed the lane's middle to past its edge takes under a second.
    const warning = T.fistCast + T.waveDelay;
    const runOut = (T.laneHalf + 0.5) / RUN_SPEED;
    expect(runOut).toBeLessThan(1);
    expect(runOut * 3).toBeLessThan(warning);
    // The fist's own target, at the spot itself, reaches a gap (clear of the
    // fist's radius and both lanes it stands between) inside the bar.
    const gap = Math.max(T.fistR, Math.hypot(T.laneHalf, T.laneHalf)) + 0.5;
    expect(gap / RUN_SPEED).toBeLessThan(T.fistCast * 0.6);
  });

  it('never covers the room: wherever the fist lands most of the floor and the melee ring stay clear', () => {
    for (const out of [1.5, 6, 14]) {
      for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const a = (deg * Math.PI) / 180;
        const spot = {
          x: HEARTH_WELL.x + Math.sin(a) * (HEARTH_WELL.r + out),
          z: HEARTH_WELL.z + Math.cos(a) * (HEARTH_WELL.r + out),
        };
        if (!inHearthFloor(spot.x, spot.z)) continue;
        const lanes = swellBearings(spot);
        const struck = (x: number, z: number) =>
          Math.hypot(x - spot.x, z - spot.z) <= T.fistR ||
          lanes.some((b) => inLane(spot.x, spot.z, b, T.laneLength, T.laneHalf, x, z));
        let floor = 0;
        let hit = 0;
        for (let x = -262; x <= -170; x += 1)
          for (let z = -50; z <= 50; z += 1) {
            if (!inHearthFloor(x, z) || wellDistance(x, z) < HEARTH_WELL.r) continue;
            floor++;
            if (struck(x, z)) hit++;
          }
        expect(hit / floor).toBeLessThan(0.25);
        // The melee ring (the lip to 3 yd out): at least half of it is clear.
        let ring = 0;
        let ringHit = 0;
        for (let k = 0; k < 360; k++) {
          const r = (k * Math.PI) / 180;
          const x = HEARTH_WELL.x + Math.sin(r) * (HEARTH_WELL.r + 1.5);
          const z = HEARTH_WELL.z + Math.cos(r) * (HEARTH_WELL.r + 1.5);
          if (!inHearthFloor(x, z)) continue;
          ring++;
          if (struck(x, z)) ringHit++;
        }
        expect(ringHit / ring).toBeLessThan(0.5);
      }
    }
  });
});

describe('Guardian of the Heat: the pass-5 wall in a live fight', () => {
  it('strikes 4.5 yd across the lane and 4.5 yd behind the front, not 6 across', () => {
    const f = pulled(5);
    const [, victim, across45, across6, behind] = f.players;
    const spot = { x: HEARTH_WELL.x + 16, z: 0 };
    f.put(victim, spot.x, spot.z);
    expect(f.dev('/dev heart heat fist', victim.id)).toBe(true);
    // Down the lane away from the wellspring (+x), 14 yd out (clear of the
    // side lanes, which cover 5.5 yd either side of the spot's line).
    f.put(across45, spot.x + 14, 4.5);
    f.put(across6, spot.x + 14, -6);
    f.tick(ticks(T.fistCast + T.waveDelay + 0.05));
    // Half a yard behind where the front will be when it is 14.2 yd out,
    // the wall 5 yd deep reaches back over it as it passes.
    let roll: SimEvent[] = [];
    for (let i = 0; i < ticks(1.4); i++) roll = roll.concat(f.tick(1));
    // The front is about 14.5 yd out: step the one behind into the wall's
    // back (4.5 yd behind the front, the wall 5 deep), not its front.
    const front = f.objects(HEAT_OBJECTS.wave).find((w) => Math.abs(w.facing - Math.PI / 2) < 0.01);
    expect(front).toBeTruthy();
    const o = f.world(spot.x, 0);
    const out = (front?.pos.x ?? 0) - o.x;
    f.put(behind, spot.x + out - 4.5, 0.5);
    const last = f.tick(1);
    roll = roll.concat(last);
    expect(hitsOf(roll, HEAT_NAMES.swell, across45.id).length).toBe(1);
    expect(hitsOf(roll, HEAT_NAMES.swell, across6.id)).toEqual([]);
    expect(hitsOf(last, HEAT_NAMES.swell, behind.id).length).toBe(1);
  });
});

describe('Guardian of the Heat: the guardian', () => {
  it('stands half sunk in its wellspring and never steps out of it', () => {
    const t = SMITH_HEART_MOBS[SMITH_HEART_GUARDIANS.heat];
    expect(t.trashKit).toBeUndefined();
    expect(t.bodyRadius).toBe(HEARTH_WELL.r);
    expect(t.stackPoison?.name).toBe(HEAT_NAMES.grip);
    const f = pulled();
    const o = f.world(HEARTH_WELL.x, HEARTH_WELL.z);
    // The tank backs off: the guardian stays in the wellspring.
    f.put(f.players[0], -205, 0);
    f.tick(ticks(4));
    expect(f.boss().pos.x).toBeCloseTo(o.x, 6);
    expect(f.boss().pos.z).toBeCloseTo(o.z, 6);
    const st = aura(f.boss(), HEAT_AURAS.state);
    expect(st?.value).toBe(1);
    expect(st?.value2).toBe(HEAT_STAGES.fight);
    expect(f.objects(HEAT_OBJECTS.wellPrefix).map((e) => e.templateId)).toEqual([
      wellTemplate('calm'),
    ]);
  });

  it('Cinder Grip stacks on its tank with every landed swing', () => {
    const f = pulled(2);
    const tank = f.players[0];
    f.put(tank, HEARTH_WELL.x + HEARTH_WELL.r + 0.5, 0);
    f.tick(ticks(14));
    const grip = aura(tank, HEAT_AURAS.grip);
    expect(grip?.name).toBe(HEAT_NAMES.grip);
    expect(grip?.stacks ?? 0).toBeGreaterThanOrEqual(3);
    expect(has(f.players[1], HEAT_AURAS.grip)).toBe(false);
  });
});

describe('Guardian of the Heat: phase 1', () => {
  it('Basalt Fist shows its spot and three lanes, slams the spot, then three swells roll out', () => {
    const f = pulled(4);
    const [, victim, inLaneP, inGap] = f.players;
    const spot = { x: HEARTH_WELL.x + 16, z: 0 };
    f.put(victim, spot.x, spot.z);
    expect(f.dev('/dev heart heat fist', victim.id)).toBe(true);
    expect(f.objects(HEAT_OBJECTS.fistPrefix).length).toBe(1);
    const lanes = f.objects(HEAT_OBJECTS.lanePrefix);
    expect(lanes.length).toBe(3);
    for (const l of lanes) expect(swellLaneOf(l.templateId)?.state).toBe('warn');
    expect(f.boss().castingAbility).toBe(HEAT_CASTS.fist);
    // One stands down the lane away from the wellspring, one in a gap.
    f.put(inLaneP, spot.x + 14, 0.5);
    f.put(inGap, spot.x + 10, 10);
    const ev = f.tick(ticks(T.fistCast + 0.2));
    const slam = hitsOf(ev, HEAT_NAMES.fist, victim.id);
    expect(slam.length).toBe(1);
    expect(slam[0]).toBeGreaterThanOrEqual(T.fistMin);
    expect(hitsOf(ev, HEAT_NAMES.fist, inLaneP.id)).toEqual([]);
    expect(cues(ev, HEAT_CUES.fist).length).toBe(1);
    const roll = f.tick(ticks(5));
    expect(hitsOf(roll, HEAT_NAMES.swell, inLaneP.id).length).toBe(1);
    expect(hitsOf(roll, HEAT_NAMES.swell, inGap.id)).toEqual([]);
    expect(cues(roll, HEAT_CUES.swell).length).toBe(3);
    // Rolled out: every lane and wave gone.
    f.tick(ticks(1));
    expect(f.objects(HEAT_OBJECTS.lanePrefix)).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.wave)).toEqual([]);
  });

  it('Hearth Flare strikes only those out of reach, and scorches them', () => {
    const f = pulled(3);
    const [, near, far] = f.players;
    f.put(far, HEARTH_WELL.x + T.flareReach + 6, 0);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.flareTimer = 0.05;
    const ev = f.tick(2);
    expect(hitsOf(ev, HEAT_NAMES.flare, far.id).length).toBe(1);
    expect(hitsOf(ev, HEAT_NAMES.flare, near.id)).toEqual([]);
    expect(aura(far, HEAT_AURAS.scorched)?.kind).toBe('spellvuln');
    expect(has(near, HEAT_AURAS.scorched)).toBe(false);
  });

  it('through phases 2 and 3 it flares only its own target, and only when out of reach', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 2');
    hold(f);
    const [tank, , far] = f.players;
    f.put(far, HEARTH_WELL.x + T.flareReach + 6, 0);
    f.put(tank, HEARTH_WELL.x + T.flareReach + 6, 6);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.flareTimer = 0.05;
    const ev = f.tick(2);
    expect(f.boss().aggroTargetId).toBe(tank.id);
    expect(hitsOf(ev, HEAT_NAMES.flare, tank.id).length).toBe(1);
    expect(hitsOf(ev, HEAT_NAMES.flare, far.id)).toEqual([]);
  });

  it('the wellspring burns whoever steps into it', () => {
    const f = pulled(2);
    const p = f.players[1];
    f.put(p, HEARTH_WELL.x + 3, 1);
    const ev = f.tick(ticks(1.1));
    expect(hitsOf(ev, HEAT_NAMES.wellFire, p.id).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Guardian of the Heat: the overflows', () => {
  it('normal: holds at 70 percent, sinks out of reach, overflows 20 s with no adds, rises into phase 2', () => {
    const f = pulled(4);
    const b = f.boss();
    // A burst cannot skip the threshold.
    f.sim.ctx.dealDamage(f.players[0], b, b.maxHp, false, 'physical', 'test', 'hit');
    expect(b.hp).toBe(Math.ceil(b.maxHp * T.overflowOneAt));
    let ev = f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.stage).toBe('sinking');
    expect(b.hostile).toBe(false);
    expect(b.damageImmune).toBe(true);
    expect(cues(ev, HEAT_CUES.sink).length).toBe(1);
    expect(chatKeys(ev)).toContain('hudChrome.heatGuardian.say.sink');
    expect(f.objects(HEAT_OBJECTS.wellPrefix)[0].templateId).toBe(wellTemplate('over'));
    ev = f.tick(ticks(10));
    expect(st.stage).toBe('under');
    expect(adds(f, HEAT_MOBS.spawn)).toEqual([]);
    expect(cues(ev, HEAT_CUES.river).length).toBeGreaterThan(0);
    expect(cues(ev, HEAT_CUES.bolt).length).toBeGreaterThanOrEqual(HEAT_DIFFICULTY.normal.bolts);
    // The guardian itself takes nothing while under.
    const hp = b.hp;
    f.sim.ctx.dealDamage(f.players[0], b, 500, false, 'physical', 'test', 'hit');
    expect(b.hp).toBe(hp);
    until(f, () => st.phase === 2, 20);
    expect(st.phase).toBe(2);
    expect(st.stage).toBe('fight');
    expect(st.overflow).toBeNull();
    expect(b.hostile).toBe(true);
    expect(b.damageImmune).toBe(false);
    expect(st.clock).toBeGreaterThan(T.sinkSeconds + T.overflowSeconds + T.riseSeconds);
    expect(f.objects(HEAT_OBJECTS.riverPrefix)).toEqual([]);
    expect(b.damageFloorHp).toBe(Math.ceil(b.maxHp * T.overflowTwoAt));
  });

  it('a river strikes those on its lane while it flows', () => {
    const f = pulled(2);
    setHp(f, 0.69);
    f.tick(ticks(T.sinkSeconds + 0.1));
    const st = f.state();
    if (!st?.overflow) throw new Error('no overflow');
    // The next surge, and a player stood down its first river.
    st.overflow.riverIn = 0.05;
    f.tick(2);
    const r = st.overflow.rivers[0];
    const p = f.players[1];
    f.put(p, HEARTH_WELL.x + Math.sin(r.facing) * 14, HEARTH_WELL.z + Math.cos(r.facing) * 14);
    const ev = f.tick(ticks(T.riverWarn + 1));
    expect(hitsOf(ev, HEAT_NAMES.river, p.id).length).toBeGreaterThanOrEqual(1);
  });

  it('heroic: the Wellspawn walk to the wellspring, slowing as they lose health', () => {
    const f = pulled(3, 31, true);
    setHp(f, 0.69);
    f.tick(ticks(T.sinkSeconds + 0.2));
    const kids = adds(f, HEAT_MOBS.spawn);
    expect(kids.length).toBe(4);
    for (const k of kids) {
      expect(k.hostile).toBe(true);
      expect(k.inCombat).toBe(true);
    }
    const [whole, hurt] = kids;
    hurt.hp = Math.floor(hurt.maxHp * 0.5);
    const d0 = (e: Entity) => wellDistance(f.local(e).x, f.local(e).z);
    const w0 = d0(whole);
    const h0 = d0(hurt);
    f.tick(ticks(2));
    const wStep = w0 - d0(whole);
    const hStep = h0 - d0(hurt);
    expect(wStep).toBeCloseTo(T.spawnSpeed * 2, 0);
    expect(hStep).toBeGreaterThan(0);
    expect(hStep).toBeLessThan(wStep * 0.25);
    // A root holds one still.
    hurt.auras.push({
      id: 'test_root',
      name: 'Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: f.players[0].id,
      school: 'nature',
    });
    const h1 = d0(hurt);
    f.tick(ticks(1));
    expect(d0(hurt)).toBeCloseTo(h1, 6);
  });

  it('heroic: a Wellspawn that reaches the wellspring feeds the guardian and blasts the raid', () => {
    const f = pulled(3, 31, true);
    setHp(f, 0.69);
    f.tick(ticks(T.sinkSeconds + 0.2));
    const [kid] = adds(f, HEAT_MOBS.spawn);
    const b = f.boss();
    const before = b.hp;
    const at = f.world(HEARTH_WELL.x + T.spawnReach + 0.5, 0);
    kid.pos.x = at.x;
    kid.pos.z = at.z;
    const ev = f.tick(ticks(1));
    expect(f.state()?.feeds).toBe(1);
    expect(b.hp).toBeGreaterThan(before);
    for (const p of f.players) expect(hitsOf(ev, HEAT_NAMES.feed, p.id).length).toBe(1);
    expect(cues(ev, HEAT_CUES.feed).length).toBe(1);
    expect(f.sim.ctx.entities.has(kid.id)).toBe(false);
  });

  it('heroic: the overflow ends once the adds are dead (never before 8 s), or at 45 s', () => {
    const f = pulled(3, 31, true);
    setHp(f, 0.69);
    f.tick(ticks(T.sinkSeconds + 0.2));
    const st = f.state();
    if (!st) throw new Error('no fight');
    for (const k of adds(f, HEAT_MOBS.spawn)) f.sim.ctx.handleDeath(k, f.players[0]);
    f.tick(ticks(2));
    expect(st.stage).toBe('under');
    until(f, () => st.stage !== 'under', 10);
    expect(st.stage).toBe('rising');
    expect(st.overflow?.clock ?? 0).toBeGreaterThanOrEqual(T.overflowMin - 0.05);
    expect(st.overflow?.clock ?? 99).toBeLessThan(T.overflowMin + 0.5);

    // Left alone, the survivors dive in at the cap.
    const g = pulled(3, 31, true);
    setHp(g, 0.69);
    g.tick(ticks(T.sinkSeconds + 0.2));
    const kids = adds(g, HEAT_MOBS.spawn);
    for (const k of kids) {
      k.auras.push({
        id: 'test_stun',
        name: 'Stun',
        kind: 'stun',
        remaining: 999,
        duration: 999,
        value: 0,
        sourceId: g.players[0].id,
        school: 'physical',
      });
    }
    const gst = g.state();
    if (!gst) throw new Error('no fight');
    until(g, () => gst.stage !== 'under', T.overflowMax + 2);
    expect(gst.overflow?.clock ?? 0).toBeGreaterThanOrEqual(T.overflowMax - 0.05);
    expect(gst.feeds).toBe(kids.length);
  });

  it("heroic's second overflow: two Wellkeepers mark a player whose trail heals the Wellspawn", () => {
    const f = pulled(4, 31, true);
    f.dev('/dev heart heat phase 2');
    hold(f);
    setHp(f, 0.39);
    f.tick(ticks(T.sinkSeconds + 0.2));
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.overflow?.n).toBe(2);
    expect(adds(f, HEAT_MOBS.keeper).length).toBe(2);
    expect(adds(f, HEAT_MOBS.spawn).length).toBe(4);
    const ev = f.tick(ticks(T.markFirst + 0.2));
    const marked = f.players.filter((p) => has(p, HEAT_AURAS.kindling));
    expect(marked.length).toBeGreaterThanOrEqual(1);
    expect(cues(ev, HEAT_CUES.kindling).length).toBeGreaterThanOrEqual(1);
    const p = marked[0];
    f.tick(ticks(T.markSeconds + 0.1));
    expect(has(p, HEAT_AURAS.kindling)).toBe(false);
    expect(has(p, HEAT_AURAS.trail)).toBe(true);
    f.tick(ticks(1.5));
    const trails = f.objects(HEAT_OBJECTS.trailPrefix);
    expect(trails.length).toBeGreaterThanOrEqual(2);
    // A hurt Wellspawn set in a trail heals.
    const [kid] = adds(f, HEAT_MOBS.spawn);
    kid.hp = Math.floor(kid.maxHp * 0.4);
    const before = kid.hp;
    kid.auras.push({
      id: 'test_root',
      name: 'Root',
      kind: 'root',
      remaining: 9,
      duration: 9,
      value: 0,
      sourceId: f.players[0].id,
      school: 'nature',
    });
    const t0 = trails[0];
    kid.pos.x = t0.pos.x;
    kid.pos.z = t0.pos.z;
    f.tick(ticks(1));
    expect(kid.hp).toBeGreaterThan(before + kid.maxHp * T.trailHealPct * 0.8);
  });
});

describe('Guardian of the Heat: Basalt Fist waits out Wakefire', () => {
  it('holds a due fist while a run lays bands, a band warns or burns, or a run is near', () => {
    const quiet = { zoneRun: null, zones: [], zoneTimer: 30 };
    expect(wakefireHoldsFist(quiet, true)).toBe(false);
    expect(
      wakefireHoldsFist({ ...quiet, zoneRun: { order: [0, 1, 2], next: 1, stepIn: 1 } }, true),
    ).toBe(true);
    const band = { objectId: 1, band: 0, state: 'burn' as const, remaining: 1, tick: 0 };
    expect(wakefireHoldsFist({ ...quiet, zones: [band] }, true)).toBe(true);
    // The next run starting before its swells are done holds it too...
    expect(wakefireHoldsFist({ ...quiet, zoneTimer: FIST_SPAN - 0.1 }, true)).toBe(true);
    expect(wakefireHoldsFist({ ...quiet, zoneTimer: FIST_SPAN + 0.1 }, true)).toBe(false);
    // ...but not in a phase without Wakefire (its timer never runs there).
    expect(wakefireHoldsFist({ ...quiet, zoneTimer: 0 }, false)).toBe(false);
    // The swells' whole run: the bar, the delay, the lane and the wall.
    expect(FIST_SPAN).toBeCloseTo(
      T.fistCast + T.waveDelay + (T.laneLength + T.waveDepth) / T.waveSpeed,
      9,
    );
  });

  it('a due fist waits for the run to end, then comes at once', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 2');
    hold(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.zoneTimer = 0.01;
    st.fistTimer = 0.5;
    let begun = -1;
    for (let i = 0; i < ticks(20) && begun < 0; i++) {
      f.tick(1);
      for (const p of f.players) p.hp = p.maxHp;
      if (f.objects(HEAT_OBJECTS.fistPrefix).length > 0) {
        begun = i * DT;
        // Never while a band is on the floor or the run still lays them.
        expect(st.zones).toEqual([]);
        expect(st.zoneRun).toBeNull();
      }
    }
    // The run: three bands 2.5 s apart, each warning 4 s and burning 2.
    const run = 2 * T.zoneStep + T.zoneWarn + T.zoneBurn;
    expect(begun).toBeGreaterThan(run - 0.2);
    expect(begun).toBeLessThan(run + 0.5);
  });

  it('is never starved and keeps its 22 s rhythm round the runs (phases 2 and 3, Mythic too)', () => {
    const run = 2 * T.zoneStep + T.zoneWarn + T.zoneBurn;
    for (const [phase, tier] of [
      [2, ''],
      [3, ''],
      [2, 'mythic'],
    ] as const) {
      const f = pulled(3);
      if (tier) f.dev(`/dev heart heat ${tier}`);
      f.dev(`/dev heart heat phase ${phase}`);
      const st = f.state();
      if (!st) throw new Error('no fight');
      const starts: number[] = [];
      let had = false;
      const seconds = 240;
      for (let i = 0; i < ticks(seconds); i++) {
        // Only Wakefire (and Mythic's Wheel) and the fist run.
        st.seedTimer = 999;
        st.flareTimer = 999;
        st.cinderTimer = 999;
        f.tick(1);
        for (const p of f.players) p.hp = p.maxHp;
        f.boss().hp = f.boss().maxHp;
        const has = f.objects(HEAT_OBJECTS.fistPrefix).length > 0;
        if (has && !had) {
          starts.push(i * DT);
          expect(st.zones).toEqual([]);
          expect(st.zoneRun).toBeNull();
        }
        // No swell rolls while a band is on the floor.
        if (st.zones.length > 0) expect(st.swells).toEqual([]);
        had = has;
      }
      // The rhythm: about one every 22 s over the whole stretch (a flat
      // 34 s, one a run, would be 7).
      expect(starts.length).toBeGreaterThanOrEqual(Math.floor(seconds / T.fistEvery) - 1);
      for (let k = 1; k < starts.length; k++) {
        const gap = starts[k] - starts[k - 1];
        // Never starved: at most its cadence, a whole run and the lookahead.
        expect(gap).toBeLessThanOrEqual(T.fistEvery + run + FIST_SPAN + DT);
        // Never two on top of each other.
        expect(gap).toBeGreaterThanOrEqual(T.fistEvery / 2 - DT);
      }
    }
  });
});

describe('Guardian of the Heat: phase 2', () => {
  it('Hearthseeds fall under every player, throb 10 s, then burst less the farther away', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 2');
    hold(f);
    const [a, b2, c] = f.players;
    f.put(a, HEARTH_WELL.x + 12, -10);
    f.put(b2, HEARTH_WELL.x + 12, 10);
    f.put(c, HEARTH_WELL.x + 12, 0);
    f.dev('/dev heart heat seeds');
    expect(f.objects(HEAT_OBJECTS.seedPrefix).length).toBe(3);
    // Two run far, one stays on its seed.
    f.put(a, HEARTH_WELL.x + 40, -30);
    f.put(b2, HEARTH_WELL.x + 22, 8);
    const ev = f.tick(ticks(T.seedLife + 0.2));
    const stay = hitsOf(ev, HEAT_NAMES.seed, c.id).reduce((x, y) => x + y, 0);
    const near = hitsOf(ev, HEAT_NAMES.seed, b2.id).reduce((x, y) => x + y, 0);
    const far = hitsOf(ev, HEAT_NAMES.seed, a.id).reduce((x, y) => x + y, 0);
    expect(stay).toBeGreaterThan(near);
    expect(near).toBeGreaterThanOrEqual(far);
    expect(far).toBe(0);
    expect(cues(ev, HEAT_CUES.seedBurst).length).toBe(3);
    expect(f.objects(HEAT_OBJECTS.seedPrefix)).toEqual([]);
    // Normal hatches nothing.
    expect(adds(f, HEAT_MOBS.seedflame)).toEqual([]);
  });

  it('heroic: every burst hatches a Seedflame hunting one player', () => {
    const f = pulled(3, 31, true);
    f.dev('/dev heart heat phase 2');
    hold(f);
    f.dev('/dev heart heat seeds');
    f.tick(ticks(T.seedLife + 0.3));
    const flames = adds(f, HEAT_MOBS.seedflame);
    expect(flames.length).toBe(3);
    for (const e of flames) {
      expect(e.forcedTargetId).not.toBeNull();
      const quarry = f.sim.ctx.entities.get(e.forcedTargetId ?? -1);
      expect(quarry && has(quarry, HEAT_AURAS.hunted)).toBe(true);
    }
  });

  it('Wakefire always runs from the giant outward, run after run', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 2');
    hold(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    for (let run = 0; run < 8; run++) {
      f.dev('/dev heart heat zones');
      expect(st.zoneRun?.order).toEqual([0, 1, 2]);
    }
  });

  it('Wakefire ignites its three bands one after another, striking only who stands in each', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 2');
    hold(f);
    const [p0, p1, p2] = f.players;
    f.put(p0, HEARTH_WELL.x + HEARTH_WELL.r + 2, 0);
    f.put(p1, HEARTH_WELL.x + HEARTH_WELL.r + 14, 0);
    f.put(p2, HEARTH_WELL.x + HEARTH_WELL.r + 30, 0);
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart heat zones');
    const order = st.zoneRun?.order ?? [];
    expect(order).toEqual([0, 1, 2]);
    const ev = f.tick(ticks(T.zoneWarn + 0.1));
    // Only the first band has ignited.
    const first = [p0, p1, p2][order[0]];
    expect(hitsOf(ev, HEAT_NAMES.zone, first.id).length).toBeGreaterThanOrEqual(1);
    for (const p of [p0, p1, p2].filter((x) => x !== first))
      expect(hitsOf(ev, HEAT_NAMES.zone, p.id)).toEqual([]);
    const rest = f.tick(ticks(T.zoneStep * 2 + T.zoneBurn + 0.5));
    for (const p of [p0, p1, p2]) {
      if (p === first) continue;
      expect(hitsOf(rest, HEAT_NAMES.zone, p.id).length).toBeGreaterThanOrEqual(1);
    }
    expect(f.objects(HEAT_OBJECTS.zonePrefix)).toEqual([]);
  });
});

describe('Guardian of the Heat: phase 3, the Rolling Cinders', () => {
  /** Phase 3 with a cinder rolling after `quarry`. */
  function rolling(heroic = false) {
    const f = pulled(3, 31, heroic);
    f.dev('/dev heart heat phase 3');
    hold(f);
    f.dev('/dev heart heat ember');
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.falls.length).toBe(1);
    expect(f.objects(HEAT_OBJECTS.fallPrefix).length).toBe(1);
    const ev = f.tick(ticks(T.cinderFallWarn + 0.1));
    expect(cues(ev, HEAT_CUES.cinderLand).length).toBe(1);
    const [cinder] = adds(f, HEAT_MOBS.cinder);
    const c = st.cinders[0];
    const quarry = f.sim.ctx.entities.get(c.quarry ?? -1) as Entity;
    return { f, st, cinder, c, quarry };
  }

  it('lands, burns its spot, and hunts its quarry until it reaches them', () => {
    const { f, cinder, quarry } = rolling();
    expect(cinder).toBeDefined();
    expect(has(quarry, HEAT_AURAS.hunted)).toBe(true);
    expect(f.objects(HEAT_OBJECTS.scorchPrefix).length).toBe(1);
    const d = () => Math.hypot(cinder.pos.x - quarry.pos.x, cinder.pos.z - quarry.pos.z);
    const d0 = d();
    f.tick(ticks(1));
    expect(d0 - d()).toBeCloseTo(HEAT_DIFFICULTY.normal.cinderSpeed, 0);
    // Reaching its quarry kills them and spends the cinder.
    cinder.pos.x = quarry.pos.x + 3;
    cinder.pos.z = quarry.pos.z;
    const ev = f.tick(ticks(1), false);
    expect(hitsOf(ev, HEAT_NAMES.cinder, quarry.id)[0]).toBeGreaterThanOrEqual(T.cinderKill / 2);
    expect(quarry.dead).toBe(true);
    expect(cues(ev, HEAT_CUES.cinderBurst).length).toBe(1);
    expect(adds(f, HEAT_MOBS.cinder)).toEqual([]);
  });

  it('a strike knocks it back 6 yd, then Cooling Crust holds it 5 s', () => {
    const { f, cinder, quarry } = rolling();
    const striker = f.players.find((p) => p.id !== quarry.id) as Entity;
    const d = () => Math.hypot(cinder.pos.x - quarry.pos.x, cinder.pos.z - quarry.pos.z);
    // A strike lands one point (a ward) and knocks it back.
    const hp0 = cinder.hp;
    const landed = f.sim.ctx.dealDamage(striker, cinder, 900, false, 'physical', 'test', 'hit');
    expect(landed).toBe(1);
    expect(cinder.hp).toBe(hp0 - 1);
    const before = d();
    let ev = f.tick(1);
    expect(d()).toBeGreaterThan(before + T.cinderKnock - 1);
    expect(has(cinder, HEAT_AURAS.crust)).toBe(true);
    expect(cues(ev, HEAT_CUES.cinderKnock).length).toBe(1);
    // Struck again under its crust: no knockback.
    f.sim.ctx.dealDamage(striker, cinder, 900, false, 'physical', 'test', 'hit');
    const d1 = d();
    ev = f.tick(1);
    expect(cues(ev, HEAT_CUES.cinderKnock)).toEqual([]);
    expect(d()).toBeLessThan(d1);
    // The crust gone, a strike knocks it back again.
    f.tick(ticks(T.crustSeconds));
    expect(has(cinder, HEAT_AURAS.crust)).toBe(false);
    f.sim.ctx.dealDamage(striker, cinder, 900, false, 'physical', 'test', 'hit');
    ev = f.tick(1);
    expect(cues(ev, HEAT_CUES.cinderKnock).length).toBe(1);
    // A damage-over-time tick lands nothing and knocks nothing.
    f.tick(ticks(T.crustSeconds + 0.1));
    const hp1 = cinder.hp;
    f.sim.ctx.dealDamage(striker, cinder, 50, false, 'fire', 'dot', 'hit', true, undefined, false);
    expect(cinder.hp).toBe(hp1);
  });

  it('nothing wears it down: strikes, a sourceless hit and a wild mob land nothing lasting', () => {
    const { f, cinder, quarry } = rolling();
    const striker = f.players.find((p) => p.id !== quarry.id) as Entity;
    const full = cinder.maxHp;
    // Strikes worth nearly all its health in one tick: whole again after it.
    for (let i = 0; i < full - 5; i++)
      f.sim.ctx.dealDamage(striker, cinder, 900, false, 'physical', 'test', 'hit');
    expect(cinder.hp).toBe(5);
    f.tick(1);
    expect(cinder.dead).toBe(false);
    expect(cinder.hp).toBe(full);
    // A hit with no source, or from a mob nobody owns, lands nothing.
    expect(f.sim.ctx.dealDamage(null, cinder, 99999, false, 'fire', 'test', 'hit')).toBe(0);
    expect(cinder.hp).toBe(full);
    expect(f.sim.ctx.dealDamage(f.boss(), cinder, 99999, false, 'fire', 'test', 'hit')).toBe(0);
    expect(cinder.dead).toBe(false);
    expect(adds(f, HEAT_MOBS.cinder)).toHaveLength(1);
  });

  it('Hunted leaves a quarry who walks off the floor, and every player at the fight end', () => {
    const { f, quarry } = rolling();
    expect(has(quarry, HEAT_AURAS.hunted)).toBe(true);
    // Off the Hearth's floor (back toward the forge): no longer a quarry.
    f.put(quarry, -150, 0);
    f.tick(2);
    expect(has(quarry, HEAT_AURAS.hunted)).toBe(false);
    // The cinder picks someone on the floor; one Hunted, never two.
    f.tick(ticks(T.cinderRetarget + 0.2));
    const huntedNow = f.players.filter((p) => has(p, HEAT_AURAS.hunted));
    expect(huntedNow).toHaveLength(1);
    expect(huntedNow[0].id).not.toBe(quarry.id);
    // The fight ends far from the forge: the mark goes with it.
    f.put(huntedNow[0], 40, 0);
    expect(f.dev('/dev heart heat reset')).toBe(true);
    for (const p of f.players) expect(has(p, HEAT_AURAS.hunted)).toBe(false);
  });

  it('keeps at most scorchCap burning landings, the oldest going out first', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 3');
    hold(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Two volleys of as many falls as the cinder cap allows, landing together.
    let first: number[] = [];
    for (let round = 0; round < 2; round++) {
      // Forget the rolling cinders so the cap on cinders never stops a fall.
      st.cinders = [];
      for (let i = 0; i < T.cinderCap; i++) f.dev('/dev heart heat ember');
      f.tick(ticks(T.cinderFallWarn + 0.1));
      expect(st.scorches.length).toBeLessThanOrEqual(T.scorchCap);
      expect(f.objects(HEAT_OBJECTS.scorchPrefix).length).toBe(st.scorches.length);
      if (round === 0) first = st.scorches.map((p) => p.objectId);
    }
    expect(st.scorches.length).toBe(T.scorchCap);
    // The second volley put the first out.
    for (const id of first) expect(st.scorches.some((p) => p.objectId === id)).toBe(false);
  });

  it('falls on its own clock through phase 3', () => {
    const f = pulled(3);
    f.dev('/dev heart heat phase 3');
    const ev = f.tick(ticks(T.cinderFirst + T.cinderFallWarn + 0.5));
    expect(cues(ev, HEAT_CUES.cinderLand).length).toBe(1);
    expect(chatKeys(ev)).toContain('hudChrome.heatGuardian.warn.cinder');
  });
});

describe('Guardian of the Heat: no phase 4 on any difficulty', () => {
  it('heroic and mythic end with phase 3 like normal: it never leaves the wellspring', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const f = pulled(2);
      if (tier !== 'normal') f.dev(`/dev heart heat ${tier}`);
      f.dev('/dev heart heat phase 3');
      hold(f);
      setHp(f, 0.05);
      f.tick(ticks(3));
      const st = f.state();
      expect(st?.phase).toBe(3);
      expect(st?.stage).toBe('fight');
      expect(f.boss().damageFloorHp).toBeUndefined();
      // The tank backs off: still sunk in its wellspring.
      f.put(f.players[0], HEARTH_WELL.x + 30, 0);
      f.tick(ticks(3));
      const o = f.world(HEARTH_WELL.x, HEARTH_WELL.z);
      expect(f.boss().pos.x).toBeCloseTo(o.x, 6);
      expect(f.boss().pos.z).toBeCloseTo(o.z, 6);
      expect(f.dev('/dev heart heat phase 4')).toBe(true);
      expect(f.state()?.phase).toBe(3);
    }
  });

  it('a Rolling Cinder is never killed: every strike lands one point', () => {
    const f = pulled(2, 31, true);
    f.dev('/dev heart heat phase 3');
    hold(f);
    f.dev('/dev heart heat ember');
    f.tick(ticks(T.cinderFallWarn + 0.1));
    const [cinder] = adds(f, HEAT_MOBS.cinder);
    const hp0 = cinder.hp;
    for (let i = 0; i < 5; i++)
      f.sim.ctx.dealDamage(f.players[1], cinder, 99999, true, 'fire', 'test', 'hit');
    expect(cinder.hp).toBe(hp0 - 5);
    expect(cinder.dead).toBe(false);
  });
});

describe('Guardian of the Heat: the end', () => {
  it('a wipe puts the Hearth back: every footprint, add and mark gone', () => {
    const f = pulled(4, 31, true);
    f.dev('/dev heart heat phase 3');
    f.dev('/dev heart heat ember');
    f.dev('/dev heart heat seeds');
    f.dev('/dev heart heat zones');
    f.tick(ticks(4));
    expect(adds(f, HEAT_MOBS.cinder).length).toBe(1);
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    const ev = until(f, () => f.state() === null, 30);
    expect(f.state()).toBeNull();
    expect(chatKeys(ev)).toContain('hudChrome.heatGuardian.say.wipe');
    for (const [k, prefix] of Object.entries(HEAT_OBJECTS)) {
      const left = f.objects(prefix);
      if (k === 'wellPrefix') expect(left.map((e) => e.templateId)).toEqual([wellTemplate('calm')]);
      else expect(left).toEqual([]);
    }
    for (const id of Object.values(HEAT_MOBS)) expect(adds(f, id)).toEqual([]);
    for (const p of f.players)
      for (const id of [HEAT_AURAS.hunted, HEAT_AURAS.kindling]) expect(has(p, id)).toBe(false);
    expect(has(f.boss(), HEAT_AURAS.state)).toBe(false);
    expect(f.boss().damageImmune).toBe(false);
    expect(f.boss().damageFloorHp).toBeUndefined();
  });

  it("its fall lights the Heat vein and the seal's quarter; the wellspring settles", () => {
    const f = pulled(2);
    f.dev('/dev heart heat phase 3');
    f.dev('/dev heart heat ember');
    f.tick(ticks(3));
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'heat')).toBe(false);
    f.sim.ctx.handleDeath(f.boss(), f.players[0]);
    const ev = f.tick(3);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'heat')).toBe(true);
    expect(smithHeartProgress(f.sim.ctx, f.inst).mask & 8).toBe(8);
    expect(chatKeys(ev)).toContain('hudChrome.heatGuardian.say.death');
    expect(cues(ev, HEAT_CUES.settle).length).toBe(1);
    expect(f.state()?.finished).toBe(true);
    expect(adds(f, HEAT_MOBS.cinder)).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.fallPrefix)).toEqual([]);
  });
});

describe('Guardian of the Heat: determinism', () => {
  it('the same seed and the same raid fight the same fight', () => {
    const run = () => {
      const f = heatFight(6, 43);
      f.dev('/dev heart heat heroic');
      f.dev('/dev heart heat pull');
      const evs: SimEvent[] = [];
      evs.push(...f.tick(ticks(30)));
      setHp(f, 0.69);
      evs.push(...f.tick(ticks(20)));
      f.dev('/dev heart heat phase 2');
      evs.push(...f.tick(ticks(40)));
      f.dev('/dev heart heat phase 3');
      evs.push(...f.tick(ticks(30)));
      const st = f.state();
      return JSON.stringify({
        phase: st?.phase,
        fists: st?.fists,
        feeds: st?.feeds,
        cinders: st?.cinders.map((c) => c.quarry),
        hits: evs
          .filter((e) => e.type === 'damage')
          .map((e) => [(e as { ability?: string }).ability, (e as { amount?: number }).amount])
          .slice(0, 600),
      });
    };
    expect(run()).toBe(run());
  });
});
