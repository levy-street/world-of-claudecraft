// The Guardian of the Heat's Basalt Fist and its Molten Swells (docs/design/
// raid/smith_heart.md section 7.4), phases 1 to 3.
//
//   Basalt Fist    every 22 s (first 8 s into the fight) a 3 s bar, planted,
//                  its facing locked on a spot on the shore: where a hashed
//                  player (never the tank while anyone else stands) stood as
//                  it began. Heroic and Mythic mark TWO (Jose's call of
//                  2026-11-25, HEAT_DIFFICULTY `fistMarks`): a second spot
//                  where another marked player stands, at least
//                  FIST_TWIN_APART from the first, slammed with it, its own
//                  swells rolling from it. The spot shows at its exact radius, and the
//                  three lanes its swells will roll down show with it. At the
//                  end of the bar the fist slams the spot: whoever is inside
//                  its radius takes a lethal blow.
//   Molten Swell   0.6 s after the slam three walls of molten rock roll out
//                  from the spot, one straight away from the wellspring and
//                  one to either side, 32 yd at 10 yd a second: a wall
//                  strikes each player it rolls over once. The raid stands in
//                  the gaps between the lanes (the side toward the guardian
//                  is always clear).
//   Held           (pass 5, the owner's call) the fist never comes while
//                  Wakefire warns or burns or the Wheel of the Hearth turns
//                  (since 2026-11-18), nor when its swells would still
//                  roll as the next run begins: its due cast waits for the
//                  run to end (at most one run and the lookahead, so it is
//                  never starved), and the next comes that much sooner (never
//                  under half the cadence), so the 22 s rhythm holds.
//
// Deterministic: the target is hashed (pickPlayers), the bearings are the
// geometry's; the only rng draws are the damage rolls, in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import { facingTo, type HPoint, inWave, swellBearings, wellDistance } from './heat_geometry';
import {
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_LIP_WALL,
  HEAT_NAMES,
  HEAT_OBJECTS,
  heatTimed,
  swellLaneTemplate,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  beginBar,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  local,
  moveFightObject,
  pickPlayers,
  punishMult,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatFightState, HeatFist, HeatSwell } from './heat_state';
import { heatSay } from './heat_voice';

/** How long a Basalt Fist holds the floor from its cast: its bar, the
 *  swells' delay and their roll to the lane's end and past it. */
export const FIST_SPAN = T.fistCast + T.waveDelay + (T.laneLength + T.waveDepth) / T.waveSpeed;

/** Does the floor hold a due Basalt Fist back? While a Wakefire run is laying
 *  its bands or any band warns or burns, while a Wheel of the Hearth turns,
 *  and (where the phase runs them, `kit`) when the next Wakefire run or Wheel
 *  would begin before the fist's swells are done, so the raid never dodges a
 *  lane and a band or a slice at once. */
export function floorHoldsFist(
  st: Pick<HeatFightState, 'zoneRun' | 'zones' | 'zoneTimer' | 'wheelRounds' | 'wheelTimer'>,
  kit: { zones: boolean; wheel: boolean },
): boolean {
  if (st.zoneRun || st.zones.length > 0 || st.wheelRounds.length > 0) return true;
  if (kit.zones && st.zoneTimer < FIST_SPAN) return true;
  return kit.wheel && st.wheelTimer < FIST_SPAN;
}

/** Where the fist comes down for a player standing at `p`: their spot,
 *  pushed out of the wellspring and its lip wall onto the shore (nobody
 *  stands inside the wall; a dev spot may). */
export function fistSpot(p: HPoint): HPoint {
  const d = wellDistance(p.x, p.z);
  const min = HEAT_LIP_WALL.outer;
  if (d >= min) return { x: p.x, z: p.z };
  const f = d > 1e-6 ? facingTo(HEARTH_WELL, p) : Math.PI / 2;
  return { x: HEARTH_WELL.x + Math.sin(f) * min, z: HEARTH_WELL.z + Math.cos(f) * min };
}

/** How far apart two marked fists' spots must lie (yards): their slams and
 *  their swells' starts read as two, never one blot. */
export const FIST_TWIN_APART = T.fistR * 2 + 4;

/** Lay one fist's spot and its lanes at `spot` (its object and lane
 *  objects spawned). */
function layFist(s: HeatScope, spot: HPoint): HeatFist {
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    heatTimed(HEAT_OBJECTS.fistPrefix, T.fistCast),
    HEAT_NAMES.fist,
    spot.x,
    spot.z,
    T.fistR,
  );
  const bearings = swellBearings(spot);
  const lanes: number[] = [];
  for (const b of bearings) {
    const lane = spawnFightObject(
      s.ctx,
      s.inst,
      swellLaneTemplate('warn', T.fistCast + T.waveDelay),
      HEAT_NAMES.swell,
      spot.x,
      spot.z,
      T.laneHalf,
    );
    lane.facing = b;
    lanes.push(lane.id);
  }
  return { objectId: obj.id, x: spot.x, z: spot.z, lanes, bearings };
}

/** Begin Basalt Fist at the spot of a hashed player (or `forced`, a dev
 *  spot), and on Heroic and Mythic a second at another marked player's spot
 *  well apart from it (never the tank while anyone else stands). Returns
 *  false with nobody to aim at. Exported for the dev trigger (its own
 *  spots: `forced`, and `forcedTwin` for the second). */
