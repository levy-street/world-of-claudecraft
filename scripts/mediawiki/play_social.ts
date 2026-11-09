import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
} from '../../src/sim/content/highwatch_guild';
import { BUILTIN_WORLD } from '../../src/sim/data';
import type { PlayPath } from './play_path';

function hallResident(id: string) {
  const { name, pos } = BUILTIN_WORLD.npcs[id];
  return `[[${name} (NPC)|${name}]] (x ${Number(pos.x.toFixed(1))}, z ${Number(pos.z.toFixed(1))})`;
}

export const socialPaths: Record<string, PlayPath> = {
  'Friends and chat': {
    where:
      'Use the chat window, or open Social (O by default). You can do this anywhere on an online realm.',
    need: "To whisper someone or add them as a friend, you need their character's name.",
    steps: [
      'Right-click their name in chat and choose Add Friend. Open the Friends list in Social to see if they are online and where they are.',
      'To talk privately, right-click the name and choose Whisper. Type your message and press Enter. To talk to your party instead, type /p and then your message.',
      'To keep a channel handy, click the plus button on the chat tabs and pick that channel. Click its tab before you type.',
    ],
    result:
      'A friend you add stays on your list next time you play. A whisper goes only to the player you named. Party chat goes to your whole group.',
  },
  Parties: {
    where:
      "On an online realm, use chat or right-click a player's name. You do not need to be in the same place to invite someone.",
    need: 'You need two players to make a party. Once the party exists, its leader handles invites.',
    steps: [
      "Right-click the other player's name in chat and choose Invite to Party. Or type /invite and then their character name.",
      'The other player accepts the invite. Check the party frames to see who joined. Travel together before you kill an enemy or do a goal that shares credit.',
      'For a raid, fill all five party spots first. Then the leader right-clicks their own portrait, chooses Convert to raid, and invites more players.',
    ],
    result:
      'A party holds five players and a raid holds ten. Nearby players who qualify share the rewards for a kill. Some quest goals have extra rules of their own.',
  },
  'Party loot': {
    where:
      'In a party, right-click your own portrait and open Loot Settings. Set these before the kill.',
    need: 'You must be in a party to see the settings. The party leader picks the loot method and the roll threshold.',
    steps: [
      'To roll for items, pick Group Loot and set the Roll Threshold. Defeat a creature together and loot its body.',
      'When an item comes up for a roll, choose Need, Greed or Pass. Each player who can roll makes their own choice. If anyone picks Need, the highest Need roll wins. If nobody picks Need, the highest Greed roll wins.',
      'To hand items out instead, the leader picks Master Loot, chooses the Master Looter and sets the threshold. That player then gives each drop that meets the threshold to a group member who can take it.',
    ],
    result:
      "The loot method you chose decides who gets the item. Lower-quality drops and coin follow the party's normal loot rules.",
  },
  Guilds: {
    where:
      'Open Social (O by default) and choose Guild. You can start or join a player guild anywhere on an online realm.',
    need: 'To start a guild, you must not be in one already. You also need a guild name that is allowed and not taken, and 1 gold. To join a guild, someone allowed to invite must invite you.',
    steps: [
      'To start one, type the guild name in the Guild tab and choose Found. The 1 gold fee is taken from you.',
      'To recruit someone, a member who is allowed to invite right-clicks their name in chat and chooses Invite to Guild. The other player accepts the invite.',
      'Open Guild again to see the member list. Type /g and then a message to talk to guildmates who are online. To use a guild bank your guild has opened, visit a banker and choose Guild.',
    ],
    result:
      'The player who starts the guild becomes its leader. A player who accepts an invite joins the member list. You stay in the guild between play sessions. Your rank decides what you can do with the guild bank and other guild tools.',
  },
  'Guild contracts': {
    where: `In Lantern Hall in Highwatch, [[Thornpeak Heights]], talk to ${hallResident(CONTRACT_CLERK_NPC_ID)} to open Contracts.`,
    need: "Read this week's goal. Bring a group that can enter the named dungeon on the right difficulty. Anyone can use the contract board, even players who are not in a guild.",
    steps: [
      'Pick a notice and read its target. You do not sign up or pay anything. The named-boss bounty works on either difficulty. The Heroic clear must be done on Heroic. An execution contract needs you to do the task it names during a fight.',
      'Go into the named dungeon and finish the goal. Each player who qualifies gets credit the first time they finish that contract each week.',
      `To spend your reward, go back to Lantern Hall and talk to ${hallResident(GUILD_QUARTERMASTER_NPC_ID)}. Open Quartermaster, pick the reward and press Buy. To buy the mount, you also need riding training and a free bag space.`,
    ],
    result:
      'Lantern Seals go straight into your bags. The board marks the contract as done. Seals buy titles, a sword appearance and a mount. The weekly reset swaps in three new contracts.',
  },
  Calendar: {
    where:
      'Open the Event Calendar (I by default) from anywhere. All dates and booking times are in UTC.',
    need: 'Any player can look at realm events. Only a guild leader or officer can add or remove guild events.',
    steps: [
      'Use Previous month or Next month, then pick a day. Read the event name and note to find out what activity it is for.',
      'To plan a guild event, pick the day and type an Event title. You can add a note if you like. Choose All day or a UTC hour, then choose Book event.',
      'Open the same date to see the booking. A leader or officer can use the remove button on the booked event.',
    ],
    result:
      'Your guildmates see the booking on the guild calendar. While a realm event such as Double Honor is running, it changes the reward for its activity. Picking its date only shows you the details.',
  },
};
