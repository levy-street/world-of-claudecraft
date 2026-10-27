// The Guardian of the Breath's Storm (docs/design/raid/smith_heart.md section
// 7.2): at half health the storm breaks, then the second half of the fight.
//
//   The storm breaks   a 4 s bar (planted): the guardian draws in all the
//                      wind (it stops at once: no blow, no pull, no circle),
//                      freezes, then tears open into a body of lightning (an
//                      aura on it every client draws). For 10 s strikes fall
//                      across the Cornice on telegraphed spots (one on a
//                      player each volley, one on the floor).
//   Leaping Bolt       a 2.5 s bar at a player: the bolt strikes them, then
//                      jumps to the nearest player within 8 yd, again and
//                      again (breath_ids.ts forkPath): spread.
//   Thunder's Cradle   a 1.5 s bar at a player: they are lifted into the
//                      storm (carried, an unbreakable stun) over a gather
//                      circle; 6 s on, the discharge is split between
//                      everyone under it, the lifted included. Too few under
//                      it: each share heavier and a backlash over the whole
//                      Cornice (lethal for one or two). Gather, then spread.
//   Drawn Lightning    a 1 s bar at a player: for 10 s a strike falls at their
//                      feet every 2 s, each leaving charged ground that bites
//                      for 18 s: they lead the strikes to the edge.
//   The swelling storm every 5 s the whole Cornice is struck, each pulse 8
//                      percent harder than the first, without end: the soft
//                      enrage.
//
// Zero rng in every pick (hashed marks, hashed spots); the draws are the
// damage rolls, in player order.

import { carryBody, setDownBody } from '../../carried_body';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { clearWindAuras, setWind, thessalyOf } from './breath_gale';
import { barrageSpot, breathHash } from './breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_NAMES,
  BREATH_OBJECTS,
  cradleShare,
  forkPath,
  swellMult,
  BREATH_TUNING as T,
  timedTemplate,
} from './breath_ids';
import {
  type BreathScope,
  beginBar,
  corniceListeners,
  dropAura,
  dropBreathObject,
  guardianFree,
  livePlayers,
  living,
  local,
  pickMarks,
  putMarker,
  raidWarn,
  roll,
  spawnBreathObject,
} from './breath_scope';
import type { BreathFightState, BreathSpot } from './breath_state';
import { clearCalm } from './breath_thessaly';
import { breathSay } from './breath_voice';

// ---- the storm breaks ---------------------------------------------------------------------

/** Is the storm due (half health, the Wind half, the guardian free)? */
export function stormDue(s: BreathScope): boolean {
  return s.st.half === 'wind' && s.boss.hp <= s.boss.maxHp * T.stormAt && guardianFree(s);
}

/** Begin the storm's breaking: the wind drawn in, the guardian frozen on its
 *  bar. Exported for the dev trigger. */
export function startStorm(s: BreathScope): boolean {
  if (s.st.half !== 'wind') return false;
  const st = s.st;
  st.half = 'break';
  clearWindAuras(s.ctx, s.inst, s.boss.id);
  clearCalm(s.ctx, s.inst, st);
  dropBreathObject(s.ctx, s.inst, st.vortex?.objectId ?? null);
  st.vortex = null;
  setWind(s, 'break', T.stormCast, st.wind.bearing);
  beginBar(s, BREATH_CASTS.storm, T.stormCast, null);
  raidWarn(s, s.boss, 'storm', 'The storm breaks! Lightning will fall across the Cornice!');
  breathSay(s, s.boss, 'guardian', 'storm');
  breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'storm');
  return true;
}

/** The bar lands: the guardian tears open into its storm body; the barrage
 *  begins and the Storm's clocks start. */
export function landStorm(s: BreathScope): void {
  const st = s.st;
  const b = s.boss;
  st.half = 'storm';
  putMarker(b, BREATH_AURAS.stormForm, BREATH_NAMES.stormForm, 3600, b.id, { permanent: true });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: BREATH_CUES.tear,
  });
  st.barrage = { remaining: T.barrageSeconds, next: 0, volleys: 0 };
  setWind(s, 'storm', 0, st.wind.bearing);
  st.forkTimer = T.barrageSeconds + T.forkFirst;
  st.cradleTimer = T.barrageSeconds + T.cradleFirst;
  st.drawnTimer = T.barrageSeconds + T.drawnFirst;
  // The swell counts only once the barrage is over (stepStorm).
  st.swellTimer = T.swellEvery;
  st.gustTimer = T.barrageSeconds + T.gustFirst;
}

