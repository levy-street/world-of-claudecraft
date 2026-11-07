// The Guardian of the Heat's heroic overflow adds (docs/design/raid/
// smith_heart.md section 7.4).
//
//   The Wellspawn    four children of the flame climb out at the room's edge
//                    as the Hearth overflows and walk to the wellspring
//                    (walked by the encounter: the mob AI never moves them).
//                    They slow as they lose health, crawling from half their
//                    health down, and every slow, root, stun and control the
//                    raid has works on them. One that reaches the wellspring
//                    feeds the guardian (3 percent of its health) and blasts
//                    the whole raid. When the overflow ends the survivors
//                    dive in all the same.
//   The Wellkeepers  at 40 percent two keepers rise by the wellspring: the mob
//                    AI fights them (they must be tanked). Every 10 s each
//                    puts a Kindling Mark on a player; 5 s later that player
//                    trails fire for 8 s. A Wellspawn in a Cinder Trail heals
//                    fast, so the marked player leaves the group and the
//                    children's path. When the overflow ends they sink back.
//
// Deterministic: the marks are hashed, the walk is a straight step; the only
// rng draws are the damage rolls, in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { facingTo, WELLKEEPER_SPOTS, WELLSPAWN_SPOTS, wellDistance } from './heat_geometry';
import {
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  heatTimed,
  spawnPace,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  beamCue,
  cueAt,
  dropAura,
  dropFightObject,
  dropHeatMob,
  fireHit,
  type HeatScope,
  liveEntity,
  livePlayers,
  local,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
  spawnHeatMob,
} from './heat_scope';
import type { HeatMark, HeatPatch } from './heat_state';
import { heatSay } from './heat_voice';

// ---- the Wellspawn -----------------------------------------------------------------------

/** The four Wellspawn climb out at the room's edge. */
export function raiseWellspawn(s: HeatScope): Entity[] {
  const out: Entity[] = [];
  for (const spot of WELLSPAWN_SPOTS) {
    const e = spawnHeatMob(s, HEAT_MOBS.spawn, spot.x, spot.z, facingTo(spot, HEARTH_WELL));
    if (!e) continue;
    e.inCombat = true;
    e.aiState = 'attack';
    e.hostile = true;
    s.st.spawn.push(e.id);
    out.push(e);
    cueAt(s, HEAT_CUES.spawn, spot.x, spot.z, 2);
  }
  raidWarn(
    s,
    s.boss,
    'wellspawn',
    'The Wellspawn climb out! Slow them and kill them before they reach the wellspring!',
  );
  return out;
}

/** A Wellspawn reaches the wellspring: it feeds the guardian and blasts the
 *  whole raid. Exported for the tests. */
export function feedWell(s: HeatScope, child: Entity): Entity[] {
  const b = s.boss;
  const here = local(s.ctx, s.inst, child);
  dropHeatMob(s, child.id);
  s.st.spawn = s.st.spawn.filter((id) => id !== child.id);
  s.st.feeds++;
  b.hp = Math.min(b.maxHp, b.hp + Math.round(b.maxHp * T.feedHealPct));
  cueAt(s, HEAT_CUES.feed, here.x, here.z, HEARTH_WELL.r);
  heatSay(s, b, 'feed');
  const hit = livePlayers(s);
  for (const p of hit) fireHit(s, p, roll(s, T.feedMin, T.feedMax), HEAT_NAMES.feed);
  return hit;
}

/** One Wellspawn's step toward the wellspring: its pace by its health, every
 *  slow on it, nothing while it is held. */
function walkChild(s: HeatScope, e: Entity): void {
  e.inCombat = true;
  e.swingTimer = Math.max(e.swingTimer, 0.6);
  if (s.ctx.isStunned(e) || s.ctx.isRooted(e)) return;
  const pace = spawnPace(e.hp / Math.max(1, e.maxHp));
  const speed = T.spawnSpeed * pace * s.ctx.moveSpeedMult(e);
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.moveToward(e, s.ctx.groundPos(o.x + HEARTH_WELL.x, o.z + HEARTH_WELL.z), speed);
}

