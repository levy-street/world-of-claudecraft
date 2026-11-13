import { FACTION_HUB_LANDINGS } from '../../src/sim/content/faction_vendors';
import { STATIONS } from '../../src/sim/content/professions';
import { TRANSPORT_ROUTES } from '../../src/sim/content/transport_ships';
import { LAKE, ZONE1_ZONE } from '../../src/sim/content/zone1';
import { getActiveWorldContent, PORTALS, QUESTS, zoneContaining } from '../../src/sim/data';
import { questRoute } from './quest_route';
import { npcPin, type SystemRoute, worldPin } from './system_route_points';

const camp = getActiveWorldContent().camps.find((c) => c.mobId === 'forest_wolf')!;
const wolf = (step: 'Start' | number | 'Reward', label: string) =>
  worldPin(step, camp.center.x, camp.center.z, label, camp.radius);
const marshal = (step: 'Start' | number | 'Reward', label: string) =>
  npcPin(step, 'marshal_redbrook', label);
const questExample = questRoute(QUESTS.q_wolves)
  .points.filter((p) => typeof p.step === 'number')
  .map((p) => ({ ...p, step: 2, label: 'Forest Wolf objective · ' + p.label }));
const quartermasters = [
  'npc_church_order_quartermaster',
  'npc_rift_watch_quartermaster',
  'npc_automaton_quartermaster',
];
const passage = PORTALS.find((p) => p.id === 'duskfall_passage')!;
const destinations = Object.values(FACTION_HUB_LANDINGS);
const anywhere = (flow: string[], note: string): SystemRoute => ({
  points: [],
  flow,
  notes: [note],
});

