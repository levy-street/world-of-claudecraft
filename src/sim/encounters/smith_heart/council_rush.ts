// Mountain's Rush and the cursed pillar, the Guardian of the Hammer's charge in
// the Hammer Council (docs/design/raid/smith_heart.md section 7.1). Every
// number lives in COUNCIL_TUNING (`rush*`, `cursed*`, `collapse*`) and the
// difficulty rows (`cursedPulseMin/Max`, `missCollapse`).
//
//   The mark      every 24 s (first at 16) a 3 s bar at one player who is no
//                 council member's tank (nobody else on the floor: no Rush);
//                 the player wears the mark and the bar's target draws the lane
//                 from the Guardian.
//   The cursed    with the mark the Guardian raises ONE cursed pillar (if none
//   pillar        stands) on a ring round the Quarry's middle. While it stands
//                 it pulses on the whole raid every 2 s (low on normal, a
//                 reminder; the real pressure on heroic and mythic). It
//                 shelters nobody from a Wrath, the rock and Resonance never
//                 touch it; only the Rush or a Wrath breaks it.
//   The dash      when the bar lands the Guardian dashes in a straight line at
//                 where the marked player stands. It stops at the FIRST pillar
//                 on its line:
//                   the cursed pillar  it shatters; the Guardian reels (a 5 s
//                                      stun) and takes 50 percent more damage
//                                      for 12 s (the reward for aiming);
//                   a good pillar      that pillar is taken whole and the
//                                      cursed one keeps pulsing;
//                   a soul pillar      it stops there, the soul pillar stands.
//                 Anyone in the path up to where it stops takes a heavy blow
//                 and a throw; with no pillar on the line that is the marked
//                 player, and the cursed pillar stays. Mythic: a miss sets
//                 the Quarry collapsing (a stacking raid-wide blow every 2 s)
//                 until the cursed pillar breaks.
//   No heir       it dies with the Guardian, and so does his cursed pillar.
//
// A floor mechanic (council_floor.ts); on normal it never runs into a Wrath.
// Zero rng in every pick (hashed, ordered); the draws are the damage rolls.

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { dropAuraById, pickMarkTargets } from '../sunken_bastion/claim';
import { stampFloor } from './council_floor_gap';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  COUNCIL_TUNING as T,
} from './council_ids';
import {
  type CouncilPillar,
  collapsePillar,
  councilPillars,
  pillarBetween,
  raisePillar,
} from './council_pillars';
import {
  beginBar,
  type CouncilScope,
  councilTanks,
  living,
  memberFree,
  namesOf,
  raidWarn,
  roll,
} from './council_scope';
import { councilSay } from './council_voice';

/** Is the Rush due now (its clock run out, the Guardian standing, no dash
 *  in flight)? */
export function rushDue(s: CouncilScope): boolean {
  return s.st.rushTimer <= 0 && s.st.rush === null && living(s.bodies.guardian);
}

/** The standing cursed pillar, or null (a stale record is dropped). */
export function cursedPillar(s: CouncilScope): CouncilPillar | null {
  const c = s.st.cursed;
  if (!c) return null;
  const p = councilPillars(s.ctx, s.inst).find((q) => q.e.id === c.pillarId && q.cursed);
  if (!p) s.st.cursed = null;
  return p ?? null;
}

/** Raise the cursed pillar (if none stands): on a ring round the Quarry's
 *  middle, at an angle the fight's cast count picks (the golden angle, so
 *  two in a row never rise at the same spot). */
function raiseCursed(s: CouncilScope, g: Entity): boolean {
  if (cursedPillar(s)) return false;
  const bodies = COUNCIL_ROLES.map((r) => s.bodies[r]).filter((b): b is Entity => b !== null);
  for (let k = 0; k < 8; k++) {
    const a = (s.st.casts + k * 3) * 2.39996;
    const x = HAMMER_PIT.x + Math.sin(a) * T.cursedRing;
    const z = HAMMER_PIT.z + Math.cos(a) * T.cursedRing;
    const e = raisePillar(s.ctx, s.inst, g, bodies, s.players, x, z, 0, false, true);
    if (!e) continue;
    s.st.cursed = { pillarId: e.id, pulse: T.cursedPulseEvery };
    return true;
  }
  return false;
}

