// The Masterless Strength's Breath quarter (design doc 7.5): spread. The
// Guardian of the Breath's bolt, compressed.
//
//   (Bellows Wind and Pressed to the Rim went with the rework of 2026-11-18:
//   the team read the push as blowing the wrong way; the quarter's star, Sky
//   Strike, is final_sky.ts, told apart from Leaping Bolt by its sky-white
//   column and its spot on the floor.)
//   Leaping Bolt     every 14 s (first 8 s in) a 2 s bar on a hashed player;
//                    it strikes them, then leaps to every player within 6 yd
//                    of anyone struck, each leap half again as hard: spread.
//   Drawn Lightning  Heroic, every 22 s (first 12 s in): two marked players
//                    for 6 s; every second it arcs from each to everyone
//                    within 8 yd of them.
//   Dust Devils      every 20 s (first 9 s in; Jose's playtest of 2026-11-19:
//                    the quarter's whirlwinds were dressing, now they do
//                    something): the tier's count (2 Normal, 3 Heroic and
//                    Mythic) rise a few yards off hashed players (2 s of
//                    warning), then wander the floor for 9 s; whoever one
//                    touches is thrown 8 yd out of it and takes a little
//                    nature damage (at most once in 2 s). Their loop is the
//                    Fire Whirl's (final_heat.ts stepWhirls, `wind`).
//   Storm Orbs       Mythic, every 25 s (first 15 s in): three orbs round the
//                    boss; each must be stepped on by one player (a jolt;
//                    two or more share nothing, each takes it twice over)
//                    within 8 s, or it bursts on the whole raid.
//
// Deterministic: every pick is hashed (pickPlayers, finalHash) and every leap
// walks the struck in order, the others in id order; the only rng draws are
// the damage rolls.

import { DT, type Entity } from '../../types';
import {
  boltScale,
  devilTemplate,
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalHash,
  finalTimed,
  FINAL_TUNING as T,
} from './final_ids';
import {
  at,
  beamCue,
  beginBar,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  facingTo,
  hit,
  livePlayers,
  local,
  onFloor,
  pickPlayers,
  putMarker,
  roll,
  spawnFightObject,
  standingSpot,
} from './final_scope';

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
    const spot = standingSpot(
      s,
      onFloor({ x: b.x + Math.sin(ang) * r, z: b.z + Math.cos(ang) * r }, 3),
    );
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
  for (const o of st.orbs) dropFightObject(s.ctx, s.inst, o.objectId);
  st.orbs = [];
  st.drawn = [];
  st.boltTarget = null;
  for (const p of players) dropAura(p, FINAL_AURAS.drawn);
}

// ---- Dust Devils -------------------------------------------------------------------------

/** The tier's Dust Devils rise a few yards off hashed players. Returns how
 *  many. Exported for the dev trigger. */
export function raiseDevils(s: FinalScope): number {
  const st = s.st;
  st.kit.devil = T.devilEvery;
  const victims = pickPlayers(s, s.rules.devilCount, st.casts + 501);
  let n = 0;
  victims.forEach((v, i) => {
    const h = finalHash(s.boss.id, st.casts * 17 + i + 3);
    const heading = ((h % 360) * Math.PI) / 180;
    const p = at(s, v);
    const spot = standingSpot(
      s,
      onFloor({ x: p.x - Math.sin(heading) * 6, z: p.z - Math.cos(heading) * 6 }, 3),
      p,
    );
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      devilTemplate('warn'),
      FINAL_NAMES.devil,
      spot.x,
      spot.z,
      T.devilR,
    );
    obj.facing = heading;
    st.whirls.push({
      objectId: obj.id,
      warn: T.devilWarn,
      life: T.devilLife,
      heading,
      cooldown: {},
      wind: true,
      turn: T.devilTurnEvery,
    });
    n++;
  });
  st.casts++;
  return n;
}
