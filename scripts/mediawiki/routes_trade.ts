import { GUIDE_PROF_CRAFTS } from '../../src/guide/content.generated';
import { MAILBOXES } from '../../src/sim/content/mailboxes';
import { STATION_RADIUS, STATIONS } from '../../src/sim/content/professions';
import { LAKE } from '../../src/sim/content/zone1';
import {
  farmPatchesInActiveWorld,
  gatherNodesInActiveWorld,
  getActiveWorldContent,
} from '../../src/sim/data';
import { npcPin, type SystemRoute, worldPin } from './system_route_points';

type Step = Parameters<typeof worldPin>[0];
type Position = { x: number; z: number };
const pin = (step: Step, p: Position, label: string, radius?: number) =>
  worldPin(step, p.x, p.z, label, radius);

const eastbrookNodes = gatherNodesInActiveWorld().filter(
  (n) => n.zoneId === 'eastbrook_vale' && n.tier === 1,
);
const veins = eastbrookNodes.filter((n) => n.type === 'ore');
const firstOre = veins[0];
const wolfCamp = getActiveWorldContent().camps.find((c) => c.mobId === 'forest_wolf')!;
const bed = farmPatchesInActiveWorld().find((p) => p.id === 'patch_eastbrook')!.beds[0];
const forge = STATIONS.find((s) => s.type === 'forge')!;
const shore = { x: -92, z: 67 };
const eastbrookMailbox = MAILBOXES[0];

function bank(step: Step, action: string) {
  return npcPin(step, 'bursar_fernando', action);
}
function forgePin(step: Step, action: string) {
  return pin(step, forge.pos, 'Eastbrook forge: ' + action);
}

const farm: SystemRoute = {
  points: [
    npcPin('Start', 'farmer_jessica', 'get the starter hoe and seed'),
    pin(1, bed, 'Open Plant a Crop at an empty bed'),
    pin(2, bed, 'Plant here; the Harvest Journal shows when to return'),
    pin(3, bed, 'Return to the bed you planted and harvest the ripe crop'),
    pin('Reward', bed, 'Pick the produce at this bed'),
  ],
  notes: [
    'This example marks one Eastbrook bed. If someone is using it, plant in another empty bed, and pick from the bed you planted. You can check the journal anywhere while the crop grows.',
  ],
};

