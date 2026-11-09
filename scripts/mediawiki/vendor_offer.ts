import { FACTION_VENDOR_GATES, vendorFactionForNpc } from '../../src/sim/content/faction_vendors';
import { GOURDLIGHT_BROOM_ID } from '../../src/sim/content/gourdlight_eve';
import { factionCurrencyName, factionDisplayName } from '../../src/sim/factions';
import { MOUNT_TRAIN_MIN_LEVEL } from '../../src/sim/mounts_training';
import { ridingTrainingFee } from '../../src/sim/riding_training';
import type { ItemDef, NpcDef } from '../../src/sim/types';
import { buyPurchaseTotals } from '../../src/sim/vendor_buy_stack';
import { vendorTokenPrice } from '../../src/sim/vendor_token_price';
import { type ArticleTools, ref } from './entity_format';

/** One ordinary click in this specific vendor's stock. Each currency is a separate debit. */
export function vendorOfferText(w: ArticleTools, npc: NpcDef, item: ItemDef): string {
  if (item.teachesRiding)
    return (
      'Riding lessons from level ' +
      MOUNT_TRAIN_MIN_LEVEL +
      '. Basic training costs ' +
      w.money(ridingTrainingFee(0)) +
      '. Advanced training costs ' +
      w.money(ridingTrainingFee(1)) +
      ', and you need basic training first.'
    );
  if (npc.devVendor) return 'Free, but only on a test realm with developer commands turned on.';
  const costs: string[] = [];
  const conditions: string[] = [];
  const totals = buyPurchaseTotals(item, item.buyValue ?? 0, item.priceHonor ?? 0, 1);
  if (!totals) throw new Error('Invalid vendor prices for ' + item.id);
  if (totals.copper) costs.push(w.money(totals.copper));
  if (totals.honor) costs.push(totals.honor + ' Honor');
  const token = vendorTokenPrice(item);
  if (token) costs.push(token.count + ' ' + ref(w, 'item', token.itemId));
  const gate = FACTION_VENDOR_GATES[item.id];
  if (gate) {
    const faction = gate.factionId ?? vendorFactionForNpc(npc.id) ?? 'church_order';
    if (gate.currencyCost) costs.push(gate.currencyCost + ' ' + factionCurrencyName(faction));
    conditions.push(
      'You need ' +
        gate.standingTier +
        ' standing (' +
        gate.requiredStanding +
        ') with ' +
        (gate.factionId ? factionDisplayName(gate.factionId) : 'an allied faction') +
        '.',
    );
  }
  if (npc.vendorQuestGates?.[item.id])
    conditions.push(
      'You must have ' +
        ref(w, 'quest', npc.vendorQuestGates[item.id]) +
        ' in your quest log, or have finished it.',
    );
  if (item.kind === 'mount' && !item.seasonalEvent && item.id !== GOURDLIGHT_BROOM_ID)
    conditions.push('You need riding training and level ' + MOUNT_TRAIN_MIN_LEVEL + '.');
  if (item.kind === 'mount') conditions.push('You can only buy a mount you do not already own.');
  const price = costs.length
    ? (totals.units === 1 ? 'One' : 'Stack of ' + totals.units) +
      ' for ' +
      costs.join(' and ') +
      '.'
    : 'This item has no price set.';
  return [price, ...conditions].join(' ');
}
