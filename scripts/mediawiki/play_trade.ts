import { GUIDE_PROF_CRAFTS, GUIDE_PROF_GATHERING } from '../../src/guide/content.generated';
import { STATION_RADIUS, STATIONS } from '../../src/sim/content/professions';
import { LAKE } from '../../src/sim/content/zone1';
import {
  BUILTIN_WORLD,
  farmPatchesInActiveWorld,
  gatherNodesInActiveWorld,
  zoneContaining,
} from '../../src/sim/data';
import type { PlayPath } from './play_path';

function coords(p: { x: number; z: number }) {
  return `x ${Number(p.x.toFixed(1))}, z ${Number(p.z.toFixed(1))}`;
}

function npc(id: string) {
  const n = BUILTIN_WORLD.npcs[id];
  return `[[${n.name} (NPC)|${n.name}]] in ${zoneContaining(n.pos.x, n.pos.z)?.name ?? 'the overworld'} (${coords(n.pos)})`;
}

const banker = npc('bursar_fernando');
const patch = farmPatchesInActiveWorld().find((p) => p.id === 'patch_eastbrook')!;
const starterFarm = `Find ${npc('farmer_jessica')}. The Eastbrook allotment beside her has an empty starting bed at ${coords(patch.beds[0])} on a new character.`;
const startCraft = 'Press T (default) to open Crafting.';
const bankStart = `Speak to ${banker}, or visit another [[Banker (NPCs index)|banker]].`;

