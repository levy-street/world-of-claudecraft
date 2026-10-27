// The Guardian of the Breath's wind (docs/design/raid/smith_heart.md section
// 7.2): the Wind half of the fight, and the storm's short gusts on heroic.
//
//   The bellows breathes   a blow of 10 s across the whole Cornice toward one
//                          bearing, then a calm (5 s at full health, 3 s at
//                          half), whose last 2.5 s telegraph the next bearing
//                          (the wind object's `gather` phase); then it turns
//                          and blows another way (breath_ids.ts BLOW_BEARINGS).
//   The push               every non-anchored player on the Cornice wears the
//                          kernel's wind aura (src/sim/wind_drift.ts): both
//                          hosts step the same drift, a player walks against
//                          it and keeps casting while it carries them.
//   The rim                where the wall stands, a body pressed against it
//                          takes a hit each second (Pressed to the Rim); at a
//                          gap there is no wall: the body walks off the lip
//                          and falls (the field's lipOpenings), on every
//                          difficulty. Anyone who has gone over is the void's.
//   The indrawn breath     about every 45 s (between blows): a 5 s bar, the
//                          wind turns and draws everyone toward the guardian
//                          (the kernel's pull aura), a vortex before its mouth
//                          bites whoever stands in it; then Bellows Gust (its
//                          old id), a 1.5 s bar and a blast that hurts and
//                          throws everyone outward (the anchored stay put).
//   Heroic                 three loose gales wander the Cornice after each
//                          exhale, tossing whoever they touch (a throw can
//                          carry a body out through a gap); in phase 2, short
//                          gusts return now and then, telegraphed.
//
// The wind's phase, bearing and length ride ONE object's template id
// (breathWindTemplate), so every client draws the telegraph to the tick.
// Zero rng in every pick; the draws are the damage rolls, in player order.

import { BREATH } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../../wind_drift';
import {
  fellFromCornice,
  gapAt,
  inBreathArena,
  looseGalePos,
  pinnedAgainstRim,
} from './breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_NAMES,
  BREATH_OBJECTS,
  type BreathWindPhase,
  blowBearing,
  breathWindOf,
  breathWindTemplate,
  calmSeconds,
  BREATH_TUNING as T,
} from './breath_ids';
import {
  anchored,
  auraOf,
  type BreathScope,
  beginBar,
  corniceListeners,
  dropAura,
  dropBreathObject,
  guardianFree,
  livePlayers,
  local,
  moveBreathObject,
  putMarker,
  raidWarn,
  roll,
  spawnBreathObject,
  throwPlayer,
} from './breath_scope';
import type { BreathFightState } from './breath_state';
import { breathSay } from './breath_voice';

// ---- the wind object ---------------------------------------------------------------------

/** The claim's wind object (spawned with it at the Cornice's middle). */
export function windObject(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId.startsWith(BREATH_OBJECTS.windPrefix)) return e;
  }
  return null;
}

/** Put the wind into `phase` for `seconds` toward `bearing`, and say so on
 *  its object. */
export function setWind(
  s: Pick<BreathScope, 'ctx' | 'inst' | 'st'>,
  phase: BreathWindPhase,
  seconds: number,
  bearing: number = s.st.wind.bearing,
): void {
  const w = s.st.wind;
  w.phase = phase;
  w.remaining = seconds;
  w.total = seconds;
  w.bearing = bearing;
  const obj = windObject(s.ctx, s.inst);
  if (obj) obj.templateId = breathWindTemplate(phase, bearing, seconds);
}

/** The wind object at rest (no fight): still. */
export function stillWind(ctx: SimContext, inst: InstanceSlot): void {
  const obj = windObject(ctx, inst);
  if (obj && breathWindOf(obj.templateId)?.phase !== 'still')
    obj.templateId = breathWindTemplate('still', 0, 0);
}

/** Does the wind push right now (a blow, or a heroic storm gust)? */
export function windBlowing(st: BreathFightState): boolean {
  return st.wind.phase === 'blow' || st.wind.phase === 'gust';
}

