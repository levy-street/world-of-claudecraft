import { GOURDLIGHT_KEEPER_NPC_ID } from '../../src/sim/content/gourdlight_eve';
import { HEROIC_VENDOR_NPC_ID, HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { CRUCIBLE_VENDOR_NPC_ID, CRUCIBLE_VENDOR_STOCK } from '../../src/sim/content/ignivar_loot';
import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  STATION_RADIUS,
  STATIONS,
} from '../../src/sim/content/professions';
import {
  ALL_RECIPES,
  getActiveWorldContent,
  ITEMS,
  NPCS,
  QUESTS,
  zoneContaining,
} from '../../src/sim/data';
import { MARKET_HOUSE_STOCK } from '../../src/sim/market';
import { craftCastDurationSec } from '../../src/sim/professions/craft_cast_duration';
import { trainingFeeFor, trainingStationTypeFor } from '../../src/sim/professions/training';
import { TIER_SKILL_STEP, tierForSkill } from '../../src/sim/professions/wheel';
import { buyPurchaseTotals } from '../../src/sim/vendor_buy_stack';
import { type ArticleTools, ref, words } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import { addDisenchantAcquisitions } from './item_disenchant';
import { itemNpcPoints } from './item_npc_route';
import type { RoutePoint } from './quest_map';
import { vendorOfferText } from './vendor_offer';

function location(points: RoutePoint[]): string {
  return points
    .map((p) => {
      const place = p.frame === 'Overworld' ? (zoneContaining(p.x, p.z)?.name ?? p.frame) : p.frame;
      return place + ' (x ' + Number(p.x.toFixed(2)) + ', z ' + Number(p.z.toFixed(2)) + ')';
    })
    .join(' or ');
}

