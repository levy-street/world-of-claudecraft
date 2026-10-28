// The Masterless Strength's Heat quarter (design doc 7.5): dodge and place.
// The Guardian of the Heat's fist, compressed.
//
//   Basalt Fist     every 16 s (first 5 s into the quarter) a 3 s bar,
//                   planted, its facing on the spot where a hashed player
//                   (never the tank while anyone else stands) stood: the
//                   spot's lethal blow, then three Molten Swells roll out
//                   of it (away from the boss and to either side), the Heat
//                   guardian's own objects, lanes and numbers.
//   Fire Whirl      every 13 s (first 8 s in) three whirls of fire rise by
//                   hashed players (1.5 s of warning), then run straight
//                   across the floor for 9 s, turning back off the rim: each
//                   strikes a player it touches at most once a second.
//   Ember Mark      Heroic, every 22 s (first 10 s in): up to three ranged
//                   players (12 yd or more from the boss) are marked; 6 s
//                   later embers drop at their feet and smoulder 30 s. The
//                   raid stacks the marks in one corner, then moves out.
//   Forge Fire      Mythic: the boss's frontal (Forge Fist, its swing
//                   cleave) leaves a pool of fire where it struck.
//
// Deterministic: every pick is hashed (pickPlayers, finalHash), every heading
// derived; the only rng draws are the damage rolls, in player order.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_NAMES,
  finalHash,
  poolTemplate,
  FINAL_TUNING as T,
  whirlTemplate,
} from './final_ids';
import {
  at,
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
  moveFightObject,
  onFloor,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
} from './final_scope';
import type { FinalSwell } from './final_state';
import { inWave, laneReach } from './heat_geometry';
import {
  HEAT_TUNING as H,
  HEAT_CUES,
  HEAT_OBJECTS,
  heatTimed,
  swellLaneTemplate,
} from './heat_ids';

// ---- Basalt Fist and the Molten Swells -----------------------------------------------------

/** Begin Basalt Fist on a hashed player's spot (or `forced`). Exported for
 *  the dev trigger. */
export function startFist(s: FinalScope, forced?: FPoint): boolean {
  const st = s.st;
  st.kit.fist = T.fistEvery;
  let aim: FPoint | null = forced ?? null;
  if (!aim) {
    const [victim] = pickPlayers(s, 1, st.casts + 301);
    if (!victim) return false;
    aim = at(s, victim);
  }
  const spot = onFloor(aim, 1);
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    heatTimed(HEAT_OBJECTS.fistPrefix, T.fistCast),
    FINAL_NAMES.fist,
    spot.x,
    spot.z,
    T.fistR,
  );
  const here = local(s.ctx, s.inst, s.boss);
  const away =
    Math.hypot(spot.x - here.x, spot.z - here.z) > 0.5 ? facingTo(here, spot) : s.boss.facing;
  const bearings = [away, away + Math.PI / 2, away - Math.PI / 2];
  const lanes: number[] = [];
  for (const b of bearings) {
    const lane = spawnFightObject(
      s.ctx,
      s.inst,
      swellLaneTemplate('warn', T.fistCast + H.waveDelay),
      FINAL_NAMES.swell,
      spot.x,
      spot.z,
      H.laneHalf,
    );
    lane.facing = b;
    lanes.push(lane.id);
  }
  st.fist = { objectId: obj.id, x: spot.x, z: spot.z, lanes, bearings };
  beginBar(s, FINAL_CASTS.fist, T.fistCast, away);
  return true;
}

/** The fist lands (its bar ran out or was cut) and its swells begin. Returns
 *  who it struck. */
export function landFist(s: FinalScope): Entity[] {
  const st = s.st;
  const f = st.fist;
  if (!f) return [];
  st.fist = null;
  dropFightObject(s.ctx, s.inst, f.objectId);
  cueAt(s, HEAT_CUES.fist, f.x, f.z, T.fistR);
  const struck: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (Math.hypot(here.x - f.x, here.z - f.z) > T.fistR) continue;
    struck.push(p);
    hit(s, p, roll(s, T.fistMin, T.fistMax), FINAL_NAMES.fist, 'fire');
  }
  f.lanes.forEach((laneId, i) => {
    st.swells.push({
      laneId,
      waveId: null,
      x: f.x,
      z: f.z,
      facing: f.bearings[i],
      delay: H.waveDelay,
      front: 0,
      struck: [],
    });
  });
  return struck;
}

