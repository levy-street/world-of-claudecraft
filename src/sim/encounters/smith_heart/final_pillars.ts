// The Masterless Strength's Hammer star, Wake the Stone (docs/design/raid/
// smith_heart.md section 7.5, the rework of 2026-11-18): the Hammer
// Council's pillars, risen on the Anvil of the World.
//
//   The rise     a volley lays a warning spot under each of the tier's
//                `pillarCount` hashed players standing in a quarter (never the
//                ring), nudged clear of the other pillars, the boss, the ring
//                and the rim; 2 s later a pillar bursts out there, throwing
//                back and striking whoever still stands on it.
//   They stay    a pillar is a round combat wall (it blocks bodies and sight,
//                like the council's) and stands for the rest of the fight:
//                only a Crossing Blade shatters it (final_blades.ts).
//   The cap      at most the tier's `pillarCap` stand (and rise) at once; a
//                volley that finds no room rings Stone Thrum through every
//                standing pillar onto the whole raid instead: break them.
//   Charged      a Sky Strike that falls by a pillar leaves it Storm-Charged
//                (final_sky.ts); every charged pillar pulses the whole raid
//                every 5 s while it stands (summed per pillar; 90 to 110 a
//                pillar on Normal since Jose's playtest of 2026-11-19, a cue
//                on each player struck), and its ground is electric: whoever
//                stands within 5.5 yd of it is bitten every second (Charged
//                Ground).
//
// Zero rng in every pick (hashed, distance and roster order); the only draws
// are the damage rolls, in player order.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { HEART_QUARTERS, heartQuarterAt } from '../../content/smith_heart_quarters';
import { dropKitObject, spawnKitObject } from '../../mob/trash_kit/kit_objects';
import { DT, type Entity } from '../../types';
import { syncPillarWalls } from './council_pillars';
import {
  chargedPulse,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_OBJECTS,
  finalHash,
  finalPillarTemplate,
  finalTimed,
  FINAL_TUNING as T,
} from './final_ids';
import {
  at,
  cueAt,
  dropFightObject,
  type FinalScope,
  type FPoint,
  fromCentre,
  hit,
  livePlayers,
  overTheVoid,
  pickPlayers,
  roll,
  spawnFightObject,
} from './final_scope';
import type { FinalPillar } from './final_state';

/** A pillar's wall stands as long as the fight (never a clock's). */
const PILLAR_WALL_LIFE = 1e9;

/** May a pillar rise at instance-local `p`? In a quarter (clear of the ring
 *  and the rim), off the void, clear of every standing or rising pillar and
 *  of the boss. Pure over its inputs. */
export function pillarSpotClear(
  p: FPoint,
  taken: readonly FPoint[],
  boss: FPoint,
  void_: (p: FPoint) => boolean = () => false,
): boolean {
  const d = fromCentre(p);
  if (d < HEART_QUARTERS.ringR + T.pillarRingPad) return false;
  if (d > HEART_ROOM.r - T.pillarRimPad) return false;
  if (heartQuarterAt(p.x, p.z) === 'ring') return false;
  if (void_(p)) return false;
  if (Math.hypot(p.x - boss.x, p.z - boss.z) < T.pillarClearOfBoss) return false;
  for (const q of taken) if (Math.hypot(p.x - q.x, p.z - q.z) < T.pillarGap) return false;
  return true;
}

/** Offsets a rise looks through, nearest first. */
const PROBES: readonly FPoint[] = (() => {
  const out: FPoint[] = [{ x: 0, z: 0 }];
  for (const d of [2, 4, 6, 8, 11]) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + d * 0.37;
      out.push({ x: Math.sin(a) * d, z: Math.cos(a) * d });
    }
  }
  return out;
})();

/** The nearest clear spot to `p`, or null. */
export function nearestPillarSpot(
  p: FPoint,
  taken: readonly FPoint[],
  boss: FPoint,
  void_?: (p: FPoint) => boolean,
): FPoint | null {
  for (const o of PROBES) {
    const q = { x: p.x + o.x, z: p.z + o.z };
    if (pillarSpotClear(q, taken, boss, void_)) return q;
  }
  return null;
}

/** Every pillar standing or on its way up. */
function takenSpots(s: FinalScope): FPoint[] {
  const st = s.st.stars;
  return [...st.pillars, ...st.rises].map((p) => ({ x: p.x, z: p.z }));
}

