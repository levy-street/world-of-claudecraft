// Living Rime, the Guardian of the Quench's healer check (the owner's review
// of 2026-11-09; docs/design/raid/smith_heart.md section 7.3). Not a dispel:
// a crust of living ice that drinks healing.
//
//   The cast     every 25 s (the first 12 s into the fight) she sets it on the
//                tier's count of players (QUENCH_DIFFICULTY rimeTargets: 1, 2,
//                3), in a hashed order: never the active tank, never someone
//                frozen, under the ice, already rimed or marked for a slash.
//   The crust    a heal absorb (the `heal_absorb` aura Stone Shell rides,
//                combat/heal.ts consumeHealAbsorb) of the tier's rimeAbsorb;
//                while it holds its carrier is slowed 30% and their cold
//                rises the tier's rimeColdMult times as fast (twice on
//                Normal, half again on Heroic and Mythic; quench_cold.ts).
//                It asks them to LEAVE the group (its burst splashes the
//                raid) while their cold
//                climbs alone, so the healers must break it fast.
//   Healed       within 10 s: it falls away, nothing else.
//   Not healed   its carrier freezes at once (Encased in Rime, the cold's own
//                freeze and shatter) and the cold bursts on everyone within
//                6 yd (the tier's splashCold, a shatter's splash: one a tick,
//                bounded by Frost-Brittle, so it may chain but never lock).
//                A carrier frozen by their own cold before the 10 s is up has
//                not been healed through either: the same burst, at once.
//   Heroic       a burst leaps to the nearest other player it may take, with
//                a fresh crust (the row's rimeLeap; Mythic keeps it).
//
// The absorb's left and whole ride the aura (`value`, `value2`) and its
// seconds `remaining`, kept by this module (the aura never runs out on its own:
// the burst is this fight's to resolve). Zero rng: every pick is hashed or by
// distance.

import { DT, type Entity } from '../../types';
import { warded } from './quench_bite';
import { freezePlayer, isFrozen, splashRound } from './quench_cold';
import {
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_NAMES,
  quenchHash,
  QUENCH_TUNING as T,
} from './quench_ids';
import { at, auraOf, dropAura, livePlayers, type QuenchScope } from './quench_scope';

/** May Living Rime take `p` now? */
function rimeable(s: QuenchScope, p: Entity): boolean {
  if (p.dead) return false;
  if (p.id === s.boss.aggroTargetId) return false;
  if (isFrozen(s, p.id) || s.st.trapped[p.id] !== undefined || warded(p)) return false;
  if (s.st.rimes.some((r) => r.id === p.id)) return false;
  return auraOf(p, QUENCH_AURAS.marked) === undefined;
}

/** Who a cast takes: the tier's count, hashed, from the players it may. */
export function pickRimeTargets(s: QuenchScope, count: number): Entity[] {
  // Its own count salts the pick (the shared `casts` salts the slashes'
  // and the hunt's: a rime never reshuffles them).
  const salt = s.boss.id * 37 + s.st.rimeCasts * 11 + 5;
  return livePlayers(s)
    .filter((p) => rimeable(s, p))
    .map((p) => ({ p, key: quenchHash(salt, p.id) }))
    .sort((a, b) => a.key - b.key || a.p.id - b.p.id)
    .slice(0, Math.max(0, count))
    .map((o) => o.p);
}

/** Set the crust on `p` (and its slow), its clock full. `from` casts it (the
 *  guardian, or the carrier it leapt from). False when it did not take. */
export function setRime(s: QuenchScope, p: Entity, from: Entity): boolean {
  const absorb = s.rules.rimeAbsorb;
  dropAura(p, QUENCH_AURAS.rime);
  dropAura(p, QUENCH_AURAS.rimeSlow);
  s.ctx.applyAura(p, {
    id: QUENCH_AURAS.rime,
    name: QUENCH_NAMES.rime,
    kind: 'heal_absorb',
    remaining: T.rimeSeconds,
    duration: T.rimeSeconds,
    value: absorb,
    value2: absorb,
    sourceId: s.boss.id,
    school: 'frost',
    undispellable: true,
    encounterOwned: true,
  });
  if (auraOf(p, QUENCH_AURAS.rime) === undefined) {
    // It did not take (an immunity): no crust, no mark, nothing to break.
    s.st.rimes = s.st.rimes.filter((r) => r.id !== p.id);
    return false;
  }
  s.ctx.applyAura(p, {
    id: QUENCH_AURAS.rimeSlow,
    name: QUENCH_NAMES.rime,
    kind: 'slow',
    remaining: T.rimeSeconds,
    duration: T.rimeSeconds,
    value: T.rimeSlow,
    sourceId: s.boss.id,
    school: 'frost',
    undispellable: true,
    encounterOwned: true,
  });
  s.st.rimes = s.st.rimes.filter((r) => r.id !== p.id);
  s.st.rimes.push({ id: p.id, remaining: T.rimeSeconds });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: from.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.rime,
  });
  return true;
}

