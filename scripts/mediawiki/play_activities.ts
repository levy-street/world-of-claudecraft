import { NPCS } from '../../src/sim/data';
import { WORLD_PVP_ASSIST_WINDOW } from '../../src/sim/pvp/world_pvp_rules';
import type { PlayPath } from './play_path';

function location(id: string) {
  const { x, z } = NPCS[id].pos;
  return 'x ' + Number(x.toFixed(1)) + ', z ' + Number(z.toFixed(1));
}

const delveBoards =
  'Talk to Brother Halven. He stands in Eastbrook Vale at x -136, z 112 for [[The Collapsed Reliquary (Delve)|The Collapsed Reliquary]]. He also stands in Mirefen Marsh at x -95, z 505 for [[The Drowned Litany (Delve)|The Drowned Litany]].';
const riftEntrance =
  'Watch realm chat for a message that a rift has opened. Go to the zone it names and look for the open portal. Each new portal opens in a different spot and can have a different rank.';
const mapSite =
  'Use a treasure map from your bags. It shows its zone and a dig spot marked with an X. Each map has its own X, so follow your own map to the spot.';
const pvpVendors = `Visit [[FURY (NPC)|FURY]] in Eastbrook Vale (${location('fury')}) or [[Warmarshal Draven Kole (NPC)|Warmarshal Draven Kole]] in Highwatch (${location('warmarshal_draven_kole')}). They both sell the same things.`;

