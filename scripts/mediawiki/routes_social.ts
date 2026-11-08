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
    notes: [
      'The message is delivered to the named character. Both players can stay where they are.',
    ],
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
      'Invitations work across locations. The meeting place and kill-credit area depend on the activity you choose.',
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
      'The corpse is where your group defeated the creature. The roll prompt and master-loot assignment use that drop.',
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
      'Steps 1 and 2 happen in Social or the invite prompt. You gain membership when you found the guild or accept. Only the optional storage visit needs the banker shown.',
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
      'The Hollow Crypt entrance and final boss illustrate step 2 only when your contract calls for that objective. Follow the current notice for other targets. Seals go directly to you on completion. The quartermaster is where you redeem them.',
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
      'A calendar booking appears on that day in the guild calendar. Participating in a realm event can require travel to its own activity.',
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
      'The selected deed determines the locations. Its individual article gives the targets, landmarks or counts. Credit is automatic.',
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
      'Every relic has a different source. The collection updates where you acquire the piece.',
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
      'The pins show the Tug purchase option. For a boss drop, use that companion’s source page. Steps 2 and 3 use your collection and the summoned companion’s target frame.',
    ],
  },
  'Mount appearances': {
    points: [
      npcPin('Start', 'stablemaster_marla', 'Optional riding training before your first summon'),
    ],
    flow: ['Cosmetics → Mounts', 'Preview a skin', 'Choose Wear', 'Summon your mount'],
    notes: [
      'Only riding training requires this visit. If you already know how to ride, all appearance selections happen on the current character.',
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
      'Acquisition varies by skin. For a Lantern Hall purchase, follow [[Guild contracts]]. The appearance applies on your equipment at your current location.',
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
      'Steps 1 and 2 happen in the store, parcel window and bags. Account time is credited when the token is redeemed. The map shows the separate gear pickup.',
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
      'Controls travel with your character. The activity you open determines its own reward or destination.',
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
    notes: ['This is a local training procedure. There is no realm NPC or in-game claim.'],
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
      'Map numbers refer to stamps 1 through 5 in “How to earn and redeem each stamp”. The first four show the tutorial hand-in and the three dungeon boss routes. Stamp 5 shows one qualifying raid boss. Starting a card and claiming each reward take place in Social, wherever you stand.',
    ],
  },
};
