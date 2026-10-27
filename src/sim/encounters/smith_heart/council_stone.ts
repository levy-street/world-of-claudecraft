// The Slabwright's job in the Hammer Council (docs/design/raid/smith_heart.md
// section 7.1): it makes the pillars and drops the rock.
//
//   Wake the Stone  every 30 s a short bar, then 2 players (3 on heroic) wear
//                   a ground circle for 5 s; when it runs out a fresh pillar
//                   bursts out of the floor where each one STANDS (the players
//                   choose where the cover goes), throwing back anyone within
//                   3 yd. Never more pillars than the cap.
//   Falling Rock    every 25 s a short bar, then one player wears the soak
//                   circle for 5 s; the rock lands on them and its blow is
//                   split between everyone within 6 yd (fewer than 3 under it:
//                   each takes half as much again and the whole raid feels the
//                   tremor), and every pillar within 6 yd loses a piece, so the
//                   raid soaks AWAY from its cover.
//   Heir            the Slabwright fallen, a survivor keeps raising pillars,
//                   but under RANDOM players with only a 2 s warning on a
//                   locked spot (nobody chooses); the rock stops with it.
//                   Mythic: a 1.5 s warning, and a survivor keeps the rock
//                   too (with Resonance it is all that breaks a soul pillar).
//   Soul pillars    a rock landing within 6 yd of one strikes a soul pip off
//                   (council_soul.ts) instead of a piece.
//
// Zero rng in every pick (hashed marks); the draws are the damage rolls.

import { DT, type Entity } from '../../types';
import {
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  spawnEncounterObject,
} from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  type CouncilRole,
  councilRiseSpotTemplate,
  fallingRockShare,
  JOB_HEIRS,
  COUNCIL_TUNING as T,
} from './council_ids';
import { councilPillars, crackPillar, raisePillar } from './council_pillars';
import {
  beginBar,
  type CouncilScope,
  damageMult,
  jobHolder,
  living,
  memberFree,
  namesOf,
  pickMarks,
  raidWarn,
  roll,
} from './council_scope';
import { strikeSoulPip } from './council_soul';
import { councilSay } from './council_voice';

/** Free pillar places under the cap (marks never outnumber them). */
function freePlaces(s: CouncilScope): number {
  const standing = councilPillars(s.ctx, s.inst).length;
  const coming = s.st.wakeMarks.length + s.st.riseSpots.length;
  return Math.max(0, T.pillarCap - standing - coming);
}

/** Wake the Stone comes due: the Slabwright's bar, or the heir's locked
 *  spots. Exported for the dev trigger. */
export function startWake(s: CouncilScope): boolean {
  const holder = jobHolder(s, 'pillars');
  if (!holder) return false;
  const count = Math.min(s.rules.wakeMarks, freePlaces(s));
  if (count <= 0) return false;
  if (!holder.heir) {
    if (!memberFree(s, holder.role)) return false;
    s.st.wakeTimer = T.wakeEvery;
    beginBar(s, holder.role, COUNCIL_CASTS.wake, T.wakeCast, null, false);
    councilSay(s, holder.role, 'wake');
    return true;
  }
  // The heir: no bar, no choice. The spots lock under random players now.
  const marked = pickMarks(s, holder.body, count);
  if (marked.length === 0) return false;
  s.st.wakeTimer = T.wakeEvery;
  s.st.casts++;
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const p of marked) {
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    const obj = spawnEncounterObject(
      s.ctx,
      s.inst,
      councilRiseSpotTemplate(s.rules.heirRiseWarn),
      'Rising Stone',
      lx,
      lz,
      0,
      T.riseKnockRadius,
    );
    obj.dungeonId = s.inst.dungeonId;
    s.st.riseSpots.push({ x: lx, z: lz, remaining: s.rules.heirRiseWarn, objectId: obj.id });
  }
  raidWarn(s, holder.body, 'wakeHeir', `The stone wakes under ${namesOf(marked)}: move!`, {
    players: namesOf(marked),
  });
  return true;
}

