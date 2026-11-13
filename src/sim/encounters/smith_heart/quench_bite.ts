// The Guardian of the Quench's cold against immunities (docs/design/raid/
// smith_heart.md section 7.3; the team's pass of 2026-11-04): an immunity is
// never warmth. The cold is not damage, so no shield, absorb or damage cut
// touches the bar; and a body sealed in an immunity (an Ice Block's stasis, a
// Temporal Hourglass, a scripted damage immunity) is no warm body:
//
//   - it gives no warmth to a huddle and takes none from one: its bar keeps
//     rising alone while the immunity lasts (quench_cold.ts reads `warded`);
//   - nothing it casts clears the cold: the bar, the freeze, the brittle and
//     the water are undispellable (Ice Block's cleanse leaves them);
//   - the rime cracks it: a player who freezes solid, stays frozen, or
//     shatters loses every BREAKABLE stasis they wear (`biteThrough`), so an
//     Ice Block pressed at 99 cold, or inside the ice, never skips the freeze,
//     the shatter's hit or the brittle after it.
//
// Unbreakable stasis (a trinket's death save, the Barrowstone statue) is the
// owner's script and stays; ordinary mitigation (damage cuts, absorbs, a
// cheat-death ward) mitigates the shatter as it mitigates any hit, and never
// moves the bar. Zero rng.

import { isUnbreakableControlAura } from '../../combat/cc';
import type { Entity } from '../../types';
import { QUENCH_CUES } from './quench_ids';
import type { QuenchScope } from './quench_scope';

/** Is `p` sealed in an immunity the cold ignores as a warm body? */
export function warded(p: Pick<Entity, 'auras' | 'damageImmune'>): boolean {
  if (p.damageImmune) return true;
  for (const a of p.auras) if (a.kind === 'stasis') return true;
  return false;
}

/** The ids of every breakable stasis `p` wears (and its cast's absorb). */
function breakable(p: Entity): Set<string> {
  const ids = new Set<string>();
  for (const a of p.auras)
    if (a.kind === 'stasis' && !isUnbreakableControlAura(a)) {
      ids.add(a.id);
      ids.add(`${a.id}_absorb`);
    }
  return ids;
}

/**
 * The rime cracks `p`'s breakable immunity: every breakable stasis aura (and
 * the absorb its cast carries) comes off, each fade on the wire, and the
 * moment shows on them. Returns true when anything broke.
 */
export function biteThrough(s: Pick<QuenchScope, 'ctx' | 'boss'>, p: Entity): boolean {
  const ids = breakable(p);
  if (ids.size === 0) return false;
  for (let i = p.auras.length - 1; i >= 0; i--) {
    const a = p.auras[i];
    if (!ids.has(a.id) || isUnbreakableControlAura(a)) continue;
    p.auras.splice(i, 1);
    s.ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
  }
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.bite,
  });
  return true;
}
