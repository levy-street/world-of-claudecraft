// The renderer's side of a thrown body's hop (thrown_hop_core.ts): one hop
// state per drawn view, held here by the view object (collected with it), so
// the coordinator only asks for this frame's lift.

import { newThrownHop, stepThrownHop, type ThrownHopState } from './thrown_hop_core';

const hops = new WeakMap<object, ThrownHopState>();

/** The drawn lift (yards) of `view`'s body wearing `auras` at render time
 *  `now`: 0 unless an encounter's throw is lifting it. */
export function thrownHopLift(view: object, auras: readonly { id: string }[], now: number): number {
  let st = hops.get(view);
  if (!st) {
    // Most bodies are never thrown: no state until one wears a throw.
    if (auras.length === 0) return 0;
    st = newThrownHop();
    hops.set(view, st);
  }
  return stepThrownHop(st, auras, now);
}