/** The Slabwright's Wake the Stone bar ran out: the marks go on. */
export function landWake(s: CouncilScope, caster: Entity): void {
  const count = Math.min(s.rules.wakeMarks, freePlaces(s));
  const busy = new Set(s.st.wakeMarks.map((m) => m.playerId));
  if (s.st.rock) busy.add(s.st.rock.playerId);
  const marked = pickMarks(s, caster, count, busy);
  for (const p of marked) {
    s.st.wakeMarks.push({ playerId: p.id, remaining: T.wakeMarkSeconds });
    s.ctx.applyAura(p, {
      id: COUNCIL_AURAS.wakeMark,
      name: COUNCIL_NAMES.wake,
      kind: 'vulnerability',
      remaining: T.wakeMarkSeconds,
      duration: T.wakeMarkSeconds,
      value: 0,
      sourceId: caster.id,
      school: 'physical',
      undispellable: true,
    });
  }
  if (marked.length > 0)
    raidWarn(
      s,
      caster,
      'wake',
      `Wake the Stone: pillars rise under ${namesOf(marked)}! Stand where the cover should go.`,
      { players: namesOf(marked) },
    );
}

/** The marks and the heir's spots count down; each rises when its time is up.
 *  A mark whose player left the Quarry rises nowhere (no clear floor there);
 *  a mark on a player who fell raises nothing (never on a corpse). */
export function stepRises(s: CouncilScope): void {
  const holder = jobHolder(s, 'pillars');
  const source = holder?.body ?? null;
  const bodies = [s.bodies.guardian, s.bodies.slabwright, s.bodies.singer].filter(
    (b): b is Entity => b !== null,
  );
  const o = s.ctx.instanceOriginOf(s.inst);
  if (s.st.wakeMarks.length > 0) {
    for (const m of s.st.wakeMarks) m.remaining -= DT;
    const due = s.st.wakeMarks.filter((m) => m.remaining <= 1e-9);
    if (due.length > 0) {
      s.st.wakeMarks = s.st.wakeMarks.filter((m) => m.remaining > 1e-9);
      for (const m of due) {
        const p = s.ctx.entities.get(m.playerId);
        if (!p) continue;
        dropAuraById(p, COUNCIL_AURAS.wakeMark);
        // A mark on a player who fell raises nothing (no pillar on a corpse).
        if (!source || p.dead) continue;
        raisePillar(
          s.ctx,
          s.inst,
          source,
          bodies,
          s.players,
          p.pos.x - o.x,
          p.pos.z - o.z,
          damageMult(s, source),
        );
      }
    }
  }
  if (s.st.riseSpots.length > 0) {
    for (const r of s.st.riseSpots) r.remaining -= DT;
    const due = s.st.riseSpots.filter((r) => r.remaining <= 1e-9);
    if (due.length > 0) {
      s.st.riseSpots = s.st.riseSpots.filter((r) => r.remaining > 1e-9);
      for (const r of due) {
        dropEncounterObject(s.ctx, s.inst, r.objectId);
        if (source)
          raisePillar(s.ctx, s.inst, source, bodies, s.players, r.x, r.z, damageMult(s, source));
      }
    }
  }
}

/** Who drops the rock: the Slabwright; once it has fallen, nobody, or on
 *  mythic its first living heir (the rock outlives it there). */
export function rockCaster(s: CouncilScope): CouncilRole | null {
  if (living(s.bodies.slabwright)) return 'slabwright';
  if (!s.rules.rockOutlivesSlabwright) return null;
  for (const r of JOB_HEIRS.pillars) if (living(s.bodies[r])) return r;
  return null;
}

/** Falling Rock: the Slabwright's own (it stops when the Slabwright falls,
 *  but on mythic). */
export function startRock(s: CouncilScope): boolean {
  const role = rockCaster(s);
  if (role === null || s.st.rock || !memberFree(s, role)) return false;
  s.st.rockTimer = T.rockEvery;
  beginBar(s, role, COUNCIL_CASTS.rock, T.rockCast, null, role !== 'slabwright');
  if (role === 'slabwright') councilSay(s, role, 'rock');
  return true;
}

