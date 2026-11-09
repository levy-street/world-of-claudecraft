import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
} from '../../src/sim/content/highwatch_guild';
import { DUNGEON_LIST, MOBS } from '../../src/sim/data';
import type { RoutePoint } from './quest_map';
import { entranceRoute } from './rotating_routes';
import { npcPin, type SystemRoute, worldPin } from './system_route_points';

function bossRoute(step: number, mobId: string): RoutePoint[] {
  const dungeon = DUNGEON_LIST.find((d) => d.spawns.some((s) => s.mobId === mobId));
  if (!dungeon) throw Error('Missing stamp target ' + mobId);
  const path = entranceRoute(dungeon);
  const first = path[0];
  const points = [
    worldPin(
      step,
      first.doorPos.x,
      first.doorPos.z,
      'Enter ' + first.name + ' for ' + MOBS[mobId].name,
    ),
  ];
  for (let i = 1; i < path.length; i++) {
    const parent = path[i - 1];
    const gate = parent.objects!.find((o) => o.dungeonId === path[i].id)!;
    points.push({
      step,
      frame: parent.name,
      x: gate.x,
      z: gate.z,
      label: 'Take ' + gate.name + ' to ' + path[i].name,
    });
  }
  const target = dungeon.spawns.find((s) => s.mobId === mobId)!;
  points.push({ step, frame: dungeon.name, x: target.x, z: target.z, label: MOBS[mobId].name });
  return points;
}
const banker = 'bursar_fernando';

