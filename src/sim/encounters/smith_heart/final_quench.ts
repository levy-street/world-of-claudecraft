// The Masterless Strength's Quench quarter (design doc 7.5): stack, with no
// damage split. The Guardian of the Quench's cold, compressed.
//
//   Quenching Cold  while the boss stands in the Quench quarter, everyone
//                   with fewer than two other players within 10 yd grows
//                   cold (a bar, 0 to 100: full in 5 s alone); within reach
//                   of two or more it falls again. Full, the player is
//                   Encased in Rime (an unbreakable stun, 4 s) and struck;
//                   the bar starts over. Away from the quarter the cold
//                   falls and goes.
//   Groaning Ice    Heroic, every 18 s (first 7 s in): the floor under two
//                   hashed players cracks (4 yd); 3 s later it breaks, and
//                   whoever still stands on it falls Under the Ice (a heavy
//                   hit and a 3 s stun).
//   Numbing Frost   Mythic: the boss's frontal (Forge Fist) slows everyone it
//                   strikes by 75 percent for 6 s.
//
// Deterministic: every pick is hashed (pickPlayers); the only rng draws are
// the damage rolls, in player order.

import { MOBS } from '../../data';
import { DT, type Entity } from '../../types';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalTimed,
  FINAL_TUNING as T,
} from './final_ids';
import {
  at,
  auraOf,
  cueAt,
  cueOn,
  dropAura,
  dropFightObject,
  type FinalScope,
  hit,
  livePlayers,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
} from './final_scope';

/** How many other living players stand within `reach` of `p`. */
export function alliesNear(s: FinalScope, p: Entity, reach = T.coldReach): number {
  const q = at(s, p);
  let n = 0;
  for (const o of livePlayers(s)) {
    if (o.id === p.id) continue;
    const r = at(s, o);
    if (Math.hypot(r.x - q.x, r.z - q.z) <= reach) n++;
  }
  return n;
}

function showCold(s: FinalScope, p: Entity, cold: number, trend: number): void {
  const v = Math.round(cold);
  const a = auraOf(p, FINAL_AURAS.cold);
  if (!a) {
    putMarker(p, FINAL_AURAS.cold, FINAL_NAMES.cold, 3600, s.boss.id, {
      permanent: true,
      value: v,
      value2: trend,
      school: 'frost',
    });
    return;
  }
  if (a.value !== v) a.value = v;
  if (a.value2 !== trend) a.value2 = trend;
}

/** Encase `p` in rime: the stun, the hit, the bar starting over. Exported
 *  for the dev trigger. */
export function encase(s: FinalScope, p: Entity): void {
  s.st.cold[p.id] = 0;
  s.st.frozen[p.id] = T.freezeSeconds;
  s.ctx.applyAura(p, {
    id: FINAL_AURAS.frozen,
    name: FINAL_NAMES.frozen,
    kind: 'stun',
    remaining: T.freezeSeconds,
    duration: T.freezeSeconds,
    value: 0,
    sourceId: s.boss.id,
    school: 'frost',
    unbreakableControl: true,
    undispellable: true,
  });
  hit(s, p, roll(s, T.freezeMin, T.freezeMax), FINAL_NAMES.frozen, 'frost');
  cueOn(s, p, FINAL_CUES.freeze, 'frost');
  showCold(s, p, 0, 0);
}

/** One tick of the cold on every player (`active`: the boss is in the
 *  Quench quarter, or the Quench poured into it; `rate` its rise's share:
 *  a poured Quench's is slower, part 2). */
export function stepCold(s: FinalScope, active: boolean, rate = 1): void {
  const st = s.st;
  for (const id of Object.keys(st.frozen)) {
    const k = Number(id);
    st.frozen[k] -= DT;
    if (st.frozen[k] <= 1e-9) delete st.frozen[k];
  }
  for (const p of livePlayers(s)) {
    const was = st.cold[p.id] ?? 0;
    if (!active && was <= 0) {
      if (auraOf(p, FINAL_AURAS.cold)) dropAura(p, FINAL_AURAS.cold);
      continue;
    }
    if (st.frozen[p.id] !== undefined) continue;
    const alone = active && alliesNear(s, p) < T.coldAllies;
    const next = alone
      ? Math.min(T.coldMax, was + T.coldRise * rate * DT)
      : Math.max(0, was - T.coldFall * DT);
    st.cold[p.id] = next;
    if (alone && next >= T.coldMax - 1e-9) {
      encase(s, p);
      continue;
    }
    if (!active && next <= 0) {
      delete st.cold[p.id];
      dropAura(p, FINAL_AURAS.cold);
      continue;
    }
    showCold(s, p, next, alone ? 1 : -1);
  }
}

