// Elemental Strike: the Masterless Strength's tank swap (Jose's brief of
// 2026-11-19 (b); the leaf final_elements_ids.ts holds every number).
//
//   The strike    every 8 s (every tier) it strikes its tank (in reach) with
//                 the element of the quarter it stands in (the ring and the
//                 final phase: the last quarter it drank) and leaves a stack
//                 of that element's debuff for 30 s; each strike refreshes the
//                 stacks and hits harder per stack. A strike in another element
//                 RE-FORGES the stacks into its own (the count carries over), so
//                 dragging the boss on never resets a tank: the stacks fall off
//                 only 30 s after the last strike, the swap's window.
//   Heat          Searing Burn: a burn every second, per stack.
//   Quench        Biting Frost: slower per stack; from 5 stacks every strike
//                 plants Hardening Frost at the tank's feet: a ring of frost
//                 closing 3 s later, freezing solid (2 s) whoever still
//                 stands in it (Jose's playtest of 2026-11-20: the old freeze
//                 landed with the strike, so a tank carrying stacks into the
//                 Quench froze the moment the boss arrived). Never on the
//                 strike that re-forges older stacks into frost: a freeze is
//                 never the first thing a quarter change does.
//   Breath        Static Charge: magic damage taken up per stack; from 3
//                 stacks lightning arcs every 2 s from the tank to every ally
//                 within 6 yd (the melee spreads off the tank).
//   Hammer        Cracked Armor: armour down per stack.
// From 4 stacks the tank swaps: a fresh tank takes it on to the next quarter.
// Deterministic: no pick (the boss's own aggro target); the only rng draws are
// the damage rolls.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import {
  arcScale,
  armorKept,
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CUES,
  ELEMENT_DIFFICULTY,
  ELEMENT_NAMES,
  type ElementRules,
  frostSlow,
  rimeTemplate,
  STRIKE_AURAS,
  strikeScale,
} from './final_elements_ids';
import type { FinalElementsState } from './final_elements_state';
import {
  at,
  auraOf,
  beamCue,
  bossTank,
  cueAt,
  cueOn,
  damageMult,
  dropAura,
  dropFightObject,
  type FinalScope,
  hit,
  livePlayers,
  putMarker,
  roll,
  spawnFightObject,
} from './final_scope';

const VEINS: readonly SmithHeartVein[] = ['heat', 'quench', 'breath', 'hammer'];

const SCHOOL: Readonly<Record<SmithHeartVein, 'fire' | 'frost' | 'nature' | 'physical'>> = {
  heat: 'fire',
  quench: 'frost',
  breath: 'nature',
  hammer: 'physical',
};

/** The tier's elemental rules. */
export function elementRules(s: Pick<FinalScope, 'st'>): ElementRules {
  return ELEMENT_DIFFICULTY[s.st.difficulty];
}

/** The element its strike carries now: the quarter it stands in, else the
 *  last it drank (the ring, the final phase), else its base form. */
export function strikeElement(s: Pick<FinalScope, 'st'>): SmithHeartVein {
  const st = s.st;
  if (st.zone !== 'ring') return st.zone;
  return st.lastQuarter ?? st.baseForm ?? 'hammer';
}

/** A player's Elemental Strike stacks (any element) and which element. */
export function strikeStacks(p: Entity): { stacks: number; vein: SmithHeartVein | null } {
  for (const v of VEINS) {
    const a = auraOf(p, STRIKE_AURAS[v]);
    if (a) return { stacks: Math.max(1, a.stacks ?? 1), vein: v };
  }
  return { stacks: 0, vein: null };
}

/** Is `p` carrying Elemental Strike stacks (a tank of this fight)? */
export function struckTank(p: Entity): boolean {
  return strikeStacks(p).stacks > 0;
}

/** Strike `tank` once in `vein`: its hit, one stack more (the old element's
 *  re-forged), the element's effect. Returns the stacks it now carries.
 *  Exported for the dev verb and the tests. */