export function startFist(s: HeatScope, forced?: HPoint, forcedTwin?: HPoint): boolean {
  const st = s.st;
  st.fistTimer = T.fistEvery;
  let aim: HPoint | null = forced ?? null;
  let twin: HPoint | null = forcedTwin ? fistSpot(forcedTwin) : null;
  if (!aim) {
    const victims = pickPlayers(s, Math.max(1, s.rules.fistMarks) + 3, st.fists + 101);
    const first = victims[0];
    if (!first) return false;
    aim = at(s, first);
    if (s.rules.fistMarks >= 2) {
      const spot0 = fistSpot(aim);
      for (const v of victims.slice(1)) {
        const here = fistSpot(at(s, v));
        if (Math.hypot(here.x - spot0.x, here.z - spot0.z) < FIST_TWIN_APART) continue;
        twin = here;
        break;
      }
    }
  }
  st.fists++;
  // Time spent waiting out Wakefire or the Wheel comes off the next one's wait.
  st.fistTimer = Math.max(T.fistEvery / 2, T.fistEvery - st.fistHeld);
  st.fistHeld = 0;
  const spot = fistSpot(aim);
  st.fist = layFist(s, spot);
  st.fistTwin = twin ? layFist(s, twin) : null;
  const here = local(s.ctx, s.inst, s.boss);
  beginBar(s, HEAT_CASTS.fist, T.fistCast, facingTo(here, spot));
  heatSay(s, s.boss, 'fist');
  return true;
}

/** One fist slams its spot and its swells begin; whoever it struck goes
 *  into `hit`. */
function slamFist(s: HeatScope, f: HeatFist, hit: Entity[]): void {
  const st = s.st;
  dropFightObject(s.ctx, s.inst, f.objectId);
  cueAt(s, HEAT_CUES.fist, f.x, f.z, T.fistR);
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (Math.hypot(here.x - f.x, here.z - f.z) > T.fistR) continue;
    if (!hit.includes(p)) hit.push(p);
    fireHit(s, p, roll(s, T.fistMin, T.fistMax, punishMult(s)), HEAT_NAMES.fist);
  }
  f.lanes.forEach((laneId, i) => {
    st.swells.push({
      laneId,
      waveId: null,
      x: f.x,
      z: f.z,
      facing: f.bearings[i],
      delay: T.waveDelay,
      front: 0,
      struck: [],
    });
  });
}

/** The fist slams its spot (its bar ran out, or was cut: the slam lands all
 *  the same), the twin's with it, and their swells begin. Returns who the
 *  slams struck. */
export function landFist(s: HeatScope): Entity[] {
  const st = s.st;
  const hit: Entity[] = [];
  for (const f of [st.fist, st.fistTwin]) if (f) slamFist(s, f, hit);
  st.fist = null;
  st.fistTwin = null;
  return hit;
}

/** One swell's tick: its delay, then its wave rolling and striking. Returns
 *  true while it still rolls. */
function stepSwell(s: HeatScope, w: HeatSwell): boolean {
  if (w.waveId === null) {
    w.delay -= DT;
    if (w.delay > 1e-9) return true;
    const lane = s.ctx.entities.get(w.laneId);
    if (lane) lane.templateId = swellLaneTemplate('roll', T.laneLength / T.waveSpeed);
    const wave = spawnFightObject(
      s.ctx,
      s.inst,
      HEAT_OBJECTS.wave,
      HEAT_NAMES.swell,
      w.x,
      w.z,
      T.laneHalf,
    );
    wave.facing = w.facing;
    w.waveId = wave.id;
    cueAt(s, HEAT_CUES.swell, w.x, w.z, T.laneHalf);
  }
  w.front += T.waveSpeed * DT;
  const wave = s.ctx.entities.get(w.waveId);
  if (wave) {
    const ahead = Math.min(w.front, T.laneLength);
    moveFightObject(
      s.ctx,
      s.inst,
      wave,
      w.x + Math.sin(w.facing) * ahead,
      w.z + Math.cos(w.facing) * ahead,
    );
  }
  for (const p of livePlayers(s)) {
    if (w.struck.includes(p.id)) continue;
    const here = at(s, p);
    if (!inWave(w.x, w.z, w.facing, Math.min(w.front, T.laneLength), here.x, here.z)) continue;
    w.struck.push(p.id);
    fireHit(s, p, roll(s, T.waveMin, T.waveMax), HEAT_NAMES.swell);
  }
  return w.front < T.laneLength + T.waveDepth;
}

/** One tick of every Molten Swell. */
export function stepSwells(s: HeatScope): void {
  const st = s.st;
  if (st.swells.length === 0) return;
  const keep: HeatSwell[] = [];
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

/** Basalt Fist's spot and lanes off the floor (a bar cut before it landed by
 *  an overflow, or the fight's end), and every swell with them. */
export function clearFist(s: Pick<HeatScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const st = s.st;
  for (const f of [st.fist, st.fistTwin]) {
    if (!f) continue;
    dropFightObject(s.ctx, s.inst, f.objectId);
    for (const id of f.lanes) dropFightObject(s.ctx, s.inst, id);
  }
  st.fist = null;
  st.fistTwin = null;
  for (const w of st.swells) {
    dropFightObject(s.ctx, s.inst, w.laneId);
    dropFightObject(s.ctx, s.inst, w.waveId);
  }
  st.swells = [];
  clearCastIf(s.boss, HEAT_CASTS.fist);
}
