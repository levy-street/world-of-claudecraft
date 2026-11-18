// The Guardian of the Breath's sky strikes (the team's review of 2026-11-17:
// "lightning strikes, like meteors, in all phases"). In the Wind half and the
// Storm half alike (never while the storm breaks, nor through its barrage,
// which already rains strikes), every `skyEvery` seconds a volley falls from
// the sky: a telegraphed spot under each of `skyMarks` hashed players (where
// they stand as it is laid: they step out of it; each wears the mark,
// BREATH_AURAS.skyMark, for the warning) and `skySpots` more hashed
// over the Cornice's floor, each the barrage's own strike (its reach, its
// hit, its look) on the longer `skyWarn` warning.
//
// Zero rng: the marks are hashed (pickMarks), the floor spots hashed
// (barrageSpot); the draws are the strikes' damage rolls when they land
// (breath_storm.ts stepSpots).

import { DT } from '../../types';
import { barrageSpot } from './breath_geometry';
import { BREATH_AURAS, BREATH_NAMES, BREATH_TUNING as T } from './breath_ids';
import { type BreathScope, local, pickMarks, putMarker } from './breath_scope';
import { spawnStrike } from './breath_storm';

/** Lay one volley now. Returns how many strikes it laid (the tests read it). */
export function startSkyVolley(s: BreathScope): number {
  const st = s.st;
  st.skyTimer = T.skyEvery;
  const salt = s.boss.id * 11 + st.skyVolleys * 7 + 3;
  st.skyVolleys++;
  let n = 0;
  for (const p of pickMarks(s, T.skyMarks)) {
    const at = local(s.ctx, s.inst, p);
    spawnStrike(s, at.x, at.z, 'barrage', T.skyWarn);
    // The mark: the arrow over them the whole raid sees, their own alarm.
    putMarker(p, BREATH_AURAS.skyMark, BREATH_NAMES.skyMark, T.skyWarn, s.boss.id, {
      school: 'nature',
    });
    n++;
  }
  for (let k = 0; k < T.skySpots; k++) {
    const at = barrageSpot(salt, k);
    spawnStrike(s, at.x, at.z, 'barrage', T.skyWarn);
    n++;
  }
  return n;
}

/** One tick of the sky's clock: a volley when it runs out, in either half. */
export function stepSky(s: BreathScope): void {
  const st = s.st;
  if (st.half === 'isles' || st.half === 'break' || st.barrage) return;
  st.skyTimer -= DT;
  if (st.skyTimer > 1e-9) return;
  startSkyVolley(s);
}
