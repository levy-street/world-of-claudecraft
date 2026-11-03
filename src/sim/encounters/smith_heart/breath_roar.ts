// The Summit Roar's travelling wave (the Guardian of the Breath, design doc
// 7.2; the third pass of 2026-11-03): the exhale no longer strikes the whole
// Cornice in one tick. It leaves the guardian's maw as a ring racing out
// over the floor at BREATH_TUNING.roarSpeed; as its front reaches each
// player that player takes the blow and is thrown straight away from the
// guardian, the throw SLIDING over BREATH_TUNING.roarSlide seconds (the
// knockback's walker a step each tick), so every client sees the wave travel,
// hit bodies in turn and fling them, instead of a blink to the edge. A throw
// that carries a body past an open lip leaves it in the air over the void
// (throwPlayer), the rest of the throw its flight as it falls. The anchored and the
// Knotted Gale's carrier keep their feet (throwPlayer), yet the blow lands.
// Zero rng but the damage rolls (in player order, as each is struck).

import { DT } from '../../types';
import { BREATH_CUES, BREATH_NAMES, BREATH_TUNING as T } from './breath_ids';
import { type BreathScope, livePlayers, roll, throwPlayer } from './breath_scope';

/** Seconds the wave's front takes to reach `distance` yards. */
export function roarArrival(distance: number): number {
  return Math.max(0, distance) / T.roarSpeed;
}

/** The wave leaves the maw (the exhale lands): its reach is the furthest
 *  living player's distance (plus a body), so it ends once all are struck. */
export function startRoar(s: BreathScope): void {
  const b = s.boss;
  let reach = 0;
  for (const p of livePlayers(s))
    reach = Math.max(reach, Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z));
  s.st.roar = { x: b.pos.x, z: b.pos.z, r: 0, reach: reach + 1, struck: [], slides: [] };
}

/** One tick of the wave: its front moves out, strikes whoever it reaches,
 *  and every throw in flight slides a step. */
export function stepRoar(s: BreathScope): void {
  const w = s.st.roar;
  if (!w) return;
  const b = s.boss;
  if (w.r < w.reach) {
    w.r += T.roarSpeed * DT;
    for (const p of livePlayers(s)) {
      if (w.struck.includes(p.id)) continue;
      let dx = p.pos.x - w.x;
      let dz = p.pos.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > w.r) continue;
      w.struck.push(p.id);
      s.ctx.emit({
        type: 'spellfx',
        sourceId: b.id,
        targetId: p.id,
        school: 'nature',
        fx: 'nova',
        ability: BREATH_CUES.roarHit,
      });
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
      if (d < 1e-3) {
        dx = Math.sin(b.facing);
        dz = Math.cos(b.facing);
      } else {
        dx /= d;
        dz /= d;
      }
      const throwYards = s.rules.gustThrow;
      const steps = Math.max(1, Math.round(T.roarSlide / DT));
      w.slides.push({ id: p.id, ux: dx, uz: dz, left: throwYards, step: throwYards / steps });
    }
  }
  for (let i = w.slides.length - 1; i >= 0; i--) {
    const sl = w.slides[i];
    const p = s.ctx.entities.get(sl.id);
    // Only a living body still in the fight's scope slides (a teleport, a
    // wipe home or a hearth ends it).
    if (!p || p.dead || !s.players.includes(p)) {
      w.slides.splice(i, 1);
      continue;
    }
    const step = Math.min(sl.step, sl.left);
    const moved = throwPlayer(s, p, sl.ux, sl.uz, step);
    sl.left -= step;
    if (!p.onGround && sl.left > 1e-6) {
      // Carried past an open lip into the air: the rest of the throw rides
      // on as its flight at the same pace, and the fall takes it from here.
      const secs = Math.max(DT, (sl.left / sl.step) * DT);
      p.vx = (sl.ux * sl.left) / secs;
      p.vz = (sl.uz * sl.left) / secs;
      w.slides.splice(i, 1);
      continue;
    }
    // Done: thrown its whole way, or stopped (a wall, an anchor).
    if (sl.left <= 1e-6 || moved <= 0) w.slides.splice(i, 1);
  }
  if (w.r >= w.reach && w.slides.length === 0) s.st.roar = null;
}