export const tradeRoutes: Record<string, SystemRoute> = {
  'Harvesting and gathering': {
    points: [
      npcPin('Start', 'trader_wilkes', 'buy a Field Kit for bodies, or a tool for gathering nodes'),
      pin(1, wolfCamp.center, 'Example body: defeat a Forest Wolf in this camp', wolfCamp.radius),
      pin(2, wolfCamp.center, 'At the body, pick which materials you want and Harvest'),
      pin('Reward', wolfCamp.center, 'Body route: collect the materials where the wolf fell'),
      pin(3, firstOre.pos, 'Or, node route: use a mining pick on this ore vein'),
      pin('Reward', firstOre.pos, 'Node route: you get the ore here when the cast finishes'),
    ],
    notes: [
      'The wolf pin marks a camp. The body ends up wherever you fight. The ore vein is a different way to gather. You do not have to go there after harvesting a body.',
    ],
  },
  Fishing: {
    points: [
      npcPin('Start', 'fisherman_brandt', 'buy the Simple Fishing Pole'),
      pin(1, shore, 'Stand on this shore and use the pole'),
      pin(2, shore, 'Reel in at the bite'),
      pin(3, shore, 'Cast again here for another attempt'),
      pin('Reward', shore, 'If you reel in a catch, it goes into your bags here'),
    ],
    notes: [
      `From the shore pin, face the middle of Mirror Lake at x ${LAKE.x}, z ${LAKE.z}. You stay on land to cast and reel in.`,
    ],
  },
  Farming: {
    points: [
      npcPin('Start', 'farmer_jessica', 'accept First Furrow for the starter hoe and seed'),
      pin(1, bed, 'Select Vale Wheat Seed and plant in an empty bed'),
      pin(3, bed, 'Return to this same bed when ripe and pick the crop'),
      pin('Reward', bed, 'Harvest the produce here'),
    ],
    notes: [
      'Step 2 is checking the journal, which you can open anywhere. The pin shows one starting bed. If you plant in a different bed, harvest there instead. You hand in First Furrow to Farmer Jessica.',
    ],
  },
  'Farm crops': farm,
  Professions: {
    points: [
      npcPin('Start', 'foreman_odell', 'accept A Trade for Every Hand'),
      ...veins.map((v) => pin(1, v.pos, 'Copper Dig: mine an ore vein here for the quest')),
      npcPin(1, 'foreman_odell', 'return after five ore harvests'),
      npcPin('Reward', 'foreman_odell', 'Get the first quest’s reward here'),
      npcPin(2, forge.masterNpcId, 'Example crafting trainer: speak to Forgemistress Darva'),
      forgePin(3, 'create the selected forge recipe'),
      forgePin('Reward', 'the completed craft is added to your bags here'),
    ],
    notes: [
      'You can mine at any of the ore pins, in any order. The quest counts each time you mine ore. The forge is a separate example for the crafting steps. Other crafts use their own station, or can be done anywhere.',
    ],
  },
  'Crafting recipes': {
    points: [
      npcPin(
        'Start',
        forge.masterNpcId,
        'start here if your forge recipe must be learned from a trainer',
      ),
      npcPin(1, forge.masterNpcId, 'Open Training and learn the forge recipe'),
      forgePin(2, 'stay close with the listed materials'),
      forgePin(3, 'choose Create or Create All'),
      forgePin('Reward', 'you get the crafted item when the cast ends'),
    ],
    notes: [
      'This is an example for a forge recipe. You can open the recipe list anywhere. Field recipes do not need a bench. Your recipe’s page shows its real materials, training and station.',
    ],
  },
  'Crafting stations': {
    points: [
      npcPin('Start', forge.masterNpcId, 'Eastbrook forge master'),
      pin(1, forge.pos, 'Eastbrook forge: get close enough to use it', STATION_RADIUS),
      npcPin(2, forge.masterNpcId, 'Open Training here to learn a forge recipe'),
      forgePin(3, 'select the known recipe and create it'),
      forgePin('Reward', 'the output goes into your bags when the cast finishes'),
      ...STATIONS.filter((s) => s.id !== forge.id).map((s) =>
        pin(1, s.pos, `Alternative station for ${s.type} recipes`),
      ),
    ],
    notes: [
      'The numbered steps use the Eastbrook forge. The other station pins show where to go for other kinds of recipes. You use every town station from the same distance.',
    ],
  },
  'Profession work orders': {
    points: [
      npcPin('Start', forge.masterNpcId, 'Forge Work Order'),
      npcPin(1, forge.masterNpcId, 'Accept the Forge Work Order'),
      ...veins.map((v) => pin(2, v.pos, 'Copper Dig: mine Copper Ore here until you have eight')),
      npcPin(
        'Reward',
        forge.masterNpcId,
        'Come back with eight Copper Ore and complete the quest for coin and XP',
      ),
    ],
    notes: [
      'This is the Forge Work Order example. You can bring ore you already have, or buy it. Step 3 is the wait before you can take the order again. Only your own wait counts. For another order, use its quest page and the master it names.',
    ],
  },
  'Masterwork crafting': {
    points: [
      npcPin(
        'Start',
        forge.masterNpcId,
        'Forge example: find the master here if your recipe must be learned from a trainer',
      ),
      forgePin(1, 'pick an equipment recipe that has stats and choose Create'),
      forgePin(2, 'finish the cast; the game checks for a masterwork by itself'),
      forgePin('Reward', 'you get the equipment here; look at it in your bags'),
    ],
    notes: [
      'The pin is an example for a forge recipe. Use the station your equipment recipe names. Step 3 is just looking at the item in your bags, which you can do anywhere.',
    ],
  },
  Enchanting: {
    points: [],
    flow: [
      'Open your bags',
      'Disenchant spare equipment for reagents',
      'Open Apply Enchant on the item to keep',
      'Confirm the formula',
      'Inspect the enchanted item in your bags',
    ],
    notes: [
      'Start with the item in your bags, wherever you are. You do steps 1 and 2 from your bags. Disenchant gives reagents right away. Apply Enchant puts the effect straight onto the item. There is no NPC or chest to visit. In step 3, crafting a charm is optional; its recipe tells you which station to use.',
    ],
  },
  'Vendors and currencies': {
    points: [
      npcPin('Start', 'trader_wilkes', 'example of normal shopping'),
      npcPin(1, 'trader_wilkes', 'Open the shop and check the price'),
      npcPin(2, 'trader_wilkes', 'Buy the Field Kit here'),
      npcPin(3, 'trader_wilkes', 'With the shop open, sell items or buy them back'),
      npcPin(
        'Reward',
        'trader_wilkes',
        'What you buy, or the coin from what you sell, goes to you here',
      ),
    ],
    notes: [
      'The map shows the example of buying a Field Kit for 20 copper. For the Honor quartermasters, follow the Honor and Warfare gear route instead.',
    ],
  },
  Trading: {
    points: [],
    flow: [
      'Meet within 10 yards',
      'Choose Trade and accept the invitation',
      'Set both offers',
      'Both choose Accept Trade',
      'The items and coin go straight to the two players',
    ],
    notes: [
      'You can meet anywhere the two of you agree on. For the start and steps 1 to 3, stay within 10 yards of each other. When both players accept the final offer, both get the items or coin they agreed on. You do not need to visit a vendor or pick anything up.',
    ],
  },
  'World Market': {
    points: ['the_merchant', 'auctioneer_voss'].flatMap((id) => [
      npcPin('Start', id),
      npcPin(1, id, 'Browse and buy at this keeper'),
      npcPin(2, id, 'List a stack for sale here'),
      npcPin(3, id, 'Open Collect at either market keeper'),
      npcPin('Reward', id, 'Buyers get items; sellers collect coin or items returned to them'),
    ]),
    notes: [
      'Both market keepers work the same way. Use either one to buy, sell or collect. You do not need to visit both.',
    ],
  },
  Mail: {
    points: [
      pin('Start', eastbrookMailbox, 'Eastbrook Ravenpost mailbox'),
      pin(1, eastbrookMailbox, 'Sender: open Send and enter the recipient'),
      pin(2, eastbrookMailbox, 'Sender: attach goods or coin and send the letter'),
      pin(3, eastbrookMailbox, 'Recipient: open Inbox and read the letter'),
      pin(
        'Reward',
        eastbrookMailbox,
        'Recipient: Take attachments here or at another Ravenpost pillar',
      ),
    ],
    notes: [
      'The map shows the Eastbrook mailbox as the example for both players. The sender and the recipient can use different mailboxes. The mailbox list below shows where the others are.',
    ],
  },
  Banking: {
    points: [
      bank('Start', 'open the bank'),
      bank(1, 'choose Personal'),
      bank(2, 'deposit or withdraw items'),
      bank(3, 'buy a storage expansion if wanted'),
      bank('Reward', 'items you take out go to your bags; space you buy shows up in the bank'),
    ],
    notes: [
      'This uses the Eastbrook banker as the example. You can reach the same bank space at any other banker.',
    ],
  },
  'Bank courier': {
    points: [
      bank('Start', 'optional: unlock the Materials Vault here before sending things there'),
    ],
    flow: [
      'Summon Courier where you are in the open world',
      'Choose the destination and cargo',
      'Send courier',
      'Stay online for return travel',
      'Collect the returned items in bags or overflow',
    ],
    notes: [
      'You do not have to visit the banker pin. For a normal trip, summon the courier wherever you are in the open world. Pick the cargo there, send it, and stay logged in. When it comes back, the items go into your bags, or into overflow. This happens wherever you are, so there is no fixed spot on the map.',
    ],
  },
  'Materials Vault': {
    points: [
      bank('Start', 'open the bank and select Vault'),
      bank(1, 'unlock the vault'),
      bank(2, 'deposit or withdraw materials'),
      bank(3, 'buy the next capacity increase'),
      bank('Reward', 'materials you take out go to your bags; space you buy is added to the vault'),
    ],
    notes: [
      'This uses the Eastbrook banker as the example. Once it is unlocked, you can reach the same vault from any banker.',
    ],
  },
};