/** The bearing the next blow will take (the one a gather telegraphs). */
export function nextBearing(st: BreathFightState): number {
  return blowBearing(st.start, st.wind.blows);
}

/** The calm after a blow: its plain stretch, then the gather telegraphing
 *  the next bearing. */
function beginCalm(s: BreathScope): void {
  const calm = calmSeconds(s.boss.hp / s.boss.maxHp);
  setWind(s, 'calm', Math.max(0.5, calm - T.gatherSeconds), s.st.wind.bearing);
}

/** One tick of the Wind half's cycle (the indrawn breath owns the wind while
 *  its bars run). */
function stepCycle(s: BreathScope): void {
  const w = s.st.wind;
  if (w.phase === 'inhale' || w.phase === 'exhale') return;
  w.remaining -= DT;
  if (w.remaining > 1e-9) return;
  if (w.phase === 'calm' || w.phase === 'still') {
    setWind(s, 'gather', T.gatherSeconds, nextBearing(s.st));
    return;
  }
  if (w.phase === 'gather') {
    const first = w.blows === 0;
    w.blows++;
    setWind(s, 'blow', T.blowSeconds, w.bearing);
    if (first) breathSay(s, s.boss, 'guardian', 'blow');
    return;
  }
  if (w.phase === 'blow') beginCalm(s);
}

/** Phase 2, heroic: the short gusts on their own clock. */
function stepStormGusts(s: BreathScope): void {
  const w = s.st.wind;
  if (w.phase === 'gustgather' || w.phase === 'gust') {
    w.remaining -= DT;
    if (w.remaining > 1e-9) return;
    if (w.phase === 'gustgather') {
      w.blows++;
      setWind(s, 'gust', T.gustSeconds, w.bearing);
    } else setWind(s, 'storm', 0, w.bearing);
    return;
  }
  if (!s.rules.stormGusts) return;
  s.st.gustTimer -= DT;
  if (s.st.gustTimer > 1e-9) return;
  s.st.gustTimer = T.gustEvery;
  setWind(s, 'gustgather', T.gustGather, nextBearing(s.st));
  raidWarn(s, s.boss, 'stormGust', 'A storm gust gathers! Brace against the wind!');
}

// ---- the push, the rim, the void -----------------------------------------------------------

/** How long a wind aura lives between top-ups (s): a body the fight stops
 *  seeing (its claim freed under it) is never carried for long. */
const WIND_AURA_LIFE = 1.5;
/** A wind aura is topped up when it has less than this left (each top-up
 *  moves its deadline on the wire; its value never changes). */
const WIND_AURA_TOPUP = 0.6;

/** Keep a wind aura on `p`: a fresh one when its numbers changed, else its
 *  life topped up now and then. */
function keepWind(
  s: BreathScope,
  p: Entity,
  id: string,
  name: string,
  values: { value: number; value2: number; value3?: number },
): void {
  const a = auraOf(p, id);
  if (a && a.value === values.value && a.value2 === values.value2 && a.value3 === values.value3) {
    if (a.remaining < WIND_AURA_TOPUP) a.remaining = WIND_AURA_LIFE;
    return;
  }
  putMarker(p, id, name, WIND_AURA_LIFE, s.boss.id, values);
}

/** Every player's wind auras for this tick: the blow's (or the pull's) on
 *  the non-anchored on the Cornice; none on anyone else, wherever they went
 *  (a hearth or a teleport mid-blow takes no wind along). */
function syncWindAuras(s: BreathScope): void {
  const w = s.st.wind;
  const blowing = windBlowing(s.st);
  const pulling = w.phase === 'inhale';
  const heading = (w.bearing * Math.PI) / 180;
  const inFight = new Set(s.players.map((p) => p.id));
  for (const meta of s.ctx.players.values()) {
    const p = s.ctx.entities.get(meta.entityId);
    if (!p) continue;
    if (!inFight.has(p.id)) {
      dropWindFrom(p, s.boss.id);
      continue;
    }
    const held = anchored(p) || p.carriedBy !== undefined;
    if (held || !blowing) dropAura(p, WIND_DRIFT_AURA);
    if (held || !pulling) dropAura(p, WIND_PULL_AURA);
    if (held) continue;
    if (blowing)
      keepWind(s, p, WIND_DRIFT_AURA, BREATH_NAMES.wind, {
        value: heading,
        value2: s.rules.windSpeed,
      });
    else if (pulling)
      keepWind(s, p, WIND_PULL_AURA, BREATH_NAMES.pull, {
        value: s.boss.pos.x,
        value2: s.boss.pos.z,
        value3: T.pullSpeed,
      });
  }
}