/** Heroic: the floor under two hashed players cracks. Returns who. */
export function crackIce(s: FinalScope): Entity[] {
  const st = s.st;
  st.kit.ice = T.iceEvery;
  const marked = pickPlayers(s, T.iceMarks, st.casts + 601);
  st.casts++;
  for (const p of marked) {
    const q = at(s, p);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      finalTimed(FINAL_OBJECTS.crackPrefix, T.iceWarn),
      FINAL_NAMES.crack,
      q.x,
      q.z,
      T.iceR,
    );
    st.cracks.push({ objectId: obj.id, x: q.x, z: q.z, left: T.iceWarn });
  }
  if (marked.length > 0) raidWarn(s, 'ice', 'The ice groans under you! Step off before it breaks!');
  return marked;
}

/** One tick of the cracks: each breaks at its time, dropping whoever stands
 *  on it Under the Ice. */
export function stepCracks(s: FinalScope): void {
  const st = s.st;
  if (st.cracks.length === 0) return;
  const keep: typeof st.cracks = [];
  for (const c of st.cracks) {
    c.left -= DT;
    if (c.left > 1e-9) {
      keep.push(c);
      continue;
    }
    dropFightObject(s.ctx, s.inst, c.objectId);
    cueAt(s, FINAL_CUES.iceBreak, c.x, c.z, T.iceR, 'frost');
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - c.x, q.z - c.z) > T.iceR) continue;
      hit(s, p, roll(s, T.iceMin, T.iceMax), FINAL_NAMES.underIce, 'frost');
      if (p.dead) continue;
      s.ctx.applyAura(p, {
        id: FINAL_AURAS.underIce,
        name: FINAL_NAMES.underIce,
        kind: 'stun',
        remaining: T.underIceSeconds,
        duration: T.underIceSeconds,
        value: 0,
        sourceId: s.boss.id,
        school: 'frost',
        unbreakableControl: true,
        undispellable: true,
      });
    }
  }
  st.cracks = keep;
}

/** The players in the boss's frontal arc (its swing cleave's own arc and
 *  reach, off its template). */
export function inFrontal(s: FinalScope): Entity[] {
  const tpl = MOBS[s.boss.templateId];
  const cleave = tpl?.arcCleave;
  if (!cleave) return [];
  const b = at(s, s.boss);
  const half = (cleave.arcDeg * Math.PI) / 360;
  const out: Entity[] = [];
  for (const p of livePlayers(s)) {
    const q = at(s, p);
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d > cleave.range + (tpl?.bodyRadius ?? 0)) continue;
    let da = Math.atan2(q.x - b.x, q.z - b.z) - s.boss.facing;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (d > 0.5 && Math.abs(da) > half) continue;
    out.push(p);
  }
  return out;
}

/** Mythic: the frontal struck in the Quench quarter: Numbing Frost on
 *  everyone in its arc. Returns who. */
export function numbingFrost(s: FinalScope): Entity[] {
  const struck = inFrontal(s);
  for (const p of struck) {
    s.ctx.applyAura(p, {
      id: FINAL_AURAS.numbing,
      name: FINAL_NAMES.numbing,
      kind: 'slow',
      remaining: T.numbingSeconds,
      duration: T.numbingSeconds,
      value: T.numbingSlow,
      sourceId: s.boss.id,
      school: 'frost',
      undispellable: true,
    });
  }
  return struck;
}

/** Every Quench footprint and mark gone (the fight's end). */
export function clearQuench(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  for (const c of s.st.cracks) dropFightObject(s.ctx, s.inst, c.objectId);
  s.st.cracks = [];
  s.st.cold = {};
  s.st.frozen = {};
  for (const p of players) dropAura(p, FINAL_AURAS.cold);
}
