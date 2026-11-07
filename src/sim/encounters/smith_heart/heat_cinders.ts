// The Guardian of the Heat's Rolling Cinders (docs/design/raid/smith_heart.md
// section 7.4), phase 3.
//
//   The fall       every 45 s (first 8 s into phase 3) a great living
//                  fireball falls on the shore: 2 s of warning where it will
//                  land (a hashed shore point at least 14 yd from the player
//                  it will hunt), then it lands, striking everyone within
//                  4 yd and leaving the spot burning for 8 s.
//   The hunt       it rolls after one hashed player (Hunted shows who),
//                  slower on normal, faster on heroic, nothing slows it. If
//                  it reaches them they die and those beside them burn, and
//                  the cinder is spent. Its quarry gone, it picks another.
//   Striking it    a cinder is a ward (heat_cinder_ward.ts): any strike lands
//                  one point and knocks it 6 yd back (straight away from its
//                  quarry), then Cooling Crust holds it against knockback for
//                  5 s. The raid assigns who strikes it and when. Nothing
//                  kills it: it rolls on until it reaches someone or the
//                  fight ends.
//
// Deterministic: the quarry and the landing are hashed; the only rng draws
// are the damage rolls, in player order.

import { displaceAlong } from '../../knockback';
import { DT, type Entity } from '../../types';
import { type HPoint, SHORE_POINTS } from './heat_geometry';
import {
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  heatHash,
  heatTimed,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  auraOf,
  cueAt,
  cueOn,
  dropAura,
  dropFightObject,
  dropHeatMob,
  fireHit,
  type HeatScope,
  liveEntity,
  livePlayers,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
  spawnHeatMob,
} from './heat_scope';
import type { HeatCinder, HeatPatch } from './heat_state';
import { heatSay } from './heat_voice';

/** How far from its quarry a cinder lands at the least. */
const LAND_CLEAR = 14;

/** Where cinder `n` lands, hunting a player at `quarry`: a hashed shore
 *  point at least LAND_CLEAR from them (any shore point if none is). */
export function cinderLanding(n: number, quarry: HPoint | null): HPoint {
  const pts = SHORE_POINTS;
  const start = heatHash(n, 41) % pts.length;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[(start + k * 7) % pts.length];
    if (!quarry || Math.hypot(p.x - quarry.x, p.z - quarry.z) >= LAND_CLEAR) return p;
  }
  return pts[start];
}

/** Every player a cinder or a Seedflame hunts wears Hunted (and nobody
 *  else: a quarry who left the floor loses it too). */
export function syncHunted(s: HeatScope): void {
  const hunted = new Set<number>();
  for (const c of s.st.cinders) if (c.quarry !== null) hunted.add(c.quarry);
  for (const sp of s.st.sprouts) if (sp.quarry !== null) hunted.add(sp.quarry);
  for (const p of s.players) {
    if (!hunted.has(p.id) || auraOf(p, HEAT_AURAS.hunted) !== undefined) continue;
    putMarker(p, HEAT_AURAS.hunted, HEAT_NAMES.hunted, 3600, s.boss.id, {
      permanent: true,
      school: 'fire',
    });
  }
  dropStrayHunted(s.ctx, s.boss.id, hunted, s.players);
}

/** Drop Hunted (this guardian's) from every player it no longer fits: not
 *  hunted, or off the floor (`onFloor`). With no `keep`, from everyone
 *  (the fight's end). */
export function dropStrayHunted(
  ctx: HeatScope['ctx'],
  bossId: number,
  keep: ReadonlySet<number> | null,
  onFloor: readonly Entity[] = [],
): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    const a = auraOf(p, HEAT_AURAS.hunted);
    if (!a || a.sourceId !== bossId) continue;
    if (keep?.has(p.id) && onFloor.includes(p)) continue;
    dropAura(p, HEAT_AURAS.hunted);
  }
}

