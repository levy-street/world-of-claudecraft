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
    'This example marks one Eastbrook bed. If it is occupied, use another free bed and collect from the one you planted. You can check the journal anywhere while the crop grows.',
  ],
};

export const tradeRoutes: Record<string, SystemRoute> = {
  'Harvesting and gathering': {
    points: [
      npcPin(
        'Start',
        'trader_wilkes',
        'buy a Field Kit for a corpse or a tool for a gathering node',
      ),
      pin(1, wolfCamp.center, 'Example corpse: defeat a Forest Wolf in this camp', wolfCamp.radius),
      pin(2, wolfCamp.center, 'At the body, choose your material preference and Harvest'),
      pin('Reward', wolfCamp.center, 'Corpse route: collect the materials where the wolf fell'),
      pin(3, firstOre.pos, 'Alternative node route: use a mining pick on this ore vein'),
      pin('Reward', firstOre.pos, 'Node route: receive the ore here when the cast finishes'),
    ],
    notes: [
      'The wolf pin marks a camp. The exact corpse location depends on where you fight. The ore vein is an alternative gathering activity, not a required stop after harvesting a corpse.',
    ],
  },
  Fishing: {
    points: [
      npcPin('Start', 'fisherman_brandt', 'buy the Simple Fishing Pole'),
      pin(1, shore, 'Stand on this shore and use the pole'),
      pin(2, shore, 'Reel in at the bite'),
      pin(3, shore, 'Cast again here for another attempt'),
      pin('Reward', shore, 'The catch goes into your bags here if the reel succeeds'),
    ],
    notes: [
      `Face the centre of Mirror Lake at x ${LAKE.x}, z ${LAKE.z} from the shore pin. You stay on land to cast and reel.`,
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
      'Step 2 is a journal check. Open it anywhere. The pin shows one starting bed; if you plant in a different bed, harvest there instead. First Furrow has its own quest hand-in with Farmer Jessica.',
    ],
  },
  'Farm crops': farm,
  Professions: {
    points: [
      npcPin('Start', 'foreman_odell', 'accept A Trade for Every Hand'),
      ...veins.map((v) => pin(1, v.pos, 'Copper Dig: mine an ore vein here for the quest')),
      npcPin(1, 'foreman_odell', 'return after five ore harvests'),
      npcPin('Reward', 'foreman_odell', 'Collect the introductory quest reward here'),
      npcPin(2, forge.masterNpcId, 'Example crafting trainer: speak to Forgemistress Darva'),
      forgePin(3, 'create the selected forge recipe'),
      forgePin('Reward', 'the completed craft is added to your bags here'),
    ],
    notes: [
      'The ore pins are choices, not an ordered circuit. The quest counts successful harvests. The forge is a separate example for the crafting steps. Other crafts use their own station or can be done in the field.',
    ],
  },
  'Crafting recipes': {
    points: [
      npcPin('Start', forge.masterNpcId, 'start here if the selected forge recipe needs training'),
      npcPin(1, forge.masterNpcId, 'Open Training and learn the forge recipe'),
      forgePin(2, 'stay in range with the listed ingredients'),
      forgePin(3, 'choose Create or Create All'),
      forgePin('Reward', 'receive the crafted output at the end of the cast'),
    ],
    notes: [
      'Example for a forge recipe. You may open the recipe list anywhere. Field recipes need no fixed bench. Follow your recipe page for its actual ingredients, training and station.',
    ],
  },
  'Crafting stations': {
    points: [
      npcPin('Start', forge.masterNpcId, 'Eastbrook forge master'),
      pin(1, forge.pos, 'Eastbrook forge: enter station range', STATION_RADIUS),
      npcPin(2, forge.masterNpcId, 'Open Training here to learn a forge recipe'),
      forgePin(3, 'select the known recipe and create it'),
      forgePin('Reward', 'the output goes into your bags when the cast finishes'),
      ...STATIONS.filter((s) => s.id !== forge.id).map((s) =>
        pin(1, s.pos, `Alternative station for ${s.type} recipes`),
      ),
    ],
    notes: [
      'The numbered walkthrough uses the Eastbrook forge. Other station pins identify alternative destinations for different recipes. Each town station works within the same range.',
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
        'Return with eight Copper Ore and complete the quest for coin and XP',
      ),
    ],
    notes: [
      'Forge Work Order example. You can supply ore you already own or buy it instead. Step 3 is a personal repeat timer after delivery. For another order, use its quest page and the indicated master.',
    ],
  },
  'Masterwork crafting': {
    points: [
      npcPin(
        'Start',
        forge.masterNpcId,
        'Forge example: find the master here if your recipe needs training',
      ),
      forgePin(1, 'choose an eligible stat-bearing equipment recipe and Create'),
      forgePin(2, 'finish the cast; masterwork is checked automatically'),
      forgePin('Reward', 'receive the equipment here and inspect it in your bags'),
    ],
    notes: [
      'The pin is an example for a forge recipe. Follow the station requirement on your equipment recipe. Step 3 is an inspection in your bags and can be done anywhere.',
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
      'Start with the eligible item in your bags wherever you are. Steps 1 and 2 are bag actions. Disenchant gives reagents immediately; Apply Enchant puts the effect directly on the target item. There is no reward chest or NPC. For the optional crafted charm in step 3, follow its recipe to the specified station.',
    ],
  },
  'Vendors and currencies': {
    points: [
      npcPin('Start', 'trader_wilkes', 'ordinary purchase example'),
      npcPin(1, 'trader_wilkes', 'Open the shop and check the price'),
      npcPin(2, 'trader_wilkes', 'Buy the Field Kit here'),
      npcPin(3, 'trader_wilkes', 'Use the open vendor window to sell or buy back'),
      npcPin('Reward', 'trader_wilkes', 'Your purchase or sale proceeds go to the character here'),
    ],
    notes: [
      'The map shows the 20-copper Field Kit example. Follow the Honor and Warfare gear route for the Honor quartermasters instead.',
    ],
  },
  Trading: {
    points: [],
    flow: [
      'Meet within 10 yards',
      'Choose Trade and accept the invitation',
      'Set both offers',
      'Both choose Accept Trade',
      'Items and coin transfer directly to the two players',
    ],
    notes: [
      'The meeting point is wherever the two players agree. Start and steps 1 to 3 take place within 10 yards of one another. Both players receive their agreed items or coin when both accept the final offer. No vendor or collection trip is involved.',
    ],
  },
  'World Market': {
    points: ['the_merchant', 'auctioneer_voss'].flatMap((id) => [
      npcPin('Start', id),
      npcPin(1, id, 'Browse and buy at this keeper'),
      npcPin(2, id, 'List a stack for sale here'),
      npcPin(3, id, 'Open Collect at either market keeper'),
      npcPin('Reward', id, 'Buyers receive goods; sellers collect proceeds or returned goods'),
    ]),
    notes: [
      'The two keepers are interchangeable. Choose either one to buy, list or collect. You do not need to visit both.',
    ],
  },
  Mail: {
    points: [
      pin('Start', eastbrookMailbox, 'Eastbrook Ravenpost mailbox'),
      pin(1, eastbrookMailbox, 'Sender: open Send and enter the recipient'),
      pin(2, eastbrookMailbox, 'Sender: attach goods or coin and send the letter'),
      pin(3, eastbrookMailbox, 'Recipient: open Inbox and read the delivered letter'),
      pin(
        'Reward',
        eastbrookMailbox,
        'Recipient: Take attachments here or at another Ravenpost pillar',
      ),
    ],
    notes: [
      'The map shows the Eastbrook example for both players. The sender and recipient may use different mailboxes. The mailbox list below gives the other locations.',
    ],
  },
  Banking: {
    points: [
      bank('Start', 'open the bank'),
      bank(1, 'choose Personal'),
      bank(2, 'deposit or withdraw items'),
      bank(3, 'buy a storage expansion if wanted'),
      bank('Reward', 'withdrawn goods go to your bags; a bought expansion appears in the bank'),
    ],
    notes: [
      'Eastbrook branch example. You can access the same personal storage at another banker.',
    ],
  },
  'Bank courier': {
    points: [
      bank('Start', 'optional stop to unlock the Materials Vault before using that destination'),
    ],
    flow: [
      'Summon Courier at your open-world location',
      'Choose the destination and cargo',
      'Send courier',
      'Stay online for return travel',
      'Collect the returned items in bags or overflow',
    ],
    notes: [
      'The banker pin is optional. Summon the courier at your own open-world position to start a normal delivery. Select the cargo there, send it and stay logged in. On its return, goods enter your bags or overflow at your character, so the travel and payout have no fixed map coordinates.',
    ],
  },
  'Materials Vault': {
    points: [
      bank('Start', 'open the bank and select Vault'),
      bank(1, 'unlock the vault'),
      bank(2, 'deposit or withdraw materials'),
      bank(3, 'buy the next capacity increase'),
      bank(
        'Reward',
        'withdrawn materials enter your bags; purchased capacity applies to the vault',
      ),
    ],
    notes: [
      'Eastbrook branch example. Once unlocked, the same vault can be accessed from any banker.',
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
      npcPin(1, station.masterNpcId, `Learn ${recipe.name} from the resident master`),
      pin(2, station.pos, `Use the ${station.type} with the listed ingredients`, STATION_RADIUS),
      pin(3, station.pos, `Choose Create for ${recipe.name}`),
      pin(
        'Reward',
        station.pos,
        `Receive ${recipe.output.count} x ${recipe.output.name} when the cast finishes`,
      ),
    ],
    notes: [
      'This route matches the first recipe in the walkthrough. Obtain its ingredients before arriving. Other recipes can have different requirements.',
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
      pin(2, node.pos, 'Remain here until the cast finishes'),
      pin('Reward', node.pos, 'Receive the materials at this node'),
    ],
    notes: [
      'The pin shows the first Eastbrook node from the walkthrough. Step 3 is ongoing progression: use the tables below to choose a later zone and tool tier.',
    ],
  };
}
