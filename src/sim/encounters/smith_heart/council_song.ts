// The Seam Singer's job in the Hammer Council (docs/design/raid/smith_heart.md
// section 7.1): it sings the ochre seams of the stone loose.
//
//   Seam Bolt         every 8 s a 2 s kickable bar at a random player it can
//                     see; it lands only on a player still in sight.
//   Song of the Seam  a 3 s kickable bar: sung out, Resonance on 3 players;
//                     kicked, on 1. Normal: it waits for a Wrath to land, so
//                     its Resonance runs out before the next one. Heroic: it
//                     keeps its own clock and the two overlap.
//   Resonance         15 s, a visible ring on the player; standing within
//                     3.5 yd of a pillar's face for 3 seconds in a row takes a
//                     piece off it (the 3 s start again). Nothing cleanses it:
//                     the marked hide behind the most damaged pillar at Wrath
//                     and keep off the whole ones.
//   Heir              the Singer fallen, a survivor sings the song itself, on 3
//                     players (4 on mythic), and no kick stops it; the bolt
//                     stops with it.
//   Soul pillars      a Resonance carrier by a soul pillar for 3 s strikes a
//                     soul pip off (council_soul.ts) instead of a piece; by the
//                     Seam Singer's own soul, in 1.5 s.
//
// The kick: between two council passes only a player interrupt clears the
// Singer's bar (bosses take no spell pushback; a reset or a death runs the
// council's own cleanup first), so a kickable bar that is gone was cut.
// Zero rng in every pick; the draws are the damage rolls.

import { isLockedOut } from '../../combat/cc';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropAuraById } from '../sunken_bastion/claim';
import { COUNCIL_AURAS, COUNCIL_CASTS, COUNCIL_NAMES, COUNCIL_TUNING as T } from './council_ids';
import { councilPillars, crackPillar, pillarNear } from './council_pillars';
import {
  beginBar,
  type CouncilScope,
  jobHolder,
  living,
  memberFree,
  namesOf,
  pickMarks,
  raidWarn,
  roll,
} from './council_scope';
import { soulResonanceSeconds, strikeSoulPip } from './council_soul';
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

/** The song comes due on its holder (exported for the dev trigger, `force`
 *  skipping the timing guard). */
export function startSong(s: CouncilScope, force = false): boolean {
  const holder = jobHolder(s, 'resonance');
  if (!holder) return false;
  if (!force && !songDue(s)) return false;
  if (!holder.heir && (s.st.quiet > 0 || isLockedOut(holder.body, 'nature'))) return false;
  if (!memberFree(s, holder.role)) return false;
  s.st.songDue = null;
  s.st.songTimer = T.songEvery;
  const id = holder.heir ? COUNCIL_CASTS.songUnbroken : COUNCIL_CASTS.song;
  beginBar(s, holder.role, id, T.songCast, null, holder.heir);
  if (!holder.heir) {
    s.st.kickable = COUNCIL_CASTS.song;
    raidWarn(s, holder.body, 'song', 'Song of the Seam! Interrupt it!');
    councilSay(s, holder.role, 'song');
  }
  return true;
}

/** Resonance goes on `count` players (never one already ringing). */
export function applyResonance(s: CouncilScope, singer: Entity, count: number): Entity[] {
  const busy = new Set(s.st.resonance.map((r) => r.playerId));
  const marked = pickMarks(s, singer, count, busy);
  // Normal: it runs out a breath before the next Wrath, whatever the fill
  // (an heir's soft-enraged Wrath comes sooner than its 15 s).
  const seconds = s.rules.songAfterWrath
    ? Math.max(5, Math.min(T.resonanceSeconds, secondsToNextWrath(s) - 1.5))
    : T.resonanceSeconds;
  for (const p of marked) {
    s.st.resonance.push({ playerId: p.id, remaining: seconds, near: 0, pillarId: null });
    s.ctx.applyAura(p, {
      id: COUNCIL_AURAS.resonance,
      name: COUNCIL_NAMES.resonance,
      kind: 'vulnerability',
      remaining: seconds,
      duration: seconds,
      value: 0,
      value2: 0,
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
      `Resonance on ${namesOf(marked)}: crack the weakest pillar, keep off the whole ones!`,
      { players: namesOf(marked) },
    );
  return marked;
}

/** The song was sung out (by an heir: the difficulty's heir count). */
export function landSong(s: CouncilScope, singer: Entity, heir = false): void {
  applyResonance(s, singer, heir ? s.rules.heirSongMarks : T.songMarks);
}

/** A kickable bar was cut: the bolt fizzles, the song rings on one only. */
export function songKicked(s: CouncilScope, singer: Entity, castId: string): void {
  s.st.quiet = T.kickQuiet;
  if (castId === COUNCIL_CASTS.song) applyResonance(s, singer, T.songKickedMarks);
}

/** One tick of every Resonance: by a pillar for 3 s in a row, a piece off it. */
export function stepResonance(s: CouncilScope): void {
  if (s.st.resonance.length === 0) return;
  const pillars = councilPillars(s.ctx, s.inst);
  for (const r of s.st.resonance) {
    r.remaining -= DT;
    const p = s.ctx.entities.get(r.playerId);
    if (!p || p.dead || r.remaining <= 1e-9) continue;
    const near = pillarNear(pillars, p.pos, T.resonanceReach);
    const id = near ? near.e.id : null;
    if (id !== r.pillarId) {
      r.pillarId = id;
      r.near = 0;
    }
    // A soul pillar's own pace (the Singer's soul: twice as fast).
    const need = near?.soul ? soulResonanceSeconds(near.soul) : T.resonanceCrackSeconds;
    if (near) {
      r.near += DT;
      if (r.near >= need - 1e-9) {
        r.near = 0;
        if (near.soul) strikeSoulPip(s, near, 'resonance');
        else crackPillar(s.ctx, s.inst, s.st, near);
        // A fallen pillar is gone from this tick's list.
        if (!s.ctx.entities.has(near.e.id)) {
          pillars.splice(pillars.indexOf(near), 1);
          r.pillarId = null;
        }
      }
    }
    // The ring shows the climb (tenths, so the snapshot cache keeps eliding).
    const aura = p.auras.find((a) => a.id === COUNCIL_AURAS.resonance);
    if (aura) {
      aura.value = Math.floor((r.near / need) * 10) / 10;
      aura.value2 = r.pillarId ?? 0;
    }
  }
  const gone = s.st.resonance.filter((r) => {
    const p = s.ctx.entities.get(r.playerId);
    return r.remaining <= 1e-9 || !p || p.dead;
  });
  if (gone.length === 0) return;
  for (const r of gone) {
    const p = s.ctx.entities.get(r.playerId);
    if (p) dropAuraById(p, COUNCIL_AURAS.resonance);
  }
  s.st.resonance = s.st.resonance.filter((r) => !gone.includes(r));
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
  clearCastIf(b, COUNCIL_CASTS.bolt, COUNCIL_CASTS.song, COUNCIL_CASTS.songUnbroken);
}
