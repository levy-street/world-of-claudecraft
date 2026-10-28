// The Masterless Strength's Breath quarter (design doc 7.5): spread. The
// Guardian of the Breath's wind and bolt, compressed.
//
//   Bellows Wind     every 20 s (first 4 s into the quarter) the wind gathers
//                    (2 s, its heading shown), then blows 8 s toward a hashed
//                    bearing: the wind kernel carries everyone on the Anvil
//                    3.5 yd a second (src/sim/wind_drift.ts: both hosts step
//                    it, the online client predicts it). Within 5 yd of the
//                    rim while it blows the storm strikes every second
//                    (Pressed to the Rim): walk into the wind.
//   Leaping Bolt     every 11 s (first 6 s in) a 2 s bar on a hashed player;
//                    it strikes them, then leaps to every player within 6 yd
//                    of anyone struck, each leap half again as hard: spread.
//   Drawn Lightning  Heroic, every 22 s (first 12 s in): two marked players
//                    for 6 s; every second it arcs from each to everyone
//                    within 8 yd of them.
//   Storm Orbs       Mythic, every 25 s (first 15 s in): three orbs round the
//                    boss; each must be stepped on by one player (a jolt;
//                    two or more share nothing, each takes it twice over)
//                    within 8 s, or it bursts on the whole raid.
//
// Deterministic: every pick is hashed (pickPlayers, finalHash) and every leap
// walks the struck in order, the others in id order; the only rng draws are
// the damage rolls.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { WIND_DRIFT_AURA } from '../../wind_drift';
import {
  boltScale,
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalHash,
  finalTimed,
  FINAL_TUNING as T,
  windTemplate,
} from './final_ids';
import {
  at,
  auraOf,
  beamCue,
  beginBar,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  facingTo,
  fromCentre,
  hit,
  livePlayers,
  local,
  onFloor,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
} from './final_scope';

/** The tag the final's wind carries in its `value3` (the kernel ignores it
 *  on a steady wind): its tooltip is the final's, not the guardian's. */
export const FINAL_WIND_TAG = 7;

// ---- the wind ------------------------------------------------------------------------------

/** The wind gathers toward a hashed bearing (or `forced`, radians). Exported
 *  for the dev trigger. */
export function gatherWind(s: FinalScope, forced?: number): void {
  const st = s.st;
  st.kit.wind = T.windEvery;
  if (st.wind) dropFightObject(s.ctx, s.inst, st.wind.objectId);
  const heading = forced ?? ((finalHash(s.boss.id, st.casts * 31 + 7) % 8) * Math.PI) / 4;
  st.casts++;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    windTemplate('warn', T.windWarn),
    FINAL_NAMES.wind,
    HEART_ROOM.x,
    HEART_ROOM.z,
    HEART_ROOM.r,
  );
  obj.facing = heading;
  st.wind = { objectId: obj.id, heading, warn: T.windWarn, blow: T.windBlow, rimTick: T.rimTick };
  raidWarn(s, 'wind', 'The Breath gathers a gale! Walk into the wind, away from the rim!');
}

function keepWindOn(s: FinalScope, p: Entity, heading: number): void {
  const a = auraOf(p, WIND_DRIFT_AURA);
  if (a && a.value === heading && a.value2 === T.windSpeed && a.value3 === FINAL_WIND_TAG) {
    if (a.remaining < 1.5) a.remaining = 3;
    return;
  }
  putMarker(p, WIND_DRIFT_AURA, FINAL_NAMES.wind, 3, s.boss.id, {
    value: heading,
    value2: T.windSpeed,
    value3: FINAL_WIND_TAG,
  });
}

function dropWind(s: FinalScope): void {
  for (const p of s.players) {
    const a = auraOf(p, WIND_DRIFT_AURA);
    if (a && a.sourceId === s.boss.id) dropAura(p, WIND_DRIFT_AURA);
  }
}

/** One tick of the wind: the warning, the blow (the kernel's push on
 *  everyone, the rim's strikes), the calm. */