/** Take the wind and pull auras one guardian put on `p` off it. */
function dropWindFrom(p: Entity, sourceId: number): void {
  if (
    p.auras.some(
      (a) => (a.id === WIND_DRIFT_AURA || a.id === WIND_PULL_AURA) && a.sourceId === sourceId,
    )
  )
    p.auras = p.auras.filter(
      (a) => !((a.id === WIND_DRIFT_AURA || a.id === WIND_PULL_AURA) && a.sourceId === sourceId),
    );
}

/** The wind presses a body against the rim's wall: a hit each second. */
function stepPinned(s: BreathScope): void {
  const st = s.st;
  const blowing = windBlowing(st);
  const heading = (st.wind.bearing * Math.PI) / 180;
  const still = new Set<number>();
  for (const p of livePlayers(s)) {
    if (!blowing || anchored(p)) continue;
    const at = local(s.ctx, s.inst, p);
    if (!pinnedAgainstRim(at.x, at.z, heading)) continue;
    still.add(p.id);
    // Topped up only now and then (each top-up moves its deadline on the
    // wire); a body the wind lets go loses it at once below.
    const pin = auraOf(p, BREATH_AURAS.pinned);
    if (!pin) putMarker(p, BREATH_AURAS.pinned, BREATH_NAMES.pinned, 1.5, s.boss.id);
    else if (pin.remaining < 0.5) pin.remaining = 1.5;
    st.pinned[p.id] = (st.pinned[p.id] ?? 0) + DT;
    if (st.pinned[p.id] + 1e-9 >= T.pinTick) {
      st.pinned[p.id] -= T.pinTick;
      s.ctx.dealDamage(
        s.boss,
        p,
        roll(s, T.pinMin, T.pinMax),
        false,
        'nature',
        BREATH_NAMES.pinned,
        'hit',
        true,
      );
    }
  }
  for (const key of Object.keys(st.pinned)) {
    const id = Number(key);
    if (still.has(id)) continue;
    delete st.pinned[id];
    const p = s.ctx.entities.get(id);
    if (p) dropAura(p, BREATH_AURAS.pinned);
  }
}

/** A body over an open lip falls (the kernel's gravity); once it is well
 *  below the Cornice it is dead, whatever carried it there. Said once each. */
export function stepVoid(s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const p of corniceListeners(s.ctx, s.inst)) {
    if (p.dead || p.ghost) continue;
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    const ly = p.pos.y;
    const off = !inBreathArena(lx, lz) && ly < BREATH.cornice.h - 0.6 && ly > BREATH.cornice.h - 40;
    if (off && !s.st.overLip.includes(p.id) && gapNear(lx, lz)) {
      s.st.overLip.push(p.id);
      s.ctx.emit({
        type: 'spellfxAt',
        x: p.pos.x,
        z: p.pos.z,
        school: 'nature',
        fx: 'burst',
        radius: 2,
        ability: BREATH_CUES.fall,
      });
      raidWarn(s, s.boss, 'fell', `${p.name} is swept into the void!`, { player: p.name });
      const thessaly = thessalyOf(s.ctx, s.inst);
      breathSay(s, thessaly, 'thessaly', 'fall');
    }
    if (fellFromCornice(lx, lz, ly, p.onGround)) {
      s.ctx.dealDamage(null, p, p.hp + p.maxHp * 10, false, 'physical', 'Falling', 'hit', true);
    }
  }
}