/** A Rolling Cinder starts to fall. Returns false at the cap or with nobody
 *  to hunt. Exported for the dev trigger. */
export function callCinder(s: HeatScope): boolean {
  const st = s.st;
  st.cinderTimer = T.cinderEvery;
  if (st.cinders.length + st.falls.length >= T.cinderCap) return false;
  const [quarry] = pickPlayers(s, 1, 1100 + st.cindersCalled);
  if (!quarry) return false;
  const spot = cinderLanding(st.cindersCalled, at(s, quarry));
  st.cindersCalled++;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    heatTimed(HEAT_OBJECTS.fallPrefix, T.cinderFallWarn),
    HEAT_NAMES.cinder,
    spot.x,
    spot.z,
    T.cinderLandR,
  );
  st.falls.push({
    objectId: obj.id,
    x: spot.x,
    z: spot.z,
    remaining: T.cinderFallWarn,
    quarry: quarry.id,
  });
  raidWarn(
    s,
    s.boss,
    'cinder',
    'A Rolling Cinder falls! Strike it back before it reaches its quarry!',
  );
  heatSay(s, s.boss, 'cinder');
  return true;
}

/** A fall lands: the blow and the scorch, and the cinder itself. */
function landCinder(s: HeatScope, x: number, z: number, quarry: number | null): Entity | null {
  cueAt(s, HEAT_CUES.cinderLand, x, z, T.cinderLandR);
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (Math.hypot(here.x - x, here.z - z) > T.cinderLandR) continue;
    fireHit(s, p, roll(s, T.cinderLandMin, T.cinderLandMax), HEAT_NAMES.cinderLand);
  }
  // At the cap the oldest scorch goes out (the renderer's pool is sized to it).
  while (s.st.scorches.length >= T.scorchCap) {
    const old = s.st.scorches.shift();
    if (old) dropFightObject(s.ctx, s.inst, old.objectId);
  }
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    heatTimed(HEAT_OBJECTS.scorchPrefix, T.scorchLife),
    HEAT_NAMES.cinderLand,
    x,
    z,
    T.cinderLandR,
  );
  s.st.scorches.push({ objectId: obj.id, x, z, life: T.scorchLife, tick: T.scorchTick });
  const e = spawnHeatMob(s, HEAT_MOBS.cinder, x, z, 0);
  if (!e) return null;
  e.inCombat = true;
  e.aiState = 'attack';
  e.hostile = true;
  s.st.cinders.push({ id: e.id, quarry, retarget: 0, hpSeen: e.hp });
  return e;
}

/** The cinder reaches its quarry: they die, those beside them burn, the
 *  cinder is spent. Returns who it struck. */
function burstCinder(s: HeatScope, cinder: Entity, quarry: Entity): Entity[] {
  const here = at(s, quarry);
  cueAt(s, HEAT_CUES.cinderBurst, here.x, here.z, T.cinderSplashR);
  const hit: Entity[] = [quarry];
  fireHit(s, quarry, T.cinderKill, HEAT_NAMES.cinder);
  for (const p of livePlayers(s)) {
    if (p.id === quarry.id) continue;
    const there = at(s, p);
    if (Math.hypot(there.x - here.x, there.z - here.z) > T.cinderSplashR) continue;
    hit.push(p);
    fireHit(s, p, roll(s, T.cinderSplashMin, T.cinderSplashMax), HEAT_NAMES.cinder);
  }
  dropHeatMob(s, cinder.id);
  return hit;
}

/** A strike knocks the cinder back straight away from its quarry, and its
 *  crust hardens. Exported for the tests. */
