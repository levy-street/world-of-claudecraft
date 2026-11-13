// The Guardian of the Heat's reach (docs/design/raid/smith_heart.md section
// 7.4): what keeps the raid pressed close in phase 1, and the wellspring's
// own fire.
//
//   Hearth Flare     phase 1, every 4 s: everyone farther than flareReach from
//                    the wellspring's middle (12 yd past its lip, out of the
//                    guardian's reach) is struck by a bolt of the first flame
//                    and marked Flare-Scorched (25 percent more Fire and other
//                    magic damage taken, 8 s). The opposite of the Breath's
//                    spread: the whole raid fights close. Through phases 2
//                    and 3 (still sunk) it strikes only the guardian's own
//                    target when that one stands out of reach, so nobody can
//                    hold it from afar and leave it swinging at nothing.
//   Wellspring Fire  the whole fight: whoever stands inside the wellspring's
//                    lip burns every half second.
//   Cinder Grip      the tank's stacking burn is the template's own
//                    (`stackPoison` on every landed swing, mob/mob_swing.ts):
//                    nothing here, the tanks swap around 5 stacks.
//
// Zero rng but the damage rolls, in player order.

import { DT, type Entity } from '../../types';
import { beyondFlare, inWell } from './heat_geometry';
import { HEAT_AURAS, HEAT_CUES, HEAT_NAMES, HEAT_TUNING as T } from './heat_ids';
import { at, auraOf, beamCue, fireHit, type HeatScope, livePlayers, roll } from './heat_scope';

/** Mark `p` Flare-Scorched (or refresh it). */
function scorch(s: HeatScope, p: Entity): void {
  const have = auraOf(p, HEAT_AURAS.scorched);
  if (have) {
    have.remaining = T.scorchedSeconds;
    return;
  }
  s.ctx.applyAura(p, {
    id: HEAT_AURAS.scorched,
    name: HEAT_NAMES.scorched,
    kind: 'spellvuln',
    remaining: T.scorchedSeconds,
    duration: T.scorchedSeconds,
    value: T.scorchedPct,
    sourceId: s.boss.id,
    school: 'fire',
    undispellable: true,
  });
}

/** Who Hearth Flare takes: everyone out of reach, only the guardian's own
 *  target when out of reach, or nobody. */
export type FlareMode = 'all' | 'target' | 'none';

/** Hearth Flare now: every living player out of reach is struck (`all`), or
 *  only the guardian's target (`target`). Returns who (the tests read it).
 *  Exported for the dev trigger. */
export function flare(s: HeatScope, mode: FlareMode = 'all'): Entity[] {
  const hit: Entity[] = [];
  if (mode === 'none') return hit;
  for (const p of livePlayers(s)) {
    if (mode === 'target' && p.id !== s.boss.aggroTargetId) continue;
    const here = at(s, p);
    if (!beyondFlare(here.x, here.z)) continue;
    hit.push(p);
    beamCue(s, s.boss.id, p.id, HEAT_CUES.flare);
    fireHit(s, p, roll(s, T.flareMin, T.flareMax), HEAT_NAMES.flare);
    if (!p.dead) scorch(s, p);
  }
  return hit;
}

/** One tick of Hearth Flare's clock. */
export function stepFlare(s: HeatScope, mode: FlareMode): Entity[] {
  s.st.flareTimer -= DT;
  if (s.st.flareTimer > 1e-9) return [];
  s.st.flareTimer += T.flareEvery;
  return flare(s, mode);
}
/** One tick of the wellspring's fire. Returns who it burned this tick. */
export function stepWellFire(s: HeatScope): Entity[] {
  s.st.wellTick -= DT;
  if (s.st.wellTick > 1e-9) return [];
  s.st.wellTick += T.wellTick;
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (!inWell(here.x, here.z)) continue;
    hit.push(p);
    fireHit(s, p, roll(s, T.wellMin, T.wellMax), HEAT_NAMES.wellFire);
  }
  return hit;
}
