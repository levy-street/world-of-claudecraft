// The lockpicking command's action guard, moved out of server/game.ts under
// the monolith ratchet. Valid lockpicking action enums accepted from the
// client (anti-cheat: reject anything else before it reaches the Sim).

import type { PickAction } from '../src/sim/lockpick';

const LOCKPICK_ACTIONS = new Set<PickAction>(['hardSet', 'set', 'steady', 'ease', 'drop', 'abort']);

/** True when a client-sent value is one of the lockpick actions the Sim accepts. */
export function isPickAction(value: unknown): value is PickAction {
  return typeof value === 'string' && LOCKPICK_ACTIONS.has(value as PickAction);
}