/** Is (x, z) by a gap (a body leaving the floor here went over its lip)? */
function gapNear(x: number, z: number): boolean {
  for (const dx of [-3, 0, 3]) for (const dz of [-3, 0, 3]) if (gapAt(x + dx, z + dz)) return true;
  return false;
}

/** Captain Thessaly in this claim, or null. */
export function thessalyOf(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.npcIds) {
    const e = ctx.entities.get(id);
    if (e && e.templateId === 'heart_captain_thessaly') return e;
  }
  return null;
}

// ---- the indrawn breath and the exhale -----------------------------------------------------

/** May the guardian draw breath now (its clock run out, between blows)? */
function inhaleDue(s: BreathScope): boolean {
  const ph = s.st.wind.phase;
  return s.st.inhaleTimer <= 0 && (ph === 'calm' || ph === 'gather' || ph === 'still');
}

/** Begin the indrawn breath: the guardian turns to the raid, plants, and the
 *  wind turns round to draw everyone in. Exported for the dev trigger. */
export function startInhale(s: BreathScope, force = false): boolean {
  if (!guardianFree(s) && !force) return false;
  if (!force && !inhaleDue(s)) return false;
  const b = s.boss;
  // Face the raid (the tank aside): the vortex lies between it and them.
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const p of livePlayers(s)) {
    if (p.id === b.aggroTargetId) continue;
    cx += p.pos.x;
    cz += p.pos.z;
    n++;
  }
  if (n > 0) b.facing = Math.atan2(cx / n - b.pos.x, cz / n - b.pos.z);
  beginBar(s, BREATH_CASTS.inhale, T.inhaleCast, null);
  s.st.inhaleTimer = T.inhaleEvery;
  setWind(s, 'inhale', T.inhaleCast, s.st.wind.bearing);
  const at = local(s.ctx, s.inst, b);
  const vx = at.x + Math.sin(b.facing) * T.vortexAhead;
  const vz = at.z + Math.cos(b.facing) * T.vortexAhead;
  const v = spawnBreathObject(
    s.ctx,
    s.inst,
    BREATH_OBJECTS.vortex,
    BREATH_NAMES.vortex,
    vx,
    vz,
    T.vortexR,
  );
  v.facing = b.facing;
  s.st.vortex = { objectId: v.id, x: vx, z: vz, tick: T.vortexTick };
  raidWarn(s, b, 'inhale', 'The Guardian draws breath! Keep out of the vortex before its mouth!');
  breathSay(s, b, 'guardian', 'inhale');
  breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'inhale');
  return true;
}

/** The vortex bites whoever stands in it, twice a second. */
function stepVortex(s: BreathScope): void {
  const v = s.st.vortex;
  if (!v) return;
  v.tick -= DT;
  if (v.tick > 1e-9) return;
  v.tick += T.vortexTick;
  for (const p of livePlayers(s)) {
    const at = local(s.ctx, s.inst, p);
    if (Math.hypot(at.x - v.x, at.z - v.z) > T.vortexR) continue;
    s.ctx.dealDamage(
      s.boss,
      p,
      roll(s, T.vortexMin, T.vortexMax),
      false,
      'nature',
      BREATH_NAMES.vortex,
      'hit',
      true,
    );
  }
}

/** The indrawn breath lands: the vortex goes, the exhale's bar begins. */
export function landInhale(s: BreathScope): void {
  dropBreathObject(s.ctx, s.inst, s.st.vortex?.objectId ?? null);
  s.st.vortex = null;
  beginBar(s, BREATH_CASTS.gust, T.gustCast, null);
  setWind(s, 'exhale', T.gustCast, s.st.wind.bearing);
  raidWarn(s, s.boss, 'gust', 'Bellows Gust! Brace for the blast!');
}

/** Bellows Gust lands: everyone on the Cornice is struck and thrown outward
 *  (the anchored keep their feet); heroic sets the loose gales running. */
