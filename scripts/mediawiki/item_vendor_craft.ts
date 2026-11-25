import { HEROIC_MARK_CURRENCY_ID } from '../../src/sim/content/dungeon_difficulty';
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
import type { ItemDef, NpcDef } from '../../src/sim/types';
import { buyPurchaseTotals } from '../../src/sim/vendor_buy_stack';
import { vendorTokenPrice } from '../../src/sim/vendor_token_price';
import { type ArticleTools, ref, words } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import { addDisenchantAcquisitions } from './item_disenchant';
import { itemNpcPoints } from './item_npc_route';
import type { RoutePoint } from './quest_map';
import { vendorOfferText } from './vendor_offer';
import { wikiProfessionName, wikiStationName } from './wiki_item_kind';

function location(points: RoutePoint[]): string {
  return points
    .map((p) => {
      const place = p.frame === 'Overworld' ? (zoneContaining(p.x, p.z)?.name ?? p.frame) : p.frame;
      return place + ' (x ' + Number(p.x.toFixed(2)) + ', z ' + Number(p.z.toFixed(2)) + ')';
    })
    .join(' or ');
}

/** Every live (non-developer) vendor and the items it stocks, in the active world. */
export function liveVendorStock(): { npc: NpcDef; items: ItemDef[] }[] {
  return Object.values(NPCS).flatMap((original) => {
    const npc = getActiveWorldContent().npcs[original.id] ?? original;
    if (npc.devVendor || !npc.vendorItems?.length) return [];
    return [
      {
        npc,
        items: npc.vendorItems.map((id) => {
          const item = ITEMS[id];
          if (!item) throw new Error('Unknown vendor item ' + id);
          return item;
        }),
      },
    ];
  });
}

/** One way to spend a currency item: what you get, how many it costs, and where. */
export interface CurrencySpend {
  /** Wikitext for what you get. */
  buys: string;
  /** How many of the currency one purchase costs. */
  cost: number;
  /** Wikitext for where you spend it. */
  where: string;
  notes: string;
}

/**
 * The reverse side of the shop routes above: for each item a shop takes as payment, what
 * it buys. Reads the same stock tables (vendor token prices, the Heroic Quartermaster, the
 * Crucible sigil exchange), so the two sides cannot disagree.
 */
