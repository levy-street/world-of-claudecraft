// Opposing Elements: the Masterless Strength's polarity pairs (Jose's brief
// of 2026-11-19 (b); every number in final_elements_ids.ts).
//
//   The marks    every 48 s (first 42 s in, after the first tank swap) it
//                marks living NON-TANK players (never its tank, never a
//                player carrying Elemental Strike), each with an element:
//                Fire and Ice are opposites, Earth and Lightning. Always an
//                even count in matching opposite pairs (4 on Normal; EVERY
//                living non-tank on Heroic and Mythic, the manager's feedback
//                of 2026-11-20); with an odd count one player is left
//                unmarked, so nobody is ever without a possible partner.
//   Grace        no meeting counts for the first 1.5 s (players marked side
//                by side step apart first).
//   Cancel       a marked player who comes within 3 yd of one of the
//                OPPOSITE element: both marks go in a burst.
//   Clash        within 3 yd of any other mark (the same element, or the
//                other pair's): an explosion (both on Normal and Heroic;
//                everyone within 8 yd on Mythic), both marks gone.
//   Timeout      a mark still worn after 10 s: on its player (Normal); on
//                the raid once per failed pair (Heroic; Mythic hard enough
//                that two failed pairs wipe a healthy raid).
//   Orphans      a mark whose every possible partner is gone (its partner
//                died, or was spent in a clash) is cleared harmlessly at once:
//                nobody is ever left holding a mark with no partner to find.
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
  echoTemplate,
  POLARITY_CODES,
  POLARITY_ORDER,
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
  dropFightObject,
  type FinalScope,
  hit,
  livePlayers,
  onFloor,
  pickPlayers,
  putMarker,
  roll,
  spawnFightObject,
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

/** The pairs a timeout counts as failed: the marks left, two to a pair,
 *  rounded up (a lone mark left is a failed pair too). */
export function failedPairs(marksLeft: number): number {
  return Math.ceil(Math.max(0, marksLeft) / 2);
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
  for (const m of s.st.elements.marks) dropMark(s, m);
  s.st.elements.marks = [];
}

function dropMark(s: Pick<FinalScope, 'ctx' | 'inst'>, m: PolarityMark): void {
  if (m.echo) {
    dropFightObject(s.ctx, s.inst, m.pid);
    return;
  }
  const p = s.ctx.entities.get(m.pid);
  if (p) dropAura(p, ELEMENT_AURAS.polarity);
}

/** DEV ONLY (`/dev heart final opposites`): a round as play would lay it,
 *  or, with nobody to pair (a solo caller is the boss's tank, never in the
 *  pool), the caller marked and a practice echo of the opposite element set
 *  on the floor `echoGap` yards off, so the whole round can be seen alone:
 *  the sigil, the arrow, walking into the echo to cancel, or the timeout.
 *  Never reached in play. */
export function startOppositesForDev(
  s: FinalScope,
  me: Entity | null,
): { marks: PolarityMark[]; echo: boolean } {
  const marks = startOpposites(s);
  if (marks.length > 0 || !me || me.dead || !s.players.includes(me)) return { marks, echo: false };
  const el = s.st.elements;
  const mine = POLARITY_ORDER[(el.rounds - 1) % POLARITY_ORDER.length];
  const theirs = POLARITY_ORDER.find((q) => polaritiesCancel(mine, q)) ?? 'ice';
  const q = at(s, me);
  // Off to the side of the boss's line, on the floor.
  const b = at(s, s.boss);
  const away = Math.atan2(q.x - b.x, q.z - b.z) + Math.PI / 2;
  const spot = onFloor(
    { x: q.x + Math.sin(away) * ECHO_GAP, z: q.z + Math.cos(away) * ECHO_GAP },
    3,
  );
  const echo = spawnFightObject(
    s.ctx,
    s.inst,
    echoTemplate(theirs),
    ELEMENT_NAMES.polarity,
    spot.x,
    spot.z,
    1,
  );
  putMarker(me, ELEMENT_AURAS.polarity, ELEMENT_NAMES.polarity, E.polaritySeconds, s.boss.id, {
    value: POLARITY_CODES[mine],
    school: SCHOOL[mine],
  });
  el.marks = [
    { pid: me.id, polarity: mine },
    { pid: echo.id, polarity: theirs, echo: true },
  ];
  el.polarityLeft = E.polaritySeconds;
  return { marks: el.marks, echo: true };
}

/** The dev echo's distance from its caller (yards). */
const ECHO_GAP = 9;

/** One tick of the round: the meetings, the orphans, the timeout. */
function stepRound(s: FinalScope): void {
  const el = s.st.elements;
  const r = elementRules(s);
  // The marks still worn by the living (the round's own clock ends them: the
  // aura's runs out on the same beat, so it is never read as worn).
  let marks = el.marks.filter((m) => {
    const p = s.ctx.entities.get(m.pid);
    const worn = !!p && !p.dead;
    if (!worn) dropMark(s, m);
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
            : [pa, pb].filter((p) => s.players.includes(p));
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
    const p = m.echo ? undefined : s.ctx.entities.get(m.pid);
    if (p) cueOn(s, p, ELEMENT_CUES.unbalanced, 'arcane');
  }
  if (raid) {
    // Once per failed pair: one hurts, two wipe a healthy raid on Mythic.
    const k = failedPairs(marks.length);
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
      const p = m.echo ? undefined : s.ctx.entities.get(m.pid);
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
export function clearOpposites(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  for (const m of s.st.elements.marks) if (m.echo) dropMark(s, m);
  s.st.elements.marks = [];
  s.st.elements.polarityLeft = 0;
  for (const p of players) dropAura(p, ELEMENT_AURAS.polarity);
}
