// The Summit Roar's travelling wave (the Guardian of the Breath, design doc
// 7.2; the third pass of 2026-11-03): the exhale no longer strikes the whole
// Cornice in one tick. It leaves the guardian's maw as a ring racing out
// over the floor at BREATH_TUNING.roarSpeed; as its front reaches each
// player that player takes the blow and is thrown straight away from the
// guardian, the throw SLIDING over BREATH_TUNING.roarSlide seconds (the
// knockback's walker a step each tick, eased like a blow: fast off it and
// settling, breath_shove.ts 'knock'; the renderer lifts the body on a short
// arc meanwhile, render/thrown_hop.ts), so every client sees the wave travel,
// hit bodies in turn and fling them, instead of a blink to the edge. A throw
// that carries a body past an open lip leaves it in the air over the void
// (throwPlayer), the rest of the throw its flight as it falls. The anchored and the
// Knotted Gale's carrier keep their feet (throwPlayer), yet the blow lands.
// While a throw slides its body wears an unbreakable root (BREATH_AURAS.thrown):
// the server's movement override stays active through the slide, so the online
// client stands its prediction down once and draws the slide, instead of a
// server-driven step every tick bumping the override epoch (a jerky throw).
// The slide itself is breath_shove.ts' (shared with the loose gales' toss).
// The owner's call of 2026-11-17 (no moment made anyone fear the fall): the
// throw is gone (every tier's gustThrow is 0) and the wave sets a BLAST on
// each body it reaches (wind_drift.ts WIND_BLAST_AURA), strongest by the maw
// and easing outward: whoever runs straight back against it at once holds,
// whoever stands is carried over the rim. The anchored and the carrier keep
// their feet.
// Zero rng but the damage rolls (in player order, as each is struck).

import { DT } from '../../types';
import { WIND_BLAST_AURA } from '../../wind_drift';
import { BREATH_AURAS, BREATH_CUES, BREATH_NAMES, BREATH_TUNING as T } from './breath_ids';
import { type BreathScope, heldFast, livePlayers, putMarker, roll } from './breath_scope';
import { beginShove, stepShoves } from './breath_shove';
import { breathSay } from './breath_voice';

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
  breathSay(s, b, 'guardian', 'roar');
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
      const shove = beginShove(
        s,
        p,
        dx,
        dz,
        s.rules.gustThrow,
        T.roarSlide,
        'knock',
        BREATH_AURAS.thrown,
        BREATH_NAMES.gust,
      );
      // The anchored and the carrier keep their feet (the blow still lands).
      if (shove) w.slides.push(shove);
      // The blast: from the maw outward, easing with the distance, for the
      // tier's seconds (wind_drift.ts: both hosts step it, so it is
      // predicted online, never a server-driven slide). Run straight back
      // against it at once and you hold; stand and it carries you off.
      if (!heldFast(p) && p.carriedBy === undefined && s.rules.blastSpeed > 0)
        putMarker(p, WIND_BLAST_AURA, BREATH_NAMES.gust, s.rules.blastSeconds, b.id, {
          value: w.x,
          value2: w.z,
          value3: s.rules.blastSpeed,
        });
    }
  }
  stepShoves(s, w.slides);
  if (w.r >= w.reach && w.slides.length === 0) s.st.roar = null;
}
