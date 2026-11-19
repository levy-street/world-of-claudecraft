// Opposing Elements: the Masterless Strength's polarity pairs (Jose's brief
// of 2026-11-19 (b); every number in final_elements_ids.ts).
//
//   The marks    every 48 s (first 42 s in, after the first tank swap) it
//                marks living NON-TANK players (never its tank, never a
//                player carrying Elemental Strike), each with an element:
//                Fire and Ice are opposites, Earth and Lightning. Always an
//                even count in matching opposite pairs (4 on Normal, 6 on
//                Heroic, 8 = every non-tank on Mythic); an odd player out is
//                left unmarked.
//   Grace        no meeting counts for the first 1.5 s (players marked side
//                by side step apart first).
//   Cancel       a marked player who comes within 3 yd of one of the
//                OPPOSITE element: both marks go in a burst.
//   Clash        within 3 yd of any other mark (the same element, or the
//                other pair's): an explosion (both on Normal and Heroic;
//                everyone within 8 yd on Mythic), both marks gone.
//   Timeout      a mark still worn after 10 s: on its player (Normal), the
//                raid (Heroic), harder on the raid (Mythic).
//   Orphans      a mark whose every possible partner is gone (dead, or
//                spent in a clash) fades quietly: nobody is ever left with no
//                partner to find.
//   Cadence      the round waits while a fusion runs or the Anvil is near.
// No tether: the marks read on the bodies (the painter's sigils) and the
// marked player's own arrow. Deterministic: the picks are hashed; the only
// rng draws are the damage rolls.

import { DT, type Entity } from '../../types';
import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CUES,
  ELEMENT_NAMES,
  POLARITY_CODES,
  type Polarity,
  polaritiesCancel,
  polarityCount,
  polarityFor,
} from './final_elements_ids';
import type { PolarityMark } from './final_elements_state';
import { combosRunning } from './final_fusion';
import {
  at,
  bossTank,
  cueAt,
  cueOn,
  dropAura,
  type FinalScope,
  hit,
  livePlayers,
  pickPlayers,
  putMarker,
  roll,
} from './final_scope';
import { elementRules, struckTank } from './final_strike';

const SCHOOL: Readonly<Record<Polarity, 'fire' | 'frost' | 'nature' | 'physical'>> = {
  fire: 'fire',
  ice: 'frost',
  earth: 'physical',
  lightning: 'nature',
};

/** The players a round may mark: alive, never the boss's tank, never a
 *  player carrying Elemental Strike (the other tank). */
export function polarityPool(s: FinalScope): Entity[] {
  const tank = bossTank(s);
  return livePlayers(s).filter((p) => p !== tank && !struckTank(p));
}

/** Begin a round. Returns the marks laid. */
export function startOpposites(s: FinalScope): PolarityMark[] {
  const el = s.st.elements;
  const pool = polarityPool(s);
  const n = polarityCount(pool.length, elementRules(s).polarityMarks);
  const busy = new Set(
    livePlayers(s)
      .filter((p) => !pool.includes(p))
      .map((p) => p.id),
  );
  const picked = n > 0 ? pickPlayers(s, n, el.rounds * 19 + 1301, busy) : [];
  el.rounds++;
  clearMarks(s);
  el.marks = picked.map((p, k) => {
    const polarity = polarityFor(k);
    putMarker(p, ELEMENT_AURAS.polarity, ELEMENT_NAMES.polarity, E.polaritySeconds, s.boss.id, {
      value: POLARITY_CODES[polarity],
      school: SCHOOL[polarity],
    });
    return { pid: p.id, polarity };
  });
  el.polarityLeft = el.marks.length > 0 ? E.polaritySeconds : 0;
  el.polarityClock = E.polarityEvery;
  return el.marks;
}

function clearMarks(s: FinalScope): void {
  for (const m of s.st.elements.marks) {
    const p = s.ctx.entities.get(m.pid);
    if (p) dropAura(p, ELEMENT_AURAS.polarity);
  }
  s.st.elements.marks = [];
}

function dropMark(s: FinalScope, m: PolarityMark): void {
  const p = s.ctx.entities.get(m.pid);
  if (p) dropAura(p, ELEMENT_AURAS.polarity);
}