function spawnStrike(s: BreathScope, x: number, z: number, kind: 'barrage' | 'drawn'): void {
  const warn = kind === 'barrage' ? T.strikeWarn : T.drawnWarn;
  const r = kind === 'barrage' ? T.strikeR : T.drawnR;
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    timedTemplate(BREATH_OBJECTS.strikePrefix, warn),
    kind === 'barrage' ? BREATH_NAMES.strike : BREATH_NAMES.drawn,
    x,
    z,
    r,
  );
  s.st.spots.push({ objectId: e.id, x, z, r, remaining: warn, kind, tick: 0 });
}

function stepBarrage(s: BreathScope): void {
  const bar = s.st.barrage;
  if (!bar) return;
  bar.remaining -= DT;
  bar.next -= DT;
  if (bar.remaining <= 0) {
    s.st.barrage = null;
    return;
  }
  if (bar.next > 1e-9) return;
  bar.next += T.barrageEvery;
  const salt = s.boss.id * 7 + s.st.casts;
  // One on a player (where they stand now: they step out of it), the rest
  // hashed over the floor.
  if (s.players.length > 0) {
    const p = s.players[breathHash(salt, bar.volleys) % s.players.length];
    const at = local(s.ctx, s.inst, p);
    spawnStrike(s, at.x, at.z, 'barrage');
  }
  for (let k = 1; k < T.barrageSpots; k++) {
    const at = barrageSpot(salt, bar.volleys * T.barrageSpots + k);
    spawnStrike(s, at.x, at.z, 'barrage');
  }
  bar.volleys++;
}

/** Every strike's warning and landing, and the charged ground's bite. */
function stepSpots(s: BreathScope): void {
  const st = s.st;
  if (st.spots.length === 0) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  const keep: BreathSpot[] = [];
  const fresh: BreathSpot[] = [];
  for (const sp of st.spots) {
    sp.remaining -= DT;
    if (sp.kind === 'charged') {
      if (sp.remaining <= 0) {
        dropBreathObject(s.ctx, s.inst, sp.objectId);
        continue;
      }
      sp.tick -= DT;
      if (sp.tick <= 1e-9) {
        sp.tick += T.chargedTick;
        for (const p of livePlayers(s)) {
          const at = local(s.ctx, s.inst, p);
          if (Math.hypot(at.x - sp.x, at.z - sp.z) > sp.r) continue;
          s.ctx.dealDamage(
            s.boss,
            p,
            roll(s, T.chargedMin, T.chargedMax),
            false,
            'nature',
            BREATH_NAMES.charged,
            'hit',
            true,
          );
        }
      }
      keep.push(sp);
      continue;
    }
    if (sp.remaining > 1e-9) {
      keep.push(sp);
      continue;
    }
    // A strike lands.
    dropBreathObject(s.ctx, s.inst, sp.objectId);
    s.ctx.emit({
      type: 'spellfxAt',
      x: o.x + sp.x,
      z: o.z + sp.z,
      school: 'nature',
      fx: 'burst',
      radius: sp.r,
      ability: BREATH_CUES.strike,
    });
    const barrage = sp.kind === 'barrage';
    for (const p of livePlayers(s)) {
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - sp.x, at.z - sp.z) > sp.r) continue;
      s.ctx.dealDamage(
        s.boss,
        p,
        barrage ? roll(s, T.strikeMin, T.strikeMax) : roll(s, T.drawnMin, T.drawnMax),
        false,
        'nature',
        barrage ? BREATH_NAMES.strike : BREATH_NAMES.drawn,
        'hit',
        true,
      );
    }
    if (!barrage) {
      const e = spawnBreathObject(
        s.ctx,
        s.inst,
        timedTemplate(BREATH_OBJECTS.chargedPrefix, T.chargedSeconds),
        BREATH_NAMES.charged,
        sp.x,
        sp.z,
        T.chargedR,
      );
      fresh.push({
        objectId: e.id,
        x: sp.x,
        z: sp.z,
        r: T.chargedR,
        remaining: T.chargedSeconds,
        kind: 'charged',
        tick: T.chargedTick,
      });
    }
  }
  st.spots = keep.concat(fresh);
}

// ---- Leaping Bolt ---------------------------------------------------------------------------

/** Begin the Leaping Bolt on a hashed player. Exported for the dev trigger. */
export function startFork(s: BreathScope): boolean {
  const [t] = pickMarks(s, 1);
  if (!t) return false;
  beginBar(s, BREATH_CASTS.fork, T.forkCast, t.id);
  s.st.forkTimer = T.forkEvery;
  raidWarn(s, s.boss, 'fork', `Leaping Bolt on ${t.name}! Spread out!`, { player: t.name });
  return true;
}

