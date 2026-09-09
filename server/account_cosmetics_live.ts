// The pure half of GameServer's live account-cosmetics bookkeeping: how a
// fresh AccountCosmetics view merges into the remembered one, which loadout
// entries the account actually owns, and the optimistic union a store grant
// pushes before its row persists. DOM-free and GameServer-free so the rules
// are unit-tested without a session (tests/server/account_cosmetics_live.test.ts);
// game.ts stays the thin consumer that fans the result out to live sessions.
import type { AccountCosmetics } from '../src/world_api';

/** The two account-wide skin families a store grant can add to. */
export type AccountSkinField = 'weaponSkinIds' | 'mountSkinIds';

export const EMPTY_LIVE_ACCOUNT_COSMETICS: AccountCosmetics = {
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [],
  weaponSkinLoadout: {},
  mountSkinIds: [],
};

/** Merge a fresh cosmetics view into the remembered one. Ownership lists are
 *  additive (a purchase is never un-bought here); the applied weapon loadout is
 *  last-write-wins so a detach (key removed in the fresh state) never
 *  resurrects from the stale side. The reads stay nullish-tolerant: pre-skin
 *  callers and test doubles still hand over older, narrower shapes at runtime. */
export function mergeAccountCosmetics(a: AccountCosmetics, b: AccountCosmetics): AccountCosmetics {
  return {
    completedQuestIds: [...new Set([...a.completedQuestIds, ...b.completedQuestIds])],
    mechChromaIds: [...new Set([...a.mechChromaIds, ...b.mechChromaIds])],
    weaponSkinIds: [...new Set([...(a.weaponSkinIds ?? []), ...(b.weaponSkinIds ?? [])])],
    weaponSkinLoadout: { ...(b.weaponSkinLoadout ?? {}) },
    mountSkinIds: [...new Set([...(a.mountSkinIds ?? []), ...(b.mountSkinIds ?? [])])],
  };
}

/** The account loadout filtered to owned skins, as the Sim seeds it. */
export function ownedWeaponSkinLoadout(cosmetics: AccountCosmetics): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [t, skinId] of Object.entries(cosmetics.weaponSkinLoadout ?? {})) {
    if (skinId && (cosmetics.weaponSkinIds ?? []).includes(skinId)) out[t] = skinId;
  }
  return out;
}

/** The optimistic live view after granting `known` ids into `field`, or null
 *  when the account already owns every one of them (nothing to push or
 *  persist). `current` undefined means no session on the account has been
 *  remembered yet: the caller then persists without a live push. */
export function withAccountSkinsGranted(
  current: AccountCosmetics | undefined,
  known: readonly string[],
  field: AccountSkinField,
): AccountCosmetics | null {
  if (!current) return null;
  const owned = current[field] ?? [];
  if (known.every((id) => owned.includes(id))) return null;
  return { ...current, [field]: [...new Set([...owned, ...known])] };
}