/** The Guardian marks a player, raises the cursed pillar and begins the
 *  Rush's bar. Exported for the dev trigger. */
export function startRush(s: CouncilScope): boolean {
  const g = s.bodies.guardian;
  if (!living(g) || s.st.rush !== null || !memberFree(s, 'guardian')) return false;
  const tanks = councilTanks(s);
  const free = s.players.filter((p) => !p.dead && !tanks.has(p.id));
  const [target] = pickMarkTargets(g, free, 1, s.st.casts * 11 + 5);
  // Never on a tank: with nobody else on the floor the Rush waits a round.
  s.st.rushTimer = T.rushEvery;
  if (!target || tanks.has(target.id)) return false;
  stampFloor(s.st);
  beginBar(s, 'guardian', COUNCIL_CASTS.rush, T.rushCast, target.id, false);
  raiseCursed(s, g);
  s.ctx.applyAura(target, {
    id: COUNCIL_AURAS.rushMark,
    name: COUNCIL_NAMES.rush,
    kind: 'vulnerability',
    remaining: T.rushCast,
    duration: T.rushCast,
    value: 0,
    value2: T.rushHalfWidth,
    sourceId: g.id,
    school: 'physical',
    undispellable: true,
  });
  raidWarn(
    s,
    g,
    'rush',
    `Mountain's Rush on ${target.name}! Lead the charge into the cursed pillar!`,
    { player: target.name },
  );
  councilSay(s, 'guardian', 'rush');
  return true;
}

/** The bar landed: the line is fixed and the dash begins. Its stop is the
 *  first pillar on the line (the lane is as wide as the Guardian: a pillar it
 *  would brush stops it), else the marked player. */
export function landRush(s: CouncilScope, g: Entity, targetId: number | null): void {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (t) dropAuraById(t, COUNCIL_AURAS.rushMark);
  // A marked player who left the Quarry floor draws no dash out of it.
  if (!t || t.dead || !s.players.includes(t)) return;
  const from = { x: g.pos.x, z: g.pos.z };
  const dx = t.pos.x - from.x;
  const dz = t.pos.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const walls = councilPillars(s.ctx, s.inst).map((p) => ({ ...p, r: p.r + T.rushHalfWidth }));
  const hit = pillarBetween(walls, from, t.pos);
  let stop = len;
  if (hit) {
    const along = ((hit.e.pos.x - from.x) * dx + (hit.e.pos.z - from.z) * dz) / len;
    stop = Math.max(0, along - hit.r);
  }
  const to = { x: from.x + (dx / len) * stop, z: from.z + (dz / len) * stop };
  s.st.rush = {
    targetId: t.id,
    from,
    to,
    pillarId: hit ? hit.e.id : null,
    remaining: Math.max(DT, stop / T.rushSpeed),
  };
}

/** Distance from p to the segment a to b (xz). */
function segmentDistance(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const k =
    len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * k), p.z - (a.z + dz * k));
}

/** The cursed pillar breaks (the Rush, a Wrath, the Guardian's fall): its
 *  pulse and the mythic collapse end with it. */
export function breakCursed(s: CouncilScope, p: CouncilPillar): void {
  s.ctx.emit({
    type: 'spellfxAt',
    x: p.e.pos.x,
    z: p.e.pos.z,
    school: 'shadow',
    fx: 'burst',
    ability: COUNCIL_CUES.cursedBreak,
    radius: p.r,
  });
  collapsePillar(s.ctx, s.inst, s.st, p, false);
  s.st.cursed = null;
  endCollapse(s);
}

