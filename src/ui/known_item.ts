// The one unknown-id predicate for every stale-client fallback surface
// (R34 family). A bare `ITEMS[id]` truthiness test is NOT that predicate:
// the content tables are prototype-bearing Records, so 'constructor'
// resolves to a truthy FUNCTION whose missing fields throw exactly where
// the fallback was supposed to save the surface, and '__proto__' resolves
// to a truthy object with the same problem. icons.ts itemFallback carries
// this gate for the icon layer; every surface that BRANCHES between its
// known-item arm and its unknown-item arm must apply it too, or the branch
// sends a prototype key down the known arm and the icon-layer gate is
// unreachable. Pure leaf: no DOM, no canvas, type-only imports, so every
// consumer's Vitest drives it directly.

import type { ItemDef } from '../sim/types';

/**
 * The ItemDef for `id` when this bundle actually ships one: own-property
 * gated, then shape-checked the same way icons.ts itemFallback checks
 * (`.name` must be a string, because 'constructor' is a function whose
 * `.name` IS a string on the FUNCTION, not a def, and a hand-built table
 * row missing its name would throw at the display-name sink).
 */
export function knownItemDef(
  items: Readonly<Record<string, ItemDef>>,
  id: string,
): ItemDef | undefined {
  if (!Object.hasOwn(items, id)) return undefined;
  const def = items[id];
  return def && typeof def.name === 'string' ? def : undefined;
}

/**
 * Own-property read for any other content Record indexed by a server- or
 * peer-supplied id (quests, abilities, delves): the prototype-key half of
 * knownItemDef without the ItemDef shape check.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(table, id) ? table[id] : undefined;
}