export function stepWind(s: FinalScope): void {
  const w = s.st.wind;
  if (!w) return;
  const obj = s.ctx.entities.get(w.objectId);
  if (w.warn > 0) {
    w.warn -= DT;
    if (w.warn <= 1e-9 && obj) obj.templateId = windTemplate('blow', T.windBlow);
    return;
  }
  w.blow -= DT;
  if (w.blow <= 1e-9) {
    dropWind(s);
    dropFightObject(s.ctx, s.inst, w.objectId);
    s.st.wind = null;
    return;
  }
  for (const p of livePlayers(s)) keepWindOn(s, p, w.heading);
  w.rimTick -= DT;
  if (w.rimTick > 1e-9) return;
  w.rimTick = T.rimTick;
  for (const p of livePlayers(s)) {
    if (fromCentre(at(s, p)) < HEART_ROOM.r - T.rimBand) continue;
    hit(s, p, roll(s, T.rimMin, T.rimMax), FINAL_NAMES.rim, 'nature');
  }
}

// ---- Leaping Bolt --------------------------------------------------------------------------

/** Begin Leaping Bolt on a hashed player (or `forced`). Exported for the dev
 *  trigger. */
export function startBolt(s: FinalScope, forced?: Entity): boolean {
  const st = s.st;
  st.kit.bolt = T.boltEvery;
  const target = forced ?? pickPlayers(s, 1, st.casts + 701)[0];
  if (!target) return false;
  st.boltTarget = target.id;
  const b = local(s.ctx, s.inst, s.boss);
  beginBar(s, FINAL_CASTS.bolt, T.boltCast, facingTo(b, at(s, target)), target.id);
  return true;
}

/** The bolt lands: its target, then a leap to everyone near anyone struck,
 *  each leap harder. Returns who, in order. */
export function landBolt(s: FinalScope): Entity[] {
  const st = s.st;
  const first = st.boltTarget !== null ? s.ctx.entities.get(st.boltTarget) : undefined;
  st.boltTarget = null;
  const alive = livePlayers(s);
  if (!first || first.dead || !alive.includes(first)) return [];
  const struck: Entity[] = [first];
  beamCue(s, s.boss.id, first.id, FINAL_CUES.bolt);
  for (let i = 0; i < struck.length && struck.length < T.boltMaxStruck; i++) {
    const from = at(s, struck[i]);
    for (const o of alive) {
      if (struck.includes(o) || struck.length >= T.boltMaxStruck) continue;
      const q = at(s, o);
      if (Math.hypot(q.x - from.x, q.z - from.z) > T.boltJump) continue;
      struck.push(o);
      beamCue(s, struck[i].id, o.id, FINAL_CUES.bolt);
    }
  }
  struck.forEach((p, k) => {
    if (p.dead) return;
    hit(s, p, Math.round(roll(s, T.boltMin, T.boltMax) * boltScale(k)), FINAL_NAMES.bolt, 'nature');
  });
  return struck;
}

// ---- Drawn Lightning -----------------------------------------------------------------------

/** Heroic: two players marked. Returns who. */
export function drawLightning(s: FinalScope): Entity[] {
  const st = s.st;
  st.kit.drawn = T.drawnEvery;
  const marked = pickPlayers(s, T.drawnMarks, st.casts + 801);
  st.casts++;
  for (const p of marked) {
    putMarker(p, FINAL_AURAS.drawn, FINAL_NAMES.drawn, T.drawnSeconds, s.boss.id, {
      school: 'nature',
    });
    st.drawn.push({ pid: p.id, left: T.drawnSeconds });
  }
  st.drawnTick = T.drawnTick;
  if (marked.length > 0)
    raidWarn(s, 'drawn', 'Drawn Lightning! The marked keep 8 yards from everyone!');
  return marked;
}

/** One tick of the marks: every second each arcs to everyone near it.
 *  Returns the arcs struck this tick (the tests read it). */
