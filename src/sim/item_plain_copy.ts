// The "least special copy first" read for the destroy-victim walks (the
// disenchant and sunder preference, professions/enchanting.ts
// consumePreferredDisenchantVictim). Before item tracking, a plain copy was a
// slot with NO payload; now every epic or legendary copy carries a guid and a
// provenance record (item_tracking.ts) from the moment it is minted, so no
// copy of such an item is ever payload-free. The tracked identity says who
// holds the copy and where it came from, never what the copy IS: a copy whose
// payload is that identity and nothing else is exactly as plain as a
// payload-free one, and a walk that ranked it with the special copies would
// destroy a Perfected or masterwork copy while an ordinary one sat in the bags.
//
// Pure leaf: no SimContext, no state, no rng.

import type { ItemInstancePayload } from './types';

/** The payload fields that only identify a copy (item_tracking.ts). */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['guid', 'provenance']);

/** Whether a held copy is plain: no payload at all, or a payload that carries
 *  nothing but its tracked identity (an absent-valued key reads as absent). */
export function isPlainCopy(instance: ItemInstancePayload | undefined): boolean {
  if (instance === undefined) return true;
  for (const [key, value] of Object.entries(instance)) {
    if (value !== undefined && !IDENTITY_FIELDS.has(key)) return false;
  }
  return true;
}