/** The guardian sets Living Rime on the tier's count. Returns who. */
export function castRime(s: QuenchScope): Entity[] {
  const targets = pickRimeTargets(s, s.rules.rimeTargets);
  s.st.rimeCasts++;
  return targets.filter((p) => setRime(s, p, s.boss));
}

function dropRimeAuras(p: Entity): void {
  dropAura(p, QUENCH_AURAS.rime);
  dropAura(p, QUENCH_AURAS.rimeSlow);
}

/** The nearest other player a burst from `from` may leap to, or null. */
export function rimeLeapTarget(s: QuenchScope, from: Entity): Entity | null {
  const here = at(s, from);
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const q of livePlayers(s)) {
    if (q.id === from.id || !rimeable(s, q)) continue;
    const there = at(s, q);
    const d = Math.hypot(there.x - here.x, there.z - here.z);
    if (d < bestD - 1e-9) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

/** Not healed through: the carrier freezes, the cold bursts round them and,
 *  on a leaping tier, a fresh crust takes the nearest other player. Returns
 *  the players the burst splashed. */
export function burstRime(s: QuenchScope, p: Entity): Entity[] {
  dropRimeAuras(p);
  s.st.rimes = s.st.rimes.filter((r) => r.id !== p.id);
  s.st.rimeBursts++;
  if (!isFrozen(s, p.id)) freezePlayer(s, p);
  const o = s.ctx.instanceOriginOf(s.inst);
  const here = at(s, p);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + here.x,
    z: o.z + here.z,
    school: 'frost',
    fx: 'burst',
    radius: T.rimeBurstR,
    ability: QUENCH_CUES.rimeBurst,
  });
  const splashed = splashRound(s, p, T.rimeBurstR);
  if (s.rules.rimeLeap) {
    const next = rimeLeapTarget(s, p);
    if (next) setRime(s, next, p);
  }
  return splashed;
}

/** One tick of Living Rime: the cast when due, each crust's clock, the
 *  healed-through and the burst. The Blades Hunt (Mythic's interphase) holds
 *  the next cast back; a crust already on keeps its clock. */
export function stepRime(s: QuenchScope): void {
  const st = s.st;
  if (!st.flurry && !st.rimeOff) {
    st.rimeTimer -= DT;
    if (st.rimeTimer <= 1e-9) {
      st.rimeTimer += T.rimeEvery;
      castRime(s);
    }
  }
  if (st.rimes.length === 0) return;
  const onLake = new Set(s.players.map((p) => p.id));
  for (const mark of [...st.rimes]) {
    if (!st.rimes.includes(mark)) continue;
    const p = s.ctx.entities.get(mark.id);
    if (!p || p.dead || !onLake.has(p.id)) {
      if (p) dropRimeAuras(p);
      st.rimes = st.rimes.filter((r) => r !== mark);
      continue;
    }
    const crust = auraOf(p, QUENCH_AURAS.rime);
    if (!crust) {
      // Healed through (the absorb drained to nothing): it falls away.
      dropAura(p, QUENCH_AURAS.rimeSlow);
      st.rimes = st.rimes.filter((r) => r !== mark);
      st.rimeBreaks++;
      s.ctx.emit({
        type: 'spellfx',
        sourceId: s.boss.id,
        targetId: p.id,
        school: 'frost',
        fx: 'nova',
        ability: QUENCH_CUES.rimeBreak,
      });
      continue;
    }
    mark.remaining -= DT;
    if (mark.remaining <= 1e-9 || isFrozen(s, p.id)) {
      burstRime(s, p);
      continue;
    }
    // The clock is this module's: the auras show it and never lapse first.
    const left = Math.max(DT * 2, mark.remaining);
    crust.remaining = left;
    const slow = auraOf(p, QUENCH_AURAS.rimeSlow);
    if (slow) slow.remaining = left;
  }
}

/** Every crust off (a wipe, the kill). */
export function clearRime(s: Pick<QuenchScope, 'ctx' | 'st'>): void {
  for (const r of s.st.rimes) {
    const p = s.ctx.entities.get(r.id);
    if (p) dropRimeAuras(p);
  }
  s.st.rimes = [];
}

/** A body's rime marks off (a reset sweep over the listeners). */
export function clearRimeMarks(e: Entity): void {
  dropRimeAuras(e);
}
