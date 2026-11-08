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
    where: 'Use the chat window or open Social (O by default) anywhere on an online realm.',
    need: "For a private message or friend entry, you need the other character's name.",
    steps: [
      'Right-click their name in chat and choose Add Friend. Open the Friends list in Social to check whether they are online and where they are.',
      'To talk privately, right-click the name, choose Whisper, type your message and press Enter. To speak to your party instead, type /p followed by your message.',
      'For a channel you use regularly, click the plus button on the chat tabs and select that channel. Select its tab before you type.',
    ],
    result:
      'Adding a friend saves the name for future sessions. A whisper goes to the named player. Party chat goes to the group.',
  },
  Parties: {
    where:
      "On an online realm, use chat or the context menu on a player's name. You can invite from different locations.",
    need: 'Two players to form a party. Once a party exists, its leader manages invitations.',
    steps: [
      "Right-click the other player's name in chat and select Invite to Party, or type /invite followed by their character name.",
      'The invited player accepts the prompt. Check the party frames to see who joined. Travel together before killing an enemy or doing an objective that shares credit.',
      'For a raid, fill all five party places first. The leader right-clicks their own portrait, chooses Convert to raid, then invites the additional players.',
    ],
    result:
      'A party holds five players and a raid holds ten. Eligible nearby players share kill rewards. Individual quest objectives can have additional requirements.',
  },
  'Party loot': {
    where:
      'In a party, right-click your own portrait and open Loot Settings. Use these settings before the kill.',
    need: 'Party membership to view the settings. The party leader controls the loot method and roll threshold.',
    steps: [
      'For rolls, select Group Loot and set the Roll Threshold. Defeat a creature together and loot the corpse.',
      'When an eligible item comes up, choose Need, Greed or Pass. Each eligible player makes their own choice. If anyone chooses Need, the highest Need roll wins. Otherwise the highest Greed roll wins.',
      'For assigned loot, the leader selects Master Loot, chooses the Master Looter and sets the threshold. That player assigns qualifying drops to eligible group members.',
    ],
    result:
      "The selected method determines who receives the item. Lower-quality drops and coin follow the party's ordinary loot rules.",
  },
  Guilds: {
    where:
      'Open Social (O by default) and select Guild. You can found or join a player guild anywhere on an online realm.',
    need: 'To found a guild, be guildless, have a valid unused guild name and carry 1 gold. To join an existing guild, get an invitation from someone with invite permission.',
    steps: [
      'To found one, enter the guild name in the Guild tab and select Found. The fee comes from the founder.',
      'To recruit someone, a member with invite permission can right-click their name in chat and choose Invite to Guild. The other player accepts the guild invitation.',
      'Open Guild again to see the roster. Type /g followed by a message to speak to online guildmates. Visit a banker and choose Guild to use a bank your guild has opened.',
    ],
    result:
      'The founder becomes guild leader. An invited player joins the roster. Membership persists between sessions. Your rank controls what you can do with guild resources.',
  },
  'Guild contracts': {
    where: `In Lantern Hall in Highwatch, [[Thornpeak Heights]], speak to ${hallResident(CONTRACT_CLERK_NPC_ID)} to open Contracts.`,
    need: 'Read the active weekly objective. Bring a group eligible for the named dungeon and difficulty. The contract board is open to adventurers, including players without a player guild.',
    steps: [
      'Select a notice and read its target. There is no sign-up or fee. The named-boss bounty allows either difficulty, the Heroic clear requires Heroic, and an execution contract requires its specified encounter task.',
      'Enter the named dungeon and complete the stated objective. Each eligible contributor gets credit for their own first completion of that contract during the week.',
      `To spend the reward, return to Lantern Hall and speak to ${hallResident(GUILD_QUARTERMASTER_NPC_ID)}. Open Quartermaster, choose the reward and press Buy. The mount also requires riding training and bag space.`,
    ],
    result:
      'Lantern Seals go directly to your bags. The board marks the contract complete. Seals buy titles, a sword appearance and a mount. The weekly reset replaces the three contracts.',
  },
  Calendar: {
    where: 'Open Event Calendar (I by default) from anywhere. Dates and booking times use UTC.',
    need: 'Any player can inspect realm events. Only a guild leader or officer can book or remove guild events.',
    steps: [
      'Use Previous month or Next month, then select a day. Read the event name and note to find the related activity.',
      'To schedule a guild event, select the day, enter an Event title and optionally a note. Choose All day or a UTC hour, then select Book event.',
      'Open the same date to see the booking. A leader or officer can use the remove control on the booked event.',
    ],
    result:
      'Guildmates see the booking on the guild calendar. A realm event such as Double Honor changes the reward for its activity while active. Selecting its date just displays the details.',
  },
};
