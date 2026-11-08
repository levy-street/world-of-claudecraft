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
      marshal(1, 'Complete [[Wolves at the Door]] for quest XP'),
    ],
    notes: [
      'One Eastbrook XP route is shown. For step 2, rest at an inn of your choice, then spend rested XP on kills. At the level cap the Prestige claim is on your character sheet wherever you are.',
    ],
    flow: [
      'Accept a quest',
      'Earn XP and turn in',
      'At the cap, open Character',
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
      'Example XP sources in Eastbrook Vale. The experience bar advances where you earn the XP. Learn new abilities in the spellbook from any location.',
    ],
  },
  'Character stats': anywhere(
    ['Character sheet', 'Compare an item in Bags', 'Equip it', 'Read your updated stats'],
    'You can do every step where you are standing. The updated totals appear on the sheet.',
  ),
  'Specialization and talents': anywhere(
    ['Talents', 'View talents', 'Select choices', 'Find granted abilities in the spellbook'],
    'Choose your build out of combat. The choices take effect here, with no trainer or hand-in.',
  ),
  Combat: {
    points: [
      wolf('Start', 'Example encounter'),
      wolf(1, 'Target a Forest Wolf'),
      wolf(2, 'Use an attack in range'),
      wolf('Reward', 'Loot the defeated wolf'),
    ],
    notes: [
      'The circle is the camp area. The wolf and its corpse may be anywhere inside or where the fight ends. XP is credited on an eligible kill.',
    ],
  },
  'Combat pets': anywhere(
    [
      'Spellbook or action bar',
      'Cast your pet summon',
      'Choose a target and command',
      'The pet acts beside you',
    ],
    'A summon works at your position. For the route to a tameable creature, see [[Hunter pets]].',
  ),
  'Hunter pets': {
    points: [
      wolf('Start', 'Example tameable Forest Wolf camp'),
      wolf(2, 'Use Wildbond on a live eligible wolf'),
      wolf('Reward', 'The tamed pet joins you here'),
    ],
    notes: [
      'Prepare Wildbond in the spellbook before the tame. Step 3 uses the pet bar or Patch Up at your current position.',
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
      'Your starting point is the place where you died. On the corpse route follow your own corpse marker. In a dungeon follow the entrance for that instance. The reward is revival where the chosen method resolves.',
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
    'Gear is equipped on your character. Consumables are used from your bags or action bar.',
  ),
  'Equipment sets': anywhere(
    [
      'Choose a set and threshold',
      'Follow each piece to its source',
      'Equip enough matching pieces',
      'Read the active bonus',
    ],
    'There is no shared destination for all sets. Each set lists the pieces, and their item articles identify the vendors, recipes or enemies that supply them.',
  ),
  'Vanguard equipment': {
    points: ['fury', 'warmarshal_draven_kole'].flatMap((id) => [
      npcPin('Start', id, 'Alternative vendor'),
      npcPin('Reward', id, 'Purchase goes to your bags'),
    ]),
    notes: [
      'Choose either quartermaster for steps 1 and 2. Equip enough matching pieces for step 3 wherever you are.',
    ],
  },
  'Equipment enchants': anywhere(
    [
      'Reagent in Bags',
      'Apply Enchant',
      'Choose formula and item',
      'Finish cast on the chosen item',
    ],
    'The map location of a formula depends on the enchant. Applying it through the bag picker has no common hand-in location.',
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
      'Pins show station alternatives for the optional rank exchange in step 3. The ordinary attempt and promotion are completed in the Perfecting window. The benefit is applied to the selected item.',
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
      marshal('Start', 'Accept [[Wolves at the Door]]'),
      ...questExample,
      marshal('Reward', 'Speak to the marshal and complete the quest'),
    ],
    notes: [
      'Worked example in Eastbrook Vale. Each other quest has its own map showing its actual objectives and hand-in.',
    ],
  },
  'Faction standing': {
    points: [
      npcPin('Start', 'npc_wq_taskmaster', 'Open the world quest board'),
      ...quartermasters.map((id) => npcPin(3, id, 'Optional purchase once eligible')),
    ],
    notes: [
      'Step 2 uses the location of the assignment selected on the board. Standing is credited on completion. Spend faction currency at the appropriate quartermaster.',
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
    notes: ['Outbound route from Thornpeak. For the reverse journey enter on the Hollow side.'],
  },
  'Swimming and climbing': {
    points: [
      worldPin('Start', -92, 67, 'Example shore at Mirror Lake'),
      worldPin(1, LAKE.x, LAKE.z, 'Swim out into Mirror Lake'),
    ],
    notes: [
      'Swimming can begin at any reachable shore. Surface to restore breath. Climb at a reachable lip in the terrain. Reaching the surface or the ledge completes the movement.',
    ],
  },
  Ferries: {
    points: TRANSPORT_ROUTES.flatMap((r) => {
      const [a, b] = r.berths;
      return [
        worldPin('Start', a.x, a.z, 'Example outbound berth for ' + zoneContaining(b.x, b.z)?.name),
        worldPin(2, a.x, a.z, 'Board the ferry while docked'),
        worldPin('Reward', b.x, b.z, 'Disembark here · return trips start at this berth'),
      ];
    }),
    notes: [
      'These are two separate crossings. Choose one pair of ports from the walkthrough. For the return trip, swap the departure and arrival berths.',
    ],
  },
  'Mounts and riding': {
    points: [
      npcPin('Start', 'stablemaster_marla', 'Speak to the stablemaster'),
      npcPin(1, 'stablemaster_marla', 'Buy basic training'),
      npcPin(3, 'stablemaster_marla', 'Return for optional advanced training'),
      npcPin('Reward', 'stablemaster_marla', 'Training applies at purchase'),
    ],
    notes: ['Step 2 can be done on land outside combat. The mount is summoned to you.'],
  },
  'Allied Hearthstone': {
    points: [
      ...quartermasters.map((id) =>
        npcPin('Start', id, 'Choose a selling quartermaster; attune at the hub you want'),
      ),
      ...destinations.map((d) =>
        worldPin('Reward', d.x, d.z, d.name + ' · arrival if attuned here'),
      ),
    ],
    notes: [
      'Choose one hub. Step 2 starts at your current position out of combat. To change your destination in step 3, speak to the other hub’s quartermaster.',
    ],
  },
};
