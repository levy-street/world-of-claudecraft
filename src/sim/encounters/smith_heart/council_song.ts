// The Seam Singer's job in the Hammer Council (docs/design/raid/smith_heart.md
// section 7.1): it sings the ochre seams of the stone loose.
//
//   Seam Bolt         every 8 s a 2 s kickable bar at a random player it can
//                     see; it lands only on a player still in sight.
//   Song of the Seam  a 3 s kickable bar: sung out, Resonance on 3 players;
//                     kicked, on 1. Normal: it waits for a Wrath to land, so
//                     its Resonance runs out before the next one. Heroic: it
//                     keeps its own clock and the two overlap.
//   Resonance         a SPREAD (the rock's opposite: the rock wants a
//                     stack): 6 s, a ring of 7 yd round the player; every
//                     second it rings, hurting every ally inside the ring
//                     (never its carrier), so the marked step away from the
//                     group until it ends. It never touches a pillar. Normal:
//                     the song follows a Wrath, so the ring is over long
//                     before the next one; heroic and mythic: it may overlap
//                     a Wrath, and a carrier then needs a pillar's shadow of
//                     their own (they still count toward its capacity).
//   Wake the Stone    her third bar is kickable too (council_stone.ts), but a
//                     kick there costs the raid its cover: the raid chooses
//                     what to kick.
//   No heir           the bolt, the song and Resonance stop with the Singer
//                     (her pillars pass to the Guardian, council_stone.ts).
//
// The kick: between two council passes only a player interrupt clears the
// Singer's bar (bosses take no spell pushback; a reset or a death runs the
// council's own cleanup first), so a kickable bar that is gone was cut.
// Zero rng in every pick; the draws are the damage rolls.

import { isLockedOut } from '../../combat/cc';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropAuraById } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  COUNCIL_TUNING as T,
} from './council_ids';
import {
  beginBar,
  type CouncilScope,
  living,
  memberFree,
  namesOf,
  pickMarks,
  raidWarn,
  roll,
} from './council_scope';
import { wakeKicked } from './council_stone';
import { councilSay } from './council_voice';
import { secondsToNextWrath } from './council_wrath';

/** Seam Bolt: the Singer's own. */
export function startBolt(s: CouncilScope): boolean {
  const c = s.bodies.singer;
  if (!living(c) || s.st.quiet > 0 || !memberFree(s, 'singer')) return false;
  // A kick's lockout holds its bolt too.
  if (isLockedOut(c, 'nature')) return false;
  const seen = s.players.filter(
    (p) =>
      !p.dead &&
      Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) <= T.boltRange &&
      s.ctx.hasLineOfSight(c, p),
  );
  // Any player in sight (the tank only when nobody else is).
  const [victim] = pickMarks({ ...s, players: seen }, c, 1);
  s.st.boltTimer = T.boltEvery;
  if (!victim) return false;
  beginBar(s, 'singer', COUNCIL_CASTS.bolt, T.boltCast, victim.id, false);
  s.st.kickable = COUNCIL_CASTS.bolt;
  return true;
}

export function landBolt(s: CouncilScope, c: Entity, targetId: number | null): void {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!t || t.dead) return;
  if (Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z) > T.boltRange) return;
  if (!s.ctx.hasLineOfSight(c, t)) return;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: c.id,
    targetId: t.id,
    school: 'nature',
    fx: 'projectile',
    ability: COUNCIL_CASTS.bolt,
  });
  s.ctx.dealDamage(
    c,
    t,
    roll(s, c, T.boltMin, T.boltMax),
    false,
    'nature',
    COUNCIL_NAMES.bolt,
    'hit',
    true,
  );
}

/** Is the song owed now? Normal: a Wrath landed a moment ago. Heroic: its
 *  own clock. */
function songDue(s: CouncilScope): boolean {
  if (s.rules.songAfterWrath) return s.st.songDue !== null && s.st.songDue <= 0;
  return s.st.songTimer <= 0;
}

/** The song comes due on the Singer (exported for the dev trigger, `force`
 *  skipping the timing guard). */
export function startSong(s: CouncilScope, force = false): boolean {
  const c = s.bodies.singer;
  if (!living(c)) return false;
  if (!force && !songDue(s)) return false;
  if (s.st.quiet > 0 || isLockedOut(c, 'nature')) return false;
  if (!memberFree(s, 'singer')) return false;
  s.st.songDue = null;
  s.st.songTimer = T.songEvery;
  beginBar(s, 'singer', COUNCIL_CASTS.song, T.songCast, null, false);
  s.st.kickable = COUNCIL_CASTS.song;
  raidWarn(s, c, 'song', 'Song of the Seam! Interrupt it!');
  councilSay(s, 'singer', 'song');
  return true;
}

