// The Guardian of the Quench's tank swap (docs/design/raid/smith_heart.md
// section 7.3; the owner's brief of 2026-11-16): Rime-Tempered.
//
//   Tempering Strike  her swing cleave (every 4th landed swing, the
//                     template's) tempers its target: a stack of
//                     Rime-Tempered (refreshed by each strike, gone
//                     `temperSeconds` after the last).
//   Each stack        holds the tank's cold bar at least the tier's
//                     `temperCold` a stack (a huddle warms it no lower), and
//                     adds the tier's `temperFrost` to the magic damage they
//                     take (a `spellvuln`: every hit of this fight is Frost).
//   Heroic, Mythic    20 a stack: the fifth stack holds the bar at 100 and
//                     the tank freezes solid (quench_cold.ts `freezePlayer`,
//                     the fight's own threat: the rime cracks any immunity,
//                     double damage taken). The tanks swap at 3.
//   Normal            12 a stack, six at most (72): a swap asked for, never a
//                     freeze on its own.
//   Immunities        the cold is no damage (quench_bite.ts): the stack and
//                     its floor land on a warded tank too, the aura is
//                     undispellable, and the freeze it brings bites through.
//
// The strike is read off the swing kernel's count (a reset to 0 is the
// cleave landing, as final.ts watches the Forge Fist): the swing's target is
// the guardian's aggro target that tick. Zero rng.

import type { Entity } from '../../types';
import { addCold, chillOf, isFrozen } from './quench_cold';
import {
  QUENCH_AURAS,
  QUENCH_NAMES,
  QUENCH_TUNING as T,
  temperFloor,
  temperStacks,
} from './quench_ids';
import { auraOf, type QuenchScope } from './quench_scope';

/** Temper `p` once (a Tempering Strike landed on them): one stack more (at
 *  most the tier's), the timer refreshed, the magic damage taken raised, the
 *  bar lifted to its floor (a floor at full freezes them, and the freeze
 *  takes the stacks). Exported for the dev trigger and the tests. */
export function temper(s: QuenchScope, p: Entity): number {
  if (p.dead || isFrozen(s, p.id)) return 0;
  const r = s.rules;
  const stacks = Math.min(r.temperMax, temperStacks(p.auras) + 1);
  const have = auraOf(p, QUENCH_AURAS.tempered);
  if (have) {
    have.stacks = stacks;
    have.value = r.temperFrost * stacks;
    have.value2 = r.temperCold;
    have.value3 = r.temperSwap;
    have.remaining = T.temperSeconds;
    have.duration = T.temperSeconds;
    s.ctx.emit({ type: 'aura', targetId: p.id, name: QUENCH_NAMES.tempered, gained: true });
  } else {
    s.ctx.applyAura(p, {
      id: QUENCH_AURAS.tempered,
      name: QUENCH_NAMES.tempered,
      kind: 'spellvuln',
      remaining: T.temperSeconds,
      duration: T.temperSeconds,
      value: r.temperFrost * stacks,
      value2: r.temperCold,
      value3: r.temperSwap,
      stacks,
      sourceId: s.boss.id,
      school: 'frost',
      undispellable: true,
    });
  }
  const floor = temperFloor(p.auras, r.temperCold);
  const c = chillOf(s, p.id);
  if (floor > c.cold) addCold(s, p, floor - c.cold);
  return stacks;
}

/** One tick: a Tempering Strike that landed this tick tempers its target. */
export function watchTemperingStrike(s: QuenchScope): void {
  const b = s.boss;
  const now = b.swingCleaveCount ?? 0;
  const seen = s.st.cleaveSeen ?? 0;
  s.st.cleaveSeen = now;
  if (!(now === 0 && seen > 0)) return;
  const id = b.aggroTargetId;
  if (id === null) return;
  const t = s.players.find((p) => p.id === id);
  if (t && !t.dead) temper(s, t);
}