/** The bolt lands and forks. Returns the path it took (the tests read it). */
export function landFork(s: BreathScope, targetId: number | null): Entity[] {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!living(t)) return [];
  const path = forkPath(t, livePlayers(s));
  let from: Entity = s.boss;
  for (const p of path) {
    s.ctx.emit({
      type: 'spellfx',
      sourceId: from.id,
      targetId: p.id,
      school: 'nature',
      fx: 'beam',
      ability: BREATH_CUES.fork,
    });
    s.ctx.dealDamage(
      s.boss,
      p,
      roll(s, T.forkMin, T.forkMax),
      false,
      'nature',
      BREATH_NAMES.fork,
      'hit',
      true,
    );
    from = p;
  }
  return path;
}

// ---- Thunder's Cradle -----------------------------------------------------------------------

/** Begin the Cradle on a hashed player (never one already held). Exported
 *  for the dev trigger. */
export function startCradle(s: BreathScope): boolean {
  if (s.st.cradle) return false;
  const busy = new Set(s.st.drawn ? [s.st.drawn.playerId] : []);
  const [t] = pickMarks(s, 1, busy);
  if (!t) return false;
  beginBar(s, BREATH_CASTS.cradle, T.cradleCast, t.id);
  s.st.cradleTimer = T.cradleEvery;
  return true;
}

/** The bar lands: its player is lifted over the gather circle. */
export function landCradle(s: BreathScope, targetId: number | null): void {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!living(t) || t.carriedBy !== undefined) return;
  const at = local(s.ctx, s.inst, t);
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    timedTemplate(BREATH_OBJECTS.cradlePrefix, T.cradleHold),
    BREATH_NAMES.cradle,
    at.x,
    at.z,
    T.cradleR,
  );
  carryBody(t, e.id);
  s.ctx.applyAura(t, {
    id: BREATH_AURAS.cradled,
    name: BREATH_NAMES.cradle,
    kind: 'stun',
    remaining: T.cradleHold + 0.5,
    duration: T.cradleHold + 0.5,
    value: 0,
    sourceId: s.boss.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  s.st.cradle = { playerId: t.id, objectId: e.id, x: at.x, z: at.z, remaining: T.cradleHold };
  raidWarn(s, s.boss, 'cradle', `${t.name} is lifted into the storm! Gather beneath them!`, {
    player: t.name,
  });
  breathSay(s, s.boss, 'guardian', 'cradle');
}

/** The lifted body hangs over its circle; at the end the discharge. */
function stepCradle(s: BreathScope): void {
  const c = s.st.cradle;
  if (!c) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  const t = s.ctx.entities.get(c.playerId);
  const floor = s.ctx.groundPos(o.x + c.x, o.z + c.z).y;
  c.remaining -= DT;
  if (t && !t.dead && t.carriedBy === c.objectId) {
    const k = Math.min(1, (T.cradleHold - c.remaining) / 0.8);
    t.pos.x = o.x + c.x;
    t.pos.z = o.z + c.z;
    t.pos.y = floor + T.cradleLift * k * k * (3 - 2 * k);
    s.ctx.rebucket(t);
  }
  if (c.remaining > 1e-9) return;
  dischargeCradle(s, c, floor);
}

/** The discharge: split between everyone under the circle (the lifted one
 *  counts), heavier and with a backlash if too few gathered. Returns the
 *  soakers (the tests read it). */
export function dischargeCradle(
  s: BreathScope,
  c: NonNullable<BreathFightState['cradle']>,
  floor: number,
): Entity[] {
  const o = s.ctx.instanceOriginOf(s.inst);
  const lifted = s.ctx.entities.get(c.playerId);
  const under = livePlayers(s).filter((p) => {
    if (p.id === c.playerId) return true;
    const at = local(s.ctx, s.inst, p);
    return Math.hypot(at.x - c.x, at.z - c.z) <= T.cradleR;
  });
  if (lifted && !lifted.dead && !under.includes(lifted)) under.push(lifted);
  const share = cradleShare(under.length, s.rules.cradleSoakers);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + c.x,
    z: o.z + c.z,
    school: 'nature',
    fx: 'burst',
    radius: T.cradleR,
    ability: BREATH_CUES.discharge,
  });
  for (const p of under)
    s.ctx.dealDamage(
      s.boss,
      p,
      Math.max(1, Math.round(share.each * s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1))),
      false,
      'nature',
      BREATH_NAMES.cradle,
      'hit',
      true,
    );
  if (share.backlash)
    for (const p of livePlayers(s))
      s.ctx.dealDamage(
        s.boss,
        p,
        roll(s, T.backlashMin, T.backlashMax),
        false,
        'nature',
        BREATH_NAMES.backlash,
        'hit',
        true,
      );
  releaseCradle(s.ctx, s.inst, s.st, floor);
  return under;
}