/** Stone Thrum: the cap is met, every standing pillar rings on the raid. */
export function stoneThrum(s: FinalScope): Entity[] {
  const st = s.st.stars;
  st.thrums++;
  for (const p of st.pillars) {
    const e = s.ctx.entities.get(p.objectId);
    if (e)
      s.ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: e.id,
        school: 'physical',
        fx: 'nova',
        ability: FINAL_CUES.thrum,
      });
  }
  const struck: Entity[] = [];
  for (const p of livePlayers(s)) {
    hit(s, p, roll(s, s.rules.thrumMin, s.rules.thrumMax), FINAL_NAMES.thrum, 'physical');
    struck.push(p);
  }
  return struck;
}

/** A volley of rises: under the tier's count of hashed players in the
 *  quarters (or at `forced`), as many as the cap leaves room for; a volley
 *  with no room rings Stone Thrum. Returns how many pillars it began. */
export function raisePillars(s: FinalScope, forced?: FPoint): number {
  const st = s.st.stars;
  const room = s.rules.pillarCap - st.pillars.length - st.rises.length;
  if (room <= 0) {
    stoneThrum(s);
    return 0;
  }
  const salt = s.boss.id * 7 + st.volleys * 31 + 1301;
  st.volleys++;
  const want = forced ? 1 : Math.min(s.rules.pillarCount, room);
  const aims: FPoint[] = [];
  if (forced) aims.push(forced);
  else {
    const inQuarters = livePlayers(s).filter((p) => {
      const q = at(s, p);
      return heartQuarterAt(q.x, q.z) !== 'ring';
    });
    const busy = new Set(
      livePlayers(s)
        .filter((p) => !inQuarters.includes(p))
        .map((p) => p.id),
    );
    for (const p of pickPlayers(s, want, salt, busy)) if (!busy.has(p.id)) aims.push(at(s, p));
    // Nobody in a quarter: hashed spots in the quarters themselves.
    for (let k = 0; aims.length < want && k < 8; k++) {
      const h = finalHash(salt, k);
      const a = ((h % 360) * Math.PI) / 180;
      const r = HEART_QUARTERS.ringR + 8 + (h % 24);
      aims.push({ x: HEART_ROOM.x + Math.sin(a) * r, z: HEART_ROOM.z + Math.cos(a) * r });
    }
  }
  const boss = at(s, s.boss);
  let n = 0;
  for (const aim of aims) {
    if (n >= want) break;
    const spot = nearestPillarSpot(aim, takenSpots(s), boss, (q) => overTheVoid(s, q));
    if (!spot) continue;
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      finalTimed(FINAL_OBJECTS.risePrefix, T.pillarWarn),
      FINAL_NAMES.wake,
      spot.x,
      spot.z,
      T.riseKnockR,
    );
    st.rises.push({ objectId: obj.id, x: spot.x, z: spot.z, left: T.pillarWarn });
    n++;
  }
  return n;
}

/** A pillar bursts out at a rise's spot. */
function risePillar(s: FinalScope, x: number, z: number): Entity {
  const o = s.ctx.instanceOriginOf(s.inst);
  const e = spawnKitObject(
    s.ctx,
    s.inst,
    finalPillarTemplate('plain'),
    FINAL_NAMES.pillar,
    o.x + x,
    o.z + z,
    1,
    0,
    { kind: 'wall', remaining: PILLAR_WALL_LIFE },
  );
  s.st.stars.pillars.push({ objectId: e.id, x, z, charged: false });
  syncPillarWalls(s.ctx, s.inst);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: e.id,
    targetId: e.id,
    school: 'physical',
    fx: 'nova',
    ability: FINAL_CUES.rise,
  });
  const shove = { ...s.boss, pos: { ...e.pos } } as Entity;
  for (const p of livePlayers(s)) {
    const q = at(s, p);
    if (Math.hypot(q.x - x, q.z - z) > T.riseKnockR + 1e-6) continue;
    hit(s, p, roll(s, T.riseMin, T.riseMax), FINAL_NAMES.wake, 'physical');
    if (!p.dead) s.ctx.applyKnockback(shove, p, T.riseKnockback);
  }
  return e;
}

/** A pillar shatters (a blade crossed it, the void took it). */
export function shatterPillar(s: FinalScope, pillar: FinalPillar): void {
  const st = s.st.stars;
  const i = st.pillars.indexOf(pillar);
  if (i < 0) return;
  st.pillars.splice(i, 1);
  st.shattered++;
  dropKitObject(s.ctx, s.inst, pillar.objectId);
  syncPillarWalls(s.ctx, s.inst);
  cueAt(s, FINAL_CUES.shatter, pillar.x, pillar.z, T.pillarR + 1.5, 'physical');
  // A strike on its way to this pillar finds no stone to run into.
  for (const sk of st.strikes) {
    sk.arcs = sk.arcs.filter((a) => {
      if (a.pillarId !== pillar.objectId) return true;
      dropFightObject(s.ctx, s.inst, a.objectId);
      return false;
    });
  }
}