for (const craft of GUIDE_PROF_CRAFTS.filter((c) => c.name !== 'Enchanting')) {
  const station = STATIONS.find((s) => s.type === craft.station)!;
  const recipe = craft.recipes.find(
    (r) =>
      r.skillReq === 0 && r.acquisition === 'trainer' && r.station === craft.station && !r.combo,
  )!;
  tradeRoutes[craft.name] = {
    points: [
      npcPin('Start', station.masterNpcId),
      npcPin(1, station.masterNpcId, `Learn ${recipe.name} from the master here`),
      pin(2, station.pos, `Use the ${station.type} with the listed ingredients`, STATION_RADIUS),
      pin(3, station.pos, `Choose Create for ${recipe.name}`),
      pin(
        'Reward',
        station.pos,
        `You get ${recipe.output.count} x ${recipe.output.name} when the cast finishes`,
      ),
    ],
    notes: [
      'This route follows the first recipe in the steps above. Get its materials before you go. Other recipes can need different things.',
    ],
  };
}

for (const [trade, type, tool, target] of [
  ['Mining', 'ore', 'Copper Mining Pick', 'ore vein'],
  ['Logging', 'wood', 'Handaxe', 'timber stand'],
  ['Herbalism', 'herb', 'Gathering Sickle', 'herb patch'],
] as const) {
  const node = eastbrookNodes.find((n) => n.type === type)!;
  tradeRoutes[trade] = {
    points: [
      npcPin('Start', 'trader_wilkes', 'buy the ' + tool),
      pin(1, node.pos, 'Click this tier 1 ' + target),
      pin(2, node.pos, 'Stay here until the cast finishes'),
      pin('Reward', node.pos, 'You get the materials at this node'),
    ],
    notes: [
      'The pin shows the first Eastbrook node from the steps above. Step 3 is something you keep doing as you get better: use the tables below to pick a later zone and tool tier.',
    ],
  };
}
