// Wire decode for the account cosmetics self-snapshot facet (the `cosmetics`
// field on the `self` record). Kept as its own DOM-free, ClientWorld-free
// module so the decode is unit-testable without standing up a socket, and so
// online.ts stays a consumer rather than growing another decode block.
//
// Defensive by construction, the online.ts decode idiom: every field is
// re-validated and a malformed entry is DROPPED rather than mirrored.

import type { AccountCosmetics } from '../world_api';

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

/** Decode a `self.cosmetics` payload into an `AccountCosmetics` mirror. Missing
 *  or malformed input yields all-empty defaults rather than throwing, matching
 *  the rest of the online decode idiom. */
export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: stringList(src.completedQuestIds),
    mechChromaIds: stringList(src.mechChromaIds),
    weaponSkinIds: stringList(src.weaponSkinIds),
    weaponSkinLoadout: stringRecord(src.weaponSkinLoadout),
  };
}