/** Resonance goes on `count` players (never one already ringing). */
export function applyResonance(s: CouncilScope, singer: Entity, count: number): Entity[] {
  const busy = new Set(s.st.resonance.map((r) => r.playerId));
  const marked = pickMarks(s, singer, count, busy);
  // Normal: it runs out a breath before the next Wrath, whatever the fill
  // (an heir's soft-enraged Wrath comes sooner).
  const seconds = s.rules.songAfterWrath
    ? Math.max(3, Math.min(T.resonanceSeconds, secondsToNextWrath(s) - 1.5))
    : T.resonanceSeconds;
  for (const p of marked) {
    s.st.resonance.push({ playerId: p.id, remaining: seconds, tick: T.resonanceEvery });
    s.ctx.applyAura(p, {
      id: COUNCIL_AURAS.resonance,
      name: COUNCIL_NAMES.resonance,
      kind: 'vulnerability',
      remaining: seconds,
      duration: seconds,
      value: 0,
      value2: T.resonanceRadius,
      sourceId: singer.id,
      school: 'nature',
      undispellable: true,
    });
  }
  if (marked.length > 0)
    raidWarn(
      s,
      singer,
      'resonance',
      `Resonance on ${namesOf(marked)}: move away from everyone until it ends!`,
      { players: namesOf(marked) },
    );
  return marked;
}

/** The song was sung out. */
export function landSong(s: CouncilScope, singer: Entity): void {
  applyResonance(s, singer, T.songMarks);
}

/** A kickable bar was cut: the bolt fizzles, the song rings on one only,
 *  Wake the Stone raises nothing. */
export function songKicked(s: CouncilScope, singer: Entity, castId: string): void {
  s.st.quiet = T.kickQuiet;
  if (castId === COUNCIL_CASTS.song) applyResonance(s, singer, T.songKickedMarks);
  else if (castId === COUNCIL_CASTS.wake) wakeKicked(s, singer);
}

/** One tick of every Resonance: each second it rings on every ally within
 *  its ring (never its carrier). Returns the blows dealt this tick (the tests
 *  read it). */
export function stepResonance(s: CouncilScope): number {
  if (s.st.resonance.length === 0) return 0;
  const source =
    (living(s.bodies.singer) ? s.bodies.singer : null) ??
    COUNCIL_ROLES.map((r) => s.bodies[r]).find(living) ??
    null;
  let blows = 0;
  for (const r of s.st.resonance) {
    r.remaining -= DT;
    const p = s.ctx.entities.get(r.playerId);
    if (!p || p.dead || r.remaining <= -1e-9 || !source) continue;
    r.tick -= DT;
    if (r.tick > 1e-9) continue;
    r.tick += T.resonanceEvery;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: p.id,
      school: 'nature',
      fx: 'nova',
      ability: COUNCIL_CUES.resonancePulse,
    });
    for (const q of s.players) {
      if (q === p || q.dead) continue;
      if (Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) > T.resonanceRadius + 1e-6) continue;
      s.ctx.dealDamage(
        source,
        q,
        roll(s, source, T.resonanceMin, T.resonanceMax),
        false,
        'nature',
        COUNCIL_NAMES.resonance,
        'hit',
        true,
      );
      blows++;
    }
  }
  const gone = s.st.resonance.filter((r) => {
    const p = s.ctx.entities.get(r.playerId);
    return r.remaining <= 1e-9 || !p || p.dead;
  });
  if (gone.length === 0) return blows;
  for (const r of gone) {
    const p = s.ctx.entities.get(r.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.resonance);
  }
  s.st.resonance = s.st.resonance.filter((r) => !gone.includes(r));
  return blows;
}

/** Drop every Resonance (a reset, the council's fall). */
export function clearSong(s: CouncilScope): void {
  for (const r of s.st.resonance) {
    const p = s.ctx.entities.get(r.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.resonance);
  }
  s.st.resonance = [];
  s.st.kickable = null;
}

export function clearSongBars(b: Entity): void {
  clearCastIf(b, COUNCIL_CASTS.bolt, COUNCIL_CASTS.song);
}