/** One tick of the Wellspawn: their walk, the trails healing them, the
 *  wellspring taking any that reach it. */
export function stepWellspawn(s: HeatScope): void {
  const st = s.st;
  if (st.spawn.length === 0) return;
  for (const id of [...st.spawn]) {
    const e = liveEntity(s, id);
    if (!e) {
      st.spawn = st.spawn.filter((x) => x !== id);
      continue;
    }
    walkChild(s, e);
    const here = local(s.ctx, s.inst, e);
    for (const t of st.trails) {
      if (Math.hypot(here.x - t.x, here.z - t.z) > T.trailR) continue;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * T.trailHealPct * DT);
      break;
    }
    if (wellDistance(here.x, here.z) <= T.spawnReach) feedWell(s, e);
  }
}

// ---- the Wellkeepers ---------------------------------------------------------------------

/** Two Wellkeepers rise by the wellspring and take the fight. */
export function raiseKeepers(s: HeatScope): Entity[] {
  const out: Entity[] = [];
  const live = livePlayers(s);
  WELLKEEPER_SPOTS.forEach((spot, i) => {
    const e = spawnHeatMob(s, HEAT_MOBS.keeper, spot.x, spot.z, Math.PI / 2);
    if (!e) return;
    const first = live.length > 0 ? live[i % live.length] : null;
    if (first) s.ctx.aggroMob(e, first, false);
    s.st.keepers.push({ id: e.id, markIn: T.markFirst + i * (T.markEvery / 2) });
    out.push(e);
    cueAt(s, HEAT_CUES.spawn, spot.x, spot.z, 2.5);
  });
  raidWarn(
    s,
    s.boss,
    'keepers',
    'Wellkeepers rise from the wellspring! Tank them, and keep their marks away from the Wellspawn!',
  );
  return out;
}

/** A Wellkeeper's Kindling Mark on a hashed player (never one already
 *  marked). Returns who, or null. Exported for the tests. */
export function markPlayer(s: HeatScope, keeper: Entity, salt: number): Entity | null {
  const busy = new Set(s.st.marks.map((m) => m.pid));
  const [p] = pickPlayers(s, 1, 700 + salt, busy);
  if (!p) return null;
  putMarker(p, HEAT_AURAS.kindling, HEAT_NAMES.kindling, T.markSeconds, keeper.id, {
    school: 'fire',
  });
  beamCue(s, keeper.id, p.id, HEAT_CUES.kindling);
  s.st.marks.push({ pid: p.id, markIn: T.markSeconds, trailLeft: T.trailSeconds, dropIn: 0 });
  return p;
}

/** One tick of the keepers' clocks. */
export function stepKeepers(s: HeatScope): void {
  const st = s.st;
  if (st.keepers.length === 0) return;
  st.keepers = st.keepers.filter((k) => liveEntity(s, k.id));
  for (const k of st.keepers) {
    k.markIn -= DT;
    if (k.markIn > 1e-9) continue;
    k.markIn += T.markEvery;
    const e = liveEntity(s, k.id);
    if (e) markPlayer(s, e, st.casts++);
  }
}

/** Lay a Cinder Trail patch at instance-local (x, z) (the oldest goes past
 *  the cap). Exported for the tests. */
export function layTrail(s: HeatScope, x: number, z: number): HeatPatch {
  const st = s.st;
  while (st.trails.length >= T.trailCap) {
    const old = st.trails.shift();
    if (old) dropFightObject(s.ctx, s.inst, old.objectId);
  }
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    heatTimed(HEAT_OBJECTS.trailPrefix, T.trailLife),
    HEAT_NAMES.trail,
    x,
    z,
    T.trailR,
  );
  const patch = { objectId: obj.id, x, z, life: T.trailLife, tick: T.trailTick };
  st.trails.push(patch);
  return patch;
}

