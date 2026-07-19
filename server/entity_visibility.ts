import type { Entity } from '../src/sim/types';

// Hunter's Mark is a source-scoped reveal: only the Hunter who owns the mark
// keeps observing the stealthed target. Other players must still pass the normal
// stealth visibility rules, so the mark never leaks hidden enemies realm-wide.
export function revealedByHuntersMark(viewer: Entity, target: Entity): boolean {
  return target.auras.some((aura) => aura.kind === 'hunter_mark' && aura.sourceId === viewer.id);
}