function stepSwell(s: FinalScope, w: FinalSwell): boolean {
  const length = laneReach(w.x, w.z, w.facing, H.laneLength);
  if (w.waveId === null) {
    w.delay -= DT;
    if (w.delay > 1e-9) return true;
    const lane = s.ctx.entities.get(w.laneId);
    if (lane) lane.templateId = swellLaneTemplate('roll', length / H.waveSpeed);
    const wave = spawnFightObject(
      s.ctx,
      s.inst,
      HEAT_OBJECTS.wave,
      FINAL_NAMES.swell,
      w.x,
      w.z,
      H.laneHalf,
    );
    wave.facing = w.facing;
    w.waveId = wave.id;
    cueAt(s, HEAT_CUES.swell, w.x, w.z, H.laneHalf);
  }
  w.front += H.waveSpeed * DT;
  const wave = s.ctx.entities.get(w.waveId);
  const ahead = Math.min(w.front, length);
  if (wave)
    moveFightObject(
      s.ctx,
      s.inst,
      wave,
      w.x + Math.sin(w.facing) * ahead,
      w.z + Math.cos(w.facing) * ahead,
    );
  for (const p of livePlayers(s)) {
    if (w.struck.includes(p.id)) continue;
    const here = at(s, p);
    if (!inWave(w.x, w.z, w.facing, ahead, here.x, here.z)) continue;
    w.struck.push(p.id);
    hit(s, p, roll(s, H.waveMin, H.waveMax), FINAL_NAMES.swell, 'fire');
  }
  return w.front < length + H.waveDepth;
}

/** One tick of every Molten Swell. */
export function stepSwells(s: FinalScope): void {
  const st = s.st;
  if (st.swells.length === 0) return;
  const keep: FinalSwell[] = [];
  for (const w of st.swells) {
    if (stepSwell(s, w)) {
      keep.push(w);
      continue;
    }
    dropFightObject(s.ctx, s.inst, w.laneId);
    dropFightObject(s.ctx, s.inst, w.waveId);
  }
  st.swells = keep;
}

// ---- Fire Whirls ---------------------------------------------------------------------------

/** Three Fire Whirls rise by hashed players. Returns how many. */
export function raiseWhirls(s: FinalScope): number {
  const st = s.st;
  st.kit.whirl = T.whirlEvery;
  const victims = pickPlayers(s, T.whirlCount, st.casts + 401);
  let n = 0;
  victims.forEach((v, i) => {
    const h = finalHash(s.boss.id, st.casts * 13 + i);
    const heading = ((h % 360) * Math.PI) / 180;
    const p = at(s, v);
    // It rises a few yards off them, so the first step is a dodge.
    const spot = onFloor({ x: p.x - Math.sin(heading) * 5, z: p.z - Math.cos(heading) * 5 }, 3);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      whirlTemplate('warn'),
      FINAL_NAMES.whirl,
      spot.x,
      spot.z,
      T.whirlR,
    );
    obj.facing = heading;
    st.whirls.push({
      objectId: obj.id,
      warn: T.whirlWarn,
      life: T.whirlLife,
      heading,
      cooldown: {},
    });
    n++;
  });
  st.casts++;
  return n;
}

/** One tick of every Fire Whirl. */
export function stepWhirls(s: FinalScope): void {
  const st = s.st;
  if (st.whirls.length === 0) return;
  const keep: typeof st.whirls = [];
  for (const w of st.whirls) {
    const obj = s.ctx.entities.get(w.objectId);
    if (!obj) continue;
    if (w.warn > 0) {
      w.warn -= DT;
      if (w.warn <= 1e-9) obj.templateId = whirlTemplate('live');
      keep.push(w);
      continue;
    }
    w.life -= DT;
    if (w.life <= 1e-9) {
      dropFightObject(s.ctx, s.inst, w.objectId);
      continue;
    }
    const p = at(s, obj);
    let next = {
      x: p.x + Math.sin(w.heading) * T.whirlSpeed * DT,
      z: p.z + Math.cos(w.heading) * T.whirlSpeed * DT,
    };
    if (fromCentre(next) > HEART_ROOM.r - T.whirlR) {
      // Off the rim: turn back toward the centre.
      w.heading = facingTo(next, HEART_ROOM);
      obj.facing = w.heading;
      next = onFloor(next, T.whirlR);
    }
    moveFightObject(s.ctx, s.inst, obj, next.x, next.z);
    for (const id of Object.keys(w.cooldown)) {
      const k = Number(id);
      w.cooldown[k] -= DT;
      if (w.cooldown[k] <= 1e-9) delete w.cooldown[k];
    }
    for (const pl of livePlayers(s)) {
      if (w.cooldown[pl.id] !== undefined) continue;
      const here = at(s, pl);
      if (Math.hypot(here.x - next.x, here.z - next.z) > T.whirlR) continue;
      w.cooldown[pl.id] = T.whirlHitEvery;
      hit(s, pl, roll(s, T.whirlMin, T.whirlMax), FINAL_NAMES.whirl, 'fire');
      s.ctx.emit({
        type: 'spellfx',
        sourceId: obj.id,
        targetId: pl.id,
        school: 'fire',
        fx: 'nova',
        ability: FINAL_CUES.whirl,
      });
    }
    keep.push(w);
  }
  st.whirls = keep;
}

// ---- Ember Mark and the pools --------------------------------------------------------------