export function landGust(s: BreathScope): void {
  const b = s.boss;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: BREATH_CUES.gust,
  });
  for (const p of livePlayers(s)) {
    s.ctx.dealDamage(
      b,
      p,
      roll(s, T.gustMin, T.gustMax),
      false,
      'nature',
      BREATH_NAMES.gust,
      'hit',
      true,
    );
    if (p.dead) continue;
    let dx = p.pos.x - b.pos.x;
    let dz = p.pos.z - b.pos.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      dx = Math.sin(b.facing);
      dz = Math.cos(b.facing);
      len = 1;
    }
    throwPlayer(s, p, dx / len, dz / len, T.gustThrow);
  }
  if (s.rules.looseGales) startGales(s);
  // The wind comes back: a calm, then the next blow's telegraph.
  beginCalm(s);
}

// ---- heroic: the loose gales ---------------------------------------------------------------

/** Set the loose gales running (heroic, after an exhale; the dev trigger). */
export function startGales(s: BreathScope): void {
  clearGales(s.ctx, s.inst, s.st);
  for (let k = 0; k < T.galeCount; k++) {
    const at = looseGalePos(k + s.st.casts, 0);
    const e = spawnBreathObject(
      s.ctx,
      s.inst,
      BREATH_OBJECTS.gale,
      BREATH_NAMES.gale,
      at.x,
      at.z,
      T.galeR,
    );
    s.st.gales.push({ objectId: e.id, k: k + s.st.casts, t: 0, tossed: {} });
  }
  raidWarn(s, s.boss, 'gales', 'Loose gales tear across the Cornice! Keep clear of them!');
}

function stepGales(s: BreathScope): void {
  const st = s.st;
  if (st.gales.length === 0) return;
  const keep: typeof st.gales = [];
  for (const g of st.gales) {
    g.t += DT;
    const e = s.ctx.entities.get(g.objectId);
    if (!e || g.t >= T.galeSeconds) {
      dropBreathObject(s.ctx, s.inst, g.objectId);
      continue;
    }
    const at = looseGalePos(g.k, g.t);
    moveBreathObject(s.ctx, s.inst, e, at.x, at.z);
    for (const p of livePlayers(s)) {
      const pl = local(s.ctx, s.inst, p);
      const dx = pl.x - at.x;
      const dz = pl.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > T.galeR + 0.5) continue;
      const last = g.tossed[p.id];
      if (last !== undefined && st.clock - last < T.galeEvery) continue;
      g.tossed[p.id] = st.clock;
      s.ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: p.id,
        school: 'nature',
        fx: 'nova',
        ability: BREATH_CUES.toss,
      });
      s.ctx.dealDamage(
        s.boss,
        p,
        roll(s, T.galeMin, T.galeMax),
        false,
        'nature',
        BREATH_NAMES.gale,
        'hit',
        true,
      );
      if (!p.dead) {
        const len = d > 1e-3 ? d : 1;
        throwPlayer(s, p, d > 1e-3 ? dx / len : 0, d > 1e-3 ? dz / len : 1, T.galeThrow);
      }
    }
    keep.push(g);
  }
  st.gales = keep;
}

export function clearGales(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  for (const g of st.gales) dropBreathObject(ctx, inst, g.objectId);
  st.gales = [];
}

// ---- the tick ---------------------------------------------------------------------------------

/** One tick of the wind (both halves): the cycle, the auras, the rim, the
 *  vortex, the gales. The indrawn breath begins from startWindBars. */
export function stepWind(s: BreathScope): void {
  if (s.st.half === 'wind') {
    s.st.inhaleTimer -= DT;
    stepCycle(s);
  } else if (s.st.half === 'storm') stepStormGusts(s);
  syncWindAuras(s);
  stepPinned(s);
  stepVortex(s);
  stepGales(s);
}

/** The Wind half's bar: the indrawn breath when it is due. */
export function startWindBars(s: BreathScope): void {
  if (s.st.half === 'wind' && inhaleDue(s)) startInhale(s);
}

/** Take every wind aura and pin off the claim's players. */
export function clearWindAuras(ctx: SimContext, inst: InstanceSlot, bossId: number): void {
  for (const p of corniceListeners(ctx, inst)) dropAura(p, BREATH_AURAS.pinned);
  // The wind wherever its players went.
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p) dropWindFrom(p, bossId);
  }
}