export const activityPaths: Record<string, PlayPath> = {
  'Dungeon Finder': {
    where: 'Press Shift+I to open Dungeon Finder. It works from anywhere on the realm.',
    need: 'Pick an activity that fits the Finder level range of every player in your party. Each player picks at least one role their class can play. Your role choice does not depend on your talent specialization. In a party, the party leader joins the queue for everyone.',
    steps: [
      'Tick the activities you want, pick your role and choose Join queue. When a group is found, every player must accept it within 30 seconds.',
      'To pick your own group instead, post an expedition listing or apply to someone else’s. The leader chooses who to accept.',
      'Once you have a group, open the dungeon’s page to find its entrance. Travel there together. The Finder makes the group, but it does not teleport you. Some raid doors still need an attunement.',
    ],
    result:
      'You join a party for the run you picked. Boss loot and clear credit come from finishing the dungeon itself.',
  },
  'Heroic difficulty': {
    where:
      'Set the difficulty while you are outside the dungeon. Then go to the entrance shown on the dungeon’s page.',
    need: 'Pick a dungeon that has a Heroic mode. You must meet its entry rules and not already have a Heroic lockout for it. In a group, the party leader must pick the difficulty before anyone enters and claims the dungeon.',
    steps: [
      'Open the menu on your own portrait. Choose Set Dungeon Difficulty, then Heroic. Typing /dungeon heroic in chat does the same thing.',
      'Go in and defeat the bosses. Loot the final boss before you leave. Before you try the same run again, check the lockout sign by the minimap.',
      `To spend Heroic Marks, talk to [[Quartermaster Vex (NPC)|Quartermaster Vex]] in Highwatch (${location('heroic_quartermaster')}). Pick an item you can afford.`,
    ],
    result:
      'Boss gear that has a Heroic version drops with Heroic stats. The final boss gives extra loot and Heroic Marks. The lockout lasts a day, and each dungeon has its own.',
  },
  Delves: {
    where: delveBoards,
    need: 'Go alone or with one other player. For the Reliquary, you need level 7 for Normal or level 9 for Heroic. For the Litany, you need level 12 for Normal or level 14 for Heroic.',
    steps: [
      'Pick the delve when you talk to Halven. This opens the Delve Board. Pick Normal or Heroic, pick a companion you can use, then choose Enter Delve.',
      'Follow the goal shown in the delve tracker. In each chamber, beat the enemies or finish its goal. Then walk through the passage that opens. In the last chamber, defeat the named guardian.',
      'Use the reward object. In the Collapsed Reliquary, pick the lock on the reward chest. In the Drowned Litany, press Interact at the reliquary and watch the order the shrines light up. Use the shrines in that same order, then use the open reliquary.',
    ],
    result:
      'You get the clear rewards for your delve and its tier. Your first clears each day give more XP. Spend Delve Marks in the board’s Shop or on your healer.',
  },
  'Delve companions': {
    where: delveBoards,
    need: 'You need the delve’s level, and your party must be small enough for it. A rank 1 healer is free. Rank 2 costs 3 Delve Marks. Rank 3 costs 5 more.',
    steps: [
      'Open the Delve Board and look under Choose a companion. Pick the healer before you choose Enter Delve.',
      'To upgrade, choose Upgrade to Rank next to the healer you want. Check the rank and the Mark cost on the button before you say yes.',
      'Stay close to your healer during the run. She heals on her own, so you do not have to do anything. A rank 3 healer can bring one fallen ally back to life once per run.',
    ],
    result:
      'The healer you picked comes with you into the delve. Ranks you buy keep her healing stronger on every later run too.',
  },
  'Buried hoards': {
    where: mapSite,
    need: 'You must be level 16 or higher. To earn a map, finish every rotating zone slot on your world-quest board that you can do. You can earn one map each time the board changes. The always-open dailies are not needed. If your bags were full, check Ravenpost for the map. Invite any friends to your party before you go in.',
    steps: [
      'Walk to within 12 yards of the X. Use the same map again to dig. This opens a portal.',
      'Use the portal to go in. Common and rare maps open a cave under the ground. Epic and legendary maps open a valley outside. Defeat the guardian. Its attacks are listed on [[Hoard encounters]].',
      'After the kill, each player who can get a reward uses the reward chest to collect their own share.',
    ],
    result:
      'The chest gives copper and materials. It also rolls for more rewards, and the map’s rarity sets those rolls. The map owner gets 50% more copper than a guest.',
  },
  'Hoard encounters': {
    where:
      'Go into a portal you dug up with a treasure map. The hoard is private to your group. Common and rare maps lead to a cave. Epic and legendary maps lead to an open valley. Follow the hoard to its guardian.',
    need: 'You must be level 16 or higher. Use your own map, or join the party of the player who owns the map. See [[Buried hoards]] for how to dig.',
    steps: [
      'Find out which guardian is in the room, then read its entry below to learn its attacks. Watch the warning shapes on the ground and stand in the safe spots. The same boss can have extra attacks on a rarer map.',
      'Defeat the guardian. A reward chest appears. Each player who can get a reward should use it before leaving the room.',
    ],
    result:
      'Each player who can get a reward gets their own chest reward. If you leave the hoard without opening the chest, your share is given to you anyway. Look up the boss and the map rarity below to see what gear and effects it can give.',
  },
  Lockpicking: {
    where:
      'Use the reward chest at the end of the Collapsed Reliquary. You can also use an optional locked cache that you find on a rift floor.',
    need: 'Find a chest that has not been opened yet. Before you touch the lock, pick how many lockpicks to bet (your ante). Betting 1 pick gives the best reward but the fewest tries. A Bountiful Coffer only lets you pick the Hard, Premium path.',
    steps: [
      'Bet 3 picks for one page with three tries. Bet 2 for two pages with two tries. Bet 1 for three pages with one try.',
      'Look at the next column. Every choice moves you one column to the right and changes your row:\n#* Hard Set moves you up two rows.\n#* Set moves you up one row.\n#* Steady keeps you on the same row.\n#* Ease moves you down one row.\n#* Drop moves you down two rows.',
      'Guide the pin through the gap in each gate and stay away from traps. Reach the final seat before the move timer runs out. Finish every page you need, in order.',
    ],
    result:
      'If you solve it, you get the chest tier you picked. If you use up all your tries, a delve reward chest still gives you a smaller prize. A rift cache jams instead and gives you nothing.',
  },
  'Clue hunts': {
    where:
      'Start with a Clue Scroll that is already in your bags. Each hunt page below lists the places and coordinates for its riddles.',
    need: 'You need two Clue Scrolls to finish a hunt from your bags. Starting the hunt uses one. The final dig needs another one in your bags. The world-quest board now gives treasure maps for [[Buried hoards]] instead. You can only follow one hunt at a time.',
    steps: [
      'Use a Clue Scroll from your bags. Find the hunt below that matches its riddle.',
      'Go to each place in order. Do the action it asks for there, such as talking to a certain character or using a certain emote. Wait for the tracker to move on before you leave.',
      'Stand within 12 yards of the final dig spot and use one of your Clue Scrolls. Digging does not use up that scroll, so it stays in your bags. Open the Treasure Casket the dig gives you.',
    ],
    result:
      'The dig gives you faction standing and the casket. The casket holds copper and materials. It also has separate chances to hold gear, Heroic Marks or Grumbol the Lanternback.',
  },
  'Weekly Vault': {
    where: `Visit the [[Vault Keeper (NPC)|Vault Keeper]] in Eastbrook Vale. The Keeper stands next to the vault at ${location('eastbrook_vault_keeper')}. Choose Weekly Rewards.`,
    need: 'Before the weekly Crucible reset, reach at least one goal: 1 raid clear, 1 dungeon clear, 2 world quests or 1 PvP win that counts. Reaching the bigger goals listed below gives you more items to pick from.',
    steps: [
      'After the reset, go to the Keeper and open the oldest week you have not claimed yet. Pick your loot focus. For dungeon and raid vaults, pick one or more boss loot tables you can use.',
      'Open each vault you earned to show its item. The item is then saved and will not change. Look at all the choices and pick the one item you want. Then choose Take selected item and Confirm claim.',
    ],
    result:
      'You keep only one item from all the rows for that week. When you claim it, you give up all the other choices. Weeks you have not opened stay there for later. Any item you have shown stays the same, even after you log out and back in.',
  },
  Rifts: {
    where: riftEntrance,
    need: 'You must be level 20. You can go in alone, but enemies do not get weaker when you have fewer players. Join your group before anyone kills the first enemy or opens a cache, so you all stay in the same copy of the rift.',
    steps: [
      'Use the open portal. The rank in the message tells you how hard it is, from C (easiest) up to S (hardest).',
      'On each floor, defeat the normal enemies and solve any puzzle shown in the tracker. When the way down (the descent) opens, use it. Everyone on that floor moves down together.',
      'Defeat the final boss and loot its body. To win the race bonus, your group must finish this portal before any other group. Use the exit to leave.',
    ],
    result:
      'The first group to finish gets the rank’s [[Rift first-clear rewards]]. If another group is already inside when the portal closes, they can still finish their run.',
  },
  'Rift floors': {
    where:
      'Inside a level 20 natural rift. Every portal makes its own layout. Follow the rift tracker, and use the map to see the floor you are on.',
    need: 'Go into the same [[Rifts|rift]] as your group. To open a normal way down (descent), you must beat the floor’s enemies and solve its puzzle.',
    steps: [
      'Beat the enemies in the room. Then solve the puzzle, if there is one:\n#* Pylons: turn on every pylon.\n#* Ice slide: slide until you reach the goal tile.\n#* Strength boulders: push each boulder onto a pad.\n#* Rune sequence: step on the runes in the order shown.',
      'Use the open descent. Keep going to the last floor and defeat its boss. In the Infernal Citadel, defeat the ritualist first. Take the Blood Orb to open the Temple Gate. Then go down and kill the pit lord.',
    ],
    result:
      'Clearing a floor opens the way on for everyone on it. The final kill opens the exit. It also decides whether you win the first-clear reward.',
  },
  'Rift first-clear rewards': {
    where: riftEntrance,
    need: 'Go into a natural rift that is still open. You must be level 20. Groups race each other, and each group gets its own copy of the same portal. A buried hoard does not use these rewards. It has its own reward chest.',
    steps: [
      'Have your party go into the same portal. Clear each floor and take its descent. Defeat the final boss before another group finishes its copy.',
      'Loot the final boss’s body. You get the group’s shared reward. You also get your own Riftbound band, Rift Essence and any gem saved for you. Take the band to the [[Rift Forge]] to make it better.',
    ],
    result:
      'Winning gives gear and bonus copper based on the rank, plus your own band and Essence. With normal loot settings, you get 1 Essence for C, 2 for B, 3 for A and 4 for S. A and S also give a gem.',
  },
  'Rift Forge': {
    where: `Talk to [[Riftwright Maelis (NPC)|Riftwright Maelis]] in The Farshore at ${location('riftwright_maelis')}. Stand within 7 yards and open Rift Forge.`,
    need: 'First, get a Riftbound band by winning a natural rift’s first clear. Take the band off and put it in your bags. Bring Rift Essence to upgrade it, or a Rift gem to put in a socket.',
    steps: [
      'Find your band in the forge window. To upgrade, click the button that shows the new item level and the Essence cost. The five upgrades cost 2, 4, 6, 8 and 10 Essence.',
      'To add a gem, pick one from the Gem to socket list and choose Socket. If every socket is full, the new gem replaces the oldest one. The window tells you which gem that is before you socket.',
      'Put the band back on from your bags to use its new stats.',
    ],
    result:
      'Upgrading raises the band’s item level. Socketing adds the gem’s combat rating. The band’s rift rank decides how many sockets it has.',
  },
  Duels: {
    where:
      'Meet the other player out in the world, within 30 yards of each other. You cannot duel inside the Nythraxis raid arena.',
    need: 'Neither of you can already be in a duel. The other player must also be free to get an invite.',
    steps: [
      'Open the other player’s name menu and choose Challenge to a Duel. The other player has 30 seconds to choose Accept Duel.',
      'Wait for the three-second countdown. Fight until one player drops to 1 health. Stay within 60 yards of each other, or the duel ends.',
    ],
    result:
      'The game says who won and ends the fight. The loser does not die. A friendly duel does not give ranked Honor, and you do not take the other player’s gold.',
  },
  'World PvP': {
    where:
      'Go to any outdoor zone except The Proving Shore. Open PvP (G) and choose World PvP, or type /pvp in chat.',
    need: 'You must be level 10. To get kill rewards, fight a flagged player who is no more than five levels below you. Players in a raid group do not get the kill reward.',
    steps: [
      'Turn on your PvP flag. Now flagged players can attack you, and you can attack them. While your flag is fully on, you get 10% more XP.',
      `Defeat a player who counts for rewards. You also get credit if you did damage or healing in the ${WORLD_PVP_ASSIST_WINDOW} seconds before the kill. Kill credit, Honor and the gold stake are split between everyone who helped.`,
      'To stop, turn your flag off again. It takes 300 seconds to turn off. It only finishes once you are out of combat and out of the active hill.',
    ],
    result:
      'A normal first kill gives 10 base Honor. You also win a gold stake: 10% of the other player’s gold, up to 5 gold. Killing the same player again gives less. If you lose a fight, you can lose your own stake.',
  },
  'Ashen Coliseum': {
    where: 'In the online world, open PvP (G) and choose the 1v1 or 2v2 arena tab.',
    need: 'Every character who joins must be level 15. To join the queue, you must be alive and not inside an instance. You also cannot be in another PvP queue, a trade or a duel. If you queue with a partner, you both must meet these rules.',
    steps: [
      'For 1v1, leave your party and choose Enter the Queue. For 2v2, you can queue alone and be given a teammate. Or the leader of a two-player party can choose Enter the Queue for you both.',
      'When you arrive in the Coliseum, fight the other side. Stay until the result screen shows, so the match counts as finished. Check your place on the bracket leaderboard.',
    ],
    result:
      'A ranked result changes your rating for that bracket. Wins that count give Honor and count toward the PvP row of the [[Weekly Vault]]. Finished losses and draws can give a smaller amount. If you give up (forfeit), you get no Honor.',
  },
  'Thornhollow battleground': {
    where: 'In the online world, open PvP (G) and pick Thornhollow Fields.',
    need: 'Every character in the queue must be level 20. Go alone or in a party of up to five. A full match needs ten players.',
    steps: [
      'Choose Enter the Queue. When both teams are in, wait at your keep while the teams get ready.',
      'Go to the enemy keep, grab their flag and carry it back to your own flag stand. You can only score while your own flag is safe at home. If your flag is dropped, help get it back by reaching it before an enemy picks it up again.',
      'Score three captures to win. Or have the higher score when the timer ends. Stay until the very end to get credit for the match.',
    ],
    result:
      'The match gives Honor, based on the battleground’s rules. A rated win that counts also counts toward the [[Weekly Vault]].',
  },
  'King of the Hill': {
    where:
      'Watch for the realm message that names the zone and gives a 15-minute warning. Type /hill in chat to see where the hill is and how it is going. Go to the marked circle.',
    need: 'You must be level 10. Go alone or in a party. Players in a raid group do not count for taking the hill or for its rewards. Walking into the active circle can turn on your World PvP flag.',
    steps: [
      'Stay alive inside the circle (within 50 yards of its middle). Keep more of your party inside than any other party for 30 seconds to take the hill. A tie stops the capture from moving. If no living member of your party is left inside, the capture starts over.',
      'Stay in the circle to earn Honor while your party holds it. Defend it, or take it back, until the hill ends after 30 minutes.',
      'For Weekly Vault credit, your group must have held the hill the longest in total, and for at least 10 minutes. You must spend at least one minute inside for that group. You must still be in that group when the hill ends.',
    ],
    result:
      'Each holder in the circle who counts gets 9 Honor for each paid minute. Members of the group that held it longest who meet the rules also get one win toward the [[Weekly Vault]].',
  },
  'Honor and Warfare gear': {
    where: pvpVendors,
    need: 'Bring gold for the Season 1 starter gear. Or earn Honor in PvP activities that count, for the items that cost Honor. Check each item for its price, which money it uses, its class and the level you need to wear it.',
    steps: [
      'Talk to either quartermaster to open the Warfare shop. Look through your set, weapons, trinkets or goods. Check an item before you pick it.',
      'Pick an item that costs the kind of money you have. For example, the starter Furyforged Warhelm costs 17 gold. The Medallion of Defiance costs 800 Honor.',
      'Put on an item you can use from your bags. For a set bonus, wear the number of pieces from the same set that the bonus asks for.',
    ],
    result:
      'Gear you buy gives the stats on its tooltip. Warfare ratings only work when you fight other players. Normal armor, weapon damage and normal stats also work against monsters.',
  },
  'Gourdlight Eve': {
    where:
      'While the realm event is on, visit Hester Gourdwick at the lantern post. She is in Eastbrook Vale (x -4.2, z -110.5), Mirefen Marsh (x -8, z 266) and Thornpeak Heights (x -8.5, z 656.1).',
    need: 'The seasonal event must be turned on for the realm. You can visit each townsperson who takes part once per daily reset.',
    steps: [
      'Stand within 7 yards of a townsperson who takes part, talk to them and choose Trick or treat! Visit different townspeople to get more Gourdlight Sweets.',
      'Bring your sweets to Hester and pick a seasonal item from her shop. Look at the Sweet prices section to see what each toy, costume or writ costs.',
      'For the Emberbristle Broom, fight Old Thatchgrin during the event and collect Emberwoven Sheaves. Give five sheaves to Hester to get the broom.',
    ],
    result:
      'A treat gives two sweets. A trick gives one sweet and changes how you look for a short time. What you buy depends on the item you pick. Players who help fight Thatchgrin and meet the rules also get a separate chance at the broom, if they do not own it yet.',
  },
  'The Card Master': {
    where: `Visit the [[Card Master (NPC)|Card Master]] in Eastbrook Vale at ${location('card_master')}, next to the bank.`,
    need: 'Play online while another real player is around. Stay alive and stand near the dealer to join the queue. You do not need a card item, a certain level or a certain class.',
    steps: [
      'Talk to the dealer, choose Card Duel and pick Join Queue. The board opens when another player joins.',
      'Pick one card from the four in your hand. Both cards are shown after both players pick. The higher number wins the round. In a tie, nobody scores.',
      'Your hand fills up again. Pick another card. Win two rounds to win the match. You have 90 seconds to play a card each round.',
    ],
    result:
      'Your win is saved for your character. Your first win gives you [[House Rules (Deed)|House Rules]] and 5 Renown.',
  },
};
