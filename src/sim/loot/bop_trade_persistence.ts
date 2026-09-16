// The two persistence-boundary hooks for the bind-on-pickup party-trade marker
// (bop_trade_cleanup.ts owns the slot walk): a character's item containers and
// Materials Vault retire expired markers when the character loads and again
// when it serializes, so stale metadata never survives a save/load cycle and
// the simulation tick never needs a realm-wide container sweep. The clock is
// the caller's (the raid-lockout clock, which is what stamped `untilMs`), so
// this leaf stays deterministic and host-neutral.

import {
  normalizeSavedVaultPartyTradeState,
  normalizeVaultPartyTradeState,
  type SavedMaterialsVaultState,
} from '../materials_vault';
import type { PlayerMeta } from '../sim';
import {
  normalizePartyTradeContainers,
  normalizePersistedPartyTradeContainers,
  type PersistedPartyTradeContainers,
} from './bop_trade_cleanup';

/** Load side: the live PlayerMeta containers (bags, bank, buyback) plus its vault. */
export function retirePartyTradeOnLoad(meta: PlayerMeta, nowMs: number): void {
  normalizePartyTradeContainers(meta, nowMs);
  normalizeVaultPartyTradeState(meta.vault, nowMs);
}

/** Save side: the serialized character, returned so the caller can chain the
 *  save sanitizers. The vault stays absent-while-empty (the save-shape contract). */
export function retirePartyTradeOnSave<
  T extends PersistedPartyTradeContainers & { vault?: SavedMaterialsVaultState },
>(state: T, nowMs: number): T {
  normalizePersistedPartyTradeContainers(state, nowMs);
  if (state.vault) normalizeSavedVaultPartyTradeState(state.vault, nowMs);
  return state;
}