export const socialRoutes: Record<string, SystemRoute> = {
  'Friends and chat': {
    points: [],
    flow: [
      'Open chat or Social',
      'Select a character name',
      'Add Friend or Whisper',
      'Read the Friends list or conversation',
    ],
    notes: ['The message goes straight to the character you named. Neither of you has to move.'],
  },
  Parties: {
    points: [],
    flow: [
      'Chat name or /invite',
      'Other player accepts',
      'Check the party frames',
      'Group up at the activity you chose',
    ],
    notes: [
      'You can invite someone from anywhere. Where you meet, and where you must stand to share kill credit, depend on what you plan to do.',
    ],
  },
  'Party loot': {
    points: [],
    flow: [
      'Own portrait',
      'Loot Settings',
      'Loot an eligible kill',
      'Roll on or assign the item',
      'Winner receives the item',
    ],
    notes: [
      'The body lies where your group defeated the creature. The roll window and the Master Looter both use what that body drops.',
    ],
  },
  Guilds: {
    points: [npcPin(3, banker, 'Example banker for the optional Guild bank visit')],
    flow: [
      'Social → Guild',
      'Found or accept an invitation',
      'Check the roster',
      'Use guild chat or visit the guild bank',
    ],
    notes: [
      'Steps 1 and 2 happen in Social or in the invite window. You join when you start the guild or accept an invite. You only need to visit the banker shown if you want to use the guild bank.',
    ],
  },
  'Guild contracts': {
    points: [
      npcPin('Start', CONTRACT_CLERK_NPC_ID, 'Read the current contracts'),
      ...bossRoute(2, 'morthen'),
      npcPin(3, GUILD_QUARTERMASTER_NPC_ID, 'Spend Lantern Seals'),
      npcPin('Reward', GUILD_QUARTERMASTER_NPC_ID, 'Collect your chosen purchase'),
    ],
    notes: [
      'The map shows The Hollow Crypt entrance and final boss as an example for step 2. Follow it only when your contract names that goal. For other targets, follow the current notice. Seals go straight to you when you finish. You spend them at the quartermaster.',
    ],
  },
  Calendar: {
    points: [],
    flow: [
      'Event Calendar',
      'Select month and day',
      'Read the event or book a guild event',
      'Check the selected date',
    ],
    notes: [
      'A booking shows on that day in the guild calendar. To take part in a realm event, you may need to travel to where its activity happens.',
    ],
  },
  'Book of Deeds': {
    points: [],
    flow: [
      'Book of Deeds',
      'Read the deed and watch it',
      'Complete the deed’s own objectives',
      'Check Renown and cosmetics in the Book',
    ],
    notes: [
      'Where you go depends on the deed you pick. Its own page lists the targets, landmarks or counts. Your progress counts by itself as you play.',
    ],
  },
  'The Reliquary': {
    points: [],
    flow: [
      'The Reliquary',
      'Choose shelf and relic',
      'Collect the piece from its listed source',
      'See the filled silhouette on the page',
    ],
    notes: [
      'Every relic comes from a different place. Your collection updates as soon as you get the piece, wherever you are.',
    ],
  },
  Companions: {
    points: ['fury', 'warmarshal_draven_kole'].map((id) =>
      npcPin(1, id, 'Alternative Honor vendor for Tug, the Warhorse'),
    ),
    flow: [
      'Unlock the chosen companion',
      'Open Cosmetics',
      'Choose Summon',
      'The companion appears next to you',
    ],
    notes: [
      'The pins show where to buy Tug. For a companion that drops from a boss, see that companion’s own page. Steps 2 and 3 happen in your collection, and the summoned companion then shows its own target frame.',
    ],
  },
  'Mount appearances': {
    points: [
      npcPin('Start', 'stablemaster_marla', 'Optional riding training before your first summon'),
    ],
    flow: ['Cosmetics → Mounts', 'Preview a skin', 'Choose Wear', 'Summon your mount'],
    notes: [
      'You only need this visit to learn riding. If you can already ride, you pick every appearance from your current character, wherever you are.',
    ],
  },
  'Weapon appearances': {
    points: [],
    flow: [
      'Obtain the skin',
      'Equip a matching weapon',
      'Cosmetics → Skins',
      'Apply to your weapon',
    ],
    notes: [
      'Each skin is earned a different way. To buy one in Lantern Hall, follow [[Guild contracts]]. You apply the look to your weapon wherever you are.',
    ],
  },
  Membership: {
    points: [
      npcPin(3, banker, 'Example banker · Account bank → Claim membership gear'),
      npcPin('Reward', banker, 'Receive your claimed equipment'),
    ],
    flow: [
      'WOC Store or tradable token',
      'Collect the purchased token',
      'Use it from Bags',
      'Claim gear at a banker',
    ],
    notes: [
      'Steps 1 and 2 happen in the store, the parcel window and your bags. Your account gets its membership time when you use the token. The map shows where to pick up the gear, which is a separate step.',
    ],
  },
  'Mobile Play': {
    points: [],
    flow: [
      'Enter the world on a touchscreen',
      'Move and select a target',
      'Tap an ability or Quick Actions',
      'Use the selected window',
    ],
    notes: [
      'The controls work wherever your character is. Each activity you open has its own reward or place to go.',
    ],
  },
  'Agents and Bots': {
    points: [],
    flow: [
      'Repository terminal',
      'Build the local simulation',
      'Run the Python example',
      'Read the episode reward in the terminal',
    ],
    notes: [
      'You do this on your own computer to train an agent. There is no NPC to visit and nothing to claim in the game.',
    ],
  },
  'Referral cards': {
    points: [
      npcPin(1, 'ferryman_odo', 'Stamp 1 · turn in Set Sail here'),
      ...bossRoute(2, 'morthen'),
      ...bossRoute(3, 'vael_the_mistcaller'),
      ...bossRoute(4, 'korzul_the_gravewyrm'),
      ...bossRoute(5, 'nythraxis_scourge_of_thornpeak'),
    ],
    flow: [
      'Social → Refer a Friend',
      'Create the friend’s account from the invitation',
      'Party together and both accept the card',
      'Earn the five stamps',
      'Each player opens the card and selects Redeem',
    ],
    notes: [
      'Map numbers refer to stamps 1 to 5 in “How to earn and redeem each stamp”. Number 1 is the tutorial hand-in. Numbers 2 to 4 are the routes to the three dungeon bosses. Number 5 shows one raid boss that counts. You start the card and claim each reward in Social, wherever you are.',
    ],
  },
};