export function vendorCurrencySpends(w: ArticleTools): Map<string, CurrencySpend[]> {
  const index = new Map<string, CurrencySpend[]>();
  const add = (currency: string, spend: CurrencySpend) =>
    index.set(currency, [...(index.get(currency) ?? []), spend]);
  for (const { npc, items } of liveVendorStock())
    for (const item of items) {
      const token = vendorTokenPrice(item);
      if (!token) continue;
      const units = buyPurchaseTotals(item, item.buyValue ?? 0, item.priceHonor ?? 0, 1)?.units;
      // The offer text opens with the price. When the token is the whole price, the Cost
      // column already says it, so keep only the conditions after it.
      const offer = vendorOfferText(w, npc, item);
      const tokenOnly =
        (units === 1 ? 'One' : 'Stack of ' + units) +
        ' for ' +
        token.count +
        ' ' +
        ref(w, 'item', token.itemId) +
        '.';
      add(token.itemId, {
        buys: (units && units > 1 ? units + ' × ' : '') + ref(w, 'item', item.id),
        cost: token.count,
        where: ref(w, 'npc', npc.id),
        notes: [
          offer.startsWith(tokenOnly) ? offer.slice(tokenOnly.length).trim() : offer,
          npc.id === GOURDLIGHT_KEEPER_NPC_ID || item.seasonalEvent
            ? 'You can only buy this while its seasonal event is on.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
  for (const offer of HEROIC_VENDOR_STOCK)
    add(HEROIC_MARK_CURRENCY_ID, {
      buys: ref(w, 'item', offer.itemId),
      cost: offer.marks,
      where: ref(w, 'npc', HEROIC_VENDOR_NPC_ID),
      notes: 'Marks come out of your Heroic Mark total.',
    });
  for (const offer of CRUCIBLE_VENDOR_STOCK)
    add(offer.sigilId, {
      buys: ref(w, 'item', offer.itemId),
      cost: 1,
      where: ref(w, 'npc', CRUCIBLE_VENDOR_NPC_ID),
      notes: 'Pick a piece your class can wear.',
    });
  return index;
}

export function vendorCraftAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const index = new Map<string, ItemAcquisition[]>();
  const itemLink = (id: string) => ref(w, 'item', id);
  const marketKeepers = Object.values(NPCS).filter((npc) => npc.market);
  for (const stock of MARKET_HOUSE_STOCK) {
    addAcquisition(index, stock.itemId, {
      title: 'Buy standing stock on the World Market',
      steps: [
        'Go to ' +
          marketKeepers
            .map((npc) => ref(w, 'npc', npc.id) + ' at ' + location(itemNpcPoints('Start', npc.id)))
            .join(' or ') +
          '. Both of them open the same [[World Market]].',
        'Talk to the keeper and choose Show me the World Market. Then open Browse. Search for ' +
          itemLink(stock.itemId) +
          '. Pick the listing sold by The Merchant. That listing is always there.',
        'Choose the full stack of ' +
          stock.count +
          ' for ' +
          w.money(stock.price) +
          '. Click Buy, then confirm. Bring enough money and leave room in your bags. The items go straight into your bags.',
      ],
      details: [
        'The price is for the whole stack of ' +
          stock.count +
          ' items, not for each one. This stock never runs out and never goes away.',
        'Other players may sell the same item for a different price. They choose their own prices and how many to sell. Check the listing before you confirm.',
      ],
      points: marketKeepers.flatMap((npc) => [
        ...itemNpcPoints('Start', npc.id, 'Open World Market Browse'),
        ...itemNpcPoints('Reward', npc.id, 'Buy ' + ITEMS[stock.itemId].name),
      ]),
    });
  }
  for (const { npc, items } of liveVendorStock()) {
    const positions = itemNpcPoints('Reward', npc.id);
    const where = location(positions);
    for (const item of items) {
      const id = item.id;
      const units =
        buyPurchaseTotals(item, item.buyValue ?? 0, item.priceHonor ?? 0, 1)?.units ?? 1;
      addAcquisition(index, id, {
        title: 'Buy from ' + ref(w, 'npc', npc.id),
        steps: [
          'Go to ' +
            ref(w, 'npc', npc.id) +
            (where
              ? ' in ' + where
              : '. Where it stands depends on an activity, so check its NPC page') +
            '.',
          'Bring what you need to pay and leave room in your bags. ' +
            vendorOfferText(w, npc, item),
          'Talk to the vendor, open the shop and click ' +
            itemLink(id) +
            ' once. ' +
            (item.teachesRiding
              ? 'This character learns the riding training you paid for.'
              : 'You get ' + units + ' in your bags.'),
        ],
        details: [
          ...(npc.id === GOURDLIGHT_KEEPER_NPC_ID || item.seasonalEvent
            ? ['You can only buy this while its seasonal event is on.']
            : []),
          'You buy this for the listed price. There is no random drop roll.',
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
          ' Heroic Marks from Heroic activities that give them. See [[Heroic difficulty]] for which clears count and when they reset.',
        'Go to ' +
          ref(w, 'npc', HEROIC_VENDOR_NPC_ID) +
          ' in ' +
          where +
          '. Talk to the quartermaster to open the Heroic shop.',
        'Click ' +
          itemLink(offer.itemId) +
          '. This spends ' +
          offer.marks +
          ' Heroic Marks and gives you one item. Make room in your bags first.',
      ],
      details: [
        "You always get the item when you buy it. The Heroic Marks come out of this character's total.",
      ],
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
        'Get 1 ' +
          itemLink(offer.sigilId) +
          '. Its page tells you which boss drops it, on which difficulty, and how often.',
        'Go to ' +
          ref(w, 'npc', CRUCIBLE_VENDOR_NPC_ID) +
          ' at ' +
          where +
          '. The quartermaster stands on the landing court outside the Crucible keep.',
        'Talk to the quartermaster and click ' +
          itemLink(offer.itemId) +
          '. You hand over one sigil and get one piece in your bags. Make room in your bags first, and pick a piece your class can wear.',
      ],
      details: [
        'The trade always works. The only luck is in getting the sigil, which is a separate boss drop.',
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
    if (!recipe.acquisition?.length)
      learned.push('This recipe is known automatically. You do not need to learn it.');
    if (trainer)
      learned.push(
        'When your ' +
          wikiProfessionName(recipe.professionId) +
          ' skill is ' +
          tierForSkill(recipe.skillReq) * TIER_SKILL_STEP +
          ' or higher, talk to ' +
          ref(w, 'npc', trainer.masterNpcId) +
          ' at ' +
          location(itemNpcPoints(1, trainer.masterNpcId)) +
          '. Choose Training and learn this recipe for ' +
          w.money(trainingFeeFor(recipe)) +
          '.',
      );
    if (names.length)
      learned.push('Get and use ' + names.map(itemLink).join(' or ') + ' to learn it.');
    if (quest)
      learned.push(
        'Finish ' +
          ref(w, 'quest', quest.id) +
          ' to learn it. The quest page shows the whole route.',
      );
    if (!learned.length)
      learned.push(
        'Learn this recipe through its ' +
          (recipe.acquisition ?? []).map(words).join(' or ') +
          ' source before you craft it.',
      );
    const ingredients = recipe.reagents
      .map(
        (r) =>
          r.count +
          ' × ' +
          itemLink(r.itemId) +
          (r.noDiscount ? ' (you always need the full amount)' : ''),
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
        label: wikiStationName(bench.type) + ' · craft here',
      });
      points.push({
        step: 'Reward',
        frame: 'Overworld',
        ...bench.pos,
        label: 'Receive ' + ITEMS[recipe.resultItemId].name + ' in your bags',
      });
    }
    addAcquisition(index, recipe.resultItemId, {
      title:
        'Craft with ' +
        wikiProfessionName(recipe.professionId) +
        ' (recipe skill ' +
        recipe.skillReq +
        ')',
      steps: [
        learned.join(' '),
        'Collect the ingredients for one craft: ' +
          ingredients +
          '. Click an ingredient to see where to get it.',
        (benches.length
          ? 'Stand within ' +
            STATION_RADIUS +
            ' yards of a ' +
            wikiStationName(recipe.stationType!) +
            ' station. Use one shown on the map, or a matching mobile station. '
          : 'You do not need a station for this recipe. ') +
          'Open Crafting (T). Pick ' +
          wikiProfessionName(recipe.professionId) +
          ', then the recipe for ' +
          itemLink(recipe.resultItemId) +
          ', and choose Craft. Wait for the cast to finish. Its base time is ' +
          craftCastDurationSec(recipe) +
          ' seconds. One craft makes ' +
          recipe.resultCount +
          ' × ' +
          itemLink(recipe.resultItemId) +
          '.',
      ],
      details: [
        'Once you learn this recipe, you can craft it even with less than ' +
          recipe.skillReq +
          ' skill. The recipe skill of ' +
          recipe.skillReq +
          ' sets how advanced the recipe is (its tier).',
        ...(combo
          ? [
              'You need ' +
                wikiProfessionName(combo.craftA) +
                ' and ' +
                wikiProfessionName(combo.craftB) +
                ' as your major pair, with both at tier ' +
                combo.minTier +
                ' (skill ' +
                combo.minTier * TIER_SKILL_STEP +
                ') or higher.',
            ]
          : []),
        'Each craft also costs ' +
          w.money(fee) +
          ' in coins. If you have less than that, it takes all the copper you have.',
        'The ingredient list above is the normal amount. Some discounts can lower it if they apply to you: specialization, signed materials or Jack of All Trades. The crafting window shows exactly what you will use.',
        ...(recipe.oncePerDay
          ? [
              'Each character can craft this only once per day. The day starts over at the daily reset.',
            ]
          : []),
        ...(recipe.consumeOnCraft
          ? ['You can use this recipe only once. It is used up when the craft works.']
          : []),
        'Crafting is not a random drop. Some equipment can come out as a better masterwork version. See [[Masterwork crafting]] for the chance and the rules.',
        ...(!benches.length
          ? ['You get the item right where you are when the cast finishes.']
          : []),
      ],
      points,
    });
  }
  addDisenchantAcquisitions(w, index);
  return index;
}