/** A pillar is Storm-Charged (a strike ran into it). */
export function chargePillar(s: FinalScope, pillar: FinalPillar): void {
  if (pillar.charged) return;
  pillar.charged = true;
  s.st.stars.charges++;
  const e = s.ctx.entities.get(pillar.objectId);
  if (e) e.templateId = finalPillarTemplate('charged');
  syncPillarWalls(s.ctx, s.inst);
}

/** Storm-Charged: every charged pillar pulses the whole raid (one hit a
 *  player, summed over the charged pillars). Returns who it struck. */
export function pulseCharged(s: FinalScope): Entity[] {
  const charged = s.st.stars.pillars.filter((p) => p.charged);
  if (charged.length === 0) return [];
  for (const p of charged) {
    const e = s.ctx.entities.get(p.objectId);
    if (e)
      s.ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: e.id,
        school: 'nature',
        fx: 'nova',
        ability: FINAL_CUES.charged,
      });
  }
  const [min, max] = chargedPulse(charged.length, s.rules.chargedMin, s.rules.chargedMax);
  const struck: Entity[] = [];
  const source = s.ctx.entities.get(charged[0].objectId);
  for (const p of livePlayers(s)) {
    hit(s, p, roll(s, min, max), FINAL_NAMES.charged, 'nature');
    struck.push(p);
    // The hit reads on the player: its flash and crack (the client's).
    if (source)
      s.ctx.emit({
        type: 'spellfx',
        sourceId: source.id,
        targetId: p.id,
        school: 'nature',
        fx: 'nova',
        ability: FINAL_CUES.chargedHit,
      });
  }
  return struck;
}

/** Charged Ground: each charged pillar bites whoever stands within its
 *  reach (per pillar). Returns the bites dealt. */
export function biteChargedGround(s: FinalScope): number {
  let bites = 0;
  for (const pillar of s.st.stars.pillars) {
    if (!pillar.charged) continue;
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - pillar.x, q.z - pillar.z) > T.chargedZoneR + 1e-6) continue;
      hit(s, p, roll(s, T.chargedZoneMin, T.chargedZoneMax), FINAL_NAMES.chargedZone, 'nature');
      s.ctx.emit({
        type: 'spellfx',
        sourceId: pillar.objectId,
        targetId: p.id,
        school: 'nature',
        fx: 'nova',
        ability: FINAL_CUES.chargedZone,
      });
      bites++;
    }
  }
  return bites;
}

/** One tick of the rises (each pillar bursts out at its time) and of the
 *  charged pillars' pulse (`live`: never through a stride or a call). */
export function stepPillars(s: FinalScope, live: boolean): void {
  const st = s.st.stars;
  if (st.rises.length > 0) {
    const keep: typeof st.rises = [];
    for (const r of st.rises) {
      r.left -= DT;
      if (r.left > 1e-9) {
        keep.push(r);
        continue;
      }
      dropFightObject(s.ctx, s.inst, r.objectId);
      if (overTheVoid(s, r)) continue;
      risePillar(s, r.x, r.z);
    }
    st.rises = keep;
  }
  // Mythic's collapse: a pillar over a fallen quarter goes with it.
  for (const p of [...st.pillars]) if (overTheVoid(s, p)) shatterPillar(s, p);
  if (!live) return;
  if (!st.pillars.some((p) => p.charged)) {
    st.chargedTimer = T.chargedEvery;
    st.zoneTimer = T.chargedZoneEvery;
    return;
  }
  st.zoneTimer -= DT;
  if (st.zoneTimer <= 1e-9) {
    st.zoneTimer = T.chargedZoneEvery;
    biteChargedGround(s);
  }
  st.chargedTimer -= DT;
  if (st.chargedTimer > 1e-9) return;
  st.chargedTimer = T.chargedEvery;
  pulseCharged(s);
}

/** Every pillar and rise gone (a wipe, the kill). */
export function clearPillars(s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>): void {
  const st = s.st.stars;
  for (const r of st.rises) dropFightObject(s.ctx, s.inst, r.objectId);
  for (const p of st.pillars) dropKitObject(s.ctx, s.inst, p.objectId);
  const had = st.pillars.length > 0;
  st.rises = [];
  st.pillars = [];
  if (had) syncPillarWalls(s.ctx, s.inst);
}