export const tradePaths: Record<string, PlayPath> = {
  'Harvesting and gathering': {
    where: `Start with ${npc('trader_wilkes')}. For a guided first ore harvest visit ${npc('foreman_odell')} and accept [[A Trade for Every Hand]].`,
    need: 'Buy a [[Field Kit]] for 20 copper to harvest a defeated creature. For an ore vein, timber stand or herb patch, carry the matching pick, axe or sickle instead. Your tool stays in your bags.',
    steps: [
      'For a corpse, defeat a creature that offers harvestable materials and open its loot window. Use Harvest for materials. Take Loot collects the ordinary drops separately.',
      'Leave the harvest preference on all materials to take the full selection. To focus on one, choose Change, pick the material and choose Apply before harvesting.',
      'For a world node, walk up to it and click it with the matching tool in your bags. Let the gathering cast finish. See [[Mining]], [[Logging]] or [[Herbalism]] for a first node and its coordinates.',
    ],
    result:
      'A corpse supplies materials such as hides, meat or silk once per body. A world node supplies its own material, can advance that gathering proficiency and goes on a personal respawn timer.',
  },
  Fishing: {
    where: `Buy a [[Simple Fishing Pole]] from ${npc('fisherman_brandt')}. At Mirror Lake in Eastbrook Vale, stand at x -92, z 67 and face the lake centre at ${coords(LAKE)}. This shore position puts deep water within casting range.`,
    need: 'The starter pole costs 20 copper. Carry it in your bags. The first fishing band has no proficiency requirement.',
    steps: [
      'Use the pole from your bags or put it on an action bar and activate it. If the game asks you to face fishable water, move along the shore and turn toward deeper water.',
      'Wait for the bite, then use the pole again before the reel window closes. Casting too early or missing the bite can end the attempt.',
      'Cast again for another attempt. Check the band and zone tables below before moving on to a stronger rod or tougher water.',
    ],
    result:
      'Your catch can be a named raw fish or junk, or the hook can come up empty. Fish are ingredients for [[Cooking]]. Successful catches can increase fishing proficiency.',
  },
  Farming: {
    where: starterFarm,
    need: 'Accept [[First Furrow]] from Farmer Jessica. She supplies a [[Garden Hoe]] and [[Vale Wheat Seed]] if missing. You can also buy the hoe for 20 copper and buy seeds from her.',
    steps: [
      'Keep the hoe and seed in your bags. Click an empty bed to open Plant a Crop. Select Vale Wheat Seed and choose Plant.',
      'Open the Harvest Journal with Shift+K (default), or select Farming in Professions. Return to the same bed when the journal shows it is ready. Growth continues while you are offline.',
      'Interact with the ripe bed to pick produce. Harvest again while it still has picks. Once the bed is empty, plant another seed.',
    ],
    result:
      'A surviving crop gives produce and farming proficiency as long as its tier can still teach you. A harvest can give the fine grade. Crops do not give character XP.',
  },
  'Farm crops': {
    where: starterFarm,
    need: 'Carry a hoe suited to the patch and seed for a crop your farming proficiency allows. [[Vale Wheat Seed]] is a starting seed. The crop articles below give seed, required skill, grow time and produce.',
    steps: [
      'Pick a crop below, obtain its seed, then go to a patch where you can sow it. Click a free bed to open Plant a Crop.',
      'Select the seed. If you have the supplies, choose compost or a watch to improve the crop’s survival odds. Choose Plant.',
      'Check the Harvest Journal (Shift+K by default), return to that bed when ready, and interact to pick it.',
    ],
    result:
      'A successful plot yields the crop named on its page, with a chance at fine produce. Each plot has a limited number of picks. A withered crop gives no produce.',
  },
  Professions: {
    where: `Visit ${npc('foreman_odell')} for [[A Trade for Every Hand]]. He points you to the Copper Dig in Eastbrook Vale. To work a town craft, use the master and coordinates in [[Crafting stations]].`,
    need: 'You can try the starting trades on the same character. Accept the introductory quest for a Copper Mining Pick if you lack one. For crafting, collect the materials shown on the recipe.',
    steps: [
      'Follow the quest walkthrough to mine its ore and return to the foreman. Open Professions with Shift+P (default) to see your trades and skill.',
      'Press T to open Crafting. Select a craft, then a known recipe. For a locked trainer recipe, speak to the station master and choose Training.',
      'Bring the listed materials within reach of any required station. Choose a quantity, click Create and wait for the cast to finish.',
    ],
    result:
      'Gathering gives raw materials and proficiency. Crafting spends the recipe materials and gives its listed output. Your current skill and recipe tier determine how much craft skill you gain.',
  },
  'Crafting recipes': {
    where: `Open Crafting with T (default) wherever you are. For a station recipe, use the master and coordinates on [[Crafting stations]]. For example, the Eastbrook forge is beside ${npc('forgemistress_darva')}.`,
    need: 'Know the recipe and gather the listed materials. Its page tells you whether it is known automatically, taught by a trainer, or learned from a quest or pattern, and lists any special requirements.',
    steps: [
      'Select the craft and recipe. To learn a trainer recipe, speak to the named master, open Training and select the recipe once you meet its skill and fee.',
      'Read the required and available quantities. Track a recipe if you want to keep its material list on the HUD. Move within 20 yards of the matching station for a station recipe.',
      'Set the quantity and choose Create, or Create All to use the available materials for a batch. Let each cast finish.',
    ],
    result:
      'Each completed cast consumes its materials and gives the named output in the quantity on the recipe. Each recipe page explains its skill gain, cast time and costs.',
  },
  'Crafting stations': {
    where: `A first stop is the Eastbrook forge beside ${npc('forgemistress_darva')}. The station list on this page gives the position and resident master for each kind of bench.`,
    need: 'For crafting, bring a known recipe and all its materials. For training, bring the skill and fee shown by the station master.',
    steps: [
      `Walk to the type of station your recipe names. Stay within ${STATION_RADIUS} yards of it.`,
      'Speak to the resident master and choose Training for a new recipe. For a recipe you know, choose Crafting or press T and select its craft tab.',
      'Select the recipe, choose the quantity, and click Create. Stay until the cast finishes.',
    ],
    result:
      'Training permanently teaches the selected recipe unless the recipe itself says its knowledge is consumed. A successful craft produces its listed items. Using a town station does not consume the station.',
  },
  'Profession work orders': {
    where: `For the [[Forge Work Order (Work order)|Forge Work Order]], go to ${npc('forgemistress_darva')}. The other orders below name their master and town.`,
    need: 'For the Forge Work Order, bring 8 [[Copper Ore]]. For another order, open its page for the requested item, amount and payment. The order must be available from that master.',
    steps: [
      'Speak to the master. Choose the named work-order quest and click Accept.',
      'Gather or buy the requested materials, then speak to the same master with the full quantity. Open the quest and select Complete Quest when offered.',
      'If the order is unavailable after a previous delivery, check again after its 30-minute repeat interval.',
    ],
    result:
      'The master takes the requested materials and pays the listed coin. The Forge Work Order awards 16 copper and 100 quest XP for the eight ore.',
  },
  'Masterwork crafting': {
    where:
      'Use Crafting (T by default) at the station named by the equipment recipe. Find the bench and its master in [[Crafting stations]]. Recipes marked for field use can be made away from a station.',
    need: 'Choose equipment with a real stat line, know its recipe and bring its materials. Your craft tier must permit the improved quality. Specialization and higher-tier or signed materials can improve the chance.',
    steps: [
      'Select the equipment recipe under its profession. Check the materials and station, choose a quantity and click Create.',
      'Wait for the normal craft to finish. The game checks for a masterwork automatically on an eligible craft.',
      'Examine the resulting piece. The chance calculation below explains what changes the odds on your next craft.',
    ],
    result:
      'An ordinary success gives the standard piece. A masterwork improves eligible gear by one quality tier. A successful masterwork on apex Masterwrought gear gives it one Perfecting rank instead.',
  },
  Enchanting: {
    where:
      'You can disenchant or apply an enchant directly from your bags. Standard equipment enchants do not require a permanent station. Individual crafting recipes such as tool charms have their own station rules.',
    need: 'To disenchant, choose an eligible spare piece you are willing to destroy. To apply an enchant, bring a compatible item and the listed reagents, know the formula if required, and meet its skill requirement. See [[Equipment enchants]] for the exact slots, effects and costs.',
    steps: [
      'Open the item menu on spare eligible gear and choose Disenchant to break it into reagents.',
      'Open the item menu on the piece you want to keep and choose Apply Enchant. Select the compatible enchant and confirm the application.',
      'For a crafted charm instead, open Crafting with T, select Enchanting, then follow that recipe’s trainer, material and station requirements before choosing Create.',
    ],
    result:
      'Disenchanting consumes the source piece and gives enchanting materials. Applying an enchant spends reagents and puts the selected bonus on the target item. The enchant page gives its exact effect.',
  },
  'Vendors and currencies': {
    where: `For an ordinary purchase, speak to ${npc('trader_wilkes')}. For Honor gear use the quartermasters listed in [[Honor and Warfare gear]].`,
    need: 'Check which currency the item costs. Ordinary shops use coin (100 copper = 1 silver, 100 silver = 1 gold). Mark and Honor purchases require the currency and any rank or standing named by the seller.',
    steps: [
      'Choose Let me browse your goods. Find the item, read its price and restrictions, and select how many you want.',
      'Buy the item and confirm if prompted. For a simple first purchase, one Field Kit from Trader Wilkes costs 20 copper.',
      'To sell an eligible item, open your bags while the vendor is open and select the item to sell. Use the vendor’s buyback list for a recent ordinary sale.',
    ],
    result:
      'Buying deducts the shown price and puts the purchased item in your bags. A normal sale gives its vendor value. Special currencies and stock vary by quartermaster.',
  },
  Trading: {
    where:
      'Meet your trading partner in the same world location. Stand within 10 yards of each other.',
    need: 'Both players must be available to trade. Bring the transferable items or coin you plan to offer. A coin trade can carry up to six item lines on each side.',
    steps: [
      'Open the other player’s character menu and choose Trade. The other player accepts the request.',
      'Use the Gold tab for an ordinary trade. Choose items from your bags, set the quantity to offer and enter any coin. Check both sides of the window.',
      'Both players choose Accept Trade on the final offer. If either player changes it, both must confirm again. Stay in range until the trade completes.',
    ],
    result:
      'The game transfers both offers together. Cancelling or walking out of range before confirmation ends the trade without exchanging items.',
  },
  'World Market': {
    where: `Speak to ${npc('the_merchant')} or ${npc('auctioneer_voss')}. Choose Show me the World Market. Both serve the same listings.`,
    need: 'To buy, have the listed price for the whole stack. To sell, bring a tradeable stack and choose your asking price. The selling rules below give the listing limit and Merchant’s cut.',
    steps: [
      'To buy, open Browse, search for the item, check the stack size and full price, then choose Buy and confirm.',
      'To sell, open Sell, pick an item from your bags, set the quantity and price and post the listing. The market holds the listed items.',
      'Return to either keeper and open Collect to take sale proceeds or reclaim returned goods.',
    ],
    result:
      'A buyer receives the listed goods. A seller receives the sale price after the market cut. An unsold coin listing expires after 48 hours.',
  },
  Mail: {
    where:
      'Click a Ravenpost mailbox. The Eastbrook mailbox is at x -10, z -98. The list below gives coordinates for the other towns.',
    need: 'Know the recipient’s character name. Each player letter costs 30 copper in postage, plus any money you attach. You can attach up to three item stacks.',
    steps: [
      'Open Send. Fill in To with the character name and enter your message.',
      'For goods, click the item in your bags and set its parcel quantity. For money, use Attach coin. Choose Send letter.',
      'After delivery, the recipient opens Inbox at any mailbox, selects the letter, then chooses Take attachments.',
    ],
    result:
      'After 45 seconds the letter reaches the other character, even if they are offline. Attached coin and goods leave the sender when the letter is sent.',
  },
  Banking: {
    where: bankStart,
    need: 'Personal storage starts with 24 slots. Have the item in your bags and space in the bank, or space in your bags to withdraw it. Bring coin if you intend to buy an expansion.',
    steps: [
      'Speak to the bursar and open the bank, then select Personal.',
      'Click a bag item to deposit it or click a stored item to withdraw it. Shift-click a stack to enter a partial quantity.',
      'For more room, select an expansion or bag socket, check the quoted price and confirm the purchase. An empty socket accepts a storage bag.',
    ],
    result:
      'Storage follows this character between bank branches. A slot expansion adds six slots. The [[Materials Vault]] has its own capacity and upgrade costs.',
  },
  'Bank courier': {
    where:
      'Use the [[Courier (Ability)|Courier]] ability from your spellbook or action bar while in the open world, then open the summoned courier to plan the delivery.',
    need: 'An active membership is required to send a new trip. Choose up to 24 whole stacks. Quest items cannot be sent. To use the Materials Vault, unlock it at a banker first.',
    steps: [
      'Select the destination under Courier storage. Pick the bag stacks to deposit and any stored stacks you want brought back. The cargo preview shows each destination.',
      'Choose Send courier. It deposits outgoing cargo first, then collects the requested items. A trip to another character’s bank requires that character to be logged out when the courier arrives.',
      'Remain logged in for travel time to advance. If you die or enter a private instance, return travel waits until you are available.',
    ],
    result:
      'Each leg takes up to 15 seconds of active travel. Returned items enter your bags or overflow if full. Summon the courier again to plan the next delivery.',
  },
  'Materials Vault': {
    where: bankStart,
    need: 'Open the Vault tab at a banker. The default unlocking price is 2 gold. Bring crafting materials to store. Gear and quest items use other storage.',
    steps: [
      'Choose Unlock the Materials Vault and confirm the quoted price. Once unlocked, open Vault at any banker.',
      'Click a material stack in your bags, or choose Deposit all materials to move every eligible stack up to its own limit. To withdraw, select the stored material and enter a quantity.',
      'To hold more of every material, choose the next capacity increase and confirm the price. The prices below are per upgrade.',
    ],
    result:
      'The first tier holds 100 units of each eligible material independently. Each upgrade adds 100 to every material’s limit. Eligible overworld crafts can draw stored ingredients once bag materials are exhausted.',
  },
};