/** One tick of the round: the meetings, the orphans, the timeout. */
function stepRound(s: FinalScope): void {
  const el = s.st.elements;
  const r = elementRules(s);
  // The marks still worn by the living (the round's own clock ends them: the
  // aura's runs out on the same beat, so it is never read as worn).
  let marks = el.marks.filter((m) => {
    const p = s.ctx.entities.get(m.pid);
    const worn = !!p && !p.dead;
    if (!worn && p) dropAura(p, ELEMENT_AURAS.polarity);
    return worn;
  });
  // The meetings, nearest first in id order (none through the grace).
  const spent = new Set<number>();
  const judging = el.polarityLeft <= E.polaritySeconds - E.polarityGrace + 1e-9;
  for (let i = 0; i < marks.length && judging; i++) {
    const a = marks[i];
    if (spent.has(a.pid)) continue;
    const pa = s.ctx.entities.get(a.pid) as Entity;
    const qa = at(s, pa);
    for (let j = i + 1; j < marks.length; j++) {
      const b = marks[j];
      if (spent.has(b.pid)) continue;
      const pb = s.ctx.entities.get(b.pid) as Entity;
      const qb = at(s, pb);
      if (Math.hypot(qa.x - qb.x, qa.z - qb.z) > E.meetR) continue;
      spent.add(a.pid);
      spent.add(b.pid);
      const mx = (qa.x + qb.x) / 2;
      const mz = (qa.z + qb.z) / 2;
      if (polaritiesCancel(a.polarity, b.polarity)) {
        el.balanced++;
        cueAt(s, ELEMENT_CUES.balance, mx, mz, E.meetR, SCHOOL[a.polarity]);
      } else {
        el.clashes++;
        cueAt(
          s,
          ELEMENT_CUES.clash,
          mx,
          mz,
          r.clashReach === 'around' ? E.clashR : E.meetR,
          'arcane',
        );
        const struck =
          r.clashReach === 'around'
            ? livePlayers(s).filter((p) => {
                const q = at(s, p);
                return Math.hypot(q.x - mx, q.z - mz) <= E.clashR;
              })
            : [pa, pb];
        for (const p of struck)
          if (!p.dead) hit(s, p, roll(s, r.clashMin, r.clashMax), ELEMENT_NAMES.clash, 'arcane');
      }
      dropMark(s, a);
      dropMark(s, b);
      break;
    }
  }
  marks = marks.filter((m) => !spent.has(m.pid));
  // Orphans: no partner of the opposite element left to find.
  marks = marks.filter((m) => {
    const partner = marks.some((o) => o !== m && polaritiesCancel(m.polarity, o.polarity));
    if (!partner) dropMark(s, m);
    return partner;
  });
  el.marks = marks;
  if (marks.length === 0) {
    el.polarityLeft = 0;
    return;
  }
  el.polarityLeft -= DT;
  if (el.polarityLeft > 1e-9) return;
  // Run out: each mark still worn unbalances.
  el.unbalanced += marks.length;
  const raid = r.unbalancedOn === 'raid';
  for (const m of marks) {
    const p = s.ctx.entities.get(m.pid);
    if (p) cueOn(s, p, ELEMENT_CUES.unbalanced, 'arcane');
  }
  if (raid) {
    const k = 1 + 0.5 * (marks.length - 1);
    for (const p of livePlayers(s))
      hit(
        s,
        p,
        Math.round(roll(s, r.unbalancedMin, r.unbalancedMax) * k),
        ELEMENT_NAMES.unbalanced,
        'arcane',
      );
  } else
    for (const m of marks) {
      const p = s.ctx.entities.get(m.pid);
      if (p && !p.dead)
        hit(s, p, roll(s, r.unbalancedMin, r.unbalancedMax), ELEMENT_NAMES.unbalanced, 'arcane');
    }
  clearMarks(s);
  el.polarityLeft = 0;
}

/** One tick: a round under way, or the next one when it is due and clear
 *  of a fusion and the Anvil (the quarter fight and the final phase). */
export function stepOpposites(s: FinalScope): void {
  const el = s.st.elements;
  if (el.marks.length > 0) {
    stepRound(s);
    return;
  }
  el.polarityClock -= DT;
  if (el.polarityClock > 1e-9) return;
  const anvilNear = s.st.anvil !== null || s.st.anvilClock < E.polarityAnvilClear;
  if (combosRunning(s) || anvilNear || s.st.bar) {
    el.polarityClock = 0;
    return;
  }
  startOpposites(s);
}

/** Every mark gone (the fight's end). */
export function clearOpposites(s: Pick<FinalScope, 'st'>, players: readonly Entity[]): void {
  s.st.elements.marks = [];
  s.st.elements.polarityLeft = 0;
  for (const p of players) dropAura(p, ELEMENT_AURAS.polarity);
}
