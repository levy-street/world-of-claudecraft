// The Inner Crucible skin claim rules (sim/content/crucible_skins.ts): one
// pure verdict both hosts share, so the online server (server/game.ts
// 'claim_crucible_skin') and the offline Sim (Sim.claimCrucibleSkin) can never
// disagree about who may claim. The verdict reads the SAME ownership lane the
// Reliquary displays (the character's collection log unioned with the account
// ledger), so a set one character completed counts for a sibling that claims.

import type { AccountCosmetics } from '../world_api';
import { accountRelicKey } from './account_ledger';
import { crucibleSetCompleted, crucibleSkinDef } from './content/crucible_skins';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { PlayerClass } from './types';

export type CrucibleClaimVerdict =
  | 'ok'
  | 'unknown_skin'
  | 'wrong_class'
  | 'already_owned'
  | 'set_incomplete';

/** The slice of a player the verdict reads (PlayerMeta satisfies it). */
export interface CrucibleClaimSubject {
  cls: PlayerClass;
  deedStats: { itemsDiscovered: ReadonlySet<string> };
  accountLedger: { relics: ReadonlyMap<string, unknown> };
}

export function crucibleClaimVerdict(
  subject: CrucibleClaimSubject,
  catalog: string,
  ownedSkinIds: readonly string[],
): CrucibleClaimVerdict {
  const def = crucibleSkinDef(catalog);
  if (!def) return 'unknown_skin';
  if (def.requiredClass !== subject.cls) return 'wrong_class';
  if (ownedSkinIds.includes(catalog)) return 'already_owned';
  const has = (itemId: string): boolean =>
    subject.deedStats.itemsDiscovered.has(itemId) ||
    subject.accountLedger.relics.has(accountRelicKey('item', itemId));
  return crucibleSetCompleted(subject.cls, has) ? 'ok' : 'set_incomplete';
}

/** The offline Sim's claim (no wallet or server round trip): on an 'ok'
 *  verdict, returns the account cosmetics with the skin added and writes the
 *  collection-log marker; otherwise null, with the incomplete-set case told to
 *  the player. */
export function claimCrucibleSkinOffline(
  ctx: SimContext,
  meta: PlayerMeta | undefined,
  cosmetics: AccountCosmetics,
  catalog: string,
): AccountCosmetics | null {
  const def = crucibleSkinDef(catalog);
  if (!meta || !def) return null;
  const owned = cosmetics.founderSkinIds ?? [];
  const verdict = crucibleClaimVerdict(meta, catalog, owned);
  if (verdict === 'set_incomplete') {
    ctx.error(meta.entityId, 'Complete a full Inner Crucible set for your class first.');
  }
  if (verdict !== 'ok') return null;
  ctx.markItemDiscovered(meta, def.itemId);
  return { ...cosmetics, founderSkinIds: [...owned, catalog] };
}
