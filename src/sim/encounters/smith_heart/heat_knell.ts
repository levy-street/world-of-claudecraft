// The Guardian of the Heat's Searing Knell, and heroic's Knell Embers
// (docs/design/raid/smith_heart.md section 7.4). The knell itself stays the
// trash kit's screech (its bar, its ring, its stun of everyone close: the
// content record's numbers); this module only watches it land. On heroic
// every player it stuns leaves Knell Embers where they stood: a patch of the
// first flame on the floor that burns anyone in it every second for 25 s, so
// the melee and the tank must move the fight after every knell.
//
// A fresh knell is read off the stun the trash kit puts on a player (its id is
// the cast's): each stun aura object is seen once (a WeakSet keyed by the
// aura itself, so a long tick, a shortened stun or a late look can neither
// miss it nor count it twice). Zero rng but the damage rolls.

import { DT, type Entity } from '../../types';
import { embersTemplate, HEAT_CASTS, HEAT_CUES, HEAT_NAMES, HEAT_TUNING as T } from './heat_ids';
import {
  at,
  auraOf,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  roll,
  spawnFightObject,
} from './heat_scope';

/** The knell stuns already seen (by the aura object: deterministic, exact,
 *  and gone with the aura). */
const seenStuns = new WeakSet<object>();

/** Lay Knell Embers at instance-local (x, z). Exported for the dev trigger. */
export function layEmbers(s: HeatScope, x: number, z: number): void {
  const st = s.st;
  while (st.embers.length >= T.embersCap) {
    const old = st.embers.shift();
    if (old) dropFightObject(s.ctx, s.inst, old.objectId);
  }
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    embersTemplate(T.embersLife),
    HEAT_NAMES.embers,
    x,
    z,
    T.embersR,
  );
  st.embers.push({ objectId: obj.id, x, z, life: T.embersLife, tick: T.embersTick });
  cueAt(s, HEAT_CUES.embers, x, z, T.embersR);
}

/** Watch for a fresh Searing Knell's stun on the floor's players; on heroic
 *  each one leaves embers. Returns the players a fresh stun was found on. */
export function watchKnell(s: HeatScope): Entity[] {
  const st = s.st;
  const fresh: Entity[] = [];
  for (const p of livePlayers(s)) {
    const a = auraOf(p, HEAT_CASTS.knell);
    if (!a || a.kind !== 'stun' || seenStuns.has(a)) continue;
    seenStuns.add(a);
    st.knellAt[p.id] = st.clock;
    fresh.push(p);
    if (s.rules.knellEmbers) {
      const here = at(s, p);
      layEmbers(s, here.x, here.z);
    }
  }
  return fresh;
}

/** One tick of the embers: their burn, their burning out. */
export function stepEmbers(s: HeatScope): void {
  const st = s.st;
  if (st.embers.length === 0) return;
  for (const e of st.embers) {
    e.life -= DT;
    e.tick -= DT;
    if (e.tick > 1e-9 || e.life <= 1e-9) continue;
    e.tick += T.embersTick;
    for (const p of livePlayers(s)) {
      const here = at(s, p);
      if (Math.hypot(here.x - e.x, here.z - e.z) > T.embersR) continue;
      fireHit(s, p, roll(s, T.embersMin, T.embersMax), HEAT_NAMES.embers);
    }
  }
  const gone = st.embers.filter((e) => e.life <= 1e-9);
  if (gone.length === 0) return;
  for (const e of gone) dropFightObject(s.ctx, s.inst, e.objectId);
  st.embers = st.embers.filter((e) => e.life > 1e-9);
}

/** Every ember off the floor. */
export function clearEmbers(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  for (const e of s.st.embers) dropFightObject(s.ctx, s.inst, e.objectId);
  s.st.embers = [];
  s.st.knellAt = {};
}
