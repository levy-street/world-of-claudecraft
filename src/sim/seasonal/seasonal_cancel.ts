// Right-click cancel for the seasonal cosmetic auras (a costume draught's body, a
// trick-or-treat trick, the Strawling Charm's guise, the worn pumpkin head). They
// stay `undispellable` (no dispel or cleanse ever reads them), but the player who
// wears one may take it off: they are pure looks with no sim effect, so ending one
// early gives nothing a fight could read. Offered by the authoritative cancel
// command (combat/aura_cancel_command.ts) before its generic splice, so it runs
// the same offline, on the server and in the headless env.
import { PUMPKIN_HEAD_AURA_ID } from '../content/gourdlight_eve';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { SEASONAL_COSMETIC_AURA_IDS, stripSeasonalAura } from './seasonal_cosmetics';

/** Take a worn seasonal cosmetic off. True when `auraId` is a seasonal cosmetic id
 *  (handled here, worn or not: the generic splice must never see one). */
export function cancelSeasonalCosmetic(
  ctx: SimContext,
  meta: PlayerMeta,
  e: Entity,
  auraId: string,
): boolean {
  if (!SEASONAL_COSMETIC_AURA_IDS.has(auraId)) return false;
  if (!stripSeasonalAura(ctx, e, auraId)) return true;
  // The worn head is a ledger flag the season tick re-applies: clearing the flag is
  // what keeps it off, the same as toggling the head's own item.
  if (auraId === PUMPKIN_HEAD_AURA_ID && meta.pumpkinHeadWorn) {
    meta.pumpkinHeadWorn = false;
    ctx.emit({ type: 'seasonal', what: 'pumpkinOff', pid: meta.entityId });
    meta.wireRev++;
  }
  return true;
}