export function landRockBar(s: CouncilScope, caster: Entity): void {
  const busy = new Set(s.st.wakeMarks.map((m) => m.playerId));
  const [p] = pickMarks(s, caster, 1, busy);
  if (!p) return;
  s.st.rock = { playerId: p.id, remaining: T.rockMarkSeconds };
  s.ctx.applyAura(p, {
    id: COUNCIL_AURAS.rockMark,
    name: COUNCIL_NAMES.rock,
    kind: 'vulnerability',
    remaining: T.rockMarkSeconds,
    duration: T.rockMarkSeconds,
    value: 0,
    value2: T.rockRadius,
    sourceId: caster.id,
    school: 'physical',
    undispellable: true,
  });
  raidWarn(s, caster, 'rock', `Falling Rock on ${p.name}! Share the blow, away from your cover!`, {
    player: p.name,
  });
}

/** The rock counts down on its player and lands where they stand. Returns
 *  how many shared it on the tick it lands (the tests read it), else -1. */
export function stepRock(s: CouncilScope): number {
  const rock = s.st.rock;
  if (!rock) return -1;
  rock.remaining -= DT;
  if (rock.remaining > 1e-9) return -1;
  s.st.rock = null;
  const target = s.ctx.entities.get(rock.playerId);
  if (target) dropAuraById(target, COUNCIL_AURAS.rockMark);
  const source =
    (living(s.bodies.slabwright) ? s.bodies.slabwright : null) ??
    [s.bodies.guardian, s.bodies.singer].find(living) ??
    null;
  if (!target || !source) return 0;
  const at = { x: target.pos.x, z: target.pos.z };
  s.ctx.emit({
    type: 'spellfxAt',
    x: at.x,
    z: at.z,
    school: 'physical',
    fx: 'burst',
    ability: COUNCIL_CUES.rockImpact,
    radius: T.rockRadius,
  });
  const under = s.players.filter(
    (p) => !p.dead && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) <= T.rockRadius + 1e-6,
  );
  const share = fallingRockShare(under.length, T.rockTotal);
  const each = Math.max(1, Math.round(share.each * damageMult(s, source)));
  for (const p of under) {
    s.ctx.dealDamage(source, p, each, false, 'physical', COUNCIL_NAMES.rock, 'hit', true);
  }
  if (share.tremor) {
    for (const p of s.players) {
      if (p.dead) continue;
      s.ctx.dealDamage(
        source,
        p,
        roll(s, source, T.rockTremorMin, T.rockTremorMax),
        false,
        'physical',
        COUNCIL_NAMES.rockTremor,
        'hit',
        true,
      );
    }
  }
  // Every pillar within the blow loses a piece (a soul pillar, a pip).
  for (const pl of councilPillars(s.ctx, s.inst)) {
    const d = Math.hypot(pl.e.pos.x - at.x, pl.e.pos.z - at.z) - pl.r;
    if (pl.soul) {
      if (d <= T.soulRockReach) strikeSoulPip(s, pl, 'rock');
      continue;
    }
    if (d > T.rockRadius) continue;
    crackPillar(s.ctx, s.inst, s.st, pl);
  }
  return under.length;
}

/** Drop every mark, spot and the rock (a reset, the council's fall). */
export function clearStone(s: CouncilScope): void {
  for (const m of s.st.wakeMarks) {
    const p = s.ctx.entities.get(m.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.wakeMark);
  }
  s.st.wakeMarks = [];
  for (const r of s.st.riseSpots) dropEncounterObject(s.ctx, s.inst, r.objectId);
  s.st.riseSpots = [];
  if (s.st.rock) {
    const p = s.ctx.entities.get(s.st.rock.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.rockMark);
    s.st.rock = null;
  }
}

export function clearStoneBars(b: Entity): void {
  clearCastIf(b, COUNCIL_CASTS.wake, COUNCIL_CASTS.rock);
}
