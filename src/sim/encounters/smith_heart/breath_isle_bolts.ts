// Isle Lightning: the Islands of the Wind's light mechanic (the team's
// playtest of 2026-11-25: the isles' adds read as a pinata, nothing to move
// for). While an isle's adds stand and its Closing Storm still closes, the
// sky strikes it now and then: every tier's `boltEvery` seconds (from
// `boltFirst` after its first rider lands) a volley of `boltMarks` strikes
// under hashed players on that isle (where they stand as it is laid) and
// `boltSpots` more hashed over its floor, each on a `boltWarn` warning, each
// a share of the struck one's whole health within `boltR` (the tier's
// `boltShare`). Step out of the circle. The strike is the Breath's own (its
// object, its look, the shared avoid tell over it) and its hit is named Sky
// Strike, like the Cornice's.
//
// Never once the isle's adds are down (the Stillstone's calm), never after
// its Closing Storm ran out (Sky's Reckoning rains then), never under a
// player channeling a Stillstone.
//
// Zero rng: the marks and the spots are hashed (breathHash, salted by the
// isle and its volley count); the draws are none (the hit is a share).

import { DT } from '../../types';
import { breathHash } from './breath_geometry';
import { BREATH_NAMES, BREATH_OBJECTS, timedTemplate } from './breath_ids';
import { isleTier, playersOnIsle } from './breath_isle_adds';
import { isleAt, isleSpots } from './breath_isle_geometry';
import { ISLE_CASTS, ISLE_TUNING as IT } from './breath_isle_ids';
import { type BreathScope, local, spawnBreathObject } from './breath_scope';

/** A hashed spot on isle `i`'s floor (instance-local), or null if none of
 *  the tries lands on it. */
export function isleBoltSpot(i: number, salt: number): { x: number; z: number } | null {
  const sp = isleSpots()[i];
  for (let k = 0; k < 8; k++) {
    const a = ((breathHash(salt, k * 2 + 1) % 3600) / 3600) * Math.PI * 2;
    const r = Math.sqrt((breathHash(salt, k * 2 + 2) % 1000) / 1000) * sp.r * 0.85;
    const x = sp.x + Math.sin(a) * r;
    const z = sp.z + Math.cos(a) * r;
    if (isleAt(x, z) === i) return { x, z };
  }
  return null;
}

/** Lay one strike on isle `i` at (x, z). */
function layBolt(s: BreathScope, i: number, x: number, z: number, share: number): void {
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    timedTemplate(BREATH_OBJECTS.strikePrefix, IT.boltWarn),
    BREATH_NAMES.skyMark,
    x,
    z,
    IT.boltR,
  );
  s.st.isles.strikes.push({
    objectId: e.id,
    isle: i,
    x,
    z,
    remaining: IT.boltWarn,
    share,
    r: IT.boltR,
  });
}

/** Lay isle `i`'s next volley now. Returns how many strikes it laid. */
export function startIsleBolts(s: BreathScope, i: number): number {
  const st = s.st.isles.isles[i];
  const tier = isleTier(s);
  const volley = st.bolts ?? 0;
  st.bolts = volley + 1;
  st.bolt = tier.boltEvery;
  const salt = s.boss.id * 31 + i * 101 + volley * 7 + 5;
  const free = playersOnIsle(s, i).filter((p) => p.castingAbility !== ISLE_CASTS.still);
  let n = 0;
  const taken = new Set<number>();
  for (let k = 0; k < IT.boltMarks && taken.size < free.length; k++) {
    let idx = breathHash(salt, 40 + k) % free.length;
    while (taken.has(idx)) idx = (idx + 1) % free.length;
    taken.add(idx);
    const at = local(s.ctx, s.inst, free[idx]);
    layBolt(s, i, at.x, at.z, tier.boltShare);
    n++;
  }
  for (let k = 0; k < IT.boltSpots; k++) {
    const at = isleBoltSpot(i, salt + k * 13);
    if (!at) continue;
    layBolt(s, i, at.x, at.z, tier.boltShare);
    n++;
  }
  return n;
}

/** One tick of every isle's lightning (the phase's `nova` stage only). */
export function stepIsleBolts(s: BreathScope): void {
  const isl = s.st.isles;
  for (let i = 0; i < isl.isles.length; i++) {
    const st = isl.isles[i];
    // Its storm begun (a rider landed), still closing, its adds standing.
    if (st.closing === null || st.closing <= 1e-9 || st.cleared || st.stilled) continue;
    if (st.bolt === undefined) st.bolt = IT.boltFirst;
    st.bolt -= DT;
    if (st.bolt > 1e-9) continue;
    if (playersOnIsle(s, i).length === 0) {
      st.bolt = 0.5;
      continue;
    }
    startIsleBolts(s, i);
  }
}