export const characterRoutes: Record<string, SystemRoute> = {
  'Leveling and prestige': {
    points: [
      marshal('Start', 'Example quest for XP'),
      wolf(1, 'Defeat Forest Wolves'),
      marshal(
        1,
        'Complete [[Wolves at the Door (Quest, Eastbrook Vale)|Wolves at the Door]] for quest XP',
      ),
    ],
    notes: [
      'This map shows one way to earn XP in Eastbrook. For step 2, rest at any inn, then kill enemies to use up your rested XP. At the top level, you can claim Prestige on your character sheet wherever you are.',
    ],
    flow: [
      'Accept a quest',
      'Earn XP and turn in',
      'At the top level, open Character',
      'Confirm Prestige on the sheet',
    ],
  },
  'Level experience': {
    points: [
      marshal('Start', 'Accept the example quest'),
      wolf(2, 'Earn kill XP'),
      marshal('Reward', 'Complete the quest for its XP'),
    ],
    notes: [
      'These are example ways to earn XP in Eastbrook Vale. Your experience bar fills up wherever you earn the XP. You can find new abilities in the spellbook anywhere.',
    ],
  },
  'Character stats': anywhere(
    ['Character sheet', 'Compare an item in Bags', 'Equip it', 'Read your updated stats'],
    'You can do every step right where you are standing. Your new totals show on the sheet.',
  ),
  'Specialization and talents': anywhere(
    ['Talents', 'View talents', 'Select choices', 'Find granted abilities in the spellbook'],
    'Pick your build while out of combat. Your choices work right away, with no trainer to visit.',
  ),
  Combat: {
    points: [
      wolf('Start', 'Example encounter'),
      wolf(1, 'Target a Forest Wolf'),
      wolf(2, 'Use an attack in range'),
      wolf('Reward', 'Loot the defeated wolf'),
    ],
    notes: [
      'The circle is the camp area. The wolf can be anywhere inside it, and its body stays where the fight ends. You get XP when you kill it, if the kill counts for you.',
    ],
  },
  'Combat pets': anywhere(
    [
      'Spellbook or action bar',
      'Cast your pet summon',
      'Choose a target and command',
      'The pet acts beside you',
    ],
    'You summon your pet right where you are. To find a creature you can tame, see [[Hunter pets]].',
  ),
  'Hunter pets': {
    points: [
      wolf('Start', 'Example tameable Forest Wolf camp'),
      wolf(2, 'Use Wildbond on a living wolf you can tame'),
      wolf('Reward', 'The tamed pet joins you here'),
    ],
    notes: [
      'Put Wildbond on your action bar from the spellbook before you tame. Step 3 uses the pet bar or Patch Up wherever you are.',
    ],
  },
  'Death and recovery': {
    points: [
      worldPin(
        1,
        ZONE1_ZONE.graveyard.x,
        ZONE1_ZONE.graveyard.z,
        'Example graveyard in Eastbrook Vale',
      ),
      worldPin(3, ZONE1_ZONE.graveyard.x, ZONE1_ZONE.graveyard.z, 'Graveyard revival option'),
    ],
    notes: [
      'You start where you died. To run back to your body, follow your body marker. In a dungeon, head for that dungeon’s entrance. You come back to life wherever the way you chose brings you back.',
    ],
    flow: [
      'Death screen',
      'Release Spirit or accept an ally resurrection',
      'Return to your body or use the graveyard',
      'Revive',
    ],
  },
  'Equipment and inventory': anywhere(
    ['Bags', 'Inspect the item', 'Drag to its equipment slot', 'Check the equipped item and stats'],
    'You put gear on from your character sheet. You use consumables from your bags or action bar.',
  ),
  'Equipment sets': anywhere(
    [
      'Choose a set and a bonus',
      'Follow each piece to its source',
      'Equip enough matching pieces',
      'Read the active bonus',
    ],
    'Each set comes from different places, so there is no one place to go. Each set lists its pieces. Each piece’s item page shows the vendors, recipes or enemies that give it.',
  ),
  'Vanguard equipment': {
    points: ['fury', 'warmarshal_draven_kole'].flatMap((id) => [
      npcPin('Start', id, 'Alternative vendor'),
      npcPin('Reward', id, 'Purchase goes to your bags'),
    ]),
    notes: [
      'Use either quartermaster for steps 1 and 2. For step 3, put on enough matching pieces wherever you are.',
    ],
  },
  'Equipment enchants': anywhere(
    [
      'Reagent in Bags',
      'Apply Enchant',
      'Choose formula and item',
      'Finish cast on the chosen item',
    ],
    'Where you get a formula depends on the enchant. You apply the enchant from your bags, so there is no place you have to go.',
  ),
  'Perfecting and promotion': {
    points: STATIONS.map((s) =>
      worldPin(
        3,
        s.pos.x,
        s.pos.z,
        s.type + ' station · use only the matching type for a rank exchange',
      ),
    ),
    notes: [
      'The pins show the stations you can use for a rank swap in step 3. A rank swap is optional. Normal tries and promotion happen in the Perfecting window. The result goes on the item you picked.',
    ],
    flow: [
      'Perfecting window',
      'Select the eligible copy',
      'Attempt ranks',
      'Promote the item or exchange ranks at its station',
    ],
  },
  Questing: {
    points: [
      marshal('Start', 'Accept [[Wolves at the Door (Quest, Eastbrook Vale)|Wolves at the Door]]'),
      ...questExample,
      marshal('Reward', 'Speak to the marshal and complete the quest'),
    ],
    notes: [
      'This is one example quest in Eastbrook Vale. Every other quest has its own map that shows where to do it and where to hand it in.',
    ],
  },
  'Faction standing': {
    points: [
      npcPin('Start', 'npc_wq_taskmaster', 'Open the world quest board'),
      ...quartermasters.map((id) =>
        npcPin(3, id, 'Optional: buy here once your standing is high enough'),
      ),
    ],
    notes: [
      'For step 2, go wherever the quest you picked on the board takes you. You get standing when you finish it. Spend faction currency at that faction’s quartermaster.',
    ],
  },
  'Overworld passages': {
    points: [
      worldPin(
        'Start',
        passage.a.x,
        passage.a.z,
        'Duskfall Passage · Thornpeak side',
        passage.radius,
      ),
      worldPin(2, passage.a.x, passage.a.z, 'Walk into the entrance'),
      worldPin('Reward', passage.b.landing.x, passage.b.landing.z, 'Arrival in The Veiled Hollow'),
      worldPin(3, passage.b.x, passage.b.z, 'Return entrance', passage.radius),
    ],
    notes: ['This shows the trip from Thornpeak. To go the other way, enter on the Hollow side.'],
  },
  'Swimming and climbing': {
    points: [
      worldPin('Start', -92, 67, 'Example shore at Mirror Lake'),
      worldPin(1, LAKE.x, LAKE.z, 'Swim out into Mirror Lake'),
    ],
    notes: [
      'You can start swimming from any shore you can reach. Come up for air to fill your breath bar. Climb at any edge in the ground you can reach. You are done when you reach the surface or the top of the ledge.',
    ],
  },
  Ferries: {
    points: TRANSPORT_ROUTES.flatMap((r) => {
      const [a, b] = r.berths;
      return [
        worldPin('Start', a.x, a.z, 'Example outbound berth for ' + zoneContaining(b.x, b.z)?.name),
        worldPin(2, a.x, a.z, 'Get on the ferry while it is stopped here'),
        worldPin('Reward', b.x, b.z, 'Get off here · trips back start at this dock'),
      ];
    }),
    notes: [
      'These are two different ferry trips. Pick one pair of ports from the steps above. To come back, start from the dock you arrived at.',
    ],
  },
  'Mounts and riding': {
    points: [
      npcPin('Start', 'stablemaster_marla', 'Speak to the stablemaster'),
      npcPin(1, 'stablemaster_marla', 'Buy basic training'),
      npcPin(3, 'stablemaster_marla', 'Return for optional advanced training'),
      npcPin('Reward', 'stablemaster_marla', 'You learn the training as soon as you buy it'),
    ],
    notes: [
      'You can do step 2 anywhere on land while out of combat. Your mount appears next to you.',
    ],
  },
  'Allied Hearthstone': {
    points: [
      ...quartermasters.map((id) =>
        npcPin('Start', id, 'Buy from any of these quartermasters; attune at the place you want'),
      ),
      ...destinations.map((d) =>
        worldPin('Reward', d.x, d.z, d.name + ' · you arrive here if you attuned here'),
      ),
    ],
    notes: [
      'Pick one home. Step 2 starts wherever you are, while out of combat. To change your home in step 3, talk to the quartermaster at a different place.',
    ],
  },
};