export function stepDrawn(s: FinalScope): Entity[] {
  const st = s.st;
  if (st.drawn.length === 0) return [];
  for (const m of st.drawn) m.left -= DT;
  const done = st.drawn.filter((m) => m.left <= 1e-9);
  for (const m of done) {
    const p = s.ctx.entities.get(m.pid);
    if (p) dropAura(p, FINAL_AURAS.drawn);
  }
  st.drawn = st.drawn.filter((m) => m.left > 1e-9);
  st.drawnTick -= DT;
  if (st.drawnTick > 1e-9 || st.drawn.length === 0) return [];
  st.drawnTick = T.drawnTick;
  const struck: Entity[] = [];
  for (const m of st.drawn) {
    const src = s.ctx.entities.get(m.pid);
    if (!src || src.dead) continue;
    const q = at(s, src);
    for (const o of livePlayers(s)) {
      if (o.id === src.id) continue;
      const r = at(s, o);
      if (Math.hypot(r.x - q.x, r.z - q.z) > T.drawnReach) continue;
      beamCue(s, src.id, o.id, FINAL_CUES.arc);
      hit(s, o, roll(s, T.drawnMin, T.drawnMax), FINAL_NAMES.drawn, 'nature');
      struck.push(o);
    }
  }
  return struck;
}

// ---- Storm Orbs ----------------------------------------------------------------------------

/** Mythic: three orbs round the boss (or `around` a Splinter of the Breath,
 *  `count` of them, part 2: its circles, the same solo soaks). Returns how
 *  many. */
export function raiseOrbs(
  s: FinalScope,
  opts: { around?: FPoint; count?: number; salt?: number } = {},
): number {
  const st = s.st;
  const count = opts.count ?? T.orbCount;
  if (!opts.around) st.kit.orb = T.orbEvery;
  const b = opts.around ?? at(s, s.boss);
  const near = opts.around ? 6 : 12;
  const span = opts.around ? 6 : 13;
  for (let i = 0; i < count; i++) {
    const h = finalHash(s.boss.id + (opts.salt ?? 0), st.casts * 17 + i);
    const ang = ((h % 360) * Math.PI) / 180;
    const r = near + (h % span);
    const spot = onFloor({ x: b.x + Math.sin(ang) * r, z: b.z + Math.cos(ang) * r }, 3);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      finalTimed(FINAL_OBJECTS.orbPrefix, T.orbLife),
      FINAL_NAMES.orb,
      spot.x,
      spot.z,
      T.orbR,
    );
    st.orbs.push({ objectId: obj.id, x: spot.x, z: spot.z, left: T.orbLife });
  }
  st.casts++;
  raidWarn(s, 'orbs', 'Storm Orbs! One player steps on each before it bursts!');
  return count;
}

/** One tick of the orbs: each taken by whoever steps on it, or bursting at
 *  its time. */
export function stepOrbs(s: FinalScope): void {
  const st = s.st;
  if (st.orbs.length === 0) return;
  const keep: typeof st.orbs = [];
  for (const o of st.orbs) {
    o.left -= DT;
    const on = livePlayers(s).filter((p) => {
      const q = at(s, p);
      return Math.hypot(q.x - o.x, q.z - o.z) <= T.orbR;
    });
    if (on.length > 0) {
      dropFightObject(s.ctx, s.inst, o.objectId);
      cueAt(s, FINAL_CUES.orbTaken, o.x, o.z, T.orbR, 'nature');
      const mult = on.length > 1 ? 2 : 1;
      for (const p of on) hit(s, p, roll(s, T.orbMin, T.orbMax) * mult, FINAL_NAMES.orb, 'nature');
      continue;
    }
    if (o.left > 1e-9) {
      keep.push(o);
      continue;
    }
    dropFightObject(s.ctx, s.inst, o.objectId);
    cueAt(s, FINAL_CUES.orbBurst, o.x, o.z, 30, 'nature');
    for (const p of livePlayers(s))
      hit(s, p, roll(s, T.orbBurstMin, T.orbBurstMax), FINAL_NAMES.orb, 'nature');
  }
  st.orbs = keep;
}

/** Every Breath footprint and mark gone (the fight's end). */
export function clearBreath(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  players: readonly Entity[],
): void {
  const st = s.st;
  if (st.wind) dropFightObject(s.ctx, s.inst, st.wind.objectId);
  st.wind = null;
  for (const o of st.orbs) dropFightObject(s.ctx, s.inst, o.objectId);
  st.orbs = [];
  st.drawn = [];
  st.boltTarget = null;
  for (const p of players) {
    const a = auraOf(p, WIND_DRIFT_AURA);
    if (a && a.sourceId === s.boss.id) dropAura(p, WIND_DRIFT_AURA);
    dropAura(p, FINAL_AURAS.drawn);
  }
}
