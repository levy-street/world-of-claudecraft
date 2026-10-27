// Captain Thessaly fights beside the raid against the Guardian of the Breath
// (docs/design/raid/smith_heart.md section 7.2). She stands at the head of
// the Cornice's climb (an NPC: never attacked, never moved by the wind) and,
// through the Wind half only, about every 20 s plants a circle of calm on the
// Cornice, upwind of the guardian for the blow now blowing or the next:
//
//   landing   a 2 s telegraph where it will land (the object's `land` state)
//   holding   6 s; the first three players to step in are anchored for 15 s
//             (no wind, pull, blast or throw moves them: breath_scope.ts
//             anchored); never enough for everyone
//   spent     every seat taken, or its hold run out (it fades)
//   heroic    an anchor that ran out leaves its player spent for 60 s (no
//             circle takes them again), so the raid rotates who holds them
//
// Her lines are breath_voice.ts's. Zero rng: the spot is the geometry's, the
// seats go in roster order to whoever stands in it first.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { nextBearing, thessalyOf, windBlowing } from './breath_gale';
import { calmCircleSpot } from './breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CUES,
  BREATH_NAMES,
  calmTemplate,
  BREATH_TUNING as T,
} from './breath_ids';
import {
  anchored,
  auraOf,
  type BreathScope,
  dropAura,
  dropBreathObject,
  livePlayers,
  local,
  putMarker,
  raidWarn,
  spawnBreathObject,
} from './breath_scope';
import type { BreathFightState } from './breath_state';
import { breathSay, circleMoment } from './breath_voice';

/** Thessaly plants a circle now (her clock, or the dev trigger). Returns
 *  false with no Thessaly in the claim, or once the storm has broken. */
export function plantCalm(s: BreathScope): boolean {
  const thessaly = thessalyOf(s.ctx, s.inst);
  // Her calm cannot hold the storm: nothing once it has broken.
  if (!thessaly || s.st.half !== 'wind') return false;
  clearCalm(s.ctx, s.inst, s.st);
  const bearing = windBlowing(s.st) ? s.st.wind.bearing : nextBearing(s.st);
  const at = calmCircleSpot(local(s.ctx, s.inst, s.boss), bearing);
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    calmTemplate('land', T.circleLand),
    BREATH_NAMES.calm,
    at.x,
    at.z,
    T.circleR,
  );
  s.st.calm = {
    objectId: e.id,
    x: at.x,
    z: at.z,
    state: 'land',
    remaining: T.circleLand,
    seated: [],
  };
  s.st.circleTimer = T.circleEvery;
  const n = Math.round(s.st.clock / T.circleEvery);
  breathSay(s, thessaly, 'thessaly', circleMoment(n));
  raidWarn(
    s,
    thessaly,
    'circle',
    `Captain Thessaly plants a circle of calm! ${T.circleSeats} may stand in it.`,
    { seats: String(T.circleSeats) },
  );
  return true;
}

function setCalmState(s: BreathScope, state: 'land' | 'hold' | 'spent', seconds: number): void {
  const c = s.st.calm;
  if (!c) return;
  c.state = state;
  c.remaining = seconds;
  const e = s.ctx.entities.get(c.objectId);
  if (e) e.templateId = calmTemplate(state, seconds);
}

/** May `pid` take an anchor now? (Not held already, not spent on heroic.) */
function seatable(s: BreathScope, pid: number): boolean {
  const p = s.ctx.entities.get(pid);
  if (!p || anchored(p) || p.carriedBy !== undefined) return false;
  return !auraOf(p, BREATH_AURAS.spent);
}

function stepCalm(s: BreathScope): void {
  const c = s.st.calm;
  if (!c) return;
  c.remaining -= DT;
  if (c.state === 'land') {
    if (c.remaining > 1e-9) return;
    const o = s.ctx.instanceOriginOf(s.inst);
    s.ctx.emit({
      type: 'spellfxAt',
      x: o.x + c.x,
      z: o.z + c.z,
      school: 'holy',
      fx: 'burst',
      radius: T.circleR,
      ability: BREATH_CUES.calmLand,
    });
    setCalmState(s, 'hold', T.circleHold);
    return;
  }
  if (c.remaining <= 1e-9) {
    clearCalm(s.ctx, s.inst, s.st);
    return;
  }
  if (c.state !== 'hold') return;
  const thessaly = thessalyOf(s.ctx, s.inst);
  for (const p of livePlayers(s)) {
    if (c.seated.length >= T.circleSeats) break;
    const at = local(s.ctx, s.inst, p);
    if (Math.hypot(at.x - c.x, at.z - c.z) > T.circleR) continue;
    if (!seatable(s, p.id)) continue;
    c.seated.push(p.id);
    putMarker(
      p,
      BREATH_AURAS.anchor,
      BREATH_NAMES.anchor,
      T.anchorSeconds,
      thessaly?.id ?? s.boss.id,
    );
    if (!s.st.anchors.includes(p.id)) s.st.anchors.push(p.id);
    if (thessaly)
      s.ctx.emit({
        type: 'spellfx',
        sourceId: thessaly.id,
        targetId: p.id,
        school: 'holy',
        fx: 'beam',
        ability: BREATH_CUES.anchor,
      });
  }
  if (c.seated.length >= T.circleSeats) setCalmState(s, 'spent', Math.max(0.5, c.remaining));
}

/** An anchor that ran out: heroic leaves its player spent for a while. */
function stepAnchors(s: BreathScope): void {
  if (s.st.anchors.length === 0) return;
  const keep: number[] = [];
  for (const id of s.st.anchors) {
    const p = s.ctx.entities.get(id);
    if (p && anchored(p)) {
      keep.push(id);
      continue;
    }
    if (p && !p.dead && s.rules.calmSpent)
      putMarker(p, BREATH_AURAS.spent, BREATH_NAMES.spent, T.spentSeconds, s.boss.id);
  }
  s.st.anchors = keep;
}

/** One tick of Thessaly's part: her clock and circle (the Wind half only),
 *  the anchors running out (any half). */
export function stepThessaly(s: BreathScope): void {
  if (s.st.half === 'wind') {
    s.st.circleTimer -= DT;
    if (s.st.circleTimer <= 1e-9 && !s.st.calm) plantCalm(s);
    stepCalm(s);
  } else if (s.st.calm) clearCalm(s.ctx, s.inst, s.st);
  stepAnchors(s);
}

/** Thessaly's circle goes (its hold run out, the storm, a reset). */
export function clearCalm(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  if (!st.calm) return;
  dropBreathObject(ctx, inst, st.calm.objectId);
  st.calm = null;
}

/** Lift every anchor and spent mark off the claim's players (a reset, the
 *  end). */
export function clearAnchors(players: readonly Entity[], st: BreathFightState | null): void {
  for (const p of players) {
    dropAura(p, BREATH_AURAS.anchor);
    dropAura(p, BREATH_AURAS.spent);
  }
  if (st) st.anchors = [];
}
