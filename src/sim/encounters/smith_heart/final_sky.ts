// The Masterless Strength's Breath star, Sky Strike (docs/design/raid/
// smith_heart.md section 7.5, the rework of 2026-11-18): the Guardian of the
// Breath's lightning from the sky, on the Anvil of the World.
//
//   A volley     a telegraphed spot under each of the tier's `skyMarks`
//                hashed players (they wear the mark, their own alarm, for the
//                warning: step out), and `skyPillarSpots` more beside the
//                standing pillars nearest the boss (the lightning seeks the
//                stone); 2.2 s later each lands (3.5 yd).
//   Arcing Stone a strike whose spot falls within `arcReach` of a standing
//                pillar runs into it: a big ring of lightning round the
//                pillar (`arcR`) lands with it, its own footprint on the floor
//                from the moment the strike is laid, and the pillar is left
//                Storm-Charged (final_pillars.ts). A pillar shattered before
//                the strike lands takes its ring with it.
//
// Zero rng in every pick (hashed, roster order); the draws are the damage
// rolls, in player order.

import { DT, type Entity } from '../../types';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalHash,
  finalTimed,
  FINAL_TUNING as T,
} from './final_ids';
import { chargePillar } from './final_pillars';
import {
  at,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  hit,
  livePlayers,
  onFloor,
  pickPlayers,
  putMarker,
  roll,
  spawnFightObject,
  standingSpot,
} from './final_scope';

/** Lay one strike at instance-local `p` (and the rings of every pillar it
 *  will run into). */
export function layStrike(s: FinalScope, p: FPoint): void {
  const st = s.st.stars;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    finalTimed(FINAL_OBJECTS.strikePrefix, T.skyWarn),
    FINAL_NAMES.strike,
    p.x,
    p.z,
    T.skyR,
  );
  const arcs: { pillarId: number; objectId: number }[] = [];
  for (const pl of st.pillars) {
    if (Math.hypot(pl.x - p.x, pl.z - p.z) > T.arcReach) continue;
    // One ring a pillar however many strikes seek it.
    if (st.strikes.some((sk) => sk.arcs.some((a) => a.pillarId === pl.objectId))) continue;
    const ring = spawnFightObject(
      s.ctx,
      s.inst,
      finalTimed(FINAL_OBJECTS.arcPrefix, T.skyWarn),
      FINAL_NAMES.arc,
      pl.x,
      pl.z,
      T.arcR,
    );
    arcs.push({ pillarId: pl.objectId, objectId: ring.id });
  }
  st.strikes.push({ objectId: obj.id, x: p.x, z: p.z, left: T.skyWarn, arcs });
}

/** A volley now (exported for the dev verb and the tests): the marks under
 *  players, then the strikes that seek the pillars. Returns how many it
 *  laid. */
export function skyVolley(s: FinalScope, forced?: FPoint): number {
  const st = s.st.stars;
  const salt = s.boss.id * 13 + st.volleys * 17 + 1401;
  st.volleys++;
  if (forced) {
    layStrike(s, forced);
    return 1;
  }
  let n = 0;
  for (const p of pickPlayers(s, s.rules.skyMarks, salt)) {
    layStrike(s, standingSpot(s, at(s, p)));
    putMarker(p, FINAL_AURAS.skyMark, FINAL_NAMES.sky, T.skyWarn, s.boss.id, {
      school: 'nature',
    });
    n++;
  }
  // The stone draws the lightning: beside the pillars nearest the boss.
  const boss = at(s, s.boss);
  const near = [...st.pillars].sort(
    (a, b) =>
      Math.hypot(a.x - boss.x, a.z - boss.z) - Math.hypot(b.x - boss.x, b.z - boss.z) ||
      a.objectId - b.objectId,
  );
  for (let k = 0; k < s.rules.skyPillarSpots && k < near.length; k++) {
    const pl = near[k];
    const h = finalHash(salt, k + 7);
    const a = ((h % 360) * Math.PI) / 180;
    const off = T.pillarR + 1.5;
    layStrike(
      s,
      standingSpot(s, onFloor({ x: pl.x + Math.sin(a) * off, z: pl.z + Math.cos(a) * off }, 3)),
    );
    n++;
  }
  return n;
}

/** A strike laid beside the standing pillar nearest `near` (the dev verb's
 *  `sky pillar`). Returns whether a pillar stood. */
export function skyAtPillar(s: FinalScope, near: FPoint): boolean {
  const st = s.st.stars;
  const pl = [...st.pillars].sort(
    (a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z),
  )[0];
  if (!pl) return false;
  const a = Math.atan2(near.x - pl.x, near.z - pl.z);
  const off = T.pillarR + 1.5;
  layStrike(s, standingSpot(s, { x: pl.x + Math.sin(a) * off, z: pl.z + Math.cos(a) * off }));
  return true;
}

/** A strike lands: whoever stands in it, and every pillar it ran into rings
 *  out (Arcing Stone) and is left Storm-Charged. Returns who it struck. */
function landStrike(s: FinalScope, sk: (typeof s.st.stars.strikes)[number]): Entity[] {
  const st = s.st.stars;
  dropFightObject(s.ctx, s.inst, sk.objectId);
  cueAt(s, FINAL_CUES.strike, sk.x, sk.z, T.skyR, 'nature');
  const struck: Entity[] = [];
  for (const p of livePlayers(s)) {
    const q = at(s, p);
    if (Math.hypot(q.x - sk.x, q.z - sk.z) > T.skyR) continue;
    hit(s, p, roll(s, T.skyMin, T.skyMax), FINAL_NAMES.strike, 'nature');
    struck.push(p);
  }
  for (const a of sk.arcs) {
    dropFightObject(s.ctx, s.inst, a.objectId);
    const pl = st.pillars.find((x) => x.objectId === a.pillarId);
    if (!pl) continue;
    cueAt(s, FINAL_CUES.arcingStone, pl.x, pl.z, T.arcR, 'nature');
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - pl.x, q.z - pl.z) > T.arcR) continue;
      hit(s, p, roll(s, T.arcMin, T.arcMax), FINAL_NAMES.arc, 'nature');
      if (!struck.includes(p)) struck.push(p);
    }
    chargePillar(s, pl);
  }
  return struck;
}

/** One tick of the strikes on their way down. */
export function stepSky(s: FinalScope): void {
  const st = s.st.stars;
  if (st.strikes.length === 0) return;
  const keep: typeof st.strikes = [];
  for (const sk of st.strikes) {
    sk.left -= DT;
    if (sk.left > 1e-9) keep.push(sk);
    else landStrike(s, sk);
  }
  st.strikes = keep;
}

/** Every strike, ring and mark gone (a wipe, the kill). */
export function clearSky(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  const st = s.st.stars;
  for (const sk of st.strikes) {
    dropFightObject(s.ctx, s.inst, sk.objectId);
    for (const a of sk.arcs) dropFightObject(s.ctx, s.inst, a.objectId);
  }
  st.strikes = [];
  for (const p of players) dropAura(p, FINAL_AURAS.skyMark);
}
