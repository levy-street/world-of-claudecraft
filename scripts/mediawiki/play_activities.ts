import { NPCS } from '../../src/sim/data';
import type { PlayPath } from './play_path';

function location(id: string) {
  const { x, z } = NPCS[id].pos;
  return 'x ' + Number(x.toFixed(1)) + ', z ' + Number(z.toFixed(1));
}

const delveBoards =
  'Speak to Brother Halven in Eastbrook Vale at x -136, z 112 for [[The Collapsed Reliquary (Delve)|The Collapsed Reliquary]], or in Mirefen Marsh at x -95, z 505 for [[The Drowned Litany (Delve)|The Drowned Litany]].';
const riftEntrance =
  'Watch realm chat for a rift announcement. Travel to the named zone and look for the open portal. Its position and rank change with each opening.';
const mapSite =
  'Use a treasure map from your bags to see its zone and marked dig site. The X belongs to that map, so follow your own map to the spot.';
const pvpVendors = `Visit [[FURY (NPC)|FURY]] in Eastbrook Vale (${location('fury')}) or [[Warmarshal Draven Kole (NPC)|Warmarshal Draven Kole]] in Highwatch (${location('warmarshal_draven_kole')}). They carry the same stock.`;

export const activityPaths: Record<string, PlayPath> = {
  'Dungeon Finder': {
    where: 'Open Dungeon Finder with Shift+I from anywhere on the realm.',
    need: 'Choose an activity that every member meets the Finder level range for, and have each member select at least one role their class can fill. Role choices work independently of talent specialization. A party queues through its leader.',
    steps: [
      'Tick the activities you want, select your role and choose Join queue. Have every player accept the group proposal within 30 seconds.',
      'For a hand-picked group instead, post an expedition listing or apply to one. The leader accepts applications.',
      'Once grouped, open the dungeon article for its entrance. Travel there together. The Finder forms the group without teleporting it, and a raid door can still require attunement.',
    ],
    result:
      'You join a party for the selected run. Boss loot and clear credit come from completing the dungeon itself.',
  },
  'Heroic difficulty': {
    where:
      'Set difficulty outside the dungeon, then travel to the entrance shown on its dungeon page.',
    need: 'Use a dungeon that offers Heroic, meet its entry requirements and have no active Heroic lockout for it. If grouped, have the party leader choose the difficulty before anyone claims the instance.',
    steps: [
      'Open the menu on your own portrait and choose Set Dungeon Difficulty, then Heroic. The chat command /dungeon heroic makes the same selection.',
      'Enter and defeat the bosses. Loot the final boss before leaving. Check the lockout indicator at the minimap before trying the same run again.',
      `To spend Heroic Marks, talk to [[Quartermaster Vex (NPC)|Quartermaster Vex]] in Highwatch (${location('heroic_quartermaster')}) and choose an item you can afford.`,
    ],
    result:
      'Eligible boss gear has Heroic stats. The final boss offers additional loot and Heroic Marks. The daily lockout applies per dungeon.',
  },
  Delves: {
    where: delveBoards,
    need: 'Go solo or as a duo. For the Reliquary, reach level 7 on Normal or 9 on Heroic. For the Litany, reach level 12 on Normal or 14 on Heroic.',
    steps: [
      'Choose the delve from Halven’s conversation to open the Delve Board. Select Normal or Heroic, choose an available companion, then select Enter Delve.',
      'Follow the objective in the delve tracker. Clear the chamber or recover its objective and walk through the opened passage to continue. Defeat the named guardian in the last chamber.',
      'Interact with the reward object. In the Collapsed Reliquary, pick the reward chest’s lock. In the Drowned Litany, press Interact at the reliquary, watch the shrine sequence, repeat it at the shrines, then interact with the open reliquary.',
    ],
    result:
      'You receive the clear rewards for your delve and tier. First daily clears grant the higher XP award. Use Delve Marks at the board’s Shop or spend them on your healer.',
  },
  'Delve companions': {
    where: delveBoards,
    need: 'Meet the delve’s level and party-size requirements. A rank 1 healer is available without spending Marks. An upgrade to rank 2 costs 3 Delve Marks, and rank 3 costs another 5.',
    steps: [
      'Open the Delve Board and look under Choose a companion. Select the available healer before selecting Enter Delve.',
      'If upgrading, select Upgrade to Rank beside the healer you want. Check the rank and Mark cost on the button before confirming your choice.',
      'Stay near your healer during the run. Her healing checks happen automatically. A rank 3 healer can revive a fallen ally once per run.',
    ],
    result:
      'The selected healer accompanies you inside the delve. Purchasing ranks improves her healing on later runs as well.',
  },
  'Buried hoards': {
    where: mapSite,
    need: 'At level 16 or above, finish each eligible rotating zone slot on your world-quest board to earn one map per cycle. Always-open dailies are optional. Check Ravenpost if your bags were full. Invite guests to your party before entering.',
    steps: [
      'Walk to within 12 yards of the X. Use that same map again to dig and open a portal.',
      'Interact with the portal and enter. Common and rare maps open an underground cave. Epic and legendary maps open an outdoor valley. Defeat the guardian. Its mechanics are listed under [[Hoard encounters]].',
      'Each eligible player interacts with the reward chest after the kill to collect their own share.',
    ],
    result:
      'The chest awards copper and materials, with further rolls set by map rarity. The map owner gets 50% more copper than a guest.',
  },
  'Hoard encounters': {
    where:
      'Enter a portal dug from a treasure map. The private hoard is a cave on a common or rare map and an open valley on an epic or legendary map. Follow the hoard to its guardian.',
    need: 'Be level 16 or higher. Use your own map or join the map owner’s party. See [[Buried hoards]] for the dig instructions.',
    steps: [
      'Identify the guardian in the chamber and open its entry below for its attacks. Follow its warning shapes and safe spaces. The same boss can gain extra attacks on a rarer map.',
      'Defeat the guardian. Each eligible player should interact with the newly appeared reward chest before leaving the room.',
    ],
    result:
      'Each eligible participant receives a personal chest reward. Leaving the hoard settles an unclaimed share automatically. Look up the boss and map rarity below for its possible equipment and effects.',
  },
  Lockpicking: {
    where:
      'Interact with the reward chest at the end of the Collapsed Reliquary, or with an optional locked cache you find on a rift floor.',
    need: 'Reach an unopened chest. Pick an ante before touching the lock. The one-pick option offers the best reward with the fewest chances to solve it. A Bountiful Coffer offers only the Hard, Premium path.',
    steps: [
      'Choose 3 picks for one page with three attempts, 2 for two pages with two attempts, or 1 for three pages with one attempt.',
      'Watch the next column. Select Hard Set or Set to move up two rows or one, Steady to stay on your row, or Ease or Drop to move down one or two. Every selection also advances you one column.',
      'Thread each gate through its gap, avoid traps, and reach the final seat before the move timer expires. Complete all required pages in sequence.',
    ],
    result:
      'A solve pays the selected chest tier. If all attempts are spent, a delve reward chest pays consolation loot and a rift cache jams without a payout.',
  },
  'Clue hunts': {
    where:
      'Start from a Clue Scroll already in your bags. The individual hunt articles below list the places and coordinates for each riddle.',
    need: 'Keep two existing scrolls to finish a hunt through the bag controls. Starting spends one, and the final dig requires another in your bags. The current world-quest board awards treasure maps for [[Buried hoards]] instead. You can follow one hunt at a time.',
    steps: [
      'Use a Clue Scroll in your bags. Match its riddle to the hunt entry below.',
      'Go to each indicated place in order. Perform the named action there, such as talking to a particular character or using the requested emote. Wait for the tracker to advance before moving on.',
      'Stand within 12 yards of the final dig spot and use a remaining Clue Scroll. Digging leaves that copy in your bags. Open the Treasure Casket it gives you.',
    ],
    result:
      'The dig awards faction standing and the casket. The casket contains copper and materials, plus separate chances for gear, Heroic Marks or Grumbol the Lanternback.',
  },
  'Weekly Vault': {
    where: `Visit the [[Vault Keeper (NPC)|Vault Keeper]] in Eastbrook Vale, beside the vault at ${location('eastbrook_vault_keeper')}. Choose Weekly Rewards.`,
    need: 'Before the weekly Crucible reset, earn at least one milestone: 1 raid clear, 1 dungeon clear, 2 world quests or 1 qualifying PvP win. Higher thresholds below give more choices.',
    steps: [
      'After reset, open the oldest unclaimed week at the Keeper. Select your loot focus. For dungeon and raid vaults, choose one or more eligible boss tables.',
      'Open each earned vault to reveal and save its item. Inspect the choices, select the single item you want, then choose Take selected item and Confirm claim.',
    ],
    result:
      'You keep one item across all rows for that week. Claiming it gives up every other choice. Unopened weeks remain available and revealed items stay the same after reconnecting.',
  },
  Rifts: {
    where: riftEntrance,
    need: 'Reach level 20. A solo player can enter, but enemies keep their full strength with fewer players. Group before the first kill or opened cache to stay in the same copy.',
    steps: [
      'Interact with the open portal. Use the rank shown in the announcement to judge the difficulty, from C up to S.',
      'On each floor, defeat its ordinary enemies and solve any puzzle in the tracker. Interact with the descent when it opens to move everyone on the floor together.',
      'Defeat the final boss and loot the corpse. For the race bonus, your group must finish this world portal before any other group. Use the exit to return.',
    ],
    result:
      'The first group earns the rank’s [[Rift first-clear rewards]]. Another group already inside can finish its run after the portal is sealed.',
  },
  'Rift floors': {
    where:
      'Inside a level 20 natural rift. Each portal generates its own layout. Follow the rift tracker and use the map to see the floor you are on.',
    need: 'Enter the same [[Rifts|rift]] as your group. The current floor’s enemies and puzzle must both be cleared to open an ordinary descent.',
    steps: [
      'Clear the room enemies. For pylons, activate them all. For an ice slide, reach the goal tile. For strength boulders, push each onto a pad. For rune sequences, step on the runes in the displayed order.',
      'Interact with the open descent. Continue to the final floor and defeat its boss. For Infernal Citadel, defeat the ritualist, take the Blood Orb to open the Temple Gate, then descend and kill the pit lord.',
    ],
    result:
      'A cleared floor opens the route for everyone on it. The final kill opens the exit and determines whether you win the first-clear reward.',
  },
  'Rift first-clear rewards': {
    where: riftEntrance,
    need: 'Enter a still-open natural rift at level 20. Groups race in separate copies of the same portal. A buried hoard uses its own reward chest instead.',
    steps: [
      'Have your party enter the same portal. Clear each floor and take its descent. Defeat the final boss before another group finishes its copy.',
      'Loot the final corpse for the group’s shared reward and your reserved personal Riftbound band, Rift Essence and any gem. Take the band to the [[Rift Forge]] to improve it.',
    ],
    result:
      'Winning earns rank-based gear and bonus copper plus a personal band and Essence. At the ordinary loot rate the Essence amounts are 1 for C, 2 for B, 3 for A and 4 for S. A and S also award a gem.',
  },
  'Rift Forge': {
    where: `Talk to [[Riftwright Maelis (NPC)|Riftwright Maelis]] in The Farshore at ${location('riftwright_maelis')}. Stand within 7 yards and open Rift Forge.`,
    need: 'Obtain a Riftbound band from a natural rift first clear. Unequip it and put it in your bags. Bring Rift Essence for an upgrade or a Rift gem for a socket.',
    steps: [
      'Find your band in the forge window. For an upgrade, click the button showing its new item level and Essence cost. The five steps cost 2, 4, 6, 8 and 10 Essence.',
      'To add a gem, select one from the Gem to socket list and choose Socket. A full band replaces its oldest gem, which the window names before you socket.',
      'Equip the upgraded band from your bags to use its new stats.',
    ],
    result:
      'Upgrading raises the band’s item level. Socketing adds the selected gem’s combat rating. The band’s original rift rank determines how many sockets it has.',
  },
  Duels: {
    where: 'Meet the other player within 30 yards in the world, outside the Nythraxis raid arena.',
    need: 'Both players must be free of another duel, and the other player must be free to receive an invitation.',
    steps: [
      'Open the other player’s name menu and choose Challenge to a Duel. The other player chooses Accept Duel within 30 seconds.',
      'Wait for the three-second countdown. Fight until one participant reaches 1 health. Staying within 60 yards of each other keeps the duel going.',
    ],
    result:
      'The game announces the winner and ends the fight without killing the loser. A friendly duel does not pay ranked Honor or take the other player’s gold.',
  },
  'World PvP': {
    where:
      'Go to an overworld zone outside The Proving Shore. Open PvP (G) and choose World PvP, or type /pvp in chat.',
    need: 'Reach level 10. To earn kill rewards, fight a flagged player no more than five levels below you. Raid members are ineligible for the kill payout.',
    steps: [
      'Raise your flag. A flagged opponent can now attack you, and you can attack them. While your flag is fully active, XP earns a 10% bonus.',
      'Defeat an eligible opponent, or contribute damage or healing within the assist window. Kill credit, Honor and the gold stake are shared between qualifying participants.',
      'To stop, toggle your flag again. Allow 300 seconds to disarm and leave combat and the active hill before it can finish.',
    ],
    result:
      'An ordinary first kill is worth 10 base Honor, with a gold stake of 10% of the victim’s purse up to 5 gold. Repeated kills of the same player pay less. A defeat can cost you your own stake.',
  },
  'Ashen Coliseum': {
    where: 'In the online world, open PvP (G) and choose the 1v1 or 2v2 arena tab.',
    need: 'Reach level 15 on each participating character. Queue alive, outside an instance and free of another PvP queue, trade or duel. For a premade pair, both partners must qualify.',
    steps: [
      'For 1v1, leave your party and select Enter the Queue. In 2v2 you can queue alone for a teammate, or have the leader of a two-player party choose Enter the Queue for both of you.',
      'When placed in the Coliseum, fight the opposing side. Stay through the result screen for a completed match. Check your standing on the bracket leaderboard.',
    ],
    result:
      'A ranked result updates that bracket’s rating. Eligible wins pay Honor and count toward the PvP row of the [[Weekly Vault]]. Completed losses and draws can pay a smaller share. Forfeits do not pay Honor.',
  },
  'Thornhollow battleground': {
    where: 'In the online world, open PvP (G) and select Thornhollow Fields.',
    need: 'Reach level 20 on every character in the queue. Go alone or with a party of up to five. A full match needs ten players.',
    steps: [
      'Choose Enter the Queue, then wait at your keep through the form-up when the two teams are seated.',
      'Reach the enemy flag in their keep and carry it back to your own stand. You can score only while your own flag is home. Help return your own dropped flag by reaching it before an enemy picks it up again.',
      'Score three captures to win, or finish ahead on score when the timer ends. Stay through the end for match credit.',
    ],
    result:
      'The match pays Honor under its battleground rules. A qualifying rated win also counts toward the [[Weekly Vault]].',
  },
  'King of the Hill': {
    where:
      'Watch the realm announcement for the zone and the 15-minute warning. Use /hill in chat for the current location and status. Travel to the marked circle.',
    need: 'Reach level 10 and go alone or in a party. Raid members do not count for control or hold rewards. Entering the active circle can raise your World PvP flag.',
    steps: [
      'Stand alive within the 50-yard circle. Keep more party members inside than any rival party for 30 seconds to capture it. A tie pauses capture progress. Losing every living party member inside resets it.',
      'Stay in the circle to earn Honor while your party holds it. Defend or recapture it until the hill falls after 30 minutes.',
      'For vault credit, your group must finish with the longest accumulated hold and at least 10 minutes held. Spend at least one minute inside for that group and still belong to it when the hill falls.',
    ],
    result:
      'Each eligible holder in the circle earns 9 Honor per paid minute. Qualifying members of the longest-holding group also get one win toward the [[Weekly Vault]].',
  },
  'Honor and Warfare gear': {
    where: pvpVendors,
    need: 'Bring gold for Season 1 entry gear, or earn Honor from eligible PvP activities for the Honor-priced stock. Check the individual offer for its currency, price, class and equip level.',
    steps: [
      'Speak to either quartermaster to open the Warfare shop. Look through your set, weapons, trinkets or goods. Inspect the piece before choosing it.',
      'Choose the item priced in the currency you have. For example, the entry-tier Furyforged Warhelm costs 17 gold. The Medallion of Defiance costs 800 Honor.',
      'Equip a usable piece from your bags. For a set bonus, wear the indicated number of pieces from the same set.',
    ],
    result:
      'Purchased gear adds the stats on its tooltip. Warfare ratings apply in player combat. Ordinary armor, weapon damage and ordinary attributes also work against creatures.',
  },
  'Gourdlight Eve': {
    where:
      'While the realm event is active, visit Hester Gourdwick at the lantern post in Eastbrook Vale (x -4.2, z -110.5), Mirefen Marsh (x -8, z 266) or Thornpeak Heights (x -8.5, z 656.1).',
    need: 'The realm must have the seasonal event switched on. Each participating townsperson can be visited once per daily reset.',
    steps: [
      'Speak to a participating townsperson from within 7 yards and choose Trick or treat! Visit different eligible townspeople to collect more Gourdlight Sweets.',
      'Take your sweets to Hester and select a seasonal purchase from her shop. Check the Sweet prices section for the cost of the exact toy, costume or writ you want.',
      'For the Emberbristle Broom, fight Old Thatchgrin during the event and collect Emberwoven Sheaves. Trade five sheaves to Hester for the broom.',
    ],
    result:
      'A treat gives two sweets. A trick gives one sweet and a temporary cosmetic effect. Your purchases depend on the item you choose. Eligible Thatchgrin contributors also have a separate chance for an unowned broom.',
  },
  'The Card Master': {
    where: `Visit the [[Card Master (NPC)|Card Master]] in Eastbrook Vale at ${location('card_master')}, beside the bank.`,
    need: 'Play online with another human available. Be alive and stand near the dealer to queue. You do not need a card item, a minimum level or a particular class.',
    steps: [
      'Speak to the dealer, choose Card Duel and select Join Queue. The board opens when another player joins.',
      'Select one card from the four in your hand. Both cards are revealed after both players choose. The higher number wins one round, and a tie scores neither player.',
      'Choose again from the replenished hand. Win two rounds to win the match. The board gives you 90 seconds to play a card each round.',
    ],
    result:
      'The win is recorded for your character. Your first win earns [[House Rules (Deed)|House Rules]] and 5 Renown.',
  },
};