function endCollapse(s: CouncilScope): void {
  if (!s.st.collapse) return;
  s.st.collapse = null;
  for (const p of s.players) dropAuraById(p, COUNCIL_AURAS.collapse);
}

/** The Guardian reels off the broken curse: stunned, and open to the raid.
 *  Its own aura (sourceId itself), so its control immunity lets it in. */
function reel(s: CouncilScope, g: Entity): void {
  s.ctx.applyAura(g, {
    id: COUNCIL_AURAS.rushStunned,
    name: COUNCIL_NAMES.rushStunned,
    kind: 'stun',
    remaining: T.rushStunSeconds,
    duration: T.rushStunSeconds,
    value: 0,
    sourceId: g.id,
    school: 'physical',
    unbreakableControl: true,
  });
  s.ctx.applyAura(g, {
    id: COUNCIL_AURAS.rushExposed,
    name: COUNCIL_NAMES.rushStunned,
    kind: 'vulnerability',
    remaining: T.rushExposedSeconds,
    duration: T.rushExposedSeconds,
    value: T.rushExposed,
    sourceId: g.id,
    school: 'physical',
  });
}

/** What the dash ended on (the tests read it). */
export type RushOutcome = 'cursed' | 'pillar' | 'soul' | 'miss';

/** One tick of the dash: the Guardian moves along its line; on arrival the
 *  first pillar on it is dealt with and everyone in its path is struck.
 *  Returns the outcome on the tick it lands, else null. */
export function stepRush(s: CouncilScope): RushOutcome | null {
  const r = s.st.rush;
  if (!r) return null;
  const g = s.bodies.guardian;
  // Gone, or walking home on its leash: the dash is over.
  if (!living(g) || g.aiState === 'evade') {
    s.st.rush = null;
    return null;
  }
  // No swing while it charges.
  g.swingTimer = Math.max(g.swingTimer, 0.6);
  const total = Math.max(DT, Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z) / T.rushSpeed);
  r.remaining = Math.max(0, r.remaining - DT);
  const k = 1 - Math.min(1, r.remaining / total);
  const ground = s.ctx.groundPos(
    r.from.x + (r.to.x - r.from.x) * k,
    r.from.z + (r.to.z - r.from.z) * k,
  );
  g.pos.x = ground.x;
  g.pos.y = ground.y;
  g.pos.z = ground.z;
  g.facing = Math.atan2(r.to.x - r.from.x, r.to.z - r.from.z);
  s.ctx.rebucket(g);
  if (r.remaining > 1e-9) return null;
  s.st.rush = null;
  s.ctx.emit({
    type: 'spellfxAt',
    x: r.to.x,
    z: r.to.z,
    school: 'physical',
    fx: 'burst',
    ability: COUNCIL_CUES.rushImpact,
    radius: T.rushHalfWidth,
  });
  let outcome: RushOutcome = 'miss';
  if (r.pillarId !== null) {
    const pl = councilPillars(s.ctx, s.inst).find((p) => p.e.id === r.pillarId);
    if (pl?.cursed) {
      outcome = 'cursed';
      breakCursed(s, pl);
      reel(s, g);
      raidWarn(
        s,
        g,
        'rushCursed',
        'The Guardian shatters the cursed pillar and reels! Strike now!',
      );
    } else if (pl?.soul) outcome = 'soul';
    else if (pl) {
      outcome = 'pillar';
      collapsePillar(s.ctx, s.inst, s.st, pl, false);
      if (cursedPillar(s))
        raidWarn(
          s,
          g,
          'rushPillar',
          'The Rush broke a sheltering pillar! The cursed pillar still stands.',
        );
    } else outcome = 'pillar';
  }
  const struck: Entity[] = [];
  for (const p of s.players) {
    if (p.dead) continue;
    if (segmentDistance(p.pos, r.from, r.to) > T.rushHalfWidth + 0.5) continue;
    const amount = roll(s, g, T.rushMin, T.rushMax);
    s.ctx.dealDamage(g, p, amount, false, 'physical', COUNCIL_NAMES.rush, 'hit', true);
    if (!p.dead) s.ctx.applyKnockback(g, p, T.rushKnockback);
    struck.push(p);
  }
  if (outcome === 'miss' && struck.length > 0)
    raidWarn(s, g, 'rushMiss', `Mountain's Rush tramples ${namesOf(struck)}!`, {
      players: namesOf(struck),
    });
  // Mythic: a miss with the curse still standing brings the Quarry down.
  if (outcome === 'miss' && s.rules.missCollapse && cursedPillar(s) && !s.st.collapse) {
    s.st.collapse = { stacks: 0, timer: T.collapseEvery };
    raidWarn(
      s,
      g,
      'collapse',
      'The Quarry begins to collapse! Lead the next Rush into the cursed pillar!',
    );
  }
  return outcome;
}