export function elementalStrike(s: FinalScope, tank: Entity, vein = strikeElement(s)): number {
  const r = elementRules(s);
  const had = strikeStacks(tank);
  const stacks = Math.min(E.stackCap, had.stacks + 1);
  // Older stacks re-forged into this element by this very strike.
  const reforged = had.vein !== null && had.vein !== vein;
  for (const v of VEINS) if (v !== vein) dropAura(tank, STRIKE_AURAS[v]);
  const school = SCHOOL[vein];
  cueOn(s, tank, ELEMENT_CUES.strike, school);
  const amount = Math.round(
    roll(s, r.strikeMin, r.strikeMax) * strikeScale(stacks, r.strikeGrowth),
  );
  hit(s, tank, amount, ELEMENT_NAMES.strike, school);
  if (tank.dead) return stacks;
  putStack(s, tank, vein, stacks, r);
  if (vein === 'quench' && stacks >= E.freezeAt && !reforged) layRime(s, tank);
  s.st.elements.strikes++;
  return stacks;
}

/** The element's debuff at `stacks` (replacing any older one of its id). */
function putStack(
  s: FinalScope,
  tank: Entity,
  vein: SmithHeartVein,
  stacks: number,
  r: ElementRules,
): void {
  const id = STRIKE_AURAS[vein];
  const old = auraOf(tank, id);
  const base = {
    id,
    name: ELEMENT_NAMES[vein],
    remaining: E.stackSeconds,
    duration: E.stackSeconds,
    sourceId: s.boss.id,
    stacks,
    undispellable: true as const,
    encounterOwned: true as const,
  };
  if (old) dropAura(tank, id);
  switch (vein) {
    case 'heat':
      s.ctx.applyAura(tank, {
        ...base,
        kind: 'dot',
        value: Math.max(1, Math.round(r.burnPerStack * stacks * damageMult(s))),
        tickInterval: 1,
        tickTimer: old?.tickTimer ?? 1,
        school: 'fire',
        finalDamage: true,
      });
      return;
    case 'quench':
      s.ctx.applyAura(tank, {
        ...base,
        kind: 'slow',
        value: 1 - frostSlow(stacks, r.frostSlowPerStack),
        school: 'frost',
      });
      return;
    case 'breath':
      s.ctx.applyAura(tank, {
        ...base,
        kind: 'spellvuln',
        value: 0.03 * stacks,
        school: 'nature',
      });
      return;
    case 'hammer': {
      const lost = (1 - armorKept(stacks, r.armorPerStack)) * Math.max(0, tank.stats.armor);
      s.ctx.applyAura(tank, {
        ...base,
        kind: 'corrode',
        value: Math.round(lost / stacks),
        school: 'physical',
      });
      return;
    }
  }
}

/** Hardening Frost: a ring of frost planted at the tank's feet, closing
 *  `rimeWarn` later (one at a time a tank). Exported for the tests. */
export function layRime(s: FinalScope, tank: Entity): boolean {
  const el = s.st.elements;
  if (el.rimes.some((r) => r.pid === tank.id)) return false;
  const q = at(s, tank);
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    rimeTemplate(E.rimeWarn),
    ELEMENT_NAMES.rime,
    q.x,
    q.z,
    E.rimeR,
  );
  el.rimes.push({ objectId: obj.id, pid: tank.id, x: q.x, z: q.z, left: E.rimeWarn });
  putMarker(tank, ELEMENT_AURAS.rime, ELEMENT_NAMES.rime, E.rimeWarn, s.boss.id, {
    school: 'frost',
  });
  return true;
}

/** One tick of the rings: each closes at its time, freezing whoever still
 *  stands in it. Returns who froze. */
export function stepRimes(s: FinalScope): Entity[] {
  const el = s.st.elements;
  if (el.rimes.length === 0) return [];
  const frozen: Entity[] = [];
  const keep: typeof el.rimes = [];
  for (const r of el.rimes) {
    r.left -= DT;
    if (r.left > 1e-9) {
      keep.push(r);
      continue;
    }
    dropFightObject(s.ctx, s.inst, r.objectId);
    const owner = s.ctx.entities.get(r.pid);
    if (owner) dropAura(owner, ELEMENT_AURAS.rime);
    cueAt(s, ELEMENT_CUES.rime, r.x, r.z, E.rimeR, 'frost');
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - r.x, q.z - r.z) > E.rimeR) continue;
      freeze(s, p);
      frozen.push(p);
    }
  }
  el.rimes = keep;
  return frozen;
}

