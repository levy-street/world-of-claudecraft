// The authoritative "right-click a buff to remove it" command (Sim.cancelAura's
// body, extracted behind the SimContext seam so the coordinator stays a delegate).
// The pure predicate in ./aura_cancel refuses debuffs, so a player can never strip
// a silence/hex/root off themselves. Mirrors clearAurasFromSource's fade-event +
// conditional stat recalc so a stripped buff_*/form_* actually un-folds.
import { recalcPlayerStats } from '../entity';
import { cancelSeasonalCosmetic } from '../seasonal/seasonal_cancel';
import type { SimContext } from '../sim_context';
import { auraAffectsStats, removeCancelableAura } from './aura_cancel';
import { applyGreaterInvisibilityAftereffect } from './greater_invisibility';
import { PALADIN_DEVOTION_ABILITY_IDS, stripPaladinDevotionsFromSource } from './paladin_support';

export function cancelPlayerAura(ctx: SimContext, auraId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { e, meta } = r;
  // The battleground's carried-flag buff is a DROP affordance wearing a buff's
  // clothes, so it is offered to its owner FIRST: cancelling it must route
  // through the authoritative flag drop (flag at the runner's feet, catchable,
  // the bgFlag 'dropped' call to all ten), never the generic splice below,
  // which would strip the buff and leave the flag carried.
  if (ctx.bgCancelFlagAura(e, auraId)) return;
  // A seasonal cosmetic (a costume draught, a trick, the Strawling Charm, the
  // worn pumpkin head) carries per-character ledger state the generic splice
  // would leave behind (the worn-head flag re-applies the head next tick), so
  // its own module takes it off.
  if (cancelSeasonalCosmetic(ctx, meta, e, auraId)) return;
  const isPaladinDevotion = PALADIN_DEVOTION_ABILITY_IDS.has(auraId);
  const removed = removeCancelableAura(e.auras, auraId, isPaladinDevotion ? e.id : undefined);
  if (!removed) return;
  if (auraId === 'divine_ascension' && e.paladinDevotion) {
    e.paladinDevotion.ascensionCharges = 0;
    e.paladinDevotion.ascensionRemaining = 0;
  }
  ctx.emit({ type: 'aura', targetId: e.id, name: removed.name, gained: false });
  if (isPaladinDevotion) stripPaladinDevotionsFromSource(ctx, e.id, auraId);
  if (removed.kind === 'stealth') {
    e.stealthed = e.auras.some((a) => a.kind === 'stealth');
  }
  applyGreaterInvisibilityAftereffect(ctx, e, removed);
  if (auraAffectsStats(removed)) {
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
}