/** Set the lifted body down and take the circle away. */
export function releaseCradle(
  ctx: SimContext,
  inst: InstanceSlot,
  st: BreathFightState,
  floor?: number,
): void {
  const c = st.cradle;
  if (!c) return;
  const o = ctx.instanceOriginOf(inst);
  const t = ctx.entities.get(c.playerId);
  if (t && t.carriedBy === c.objectId) {
    setDownBody(t, floor ?? ctx.groundPos(o.x + c.x, o.z + c.z).y);
    ctx.rebucket(t);
  }
  if (t) dropAura(t, BREATH_AURAS.cradled);
  dropBreathObject(ctx, inst, c.objectId);
  st.cradle = null;
}

// ---- Drawn Lightning ------------------------------------------------------------------------

/** Begin Drawn Lightning on a hashed player. Exported for the dev trigger. */
export function startDrawn(s: BreathScope): boolean {
  if (s.st.drawn) return false;
  const busy = new Set(s.st.cradle ? [s.st.cradle.playerId] : []);
  const [t] = pickMarks(s, 1, busy);
  if (!t) return false;
  beginBar(s, BREATH_CASTS.drawn, T.drawnCast, t.id);
  s.st.drawnTimer = T.drawnEvery;
  return true;
}

export function landDrawn(s: BreathScope, targetId: number | null): void {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!living(t)) return;
  putMarker(t, BREATH_AURAS.drawn, BREATH_NAMES.drawn, T.drawnSeconds, s.boss.id);
  s.st.drawn = { playerId: t.id, remaining: T.drawnSeconds, next: 0 };
  raidWarn(s, s.boss, 'drawn', `Drawn Lightning on ${t.name}! Lead the strikes to the edge!`, {
    player: t.name,
  });
  breathSay(s, s.boss, 'guardian', 'drawn');
}

function stepDrawn(s: BreathScope): void {
  const d = s.st.drawn;
  if (!d) return;
  const t = s.ctx.entities.get(d.playerId);
  d.remaining -= DT;
  d.next -= DT;
  if (!living(t) || d.remaining <= 1e-9) {
    if (t) dropAura(t, BREATH_AURAS.drawn);
    s.st.drawn = null;
    return;
  }
  if (d.next > 1e-9) return;
  d.next += T.drawnStrikeEvery;
  const at = local(s.ctx, s.inst, t);
  spawnStrike(s, at.x, at.z, 'drawn');
}

// ---- the swelling storm ---------------------------------------------------------------------

function stepSwell(s: BreathScope): void {
  const st = s.st;
  st.swellTimer -= DT;
  if (st.swellTimer > 1e-9) return;
  st.swellTimer += T.swellEvery;
  const mult = swellMult(st.swellPulses);
  st.swellPulses++;
  const b = s.boss;
  const have = b.auras.find((a) => a.id === BREATH_AURAS.swell);
  if (have) have.stacks = st.swellPulses;
  else
    putMarker(b, BREATH_AURAS.swell, BREATH_NAMES.swell, 3600, b.id, {
      permanent: true,
      stacks: st.swellPulses,
    });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: BREATH_CUES.swell,
  });
  for (const p of livePlayers(s))
    s.ctx.dealDamage(
      b,
      p,
      roll(s, T.swellMin, T.swellMax, mult),
      false,
      'nature',
      BREATH_NAMES.swell,
      'hit',
      true,
    );
}

// ---- the tick ---------------------------------------------------------------------------------

/** One tick of the storm's parts (the spots in any half: a strike in flight
 *  still lands). */
export function stepStorm(s: BreathScope): void {
  stepSpots(s);
  stepCradle(s);
  stepDrawn(s);
  if (s.st.half !== 'storm') return;
  stepBarrage(s);
  s.st.forkTimer -= DT;
  s.st.cradleTimer -= DT;
  s.st.drawnTimer -= DT;
  if (!s.st.barrage) stepSwell(s);
}

/** The Storm half's bars, the most demanding first. */
export function startStormBars(s: BreathScope): void {
  if (s.st.half !== 'storm' || s.st.barrage || !guardianFree(s)) return;
  if (s.st.cradleTimer <= 0 && startCradle(s)) return;
  if (s.st.drawnTimer <= 0 && startDrawn(s)) return;
  if (s.st.forkTimer <= 0) startFork(s);
}

/** Every strike, every patch of charged ground, the cradle and the mark go
 *  (a reset, the end). */
export function clearStorm(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  for (const sp of st.spots) dropBreathObject(ctx, inst, sp.objectId);
  st.spots = [];
  st.barrage = null;
  releaseCradle(ctx, inst, st);
  if (st.drawn) {
    const t = ctx.entities.get(st.drawn.playerId);
    if (t) dropAura(t, BREATH_AURAS.drawn);
    st.drawn = null;
  }
  for (const p of corniceListeners(ctx, inst)) dropAura(p, BREATH_AURAS.drawn);
}