for (const c of GUIDE_PROF_CRAFTS.filter((craft) => craft.name !== 'Enchanting')) {
  const recipe = c.recipes.find(
    (r) => r.skillReq === 0 && r.acquisition === 'trainer' && r.station === c.station && !r.combo,
  );
  const station = STATIONS.find((s) => s.type === c.station);
  if (!recipe || !station) throw new Error('Missing starting recipe or station for ' + c.name);
  const recipeLink = `[[${recipe.name} (Recipe)|${recipe.name}]]`;
  tradePaths[c.name] = {
    where: `To make ${recipeLink} as your first ${c.name} project, visit ${npc(station.masterNpcId)}. The ${station.type} is at ${coords(station.pos)}.`,
    need: `This trainer recipe is available at skill 0. For one craft, bring ${recipe.materials.map((m) => `${m.count} x [[${m.name}]]`).join(', ')}. The training fee is ${recipe.feeCopper} copper.`,
    steps: [
      `Speak to the master, choose Training and learn ${recipe.name}. If you already know it, go straight to the bench.`,
      `${startCraft} Choose ${c.name} and select ${recipe.name}. Stay within ${STATION_RADIUS} yards of the ${station.type}.`,
      'Choose a quantity of one and click Create. Let the cast finish. To make a different item, use the recipe list below to check its trainer or pattern, materials and station.',
    ],
    result: `One successful craft gives ${recipe.output.count} x [[${recipe.output.name}]]. The usual base material cost is consumed. See ${recipeLink} for skill gain, time per craft and coin costs.`,
  };
}

