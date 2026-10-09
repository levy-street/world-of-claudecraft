// The Wildheart Basin's control rules, asked by the aura gate before any aura
// lands (combat/trinket_seams.ts auraGuarded, consulted by Sim.applyAura):
//
//  - the Fanglord's Great Jaguar (Stalk, design 5.1) can be stunned, rooted
//    and slowed, but each kind of control only once per window: the first one
//    of a kind lands, and once it is seen on the jaguar beastmaster.ts opens
//    that kind's window (shown as a Wary aura); any other of the same kind
//    slides off here until the window closes. Every hard control (a stun, a
//    sap or fear, a sheep) shares the stun window;
//  - Zulgar's Jaguar Avatar (Spirit of the Hunt, design 5.3) can be slowed and
//    rooted during the hunt (zulgar.ts lifts his immunity for it), and a stun
//    lands for half as long (a sheep or a sap slides off, as outside the hunt;
//    a blind is a miss chance, not a control, and is never counted).
//
// Pure: it reads the target's own encounter state and may shorten the
// incoming stun aura in place (each applyAura call builds its own aura).
// Zero rng. Self-applied auras (Sunstruck) always pass.

import type { Aura, Entity } from '../../types';
import { controlGroupOf, ZULGAR_TUNING } from './ids';

/** True when the Basin's rules keep this aura off `target`. As a side effect
 *  a stun on the hunting avatar is halved. */
export function wildheartControlBlocks(target: Entity, aura: Aura): boolean {
  const st = target.wildheartFight;
  if (!st || target.kind !== 'mob' || aura.sourceId === target.id) return false;
  if (st.kind === 'jaguar') {
    const group = controlGroupOf(aura.kind);
    if (!group) return false;
    return st.windows[group] > 0;
  }
  if (st.kind === 'zulgar' && st.phase === 'hunt' && controlGroupOf(aura.kind) === 'stun') {
    // Only a true stun takes hold of the avatar (halved); a sheep or a sap
    // slides off as it does outside the hunt.
    if (aura.kind !== 'stun') return true;
    aura.remaining *= ZULGAR_TUNING.huntStunScale;
    aura.duration *= ZULGAR_TUNING.huntStunScale;
  }
  return false;
}