/** One tick of the marks: the countdown, then the trail laid behind. */
export function stepMarks(s: HeatScope): void {
  const st = s.st;
  if (st.marks.length === 0) return;
  const keep: HeatMark[] = [];
  for (const m of st.marks) {
    const p = liveEntity(s, m.pid);
    if (!p) continue;
    if (m.markIn > 0) {
      m.markIn -= DT;
      if (m.markIn <= 1e-9) {
        m.markIn = 0;
        dropAura(p, HEAT_AURAS.kindling);
        putMarker(p, HEAT_AURAS.trail, HEAT_NAMES.trail, T.trailSeconds, s.boss.id, {
          school: 'fire',
        });
      }
      keep.push(m);
      continue;
    }
    m.trailLeft -= DT;
    m.dropIn -= DT;
    if (m.dropIn <= 1e-9) {
      m.dropIn += T.trailEvery;
      const here = at(s, p);
      layTrail(s, here.x, here.z);
    }
    if (m.trailLeft <= 1e-9) {
      dropAura(p, HEAT_AURAS.trail);
      continue;
    }
    keep.push(m);
  }
  st.marks = keep;
}

/** One tick of the trails: their burn, their burning out. */
export function stepTrails(s: HeatScope): void {
  const st = s.st;
  if (st.trails.length === 0) return;
  for (const t of st.trails) {
    t.life -= DT;
    t.tick -= DT;
    if (t.tick > 1e-9 || t.life <= 1e-9) continue;
    t.tick += T.trailTick;
    for (const p of livePlayers(s)) {
      const here = at(s, p);
      if (Math.hypot(here.x - t.x, here.z - t.z) > T.trailR) continue;
      fireHit(s, p, roll(s, T.trailMin, T.trailMax), HEAT_NAMES.trail);
    }
  }
  const gone = st.trails.filter((t) => t.life <= 1e-9);
  if (gone.length === 0) return;
  for (const t of gone) dropFightObject(s.ctx, s.inst, t.objectId);
  st.trails = st.trails.filter((t) => t.life > 1e-9);
}

// ---- the overflow's end ---------------------------------------------------------------

/** Are the overflow's adds all gone (dead, or never raised)? */
export function overflowAddsGone(s: HeatScope): boolean {
  return (
    s.st.spawn.every((id) => !liveEntity(s, id)) && s.st.keepers.every((k) => !liveEntity(s, k.id))
  );
}

/** The overflow ends: every Wellspawn still walking dives into the
 *  wellspring (each feeding it), the keepers sink back, the marks lift. */
export function endOverflowAdds(s: HeatScope): void {
  const st = s.st;
  for (const id of [...st.spawn]) {
    const e = liveEntity(s, id);
    if (e) feedWell(s, e);
  }
  st.spawn = [];
  for (const k of st.keepers) dropHeatMob(s, k.id);
  st.keepers = [];
  clearMarks(s);
}

/** Every mark off its player. */
function clearMarks(s: Pick<HeatScope, 'ctx' | 'st'>): void {
  for (const m of s.st.marks) {
    const p = s.ctx.entities.get(m.pid);
    if (!p) continue;
    dropAura(p, HEAT_AURAS.kindling);
    dropAura(p, HEAT_AURAS.trail);
  }
  s.st.marks = [];
}

/** Every overflow add, mark and trail gone (a wipe, the kill). */
export function clearOverflowAdds(s: Pick<HeatScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const st = s.st;
  for (const id of st.spawn) dropHeatMob(s, id);
  for (const k of st.keepers) dropHeatMob(s, k.id);
  st.spawn = [];
  st.keepers = [];
  clearMarks(s);
  for (const t of st.trails) dropFightObject(s.ctx, s.inst, t.objectId);
  st.trails = [];
}
