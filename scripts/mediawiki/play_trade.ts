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
const starterFarm = `Find ${npc('farmer_jessica')}. On a new character, the Eastbrook farm plot beside her has an empty bed at ${coords(patch.beds[0])} you can start with.`;
const startCraft = 'Press T (unless you changed it) to open Crafting.';
const bankStart = `Talk to ${banker}, or visit another [[Banker (NPCs index)|banker]].`;

export const tradePaths: Record<string, PlayPath> = {
  'Harvesting and gathering': {
    where: `Start with ${npc('trader_wilkes')}. For help with your first ore, visit ${npc('foreman_odell')} and accept [[A Trade for Every Hand]].`,
    need: 'To take materials from a creature you defeated, buy a [[Field Kit]] for 20 copper. For an ore vein, timber stand or herb patch, carry the matching pick, axe or sickle instead. You do not use up your tool: it stays in your bags.',
    steps: [
      'For a body, defeat a creature that has materials to harvest and open its loot window. Click Harvest to get the materials. Click Take Loot to get the normal drops. These are separate.',
      'Leave the harvest setting on all materials to get every kind. To get just one kind, choose Change, pick the material and choose Apply. Do this before you harvest.',
      'For a node in the world (an ore vein, timber stand or herb patch), walk up to it with the matching tool in your bags and click it. Wait for the gathering cast to finish. See [[Mining]], [[Logging]] or [[Herbalism]] for a first node and where it is.',
    ],
    result:
      'A body gives materials such as hides, meat or silk. You can harvest each body once. A node gives its own material and can raise your skill in that gathering trade. Then it goes on a timer before you can use it again. The timer is just for you.',
  },
  Fishing: {
    where: `Buy a [[Simple Fishing Pole]] from ${npc('fisherman_brandt')}. At Mirror Lake in Eastbrook Vale, stand on the shore at x -92, z 67. Face the middle of the lake at ${coords(LAKE)}. From there, deep water is close enough to cast into.`,
    need: 'The starter pole costs 20 copper. Keep it in your bags. You can fish in the first band with no fishing skill at all.',
    steps: [
      'Use the pole from your bags, or put it on an action bar and click it. If the game asks you to face water you can fish in, move along the shore and turn toward deeper water.',
      'Wait for a fish to bite. Then use the pole again quickly, before the time to reel in runs out. If you reel too early or miss the bite, the try can end with no fish.',
      'Cast again to try again. Check the band and zone tables below before you move on to a better rod or harder water.',
    ],
    result:
      'You might catch a raw fish or junk, or nothing at all. Fish are used in [[Cooking]]. A catch can raise your fishing skill.',
  },
  Farming: {
    where: starterFarm,
    need: 'Accept [[First Furrow]] from Farmer Jessica. If you do not have them, she gives you a [[Garden Hoe]] and [[Vale Wheat Seed]]. You can also buy the hoe for 20 copper and buy seeds from her.',
    steps: [
      'Keep the hoe and seed in your bags. Click an empty bed to open Plant a Crop. Pick Vale Wheat Seed and choose Plant.',
      'Press Shift+K (unless you changed it) to open the Harvest Journal, or pick Farming in Professions. Go back to the same bed when the journal says it is ready. Crops keep growing while you are logged off.',
      'Click the ripe bed to pick the crop. You can pick it again until it runs out of picks. When the bed is empty, plant another seed.',
    ],
    result:
      'If the crop survives, it gives you produce. It also raises your farming skill, until your skill is too high for that crop to teach you more. A harvest can give the better fine grade. Crops do not give character XP.',
  },
  'Farm crops': {
    where: starterFarm,
    need: 'Carry a hoe that works on the patch, and a seed your farming skill is high enough to plant. [[Vale Wheat Seed]] is a starting seed. The crop pages below show the seed, the skill you need, the grow time and what you get.',
    steps: [
      'Pick a crop below and get its seed. Then go to a patch where you can plant it. Click an empty bed to open Plant a Crop.',
      'Pick the seed. If you have them, add compost or a watch to give the crop a better chance to survive. Choose Plant.',
      'Check the Harvest Journal (Shift+K unless you changed it). When the crop is ready, go back to that bed and click it to pick it.',
    ],
    result:
      'A crop that survives gives the produce named on its page, with a chance of the fine grade. Each bed can only be picked a set number of times. A crop that withers (dies) gives nothing.',
  },
  Professions: {
    where: `Visit ${npc('foreman_odell')} for [[A Trade for Every Hand]]. He sends you to the Copper Dig in Eastbrook Vale. To craft at a town station, find its master and location in [[Crafting stations]].`,
    need: 'One character can try all the starting trades. If you do not have a Copper Mining Pick, accept the first quest to get one. For crafting, collect the materials the recipe lists.',
    steps: [
      'Follow the quest’s steps to mine the ore, then go back to the foreman. Press Shift+P (unless you changed it) to open Professions and see your trades and skill.',
      'Press T to open Crafting. Pick a craft, then a recipe you know. If a recipe is locked and a trainer teaches it, talk to the station master and choose Training.',
      'Bring the materials. If the recipe needs a station, stand close to it. Choose how many to make, click Create and wait for the cast to finish.',
    ],
    result:
      'Gathering gives you raw materials and raises your gathering skill. Crafting uses up the recipe’s materials and gives you what it makes. How much craft skill you gain depends on your skill and the recipe’s tier.',
  },
  'Crafting recipes': {
    where: `Open Crafting with T (default) wherever you are. If a recipe needs a station, find its master and location on [[Crafting stations]]. For example, the Eastbrook forge is beside ${npc('forgemistress_darva')}.`,
    need: 'Know the recipe and collect its materials. The recipe’s page tells you how to learn it: you may know it already, or learn it from a trainer, a quest or a pattern. The page also lists anything else it needs.',
    steps: [
      'Pick the craft and recipe. To learn a recipe from a trainer, talk to the master it names and open Training. Pick the recipe once you have the skill and the coin for the fee.',
      'Compare how many materials you need with how many you have. Track a recipe to keep its material list on your screen. If the recipe needs a station, stand within 20 yards of the right one.',
      'Set how many to make and choose Create. Or choose Create All to make as many as your materials allow. Let each cast finish.',
    ],
    result:
      'Each finished cast uses up its materials and gives you the item, in the amount the recipe says. Each recipe page shows its skill gain, cast time and costs.',
  },
  'Crafting stations': {
    where: `A first stop is the Eastbrook forge beside ${npc('forgemistress_darva')}. The station list on this page shows where each kind of bench is and which master works there.`,
    need: 'To craft, you need a recipe you know and all its materials. To train, you need the skill and the fee the station master shows.',
    steps: [
      `Walk to the kind of station your recipe names. Stay within ${STATION_RADIUS} yards of it.`,
      'For a new recipe, talk to the master there and choose Training. For a recipe you know, choose Crafting, or press T and pick its craft tab.',
      'Pick the recipe, choose how many, and click Create. Stay until the cast finishes.',
    ],
    result:
      'Training teaches you the recipe for good, unless the recipe says you forget it after you craft it. A craft that works gives you its listed items. Town stations never get used up.',
  },
  'Profession work orders': {
    where: `For the [[Forge Work Order (Work order)|Forge Work Order]], go to ${npc('forgemistress_darva')}. The other orders below say which master and town to go to.`,
    need: 'For the Forge Work Order, bring 8 [[Copper Ore]]. For another order, open its page to see what item it wants, how many, and what it pays. The master must have the order ready for you.',
    steps: [
      'Talk to the master. Pick the work-order quest by name and click Accept.',
      'Gather or buy the materials it asks for. When you have all of them, talk to the same master. Open the quest and choose Complete Quest.',
      'After you hand in an order, wait 30 minutes. Then you can take it again.',
    ],
    result:
      'The master takes the materials and pays you the coin listed. For the eight ore, the Forge Work Order gives 16 copper and 100 quest XP.',
  },
  'Masterwork crafting': {
    where:
      'Open Crafting (T unless you changed it) at the station the equipment recipe names. Find the bench and its master in [[Crafting stations]]. Recipes marked for field use can be made away from a station.',
    need: 'Pick equipment that has stats on it. You need to know its recipe and bring its materials. Your craft tier must be high enough for the better quality. Specializing, higher-tier materials and signed materials can raise your chance.',
    steps: [
      'Pick the equipment recipe under its profession. Check the materials and station, choose how many and click Create.',
      'Wait for the craft to finish. If the item can become a masterwork, the game checks for it by itself.',
      'Look at the item you made. The chances explained below show what changes your odds next time.',
    ],
    result:
      'A normal craft gives the normal item. A masterwork makes the gear one quality tier better. On top-tier (apex) Masterwrought gear, a masterwork gives it one Perfecting rank instead.',
  },
  Enchanting: {
    where:
      'You can disenchant items or apply enchants right from your bags. Normal equipment enchants do not need a fixed station. Some crafting recipes, such as tool charms, have their own station rules.',
    need: 'To disenchant, pick a spare item that can be disenchanted. It will be destroyed. To apply an enchant, you need an item it works on, the listed reagents, the formula if it needs one, and enough skill. See [[Equipment enchants]] for the exact slots, effects and costs.',
    steps: [
      'Open the item menu on a spare item and choose Disenchant. This breaks it into reagents (enchanting materials).',
      'Open the item menu on the item you want to keep and choose Apply Enchant. Pick an enchant that works on it and confirm.',
      'To craft a charm instead, press T to open Crafting and pick Enchanting. Follow that recipe’s rules for trainer, materials and station, then choose Create.',
    ],
    result:
      'Disenchanting destroys the item and gives you enchanting materials. Applying an enchant uses up reagents and puts the bonus on the item you picked. The enchant’s page shows exactly what it does.',
  },
  'Vendors and currencies': {
    where: `For normal shopping, talk to ${npc('trader_wilkes')}. For Honor gear, use the quartermasters listed in [[Honor and Warfare gear]].`,
    need: 'Check what kind of money the item costs. Normal shops use coin (100 copper = 1 silver, 100 silver = 1 gold). For Mark and Honor items, you need that currency and any rank or standing the seller asks for.',
    steps: [
      'Choose Let me browse your goods. Find the item, read its price and rules, and pick how many you want.',
      'Buy the item, and confirm if the game asks. For an easy first buy, one Field Kit from Trader Wilkes costs 20 copper.',
      'To sell an item, open your bags while the shop is open and pick the item. To get back a normal item you sold not long ago, use the vendor’s buyback list.',
    ],
    result:
      'Buying takes the price shown and puts the item in your bags. Selling a normal item gives you its vendor price. Each quartermaster has its own special currency and items.',
  },
  Trading: {
    where:
      'Meet the player you want to trade with in the same place. Stand within 10 yards of each other.',
    need: 'Both players must be free to trade. Bring the coin, or items that can be traded, that you want to give. A coin trade can hold up to six item lines on each side.',
    steps: [
      'Open the other player’s character menu and choose Trade. The other player accepts.',
      'Use the Gold tab for a normal trade. Pick items from your bags, set how many to give, and type in any coin. Check both sides of the window.',
      'When the offer is final, both players choose Accept Trade. If either player changes anything, both must accept again. Stay close until the trade is done.',
    ],
    result:
      'The game swaps both offers at the same time. If someone cancels or walks too far away before both accept, the trade ends and nothing is swapped.',
  },
  'World Market': {
    where: `Speak to ${npc('the_merchant')} or ${npc('auctioneer_voss')}. Choose Show me the World Market. Both show the same items for sale.`,
    need: 'To buy, you need enough coin for the whole stack. To sell, bring a stack that can be traded and pick your price. The selling rules below show how many listings you can have and how much the Merchant keeps.',
    steps: [
      'To buy, open Browse and search for the item. Check how many are in the stack and the full price. Then choose Buy and confirm.',
      'To sell, open Sell and pick an item from your bags. Set how many and the price, then post it. The market holds your items while they are for sale.',
      'Go back to either market keeper and open Collect. There you get the coin from your sales, or take back items that were returned to you, such as ones that did not sell.',
    ],
    result:
      'The buyer gets the items. The seller gets the price, minus the part the market keeps. A coin listing that does not sell ends after 48 hours.',
  },
  Mail: {
    where:
      'Click a Ravenpost mailbox. The Eastbrook mailbox is at x -10, z -98. The list below shows where the mailboxes in other towns are.',
    need: 'You need the name of the character you are writing to. Each letter to a player costs 30 copper to send, plus any money you put in it. You can add up to three stacks of items.',
    steps: [
      'Open Send. Type the character’s name in To and write your message.',
      'To send items, click the item in your bags and set how many to send. To send money, use Attach coin. Choose Send letter.',
      'When the letter arrives, the other player opens Inbox at any mailbox, picks the letter, and chooses Take attachments.',
    ],
    result:
      'The letter arrives after 45 seconds, even if the other player is logged off. The coin and items leave your bags as soon as you send it.',
  },
  Banking: {
    where: bankStart,
    need: 'Your own bank space starts with 24 slots. To put an item in, have it in your bags and room in the bank. To take one out, have room in your bags. Bring coin if you want to buy more space.',
    steps: [
      'Talk to the bursar and open the bank, then pick Personal.',
      'Click an item in your bags to put it in the bank. Click an item in the bank to take it out. Shift-click a stack to move only part of it.',
      'For more room, pick an expansion or a bag socket. Check the price and confirm. You can put a storage bag in an empty socket.',
    ],
    result:
      'This character’s bank is the same at every banker. Each slot expansion adds six slots. The [[Materials Vault]] has its own space and upgrade costs.',
  },
  'Bank courier': {
    where:
      'Out in the open world, use the [[Courier (Ability)|Courier]] ability from your spellbook or action bar. Then open the courier that appears to plan the trip.',
    need: 'You need an active membership to send a new trip. You can pick up to 24 whole stacks. You cannot send quest items. To use the Materials Vault, unlock it at a banker first.',
    steps: [
      'Pick where to send it under Courier storage. Pick the stacks from your bags to store, and any stored stacks you want brought back. The cargo preview shows where each stack goes.',
      'Choose Send courier. It drops off what you sent first, then picks up what you asked for. If you send it to another character’s bank, that character must be logged off when the courier gets there.',
      'Stay logged in: the courier only travels while you are online. If you die or go into a private instance, the trip back waits until you are free again.',
    ],
    result:
      'Each part of the trip takes up to 15 seconds of travel while you are online. Items that come back go into your bags, or into overflow if your bags are full. Summon the courier again to plan the next trip.',
  },
  'Materials Vault': {
    where: bankStart,
    need: 'Open the Vault tab at a banker. It normally costs 2 gold to unlock. Bring crafting materials to store. Gear and quest items cannot go in the vault.',
    steps: [
      'Choose Unlock the Materials Vault and confirm the price. After that, you can open Vault at any banker.',
      'Click a stack of materials in your bags. Or choose Deposit all materials to move every material that can go in, up to each one’s limit. To take some out, pick the stored material and type how many.',
      'To hold more of every material, choose the next space upgrade and confirm the price. The prices below are for each upgrade.',
    ],
    result:
      'At first, the vault holds up to 100 of each material, counted separately. Each upgrade adds 100 to the limit for every material. Some crafts out in the world can use materials from the vault once the ones in your bags run out.',
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
    where: `To make ${recipeLink} as your first ${c.name} item, visit ${npc(station.masterNpcId)}. The ${station.type} is at ${coords(station.pos)}.`,
    need: `A trainer teaches this recipe, and you can learn it at skill 0. To make it once, bring ${recipe.materials.map((m) => `${m.count} x [[${m.name}]]`).join(', ')}. The training fee is ${recipe.feeCopper} copper.`,
    steps: [
      `Talk to the master, choose Training and learn ${recipe.name}. If you already know it, go straight to the bench.`,
      `${startCraft} Choose ${c.name} and pick ${recipe.name}. Stay within ${STATION_RADIUS} yards of the ${station.type}.`,
      'Set the amount to one and click Create. Let the cast finish. To make something else, use the recipe list below to check where to learn it, its materials and its station.',
    ],
    result: `One successful craft gives ${recipe.output.count} x [[${recipe.output.name}]]. It uses up the normal base materials. See ${recipeLink} for skill gain, time per craft and coin costs.`,
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
    need: `Carry a [[${tool}]] in your bags. Trader Wilkes sells one for 20 copper. You can start with no skill (0). Leave room in your bags for what you gather.`,
    steps: [
      `Walk up to the ${label} and click it when you are close enough. The game uses the ${trade.toLowerCase()} tool you are carrying.`,
      'Stand still until the gathering cast finishes. If you used this node not long ago, it is on your own timer. Use another node in the zone, or wait for it to come back.',
      'As your skill and tool tier go up, gather higher-tier nodes. The tool and gathering tables on this page show what each zone needs.',
    ],
    result: `This first node gives ${source.material} and can raise your ${trade} skill. After you gather it, you must wait ${info.respawnSeconds} seconds before you can gather it again.`,
  };
}
