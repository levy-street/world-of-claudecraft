// The Masterless Strength's Quench quarter (design doc 7.5). Its cold
// (Quenching Cold, Encased in Rime) went with the rework of 2026-11-18 (the
// team's review: it read as a mechanic of the ice quarter alone); the
// quarter's star, Crossing Blade, is final_blades.ts.
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
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  hit,
  livePlayers,
  pickPlayers,
  roll,
  spawnFightObject,
} from './final_scope';

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
    // The swing cleave's own reach, from the pivot (mob_swing.ts): its
    // body's edge (FINAL_BODY_RADIUS) is where melee reaches it, never a
    // longer frontal.
    if (d > cleave.range) continue;
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
  for (const p of players) dropAura(p, FINAL_AURAS.numbing);
}
