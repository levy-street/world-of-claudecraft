// The Seam Singer's stone in the Hammer Council (docs/design/raid/
// smith_heart.md section 7.1): she wakes the pillars and drops the rock.
//
//   Wake the Stone  a 2.5 s KICKABLE bar (every 30 s, first at 20, and 6 s
//                   after each Wrath lands, so every Wrath cycle has one),
//                   then 2 players (3 on heroic and mythic, never more than
//                   the cap allows) wear a ground circle for 5 s; when it runs
//                   out a fresh pillar bursts out of the floor where each one
//                   STANDS (the players choose where the cover goes), throwing
//                   back anyone within 3 yd. A kick raises NOTHING, and every
//                   pillar a Wake lets up rings Stone Thrum on the whole raid
//                   while it stands (council_risen_pulse.ts): let through the
//                   one Wake the next Wrath needs, kick the rest. Normal: its
//                   marks never run
//                   into a Wrath (council_floor.ts holds it until it lands).
//   Falling Rock    every 25 s a short bar, then one player wears the soak
//                   circle for 5 s; the rock lands on them and its blow is
//                   split between everyone within 6 yd (fewer than 3 under it:
//                   each takes half as much again and the whole raid feels the
//                   tremor), and every pillar within 6 yd loses a piece, so the
//                   raid soaks AWAY from its cover.
//   Heir            the Singer fallen, once her soul reaches him the Guardian
//                   casts the SAME Wake the Stone (Grieving Fury,
//                   council_fury.ts: the kickable bar, the marks, the clock,
//                   all hastened). The rock stops with her, but on mythic the
//                   Guardian keeps it too (it is all that breaks a soul
//                   pillar).
//   Soul pillars    a rock landing within 6 yd of one strikes a soul pip off
//                   (council_soul.ts) instead of a piece.
//
// Zero rng in every pick (hashed marks); the draws are the damage rolls.

import { isLockedOut } from '../../combat/cc';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropAuraById } from '../sunken_bastion/claim';
import { stampFloor } from './council_floor_gap';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  type CouncilRole,
  fallingRockShare,
  COUNCIL_TUNING as T,
} from './council_ids';
import { collapsePillar, councilPillars, raisePillar } from './council_pillars';
import {
  beginBar,
  type CouncilScope,
  damageMult,
  jobHolder,
  living,
  memberFree,
  pickMarks,
  punishMult,
  punishRoll,
} from './council_scope';
import { strikeSoulPip } from './council_soul';
import { councilSay } from './council_voice';

/** Free pillar places under the cap (marks never outnumber them). */
function freePlaces(s: CouncilScope): number {
  const standing = councilPillars(s.ctx, s.inst).filter((p) => !p.cursed).length;
  const coming = s.st.wakeMarks.length;
  return Math.max(0, T.pillarCap - standing - coming);
}

/** Wake the Stone comes due: the kickable bar of whoever holds the pillars
 *  (the Singer, or the Guardian after her). Exported for the dev trigger. */
export function startWake(s: CouncilScope): boolean {
  const holder = jobHolder(s, 'pillars');
  if (!holder) return false;
  const count = Math.min(s.rules.wakeMarks, freePlaces(s));
  if (count <= 0) return false;
  if (!memberFree(s, holder.role)) return false;
  // A kick's silence and lockout hold the Wake too.
  if (s.st.quiet > 0 || isLockedOut(holder.body, 'nature')) return false;
  s.st.wakeTimer = T.wakeEvery;
  stampFloor(s.st);
  beginBar(s, holder.role, COUNCIL_CASTS.wake, T.wakeCast, null, holder.heir);
  s.st.kickable = COUNCIL_CASTS.wake;
  if (!holder.heir) councilSay(s, holder.role, 'wake');
  return true;
}

/** The Singer's Wake the Stone bar ran out: the marks go on. */
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
}

/** The marks count down; each rises when its time is up.
 *  A mark whose player left the Quarry rises nowhere (no clear floor there);
 *  a mark on a player who fell raises nothing (never on a corpse). */
export function stepRises(s: CouncilScope): void {
  // The pillars' holder raises them; between the Singer's fall and her soul
  // reaching the Guardian, he does (her marks still rise).
  const source =
    jobHolder(s, 'pillars')?.body ?? COUNCIL_ROLES.map((r) => s.bodies[r]).find(living) ?? null;
  const bodies = COUNCIL_ROLES.map((r) => s.bodies[r]).filter((b): b is Entity => b !== null);
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
}

/** Who drops the rock: the Seam Singer; once she has fallen, nobody, or on
 *  mythic the Guardian (the rock outlives her there). */
export function rockCaster(s: CouncilScope): CouncilRole | null {
  if (living(s.bodies.singer)) return 'singer';
  if (s.rules.rockOutlivesSinger && living(s.bodies.guardian)) return 'guardian';
  return null;
}

/** Falling Rock: the Singer's own (it stops when she falls, but on
 *  mythic). */
export function startRock(s: CouncilScope): boolean {
  const role = rockCaster(s);
  if (role === null || s.st.rock || !memberFree(s, role)) return false;
  s.st.rockTimer = T.rockEvery;
  stampFloor(s.st);
  beginBar(s, role, COUNCIL_CASTS.rock, T.rockCast, null, role !== 'singer');
  if (role === 'singer') councilSay(s, role, 'rock');
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
    // How many must share it (the client's soak tell counts them in).
    value3: T.rockMinSoakers,
    sourceId: caster.id,
    school: 'physical',
    undispellable: true,
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
    (living(s.bodies.singer) ? s.bodies.singer : null) ??
    (living(s.bodies.guardian) ? s.bodies.guardian : null);
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
  const each = Math.max(1, Math.round(share.each * punishMult(s, source)));
  for (const p of under) {
    s.ctx.dealDamage(source, p, each, false, 'physical', COUNCIL_NAMES.rock, 'hit', true);
  }
  if (share.tremor) {
    for (const p of s.players) {
      if (p.dead) continue;
      s.ctx.dealDamage(
        source,
        p,
        punishRoll(s, source, T.rockTremorMin, T.rockTremorMax),
        false,
        'physical',
        COUNCIL_NAMES.rockTremor,
        'hit',
        true,
      );
    }
  }
  // Every pillar within the blow falls at once, a carved column as surely as
  // a risen one (the team's review of 2026-11-17); a soul pillar loses a pip,
  // the cursed one only the Rush or a Wrath breaks.
  for (const pl of councilPillars(s.ctx, s.inst)) {
    const d = Math.hypot(pl.e.pos.x - at.x, pl.e.pos.z - at.z) - pl.r;
    if (pl.soul) {
      if (d <= T.soulRockReach) strikeSoulPip(s, pl, 'rock');
      continue;
    }
    if (pl.cursed || d > T.rockRadius) continue;
    collapsePillar(s.ctx, s.inst, s.st, pl);
  }
  return under.length;
}

/** Drop every mark and the rock (a reset, the council's fall). */
export function clearStone(s: CouncilScope): void {
  for (const m of s.st.wakeMarks) {
    const p = s.ctx.entities.get(m.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.wakeMark);
  }
  s.st.wakeMarks = [];
  if (s.st.rock) {
    const p = s.ctx.entities.get(s.st.rock.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.rockMark);
    s.st.rock = null;
  }
}

export function clearStoneBars(b: Entity): void {
  clearCastIf(b, COUNCIL_CASTS.wake, COUNCIL_CASTS.rock);
}