for (const [trade, kind, tool, label] of [
  ['Mining', 'ore', 'Copper Mining Pick', 'ore vein'],
  ['Logging', 'wood', 'Handaxe', 'timber stand'],
  ['Herbalism', 'herb', 'Gathering Sickle', 'herb patch'],
] as const) {
  const node = gatherNodesInActiveWorld().find(
    (n) => n.zoneId === 'eastbrook_vale' && n.type === kind && n.tier === 1,
  );
  const info = GUIDE_PROF_GATHERING.find((p) => p.name === trade)!;
  const source = info.nodes?.find((n) => n.zone === 'Eastbrook Vale' && n.tier === 1);
  if (!node || !source) throw new Error('Missing starting node for ' + trade);
  tradePaths[trade] = {
    where: `Start at ${npc('trader_wilkes')}. An Eastbrook Vale tier 1 ${label} is at ${coords(node.pos)}.`,
    need: `Carry a [[${tool}]] in your bags. Trader Wilkes sells one for 20 copper. You can start at proficiency 0. Leave room in your bags for the yield.`,
    steps: [
      `Walk to the ${label} and click it while in reach. The game uses the eligible ${trade.toLowerCase()} tool you are carrying.`,
      'Stay put until the gathering cast finishes. If the node is on your personal cooldown, use another node in the zone or wait for it to replenish.',
      'Gather higher-tier nodes as your proficiency and tool tier rise. The tool and gathering tables on this page show what each zone requires.',
    ],
    result: `This starting node yields ${source.material} and can advance ${trade} proficiency. Its respawn timer for your character is ${info.respawnSeconds} seconds.`,
  };
}