/** One tick of the cursed pillar's pulse and the mythic collapse. Returns
 *  the blows dealt this tick (the tests read it). */
export function stepCursed(s: CouncilScope): number {
  const pl = cursedPillar(s);
  if (!pl) {
    endCollapse(s);
    return 0;
  }
  const source =
    (living(s.bodies.guardian) ? s.bodies.guardian : null) ??
    COUNCIL_ROLES.map((r) => s.bodies[r]).find(living) ??
    null;
  if (!source || !s.st.cursed) return 0;
  let blows = 0;
  const c = s.st.cursed;
  c.pulse -= DT;
  if (c.pulse <= 1e-9) {
    c.pulse += T.cursedPulseEvery;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: pl.e.id,
      targetId: pl.e.id,
      school: 'shadow',
      fx: 'nova',
      ability: COUNCIL_CUES.cursedPulse,
    });
    for (const p of s.players) {
      if (p.dead) continue;
      const amount = roll(s, source, s.rules.cursedPulseMin, s.rules.cursedPulseMax);
      s.ctx.dealDamage(source, p, amount, false, 'shadow', COUNCIL_NAMES.cursed, 'hit', true);
      blows++;
    }
  }
  const col = s.st.collapse;
  if (!col) return blows;
  col.timer -= DT;
  if (col.timer > 1e-9) return blows;
  col.timer += T.collapseEvery;
  col.stacks = Math.min(T.collapseCap, col.stacks + 1);
  for (const p of s.players) {
    if (p.dead) continue;
    s.ctx.emit({
      type: 'spellfxAt',
      x: p.pos.x,
      z: p.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.quarryCollapse,
      radius: 1.5,
    });
    const amount = roll(s, source, T.collapseMin * col.stacks, T.collapseMax * col.stacks);
    s.ctx.dealDamage(source, p, amount, false, 'physical', COUNCIL_NAMES.collapse, 'hit', true);
    blows++;
    const have = p.auras.find((a) => a.id === COUNCIL_AURAS.collapse);
    if (have) {
      have.stacks = col.stacks;
      have.remaining = T.collapseEvery * 2;
      continue;
    }
    s.ctx.applyAura(p, {
      id: COUNCIL_AURAS.collapse,
      name: COUNCIL_NAMES.collapse,
      kind: 'vulnerability',
      remaining: T.collapseEvery * 2,
      duration: T.collapseEvery * 2,
      value: 0,
      stacks: col.stacks,
      sourceId: source.id,
      school: 'physical',
      undispellable: true,
    });
  }
  return blows;
}

/** Drop the mark and the dash; `curse` too: the cursed pillar breaks (the
 *  Guardian's fall) and the collapse ends. */
export function clearRush(s: CouncilScope, curse = true): void {
  for (const p of s.players) dropAuraById(p, COUNCIL_AURAS.rushMark);
  s.st.rush = null;
  if (!curse) return;
  const pl = cursedPillar(s);
  if (pl) breakCursed(s, pl);
  endCollapse(s);
}