export function vendorCraftAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const index = new Map<string, ItemAcquisition[]>();
  const itemLink = (id: string) => ref(w, 'item', id);
  const marketKeepers = Object.values(NPCS).filter((npc) => npc.market);
  for (const stock of MARKET_HOUSE_STOCK) {
    addAcquisition(index, stock.itemId, {
      title: 'Buy standing stock on the World Market',
      steps: [
        'Visit ' +
          marketKeepers
            .map((npc) => ref(w, 'npc', npc.id) + ' at ' + location(itemNpcPoints('Start', npc.id)))
            .join(' or ') +
          '. Both open the same [[World Market]].',
        'Speak to the keeper, choose Show me the World Market, then open Browse. Search for ' +
          itemLink(stock.itemId) +
          ' and select the standing-stock listing sold by The Merchant.',
        'Choose the full stack of ' +
          stock.count +
          ' for ' +
          w.money(stock.price) +
          ', click Buy and confirm. Carry that amount and leave enough bag space. The purchased items arrive directly in your bags.',
      ],
      details: [
        'The listed price is for the entire ' +
          stock.count +
          '-item stack, not for each item. This built-in stock never expires or sells out.',
        'Other players may list the same item at different prices. Their prices and availability are set by those players; check the actual listing before confirming.',
      ],
      points: marketKeepers.flatMap((npc) => [
        ...itemNpcPoints('Start', npc.id, 'Open World Market Browse'),
        ...itemNpcPoints('Reward', npc.id, 'Buy ' + ITEMS[stock.itemId].name),
      ]),
    });
  }
  for (const original of Object.values(NPCS)) {
    const npc = getActiveWorldContent().npcs[original.id] ?? original;
    if (npc.devVendor) continue;
    const positions = itemNpcPoints('Reward', npc.id);
    const where = location(positions);
    for (const id of npc.vendorItems ?? []) {
      const item = ITEMS[id];
      if (!item) throw new Error('Unknown vendor item ' + id);
      const units =
        buyPurchaseTotals(item, item.buyValue ?? 0, item.priceHonor ?? 0, 1)?.units ?? 1;
      addAcquisition(index, id, {
        title: 'Buy from ' + ref(w, 'npc', npc.id),
        steps: [
          'Travel to ' +
            ref(w, 'npc', npc.id) +
            (where
              ? ' in ' + where
              : '. Follow the NPC article for its activity-dependent location') +
            '.',
          'Carry the required currency and leave enough room in your bags. ' +
            vendorOfferText(w, npc, item),
          'Speak to the vendor, open the stock and click ' +
            itemLink(id) +
            ' once. ' +
            (item.teachesRiding
              ? 'The purchased riding training is applied to this character.'
              : 'Receive ' + units + ' in your bags.'),
        ],
        details: [
          ...(npc.id === GOURDLIGHT_KEEPER_NPC_ID || item.seasonalEvent
            ? ['Available only while its seasonal event is active.']
            : []),
          'This is a purchase at the listed price. It does not use a random drop roll.',
        ],
        points: [
          ...itemNpcPoints('Start', npc.id, 'Open the vendor'),
          ...itemNpcPoints(
            'Reward',
            npc.id,
            item.teachesRiding ? 'Receive riding training' : 'Buy ' + item.name,
          ),
        ],
      });
    }
  }
  for (const offer of HEROIC_VENDOR_STOCK) {
    const where = location(itemNpcPoints('Reward', HEROIC_VENDOR_NPC_ID));
    addAcquisition(index, offer.itemId, {
      title: 'Spend Heroic Marks',
      steps: [
        'Earn ' +
          offer.marks +
          ' Heroic Marks through eligible Heroic activities. See [[Heroic difficulty]] for the clear and reset rules.',
        'Visit ' +
          ref(w, 'npc', HEROIC_VENDOR_NPC_ID) +
          ' in ' +
          where +
          '. Speak to the quartermaster to open the Heroic shop.',
        'Click ' +
          itemLink(offer.itemId) +
          '. The purchase spends ' +
          offer.marks +
          ' Heroic Marks and gives one item. Leave bag space before buying.',
      ],
      details: ['Guaranteed purchase. Heroic Marks are taken from your character balance.'],
      points: [
        ...itemNpcPoints('Start', HEROIC_VENDOR_NPC_ID, 'Open Heroic stock'),
        ...itemNpcPoints('Reward', HEROIC_VENDOR_NPC_ID, 'Collect ' + ITEMS[offer.itemId].name),
      ],
    });
  }
  for (const offer of CRUCIBLE_VENDOR_STOCK) {
    const item = ITEMS[offer.itemId];
    const where = location(itemNpcPoints('Reward', CRUCIBLE_VENDOR_NPC_ID));
    addAcquisition(index, offer.itemId, {
      title: 'Exchange a Crucible sigil',
      steps: [
        'Obtain 1 ' +
          itemLink(offer.sigilId) +
          '. Its article identifies the exact boss, difficulty and loot chance.',
        'Travel to ' +
          ref(w, 'npc', CRUCIBLE_VENDOR_NPC_ID) +
          ' at ' +
          where +
          ', on the landing court outside the Crucible keep.',
        'Speak to the quartermaster and click ' +
          itemLink(offer.itemId) +
          '. One sigil is consumed and one piece goes to your bags. Have bag space and choose a piece your class is allowed to wear.',
      ],
      details: [
        'The exchange itself is guaranteed. The chance to get the sigil is a separate boss drop.',
      ],
      points: [
        ...itemNpcPoints('Start', CRUCIBLE_VENDOR_NPC_ID, 'Open the sigil shop'),
        ...itemNpcPoints('Reward', CRUCIBLE_VENDOR_NPC_ID, 'Exchange 1 sigil for ' + item.name),
      ],
    });
  }
  const patterns = new Map<string, string[]>();
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'recipe') continue;
    for (const id of item.teachesRecipeIds ?? [item.teachesRecipeId]) {
      const found = patterns.get(id) ?? [];
      found.push(item.id);
      patterns.set(id, found);
    }
  }
  const recipeQuests = new Map(
    Object.values(QUESTS)
      .filter((q) => q.recipeReward)
      .map((q) => [q.recipeReward!, q]),
  );
  for (const recipe of ALL_RECIPES) {
    const trainer = recipe.acquisition?.includes('trainer')
      ? STATIONS.find((s) => s.type === trainingStationTypeFor(recipe))
      : undefined;
    const benches = recipe.stationType ? STATIONS.filter((s) => s.type === recipe.stationType) : [];
    const names = patterns.get(recipe.id) ?? [];
    const quest = recipeQuests.get(recipe.id);
    const learned: string[] = [];
    if (!recipe.acquisition?.length) learned.push('This recipe is known automatically.');
    if (trainer)
      learned.push(
        'At ' +
          words(recipe.professionId) +
          ' skill ' +
          tierForSkill(recipe.skillReq) * TIER_SKILL_STEP +
          ' or above, speak to ' +
          ref(w, 'npc', trainer.masterNpcId) +
          ' at ' +
          location(itemNpcPoints(1, trainer.masterNpcId)) +
          ', choose Training and learn this recipe for ' +
          w.money(trainingFeeFor(recipe)) +
          '.',
      );
    if (names.length)
      learned.push('Obtain and use ' + names.map(itemLink).join(' or ') + ' to learn it.');
    if (quest)
      learned.push(
        'Complete ' +
          ref(w, 'quest', quest.id) +
          ' to learn it. Follow that quest page for the full route.',
      );
    if (!learned.length)
      learned.push(
        'Learn this recipe through its ' +
          (recipe.acquisition ?? []).map(words).join(' or ') +
          ' source before crafting.',
      );
    const ingredients = recipe.reagents
      .map(
        (r) =>
          r.count +
          ' × ' +
          itemLink(r.itemId) +
          (r.noDiscount ? ' (full quantity always required)' : ''),
      )
      .join(', ');
    const fee = Math.ceil(recipe.itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET);
    const combo = recipe.comboRequirement;
    const points: RoutePoint[] = trainer
      ? itemNpcPoints('Start', trainer.masterNpcId, 'Learn the recipe')
      : [];
    for (const bench of benches) {
      points.push({
        step: 3,
        frame: 'Overworld',
        ...bench.pos,
        label: words(bench.type) + ' · craft here',
      });
      points.push({
        step: 'Reward',
        frame: 'Overworld',
        ...bench.pos,
        label: 'Receive ' + ITEMS[recipe.resultItemId].name + ' in your bags',
      });
    }
    addAcquisition(index, recipe.resultItemId, {
      title: 'Craft with ' + words(recipe.professionId) + ' (recipe skill ' + recipe.skillReq + ')',
      steps: [
        learned.join(' '),
        'Gather the base material bill for one craft: ' +
          ingredients +
          '. Click each ingredient for its sources and map.',
        (benches.length
          ? 'Stand within ' +
            STATION_RADIUS +
            ' yards of a ' +
            words(recipe.stationType!) +
            ' station shown on the map, or a matching mobile station. '
          : 'This recipe can be crafted in the field. ') +
          'Open Crafting (T), select ' +
          words(recipe.professionId) +
          ' and the recipe for ' +
          itemLink(recipe.resultItemId) +
          ', then choose Craft. Complete the ' +
          craftCastDurationSec(recipe) +
          '-second base cast. One craft yields ' +
          recipe.resultCount +
          ' × ' +
          itemLink(recipe.resultItemId) +
          '.',
      ],
      details: [
        'Once learned, the listed recipe skill of ' +
          recipe.skillReq +
          ' sets its progression tier. It does not by itself block crafting below that skill.',
        ...(combo
          ? [
              'Choose ' +
                words(combo.craftA) +
                ' and ' +
                words(combo.craftB) +
                ' as your major pair and raise both to tier ' +
                combo.minTier +
                ' (skill ' +
                combo.minTier * TIER_SKILL_STEP +
                ').',
            ]
          : []),
        'The craft takes up to ' +
          w.money(fee) +
          ' from your purse. If you have less, it takes your remaining copper.',
        'The ingredient list above is the base bill. Your displayed cost can be lower with qualifying specialization, signed-material or Jack of All Trades discounts. The crafting window shows your exact current bill.',
        ...(recipe.oncePerDay
          ? ['Limited to one successful craft of this recipe per character per reset day.']
          : []),
        ...(recipe.consumeOnCraft ? ['A successful craft consumes this one-use recipe.'] : []),
        'Crafting is not an item-drop roll. Eligible equipment can receive a masterwork improvement. See [[Masterwork crafting]] for its chance and restrictions.',
        ...(!benches.length
          ? ['Receive the output at your current position when the cast finishes.']
          : []),
      ],
      points,
    });
  }
  addDisenchantAcquisitions(w, index);
  return index;
}