/** Heroic: mark up to three ranged players. Returns who. */
export function markEmbers(s: FinalScope): Entity[] {
  const st = s.st;
  st.kit.ember = T.emberEvery;
  const boss = at(s, s.boss);
  const ranged = livePlayers(s).filter((p) => {
    const q = at(s, p);
    return Math.hypot(q.x - boss.x, q.z - boss.z) >= T.emberRanged && p.id !== s.boss.aggroTargetId;
  });
  const busy = new Set(
    livePlayers(s)
      .filter((p) => !ranged.includes(p))
      .map((p) => p.id),
  );
  const marked = ranged.length > 0 ? pickPlayers(s, T.emberMarks, st.casts + 501, busy) : [];
  st.casts++;
  for (const p of marked) {
    if (!ranged.includes(p)) continue;
    putMarker(p, FINAL_AURAS.ember, FINAL_NAMES.ember, T.emberSeconds, s.boss.id, {
      school: 'fire',
    });
    st.embers.push({ pid: p.id, left: T.emberSeconds });
  }
  if (st.embers.length > 0)
    raidWarn(
      s,
      'embers',
      'Embers fall at the ranged! Stack the marks in one corner, then move out!',
    );
  return marked.filter((p) => ranged.includes(p));
}

/** A burning pool at (x, z) (the oldest goes out past the cap). */
export function layPool(s: FinalScope, kind: 'ember' | 'forge', x: number, z: number): void {
  const st = s.st;
  const r = kind === 'ember' ? T.emberR : T.forgeFireR;
  const life = kind === 'ember' ? T.emberLife : T.forgeFireLife;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    poolTemplate(kind),
    kind === 'ember' ? FINAL_NAMES.embers : FINAL_NAMES.forgeFire,
    x,
    z,
    r,
  );
  st.pools.push({ objectId: obj.id, kind, x, z, r, life });
  while (st.pools.length > T.poolCap) {
    const old = st.pools.shift();
    if (old) dropFightObject(s.ctx, s.inst, old.objectId);
  }
  cueAt(s, kind === 'ember' ? FINAL_CUES.embers : FINAL_CUES.forgeFire, x, z, r);
}

/** One tick of the marks (their embers drop) and the pools (they burn). */
export function stepEmbersAndPools(s: FinalScope): void {
  const st = s.st;
  if (st.embers.length > 0) {
    const keep: typeof st.embers = [];
    for (const m of st.embers) {
      m.left -= DT;
      if (m.left > 1e-9) {
        keep.push(m);
        continue;
      }
      const p = s.ctx.entities.get(m.pid);
      if (!p) continue;
      dropAura(p, FINAL_AURAS.ember);
      if (p.dead) continue;
      const q = at(s, p);
      layPool(s, 'ember', q.x, q.z);
    }
    st.embers = keep;
  }
  if (st.pools.length === 0) return;
  const keep = st.pools.filter((pool) => {
    pool.life -= DT;
    if (pool.life > 1e-9) return true;
    dropFightObject(s.ctx, s.inst, pool.objectId);
    return false;
  });
  st.pools = keep;
  st.poolTick -= DT;
  if (st.poolTick > 1e-9) return;
  st.poolTick = T.poolTick;
  for (const p of livePlayers(s)) {
    const q = at(s, p);
    const pool = st.pools.find((o) => Math.hypot(q.x - o.x, q.z - o.z) <= o.r);
    if (!pool) continue;
    const [min, max] =
      pool.kind === 'ember' ? [T.emberMin, T.emberMax] : [T.forgeFireMin, T.forgeFireMax];
    hit(
      s,
      p,
      roll(s, min, max),
      pool.kind === 'ember' ? FINAL_NAMES.embers : FINAL_NAMES.forgeFire,
      'fire',
    );
  }
}

/** Mythic: the frontal struck in the Heat quarter: fire where it fell. */
export function forgeFire(s: FinalScope): void {
  const b = at(s, s.boss);
  const f = s.boss.facing;
  const spot = onFloor({ x: b.x + Math.sin(f) * 5, z: b.z + Math.cos(f) * 5 }, 2);
  layPool(s, 'forge', spot.x, spot.z);
}

// ---- the quarter's end and the fight's -----------------------------------------------------

/** Basalt Fist's spot and lanes off the floor, every swell with them. */
export function clearFist(s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const st = s.st;
  if (st.fist) {
    dropFightObject(s.ctx, s.inst, st.fist.objectId);
    for (const id of st.fist.lanes) dropFightObject(s.ctx, s.inst, id);
    st.fist = null;
  }
  for (const w of st.swells) {
    dropFightObject(s.ctx, s.inst, w.laneId);
    dropFightObject(s.ctx, s.inst, w.waveId);
  }
  st.swells = [];
  clearCastIf(s.boss, FINAL_CASTS.fist);
}

/** Every Heat footprint gone (the fight's end). */
export function clearHeat(s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  clearFist(s);
  for (const w of s.st.whirls) dropFightObject(s.ctx, s.inst, w.objectId);
  for (const p of s.st.pools) dropFightObject(s.ctx, s.inst, p.objectId);
  s.st.whirls = [];
  s.st.pools = [];
  s.st.embers = [];
}