export function knockCinder(s: HeatScope, cinder: Entity, c: HeatCinder): boolean {
  if (auraOf(cinder, HEAT_AURAS.crust)) return false;
  const q = liveEntity(s, c.quarry);
  let ux = -Math.sin(cinder.facing);
  let uz = -Math.cos(cinder.facing);
  if (q) {
    const dx = cinder.pos.x - q.pos.x;
    const dz = cinder.pos.z - q.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      ux = dx / len;
      uz = dz / len;
    }
  }
  displaceAlong(s.ctx, cinder, ux, uz, T.cinderKnock);
  s.ctx.rebucket(cinder);
  putMarker(cinder, HEAT_AURAS.crust, HEAT_NAMES.crust, T.crustSeconds, s.boss.id, {
    school: 'fire',
  });
  cueOn(s, cinder, HEAT_CUES.cinderKnock);
  return true;
}

/** One cinder's tick: struck back, hunting, reaching. Returns false
 *  once it is gone. */
function stepCinder(s: HeatScope, c: HeatCinder): boolean {
  const e = liveEntity(s, c.id);
  if (!e) return false;
  e.inCombat = true;
  e.swingTimer = Math.max(e.swingTimer, 0.6);
  if (e.hp < c.hpSeen - 1e-9) knockCinder(s, e, c);
  // Nothing kills it: the points the ward let through come back once read.
  e.hp = e.maxHp;
  c.hpSeen = e.hp;
  const quarry = liveEntity(s, c.quarry);
  if (!quarry || !s.players.includes(quarry)) {
    c.quarry = null;
    c.retarget -= DT;
    if (c.retarget > 1e-9) return true;
    const [next] = pickPlayers(s, 1, 1300 + s.st.casts++);
    c.retarget = T.cinderRetarget;
    if (next) c.quarry = next.id;
    return true;
  }
  c.retarget = T.cinderRetarget;
  s.ctx.moveToward(e, quarry.pos, s.rules.cinderSpeed);
  const d = Math.hypot(e.pos.x - quarry.pos.x, e.pos.z - quarry.pos.z);
  if (d <= T.cinderContact) {
    burstCinder(s, e, quarry);
    return false;
  }
  return true;
}

/** One tick of the falls, the scorches and the cinders. */
export function stepCinders(s: HeatScope): void {
  const st = s.st;
  if (st.falls.length > 0) {
    const keep = [];
    for (const f of st.falls) {
      f.remaining -= DT;
      if (f.remaining > 1e-9) {
        keep.push(f);
        continue;
      }
      dropFightObject(s.ctx, s.inst, f.objectId);
      landCinder(s, f.x, f.z, f.quarry);
    }
    st.falls = keep;
  }
  if (st.scorches.length > 0) stepScorches(s);
  if (st.cinders.length > 0) st.cinders = st.cinders.filter((c) => stepCinder(s, c));
}

function stepScorches(s: HeatScope): void {
  const st = s.st;
  for (const t of st.scorches) {
    t.life -= DT;
    t.tick -= DT;
    if (t.tick > 1e-9 || t.life <= 1e-9) continue;
    t.tick += T.scorchTick;
    for (const p of livePlayers(s)) {
      const here = at(s, p);
      if (Math.hypot(here.x - t.x, here.z - t.z) > T.cinderLandR) continue;
      fireHit(s, p, roll(s, T.scorchMin, T.scorchMax), HEAT_NAMES.cinderLand);
    }
  }
  const gone: HeatPatch[] = st.scorches.filter((t) => t.life <= 1e-9);
  if (gone.length === 0) return;
  for (const t of gone) dropFightObject(s.ctx, s.inst, t.objectId);
  st.scorches = st.scorches.filter((t) => t.life > 1e-9);
}

/** Every fall, scorch and cinder gone. */
export function clearCinders(s: Pick<HeatScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const st = s.st;
  for (const f of st.falls) dropFightObject(s.ctx, s.inst, f.objectId);
  for (const t of st.scorches) dropFightObject(s.ctx, s.inst, t.objectId);
  for (const c of st.cinders) dropHeatMob(s, c.id);
  st.falls = [];
  st.scorches = [];
  st.cinders = [];
}