/** Every ring gone unclosed (the fight's end). */
function clearRimes(s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>, players: readonly Entity[]): void {
  for (const r of s.st.elements.rimes) dropFightObject(s.ctx, s.inst, r.objectId);
  s.st.elements.rimes = [];
  for (const p of players) dropAura(p, ELEMENT_AURAS.rime);
}

/** Biting Frost's freeze: 2 s solid. */
function freeze(s: FinalScope, tank: Entity): void {
  cueOn(s, tank, ELEMENT_CUES.frozen, 'frost');
  s.ctx.applyAura(tank, {
    id: ELEMENT_AURAS.frozen,
    name: ELEMENT_NAMES.frozen,
    kind: 'stun',
    remaining: E.freezeSeconds,
    duration: E.freezeSeconds,
    value: 0,
    sourceId: s.boss.id,
    school: 'frost',
    unbreakableControl: true,
    undispellable: true,
  });
}

/** Static Charge's arcs: from every charged tank (3 stacks or more) to every
 *  ally within reach, every `arcEvery`. Returns who was struck. */
export function stepStatic(s: FinalScope): Entity[] {
  const el = s.st.elements;
  const r = elementRules(s);
  const struck: Entity[] = [];
  const alive = livePlayers(s);
  for (const tank of alive) {
    const a = auraOf(tank, STRIKE_AURAS.breath);
    const k = arcScale(a ? Math.max(1, a.stacks ?? 1) : 0);
    if (k <= 0) {
      delete el.arcClock[tank.id];
      continue;
    }
    const left = (el.arcClock[tank.id] ?? E.arcEvery) - DT;
    if (left > 1e-9) {
      el.arcClock[tank.id] = left;
      continue;
    }
    el.arcClock[tank.id] = E.arcEvery;
    const from = at(s, tank);
    for (const o of alive) {
      if (o === tank || o.dead) continue;
      const q = at(s, o);
      if (Math.hypot(q.x - from.x, q.z - from.z) > E.arcReach) continue;
      beamCue(s, tank.id, o.id, ELEMENT_CUES.staticArc);
      hit(s, o, Math.round(roll(s, r.arcMin, r.arcMax) * k), ELEMENT_NAMES.breath, 'nature');
      struck.push(o);
    }
  }
  return struck;
}

/** One tick of the strike's clock: on its tank when it is due and in reach
 *  (never through one of its planted bars). Returns the stacks laid, or 0. */
export function stepStrike(s: FinalScope): number {
  const el = s.st.elements;
  el.strikeClock -= DT;
  if (el.strikeClock > 1e-9) return 0;
  const tank = bossTank(s);
  if (!tank || s.st.bar || s.ctx.isStunned(s.boss)) {
    el.strikeClock = 0;
    return 0;
  }
  const b = at(s, s.boss);
  const q = at(s, tank);
  if (Math.hypot(q.x - b.x, q.z - b.z) > E.strikeReach) {
    el.strikeClock = 0;
    return 0;
  }
  el.strikeClock = E.strikeEvery;
  return elementalStrike(s, tank);
}

/** Every strike debuff and ring gone (the fight's end). */
export function clearStrike(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  clearRimes(s, players);
  for (const p of players) {
    for (const v of VEINS) dropAura(p, STRIKE_AURAS[v]);
    dropAura(p, ELEMENT_AURAS.frozen);
  }
}

/** The elements' state at the pull. */
export function freshElements(): FinalElementsState {
  return {
    strikeClock: E.strikeFirst,
    strikes: 0,
    arcClock: {},
    rimes: [],
    pending: null,
    casting: null,
    fusions: 0,
    lastCombo: null,
    comboQuarter: null,
    steam: [],
    magma: [],
    pools: [],
    poolTick: E.lavaTick,
    lanes: [],
    hail: [],
    hailWaves: 0,
    hailClock: 0,
    avalancheLater: null,
    spires: [],
    polarityClock: E.polarityFirst,
    polarityLeft: 0,
    marks: [],
    rounds: 0,
    balanced: 0,
    clashes: 0,
    unbalanced: 0,
  };
}
